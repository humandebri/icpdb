// Where: scripts/icpdb-http-canister-command.mjs
// What: Controller/canister command builders for the ICPDB HTTP CLI.
// Why: Sharding and deployment command parsing should stay apart from SQL/table HTTP command parsing.

import {
  outputFormatOption,
  parseNonNegativeNatText,
  parseShardReconcileStatus,
  requiredArg,
  requiredConfig
} from "./icpdb-http-command-utils.mjs";

export const CANISTER_COMMANDS = new Set([
  "create-db",
  "databases",
  "placements",
  "shards",
  "shard-status",
  "shard-top-up",
  "shard-maintain",
  "shard-ops",
  "shard-reconcile",
  "operation-reconcile"
]);

export function buildCanisterCommand(command, databaseId, tableNameOrSql, rest, options) {
  const base = canisterBase(options);
  if (command === "create-db") {
    return { createDatabase: true, ...base, tokenName: requiredArg(databaseId ?? options.tokenName, "token_name") };
  }
  if (command === "databases") return { databases: true, ...base };
  if (command === "placements") return { databasePlacements: true, ...base };
  if (command === "shards") return { databaseShards: true, ...base };
  if (command === "shard-status") {
    return { databaseShardStatus: true, ...base, databaseCanisterId: requiredArg(databaseId, "database_canister_id") };
  }
  if (command === "shard-top-up") {
    return {
      topUpDatabaseShard: true,
      ...base,
      databaseCanisterId: requiredArg(databaseId, "database_canister_id"),
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
      maxNewShards: parseNonNegativeNatText(requiredArg(rest[1], "max_new_shards"), "max_new_shards"),
      newShardMaxDatabases: parseNonNegativeNatText(requiredArg(rest[2], "new_shard_max_databases"), "new_shard_max_databases"),
      newShardInitialCycles: parseNonNegativeNatText(requiredArg(rest[3], "new_shard_initial_cycles"), "new_shard_initial_cycles")
    };
  }
  if (command === "shard-ops") return { shardOperations: true, ...base };
  if (command === "shard-reconcile") {
    const status = parseShardReconcileStatus(requiredArg(databaseId, "applied_or_failed"));
    const error = status === "failed" ? requiredArg(rest.join(" ") || undefined, "failure_reason") : null;
    return {
      reconcileShardOperation: true,
      ...base,
      operationId: requiredArg(tableNameOrSql, "operation_id"),
      status,
      error
    };
  }
  if (command === "operation-reconcile") {
    return {
      reconcileRoutedOperation: true,
      ...base,
      databaseId: requiredArg(databaseId, "database_id"),
      operationId: requiredArg(tableNameOrSql, "operation_id")
    };
  }
  return null;
}

function canisterBase(options) {
  return {
    canisterId: requiredConfig(options.canisterId, "canister ID", "ICPDB_CANISTER_ID"),
    networkUrl: requiredConfig(options.networkUrl, "network URL", "ICPDB_NETWORK_URL"),
    rootKey: options.rootKey.trim(),
    ...outputFormatOption(options)
  };
}
