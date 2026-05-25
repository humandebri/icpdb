"use client";

// icpdb-console/components/icpdb-shard-panels.tsx
// Shard placement and shard journal panels for database-canister routing operations.

import { Check, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { DatabaseShardPlacement, ShardOperationInfo, ShardOperationReconcileStatus } from "@/lib/types";
import { formatEventTimestamp } from "@/components/icpdb-usage-events-panel";

export function ShardPlacementPanel({
  placements,
  status,
  onRefreshAll
}: {
  placements: DatabaseShardPlacement[];
  status: string;
  onRefreshAll: () => void;
}) {
  const [placementSearch, setPlacementSearch] = useState("");
  const visiblePlacements = useMemo(() => filterShardPlacements(placements, placementSearch), [placementSearch, placements]);
  const placementCountLabel = placementSearch.trim() ? `${visiblePlacements.length}/${placements.length}` : String(placements.length);
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Shard placement</h3>
          <p className="mt-1 text-xs text-[#667085]">{status}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {placements.length > 0 ? (
            <label className="flex h-8 min-w-40 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
              <Search aria-hidden size={14} />
              <input
                aria-label="Search shard placements"
                className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
                placeholder="Search placements"
                value={placementSearch}
                onChange={(event) => setPlacementSearch(event.target.value)}
              />
              <span className="font-mono text-[#667085]">{placementCountLabel}</span>
            </label>
          ) : null}
          <button className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] px-2 text-xs font-medium text-[#344054]" type="button" onClick={onRefreshAll}>
            <RefreshCw aria-hidden size={12} />
            <span>All</span>
          </button>
        </div>
      </div>
      {placements.length === 0 ? <p className="mt-3 text-xs text-[#667085]">No placements</p> : null}
      {placements.length > 0 ? (
        <div className="mt-3 max-h-56 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="text-[#667085]">
              <tr>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">DB</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Shard</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Status</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Slot</th>
              </tr>
            </thead>
            <tbody>
              {visiblePlacements.length === 0 ? (
                <tr>
                  <td className="border-b border-[#f2f4f7] py-3 text-center text-[#667085]" colSpan={4}>
                    No matching shard placements
                  </td>
                </tr>
              ) : null}
              {visiblePlacements.map((placement) => (
                <tr key={placement.databaseId}>
                  <td className="max-w-28 border-b border-[#f2f4f7] py-2 pr-3 font-mono" title={placement.databaseId}>
                    <span className="block truncate">{placement.databaseId}</span>
                  </td>
                  <td className="max-w-28 border-b border-[#f2f4f7] py-2 pr-3 font-mono" title={placement.canisterId ?? placement.shardId}>
                    <span className="block truncate">{placement.canisterId ?? placement.shardId}</span>
                  </td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3">{placement.status}</td>
                  <td className="border-b border-[#f2f4f7] py-2 font-mono">{placement.mountId ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function ShardOperationJournalPanel({
  failureReason,
  operations,
  status,
  onFailureReasonChange,
  onReconcile,
  onRefresh
}: {
  failureReason: string;
  operations: ShardOperationInfo[];
  status: string;
  onFailureReasonChange: (value: string) => void;
  onReconcile: (operation: ShardOperationInfo, status: ShardOperationReconcileStatus) => void;
  onRefresh: () => void;
}) {
  const [operationSearch, setOperationSearch] = useState("");
  const visibleOperations = useMemo(() => filterShardOperations(operations, operationSearch), [operationSearch, operations]);
  const operationCountLabel = operationSearch.trim() ? `${visibleOperations.length}/${operations.length}` : String(operations.length);
  const hasUnknownOperation = visibleOperations.some((operation) => operation.status === "unknown");
  const canMarkFailed = failureReason.trim().length > 0;
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Shard journal</h3>
          <p className="mt-1 text-xs text-[#667085]">{status}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {operations.length > 0 ? (
            <label className="flex h-8 min-w-40 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
              <Search aria-hidden size={14} />
              <input
                aria-label="Search shard operations"
                className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
                placeholder="Search operations"
                value={operationSearch}
                onChange={(event) => setOperationSearch(event.target.value)}
              />
              <span className="font-mono text-[#667085]">{operationCountLabel}</span>
            </label>
          ) : null}
          <button className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] px-2 text-xs font-medium text-[#344054]" type="button" onClick={onRefresh}>
            <RefreshCw aria-hidden size={12} />
            <span>Refresh</span>
          </button>
        </div>
      </div>
      {hasUnknownOperation ? (
        <label className="mt-3 block text-xs text-[#5f6c7b]">
          <span className="font-medium text-[#344054]">Failure reason</span>
          <input
            className="mt-1 h-8 w-full rounded-md border border-[#c9ced8] px-2 font-mono text-xs text-[#101828] outline-none focus:border-[#2f6fed]"
            onChange={(event) => onFailureReasonChange(event.target.value)}
            placeholder="required for failed"
            type="text"
            value={failureReason}
          />
        </label>
      ) : null}
      {operations.length === 0 ? <p className="mt-3 text-xs text-[#667085]">No operations</p> : null}
      {operations.length > 0 ? (
        <div className="mt-3 max-h-56 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="text-[#667085]">
              <tr>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Kind</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Status</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Target</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Hash</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleOperations.length === 0 ? (
                <tr>
                  <td className="border-b border-[#f2f4f7] py-3 text-center text-[#667085]" colSpan={5}>
                    No matching shard operations
                  </td>
                </tr>
              ) : null}
              {visibleOperations.map((operation) => (
                <tr key={operation.operationId}>
                  <td className="max-w-32 border-b border-[#f2f4f7] py-2 pr-3 font-mono" title={operation.operationId}>
                    <span className="block truncate">{operation.operationKind}</span>
                  </td>
                  <td className={operation.status === "unknown" ? "border-b border-[#f2f4f7] py-2 pr-3 font-medium text-[#b42318]" : "border-b border-[#f2f4f7] py-2 pr-3"}>
                    {operation.status}
                  </td>
                  <td className="max-w-32 border-b border-[#f2f4f7] py-2 pr-3 font-mono" title={operation.error ?? operation.target ?? ""}>
                    <span className="block truncate">{operation.target ?? operation.error ?? "-"}</span>
                  </td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{formatHash(operation.requestHash)}</td>
                  <td className="border-b border-[#f2f4f7] py-2">
                    {operation.status === "unknown" ? (
                      <div className="flex min-w-40 flex-wrap gap-1">
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-[#a6d8b8] px-2 text-xs font-medium text-[#027a48]"
                          type="button"
                          onClick={() => onReconcile(operation, "applied")}
                        >
                          <Check aria-hidden size={12} />
                          <span>Mark applied</span>
                        </button>
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-[#fecdca] px-2 text-xs font-medium text-[#b42318] disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!canMarkFailed}
                          type="button"
                          onClick={() => onReconcile(operation, "failed")}
                        >
                          <X aria-hidden size={12} />
                          <span>Mark failed</span>
                        </button>
                      </div>
                    ) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function filterShardPlacements(placements: DatabaseShardPlacement[], placementSearch: string): DatabaseShardPlacement[] {
  const query = placementSearch.trim().toLowerCase();
  if (!query) return placements;
  return placements.filter((placement) => {
    const fields = [
      placement.databaseId,
      placement.shardId,
      placement.canisterId ?? "",
      placement.status,
      String(placement.mountId ?? "-"),
      placement.schemaVersion,
      formatEventTimestamp(placement.createdAtMs),
      formatEventTimestamp(placement.updatedAtMs)
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}

function filterShardOperations(operations: ShardOperationInfo[], operationSearch: string): ShardOperationInfo[] {
  const query = operationSearch.trim().toLowerCase();
  if (!query) return operations;
  return operations.filter((operation) => {
    const fields = [
      operation.operationId,
      operation.operationKind,
      operation.status,
      operation.target ?? "",
      operation.error ?? "",
      formatHash(operation.requestHash),
      formatEventTimestamp(operation.createdAtMs),
      formatEventTimestamp(operation.updatedAtMs)
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}

function formatHash(bytes: number[]): string {
  return bytes.slice(0, 4).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
