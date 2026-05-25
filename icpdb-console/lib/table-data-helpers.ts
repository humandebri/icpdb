// icpdb-console/lib/table-data-helpers.ts
// Current-page table preview search, current-page column sort, selection, and CSV filename helpers.

import { formatSqlValue, type GridColumnSort, type GridColumnSortDirection } from "@/lib/result-grid-helpers";
import type { SqlValue } from "@/lib/types";

export type PreviewRowEntry = {
  row: SqlValue[];
  rowIndex: number;
  rowNumber: number;
};

export function nextColumnSort(current: GridColumnSort | null, columnName: string): GridColumnSort | null {
  if (!current || current.columnName !== columnName) return { columnName, direction: "ascending" };
  if (current.direction === "ascending") return { columnName, direction: "descending" };
  return null;
}

export function filterPreviewRows(columns: string[], rows: SqlValue[][], rowNumberOffset: number, tableRowSearch: string): PreviewRowEntry[] {
  const entries = rows.map((row, rowIndex) => ({
    row,
    rowIndex,
    rowNumber: rowNumberOffset + rowIndex + 1
  }));
  const query = tableRowSearch.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => rowMatchesPreviewSearch(columns, entry, query));
}

export function sortPreviewRows(entries: PreviewRowEntry[], columns: string[], columnSort: GridColumnSort | null): PreviewRowEntry[] {
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

export function activeVisibleRowIndex(selectedRowIndex: number | null, visibleRowEntries: PreviewRowEntry[]): number | null {
  if (selectedRowIndex === null) return null;
  const visibleIndex = visibleRowEntries.findIndex((entry) => entry.rowIndex === selectedRowIndex);
  return visibleIndex === -1 ? null : visibleIndex;
}

export function tableCsvFileName(tableName: string): string {
  const trimmed = tableName.trim();
  const filePart = sanitizeCsvFilePart(trimmed.length > 0 ? trimmed : "table");
  return `icpdb-table-${filePart}.csv`;
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

function rowMatchesPreviewSearch(columns: string[], entry: PreviewRowEntry, query: string): boolean {
  const fields = [String(entry.rowNumber)];
  entry.row.forEach((value, index) => {
    fields.push(columns[index] ?? "");
    fields.push(formatSqlValue(value));
  });
  return fields.some((field) => field.toLowerCase().includes(query));
}

function sanitizeCsvFilePart(value: string): string {
  const normalized = value.toLowerCase();
  let output = "";
  for (const char of normalized) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isLetter = code >= 97 && code <= 122;
    const isAllowedPunctuation = char === "-" || char === "_" || char === ".";
    output += isDigit || isLetter || isAllowedPunctuation ? char : "-";
  }
  return output || "table";
}
