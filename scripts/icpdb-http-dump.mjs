// Where: scripts/icpdb-http-dump.mjs
// What: SQL dump and load helpers for the ICPDB HTTP CLI.
// Why: Backup/import workflows need SQL serialization that stays separate from shell and command routing.

import { readFile } from "node:fs/promises";
import { DEFAULT_LIMIT, isReadSql } from "./icpdb-http-command-utils.mjs";
import { tableDescribeCommand, tableListCommand, tablePreviewCommand } from "./icpdb-http-inspect.mjs";
import { waitForResponseOperations } from "./icpdb-http-wait.mjs";

const MAX_BATCH_STATEMENTS = 32;
const MIGRATIONS_TABLE = "icpdb_schema_migrations";

export async function dumpIcpdb(command, fetchImpl, callHttp) {
  const tableNames = command.tableName
    ? [{ name: command.tableName, object_type: "table" }]
    : await callHttp(tableListCommand(command), fetchImpl);
  const descriptions = await Promise.all(
    tableNames.map((table) => callHttp(tableDescribeCommand(command, table.name), fetchImpl))
  );
  const lines = [
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;"
  ];
  for (const description of descriptions) {
    if (description.schema_sql) {
      lines.push(`${trimSqlSemicolon(description.schema_sql)};`);
    }
  }
  for (const description of sortDescriptionsForInsert(descriptions)) {
    if (description.object_type && description.object_type !== "table" && description.object_type !== "Table") {
      continue;
    }
    let offset = 0;
    const limit = command.limit || DEFAULT_LIMIT;
    while (true) {
      const preview = await callHttp(tablePreviewCommand(command, description.table_name, limit, offset), fetchImpl);
      const rows = preview.rows ?? [];
      for (const row of rows) {
        lines.push(formatDumpInsertStatement(description, preview.columns ?? [], row));
      }
      offset += rows.length;
      if (rows.length === 0 || offset >= (preview.total_count ?? offset)) {
        break;
      }
    }
  }
  lines.push(...await sqliteSequenceDumpStatements(command, descriptions.map((description) => description.table_name), fetchImpl, callHttp));
  for (const description of descriptions) {
    for (const index of description.indexes ?? []) {
      if (index.schema_sql) {
        lines.push(`${trimSqlSemicolon(index.schema_sql)};`);
      }
    }
    for (const trigger of description.triggers ?? []) {
      if (trigger.schema_sql) {
        lines.push(`${trimSqlSemicolon(trigger.schema_sql)};`);
      }
    }
  }
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

async function sqliteSequenceDumpStatements(command, tableNames, fetchImpl, callHttp) {
  const sqliteSequence = await callHttp({
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/sql/query",
    body: {
      database_id: command.databaseId,
      sql: "SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2",
      params: [sqlTextValue("table"), sqlTextValue("sqlite_sequence")],
      max_rows: 1
    }
  }, fetchImpl);
  if ((sqliteSequence.rows ?? []).length === 0) return [];
  const includedTables = new Set(tableNames);
  const statements = [];
  const pageSize = command.maxRows ?? DEFAULT_LIMIT;
  let lastName = "";
  while (true) {
    const response = await callHttp({
      baseUrl: command.baseUrl,
      token: command.token,
      endpoint: "/v1/sql/query",
      body: {
        database_id: command.databaseId,
        sql: "SELECT name, seq FROM sqlite_sequence WHERE name > ?1 ORDER BY name",
        params: [sqlTextValue(lastName)],
        max_rows: pageSize
      }
    }, fetchImpl);
    const rows = response.rows ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const name = sqlCellText(row[0]);
      lastName = name;
      if (!includedTables.has(name)) continue;
      statements.push(`DELETE FROM sqlite_sequence WHERE name = ${quoteSqlText(name)};`);
      statements.push(`INSERT INTO sqlite_sequence(name, seq) VALUES (${quoteSqlText(name)}, ${sqliteSequenceValue(sqlCellText(row[1]))});`);
    }
    if (rows.length < pageSize && !response.truncated) break;
  }
  return statements;
}

