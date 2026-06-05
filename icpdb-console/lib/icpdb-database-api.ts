// icpdb-console/lib/icpdb-database-api.ts
// Database inventory and shard operation API calls.

import type { Identity } from "@icp-sdk/core/agent";
import { callIcpdb, createAuthenticatedActor, throwCanisterError } from "@/lib/icpdb-actor";
import {
  normalizeDatabaseShardPlacement,
  normalizeDatabaseSummary,
  normalizeRoutedOperationInfo,
  normalizeShardOperationInfo,
  rawShardOperationReconcileRequest
} from "@/lib/icpdb-database-codec";
import type {
  DatabaseShardPlacement,
  DatabaseSummary,
  RoutedOperationInfo,
  ShardOperationInfo,
  ShardOperationReconcileRequest
} from "@/lib/types";

export async function listDatabasesAuthenticated(canisterId: string, identity: Identity): Promise<DatabaseSummary[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_databases();
    if ("Err" in result) throw new Error(result.Err);
    return result.Ok.map(normalizeDatabaseSummary);
  });
}

export async function listDatabasePlacementsAuthenticated(canisterId: string, identity: Identity): Promise<DatabaseShardPlacement[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_database_placements();
    if ("Err" in result) throwCanisterError(result.Err);
    return result.Ok.map(normalizeDatabaseShardPlacement);
  });
}

export async function listAllDatabasePlacementsAuthenticated(canisterId: string, identity: Identity): Promise<DatabaseShardPlacement[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_all_database_placements();
    if ("Err" in result) throwCanisterError(result.Err);
    return result.Ok.map(normalizeDatabaseShardPlacement);
  });
}

export async function listShardOperationsAuthenticated(canisterId: string, identity: Identity): Promise<ShardOperationInfo[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_shard_operations();
    if ("Err" in result) throwCanisterError(result.Err);
    return result.Ok.map(normalizeShardOperationInfo);
  });
}

export async function getRoutedOperationAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  operationId: string
): Promise<RoutedOperationInfo> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_routed_operation({ database_id: databaseId, operation_id: operationId });
    if ("Err" in result) throwCanisterError(result.Err);
    return normalizeRoutedOperationInfo(result.Ok);
  });
}

export async function reconcileShardOperationAuthenticated(
  canisterId: string,
  identity: Identity,
  request: ShardOperationReconcileRequest
): Promise<ShardOperationInfo> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.reconcile_shard_operation(rawShardOperationReconcileRequest(request));
    if ("Err" in result) throwCanisterError(result.Err);
    return normalizeShardOperationInfo(result.Ok);
  });
}

export async function createDatabaseAuthenticated(canisterId: string, identity: Identity): Promise<string> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.create_database();
    if ("Err" in result) throw new Error(result.Err);
    return result.Ok;
  });
}

export async function deleteDatabaseAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<void> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.delete_database(databaseId);
    if ("Err" in result) throwCanisterError(result.Err);
  });
}
