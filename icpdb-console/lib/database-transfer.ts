// icpdb-console/lib/database-transfer.ts
// Backup and restore transfer helpers: stream chunk APIs and SQL dump files outside React components.

import type { Identity } from "@icp-sdk/core/agent";
import {
  beginDatabaseArchiveAuthenticated,
  beginDatabaseRestoreAuthenticated,
  finalizeDatabaseArchiveAuthenticated,
  finalizeDatabaseRestoreAuthenticated,
  readDatabaseArchiveChunkAuthenticated,
  sqlBatchAuthenticated,
  writeDatabaseRestoreChunkAuthenticated
} from "@/lib/icpdb-client";
import {
  beginArchiveWithToken,
  beginRestoreWithToken,
  finalizeArchiveWithToken,
  finalizeRestoreWithToken,
  readArchiveChunkWithToken,
  writeRestoreChunkWithToken
} from "@/lib/icpdb-http-admin-client";
import { sqlBatchWithToken, type IcpdbTokenSession } from "@/lib/icpdb-http-client";
import {
  appendBytes,
  archiveSnapshotFileName,
  bytesToHex
} from "@/lib/workbench-state";
import {
  buildSqlDump,
  buildSqlDumpWithToken,
  splitSqlDumpStatements
} from "@/lib/sql-dump";
import type {
  DatabaseArchiveInfo,
  SqlExecuteResponse
} from "@/lib/types";

export type ArchiveSnapshot = DatabaseArchiveInfo & {
  bytes: number[];
  hashBytes: number[];
  hashHex: string;
};

export type ArchiveSnapshotFile = {
  snapshot: ArchiveSnapshot;
  fileName: string;
};

export type TransferProgress = (doneBytes: string, totalBytes: string) => void;
export type SqlDumpProgress = (loadedStatements: number, totalStatements: number) => void;

export async function archiveDatabaseToSnapshot(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  chunkBytes: number,
  onProgress: TransferProgress
): Promise<ArchiveSnapshotFile> {
  const info = await beginDatabaseArchiveAuthenticated(canisterId, identity, databaseId);
  const sizeBytes = checkedBrowserSize(info.sizeBytes);
  const bytes: number[] = [];
  let offset = 0;
  while (offset < sizeBytes) {
    const maxBytes = Math.min(chunkBytes, sizeBytes - offset);
    const chunk = await readDatabaseArchiveChunkAuthenticated(canisterId, identity, databaseId, String(offset), maxBytes);
    if (chunk.length === 0) {
      throw new Error("archive chunk stream stopped before snapshot end");
    }
    appendBytes(bytes, chunk);
    offset += chunk.length;
    onProgress(String(offset), info.sizeBytes);
  }
  const hashBytes = await digestBytes(bytes);
  await finalizeDatabaseArchiveAuthenticated(canisterId, identity, databaseId, hashBytes);
  const hashHex = bytesToHex(hashBytes);
  return {
    snapshot: { ...info, bytes, hashBytes, hashHex },
    fileName: archiveSnapshotFileName(databaseId, hashHex)
  };
}

export async function archiveDatabaseToSnapshotWithToken(
  session: IcpdbTokenSession,
  chunkBytes: number,
  onProgress: TransferProgress
): Promise<ArchiveSnapshotFile> {
  const info = await beginArchiveWithToken(session);
  const sizeBytes = checkedBrowserSize(info.sizeBytes);
  const bytes: number[] = [];
  let offset = 0;
  while (offset < sizeBytes) {
    const chunk = await readArchiveChunkWithToken(session, offset, Math.min(chunkBytes, sizeBytes - offset));
    if (chunk.length === 0) throw new Error("archive chunk stream stopped before snapshot end");
    appendBytes(bytes, chunk);
    offset += chunk.length;
    onProgress(String(offset), info.sizeBytes);
  }
  const hashBytes = await digestBytes(bytes);
  await finalizeArchiveWithToken(session, hashBytes);
  const hashHex = bytesToHex(hashBytes);
  return {
    snapshot: { ...info, bytes, hashBytes, hashHex },
    fileName: archiveSnapshotFileName(session.databaseId, hashHex)
  };
}

export async function loadArchiveSnapshotFromFile(databaseId: string, file: File): Promise<ArchiveSnapshotFile> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  if (bytes.length === 0) {
    throw new Error("archive file is empty");
  }
  const hashBytes = await digestBytes(bytes);
  const hashHex = bytesToHex(hashBytes);
  const fileName = file.name || archiveSnapshotFileName(databaseId, hashHex);
  return {
    snapshot: {
      databaseId,
      sizeBytes: String(bytes.length),
      bytes,
      hashBytes,
      hashHex
    },
    fileName
  };
}

