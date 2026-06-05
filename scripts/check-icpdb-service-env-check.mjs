#!/usr/bin/env node
// Where: scripts/check-icpdb-service-env-check.mjs
// What: Static/unit checks for the service.env postdeploy checker.
// Why: Server/CI env verification must fail on principal or URL drift before release.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  checkServiceEnvFileMode,
  checkServiceEnv,
  formatServiceEnvCheck,
  parseServiceEnvCheckArgs,
  usage
} from "./icpdb-service-env-check.mjs";

const execFileAsync = promisify(execFile);
const serviceEnvCheckSource = await readFile(new URL("./icpdb-service-env-check.mjs", import.meta.url), "utf8");

assert.match(usage(), /icpdb-service-env-check/);
assert.match(usage(), /\[--env-file <file>\]/);
assert.match(usage(), /default: service\.env/);
assert.match(usage(), /--smoke-sdk/);
assert.match(usage(), /@icpdb\/client\/server/);
assert.match(serviceEnvCheckSource, /dist-sdk\/icpdb-server\.js/);
assert.doesNotMatch(serviceEnvCheckSource, /dist-sdk\/icpdb-node\.js/);
assert.match(serviceEnvCheckSource, /connectClientFromEnvFile/);
assert.match(usage(), /--smoke-sdk-archive-restore/);
assert.match(usage(), /--smoke-sdk-shards/);
assert.deepEqual(parseServiceEnvCheckArgs([]), {
  envFile: "service.env",
  skipCall: false,
  smokeSql: false,
  smokeSdk: false,
  smokeArchiveRestore: false,
  smokeSdkArchiveRestore: false,
  smokeShards: false,
  smokeSdkShards: false,
  requireRole: "",
  outputFormat: "json"
});
assert.deepEqual(parseServiceEnvCheckArgs(["--env-file", "service.env"]), {
  envFile: "service.env",
  skipCall: false,
  smokeSql: false,
  smokeSdk: false,
  smokeArchiveRestore: false,
  smokeSdkArchiveRestore: false,
  smokeShards: false,
  smokeSdkShards: false,
  requireRole: "",
  outputFormat: "json"
});
assert.deepEqual(parseServiceEnvCheckArgs(["--env-file", "service.env", "--skip-call", "--format", "table"]), {
  envFile: "service.env",
  skipCall: true,
  smokeSql: false,
  smokeSdk: false,
  smokeArchiveRestore: false,
  smokeSdkArchiveRestore: false,
  smokeShards: false,
  smokeSdkShards: false,
  requireRole: "",
  outputFormat: "table"
});
assert.equal(parseServiceEnvCheckArgs(["--env-file", "service.env", "--format", "env"]).outputFormat, "env");
assert.equal(parseServiceEnvCheckArgs(["--env-file", "service.env", "--smoke-sql"]).smokeSql, true);
assert.equal(parseServiceEnvCheckArgs(["--env-file", "service.env", "--smoke-sdk"]).smokeSdk, true);
assert.equal(parseServiceEnvCheckArgs(["--env-file", "service.env", "--smoke-archive-restore"]).smokeArchiveRestore, true);
assert.equal(parseServiceEnvCheckArgs(["--env-file", "service.env", "--smoke-sdk-archive-restore"]).smokeSdkArchiveRestore, true);
assert.equal(parseServiceEnvCheckArgs(["--env-file", "controller.env", "--smoke-shards"]).smokeShards, true);
assert.equal(parseServiceEnvCheckArgs(["--env-file", "controller.env", "--smoke-sdk-shards"]).smokeSdkShards, true);
assert.equal(parseServiceEnvCheckArgs(["--env-file", "service.env", "--require-role", "owner"]).requireRole, "owner");
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "service.env", "--skip-call", "--smoke-sql"]), /cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "service.env", "--skip-call", "--smoke-sdk"]), /cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "service.env", "--skip-call", "--smoke-archive-restore"]), /cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "service.env", "--skip-call", "--smoke-sdk-archive-restore"]), /cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "controller.env", "--skip-call", "--smoke-shards"]), /cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "controller.env", "--skip-call", "--smoke-sdk-shards"]), /cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "service.env", "--skip-call", "--require-role", "owner"]), /--require-role cannot be combined with --skip-call/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "controller.env", "--smoke-shards", "--smoke-sql"]), /shard smokes cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "controller.env", "--smoke-shards", "--smoke-sdk"]), /shard smokes cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "controller.env", "--smoke-shards", "--smoke-archive-restore"]), /shard smokes cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "controller.env", "--smoke-shards", "--smoke-sdk-archive-restore"]), /shard smokes cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "controller.env", "--smoke-shards", "--require-role", "owner"]), /shard smokes cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "controller.env", "--smoke-sdk-shards", "--smoke-sql"]), /shard smokes cannot be combined/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "service.env", "--require-role", "admin"]), /role must be reader/);
assert.throws(() => parseServiceEnvCheckArgs(["--env-file", "   "]), /service env file path must be a non-empty string/);
assert.throws(() => parseServiceEnvCheckArgs(["--format", "csv", "--env-file", "service.env"]), /format must be json, table, or env/);

