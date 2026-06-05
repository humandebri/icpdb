"use client";

// icpdb-console/components/icpdb-response-metrics-panel.tsx
// Response metrics, issued token copy, and storage usage meter for the SQLite admin sidebar.

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { MetricRow } from "@/components/icpdb-display-panels";
import { formatBytes, quotaUsagePercent } from "@/lib/workbench-state";
import type { DatabaseSummary, DatabaseTable, DatabaseTokenInfo, DatabaseUsage, SqlExecuteResponse } from "@/lib/types";

type ResponseMetricsProps = {
  batchResponses: SqlExecuteResponse[];
  canisterId: string;
  response: SqlExecuteResponse | null;
  selectedDatabase: DatabaseSummary | null;
  selectedTable: DatabaseTable | null;
  tokens: DatabaseTokenInfo[];
  usage: DatabaseUsage | null;
};

export function ResponseMetricsPanel(props: ResponseMetricsProps & { issuedToken: string | null }) {
  return (
    <>
      <ResponseMetrics {...props} />
      {props.issuedToken ? <IssuedTokenPanel token={props.issuedToken} /> : null}
    </>
  );
}

function IssuedTokenPanel({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  async function copyToken() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[#5f6c7b]">Issued token</p>
        <button
          aria-label="Copy issued token"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#d5d9e2] bg-white text-[#344054]"
          title={copied ? "Copied" : "Copy issued token"}
          type="button"
          onClick={() => void copyToken()}
        >
          {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
        </button>
      </div>
      <p className="mt-1 break-all font-mono text-xs">{token}</p>
    </div>
  );
}

function ResponseMetrics({
  batchResponses,
  canisterId,
  response,
  selectedDatabase,
  selectedTable,
  tokens,
  usage
}: ResponseMetricsProps) {
  const batchRowCount = batchResponses.reduce((total, nextResponse) => total + nextResponse.rows.length, 0);
  const batchRowSetCount = batchResponses.filter((nextResponse) => nextResponse.columns.length > 0).length;
  const batchAffectedCount = batchResponses.reduce((total, nextResponse) => total + BigInt(nextResponse.rowsAffected), 0n);
  const selectedDatabaseId = selectedDatabase?.databaseId ?? "none";
  const callerRole = selectedDatabase?.role ?? "none";
  const connectionUrl = selectedDatabase && canisterId ? formatConsoleConnectionUrl(canisterId, selectedDatabase.databaseId) : "none";
  return (
    <dl className="mt-4 space-y-3 text-sm">
      <MetricRow copyValue={selectedDatabase?.databaseId} label="Database" value={selectedDatabaseId} />
      <MetricRow label="Caller role" value={callerRole} />
      <MetricRow copyValue={selectedDatabase && canisterId ? connectionUrl : undefined} label="Connection URL" value={connectionUrl} />
      <MetricRow label="Table" value={selectedTable?.name ?? "none"} />
      <MetricRow label="Size" value={usage ? formatBytes(usage.logicalSizeBytes) : "0 B"} />
      <MetricRow label="Quota" value={usage ? formatBytes(usage.maxLogicalSizeBytes) : "0 B"} />
      <StorageUsageMeter usage={usage} />
      <MetricRow label="Usage events" value={usage?.usageEventCount ?? "0"} />
      <MetricRow label="API tokens" value={String(tokens.length)} />
      <MetricRow label="Rows" value={String(response?.rows.length ?? 0)} />
      <MetricRow label="Columns" value={String(response?.columns.length ?? 0)} />
      <MetricRow label="Batch statements" value={String(batchResponses.length)} />
      <MetricRow label="Batch row sets" value={String(batchRowSetCount)} />
      <MetricRow label="Batch rows" value={String(batchRowCount)} />
      <MetricRow label="Batch affected" value={batchAffectedCount.toString()} />
      <MetricRow label="Affected" value={response?.rowsAffected ?? "0"} />
      <MetricRow label="Insert rowid" value={response?.lastInsertRowId ?? "0"} />
      <MetricRow label="Truncated" value={response?.truncated ? "yes" : "no"} />
    </dl>
  );
}

function formatConsoleConnectionUrl(canisterId: string, databaseId: string): string {
  return `icpdb://${canisterId}/${encodeURIComponent(databaseId)}`;
}

function StorageUsageMeter({ usage }: { usage: DatabaseUsage | null }) {
  const percent = usage ? quotaUsagePercent(usage.logicalSizeBytes, usage.maxLogicalSizeBytes) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <dt className="text-[#667085]">Storage used</dt>
        <dd className="font-mono text-xs text-[#182230]">{percent.toFixed(2)}%</dd>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#eef1f5]" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-[#2f6fed]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
