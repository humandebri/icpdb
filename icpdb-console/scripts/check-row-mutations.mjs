// Where: icpdb-console/scripts/check-row-mutations.mjs
// What: Execute Table Editor row/cell mutation helpers against representative schema fixtures.
// Why: Supabase-style row editing depends on exact parameterized SQL, not just rendered controls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(new URL("../lib/row-mutations.ts", import.meta.url), "utf8")
  .replace(
    /import \{ quoteSqlIdentifier \} from "@\/lib\/sql-dump";/,
    "function quoteSqlIdentifier(value) { return `\"${String(value).replaceAll('\"', '\"\"')}\"`; }"
  )
  .replace(/import type \{[\s\S]*?\} from "@\/lib\/types";\n/, "");

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    strict: true
  }
}).outputText;

const cjsModule = { exports: {} };
vm.runInNewContext(compiled, { module: cjsModule, exports: cjsModule.exports, require });

const {
  buildInsertRequest,
  buildNewRowDraft,
  buildSelectedCellMutationRequest,
  buildSelectedRowMutationRequest,
  cellValueForRow,
  columnKindLabel,
  rowToJsonObject
} = cjsModule.exports;

const table = {
  databaseId: "db_alpha",
  tableName: "notes",
  objectType: "table",
  schemaSql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL, rating REAL, payload BLOB, generated TEXT)",
  columns: [
    column("id", "INTEGER", true, null, 1, 0),
    column("body", "TEXT", true, null, 0, 0),
    column("rating", "REAL", false, null, 0, 0),
    column("payload", "BLOB", false, null, 0, 0),
    column("generated", "TEXT", false, null, 0, 2),
    column("created_at", "TEXT", false, "CURRENT_TIMESTAMP", 0, 0)
  ],
  indexes: [],
  triggers: [],
  foreignKeys: []
};

const preview = {
  databaseId: "db_alpha",
  tableName: "notes",
  columns: ["id", "body", "rating", "payload", "generated", "created_at"],
  rows: [[integer("7"), text("old body"), real(1.5), blob([1, 2, 3]), text("computed"), text("now")]],
  offset: 0,
  limit: 100,
  totalCount: "1",
  truncated: false
};

assertJsonEqual(buildNewRowDraft(table), {
  body: "",
  rating: null,
  payload: null
});

assertJsonEqual(
  buildInsertRequest(
    "db_alpha",
    table,
    JSON.stringify({ id: 99, body: "new body", rating: "2.75", payload: [0, 255], generated: "ignored" })
  ),
  {
    databaseId: "db_alpha",
    sql: 'INSERT INTO "notes" ("body", "rating", "payload") VALUES (?1, ?2, ?3)',
    params: [text("new body"), real(2.75), blob([0, 255])],
    maxRows: null
  }
);

assertJsonEqual(
  buildSelectedRowMutationRequest(
    "db_alpha",
    table,
    preview,
    0,
    JSON.stringify({ body: "updated", rating: null, created_at: "manual" }),
    "update"
  ),
  {
    databaseId: "db_alpha",
    sql: 'UPDATE "notes" SET "body" = ?1, "rating" = ?2, "created_at" = ?3 WHERE "id" = ?4',
    params: [text("updated"), nullValue(), text("manual"), integer("7")],
    maxRows: null
  }
);

assertJsonEqual(
  buildSelectedRowMutationRequest("db_alpha", table, preview, 0, "{}", "delete"),
  {
    databaseId: "db_alpha",
    sql: 'DELETE FROM "notes" WHERE "id" = ?1',
    params: [integer("7")],
    maxRows: null
  }
);

assertJsonEqual(
  buildSelectedCellMutationRequest("db_alpha", table, preview, 0, table.columns[1], "cell edit"),
  {
    databaseId: "db_alpha",
    sql: 'UPDATE "notes" SET "body" = ?1 WHERE "id" = ?2',
    params: [text("cell edit"), integer("7")],
    maxRows: null
  }
);

assertJsonEqual(rowToJsonObject(preview.columns, preview.rows[0]), {
  id: "7",
  body: "old body",
  rating: 1.5,
  payload: [1, 2, 3],
  generated: "computed",
  created_at: "now"
});
assert.equal(cellValueForRow(preview, preview.rows[0], "payload"), "[1,2,3]");
assert.equal(columnKindLabel(table.columns[0]), "primary");
assert.equal(columnKindLabel(table.columns[4]), "generated virtual");

assert.throws(
  () => buildSelectedCellMutationRequest("db_alpha", table, preview, 0, table.columns[0], "8"),
  /primary key cells/
);
assert.throws(
  () => buildInsertRequest("db_alpha", table, JSON.stringify({ payload: [256] })),
  /unsupported value/
);

console.log("ICPDB row mutation checks OK");

function column(name, declaredType, notNull, defaultValue, primaryKeyPosition, hidden) {
  return { cid: 0, name, declaredType, notNull, defaultValue, primaryKeyPosition, hidden };
}

function nullValue() {
  return { kind: "null" };
}

function integer(value) {
  return { kind: "integer", value };
}

function real(value) {
  return { kind: "real", value };
}

function text(value) {
  return { kind: "text", value };
}

function blob(value) {
  return { kind: "blob", value };
}

function assertJsonEqual(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
}
