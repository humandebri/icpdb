// Where: scripts/icpdb-http-dump.mjs
// What: SQL dump and load helpers for the ICPDB HTTP CLI.
// Why: Backup/import workflows need SQL serialization that stays separate from shell and command routing.

import { readFile } from "node:fs/promises";
import { DEFAULT_LIMIT } from "./icpdb-http-command-utils.mjs";
import { tableDescribeCommand, tableListCommand, tablePreviewCommand } from "./icpdb-http-inspect.mjs";

const MAX_BATCH_STATEMENTS = 32;

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
        lines.push(formatInsertStatement(description.table_name, preview.columns ?? [], row));
      }
      offset += rows.length;
      if (rows.length === 0 || offset >= (preview.total_count ?? offset)) {
        break;
      }
    }
  }
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

export async function loadIcpdb(command, fetchImpl, callHttp) {
  const source = await readFile(command.filePath, "utf8");
  const statements = splitSqlScript(source)
    .map((statement) => trimSqlSemicolon(statement))
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !isIgnoredLoadStatement(statement))
    .map((sql) => ({ sql, params: [] }));
  const responses = [];
  for (let offset = 0; offset < statements.length; offset += MAX_BATCH_STATEMENTS) {
    const batch = statements.slice(offset, offset + MAX_BATCH_STATEMENTS);
    const chunkResponses = await callHttp(
      {
        baseUrl: command.baseUrl,
        token: command.token,
        ...loadBatchIdempotencyKey(command, offset),
        endpoint: "/v1/sql/batch",
        body: {
          database_id: command.databaseId,
          statements: batch,
          max_rows: command.maxRows
        }
      },
      fetchImpl
    );
    responses.push(...chunkResponses);
  }
  return {
    database_id: command.databaseId,
    file: command.filePath,
    statement_count: statements.length,
    batch_count: Math.ceil(statements.length / MAX_BATCH_STATEMENTS),
    rows_affected: responses.reduce((total, response) => total + Number(response.rows_affected ?? 0), 0)
  };
}

function loadBatchIdempotencyKey(command, offset) {
  if (!command.idempotencyKey) return {};
  return { idempotencyKey: `${command.idempotencyKey}-${offset / MAX_BATCH_STATEMENTS}` };
}

function formatInsertStatement(tableName, columns, row) {
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
  if (!/^\s*CREATE\s+TRIGGER\b/i.test(statement)) {
    return true;
  }
  return /\bEND\s*;\s*$/i.test(statement);
}

function isIgnoredLoadStatement(statement) {
  return /^(PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i.test(statement.trim());
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
