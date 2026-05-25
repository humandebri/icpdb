"use client";

// icpdb-console/lib/use-icpdb-workbench-state.ts
// Primitive workbench state: keeps local React state setup out of the Workbench view.

import { AuthClient } from "@icp-sdk/auth/client";
import type { IcpWallet } from "@dfinity/oisy-wallet-signer/icp-wallet";
import { useRef, useState } from "react";
import type { ArchiveSnapshot } from "@/lib/use-icpdb-backup-actions";
import type { ApprovedDeposit, WalletStatus } from "@/lib/use-icpdb-billing-actions";
import type { IcpdbTokenSession } from "@/lib/icpdb-http-client";
import type { SqlMode, WorkbenchView } from "@/lib/use-icpdb-sql-actions";
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
  SqlExecuteResponse,
  TableDescription,
  TablePreviewResponse
} from "@/lib/types";

export type LoadState = "idle" | "loading" | "ready" | "error";

const defaultSql = `select name, type
from sqlite_schema
where type in (?1, ?2)
order by name
limit 25;`;

export function useIcpdbWorkbenchState() {
  const walletRef = useRef<IcpWallet | null>(null);
  const [authClient, setAuthClient] = useState<AuthClient | null>(null);
  const [principal, setPrincipal] = useState<string | null>(null);
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [shardPlacements, setShardPlacements] = useState<DatabaseShardPlacement[]>([]);
  const [shardPlacementStatus, setShardPlacementStatus] = useState("Caller placements");
  const [shardOperations, setShardOperations] = useState<ShardOperationInfo[]>([]);
  const [shardJournalStatus, setShardJournalStatus] = useState("Not loaded");
  const [shardReconcileError, setShardReconcileError] = useState("");
  const [operationId, setOperationId] = useState("");
  const [routedOperation, setRoutedOperation] = useState<RoutedOperationInfo | null>(null);
  const [operationStatus, setOperationStatus] = useState("No operation loaded");
  const [databaseId, setDatabaseId] = useState("");
  const [view, setView] = useState<WorkbenchView>("table");
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [tableName, setTableName] = useState("");
  const [createTableName, setCreateTableName] = useState("");
  const [createTableColumns, setCreateTableColumns] = useState("id INTEGER PRIMARY KEY, body TEXT NOT NULL");
  const [tableLimit, setTableLimit] = useState(100);
  const [tableOffset, setTableOffset] = useState(0);
  const [tableDescription, setTableDescription] = useState<TableDescription | null>(null);
  const [tablePreview, setTablePreview] = useState<TablePreviewResponse | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [rowJson, setRowJson] = useState("{}");
  const [selectedCellColumnName, setSelectedCellColumnName] = useState("");
  const [cellValue, setCellValue] = useState("");
  const [mode, setMode] = useState<SqlMode>("query");
  const [sql, setSql] = useState(defaultSql);
  const [sqlMaxRows, setSqlMaxRows] = useState("100");
  const [paramsJson, setParamsJson] = useState(`["table", "view"]`);
  const [response, setResponse] = useState<SqlExecuteResponse | null>(null);
  const [batchResponses, setBatchResponses] = useState<SqlExecuteResponse[]>([]);
  const [usage, setUsage] = useState<DatabaseUsage | null>(null);
  const [usageEvents, setUsageEvents] = useState<DatabaseUsageEventSummary[]>([]);
  const [billing, setBilling] = useState<DatabaseBilling | null>(null);
  const [tokens, setTokens] = useState<DatabaseTokenInfo[]>([]);
  const [members, setMembers] = useState<DatabaseMember[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [tokenName, setTokenName] = useState("web-read");
  const [tokenScope, setTokenScope] = useState<DatabaseTokenScope>("read");
  const [tokenHttpBaseUrl, setTokenHttpBaseUrl] = useState("");
  const [tokenDatabaseId, setTokenDatabaseId] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
  const [tokenSession, setTokenSession] = useState<IcpdbTokenSession | null>(null);
  const [memberPrincipal, setMemberPrincipal] = useState("");
  const [memberRole, setMemberRole] = useState<DatabaseRole>("reader");
  const [quotaBytes, setQuotaBytes] = useState("");
  const [depositAmount, setDepositAmount] = useState("0.01");
  const [depositQuote, setDepositQuote] = useState<DepositQuote | null>(null);
  const [approvedDeposit, setApprovedDeposit] = useState<ApprovedDeposit | null>(null);
  const [archiveSnapshot, setArchiveSnapshot] = useState<ArchiveSnapshot | null>(null);
  const [archiveSnapshotName, setArchiveSnapshotName] = useState<string | null>(null);
  const [archiveStatus, setArchiveStatus] = useState("No archive loaded");
  const [sqlDumpStatus, setSqlDumpStatus] = useState("No SQL dump loaded");
  const [walletStatus, setWalletStatus] = useState<WalletStatus>("disconnected");
  const [walletOwner, setWalletOwner] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  return {
    approvedDeposit, archiveSnapshot, archiveSnapshotName, archiveStatus, authClient, batchResponses, billing, cellValue,
    createTableColumns, createTableName, databaseId, databases, depositAmount, depositQuote, error, issuedToken, loadState,
    memberPrincipal, memberRole, members, mode, operationId, operationStatus, paramsJson, payments, principal, quotaBytes, response, routedOperation, rowJson,
    selectedCellColumnName, selectedRowIndex, sql, sqlDumpStatus, sqlMaxRows, tableDescription, tableLimit, tableName, tableOffset,
    shardJournalStatus, shardOperations, shardPlacements, shardPlacementStatus, shardReconcileError, tablePreview, tables, tokenDatabaseId, tokenHttpBaseUrl, tokenName, tokenScope, tokenSecret, tokenSession, tokens,
    usage, usageEvents, view, walletOwner, walletRef, walletStatus,
    setApprovedDeposit, setArchiveSnapshot, setArchiveSnapshotName, setArchiveStatus, setAuthClient, setBatchResponses,
    setBilling, setCellValue, setCreateTableColumns, setCreateTableName, setDatabaseId, setDatabases, setDepositAmount,
    setDepositQuote, setError, setIssuedToken, setLoadState, setMemberPrincipal, setMemberRole, setMembers, setMode,
    setOperationId, setOperationStatus, setParamsJson, setPayments, setPrincipal, setQuotaBytes, setResponse, setRoutedOperation, setRowJson, setSelectedCellColumnName,
    setSelectedRowIndex, setShardJournalStatus, setShardOperations, setShardPlacements, setShardPlacementStatus, setShardReconcileError, setSql, setSqlDumpStatus, setSqlMaxRows, setTableDescription, setTableLimit, setTableName, setTableOffset,
    setTablePreview, setTables, setTokenDatabaseId, setTokenHttpBaseUrl, setTokenName, setTokenScope, setTokenSecret,
    setTokenSession, setTokens, setUsage, setUsageEvents, setView, setWalletOwner, setWalletStatus
  };
}
