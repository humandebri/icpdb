#!/usr/bin/env node
// Where: scripts/icpdb-http.mjs
// What: Small bearer-token HTTP CLI for ICPDB SQL and table inspection endpoints.
// Why: Turso-like workflows need a scriptable shell/inspect surface outside Candid UI clients.
import { fileURLToPath } from "node:url";
import {
  createIcpdbDatabase,
  getDatabaseShardStatus,
  listDatabasePlacements,
  listDatabaseShards,
  listDatabases,
  listShardOperations,
  maintainDatabaseShards,
  reconcileRoutedOperation,
  reconcileShardOperation,
  topUpDatabaseShard
} from "./icpdb-http-canister.mjs";
import { parseCliArgs } from "./icpdb-http-command-builder.mjs";
import { executeIcpdbCommand } from "./icpdb-http-dispatch.mjs";
import { dumpIcpdb as dumpIcpdbSql, loadIcpdb as loadIcpdbSql } from "./icpdb-http-dump.mjs";
import * as inspectHelpers from "./icpdb-http-inspect.mjs";
import { formatCliOutput } from "./icpdb-http-output.mjs";
import {
  runShell as runIcpdbShell,
  runShellSql as runIcpdbShellSql,
  shellUsage as shellUsageText
} from "./icpdb-http-shell.mjs";
import { archiveIcpdb as archiveIcpdbTransfer, restoreIcpdb as restoreIcpdbTransfer } from "./icpdb-http-transfer.mjs";

export { buildCommand, parseCliArgs } from "./icpdb-http-command-builder.mjs";
export {
  createIcpdbDatabase,
  getDatabaseShardStatus,
  listDatabasePlacements,
  listDatabaseShards,
  listDatabases,
  listShardOperations,
  maintainDatabaseShards,
  reconcileRoutedOperation,
  reconcileShardOperation,
  topUpDatabaseShard
} from "./icpdb-http-canister.mjs";
export { formatCliOutput } from "./icpdb-http-output.mjs";
export { shellLineCommand, shellUsage } from "./icpdb-http-shell.mjs";

