"use client";

// icpdb-console/components/icpdb-database-list-panel.tsx
// Searchable database list with lifecycle status, role, size, and archive/delete timestamps.

import { Database, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { formatBytes } from "@/lib/workbench-state";
import type { DatabaseSummary } from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

export function DatabaseList({
  databaseId,
  databases,
  loadState,
  onSelectDatabase
}: {
  databaseId: string;
  databases: DatabaseSummary[];
  loadState: LoadState;
  onSelectDatabase: (databaseId: string) => void;
}) {
  const [databaseSearch, setDatabaseSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<DatabaseLifecycleFilter>("all");
  const lifecycleCounts = useMemo(() => countDatabaseLifecycles(databases), [databases]);
  const visibleDatabases = useMemo(
    () => filterDatabases(databases, databaseSearch, databaseId, lifecycleFilter),
    [databaseId, databaseSearch, databases, lifecycleFilter]
  );
  const filtered = databaseSearch.trim() || lifecycleFilter !== "all";
  const databaseCountLabel = filtered ? `${visibleDatabases.length}/${databases.length}` : String(databases.length);

  return (
    <div className="rounded-md border border-[#d5d9e2] bg-white">
      <div className="flex items-center justify-between border-b border-[#eef1f5] px-3 py-2">
        <h3 className="text-sm font-semibold">Databases</h3>
        <Database aria-hidden size={16} />
      </div>
      <div className="border-b border-[#eef1f5] p-2">
        <div className="mb-2 grid grid-cols-4 overflow-hidden rounded-md border border-[#c9ced8] text-xs">
          {databaseLifecycleFilters.map((filter) => (
            <button
              aria-pressed={lifecycleFilter === filter.value}
              className={lifecycleFilter === filter.value ? activeLifecycleFilterClass : inactiveLifecycleFilterClass}
              key={filter.value}
              type="button"
              onClick={() => setLifecycleFilter(filter.value)}
            >
              <span>{filter.label}</span>
              <span className="font-mono">{databaseLifecycleCountLabel(filter.value, lifecycleCounts)}</span>
            </button>
          ))}
        </div>
        <label className="flex h-9 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
          <Search aria-hidden size={14} />
          <input
            aria-label="Search databases"
            className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
            placeholder="Search databases"
            value={databaseSearch}
            onChange={(event) => setDatabaseSearch(event.target.value)}
          />
          <span className="font-mono text-[#667085]">{databaseCountLabel}</span>
        </label>
      </div>
      <div className="max-h-56 overflow-auto p-1">
        {databases.length === 0 ? <p className="px-2 py-3 text-sm text-[#5f6c7b]">No databases</p> : null}
        {databases.length > 0 && visibleDatabases.length === 0 ? <p className="px-2 py-3 text-sm text-[#5f6c7b]">No matching databases</p> : null}
        {visibleDatabases.map((database) => (
          <button
            className={database.databaseId === databaseId ? activeDatabaseClass : inactiveDatabaseClass}
            disabled={loadState === "loading"}
            key={database.databaseId}
            type="button"
            onClick={() => onSelectDatabase(database.databaseId)}
          >
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono">{database.databaseId}</span>
              <span className={database.databaseId === databaseId ? selectedDatabaseBadgeClass : inactiveDatabaseBadgeClass}>
                {databaseSelectionLabel(database.databaseId, databaseId)}
              </span>
            </span>
            <span className="grid grid-cols-3 gap-2 text-xs text-[#667085]">
              <span className="truncate">{database.status}</span>
              <span className="truncate">{database.role}</span>
              <span className="truncate text-right">{formatBytes(database.logicalSizeBytes)}</span>
            </span>
            <span className="truncate font-mono text-xs text-[#667085]" title={databaseLifecycleLabel(database)}>
              {databaseLifecycleLabel(database)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

type DatabaseLifecycleFilter = "all" | "current" | "archived" | "deleted";

const databaseLifecycleFilters: { label: string; value: DatabaseLifecycleFilter }[] = [
  { label: "All", value: "all" },
  { label: "Current", value: "current" },
  { label: "Archived", value: "archived" },
  { label: "Deleted", value: "deleted" }
];

function filterDatabases(
  databases: DatabaseSummary[],
  databaseSearch: string,
  selectedDatabaseId: string,
  lifecycleFilter: DatabaseLifecycleFilter
): DatabaseSummary[] {
  const query = databaseSearch.trim().toLowerCase();
  return databases.filter((database) => {
    if (!databaseLifecycleMatches(database, lifecycleFilter)) return false;
    if (!query) return true;
    const fields = [
      database.databaseId,
      database.status,
      database.role,
      formatBytes(database.logicalSizeBytes),
      databaseSelectionLabel(database.databaseId, selectedDatabaseId),
      databaseLifecycleLabel(database)
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}

function databaseLifecycleMatches(database: DatabaseSummary, lifecycleFilter: DatabaseLifecycleFilter): boolean {
  return lifecycleFilter === "all" || databaseLifecycleFilterValue(database) === lifecycleFilter;
}

function countDatabaseLifecycles(databases: DatabaseSummary[]): Record<DatabaseLifecycleFilter, number> {
  return {
    all: databases.length,
    current: databases.filter((database) => databaseLifecycleFilterValue(database) === "current").length,
    archived: databases.filter((database) => databaseLifecycleFilterValue(database) === "archived").length,
    deleted: databases.filter((database) => databaseLifecycleFilterValue(database) === "deleted").length
  };
}

function databaseLifecycleCountLabel(filter: DatabaseLifecycleFilter, counts: Record<DatabaseLifecycleFilter, number>): string {
  return String(counts[filter]);
}

function databaseLifecycleFilterValue(database: DatabaseSummary): Exclude<DatabaseLifecycleFilter, "all"> {
  if (database.deletedAtMs) return "deleted";
  if (database.archivedAtMs) return "archived";
  return "current";
}

function databaseLifecycleLabel(database: DatabaseSummary): string {
  if (database.deletedAtMs) return `deleted ${formatDatabaseLifecycleTimestamp(database.deletedAtMs)}`;
  if (database.archivedAtMs) return `archived ${formatDatabaseLifecycleTimestamp(database.archivedAtMs)}`;
  return database.status === "hot" ? "current" : database.status;
}

function databaseSelectionLabel(databaseId: string, selectedDatabaseId: string): string {
  return databaseId === selectedDatabaseId ? "selected" : "available";
}

function formatDatabaseLifecycleTimestamp(timestampMs: string): string {
  const numericTimestamp = Number(timestampMs);
  if (!Number.isFinite(numericTimestamp)) return timestampMs;
  return new Date(numericTimestamp).toISOString();
}

const activeDatabaseClass =
  "grid w-full gap-1 rounded-md bg-[#eaf1ff] px-2 py-2 text-left text-sm font-medium text-[#182230] disabled:opacity-50";
const inactiveDatabaseClass =
  "grid w-full gap-1 rounded-md px-2 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fb] disabled:opacity-50";
const activeLifecycleFilterClass = "flex h-8 min-w-0 items-center justify-center gap-1 bg-[#182230] px-1 font-medium text-white";
const inactiveLifecycleFilterClass = "flex h-8 min-w-0 items-center justify-center gap-1 bg-white px-1 text-[#5f6c7b] hover:bg-[#f7f8fb]";
const selectedDatabaseBadgeClass =
  "shrink-0 rounded border border-[#2f6fed] bg-[#eaf1ff] px-1.5 py-0.5 text-[0.68rem] font-medium text-[#2f6fed]";
const inactiveDatabaseBadgeClass =
  "shrink-0 rounded border border-[#d5d9e2] bg-white px-1.5 py-0.5 text-[0.68rem] font-medium text-[#667085]";
