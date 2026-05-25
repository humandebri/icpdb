// icpdb-console/lib/row-mutations.ts
// Table editor row mutation helpers: convert grid edits into parameterized SQLite statements.

import { quoteSqlIdentifier } from "@/lib/sql-dump";
import type {
  DatabaseColumn,
  SqlExecuteRequest,
  SqlValue,
  TableDescription,
  TablePreviewResponse
} from "@/lib/types";

export type RowMutation = "insert" | "update" | "delete";
export type RowDraftValue = string | number | number[] | null;

export function buildInsertRequest(databaseId: string, table: TableDescription, source: string): SqlExecuteRequest {
  const record = parseRowRecord(source);
  const columns = table.columns.filter((column) => canWriteColumn(column) && Object.hasOwn(record, column.name));
  if (columns.length === 0) {
    throw new Error("row JSON must include at least one column");
  }
  const sql = `INSERT INTO ${quoteSqlIdentifier(table.tableName)} (${columns
    .map((column) => quoteSqlIdentifier(column.name))
    .join(", ")}) VALUES (${columns.map((_, index) => `?${index + 1}`).join(", ")})`;
  return {
    databaseId,
    sql,
    params: columns.map((column) => columnValueToSqlValue(record[column.name], column)),
    maxRows: null
  };
}

export function buildNewRowDraft(table: TableDescription): Record<string, RowDraftValue> {
  const draft: Record<string, RowDraftValue> = {};
  for (const column of table.columns) {
    if (!canWriteColumn(column) || column.defaultValue !== null) {
      continue;
    }
    draft[column.name] = draftValueForColumn(column);
  }
  return draft;
}

export function buildSelectedRowMutationRequest(
  databaseId: string,
  table: TableDescription,
  preview: TablePreviewResponse,
  selectedRowIndex: number | null,
  source: string,
  mutation: RowMutation
): SqlExecuteRequest {
  if (selectedRowIndex === null) {
    throw new Error("select a row first");
  }
  const selectedRow = preview.rows[selectedRowIndex];
  if (!selectedRow) {
    throw new Error("selected row is no longer available");
  }
  const primaryKeyColumns = table.columns
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
  if (primaryKeyColumns.length === 0) {
    throw new Error("update/delete require a primary key");
  }
  const whereValues = primaryKeyColumns.map((column) => selectedRowValue(preview, selectedRow, column.name));
  const whereSql = primaryKeyColumns
    .map((column, index) => `${quoteSqlIdentifier(column.name)} = ?${index + 1}`)
    .join(" AND ");
  if (mutation === "delete") {
    return {
      databaseId,
      sql: `DELETE FROM ${quoteSqlIdentifier(table.tableName)} WHERE ${whereSql}`,
      params: whereValues,
      maxRows: null
    };
  }
  const record = parseRowRecord(source);
  const mutableColumns = table.columns.filter(
    (column) => canWriteColumn(column) && Object.hasOwn(record, column.name)
  );
  if (mutableColumns.length === 0) {
    throw new Error("row JSON must include at least one non-primary-key column");
  }
  const setSql = mutableColumns
    .map((column, index) => `${quoteSqlIdentifier(column.name)} = ?${index + 1}`)
    .join(", ");
  const whereOffset = mutableColumns.length;
  const shiftedWhereSql = primaryKeyColumns
    .map((column, index) => `${quoteSqlIdentifier(column.name)} = ?${whereOffset + index + 1}`)
    .join(" AND ");
  return {
    databaseId,
    sql: `UPDATE ${quoteSqlIdentifier(table.tableName)} SET ${setSql} WHERE ${shiftedWhereSql}`,
    params: [
      ...mutableColumns.map((column) => columnValueToSqlValue(record[column.name], column)),
      ...whereValues
    ],
    maxRows: null
  };
}

