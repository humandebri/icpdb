// Where: scripts/icpdb-http-transfer.mjs
// What: Chunked archive and restore transfer implementation for the ICPDB HTTP CLI.
// Why: Backup/restore is a core DBaaS workflow and should evolve apart from command parsing and shell logic.

import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";

const ARCHIVE_CHUNK_BYTES = 256 * 1024;

export async function archiveIcpdb(command, fetchImpl, callHttp) {
  const info = await callHttp(archiveBeginCommand(command), fetchImpl);
  const output = await open(command.filePath, "w");
  const hash = createHash("sha256");
  let offset = 0;
  try {
    while (offset < info.size_bytes) {
      const maxBytes = Math.min(ARCHIVE_CHUNK_BYTES, info.size_bytes - offset);
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
    size_bytes: info.size_bytes,
    snapshot_hash: bytesToHex(snapshotHash)
  };
}

export async function restoreIcpdb(command, fetchImpl, callHttp) {
  const bytes = await readFile(command.filePath);
  const snapshotHash = [...createHash("sha256").update(bytes).digest()];
  await callHttp(restoreBeginCommand(command, snapshotHash, bytes.length), fetchImpl);
  for (let offset = 0; offset < bytes.length; offset += ARCHIVE_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + ARCHIVE_CHUNK_BYTES);
    await callHttp(restoreWriteCommand(command, offset, [...chunk]), fetchImpl);
  }
  await callHttp(restoreFinalizeCommand(command), fetchImpl);
  return {
    database_id: command.databaseId,
    file: command.filePath,
    size_bytes: bytes.length,
    snapshot_hash: bytesToHex(snapshotHash)
  };
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