export function downloadArchiveSnapshotFile(snapshot: ArchiveSnapshot, fileName: string) {
  downloadFile(new Uint8Array(snapshot.bytes), fileName, "application/octet-stream");
}

export async function downloadSqlDumpFile(canisterId: string, identity: Identity, databaseId: string): Promise<number> {
  const dump = await buildSqlDump(canisterId, identity, databaseId);
  const blob = new Blob([dump], { type: "application/sql;charset=utf-8" });
  downloadFile(blob, `${databaseId}.sql`, blob.type);
  return blob.size;
}

export async function downloadSqlDumpFileWithToken(session: IcpdbTokenSession): Promise<number> {
  const dump = await buildSqlDumpWithToken(session);
  const blob = new Blob([dump], { type: "application/sql;charset=utf-8" });
  downloadFile(blob, `${session.databaseId}.sql`, blob.type);
  return blob.size;
}

export async function loadSqlDumpFromFile(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  file: File,
  maxBatchStatements: number,
  onProgress: SqlDumpProgress
): Promise<SqlExecuteResponse[]> {
  const source = await file.text();
  const statements = splitSqlDumpStatements(source).map((sql) => ({ sql, params: [] }));
  if (statements.length === 0) {
    throw new Error("SQL dump has no executable statements");
  }
  const responses: SqlExecuteResponse[] = [];
  for (let offset = 0; offset < statements.length; offset += maxBatchStatements) {
    const batch = statements.slice(offset, offset + maxBatchStatements);
    const nextResponses = await sqlBatchAuthenticated(canisterId, identity, {
      databaseId,
      statements: batch,
      maxRows: 100
    });
    responses.push(...nextResponses);
    onProgress(Math.min(offset + batch.length, statements.length), statements.length);
  }
  return responses;
}

export async function loadSqlDumpFromFileWithToken(
  session: IcpdbTokenSession,
  file: File,
  maxBatchStatements: number,
  onProgress: SqlDumpProgress
): Promise<SqlExecuteResponse[]> {
  const source = await file.text();
  const statements = splitSqlDumpStatements(source).map((sql) => ({ sql, params: [] }));
  if (statements.length === 0) {
    throw new Error("SQL dump has no executable statements");
  }
  const responses: SqlExecuteResponse[] = [];
  for (let offset = 0; offset < statements.length; offset += maxBatchStatements) {
    const batch = statements.slice(offset, offset + maxBatchStatements);
    const nextResponses = await sqlBatchWithToken(session, {
      databaseId: session.databaseId,
      statements: batch,
      maxRows: 100
    });
    responses.push(...nextResponses);
    onProgress(Math.min(offset + batch.length, statements.length), statements.length);
  }
  return responses;
}

export async function restoreArchiveSnapshot(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  snapshot: ArchiveSnapshot,
  chunkBytes: number,
  onProgress: TransferProgress
) {
  await beginDatabaseRestoreAuthenticated(canisterId, identity, databaseId, snapshot.hashBytes, snapshot.sizeBytes);
  let offset = 0;
  while (offset < snapshot.bytes.length) {
    const chunk = snapshot.bytes.slice(offset, offset + chunkBytes);
    await writeDatabaseRestoreChunkAuthenticated(canisterId, identity, databaseId, String(offset), chunk);
    offset += chunk.length;
    onProgress(String(offset), snapshot.sizeBytes);
  }
  await finalizeDatabaseRestoreAuthenticated(canisterId, identity, databaseId);
}

export async function restoreArchiveSnapshotWithToken(
  session: IcpdbTokenSession,
  snapshot: ArchiveSnapshot,
  chunkBytes: number,
  onProgress: TransferProgress
) {
  await beginRestoreWithToken(session, snapshot.hashBytes, snapshot.sizeBytes);
  let offset = 0;
  while (offset < snapshot.bytes.length) {
    const chunk = snapshot.bytes.slice(offset, offset + chunkBytes);
    await writeRestoreChunkWithToken(session, offset, chunk);
    offset += chunk.length;
    onProgress(String(offset), snapshot.sizeBytes);
  }
  await finalizeRestoreWithToken(session);
}

function checkedBrowserSize(sizeBytesText: string): number {
  const sizeBytes = Number(sizeBytesText);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("archive is too large for browser memory");
  }
  return sizeBytes;
}

async function digestBytes(bytes: number[]): Promise<number[]> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest));
}

function downloadFile(data: BlobPart, fileName: string, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
