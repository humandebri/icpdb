"use client";

// icpdb-console/lib/use-icpdb-workbench-controller.ts
// Workbench coordinator: wires state, derived permissions, refresh hooks, and action hooks.

import { useCallback, useEffect } from "react";
import type { ResponseSidebarProps } from "@/components/icpdb-response-sidebar";
import type { ConsoleConnection } from "@/lib/console-connection";
import { useIcpdbAccountActions } from "@/lib/use-icpdb-account-actions";
import { useIcpdbBackupActions } from "@/lib/use-icpdb-backup-actions";
import { useIcpdbBillingActions } from "@/lib/use-icpdb-billing-actions";
import { useIcpdbDatabaseActions } from "@/lib/use-icpdb-database-actions";
import { useIcpdbOperationActions } from "@/lib/use-icpdb-operation-actions";
import { useIcpdbResourceRefresh } from "@/lib/use-icpdb-resource-refresh";
import { useIcpdbSessionActions } from "@/lib/use-icpdb-session-actions";
import { useIcpdbShardActions } from "@/lib/use-icpdb-shard-actions";
import { useIcpdbSqlActions } from "@/lib/use-icpdb-sql-actions";
import { useIcpdbTableActions } from "@/lib/use-icpdb-table-actions";
import { useIcpdbTokenAdminActions } from "@/lib/use-icpdb-token-admin-actions";
import { useIcpdbTokenBackupActions } from "@/lib/use-icpdb-token-backup-actions";
import { useIcpdbTokenActions } from "@/lib/use-icpdb-token-actions";
import { useIcpdbWorkbenchDerivedState } from "@/lib/use-icpdb-workbench-derived-state";
import { useIcpdbWorkbenchState } from "@/lib/use-icpdb-workbench-state";
import { buildNewRowDraft, canWriteColumn } from "@/lib/row-mutations";
import { quoteSqlIdentifier } from "@/lib/sql-dump";
import { tablePageSelectSql } from "@/lib/table-data-helpers";
import {
  normalizeCreateTableColumns,
  normalizeCreateTableName
} from "@/lib/workbench-state";
import type { ShardOperationInfo, ShardOperationReconcileStatus, TableDescription } from "@/lib/types";

const defaultWalletSignerUrl = "https://oisy.com/sign";
const defaultWalletHost = "https://icp-api.io";

