"use client";

// icpdb-console/components/icpdb-display-panels.tsx
// Shared ICPDB console display exports and small copyable metric fields.

import { Check, Copy } from "lucide-react";
import { useState } from "react";
export {
  BatchResultList,
  DataGrid,
  EmptyPanel,
  ResultTable,
  SqlResultSummary,
  downloadSqlRowsCsv,
  downloadTextFile,
  formatSqlValue,
  type GridColumnSort,
  type GridColumnSortDirection
} from "@/components/icpdb-result-grid";
export { ForeignKeyViewer, IndexViewer, TriggerViewer } from "@/components/icpdb-schema-viewers";
export { ShardOperationJournalPanel, ShardPlacementPanel } from "@/components/icpdb-shard-panels";
export { UsageEventSummaryPanel } from "@/components/icpdb-usage-events-panel";

export function MetricRow({ copyValue, label, value }: { copyValue?: string; label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const nextCopyValue = copyValue ?? "";
  async function copyMetric() {
    await navigator.clipboard.writeText(nextCopyValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#5f6c7b]">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="max-w-32 truncate font-mono" title={value}>{value}</span>
        {copyValue ? (
          <button
            aria-label={`Copy ${label}`}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#d5d9e2] bg-white text-[#344054]"
            title={copied ? "Copied" : `Copy ${label}`}
            type="button"
            onClick={() => void copyMetric()}
          >
            {copied ? <Check aria-hidden size={13} /> : <Copy aria-hidden size={13} />}
          </button>
        ) : null}
      </dd>
    </div>
  );
}

export function CanisterField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copyValue() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="min-w-0 rounded-md border border-[#d5d9e2] bg-[#fbfcff] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[#5f6c7b]">{label}</p>
        <button
          aria-label={`Copy ${label}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[#d5d9e2] bg-white text-[#344054] disabled:opacity-50"
          disabled={!value}
          title={copied ? "Copied" : `Copy ${label}`}
          type="button"
          onClick={() => void copyValue()}
        >
          {copied ? <Check aria-hidden size={13} /> : <Copy aria-hidden size={13} />}
        </button>
      </div>
      <p className="mt-1 truncate font-mono text-sm" title={value}>{value}</p>
    </div>
  );
}
