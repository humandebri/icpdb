// Where: scripts/icpdb-http-canister-command.mjs
// What: Controller/canister command builders for the ICPDB HTTP CLI.
// Why: Sharding and deployment command parsing should stay apart from SQL/table HTTP command parsing.

import {
  databaseCanisterIdArg,
  databaseIdArg,
  operationIdArg,
  outputFormatOption,
  parseNonNegativeNatText,
  parseNat16Text,
  parseShardReconcileStatus,
  requiredArg,
  requiredConfig,
  tokenNameArg
} from "./icpdb-http-command-utils.mjs";

export const CANISTER_COMMANDS = new Set([
  "create-db",
  "databases",
  "placements",
  "shards",
  "shard-status",
  "shard-top-up",
  "shard-maintain",
  "shard-migrate",
  "shard-ops",
  "shard-reconcile",
  "operation-reconcile"
]);

export function buildCanisterCommand(command, databaseId, tableNameOrSql, rest, options) {
  if (options.outputFormat === "env" && command !== "create-db") {
    throw new Error("--format env is only valid for create-db");
  }
  const base = canisterBase(options);
  if (command === "create-db") {
    assertCreateDatabaseHasNoDatabaseId(options);
    return {
      createDatabase: true,
      ...base,
      tokenName: tokenNameArg(databaseId ?? options.tokenName),
      ...envOutOption(options),
      ...createDatabaseSetupOptions(options)
    };
  }
  if (command === "databases") return { databases: true, ...base };
  if (command === "placements") return { databasePlacements: true, ...base };
  if (command === "shards") return { databaseShards: true, ...base };
  if (command === "shard-status") {
    return { databaseShardStatus: true, ...base, databaseCanisterId: databaseCanisterIdArg(databaseId) };
  }
  if (command === "shard-top-up") {
    return {
      topUpDatabaseShard: true,
      ...base,
      databaseCanisterId: databaseCanisterIdArg(databaseId),
      cycles: parseNonNegativeNatText(requiredArg(tableNameOrSql, "cycles"), "cycles")
    };
  }
  if (command === "shard-maintain") {
    return {
      maintainDatabaseShards: true,
      ...base,
      minAvailableSlots: parseNonNegativeNatText(requiredArg(databaseId, "min_available_slots"), "min_available_slots"),
      minCyclesBalance: parseNonNegativeNatText(requiredArg(tableNameOrSql, "min_cycles_balance"), "min_cycles_balance"),
      topUpCycles: parseNonNegativeNatText(requiredArg(rest[0], "top_up_cycles"), "top_up_cycles"),
      maxNewShards: parseNat16Text(requiredArg(rest[1], "max_new_shards"), "max_new_shards"),
      newShardMaxDatabases: parseNat16Text(requiredArg(rest[2], "new_shard_max_databases"), "new_shard_max_databases"),
      newShardInitialCycles: parseNonNegativeNatText(requiredArg(rest[3], "new_shard_initial_cycles"), "new_shard_initial_cycles")
    };
  }
  if (command === "shard-migrate") {
    return {
      migrateDatabaseToShard: true,
      ...base,
      databaseId: databaseIdArg(databaseId),
      databaseCanisterId: databaseCanisterIdArg(tableNameOrSql)
    };
  }
  if (command === "shard-ops") return { shardOperations: true, ...base };
  if (command === "shard-reconcile") {
    const status = parseShardReconcileStatus(requiredArg(databaseId, "applied_or_failed"));
    const failureReason = rest.join(" ");
    if (status === "applied" && failureReason) {
      throw new Error("failure_reason is only valid when shard-reconcile status is failed");
    }
    const error = status === "failed" ? requiredArg(failureReason || undefined, "failure_reason") : null;
    return {
      reconcileShardOperation: true,
      ...base,
      operationId: operationIdArg(tableNameOrSql),
      status,
      error
    };
  }
  if (command === "operation-reconcile") {
    return {
      reconcileRoutedOperation: true,
      ...base,
      databaseId: databaseIdArg(databaseId),
      operationId: operationIdArg(tableNameOrSql)
    };
  }
  return null;
}

function assertCreateDatabaseHasNoDatabaseId(options) {
  if (!options.databaseId) return;
  throw new Error("create-db creates a new database; omit database id from --database-id, ICPDB_DATABASE_ID, and ICPDB_URL");
}

function canisterBase(options) {
  const base = {
    canisterId: requiredConfig(options.canisterId, "canister ID", "ICPDB_CANISTER_ID"),
    networkUrl: requiredConfig(options.networkUrl, "network URL", "ICPDB_NETWORK_URL"),
    rootKey: options.rootKey.trim(),
    ...outputFormatOption(options)
  };
  if ((options.outputFormat === "env" || options.statements.length > 0 || options.statementsFilePath || options.setupFilePath || options.setupMigrationsFilePath) && options.baseUrl.trim()) {
    base.baseUrl = options.baseUrl.trim();
  }
  return base;
}

function createDatabaseSetupOptions(options) {
  const setup = {};
  if (options.statements.length > 0) setup.statements = options.statements;
  if (options.statementsFilePath) setup.statementsFilePath = options.statementsFilePath;
  if (options.setupFilePath) setup.setupFilePath = options.setupFilePath;
  if (options.setupMigrationsFilePath) setup.setupMigrationsFilePath = options.setupMigrationsFilePath;
  if (setup.statements || setup.setupFilePath || setup.setupMigrationsFilePath) {
    setup.maxRows = options.maxRows;
    if (options.idempotencyKey) setup.idempotencyKey = options.idempotencyKey;
  }
  return setup;
}

function envOutOption(options) {
  return options.envOutFile ? { envOutFile: options.envOutFile } : {};
}
