"use client";

// icpdb-console/components/icpdb-backup-billing-panels.tsx
// Backup, restore, SQL dump, and ICP deposit panels for the console sidebar.

import { Archive, Coins, Download, RotateCcw, Search, Upload, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { MetricRow } from "@/components/icpdb-display-panels";
import { formatBytes, formatIcpE8s } from "@/lib/workbench-state";
import type { WalletStatus } from "@/lib/use-icpdb-billing-actions";
import type { DatabaseStatus, DepositQuote, PaymentRecord } from "@/lib/types";

type ArchiveSnapshotView = {
  databaseId: string;
  hashHex: string;
  sizeBytes: string;
};

export function BackupRestorePanel({
  archiveSnapshot,
  archiveSnapshotName,
  archiveStatus,
  canArchive,
  canCancelArchive,
  canDownloadArchive,
  canDownloadSqlDump,
  canLoadSqlDump,
  canRestore,
  canRun,
  selectedDatabaseStatus,
  sqlDumpStatus,
  onArchiveDatabase,
  onCancelArchive,
  onDownloadArchiveSnapshot,
  onDownloadSqlDump,
  onLoadArchiveFile,
  onLoadSqlDumpFile,
  onRestoreArchive
}: {
  archiveSnapshot: ArchiveSnapshotView | null;
  archiveSnapshotName: string | null;
  archiveStatus: string;
  canArchive: boolean;
  canCancelArchive: boolean;
  canDownloadArchive: boolean;
  canDownloadSqlDump: boolean;
  canLoadSqlDump: boolean;
  canRestore: boolean;
  canRun: boolean;
  selectedDatabaseStatus: DatabaseStatus | null;
  sqlDumpStatus: string;
  onArchiveDatabase: () => void;
  onCancelArchive: () => void;
  onDownloadArchiveSnapshot: () => void;
  onDownloadSqlDump: () => void;
  onLoadArchiveFile: (file: File | null) => void;
  onLoadSqlDumpFile: (file: File | null) => void;
  onRestoreArchive: () => void;
}) {
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Backup / restore</h3>
        <Archive aria-hidden size={16} />
      </div>
      <div className="mt-3 grid gap-2">
        <PanelButton disabled={!canArchive} icon={<Archive aria-hidden size={16} />} label="Archive current DB" onClick={onArchiveDatabase} />
        <PanelButton disabled={!canDownloadArchive} icon={<Download aria-hidden size={16} />} label="Download snapshot" onClick={onDownloadArchiveSnapshot} />
        <FilePanelButton accept=".db,.sqlite,.sqlite3,application/octet-stream" disabled={!canRun} icon={<Upload aria-hidden size={16} />} label="Load snapshot file" onFile={onLoadArchiveFile} />
        <PanelButton disabled={!canDownloadSqlDump} icon={<Download aria-hidden size={16} />} label="Download SQL dump" onClick={onDownloadSqlDump} />
        <FilePanelButton accept=".sql,text/sql,text/plain" disabled={!canLoadSqlDump} icon={<Upload aria-hidden size={16} />} label="Load SQL dump" onFile={onLoadSqlDumpFile} />
        <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!canRestore} type="button" onClick={onRestoreArchive}>
          <RotateCcw aria-hidden size={16} />
          <span>Restore snapshot</span>
        </button>
        <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#fecdca] bg-white px-3 py-2 text-sm font-medium text-[#b42318] disabled:opacity-50" disabled={!canCancelArchive} type="button" onClick={onCancelArchive}>
          <XCircle aria-hidden size={16} />
          <span>Cancel archive</span>
        </button>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        <MetricRow label="DB status" value={selectedDatabaseStatus ?? "none"} />
        <MetricRow label="Status" value={archiveStatus} />
        <MetricRow label="Source" value={archiveSnapshotName ?? "none"} />
        <MetricRow label="Snapshot DB" value={archiveSnapshot?.databaseId ?? "none"} />
        <MetricRow label="Snapshot" value={archiveSnapshot ? formatBytes(archiveSnapshot.sizeBytes) : "none"} />
        <MetricRow label="SQL dump" value={sqlDumpStatus} />
        <MetricRow label="SHA-256" value={archiveSnapshot?.hashHex ?? "none"} />
      </dl>
    </div>
  );
}

