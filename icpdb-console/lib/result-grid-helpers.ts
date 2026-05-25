// icpdb-console/lib/result-grid-helpers.ts
// Shared SQL value formatting, CSV export, and result-grid row search/sort helpers.

import type { SqlValue } from "@/lib/types";

export type GridColumnSortDirection = "ascending" | "descending";

export type GridColumnSort = {
  columnName: string;
  direction: GridColumnSortDirection;
};

export type ResultRowEntry = {
  row: SqlValue[];
  rowNumber: number;
};

export function formatSqlValue(value: SqlValue): string {
  if (value.kind === "null") return "NULL";
  if (value.kind === "blob") return `<${value.value.length} bytes>`;
  return String(value.value);
}

export function downloadSqlRowsCsv(columns: string[], rows: SqlValue[][], fileName: string) {
  downloadTextFile(buildResultCsv(columns, rows), fileName, "text/csv;charset=utf-8");
}

export function downloadTextFile(data: string, fileName: string, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function filterResultRows(columns: string[], rows: SqlValue[][], resultSearch: string): ResultRowEntry[] {
  const entries = rows.map((row, index) => ({ row, rowNumber: index + 1 }));
  const query = resultSearch.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => rowMatchesResultSearch(columns, entry, query));
}

export function nextColumnSort(current: GridColumnSort | null, columnName: string): GridColumnSort | null {
  if (!current || current.columnName !== columnName) return { columnName, direction: "ascending" };
  if (current.direction === "ascending") return { columnName, direction: "descending" };
  return null;
}

export function sortResultRows(entries: ResultRowEntry[], columns: string[], columnSort: GridColumnSort | null): ResultRowEntry[] {
  if (!columnSort) return entries;
  const columnIndex = columns.indexOf(columnSort.columnName);
  if (columnIndex === -1) return entries;
  const direction = sortDirectionMultiplier(columnSort.direction);
  return [...entries].sort((left, right) => {
    const valueOrder = compareSqlValues(left.row[columnIndex] ?? { kind: "null" }, right.row[columnIndex] ?? { kind: "null" });
    if (valueOrder !== 0) return valueOrder * direction;
    return left.rowNumber - right.rowNumber;
  });
}

function buildResultCsv(columns: string[], rows: SqlValue[][]): string {
  return [
    columns.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map((value) => escapeCsvField(formatSqlValue(value))).join(","))
  ].join("\n");
}

function escapeCsvField(value: string): string {
  const escaped = value.replaceAll("\"", "\"\"");
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function sortDirectionMultiplier(direction: GridColumnSortDirection): number {
  return direction === "ascending" ? 1 : -1;
}

function compareSqlValues(left: SqlValue, right: SqlValue): number {
  if (left.kind === "integer" && right.kind === "integer") return compareIntegerStrings(left.value, right.value);
  if (isNumericSqlValue(left) && isNumericSqlValue(right)) return numericSqlValue(left) - numericSqlValue(right);
  const rankOrder = sqlValueRank(left) - sqlValueRank(right);
  if (rankOrder !== 0) return rankOrder;
  if (left.kind === "text" && right.kind === "text") return left.value.localeCompare(right.value);
  if (left.kind === "blob" && right.kind === "blob") return compareBlobValues(left.value, right.value);
  return formatSqlValue(left).localeCompare(formatSqlValue(right));
}

function compareIntegerStrings(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function isNumericSqlValue(value: SqlValue): boolean {
  return value.kind === "integer" || value.kind === "real";
}

function numericSqlValue(value: SqlValue): number {
  if (value.kind === "integer") return Number(value.value);
  if (value.kind === "real") return value.value;
  return 0;
}

function sqlValueRank(value: SqlValue): number {
  if (value.kind === "null") return 0;
  if (value.kind === "integer" || value.kind === "real") return 1;
  if (value.kind === "text") return 2;
  return 3;
}

function compareBlobValues(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function rowMatchesResultSearch(columns: string[], entry: ResultRowEntry, query: string): boolean {
  if (String(entry.rowNumber).includes(query)) return true;
  return columns.some((column, index) => {
    const value = formatSqlValue(entry.row[index] ?? { kind: "null" });
    return column.toLowerCase().includes(query) || value.toLowerCase().includes(query);
  });
}
