"use client";

// icpdb-console/components/icpdb-data-grid.tsx
// Spreadsheet-style SQL row grid with sticky row numbers, sorting controls, and inline cell edit.

import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";
import type { DatabaseColumn, SqlValue } from "@/lib/types";
import { formatSqlValue, type GridColumnSort, type GridColumnSortDirection } from "@/lib/result-grid-helpers";

export function DataGrid({
  columns,
  columnSort,
  columnDetails = [],
  editValue,
  editableColumnNames = [],
  emptyLabel = "(no rows)",
  rowNumberOffset = 0,
  rowNumbers,
  rows,
  selectedColumnName,
  selectedRowIndex,
  onCommitEdit,
  onToggleColumnSort,
  onEditValueChange,
  onSelectCell,
  onSelectRow
}: {
  columns: string[];
  columnSort?: GridColumnSort | null;
  columnDetails?: DatabaseColumn[];
  editValue?: string;
  editableColumnNames?: string[];
  emptyLabel?: string;
  rowNumberOffset?: number;
  rowNumbers?: number[];
  rows: SqlValue[][];
  selectedColumnName?: string;
  selectedRowIndex?: number | null;
  onCommitEdit?: () => void;
  onToggleColumnSort?: (columnName: string) => void;
  onEditValueChange?: (value: string) => void;
  onSelectCell?: (rowIndex: number, columnName: string) => void;
  onSelectRow?: (rowIndex: number) => void;
}) {
  const isSelectable = Boolean(onSelectRow || onSelectCell);
  return (
    <div className="mt-4 max-h-72 overflow-auto rounded-md border border-[#d5d9e2] bg-white">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-[#f7f8fb] text-[#5f6c7b]">
          <tr>
            <th className="sticky left-0 z-20 w-12 border-b border-[#d5d9e2] bg-[#f7f8fb] px-2 py-2 text-right font-medium">#</th>
            {columns.map((column) => {
              const detail = columnDetailFor(columnDetails, column);
              const sortDirection = columnSort?.columnName === column ? columnSort.direction : null;
              return (
                <th className="border-b border-[#d5d9e2] px-2 py-2 font-medium" key={column}>
                  {onToggleColumnSort ? (
                    <button
                      aria-label={columnSortLabel(column, sortDirection)}
                      className="flex max-w-48 items-center gap-1 text-left font-mono text-[#182230]"
                      title={column}
                      type="button"
                      onClick={() => onToggleColumnSort(column)}
                    >
                      <span className="block truncate">{column}</span>
                      <SortIcon direction={sortDirection} />
                    </button>
                  ) : (
                    <span className="block truncate font-mono text-[#182230]" title={column}>{column}</span>
                  )}
                  {detail ? <span className="mt-1 block truncate text-[11px] font-normal text-[#667085]" title={columnHeaderTitle(detail)}>{columnHeaderMeta(detail)}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="sticky left-0 z-10 border-b border-[#eef1f5] bg-[#f7f8fb] px-2 py-6 text-right font-mono text-[#98a2b3]">-</td>
              <td className="border-b border-[#eef1f5] px-2 py-6 text-center text-[#667085]" colSpan={Math.max(columns.length, 1)}>
                {emptyLabel}
              </td>
            </tr>
          ) : null}
          {rows.map((row, rowIndex) => {
            const rowNumber = rowNumbers?.[rowIndex] ?? rowNumberOffset + rowIndex + 1;
            return (
              <tr
                className={selectedRowIndex === rowIndex ? "bg-[#eaf1ff]" : isSelectable ? "hover:bg-[#f7f8fb]" : ""}
                key={`${rowNumber}-${rowIndex}`}
              >
                <td
                  className={rowNumberCellClass(isSelectable, selectedRowIndex === rowIndex)}
                  onClick={() => onSelectRow?.(rowIndex)}
                >
                  {rowNumber}
                </td>
                {row.map((value, cellIndex) => {
                  const columnName = columns[cellIndex] ?? "";
                  const cellDisplayValue = formatSqlValue(value);
                  const isSelectedCell = selectedRowIndex === rowIndex && selectedColumnName === columnName;
                  const canInlineEdit = isSelectedCell && editableColumnNames.includes(columnName) && onEditValueChange && onCommitEdit;
                  return (
                    <td
                      className={dataGridCellClass(isSelectable, isSelectedCell)}
                      key={`${rowIndex}-${cellIndex}`}
                      title={cellDisplayValue}
                      onClick={() => {
                        onSelectCell?.(rowIndex, columnName);
                        if (!onSelectCell) onSelectRow?.(rowIndex);
                      }}
                    >
                      {canInlineEdit ? (
                        <span className="flex min-w-36 items-center gap-1">
                          <input
                            autoFocus
                            className="min-w-0 flex-1 rounded border border-[#2f6fed] bg-white px-2 py-1 font-mono text-xs text-[#182230] outline-none"
                            value={editValue ?? ""}
                            onChange={(event) => onEditValueChange(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                onCommitEdit();
                              }
                              if (event.key === "Escape") {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                          <button
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-[#2f6fed] bg-[#2f6fed] text-white"
                            title="Save cell"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onCommitEdit();
                            }}
                          >
                            <Check aria-hidden size={14} />
                          </button>
                        </span>
                      ) : cellDisplayValue}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortIcon({ direction }: { direction: GridColumnSortDirection | null }) {
  if (direction === "ascending") return <ArrowUp aria-hidden className="shrink-0" size={12} />;
  if (direction === "descending") return <ArrowDown aria-hidden className="shrink-0" size={12} />;
  return <ArrowUpDown aria-hidden className="shrink-0 text-[#98a2b3]" size={12} />;
}

function columnSortLabel(columnName: string, direction: GridColumnSortDirection | null): string {
  if (direction === "ascending") return `Sort ${columnName} descending`;
  if (direction === "descending") return `Clear ${columnName} sort`;
  return `Sort ${columnName} ascending`;
}

function columnDetailFor(columns: DatabaseColumn[], columnName: string): DatabaseColumn | null {
  return columns.find((column) => column.name === columnName) ?? null;
}

function columnHeaderMeta(column: DatabaseColumn): string {
  const parts = [column.declaredType || "dynamic"];
  if (column.primaryKeyPosition > 0) parts.push("PK");
  parts.push(column.notNull ? "not null" : "nullable");
  return parts.join(" / ");
}

function columnHeaderTitle(column: DatabaseColumn): string {
  return `${column.name}: ${columnHeaderMeta(column)}`;
}

function dataGridCellClass(isSelectable: boolean, isSelectedCell: boolean) {
  const base = "border-b border-[#eef1f5] px-2 py-2 font-mono";
  const selectable = isSelectable ? " cursor-pointer" : "";
  const selected = isSelectedCell ? " bg-[#dbeafe] ring-1 ring-inset ring-[#2f6fed]" : "";
  return `${base}${selectable}${selected}`;
}

function rowNumberCellClass(isSelectable: boolean, isSelectedRow: boolean) {
  const base = "sticky left-0 z-10 border-b border-[#eef1f5] bg-[#f7f8fb] px-2 py-2 text-right font-mono text-[#667085]";
  const selectable = isSelectable ? " cursor-pointer" : "";
  const selected = isSelectedRow ? " text-[#182230] ring-1 ring-inset ring-[#2f6fed]" : "";
  return `${base}${selectable}${selected}`;
}