export async function loadIcpdb(command, fetchImpl, callHttp, input = process.stdin) {
  const source = await readSqlDumpSource(command.filePath, input);
  const statements = sqlScriptStatements(source, true);
  return executeSqlStatementBatches(command, statements, fetchImpl, callHttp);
}

export async function scriptIcpdb(command, fetchImpl, callHttp, input = process.stdin) {
  const source = await readSqlDumpSource(command.filePath, input);
  const statements = sqlScriptStatements(source, false);
  if (statements.length === 0) throw new Error("SQL script has no executable statements");
  return executeSqlStatementBatches(command, statements, fetchImpl, callHttp);
}

export async function migrateIcpdb(command, fetchImpl, callHttp, input = process.stdin) {
  const source = await readSqlDumpSource(command.filePath, input);
  const migrations = parseMigrationsJson(source);
  const ensured = await ensureMigrationTable(command, fetchImpl, callHttp);
  const appliedVersions = await listAppliedMigrationVersions(command, fetchImpl, callHttp);
  const applied = [];
  const skipped = [];
  const routedOperations = [...ensured.routedOperations];
  let statementCount = 0;
  let batchCount = ensured.created ? 1 : 0;
  let rowsAffected = 0;
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    if (appliedVersions.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }
    const statements = sqlScriptStatements(migration.sql, false);
    if (statements.length === 0) throw new Error(`migration ${migration.version} has no SQL statements`);
    if (statements.length >= MAX_BATCH_STATEMENTS) {
      throw new Error(`migration ${migration.version} has too many SQL statements; split it so version recording stays atomic`);
    }
    const responses = await callSqlBatch(command, [
      ...statements,
      {
        sql: `INSERT INTO ${MIGRATIONS_TABLE}(version, name, applied_at_ms) VALUES (?1, ?2, ?3)`,
        params: [sqlTextValue(migration.version), sqlTextValue(migration.name), sqlTextValue(String(Date.now()))]
      }
    ], migrationBatchKey(command, index), fetchImpl, callHttp);
    if (command.waitForRoutedOperation) {
      routedOperations.push(...await waitForResponseOperations(command, responses, fetchImpl, callHttp));
    }
    rowsAffected += rowsAffectedTotal(responses);
    appliedVersions.add(migration.version);
    applied.push(migration.version);
    statementCount += statements.length;
    batchCount += 1;
  }
  return {
    database_id: command.databaseId,
    file: command.filePath,
    migration_count: migrations.length,
    applied,
    skipped,
    statement_count: statementCount,
    batch_count: batchCount,
    rows_affected: String(rowsAffected),
    ...(routedOperations.length > 0 ? { routed_operations: routedOperations } : {})
  };
}

async function executeSqlStatementBatches(command, statements, fetchImpl, callHttp) {
  if (command.batchMode === "read") return executeSqlStatementQueries(command, statements, fetchImpl, callHttp);
  const responses = [];
  const routedOperations = [];
  for (let offset = 0; offset < statements.length; offset += MAX_BATCH_STATEMENTS) {
    const batch = statements.slice(offset, offset + MAX_BATCH_STATEMENTS);
    const chunkResponses = await callSqlBatch(command, batch, loadBatchIdempotencyKey(command, offset).idempotencyKey, fetchImpl, callHttp);
    if (command.waitForRoutedOperation) {
      routedOperations.push(...await waitForResponseOperations(command, chunkResponses, fetchImpl, callHttp));
    }
    responses.push(...chunkResponses);
  }
  return {
    database_id: command.databaseId,
    file: command.filePath,
    statement_count: statements.length,
    batch_count: Math.ceil(statements.length / MAX_BATCH_STATEMENTS),
    rows_affected: rowsAffectedTotal(responses),
    ...(routedOperations.length > 0 ? { routed_operations: routedOperations } : {})
  };
}

