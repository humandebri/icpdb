"use client";

// icpdb-console/components/icpdb-table-list-panel.tsx
// Table/view picker with object-type filtering and create-table controls.

import { Plus, Search, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { DatabaseTable } from "@/lib/types";

export type TableListProps = {
  canCreateTable: boolean;
  createTableColumns: string;
  createTableName: string;
  tableName: string;
  tables: DatabaseTable[];
  onCreateTable: () => void;
  onCreateTableColumnsChange: (value: string) => void;
  onCreateTableNameChange: (value: string) => void;
  onSelectTable: (tableName: string) => void;
};

export function TableList({
  canCreateTable,
  createTableColumns,
  createTableName,
  tableName,
  tables,
  onCreateTable,
  onCreateTableColumnsChange,
  onCreateTableNameChange,
  onSelectTable
}: TableListProps) {
  const [tableSearch, setTableSearch] = useState("");
  const [objectTypeFilter, setObjectTypeFilter] = useState<TableObjectTypeFilter>("all");
  const tableObjectCounts = useMemo(() => countTableObjectTypes(tables), [tables]);
  const visibleTables = useMemo(() => filterTables(tables, tableSearch, objectTypeFilter, tableName), [objectTypeFilter, tableName, tableSearch, tables]);
  const filtered = tableSearch.trim() || objectTypeFilter !== "all";
  const tableCountLabel = filtered ? `${visibleTables.length}/${tables.length}` : String(tables.length);

  return (
    <div className="rounded-md border border-[#d5d9e2] bg-white">
      <div className="flex items-center justify-between border-b border-[#eef1f5] px-3 py-2">
        <h3 className="text-sm font-semibold">Tables</h3>
        <Table2 aria-hidden size={16} />
      </div>
      <div className="border-b border-[#eef1f5] p-2">
        <input
          className="w-full rounded-md border border-[#c9ced8] bg-white px-2 py-1.5 font-mono text-xs text-[#182230]"
          placeholder="table_name"
          value={createTableName}
          onChange={(event) => onCreateTableNameChange(event.target.value)}
        />
        <textarea
          className="mt-2 min-h-20 w-full resize-y rounded-md border border-[#c9ced8] bg-[#f7f8fb] px-2 py-1.5 font-mono text-xs leading-5 text-[#182230] outline-none"
          value={createTableColumns}
          onChange={(event) => onCreateTableColumnsChange(event.target.value)}
        />
        <button
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#2f6fed] bg-[#2f6fed] px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={!canCreateTable}
          type="button"
          onClick={onCreateTable}
        >
          <Plus aria-hidden size={14} />
          <span>Create table</span>
        </button>
      </div>
      <div className="border-b border-[#eef1f5] p-2">
        <div className="mb-2 grid grid-cols-3 overflow-hidden rounded-md border border-[#c9ced8] text-xs">
          {tableObjectTypeFilters.map((filter) => (
            <button
              aria-pressed={objectTypeFilter === filter.value}
              className={objectTypeFilter === filter.value ? activeTableFilterClass : inactiveTableFilterClass}
              key={filter.value}
              type="button"
              onClick={() => setObjectTypeFilter(filter.value)}
            >
              <span>{filter.label}</span>
              <span className="font-mono">{tableObjectCountLabel(filter.value, tableObjectCounts)}</span>
            </button>
          ))}
        </div>
        <label className="flex h-9 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
          <Search aria-hidden size={14} />
          <input
            aria-label="Search tables"
            className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
            placeholder="Search tables"
            value={tableSearch}
            onChange={(event) => setTableSearch(event.target.value)}
          />
          <span className="font-mono text-[#667085]">{tableCountLabel}</span>
        </label>
      </div>
      <div className="max-h-96 overflow-auto p-1">
        {tables.length === 0 ? <p className="px-2 py-3 text-sm text-[#5f6c7b]">No tables</p> : null}
        {tables.length > 0 && visibleTables.length === 0 ? <p className="px-2 py-3 text-sm text-[#5f6c7b]">No matching tables</p> : null}
        {visibleTables.map((table) => (
          <button
            className={table.name === tableName ? activeTableClass : inactiveTableClass}
            key={table.name}
            type="button"
            onClick={() => onSelectTable(table.name)}
          >
            <span className="truncate">{table.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              <span className="text-xs text-[#667085]">{table.objectType}</span>
              <span className={table.name === tableName ? selectedTableBadgeClass : inactiveTableBadgeClass}>
                {tableSelectionLabel(table.name, tableName)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

type TableObjectTypeFilter = "all" | "table" | "view";

const tableObjectTypeFilters: { label: string; value: TableObjectTypeFilter }[] = [
  { label: "All", value: "all" },
  { label: "Tables", value: "table" },
  { label: "Views", value: "view" }
];

function filterTables(tables: DatabaseTable[], tableSearch: string, objectTypeFilter: TableObjectTypeFilter, selectedTableName: string): DatabaseTable[] {
  const query = tableSearch.trim().toLowerCase();
  return tables.filter((table) => {
    const typeMatches = objectTypeFilter === "all" || table.objectType === objectTypeFilter;
    if (!typeMatches) return false;
    if (!query) return true;
    return [
      table.name,
      table.objectType,
      tableSelectionLabel(table.name, selectedTableName)
    ].some((field) => field.toLowerCase().includes(query));
  });
}

function countTableObjectTypes(tables: DatabaseTable[]): Record<TableObjectTypeFilter, number> {
  return {
    all: tables.length,
    table: tables.filter((table) => table.objectType === "table").length,
    view: tables.filter((table) => table.objectType === "view").length
  };
}

function tableObjectCountLabel(filter: TableObjectTypeFilter, counts: Record<TableObjectTypeFilter, number>): string {
  return String(counts[filter]);
}

function tableSelectionLabel(nextTableName: string, selectedTableName: string): string {
  return nextTableName === selectedTableName ? "selected" : "available";
}

const activeTableFilterClass = "flex h-8 items-center justify-center gap-1 bg-[#182230] px-2 font-medium text-white";
const inactiveTableFilterClass = "flex h-8 items-center justify-center gap-1 bg-white px-2 text-[#5f6c7b] hover:bg-[#f7f8fb]";
const activeTableClass =
  "flex w-full items-center justify-between gap-2 rounded-md bg-[#eaf1ff] px-2 py-2 text-left text-sm font-medium text-[#182230]";
const inactiveTableClass =
  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fb]";
const selectedTableBadgeClass =
  "rounded border border-[#2f6fed] bg-[#eaf1ff] px-1.5 py-0.5 text-[0.68rem] font-medium text-[#2f6fed]";
const inactiveTableBadgeClass =
  "rounded border border-[#d5d9e2] bg-white px-1.5 py-0.5 text-[0.68rem] font-medium text-[#667085]";
