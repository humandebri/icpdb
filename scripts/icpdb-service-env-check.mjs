#!/usr/bin/env node
// Where: scripts/icpdb-service-env-check.mjs
// What: Verify a Server/CI service.env locally and through database or shard canister calls.
// Why: Postdeploy checks should prove the env principal, connection URL, SQL access, and controller ops match canister-visible state.
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const identityCliPath = fileURLToPath(new URL("./icpdb-identity.mjs", import.meta.url));
const DEFAULT_SERVICE_ENV_FILE = "service.env";

export function usage() {
  return [
    "Usage:",
    "  node scripts/icpdb-service-env-check.mjs [--env-file <file>] [--skip-call] [--smoke-sql] [--smoke-sdk] [--smoke-archive-restore] [--smoke-sdk-archive-restore] [--smoke-shards] [--smoke-sdk-shards] [--require-role reader|writer|owner] [--format json|table|env]",
    "",
    "Options:",
    "  --env-file <file>    default: service.env",
    "  --skip-call",
    "  --smoke-sql",
    "  --smoke-sdk       verify @icpdb/client/server can use this service.env",
    "  --smoke-archive-restore",
    "  --smoke-sdk-archive-restore",
    "  --smoke-shards",
    "  --smoke-sdk-shards",
    "  --require-role <reader|writer|owner>",
    "  --format json|table|env"
  ].join("\n");
}