const inspect = {
  canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  database_id: "db_alpha",
  connection_url: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_alpha",
  network_url: "https://icp-api.io",
  principal: "aaaaa-aa",
  identity_type: "ed25519",
  has_root_key: false,
  has_setup_sql: false,
  setup_statement_count: 0,
  setup_migration_count: 0
};
const controllerInspect = {
  ...inspect,
  database_id: undefined,
  connection_url: undefined
};
const status = {
  database_id: "db_alpha",
  connection_url: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_alpha",
  caller_principal: "aaaaa-aa",
  caller_role: "writer",
  stats: {
    table_count: 1,
    view_count: 2,
    row_count: "3",
    column_count: 4,
    index_count: 5,
    trigger_count: 6,
    foreign_key_count: 7
  },
  table_summaries: []
};
const tempDir = await mkdtemp(join(tmpdir(), "icpdb-service-env-check-"));
const envPath = join(tempDir, "service.env");
await writeFile(envPath, "ICPDB_URL=\"icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_alpha\"\nICPDB_IDENTITY_PRINCIPAL=\"aaaaa-aa\"\nICPDB_IDENTITY_JSON=\"[]\"\n", { mode: 0o600 });
await chmod(envPath, 0o600);
const openEnvPath = join(tempDir, "open-service.env");
await writeFile(openEnvPath, "ICPDB_IDENTITY_JSON=\"[]\"\n", { mode: 0o644 });
await chmod(openEnvPath, 0o644);
const emptyUrlEnvPath = join(tempDir, "empty-service-url.env");
await writeFile(emptyUrlEnvPath, "ICPDB_URL=\"\"\nICPDB_IDENTITY_JSON=\"[]\"\n", { mode: 0o600 });
await chmod(emptyUrlEnvPath, 0o600);
const emptyDatabaseEnvPath = join(tempDir, "empty-service-database.env");
await writeFile(emptyDatabaseEnvPath, "ICPDB_CANISTER_ID=\"ryjl3-tyaaa-aaaaa-aaaba-cai\"\nICPDB_DATABASE_ID=\"\"\nICPDB_IDENTITY_JSON=\"[]\"\n", { mode: 0o600 });
await chmod(emptyDatabaseEnvPath, 0o600);
const duplicateEnvPath = join(tempDir, "duplicate-service.env");
await writeFile(duplicateEnvPath, "ICPDB_URL=\"icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_alpha\"\nICPDB_URL=\"icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_beta\"\n", { mode: 0o600 });
await chmod(duplicateEnvPath, 0o600);
const singleQuotedEnvPath = join(tempDir, "single-quoted-service.env");
await writeFile(singleQuotedEnvPath, [
  "ICPDB_URL='icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_alpha'",
  "ICPDB_IDENTITY_TYPE='ed25519'",
  "ICPDB_IDENTITY_PRINCIPAL='aaaaa-aa'",
  "ICPDB_IDENTITY_JSON='[]'",
  ""
].join("\n"), { mode: 0o600 });
await chmod(singleQuotedEnvPath, 0o600);

assert.deepEqual(await checkServiceEnvFileMode(envPath), {
  mode_octal: "0600",
  owner_only: true
});
await assert.rejects(() => checkServiceEnvFileMode(openEnvPath), /owner-only/);
await assert.rejects(() => checkServiceEnvFileMode("   "), /service env file path must be a non-empty string/);

const calls = [];
const result = await checkServiceEnv({ envFile: envPath, skipCall: false }, async (_envFile, command) => {
  calls.push(command);
  return command === "inspect-env" ? inspect : status;
});
assert.deepEqual(calls, ["inspect-env", "status"]);
assert.equal(result.ok, true);
assert.equal(result.file_mode.mode_octal, "0600");
assert.equal(result.status.connection_url, inspect.connection_url);
assert.deepEqual(result.checks, ["inspect-env", "status", "database_id", "connection_url", "caller_principal", "caller_role"]);
assert.match(formatServiceEnvCheck(result, "json"), /caller_principal/);
const table = formatServiceEnvCheck(result, "table");
assert.match(table, /file_mode\t0600/);
assert.match(table, /smoke_sdk_archive_restore\tfalse/);
assert.match(table, /smoke_sdk_shards\tfalse/);
assert.match(table, /connection_url\ticpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_alpha/);
assert.match(table, /caller_role\twriter/);
assert.match(table, /status_table_count\t1/);
assert.match(table, /status_view_count\t2/);
assert.match(table, /status_row_count\t3/);
assert.match(table, /status_column_count\t4/);
assert.match(table, /status_index_count\t5/);
assert.match(table, /status_trigger_count\t6/);
assert.match(table, /status_foreign_key_count\t7/);
assert.match(table, /checks\tinspect-env, status, database_id, connection_url, caller_principal, caller_role/);
const envOutput = formatServiceEnvCheck(result, "env");
assert.match(envOutput, /ICPDB_SERVICE_CHECK_OK="true"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_ENV_FILE=/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_CANISTER_ID="ryjl3-tyaaa-aaaaa-aaaba-cai"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_DATABASE_ID="db_alpha"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_CONNECTION_URL="icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_alpha"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_URL="icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_alpha"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_NETWORK_URL="https:\/\/icp-api.io"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_HAS_ROOT_KEY="false"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_PRINCIPAL="aaaaa-aa"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_CALLER_ROLE="writer"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_STATUS_TABLE_COUNT="1"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_STATUS_VIEW_COUNT="2"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_STATUS_ROW_COUNT="3"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_STATUS_COLUMN_COUNT="4"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_STATUS_INDEX_COUNT="5"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_STATUS_TRIGGER_COUNT="6"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECK_STATUS_FOREIGN_KEY_COUNT="7"/);
assert.match(envOutput, /ICPDB_SERVICE_CHECKS="inspect-env,status,database_id,connection_url,caller_principal,caller_role"/);