export function buildSelectedCellMutationRequest(
  databaseId: string,
  table: TableDescription,
  preview: TablePreviewResponse,
  selectedRowIndex: number | null,
  column: DatabaseColumn,
  source: string
): SqlExecuteRequest {
  if (selectedRowIndex === null) {
    throw new Error("select a row first");
  }
  const selectedRow = preview.rows[selectedRowIndex];
  if (!selectedRow) {
    throw new Error("selected row is no longer available");
  }
  if (column.primaryKeyPosition > 0) {
    throw new Error("primary key cells must be edited with row JSON");
  }
  const primaryKeyColumns = table.columns
    .filter((tableColumn) => tableColumn.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
  if (primaryKeyColumns.length === 0) {
    throw new Error("cell update requires a primary key");
  }
  const whereSql = primaryKeyColumns
    .map((primaryKeyColumn, index) => `${quoteSqlIdentifier(primaryKeyColumn.name)} = ?${index + 2}`)
    .join(" AND ");
  return {
    databaseId,
    sql: `UPDATE ${quoteSqlIdentifier(table.tableName)} SET ${quoteSqlIdentifier(column.name)} = ?1 WHERE ${whereSql}`,
    params: [
      columnValueToSqlValue(parseCellValue(source), column),
      ...primaryKeyColumns.map((primaryKeyColumn) => selectedRowValue(preview, selectedRow, primaryKeyColumn.name))
    ],
    maxRows: null
  };
}

export function rowToJsonObject(columns: string[], row: SqlValue[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [index, column] of columns.entries()) {
    result[column] = sqlValueToJson(row[index] ?? { kind: "null" });
  }
  return result;
}

export function cellValueForRow(preview: TablePreviewResponse, row: SqlValue[], columnName: string): string {
  if (!columnName) return "";
  const columnIndex = preview.columns.indexOf(columnName);
  if (columnIndex < 0) return "";
  return sqlValueToCellValue(row[columnIndex] ?? { kind: "null" });
}

export function isBlobColumn(column: DatabaseColumn): boolean {
  return column.declaredType.toUpperCase().includes("BLOB");
}

export function canWriteColumn(column: DatabaseColumn): boolean {
  return column.primaryKeyPosition === 0 && column.hidden === 0;
}

export function columnKindLabel(column: DatabaseColumn): string {
  if (column.hidden === 2) return "generated virtual";
  if (column.hidden === 3) return "generated stored";
  if (column.hidden > 0) return "hidden";
  if (column.primaryKeyPosition > 0) return "primary";
  return "regular";
}

function draftValueForColumn(column: DatabaseColumn): RowDraftValue {
  if (!column.notNull) {
    return null;
  }
  if (isBlobColumn(column)) {
    return [];
  }
  if (isIntegerColumn(column)) {
    return 0;
  }
  if (isRealColumn(column)) {
    return 0;
  }
  return "";
}

function selectedRowValue(preview: TablePreviewResponse, row: SqlValue[], columnName: string): SqlValue {
  const columnIndex = preview.columns.indexOf(columnName);
  if (columnIndex < 0) {
    throw new Error(`primary key column missing from preview: ${columnName}`);
  }
  return row[columnIndex] ?? { kind: "null" };
}

function sqlValueToCellValue(value: SqlValue): string {
  if (value.kind === "null") return "null";
  if (value.kind === "blob") return JSON.stringify(value.value);
  return String(value.value);
}

function parseCellValue(source: string): unknown {
  return source.trim().toLowerCase() === "null" ? null : source;
}

function parseRowRecord(source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source);
  if (!isPlainRecord(parsed)) {
    throw new Error("row JSON must be an object");
  }
  return parsed;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function columnValueToSqlValue(value: unknown, column: DatabaseColumn): SqlValue {
  if (value === null) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "integer", value: value ? "1" : "0" };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!Number.isInteger(value)) return { kind: "real", value };
    if (!Number.isSafeInteger(value)) {
      throw new Error(`integer value is outside JS safe range: ${column.name}`);
    }
    return { kind: "integer", value: String(value) };
  }
  if (typeof value === "string") {
    return stringColumnValueToSqlValue(value, column);
  }
  if (Array.isArray(value) && value.every(isByteValue)) {
    return { kind: "blob", value };
  }
  throw new Error(`unsupported value for column: ${column.name}`);
}

function isIntegerColumn(column: DatabaseColumn): boolean {
  return column.declaredType.toUpperCase().includes("INT");
}

function isRealColumn(column: DatabaseColumn): boolean {
  const declaredType = column.declaredType.toUpperCase();
  return declaredType.includes("REAL") || declaredType.includes("FLOA") || declaredType.includes("DOUB");
}

function stringColumnValueToSqlValue(value: string, column: DatabaseColumn): SqlValue {
  const declaredType = column.declaredType.toUpperCase();
  if (declaredType.includes("BLOB")) {
    throw new Error(`blob column requires a byte array: ${column.name}`);
  }
  if (declaredType.includes("INT")) {
    if (!/^-?\d+$/.test(value)) {
      throw new Error(`integer column requires an integer string: ${column.name}`);
    }
    return { kind: "integer", value };
  }
  if (declaredType.includes("REAL") || declaredType.includes("FLOA") || declaredType.includes("DOUB")) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`real column requires a numeric string: ${column.name}`);
    }
    return { kind: "real", value: parsed };
  }
  return { kind: "text", value };
}

function isByteValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

function sqlValueToJson(value: SqlValue): unknown {
  if (value.kind === "null") return null;
  if (value.kind === "blob") return value.value;
  return value.value;
}
