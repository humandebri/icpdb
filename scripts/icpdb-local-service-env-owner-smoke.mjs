#!/usr/bin/env node
// Where: scripts/icpdb-local-service-env-owner-smoke.mjs
// What: Focused local-network smoke for owner service.env SQL/setup checks.
// Why: Server/CI readiness needs a short proof that package init can create an owner DB env and run ordinary SQL.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const smokeProgress = process.env.ICPDB_SMOKE_PROGRESS === "1";
const packageCliPath = fileURLToPath(new URL("../icpdb-console/dist-sdk/icpdb-cli.js", import.meta.url));
const options = parseArgs(process.argv.slice(2));

async function main() {
  await assertPackageCliBuilt();
  const network = await localNetworkConfig(environment, canisterName);
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-owner-service-env-smoke-"));
  const envPath = join(tempDir, "service.env");
  progress(`network ${network.networkUrl} canister ${network.canisterId}`);

  let databaseId;
  try {
    await waitForLocalGateway(network.networkUrl, "before package init");
    const created = JSON.parse(await runPackageCli([
      "init",
      "--env-out",
      envPath,
      ...packageTargetArgs(network),
      "--setup-sql",
      "CREATE TABLE owner_service_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO owner_service_notes(body) VALUES ('from-owner-service-init')"
    ]));
    databaseId = created.databaseId;
    assert.equal(created.canisterId, network.canisterId);
    assert.equal(created.url, `icpdb://${network.canisterId}/${databaseId}`);
    assert.equal(typeof databaseId, "string");
    assert.match(created.principal, /-/);
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
    await chmod(envPath, 0o600);

    const envText = await readFile(envPath, "utf8");
    assertIncludes(envText, `ICPDB_CANISTER_ID="${network.canisterId}"`);
    assertIncludes(envText, `ICPDB_DATABASE_ID="${databaseId}"`);
    assertIncludes(envText, `ICPDB_URL="icpdb://${network.canisterId}/${databaseId}"`);
    assert.ok(!envText.includes("ICPDB_SETUP_SQL"), "owner service.env must not persist setup SQL");

    const inspectOutput = await runPackageCli(["inspect-env", "--service-env-file", envPath, "--format", "table"]);
    assertIncludes(inspectOutput, databaseId);
    assertIncludes(inspectOutput, created.principal);
    const queryOutput = await runPackageCli(["query", "SELECT body FROM owner_service_notes", "--service-env-file", envPath, "--format", "table"]);
    assertIncludes(queryOutput, "from-owner-service-init");
    const sqlCheckOutput = await runPackageCli([
      "check-env",
      "--service-env-file",
      envPath,
      "--require-role",
      "owner",
      "--smoke-sql",
      "--format",
      "table"
    ]);
    assertIncludes(sqlCheckOutput, "callerRole");
    assertIncludes(sqlCheckOutput, "owner");
    assertIncludes(sqlCheckOutput, "sqlSmoke");
    progress("package check-env SQL owner service.env verified");
    if (options.archiveRestore) await smokePackageArchiveRestore(network, envPath);
    await smokePackageInitSetupFile(network, tempDir);
    await smokePackageInitSetupMigrations(network, tempDir);
  } finally {
    const cleanupDatabaseId = databaseId ?? await readOptionalEnvFileValue(envPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) await deletePackageDatabaseBestEffort(envPath, cleanupDatabaseId);
  }

  progress(options.archiveRestore ? "package owner service.env archive/restore verified" : "package owner service.env SQL/setup verified");
  console.log(`ICPDB local owner service.env smoke OK: ${databaseId}`);
}

async function smokePackageArchiveRestore(network, envPath) {
  const archiveCheckOutput = await runPackageCli([
    "check-env",
    "--service-env-file",
    envPath,
    "--require-role",
    "owner",
    "--smoke-sql",
    "--smoke-archive-restore",
    "--format",
    "table"
  ]);
  assertIncludes(archiveCheckOutput, "archiveRestoreSmoke");
  assertIncludes(archiveCheckOutput, "package-archive-");
  assertIncludes(archiveCheckOutput, "archive_restore_cleanup");
  progress("package check-env archive/restore owner service.env verified");
  await waitForLocalGateway(network.networkUrl, "after package archive/restore check-env");
  const sdkArchiveCheckOutput = await runPackageCli([
    "check-env",
    "--service-env-file",
    envPath,
    "--require-role",
    "owner",
    "--smoke-sdk-archive-restore",
    "--format",
    "table"
  ]);
  assertIncludes(sdkArchiveCheckOutput, "sdkArchiveRestoreSmoke");
  assertIncludes(sdkArchiveCheckOutput, "package-sdk-archive-");
  assertIncludes(sdkArchiveCheckOutput, "sdk_archive_restore_query");
  assertIncludes(sdkArchiveCheckOutput, "sdk_archive_restore_cleanup");
  progress("package check-env SDK archive/restore owner service.env verified");
  await waitForLocalGateway(network.networkUrl, "after package SDK archive/restore check-env");
}

