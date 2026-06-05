// Where: scripts/icpdb-http-canister.mjs
// What: Candid-backed controller canister helpers for the ICPDB HTTP CLI.
// Why: Database creation and shard administration are IC control-plane workflows, not HTTP SQL execution.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sqlParams } from "./icpdb-http-command-utils.mjs";
import { migrateIcpdb, readSqlDumpSource, sqlScriptStatements } from "./icpdb-http-dump.mjs";

const execFileAsync = promisify(execFile);

export async function createIcpdbDatabase(command, execImpl = execFileAsync, fetchImpl = fetch, input = process.stdin) {
  const databaseOutput = await callIcpdbCanister(command, "create_database", "()", execImpl);
  const databaseId = parseCandidOkText(databaseOutput, "create_database");
  try {
    const tokenOutput = await callIcpdbCanister(
      command,
      "create_database_token",
      `(record { database_id = ${candidText(databaseId)}; name = ${candidText(command.tokenName)}; scope = variant { Owner } })`,
      execImpl
    );
    const ownerToken = parseCandidDatabaseToken(tokenOutput);
    const setup = await setupCreatedDatabase(command, databaseId, ownerToken.token, fetchImpl, input);
    return {
      database_id: databaseId,
      owner_token: ownerToken,
      ...setup
    };
  } catch (error) {
    await deleteCreatedDatabaseAfterCreateFailure(command, databaseId, execImpl);
    throw error;
  }
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

export async function migrateDatabaseToShard(command, execImpl = execFileAsync) {
  const output = await callIcpdbCanister(
    command,
    "migrate_database_to_shard",
    remoteDatabaseCandidArgs(command),
    execImpl
  );
  return parseCandidOkRaw(output, "migrate_database_to_shard");
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

async function deleteCreatedDatabaseAfterCreateFailure(command, databaseId, execImpl) {
  try {
    const output = await callIcpdbCanister(command, "delete_database", `(${candidText(databaseId)})`, execImpl);
    parseCandidOkRaw(output, "delete_database");
  } catch (_deleteError) {
    // Preserve the create/token/setup failure; delete is best-effort cleanup.
  }
}

function shardReconcileCandidArgs(command) {
  const status = command.status === "applied" ? "Applied" : "Failed";
  const error = command.error === null ? "null" : `opt ${candidText(command.error)}`;
  return `(record { operation_id = ${candidText(command.operationId)}; status = variant { ${status} }; error = ${error} })`;
}

function routedOperationCandidArgs(command) {
  return `(record { database_id = ${candidText(command.databaseId)}; operation_id = ${candidText(command.operationId)} })`;
}

function remoteDatabaseCandidArgs(command) {
  return `(record { database_id = ${candidText(command.databaseId)}; database_canister_id = ${candidText(command.databaseCanisterId)} })`;
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

async function setupCreatedDatabase(command, databaseId, token, fetchImpl, input) {
  const baseUrl = (command.baseUrl ?? "").trim();
  if (command.setupMigrationsFilePath) return setupCreatedDatabaseMigrations(command, databaseId, token, baseUrl, fetchImpl, input);
  const statements = await createdDatabaseSetupStatements(command, input);
  if (statements.length === 0) return {};
  if (!baseUrl) throw new Error("create-db setup requires --base-url or ICPDB_HTTP_BASE_URL");
  let rowsAffected = 0;
  const results = [];
  for (let offset = 0; offset < statements.length; offset += 32) {
    const batch = statements.slice(offset, offset + 32);
    const response = await callSetupBatch({
      baseUrl,
      token,
      databaseId,
      statements: batch,
      maxRows: command.maxRows ?? 100,
      idempotencyKey: setupBatchIdempotencyKey(command, offset)
    }, fetchImpl);
    for (const item of response) {
      rowsAffected += Number(item.rows_affected ?? 0);
      results.push(item);
    }
  }
  return {
    setup_statement_count: statements.length,
    setup_batch_count: Math.ceil(statements.length / 32),
    setup_rows_affected: String(rowsAffected),
    setup_results: results
  };
}

async function setupCreatedDatabaseMigrations(command, databaseId, token, baseUrl, fetchImpl, input) {
  if (setupStatementSourceCount(command) > 0) throw new Error("use only one of --statement, --statements-file, --setup-file, or --setup-migrations-file");
  if (!baseUrl) throw new Error("create-db setup requires --base-url or ICPDB_HTTP_BASE_URL");
  const result = await migrateIcpdb({
    baseUrl,
    token,
    databaseId,
    filePath: command.setupMigrationsFilePath,
    maxRows: command.maxRows ?? 100,
    ...(command.idempotencyKey ? { idempotencyKey: `${command.idempotencyKey}-setup-migrate` } : {})
  }, fetchImpl, callSetupHttp, input);
  return {
    setup_migration_count: result.migration_count,
    setup_migration_applied: result.applied,
    setup_migration_skipped: result.skipped,
    setup_statement_count: result.statement_count,
    setup_batch_count: result.batch_count,
    setup_rows_affected: result.rows_affected
  };
}

async function createdDatabaseSetupStatements(command, input) {
  const statements = Array.isArray(command.statements) ? command.statements : [];
  if (!command.setupFilePath) return statements;
  if (statements.length > 0) throw new Error("use only one of --statement, --statements-file, or --setup-file");
  const source = await readSqlDumpSource(command.setupFilePath, input);
  const setupStatements = sqlScriptStatements(source, false);
  if (setupStatements.length === 0) throw new Error("setup file has no executable statements");
  return setupStatements;
}

function setupStatementSourceCount(command) {
  return ((Array.isArray(command.statements) && command.statements.length > 0) || command.statementsFilePath ? 1 : 0) + (command.setupFilePath ? 1 : 0);
}

async function callSetupBatch(command, fetchImpl) {
  const value = await callSetupHttp({
    baseUrl: command.baseUrl,
    token: command.token,
    ...(command.idempotencyKey ? { idempotencyKey: command.idempotencyKey } : {}),
    endpoint: "/v1/sql/batch",
    body: {
      database_id: command.databaseId,
      statements: command.statements.map((statement) => ({
        ...statement,
        params: sqlParams(statement.sql, statement.params ?? [])
      })),
      max_rows: command.maxRows
    }
  }, fetchImpl);
  if (!Array.isArray(value)) throw new Error("setup batch did not return SQL batch results");
  return value;
}

async function callSetupHttp(command, fetchImpl) {
  const headers = {
    authorization: `Bearer ${command.token}`,
    "content-type": "application/json"
  };
  if (command.idempotencyKey) headers["idempotency-key"] = command.idempotencyKey;
  const response = await fetchImpl(`${trimTrailingSlash(command.baseUrl)}${command.endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(command.body)
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = value && typeof value === "object" && !Array.isArray(value) && typeof value.error === "string"
      ? value.error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return value;
}

function setupBatchIdempotencyKey(command, offset) {
  if (!command.idempotencyKey) return "";
  return `${command.idempotencyKey}-setup-${offset / 32}`;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
