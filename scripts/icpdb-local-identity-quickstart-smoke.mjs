#!/usr/bin/env node
// Where: scripts/icpdb-local-identity-quickstart-smoke.mjs
// What: Focused local-network smoke for the package/identity Server-CI quickstart path.
// Why: The full identity smoke is intentionally broad; this keeps the shortest DB-to-SQL path independently verifiable.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Ed25519KeyIdentity } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/identity/index.js";
import {
  createIdentityActor,
  executeIdentityCommand,
  formatIdentityCommandOutput,
  loadServiceIdentity,
  parseIdentityCliArgs,
  writeIdentityEnvOutputFile
} from "./icpdb-identity.mjs";
import { checkServiceEnv, formatServiceEnvCheck } from "./icpdb-service-env-check.mjs";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const smokeProgress = process.env.ICPDB_SMOKE_PROGRESS === "1";
const options = parseArgs(process.argv.slice(2));
const execFileAsync = promisify(execFile);
const packageCliPath = fileURLToPath(new URL("../icpdb-console/dist-sdk/icpdb-cli.js", import.meta.url));

async function main() {
  await assertPackageCliBuilt();
  const network = await localNetworkConfig(environment, canisterName);
  const ownerIdentity = Ed25519KeyIdentity.generate();
  const ownerEnv = identityEnv(network, ownerIdentity);
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-identity-quickstart-smoke-"));
  progress(`network ${network.networkUrl} canister ${network.canisterId}`);

  if (shouldRun("package-dotenv")) await smokePackageDotEnv(network, tempDir);
  if (shouldRun("query-only")) await smokePackageQueryOnly(network, tempDir);
  if (shouldRun("setup-file")) await smokeProvisionSetupFile(network, ownerEnv, tempDir);
  if (shouldRun("setup-migrations")) await smokeProvisionSetupMigrations(network, ownerEnv, tempDir);

  console.log("ICPDB local identity quickstart smoke OK");
}

function parseArgs(args) {
  const parsed = { only: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--only") {
      index += 1;
      if (index >= args.length) fail("--only requires a comma-separated smoke list");
      parsed.only.push(...smokeIds(args[index]));
    } else if (arg.startsWith("--only=")) {
      parsed.only.push(...smokeIds(arg.slice("--only=".length)));
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  const knownIds = new Set(["package-dotenv", "query-only", "setup-file", "setup-migrations"]);
  const unknownIds = parsed.only.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) fail(`unknown --only smoke: ${unknownIds.join(", ")}`);
  return parsed;
}

