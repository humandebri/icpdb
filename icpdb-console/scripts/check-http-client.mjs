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
const session = { baseUrl: "https://db.example/", token: "secret", databaseId: "db_alpha" };
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
    return json({ columns: [], rows: [], rows_affected: 1, last_insert_rowid: 7, truncated: false });
  }
  if (url.endsWith("/v1/sql/batch")) {
    return json([{ columns: [], rows: [], rows_affected: 1, last_insert_rowid: 8, truncated: false }]);
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
assert.equal((await sqlExecuteWithToken(session, sqlRequest("insert into notes(body) values (?1)"), { onIdempotencyKey: (value) => capturedIdempotencyKeys.push(value) })).rowsAffected, "1");
assert.equal((await sqlBatchWithToken(session, { databaseId: "db_alpha", statements: [sqlRequest("insert into notes(body) values (?1)")], maxRows: 100 }, { onIdempotencyKey: (value) => capturedIdempotencyKeys.push(value) }))[0].rowsAffected, "1");
assert.equal(calls[0].request.headers.authorization, "Bearer secret");
assert.equal(calls[0].url, "https://db.example/v1/session");
assert.deepEqual(calls[7].body.params, []);
assert.equal(calls[8].request.headers["idempotency-key"], "icpdb-web-sql_execute-db_alpha-uuid-1");
assert.equal(calls[9].request.headers["idempotency-key"], "icpdb-web-sql_batch-db_alpha-uuid-2");
assert.deepEqual(capturedIdempotencyKeys, ["icpdb-web-sql_execute-db_alpha-uuid-1", "icpdb-web-sql_batch-db_alpha-uuid-2"]);

console.log("ICPDB HTTP client checks OK");

function sqlRequest(sql) {
  return { databaseId: "db_alpha", sql, params: [], maxRows: 100 };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