const smokeCalls = [];
const smokeResult = await checkServiceEnv({ envFile: envPath, skipCall: false, smokeSql: true }, async (_envFile, commandArgs) => {
  const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
  smokeCalls.push(commandArgs);
  if (command === "inspect-env") return inspect;
  if (command === "status") return status;
  if (command === "query") return { columns: ["body"], rows: [[{ text: JSON.parse(commandArgs[commandArgs.indexOf("--params") + 1])[0] }]] };
  if (command === "scalar") return { scalar: true, column: "body", value: { text: JSON.parse(commandArgs[commandArgs.indexOf("--params") + 1])[0] }, row_found: true, rows_returned: 1, truncated: false };
  return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
});
assert.equal(smokeResult.sql_smoke.selected_body, smokeResult.sql_smoke.inserted_body);
assert.equal(smokeResult.sql_smoke.selected_scalar_body, smokeResult.sql_smoke.inserted_body);
assert.equal(smokeResult.sql_smoke.cleanup, "dropped");
assert.deepEqual(smokeResult.checks, ["inspect-env", "status", "database_id", "connection_url", "caller_principal", "caller_role", "caller_role_at_least_writer", "sql_execute", "sql_query", "sql_scalar", "sql_cleanup"]);
assert.equal(smokeCalls.filter((args) => Array.isArray(args) && args[0] === "sql").length, 3);
assert.equal(smokeCalls.filter((args) => Array.isArray(args) && args[0] === "query").length, 1);
assert.equal(smokeCalls.filter((args) => Array.isArray(args) && args[0] === "scalar").length, 1);
assert.match(formatServiceEnvCheck(smokeResult, "table"), /sql_smoke_table\ticpdb_service_env_smoke_/);
assert.match(formatServiceEnvCheck(smokeResult, "table"), /sql_smoke_scalar_row\tservice-env-smoke-/);
assert.match(formatServiceEnvCheck(smokeResult, "env"), /ICPDB_SERVICE_CHECK_SQL_ROW="service-env-smoke-/);
assert.match(formatServiceEnvCheck(smokeResult, "env"), /ICPDB_SERVICE_CHECK_SQL_SCALAR_ROW="service-env-smoke-/);
const sdkSmokeResult = await checkServiceEnv(
  { envFile: envPath, skipCall: false, smokeSdk: true },
  async (_envFile, command) => command === "inspect-env" ? inspect : status,
  async (command, sdkInspect) => {
    assert.equal(command.envFile, envPath);
    assert.equal(sdkInspect.database_id, inspect.database_id);
    return {
      table: "icpdb_service_sdk_smoke_test",
      inserted_body: "service-sdk-smoke-test",
      selected_body: "service-sdk-smoke-test",
      selected_scalar_body: "service-sdk-smoke-test",
      connection_url: inspect.connection_url,
      cleanup: "dropped"
    };
  }
);
assert.equal(sdkSmokeResult.sdk_smoke.selected_body, "service-sdk-smoke-test");
assert.equal(sdkSmokeResult.sdk_smoke.selected_scalar_body, "service-sdk-smoke-test");
assert.deepEqual(sdkSmokeResult.checks, ["inspect-env", "status", "database_id", "connection_url", "caller_principal", "caller_role", "caller_role_at_least_writer", "sdk_status", "sdk_execute", "sdk_query", "sdk_scalar", "sdk_cleanup"]);
assert.match(formatServiceEnvCheck(sdkSmokeResult, "table"), /sdk_smoke_table\ticpdb_service_sdk_smoke_test/);
assert.match(formatServiceEnvCheck(sdkSmokeResult, "table"), /sdk_smoke_scalar_row\tservice-sdk-smoke-test/);
assert.match(formatServiceEnvCheck(sdkSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_TABLE="icpdb_service_sdk_smoke_test"/);
assert.match(formatServiceEnvCheck(sdkSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_ROW="service-sdk-smoke-test"/);
assert.match(formatServiceEnvCheck(sdkSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_SCALAR_ROW="service-sdk-smoke-test"/);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeSql: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "query") return { columns: ["body"], rows: [[{ text: JSON.parse(commandArgs[commandArgs.indexOf("--params") + 1])[0] }]] };
    if (command === "scalar") return { scalar: true, column: "body", value: { text: JSON.parse(commandArgs[commandArgs.indexOf("--params") + 1])[0] }, row_found: true, rows_returned: 1, truncated: false };
    if (Array.isArray(commandArgs) && commandArgs[1]?.startsWith("DROP TABLE")) throw new Error("drop failed");
    return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
  }),
  /drop failed/
);

const skipResult = await checkServiceEnv({ envFile: envPath, skipCall: true }, async () => inspect);
assert.equal(skipResult.status, null);
assert.deepEqual(skipResult.checks, ["inspect-env"]);
await assert.rejects(() => checkServiceEnv({ envFile: openEnvPath, skipCall: true }, async () => inspect), /owner-only/);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: true }, async () => ({ ...inspect, canister_id: "" })),
  /inspect-env canister_id must be a non-empty string/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: true }, async () => ({ ...inspect, principal: "   " })),
  /inspect-env principal must be a non-empty string/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: true }, async () => ({ ...inspect, connection_url: undefined })),
  /inspect-env connection_url is required when database_id is present/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: true }, async () => ({
    ...inspect,
    has_setup_sql: true,
    setup_statement_count: 1
  })),
  /DB-bearing but contains ICPDB_SETUP_\*/
);
await assert.rejects(
  () => execFileAsync(process.execPath, ["scripts/icpdb-service-env-check.mjs", "--env-file", emptyUrlEnvPath, "--skip-call"]),
  (error) => /ICPDB_URL must be a non-empty string/.test(String(error.stderr ?? error.message))
);
await assert.rejects(
  () => execFileAsync(process.execPath, ["scripts/icpdb-service-env-check.mjs", "--env-file", emptyDatabaseEnvPath, "--skip-call"]),
  (error) => /ICPDB_DATABASE_ID must be a non-empty string/.test(String(error.stderr ?? error.message))
);
await assert.rejects(
  () => checkServiceEnv({ envFile: duplicateEnvPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    return command === "status" ? { ...status, caller_role: "owner" } : inspect;
  }),
  /duplicate env key ICPDB_URL/
);

