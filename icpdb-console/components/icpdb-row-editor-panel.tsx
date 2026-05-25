"use client";

// icpdb-console/components/icpdb-row-editor-panel.tsx
// Row and cell editor controls for the ICPDB table editor surface.

import type { DatabaseColumn } from "@/lib/types";
import type { RowMutation } from "@/lib/row-mutations";

export type RowEditorPanelProps = {
  canEditRows: boolean;
  canMutateSelectedRow: boolean;
  canUpdateCell: boolean;
  cellValue: string;
  editStatus: string;
  editableColumns: DatabaseColumn[];
  primaryKeyColumns: DatabaseColumn[];
  rowJson: string;
  selectedCellColumnName: string;
  onCellValueChange: (value: string) => void;
  onChangeSelectedCellColumn: (columnName: string) => void;
  onMutateRow: (mutation: RowMutation) => void;
  onRowJsonChange: (value: string) => void;
  onStartNewRow: () => void;
  onUpdateCell: () => void;
};

export function RowEditorPanel(props: RowEditorPanelProps) {
  const {
    canEditRows,
    canMutateSelectedRow,
    canUpdateCell,
    cellValue,
    editStatus,
    editableColumns,
    primaryKeyColumns,
    rowJson,
    selectedCellColumnName,
    onCellValueChange,
    onChangeSelectedCellColumn,
    onMutateRow,
    onRowJsonChange,
    onStartNewRow,
    onUpdateCell
  } = props;
  const rowRecord = parseRowJson(rowJson);

  return (
    <section className="rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Row editor</h3>
          <p className="mt-1 text-xs text-[#667085]">{editStatus}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-md border border-[#c9ced8] bg-white px-3 py-1.5 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={!canEditRows} type="button" onClick={onStartNewRow}>
            New
          </button>
          <button className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={!canEditRows} type="button" onClick={() => onMutateRow("insert")}>
            Insert
          </button>
          <button className="rounded-md border border-[#c9ced8] bg-white px-3 py-1.5 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={!canMutateSelectedRow} type="button" onClick={() => onMutateRow("update")}>
            Update
          </button>
          <button className="rounded-md border border-[#fecdca] bg-white px-3 py-1.5 text-sm font-medium text-[#b42318] disabled:opacity-50" disabled={!canMutateSelectedRow} type="button" onClick={() => onMutateRow("delete")}>
            Delete
          </button>
        </div>
      </div>
      <textarea
        className="mt-3 min-h-32 w-full resize-y rounded-md border border-[#c9ced8] bg-[#0d1117] p-3 font-mono text-xs leading-5 text-[#d6e2ff] outline-none disabled:cursor-not-allowed disabled:bg-[#1f242f] disabled:text-[#98a2b3]"
        disabled={!canEditRows}
        value={rowJson}
        onChange={(event) => onRowJsonChange(event.target.value)}
      />
      <div className="mt-3 border-t border-[#eef1f5] pt-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold text-[#344054]">Column inputs</h4>
          <span className="text-xs text-[#667085]">{rowRecord ? `${editableColumns.length} editable` : "Fix row JSON"}</span>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {editableColumns.map((column) => (
            <label className="block" key={column.name}>
              <span className="block truncate text-xs text-[#667085]" title={column.name}>{column.name}</span>
              <input
                className="mt-1 w-full rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-xs text-[#182230] disabled:bg-[#f7f8fb]"
                disabled={!canEditRows || rowRecord === null}
                value={fieldValue(rowRecord, column.name)}
                onChange={(event) => onRowJsonChange(updateRowJsonField(rowRecord, column.name, event.target.value))}
              />
            </label>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-[#667085]">
        {primaryKeyColumns.length > 0 ? `Primary key: ${primaryKeyColumns.map((column) => column.name).join(", ")}` : "Update/delete require a primary key."}
      </p>
      <div className="mt-3 grid gap-2 border-t border-[#eef1f5] pt-3 md:grid-cols-[12rem_minmax(0,1fr)_auto]">
        <select
          className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm text-[#182230]"
          disabled={!canMutateSelectedRow || editableColumns.length === 0}
          value={selectedCellColumnName}
          onChange={(event) => onChangeSelectedCellColumn(event.target.value)}
        >
          {editableColumns.length === 0 ? <option value="">No editable column</option> : null}
          {editableColumns.map((column) => (
            <option key={column.name} value={column.name}>{column.name}</option>
          ))}
        </select>
        <input
          className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-sm text-[#182230]"
          disabled={!canUpdateCell}
          value={cellValue}
          onChange={(event) => onCellValueChange(event.target.value)}
        />
        <button
          className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!canUpdateCell}
          type="button"
          onClick={onUpdateCell}
        >
          Save cell
        </button>
      </div>
    </section>
  );
}

function parseRowJson(source: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(source);
    return isRowRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRowRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldValue(record: Record<string, unknown> | null, columnName: string): string {
  if (!record || !Object.hasOwn(record, columnName)) return "";
  const value = record[columnName];
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function updateRowJsonField(record: Record<string, unknown> | null, columnName: string, source: string): string {
  const nextRecord = { ...(record ?? {}) };
  nextRecord[columnName] = parseFieldValue(source);
  return JSON.stringify(nextRecord, null, 2);
}

function parseFieldValue(source: string): unknown {
  const trimmed = source.trim();
  if (trimmed.toLowerCase() === "null") return null;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return source;
    }
  }
  return source;
}
