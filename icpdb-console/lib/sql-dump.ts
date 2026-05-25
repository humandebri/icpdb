// icpdb-console/lib/sql-dump.ts
// SQL dump and script helpers used by the console SQL editor and backup UI.

import type { Identity } from "@icp-sdk/core/agent";
import {
  describeTableAuthenticated,
  listTablesAuthenticated,
  previewTableAuthenticated
} from "@/lib/icpdb-client";
import {
  describeTableWithToken,
  listTablesWithToken,
  previewTableWithToken,
  type IcpdbTokenSession
} from "@/lib/icpdb-http-client";
import type {
  DatabaseTable,
  SqlBatchRequest,
  SqlStatement,
  SqlValue,
  TableDescription,
  TablePreviewResponse
} from "@/lib/types";

const sqlDumpPageSize = 250;

type SqlDumpReader = {
  listTables: () => Promise<DatabaseTable[]>;
  describeTable: (tableName: string) => Promise<TableDescription>;
  previewTable: (tableName: string, limit: number, offset: number) => Promise<TablePreviewResponse>;
};

export async function buildSqlDump(canisterId: string, identity: Identity, databaseId: string): Promise<string> {
  return buildSqlDumpWithReader({
    listTables: () => listTablesAuthenticated(canisterId, identity, databaseId),
    describeTable: (tableName) => describeTableAuthenticated(canisterId, identity, databaseId, tableName),
    previewTable: (tableName, limit, offset) => previewTableAuthenticated(canisterId, identity, {
      databaseId,
      tableName,
      limit,
      offset
    })
  });
}

export async function buildSqlDumpWithToken(session: IcpdbTokenSession): Promise<string> {
  return buildSqlDumpWithReader({
    listTables: () => listTablesWithToken(session),
    describeTable: (tableName) => describeTableWithToken(session, tableName),
    previewTable: (tableName, limit, offset) => previewTableWithToken(session, {
      databaseId: session.databaseId,
      tableName,
      limit,
      offset
    })
  });
}

async function buildSqlDumpWithReader(reader: SqlDumpReader): Promise<string> {
  const tables = await reader.listTables();
  const descriptions = await Promise.all(tables.map((table) => reader.describeTable(table.name)));
  const lines = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const description of descriptions) {
    if (description.schemaSql) {
      lines.push(`${trimSqlSemicolon(description.schemaSql)};`);
    }
  }
  for (const description of sortDescriptionsForInsert(descriptions)) {
    if (description.objectType !== "table") continue;
    let offset = 0;
    while (true) {
      const preview = await reader.previewTable(description.tableName, sqlDumpPageSize, offset);
      for (const row of preview.rows) {
        lines.push(formatInsertStatement(description.tableName, preview.columns, row));
      }
      offset += preview.rows.length;
      if (preview.rows.length === 0 || BigInt(offset) >= BigInt(preview.totalCount)) {
        break;
      }
    }
  }
  for (const description of descriptions) {
    for (const index of description.indexes) {
      if (index.schemaSql) lines.push(`${trimSqlSemicolon(index.schemaSql)};`);
    }
    for (const trigger of description.triggers) {
      if (trigger.schemaSql) lines.push(`${trimSqlSemicolon(trigger.schemaSql)};`);
    }
  }
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

export function buildSqlBatchRequest(databaseId: string, source: string): SqlBatchRequest {
  const statements: SqlStatement[] = splitSqlStatements(source).map((statement) => ({
    sql: statement,
    params: []
  }));
  if (statements.length === 0) {
    throw new Error("batch requires at least one SQL statement");
  }
  return { databaseId, statements, maxRows: 100 };
}

export function splitSqlDumpStatements(source: string): string[] {
  return splitSqlScript(source)
    .map(trimSqlSemicolon)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^(PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i.test(statement));
}

export function splitSqlStatements(source: string): string[] {
  return splitSqlScript(source).map(trimSqlSemicolon).map((statement) => statement.trim()).filter(Boolean);
}

export function quoteSqlIdentifier(identifier: string): string {
  if (!identifier || identifier.includes("\0")) {
    throw new Error("invalid SQL identifier");
  }
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function sortDescriptionsForInsert(descriptions: TableDescription[]): TableDescription[] {
  const byName = new Map(descriptions.map((description) => [description.tableName, description]));
  const sorted: TableDescription[] = [];
  const temporary = new Set<string>();
  const permanent = new Set<string>();
  function visit(description: TableDescription) {
    if (permanent.has(description.tableName)) return;
    if (temporary.has(description.tableName)) return;
    temporary.add(description.tableName);
    for (const key of description.foreignKeys) {
      const parent = byName.get(key.tableName);
      if (parent) visit(parent);
    }
    temporary.delete(description.tableName);
    permanent.add(description.tableName);
    sorted.push(description);
  }
  for (const description of descriptions) {
    visit(description);
  }
  return sorted;
}

function formatInsertStatement(tableName: string, columns: string[], row: SqlValue[]): string {
  const columnSql = columns.map(quoteSqlIdentifier).join(", ");
  const valueSql = row.map(sqlValueToLiteral).join(", ");
  return `INSERT INTO ${quoteSqlIdentifier(tableName)} (${columnSql}) VALUES (${valueSql});`;
}

function sqlValueToLiteral(value: SqlValue): string {
  if (value.kind === "null") return "NULL";
  if (value.kind === "integer") return value.value;
  if (value.kind === "real") return String(value.value);
  if (value.kind === "blob") return `X'${value.value.map((byte) => byte.toString(16).padStart(2, "0")).join("")}'`;
  return `'${value.value.replaceAll("'", "''")}'`;
}

function trimSqlSemicolon(sql: string): string {
  return sql.trim().replace(/;+$/, "");
}

function splitSqlScript(source: string): string[] {
  type SplitMode = "normal" | "single" | "double" | "line_comment" | "block_comment";
  const statements: string[] = [];
  let current = "";
  let mode: SplitMode = "normal";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    current += char;
    if (mode === "line_comment") {
      if (char === "\n") mode = "normal";
      continue;
    }
    if (mode === "block_comment") {
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        mode = "normal";
      }
      continue;
    }
    if (mode === "single") {
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        mode = "normal";
      }
      continue;
    }
    if (mode === "double") {
      if (char === "\"" && next === "\"") {
        current += next;
        index += 1;
      } else if (char === "\"") {
        mode = "normal";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      current += next;
      index += 1;
      mode = "line_comment";
      continue;
    }
    if (char === "/" && next === "*") {
      current += next;
      index += 1;
      mode = "block_comment";
      continue;
    }
    if (char === "'") {
      mode = "single";
      continue;
    }
    if (char === "\"") {
      mode = "double";
      continue;
    }
    if (char === ";" && canSplitSqlStatement(current)) {
      if (current.trim()) statements.push(current);
      current = "";
    }
  }
  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function canSplitSqlStatement(statement: string): boolean {
  if (!/^\s*CREATE\s+TRIGGER\b/i.test(statement)) return true;
  return /\bEND\s*;\s*$/i.test(statement);
}
