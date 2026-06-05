// Where: icpdb-console/scripts/check-http-client.mjs
// What: Execute the browser bearer-token HTTP client against mocked ICPDB responses.
// Why: Token-based console sessions need the same table/SQL surface as the Turso-like CLI.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../lib/icpdb-http-client.ts", import.meta.url), "utf8")
  .replace(/import type \{[\s\S]*?\} from "@\/lib\/types";\n/, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    strict: true
  }
}).outputText;
const session = { baseUrl: " https://db.example/// ", token: " secret ", databaseId: " db_alpha " };
const calls = [];
let randomId = 0;
const mockFetch = async (url, request) => {
  calls.push({ url, request, body: JSON.parse(request.body) });
  if (url.endsWith("/v1/session")) {
    return json({ database_id: "db_alpha", token_id: "tok_1", scope: "owner", role: "owner" });
  }
  if (url.endsWith("/v1/usage")) {
    return json({ database_id: "db_alpha", status: "hot", logical_size_bytes: 10, max_logical_size_bytes: 20, usage_event_count: 2 });
  }
  if (url.endsWith("/v1/operations/get")) {
    return json({
      operation_id: "op_insert_1",
      database_id: "db_alpha",
      database_canister_id: "aaaaa-aa",
      method: "sql_execute_internal",
      request_hash: [1, 2, 3],
      status: "applied",
      error: null,
      created_at_ms: 11,
      updated_at_ms: 12
    });
  }
  if (url.endsWith("/v1/tables/list")) {
    return json([{ name: "notes", object_type: "table", schema_sql: "CREATE TABLE notes(id INTEGER)" }]);
  }
  if (url.endsWith("/v1/tables/describe")) {
    return json({
      database_id: "db_alpha",
      table_name: "notes",
      object_type: "table",
      schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
      columns: [{ cid: 0, name: "id", declared_type: "INTEGER", not_null: false, default_value: null, primary_key_position: 1, hidden: 0 }],
      indexes: [{ name: "notes_id_idx", table_name: "notes", unique: true, origin: "c", partial: false, columns: [{ seqno: 0, cid: 0, name: "id", descending: false, collation: "BINARY", key: true }], schema_sql: "CREATE INDEX notes_id_idx ON notes(id)" }]
    });
  }
  if (url.endsWith("/v1/tables/preview")) {
    return json({ database_id: "db_alpha", table_name: "notes", columns: ["id"], rows: [[{ Integer: 7 }]], offset: 0, limit: 25, total_count: 1, truncated: false });
  }
  if (url.endsWith("/v1/sql/query")) {
    return json({ columns: ["body"], rows: [[{ Text: "hello" }]], rows_affected: 0, last_insert_rowid: 0, truncated: false });
  }
  if (url.endsWith("/v1/sql/execute")) {
    return json({ columns: [], rows: [], rows_affected: 1, last_insert_rowid: 7, truncated: false, routed_operation_id: "op_execute" });
  }
  if (url.endsWith("/v1/sql/batch")) {
    return json([{ columns: [], rows: [], rows_affected: 1, last_insert_rowid: 8, truncated: false, routed_operation_id: "op_batch" }]);
  }
  return json({ error: "unknown endpoint" }, 404);
};
const cjsModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: cjsModule,
  exports: cjsModule.exports,
  fetch: mockFetch,
  Response,
  crypto: { randomUUID: () => `uuid-${++randomId}` }
});

const {
  describeTableWithToken,
  getRoutedOperationWithToken,
  getSessionInfoWithToken,
  getUsageWithToken,
  listTablesWithToken,
  previewTableWithToken,
  sqlBatchWithToken,
  sqlExecuteWithToken,
  sqlQueryWithToken
} = cjsModule.exports;

