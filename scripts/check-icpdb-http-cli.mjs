// Where: scripts/check-icpdb-http-cli.mjs
// What: Node-level smoke checks for the ICPDB bearer-token HTTP CLI.
// Why: CLI request shaping must stay aligned with canister HTTP endpoints without needing a live canister.
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import {
  archiveIcpdb,
  buildCommand,
  callIcpdbHttp,
  commandUsage,
  createIcpdbDatabase,
  databaseViewsIcpdb,
  dumpIcpdb,
  formatCliOutput,
  getDatabaseShardStatus,
  inspectIcpdb,
  listDatabases,
  listDatabasePlacements,
  listDatabaseShards,
  listShardOperations,
  loadIcpdb,
  maintainDatabaseShards,
  parseCliArgs,
  reconcileRoutedOperation,
  reconcileShardOperation,
  restoreIcpdb,
  runShellSql,
  schemaIcpdb,
  shellLineCommand,
  shellUsage,
  statsIcpdb,
  tableColumnsIcpdb,
  tableForeignKeysIcpdb,
  tableIndexesIcpdb,
  tableTriggersIcpdb,
  topUpDatabaseShard,
  usage
} from "./icpdb-http.mjs";

const env = {
  ICPDB_HTTP_BASE_URL: "https://db.example",
  ICPDB_TOKEN: "secret",
  ICPDB_CANISTER_ID: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ICPDB_NETWORK_URL: "http://localhost:8001",
  ICPDB_ROOT_KEY: "local-root-key"
};

function captureWritable() {
  const chunks = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      callback();
    }
  });
  output.text = () => chunks.join("");
  return output;
}

assert.deepEqual(parseCliArgs(["create-db", "cli-owner"], env), {
  createDatabase: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  tokenName: "cli-owner"
});

assert.deepEqual(parseCliArgs(["placements"], env), {
  databasePlacements: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key"
});

assert.deepEqual(parseCliArgs(["shards"], env), {
  databaseShards: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key"
});

assert.deepEqual(parseCliArgs(["shard-status", "aaaaa-aa"], env), {
  databaseShardStatus: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  databaseCanisterId: "aaaaa-aa"
});

assert.deepEqual(parseCliArgs(["shard-top-up", "aaaaa-aa", "1000000"], env), {
  topUpDatabaseShard: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  databaseCanisterId: "aaaaa-aa",
  cycles: "1000000"
});

assert.deepEqual(parseCliArgs(["shard-maintain", "1", "2", "3", "4", "5", "6"], env), {
  maintainDatabaseShards: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  minAvailableSlots: "1",
  minCyclesBalance: "2",
  topUpCycles: "3",
  maxNewShards: "4",
  newShardMaxDatabases: "5",
  newShardInitialCycles: "6"
});

assert.deepEqual(parseCliArgs(["databases"], env), {
  databases: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key"
});

assert.deepEqual(parseCliArgs(["shard-ops"], env), {
  shardOperations: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key"
});

assert.deepEqual(parseCliArgs(["shard-reconcile", "applied", "op_1"], env), {
  reconcileShardOperation: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  operationId: "op_1",
  status: "applied",
  error: null
});

assert.deepEqual(parseCliArgs(["shard-reconcile", "failed", "op_2", "operator", "verified"], env), {
  reconcileShardOperation: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  operationId: "op_2",
  status: "failed",
  error: "operator verified"
});

assert.deepEqual(parseCliArgs(["operation-reconcile", "alpha", "op_3"], env), {
  reconcileRoutedOperation: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  databaseId: "alpha",
  operationId: "op_3"
});
assert.deepEqual(parseCliArgs(["help", "inspect"], {}), { help: true, helpTopic: "inspect" });