async function smokePackageInitSetupFile(network, tempDir) {
  const setupPath = join(tempDir, "owner-service-schema.sql");
  const envPath = join(tempDir, "setup-file-service.env");
  await writeFile(setupPath, [
    "CREATE TABLE owner_setup_file_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
    "INSERT INTO owner_setup_file_notes(body) VALUES ('from-owner-setup-file')",
    "CREATE VIEW owner_setup_file_notes_view AS SELECT id, body FROM owner_setup_file_notes"
  ].join("; "));
  let databaseId;
  try {
    const output = await runPackageCli([
      "init",
      "--env-out",
      envPath,
      ...packageTargetArgs(network),
      "--setup-file",
      setupPath,
      "--format",
      "table"
    ]);
    databaseId = await requiredEnvFileValue(envPath, "ICPDB_DATABASE_ID");
    assertIncludes(output, databaseId);
    assertIncludes(output, "nextInspectEnvCommand");
    assertIncludes(output, "nextSqlSmokeCommand");
    assertIncludes(output, "nextTablesCommand");
    assertIncludes(output, "nextInfoCommand");
    const queryOutput = await runPackageCli(["query", "SELECT body FROM owner_setup_file_notes", "--service-env-file", envPath, "--format", "table"]);
    assertIncludes(queryOutput, "from-owner-setup-file");
    const viewsOutput = await runPackageCli(["views", "--service-env-file", envPath, "--format", "table"]);
    assertIncludes(viewsOutput, "owner_setup_file_notes_view");
  } finally {
    const cleanupDatabaseId = databaseId ?? await readOptionalEnvFileValue(envPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) await deletePackageDatabaseBestEffort(envPath, cleanupDatabaseId);
  }
  progress("package init setup-file owner service.env verified");
}

async function smokePackageInitSetupMigrations(network, tempDir) {
  const migrationsPath = join(tempDir, "owner-service-migrations.json");
  const envPath = join(tempDir, "setup-migrations-service.env");
  await writeFile(migrationsPath, JSON.stringify([{
    version: "owner-service-001",
    name: "create_owner_setup_migration_notes",
    sql: [
      "CREATE TABLE owner_setup_migration_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
      "INSERT INTO owner_setup_migration_notes(body) VALUES ('from-owner-setup-migration')",
      "CREATE VIEW owner_setup_migration_notes_view AS SELECT id, body FROM owner_setup_migration_notes"
    ].join("; ")
  }]));
  let databaseId;
  try {
    const output = await runPackageCli([
      "init",
      "--env-out",
      envPath,
      ...packageTargetArgs(network),
      "--setup-migrations-file",
      migrationsPath,
      "--format",
      "table"
    ]);
    databaseId = await requiredEnvFileValue(envPath, "ICPDB_DATABASE_ID");
    assertIncludes(output, databaseId);
    assertIncludes(output, "nextSchemaCountCommand");
    assertIncludes(output, "nextUrlCommand");
    const migrationOutput = await runPackageCli([
      "query",
      "SELECT version FROM icpdb_schema_migrations ORDER BY version",
      "--service-env-file",
      envPath,
      "--format",
      "table"
    ]);
    assertIncludes(migrationOutput, "owner-service-001");
    const inspectOutput = await runPackageCli(["inspect", "owner_setup_migration_notes", "--service-env-file", envPath, "--format", "table"]);
    assertIncludes(inspectOutput, "from-owner-setup-migration");
  } finally {
    const cleanupDatabaseId = databaseId ?? await readOptionalEnvFileValue(envPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) await deletePackageDatabaseBestEffort(envPath, cleanupDatabaseId);
  }
  progress("package init setup-migrations owner service.env verified");
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

async function runPackageCli(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [packageCliPath, ...args], {
      env: process.env,
      maxBuffer: 1024 * 1024 * 32
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`package CLI failed for ${args.join(" ")}: ${message}${stderr ? `\n${stderr}` : ""}`);
  }
}

async function deletePackageDatabaseBestEffort(envPath, databaseId) {
  try {
    await runPackageCli(["delete-db", "--confirm", databaseId, "--service-env-file", envPath]);
  } catch (error) {
    progress(`package CLI cleanup failed for ${databaseId}: ${error instanceof Error ? error.message : String(error)}`);
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

async function requiredEnvFileValue(path, key) {
  const value = await readOptionalEnvFileValue(path, key);
  assert.equal(typeof value, "string", `expected ${path} to contain ${key}`);
  return value;
}

async function assertPackageCliBuilt() {
  try {
    await stat(packageCliPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(`owner service.env smoke requires built SDK bin: run pnpm --dir icpdb-console build:sdk before ${fileURLToPath(import.meta.url)}`);
    }
    throw error;
  }
}

function progress(message) {
  if (smokeProgress) console.error(`[icpdb-owner-service-env-smoke] ${message}`);
}

async function waitForLocalGateway(networkUrl, label) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(`${networkUrl}/api/v2/status`);
      if (response.ok) return;
    } catch {
      // Local PocketIC gateway may briefly stop accepting requests after heavy archive calls.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`local ICP gateway did not become ready ${label}`);
}

function assertIncludes(source, expected) {
  assert.ok(source.includes(expected), `expected output to include ${expected}\n${source}`);
}

function isErrnoException(error) {
  return typeof error === "object" && error !== null && "code" in error;
}

function parseArgs(args) {
  const parsed = { archiveRestore: false };
  for (const arg of args) {
    if (arg === "--archive-restore") {
      parsed.archiveRestore = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
