// icpdb-console/lib/sql-dump.ts
// SQL dump and script helpers used by the console SQL editor and backup UI.

import type { Identity } from "@icp-sdk/core/agent";
import {
  describeTableAuthenticated,
  listTablesAuthenticated,
  previewTableAuthenticated,
  sqlQueryAuthenticated
} from "@/lib/icpdb-client";
import {
  describeTableWithToken,
  listTablesWithToken,
  previewTableWithToken,
  sqlQueryWithToken,
  type IcpdbTokenSession
} from "@/lib/icpdb-http-client";
import type {
  DatabaseTable,
  SqlBatchRequest,
  SqlExecuteResponse,
  SqlStatement,
  SqlValue,
  TableDescription,
  TablePreviewResponse
} from "@/lib/types";
import {
  splitSqlDumpStatements,
  splitSqlStatements,
  trimSqlSemicolon
} from "./icpdb-sql-script";

const sqlDumpPageSize = 250;

type SqlDumpReader = {
  listTables: () => Promise<DatabaseTable[]>;
  describeTable: (tableName: string) => Promise<TableDescription>;
  previewTable: (tableName: string, limit: number, offset: number) => Promise<TablePreviewResponse>;
  query: (sql: string, params: SqlValue[], maxRows?: number | null) => Promise<SqlExecuteResponse>;
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
    }),
    query: (sql, params, maxRows = null) => sqlQueryAuthenticated(canisterId, identity, {
      databaseId,
      sql,
      params,
      maxRows
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
    }),
    query: (sql, params, maxRows = null) => sqlQueryWithToken(session, {
      databaseId: session.databaseId,
      sql,
      params,
      maxRows
    })
  });
}

export async function buildSqlDumpWithReader(reader: SqlDumpReader): Promise<string> {
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
        lines.push(formatDumpInsertStatement(description, preview.columns, row));
      }
      offset += preview.rows.length;
      if (preview.rows.length === 0 || BigInt(offset) >= BigInt(preview.totalCount)) {
        break;
      }
    }
  }
  lines.push(...await sqliteSequenceDumpStatements(reader, descriptions.filter((description) => description.objectType === "table").map((description) => description.tableName)));
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

async function sqliteSequenceDumpStatements(reader: SqlDumpReader, tableNames: readonly string[]): Promise<string[]> {
  const sqliteSequence = await reader.query(
    "SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2",
    [{ kind: "text", value: "table" }, { kind: "text", value: "sqlite_sequence" }],
    1
  );
  if (sqliteSequence.rows.length === 0) return [];
  const includedTables = new Set(tableNames);
  const statements: string[] = [];
  let lastName = "";
  while (true) {
    const response = await reader.query(
      "SELECT name, seq FROM sqlite_sequence WHERE name > ?1 ORDER BY name",
      [{ kind: "text", value: lastName }],
      sqlDumpPageSize
    );
    if (response.rows.length === 0) break;
    for (const row of response.rows) {
      const name = sqlValueText(row[0]);
      lastName = name;
      if (!includedTables.has(name)) continue;
      statements.push(`DELETE FROM sqlite_sequence WHERE name = ${quoteSqlText(name)};`);
      statements.push(`INSERT INTO sqlite_sequence(name, seq) VALUES (${quoteSqlText(name)}, ${sqliteSequenceValue(sqlValueText(row[1]))});`);
    }
    if (response.rows.length < sqlDumpPageSize && !response.truncated) break;
  }
  return statements;
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

export { splitSqlDumpStatements, splitSqlStatements };

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

function formatDumpInsertStatement(description: TableDescription, previewColumns: readonly string[], row: readonly SqlValue[]): string {
  const insertableColumns = new Set(description.columns.filter((column) => column.hidden === 0).map((column) => column.name));
  const columns: string[] = [];
  const values: SqlValue[] = [];
  for (let index = 0; index < previewColumns.length; index += 1) {
    const column = previewColumns[index] ?? "";
    if (!insertableColumns.has(column)) continue;
    columns.push(column);
    values.push(row[index] ?? { kind: "null" });
  }
  return formatInsertStatement(description.tableName, columns, values);
}

function formatInsertStatement(tableName: string, columns: readonly string[], row: readonly SqlValue[]): string {
  if (columns.length === 0) return `INSERT INTO ${quoteSqlIdentifier(tableName)} DEFAULT VALUES;`;
  const columnSql = columns.map(quoteSqlIdentifier).join(", ");
  const valueSql = row.map(sqlValueToLiteral).join(", ");
  return `INSERT INTO ${quoteSqlIdentifier(tableName)} (${columnSql}) VALUES (${valueSql});`;
}

function sqlValueText(value: SqlValue | undefined): string {
  if (!value || value.kind === "null") return "";
  if (value.kind === "blob") return JSON.stringify(value.value);
  return String(value.value);
}

function sqliteSequenceValue(value: string): string {
  return /^[+-]?\d+$/.test(value) ? value : quoteSqlText(value);
}

function sqlValueToLiteral(value: SqlValue): string {
  if (value.kind === "null") return "NULL";
  if (value.kind === "integer") return value.value;
  if (value.kind === "real") return String(value.value);
  if (value.kind === "blob") return `X'${value.value.map((byte) => byte.toString(16).padStart(2, "0")).join("")}'`;
  return quoteSqlText(value.value);
}

function quoteSqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
