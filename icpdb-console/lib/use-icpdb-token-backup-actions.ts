"use client";

// icpdb-console/lib/use-icpdb-token-backup-actions.ts
// Owner-token backup actions: archive/restore snapshots and SQL dump import/export through HTTP APIs.

import type { Dispatch, SetStateAction } from "react";
import {
  cancelArchiveWithToken,
} from "@/lib/icpdb-http-admin-client";
import {
  archiveDatabaseToSnapshotWithToken,
  downloadSqlDumpFileWithToken,
  loadSqlDumpFromFileWithToken,
  restoreArchiveSnapshotWithToken,
  type ArchiveSnapshot
} from "@/lib/database-transfer";
import type { IcpdbTokenSession } from "@/lib/icpdb-http-client";
import { formatBytes } from "@/lib/workbench-state";
import type { DatabaseTable, SqlExecuteResponse, TableDescription, TablePreviewResponse } from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

type TokenBackupActionOptions = {
  archiveSnapshot: ArchiveSnapshot | null;
  canArchive: boolean;
  canCancelArchive: boolean;
  canDownloadSqlDump: boolean;
  canLoadSqlDump: boolean;
  canRestore: boolean;
  tableName: string;
  tokenSession: IcpdbTokenSession | null;
  refreshTokenDetails: (session: IcpdbTokenSession, preferredTableName: string) => Promise<void>;
  resetRowEditor: () => void;
  setArchiveSnapshot: Dispatch<SetStateAction<ArchiveSnapshot | null>>;
  setArchiveSnapshotName: Dispatch<SetStateAction<string | null>>;
  setArchiveStatus: Dispatch<SetStateAction<string>>;
  setBatchResponses: Dispatch<SetStateAction<SqlExecuteResponse[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setResponse: Dispatch<SetStateAction<SqlExecuteResponse | null>>;
  setSqlDumpStatus: Dispatch<SetStateAction<string>>;
  setTableDescription: Dispatch<SetStateAction<TableDescription | null>>;
  setTableName: Dispatch<SetStateAction<string>>;
  setTableOffset: Dispatch<SetStateAction<number>>;
  setTablePreview: Dispatch<SetStateAction<TablePreviewResponse | null>>;
  setTables: Dispatch<SetStateAction<DatabaseTable[]>>;
};

const archiveChunkBytes = 256 * 1024;
const maxBatchStatements = 32;

export function useIcpdbTokenBackupActions(options: TokenBackupActionOptions) {
  const {
    archiveSnapshot, canArchive, canCancelArchive, canDownloadSqlDump, canLoadSqlDump, canRestore, tableName, tokenSession,
    refreshTokenDetails, resetRowEditor, setArchiveSnapshot, setArchiveSnapshotName, setArchiveStatus,
    setBatchResponses, setError, setLoadState, setResponse, setSqlDumpStatus, setTableDescription,
    setTableName, setTableOffset, setTablePreview, setTables
  } = options;

  async function archiveDatabase() {
    if (!tokenSession || !canArchive) return;
    setLoadState("loading");
    setError(null);
    setArchiveStatus("Archive started");
    try {
      const { snapshot, fileName } = await archiveDatabaseToSnapshotWithToken(
        tokenSession,
        archiveChunkBytes,
        (doneBytes, totalBytes) => setArchiveStatus(`Read ${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`)
      );
      setArchiveSnapshot(snapshot);
      setArchiveSnapshotName(fileName);
      setArchiveStatus(`Archived ${formatBytes(snapshot.sizeBytes)}`);
      clearTableState();
      await refreshTokenDetails(tokenSession, "");
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setArchiveStatus("Archive failed");
      setLoadState("error");
    }
  }

  async function downloadSqlDump() {
    if (!tokenSession || !canDownloadSqlDump) return;
    setLoadState("loading");
    setError(null);
    setSqlDumpStatus("Dump started");
    try {
      const sizeBytes = await downloadSqlDumpFileWithToken(tokenSession);
      setSqlDumpStatus(`Dumped ${formatBytes(String(sizeBytes))}`);
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setSqlDumpStatus("Dump failed");
      setLoadState("error");
    }
  }

  async function loadSqlDumpFile(file: File | null) {
    if (!file || !tokenSession || !canLoadSqlDump) return;
    setLoadState("loading");
    setError(null);
    setSqlDumpStatus("Load started");
    try {
      const responses = await loadSqlDumpFromFileWithToken(
        tokenSession,
        file,
        maxBatchStatements,
        (loadedStatements, totalStatements) => setSqlDumpStatus(`Loaded ${loadedStatements} / ${totalStatements}`)
      );
      setBatchResponses(responses);
      setResponse(responses.at(-1) ?? null);
      await refreshTokenDetails(tokenSession, tableName);
      setSqlDumpStatus(`Loaded ${responses.length} statements`);
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setSqlDumpStatus("Load failed");
      setLoadState("error");
    }
  }

  async function cancelArchive() {
    if (!tokenSession || !canCancelArchive) return;
    setLoadState("loading");
    setError(null);
    try {
      await cancelArchiveWithToken(tokenSession);
      setArchiveStatus("Archive cancelled");
      clearTableState();
      await refreshTokenDetails(tokenSession, "");
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setLoadState("error");
    }
  }

  async function restoreArchive() {
    if (!tokenSession || !canRestore || !archiveSnapshot) return;
    setLoadState("loading");
    setError(null);
    setArchiveStatus("Restore started");
    try {
      await restoreArchiveSnapshotWithToken(
        tokenSession,
        archiveSnapshot,
        archiveChunkBytes,
        (doneBytes, totalBytes) => setArchiveStatus(`Wrote ${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`)
      );
      setArchiveStatus(`Restored ${formatBytes(archiveSnapshot.sizeBytes)}`);
      await refreshTokenDetails(tokenSession, tableName);
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setArchiveStatus("Restore failed");
      setLoadState("error");
    }
  }

  function clearTableState() {
    setTables([]);
    setTableName("");
    setTableOffset(0);
    setTableDescription(null);
    setTablePreview(null);
    resetRowEditor();
  }

  return { archiveDatabase, cancelArchive, downloadSqlDump, loadSqlDumpFile, restoreArchive };
}