const archiveRestoreCalls = [];
let archiveRestoreCreateCount = 0;
const archiveRestoreResult = await checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
  const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
  archiveRestoreCalls.push({ envFile: _envFile, commandArgs });
  if (command === "inspect-env") return inspect;
  if (command === "status") return { ...status, caller_role: "owner" };
  if (command === "archive") return { file: commandArgs[2], snapshot_hash: "a".repeat(64), size_bytes: "4096" };
  if (command === "snapshot-info") return { file: commandArgs[1], snapshot_hash: "a".repeat(64), size_bytes: "4096" };
  if (command === "create-db") {
    archiveRestoreCreateCount += 1;
    return { database_id: archiveRestoreCreateCount === 1 ? "db_scratch_archive" : "db_scratch_restore" };
  }
  if (command === "restore") return { database_id: commandArgs[1], file: commandArgs[2], snapshot_hash: commandArgs[commandArgs.indexOf("--expect-snapshot-hash") + 1], size_bytes: "4096" };
  if (command === "query") return { columns: ["body"], rows: [[{ text: JSON.parse(commandArgs[commandArgs.indexOf("--params") + 1])[0] }]] };
  if (command === "scalar") return { scalar: true, column: "body", value: { text: JSON.parse(commandArgs[commandArgs.indexOf("--params") + 1])[0] }, row_found: true, rows_returned: 1, truncated: false };
  if (command === "delete-db") return null;
  return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
});
assert.equal(archiveRestoreResult.archive_restore_smoke.snapshot_hash, "a".repeat(64));
assert.equal(archiveRestoreResult.archive_restore_smoke.size_bytes, "4096");
assert.equal(archiveRestoreResult.archive_restore_smoke.scratch_archive_database_id, "db_scratch_archive");
assert.equal(archiveRestoreResult.archive_restore_smoke.scratch_restore_database_id, "db_scratch_restore");
assert.equal(archiveRestoreResult.archive_restore_smoke.selected_body, archiveRestoreResult.archive_restore_smoke.inserted_body);
assert.equal(archiveRestoreResult.archive_restore_smoke.selected_scalar_body, archiveRestoreResult.archive_restore_smoke.inserted_body);
assert.equal(archiveRestoreResult.archive_restore_smoke.cleanup, "scratch archive database and scratch restore database deleted");
assert.match(formatServiceEnvCheck(archiveRestoreResult, "table"), /archive_restore_scratch_archive_database_id\tdb_scratch_archive/);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "table"), /archive_restore_scratch_restore_database_id\tdb_scratch_restore/);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCRATCH_ARCHIVE_DATABASE_ID="db_scratch_archive"/);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCRATCH_RESTORE_DATABASE_ID="db_scratch_restore"/);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_HASH="a{64}"/);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SIZE_BYTES="4096"/);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_ROW="service-archive-smoke-/);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCALAR_ROW="service-archive-smoke-/);
assert.deepEqual(archiveRestoreResult.checks, [
  "inspect-env",
  "status",
  "database_id",
  "connection_url",
  "caller_principal",
  "caller_role",
  "caller_role_at_least_owner",
  "archive",
  "snapshot_info",
  "scratch_create_db",
  "scratch_restore",
  "archive_restore_query",
  "archive_restore_scalar",
  "scratch_delete_db",
  "archive_restore_cleanup"
]);