function smokeIds(value) {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function shouldRun(id) {
  return options.only.length === 0 || options.only.includes(id);
}

async function smokePackageDotEnv(network, tempDir) {
  const envPath = join(tempDir, ".env");
  let databaseId;
  try {
    await waitForLocalGateway(network.networkUrl, "before package .env init");
    const initOutput = await runPackageCli([
      "init",
      "--env-out",
      envPath,
      ...packageTargetArgs(network),
      "--setup-sql",
      "CREATE TABLE package_dotenv_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO package_dotenv_notes(body) VALUES ('from-package-dotenv-setup')",
      "--format",
      "env"
    ]);
    const envText = await readFile(envPath, "utf8");
    databaseId = requiredEnvOutputValue(initOutput, "ICPDB_DATABASE_ID");
    assertIncludes(initOutput, `ICPDB_URL="icpdb://${network.canisterId}/${databaseId}"`);
    assertIncludes(envText, `ICPDB_DATABASE_ID="${databaseId}"`);
    assertIncludes(envText, `ICPDB_URL="icpdb://${network.canisterId}/${databaseId}"`);
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
    const inspectOutput = await runPackageCli(["inspect-env", "--service-env-file", envPath, "--format", "env"]);
    assertIncludes(inspectOutput, `ICPDB_DATABASE_ID="${databaseId}"`);
    const queryOutput = await runPackageCli([
      "query",
      "SELECT body FROM package_dotenv_notes",
      "--service-env-file",
      envPath,
      "--format",
      "table"
    ]);
    assertIncludes(queryOutput, "from-package-dotenv-setup");
  } catch (error) {
    const cleanupDatabaseId = databaseId ?? await readOptionalEnvFileValue(envPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) await deletePackageDatabaseBestEffort(envPath, cleanupDatabaseId);
    throw error;
  }
  await runPackageCli(["delete-db", "--confirm", databaseId, "--service-env-file", envPath]);
  progress("package .env init/query/delete verified");
}

async function smokePackageQueryOnly(network, tempDir) {
  const envPath = join(tempDir, "query-only-service.env");
  let databaseId;
  try {
    await waitForLocalGateway(network.networkUrl, "before package query-only generate-identity");
    await runPackageCli([
      "generate-identity",
      "--env-out",
      envPath,
      ...packageTargetArgs(network),
      "--format",
      "table"
    ]);
    let envText = await readFile(envPath, "utf8");
    assertIncludes(envText, `ICPDB_CANISTER_ID="${network.canisterId}"`);
    assert.ok(!envText.includes("ICPDB_DATABASE_ID="), "query-only service env should start without database id");
    assert.ok(!envText.includes(`icpdb://${network.canisterId}/`), "query-only service env should start with canister-only URL");
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);

    const scalarOutput = await runPackageCli([
      "scalar",
      "SELECT 1 AS value",
      "--service-env-file",
      envPath,
      "--format",
      "table"
    ]);
    assertIncludes(scalarOutput, "value");
    assertIncludes(scalarOutput, "1");
    envText = await readFile(envPath, "utf8");
    databaseId = requiredEnvOutputValue(envText, "ICPDB_DATABASE_ID");
    assertIncludes(envText, `ICPDB_URL="icpdb://${network.canisterId}/${databaseId}"`);
    const writeIdempotencyKey = `readiness-query-only-write-${databaseId}`;

    await runPackageCli([
      "execute",
      "CREATE TABLE readiness_query_only(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
      "--service-env-file",
      envPath,
      "--format",
      "table"
    ]);
    await runPackageCli([
      "execute",
      "INSERT INTO readiness_query_only(body) VALUES (?1)",
      "--params",
      "[\"readiness-query-only\"]",
      "--idempotency-key",
      writeIdempotencyKey,
      "--wait",
      "--service-env-file",
      envPath,
      "--format",
      "table"
    ]);
    const queryOutput = await runPackageCli([
      "query",
      "SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1",
      "--service-env-file",
      envPath,
      "--format",
      "table"
    ]);
    assertIncludes(queryOutput, "readiness-query-only");
    const urlOutput = await runPackageCli(["url", "--service-env-file", envPath, "--format", "env"]);
    assertIncludes(urlOutput, `ICPDB_URL="icpdb://${network.canisterId}/${databaseId}"`);
    const infoOutput = await runPackageCli(["info", "--service-env-file", envPath, "--format", "env"]);
    assertIncludes(infoOutput, `ICPDB_CONNECTION_URL="icpdb://${network.canisterId}/${databaseId}"`);
    const checkOutput = await runPackageCli([
      "check-env",
      "--service-env-file",
      envPath,
      "--require-role",
      "owner",
      "--smoke-sql",
      "--smoke-sdk",
      "--format",
      "table"
    ]);
    assertIncludes(checkOutput, "caller_role_at_least_owner");
    assertIncludes(checkOutput, "sql_scalar");
    assertIncludes(checkOutput, "sdk_scalar");
  } catch (error) {
    const cleanupDatabaseId = databaseId ?? await readOptionalEnvFileValue(envPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) await deletePackageDatabaseBestEffort(envPath, cleanupDatabaseId);
    throw error;
  }
  await runPackageCli(["delete-db", "--confirm", databaseId, "--service-env-file", envPath]);
  progress("package query-only service.env create/execute/query/check verified");
}