export function parseServiceEnvCheckArgs(args) {
  const command = {
    envFile: DEFAULT_SERVICE_ENV_FILE,
    skipCall: false,
    smokeSql: false,
    smokeSdk: false,
    smokeArchiveRestore: false,
    smokeSdkArchiveRestore: false,
    smokeShards: false,
    smokeSdkShards: false,
    requireRole: "",
    outputFormat: "json"
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--env-file") {
      command.envFile = filePathArg(requireValue(args, index, arg), "service env file");
      index += 1;
    } else if (arg === "--skip-call") {
      command.skipCall = true;
    } else if (arg === "--smoke-sql") {
      command.smokeSql = true;
    } else if (arg === "--smoke-sdk") {
      command.smokeSdk = true;
    } else if (arg === "--smoke-archive-restore") {
      command.smokeArchiveRestore = true;
    } else if (arg === "--smoke-sdk-archive-restore") {
      command.smokeSdkArchiveRestore = true;
    } else if (arg === "--smoke-shards") {
      command.smokeShards = true;
    } else if (arg === "--smoke-sdk-shards") {
      command.smokeSdkShards = true;
    } else if (arg === "--require-role") {
      command.requireRole = parseDatabaseRole(requireValue(args, index, arg));
      index += 1;
    } else if (arg === "--format") {
      command.outputFormat = parseOutputFormat(requireValue(args, index, arg));
      index += 1;
    } else if (arg === "-h" || arg === "--help" || arg === "help") {
      command.help = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (command.skipCall && command.smokeSql) throw new Error("--smoke-sql cannot be combined with --skip-call");
  if (command.skipCall && command.smokeSdk) throw new Error("--smoke-sdk cannot be combined with --skip-call");
  if (command.skipCall && command.smokeArchiveRestore) throw new Error("--smoke-archive-restore cannot be combined with --skip-call");
  if (command.skipCall && command.smokeSdkArchiveRestore) throw new Error("--smoke-sdk-archive-restore cannot be combined with --skip-call");
  if (command.skipCall && command.smokeShards) throw new Error("--smoke-shards cannot be combined with --skip-call");
  if (command.skipCall && command.smokeSdkShards) throw new Error("--smoke-sdk-shards cannot be combined with --skip-call");
  if (command.skipCall && command.requireRole) throw new Error("--require-role cannot be combined with --skip-call");
  assertShardSmokeOptions(command);
  return command;
}

function assertShardSmokeOptions(command) {
  if (!command.smokeShards && !command.smokeSdkShards) return;
  if (!command.smokeSql && !command.smokeSdk && !command.smokeArchiveRestore && !command.smokeSdkArchiveRestore && !command.requireRole) return;
  throw new Error("shard smokes cannot be combined with database smokes or --require-role");
}

export async function checkServiceEnv(
  command,
  runIdentity = runIdentityCliJson,
  runSdk = smokeServiceSdk,
  runSdkArchiveRestore = smokeServiceSdkArchiveRestore,
  runSdkShards = smokeServiceSdkShards
) {
  const fileMode = await checkServiceEnvFileMode(command.envFile);
  const inspect = await runIdentity(command.envFile, "inspect-env");
  validateInspectEnv(inspect);
  assertShardSmokeCanisterOnly(command, inspect);
  const result = {
    ok: true,
    env_file: command.envFile,
    file_mode: fileMode,
    skipped_call: command.skipCall,
    smoke_sql: command.smokeSql,
    smoke_sdk: command.smokeSdk,
    smoke_archive_restore: command.smokeArchiveRestore,
    smoke_sdk_archive_restore: command.smokeSdkArchiveRestore,
    smoke_shards: command.smokeShards,
    smoke_sdk_shards: command.smokeSdkShards,
    inspect,
    status: null,
    sql_smoke: null,
    sdk_smoke: null,
    archive_restore_smoke: null,
    sdk_archive_restore_smoke: null,
    shard_smoke: null,
    sdk_shard_smoke: null,
    checks: [
      "inspect-env"
    ]
  };
  if (command.skipCall) return result;
  const needsDatabaseStatus = Boolean(command.requireRole || command.smokeSql || command.smokeSdk || command.smokeArchiveRestore || command.smokeSdkArchiveRestore || (!command.smokeShards && !command.smokeSdkShards));
  if (needsDatabaseStatus && !inspect.database_id) {
    throw new Error("service env check status requires ICPDB_DATABASE_ID or a database-bearing ICPDB_URL; pass --skip-call for local-only inspection");
  }
  if (needsDatabaseStatus && !inspect.connection_url) {
    throw new Error("service env check status requires a database connection_url from inspect-env");
  }
  const status = needsDatabaseStatus && inspect.database_id ? await runIdentity(command.envFile, "status") : null;
  const requiredRole = requiredServiceRole(command);
  if (status) {
    assertEqual(status.database_id, inspect.database_id, "status database_id does not match inspect-env");
    assertEqual(status.connection_url, inspect.connection_url, "status connection_url does not match inspect-env");
    assertEqual(status.caller_principal, inspect.principal, "status caller_principal does not match service identity principal");
    if (!status.caller_role) throw new Error("status caller_role is missing; service identity role is not visible");
    const callerRole = parseDatabaseRole(status.caller_role);
    if (requiredRole) assertRoleAtLeast(callerRole, requiredRole);
  } else if (requiredRole) {
    throw new Error("service env role check requires a database-bearing ICPDB_URL or ICPDB_DATABASE_ID");
  }
  const sqlSmoke = command.smokeSql ? await smokeServiceSql(command, runIdentity) : null;
  const sdkSmoke = command.smokeSdk ? await runSdk(command, inspect) : null;
  const archiveRestoreSmoke = command.smokeArchiveRestore ? await smokeServiceArchiveRestore(command, inspect, runIdentity) : null;
  const sdkArchiveRestoreSmoke = command.smokeSdkArchiveRestore ? await runSdkArchiveRestore(command, inspect) : null;
  const shardSmoke = command.smokeShards ? await smokeServiceShards(command, inspect, runIdentity) : null;
  const sdkShardSmoke = command.smokeSdkShards ? await runSdkShards(command, inspect) : null;
  return {
    ...result,
    status,
    sql_smoke: sqlSmoke,
    sdk_smoke: sdkSmoke,
    archive_restore_smoke: archiveRestoreSmoke,
    sdk_archive_restore_smoke: sdkArchiveRestoreSmoke,
    shard_smoke: shardSmoke,
    sdk_shard_smoke: sdkShardSmoke,
    checks: [
      ...result.checks,
      ...(status ? ["status", "database_id", "connection_url", "caller_principal", "caller_role"] : []),
      ...(requiredRole ? [`caller_role_at_least_${requiredRole}`] : []),
      ...(sqlSmoke ? ["sql_execute", "sql_query", "sql_scalar", "sql_cleanup"] : []),
      ...(sdkSmoke ? ["sdk_status", "sdk_execute", "sdk_query", "sdk_scalar", "sdk_cleanup"] : []),
      ...(archiveRestoreSmoke ? ["archive", "snapshot_info", "scratch_create_db", "scratch_restore", "archive_restore_query", "archive_restore_scalar", "scratch_delete_db", "archive_restore_cleanup"] : []),
      ...(sdkArchiveRestoreSmoke ? ["sdk_archive", "sdk_snapshot_info", "sdk_scratch_create_db", "sdk_scratch_restore", "sdk_archive_restore_query", "sdk_archive_restore_scalar", "sdk_scratch_delete_db", "sdk_archive_restore_cleanup"] : []),
      ...(shardSmoke ? ["health", "all_placements", "shards", "shard_inventory_consistency", ...(shardSmoke.status_canister_id ? ["shard_status"] : []), "shard_ops", "shard_maintain_zero_action"] : []),
      ...(sdkShardSmoke ? ["sdk_health", "sdk_all_placements", "sdk_shards", "sdk_shard_inventory_consistency", ...(sdkShardSmoke.status_canister_id ? ["sdk_shard_status"] : []), "sdk_shard_ops", "sdk_shard_maintain_zero_action"] : [])
    ]
  };
}

function assertShardSmokeCanisterOnly(command, inspect) {
  if (!command.smokeShards && !command.smokeSdkShards) return;
  if (!inspect.database_id) return;
  throw new Error("shard smoke requires a canister-only controller env; remove ICPDB_DATABASE_ID and database-bearing ICPDB_URL");
}

export function formatServiceEnvCheck(result, format = "json") {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "env") return formatServiceEnvCheckEnv(result);
  return [
    ["ok", result.ok ? "true" : "false"],
    ["env_file", result.env_file],
    ["file_mode", result.file_mode.mode_octal],
    ["skipped_call", result.skipped_call ? "true" : "false"],
    ["smoke_sql", result.smoke_sql ? "true" : "false"],
    ["smoke_sdk", result.smoke_sdk ? "true" : "false"],
    ["smoke_archive_restore", result.smoke_archive_restore ? "true" : "false"],
    ["smoke_sdk_archive_restore", result.smoke_sdk_archive_restore ? "true" : "false"],
    ["smoke_shards", result.smoke_shards ? "true" : "false"],
    ["smoke_sdk_shards", result.smoke_sdk_shards ? "true" : "false"],
    ["canister_id", result.inspect.canister_id],
    ["database_id", result.inspect.database_id ?? ""],
    ["connection_url", result.inspect.connection_url ?? ""],
    ["principal", result.inspect.principal],
    ["caller_role", result.status?.caller_role ?? ""],
    ["network_url", result.inspect.network_url ?? ""],
    ["has_root_key", result.inspect.has_root_key ? "true" : "false"],
    ["setup_statement_count", String(result.inspect.setup_statement_count ?? 0)],
    ["setup_migration_count", String(result.inspect.setup_migration_count ?? 0)],
    ["status_table_count", result.status?.stats?.table_count === undefined ? "" : String(result.status.stats.table_count)],
    ["status_view_count", result.status?.stats?.view_count === undefined ? "" : String(result.status.stats.view_count)],
    ["status_row_count", result.status?.stats?.row_count === undefined ? "" : String(result.status.stats.row_count)],
    ["status_column_count", result.status?.stats?.column_count === undefined ? "" : String(result.status.stats.column_count)],
    ["status_index_count", result.status?.stats?.index_count === undefined ? "" : String(result.status.stats.index_count)],
    ["status_trigger_count", result.status?.stats?.trigger_count === undefined ? "" : String(result.status.stats.trigger_count)],
    ["status_foreign_key_count", result.status?.stats?.foreign_key_count === undefined ? "" : String(result.status.stats.foreign_key_count)],
    ["sql_smoke_table", result.sql_smoke?.table ?? ""],
    ["sql_smoke_row", result.sql_smoke?.selected_body ?? ""],
    ["sql_smoke_scalar_row", result.sql_smoke?.selected_scalar_body ?? ""],
    ["sdk_smoke_table", result.sdk_smoke?.table ?? ""],
    ["sdk_smoke_row", result.sdk_smoke?.selected_body ?? ""],
    ["sdk_smoke_scalar_row", result.sdk_smoke?.selected_scalar_body ?? ""],
    ["archive_restore_table", result.archive_restore_smoke?.table ?? ""],
    ["archive_restore_scratch_archive_database_id", result.archive_restore_smoke?.scratch_archive_database_id ?? ""],
    ["archive_restore_scratch_restore_database_id", result.archive_restore_smoke?.scratch_restore_database_id ?? ""],
    ["archive_restore_hash", result.archive_restore_smoke?.snapshot_hash ?? ""],
    ["archive_restore_size_bytes", result.archive_restore_smoke?.size_bytes ?? ""],
    ["archive_restore_row", result.archive_restore_smoke?.selected_body ?? ""],
    ["archive_restore_scalar_row", result.archive_restore_smoke?.selected_scalar_body ?? ""],
    ["sdk_archive_restore_table", result.sdk_archive_restore_smoke?.table ?? ""],
    ["sdk_archive_restore_scratch_archive_database_id", result.sdk_archive_restore_smoke?.scratch_archive_database_id ?? ""],
    ["sdk_archive_restore_scratch_restore_database_id", result.sdk_archive_restore_smoke?.scratch_restore_database_id ?? ""],
    ["sdk_archive_restore_hash", result.sdk_archive_restore_smoke?.snapshot_hash ?? ""],
    ["sdk_archive_restore_size_bytes", result.sdk_archive_restore_smoke?.size_bytes ?? ""],
    ["sdk_archive_restore_row", result.sdk_archive_restore_smoke?.selected_body ?? ""],
    ["sdk_archive_restore_scalar_row", result.sdk_archive_restore_smoke?.selected_scalar_body ?? ""],
    ["shard_canister_id", result.shard_smoke?.canister_id ?? ""],
    ["shard_status_canister_id", result.shard_smoke?.status_canister_id ?? ""],
    ["shard_status_cycles_balance", result.shard_smoke?.status_cycles_balance ?? ""],
    ["shard_count", result.shard_smoke?.shard_count === undefined ? "" : String(result.shard_smoke.shard_count)],
    ["shard_placement_count", result.shard_smoke?.placement_count === undefined ? "" : String(result.shard_smoke.placement_count)],
    ["shard_operation_count", result.shard_smoke?.operation_count === undefined ? "" : String(result.shard_smoke.operation_count)],
    ["shard_maintenance_available_slots", result.shard_smoke?.maintenance_available_slots ?? ""],
    ["shard_maintenance_actions", result.shard_smoke?.maintenance_action_count === undefined ? "" : String(result.shard_smoke.maintenance_action_count)],
    ["sdk_shard_canister_id", result.sdk_shard_smoke?.canister_id ?? ""],
    ["sdk_shard_status_canister_id", result.sdk_shard_smoke?.status_canister_id ?? ""],
    ["sdk_shard_status_cycles_balance", result.sdk_shard_smoke?.status_cycles_balance ?? ""],
    ["sdk_shard_count", result.sdk_shard_smoke?.shard_count === undefined ? "" : String(result.sdk_shard_smoke.shard_count)],
    ["sdk_shard_placement_count", result.sdk_shard_smoke?.placement_count === undefined ? "" : String(result.sdk_shard_smoke.placement_count)],
    ["sdk_shard_operation_count", result.sdk_shard_smoke?.operation_count === undefined ? "" : String(result.sdk_shard_smoke.operation_count)],
    ["sdk_shard_maintenance_available_slots", result.sdk_shard_smoke?.maintenance_available_slots ?? ""],
    ["sdk_shard_maintenance_actions", result.sdk_shard_smoke?.maintenance_action_count === undefined ? "" : String(result.sdk_shard_smoke.maintenance_action_count)],
    ["checks", result.checks.join(", ")]
  ].map(([key, value]) => `${key}\t${value}`).join("\n");
}