assert.equal((await getSessionInfoWithToken(session)).role, "owner");
assert.equal((await getUsageWithToken(session)).logicalSizeBytes, "10");
assert.equal((await getRoutedOperationWithToken(session, "op_insert_1")).status, "applied");
assert.equal((await listTablesWithToken(session))[0].name, "notes");
assert.equal((await describeTableWithToken(session, "notes")).columns[0].name, "id");
assert.equal((await describeTableWithToken(session, "notes")).indexes[0].columns[0].name, "id");
assert.equal((await previewTableWithToken(session, { databaseId: "db_alpha", tableName: "notes", limit: 25, offset: 0 })).rows[0][0].value, "7");
assert.equal((await sqlQueryWithToken(session, sqlRequest("select body from notes"))).rows[0][0].value, "hello");
const capturedIdempotencyKeys = [];
const executeResponse = await sqlExecuteWithToken(session, sqlRequest("insert into notes(body) values (?1)"), { onIdempotencyKey: (value) => capturedIdempotencyKeys.push(value) });
assert.equal(executeResponse.rowsAffected, "1");
assert.equal(executeResponse.routedOperationId, "op_execute");
const batchResponse = await sqlBatchWithToken(session, { databaseId: "db_alpha", statements: [sqlRequest("insert into notes(body) values (?1)")], maxRows: 100 }, { onIdempotencyKey: (value) => capturedIdempotencyKeys.push(value) });
assert.equal(batchResponse[0].rowsAffected, "1");
assert.equal(batchResponse[0].routedOperationId, "op_batch");
assert.equal(calls[0].request.headers.authorization, "Bearer secret");
assert.equal(calls[0].url, "https://db.example/v1/session");
assert.equal(calls[0].body.database_id, "db_alpha");
assert.equal(calls[2].body.database_id, "db_alpha");
assert.deepEqual(calls[7].body.params, []);
assert.equal(calls[8].request.headers["idempotency-key"], "icpdb-web-sql_execute-db_alpha-uuid-1");
assert.equal(calls[9].request.headers["idempotency-key"], "icpdb-web-sql_batch-db_alpha-uuid-2");
assert.deepEqual(capturedIdempotencyKeys, ["icpdb-web-sql_execute-db_alpha-uuid-1", "icpdb-web-sql_batch-db_alpha-uuid-2"]);
await sqlExecuteWithToken(session, { ...sqlRequest("insert into notes(body) values (?1)"), idempotencyKey: " browser_retry_execute " }, { onIdempotencyKey: (value) => capturedIdempotencyKeys.push(value) });
await sqlBatchWithToken(session, { databaseId: "db_alpha", statements: [sqlRequest("insert into notes(body) values (?1)")], maxRows: 100, idempotencyKey: " browser_retry_batch " }, { onIdempotencyKey: (value) => capturedIdempotencyKeys.push(value) });
assert.equal(calls[10].request.headers["idempotency-key"], "browser_retry_execute");
assert.equal(calls[11].request.headers["idempotency-key"], "browser_retry_batch");
assert.equal(randomId, 2);
assert.deepEqual(capturedIdempotencyKeys, ["icpdb-web-sql_execute-db_alpha-uuid-1", "icpdb-web-sql_batch-db_alpha-uuid-2", "browser_retry_execute", "browser_retry_batch"]);
const callCount = calls.length;
await assert.rejects(() => getRoutedOperationWithToken(session, "   "), /operation_id must be a non-empty string/);
await assert.rejects(() => describeTableWithToken(session, "   "), /table_name must be a non-empty string/);
await assert.rejects(() => previewTableWithToken(session, { databaseId: "db_alpha", tableName: "   ", limit: 25, offset: 0 }), /table_name must be a non-empty string/);
await assert.rejects(() => previewTableWithToken(session, { databaseId: "other", tableName: "notes", limit: 25, offset: 0 }), /request database_id must match token session database_id/);
await assert.rejects(() => sqlQueryWithToken(session, sqlRequest("   ")), /SQL text must be a non-empty string/);
await assert.rejects(() => sqlExecuteWithToken(session, { ...sqlRequest("insert"), databaseId: "other" }), /request database_id must match token session database_id/);
await assert.rejects(() => sqlExecuteWithToken(session, { ...sqlRequest("insert"), idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
await assert.rejects(() => sqlBatchWithToken(session, { databaseId: "other", statements: [sqlRequest("insert")], maxRows: 100 }), /request database_id must match token session database_id/);
await assert.rejects(() => sqlBatchWithToken(session, { databaseId: "db_alpha", statements: [sqlRequest("insert")], maxRows: 100, idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
await assert.rejects(() => sqlBatchWithToken(session, { databaseId: "db_alpha", statements: [{ sql: "   ", params: [] }], maxRows: 100 }), /SQL text must be a non-empty string/);
await assert.rejects(() => getSessionInfoWithToken({ ...session, baseUrl: "   " }), /HTTP base URL must be a non-empty string/);
await assert.rejects(() => getSessionInfoWithToken({ ...session, token: "   " }), /api token must be a non-empty string/);
await assert.rejects(() => getSessionInfoWithToken({ ...session, databaseId: "   " }), /token session database_id must be a non-empty string/);
assert.equal(calls.length, callCount);

console.log("ICPDB HTTP client checks OK");

function sqlRequest(sql) {
  return { databaseId: "db_alpha", sql, params: [], maxRows: 100 };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