assert.deepEqual(parseCliArgs(["tables", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["views", "alpha"], env), {
  databaseViews: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha"
});

assert.deepEqual(parseCliArgs(["stats", "alpha", "--format", "table"], env), {
  stats: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  outputFormat: "table"
});

assert.deepEqual(parseCliArgs(["describe", "alpha", "notes"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/describe",
  body: { database_id: "alpha", table_name: "notes" }
});

assert.deepEqual(parseCliArgs(["preview", "alpha", "notes", "--limit", "25", "--offset", "50"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  body: { database_id: "alpha", table_name: "notes", limit: 25, offset: 50 }
});

assert.deepEqual(parseCliArgs(["preview", "alpha", "notes", "--format", "table"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  outputFormat: "table",
  body: { database_id: "alpha", table_name: "notes", limit: 100, offset: 0 }
});

assert.deepEqual(parseCliArgs(["operation", "alpha", "op_insert_1"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/operations/get",
  body: { database_id: "alpha", operation_id: "op_insert_1" }
});

assert.deepEqual(parseCliArgs(["columns", "alpha", "notes"], env), {
  tableColumns: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(parseCliArgs(["indexes", "alpha", "notes"], env), {
  tableIndexes: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(parseCliArgs(["triggers", "alpha", "notes"], env), {
  tableTriggers: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(parseCliArgs(["foreign-keys", "alpha", "notes", "--format", "table"], env), {
  tableForeignKeys: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  outputFormat: "table"
});

assert.deepEqual(parseCliArgs(["inspect", "alpha", "notes", "--limit", "25", "--offset", "50"], env), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  includeAccess: false,
  limit: 25,
  offset: 50
});

assert.deepEqual(parseCliArgs(["inspect", "alpha", "--access"], env), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: null,
  includeAccess: true,
  limit: 100,
  offset: 0
});

assert.deepEqual(parseCliArgs(["schema", "alpha", "notes"], env), {
  schema: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(parseCliArgs(["dump", "alpha", "notes", "--limit", "2"], env), {
  dump: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  limit: 2
});

assert.deepEqual(parseCliArgs(["load", "alpha", "/tmp/dump.sql"], env), {
  load: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/dump.sql",
  maxRows: 100
});

assert.deepEqual(parseCliArgs(["load", "alpha", "/tmp/dump.sql", "--idempotency-key", "load_1"], env), {
  load: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/dump.sql",
  maxRows: 100,
  idempotencyKey: "load_1"
});

assert.deepEqual(parseCliArgs(["usage", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["usage-events", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage/events",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["billing", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/billing",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["payments", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/payments/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["placement", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/placements/get",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["quota", "alpha", "67108864"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/quota/set",
  body: { database_id: "alpha", max_logical_size_bytes: 67108864 }
});

assert.deepEqual(parseCliArgs(["tokens", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["create-token", "alpha", "web-read", "read"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/create",
  body: { database_id: "alpha", name: "web-read", scope: "read" }
});

assert.deepEqual(parseCliArgs(["revoke-token", "alpha", "tok_abc"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/revoke",
  body: { database_id: "alpha", token_id: "tok_abc" }
});

assert.deepEqual(parseCliArgs(["archive", "alpha", "/tmp/alpha.sqlite3"], env), {
  archive: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/alpha.sqlite3"
});

assert.deepEqual(parseCliArgs(["restore", "alpha", "/tmp/alpha.sqlite3"], env), {
  restore: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/alpha.sqlite3"
});

assert.deepEqual(parseCliArgs(["archive-cancel", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/archive/cancel",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["members", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["grant-member", "alpha", "2vxsx-fae", "reader"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/grant",
  body: { database_id: "alpha", principal: "2vxsx-fae", role: "reader" }
});

assert.deepEqual(parseCliArgs(["revoke-member", "alpha", "2vxsx-fae"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/revoke",
  body: { database_id: "alpha", principal: "2vxsx-fae" }
});

assert.deepEqual(parseCliArgs(["delete-db", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/database/delete",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["query", "alpha", "SELECT", "1", "--params", "[null,\"x\"]", "--max-rows", "3"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: {
    database_id: "alpha",
    sql: "SELECT 1",
    params: [null, "x"],
    max_rows: 3
  }
});

assert.deepEqual(
  buildCommand(["execute", "alpha", "CREATE TABLE notes(id INTEGER)"], {
    baseUrl: "https://db.example/",
    token: "secret",
    params: [],
    maxRows: 100,
    limit: 100,
    offset: 0,
    statements: [],
    idempotencyKey: "op_ddl"
  }),
  {
    baseUrl: "https://db.example/",
    token: "secret",
    endpoint: "/v1/sql/execute",
    body: {
      database_id: "alpha",
      sql: "CREATE TABLE notes(id INTEGER)",
      params: [],
      max_rows: 100
    },
    idempotencyKey: "op_ddl"
  }
);

assert.deepEqual(parseCliArgs(["batch", "alpha", "--idempotency-key", "op_batch", "--statement", "CREATE TABLE notes(id INTEGER)", "--statement", "SELECT 1"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/batch",
  body: {
    database_id: "alpha",
    statements: [
      { sql: "CREATE TABLE notes(id INTEGER)", params: [] },
      { sql: "SELECT 1", params: [] }
    ],
    max_rows: 100
  },
  idempotencyKey: "op_batch"
});

assert.deepEqual(parseCliArgs(["shell", "alpha", "--max-rows", "7"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 7,
  shellSql: null
});

assert.deepEqual(parseCliArgs(["shell", "alpha", "--format", "json"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 100,
  shellSql: null,
  outputFormat: "json"
});

assert.deepEqual(parseCliArgs(["query", "alpha", "SELECT body FROM notes", "--format", "csv"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "alpha", sql: "SELECT body FROM notes", params: [], max_rows: 100 },
  outputFormat: "csv"
});

assert.deepEqual(parseCliArgs(["shell", "alpha", "SELECT", "1"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 100,
  shellSql: "SELECT 1"
});

assert.deepEqual(parseCliArgs(["shell", "alpha", "--idempotency-key", "shell_write", "INSERT", "INTO", "notes", "VALUES", "(1)"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 100,
  shellSql: "INSERT INTO notes VALUES (1)",
  idempotencyKeyPrefix: "shell_write"
});

assert.deepEqual(shellLineCommand(".help", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  help: true
});
assert.deepEqual(shellLineCommand(".help inspect", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  help: true,
  helpTopic: "inspect"
});

assert.deepEqual(shellLineCommand(".tables", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".views", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  databaseViews: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha"
});

assert.deepEqual(shellLineCommand(".stats", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  stats: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha"
});

assert.deepEqual(shellLineCommand(".usage", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".billing", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/billing",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".payments", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/payments/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".placement", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/placements/get",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".operation op_insert_1", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/operations/get",
  body: { database_id: "alpha", operation_id: "op_insert_1" }
});

assert.deepEqual(shellLineCommand(".usage-events", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage/events",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".tokens", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".members", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".preview notes 2", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  body: { database_id: "alpha", table_name: "notes", limit: 2, offset: 0 }
});

assert.deepEqual(shellLineCommand(".preview notes 2 10", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  body: { database_id: "alpha", table_name: "notes", limit: 2, offset: 10 }
});

assert.deepEqual(shellLineCommand(".columns notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  tableColumns: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".indexes notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  tableIndexes: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".triggers notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  tableTriggers: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".foreign-keys notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  tableForeignKeys: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".inspect notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  includeAccess: false,
  limit: 5,
  offset: 0
});

assert.deepEqual(shellLineCommand(".inspect notes 2 10", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  includeAccess: false,
  limit: 2,
  offset: 10
});

assert.deepEqual(shellLineCommand(".inspect --access", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: null,
  includeAccess: true,
  limit: 5,
  offset: 0
});

assert.deepEqual(shellLineCommand(".schema notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  schema: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".dump notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  dump: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  limit: 5
});

assert.deepEqual(shellLineCommand("select 1", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "alpha", sql: "select 1", params: [], max_rows: 5 }
});

const shellWriteCommand = shellLineCommand("insert into notes values (1)", {
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 5
});
assert.deepEqual({
  ...shellWriteCommand,
  idempotencyKey: "<generated>"
}, {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/execute",
  body: { database_id: "alpha", sql: "insert into notes values (1)", params: [], max_rows: 5 },
  idempotencyKey: "<generated>"
});
assert.match(shellWriteCommand.idempotencyKey, /^shell-alpha-[0-9a-f-]{36}$/);

const prefixedShellWriteCommand = shellLineCommand("insert into notes values (1)", {
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 5,
  idempotencyKeyPrefix: "shell_write"
});
assert.match(prefixedShellWriteCommand.idempotencyKey, /^shell_write-[0-9a-f-]{36}$/);

const calls = [];
const okResponse = await callIcpdbHttp(
  parseCliArgs(["tables", "alpha"], env),
  async (url, request) => {
    calls.push({ url, request });
    return new Response(JSON.stringify([{ name: "notes" }]), { status: 200 });
  }
);
assert.deepEqual(okResponse, [{ name: "notes" }]);
assert.equal(calls[0].url, "https://db.example/v1/tables/list");
assert.equal(calls[0].request.headers.authorization, "Bearer secret");
assert.equal(calls[0].request.headers["content-type"], "application/json");
assert.equal(calls[0].request.body, JSON.stringify({ database_id: "alpha" }));

const idempotentCalls = [];
await callIcpdbHttp(
  parseCliArgs(["--idempotency-key", "op_insert_1", "execute", "alpha", "INSERT INTO notes VALUES (1)"], env),
  async (url, request) => {
    idempotentCalls.push({ url, request });
    return new Response(JSON.stringify({ rows: [], columns: [], rows_affected: 1, last_insert_rowid: 1, truncated: false }), { status: 200 });
  }
);
assert.equal(idempotentCalls[0].request.headers["idempotency-key"], "op_insert_1");

await assert.rejects(
  callIcpdbHttp(parseCliArgs(["tables", "alpha"], env), async () => {
    return new Response(JSON.stringify({ error: "invalid api token" }), { status: 401 });
  }),
  /invalid api token/
);

const createDbCalls = [];
const createdDb = await createIcpdbDatabase(parseCliArgs(["create-db", "cli-owner"], env), async (binary, args) => {
  createDbCalls.push({ binary, args });
  if (args.includes("create_database")) {
    return { stdout: '(variant { Ok = "db_created" })' };
  }
  return {
    stdout: '(variant { Ok = record { info = record { token_id = "tok_owner" }; token = "owner-secret" } })'
  };
});
assert.deepEqual(createdDb, {
  database_id: "db_created",
  owner_token: {
    token_id: "tok_owner",
    token: "owner-secret"
  }
});
const formattedCreatedDb = formatCliOutput(createdDb, { createDatabase: true, outputFormat: "table" });
assert.match(formattedCreatedDb, /database_id\s+\|\s+owner_token_id\s+\|\s+owner_token/);
assert.match(formattedCreatedDb, /db_created\s+\|\s+tok_owner\s+\|\s+owner-secret/);
assert.equal(createDbCalls[0].binary, "icp");
assert.deepEqual(createDbCalls[0].args.slice(0, 7), [
  "canister",
  "call",
  "-n",
  "http://localhost:8001",
  "-k",
  "local-root-key",
  "ryjl3-tyaaa-aaaaa-aaaba-cai"
]);
assert.match(createDbCalls[1].args.join(" "), /create_database_token/);
assert.match(createDbCalls[1].args.join(" "), /cli-owner/);

const databaseCalls = [];
const databases = await listDatabases(parseCliArgs(["databases"], env), async (binary, args) => {
  databaseCalls.push({ binary, args });
  return { stdout: '(variant { Ok = vec { record { database_id = "alpha"; role = variant { Owner } } } })' };
});
assert.deepEqual(databases, {
  candid: '(variant { Ok = vec { record { database_id = "alpha"; role = variant { Owner } } } })'
});
assert.equal(databaseCalls[0].binary, "icp");
assert.match(databaseCalls[0].args.join(" "), /list_databases/);

const placementCalls = [];
const placements = await listDatabasePlacements(parseCliArgs(["placements"], env), async (binary, args) => {
  placementCalls.push({ binary, args });
  return { stdout: '(variant { Ok = vec { record { database_id = "alpha"; shard_id = "local" } } })' };
});
assert.deepEqual(placements, {
  candid: '(variant { Ok = vec { record { database_id = "alpha"; shard_id = "local" } } })'
});
assert.equal(placementCalls[0].binary, "icp");
assert.match(placementCalls[0].args.join(" "), /list_all_database_placements/);

const shardCalls = [];
const shards = await listDatabaseShards(parseCliArgs(["shards"], env), async (binary, args) => {
  shardCalls.push({ binary, args });
  return { stdout: '(variant { Ok = vec { record { shard_id = "database:aaaaa-aa"; canister_id = "aaaaa-aa" } } })' };
});
assert.deepEqual(shards, {
  candid: '(variant { Ok = vec { record { shard_id = "database:aaaaa-aa"; canister_id = "aaaaa-aa" } } })'
});
assert.equal(shardCalls[0].binary, "icp");
assert.match(shardCalls[0].args.join(" "), /list_database_shards/);

const shardStatusCalls = [];
const shardStatus = await getDatabaseShardStatus(parseCliArgs(["shard-status", "aaaaa-aa"], env), async (binary, args) => {
  shardStatusCalls.push({ binary, args });
  return { stdout: '(variant { Ok = record { canister_status = "running"; cycles_balance = 1000000 } })' };
});
assert.deepEqual(shardStatus, {
  candid: '(variant { Ok = record { canister_status = "running"; cycles_balance = 1000000 } })'
});
assert.equal(shardStatusCalls[0].binary, "icp");
assert.match(shardStatusCalls[0].args.join(" "), /get_database_shard_status/);
assert.match(shardStatusCalls[0].args.join(" "), /database_canister_id = "aaaaa-aa"/);

const shardTopUpCalls = [];
const shardTopUp = await topUpDatabaseShard(parseCliArgs(["shard-top-up", "aaaaa-aa", "1000000"], env), async (binary, args) => {
  shardTopUpCalls.push({ binary, args });
  return { stdout: '(variant { Ok = record { canister_id = "aaaaa-aa"; assigned_databases = 0 } })' };
});
assert.deepEqual(shardTopUp, {
  candid: '(variant { Ok = record { canister_id = "aaaaa-aa"; assigned_databases = 0 } })'
});
assert.equal(shardTopUpCalls[0].binary, "icp");
assert.match(shardTopUpCalls[0].args.join(" "), /top_up_database_shard/);
assert.match(shardTopUpCalls[0].args.join(" "), /cycles = 1000000 : nat/);

const shardMaintainCalls = [];
const shardMaintain = await maintainDatabaseShards(parseCliArgs(["shard-maintain", "1", "2", "3", "4", "5", "6"], env), async (binary, args) => {
  shardMaintainCalls.push({ binary, args });
  return { stdout: '(variant { Ok = record { available_slots = 1 : nat64; actions = vec {} } })' };
});
assert.deepEqual(shardMaintain, {
  candid: '(variant { Ok = record { available_slots = 1 : nat64; actions = vec {} } })'
});
assert.equal(shardMaintainCalls[0].binary, "icp");
assert.match(shardMaintainCalls[0].args.join(" "), /maintain_database_shards/);
assert.match(shardMaintainCalls[0].args.join(" "), /min_available_slots = 1 : nat64/);
assert.match(shardMaintainCalls[0].args.join(" "), /new_shard_initial_cycles = 6 : nat/);

const shardOpsCalls = [];
const shardOps = await listShardOperations(parseCliArgs(["shard-ops"], env), async (binary, args) => {
  shardOpsCalls.push({ binary, args });
  return { stdout: '(variant { Ok = vec { record { operation_id = "op_1"; status = variant { Unknown } } } })' };
});
assert.deepEqual(shardOps, {
  candid: '(variant { Ok = vec { record { operation_id = "op_1"; status = variant { Unknown } } } })'
});
assert.equal(shardOpsCalls[0].binary, "icp");
assert.match(shardOpsCalls[0].args.join(" "), /list_shard_operations/);

const reconcileCalls = [];
const reconciled = await reconcileShardOperation(
  parseCliArgs(["shard-reconcile", "failed", "op_1", "operator", "verified"], env),
  async (binary, args) => {
    reconcileCalls.push({ binary, args });
    return { stdout: '(variant { Ok = record { operation_id = "op_1"; status = variant { Failed } } })' };
  }
);
assert.deepEqual(reconciled, {
  candid: '(variant { Ok = record { operation_id = "op_1"; status = variant { Failed } } })'
});
assert.equal(reconcileCalls[0].binary, "icp");
assert.match(reconcileCalls[0].args.join(" "), /reconcile_shard_operation/);
assert.match(reconcileCalls[0].args.join(" "), /operation_id = "op_1"/);
assert.match(reconcileCalls[0].args.join(" "), /status = variant \{ Failed \}/);
assert.match(reconcileCalls[0].args.join(" "), /error = opt "operator verified"/);

const routedReconcileCalls = [];
const reconciledRouted = await reconcileRoutedOperation(
  parseCliArgs(["operation-reconcile", "alpha", "op_remote_1"], env),
  async (binary, args) => {
    routedReconcileCalls.push({ binary, args });
    return { stdout: '(variant { Ok = record { operation_id = "op_remote_1"; status = variant { Applied } } })' };
  }
);
assert.deepEqual(reconciledRouted, {
  candid: '(variant { Ok = record { operation_id = "op_remote_1"; status = variant { Applied } } })'
});
assert.equal(routedReconcileCalls[0].binary, "icp");
assert.match(routedReconcileCalls[0].args.join(" "), /reconcile_routed_operation/);
assert.match(routedReconcileCalls[0].args.join(" "), /database_id = "alpha"/);
assert.match(routedReconcileCalls[0].args.join(" "), /operation_id = "op_remote_1"/);

const inspectCalls = [];
const tableInspect = await inspectIcpdb(
  parseCliArgs(["inspect", "alpha", "notes"], env),
  async (url, request) => {
    inspectCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(JSON.stringify({
        table_name: "notes",
        object_type: "table",
        columns: [{ name: "body" }],
        indexes: [{ name: "notes_body_idx" }],
        triggers: [{ name: "notes_guard" }],
        foreign_keys: [{ from_column: "parent_id" }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ columns: ["body"], rows: [[{ Text: "hello" }]], total_count: 1 }), { status: 200 });
  }
);
assert.deepEqual(tableInspect.table.table_name, "notes");
assert.deepEqual(tableInspect.preview.columns, ["body"]);
assert.deepEqual(inspectCalls.map((call) => call.url), [
  "https://db.example/v1/tables/describe",
  "https://db.example/v1/tables/preview"
]);

const databaseInspectCalls = [];
const databaseInspect = await inspectIcpdb(
  parseCliArgs(["inspect", "alpha", "--access"], env),
  async (url, request) => {
    databaseInspectCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/session")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          token_id: "tok_owner",
          scope: "owner",
          role: "owner"
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/usage")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          status: "hot",
          logical_size_bytes: 4096,
          max_logical_size_bytes: 67108864,
          usage_event_count: 3
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/placements/get")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          shard_id: "local",
          canister_id: null,
          mount_id: 11,
          status: "hot",
          schema_version: "sqlite:raw",
          created_at_ms: 1,
          updated_at_ms: 2
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/billing")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          status: "active",
          balance_units: 95,
          spent_units: 5,
          usage_event_count: 3
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/usage/events")) {
      return new Response(
        JSON.stringify([
          {
            method: "sql_execute",
            operation: "INSERT",
            success: true,
            event_count: 2,
            total_cycles_delta: 30,
            total_rows_returned: 4,
            total_rows_affected: 3,
            last_created_at_ms: 1234
          }
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/tables/list")) {
      return new Response(JSON.stringify([{ name: "notes" }]), { status: 200 });
    }
    if (url.endsWith("/v1/tokens/list")) {
      return new Response(
        JSON.stringify([
          { token_id: "tok_owner", name: "owner", scope: "owner", created_at_ms: 1000, last_used_at_ms: 1200, revoked_at_ms: null }
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/members/list")) {
      return new Response(
        JSON.stringify([
          { principal: "aaaaa-aa", role: "owner", granted_at_ms: 1000 }
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/payments/list")) {
      return new Response(
        JSON.stringify([
          {
            payment_id: "pay_1",
            database_id: "alpha",
            payer_principal: "aaaaa-aa",
            amount_e8s: 1000000,
            credited_units: 1000,
            block_index: 99,
            created_at_ms: 1100
          }
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(JSON.stringify({
        table_name: "notes",
        columns: [{ name: "body" }],
        indexes: [{ name: "notes_body_idx" }],
        triggers: [{ name: "notes_guard" }],
        foreign_keys: [{ from_column: "parent_id" }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ table_name: "notes", columns: ["body"], rows: [[{ Text: "hello" }]], total_count: 7 }), {
      status: 200
    });
  }
);
assert.deepEqual(databaseInspect.placement.shard_id, "local");
assert.deepEqual(databaseInspect.usage.logical_size_bytes, 4096);
assert.deepEqual(databaseInspect.billing.balance_units, 95);
assert.deepEqual(databaseInspect.usage_events[0].method, "sql_execute");
assert.deepEqual(databaseInspect.access.tokens[0].token_id, "tok_owner");
assert.deepEqual(databaseInspect.access.members[0].principal, "aaaaa-aa");
assert.deepEqual(databaseInspect.access.payments[0].block_index, 99);
assert.deepEqual(databaseInspect.table_summaries, [{
  table_name: "notes",
  object_type: "table",
  row_count: 7,
  column_count: 1,
  columns: ["body"],
  index_count: 1,
  trigger_count: 1,
  foreign_key_count: 1
}]);
assert.deepEqual(databaseInspect.tables[0].table_name, "notes");
assert.deepEqual(databaseInspectCalls.map((call) => call.url), [
  "https://db.example/v1/session",
  "https://db.example/v1/placements/get",
  "https://db.example/v1/usage",
  "https://db.example/v1/billing",
  "https://db.example/v1/usage/events",
  "https://db.example/v1/tables/list",
  "https://db.example/v1/tokens/list",
  "https://db.example/v1/members/list",
  "https://db.example/v1/payments/list",
  "https://db.example/v1/tables/describe",
  "https://db.example/v1/tables/preview"
]);
assert.deepEqual(databaseInspectCalls[10].body, { database_id: "alpha", table_name: "notes", limit: 1, offset: 0 });

const readDatabaseInspectCalls = [];
const readDatabaseInspect = await inspectIcpdb(
  parseCliArgs(["inspect", "alpha"], env),
  async (url, request) => {
    readDatabaseInspectCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/billing")) {
      throw new Error("read-token inspect must not call /v1/billing");
    }
    if (url.endsWith("/v1/session")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          token_id: "tok_read",
          scope: "read",
          role: "reader"
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/usage")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          status: "hot",
          logical_size_bytes: 2048,
          max_logical_size_bytes: 67108864,
          usage_event_count: 1
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/placements/get")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          shard_id: "local",
          canister_id: null,
          mount_id: 11,
          status: "hot",
          schema_version: "sqlite:raw",
          created_at_ms: 1,
          updated_at_ms: 2
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/usage/events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/v1/tables/list")) {
      return new Response(JSON.stringify([{ name: "notes" }]), { status: 200 });
    }
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(JSON.stringify({
        table_name: "notes",
        columns: [{ name: "body" }],
        indexes: [],
        triggers: [],
        foreign_keys: []
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ table_name: "notes", columns: ["body"], rows: [], total_count: 0 }), { status: 200 });
  }
);
assert.equal(readDatabaseInspect.billing, null);
assert.equal(readDatabaseInspect.access, null);
assert.deepEqual(readDatabaseInspectCalls.map((call) => call.url), [
  "https://db.example/v1/session",
  "https://db.example/v1/placements/get",
  "https://db.example/v1/usage",
  "https://db.example/v1/usage/events",
  "https://db.example/v1/tables/list",
  "https://db.example/v1/tables/describe",
  "https://db.example/v1/tables/preview"
]);

await assert.rejects(
  inspectIcpdb(
    parseCliArgs(["inspect", "alpha", "--access"], env),
    async (url, request) => {
      readDatabaseInspectCalls.push({ url, body: JSON.parse(request.body) });
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          token_id: "tok_read",
          scope: "read",
          role: "reader"
        }),
        { status: 200 }
      );
    }
  ),
  /inspect --access requires an owner token/
);

const viewListCalls = [];
const databaseViews = await databaseViewsIcpdb(
  parseCliArgs(["views", "alpha"], env),
  async (url, request) => {
    viewListCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify([
      { name: "notes", object_type: "table" },
      { name: "notes_view", object_type: "view" }
    ]), { status: 200 });
  }
);
assert.deepEqual(databaseViews, [{ name: "notes_view", object_type: "view" }]);
assert.deepEqual(viewListCalls, [{
  url: "https://db.example/v1/tables/list",
  body: { database_id: "alpha" }
}]);

const statsCalls = [];
const databaseStats = await statsIcpdb(
  parseCliArgs(["stats", "alpha"], env),
  async (url, request) => {
    statsCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/tables/list")) {
      return new Response(JSON.stringify([
        { name: "notes", object_type: "table" },
        { name: "note_bodies", object_type: "view" }
      ]), { status: 200 });
    }
    if (url.endsWith("/v1/tables/describe")) {
      const { table_name: tableName } = JSON.parse(request.body);
      return new Response(JSON.stringify({
        table_name: tableName,
        object_type: tableName === "note_bodies" ? "view" : "table",
        columns: [{ name: "body" }],
        indexes: tableName === "notes" ? [{ name: "notes_body_idx" }] : [],
        triggers: [],
        foreign_keys: []
      }), { status: 200 });
    }
    const { table_name: tableName } = JSON.parse(request.body);
    return new Response(JSON.stringify({
      table_name: tableName,
      columns: ["body"],
      rows: [],
      total_count: tableName === "notes" ? 7 : 3
    }), { status: 200 });
  }
);
assert.deepEqual(databaseStats.stats, {
  table_count: 1,
  view_count: 1,
  row_count: "10",
  column_count: 2,
  index_count: 1,
  trigger_count: 0,
  foreign_key_count: 0
});
assert.equal(statsCalls.length, 5);
const formattedStats = formatCliOutput(databaseStats, { stats: true, outputFormat: "table" });
assert.match(formattedStats, /database alpha/);
assert.match(formattedStats, /table_count/);
assert.match(formattedStats, /note_bodies/);
const formattedStatsCsv = formatCliOutput(databaseStats, { stats: true, outputFormat: "csv" });
assert.match(formattedStatsCsv, /section,name,type,rows,tables,views,columns,indexes,triggers,foreign_keys,column_names/);
assert.match(formattedStatsCsv, /database,alpha,,10,1,1,2,1,0,0,/);
assert.match(formattedStatsCsv, /table,note_bodies,view,3,,,1,0,0,0,body/);

const tableColumnCalls = [];
const tableColumns = await tableColumnsIcpdb(
  parseCliArgs(["columns", "alpha", "notes"], env),
  async (url, request) => {
    tableColumnCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      table_name: "notes",
      columns: [
        { cid: 0, name: "id", declared_type: "INTEGER", not_null: false, default_value: null, primary_key_position: 1, hidden: 0 },
        { cid: 1, name: "body", declared_type: "TEXT", not_null: true, default_value: null, primary_key_position: 0, hidden: 0 }
      ]
    }), { status: 200 });
  }
);
assert.equal(tableColumns.column_count, 2);
assert.deepEqual(tableColumns.columns[1].name, "body");
assert.deepEqual(tableColumnCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);

const tableIndexCalls = [];
const tableIndexes = await tableIndexesIcpdb(
  parseCliArgs(["indexes", "alpha", "notes"], env),
  async (url, request) => {
    tableIndexCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      table_name: "notes",
      columns: [],
      indexes: [{ name: "notes_body_idx", unique: true, origin: "c", partial: false, columns: [{ seqno: 0, cid: 1, name: "body", descending: false, collation: "BINARY", key: true }], schema_sql: "CREATE UNIQUE INDEX notes_body_idx ON notes(body)" }]
    }), { status: 200 });
  }
);
assert.deepEqual(tableIndexes.indexes[0].name, "notes_body_idx");
assert.deepEqual(tableIndexes.indexes[0].columns[0].name, "body");
assert.deepEqual(tableIndexCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);

const tableTriggerCalls = [];
const tableTriggers = await tableTriggersIcpdb(
  parseCliArgs(["triggers", "alpha", "notes"], env),
  async (url, request) => {
    tableTriggerCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      table_name: "notes",
      columns: [],
      triggers: [{ name: "notes_guard", table_name: "notes", schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END" }]
    }), { status: 200 });
  }
);
assert.deepEqual(tableTriggers.triggers[0].name, "notes_guard");
assert.deepEqual(tableTriggerCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);

const tableForeignKeyCalls = [];
const tableForeignKeys = await tableForeignKeysIcpdb(
  parseCliArgs(["foreign-keys", "alpha", "notes"], env),
  async (url, request) => {
    tableForeignKeyCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      table_name: "notes",
      columns: [],
      foreign_keys: [{ id: 0, seq: 0, from_column: "parent_id", table_name: "parents", to_column: "id", on_update: "CASCADE", on_delete: "RESTRICT", match_clause: "NONE" }]
    }), { status: 200 });
  }
);
assert.deepEqual(tableForeignKeys.foreign_keys[0].from_column, "parent_id");
assert.deepEqual(tableForeignKeyCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);

const schemaCalls = [];
const schemaResult = await schemaIcpdb(
  parseCliArgs(["schema", "alpha", "notes"], env),
  async (url, request) => {
    schemaCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(
      JSON.stringify({
        table_name: "notes",
        object_type: "table",
        schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
        columns: [],
        indexes: [
          {
            name: "notes_body_idx",
            unique: true,
            origin: "c",
            partial: false,
            columns: [{ seqno: 0, cid: 1, name: "body", descending: false, collation: "BINARY", key: true }],
            schema_sql: "CREATE UNIQUE INDEX notes_body_idx ON notes(body)"
          }
        ],
        triggers: [
          {
            name: "notes_guard",
            table_name: "notes",
            schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
          }
        ],
        foreign_keys: []
      }),
      { status: 200 }
    );
  }
);
assert.deepEqual(schemaCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);
assert.deepEqual(schemaResult.schemas, [
  {
    table_name: "notes",
    object_type: "table",
    schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
    index_schemas: ["CREATE UNIQUE INDEX notes_body_idx ON notes(body)"],
    trigger_schemas: ["CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"]
  }
]);
const formattedSchema = formatCliOutput(schemaResult, { outputFormat: "table" });
assert.match(formattedSchema, /database alpha/);
assert.match(formattedSchema, /table notes/);
assert.match(formattedSchema, /CREATE TABLE notes/);
assert.match(formattedSchema, /CREATE UNIQUE INDEX notes_body_idx ON notes\(body\)/);
assert.match(formattedSchema, /CREATE TRIGGER notes_guard BEFORE INSERT ON notes/);

const formattedViewSchema = formatCliOutput(
  {
    database_id: "alpha",
    schemas: [
      {
        table_name: "note_bodies",
        object_type: "view",
        schema_sql: "CREATE VIEW note_bodies AS SELECT body FROM notes",
        index_schemas: [],
        trigger_schemas: []
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedViewSchema, /view note_bodies/);
assert.doesNotMatch(formattedViewSchema, /table note_bodies/);
assert.match(formattedViewSchema, /CREATE VIEW note_bodies/);

const dumpCalls = [];
const dumpResult = await dumpIcpdb(
  parseCliArgs(["dump", "alpha", "notes", "--limit", "1"], env),
  async (url, request) => {
    const body = JSON.parse(request.body);
    dumpCalls.push({ url, body });
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          table_name: "notes",
          object_type: "table",
          schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
          columns: []
        }),
        { status: 200 }
      );
    }
    if (body.offset === 0) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          table_name: "notes",
          columns: ["id", "body"],
          rows: [[{ Integer: "1" }, { Text: "hello 'sql'" }]],
          total_count: 2
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        database_id: "alpha",
        table_name: "notes",
        columns: ["id", "body"],
        rows: [[{ Integer: "2" }, { Text: "bye" }]],
        total_count: 2
      }),
      { status: 200 }
    );
  }
);
assert.match(dumpResult, /BEGIN TRANSACTION/);
assert.match(dumpResult, /CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT\);/);
assert.match(dumpResult, /INSERT INTO "notes" \("id", "body"\) VALUES \(1, 'hello ''sql'''\);/);
assert.match(dumpResult, /INSERT INTO "notes" \("id", "body"\) VALUES \(2, 'bye'\);/);
assert.match(dumpResult, /COMMIT/);
assert.deepEqual(dumpCalls.map((call) => call.url), [
  "https://db.example/v1/tables/describe",
  "https://db.example/v1/tables/preview",
  "https://db.example/v1/tables/preview"
]);

const loadPath = "/tmp/icpdb-http-cli-load-check.sql";
await writeFile(
  loadPath,
  [
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
    "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);",
    "INSERT INTO notes(body) VALUES ('hello; sql');",
    "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END;",
    "COMMIT;"
  ].join("\n")
);
const loadCalls = [];
const loadResult = await loadIcpdb(
  parseCliArgs(["load", "alpha", loadPath, "--idempotency-key", "load_1"], env),
  async (url, request) => {
    loadCalls.push({ url, body: JSON.parse(request.body), idempotencyKey: request.headers["idempotency-key"] });
    return new Response(
      JSON.stringify(request.body ? JSON.parse(request.body).statements.map(() => ({ rows_affected: 1 })) : []),
      { status: 200 }
    );
  }
);
await unlink(loadPath);
assert.deepEqual(loadCalls.map((call) => call.url), ["https://db.example/v1/sql/batch"]);
assert.deepEqual(loadCalls.map((call) => call.idempotencyKey), ["load_1-0"]);
assert.deepEqual(loadCalls[0].body.statements.map((statement) => statement.sql), [
  "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
  "INSERT INTO notes(body) VALUES ('hello; sql')",
  "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
]);
assert.equal(loadResult.statement_count, 3);
assert.equal(loadResult.rows_affected, 3);

const formattedPreview = formatCliOutput(
  {
    table_name: "notes",
    columns: ["id", "body"],
    rows: [[{ integer: 1 }, { text: "hello" }]],
    total_count: 1,
    rows_affected: 0,
    truncated: false
  },
  { outputFormat: "table" }
);
assert.match(formattedPreview, /notes \(1 rows; showing 1-1; limit 1; offset 0; next -\)/);
assert.match(formattedPreview, /showing 1-1; limit 1; offset 0; next -/);
assert.match(formattedPreview, /id\s+\|\s+body/);
assert.match(formattedPreview, /1\s+\|\s+hello/);

const formattedPreviewPage = formatCliOutput(
  {
    table_name: "notes",
    columns: ["id"],
    rows: [[{ integer: 26 }]],
    total_count: 27,
    offset: 25,
    limit: 1,
    rows_affected: 0,
    truncated: false
  },
  { outputFormat: "table" }
);
assert.match(formattedPreviewPage, /notes \(27 rows; showing 26-26; limit 1; offset 25; next 26\)/);

const formattedPreviewCsv = formatCliOutput(
  {
    table_name: "notes",
    columns: ["id", "body"],
    rows: [[{ integer: 1 }, { text: "hello, csv" }]],
    total_count: 1,
    rows_affected: 0,
    truncated: false
  },
  { outputFormat: "csv" }
);
assert.equal(formattedPreviewCsv, "id,body\n1,\"hello, csv\"");

const formattedDescription = formatCliOutput(
  {
    table_name: "notes",
    schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
    columns: [
      { name: "id", declared_type: "INTEGER", not_null: false, primary_key_position: 1 },
      { name: "body", declared_type: "TEXT", not_null: true, primary_key_position: 0 }
    ],
    indexes: [
      {
        name: "notes_body_idx",
        unique: true,
        origin: "c",
        partial: false,
        columns: [{ seqno: 0, cid: 1, name: "body", descending: false, collation: "BINARY", key: true }],
        schema_sql: "CREATE UNIQUE INDEX notes_body_idx ON notes(body)"
      }
    ],
    triggers: [
      {
        name: "notes_guard",
        table_name: "notes",
        schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
      }
    ],
    foreign_keys: [
      {
        from_column: "parent_id",
        id: 0,
        seq: 0,
        table_name: "parents",
        to_column: "id",
        on_update: "CASCADE",
        on_delete: "RESTRICT",
        match_clause: "NONE"
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedDescription, /table notes/);
assert.match(formattedDescription, /columns/);
assert.match(formattedDescription, /body\s+\|\s+TEXT\s+\|\s+no/);
assert.match(formattedDescription, /indexes/);
assert.match(formattedDescription, /notes_body_idx/);
assert.match(formattedDescription, /body/);
assert.match(formattedDescription, /partial/);
assert.match(formattedDescription, /CREATE UNIQUE INDEX notes_body_idx ON notes\(body\)/);
assert.match(formattedDescription, /triggers/);
assert.match(formattedDescription, /notes_guard/);
assert.match(formattedDescription, /CREATE TRIGGER notes_guard BEFORE INSERT ON notes/);
assert.match(formattedDescription, /foreign keys/);
assert.match(formattedDescription, /group\s+\|\s+seq/);
assert.match(formattedDescription, /parent_id\s+\|\s+parents\.id/);
assert.match(formattedDescription, /CASCADE/);
assert.match(formattedDescription, /RESTRICT/);

const formattedDescriptionCsv = formatCliOutput(
  {
    table_name: "notes",
    columns: [
      { name: "id", declared_type: "INTEGER", not_null: false, primary_key_position: 1 },
      { name: "body", declared_type: "TEXT", not_null: true, primary_key_position: 0 }
    ],
    indexes: [],
    triggers: [],
    foreign_keys: []
  },
  { outputFormat: "csv" }
);
assert.match(formattedDescriptionCsv, /name,type,null,pk,default,hidden/);
assert.match(formattedDescriptionCsv, /body,TEXT,no,,,0/);

const formattedColumns = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    column_count: 2,
    columns: [
      { cid: 0, name: "id", declared_type: "INTEGER", not_null: false, default_value: null, primary_key_position: 1, hidden: 0 },
      { cid: 1, name: "body", declared_type: "TEXT", not_null: true, default_value: null, primary_key_position: 0, hidden: 0 }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedColumns, /columns notes \(2\)/);
assert.match(formattedColumns, /body\s+\|\s+TEXT\s+\|\s+no/);
assert.match(formattedColumns, /id\s+\|\s+INTEGER/);

const formattedIndexes = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    indexes: [
      {
        name: "notes_body_idx",
        unique: true,
        origin: "c",
        partial: false,
        columns: [{ seqno: 0, cid: 1, name: "body", descending: false, collation: "BINARY", key: true }],
        schema_sql: "CREATE UNIQUE INDEX notes_body_idx ON notes(body)"
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedIndexes, /indexes notes/);
assert.match(formattedIndexes, /notes_body_idx/);
assert.match(formattedIndexes, /body/);
assert.match(formattedIndexes, /CREATE UNIQUE INDEX notes_body_idx ON notes\(body\)/);

const formattedTriggers = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    triggers: [
      {
        name: "notes_guard",
        table_name: "notes",
        schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedTriggers, /triggers notes/);
assert.match(formattedTriggers, /notes_guard/);
assert.match(formattedTriggers, /CREATE TRIGGER notes_guard BEFORE INSERT ON notes/);

const formattedTriggersCsv = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    triggers: [
      {
        name: "notes_guard",
        table_name: "notes",
        schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
      }
    ]
  },
  { outputFormat: "csv" }
);
assert.match(formattedTriggersCsv, /name,table,schema_sql/);
assert.match(formattedTriggersCsv, /notes_guard,notes,CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END/);

const formattedForeignKeys = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    foreign_keys: [
      {
        from_column: "parent_id",
        id: 0,
        seq: 0,
        table_name: "parents",
        to_column: "id",
        on_update: "CASCADE",
        on_delete: "RESTRICT",
        match_clause: "NONE"
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedForeignKeys, /foreign keys notes/);
assert.match(formattedForeignKeys, /group\s+\|\s+seq/);
assert.match(formattedForeignKeys, /parent_id\s+\|\s+parents\.id/);
assert.match(formattedForeignKeys, /CASCADE/);
assert.match(formattedForeignKeys, /NONE/);

const formattedDatabaseInspect = formatCliOutput(
  {
    database_id: "alpha",
    usage: {
      status: "hot",
      logical_size_bytes: 4096,
      max_logical_size_bytes: 67108864,
      usage_event_count: 3
    },
    billing: {
      status: "active",
      balance_units: 95,
      spent_units: 5,
      usage_event_count: 3
    },
    usage_events: [
      {
        method: "sql_execute",
        operation: "INSERT",
        success: true,
        event_count: 2,
        total_cycles_delta: 30,
        total_rows_returned: 4,
        total_rows_affected: 3,
        last_created_at_ms: 1234
      }
    ],
    access: {
      tokens: [
        { token_id: "tok_owner", name: "owner", scope: "owner", created_at_ms: 1000, last_used_at_ms: 1200, revoked_at_ms: null }
      ],
      members: [
        { principal: "aaaaa-aa", role: "owner", granted_at_ms: 1000 }
      ]
    },
    table_summaries: [{
      table_name: "notes",
      object_type: "table",
      row_count: 7,
      column_count: 2,
      columns: ["id", "body"],
      index_count: 1,
      trigger_count: 2,
      foreign_key_count: 3
    }],
    tables: [
      {
        table_name: "notes",
        schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
        columns: [
          { name: "id", declared_type: "INTEGER", not_null: false, primary_key_position: 1 },
          { name: "body", declared_type: "TEXT", not_null: false, primary_key_position: 0 }
        ],
        indexes: [],
        triggers: [],
        foreign_keys: []
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedDatabaseInspect, /account/);
assert.match(formattedDatabaseInspect, /logical_size_bytes/);
assert.match(formattedDatabaseInspect, /4096/);
assert.match(formattedDatabaseInspect, /balance_units/);
assert.match(formattedDatabaseInspect, /95/);
assert.match(formattedDatabaseInspect, /usage events/);
assert.match(formattedDatabaseInspect, /sql_execute\s+\|\s+INSERT\s+\|\s+yes\s+\|\s+2\s+\|\s+30/);
assert.match(formattedDatabaseInspect, /4\s+\|\s+3/);
assert.match(formattedDatabaseInspect, /access/);
assert.match(formattedDatabaseInspect, /tok_owner\s+\|\s+owner\s+\|\s+owner\s+\|\s+active\s+\|\s+1000\s+\|\s+1200/);
assert.match(formattedDatabaseInspect, /aaaaa-aa\s+\|\s+owner/);
assert.match(formattedDatabaseInspect, /table summary/);
assert.match(formattedDatabaseInspect, /notes\s+\|\s+table\s+\|\s+7\s+\|\s+2\s+\|\s+1\s+\|\s+2\s+\|\s+3\s+\|\s+id, body/);

const formattedDatabaseInspectCsv = formatCliOutput(
  {
    database_id: "alpha",
    table_summaries: [{
      table_name: "notes",
      object_type: "table",
      row_count: 7,
      column_count: 2,
      index_count: 1,
      trigger_count: 2,
      foreign_key_count: 3,
      columns: ["id", "body"]
    }],
    tables: []
  },
  { outputFormat: "csv" }
);
assert.match(formattedDatabaseInspectCsv, /table_name,object_type,row_count,column_count,index_count,trigger_count,foreign_key_count,columns/);
assert.match(formattedDatabaseInspectCsv, /notes,table,7,2,1,2,3,"\[""id"",""body""\]"/);

const formattedTokenList = formatCliOutput(
  [
    { token_id: "tok_active", name: "active-token", scope: "write", created_at_ms: 1000, last_used_at_ms: 1200, revoked_at_ms: null },
    { token_id: "tok_revoked", name: "old-token", scope: "read", created_at_ms: 900, last_used_at_ms: null, revoked_at_ms: 1300 }
  ],
  { endpoint: "/v1/tokens/list", outputFormat: "table" }
);
assert.match(formattedTokenList, /token_id\s+\|\s+name\s+\|\s+scope\s+\|\s+status\s+\|\s+created_at_ms\s+\|\s+last_used_at_ms\s+\|\s+revoked_at_ms/);
assert.match(formattedTokenList, /tok_active\s+\|\s+active-token\s+\|\s+write\s+\|\s+active\s+\|\s+1000\s+\|\s+1200/);
assert.match(formattedTokenList, /tok_revoked\s+\|\s+old-token\s+\|\s+read\s+\|\s+revoked\s+\|\s+900\s+\|\s+\|\s+1300/);

const formattedCreatedToken = formatCliOutput(
  {
    token: "icpdb_secret",
    info: { token_id: "tok_created", name: "web-write", scope: "write", created_at_ms: 1500, last_used_at_ms: null, revoked_at_ms: null }
  },
  { endpoint: "/v1/tokens/create", outputFormat: "table" }
);
assert.match(formattedCreatedToken, /token\s+\|\s+token_id\s+\|\s+name\s+\|\s+scope\s+\|\s+status\s+\|\s+created_at_ms/);
assert.match(formattedCreatedToken, /icpdb_secret\s+\|\s+tok_created\s+\|\s+web-write\s+\|\s+write\s+\|\s+active\s+\|\s+1500/);

const formattedMemberList = formatCliOutput(
  [{ principal: "aaaaa-aa", role: "owner", granted_at_ms: 1000 }],
  { endpoint: "/v1/members/list", outputFormat: "table" }
);
assert.match(formattedMemberList, /principal\s+\|\s+role\s+\|\s+granted_at_ms/);
assert.match(formattedMemberList, /aaaaa-aa\s+\|\s+owner\s+\|\s+1000/);

const formattedPaymentList = formatCliOutput(
  [{
    payment_id: "pay_1",
    database_id: "alpha",
    payer_principal: "aaaaa-aa",
    amount_e8s: 1000000,
    credited_units: 1000,
    block_index: 99,
    created_at_ms: 1100
  }],
  { endpoint: "/v1/payments/list", outputFormat: "table" }
);
assert.match(formattedPaymentList, /payment_id\s+\|\s+payer\s+\|\s+amount_e8s\s+\|\s+credited_units\s+\|\s+block_index\s+\|\s+created_at_ms/);
assert.match(formattedPaymentList, /pay_1\s+\|\s+aaaaa-aa\s+\|\s+1000000\s+\|\s+1000\s+\|\s+99\s+\|\s+1100/);

const formattedUsageEvents = formatCliOutput(
  [
    {
      method: "sql_batch",
      operation: "CREATE+INSERT",
      success: true,
      event_count: 1,
      total_cycles_delta: 40,
      total_rows_returned: 2,
      total_rows_affected: 2,
      last_created_at_ms: 2345
    }
  ],
  { outputFormat: "table" }
);
assert.match(formattedUsageEvents, /method\s+\|\s+operation\s+\|\s+success\s+\|\s+count\s+\|\s+cycles/);
assert.match(formattedUsageEvents, /sql_batch\s+\|\s+CREATE\+INSERT\s+\|\s+yes\s+\|\s+1\s+\|\s+40\s+\|\s+2\s+\|\s+2/);

const formattedOk = formatCliOutput(null, { outputFormat: "table" });
assert.equal(formattedOk, "OK");

const shellSqlOutput = captureWritable();
const shellSqlCalls = [];
await runShellSql(
  parseCliArgs(["shell", "alpha", "SELECT", "1"], env),
  shellSqlOutput,
  async (url, request) => {
    shellSqlCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      columns: ["one"],
      rows: [[{ Integer: "1" }]],
      rows_affected: 0,
      truncated: false
    }), { status: 200 });
  }
);
assert.deepEqual(shellSqlCalls, [{
  url: "https://db.example/v1/sql/query",
  body: { database_id: "alpha", sql: "SELECT 1", params: [], max_rows: 100 }
}]);
assert.match(shellSqlOutput.text(), /one/);
assert.match(shellSqlOutput.text(), /1/);

const shellWriteOutput = captureWritable();
const shellWriteCalls = [];
await runShellSql(
  parseCliArgs(["shell", "alpha", "INSERT", "INTO", "notes", "VALUES", "(1)"], env),
  shellWriteOutput,
  async (url, request) => {
    shellWriteCalls.push({ url, body: JSON.parse(request.body), idempotencyKey: request.headers["idempotency-key"] });
    return new Response(JSON.stringify({
      rows: [],
      columns: [],
      rows_affected: 1,
      last_insert_rowid: 1,
      truncated: false
    }), { status: 200 });
  }
);
assert.equal(shellWriteCalls[0].url, "https://db.example/v1/sql/execute");
assert.deepEqual(shellWriteCalls[0].body, {
  database_id: "alpha",
  sql: "INSERT INTO notes VALUES (1)",
  params: [],
  max_rows: 100
});
assert.match(shellWriteCalls[0].idempotencyKey, /^shell-alpha-[0-9a-f-]{36}$/);
assert.match(shellWriteOutput.text(), /affected 1/);

const shellCsvOutput = captureWritable();
await runShellSql(
  parseCliArgs(["shell", "alpha", "SELECT body FROM notes", "--format", "csv"], env),
  shellCsvOutput,
  async (url, request) => {
    assert.equal(url, "https://db.example/v1/sql/query");
    assert.deepEqual(JSON.parse(request.body), {
      database_id: "alpha",
      sql: "SELECT body FROM notes",
      params: [],
      max_rows: 100
    });
    return new Response(JSON.stringify({
      columns: ["body"],
      rows: [[{ Text: "from shell,csv" }]],
      rows_affected: 0,
      truncated: false
    }), { status: 200 });
  }
);
assert.equal(shellCsvOutput.text(), "body\n\"from shell,csv\"\n");

const archiveCalls = [];
const archiveResult = await archiveIcpdb(
  parseCliArgs(["archive", "alpha", "/tmp/icpdb-http-cli-check.sqlite3"], env),
  async (url, request) => {
    archiveCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/archive/begin")) {
      return new Response(JSON.stringify({ database_id: "alpha", size_bytes: 3 }), { status: 200 });
    }
    if (url.endsWith("/v1/archive/read")) {
      return new Response(JSON.stringify({ bytes: [1, 2, 3] }), { status: 200 });
    }
    return new Response(JSON.stringify(null), { status: 200 });
  }
);
assert.equal(archiveResult.size_bytes, 3);
assert.deepEqual(archiveCalls.map((call) => call.url), [
  "https://db.example/v1/archive/begin",
  "https://db.example/v1/archive/read",
  "https://db.example/v1/archive/finalize"
]);
assert.deepEqual(archiveCalls[2].body.database_id, "alpha");
assert.equal(archiveCalls[2].body.snapshot_hash.length, 32);

const restoreCalls = [];
const restoreResult = await restoreIcpdb(
  parseCliArgs(["restore", "alpha", "/tmp/icpdb-http-cli-check.sqlite3"], env),
  async (url, request) => {
    restoreCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify(null), { status: 200 });
  }
);
assert.equal(restoreResult.size_bytes, 3);
assert.deepEqual(restoreCalls.map((call) => call.url), [
  "https://db.example/v1/restore/begin",
  "https://db.example/v1/restore/write",
  "https://db.example/v1/restore/finalize"
]);
assert.deepEqual(restoreCalls[1].body.bytes, [1, 2, 3]);

assert.match(usage(), /Control-plane commands:/);
assert.match(usage(), /Database inspection commands:/);
assert.match(usage(), /Account and lifecycle commands:/);
assert.match(usage(), /SQL commands:/);
assert.match(usage(), /preview <database_id> <table_name>/);
assert.match(usage(), /stats <database_id>/);
assert.match(usage(), /columns <database_id> <table_name>/);
assert.match(usage(), /indexes <database_id> <table_name>/);
assert.match(usage(), /triggers <database_id> <table_name>/);
assert.match(usage(), /foreign-keys <database_id> <table_name>/);
assert.match(usage(), /views <database_id>/);
assert.match(usage(), /create-db \[token_name\]/);
assert.match(usage(), /databases/);
assert.match(usage(), /shell <database_id>/);
assert.match(usage(), /batch <database_id>/);
assert.match(usage(), /inspect <database_id> \[table_name\]/);
assert.match(usage(), /--access/);
assert.match(usage(), /schema <database_id> \[table_name\]/);
assert.match(usage(), /dump <database_id> \[table_name\]/);
assert.match(usage(), /load <database_id> <file>/);
assert.match(usage(), /placements/);
assert.match(usage(), /shards/);
assert.match(usage(), /shard-status <database_canister_id>/);
assert.match(usage(), /shard-top-up <database_canister_id> <cycles>/);
assert.match(usage(), /shard-maintain <min_available_slots>/);
assert.match(usage(), /shard-ops/);
assert.match(usage(), /shard-reconcile <applied\|failed> <operation_id>/);
assert.match(usage(), /operation-reconcile <database_id> <operation_id>/);
assert.match(usage(), /usage <database_id>/);
assert.match(usage(), /usage-events <database_id>/);
assert.match(usage(), /operation <database_id> <operation_id>/);
assert.match(usage(), /billing <database_id>/);
assert.match(usage(), /placement <database_id>/);
assert.match(usage(), /quota <database_id> <max_logical_size_bytes>/);
assert.match(usage(), /create-token <database_id> <name> <read\|write\|owner>/);
assert.match(usage(), /tokens <database_id>/);
assert.match(usage(), /revoke-token <database_id> <token_id>/);
assert.match(usage(), /archive <database_id> <file>/);
assert.match(usage(), /restore <database_id> <file>/);
assert.match(usage(), /archive-cancel <database_id>/);
assert.match(usage(), /members <database_id>/);
assert.match(usage(), /grant-member <database_id> <principal> <reader\|writer\|owner>/);
assert.match(usage(), /revoke-member <database_id> <principal>/);
assert.match(usage(), /delete-db <database_id>/);
assert.match(usage(), /--format json\|table\|csv/);
assert.match(usage(), /ICPDB_HTTP_BASE_URL/);
assert.match(usage(), /ICPDB_CANISTER_ID/);
assert.match(commandUsage("inspect"), /inspect <database_id> \[table_name\]/);
assert.match(commandUsage("inspect"), /inspect <database_id> --access/);
assert.doesNotMatch(commandUsage("inspect"), /query <database_id> <sql>/);
assert.match(commandUsage("shell"), /shell <database_id> \[sql\|dot-command\]/);
assert.match(commandUsage("shell"), /\.inspect \[table_name\]/);
assert.match(commandUsage("shell"), /Database inspection commands:/);
assert.match(commandUsage("shell"), /\.help sql/);
assert.match(commandUsage(".operation"), /\.operation <operation_id>/);
assert.throws(() => commandUsage("unknown-command"), /unknown help command/);
assert.match(shellUsage(), /\.help/);
assert.match(shellUsage("inspect"), /\.inspect \[table_name\] \[limit\] \[offset\]/);
assert.match(shellUsage("inspect"), /\.inspect --access/);
assert.doesNotMatch(shellUsage("inspect"), /\.schema \[table_name\]/);
assert.match(shellUsage(".operation"), /\.operation <operation_id>/);
assert.match(shellUsage("sql"), /SELECT, WITH, PRAGMA, and EXPLAIN/);
assert.match(shellUsage("sql"), /auto-generates an idempotency key/);
assert.match(shellUsage("sql"), /--idempotency-key before shell/);
assert.throws(() => shellUsage("unknown-command"), /unknown shell help command/);
assert.match(shellUsage(), /\.views/);
assert.match(shellUsage(), /Database inspection commands:/);
assert.match(shellUsage(), /Account and lifecycle commands:/);
assert.match(shellUsage(), /Navigation commands:/);
assert.match(shellUsage(), /\.stats/);
assert.match(shellUsage(), /\.usage/);
assert.match(shellUsage(), /\.billing/);
assert.match(shellUsage(), /\.placement/);
assert.match(shellUsage(), /\.operation <operation_id>/);
assert.match(shellUsage(), /\.usage-events/);
assert.match(shellUsage(), /\.tokens/);
assert.match(shellUsage(), /\.members/);
assert.match(shellUsage(), /\.columns <table_name>/);
assert.match(shellUsage(), /\.indexes <table_name>/);
assert.match(shellUsage(), /\.triggers <table_name>/);
assert.match(shellUsage(), /\.foreign-keys <table_name>/);
assert.match(shellUsage(), /\.preview <table_name> \[limit\] \[offset\]/);
assert.match(shellUsage(), /\.inspect \[table_name\] \[limit\] \[offset\]/);
assert.match(shellUsage(), /\.inspect --access/);
assert.match(shellUsage(), /\.dump \[table_name\]/);

console.log("ICPDB HTTP CLI checks OK");
