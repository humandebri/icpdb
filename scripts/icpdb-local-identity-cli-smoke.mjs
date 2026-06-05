#!/usr/bin/env node
// Where: scripts/icpdb-local-identity-cli-smoke.mjs
// What: Live local-network smoke for service-identity DB creation, grants, and SQL.
// Why: Server and CI workflows need proof that principal ACLs work without database bearer tokens.
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
  identityShellLineCommand,
  loadServiceIdentity,
  parseIdentityCliArgs,
  writeIdentityEnvOutputFile
} from "./icpdb-identity.mjs";
import { checkServiceEnv, formatServiceEnvCheck } from "./icpdb-service-env-check.mjs";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const smokeProgress = process.env.ICPDB_SMOKE_PROGRESS === "1";
const execFileAsync = promisify(execFile);
const packageCliPath = fileURLToPath(new URL("../icpdb-console/dist-sdk/icpdb-cli.js", import.meta.url));

async function main() {
  await assertPackageCliBuilt();
  const network = await localNetworkConfig(environment, canisterName);
  progress(`network ${network.networkUrl} canister ${network.canisterId}`);
  const ownerIdentity = Ed25519KeyIdentity.generate();
  const serviceIdentity = Ed25519KeyIdentity.generate();
  const ownerEnv = identityEnv(network, ownerIdentity);
  const serviceEnv = identityEnv(network, serviceIdentity);
  const servicePrincipal = serviceIdentity.getPrincipal().toText();

  const principalOutput = await runIdentityCli(serviceEnv, ["principal"]);
  assertIncludes(principalOutput, servicePrincipal);
  progress("service principal verified");

  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-identity-cli-smoke-"));
  const namedParamsPath = join(tempDir, "named-params.json");
  const statementsPath = join(tempDir, "statements.json");
  await writeFile(namedParamsPath, JSON.stringify({ body: "from-service-params-file" }));
  await writeFile(statementsPath, JSON.stringify([{ sql: "INSERT INTO identity_notes(body) VALUES (:body)", params: { body: "from-service-statements-file" } }]));
  const packageDotEnvPath = join(tempDir, ".env");
  const packageInfoEnvPath = join(tempDir, "package-info-first.env");
  const packageInitEnvPath = join(tempDir, "package-init.env");
  let packageDotEnvDatabaseId;
  try {
    const packageDotEnvOutput = await runPackageCli([
      "init",
      "--env-out",
      packageDotEnvPath,
      ...packageTargetArgs(network),
      "--setup-sql",
      "CREATE TABLE package_dotenv_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO package_dotenv_notes(body) VALUES ('from-package-dotenv-setup')",
      "--format",
      "env"
    ]);
    const packageDotEnvText = await readFile(packageDotEnvPath, "utf8");
    packageDotEnvDatabaseId = requiredEnvOutputValue(packageDotEnvOutput, "ICPDB_DATABASE_ID");
    assertIncludes(packageDotEnvOutput, `ICPDB_URL="icpdb://${network.canisterId}/${packageDotEnvDatabaseId}"`);
    assertIncludes(packageDotEnvText, `ICPDB_DATABASE_ID="${packageDotEnvDatabaseId}"`);
    assertIncludes(packageDotEnvText, `ICPDB_URL="icpdb://${network.canisterId}/${packageDotEnvDatabaseId}"`);
    assert.equal((await stat(packageDotEnvPath)).mode & 0o777, 0o600);
    const packageDotEnvInspectOutput = await runPackageCli([
      "inspect-env",
      "--service-env-file",
      packageDotEnvPath,
      "--format",
      "env"
    ]);
    assertIncludes(packageDotEnvInspectOutput, `ICPDB_DATABASE_ID="${packageDotEnvDatabaseId}"`);
    const packageDotEnvQueryOutput = await runPackageCli([
      "query",
      "SELECT body FROM package_dotenv_notes",
      "--service-env-file",
      packageDotEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageDotEnvQueryOutput, "from-package-dotenv-setup");
  } catch (error) {
    const cleanupDatabaseId = packageDotEnvDatabaseId ?? await readOptionalEnvFileValue(packageDotEnvPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) {
      await deletePackageDatabaseBestEffort(packageDotEnvPath, cleanupDatabaseId);
    }
    throw error;
  }
  await runPackageCli(["delete-db", "--confirm", packageDotEnvDatabaseId, "--service-env-file", packageDotEnvPath]);
  progress("package CLI explicit .env create/query verified");
  let packageInitDatabaseId;
  try {
    const packageInitOutput = await runPackageCli([
      "init",
      "--env-out",
      packageInitEnvPath,
      ...packageTargetArgs(network),
      "--setup-sql",
      "CREATE TABLE package_init_parent(id INTEGER PRIMARY KEY, label TEXT NOT NULL); CREATE TABLE package_init_notes(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES package_init_parent(id), body TEXT NOT NULL); CREATE INDEX package_init_notes_body_idx ON package_init_notes(body); CREATE TRIGGER package_init_notes_ai AFTER INSERT ON package_init_notes BEGIN UPDATE package_init_parent SET label = label WHERE id = NEW.parent_id; END; INSERT INTO package_init_parent(label) VALUES ('parent'); INSERT INTO package_init_notes(parent_id, body) VALUES (1, 'from-package-init-setup'); CREATE VIEW package_init_notes_view AS SELECT id, body FROM package_init_notes;",
      "--format",
      "env"
    ]);
    const packageInitEnvText = await readFile(packageInitEnvPath, "utf8");
    packageInitDatabaseId = requiredEnvOutputValue(packageInitOutput, "ICPDB_DATABASE_ID");
    assertIncludes(packageInitOutput, `ICPDB_CANISTER_ID="${network.canisterId}"`);
    assertIncludes(packageInitOutput, `ICPDB_URL="icpdb://${network.canisterId}/${packageInitDatabaseId}"`);
    assertIncludes(packageInitOutput, `ICPDB_CONNECTION_URL="icpdb://${network.canisterId}/${packageInitDatabaseId}"`);
    assertIncludes(packageInitEnvText, `ICPDB_DATABASE_ID="${packageInitDatabaseId}"`);
    assertIncludes(packageInitEnvText, `ICPDB_URL="icpdb://${network.canisterId}/${packageInitDatabaseId}"`);
    assertIncludes(packageInitEnvText, "ICPDB_IDENTITY_PRINCIPAL=");
    assert.ok(!packageInitEnvText.includes("ICPDB_SETUP_SQL="), "package CLI init should remove create-time setup env after persistence");
    assert.equal((await stat(packageInitEnvPath)).mode & 0o777, 0o600);
    const packageInitExecuteOutput = await runPackageCli([
      "execute",
      "INSERT INTO package_init_notes(body) VALUES (?1)",
      "--params",
      "[\"from-package-init-execute\"]",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitExecuteOutput, "rowsAffected");
    const packageInitQueryOutput = await runPackageCli([
      "query",
      "SELECT body FROM package_init_notes ORDER BY id",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitQueryOutput, "from-package-init-setup");
    assertIncludes(packageInitQueryOutput, "from-package-init-execute");
    const packageInitTablesOutput = await runPackageCli([
      "tables",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitTablesOutput, "package_init_notes");
    const packageInitViewsOutput = await runPackageCli([
      "views",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitViewsOutput, "package_init_notes_view");
    const packageInitStatsOutput = await runPackageCli([
      "stats",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitStatsOutput, "package_init_notes");
    assertIncludes(packageInitStatsOutput, "package_init_notes_view");
    const packageInitSchemaOutput = await runPackageCli([
      "schema",
      "package_init_notes",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitSchemaOutput, "CREATE TABLE package_init_notes");
    const packageInitDescribeOutput = await runPackageCli([
      "describe",
      "package_init_notes",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitDescribeOutput, "body");
    assertIncludes(packageInitDescribeOutput, "TEXT");
    const packageInitColumnsOutput = await runPackageCli([
      "columns",
      "package_init_notes",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitColumnsOutput, "parent_id");
    assertIncludes(packageInitColumnsOutput, "body");
    const packageInitIndexesOutput = await runPackageCli([
      "indexes",
      "package_init_notes",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitIndexesOutput, "package_init_notes_body_idx");
    const packageInitTriggersOutput = await runPackageCli([
      "triggers",
      "package_init_notes",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitTriggersOutput, "package_init_notes_ai");
    const packageInitForeignKeysOutput = await runPackageCli([
      "foreign-keys",
      "package_init_notes",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitForeignKeysOutput, "package_init_parent");
    const packageInitPreviewOutput = await runPackageCli([
      "preview",
      "package_init_notes",
      "--limit",
      "25",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitPreviewOutput, "from-package-init-setup");
    assertIncludes(packageInitPreviewOutput, "from-package-init-execute");
    const packageInitInspectOutput = await runPackageCli([
      "inspect",
      "package_init_notes",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitInspectOutput, "package_init_notes");
    assertIncludes(packageInitInspectOutput, "from-package-init-setup");
    const packageInitStatusOutput = await runPackageCli([
      "status",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitStatusOutput, `icpdb://${network.canisterId}/${packageInitDatabaseId}`);
    assertIncludes(packageInitStatusOutput, "owner");
    const packageInitUrlOutput = await runPackageCli([
      "url",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "env"
    ]);
    assertIncludes(packageInitUrlOutput, `ICPDB_URL="icpdb://${network.canisterId}/${packageInitDatabaseId}"`);
    const packageInitInfoOutput = await runPackageCli([
      "info",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "env"
    ]);
    assertIncludes(packageInitInfoOutput, `ICPDB_CONNECTION_URL="icpdb://${network.canisterId}/${packageInitDatabaseId}"`);
    const packageInitShellStatsOutput = await runPackageCli([
      "shell",
      ".stats",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitShellStatsOutput, "package_init_notes");
    assertIncludes(packageInitShellStatsOutput, "package_init_notes_view");
    const packageInitShellDescribeOutput = await runPackageCli([
      "shell",
      ".describe package_init_notes",
      "--service-env-file",
      packageInitEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInitShellDescribeOutput, "package_init_notes");
    assertIncludes(packageInitShellDescribeOutput, "body");
  } catch (error) {
    const cleanupDatabaseId = packageInitDatabaseId ?? await readOptionalEnvFileValue(packageInitEnvPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) {
      await deletePackageDatabaseBestEffort(packageInitEnvPath, cleanupDatabaseId);
    }
    throw error;
  }
  const packageInitShellDeleteOutput = await runPackageCli([
    "shell",
    `.delete-db ${packageInitDatabaseId}`,
    "--service-env-file",
    packageInitEnvPath,
    "--format",
    "table"
  ]);
  assertIncludes(packageInitShellDeleteOutput, packageInitDatabaseId);
  assertIncludes(packageInitShellDeleteOutput, `icpdb://${network.canisterId}/${packageInitDatabaseId}`);
  progress("package CLI init create/setup/execute/query/shape verified");

  await writeServiceEnvFile(packageInfoEnvPath, canisterOnlyIdentityFileEnv(network, serviceIdentity, {
    ICPDB_SETUP_SQL: "CREATE TABLE package_info_first(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO package_info_first(body) VALUES ('from-package-info-first');"
  }));
  let packageInfoDatabaseId;
  try {
    const packageInfoOutput = await runPackageCli([
      "info",
      "--service-env-file",
      packageInfoEnvPath,
      "--format",
      "env"
    ]);
    const packageInfoEnvText = await readFile(packageInfoEnvPath, "utf8");
    packageInfoDatabaseId = requiredEnvOutputValue(packageInfoOutput, "ICPDB_DATABASE_ID");
    assertIncludes(packageInfoOutput, `ICPDB_CANISTER_ID="${network.canisterId}"`);
    assertIncludes(packageInfoOutput, `ICPDB_URL="icpdb://${network.canisterId}/${packageInfoDatabaseId}"`);
    assertIncludes(packageInfoOutput, `ICPDB_CONNECTION_URL="icpdb://${network.canisterId}/${packageInfoDatabaseId}"`);
    assertIncludes(packageInfoEnvText, `ICPDB_DATABASE_ID="${packageInfoDatabaseId}"`);
    assertIncludes(packageInfoEnvText, `ICPDB_URL="icpdb://${network.canisterId}/${packageInfoDatabaseId}"`);
    assert.ok(!packageInfoEnvText.includes("ICPDB_SETUP_SQL="), "package CLI info first-call should remove create-time setup env after persistence");
    const packageInfoQueryOutput = await runPackageCli([
      "query",
      "SELECT body FROM package_info_first",
      "--service-env-file",
      packageInfoEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageInfoQueryOutput, "from-package-info-first");
  } catch (error) {
    const cleanupDatabaseId = packageInfoDatabaseId ?? await readOptionalEnvFileValue(packageInfoEnvPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) {
      await deletePackageDatabaseBestEffort(packageInfoEnvPath, cleanupDatabaseId);
    }
    throw error;
  }
  await runPackageCli(["delete-db", "--confirm", packageInfoDatabaseId, "--service-env-file", packageInfoEnvPath]);
  progress("package CLI info first-call create/persist verified");

  const packageSqlEnvPath = join(tempDir, "package-sql-first.env");
  await writeServiceEnvFile(packageSqlEnvPath, canisterOnlyIdentityFileEnv(network, serviceIdentity, {
    ICPDB_SETUP_SQL: "CREATE TABLE package_sql_first(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO package_sql_first(body) VALUES ('from-package-sql-first');"
  }));
  let packageSqlDatabaseId;
  try {
    const packageSqlOutput = await runPackageCli([
      "sql",
      "SELECT body FROM package_sql_first",
      "--service-env-file",
      packageSqlEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageSqlOutput, "from-package-sql-first");
    const packageSqlEnvText = await readFile(packageSqlEnvPath, "utf8");
    packageSqlDatabaseId = requiredEnvOutputValue(packageSqlEnvText, "ICPDB_DATABASE_ID");
    assertIncludes(packageSqlEnvText, `ICPDB_URL="icpdb://${network.canisterId}/${packageSqlDatabaseId}"`);
    assert.ok(!packageSqlEnvText.includes("ICPDB_SETUP_SQL="), "package CLI SQL first-call should remove create-time setup env after persistence");
    const packageSqlInfoOutput = await runPackageCli([
      "info",
      "--service-env-file",
      packageSqlEnvPath,
      "--format",
      "env"
    ]);
    assertIncludes(packageSqlInfoOutput, `ICPDB_DATABASE_ID="${packageSqlDatabaseId}"`);
    assertIncludes(packageSqlInfoOutput, `ICPDB_CONNECTION_URL="icpdb://${network.canisterId}/${packageSqlDatabaseId}"`);
  } catch (error) {
    const cleanupDatabaseId = packageSqlDatabaseId ?? await readOptionalEnvFileValue(packageSqlEnvPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) {
      await deletePackageDatabaseBestEffort(packageSqlEnvPath, cleanupDatabaseId);
    }
    throw error;
  }
  await runPackageCli(["delete-db", "--confirm", packageSqlDatabaseId, "--service-env-file", packageSqlEnvPath]);
  progress("package CLI SQL first-call create/query/persist verified");

  const packageExecuteEnvPath = join(tempDir, "package-execute-first.env");
  await writeServiceEnvFile(packageExecuteEnvPath, canisterOnlyIdentityFileEnv(network, serviceIdentity, {
    ICPDB_SETUP_SQL: "CREATE TABLE package_execute_first(id INTEGER PRIMARY KEY, body TEXT NOT NULL);"
  }));
  let packageExecuteDatabaseId;
  try {
    const packageExecuteOutput = await runPackageCli([
      "execute",
      "INSERT INTO package_execute_first(body) VALUES (?1)",
      "--params",
      "[\"from-package-execute-first\"]",
      "--service-env-file",
      packageExecuteEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageExecuteOutput, "rowsAffected");
    assertIncludes(packageExecuteOutput, "affectedRows");
    assertIncludes(packageExecuteOutput, "changes");
    const packageExecuteEnvText = await readFile(packageExecuteEnvPath, "utf8");
    packageExecuteDatabaseId = requiredEnvOutputValue(packageExecuteEnvText, "ICPDB_DATABASE_ID");
    assertIncludes(packageExecuteEnvText, `ICPDB_URL="icpdb://${network.canisterId}/${packageExecuteDatabaseId}"`);
    assert.ok(!packageExecuteEnvText.includes("ICPDB_SETUP_SQL="), "package CLI execute first-call should remove create-time setup env after persistence");
    const packageExecuteQueryOutput = await runPackageCli([
      "query",
      "SELECT body FROM package_execute_first",
      "--service-env-file",
      packageExecuteEnvPath,
      "--format",
      "table"
    ]);
    assertIncludes(packageExecuteQueryOutput, "from-package-execute-first");
  } catch (error) {
    const cleanupDatabaseId = packageExecuteDatabaseId ?? await readOptionalEnvFileValue(packageExecuteEnvPath, "ICPDB_DATABASE_ID");
    if (cleanupDatabaseId !== undefined) {
      await deletePackageDatabaseBestEffort(packageExecuteEnvPath, cleanupDatabaseId);
    }
    throw error;
  }
  await runPackageCli(["delete-db", "--confirm", packageExecuteDatabaseId, "--service-env-file", packageExecuteEnvPath]);
  progress("package CLI execute first-call create/write/persist verified");

  const provisionSetupPath = join(tempDir, "provision-setup.sql");
  await writeFile(provisionSetupPath, "CREATE TABLE provision_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE VIEW provision_notes_view AS SELECT id, body FROM provision_notes;");
  const provisionOutput = await runIdentityCli(ownerEnv, [
    "--service-identity-type",
    "ed25519",
    "provision-service-db",
    "writer",
    "--setup-file",
    provisionSetupPath
  ]);
  const provisioned = JSON.parse(provisionOutput);
  assert.equal(typeof provisioned.database_id, "string");
  assert.equal(provisioned.role, "writer");
  assert.equal(provisioned.setup_statement_count, 2);
  assert.equal(provisioned.setup_rows_affected, "0");
  assert.equal(provisioned.env.ICPDB_DATABASE_ID, provisioned.database_id);
  assert.equal(provisioned.env.ICPDB_CANISTER_ID, network.canisterId);
  assert.equal(provisioned.env.ICPDB_URL, `icpdb://${network.canisterId}/${provisioned.database_id}`);
  assert.equal(provisioned.env.ICPDB_IDENTITY_TYPE, "ed25519");
  assert.equal(typeof provisioned.principal, "string");
  assert.equal(typeof provisioned.env.ICPDB_IDENTITY_JSON, "string");
  const provisionEnvPath = join(tempDir, "service.env");
  await writeIdentityEnvOutputFile(provisionEnvPath, provisioned);
  assert.equal((await stat(provisionEnvPath)).mode & 0o777, 0o600);
  await runIdentityCli({}, [
    "--env-file",
    provisionEnvPath,
    "execute",
    "INSERT INTO provision_notes(body) VALUES ('from-provision-service-db')"
  ]);
  const provisionQueryOutput = await runIdentityCli({}, [
    "--env-file",
    provisionEnvPath,
    "query",
    "SELECT body FROM provision_notes",
    "--format",
    "table"
  ]);
  assertIncludes(provisionQueryOutput, "from-provision-service-db");
  const provisionTablesOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "tables",
    "--format",
    "table"
  ]);
  assertIncludes(provisionTablesOutput, "provision_notes");
  const provisionViewsOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "views",
    "--format",
    "table"
  ]);
  assertIncludes(provisionViewsOutput, "provision_notes_view");
  const provisionSchemaOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "schema",
    "provision_notes",
    "--format",
    "table"
  ]);
  assertIncludes(provisionSchemaOutput, "CREATE TABLE provision_notes");
  const provisionInspectOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "inspect",
    "provision_notes",
    "--format",
    "table"
  ]);
  assertIncludes(provisionInspectOutput, "provision_notes");
  assertIncludes(provisionInspectOutput, "from-provision-service-db");
  const provisionStatusOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "status",
    "--format",
    "table"
  ]);
  assertIncludes(provisionStatusOutput, `icpdb://${network.canisterId}/${provisioned.database_id}`);
  assertIncludes(provisionStatusOutput, provisioned.principal);
  assertIncludes(provisionStatusOutput, "writer");
  const provisionUrlOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "url",
    "--format",
    "env"
  ]);
  assertIncludes(provisionUrlOutput, `ICPDB_URL="icpdb://${network.canisterId}/${provisioned.database_id}"`);
  await runIdentityCli({ ...ownerEnv, ICPDB_DATABASE_ID: provisioned.database_id }, ["delete-db"]);
  progress("provision-service-db quickstart lifecycle verified");

  const provisionMigrationsPath = join(tempDir, "provision-migrations.json");
  await writeFile(provisionMigrationsPath, JSON.stringify([{
    version: "provision-setup-001",
    name: "create_provision_migrated",
    sql: "CREATE TABLE provision_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO provision_migrated(body) VALUES ('from-provision-service-migration'); CREATE VIEW provision_migrated_view AS SELECT id, body FROM provision_migrated;"
  }]));
  const provisionMigrationOutput = await runIdentityCli(ownerEnv, [
    "--service-identity-type",
    "ed25519",
    "provision-service-db",
    "writer",
    "--setup-migrations-file",
    provisionMigrationsPath
  ]);
  const provisionMigrated = JSON.parse(provisionMigrationOutput);
  assert.equal(provisionMigrated.setup_migration_count, 1);
  assert.deepEqual(provisionMigrated.setup_migration_applied, ["provision-setup-001"]);
  await writeIdentityEnvOutputFile(provisionEnvPath, provisionMigrated);
  const provisionMigratedQueryOutput = await runIdentityCli({}, [
    "--env-file",
    provisionEnvPath,
    "query",
    "SELECT body FROM provision_migrated",
    "--format",
    "table"
  ]);
  assertIncludes(provisionMigratedQueryOutput, "from-provision-service-migration");
  const provisionMigratedTablesOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "tables",
    "--format",
    "table"
  ]);
  assertIncludes(provisionMigratedTablesOutput, "provision_migrated");
  const provisionMigratedViewsOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "views",
    "--format",
    "table"
  ]);
  assertIncludes(provisionMigratedViewsOutput, "provision_migrated_view");
  const provisionMigratedSchemaOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "schema",
    "provision_migrated",
    "--format",
    "table"
  ]);
  assertIncludes(provisionMigratedSchemaOutput, "CREATE TABLE provision_migrated");
  const provisionMigratedInspectOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "inspect",
    "provision_migrated",
    "--format",
    "table"
  ]);
  assertIncludes(provisionMigratedInspectOutput, "provision_migrated");
  assertIncludes(provisionMigratedInspectOutput, "from-provision-service-migration");
  const provisionMigratedStatusOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "status",
    "--format",
    "table"
  ]);
  assertIncludes(provisionMigratedStatusOutput, `icpdb://${network.canisterId}/${provisionMigrated.database_id}`);
  assertIncludes(provisionMigratedStatusOutput, provisionMigrated.principal);
  assertIncludes(provisionMigratedStatusOutput, "writer");
  const provisionMigratedUrlOutput = await runIdentityCliFormatted({}, [
    "--env-file",
    provisionEnvPath,
    "url",
    "--format",
    "env"
  ]);
  assertIncludes(provisionMigratedUrlOutput, `ICPDB_URL="icpdb://${network.canisterId}/${provisionMigrated.database_id}"`);
  await runIdentityCli({ ...ownerEnv, ICPDB_DATABASE_ID: provisionMigrated.database_id }, ["delete-db"]);
  progress("provision-service-db setup migrations verified");

  const createSetupPath = join(tempDir, "create-setup.sql");
  await writeFile(createSetupPath, "CREATE TABLE env_created_notes(id INTEGER PRIMARY KEY);");
  const createEnvOutput = await runIdentityCli(ownerEnv, [
    "--format",
    "env",
    "create-db",
    "--setup-file",
    createSetupPath
  ]);
  const createEnv = JSON.parse(createEnvOutput);
  assert.equal(createEnv.env.ICPDB_CANISTER_ID, network.canisterId);
  assert.equal(createEnv.env.ICPDB_DATABASE_ID, createEnv.database_id);
  assert.equal(createEnv.env.ICPDB_URL, `icpdb://${network.canisterId}/${createEnv.database_id}`);
  assert.equal(createEnv.env.ICPDB_NETWORK_URL, network.networkUrl);
  assert.equal(createEnv.env.ICPDB_ROOT_KEY, network.rootKey);
  assert.match(createEnv.env_lines.join("\n"), /ICPDB_DATABASE_ID="/);
  assert.equal(createEnv.setup_statement_count, 1);
  await writeIdentityEnvOutputFile(provisionEnvPath, createEnv);
  assert.equal((await stat(provisionEnvPath)).mode & 0o777, 0o600);
  assertIncludes(await readFile(provisionEnvPath, "utf8"), "ICPDB_URL=");
  const createEnvUrlOutput = await runIdentityCli({}, ["--env-file", provisionEnvPath, "url", "--format", "env"]);
  const createEnvUrl = JSON.parse(createEnvUrlOutput);
  assert.deepEqual(createEnvUrl.env, {
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_DATABASE_ID: createEnv.database_id,
    ICPDB_URL: `icpdb://${network.canisterId}/${createEnv.database_id}`
  });
  const createEnvTablesOutput = await runIdentityCli({}, ["--env-file", provisionEnvPath, "tables"]);
  assertIncludes(createEnvTablesOutput, "env_created_notes");
  await runIdentityCli({}, ["--env-file", provisionEnvPath, "delete-db"]);
  progress("create-db env output verified");

  const createOutput = await runIdentityCli(ownerEnv, ["create-db"]);
  const databaseId = JSON.parse(createOutput).database_id;
  assert.equal(typeof databaseId, "string");

  const serviceDatabaseEnvPath = join(tempDir, "service-database.env");
  await writeServiceEnvFile(serviceDatabaseEnvPath, identityFileEnv(network, serviceIdentity, databaseId));
  const openServiceDatabaseEnvPath = join(tempDir, "open-service-database.env");
  await writeFile(openServiceDatabaseEnvPath, `${envFileLines(identityFileEnv(network, serviceIdentity, databaseId)).join("\n")}\n`);
  await chmod(openServiceDatabaseEnvPath, 0o644);
  const openServiceDatabaseFailure = await runIdentityCliExpectFailure({}, ["--env-file", openServiceDatabaseEnvPath, "principal"]);
  assertIncludes(openServiceDatabaseFailure, "owner-only");
  const serviceDatabaseArgs = ["--env-file", serviceDatabaseEnvPath];
  const inspectEnvOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "inspect-env"]);
  assertIncludes(inspectEnvOutput, `icpdb://${network.canisterId}/${databaseId}`);
  assertIncludes(inspectEnvOutput, servicePrincipal);
  await runIdentityCli(ownerEnv, ["execute", databaseId, "CREATE TABLE reader_probe(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"]);
  await runIdentityCli(ownerEnv, ["execute", databaseId, "INSERT INTO reader_probe(body) VALUES ('from-reader-grant')"]);
  await runIdentityCli(ownerEnv, ["grant-member", databaseId, servicePrincipal, "reader"]);
  const readerQueryOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "query", "SELECT body FROM reader_probe", "--format", "table"]);
  assertIncludes(readerQueryOutput, "from-reader-grant");
  const readerWriteFailure = await runIdentityCliExpectFailure({}, [...serviceDatabaseArgs, "execute", "INSERT INTO reader_probe(body) VALUES ('reader-write-denied')"]);
  assertIncludes(readerWriteFailure, "principal lacks required database role");
  progress("reader grant query/write boundary verified");

  await runIdentityCli(ownerEnv, ["grant-member", databaseId, servicePrincipal, "writer"]);
  const membersOutput = await runIdentityCli(ownerEnv, ["members", databaseId]);
  assertIncludes(membersOutput, servicePrincipal);
  assertIncludes(membersOutput, "writer");

  await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "execute",
    "CREATE TABLE identity_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"
  ]);
  await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "execute",
    "INSERT INTO identity_notes(body) VALUES (?1)",
    "--params",
    "[\"from-service-identity\"]"
  ]);
  await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "execute",
    "INSERT INTO identity_notes(body) VALUES (:body)",
    "--params",
    "{\"body\":\"from-service-named\"}"
  ]);
  await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "execute",
    "INSERT INTO identity_notes(body) VALUES (:body)",
    "--params-file",
    namedParamsPath
  ]);
  await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "sql",
    "INSERT INTO identity_notes(body) VALUES ('from-service-sql-auto')"
  ]);
  await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "batch",
    "--statement",
    "INSERT INTO identity_notes(body) VALUES ('from-service-batch')"
  ]);
  await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "batch",
    "--statements-file",
    statementsPath
  ]);
  await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "transaction",
    "--statement",
    "INSERT INTO identity_notes(body) VALUES ('from-service-transaction')"
  ]);

  const queryOutput = await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "sql",
    "/* auto-read */ SELECT body FROM identity_notes ORDER BY id",
    "--format",
    "table"
  ]);
  assertIncludes(queryOutput, "from-service-identity");
  assertIncludes(queryOutput, "from-service-named");
  assertIncludes(queryOutput, "from-service-params-file");
  assertIncludes(queryOutput, "from-service-sql-auto");
  assertIncludes(queryOutput, "from-service-batch");
  assertIncludes(queryOutput, "from-service-statements-file");
  assertIncludes(queryOutput, "from-service-transaction");
  progress("service identity SQL writes verified");

  const envFileOnlyOutput = await runIdentityCli({ ICPDB_ENV_FILE: serviceDatabaseEnvPath }, [
    "query",
    "SELECT body FROM identity_notes WHERE body = 'from-service-identity'",
    "--format",
    "table"
  ]);
  assertIncludes(envFileOnlyOutput, "from-service-identity");
  const envFileOnlyStatusOutput = await runIdentityCli({ ICPDB_ENV_FILE: serviceDatabaseEnvPath }, [
    "status",
    "--format",
    "table"
  ]);
  assertIncludes(envFileOnlyStatusOutput, `icpdb://${network.canisterId}/${databaseId}`);
  assertIncludes(envFileOnlyStatusOutput, servicePrincipal);
  progress("ICPDB_ENV_FILE service env verified");

  const csvOutput = await runIdentityCliFormatted({}, [
    ...serviceDatabaseArgs,
    "query",
    "SELECT body FROM identity_notes ORDER BY id",
    "--format",
    "csv"
  ]);
  assertIncludes(csvOutput, "body");
  assertIncludes(csvOutput, "from-service-statements-file");

  const tablesOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "tables"]);
  assertIncludes(tablesOutput, "identity_notes");

  const describeOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "describe", "identity_notes"]);
  assertIncludes(describeOutput, "body");
  assertIncludes(describeOutput, "TEXT");

  const columnsOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "columns", "identity_notes", "--format", "table"]);
  assertIncludes(columnsOutput, "body");
  const indexesOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "indexes", "identity_notes"]);
  assertIncludes(indexesOutput, "indexes");
  const triggersOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "triggers", "identity_notes"]);
  assertIncludes(triggersOutput, "triggers");
  const foreignKeysOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "foreign-keys", "identity_notes"]);
  assertIncludes(foreignKeysOutput, "foreign_keys");

  const schemaOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "schema", "identity_notes", "--format", "table"]);
  assertIncludes(schemaOutput, "CREATE TABLE identity_notes");

  const statsOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "stats", "--format", "table"]);
  assertIncludes(statsOutput, "identity_notes");
  assertIncludes(statsOutput, "table_count");

  const statusOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "status", "--format", "table"]);
  assertIncludes(statusOutput, `icpdb://${network.canisterId}/${databaseId}`);
  assertIncludes(statusOutput, "placement");
  assertIncludes(statusOutput, "usage");
  assertIncludes(statusOutput, "identity_notes");
  const statusJsonOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "status"]);
  assertIncludes(statusJsonOutput, "connection_url");
  const serviceEnvCheck = await checkServiceEnv({
    envFile: serviceDatabaseEnvPath,
    skipCall: false,
    requireRole: "writer",
    smokeSql: true,
    smokeSdk: true
  });
  assert.equal(serviceEnvCheck.inspect.connection_url, `icpdb://${network.canisterId}/${databaseId}`);
  assert.equal(serviceEnvCheck.status?.caller_principal, servicePrincipal);
  assertIncludes(serviceEnvCheck.checks.join(","), "caller_role_at_least_writer");
  assertIncludes(serviceEnvCheck.checks.join(","), "sql_cleanup");
  assertIncludes(serviceEnvCheck.checks.join(","), "sdk_scalar");
  assertIncludes(serviceEnvCheck.checks.join(","), "sdk_cleanup");
  assertIncludes(serviceEnvCheck.sql_smoke?.selected_body ?? "", "service-env-smoke-");
  assertIncludes(serviceEnvCheck.sql_smoke?.selected_scalar_body ?? "", "service-env-smoke-");
  assertIncludes(serviceEnvCheck.sdk_smoke?.selected_body ?? "", "service-sdk-smoke-");
  assertIncludes(serviceEnvCheck.sdk_smoke?.selected_scalar_body ?? "", "service-sdk-smoke-");
  assertIncludes(formatServiceEnvCheck(serviceEnvCheck, "table"), "caller_principal");
  progress("service env writer CLI and SDK SQL smoke verified");

  const healthOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "health", "--format", "table"]);
  assertIncludes(healthOutput, "cycles_balance");

  const inspectOutput = await runIdentityCliFormatted({}, [...serviceDatabaseArgs, "inspect", "--format", "table"]);
  assertIncludes(inspectOutput, "table summary");
  assertIncludes(inspectOutput, "identity_notes");
  const inspectTableOutput = await runIdentityCliFormatted({}, [...serviceDatabaseArgs, "inspect", "identity_notes", "--limit", "2", "--format", "table"]);
  assertIncludes(inspectTableOutput, "preview");
  assertIncludes(inspectTableOutput, "from-service-identity");
  const shellTablesOutput = await runIdentityCliFormatted({}, [...serviceDatabaseArgs, "shell", ".tables", "--format", "table"]);
  assertIncludes(shellTablesOutput, "identity_notes");
  const shellSchemaOutput = await runIdentityCliFormatted({}, [...serviceDatabaseArgs, "shell", ".schema identity_notes", "--format", "table"]);
  assertIncludes(shellSchemaOutput, "CREATE TABLE identity_notes");
  const shellColumnsOutput = await runIdentityCliFormatted({}, [...serviceDatabaseArgs, "shell", ".columns identity_notes", "--format", "table"]);
  assertIncludes(shellColumnsOutput, "body");
  const shellUrlOutput = await runIdentityCliFormatted({}, [...serviceDatabaseArgs, "shell", ".url", "--format", "table"]);
  assertIncludes(shellUrlOutput, `icpdb://${network.canisterId}/${databaseId}`);
  const shellStatusOutput = await runIdentityCliFormatted({}, [...serviceDatabaseArgs, "shell", ".status", "--format", "table"]);
  assertIncludes(shellStatusOutput, `icpdb://${network.canisterId}/${databaseId}`);
  assertIncludes(shellStatusOutput, "caller_role");
  const shellSqlOutput = await runIdentityCliFormatted({}, [...serviceDatabaseArgs, "shell", "SELECT body FROM identity_notes ORDER BY id LIMIT 1", "--format", "table"]);
  assertIncludes(shellSqlOutput, "from-service-identity");
  progress("schema stats status inspect verified");

  const previewOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "preview", "identity_notes", "--format", "table"]);
  assertIncludes(previewOutput, "identity_notes");
  assertIncludes(previewOutput, "from-service-identity");

  const dumpOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "dump"]);
  assertIncludes(dumpOutput, "CREATE TABLE identity_notes");
  assertIncludes(dumpOutput, "from-service-identity");
  const dumpPath = join(tempDir, "identity-load.sql");
  await writeFile(dumpPath, "CREATE TABLE identity_loaded(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO identity_loaded(body) VALUES ('from-identity-load');");
  const loadOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "load", dumpPath]);
  assertIncludes(loadOutput, "\"statement_count\": 2");
  const loadedOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "query", "SELECT body FROM identity_loaded", "--format", "table"]);
  assertIncludes(loadedOutput, "from-identity-load");
  const scriptPath = join(tempDir, "identity-script.sql");
  await writeFile(scriptPath, "CREATE TABLE identity_scripted(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO identity_scripted(body) VALUES ('from-identity-script');");
  const scriptOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "script", scriptPath]);
  assertIncludes(scriptOutput, "\"statement_count\": 2");
  const scriptedOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "query", "SELECT body FROM identity_scripted", "--format", "table"]);
  assertIncludes(scriptedOutput, "from-identity-script");
  const migrationsPath = join(tempDir, "identity-migrations.json");
  await writeFile(migrationsPath, JSON.stringify([{
    version: "identity-001",
    name: "create_identity_migrated",
    sql: "CREATE TABLE identity_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO identity_migrated(body) VALUES ('from-identity-migration');"
  }]));
  const migrationOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "migrate", migrationsPath]);
  assertIncludes(migrationOutput, "\"applied\": [");
  assertIncludes(migrationOutput, "identity-001");
  const migratedOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "query", "SELECT body FROM identity_migrated", "--format", "table"]);
  assertIncludes(migratedOutput, "from-identity-migration");
  const skippedMigrationOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "migrate", migrationsPath]);
  assertIncludes(skippedMigrationOutput, "\"skipped\": [");
  assertIncludes(skippedMigrationOutput, "identity-001");
  progress("dump load script migrate verified");

  const placementOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "placement", "--format", "table"]);
  assertIncludes(placementOutput, databaseId);

  const placementsOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "placements", "--format", "table"]);
  assertIncludes(placementsOutput, databaseId);

  const usageOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "usage", "--format", "table"]);
  assertIncludes(usageOutput, databaseId);
  assertIncludes(usageOutput, "hot");

  const usageEventsOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "usage-events", "--format", "table"]);
  assertIncludes(usageEventsOutput, "sql_execute");

  const writerMembersFailure = await runIdentityCliExpectFailure({}, [...serviceDatabaseArgs, "members"]);
  assertIncludes(writerMembersFailure, "principal lacks required database role");
  const writerArchivePath = join(tempDir, `${databaseId}-writer-denied.sqlite`);
  const writerArchiveFailure = await runIdentityCliExpectFailure({}, [...serviceDatabaseArgs, "archive", writerArchivePath]);
  assertIncludes(writerArchiveFailure, "principal lacks required database role");
  const writerDeleteFailure = await runIdentityCliExpectFailure({}, [...serviceDatabaseArgs, "delete-db"]);
  assertIncludes(writerDeleteFailure, "principal lacks required database role");
  progress("writer denials verified");

  await runIdentityCli(ownerEnv, ["grant-member", databaseId, servicePrincipal, "owner"]);
  const ownerMembersOutput = await runIdentityCli(ownerEnv, ["members", databaseId]);
  assertIncludes(ownerMembersOutput, servicePrincipal);
  assertIncludes(ownerMembersOutput, "owner");

  const archivePath = join(tempDir, `${databaseId}.sqlite`);
  const archiveOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "archive", archivePath]);
  assertIncludes(archiveOutput, databaseId);
  const archived = JSON.parse(archiveOutput);
  assert.ok((await readFile(archivePath)).byteLength > 0, "archive file should contain snapshot bytes");
  const snapshotInfoOutput = await runIdentityCli({}, ["snapshot-info", archivePath]);
  const snapshotInfo = JSON.parse(snapshotInfoOutput);
  assert.equal(snapshotInfo.file, archivePath);
  assert.equal(snapshotInfo.snapshot_hash, archived.snapshot_hash);
  const restoreOutput = await runIdentityCli({}, [...serviceDatabaseArgs, "restore", archivePath, "--expect-snapshot-hash", snapshotInfo.snapshot_hash]);
  assertIncludes(restoreOutput, databaseId);
  progress("archive snapshot-info restore verified");

  const restoredOutput = await runIdentityCli({}, [
    ...serviceDatabaseArgs,
    "query",
    "SELECT body FROM identity_notes ORDER BY id",
    "--format",
    "table"
  ]);
  assertIncludes(restoredOutput, "from-service-identity");
  assertIncludes(restoredOutput, "from-service-named");
  assertIncludes(restoredOutput, "from-service-params-file");
  assertIncludes(restoredOutput, "from-service-batch");
  assertIncludes(restoredOutput, "from-service-statements-file");

  await runIdentityCli({}, [...serviceDatabaseArgs, "delete-db"]);

  console.log(`ICPDB local identity CLI smoke OK: ${databaseId} writer ${servicePrincipal}`);
}

