"use client";

// icpdb-console/components/icpdb-account-panels.tsx
// Account-side storage quota controls plus token and permission panel exports.

import { HardDrive } from "lucide-react";
export { PermissionPanel } from "@/components/icpdb-permission-panel";
export { TokenPanel } from "@/components/icpdb-token-panel";

export function StorageQuotaPanel({
  canDeleteDatabase,
  canSetQuota,
  quotaBytes,
  onDeleteDatabase,
  onQuotaBytesChange,
  onSetQuota
}: {
  canDeleteDatabase: boolean;
  canSetQuota: boolean;
  quotaBytes: string;
  onDeleteDatabase: () => void;
  onQuotaBytesChange: (value: string) => void;
  onSetQuota: () => void;
}) {
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Storage / quota</h3>
        <HardDrive aria-hidden size={16} />
      </div>
      <div className="mt-3 grid gap-2">
        <input
          className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-sm text-[#182230]"
          inputMode="numeric"
          value={quotaBytes}
          onChange={(event) => onQuotaBytesChange(event.target.value)}
        />
        <button className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!canSetQuota} type="button" onClick={onSetQuota}>
          Set quota
        </button>
        <button className="rounded-md border border-[#fecdca] bg-white px-3 py-2 text-sm font-medium text-[#b42318] disabled:opacity-50" disabled={!canDeleteDatabase} type="button" onClick={onDeleteDatabase}>
          Delete database
        </button>
      </div>
    </div>
  );
}
