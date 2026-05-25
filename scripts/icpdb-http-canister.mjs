// Where: scripts/icpdb-http-canister.mjs
// What: Candid-backed controller canister helpers for the ICPDB HTTP CLI.
// Why: Database creation and shard administration are IC control-plane workflows, not HTTP SQL execution.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createIcpdbDatabase(command, execImpl = execFileAsync) {
  const databaseOutput = await callIcpdbCanister(command, "create_database", "()", execImpl);
  const databaseId = parseCandidOkText(databaseOutput, "create_database");
  const tokenOutput = await callIcpdbCanister(
    command,
    "create_database_token",
    `(record { database_id = ${candidText(databaseId)}; name = ${candidText(command.tokenName)}; scope = variant { Owner } })`,
    execImpl
  );
  return {
    database_id: databaseId,
    owner_token: parseCandidDatabaseToken(tokenOutput)
  };
}

export async function listDatabases(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(command, "list_databases", "()", execImpl);
  return parseCandidOkRaw(output, "list_databases");
}

export async function listDatabasePlacements(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(command, "list_all_database_placements", "()", execImpl);
  return parseCandidOkRaw(output, "list_all_database_placements");
}

export async function listDatabaseShards(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(command, "list_database_shards", "()", execImpl);
  return parseCandidOkRaw(output, "list_database_shards");
}

export async function getDatabaseShardStatus(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(
    command,
    "get_database_shard_status",
    databaseShardStatusCandidArgs(command),
    execImpl
  );
  return parseCandidOkRaw(output, "get_database_shard_status");
}

export async function topUpDatabaseShard(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(
    command,
    "top_up_database_shard",
    topUpDatabaseShardCandidArgs(command),
    execImpl
  );
  return parseCandidOkRaw(output, "top_up_database_shard");
}

export async function maintainDatabaseShards(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(
    command,
    "maintain_database_shards",
    maintainDatabaseShardsCandidArgs(command),
    execImpl
  );
  return parseCandidOkRaw(output, "maintain_database_shards");
}

export async function listShardOperations(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(command, "list_shard_operations", "()", execImpl);
  return parseCandidOkRaw(output, "list_shard_operations");
}

export async function reconcileShardOperation(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(
    command,
    "reconcile_shard_operation",
    shardReconcileCandidArgs(command),
    execImpl
  );
  return parseCandidOkRaw(output, "reconcile_shard_operation");
}

export async function reconcileRoutedOperation(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(
    command,
    "reconcile_routed_operation",
    routedOperationCandidArgs(command),
    execImpl
  );
  return parseCandidOkRaw(output, "reconcile_routed_operation");
}

async function callIcpdbCanister(command, method, candidArgs, execImpl) {
  const args = ["canister", "call", "-n", command.networkUrl];
  if (command.rootKey) args.push("-k", command.rootKey);
  args.push(command.canisterId, method, candidArgs, "-o", "candid");
  const { stdout } = await execImpl("icp", args);
  return stdout.trim();
}

function shardReconcileCandidArgs(command) {
  const status = command.status === "applied" ? "Applied" : "Failed";
  const error = command.error === null ? "null" : `opt ${candidText(command.error)}`;
  return `(record { operation_id = ${candidText(command.operationId)}; status = variant { ${status} }; error = ${error} })`;
}

function routedOperationCandidArgs(command) {
  return `(record { database_id = ${candidText(command.databaseId)}; operation_id = ${candidText(command.operationId)} })`;
}

function databaseShardStatusCandidArgs(command) {
  return `(record { database_canister_id = ${candidText(command.databaseCanisterId)} })`;
}

function topUpDatabaseShardCandidArgs(command) {
  return `(record { database_canister_id = ${candidText(command.databaseCanisterId)}; cycles = ${command.cycles} : nat })`;
}

function maintainDatabaseShardsCandidArgs(command) {
  return [
    "(record {",
    ` min_available_slots = ${command.minAvailableSlots} : nat64;`,
    ` min_cycles_balance = ${command.minCyclesBalance} : nat;`,
    ` top_up_cycles = ${command.topUpCycles} : nat;`,
    ` max_new_shards = ${command.maxNewShards} : nat16;`,
    ` new_shard_max_databases = ${command.newShardMaxDatabases} : nat16;`,
    ` new_shard_initial_cycles = ${command.newShardInitialCycles} : nat`,
    "})"
  ].join("");
}

function candidText(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseCandidOkRaw(output, label) {
  const error = output.match(/Err\s*=\s*"([^"]+)"/)?.[1];
  if (error) throw new Error(error);
  if (!/Ok\s*=/.test(output)) throw new Error(`${label} did not return Ok: ${output}`);
  return { candid: output };
}

function parseCandidOkText(output, label) {
  const value = output.match(/Ok\s*=\s*"([^"]+)"/)?.[1];
  if (!value) throw new Error(`${label} did not return Ok text: ${output}`);
  return value;
}

function parseCandidDatabaseToken(output) {
  const token = output.match(/token\s*=\s*"([^"]+)"/)?.[1];
  const tokenId = output.match(/token_id\s*=\s*"([^"]+)"/)?.[1];
  if (!token || !tokenId) {
    throw new Error(`create_database_token did not return owner token: ${output}`);
  }
  return {
    token_id: tokenId,
    token
  };
}
