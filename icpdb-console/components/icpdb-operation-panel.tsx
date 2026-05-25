"use client";

// icpdb-console/components/icpdb-operation-panel.tsx
// Routed operation status panel: lets token users inspect idempotent remote write outcomes.

import { Search } from "lucide-react";
import { MetricRow } from "@/components/icpdb-display-panels";
import type { RoutedOperationInfo } from "@/lib/types";

type RoutedOperationPanelProps = {
  canLoad: boolean;
  operation: RoutedOperationInfo | null;
  operationId: string;
  status: string;
  onLoadOperation: () => void;
  onOperationIdChange: (value: string) => void;
};

export function RoutedOperationPanel({
  canLoad,
  operation,
  operationId,
  status,
  onLoadOperation,
  onOperationIdChange
}: RoutedOperationPanelProps) {
  return (
    <section className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-[#344054]">Operation status</h4>
        <span className="rounded-md border border-[#d5d9e2] px-2 py-1 font-mono text-[11px] text-[#5f6c7b]">{status}</span>
      </div>
      <label className="mt-3 block text-xs text-[#5f6c7b]">
        Operation
        <div className="mt-1 flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-[#d5d9e2] px-2 py-1.5 font-mono text-xs text-[#182230]"
            placeholder="idempotency key"
            value={operationId}
            onChange={(event) => onOperationIdChange(event.target.value)}
          />
          <button
            aria-label="Lookup routed operation"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#2f6fed] bg-[#2f6fed] text-white disabled:cursor-not-allowed disabled:border-[#d5d9e2] disabled:bg-[#eef1f5] disabled:text-[#98a2b3]"
            disabled={!canLoad}
            title="Lookup routed operation"
            type="button"
            onClick={onLoadOperation}
          >
            <Search aria-hidden size={14} />
          </button>
        </div>
      </label>
      {operation ? (
        <dl className="mt-3 space-y-2 text-xs">
          <MetricRow copyValue={operation.operationId} label="Operation" value={operation.operationId} />
          <MetricRow label="State" value={operation.status} />
          <MetricRow label="Method" value={operation.method} />
          <MetricRow copyValue={operation.databaseCanisterId} label="Canister" value={operation.databaseCanisterId} />
          <MetricRow label="Updated" value={operation.updatedAtMs} />
          <MetricRow label="Error" value={operation.error ?? "none"} />
        </dl>
      ) : null}
    </section>
  );
}