const sdkArchiveRestoreResult = await checkServiceEnv(
  { envFile: envPath, skipCall: false, smokeSdkArchiveRestore: true },
  async (_envFile, command) => command === "inspect-env" ? inspect : { ...status, caller_role: "owner" },
  async () => {
    throw new Error("plain SDK smoke should not run");
  },
  async (command, sdkInspect) => {
    assert.equal(command.envFile, envPath);
    assert.equal(sdkInspect.database_id, inspect.database_id);
    return {
      table: "icpdb_service_sdk_archive_smoke_test",
      scratch_archive_database_id: "db_scratch_sdk_archive",
      scratch_restore_database_id: "db_scratch_sdk_restore",
      file: "/tmp/sdk-snapshot.sqlite",
      snapshot_hash: "b".repeat(64),
      size_bytes: "8192",
      inserted_body: "service-sdk-archive-smoke-test",
      selected_body: "service-sdk-archive-smoke-test",
      selected_scalar_body: "service-sdk-archive-smoke-test",
      cleanup: "SDK scratch archive database and scratch restore database deleted"
    };
  }
);
assert.equal(sdkArchiveRestoreResult.sdk_archive_restore_smoke.snapshot_hash, "b".repeat(64));
assert.equal(sdkArchiveRestoreResult.sdk_archive_restore_smoke.selected_body, "service-sdk-archive-smoke-test");
assert.equal(sdkArchiveRestoreResult.sdk_archive_restore_smoke.selected_scalar_body, "service-sdk-archive-smoke-test");
assert.equal(sdkArchiveRestoreResult.sdk_archive_restore_smoke.scratch_archive_database_id, "db_scratch_sdk_archive");
assert.equal(sdkArchiveRestoreResult.sdk_archive_restore_smoke.scratch_restore_database_id, "db_scratch_sdk_restore");
assert.deepEqual(sdkArchiveRestoreResult.checks, [
  "inspect-env",
  "status",
  "database_id",
  "connection_url",
  "caller_principal",
  "caller_role",
  "caller_role_at_least_owner",
  "sdk_archive",
  "sdk_snapshot_info",
  "sdk_scratch_create_db",
  "sdk_scratch_restore",
  "sdk_archive_restore_query",
  "sdk_archive_restore_scalar",
  "sdk_scratch_delete_db",
  "sdk_archive_restore_cleanup"
]);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "table"), /sdk_archive_restore_table\ticpdb_service_sdk_archive_smoke_test/);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "table"), /sdk_archive_restore_scratch_archive_database_id\tdb_scratch_sdk_archive/);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "table"), /sdk_archive_restore_scratch_restore_database_id\tdb_scratch_sdk_restore/);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCRATCH_ARCHIVE_DATABASE_ID="db_scratch_sdk_archive"/);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCRATCH_RESTORE_DATABASE_ID="db_scratch_sdk_restore"/);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_HASH="b{64}"/);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SIZE_BYTES="8192"/);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_ROW="service-sdk-archive-smoke-test"/);
assert.match(formatServiceEnvCheck(sdkArchiveRestoreResult, "env"), /ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCALAR_ROW="service-sdk-archive-smoke-test"/);
assert.equal(archiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "archive" && call.commandArgs[1] === "db_scratch_archive" && call.envFile !== envPath).length, 1);
assert.equal(archiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "snapshot-info" && call.envFile === envPath).length, 1);
assert.equal(archiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "create-db" && call.envFile !== envPath).length, 2);
const scratchRestoreCall = archiveRestoreCalls.find((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "restore");
assert.deepEqual(scratchRestoreCall.commandArgs.slice(0, 3), ["restore", "db_scratch_restore", scratchRestoreCall.commandArgs[2]]);
assert.notEqual(scratchRestoreCall.envFile, envPath);
assert.equal(archiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "query" && call.commandArgs[1] === "db_scratch_restore").length, 1);
assert.equal(archiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "scalar" && call.commandArgs[1] === "db_scratch_restore").length, 1);
assert.equal(archiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "delete-db" && call.commandArgs[1] === "db_scratch_restore").length, 2);
assert.equal(archiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "delete-db" && call.commandArgs[1] === "db_scratch_archive").length, 1);
assert.equal(archiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "sql" && call.commandArgs[1] === "db_scratch_archive").length, 2);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "table"), /archive_restore_hash\ta{64}/);
assert.match(formatServiceEnvCheck(archiveRestoreResult, "table"), /archive_restore_size_bytes\t4096/);
const singleQuotedArchiveRestoreCalls = [];
let singleQuotedArchiveRestoreCreateCount = 0;
const singleQuotedArchiveRestoreResult = await checkServiceEnv({ envFile: singleQuotedEnvPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
  const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
  singleQuotedArchiveRestoreCalls.push({ envFile: _envFile, commandArgs });
  if (command === "inspect-env") return inspect;
  if (command === "status") return { ...status, caller_role: "owner" };
  if (command === "archive") return { file: commandArgs[2], snapshot_hash: "a".repeat(64), size_bytes: "4096" };
  if (command === "snapshot-info") return { file: commandArgs[1], snapshot_hash: "a".repeat(64), size_bytes: "4096" };
  if (command === "create-db") {
    const scratchEnv = await readFile(_envFile, "utf8");
    assert.match(scratchEnv, /ICPDB_IDENTITY_TYPE="ed25519"/);
    assert.match(scratchEnv, /ICPDB_IDENTITY_PRINCIPAL="aaaaa-aa"/);
    assert.match(scratchEnv, /ICPDB_IDENTITY_JSON="\[\]"/);
    singleQuotedArchiveRestoreCreateCount += 1;
    return { database_id: singleQuotedArchiveRestoreCreateCount === 1 ? "db_scratch_single_archive" : "db_scratch_single_restore" };
  }
  if (command === "restore") return { database_id: commandArgs[1], file: commandArgs[2], snapshot_hash: commandArgs[commandArgs.indexOf("--expect-snapshot-hash") + 1], size_bytes: "4096" };
  if (command === "query") return { columns: ["body"], rows: [[{ text: JSON.parse(commandArgs[commandArgs.indexOf("--params") + 1])[0] }]] };
  if (command === "scalar") return { scalar: true, column: "body", value: { text: JSON.parse(commandArgs[commandArgs.indexOf("--params") + 1])[0] }, row_found: true, rows_returned: 1, truncated: false };
  if (command === "delete-db") return null;
  return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
});
assert.equal(singleQuotedArchiveRestoreResult.archive_restore_smoke.scratch_archive_database_id, "db_scratch_single_archive");
assert.equal(singleQuotedArchiveRestoreResult.archive_restore_smoke.scratch_restore_database_id, "db_scratch_single_restore");
assert.equal(singleQuotedArchiveRestoreCalls.filter((call) => Array.isArray(call.commandArgs) && call.commandArgs[0] === "create-db").length, 2);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "snapshot-info") return { snapshot_hash: "b".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_hash_mismatch" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected archive hash mismatch command: ${command}`);
  }),
  /snapshot hash mismatch/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "snapshot-info") return { snapshot_hash: "a".repeat(64), size_bytes: "8192" };
    if (command === "create-db") return { database_id: "db_scratch_size_mismatch" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected archive size mismatch command: ${command}`);
  }),
  /snapshot size mismatch/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive") return { snapshot_hash: "not-a-hash", size_bytes: "4096" };
    if (command === "snapshot-info") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_bad_hash" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected archive hash shape command: ${command}`);
  }),
  /archive snapshot_hash must be a 64-character hex SHA-256 hash/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive") return { snapshot_hash: "a".repeat(64), size_bytes: "4 KiB" };
    if (command === "snapshot-info") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_bad_size" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected archive size shape command: ${command}`);
  }),
  /archive size_bytes must be a non-negative integer/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive" || command === "snapshot-info") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_restore_hash" };
    if (command === "restore") return { database_id: "db_scratch_restore_hash", snapshot_hash: "b".repeat(64), size_bytes: "4096" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected restore hash mismatch command: ${command}`);
  }),
  /restored snapshot hash mismatch/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive" || command === "snapshot-info") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_restore_size" };
    if (command === "restore") return { database_id: "db_scratch_restore_size", snapshot_hash: "a".repeat(64), size_bytes: "8192" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected restore size mismatch command: ${command}`);
  }),
  /restored snapshot size mismatch/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive" || command === "snapshot-info") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_restore_bad_hash" };
    if (command === "restore") return { database_id: "db_scratch_restore_bad_hash", snapshot_hash: "not-a-hash", size_bytes: "4096" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected restore hash shape command: ${command}`);
  }),
  /restore snapshot_hash must be a 64-character hex SHA-256 hash/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive" || command === "snapshot-info") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_restore_bad_size" };
    if (command === "restore") return { database_id: "db_scratch_restore_bad_size", snapshot_hash: "a".repeat(64), size_bytes: "4 KiB" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected restore size shape command: ${command}`);
  }),
  /restore size_bytes must be a non-negative integer/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive" || command === "snapshot-info") return { snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_restore_db" };
    if (command === "restore") return { database_id: "db_other", snapshot_hash: "a".repeat(64), size_bytes: "4096" };
    if (command === "delete-db") return null;
    if (command === "sql") return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
    throw new Error(`unexpected restore database mismatch command: ${command}`);
  }),
  /restored database mismatch/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return inspect;
    if (command === "status") return { ...status, caller_role: "owner" };
    if (command === "archive" || command === "snapshot-info") return { snapshot_hash: "b".repeat(64), size_bytes: "4096" };
    if (command === "create-db") return { database_id: "db_scratch_fail" };
    if (command === "restore") return { snapshot_hash: "b".repeat(64), size_bytes: "4096" };
    if (command === "query") return { columns: ["body"], rows: [[{ text: "wrong" }]] };
    if (command === "delete-db") return null;
    return { columns: [], rows: [], rows_affected: "1", last_insert_rowid: "1", truncated: false };
  }),
  /archive\/restore smoke query mismatch/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, requireRole: "owner" }, async (_envFile, command) => (
    command === "inspect-env" ? inspect : status
  )),
  /below required role owner/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeArchiveRestore: true }, async (_envFile, command) => (
    command === "inspect-env" ? inspect : status
  )),
  /below required role owner/
);

