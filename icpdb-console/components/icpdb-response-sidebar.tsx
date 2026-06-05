"use client";

// icpdb-console/components/icpdb-response-sidebar.tsx
// Right-side console sidebar: response metrics, usage, shard status, access, and lifecycle groups.

import { ShardOperationJournalPanel, ShardPlacementPanel, UsageEventSummaryPanel } from "@/components/icpdb-display-panels";
import { RoutedOperationPanel } from "@/components/icpdb-operation-panel";
import { ResponseAccessPanel, ResponseLifecyclePanel } from "@/components/icpdb-response-admin-panels";
import { ResponseMetricsPanel } from "@/components/icpdb-response-metrics-panel";
import type { ArchiveSnapshot } from "@/lib/use-icpdb-backup-actions";
import type {
  DatabaseMember,
  DatabaseRole,
  DatabaseShardPlacement,
  DatabaseSummary,
  DatabaseTable,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  RoutedOperationInfo,
  ShardOperationInfo,
  ShardOperationReconcileStatus,
  SqlExecuteResponse
} from "@/lib/types";

export type ResponseSidebarProps = {
  archiveSnapshot: ArchiveSnapshot | null;
  archiveSnapshotName: string | null;
  archiveStatus: string;
  batchResponses: SqlExecuteResponse[];
  canArchive: boolean;
  canCancelArchive: boolean;
  canisterId: string;
  canDeleteDatabase: boolean;
  canDownloadArchive: boolean;
  canDownloadSqlDump: boolean;
  canGrantMember: boolean;
  canLoadSqlDump: boolean;
  canLoadRoutedOperation: boolean;
  canManageDatabase: boolean;
  canMutateMembers: boolean;
  canRestore: boolean;
  canRun: boolean;
  canSetQuota: boolean;
  issuedToken: string | null;
  memberPrincipal: string;
  memberRole: DatabaseRole;
  operationId: string;
  operationStatus: string;
  members: DatabaseMember[];
  principal: string | null;
  quotaBytes: string;
  response: SqlExecuteResponse | null;
  routedOperation: RoutedOperationInfo | null;
  selectedDatabase: DatabaseSummary | null;
  selectedTable: DatabaseTable | null;
  showHostedPanels: boolean;
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
  onArchiveDatabase: () => void;
  onCancelArchive: () => void;
  onCreateToken: () => void;
  onDeleteDatabase: () => void;
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
        canisterId={props.canisterId}
        issuedToken={props.issuedToken}
        response={props.response}
        selectedDatabase={props.selectedDatabase}
        selectedTable={props.selectedTable}
        tokens={props.tokens}
        usage={props.usage}
      />
      {props.showHostedPanels ? (
        <>
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
            canArchive={props.canArchive}
            canCancelArchive={props.canCancelArchive}
            canDownloadArchive={props.canDownloadArchive}
            canDownloadSqlDump={props.canDownloadSqlDump}
            canLoadSqlDump={props.canLoadSqlDump}
            canRestore={props.canRestore}
            canRun={props.canRun}
            selectedDatabaseStatus={props.selectedDatabase?.status ?? null}
            sqlDumpStatus={props.sqlDumpStatus}
            onArchiveDatabase={props.onArchiveDatabase}
            onCancelArchive={props.onCancelArchive}
            onDownloadArchiveSnapshot={props.onDownloadArchiveSnapshot}
            onDownloadSqlDump={props.onDownloadSqlDump}
            onLoadArchiveFile={props.onLoadArchiveFile}
            onLoadSqlDumpFile={props.onLoadSqlDumpFile}
            onRestoreArchive={props.onRestoreArchive}
          />
        </>
      ) : null}
    </aside>
  );
}