function progress(message) {
  if (smokeProgress) console.error(`[icpdb-identity-smoke] ${message}`);
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

function identityFileEnv(network, identity, databaseId) {
  return {
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_NETWORK_URL: network.networkUrl,
    ICPDB_IDENTITY_JSON: JSON.stringify(identity.toJSON()),
    ICPDB_IDENTITY_TYPE: "ed25519",
    ICPDB_ROOT_KEY: network.rootKey,
    ICPDB_DATABASE_ID: databaseId
  };
}

function canisterOnlyIdentityFileEnv(network, identity, extra = {}) {
  return {
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_NETWORK_URL: network.networkUrl,
    ICPDB_IDENTITY_JSON: JSON.stringify(identity.toJSON()),
    ICPDB_IDENTITY_TYPE: "ed25519",
    ICPDB_ROOT_KEY: network.rootKey,
    ...extra
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

function envFileLines(env) {
  return Object.entries(env)
    .filter(([_key, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
}

async function writeServiceEnvFile(path, env) {
  await writeFile(path, `${envFileLines(env).join("\n")}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
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
    if (command.shell && command.shellSql) {
      const shellCommand = identityShellLineCommand(command.shellSql, command);
      let result = await executeIdentityCommand(shellCommand, actor, identity);
      if (shellCommand.viewsOnly) result = result.filter((table) => table.object_type === "view");
      return shellCommand.dump ? String(result) : formatIdentityCommandOutput(result, shellCommand);
    }
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

async function runIdentityCliExpectFailure(env, args) {
  try {
    await runIdentityCli(env, args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`identity CLI command should have failed: ${args.join(" ")}`);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