async function executeSqlStatementQueries(command, statements, fetchImpl, callHttp) {
  assertReadSqlStatements(statements, command.load ? "load" : "script");
  const responses = [];
  for (const statement of statements) {
    responses.push(await callSqlQuery(command, statement, fetchImpl, callHttp));
  }
  return {
    database_id: command.databaseId,
    file: command.filePath,
    statement_count: statements.length,
    query_count: statements.length,
    batch_count: 0,
    rows_affected: rowsAffectedTotal(responses),
    results: responses
  };
}

function assertReadSqlStatements(statements, label) {
  statements.forEach((statement, index) => {
    if (!isReadSql(statement.sql)) {
      throw new Error(`read ${label} statement ${index + 1} is not read-only`);
    }
  });
}

async function ensureMigrationTable(command, fetchImpl, callHttp) {
  const table = await callHttp({
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/sql/query",
    body: {
      database_id: command.databaseId,
      sql: "SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2",
      params: [sqlTextValue("table"), sqlTextValue(MIGRATIONS_TABLE)],
      max_rows: 1
    }
  }, fetchImpl);
  if ((table.rows ?? []).length > 0) return { created: false, routedOperations: [] };
  const responses = await callSqlBatch(command, [{
    sql: `CREATE TABLE ${MIGRATIONS_TABLE}(version TEXT PRIMARY KEY, name TEXT, applied_at_ms TEXT NOT NULL)`,
    params: []
  }], migrationEnsureKey(command), fetchImpl, callHttp);
  const routedOperations = [];
  if (command.waitForRoutedOperation) {
    routedOperations.push(...await waitForResponseOperations(command, responses, fetchImpl, callHttp));
  }
  return { created: true, routedOperations };
}

async function listAppliedMigrationVersions(command, fetchImpl, callHttp) {
  const response = await callHttp({
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/sql/query",
    body: {
      database_id: command.databaseId,
      sql: `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`,
      params: [],
      max_rows: command.maxRows
    }
  }, fetchImpl);
  return new Set((response.rows ?? []).map((row) => sqlCellText(row[0])));
}

async function callSqlQuery(command, statement, fetchImpl, callHttp) {
  return callHttp({
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/sql/query",
    body: {
      database_id: command.databaseId,
      sql: statement.sql,
      params: statement.params ?? [],
      max_rows: command.maxRows
    }
  }, fetchImpl);
}

async function callSqlBatch(command, statements, idempotencyKey, fetchImpl, callHttp) {
  return callHttp({
    baseUrl: command.baseUrl,
    token: command.token,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    endpoint: "/v1/sql/batch",
    body: {
      database_id: command.databaseId,
      statements,
      max_rows: command.maxRows
    }
  }, fetchImpl);
}

export function sqlScriptStatements(source, skipDumpWrappers) {
  return splitSqlScript(source)
    .map((statement) => trimSqlSemicolon(statement))
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && (!skipDumpWrappers || !isIgnoredLoadStatement(statement)))
    .map((sql) => ({ sql, params: [] }));
}

function parseMigrationsJson(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid migrations JSON: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  if (!Array.isArray(parsed)) throw new Error("migrations JSON must be an array");
  const seen = new Set();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`migration ${index + 1} must be an object`);
    const version = migrationVersion(entry.version, index);
    if (seen.has(version)) throw new Error(`duplicate migration version: ${version}`);
    seen.add(version);
    const name = migrationName(entry.name, index);
    if (typeof entry.sql !== "string" || entry.sql.trim().length === 0) throw new Error(`migration ${version} sql must be a non-empty string`);
    return { version, name, sql: entry.sql };
  });
}

function migrationVersion(value, index) {
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`migration ${index + 1} version must be a string or number`);
  const version = String(value).trim();
  if (!version) throw new Error(`migration ${index + 1} version must not be empty`);
  return version;
}

function migrationName(value, index) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`migration ${index + 1} name must be a string`);
  return value;
}

export async function readSqlDumpSource(filePath, input) {
  if (filePath !== "-") return readFile(filePath, "utf8");
  let source = "";
  for await (const chunk of input) {
    source += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  }
  return source;
}

