"use client";

// icpdb-console/components/icpdb-response-sidebar.tsx
// Right-side console sidebar: response metrics, usage, shard status, access, backup, and billing groups.

import { ShardOperationJournalPanel, ShardPlacementPanel, UsageEventSummaryPanel } from "@/components/icpdb-display-panels";
import { RoutedOperationPanel } from "@/components/icpdb-operation-panel";
import { ResponseAccessPanel, ResponseLifecyclePanel } from "@/components/icpdb-response-admin-panels";
import { ResponseMetricsPanel } from "@/components/icpdb-response-metrics-panel";
import type { ArchiveSnapshot } from "@/lib/use-icpdb-backup-actions";
import type { WalletStatus } from "@/lib/use-icpdb-billing-actions";
import type {
  DatabaseBilling,
  DatabaseMember,
  DatabaseRole,
  DatabaseShardPlacement,
  DatabaseSummary,
  DatabaseTable,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  DepositQuote,
  PaymentRecord,
  RoutedOperationInfo,
  ShardOperationInfo,
  ShardOperationReconcileStatus,
  SqlExecuteResponse
} from "@/lib/types";

type ResponseSidebarProps = {
  archiveSnapshot: ArchiveSnapshot | null;
  archiveSnapshotName: string | null;
  archiveStatus: string;
  batchResponses: SqlExecuteResponse[];
  billing: DatabaseBilling | null;
  canApproveDeposit: boolean;
  canArchive: boolean;
  canCancelArchive: boolean;
  canDeleteDatabase: boolean;
  canDeposit: boolean;
  canDownloadArchive: boolean;
  canDownloadSqlDump: boolean;
  canGrantMember: boolean;
  canLoadSqlDump: boolean;
  canLoadRoutedOperation: boolean;
  canManageDatabase: boolean;
  canMutateMembers: boolean;
  canQuoteDeposit: boolean;
  canRestore: boolean;
  canRun: boolean;
  canSetQuota: boolean;
  depositAmount: string;
  depositQuote: DepositQuote | null;
  issuedToken: string | null;
  memberPrincipal: string;
  memberRole: DatabaseRole;
  operationId: string;
  operationStatus: string;
  members: DatabaseMember[];
  payments: PaymentRecord[];
  principal: string | null;
  quotaBytes: string;
  response: SqlExecuteResponse | null;
  routedOperation: RoutedOperationInfo | null;
  selectedDatabase: DatabaseSummary | null;
  selectedTable: DatabaseTable | null;
  shardJournalStatus: string;
  shardOperations: ShardOperationInfo[];
  shardPlacements: DatabaseShardPlacement[];
  shardPlacementStatus: string;
  shardReconcileError: string;
  sqlDumpStatus: string;
  tokenName: string;
  tokenScope: DatabaseTokenScope;
  tokens: DatabaseTokenInfo[];
  usage: DatabaseUsage | null;
  usageEvents: DatabaseUsageEventSummary[];
  walletOwner: string | null;
  walletStatus: WalletStatus;
  onApproveDeposit: () => void;
  onArchiveDatabase: () => void;
  onCancelArchive: () => void;
  onCreateToken: () => void;
  onDeleteDatabase: () => void;
  onDepositAmountChange: (value: string) => void;
  onDepositApproved: () => void;
  onDownloadArchiveSnapshot: () => void;
  onDownloadSqlDump: () => void;
  onGrantMember: () => void;
  onLoadArchiveFile: (file: File | null) => void;
  onLoadSqlDumpFile: (file: File | null) => void;
  onMemberPrincipalChange: (value: string) => void;
  onMemberRoleChange: (role: DatabaseRole) => void;
  onLoadRoutedOperation: () => void;
  onOperationIdChange: (value: string) => void;
  onQuotaBytesChange: (value: string) => void;
  onQuoteDeposit: () => void;
  onRefreshAllShardPlacements: () => void;
  onRefreshShardOperations: () => void;
  onReconcileShardOperation: (operation: ShardOperationInfo, status: ShardOperationReconcileStatus) => void;
  onRestoreArchive: () => void;
  onRevokeMember: (member: DatabaseMember) => void;
  onRevokeToken: (tokenId: string) => void;
  onSetQuota: () => void;
  onShardReconcileErrorChange: (value: string) => void;
  onTokenNameChange: (value: string) => void;
  onTokenScopeChange: (scope: DatabaseTokenScope) => void;
};