async function smokeProvisionSetupFile(network, ownerEnv, tempDir) {
  const setupPath = join(tempDir, "quickstart-schema.sql");
  const envPath = join(tempDir, "service.env");
  await writeFile(setupPath, "CREATE TABLE quickstart_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE VIEW quickstart_notes_view AS SELECT id, body FROM quickstart_notes;");
  let provisioned;
  try {
    const output = await runIdentityCli(ownerEnv, [
      "--service-identity-type",
      "ed25519",
      "provision-service-db",
      "writer",
      "--setup-file",
      setupPath
    ]);
    provisioned = JSON.parse(output);
    assert.equal(provisioned.role, "writer");
    assert.equal(provisioned.setup_statement_count, 2);
    assert.equal(provisioned.env.ICPDB_CANISTER_ID, network.canisterId);
    assert.equal(provisioned.env.ICPDB_DATABASE_ID, provisioned.database_id);
    assert.equal(provisioned.env.ICPDB_URL, `icpdb://${network.canisterId}/${provisioned.database_id}`);
    await writeIdentityEnvOutputFile(envPath, provisioned);
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
    await runIdentityCli({}, ["--env-file", envPath, "execute", "INSERT INTO quickstart_notes(body) VALUES ('from-quickstart-service-db')"]);
    const queryOutput = await runIdentityCliFormatted({}, ["--env-file", envPath, "query", "SELECT body FROM quickstart_notes", "--format", "table"]);
    assertIncludes(queryOutput, "from-quickstart-service-db");
    const viewsOutput = await runIdentityCliFormatted({}, ["--env-file", envPath, "views", "--format", "table"]);
    assertIncludes(viewsOutput, "quickstart_notes_view");
    const statusOutput = await runIdentityCliFormatted({}, ["--env-file", envPath, "status", "--format", "table"]);
    assertIncludes(statusOutput, `icpdb://${network.canisterId}/${provisioned.database_id}`);
    assertIncludes(statusOutput, "writer");
    const serviceEnvCheck = await checkServiceEnv({
      envFile: envPath,
      skipCall: false,
      requireRole: "writer",
      smokeSql: true,
      smokeSdk: true
    });
    assert.equal(serviceEnvCheck.inspect.connection_url, `icpdb://${network.canisterId}/${provisioned.database_id}`);
    assertIncludes(serviceEnvCheck.checks.join(","), "caller_role_at_least_writer");
    assertIncludes(serviceEnvCheck.checks.join(","), "sdk_cleanup");
    assertIncludes(formatServiceEnvCheck(serviceEnvCheck, "table"), "caller_principal");
  } finally {
    if (provisioned?.database_id) await deleteIdentityDatabaseBestEffort(ownerEnv, provisioned.database_id);
  }
  progress("provision-service-db setup-file service.env verified");
}

async function smokeProvisionSetupMigrations(network, ownerEnv, tempDir) {
  const migrationsPath = join(tempDir, "quickstart-migrations.json");
  const envPath = join(tempDir, "migrated-service.env");
  await writeFile(migrationsPath, JSON.stringify([{
    version: "quickstart-001",
    name: "create_quickstart_migrated",
    sql: "CREATE TABLE quickstart_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO quickstart_migrated(body) VALUES ('from-quickstart-migration'); CREATE VIEW quickstart_migrated_view AS SELECT id, body FROM quickstart_migrated;"
  }]));
  let provisioned;
  try {
    const output = await runIdentityCli(ownerEnv, [
      "--service-identity-type",
      "ed25519",
      "provision-service-db",
      "writer",
      "--setup-migrations-file",
      migrationsPath
    ]);
    provisioned = JSON.parse(output);
    assert.equal(provisioned.setup_migration_count, 1);
    assert.deepEqual(provisioned.setup_migration_applied, ["quickstart-001"]);
    assert.ok(BigInt(provisioned.setup_rows_affected) >= 2n, `expected setup rows affected >= 2, got ${provisioned.setup_rows_affected}`);
    await writeIdentityEnvOutputFile(envPath, provisioned);
    const queryOutput = await runIdentityCliFormatted({}, ["--env-file", envPath, "query", "SELECT body FROM quickstart_migrated", "--format", "table"]);
    assertIncludes(queryOutput, "from-quickstart-migration");
    const schemaOutput = await runIdentityCliFormatted({}, ["--env-file", envPath, "schema", "quickstart_migrated", "--format", "table"]);
    assertIncludes(schemaOutput, "CREATE TABLE quickstart_migrated");
    const inspectOutput = await runIdentityCliFormatted({}, ["--env-file", envPath, "inspect", "quickstart_migrated", "--format", "table"]);
    assertIncludes(inspectOutput, "from-quickstart-migration");
    const urlOutput = await runIdentityCliFormatted({}, ["--env-file", envPath, "url", "--format", "env"]);
    assertIncludes(urlOutput, `ICPDB_URL="icpdb://${network.canisterId}/${provisioned.database_id}"`);
  } finally {
    if (provisioned?.database_id) await deleteIdentityDatabaseBestEffort(ownerEnv, provisioned.database_id);
  }
  progress("provision-service-db setup-migrations service.env verified");
}

