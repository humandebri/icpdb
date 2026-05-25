"use client";

// icpdb-console/lib/use-icpdb-backup-actions.ts
// Backup action hook: coordinates archive snapshots, restore chunks, and SQL dump import/export UI state.

import type { AuthClient } from "@icp-sdk/auth/client";
import type { Dispatch, SetStateAction } from "react";
import {
  archiveDatabaseToSnapshot,
  downloadArchiveSnapshotFile,
  downloadSqlDumpFile,
  loadArchiveSnapshotFromFile,
  loadSqlDumpFromFile,
  restoreArchiveSnapshot,
  type ArchiveSnapshot
} from "@/lib/database-transfer";
import { formatBytes } from "@/lib/workbench-state";
import type { SqlExecuteResponse } from "@/lib/types";

export type { ArchiveSnapshot } from "@/lib/database-transfer";

type LoadState = "idle" | "loading" | "ready" | "error";

type BackupActionOptions = {
  archiveSnapshot: ArchiveSnapshot | null;
  archiveSnapshotName: string | null;
  authClient: AuthClient | null;
  canArchive: boolean;
  canDownloadSqlDump: boolean;
  canLoadSqlDump: boolean;
  canRestore: boolean;
  canisterId: string;
  databaseId: string;
  tableName: string;
  clearTableState: () => void;
  refreshDatabaseAccount: (client: AuthClient, databaseId: string) => Promise<void>;
  refreshDatabaseDetails: (client: AuthClient, databaseId: string, preferredTableName: string) => Promise<void>;
  refreshDatabases: (client: AuthClient) => Promise<void>;
  setArchiveSnapshot: Dispatch<SetStateAction<ArchiveSnapshot | null>>;
  setArchiveSnapshotName: Dispatch<SetStateAction<string | null>>;
  setArchiveStatus: Dispatch<SetStateAction<string>>;
  setBatchResponses: Dispatch<SetStateAction<SqlExecuteResponse[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setResponse: Dispatch<SetStateAction<SqlExecuteResponse | null>>;
  setSqlDumpStatus: Dispatch<SetStateAction<string>>;
};

const archiveChunkBytes = 256 * 1024;
const maxBatchStatements = 32;

export function useIcpdbBackupActions(options: BackupActionOptions) {
  const {
    archiveSnapshot,
    archiveSnapshotName,
    authClient,
    canArchive,
    canDownloadSqlDump,
    canLoadSqlDump,
    canRestore,
    canisterId,
    databaseId,
    tableName,
    clearTableState,
    refreshDatabaseAccount,
    refreshDatabaseDetails,
    refreshDatabases,
    setArchiveSnapshot,
    setArchiveSnapshotName,
    setArchiveStatus,
    setBatchResponses,
    setError,
    setLoadState,
    setResponse,
    setSqlDumpStatus
  } = options;

  async function archiveDatabase() {
    if (!authClient || !canArchive || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setArchiveStatus("Archive started");
    try {
      const { snapshot, fileName } = await archiveDatabaseToSnapshot(
        canisterId,
        authClient.getIdentity(),
        databaseId,
        archiveChunkBytes,
        (doneBytes, totalBytes) => setArchiveStatus(`Read ${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`)
      );
      setArchiveSnapshot(snapshot);
      setArchiveSnapshotName(fileName);
      setArchiveStatus(`Archived ${formatBytes(snapshot.sizeBytes)}`);
      clearTableState();
      await refreshDatabases(authClient);
      await refreshDatabaseAccount(authClient, databaseId);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setArchiveStatus("Archive failed");
      setLoadState("error");
    }
  }

  async function loadArchiveFile(file: File | null) {
    if (!file) return;
    if (!databaseId) {
      setError("select a database before loading an archive file");
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    setError(null);
    try {
      const { snapshot, fileName } = await loadArchiveSnapshotFromFile(databaseId, file);
      setArchiveSnapshot(snapshot);
      setArchiveSnapshotName(fileName);
      setArchiveStatus(`Loaded ${formatBytes(snapshot.sizeBytes)}`);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setArchiveStatus("Load failed");
      setLoadState("error");
    }
  }

  async function downloadArchiveSnapshot() {
    if (!archiveSnapshot) return;
    downloadArchiveSnapshotFile(archiveSnapshot, archiveSnapshotName ?? `${archiveSnapshot.databaseId}.sqlite3`);
  }

  async function downloadSqlDump() {
    if (!authClient || !canDownloadSqlDump || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setSqlDumpStatus("Dump started");
    try {
      const sizeBytes = await downloadSqlDumpFile(canisterId, authClient.getIdentity(), databaseId);
      setSqlDumpStatus(`Dumped ${formatBytes(String(sizeBytes))}`);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setSqlDumpStatus("Dump failed");
      setLoadState("error");
    }
  }

  async function loadSqlDumpFile(file: File | null) {
    if (!file) return;
    if (!authClient || !canLoadSqlDump || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setSqlDumpStatus("Load started");
    try {
      const responses = await loadSqlDumpFromFile(
        canisterId,
        authClient.getIdentity(),
        databaseId,
        file,
        maxBatchStatements,
        (loadedStatements, totalStatements) => setSqlDumpStatus(`Loaded ${loadedStatements} / ${totalStatements}`)
      );
      setBatchResponses(responses);
      setResponse(responses.at(-1) ?? null);
      await refreshDatabaseDetails(authClient, databaseId, tableName);
      setSqlDumpStatus(`Loaded ${responses.length} statements`);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setSqlDumpStatus("Load failed");
      setLoadState("error");
    }
  }

  async function restoreArchive() {
    if (!authClient || !canRestore || !archiveSnapshot || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setArchiveStatus("Restore started");
    try {
      await restoreArchiveSnapshot(
        canisterId,
        authClient.getIdentity(),
        databaseId,
        archiveSnapshot,
        archiveChunkBytes,
        (doneBytes, totalBytes) => setArchiveStatus(`Wrote ${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`)
      );
      setArchiveStatus(`Restored ${formatBytes(archiveSnapshot.sizeBytes)}`);
      await refreshDatabases(authClient);
      await refreshDatabaseDetails(authClient, databaseId, tableName);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setArchiveStatus("Restore failed");
      setLoadState("error");
    }
  }

  return {
    archiveDatabase,
    downloadArchiveSnapshot,
    downloadSqlDump,
    loadArchiveFile,
    loadSqlDumpFile,
    restoreArchive
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}
