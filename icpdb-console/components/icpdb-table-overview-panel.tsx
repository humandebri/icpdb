"use client";

// icpdb-console/components/icpdb-table-overview-panel.tsx
// Table overview metrics for selected row/cell state in the ICPDB Table Editor.

import { Code2, Hash, Plus, Search } from "lucide-react";
import { formatSqlValue } from "@/components/icpdb-display-panels";
import { canWriteColumn, columnKindLabel } from "@/lib/row-mutations";
import type { TableDescription, TablePreviewResponse } from "@/lib/types";

type TableOverviewPanelProps = {
  selectedCellColumnName: string;
  selectedRowIndex: number | null;
  tableDescription: TableDescription | null;
  tablePreview: TablePreviewResponse | null;
  onOpenCountSql: (tableName: string) => void;
  onOpenInsertSql: (tableDescription: TableDescription) => void;
  onOpenSchemaLookupSql: (tableName: string) => void;
  onOpenTableSql: (tableName: string) => void;
};

export function TableOverviewPanel({
  selectedCellColumnName,
  selectedRowIndex,
  tableDescription,
  tablePreview,
  onOpenCountSql,
  onOpenInsertSql,
  onOpenSchemaLookupSql,
  onOpenTableSql
}: TableOverviewPanelProps) {
  const canOpenInsertSql = Boolean(
    tableDescription?.objectType === "table" &&
    tableDescription.columns.some((column) => canWriteColumn(column) && column.defaultValue === null)
  );
  const selectedRowNumber = tablePreview && selectedRowIndex !== null
    ? String(tablePreview.offset + selectedRowIndex + 1)
    : "none";
  const selectedCell = selectedRowNumber === "none" || !selectedCellColumnName
    ? "none"
    : `${selectedCellColumnName} @ ${selectedRowNumber}`;
  const selectedValue = tablePreview && selectedRowIndex !== null && selectedCellColumnName
    ? formatSelectedCellValue(tablePreview, selectedRowIndex, selectedCellColumnName)
    : "none";
  const selectedColumn = selectedCellColumnName
    ? tableDescription?.columns.find((column) => column.name === selectedCellColumnName) ?? null
    : null;
  const selectedType = selectedColumn ? selectedColumn.declaredType || "dynamic" : "none";
  const selectedKind = selectedColumn ? columnKindLabel(selectedColumn) : "none";
  const metrics = [
    { label: "Rows", value: tablePreview?.totalCount ?? "0" },
    { label: "Columns", value: String(tableDescription?.columns.length ?? 0) },
    { label: "Indexes", value: String(tableDescription?.indexes.length ?? 0) },
    { label: "Foreign keys", value: String(tableDescription?.foreignKeys.length ?? 0) },
    { label: "Triggers", value: String(tableDescription?.triggers.length ?? 0) },
    { label: "Selected row", value: selectedRowNumber },
    { label: "Selected cell", value: selectedCell },
    { label: "Selected value", value: selectedValue },
    { label: "Selected type", value: selectedType },
    { label: "Selected kind", value: selectedKind }
  ];
  return (
    <section className="rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Table overview</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            aria-label={tableDescription ? `Open SELECT SQL for ${tableDescription.tableName}` : "Open SELECT SQL"}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
            disabled={!tableDescription}
            type="button"
            onClick={() => {
              if (tableDescription) onOpenTableSql(tableDescription.tableName);
            }}
          >
            <Search aria-hidden size={14} />
            <span>Open SELECT SQL</span>
          </button>
          <button
            aria-label={tableDescription ? `Open INSERT SQL for ${tableDescription.tableName}` : "Open INSERT SQL"}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
            disabled={!canOpenInsertSql}
            type="button"
            onClick={() => {
              if (tableDescription) onOpenInsertSql(tableDescription);
            }}
          >
            <Plus aria-hidden size={14} />
            <span>Open INSERT SQL</span>
          </button>
          <button
            aria-label={tableDescription ? `Open count SQL for ${tableDescription.tableName}` : "Open count SQL"}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
            disabled={!tableDescription}
            title="Open count SQL"
            type="button"
            onClick={() => {
              if (tableDescription) onOpenCountSql(tableDescription.tableName);
            }}
          >
            <Hash aria-hidden size={14} />
            <span>Open count SQL</span>
          </button>
          <button
            aria-label={tableDescription ? `Open schema lookup SQL for ${tableDescription.tableName}` : "Open schema lookup SQL"}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
            disabled={!tableDescription}
            title="Open schema lookup SQL"
            type="button"
            onClick={() => {
              if (tableDescription) onOpenSchemaLookupSql(tableDescription.tableName);
            }}
          >
            <Code2 aria-hidden size={14} />
            <span>Open schema lookup SQL</span>
          </button>
          <span className="rounded-md border border-[#eef1f5] px-2 py-1 font-mono text-xs text-[#5f6c7b]">
            {tableDescription?.objectType ?? "none"}
          </span>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]">
        {metrics.map((metric) => (
          <div className="rounded-md border border-[#eef1f5] px-3 py-2" key={metric.label}>
            <dt className="text-xs text-[#667085]">{metric.label}</dt>
            <dd className="mt-1 truncate font-mono text-sm text-[#182230]" title={metric.value}>{metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatSelectedCellValue(tablePreview: TablePreviewResponse, selectedRowIndex: number, selectedCellColumnName: string): string {
  const columnIndex = tablePreview.columns.findIndex((columnName) => columnName === selectedCellColumnName);
  const selectedValue = tablePreview.rows[selectedRowIndex]?.[columnIndex];
  return selectedValue ? formatSqlValue(selectedValue) : "none";
}
