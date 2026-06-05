"use client";

// icpdb-console/lib/use-icpdb-table-actions.ts
// Table editor action hook: loads table pages and turns row/cell edits into SQLite mutations.

import type { AuthClient } from "@icp-sdk/auth/client";
import type { Dispatch, SetStateAction } from "react";
import {
  previewTableAuthenticated,
  sqlExecuteAuthenticated
} from "@/lib/icpdb-client";
import {
  buildInsertRequest,
  buildNewRowDraft,
  buildSelectedCellMutationRequest,
  buildSelectedRowMutationRequest,
  cellValueForRow,
  rowToJsonObject,
  type RowMutation
} from "@/lib/row-mutations";
import { parseTableLimit } from "@/lib/workbench-state";
import type {
  DatabaseColumn,
  RoutedOperationInfo,
  SqlExecuteResponse,
  SqlValue,
  TableDescription,
  TablePreviewResponse
} from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";
type WorkbenchView = "table" | "sql";

type TableActionOptions = {
  authClient: AuthClient | null;
  canEditRows: boolean;
  canisterId: string;
  canUpdateCell: boolean;
  cellValue: string;
  databaseId: string;
  editableColumns: DatabaseColumn[];
  rowJson: string;
  selectedCellColumn: DatabaseColumn | null;
  selectedCellColumnName: string;
  selectedRow: SqlValue[] | null;
  selectedRowIndex: number | null;
  tableDescription: TableDescription | null;
  tableLimit: number;
  tableName: string;
  tablePreview: TablePreviewResponse | null;
  loadTable: (client: AuthClient, databaseId: string, tableName: string, offset: number) => Promise<void>;
  refreshDatabaseDetails: (client: AuthClient, databaseId: string, preferredTableName: string) => Promise<void>;
  resetRowEditor: () => void;
  setCellValue: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setOperationId: Dispatch<SetStateAction<string>>;
  setOperationStatus: Dispatch<SetStateAction<string>>;
  setResponse: Dispatch<SetStateAction<SqlExecuteResponse | null>>;
  setRowJson: Dispatch<SetStateAction<string>>;
  setRoutedOperation: Dispatch<SetStateAction<RoutedOperationInfo | null>>;
  setSelectedCellColumnName: Dispatch<SetStateAction<string>>;
  setSelectedRowIndex: Dispatch<SetStateAction<number | null>>;
  setTableLimit: Dispatch<SetStateAction<number>>;
  setTableOffset: Dispatch<SetStateAction<number>>;
  setTablePreview: Dispatch<SetStateAction<TablePreviewResponse | null>>;
  setView: Dispatch<SetStateAction<WorkbenchView>>;
};