function formatServiceEnvCheckEnv(result) {
  const entries = {
    ICPDB_SERVICE_CHECK_OK: result.ok ? "true" : "false",
    ICPDB_SERVICE_CHECK_ENV_FILE: result.env_file,
    ICPDB_SERVICE_CHECK_FILE_MODE: result.file_mode.mode_octal,
    ICPDB_SERVICE_CHECK_CANISTER_ID: result.inspect.canister_id,
    ICPDB_SERVICE_CHECK_DATABASE_ID: result.inspect.database_id,
    ICPDB_SERVICE_CHECK_CONNECTION_URL: result.inspect.connection_url,
    ICPDB_SERVICE_CHECK_URL: result.inspect.connection_url,
    ICPDB_SERVICE_CHECK_NETWORK_URL: result.inspect.network_url,
    ICPDB_SERVICE_CHECK_HAS_ROOT_KEY: result.inspect.has_root_key === undefined ? undefined : result.inspect.has_root_key ? "true" : "false",
    ICPDB_SERVICE_CHECK_PRINCIPAL: result.inspect.principal,
    ICPDB_SERVICE_CHECK_CALLER_ROLE: result.status?.caller_role,
    ICPDB_SERVICE_CHECK_STATUS_TABLE_COUNT: result.status?.stats?.table_count === undefined ? undefined : String(result.status.stats.table_count),
    ICPDB_SERVICE_CHECK_STATUS_VIEW_COUNT: result.status?.stats?.view_count === undefined ? undefined : String(result.status.stats.view_count),
    ICPDB_SERVICE_CHECK_STATUS_ROW_COUNT: result.status?.stats?.row_count === undefined ? undefined : String(result.status.stats.row_count),
    ICPDB_SERVICE_CHECK_STATUS_COLUMN_COUNT: result.status?.stats?.column_count === undefined ? undefined : String(result.status.stats.column_count),
    ICPDB_SERVICE_CHECK_STATUS_INDEX_COUNT: result.status?.stats?.index_count === undefined ? undefined : String(result.status.stats.index_count),
    ICPDB_SERVICE_CHECK_STATUS_TRIGGER_COUNT: result.status?.stats?.trigger_count === undefined ? undefined : String(result.status.stats.trigger_count),
    ICPDB_SERVICE_CHECK_STATUS_FOREIGN_KEY_COUNT: result.status?.stats?.foreign_key_count === undefined ? undefined : String(result.status.stats.foreign_key_count),
    ICPDB_SERVICE_CHECK_SQL_TABLE: result.sql_smoke?.table,
    ICPDB_SERVICE_CHECK_SQL_ROW: result.sql_smoke?.selected_body,
    ICPDB_SERVICE_CHECK_SQL_SCALAR_ROW: result.sql_smoke?.selected_scalar_body,
    ICPDB_SERVICE_CHECK_SDK_TABLE: result.sdk_smoke?.table,
    ICPDB_SERVICE_CHECK_SDK_ROW: result.sdk_smoke?.selected_body,
    ICPDB_SERVICE_CHECK_SDK_SCALAR_ROW: result.sdk_smoke?.selected_scalar_body,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCRATCH_ARCHIVE_DATABASE_ID: result.archive_restore_smoke?.scratch_archive_database_id,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCRATCH_RESTORE_DATABASE_ID: result.archive_restore_smoke?.scratch_restore_database_id,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_HASH: result.archive_restore_smoke?.snapshot_hash,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SIZE_BYTES: result.archive_restore_smoke?.size_bytes,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_ROW: result.archive_restore_smoke?.selected_body,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCALAR_ROW: result.archive_restore_smoke?.selected_scalar_body,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCRATCH_ARCHIVE_DATABASE_ID: result.sdk_archive_restore_smoke?.scratch_archive_database_id,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCRATCH_RESTORE_DATABASE_ID: result.sdk_archive_restore_smoke?.scratch_restore_database_id,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_HASH: result.sdk_archive_restore_smoke?.snapshot_hash,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SIZE_BYTES: result.sdk_archive_restore_smoke?.size_bytes,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_ROW: result.sdk_archive_restore_smoke?.selected_body,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCALAR_ROW: result.sdk_archive_restore_smoke?.selected_scalar_body,
    ICPDB_SERVICE_CHECK_SHARD_CANISTER_ID: result.shard_smoke?.canister_id,
    ICPDB_SERVICE_CHECK_SHARD_STATUS_CANISTER_ID: result.shard_smoke?.status_canister_id,
    ICPDB_SERVICE_CHECK_SHARD_STATUS_CYCLES_BALANCE: result.shard_smoke?.status_cycles_balance,
    ICPDB_SERVICE_CHECK_SHARD_COUNT: result.shard_smoke?.shard_count === undefined ? undefined : String(result.shard_smoke.shard_count),
    ICPDB_SERVICE_CHECK_SHARD_PLACEMENT_COUNT: result.shard_smoke?.placement_count === undefined ? undefined : String(result.shard_smoke.placement_count),
    ICPDB_SERVICE_CHECK_SHARD_OPERATION_COUNT: result.shard_smoke?.operation_count === undefined ? undefined : String(result.shard_smoke.operation_count),
    ICPDB_SERVICE_CHECK_SHARD_MAINTENANCE_AVAILABLE_SLOTS: result.shard_smoke?.maintenance_available_slots,
    ICPDB_SERVICE_CHECK_SHARD_MAINTENANCE_ACTIONS: result.shard_smoke?.maintenance_action_count === undefined ? undefined : String(result.shard_smoke.maintenance_action_count),
    ICPDB_SERVICE_CHECK_SDK_SHARD_CANISTER_ID: result.sdk_shard_smoke?.canister_id,
    ICPDB_SERVICE_CHECK_SDK_SHARD_STATUS_CANISTER_ID: result.sdk_shard_smoke?.status_canister_id,
    ICPDB_SERVICE_CHECK_SDK_SHARD_STATUS_CYCLES_BALANCE: result.sdk_shard_smoke?.status_cycles_balance,
    ICPDB_SERVICE_CHECK_SDK_SHARD_COUNT: result.sdk_shard_smoke?.shard_count === undefined ? undefined : String(result.sdk_shard_smoke.shard_count),
    ICPDB_SERVICE_CHECK_SDK_SHARD_PLACEMENT_COUNT: result.sdk_shard_smoke?.placement_count === undefined ? undefined : String(result.sdk_shard_smoke.placement_count),
    ICPDB_SERVICE_CHECK_SDK_SHARD_OPERATION_COUNT: result.sdk_shard_smoke?.operation_count === undefined ? undefined : String(result.sdk_shard_smoke.operation_count),
    ICPDB_SERVICE_CHECK_SDK_SHARD_MAINTENANCE_AVAILABLE_SLOTS: result.sdk_shard_smoke?.maintenance_available_slots,
    ICPDB_SERVICE_CHECK_SDK_SHARD_MAINTENANCE_ACTIONS: result.sdk_shard_smoke?.maintenance_action_count === undefined ? undefined : String(result.sdk_shard_smoke.maintenance_action_count),
    ICPDB_SERVICE_CHECKS: result.checks.join(",")
  };
  return Object.entries(entries)
    .filter(([_key, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join("\n");
}

export async function checkServiceEnvFileMode(path) {
  const filePath = filePathArg(path, "service env file");
  const stats = await stat(filePath);
  const mode = stats.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`service env file must be owner-only (0600 or stricter): ${filePath} is ${modeToOctal(mode)}`);
  }
  return {
    mode_octal: modeToOctal(mode),
    owner_only: true
  };
}

async function smokeServiceSql(command, runIdentity) {
  const table = `icpdb_service_env_smoke_${Date.now().toString(36)}_${process.pid}`;
  const body = `service-env-smoke-${Date.now().toString(36)}`;
  let created = false;
  let verified = false;
  try {
    await runIdentity(command.envFile, ["sql", `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`]);
    created = true;
    await runIdentity(command.envFile, ["sql", `INSERT INTO ${table}(body) VALUES (?1)`, "--params", JSON.stringify([body])]);
    const selected = await runIdentity(command.envFile, ["query", `SELECT body FROM ${table} WHERE body = ?1`, "--params", JSON.stringify([body])]);
    const selectedBody = selected.rows?.[0]?.[0]?.text;
    if (selectedBody !== body) {
      throw new Error(`service env SQL smoke query mismatch: expected ${JSON.stringify(body)}, got ${JSON.stringify(selectedBody)}`);
    }
    const scalar = await runIdentity(command.envFile, ["scalar", `SELECT body FROM ${table} WHERE body = ?1`, "--params", JSON.stringify([body])]);
    const scalarBody = sqlScalarText(scalar);
    if (scalarBody !== body) {
      throw new Error(`service env SQL smoke scalar mismatch: expected ${JSON.stringify(body)}, got ${JSON.stringify(scalarBody)}`);
    }
    verified = true;
    return {
      table,
      inserted_body: body,
      selected_body: selectedBody,
      selected_scalar_body: scalarBody,
      cleanup: "dropped"
    };
  } finally {
    if (created) {
      const cleanup = runIdentity(command.envFile, ["sql", `DROP TABLE ${table}`]);
      if (verified) {
        await cleanup;
      } else {
        await cleanup.catch(() => null);
      }
    }
  }
}

function sqlScalarText(result) {
  const value = result?.value;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.Text === "string") return value.Text;
  }
  return undefined;
}