function progress(message) {
  if (smokeProgress) console.error(`[icpdb-identity-quickstart-smoke] ${message}`);
}

function identityEnv(network, identity) {
  return {
    ...process.env,
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_NETWORK_URL: network.networkUrl,
    ICPDB_IDENTITY_JSON: JSON.stringify(identity.toJSON()),
    ICPDB_IDENTITY_PEM: "",
    ICPDB_IDENTITY_PEM_FILE: "",
    ICPDB_IDENTITY_JSON_FILE: "",
    ICPDB_IDENTITY_TYPE: "ed25519",
    ICPDB_ROOT_KEY: network.rootKey
  };
}

function packageTargetArgs(network) {
  return [
    "--canister-id",
    network.canisterId,
    "--network-url",
    network.networkUrl,
    ...(network.rootKey ? ["--root-key", network.rootKey] : [])
  ];
}

async function runIdentityCli(env, args) {
  try {
    const command = parseIdentityCliArgs(args, env);
    const identity = command.snapshotInfo ? null : await loadServiceIdentity(command);
    const actor = command.principal || command.snapshotInfo || command.inspectEnv ? null : await createIdentityActor(command, identity);
    return stableJson(await executeIdentityCommand(command, actor, identity));
  } catch (error) {
    throw new Error(`identity CLI failed for ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runIdentityCliFormatted(env, args) {
  try {
    const command = parseIdentityCliArgs(args, env);
    const identity = command.snapshotInfo ? null : await loadServiceIdentity(command);
    const actor = command.principal || command.snapshotInfo || command.inspectEnv ? null : await createIdentityActor(command, identity);
    return formatIdentityCommandOutput(await executeIdentityCommand(command, actor, identity), command);
  } catch (error) {
    throw new Error(`identity CLI failed for ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runPackageCli(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [packageCliPath, ...args], {
      env: process.env,
      maxBuffer: 1024 * 1024 * 16
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`package CLI failed for ${args.join(" ")}: ${message}${stderr ? `\n${stderr}` : ""}`);
  }
}

async function waitForLocalGateway(networkUrl, label) {
  let lastFailure = "no attempts";
  for (let attempt = 1; attempt <= 80; attempt += 1) {
    try {
      const response = await fetch(`${networkUrl}/api/v2/status`);
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = fetchFailureMessage(error);
      // Local PocketIC gateway may briefly stop accepting requests after deploy or heavy calls.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`local ICP gateway did not become ready ${label}: ${lastFailure}`);
}

function fetchFailureMessage(error) {
  if (!(error instanceof Error)) return "fetch failed";
  const cause = "cause" in error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

async function deletePackageDatabaseBestEffort(envPath, databaseId) {
  try {
    await runPackageCli(["delete-db", "--confirm", databaseId, "--service-env-file", envPath]);
  } catch (error) {
    progress(`package CLI cleanup failed for ${databaseId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function deleteIdentityDatabaseBestEffort(ownerEnv, databaseId) {
  try {
    await runIdentityCli({ ...ownerEnv, ICPDB_DATABASE_ID: databaseId }, ["delete-db"]);
  } catch (error) {
    progress(`identity CLI cleanup failed for ${databaseId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readOptionalEnvFileValue(path, key) {
  try {
    const source = await readFile(path, "utf8");
    const match = source.match(new RegExp(`^${key}="([^"]+)"$`, "m"));
    return match?.[1];
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertPackageCliBuilt() {
  try {
    await stat(packageCliPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(`package CLI smoke requires built SDK bin: run pnpm --dir icpdb-console build:sdk before ${fileURLToPath(import.meta.url)}`);
    }
    throw error;
  }
}

function isErrnoException(error) {
  return typeof error === "object" && error !== null && "code" in error;
}

function assertIncludes(source, expected) {
  assert.ok(source.includes(expected), `expected output to include ${expected}\n${source}`);
}

function requiredEnvOutputValue(source, key) {
  const match = source.match(new RegExp(`^${key}="([^"]+)"$`, "m"));
  assert.ok(match, `expected env output to include ${key}\n${source}`);
  return match[1];
}

function stableJson(value) {
  return JSON.stringify(value, (_key, nextValue) => typeof nextValue === "bigint" ? nextValue.toString() : nextValue, 2);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
