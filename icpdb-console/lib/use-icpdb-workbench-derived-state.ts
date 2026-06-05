"use client";

// icpdb-console/lib/use-icpdb-workbench-derived-state.ts
// Derived workbench state: centralizes selected resources and permission gates for the console UI.

import { useMemo } from "react";
import {
  canWriteColumn,
  isBlobColumn
} from "@/lib/row-mutations";
import {
  canWriteDatabaseRole,
  isValidPrincipalText,
  isSafeQuotaBytes,
  normalizeMemberPrincipalInput,
  parseIcpToE8s
} from "@/lib/workbench-state";
import type { ArchiveSnapshot } from "@/lib/use-icpdb-backup-actions";
import type { ApprovedDeposit, WalletStatus } from "@/lib/use-icpdb-billing-actions";
import type {
  DatabaseColumn,
  DatabaseMember,
  DatabaseRole,
  DatabaseSummary,
  DatabaseTable,
  DepositQuote,
  SqlValue,
  TableDescription,
  TablePreviewResponse
} from "@/lib/types";

const ANONYMOUS_PRINCIPAL = "2vxsx-fae";

type DerivedStateOptions = {
  archiveSnapshot: ArchiveSnapshot | null;
  approvedDeposit: ApprovedDeposit | null;
  authReady: boolean;
  canisterId: string;
  createTableColumns: string;
  createTableName: string;
  databaseId: string;
  databases: DatabaseSummary[];
  depositAmount: string;
  depositQuote: DepositQuote | null;
  loadState: "idle" | "loading" | "ready" | "error";
  memberPrincipal: string;
  memberRole: DatabaseRole;
  members: DatabaseMember[];
  principal: string | null;
  quotaBytes: string;
  selectedCellColumnName: string;
  selectedRowIndex: number | null;
  tableDescription: TableDescription | null;
  tableName: string;
  tablePreview: TablePreviewResponse | null;
  tables: DatabaseTable[];
  walletStatus: WalletStatus;
};

export type WorkbenchDerivedState = {
  approvedDepositMatches: boolean;
  canApproveDeposit: boolean;
  canArchive: boolean;
  canCancelArchive: boolean;
  canCreateTable: boolean;
  canDeleteDatabase: boolean;
  canDeposit: boolean;
  canDownloadArchive: boolean;
  canDownloadSqlDump: boolean;
  canEditRows: boolean;
  canGrantMember: boolean;
  canLoadSqlDump: boolean;
  canManageDatabase: boolean;
  canMutateMembers: boolean;
  canMutateSelectedRow: boolean;
  canQuoteDeposit: boolean;
  canRestore: boolean;
  canRun: boolean;
  canSetQuota: boolean;
  canUpdateCell: boolean;
  canWriteDatabase: boolean;
  depositQuoteMatchesAmount: boolean;
  editableColumns: DatabaseColumn[];
  primaryKeyColumns: DatabaseColumn[];
  selectedCellColumn: DatabaseColumn | null;
  selectedDatabase: DatabaseSummary | null;
  selectedRow: SqlValue[] | null;
  selectedTable: DatabaseTable | null;
  walletBusy: boolean;
};