async function smokeServiceSdk(command, inspect) {
  const sdkPath = serviceSdkEntryUrl();
  const { connectClientFromEnvFile } = await import(sdkPath.href);
  const client = await connectClientFromEnvFile(command.envFile);
  const table = `icpdb_service_sdk_smoke_${Date.now().toString(36)}_${process.pid}`;
  const body = `service-sdk-smoke-${Date.now().toString(36)}`;
  let created = false;
  let verified = false;
  try {
    const status = await client.status();
    assertEqual(status.databaseId, inspect.database_id, "SDK status databaseId does not match inspect-env");
    assertEqual(status.connectionUrl, inspect.connection_url, "SDK status connectionUrl does not match inspect-env");
    await client.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`);
    created = true;
    await client.execute({ sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [body] });
    const rows = await client.queryRows({ sql: `SELECT body FROM ${table} WHERE body = ?1`, args: [body] });
    const selectedBody = rows[0]?.body;
    if (selectedBody !== body) {
      throw new Error(`service env SDK smoke query mismatch: expected ${JSON.stringify(body)}, got ${JSON.stringify(selectedBody)}`);
    }
    const scalarBody = await client.scalar({ sql: `SELECT body FROM ${table} WHERE body = ?1`, args: [body] });
    if (scalarBody !== body) {
      throw new Error(`service env SDK smoke scalar mismatch: expected ${JSON.stringify(body)}, got ${JSON.stringify(scalarBody)}`);
    }
    verified = true;
    return {
      table,
      inserted_body: body,
      selected_body: selectedBody,
      selected_scalar_body: scalarBody,
      connection_url: status.connectionUrl,
      cleanup: "dropped"
    };
  } finally {
    if (created) {
      const cleanup = client.execute(`DROP TABLE ${table}`);
      if (verified) {
        await cleanup;
      } else {
        await cleanup.catch(() => null);
      }
    }
    client.close();
  }
}

async function smokeServiceArchiveRestore(command, inspect, runIdentity) {
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-service-archive-"));
  const snapshotPath = join(tempDir, "snapshot.sqlite");
  const scratchEnvPath = join(tempDir, "scratch.env");
  const table = `icpdb_service_archive_smoke_${Date.now().toString(36)}_${process.pid}`;
  const body = `service-archive-smoke-${Date.now().toString(36)}`;
  let archiveDatabaseId = "";
  let restoreDatabaseId = "";
  try {
    // The configured DB is not archived or restored; it only proves owner role through status.
    await writeScratchServiceEnvFile(command.envFile, scratchEnvPath, inspect);
    const archiveDatabase = await runIdentity(scratchEnvPath, ["create-db"]);
    archiveDatabaseId = archiveDatabase.database_id;
    if (!archiveDatabaseId) throw new Error("service env archive/restore smoke failed to create archive scratch database");
    await runIdentity(scratchEnvPath, ["sql", archiveDatabaseId, `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`]);
    await runIdentity(scratchEnvPath, ["sql", archiveDatabaseId, `INSERT INTO ${table}(body) VALUES (?1)`, "--params", JSON.stringify([body])]);
    const archived = await runIdentity(scratchEnvPath, ["archive", archiveDatabaseId, snapshotPath]);
    const snapshotInfo = await runIdentity(command.envFile, ["snapshot-info", snapshotPath]);
    const snapshotSizeBytes = archiveRestoreSnapshotSizeBytes(archived, snapshotInfo);
    const snapshotHash = archiveRestoreSnapshotHash(archived, snapshotInfo);
    if (!snapshotHash) throw new Error("service env archive/restore smoke missing snapshot hash");
    const restoreDatabase = await runIdentity(scratchEnvPath, ["create-db"]);
    restoreDatabaseId = restoreDatabase.database_id;
    if (!restoreDatabaseId) throw new Error("service env archive/restore smoke failed to create restore scratch database");
    await runIdentity(scratchEnvPath, ["delete-db", restoreDatabaseId]);
    const restored = await runIdentity(scratchEnvPath, ["restore", restoreDatabaseId, snapshotPath, "--expect-snapshot-hash", snapshotHash]);
    archiveRestoreRestoredSnapshot(restored, restoreDatabaseId, snapshotHash, snapshotSizeBytes);
    const selected = await runIdentity(scratchEnvPath, ["query", restoreDatabaseId, `SELECT body FROM ${table} WHERE body = ?1`, "--params", JSON.stringify([body])]);
    const selectedBody = selected.rows?.[0]?.[0]?.text;
    if (selectedBody !== body) {
      throw new Error(`service env archive/restore smoke query mismatch: expected ${JSON.stringify(body)}, got ${JSON.stringify(selectedBody)}`);
    }
    const scalar = await runIdentity(scratchEnvPath, ["scalar", restoreDatabaseId, `SELECT body FROM ${table} WHERE body = ?1`, "--params", JSON.stringify([body])]);
    const scalarBody = sqlScalarText(scalar);
    if (scalarBody !== body) {
      throw new Error(`service env archive/restore smoke scalar mismatch: expected ${JSON.stringify(body)}, got ${JSON.stringify(scalarBody)}`);
    }
    await runIdentity(scratchEnvPath, ["delete-db", restoreDatabaseId]);
    restoreDatabaseId = "";
    await runIdentity(scratchEnvPath, ["delete-db", archiveDatabaseId]);
    archiveDatabaseId = "";
    return {
      table,
      scratch_archive_database_id: archiveDatabase.database_id,
      scratch_restore_database_id: restoreDatabase.database_id,
      file: snapshotPath,
      snapshot_hash: snapshotHash,
      size_bytes: snapshotSizeBytes,
      inserted_body: body,
      selected_body: selectedBody,
      selected_scalar_body: scalarBody,
      cleanup: "scratch archive database and scratch restore database deleted"
    };
  } finally {
    if (restoreDatabaseId) await runIdentity(scratchEnvPath, ["delete-db", restoreDatabaseId]).catch(() => null);
    if (archiveDatabaseId) await runIdentity(scratchEnvPath, ["delete-db", archiveDatabaseId]).catch(() => null);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function smokeServiceSdkArchiveRestore(command, inspect) {
  const sdkPath = serviceSdkEntryUrl();
  const {
    archiveDatabaseToFile,
    connectClientFromEnvFile,
    createDatabaseFromEnvFile,
    restoreDatabaseFromFile,
    snapshotInfoFile
  } = await import(sdkPath.href);
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-service-sdk-archive-"));
  const snapshotPath = join(tempDir, "sdk-snapshot.sqlite");
  const scratchEnvPath = join(tempDir, "scratch-sdk.env");
  const table = `icpdb_service_sdk_archive_smoke_${Date.now().toString(36)}_${process.pid}`;
  const body = `service-sdk-archive-smoke-${Date.now().toString(36)}`;
  const client = await connectClientFromEnvFile(command.envFile);
  let archiveDatabase = null;
  let restoreDatabase = null;
  try {
    // The configured DB is not archived or restored; it only proves owner role through SDK status.
    await writeScratchServiceEnvFile(command.envFile, scratchEnvPath, inspect);
    const status = await client.status();
    assertEqual(status.databaseId, inspect.database_id, "SDK archive smoke status databaseId does not match inspect-env");
    assertEqual(status.connectionUrl, inspect.connection_url, "SDK archive smoke status connectionUrl does not match inspect-env");
    archiveDatabase = await createDatabaseFromEnvFile(scratchEnvPath);
    await archiveDatabase.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`);
    await archiveDatabase.execute({ sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [body] });
    const archived = await archiveDatabaseToFile(archiveDatabase, snapshotPath);
    const snapshotInfo = await snapshotInfoFile(snapshotPath);
    const snapshotHash = sdkArchiveRestoreSnapshotHash(archived, snapshotInfo);
    const snapshotSizeBytes = sdkArchiveRestoreSnapshotSizeBytes(archived, snapshotInfo);
    if (!snapshotHash) throw new Error("service env SDK archive/restore smoke missing snapshot hash");
    restoreDatabase = await createDatabaseFromEnvFile(scratchEnvPath);
    const restoreDatabaseId = restoreDatabase.databaseId;
    await restoreDatabase.delete();
    await restoreDatabaseFromFile(restoreDatabase, snapshotPath, { expectedSha256: snapshotHash });
    const rows = await restoreDatabase.queryRows({ sql: `SELECT body FROM ${table} WHERE body = ?1`, args: [body] });
    const selectedBody = rows[0]?.body;
    if (selectedBody !== body) {
      throw new Error(`service env SDK archive/restore smoke query mismatch: expected ${JSON.stringify(body)}, got ${JSON.stringify(selectedBody)}`);
    }
    const scalarBody = await restoreDatabase.scalar({ sql: `SELECT body FROM ${table} WHERE body = ?1`, args: [body] });
    if (scalarBody !== body) {
      throw new Error(`service env SDK archive/restore smoke scalar mismatch: expected ${JSON.stringify(body)}, got ${JSON.stringify(scalarBody)}`);
    }
    await restoreDatabase.delete();
    restoreDatabase = null;
    const archiveDatabaseId = archiveDatabase.databaseId;
    await archiveDatabase.delete();
    archiveDatabase = null;
    return {
      table,
      scratch_archive_database_id: archiveDatabaseId,
      scratch_restore_database_id: restoreDatabaseId,
      file: snapshotPath,
      snapshot_hash: snapshotHash,
      size_bytes: snapshotSizeBytes,
      inserted_body: body,
      selected_body: selectedBody,
      selected_scalar_body: scalarBody,
      cleanup: "SDK scratch archive database and scratch restore database deleted"
    };
  } finally {
    if (restoreDatabase) await restoreDatabase.delete().catch(() => null);
    if (archiveDatabase) await archiveDatabase.delete().catch(() => null);
    client.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

function sdkArchiveRestoreSnapshotHash(archived, snapshotInfo) {
  const archivedHash = optionalSnapshotHash(archived?.sha256, "SDK archive sha256");
  const offlineHash = optionalSnapshotHash(snapshotInfo?.sha256, "SDK snapshot-info sha256");
  if (archivedHash && offlineHash && archivedHash !== offlineHash) {
    throw new Error(`service env SDK archive/restore smoke snapshot hash mismatch: archive returned ${JSON.stringify(archivedHash)}, snapshot-info returned ${JSON.stringify(offlineHash)}`);
  }
  return offlineHash || archivedHash;
}

function sdkArchiveRestoreSnapshotSizeBytes(archived, snapshotInfo) {
  const archivedSize = optionalSnapshotSizeBytes(archived?.sizeBytes === undefined ? undefined : String(archived.sizeBytes), "SDK archive sizeBytes");
  const offlineSize = optionalSnapshotSizeBytes(snapshotInfo?.sizeBytes === undefined ? undefined : String(snapshotInfo.sizeBytes), "SDK snapshot-info sizeBytes");
  if (archivedSize && offlineSize && archivedSize !== offlineSize) {
    throw new Error(`service env SDK archive/restore smoke snapshot size mismatch: archive returned ${JSON.stringify(archivedSize)}, snapshot-info returned ${JSON.stringify(offlineSize)}`);
  }
  return offlineSize || archivedSize;
}

function archiveRestoreSnapshotHash(archived, snapshotInfo) {
  const archivedHash = optionalSnapshotHash(archived?.snapshot_hash, "archive snapshot_hash");
  const offlineHash = optionalSnapshotHash(snapshotInfo?.snapshot_hash, "snapshot-info snapshot_hash");
  if (archivedHash && offlineHash && archivedHash !== offlineHash) {
    throw new Error(`service env archive/restore smoke snapshot hash mismatch: archive returned ${JSON.stringify(archivedHash)}, snapshot-info returned ${JSON.stringify(offlineHash)}`);
  }
  return offlineHash || archivedHash;
}

function archiveRestoreSnapshotSizeBytes(archived, snapshotInfo) {
  const archivedSize = optionalSnapshotSizeBytes(archived?.size_bytes, "archive size_bytes");
  const offlineSize = optionalSnapshotSizeBytes(snapshotInfo?.size_bytes, "snapshot-info size_bytes");
  if (archivedSize && offlineSize && archivedSize !== offlineSize) {
    throw new Error(`service env archive/restore smoke snapshot size mismatch: archive returned ${JSON.stringify(archivedSize)}, snapshot-info returned ${JSON.stringify(offlineSize)}`);
  }
  return offlineSize || archivedSize;
}

function archiveRestoreRestoredSnapshot(restored, scratchDatabaseId, snapshotHash, snapshotSizeBytes) {
  const restoredDatabaseId = optionalInspectString(restored?.database_id, "restore database_id");
  const restoredHash = optionalSnapshotHash(restored?.snapshot_hash, "restore snapshot_hash");
  const restoredSize = optionalSnapshotSizeBytes(restored?.size_bytes, "restore size_bytes");
  if (restoredDatabaseId && restoredDatabaseId !== scratchDatabaseId) {
    throw new Error(`service env archive/restore smoke restored database mismatch: expected ${JSON.stringify(scratchDatabaseId)}, got ${JSON.stringify(restoredDatabaseId)}`);
  }
  if (restoredHash && restoredHash !== snapshotHash) {
    throw new Error(`service env archive/restore smoke restored snapshot hash mismatch: expected ${JSON.stringify(snapshotHash)}, got ${JSON.stringify(restoredHash)}`);
  }
  if (restoredSize && snapshotSizeBytes && restoredSize !== snapshotSizeBytes) {
    throw new Error(`service env archive/restore smoke restored snapshot size mismatch: expected ${JSON.stringify(snapshotSizeBytes)}, got ${JSON.stringify(restoredSize)}`);
  }
}

function optionalSnapshotHash(value, label) {
  const text = optionalInspectString(value, label);
  if (!text) return "";
  const normalized = text.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character hex SHA-256 hash`);
  }
  return normalized;
}

function optionalSnapshotSizeBytes(value, label) {
  const text = optionalInspectString(value, label);
  if (!text) return "";
  const normalized = text.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return BigInt(normalized).toString();
}

async function smokeServiceShards(command, inspect, runIdentity) {
  const health = await runIdentity(command.envFile, "health");
  const placements = await runIdentity(command.envFile, "all-placements");
  const shards = await runIdentity(command.envFile, "shards");
  const operationsBefore = await runIdentity(command.envFile, "shard-ops");
  const maintenance = await runIdentity(command.envFile, ["shard-maintain", "0", "0", "0", "0", "0", "0"]);
  const operationsAfter = await runIdentity(command.envFile, "shard-ops");
  const healthCyclesBalance = requiredScalarString(health.cycles_balance, "shard smoke health cycles_balance");
  const healthCanisterId = optionalInspectString(health.canister_id, "shard smoke health canister_id");
  if (healthCanisterId && healthCanisterId !== inspect.canister_id) {
    throw new Error(`shard smoke health canister_id does not match inspect-env: expected ${JSON.stringify(inspect.canister_id)}, got ${JSON.stringify(healthCanisterId)}`);
  }
  const placementRows = requiredArray(placements, "shard smoke all-placements");
  const shardRows = requiredArray(shards, "shard smoke shards");
  assertShardInventoryMatchesPlacements(placementRows, shardRows);
  const statusShard = firstRemoteShard(shardRows);
  const shardStatus = statusShard ? await runIdentity(command.envFile, ["shard-status", statusShard.canister_id]) : null;
  if (shardStatus) assertShardStatusMatches(statusShard, shardStatus, "shard smoke");
  const operationRowsBefore = requiredArray(operationsBefore, "shard smoke shard-ops before");
  const operationRowsAfter = requiredArray(operationsAfter, "shard smoke shard-ops after");
  const maintenanceActions = requiredArray(maintenance.actions, "shard smoke maintenance actions");
  if (maintenanceActions.length !== 0) {
    throw new Error(`service env shard smoke expected zero maintenance actions, got ${maintenanceActions.length}`);
  }
  return {
    canister_id: inspect.canister_id,
    status_canister_id: shardStatus?.shard?.canister_id ?? "",
    status_cycles_balance: optionalScalarString(shardStatus?.cycles_balance, "shard smoke shard-status cycles_balance") || healthCyclesBalance,
    placement_count: placementRows.length,
    shard_count: shardRows.length,
    operation_count: operationRowsAfter.length || operationRowsBefore.length,
    maintenance_available_slots: maintenance.available_slots?.toString?.() ?? String(maintenance.available_slots ?? ""),
    maintenance_action_count: maintenanceActions.length
  };
}

async function smokeServiceSdkShards(command, inspect) {
  const sdkPath = serviceSdkEntryUrl();
  const { createIcpdbServiceClientFromEnvFile } = await import(sdkPath.href);
  const client = await createIcpdbServiceClientFromEnvFile(command.envFile);
  const health = await client.health();
  const placements = await client.listAllPlacements();
  const shards = await client.listShards();
  const operationsBefore = await client.listShardOperations();
  const maintenance = await client.maintainShards({
    minAvailableSlots: 0,
    minCyclesBalance: 0,
    topUpCycles: 0,
    maxNewShards: 0,
    newShardMaxDatabases: 0,
    newShardInitialCycles: 0
  });
  const operationsAfter = await client.listShardOperations();
  const healthCyclesBalance = requiredScalarString(health.cyclesBalance, "SDK shard smoke health cyclesBalance");
  const healthCanisterId = optionalInspectString(health.canisterId, "SDK shard smoke health canisterId");
  if (healthCanisterId && healthCanisterId !== inspect.canister_id) {
    throw new Error(`SDK shard smoke health canisterId does not match inspect-env: expected ${JSON.stringify(inspect.canister_id)}, got ${JSON.stringify(healthCanisterId)}`);
  }
  const placementRows = requiredArray(placements, "SDK shard smoke all placements").map((placement) => ({
    shard_id: placement.shardId,
    canister_id: placement.canisterId ?? ""
  }));
  const shardRows = requiredArray(shards, "SDK shard smoke shards").map((shard) => ({
    shard_id: shard.shardId,
    canister_id: shard.canisterId
  }));
  assertShardInventoryMatchesPlacements(placementRows, shardRows);
  const statusShard = firstRemoteShard(shardRows);
  const shardStatus = statusShard ? await client.getShardStatus(statusShard.canister_id) : null;
  if (shardStatus) {
    assertShardStatusMatches(statusShard, {
      shard: {
        shard_id: shardStatus.shard.shardId,
        canister_id: shardStatus.shard.canisterId
      },
      cycles_balance: shardStatus.cyclesBalance
    }, "SDK shard smoke");
  }
  const operationRowsBefore = requiredArray(operationsBefore, "SDK shard smoke shard operations before");
  const operationRowsAfter = requiredArray(operationsAfter, "SDK shard smoke shard operations after");
  const maintenanceActions = requiredArray(maintenance.actions, "SDK shard smoke maintenance actions");
  if (maintenanceActions.length !== 0) {
    throw new Error(`service env SDK shard smoke expected zero maintenance actions, got ${maintenanceActions.length}`);
  }
  return {
    canister_id: inspect.canister_id,
    status_canister_id: shardStatus?.shard?.canisterId ?? "",
    status_cycles_balance: optionalScalarString(shardStatus?.cyclesBalance, "SDK shard smoke shard-status cyclesBalance") || healthCyclesBalance,
    placement_count: placementRows.length,
    shard_count: shardRows.length,
    operation_count: operationRowsAfter.length || operationRowsBefore.length,
    maintenance_available_slots: maintenance.availableSlots?.toString?.() ?? String(maintenance.availableSlots ?? ""),
    maintenance_action_count: maintenanceActions.length
  };
}

function serviceSdkEntryUrl() {
  return new URL("../icpdb-console/dist-sdk/icpdb-server.js", import.meta.url);
}

function assertShardInventoryMatchesPlacements(placements, shards) {
  const shardIds = new Map();
  for (const shard of shards) {
    if (typeof shard !== "object" || shard === null) throw new Error("shard smoke shard row must be an object");
    const shardId = requiredNonEmptyString(shard.shard_id, "shard smoke shard_id");
    const canisterId = requiredNonEmptyString(shard.canister_id, "shard smoke shard canister_id");
    shardIds.set(shardId, canisterId);
  }
  for (const placement of placements) {
    if (typeof placement !== "object" || placement === null) throw new Error("shard smoke placement row must be an object");
    const shardId = optionalInspectString(placement.shard_id, "shard smoke placement shard_id");
    if (!shardId || shardId === "local") continue;
    if (!shardId.startsWith("database:")) {
      throw new Error(`shard smoke placement has unsupported shard_id: ${JSON.stringify(shardId)}`);
    }
    const canisterId = optionalInspectString(placement.canister_id, "shard smoke placement canister_id");
    const registeredCanisterId = shardIds.get(shardId);
    if (!registeredCanisterId) {
      throw new Error(`shard smoke placement references unregistered shard: ${shardId}`);
    }
    if (canisterId && canisterId !== registeredCanisterId) {
      throw new Error(`shard smoke placement canister_id does not match registered shard ${shardId}: expected ${JSON.stringify(registeredCanisterId)}, got ${JSON.stringify(canisterId)}`);
    }
  }
}

function firstRemoteShard(shards) {
  return shards.find((shard) => {
    const shardId = optionalInspectString(shard?.shard_id, "shard smoke shard_id");
    return shardId.startsWith("database:");
  }) ?? null;
}

function assertShardStatusMatches(expectedShard, status, label) {
  if (typeof status !== "object" || status === null) throw new Error(`${label} shard-status output must be an object`);
  const statusShard = status.shard;
  if (typeof statusShard !== "object" || statusShard === null) throw new Error(`${label} shard-status shard must be an object`);
  const expectedCanisterId = requiredNonEmptyString(expectedShard.canister_id, `${label} expected shard canister_id`);
  const statusCanisterId = requiredNonEmptyString(statusShard.canister_id, `${label} shard-status canister_id`);
  if (statusCanisterId !== expectedCanisterId) {
    throw new Error(`${label} shard-status canister_id does not match shard list: expected ${JSON.stringify(expectedCanisterId)}, got ${JSON.stringify(statusCanisterId)}`);
  }
  const expectedShardId = requiredNonEmptyString(expectedShard.shard_id, `${label} expected shard_id`);
  const statusShardId = requiredNonEmptyString(statusShard.shard_id, `${label} shard-status shard_id`);
  if (statusShardId !== expectedShardId) {
    throw new Error(`${label} shard-status shard_id does not match shard list: expected ${JSON.stringify(expectedShardId)}, got ${JSON.stringify(statusShardId)}`);
  }
  optionalSnapshotSizeBytes(status.cycles_balance, `${label} shard-status cycles_balance`);
}

function validateInspectEnv(inspect) {
  if (typeof inspect !== "object" || inspect === null) throw new Error("inspect-env output must be an object");
  requiredNonEmptyString(inspect.canister_id, "inspect-env canister_id");
  requiredNonEmptyString(inspect.principal, "inspect-env principal");
  const databaseId = optionalInspectString(inspect.database_id, "inspect-env database_id");
  const connectionUrl = optionalInspectString(inspect.connection_url, "inspect-env connection_url");
  if (databaseId && !connectionUrl) throw new Error("inspect-env connection_url is required when database_id is present");
  if (databaseId && inspectHasSetupEnv(inspect)) {
    throw new Error("service env is DB-bearing but contains ICPDB_SETUP_* create-time setup; use script, batch, or migrate for existing database setup");
  }
}

function inspectHasSetupEnv(inspect) {
  return Boolean(inspect.has_setup_sql)
    || optionalInspectCount(inspect.setup_statement_count, "inspect-env setup_statement_count") > 0
    || optionalInspectCount(inspect.setup_migration_count, "inspect-env setup_migration_count") > 0;
}

function optionalInspectCount(value, label) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function optionalInspectString(value, label) {
  if (value === undefined || value === null) return "";
  return requiredNonEmptyString(value, label);
}

function optionalScalarString(value, label) {
  if (value === undefined || value === null) return "";
  return requiredScalarString(value, label);
}

function requiredScalarString(value, label) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return requiredNonEmptyString(value, label);
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function filePathArg(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} path must be a non-empty string`);
  return value;
}

function requiredArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

async function writeScratchServiceEnvFile(sourcePath, scratchPath, inspect) {
  const env = parseEnvFile(await readFile(sourcePath, "utf8"), sourcePath);
  const scratchEnv = {
    ICPDB_CANISTER_ID: inspect.canister_id,
    ...(inspect.network_url ? { ICPDB_NETWORK_URL: inspect.network_url } : {}),
    ...pickExistingEnv(env, [
      "ICPDB_ROOT_KEY",
      "ICPDB_IDENTITY_TYPE",
      "ICPDB_IDENTITY_PRINCIPAL",
      "ICPDB_IDENTITY_JSON",
      "ICPDB_IDENTITY_JSON_FILE",
      "ICPDB_IDENTITY_PEM",
      "ICPDB_IDENTITY_PEM_FILE"
    ])
  };
  await writeFile(scratchPath, formatEnvFile(scratchEnv), { encoding: "utf8", mode: 0o600 });
  await chmod(scratchPath, 0o600);
}

function pickExistingEnv(env, keys) {
  const picked = {};
  for (const key of keys) {
    if (env[key]) picked[key] = env[key];
  }
  return picked;
}

function formatEnvFile(env) {
  return `${Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`;
}

function parseEnvFile(source, path) {
  const parsed = {};
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) throw new Error(`${path}:${index + 1}: invalid env line`);
    const key = match[1];
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate env key ${key} at ${path}:${index + 1}`);
    parsed[key] = parseEnvValue(match[2].trim(), path, index + 1);
  }
  return parsed;
}

function parseEnvValue(source, path, lineNumber) {
  if (source.startsWith("\"")) {
    try {
      const parsed = JSON.parse(source);
      if (typeof parsed !== "string") throw new Error("env value must be a string");
      return parsed;
    } catch (error) {
      throw new Error(`${path}:${lineNumber}: invalid quoted env value: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (source.startsWith("'")) {
    if (!source.endsWith("'")) throw new Error(`${path}:${lineNumber}: invalid single-quoted env value`);
    return source.slice(1, -1);
  }
  return source;
}

