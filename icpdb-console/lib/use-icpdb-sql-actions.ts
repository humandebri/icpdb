"use client";

// icpdb-console/lib/use-icpdb-sql-actions.ts
// SQL action hook: creates tables and runs query/update/batch statements against the selected DB.

import type { AuthClient } from "@icp-sdk/auth/client";
import type { Dispatch, SetStateAction } from "react";
import {
  sqlBatchAuthenticated,
  sqlExecuteAuthenticated,
  sqlQueryAuthenticated
} from "@/lib/icpdb-client";
import {
  buildSqlBatchRequest,
  quoteSqlIdentifier
} from "@/lib/sql-dump";
import {
  normalizeCreateTableColumns,
  normalizeCreateTableName,
  parseParams,
  parseSqlMaxRows
} from "@/lib/workbench-state";
import type { RoutedOperationInfo, SqlExecuteResponse } from "@/lib/types";

export type SqlMode = "query" | "update" | "batch";
export type WorkbenchView = "table" | "sql";

type LoadState = "idle" | "loading" | "ready" | "error";

type SqlActionOptions = {
  authClient: AuthClient | null;
  canCreateTable: boolean;
  canisterId: string;
  canRun: boolean;
  createTableColumns: string;
  createTableName: string;
  databaseId: string;
  mode: SqlMode;
  paramsJson: string;
  sql: string;
  sqlMaxRows: string;
  tableName: string;
  refreshDatabaseDetails: (client: AuthClient, databaseId: string, preferredTableName: string) => Promise<void>;
  setBatchResponses: Dispatch<SetStateAction<SqlExecuteResponse[]>>;
  setCreateTableName: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setOperationId: Dispatch<SetStateAction<string>>;
  setOperationStatus: Dispatch<SetStateAction<string>>;
  setResponse: Dispatch<SetStateAction<SqlExecuteResponse | null>>;
  setRoutedOperation: Dispatch<SetStateAction<RoutedOperationInfo | null>>;
  setView: Dispatch<SetStateAction<WorkbenchView>>;
};

export function useIcpdbSqlActions(options: SqlActionOptions) {
  const {
    authClient,
    canCreateTable,
    canisterId,
    canRun,
    createTableColumns,
    createTableName,
    databaseId,
    mode,
    paramsJson,
    sql,
    sqlMaxRows,
    tableName,
    refreshDatabaseDetails,
    setBatchResponses,
    setCreateTableName,
    setError,
    setLoadState,
    setOperationId,
    setOperationStatus,
    setResponse,
    setRoutedOperation,
    setView
  } = options;

  async function createTable() {
    if (!authClient || !canCreateTable || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      const nextTableName = normalizeCreateTableName(createTableName);
      const columnsSql = normalizeCreateTableColumns(createTableColumns);
      const nextResponse = await sqlExecuteAuthenticated(canisterId, authClient.getIdentity(), {
        databaseId,
        sql: `CREATE TABLE ${quoteSqlIdentifier(nextTableName)} (${columnsSql})`,
        params: [],
        maxRows: null
      });
      setResponse(nextResponse);
      recordSqlResponseOperation(nextResponse);
      setCreateTableName("");
      await refreshDatabaseDetails(authClient, databaseId, nextTableName);
      setView("table");
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function runSql() {
    if (!authClient || !canRun) return;
    setLoadState("loading");
    setError(null);
    setResponse(null);
    setBatchResponses([]);
    try {
      if (mode === "batch") {
        const request = buildSqlBatchRequest(databaseId, sql);
        const nextResponses = await sqlBatchAuthenticated(canisterId, authClient.getIdentity(), request);
        setBatchResponses(nextResponses);
        setResponse(nextResponses.at(-1) ?? null);
        recordSqlResponseOperation(nextResponses.find((response) => response.routedOperationId) ?? null);
      } else {
        const params = parseParams(paramsJson, sql);
        const request = { databaseId, sql, params, maxRows: parseSqlMaxRows(sqlMaxRows) };
        const nextResponse =
          mode === "query"
            ? await sqlQueryAuthenticated(canisterId, authClient.getIdentity(), request)
            : await sqlExecuteAuthenticated(canisterId, authClient.getIdentity(), request);
        setResponse(nextResponse);
        recordSqlResponseOperation(nextResponse);
      }
      await refreshDatabaseDetails(authClient, databaseId, tableName);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  return { createTable, runSql };

  function recordSqlResponseOperation(response: SqlExecuteResponse | null) {
    if (!response?.routedOperationId) return;
    setOperationId(response.routedOperationId);
    setOperationStatus("Last write operation");
    setRoutedOperation(null);
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}