export function useIcpdbTableActions(options: TableActionOptions) {
  const {
    authClient,
    canEditRows,
    canisterId,
    canUpdateCell,
    cellValue,
    databaseId,
    editableColumns,
    rowJson,
    selectedCellColumn,
    selectedCellColumnName,
    selectedRow,
    selectedRowIndex,
    tableDescription,
    tableLimit,
    tableName,
    tablePreview,
    loadTable,
    refreshDatabaseDetails,
    resetRowEditor,
    setCellValue,
    setError,
    setLoadState,
    setOperationId,
    setOperationStatus,
    setResponse,
    setRowJson,
    setRoutedOperation,
    setSelectedCellColumnName,
    setSelectedRowIndex,
    setTableLimit,
    setTableOffset,
    setTablePreview,
    setView
  } = options;

  function startNewRow() {
    const nextCellColumnName = editableColumns[0]?.name ?? "";
    setSelectedRowIndex(null);
    setRowJson(tableDescription ? JSON.stringify(buildNewRowDraft(tableDescription), null, 2) : "{}");
    setSelectedCellColumnName(nextCellColumnName);
    setCellValue("");
  }

  async function selectTable(nextTableName: string) {
    if (!authClient || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      await loadTable(authClient, databaseId, nextTableName, 0);
      setView("table");
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function mutateRow(mutation: RowMutation) {
    if (!authClient || !canEditRows || !tableDescription || !tablePreview) return;
    setLoadState("loading");
    setError(null);
    try {
      const request =
        mutation === "insert"
          ? buildInsertRequest(databaseId, tableDescription, rowJson)
          : buildSelectedRowMutationRequest(databaseId, tableDescription, tablePreview, selectedRowIndex, rowJson, mutation);
      const nextResponse = await sqlExecuteAuthenticated(canisterId, authClient.getIdentity(), request);
      setResponse(nextResponse);
      recordSqlResponseOperation(nextResponse);
      await refreshDatabaseDetails(authClient, databaseId, tableName);
      resetRowEditor();
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function updateCell() {
    if (!authClient || !canUpdateCell || !tableDescription || !tablePreview || !selectedCellColumn) return;
    setLoadState("loading");
    setError(null);
    try {
      const request = buildSelectedCellMutationRequest(
        databaseId,
        tableDescription,
        tablePreview,
        selectedRowIndex,
        selectedCellColumn,
        cellValue
      );
      const nextResponse = await sqlExecuteAuthenticated(canisterId, authClient.getIdentity(), request);
      setResponse(nextResponse);
      recordSqlResponseOperation(nextResponse);
      await refreshDatabaseDetails(authClient, databaseId, tableName);
      resetRowEditor();
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  function selectPreviewRow(rowIndex: number) {
    if (!tablePreview) return;
    const row = tablePreview.rows[rowIndex];
    if (!row) return;
    const nextCellColumnName = preferredCellColumnName(editableColumns, selectedCellColumnName);
    setSelectedRowIndex(rowIndex);
    setRowJson(JSON.stringify(rowToJsonObject(tablePreview.columns, row), null, 2));
    setSelectedCellColumnName(nextCellColumnName);
    setCellValue(cellValueForRow(tablePreview, row, nextCellColumnName));
  }

  function selectPreviewCell(rowIndex: number, columnName: string) {
    if (!tablePreview) return;
    const row = tablePreview.rows[rowIndex];
    if (!row) return;
    const nextCellColumnName = editableColumns.some((column) => column.name === columnName)
      ? columnName
      : preferredCellColumnName(editableColumns, selectedCellColumnName);
    setSelectedRowIndex(rowIndex);
    setRowJson(JSON.stringify(rowToJsonObject(tablePreview.columns, row), null, 2));
    setSelectedCellColumnName(nextCellColumnName);
    setCellValue(cellValueForRow(tablePreview, row, nextCellColumnName));
  }

  function changeSelectedCellColumn(nextColumnName: string) {
    setSelectedCellColumnName(nextColumnName);
    setCellValue(selectedRow && tablePreview ? cellValueForRow(tablePreview, selectedRow, nextColumnName) : "");
  }

  async function loadTablePage(nextOffset: number) {
    if (!authClient || !databaseId || !tableName || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      await loadTable(authClient, databaseId, tableName, Math.max(0, nextOffset));
      resetRowEditor();
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function changeTableLimit(source: string) {
    const nextLimit = parseTableLimit(source);
    setTableLimit(nextLimit);
    if (!authClient || !databaseId || !tableName || !canisterId) {
      return;
    }
    setLoadState("loading");
    setError(null);
    try {
      const identity = authClient.getIdentity();
      const nextPreview = await previewTableAuthenticated(canisterId, identity, {
        databaseId,
        tableName,
        limit: nextLimit,
        offset: 0
      });
      setTableOffset(nextPreview.offset);
      setTablePreview(nextPreview);
      resetRowEditor();
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  return {
    changeSelectedCellColumn,
    changeTableLimit,
    loadTablePage,
    mutateRow,
    selectPreviewCell,
    selectPreviewRow,
    selectTable,
    startNewRow,
    updateCell
  };

  function recordSqlResponseOperation(response: SqlExecuteResponse) {
    if (!response.routedOperationId) return;
    setOperationId(response.routedOperationId);
    setOperationStatus("Last write operation");
    setRoutedOperation(null);
  }
}

function preferredCellColumnName(columns: DatabaseColumn[], currentColumnName: string): string {
  return columns.find((column) => column.name === currentColumnName)?.name ?? columns[0]?.name ?? "";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}