async function runIdentityCliJson(envFile, commandArgs) {
  const args = Array.isArray(commandArgs) ? commandArgs : [commandArgs];
  const { stdout } = await execFileAsync(process.execPath, [
    identityCliPath,
    "--env-file",
    envFile,
    ...args,
    "--format",
    "json"
  ], { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function modeToOctal(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function requiredServiceRole(command) {
  const smokeRole = command.smokeArchiveRestore || command.smokeSdkArchiveRestore ? "owner" : command.smokeSql || command.smokeSdk ? "writer" : "";
  return strongestRole(command.requireRole, smokeRole);
}

function strongestRole(first, second) {
  if (!first) return second;
  if (!second) return first;
  return roleRank(first) >= roleRank(second) ? first : second;
}

function assertRoleAtLeast(actual, required) {
  const role = parseDatabaseRole(actual);
  if (roleRank(role) < roleRank(required)) {
    throw new Error(`service identity role ${role} is below required role ${required}`);
  }
}

function parseDatabaseRole(value) {
  if (value === "reader" || value === "writer" || value === "owner") return value;
  throw new Error("role must be reader, writer, or owner");
}

function roleRank(role) {
  if (role === "reader") return 1;
  if (role === "writer") return 2;
  if (role === "owner") return 3;
  throw new Error(`unknown role: ${role}`);
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseOutputFormat(value) {
  if (value === "json" || value === "table" || value === "env") return value;
  throw new Error("format must be json, table, or env");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = parseServiceEnvCheckArgs(process.argv.slice(2));
  if (command.help) {
    console.log(usage());
  } else {
    checkServiceEnv(command)
      .then((result) => console.log(formatServiceEnvCheck(result, command.outputFormat)))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
  }
}