export function useIcpdbWorkbenchDerivedState(options: DerivedStateOptions): WorkbenchDerivedState {
  const {
    archiveSnapshot,
    approvedDeposit,
    authReady,
    canisterId,
    createTableColumns,
    createTableName,
    databaseId,
    databases,
    depositAmount,
    depositQuote,
    loadState,
    memberPrincipal,
    memberRole,
    members,
    principal,
    quotaBytes,
    selectedCellColumnName,
    selectedRowIndex,
    tableDescription,
    tableName,
    tablePreview,
    tables,
    walletStatus
  } = options;

  const selectedDatabase = useMemo(
    () => databases.find((database) => database.databaseId === databaseId) ?? null,
    [databaseId, databases]
  );
  const selectedTable = useMemo(() => tables.find((table) => table.name === tableName) ?? null, [tableName, tables]);
  const primaryKeyColumns = useMemo(
    () =>
      (tableDescription?.columns ?? [])
        .filter((column) => column.primaryKeyPosition > 0)
        .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition),
    [tableDescription]
  );
  const editableColumns = useMemo(
    () => (tableDescription?.columns ?? []).filter((column) => canWriteColumn(column) && !isBlobColumn(column)),
    [tableDescription]
  );
  const selectedRow = selectedRowIndex === null ? null : tablePreview?.rows[selectedRowIndex] ?? null;
  const selectedCellColumn = editableColumns.find((column) => column.name === selectedCellColumnName) ?? null;
  const canRun = Boolean(authReady && principal && databaseId && canisterId && loadState !== "loading");
  const canWriteDatabase = canRun && selectedDatabase?.status === "hot" && canWriteDatabaseRole(selectedDatabase.role);
  const canCreateTable = canWriteDatabase && createTableName.trim().length > 0 && createTableColumns.trim().length > 0;
  const canEditRows = canWriteDatabase && selectedTable?.objectType === "table" && Boolean(tableDescription);
  const canMutateSelectedRow = canEditRows && selectedRow !== null && primaryKeyColumns.length > 0;
  const canUpdateCell = canMutateSelectedRow && Boolean(selectedCellColumn);
  const depositQuoteMatchesAmount = depositQuoteAmountMatches(depositQuote, depositAmount);
  const walletBusy = walletStatus === "connecting" || walletStatus === "approving";
  const approvedDepositMatches =
    Boolean(depositQuote && principal && approvedDeposit) &&
    approvedDeposit?.amountE8s === depositQuote?.amountE8s &&
    approvedDeposit?.owner === principal &&
    depositQuoteMatchesAmount;
  const canQuoteDeposit = canRun && !walletBusy;
  const canApproveDeposit = canRun && depositQuoteMatchesAmount && !walletBusy;
  const canDeposit = canRun && approvedDepositMatches && !walletBusy;
  const canDownloadSqlDump = canRun && selectedDatabase?.status === "hot";
  const canLoadSqlDump = canWriteDatabase;
  const canDownloadArchive = canRun && archiveSnapshot?.databaseId === databaseId;
  const canManageDatabase = canRun && selectedDatabase?.role === "owner";
  const canArchive = canManageDatabase && selectedDatabase?.status === "hot";
  const canCancelArchive = canManageDatabase && selectedDatabase?.status === "archiving";
  const canRestore =
    canManageDatabase && canDownloadArchive && (selectedDatabase?.status === "archived" || selectedDatabase?.status === "deleted");
  const canMutateMembers = canManageDatabase && selectedDatabase?.status === "hot";
  const canGrantMember =
    canMutateMembers &&
    isGrantableMemberPrincipal(memberPrincipal) &&
    !isCallerSelfDowngrade(memberPrincipal, memberRole, principal) &&
    !isLastOwnerDowngrade(memberPrincipal, memberRole, members) &&
    !hasSameMemberRole(memberPrincipal, memberRole, members);
  const canDeleteDatabase =
    canManageDatabase && (selectedDatabase?.status === "hot" || selectedDatabase?.status === "archived");
  const canSetQuota = canManageDatabase && isSafeQuotaBytes(quotaBytes);

  return {
    approvedDepositMatches,
    canApproveDeposit,
    canArchive,
    canCancelArchive,
    canCreateTable,
    canDeleteDatabase,
    canDeposit,
    canDownloadArchive,
    canDownloadSqlDump,
    canEditRows,
    canGrantMember,
    canLoadSqlDump,
    canManageDatabase,
    canMutateMembers,
    canMutateSelectedRow,
    canQuoteDeposit,
    canRestore,
    canRun,
    canSetQuota,
    canUpdateCell,
    canWriteDatabase,
    depositQuoteMatchesAmount,
    editableColumns,
    primaryKeyColumns,
    selectedCellColumn,
    selectedDatabase,
    selectedRow,
    selectedTable,
    walletBusy
  };
}

function depositQuoteAmountMatches(quote: DepositQuote | null, depositAmount: string): boolean {
  if (!quote) return false;
  try {
    return parseIcpToE8s(depositAmount) === quote.amountE8s;
  } catch {
    return false;
  }
}

function isGrantableMemberPrincipal(principal: string): boolean {
  const value = normalizeMemberPrincipalInput(principal);
  return value.length > 0 && value !== ANONYMOUS_PRINCIPAL && isValidPrincipalText(value);
}

function isCallerSelfDowngrade(memberPrincipal: string, memberRole: DatabaseRole, principal: string | null): boolean {
  return Boolean(principal && normalizeMemberPrincipalInput(memberPrincipal) === principal && memberRole !== "owner");
}

function isLastOwnerDowngrade(memberPrincipal: string, memberRole: DatabaseRole, members: DatabaseMember[]): boolean {
  if (memberRole === "owner") return false;
  const principal = normalizeMemberPrincipalInput(memberPrincipal);
  const ownerCount = members.filter((member) => member.role === "owner").length;
  return ownerCount <= 1 && members.some((member) => member.principal === principal && member.role === "owner");
}

function hasSameMemberRole(memberPrincipal: string, memberRole: DatabaseRole, members: DatabaseMember[]): boolean {
  const principal = normalizeMemberPrincipalInput(memberPrincipal);
  return members.some((member) => member.principal === principal && member.role === memberRole);
}
