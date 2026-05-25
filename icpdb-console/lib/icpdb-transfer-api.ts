// icpdb-console/lib/icpdb-transfer-api.ts
// Chunked archive and restore API calls.

import type { Identity } from "@icp-sdk/core/agent";
import { callIcpdb, createAuthenticatedActor, throwCanisterError } from "@/lib/icpdb-actor";
import { normalizeDatabaseArchiveInfo } from "@/lib/icpdb-database-codec";
import type { DatabaseArchiveInfo } from "@/lib/types";

export async function beginDatabaseArchiveAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string
): Promise<DatabaseArchiveInfo> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.begin_database_archive(databaseId);
    if ("Err" in result) throwCanisterError(result.Err);
    return normalizeDatabaseArchiveInfo(result.Ok);
  });
}

export async function readDatabaseArchiveChunkAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  offset: string,
  maxBytes: number
): Promise<number[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.read_database_archive_chunk(databaseId, BigInt(offset), maxBytes);
    if ("Err" in result) throwCanisterError(result.Err);
    return result.Ok.bytes;
  });
}

export async function finalizeDatabaseArchiveAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  snapshotHash: number[]
): Promise<void> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.finalize_database_archive(databaseId, snapshotHash);
    if ("Err" in result) throwCanisterError(result.Err);
  });
}

export async function cancelDatabaseArchiveAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<void> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.cancel_database_archive(databaseId);
    if ("Err" in result) throwCanisterError(result.Err);
  });
}

export async function beginDatabaseRestoreAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  snapshotHash: number[],
  sizeBytes: string
): Promise<void> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.begin_database_restore(databaseId, snapshotHash, BigInt(sizeBytes));
    if ("Err" in result) throwCanisterError(result.Err);
  });
}

export async function writeDatabaseRestoreChunkAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  offset: string,
  bytes: number[]
): Promise<void> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.write_database_restore_chunk({
      database_id: databaseId,
      offset: BigInt(offset),
      bytes
    });
    if ("Err" in result) throwCanisterError(result.Err);
  });
}

export async function finalizeDatabaseRestoreAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<void> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.finalize_database_restore(databaseId);
    if ("Err" in result) throwCanisterError(result.Err);
  });
}