export async function callIcpdbHttp(command, fetchImpl = fetch) {
  const headers = {
    authorization: `Bearer ${command.token}`,
    "content-type": "application/json"
  };
  if (command.idempotencyKey) {
    headers["idempotency-key"] = command.idempotencyKey;
  }
  const response = await fetchImpl(`${trimTrailingSlash(command.baseUrl)}${command.endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(command.body)
  });
  const text = await response.text();
  const value = text ? parseJson(text, "response") : null;
  if (!response.ok) {
    const message = responseErrorMessage(value) ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return value;
}

export async function archiveIcpdb(command, fetchImpl = fetch) {
  return archiveIcpdbTransfer(command, fetchImpl, callIcpdbHttp);
}

export async function restoreIcpdb(command, fetchImpl = fetch) {
  return restoreIcpdbTransfer(command, fetchImpl, callIcpdbHttp);
}

export async function inspectIcpdb(command, fetchImpl = fetch) {
  return inspectHelpers.inspectIcpdb(command, fetchImpl, callIcpdbHttp);
}

export async function statsIcpdb(command, fetchImpl = fetch) {
  return inspectHelpers.statsIcpdb(command, fetchImpl, callIcpdbHttp);
}

export async function tableColumnsIcpdb(command, fetchImpl = fetch) {
  return inspectHelpers.tableColumnsIcpdb(command, fetchImpl, callIcpdbHttp);
}

export async function tableIndexesIcpdb(command, fetchImpl = fetch) {
  return inspectHelpers.tableIndexesIcpdb(command, fetchImpl, callIcpdbHttp);
}

export async function tableTriggersIcpdb(command, fetchImpl = fetch) {
  return inspectHelpers.tableTriggersIcpdb(command, fetchImpl, callIcpdbHttp);
}

export async function tableForeignKeysIcpdb(command, fetchImpl = fetch) {
  return inspectHelpers.tableForeignKeysIcpdb(command, fetchImpl, callIcpdbHttp);
}

export async function databaseViewsIcpdb(command, fetchImpl = fetch) {
  return inspectHelpers.databaseViewsIcpdb(command, fetchImpl, callIcpdbHttp);
}

export async function schemaIcpdb(command, fetchImpl = fetch) {
  return inspectHelpers.schemaIcpdb(command, fetchImpl, callIcpdbHttp);
}

export async function dumpIcpdb(command, fetchImpl = fetch) {
  return dumpIcpdbSql(command, fetchImpl, callIcpdbHttp);
}

export async function loadIcpdb(command, fetchImpl = fetch) {
  return loadIcpdbSql(command, fetchImpl, callIcpdbHttp);
}

export async function runShell(command, input = process.stdin, output = process.stdout, fetchImpl = fetch) {
  await runIcpdbShell(command, input, output, fetchImpl, shellHandlers);
}

export async function runShellSql(command, output = process.stdout, fetchImpl = fetch) {
  await runIcpdbShellSql(command, output, fetchImpl, shellHandlers);
}

export function usage() {
  return usageLines().join("\n");
}

export function commandUsage(topic) {
  const command = topic.trim().replace(/^\./, "");
  if (!command) return usage();
  const matches = usageLines().filter((line) => lineMatchesCommand(line, command));
  if (matches.length === 0) {
    throw new Error(`unknown help command: ${topic}`);
  }
  const lines = ["Usage:", ...matches];
  if (command === "shell") {
    lines.push("", "Shell commands:", ...shellCommandLines());
  }
  return lines.join("\n");
}

function usageLines() {
  return [
    "Usage:",
    "  node scripts/icpdb-http.mjs help [command]",
    "",
    "Control-plane commands:",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] create-db [token_name]",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] databases",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] placements",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] shards",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] shard-status <database_canister_id>",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] shard-top-up <database_canister_id> <cycles>",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] shard-maintain <min_available_slots> <min_cycles_balance> <top_up_cycles> <max_new_shards> <new_shard_max_databases> <new_shard_initial_cycles>",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] shard-ops",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] shard-reconcile <applied|failed> <operation_id> [failure_reason]",
    "  node scripts/icpdb-http.mjs --network-url <url> --canister-id <id> [--root-key <key>] operation-reconcile <database_id> <operation_id>",
    "",
    "Database inspection commands:",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> tables <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> views <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> stats <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> describe <database_id> <table_name>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> preview <database_id> <table_name> [--limit 100] [--offset 0]",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> columns <database_id> <table_name>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> indexes <database_id> <table_name>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> triggers <database_id> <table_name>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> foreign-keys <database_id> <table_name>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> inspect <database_id> [table_name] [--limit 100] [--offset 0]",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> inspect <database_id> --access",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> schema <database_id> [table_name]",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> dump <database_id> [table_name] [--limit 100]",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> load <database_id> <file>",
    "",
    "Account and lifecycle commands:",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> usage <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> usage-events <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> billing <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> payments <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> placement <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> operation <database_id> <operation_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> quota <database_id> <max_logical_size_bytes>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> create-token <database_id> <name> <read|write|owner>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> tokens <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> revoke-token <database_id> <token_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> archive <database_id> <file>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> restore <database_id> <file>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> archive-cancel <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> members <database_id>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> grant-member <database_id> <principal> <reader|writer|owner>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> revoke-member <database_id> <principal>",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <owner-token> delete-db <database_id>",
    "",
    "SQL commands:",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> query <database_id> <sql> [--params '[...]'] [--max-rows 100]",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> execute <database_id> <sql> [--params '[...]'] [--idempotency-key <key>]",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> batch <database_id> '<statements_json>' [--idempotency-key <key>]",
    "  node scripts/icpdb-http.mjs --base-url <url> --token <token> shell <database_id> [sql|dot-command]",
    "",
    "Options:",
    "  --format json|table|csv",
    "  --canister-id <principal>",
    "  --network-url <url>",
    "  --root-key <local-root-key>",
    "  --token-name <owner-token-name>",
    "  --idempotency-key <key>",
    "",
    ...shellUsageText().split("\n"),
    "",
    "Env:",
    "  ICPDB_HTTP_BASE_URL",
    "  ICPDB_TOKEN",
    "  ICPDB_CANISTER_ID",
    "  ICPDB_NETWORK_URL",
    "  ICPDB_ROOT_KEY",
    "  ICPDB_TOKEN_NAME",
    "  ICPDB_IDEMPOTENCY_KEY"
  ];
}

function shellCommandLines() {
  return shellUsageText().split("\n").slice(1);
}

function lineMatchesCommand(line, command) {
  const trimmed = line.trim();
  if (trimmed.startsWith("node scripts/icpdb-http.mjs ")) {
    const commandIndex = commandTokenIndex(trimmed);
    return commandIndex >= 0 && trimmed.split(/\s+/)[commandIndex] === command;
  }
  return trimmed === `.${command}` || trimmed.startsWith(`.${command} `);
}

function commandTokenIndex(line) {
  const tokens = line.split(/\s+/);
  for (let index = 2; index < tokens.length; index += 1) {
    if (!tokens[index].startsWith("--") && !tokens[index].startsWith("<") && !tokens[index].startsWith("[--")) {
      return index;
    }
  }
  return -1;
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`invalid JSON ${label}: ${message}`);
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function responseErrorMessage(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.error === "string") {
    return value.error;
  }
  return null;
}

async function main() {
  const command = parseCliArgs(process.argv.slice(2));
  if (command.help) {
    console.log(command.helpTopic ? commandUsage(command.helpTopic) : usage());
    return;
  }
  if (command.shell) {
    await runShell(command);
    return;
  }
  const result = await executeIcpdbCommand(command, mainHandlers());
  if (command.dump) {
    process.stdout.write(result);
    return;
  }
  console.log(formatCliOutput(result, command));
}

function shellHandlers(fetchImpl) {
  return {
    databaseViews: (command) => databaseViewsIcpdb(command, fetchImpl),
    dump: (command) => dumpIcpdb(command, fetchImpl),
    http: (command) => callIcpdbHttp(command, fetchImpl),
    inspect: (command) => inspectIcpdb(command, fetchImpl),
    schema: (command) => schemaIcpdb(command, fetchImpl),
    stats: (command) => statsIcpdb(command, fetchImpl),
    tableColumns: (command) => tableColumnsIcpdb(command, fetchImpl),
    tableForeignKeys: (command) => tableForeignKeysIcpdb(command, fetchImpl),
    tableIndexes: (command) => tableIndexesIcpdb(command, fetchImpl),
    tableTriggers: (command) => tableTriggersIcpdb(command, fetchImpl)
  };
}

function mainHandlers() {
  return {
    archive: archiveIcpdb,
    createDatabase: createIcpdbDatabase,
    databasePlacements: listDatabasePlacements,
    databaseShardStatus: getDatabaseShardStatus,
    databaseShards: listDatabaseShards,
    databaseViews: databaseViewsIcpdb,
    databases: listDatabases,
    dump: dumpIcpdb,
    http: callIcpdbHttp,
    inspect: inspectIcpdb,
    load: loadIcpdb,
    maintainDatabaseShards,
    reconcileRoutedOperation,
    reconcileShardOperation,
    restore: restoreIcpdb,
    schema: schemaIcpdb,
    shardOperations: listShardOperations,
    stats: statsIcpdb,
    tableColumns: tableColumnsIcpdb,
    tableForeignKeys: tableForeignKeysIcpdb,
    tableIndexes: tableIndexesIcpdb,
    tableTriggers: tableTriggersIcpdb,
    topUpDatabaseShard
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
