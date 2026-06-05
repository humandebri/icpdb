// Where: scripts/icpdb-http-transfer.mjs
// What: Chunked archive and restore transfer implementation for the ICPDB HTTP CLI.
// Why: Backup/restore is a core DBaaS workflow and should evolve apart from command parsing and shell logic.

import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";

const ARCHIVE_CHUNK_BYTES = 256 * 1024;

export async function archiveIcpdb(command, fetchImpl, callHttp) {
  const info = await callHttp(archiveBeginCommand(command), fetchImpl);
  try {
    const sizeBytes = archiveSizeBytes(info.size_bytes);
    const output = await open(command.filePath, "w");
    const hash = createHash("sha256");
    let offset = 0;
    try {
      while (offset < sizeBytes) {
        const maxBytes = Math.min(ARCHIVE_CHUNK_BYTES, sizeBytes - offset);
        const chunk = await callHttp(archiveReadCommand(command, offset, maxBytes), fetchImpl);
        const bytes = Buffer.from(chunk.bytes);
        if (bytes.length === 0) {
          throw new Error("archive stream ended before expected size");
        }
        await output.write(bytes, 0, bytes.length, offset);
        hash.update(bytes);
        offset += bytes.length;
      }
    } finally {
      await output.close();
    }
    const snapshotHash = [...hash.digest()];
    await callHttp(archiveFinalizeCommand(command, snapshotHash), fetchImpl);
    return {
      database_id: command.databaseId,
      file: command.filePath,
      size_bytes: sizeBytes,
      snapshot_hash: bytesToHex(snapshotHash)
    };
  } catch (error) {
    try {
      await callHttp(archiveCancelCommand(command), fetchImpl);
    } catch (_cancelError) {
      // Preserve the original archive failure; cancel is best-effort cleanup.
    }
    throw error;
  }
}

export async function restoreIcpdb(command, fetchImpl, callHttp) {
  const snapshot = await snapshotFileInfo(command.filePath);
  const snapshotHash = snapshot.snapshotHash;
  const snapshotHashHex = bytesToHex(snapshotHash);
  if (command.expectedSnapshotHash && command.expectedSnapshotHash !== snapshotHashHex) {
    throw new Error(`snapshot hash mismatch: expected ${command.expectedSnapshotHash}, got ${snapshotHashHex}`);
  }
  await callHttp(restoreBeginCommand(command, snapshotHash, snapshot.sizeBytes), fetchImpl);
  const input = await open(command.filePath, "r");
  try {
    let offset = 0;
    while (offset < snapshot.sizeBytes) {
      const length = Math.min(ARCHIVE_CHUNK_BYTES, snapshot.sizeBytes - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (bytesRead === 0) {
        throw new Error("restore file ended before expected size");
      }
      const chunk = buffer.subarray(0, bytesRead);
      await callHttp(restoreWriteCommand(command, offset, [...chunk]), fetchImpl);
      offset += bytesRead;
    }
  } finally {
    await input.close();
  }
  await callHttp(restoreFinalizeCommand(command), fetchImpl);
  return {
    database_id: command.databaseId,
    file: command.filePath,
    size_bytes: snapshot.sizeBytes,
    snapshot_hash: snapshotHashHex
  };
}

export async function snapshotInfoIcpdb(command) {
  const snapshot = await snapshotFileInfo(command.filePath);
  return {
    file: command.filePath,
    size_bytes: snapshot.sizeBytes,
    snapshot_hash: bytesToHex(snapshot.snapshotHash)
  };
}

async function snapshotFileInfo(filePath) {
  const file = await stat(filePath);
  if (!Number.isSafeInteger(file.size)) {
    throw new Error("snapshot file size exceeds JavaScript safe integer range");
  }
  const input = await open(filePath, "r");
  const hash = createHash("sha256");
  let offset = 0;
  try {
    while (offset < file.size) {
      const length = Math.min(ARCHIVE_CHUNK_BYTES, file.size - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (bytesRead === 0) {
        throw new Error("snapshot file ended before expected size");
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    await input.close();
  }
  return {
    sizeBytes: file.size,
    snapshotHash: [...hash.digest()]
  };
}

function archiveSizeBytes(value) {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("archive size_bytes exceeds JavaScript safe integer range");
    if (value < 0n) throw new Error("archive size_bytes must be a non-negative integer");
    return Number(value);
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new Error("archive size_bytes must be a non-negative integer");
    if (!Number.isSafeInteger(value)) throw new Error("archive size_bytes exceeds JavaScript safe integer range");
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return archiveSizeBytes(BigInt(value));
  }
  throw new Error("archive size_bytes must be a non-negative integer");
}

function archiveBeginCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/archive/begin",
    body: { database_id: command.databaseId }
  };
}

function archiveReadCommand(command, offset, maxBytes) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/archive/read",
    body: {
      database_id: command.databaseId,
      offset,
      max_bytes: maxBytes
    }
  };
}

function archiveFinalizeCommand(command, snapshotHash) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/archive/finalize",
    body: {
      database_id: command.databaseId,
      snapshot_hash: snapshotHash
    }
  };
}

function archiveCancelCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/archive/cancel",
    body: { database_id: command.databaseId }
  };
}

function restoreBeginCommand(command, snapshotHash, sizeBytes) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/restore/begin",
    body: {
      database_id: command.databaseId,
      snapshot_hash: snapshotHash,
      size_bytes: sizeBytes
    }
  };
}

function restoreWriteCommand(command, offset, bytes) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/restore/write",
    body: {
      database_id: command.databaseId,
      offset,
      bytes
    }
  };
}

function restoreFinalizeCommand(command) {
  return {
    baseUrl: command.baseUrl,
    token: command.token,
    endpoint: "/v1/restore/finalize",
    body: { database_id: command.databaseId }
  };
}

function bytesToHex(bytes) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
