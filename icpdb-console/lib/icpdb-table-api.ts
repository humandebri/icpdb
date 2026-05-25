// icpdb-console/lib/icpdb-table-api.ts
// Table inspection, preview, and SQL execution API calls.

import type { Identity } from "@icp-sdk/core/agent";
import { callIcpdb, createAuthenticatedActor, throwCanisterError } from "@/lib/icpdb-actor";
import {
  normalizeDatabaseTable,
  normalizeSqlResponse,
  normalizeTableDescription,
  normalizeTablePreview,
  rawSqlBatchRequest,
  rawSqlRequest,
  rawTablePreviewRequest
} from "@/lib/icpdb-table-codec";
import type {
  DatabaseTable,
  SqlBatchRequest,
  SqlExecuteRequest,
  SqlExecuteResponse,
  TableDescription,
  TablePreviewRequest,
  TablePreviewResponse
} from "@/lib/types";

export async function listTablesAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseTable[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_tables(databaseId);
    if ("Err" in result) throw new Error(result.Err);
    return result.Ok.map(normalizeDatabaseTable);
  });
}

export async function describeTableAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  tableName: string
): Promise<TableDescription> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.describe_table(databaseId, tableName);
    if ("Err" in result) throw new Error(result.Err);
    return normalizeTableDescription(result.Ok);
  });
}

export async function previewTableAuthenticated(
  canisterId: string,
  identity: Identity,
  request: TablePreviewRequest
): Promise<TablePreviewResponse> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.preview_table(rawTablePreviewRequest(request));
    if ("Err" in result) throw new Error(result.Err);
    return normalizeTablePreview(result.Ok);
  });
}

export async function sqlQueryAuthenticated(canisterId: string, identity: Identity, request: SqlExecuteRequest): Promise<SqlExecuteResponse> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.sql_query(rawSqlRequest(request));
    if ("Err" in result) throwCanisterError(result.Err);
    return normalizeSqlResponse(result.Ok);
  });
}

export async function sqlExecuteAuthenticated(canisterId: string, identity: Identity, request: SqlExecuteRequest): Promise<SqlExecuteResponse> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.sql_execute(rawSqlRequest(request));
    if ("Err" in result) throwCanisterError(result.Err);
    return normalizeSqlResponse(result.Ok);
  });
}

export async function sqlBatchAuthenticated(
  canisterId: string,
  identity: Identity,
  request: SqlBatchRequest
): Promise<SqlExecuteResponse[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.sql_batch(rawSqlBatchRequest(request));
    if ("Err" in result) throwCanisterError(result.Err);
    return result.Ok.map(normalizeSqlResponse);
  });
}
