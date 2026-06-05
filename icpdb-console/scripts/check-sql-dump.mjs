// Where: icpdb-console/scripts/check-sql-dump.mjs
// What: Runtime checks for browser-console SQL dump serialization.
// Why: Console dump must restore like the SDK/CLI dump paths, not only pass source-pattern checks.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const source = await readFile(new URL("../lib/sql-dump.ts", import.meta.url), "utf8");
const runtimeSource = `
function splitSqlDumpStatements(source) { return source.split(";").map((value) => value.trim()).filter(Boolean); }
function splitSqlStatements(source) { return splitSqlDumpStatements(source); }
function trimSqlSemicolon(source) { return source.trim().replace(/;+$/, ""); }
${source.replace(/^import[\s\S]*?from [^;]+;\n/gm, "")}
`;
const transpiled = ts.transpileModule(runtimeSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false
  }
}).outputText;

const tempDir = await mkdtemp(join(tmpdir(), "icpdb-sql-dump-check-"));
try {
  const modulePath = join(tempDir, "sql-dump.mjs");
  await writeFile(modulePath, transpiled);
  const { buildSqlDumpWithReader } = await import(pathToFileURL(modulePath).href);
  const previewCalls = [];
  const queryCalls = [];
  const dump = await buildSqlDumpWithReader({
    listTables: async () => [
      { name: "notes", objectType: "table", schemaSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL)" },
      { name: "note_lengths", objectType: "view", schemaSql: "CREATE VIEW note_lengths AS SELECT id, body_len FROM notes" }
    ],
    describeTable: async (tableName) => {
      if (tableName === "notes") {
        return {
          databaseId: "db_console",
          tableName,
          objectType: "table",
          schemaSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL)",
          columns: [
            { cid: 0, name: "id", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 1, hidden: 0 },
            { cid: 1, name: "body", declaredType: "TEXT", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 },
            { cid: 2, name: "body_len", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 2 }
          ],
          indexes: [],
          triggers: [],
          foreignKeys: []
        };
      }
      return {
        databaseId: "db_console",
        tableName,
        objectType: "view",
        schemaSql: "CREATE VIEW note_lengths AS SELECT id, body_len FROM notes",
        columns: [
          { cid: 0, name: "id", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 },
          { cid: 1, name: "body_len", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 }
        ],
        indexes: [],
        triggers: [],
        foreignKeys: []
      };
    },
    previewTable: async (tableName, limit, offset) => {
      previewCalls.push({ tableName, limit, offset });
      assert.equal(tableName, "notes");
      return {
        databaseId: "db_console",
        tableName,
        columns: ["id", "body", "body_len"],
        rows: offset === 0 ? [[
          { kind: "integer", value: "1" },
          { kind: "text", value: "hello" },
          { kind: "integer", value: "5" }
        ]] : [],
        offset,
        limit,
        totalCount: "1",
        truncated: false
      };
    },
    query: async (sql, params, maxRows) => {
      queryCalls.push({ sql, params, maxRows });
      if (sql.includes("sqlite_master")) {
        return {
          columns: ["name"],
          rows: [[{ kind: "text", value: "sqlite_sequence" }]],
          rowsAffected: "0",
          lastInsertRowid: "0",
          truncated: false
        };
      }
      assert.match(sql, /FROM sqlite_sequence/);
      return {
        columns: ["name", "seq"],
        rows: [
          [{ kind: "text", value: "notes" }, { kind: "integer", value: "44" }],
          [{ kind: "text", value: "other_table" }, { kind: "integer", value: "9" }]
        ],
        rowsAffected: "0",
        lastInsertRowid: "0",
        truncated: false
      };
    }
  });

  assert.match(dump, /CREATE TABLE notes/);
  assert.match(dump, /CREATE VIEW note_lengths/);
  assert.match(dump, /INSERT INTO "notes" \("id", "body"\) VALUES \(1, 'hello'\);/);
  assert.doesNotMatch(dump, /INSERT INTO "notes" \("id", "body", "body_len"\)/);
  assert.doesNotMatch(dump, /INSERT INTO "note_lengths"/);
  assert.match(dump, /DELETE FROM sqlite_sequence WHERE name = 'notes';/);
  assert.match(dump, /INSERT INTO sqlite_sequence\(name, seq\) VALUES \('notes', 44\);/);
  assert.doesNotMatch(dump, /other_table/);
  assert.deepEqual(previewCalls, [{ tableName: "notes", limit: 250, offset: 0 }]);
  assert.equal(queryCalls.length, 2);

  const sequenceNames = Array.from({ length: 260 }, (_, index) => `seq_${String(index).padStart(3, "0")}`);
  const sequenceDump = await buildSqlDumpWithReader({
    listTables: async () => sequenceNames.map((name) => ({ name, objectType: "table", schemaSql: `CREATE TABLE ${name}(id INTEGER PRIMARY KEY AUTOINCREMENT)` })),
    describeTable: async (tableName) => ({
      databaseId: "db_console",
      tableName,
      objectType: "table",
      schemaSql: `CREATE TABLE ${tableName}(id INTEGER PRIMARY KEY AUTOINCREMENT)`,
      columns: [{ cid: 0, name: "id", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 1, hidden: 0 }],
      indexes: [],
      triggers: [],
      foreignKeys: []
    }),
    previewTable: async (tableName, limit, offset) => ({
      databaseId: "db_console",
      tableName,
      columns: ["id"],
      rows: [],
      offset,
      limit,
      totalCount: "0",
      truncated: false
    }),
    query: async (sql, params, maxRows) => {
      if (sql.includes("sqlite_master")) {
        return {
          columns: ["name"],
          rows: [[{ kind: "text", value: "sqlite_sequence" }]],
          rowsAffected: "0",
          lastInsertRowid: "0",
          truncated: false
        };
      }
      const lastName = String(params[0]?.value ?? "");
      const rows = sequenceNames
        .filter((name) => name > lastName)
        .slice(0, maxRows ?? 250)
        .map((name, index) => [
          { kind: "text", value: name },
          { kind: "integer", value: String(index + 1) }
        ]);
      return {
        columns: ["name", "seq"],
        rows,
        rowsAffected: "0",
        lastInsertRowid: "0",
        truncated: rows.length === maxRows
      };
    }
  });
  assert.equal((sequenceDump.match(/INSERT INTO sqlite_sequence/g) ?? []).length, 260);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("ICPDB SQL dump checks OK");