export function DepositPanel({
  canApproveDeposit,
  canDeposit,
  canQuoteDeposit,
  depositAmount,
  depositQuote,
  payments,
  walletOwner,
  walletStatus,
  onApproveDeposit,
  onDepositAmountChange,
  onDepositApproved,
  onQuoteDeposit
}: {
  canApproveDeposit: boolean;
  canDeposit: boolean;
  canQuoteDeposit: boolean;
  depositAmount: string;
  depositQuote: DepositQuote | null;
  payments: PaymentRecord[];
  walletOwner: string | null;
  walletStatus: WalletStatus;
  onApproveDeposit: () => void;
  onDepositAmountChange: (value: string) => void;
  onDepositApproved: () => void;
  onQuoteDeposit: () => void;
}) {
  const [paymentSearch, setPaymentSearch] = useState("");
  const visiblePayments = useMemo(() => filterPayments(payments, paymentSearch), [paymentSearch, payments]);
  const paymentCountLabel = paymentSearch.trim() ? `${visiblePayments.length}/${payments.length}` : String(payments.length);
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Deposit</h3>
        <Coins aria-hidden size={16} />
      </div>
      <div className="mt-3 grid gap-2">
        <input className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-sm text-[#182230]" inputMode="decimal" value={depositAmount} onChange={(event) => onDepositAmountChange(event.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          <button className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={!canQuoteDeposit} type="button" onClick={onQuoteDeposit}>Quote</button>
          <button className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={!canApproveDeposit} type="button" onClick={onApproveDeposit}>{walletStatus === "approving" ? "Approving" : "Approve"}</button>
          <button className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!canDeposit} type="button" onClick={onDepositApproved}>Deposit</button>
        </div>
      </div>
      {depositQuote ? (
        <div className="mt-3 space-y-2 text-xs">
          <MetricRow label="Fee ICP" value={formatIcpE8s(depositQuote.expectedFeeE8s)} />
          <MetricRow label="Credit units" value={depositQuote.creditedUnits} />
          <MetricRow label="Spender" value={depositQuote.spenderPrincipal} />
          <MetricRow label="Wallet" value={walletOwner ?? walletStatus} />
          <p className="break-all rounded-md bg-[#f7f8fb] p-2 font-mono text-[#344054]">
            ICRC-2 approve {formatIcpE8s(depositQuote.amountE8s)} ICP to {depositQuote.spenderPrincipal}
          </p>
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-[#667085]">
          <span>{payments.length} payments</span>
          <label className="flex h-8 min-w-0 max-w-48 flex-1 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2">
            <Search aria-hidden size={14} />
            <input
              aria-label="Search payments"
              className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
              placeholder="Search payments"
              value={paymentSearch}
              onChange={(event) => setPaymentSearch(event.target.value)}
            />
            <span className="font-mono">{paymentCountLabel}</span>
          </label>
        </div>
        <div className="max-h-48 space-y-2 overflow-auto pr-1">
          {payments.length === 0 ? <p className="text-xs text-[#667085]">No payments</p> : null}
          {payments.length > 0 && visiblePayments.length === 0 ? <p className="text-xs text-[#667085]">No matching payments</p> : null}
          {visiblePayments.map((payment) => (
            <div className="rounded-md border border-[#eef1f5] p-2 text-xs" key={payment.paymentId}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono">{formatIcpE8s(payment.amountE8s)} ICP</span>
                <span className="font-mono text-[#5f6c7b]">#{payment.blockIndex}</span>
              </div>
              <div className="mt-1 text-[#5f6c7b]">{payment.creditedUnits} units</div>
              <div className="mt-1 truncate font-mono text-[#5f6c7b]" title={payment.payerPrincipal}>{payment.payerPrincipal}</div>
              <div className="mt-1 text-[#5f6c7b]">{formatTimestamp(payment.createdAtMs)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function filterPayments(payments: PaymentRecord[], paymentSearch: string): PaymentRecord[] {
  const query = paymentSearch.trim().toLowerCase();
  if (!query) return payments;
  return payments.filter((payment) => {
    const fields = [
      payment.paymentId,
      payment.databaseId,
      payment.payerPrincipal,
      payment.amountE8s,
      formatIcpE8s(payment.amountE8s),
      payment.creditedUnits,
      payment.blockIndex,
      formatTimestamp(payment.createdAtMs)
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}

function formatTimestamp(timestampMs: string): string {
  const numericTimestamp = Number(timestampMs);
  if (!Number.isFinite(numericTimestamp)) return timestampMs;
  return new Date(numericTimestamp).toISOString();
}

function PanelButton({ disabled, icon, label, onClick }: { disabled: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={disabled} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FilePanelButton({ accept, disabled, icon, label, onFile }: { accept: string; disabled: boolean; icon: ReactNode; label: string; onFile: (file: File | null) => void }) {
  return (
    <label aria-disabled={disabled} className={fileLabelClass(disabled)}>
      {icon}
      <span>{label}</span>
      <input accept={accept} className="sr-only" disabled={disabled} type="file" onChange={(event) => {
        onFile(event.currentTarget.files?.[0] ?? null);
        event.currentTarget.value = "";
      }} />
    </label>
  );
}

function fileLabelClass(disabled: boolean): string {
  const base = "inline-flex items-center justify-center gap-2 rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230]";
  return disabled ? `${base} cursor-default opacity-50` : `${base} cursor-pointer`;
}