export function ResponseSidebar(props: ResponseSidebarProps) {
  return (
    <aside className="rounded-md border border-[#d5d9e2] bg-[#fbfcff] p-4">
      <h3 className="text-sm font-semibold">Response</h3>
      <ResponseMetricsPanel
        batchResponses={props.batchResponses}
        billing={props.billing}
        issuedToken={props.issuedToken}
        response={props.response}
        selectedDatabase={props.selectedDatabase}
        selectedTable={props.selectedTable}
        tokens={props.tokens}
        usage={props.usage}
      />
      <RoutedOperationPanel
        canLoad={props.canLoadRoutedOperation}
        operation={props.routedOperation}
        operationId={props.operationId}
        status={props.operationStatus}
        onLoadOperation={props.onLoadRoutedOperation}
        onOperationIdChange={props.onOperationIdChange}
      />
      <UsageEventSummaryPanel events={props.usageEvents} />
      <ShardPlacementPanel
        placements={props.shardPlacements}
        status={props.shardPlacementStatus}
        onRefreshAll={props.onRefreshAllShardPlacements}
      />
      <ShardOperationJournalPanel
        failureReason={props.shardReconcileError}
        operations={props.shardOperations}
        status={props.shardJournalStatus}
        onFailureReasonChange={props.onShardReconcileErrorChange}
        onReconcile={props.onReconcileShardOperation}
        onRefresh={props.onRefreshShardOperations}
      />
      <ResponseAccessPanel
        canDeleteDatabase={props.canDeleteDatabase}
        canGrantMember={props.canGrantMember}
        canManageDatabase={props.canManageDatabase}
        canMutateMembers={props.canMutateMembers}
        canSetQuota={props.canSetQuota}
        memberPrincipal={props.memberPrincipal}
        memberRole={props.memberRole}
        members={props.members}
        principal={props.principal}
        quotaBytes={props.quotaBytes}
        tokenName={props.tokenName}
        tokenScope={props.tokenScope}
        tokens={props.tokens}
        onCreateToken={props.onCreateToken}
        onDeleteDatabase={props.onDeleteDatabase}
        onGrantMember={props.onGrantMember}
        onMemberPrincipalChange={props.onMemberPrincipalChange}
        onMemberRoleChange={props.onMemberRoleChange}
        onQuotaBytesChange={props.onQuotaBytesChange}
        onRevokeMember={props.onRevokeMember}
        onRevokeToken={props.onRevokeToken}
        onSetQuota={props.onSetQuota}
        onTokenNameChange={props.onTokenNameChange}
        onTokenScopeChange={props.onTokenScopeChange}
      />
      <ResponseLifecyclePanel
        archiveSnapshot={props.archiveSnapshot}
        archiveSnapshotName={props.archiveSnapshotName}
        archiveStatus={props.archiveStatus}
        canApproveDeposit={props.canApproveDeposit}
        canArchive={props.canArchive}
        canCancelArchive={props.canCancelArchive}
        canDeposit={props.canDeposit}
        canDownloadArchive={props.canDownloadArchive}
        canDownloadSqlDump={props.canDownloadSqlDump}
        canLoadSqlDump={props.canLoadSqlDump}
        canQuoteDeposit={props.canQuoteDeposit}
        canRestore={props.canRestore}
        canRun={props.canRun}
        depositAmount={props.depositAmount}
        depositQuote={props.depositQuote}
        payments={props.payments}
        selectedDatabaseStatus={props.selectedDatabase?.status ?? null}
        sqlDumpStatus={props.sqlDumpStatus}
        walletOwner={props.walletOwner}
        walletStatus={props.walletStatus}
        onApproveDeposit={props.onApproveDeposit}
        onArchiveDatabase={props.onArchiveDatabase}
        onCancelArchive={props.onCancelArchive}
        onDepositAmountChange={props.onDepositAmountChange}
        onDepositApproved={props.onDepositApproved}
        onDownloadArchiveSnapshot={props.onDownloadArchiveSnapshot}
        onDownloadSqlDump={props.onDownloadSqlDump}
        onLoadArchiveFile={props.onLoadArchiveFile}
        onLoadSqlDumpFile={props.onLoadSqlDumpFile}
        onQuoteDeposit={props.onQuoteDeposit}
        onRestoreArchive={props.onRestoreArchive}
      />
    </aside>
  );
}