function loadBatchIdempotencyKey(command, offset) {
  if (!command.idempotencyKey) return {};
  return { idempotencyKey: `${command.idempotencyKey}-${offset / MAX_BATCH_STATEMENTS}` };
}

function migrationEnsureKey(command) {
  return command.idempotencyKey ? `${command.idempotencyKey}-ensure` : "";
}

function migrationBatchKey(command, index) {
  return command.idempotencyKey ? `${command.idempotencyKey}-${index}` : "";
}

function rowsAffectedTotal(responses) {
  return responses.reduce((total, response) => total + Number(response.rows_affected ?? 0), 0);
}

function sqlCellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Object.hasOwn(value, "text")) return String(value.text);
  if (Object.hasOwn(value, "Text")) return String(value.Text);
  if (Object.hasOwn(value, "integer")) return String(value.integer);
  if (Object.hasOwn(value, "Integer")) return String(value.Integer);
  if (Object.hasOwn(value, "real")) return String(value.real);
  if (Object.hasOwn(value, "Real")) return String(value.Real);
  return JSON.stringify(value);
}

function sqlTextValue(value) {
  return value === null ? { null: null } : { text: String(value) };
}

function sqliteSequenceValue(value) {
  return /^[+-]?\d+$/.test(value) ? value : quoteSqlText(value);
}

function formatDumpInsertStatement(description, previewColumns, row) {
  const insertableColumns = new Set((description.columns ?? []).filter((column) => Number(column.hidden ?? 0) === 0).map((column) => column.name));
  const columns = [];
  const values = [];
  for (let index = 0; index < previewColumns.length; index += 1) {
    const column = previewColumns[index] ?? "";
    if (!insertableColumns.has(column)) continue;
    columns.push(column);
    values.push(row[index] ?? null);
  }
  return formatInsertStatement(description.table_name, columns, values);
}

function formatInsertStatement(tableName, columns, row) {
  if (columns.length === 0) return `INSERT INTO ${quoteIdentifier(tableName)} DEFAULT VALUES;`;
  const columnList = columns.map(quoteIdentifier).join(", ");
  const valueList = row.map(sqlValueToLiteral).join(", ");
  return `INSERT INTO ${quoteIdentifier(tableName)} (${columnList}) VALUES (${valueList});`;
}

