"use client";

// icpdb-console/lib/use-icpdb-token-actions.ts
// Token-session actions: drive Table Editor and SQL Editor through bearer-token HTTP APIs.

import type { Dispatch, SetStateAction } from "react";
import { deleteDatabaseWithToken, getBillingWithToken, listMembersWithToken, listPaymentsWithToken, listTokensWithToken } from "@/lib/icpdb-http-admin-client";
import {
  describeTableWithToken, getSessionInfoWithToken, getUsageEventsWithToken, getUsageWithToken, listTablesWithToken,
  previewTableWithToken, sqlBatchWithToken, sqlExecuteWithToken, sqlQueryWithToken,
  type IcpdbTokenSession
} from "@/lib/icpdb-http-client";
import { normalizeTokenSession } from "@/lib/icpdb-token-session";
import { buildInsertRequest, buildSelectedCellMutationRequest, buildSelectedRowMutationRequest, type RowMutation } from "@/lib/row-mutations";
import { buildSqlBatchRequest, quoteSqlIdentifier } from "@/lib/sql-dump";
import { normalizeCreateTableColumns, normalizeCreateTableName, parseParams, parseSqlMaxRows, parseTableLimit, selectPreferredTableName } from "@/lib/workbench-state";
import type {
  DatabaseBilling,
  DatabaseMember,
  DatabaseSummary,
  DatabaseTable,
  DatabaseTokenInfo,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  PaymentRecord,
  RoutedOperationInfo,
  SqlExecuteResponse,
  TableDescription, TablePreviewResponse
} from "@/lib/types";
import type { SqlMode, WorkbenchView } from "@/lib/use-icpdb-sql-actions";

type LoadState = "idle" | "loading" | "ready" | "error";

type TokenActionOptions = {
  canCreateTable: boolean;
  canDeleteDatabase: boolean;
  canEditRows: boolean;
  canRun: boolean;
  canUpdateCell: boolean;
  cellValue: string;
  createTableColumns: string;
  createTableName: string;
  databaseId: string;
  editableColumnName: string;
  mode: SqlMode;
  paramsJson: string;
  rowJson: string;
  selectedRowIndex: number | null;
  sql: string;
  sqlMaxRows: string;
  tableDescription: TableDescription | null;
  tableLimit: number;
  tableName: string;
  tablePreview: TablePreviewResponse | null;
  tokenDatabaseId: string;
  tokenHttpBaseUrl: string;
  tokenSecret: string;
  tokenSession: IcpdbTokenSession | null;
  setBatchResponses: Dispatch<SetStateAction<SqlExecuteResponse[]>>;
  setCreateTableName: Dispatch<SetStateAction<string>>;
  setDatabaseId: Dispatch<SetStateAction<string>>;
  setDatabases: Dispatch<SetStateAction<DatabaseSummary[]>>;
  setBilling: Dispatch<SetStateAction<DatabaseBilling | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setMembers: Dispatch<SetStateAction<DatabaseMember[]>>;
  setPayments: Dispatch<SetStateAction<PaymentRecord[]>>;
  setPrincipal: Dispatch<SetStateAction<string | null>>;
  setOperationId: Dispatch<SetStateAction<string>>; setOperationStatus: Dispatch<SetStateAction<string>>;
  setQuotaBytes: Dispatch<SetStateAction<string>>;
  setResponse: Dispatch<SetStateAction<SqlExecuteResponse | null>>; setRoutedOperation: Dispatch<SetStateAction<RoutedOperationInfo | null>>;
  setTableDescription: Dispatch<SetStateAction<TableDescription | null>>;
  setTableLimit: Dispatch<SetStateAction<number>>;
  setTableName: Dispatch<SetStateAction<string>>;
  setTableOffset: Dispatch<SetStateAction<number>>;
  setTablePreview: Dispatch<SetStateAction<TablePreviewResponse | null>>;
  setTables: Dispatch<SetStateAction<DatabaseTable[]>>;
  setTokenSession: Dispatch<SetStateAction<IcpdbTokenSession | null>>;
  setTokens: Dispatch<SetStateAction<DatabaseTokenInfo[]>>;
  setUsage: Dispatch<SetStateAction<DatabaseUsage | null>>;
  setUsageEvents: Dispatch<SetStateAction<DatabaseUsageEventSummary[]>>;
  setView: Dispatch<SetStateAction<WorkbenchView>>;
  resetRowEditor: () => void;
  resetDepositApproval: () => void;
};