export function useIcpdbWorkbenchController(connection: ConsoleConnection) {
  const state = useIcpdbWorkbenchState();
  const canisterId = connection.canisterId;
  const hostedMode = connection.mode === "hosted";
  const walletSignerUrl = process.env.NEXT_PUBLIC_ICPDB_WALLET_SIGNER_URL ?? defaultWalletSignerUrl;
  const walletHost = process.env.NEXT_PUBLIC_ICPDB_WALLET_HOST ?? defaultWalletHost;
  const {
    approvedDeposit, archiveSnapshot, archiveSnapshotName, authClient, createTableColumns, createTableName,
    databaseId, databases, depositAmount, depositQuote, loadState, memberPrincipal, principal, quotaBytes,
    selectedCellColumnName, selectedRowIndex, tableDescription, tableLimit, tableName, tablePreview, tables, walletRef,
    tokenSession, walletStatus
  } = state;
  const {
    setCellValue, setError, setRowJson, setSelectedCellColumnName, setSelectedRowIndex, setTableDescription, setTableName,
    setTableOffset, setTablePreview, setTables
  } = state;

  const derived = useIcpdbWorkbenchDerivedState({
    archiveSnapshot, approvedDeposit, authReady: Boolean(authClient || tokenSession), canisterId: canisterId || tokenSession?.baseUrl || "", createTableColumns,
    connectionMode: connection.mode, createTableName, databaseId, databases, depositAmount, depositQuote, loadState, memberPrincipal, memberRole: state.memberRole, members: state.members, principal, quotaBytes,
    selectedCellColumnName, selectedRowIndex, tableDescription, tableName, tablePreview, tables, walletStatus
  });
  const resetRowEditor = useCallback(() => {
    setSelectedRowIndex(null);
    setRowJson("{}");
    setSelectedCellColumnName("");
    setCellValue("");
  }, [setCellValue, setRowJson, setSelectedCellColumnName, setSelectedRowIndex]);
  const resource = useIcpdbResourceRefresh({
    canisterId, databases, skipHostedResources: !hostedMode, tableLimit, tableName, resetRowEditor, setUsage: state.setUsage,
    setUsageEvents: state.setUsageEvents, setBilling: state.setBilling, setTokens: state.setTokens,
    setMembers: state.setMembers, setPayments: state.setPayments, setQuotaBytes: state.setQuotaBytes,
    setTables: state.setTables, setTableName: state.setTableName, setTableOffset: state.setTableOffset,
    setTableDescription: state.setTableDescription, setTablePreview: state.setTablePreview,
    setSelectedRowIndex: state.setSelectedRowIndex, setRowJson: state.setRowJson
  });
  const { loadTable, refreshDatabaseAccount, refreshDatabaseDetails } = resource;
  const account = useIcpdbAccountActions({
    authClient, canisterId, databaseId, principal, canManageDatabase: derived.canManageDatabase,
    canGrantMember: derived.canGrantMember, canMutateMembers: derived.canMutateMembers, canSetQuota: derived.canSetQuota,
    tokenName: state.tokenName, tokenScope: state.tokenScope, memberPrincipal, memberRole: state.memberRole, members: state.members, quotaBytes,
    setError: state.setError, setIssuedToken: state.setIssuedToken, setLoadState: state.setLoadState,
    setMemberPrincipal: state.setMemberPrincipal, setMembers: state.setMembers, setQuotaBytes: state.setQuotaBytes,
    setTokens: state.setTokens, setUsage: state.setUsage
  });
  const billing = useIcpdbBillingActions({
    authClient, canisterId, databaseId, principal, depositAmount, depositQuote,
    depositQuoteMatchesAmount: derived.depositQuoteMatchesAmount, approvedDeposit: state.approvedDeposit, walletHost,
    walletRef, walletSignerUrl, walletStatus, setApprovedDeposit: state.setApprovedDeposit, setBilling: state.setBilling,
    setDepositQuote: state.setDepositQuote, setError: state.setError, setLoadState: state.setLoadState,
    setPayments: state.setPayments, setWalletOwner: state.setWalletOwner, setWalletStatus: state.setWalletStatus
  });
  const clearTableState = useCallback(() => {
    setTables([]);
    setTableName("");
    setTableOffset(0);
    setTableDescription(null);
    setTablePreview(null);
    resetRowEditor();
  }, [resetRowEditor, setTableDescription, setTableName, setTableOffset, setTablePreview, setTables]);
  const session = useIcpdbSessionActions({
    canisterId, connection, clearTableState, resetDepositApproval: billing.resetDepositApproval, setAuthClient: state.setAuthClient,
    setBilling: state.setBilling, setDatabaseId: state.setDatabaseId, setDatabases: state.setDatabases,
    setError: state.setError, setLoadState: state.setLoadState, setPrincipal: state.setPrincipal, setUsage: state.setUsage,
    setShardPlacements: state.setShardPlacements, setShardPlacementStatus: state.setShardPlacementStatus,
    setUsageEvents: state.setUsageEvents
  });
  const shardActions = useIcpdbShardActions({
    authClient, canisterId, shardReconcileError: state.shardReconcileError, setError: state.setError,
    setLoadState: state.setLoadState, setShardJournalStatus: state.setShardJournalStatus,
    setShardOperations: state.setShardOperations, setShardPlacements: state.setShardPlacements,
    setShardPlacementStatus: state.setShardPlacementStatus, setShardReconcileError: state.setShardReconcileError
  });
  const database = useIcpdbDatabaseActions({
    authClient, canisterId, canDeleteDatabase: derived.canDeleteDatabase, databaseId, principal, clearTableState,
    refreshDatabaseAccount, refreshDatabaseDetails,
    refreshDatabases: session.refreshDatabases, resetDepositApproval: billing.resetDepositApproval,
    setArchiveStatus: state.setArchiveStatus, setBilling: state.setBilling, setDatabaseId: state.setDatabaseId,
    setError: state.setError, setLoadState: state.setLoadState, setMembers: state.setMembers, setPayments: state.setPayments,
    setMode: state.setMode, setParamsJson: state.setParamsJson, setSql: state.setSql,
    setTokens: state.setTokens, setUsage: state.setUsage, setView: state.setView
  });
  const sqlActions = useIcpdbSqlActions({
    authClient, canCreateTable: derived.canCreateTable, canisterId, canRun: derived.canRun,
    createTableColumns, createTableName, databaseId, mode: state.mode, paramsJson: state.paramsJson, sql: state.sql,
    sqlMaxRows: state.sqlMaxRows,
    tableName, refreshDatabaseDetails, setBatchResponses: state.setBatchResponses,
    setCreateTableName: state.setCreateTableName, setError: state.setError, setLoadState: state.setLoadState,
    setOperationId: state.setOperationId, setOperationStatus: state.setOperationStatus,
    setResponse: state.setResponse, setRoutedOperation: state.setRoutedOperation, setView: state.setView
  });
  const tableActions = useIcpdbTableActions({
    authClient, canEditRows: derived.canEditRows, canisterId, canUpdateCell: derived.canUpdateCell,
    cellValue: state.cellValue, databaseId, editableColumns: derived.editableColumns, rowJson: state.rowJson,
    selectedCellColumn: derived.selectedCellColumn, selectedCellColumnName, selectedRow: derived.selectedRow,
    selectedRowIndex, tableDescription, tableLimit, tableName, tablePreview, loadTable,
    refreshDatabaseDetails, resetRowEditor, setCellValue: state.setCellValue,
    setError: state.setError, setLoadState: state.setLoadState,
    setOperationId: state.setOperationId, setOperationStatus: state.setOperationStatus,
    setResponse: state.setResponse, setRowJson: state.setRowJson, setRoutedOperation: state.setRoutedOperation,
    setSelectedCellColumnName: state.setSelectedCellColumnName, setSelectedRowIndex: state.setSelectedRowIndex,
    setTableLimit: state.setTableLimit, setTableOffset: state.setTableOffset, setTablePreview: state.setTablePreview,
    setView: state.setView
  });
  const tokenActions = useIcpdbTokenActions({
    canCreateTable: derived.canCreateTable, canDeleteDatabase: derived.canDeleteDatabase, canEditRows: derived.canEditRows, canRun: derived.canRun,
    canUpdateCell: derived.canUpdateCell, cellValue: state.cellValue, createTableColumns, createTableName,
    databaseId, editableColumnName: selectedCellColumnName, mode: state.mode, paramsJson: state.paramsJson,
    rowJson: state.rowJson, selectedRowIndex, sql: state.sql, sqlMaxRows: state.sqlMaxRows, tableDescription, tableLimit, tableName,
    tablePreview, tokenDatabaseId: state.tokenDatabaseId, tokenHttpBaseUrl: state.tokenHttpBaseUrl,
    tokenSecret: state.tokenSecret, tokenSession, setBatchResponses: state.setBatchResponses, setBilling: state.setBilling,
    setCreateTableName: state.setCreateTableName, setDatabaseId: state.setDatabaseId, setDatabases: state.setDatabases,
    setError: state.setError, setLoadState: state.setLoadState, setMembers: state.setMembers, setPrincipal: state.setPrincipal,
    setOperationId: state.setOperationId, setOperationStatus: state.setOperationStatus,
    setPayments: state.setPayments, setQuotaBytes: state.setQuotaBytes, setResponse: state.setResponse, setRoutedOperation: state.setRoutedOperation,
    setTableDescription: state.setTableDescription,
    setTableLimit: state.setTableLimit, setTableName: state.setTableName, setTableOffset: state.setTableOffset,
    setTablePreview: state.setTablePreview, setTables: state.setTables, setTokenSession: state.setTokenSession,
    setTokens: state.setTokens, setUsage: state.setUsage, setUsageEvents: state.setUsageEvents, setView: state.setView,
    resetRowEditor, resetDepositApproval: billing.resetDepositApproval
  });
  const tokenAdminActions = useIcpdbTokenAdminActions({
    canGrantMember: derived.canGrantMember, canManageDatabase: derived.canManageDatabase,
    canMutateMembers: derived.canMutateMembers, canSetQuota: derived.canSetQuota,
    memberPrincipal, memberRole: state.memberRole, members: state.members, quotaBytes, tableName, tokenName: state.tokenName,
    tokenScope: state.tokenScope, tokenSession, refreshTokenDetails: tokenActions.refreshTokenDetails,
    setError: state.setError, setIssuedToken: state.setIssuedToken, setLoadState: state.setLoadState,
    setMemberPrincipal: state.setMemberPrincipal, setMembers: state.setMembers, setQuotaBytes: state.setQuotaBytes,
    setTokens: state.setTokens, setUsage: state.setUsage
  });
  const backup = useIcpdbBackupActions({
    archiveSnapshot, archiveSnapshotName, authClient, canArchive: derived.canArchive,
    canDownloadSqlDump: derived.canDownloadSqlDump, canLoadSqlDump: derived.canLoadSqlDump, canRestore: derived.canRestore,
    canisterId, databaseId, tableName, clearTableState, refreshDatabaseAccount,
    refreshDatabaseDetails, refreshDatabases: session.refreshDatabases,
    setArchiveSnapshot: state.setArchiveSnapshot, setArchiveSnapshotName: state.setArchiveSnapshotName,
    setArchiveStatus: state.setArchiveStatus, setBatchResponses: state.setBatchResponses, setError: state.setError,
    setLoadState: state.setLoadState, setResponse: state.setResponse, setSqlDumpStatus: state.setSqlDumpStatus
  });
  const tokenBackupActions = useIcpdbTokenBackupActions({
    archiveSnapshot, canArchive: derived.canArchive, canCancelArchive: derived.canCancelArchive, canDownloadSqlDump: derived.canDownloadSqlDump,
    canLoadSqlDump: derived.canLoadSqlDump, canRestore: derived.canRestore, tableName, tokenSession,
    refreshTokenDetails: tokenActions.refreshTokenDetails, resetRowEditor, setArchiveSnapshot: state.setArchiveSnapshot,
    setArchiveSnapshotName: state.setArchiveSnapshotName, setArchiveStatus: state.setArchiveStatus,
    setBatchResponses: state.setBatchResponses, setError: state.setError, setLoadState: state.setLoadState,
    setResponse: state.setResponse, setSqlDumpStatus: state.setSqlDumpStatus, setTableDescription: state.setTableDescription,
    setTableName: state.setTableName, setTableOffset: state.setTableOffset, setTablePreview: state.setTablePreview,
    setTables: state.setTables
  });
  const operationActions = useIcpdbOperationActions({
    authClient, canisterId, databaseId, operationId: state.operationId, tokenSession,
    setError: state.setError, setLoadState: state.setLoadState,
    setOperationStatus: state.setOperationStatus, setRoutedOperation: state.setRoutedOperation
  });

  useEffect(() => () => {
    const wallet = walletRef.current;
    walletRef.current = null;
    if (wallet) void wallet.disconnect();
  }, [walletRef]);
  useEffect(() => {
    if (!authClient || !principal || !databaseId || !canisterId) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => derived.selectedDatabase?.status === "hot"
        ? refreshDatabaseDetails(authClient, databaseId, tableName)
        : refreshDatabaseAccount(authClient, databaseId))
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [
    authClient,
    canisterId,
    databaseId,
    derived.selectedDatabase?.status,
    principal,
    refreshDatabaseAccount,
    refreshDatabaseDetails,
    setError,
    tableName
  ]);

  const navigatorProps = {
    canCreateTable: derived.canCreateTable, canOpenSetupSql: derived.canWriteDatabase, canisterId, connectionMode: connection.mode, createTableColumns, createTableName, databaseId, databases,
    loadState, principal, tableName, tables,
    tokenSession: {
      connected: Boolean(tokenSession), databaseId: state.tokenDatabaseId, disabled: !hostedMode || loadState === "loading",
      httpBaseUrl: state.tokenHttpBaseUrl, token: state.tokenSecret, onConnect: tokenActions.connectTokenSession,
      onDatabaseIdChange: state.setTokenDatabaseId, onDisconnect: () => { tokenActions.disconnectTokenSession(); operationActions.clearRoutedOperation(); },
      onHttpBaseUrlChange: state.setTokenHttpBaseUrl, onTokenChange: state.setTokenSecret
    },
    onCreateTable: tokenSession ? tokenActions.createTable : sqlActions.createTable,
    onCreateTableColumnsChange: state.setCreateTableColumns,
    onCreateTableNameChange: state.setCreateTableName,
    onOpenSetupSql: openCreateTableSetupSql,
    onOpenTableSql: openTableSelectSql,
    onSelectDatabase: session.selectDatabase,
    onSelectTable: (nextTableName: string) => void (tokenSession ? tokenActions.selectTable(nextTableName) : tableActions.selectTable(nextTableName))
  };
  const toolbarProps = {
    authReady: Boolean(authClient), canCreateDatabase: hostedMode && !tokenSession, canIssueReadToken: hostedMode && !tokenSession, databaseId,
    loadState, principal, view: state.view, onCreateDatabase: database.createDatabase,
    onCreateReadToken: account.createReadToken, onLogin: () => void session.login(authClient), onSetView: state.setView,
    onSync: () => {
      if (tokenSession) void tokenActions.connectTokenSession();
      else if (authClient) void session.refreshDatabases(authClient);
    }
  };
  const tableEditorProps = {
    canEditRows: derived.canEditRows, canMutateSelectedRow: derived.canMutateSelectedRow,
    canUpdateCell: derived.canUpdateCell, cellValue: state.cellValue, editableColumns: derived.editableColumns,
    loadState, primaryKeyColumns: derived.primaryKeyColumns, rowJson: state.rowJson, selectedCellColumnName,
    selectedRowIndex, selectedTable: derived.selectedTable, tableDescription, tableLimit, tableOffset: state.tableOffset,
    tablePreview, onCellValueChange: state.setCellValue, onChangeSelectedCellColumn: tableActions.changeSelectedCellColumn,
    onChangeTableLimit: (value: string) => void (tokenSession ? tokenActions.changeTableLimit(value) : tableActions.changeTableLimit(value)),
    onLoadTablePage: (offset: number) => void (tokenSession ? tokenActions.loadTablePage(offset) : tableActions.loadTablePage(offset)),
    onMutateRow: (mutation: "insert" | "update" | "delete") => void (tokenSession ? tokenActions.mutateRow(mutation) : tableActions.mutateRow(mutation)),
    onOpenCountSql: openTableCountSql,
    onOpenColumnSql: openTableColumnSql,
    onOpenForeignKeySql: openTableForeignKeySql,
    onOpenInsertSql: openTableInsertSql,
    onOpenPageSql: openTablePageSql,
    onOpenSchemaLookupSql: openSchemaLookupSql,
    onOpenSchemaSql: openSchemaSql,
    onOpenTableSql: openTableSelectSql,
    onRowJsonChange: state.setRowJson, onSelectPreviewCell: tableActions.selectPreviewCell,
    onSelectPreviewRow: tableActions.selectPreviewRow, onStartNewRow: tableActions.startNewRow,
    onUpdateCell: () => void (tokenSession ? tokenActions.updateCell() : tableActions.updateCell())
  };
  const sqlEditorProps = {
    authReady: Boolean(authClient), batchResponses: state.batchResponses, canRun: derived.canRun,
    isAuthenticated: Boolean(principal), loadState, mode: state.mode, paramsJson: state.paramsJson,
    response: state.response, sql: state.sql, sqlMaxRows: state.sqlMaxRows, onLogin: () => void session.login(authClient),
    onModeChange: state.setMode, onParamsJsonChange: state.setParamsJson,
    onRunSql: tokenSession ? tokenActions.runSql : sqlActions.runSql, onSqlChange: state.setSql,
    onSqlMaxRowsChange: state.setSqlMaxRows
  };
  const responseSidebarProps: ResponseSidebarProps = {
    archiveSnapshot, archiveSnapshotName, archiveStatus: state.archiveStatus, batchResponses: state.batchResponses,
    canArchive: derived.canArchive,
    canCancelArchive: derived.canCancelArchive, canisterId,
    canDeleteDatabase: derived.canDeleteDatabase,
    canDownloadArchive: derived.canDownloadArchive, canDownloadSqlDump: derived.canDownloadSqlDump,
    canGrantMember: derived.canGrantMember, canLoadSqlDump: derived.canLoadSqlDump,
    canLoadRoutedOperation: hostedMode && Boolean(tokenSession || (authClient && canisterId && databaseId)),
    canManageDatabase: derived.canManageDatabase, canMutateMembers: derived.canMutateMembers,
    canRestore: derived.canRestore, canRun: derived.canRun,
    canSetQuota: derived.canSetQuota, issuedToken: state.issuedToken, memberPrincipal,
    memberRole: state.memberRole, members: state.members, operationId: state.operationId,
    operationStatus: state.operationStatus, principal, quotaBytes,
    response: state.response, routedOperation: state.routedOperation, selectedDatabase: derived.selectedDatabase, selectedTable: derived.selectedTable,
    shardJournalStatus: state.shardJournalStatus, shardOperations: state.shardOperations,
    shardPlacements: state.shardPlacements, shardPlacementStatus: state.shardPlacementStatus,
    shardReconcileError: state.shardReconcileError,
    sqlDumpStatus: state.sqlDumpStatus, tokenName: state.tokenName, tokenScope: state.tokenScope, tokens: state.tokens,
    usage: state.usage, usageEvents: state.usageEvents, showHostedPanels: hostedMode,
    onArchiveDatabase: tokenSession ? tokenBackupActions.archiveDatabase : backup.archiveDatabase,
    onCancelArchive: tokenSession ? tokenBackupActions.cancelArchive : database.cancelArchive, onCreateToken: tokenSession ? tokenAdminActions.createToken : account.createToken,
    onDeleteDatabase: tokenSession ? tokenActions.deleteDatabase : database.deleteSelectedDatabase,
    onDownloadArchiveSnapshot: () => void backup.downloadArchiveSnapshot(),
    onDownloadSqlDump: tokenSession ? tokenBackupActions.downloadSqlDump : backup.downloadSqlDump,
    onGrantMember: tokenSession ? tokenAdminActions.grantMember : account.grantMember,
    onLoadArchiveFile: (file: File | null) => void backup.loadArchiveFile(file),
    onLoadRoutedOperation: () => void operationActions.loadRoutedOperation(),
    onLoadSqlDumpFile: (file: File | null) => void (tokenSession ? tokenBackupActions.loadSqlDumpFile(file) : backup.loadSqlDumpFile(file)),
    onMemberPrincipalChange: state.setMemberPrincipal, onMemberRoleChange: state.setMemberRole,
    onOperationIdChange: state.setOperationId,
    onQuotaBytesChange: state.setQuotaBytes,
    onRefreshAllShardPlacements: () => void shardActions.refreshAllShardPlacements(),
    onRefreshShardOperations: () => void shardActions.refreshShardOperations(),
    onReconcileShardOperation: (operation: ShardOperationInfo, status: ShardOperationReconcileStatus) => void shardActions.reconcileShardOperation(operation, status),
    onRestoreArchive: tokenSession ? tokenBackupActions.restoreArchive : backup.restoreArchive,
    onRevokeMember: (member: typeof state.members[number]) => void (tokenSession ? tokenAdminActions.revokeMember(member) : account.revokeMember(member)),
    onRevokeToken: (tokenId: string) => void (tokenSession ? tokenAdminActions.revokeToken(tokenId) : account.revokeToken(tokenId)),
    onSetQuota: tokenSession ? tokenAdminActions.setQuota : account.setQuota,
    onShardReconcileErrorChange: state.setShardReconcileError, onTokenNameChange: state.setTokenName,
    onTokenScopeChange: state.setTokenScope
  };

  return { error: state.error, navigatorProps, responseSidebarProps, sqlEditorProps, tableEditorProps, toolbarProps, view: state.view };

  function openTableSelectSql(nextTableName: string) {
    state.setTableName(nextTableName);
    state.setMode("query");
    state.setParamsJson("[]");
    state.setSql(`SELECT * FROM ${quoteSqlIdentifier(nextTableName)} LIMIT ${tableLimit};`);
    state.setView("sql");
  }

  function openCreateTableSetupSql() {
    try {
      const nextTableName = normalizeCreateTableName(createTableName.trim() || "notes");
      const columnsSql = normalizeCreateTableColumns(createTableColumns);
      const setupStatements = [`CREATE TABLE ${quoteSqlIdentifier(nextTableName)} (${columnsSql});`];
      if (columnsSql === "id INTEGER PRIMARY KEY, body TEXT NOT NULL") {
        setupStatements.push(`INSERT INTO ${quoteSqlIdentifier(nextTableName)} (body) VALUES (${quoteSqlString("hello from ICPDB")});`);
      }
      setupStatements.push(
        `SELECT name, type, sql FROM sqlite_schema WHERE name = ${quoteSqlString(nextTableName)};`,
        `SELECT * FROM ${quoteSqlIdentifier(nextTableName)} LIMIT 25;`
      );
      state.setError(null);
      state.setCreateTableName(nextTableName);
      state.setMode("batch");
      state.setParamsJson("[]");
      state.setSql(setupStatements.join("\n"));
      state.setView("sql");
    } catch (cause) {
      state.setError(errorMessage(cause));
    }
  }

  function openTableCountSql(nextTableName: string) {
    state.setTableName(nextTableName);
    state.setMode("query");
    state.setParamsJson("[]");
    state.setSql(`SELECT count(*) AS total FROM ${quoteSqlIdentifier(nextTableName)};`);
    state.setView("sql");
  }

  function openTableColumnSql(nextTableName: string) {
    if (!nextTableName) return;
    state.setTableName(nextTableName);
    state.setMode("query");
    state.setParamsJson("[]");
    state.setSql(`PRAGMA table_xinfo(${quoteSqlIdentifier(nextTableName)});`);
    state.setView("sql");
  }

  function openTableForeignKeySql(nextTableName: string) {
    if (!nextTableName) return;
    state.setTableName(nextTableName);
    state.setMode("query");
    state.setParamsJson("[]");
    state.setSql(`PRAGMA foreign_key_list(${quoteSqlIdentifier(nextTableName)});`);
    state.setView("sql");
  }

  function openTableInsertSql(nextTableDescription: TableDescription) {
    const columns = nextTableDescription.columns.filter((column) => canWriteColumn(column) && column.defaultValue === null);
    if (columns.length === 0) return;
    const draft = buildNewRowDraft(nextTableDescription);
    state.setTableName(nextTableDescription.tableName);
    state.setMode("update");
    state.setParamsJson(JSON.stringify(columns.map((column) => draft[column.name] ?? null), null, 2));
    state.setSql(`INSERT INTO ${quoteSqlIdentifier(nextTableDescription.tableName)} (${columns.map((column) => quoteSqlIdentifier(column.name)).join(", ")}) VALUES (${columns.map((_, index) => `?${index + 1}`).join(", ")});`);
    state.setView("sql");
  }

  function openTablePageSql(nextTableName: string, limit: number, offset: number) {
    if (!nextTableName) return;
    state.setTableName(nextTableName);
    state.setMode("query");
    state.setParamsJson("[]");
    state.setSql(tablePageSelectSql(nextTableName, limit, offset));
    state.setView("sql");
  }

  function openSchemaSql(source: string) {
    state.setMode("batch");
    state.setParamsJson("[]");
    state.setSql(source);
    state.setView("sql");
  }

  function openSchemaLookupSql(nextTableName: string) {
    if (!nextTableName) return;
    state.setTableName(nextTableName);
    state.setMode("query");
    state.setParamsJson(JSON.stringify([nextTableName], null, 2));
    state.setSql([
      "SELECT type, name, tbl_name, sql",
      "FROM sqlite_schema",
      "WHERE tbl_name = ?1 OR name = ?1",
      "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 WHEN 'view' THEN 3 ELSE 4 END, name;"
    ].join("\n"));
    state.setView("sql");
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