function sqlValueToLiteral(value) {
  if (value === null || value === "null") return "NULL";
  if (typeof value !== "object") {
    return quoteSqlText(String(value));
  }
  if (Object.hasOwn(value, "integer")) return String(value.integer);
  if (Object.hasOwn(value, "Integer")) return String(value.Integer);
  if (Object.hasOwn(value, "real")) return String(value.real);
  if (Object.hasOwn(value, "Real")) return String(value.Real);
  if (Object.hasOwn(value, "text")) return quoteSqlText(String(value.text));
  if (Object.hasOwn(value, "Text")) return quoteSqlText(String(value.Text));
  if (Object.hasOwn(value, "blob")) return quoteSqlBlob(value.blob);
  if (Object.hasOwn(value, "Blob")) return quoteSqlBlob(value.Blob);
  return quoteSqlText(JSON.stringify(value));
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteSqlText(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteSqlBlob(bytes) {
  return `X'${bytes.map((byte) => Number(byte).toString(16).padStart(2, "0")).join("")}'`;
}

function trimSqlSemicolon(sql) {
  return sql.trim().replace(/;+$/, "");
}

function splitSqlScript(source) {
  const statements = [];
  let current = "";
  let quote = null;
  let bracketIdentifier = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] ?? "";
    current += character;
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (bracketIdentifier) {
      if (character === "]") bracketIdentifier = false;
      continue;
    }
    if (character === "-" && next === "-") {
      current += next;
      index += 1;
      lineComment = true;
      continue;
    }
    if (character === "/" && next === "*") {
      current += next;
      index += 1;
      blockComment = true;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[") {
      bracketIdentifier = true;
      continue;
    }
    if (character === ";" && canSplitSqlStatement(current)) {
      statements.push(current);
      current = "";
    }
  }
  if (current.trim()) {
    statements.push(current);
  }
  return statements;
}

function canSplitSqlStatement(statement) {
  const executableSql = stripLeadingSqlComments(statement);
  if (!/^CREATE\s+(?:(?:TEMP|TEMPORARY)\s+)?TRIGGER\b/i.test(executableSql)) {
    return true;
  }
  return isCompleteCreateTriggerStatement(statement);
}

function isCompleteCreateTriggerStatement(statement) {
  let bodyDepth = 0;
  let caseDepth = 0;
  let sawTriggerBody = false;
  let lastToken = "";
  let index = 0;
  while (index < statement.length) {
    const character = statement[index] ?? "";
    if (character === "'" || character === "\"" || character === "`") {
      index = skipQuotedSql(statement, index, character);
    } else if (character === "[") {
      index = skipBracketQuotedSql(statement, index);
    } else if (character === "-" && statement[index + 1] === "-") {
      const nextLine = statement.indexOf("\n", index + 2);
      index = nextLine === -1 ? statement.length : nextLine + 1;
    } else if (character === "/" && statement[index + 1] === "*") {
      const close = statement.indexOf("*/", index + 2);
      index = close === -1 ? statement.length : close + 2;
    } else if (/^[A-Za-z_]$/.test(character)) {
      const end = skipSqlIdentifier(statement, index);
      const token = statement.slice(index, end).toLowerCase();
      if (token === "begin") {
        bodyDepth += 1;
        sawTriggerBody = true;
      } else if (sawTriggerBody && token === "case") {
        caseDepth += 1;
      } else if (token === "end") {
        if (caseDepth > 0) {
          caseDepth -= 1;
        } else if (bodyDepth > 0) {
          bodyDepth -= 1;
        }
      }
      lastToken = token;
      index = end;
    } else {
      index += 1;
    }
  }
  return sawTriggerBody && bodyDepth === 0 && caseDepth === 0 && lastToken === "end";
}

function skipSqlIdentifier(sql, start) {
  let index = start + 1;
  while (/^[A-Za-z0-9_$]$/.test(sql[index] ?? "")) index += 1;
  return index;
}

function skipQuotedSql(sql, start, quote) {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
      } else {
        return index + 1;
      }
    } else {
      index += 1;
    }
  }
  return sql.length;
}

function skipBracketQuotedSql(sql, start) {
  const close = sql.indexOf("]", start + 1);
  return close === -1 ? sql.length : close + 1;
}

function stripLeadingSqlComments(statement) {
  let index = 0;
  while (index < statement.length) {
    while (/\s/.test(statement[index] ?? "")) index += 1;
    if (statement[index] === "-" && statement[index + 1] === "-") {
      const lineEnd = statement.indexOf("\n", index + 2);
      if (lineEnd < 0) return "";
      index = lineEnd + 1;
      continue;
    }
    if (statement[index] === "/" && statement[index + 1] === "*") {
      const commentEnd = statement.indexOf("*/", index + 2);
      if (commentEnd < 0) return statement.slice(index);
      index = commentEnd + 2;
      continue;
    }
    break;
  }
  return statement.slice(index);
}

function isIgnoredLoadStatement(statement) {
  return /^(PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i.test(stripLeadingSqlComments(statement));
}

function sortDescriptionsForInsert(descriptions) {
  const byName = new Map(descriptions.map((description) => [description.table_name, description]));
  const sorted = [];
  const temporary = new Set();
  const permanent = new Set();
  function visit(description) {
    if (permanent.has(description.table_name)) return;
    if (temporary.has(description.table_name)) return;
    temporary.add(description.table_name);
    for (const key of description.foreign_keys ?? []) {
      const parent = byName.get(key.table_name);
      if (parent) visit(parent);
    }
    temporary.delete(description.table_name);
    permanent.add(description.table_name);
    sorted.push(description);
  }
  for (const description of descriptions) {
    visit(description);
  }
  return sorted;
}