export function useIcpdbTokenActions(options: TokenActionOptions) {
  const {
    canCreateTable, canDeleteDatabase, canEditRows, canRun, canUpdateCell, cellValue, createTableColumns, createTableName, databaseId,
    editableColumnName, mode, paramsJson, rowJson, selectedRowIndex, sql, sqlMaxRows, tableDescription, tableLimit, tableName,
    tablePreview, tokenDatabaseId, tokenHttpBaseUrl,
    tokenSecret, tokenSession, setBatchResponses, setCreateTableName, setDatabaseId, setDatabases, setBilling,
    setError, setLoadState, setMembers, setPayments, setPrincipal, setOperationId, setOperationStatus, setQuotaBytes, setResponse,
    setRoutedOperation,
    setTableDescription, setTableLimit, setTableName, setTableOffset, setTablePreview, setTables, setTokenSession,
    setTokens, setUsage, setUsageEvents, setView, resetRowEditor, resetDepositApproval
  } = options;

  async function connectTokenSession() {
    const session = normalizeTokenSession(tokenHttpBaseUrl, tokenSecret, tokenDatabaseId);
    setLoadState("loading");
    setError(null);
    try {
      setTokenSession(session);
      setPrincipal(`token:${session.databaseId}`);
      setDatabaseId(session.databaseId);
      await refreshTokenDetails(session, "");
      setLoadState("ready");
    } catch (cause) {
      setTokenSession(null);
      setPrincipal(null);
      setPayments([]);
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setLoadState("error");
    }
  }

  function disconnectTokenSession() {
    setTokenSession(null);
    setPrincipal(null);
    setDatabases([]);
    setBilling(null);
    setDatabaseId("");
    setMembers([]);
    setPayments([]);
    setTables([]);
    setTokens([]);
    setUsage(null);
    setUsageEvents([]);
    setOperationId("");
    setOperationStatus("No operation loaded");
    setRoutedOperation(null);
    setTableName("");
    setTableOffset(0);
    setTableDescription(null);
    setTablePreview(null);
    resetRowEditor();
  }

  async function deleteDatabase() {
    if (!tokenSession || !canDeleteDatabase) return;
    await runTokenAction(async () => {
      await deleteDatabaseWithToken(tokenSession);
      resetDepositApproval();
      disconnectTokenSession();
    });
  }

  async function refreshTokenDetails(session: IcpdbTokenSession, preferredTableName: string) {
    const [info, usage, events] = await Promise.all([
      getSessionInfoWithToken(session),
      getUsageWithToken(session),
      getUsageEventsWithToken(session)
    ]);
    const tables = usage.status === "hot" ? await listTablesWithToken(session) : [];
    let billing: DatabaseBilling | null = null;
    let tokens: DatabaseTokenInfo[] = [];
    let members: DatabaseMember[] = [];
    let payments: PaymentRecord[] = [];
    if (info.role === "owner") {
      [billing, tokens, members, payments] = await Promise.all([
        getBillingWithToken(session),
        listTokensWithToken(session),
        listMembersWithToken(session),
        listPaymentsWithToken(session)
      ]);
    }
    setUsage(usage);
    setBilling(billing);
    setUsageEvents(events);
    setQuotaBytes(usage.maxLogicalSizeBytes);
    setTokens(tokens);
    setMembers(members);
    setPayments(payments);
    setDatabases([{
      databaseId: session.databaseId,
      role: info.role,
      status: usage.status,
      logicalSizeBytes: usage.logicalSizeBytes,
      archivedAtMs: null,
      deletedAtMs: null
    }]);
    setTables(tables);
    const nextTableName = selectPreferredTableName(tables, preferredTableName);
    if (nextTableName) {
      await loadTokenTable(session, nextTableName, 0);
    } else {
      setTableName("");
      setTableOffset(0);
      setTableDescription(null);
      setTablePreview(null);
    }
  }

  async function loadTokenTable(session: IcpdbTokenSession, nextTableName: string, nextOffset: number) {
    const [description, preview] = await Promise.all([
      describeTableWithToken(session, nextTableName),
      previewTableWithToken(session, { databaseId: session.databaseId, tableName: nextTableName, limit: tableLimit, offset: nextOffset })
    ]);
    setTableName(nextTableName);
    setTableOffset(preview.offset);
    setTableDescription(description);
    setTablePreview(preview);
    if (nextTableName !== tableName) resetRowEditor();
  }

  async function createTable() {
    if (!tokenSession || !canCreateTable) return;
    await runTokenAction(async () => {
      const nextTableName = normalizeCreateTableName(createTableName);
      const columnsSql = normalizeCreateTableColumns(createTableColumns);
      const response = await sqlExecuteWithToken(tokenSession, {
        databaseId,
        sql: `CREATE TABLE ${quoteSqlIdentifier(nextTableName)} (${columnsSql})`,
        params: [],
        maxRows: null
      }, { onIdempotencyKey: recordIdempotencyKey });
      recordSqlResponseOperation(response);
      setResponse(response);
      setCreateTableName("");
      await refreshTokenDetails(tokenSession, nextTableName);
      setView("table");
    });
  }

  async function runSql() {
    if (!tokenSession || !canRun) return;
    await runTokenAction(async () => {
      setResponse(null);
      setBatchResponses([]);
      if (mode === "batch") {
        const responses = await sqlBatchWithToken(tokenSession, buildSqlBatchRequest(databaseId, sql), { onIdempotencyKey: recordIdempotencyKey });
        recordSqlResponseOperation(responses.find((response) => response.routedOperationId) ?? null);
        setBatchResponses(responses);
        setResponse(responses.at(-1) ?? null);
      } else {
        const request = { databaseId, sql, params: parseParams(paramsJson, sql), maxRows: parseSqlMaxRows(sqlMaxRows) };
        const response = mode === "query" ? await sqlQueryWithToken(tokenSession, request) : await sqlExecuteWithToken(tokenSession, request, { onIdempotencyKey: recordIdempotencyKey });
        if (mode === "update") recordSqlResponseOperation(response);
        setResponse(response);
      }
      await refreshTokenDetails(tokenSession, tableName);
    });
  }

  async function selectTable(nextTableName: string) {
    if (!tokenSession) return;
    await runTokenAction(async () => {
      await loadTokenTable(tokenSession, nextTableName, 0);
      setView("table");
    });
  }

  async function mutateRow(mutation: RowMutation) {
    if (!tokenSession || !canEditRows || !tableDescription || !tablePreview) return;
    await runTokenAction(async () => {
      const request = mutation === "insert"
        ? buildInsertRequest(databaseId, tableDescription, rowJson)
        : buildSelectedRowMutationRequest(databaseId, tableDescription, tablePreview, selectedRowIndex, rowJson, mutation);
      const response = await sqlExecuteWithToken(tokenSession, request, { onIdempotencyKey: recordIdempotencyKey });
      recordSqlResponseOperation(response);
      setResponse(response);
      await refreshTokenDetails(tokenSession, tableName);
      resetRowEditor();
    });
  }

  async function updateCell() {
    const column = tableDescription?.columns.find((candidate) => candidate.name === editableColumnName) ?? null;
    if (!tokenSession || !canUpdateCell || !tableDescription || !tablePreview || !column) return;
    await runTokenAction(async () => {
      const request = buildSelectedCellMutationRequest(databaseId, tableDescription, tablePreview, selectedRowIndex, column, cellValue);
      const response = await sqlExecuteWithToken(tokenSession, request, { onIdempotencyKey: recordIdempotencyKey });
      recordSqlResponseOperation(response);
      setResponse(response);
      await refreshTokenDetails(tokenSession, tableName);
      resetRowEditor();
    });
  }

  async function loadTablePage(offset: number) {
    if (!tokenSession || !tableName) return;
    await runTokenAction(async () => {
      await loadTokenTable(tokenSession, tableName, Math.max(0, offset));
    });
  }

  async function changeTableLimit(source: string) {
    const nextLimit = parseTableLimit(source);
    setTableLimit(nextLimit);
    if (!tokenSession || !tableName) return;
    await runTokenAction(async () => {
      const preview = await previewTableWithToken(tokenSession, { databaseId, tableName, limit: nextLimit, offset: 0 });
      setTableOffset(preview.offset);
      setTablePreview(preview);
      resetRowEditor();
    });
  }

  async function runTokenAction(action: () => Promise<void>) {
    setLoadState("loading");
    setError(null);
    try {
      await action();
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setLoadState("error");
    }
  }

  function recordIdempotencyKey(idempotencyKey: string) {
    setOperationId(idempotencyKey); setOperationStatus("Last write operation"); setRoutedOperation(null);
  }

  function recordSqlResponseOperation(response: SqlExecuteResponse | null) {
    if (!response?.routedOperationId) return;
    setOperationId(response.routedOperationId); setOperationStatus("Last write operation"); setRoutedOperation(null);
  }

  return { changeTableLimit, connectTokenSession, createTable, deleteDatabase, disconnectTokenSession, loadTablePage, mutateRow, refreshTokenDetails, runSql, selectTable, updateCell };
}