const shardSmokeCalls = [];
const shardSmokeResult = await checkServiceEnv({ envFile: envPath, skipCall: false, smokeShards: true }, async (_envFile, commandArgs) => {
  const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
  shardSmokeCalls.push(commandArgs);
  if (command === "inspect-env") return controllerInspect;
  if (command === "health") return { canister_id: controllerInspect.canister_id, cycles_balance: "1000" };
  if (command === "all-placements") return [
    { database_id: "db_alpha" },
    { database_id: "db_remote", shard_id: "database:r7inp-6aaaa-aaaaa-aaabq-cai", canister_id: "r7inp-6aaaa-aaaaa-aaabq-cai" }
  ];
  if (command === "shards") return [
    { shard_id: "local", canister_id: controllerInspect.canister_id },
    { shard_id: "database:r7inp-6aaaa-aaaaa-aaabq-cai", canister_id: "r7inp-6aaaa-aaaaa-aaabq-cai" }
  ];
  if (command === "shard-status") return {
    shard: { shard_id: "database:r7inp-6aaaa-aaaaa-aaabq-cai", canister_id: commandArgs[1] },
    cycles_balance: "1000"
  };
  if (command === "shard-ops") return [{ operation_id: "op_1" }];
  if (command === "shard-maintain") return { inspected_shards: [], actions: [], available_slots: "1" };
  throw new Error(`unexpected shard smoke command: ${command}`);
});
assert.equal(shardSmokeResult.status, null);
assert.equal(shardSmokeResult.shard_smoke.canister_id, controllerInspect.canister_id);
assert.equal(shardSmokeResult.shard_smoke.status_canister_id, "r7inp-6aaaa-aaaaa-aaabq-cai");
assert.equal(shardSmokeResult.shard_smoke.status_cycles_balance, "1000");
assert.equal(shardSmokeResult.shard_smoke.placement_count, 2);
assert.equal(shardSmokeResult.shard_smoke.shard_count, 2);
assert.equal(shardSmokeResult.shard_smoke.operation_count, 1);
assert.equal(shardSmokeResult.shard_smoke.maintenance_action_count, 0);
assert.deepEqual(shardSmokeResult.checks, ["inspect-env", "health", "all_placements", "shards", "shard_inventory_consistency", "shard_status", "shard_ops", "shard_maintain_zero_action"]);
assert.deepEqual(shardSmokeCalls, [
  "inspect-env",
  "health",
  "all-placements",
  "shards",
  "shard-ops",
  ["shard-maintain", "0", "0", "0", "0", "0", "0"],
  "shard-ops",
  ["shard-status", "r7inp-6aaaa-aaaaa-aaabq-cai"]
]);
assert.match(formatServiceEnvCheck(shardSmokeResult, "table"), /smoke_shards\ttrue/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "table"), new RegExp(`shard_canister_id\\t${controllerInspect.canister_id}`));
assert.match(formatServiceEnvCheck(shardSmokeResult, "table"), /shard_status_canister_id\tr7inp-6aaaa-aaaaa-aaabq-cai/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "table"), /shard_status_cycles_balance\t1000/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "table"), /shard_count\t2/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "table"), /shard_maintenance_available_slots\t1/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "env"), new RegExp(`ICPDB_SERVICE_CHECK_SHARD_CANISTER_ID="${controllerInspect.canister_id}"`));
assert.match(formatServiceEnvCheck(shardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SHARD_STATUS_CANISTER_ID="r7inp-6aaaa-aaaaa-aaabq-cai"/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SHARD_STATUS_CYCLES_BALANCE="1000"/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SHARD_COUNT="2"/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SHARD_PLACEMENT_COUNT="2"/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SHARD_OPERATION_COUNT="1"/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SHARD_MAINTENANCE_AVAILABLE_SLOTS="1"/);
assert.match(formatServiceEnvCheck(shardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SHARD_MAINTENANCE_ACTIONS="0"/);

const sdkShardSmokeResult = await checkServiceEnv(
  { envFile: envPath, skipCall: false, smokeSdkShards: true },
  async (_envFile, command) => {
    assert.equal(command, "inspect-env");
    return controllerInspect;
  },
  async () => {
    throw new Error("plain SDK SQL smoke should not run");
  },
  async () => {
    throw new Error("SDK archive smoke should not run");
  },
	  async (command, sdkInspect) => {
	    assert.equal(command.envFile, envPath);
	    assert.equal(sdkInspect.canister_id, controllerInspect.canister_id);
	    return {
	      canister_id: controllerInspect.canister_id,
	      status_canister_id: "r7inp-6aaaa-aaaaa-aaabq-cai",
	      status_cycles_balance: "4000",
	      placement_count: 2,
	      shard_count: 1,
	      operation_count: 3,
	      maintenance_available_slots: "4",
	      maintenance_action_count: 0
    };
  }
);
assert.equal(sdkShardSmokeResult.status, null);
assert.equal(sdkShardSmokeResult.sdk_shard_smoke.canister_id, controllerInspect.canister_id);
assert.equal(sdkShardSmokeResult.sdk_shard_smoke.status_canister_id, "r7inp-6aaaa-aaaaa-aaabq-cai");
assert.equal(sdkShardSmokeResult.sdk_shard_smoke.status_cycles_balance, "4000");
assert.equal(sdkShardSmokeResult.sdk_shard_smoke.placement_count, 2);
assert.equal(sdkShardSmokeResult.sdk_shard_smoke.shard_count, 1);
assert.equal(sdkShardSmokeResult.sdk_shard_smoke.operation_count, 3);
assert.equal(sdkShardSmokeResult.sdk_shard_smoke.maintenance_action_count, 0);
assert.deepEqual(sdkShardSmokeResult.checks, [
	  "inspect-env",
	  "sdk_health",
	  "sdk_all_placements",
	  "sdk_shards",
	  "sdk_shard_inventory_consistency",
	  "sdk_shard_status",
	  "sdk_shard_ops",
	  "sdk_shard_maintain_zero_action"
	]);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "table"), /smoke_sdk_shards\ttrue/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "table"), new RegExp(`sdk_shard_canister_id\\t${controllerInspect.canister_id}`));
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "table"), /sdk_shard_status_canister_id\tr7inp-6aaaa-aaaaa-aaabq-cai/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "table"), /sdk_shard_status_cycles_balance\t4000/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "table"), /sdk_shard_count\t1/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "table"), /sdk_shard_maintenance_available_slots\t4/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "env"), new RegExp(`ICPDB_SERVICE_CHECK_SDK_SHARD_CANISTER_ID="${controllerInspect.canister_id}"`));
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_SHARD_STATUS_CANISTER_ID="r7inp-6aaaa-aaaaa-aaabq-cai"/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_SHARD_STATUS_CYCLES_BALANCE="4000"/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_SHARD_COUNT="1"/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_SHARD_PLACEMENT_COUNT="2"/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_SHARD_OPERATION_COUNT="3"/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_SHARD_MAINTENANCE_AVAILABLE_SLOTS="4"/);
assert.match(formatServiceEnvCheck(sdkShardSmokeResult, "env"), /ICPDB_SERVICE_CHECK_SDK_SHARD_MAINTENANCE_ACTIONS="0"/);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeShards: true }, async () => inspect),
  /shard smoke requires a canister-only controller env/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeSdkShards: true }, async () => inspect),
  /shard smoke requires a canister-only controller env/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeShards: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return controllerInspect;
    if (command === "health") return { canister_id: "r7inp-6aaaa-aaaaa-aaabq-cai", cycles_balance: "1000" };
    if (command === "all-placements" || command === "shards" || command === "shard-ops") return [];
    if (command === "shard-maintain") return { inspected_shards: [], actions: [], available_slots: "1" };
    throw new Error(`unexpected shard smoke command: ${command}`);
  }),
  /shard smoke health canister_id does not match inspect-env/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeShards: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return controllerInspect;
    if (command === "health") return { canister_id: controllerInspect.canister_id, cycles_balance: "1000" };
    if (command === "all-placements") return { rows: [] };
    if (command === "shards" || command === "shard-ops") return [];
    if (command === "shard-maintain") return { inspected_shards: [], actions: [], available_slots: "1" };
    throw new Error(`unexpected shard smoke command: ${command}`);
  }),
  /shard smoke all-placements must be an array/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeShards: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return controllerInspect;
    if (command === "health") return { canister_id: controllerInspect.canister_id, cycles_balance: "1000" };
    if (command === "all-placements") return [{ database_id: "db_remote", shard_id: "database:r7inp-6aaaa-aaaaa-aaabq-cai", canister_id: "r7inp-6aaaa-aaaaa-aaabq-cai" }];
    if (command === "shards" || command === "shard-ops") return [];
    if (command === "shard-maintain") return { inspected_shards: [], actions: [], available_slots: "1" };
    throw new Error(`unexpected shard smoke command: ${command}`);
  }),
  /placement references unregistered shard/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeShards: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return controllerInspect;
    if (command === "health") return { canister_id: controllerInspect.canister_id, cycles_balance: "1000" };
    if (command === "all-placements") return [{ database_id: "db_remote", shard_id: "database:r7inp-6aaaa-aaaaa-aaabq-cai", canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai" }];
    if (command === "shards") return [{ shard_id: "database:r7inp-6aaaa-aaaaa-aaabq-cai", canister_id: "r7inp-6aaaa-aaaaa-aaabq-cai" }];
    if (command === "shard-ops") return [];
    if (command === "shard-maintain") return { inspected_shards: [], actions: [], available_slots: "1" };
    throw new Error(`unexpected shard smoke command: ${command}`);
  }),
  /placement canister_id does not match registered shard/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeShards: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return controllerInspect;
    if (command === "health") return { canister_id: controllerInspect.canister_id, cycles_balance: "1000" };
    if (command === "all-placements" || command === "shards" || command === "shard-ops") return [];
    if (command === "shard-maintain") return { inspected_shards: [], available_slots: "1" };
    throw new Error(`unexpected shard smoke command: ${command}`);
  }),
  /shard smoke maintenance actions must be an array/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false, smokeShards: true }, async (_envFile, commandArgs) => {
    const command = Array.isArray(commandArgs) ? commandArgs[0] : commandArgs;
    if (command === "inspect-env") return controllerInspect;
    if (command === "health") return { canister_id: controllerInspect.canister_id, cycles_balance: "1000" };
    if (command === "all-placements" || command === "shards" || command === "shard-ops") return [];
    if (command === "shard-maintain") return { inspected_shards: [], actions: [{ action: "create_shard" }], available_slots: "1" };
    throw new Error(`unexpected shard smoke command: ${command}`);
  }),
  /expected zero maintenance actions/
);

await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false }, async (_envFile, command) => (
    command === "inspect-env" ? { ...inspect, database_id: undefined, connection_url: undefined } : status
  )),
  /requires ICPDB_DATABASE_ID/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false }, async (_envFile, command) => (
    command === "inspect-env" ? { ...inspect, connection_url: undefined } : status
  )),
  /inspect-env connection_url is required when database_id is present/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false }, async (_envFile, command) => (
    command === "inspect-env" ? inspect : { ...status, caller_principal: "bbbbb-bb" }
  )),
  /caller_principal does not match/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false }, async (_envFile, command) => (
    command === "inspect-env" ? inspect : { ...status, connection_url: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_other" }
  )),
  /connection_url does not match/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false }, async (_envFile, command) => (
    command === "inspect-env" ? inspect : { ...status, caller_role: "" }
  )),
  /caller_role is missing/
);
await assert.rejects(
  () => checkServiceEnv({ envFile: envPath, skipCall: false }, async (_envFile, command) => (
    command === "inspect-env" ? inspect : { ...status, caller_role: "admin" }
  )),
  /role must be reader/
);

await rm(tempDir, { recursive: true, force: true });
console.log("ICPDB service env check OK");
