"use client";

// icpdb-console/components/icpdb-table-data-panel.tsx
// Current-page Table Editor grid controls, pagination, row search state, and cell edit wiring.

import { ChevronLeft, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DataGrid,
  EmptyPanel,
  downloadSqlRowsCsv,
  type GridColumnSort
} from "@/components/icpdb-display-panels";
import { activeVisibleRowIndex, filterPreviewRows, nextColumnSort, sortPreviewRows, tableCsvFileName } from "@/lib/table-data-helpers";
import { hasNextTablePage, tableLimitOptions, tablePageLabel } from "@/lib/workbench-state";
import type { DatabaseColumn, DatabaseTable, TableDescription, TablePreviewResponse } from "@/lib/types";

type TableDataPanelProps = {
  canUpdateCell: boolean;
  cellValue: string;
  editableColumns: DatabaseColumn[];
  loadState: "idle" | "loading" | "ready" | "error";
  selectedCellColumnName: string;
  selectedRowIndex: number | null;
  selectedTable: DatabaseTable | null;
  tableDescription: TableDescription | null;
  tableLimit: number;
  tableOffset: number;
  tablePreview: TablePreviewResponse | null;
  onCellValueChange: (value: string) => void;
  onChangeTableLimit: (value: string) => void;
  onLoadTablePage: (offset: number) => void;
  onSelectPreviewCell: (rowIndex: number, columnName: string) => void;
  onSelectPreviewRow: (rowIndex: number) => void;
  onUpdateCell: () => void;
};

export function TableDataPanel(props: TableDataPanelProps) {
  const { canUpdateCell, cellValue, editableColumns, loadState, selectedCellColumnName, selectedRowIndex, selectedTable, tableDescription, tableLimit, tableOffset, tablePreview } = props;
  const [tableRowSearch, setTableRowSearch] = useState("");
  const [columnSort, setColumnSort] = useState<GridColumnSort | null>(null);
  const previewColumns = useMemo(() => tablePreview?.columns ?? [], [tablePreview]);
  const previewRows = useMemo(() => tablePreview?.rows ?? [], [tablePreview]);
  const visibleRowEntries = useMemo(
    () => sortPreviewRows(filterPreviewRows(previewColumns, previewRows, tablePreview?.offset ?? 0, tableRowSearch), previewColumns, columnSort),
    [columnSort, previewColumns, previewRows, tablePreview?.offset, tableRowSearch]
  );
  const visibleRows = useMemo(() => visibleRowEntries.map((entry) => entry.row), [visibleRowEntries]);
  const visibleRowNumbers = useMemo(() => visibleRowEntries.map((entry) => entry.rowNumber), [visibleRowEntries]);
  const activeSelectedRowIndex = activeVisibleRowIndex(selectedRowIndex, visibleRowEntries);
  const isFilteringRows = tableRowSearch.trim().length > 0;
  const rowCountLabel = isFilteringRows && tablePreview ? `${visibleRowEntries.length}/${previewRows.length}` : String(previewRows.length);

  return (
    <section className="rounded-md border border-[#d5d9e2] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef1f5] px-3 py-2">
        <h3 className="min-w-0 truncate text-sm font-semibold">{selectedTable?.name ?? "No table selected"}</h3>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {tablePreview && previewRows.length > 0 ? (
            <label className="flex h-8 min-w-44 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
              <Search aria-hidden size={14} />
              <input
                aria-label="Search table rows"
                className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
                placeholder="Search table rows"
                value={tableRowSearch}
                onChange={(event) => setTableRowSearch(event.target.value)}
              />
              <span className="font-mono text-[#667085]">{rowCountLabel}</span>
            </label>
          ) : null}
          {tablePreview && previewRows.length > 0 ? (
            <button
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054]"
              type="button"
              onClick={() => downloadSqlRowsCsv(previewColumns, visibleRows, tableCsvFileName(selectedTable?.name ?? "table"))}
            >
              <Download aria-hidden size={14} />
              <span>Download table CSV</span>
            </button>
          ) : null}
          <span className="text-xs text-[#667085]">{tablePreview ? tablePageLabel(tablePreview) : "0 rows"}</span>
          <button
            aria-label="Refresh table rows"
            className="inline-flex size-8 items-center justify-center rounded-md border border-[#c9ced8] bg-white text-[#182230] disabled:opacity-50"
            disabled={!tablePreview || loadState === "loading"}
            title="Refresh table rows"
            type="button"
            onClick={() => props.onLoadTablePage(tableOffset)}
          >
            <RefreshCw aria-hidden size={16} />
          </button>
          <select
            className="h-8 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#182230]"
            disabled={!tablePreview || loadState === "loading"}
            value={tableLimit}
            onChange={(event) => props.onChangeTableLimit(event.target.value)}
          >
            {tableLimitOptions.map((limit) => (
              <option key={limit} value={limit}>{limit}</option>
            ))}
          </select>
          <button
            aria-label="Previous table page"
            className="inline-flex size-8 items-center justify-center rounded-md border border-[#c9ced8] bg-white text-[#182230] disabled:opacity-50"
            disabled={!tablePreview || tableOffset === 0 || loadState === "loading"}
            title="Previous table page"
            type="button"
            onClick={() => props.onLoadTablePage(tableOffset - tableLimit)}
          >
            <ChevronLeft aria-hidden size={16} />
          </button>
          <button
            aria-label="Next table page"
            className="inline-flex size-8 items-center justify-center rounded-md border border-[#c9ced8] bg-white text-[#182230] disabled:opacity-50"
            disabled={!tablePreview || !hasNextTablePage(tablePreview) || loadState === "loading"}
            title="Next table page"
            type="button"
            onClick={() => props.onLoadTablePage(tableOffset + tableLimit)}
          >
            <ChevronRight aria-hidden size={16} />
          </button>
        </div>
      </div>
      {tablePreview ? (
        <DataGrid
          columns={previewColumns}
          columnSort={columnSort}
          columnDetails={tableDescription?.columns ?? []}
          editableColumnNames={canUpdateCell ? editableColumns.map((column) => column.name) : []}
          editValue={cellValue}
          emptyLabel={isFilteringRows ? "No matching table rows" : undefined}
          rowNumberOffset={tablePreview.offset}
          rowNumbers={visibleRowNumbers}
          rows={visibleRows}
          selectedRowIndex={activeSelectedRowIndex}
          selectedColumnName={selectedCellColumnName}
          onCommitEdit={canUpdateCell ? props.onUpdateCell : undefined}
          onEditValueChange={canUpdateCell ? props.onCellValueChange : undefined}
          onToggleColumnSort={(columnName) => setColumnSort((current) => nextColumnSort(current, columnName))}
          onSelectRow={(rowIndex) => {
            const entry = visibleRowEntries[rowIndex];
            if (entry) props.onSelectPreviewRow(entry.rowIndex);
          }}
          onSelectCell={(rowIndex, columnName) => {
            const entry = visibleRowEntries[rowIndex];
            if (entry) props.onSelectPreviewCell(entry.rowIndex, columnName);
          }}
        />
      ) : (
        <EmptyPanel label="Select a table" />
      )}
    </section>
  );
}
