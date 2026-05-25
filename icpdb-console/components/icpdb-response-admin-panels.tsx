"use client";

// icpdb-console/components/icpdb-response-admin-panels.tsx
// Sidebar admin composition: groups access controls and backup/billing controls.

import { PermissionPanel, StorageQuotaPanel, TokenPanel } from "@/components/icpdb-account-panels";
import { BackupRestorePanel, DepositPanel } from "@/components/icpdb-backup-billing-panels";
import type { ArchiveSnapshot } from "@/lib/use-icpdb-backup-actions";
import type { WalletStatus } from "@/lib/use-icpdb-billing-actions";
import type {
  DatabaseMember,
  DatabaseRole,
  DatabaseStatus,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DepositQuote,
  PaymentRecord
} from "@/lib/types";

type ResponseAccessPanelProps = {
  canDeleteDatabase: boolean;
  canGrantMember: boolean;
  canManageDatabase: boolean;
  canMutateMembers: boolean;
  canSetQuota: boolean;
  memberPrincipal: string;
  memberRole: DatabaseRole;
  members: DatabaseMember[];
  principal: string | null;
  quotaBytes: string;
  tokenName: string;
  tokenScope: DatabaseTokenScope;
  tokens: DatabaseTokenInfo[];
  onCreateToken: () => void;
  onDeleteDatabase: () => void;
  onGrantMember: () => void;
  onMemberPrincipalChange: (value: string) => void;
  onMemberRoleChange: (role: DatabaseRole) => void;
  onQuotaBytesChange: (value: string) => void;
  onRevokeMember: (member: DatabaseMember) => void;
  onRevokeToken: (tokenId: string) => void;
  onSetQuota: () => void;
  onTokenNameChange: (value: string) => void;
  onTokenScopeChange: (scope: DatabaseTokenScope) => void;
};

type ResponseLifecyclePanelProps = {
  archiveSnapshot: ArchiveSnapshot | null;
  archiveSnapshotName: string | null;
  archiveStatus: string;
  canApproveDeposit: boolean;
  canArchive: boolean;
  canCancelArchive: boolean;
  canDeposit: boolean;
  canDownloadArchive: boolean;
  canDownloadSqlDump: boolean;
  canLoadSqlDump: boolean;
  canQuoteDeposit: boolean;
  canRestore: boolean;
  canRun: boolean;
  depositAmount: string;
  depositQuote: DepositQuote | null;
  payments: PaymentRecord[];
  selectedDatabaseStatus: DatabaseStatus | null;
  sqlDumpStatus: string;
  walletOwner: string | null;
  walletStatus: WalletStatus;
  onApproveDeposit: () => void;
  onArchiveDatabase: () => void;
  onCancelArchive: () => void;
  onDepositAmountChange: (value: string) => void;
  onDepositApproved: () => void;
  onDownloadArchiveSnapshot: () => void;
  onDownloadSqlDump: () => void;
  onLoadArchiveFile: (file: File | null) => void;
  onLoadSqlDumpFile: (file: File | null) => void;
  onQuoteDeposit: () => void;
  onRestoreArchive: () => void;
};

export function ResponseAccessPanel(props: ResponseAccessPanelProps) {
  return (
    <>
      <StorageQuotaPanel
        canDeleteDatabase={props.canDeleteDatabase}
        canSetQuota={props.canSetQuota}
        quotaBytes={props.quotaBytes}
        onDeleteDatabase={props.onDeleteDatabase}
        onQuotaBytesChange={props.onQuotaBytesChange}
        onSetQuota={props.onSetQuota}
      />
      <TokenPanel
        canManageDatabase={props.canManageDatabase}
        tokenName={props.tokenName}
        tokenScope={props.tokenScope}
        tokens={props.tokens}
        onCreateToken={props.onCreateToken}
        onRevokeToken={props.onRevokeToken}
        onTokenNameChange={props.onTokenNameChange}
        onTokenScopeChange={props.onTokenScopeChange}
      />
      <PermissionPanel
        canGrantMember={props.canGrantMember}
        canMutateMembers={props.canMutateMembers}
        memberPrincipal={props.memberPrincipal}
        memberRole={props.memberRole}
        members={props.members}
        principal={props.principal}
        onGrantMember={props.onGrantMember}
        onMemberPrincipalChange={props.onMemberPrincipalChange}
        onMemberRoleChange={props.onMemberRoleChange}
        onRevokeMember={props.onRevokeMember}
      />
    </>
  );
}

export function ResponseLifecyclePanel(props: ResponseLifecyclePanelProps) {
  return (
    <>
      <BackupRestorePanel
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
        selectedDatabaseStatus={props.selectedDatabaseStatus}
        sqlDumpStatus={props.sqlDumpStatus}
        onArchiveDatabase={props.onArchiveDatabase}
        onCancelArchive={props.onCancelArchive}
        onDownloadArchiveSnapshot={props.onDownloadArchiveSnapshot}
        onDownloadSqlDump={props.onDownloadSqlDump}
        onLoadArchiveFile={props.onLoadArchiveFile}
        onLoadSqlDumpFile={props.onLoadSqlDumpFile}
        onRestoreArchive={props.onRestoreArchive}
      />
      <DepositPanel
        canApproveDeposit={props.canApproveDeposit}
        canDeposit={props.canDeposit}
        canQuoteDeposit={props.canQuoteDeposit}
        depositAmount={props.depositAmount}
        depositQuote={props.depositQuote}
        payments={props.payments}
        walletOwner={props.walletOwner}
        walletStatus={props.walletStatus}
        onApproveDeposit={props.onApproveDeposit}
        onDepositAmountChange={props.onDepositAmountChange}
        onDepositApproved={props.onDepositApproved}
        onQuoteDeposit={props.onQuoteDeposit}
      />
    </>
  );
}
