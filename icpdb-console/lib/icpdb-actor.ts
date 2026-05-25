// icpdb-console/lib/icpdb-actor.ts
// Actor setup and canister error mapping for authenticated ICPDB calls.

import { Actor, HttpAgent, type Identity } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { ApiError, classifyApiError, invalidCanisterIdError } from "@/lib/api-errors";
import { idlFactory } from "@/lib/icpdb-idl";
import type {
  RawCanisterHealth,
  RawCreateDatabaseTokenResponse,
  RawDatabaseArchiveChunk,
  RawDatabaseArchiveInfo,
  RawDatabaseBilling,
  RawDatabaseMember,
  RawDatabaseRestoreChunkRequest,
  RawDatabaseShardPlacement,
  RawDatabaseSummary,
  RawDatabaseTable,
  RawDatabaseTokenInfo,
  RawDatabaseUsage,
  RawDatabaseUsageEventSummary,
  RawDepositQuote,
  RawDepositResult,
  RawPaymentRecord,
  RawRoutedOperationInfo,
  RawShardOperationInfo,
  RawShardOperationReconcileRequest,
  RawSqlBatchRequest,
  RawSqlExecuteRequest,
  RawSqlExecuteResponse,
  RawTableDescription,
  RawTablePreviewRequest,
  RawTablePreviewResponse,
  Variant
} from "@/lib/icpdb-raw-types";

export type IcpdbActor = {
  begin_database_archive: (databaseId: string) => Promise<{ Ok: RawDatabaseArchiveInfo } | { Err: string }>;
  begin_database_restore: (databaseId: string, snapshotHash: number[], sizeBytes: bigint) => Promise<{ Ok: null } | { Err: string }>;
  cancel_database_archive: (databaseId: string) => Promise<{ Ok: null } | { Err: string }>;
  canister_health: () => Promise<RawCanisterHealth>;
  create_database: () => Promise<{ Ok: string } | { Err: string }>;
  create_database_token: (request: { database_id: string; name: string; scope: Variant }) => Promise<
    { Ok: RawCreateDatabaseTokenResponse } | { Err: string }
  >;
  delete_database: (databaseId: string) => Promise<{ Ok: null } | { Err: string }>;
  deposit_with_approval: (databaseId: string, amountE8s: bigint) => Promise<{ Ok: RawDepositResult } | { Err: string }>;
  get_deposit_quote: (databaseId: string, amountE8s: bigint) => Promise<{ Ok: RawDepositQuote } | { Err: string }>;
  get_billing: (databaseId: string) => Promise<{ Ok: RawDatabaseBilling } | { Err: string }>;
  get_routed_operation: (request: { database_id: string; operation_id: string }) => Promise<{ Ok: RawRoutedOperationInfo } | { Err: string }>;
  get_usage: (databaseId: string) => Promise<{ Ok: RawDatabaseUsage } | { Err: string }>;
  get_usage_event_summaries: (databaseId: string) => Promise<{ Ok: RawDatabaseUsageEventSummary[] } | { Err: string }>;
  grant_database_access: (databaseId: string, principal: string, role: Variant) => Promise<{ Ok: null } | { Err: string }>;
  list_all_database_placements: () => Promise<{ Ok: RawDatabaseShardPlacement[] } | { Err: string }>;
  list_database_members: (databaseId: string) => Promise<{ Ok: RawDatabaseMember[] } | { Err: string }>;
  list_database_placements: () => Promise<{ Ok: RawDatabaseShardPlacement[] } | { Err: string }>;
  list_databases: () => Promise<{ Ok: RawDatabaseSummary[] } | { Err: string }>;
  list_database_tokens: (databaseId: string) => Promise<{ Ok: RawDatabaseTokenInfo[] } | { Err: string }>;
  list_payments: (databaseId: string) => Promise<{ Ok: RawPaymentRecord[] } | { Err: string }>;
  list_shard_operations: () => Promise<{ Ok: RawShardOperationInfo[] } | { Err: string }>;
  list_tables: (databaseId: string) => Promise<{ Ok: RawDatabaseTable[] } | { Err: string }>;
  describe_table: (databaseId: string, tableName: string) => Promise<{ Ok: RawTableDescription } | { Err: string }>;
  finalize_database_archive: (databaseId: string, snapshotHash: number[]) => Promise<{ Ok: null } | { Err: string }>;
  finalize_database_restore: (databaseId: string) => Promise<{ Ok: null } | { Err: string }>;
  preview_table: (request: RawTablePreviewRequest) => Promise<{ Ok: RawTablePreviewResponse } | { Err: string }>;
  read_database_archive_chunk: (databaseId: string, offset: bigint, maxBytes: number) => Promise<
    { Ok: RawDatabaseArchiveChunk } | { Err: string }
  >;
  reconcile_shard_operation: (request: RawShardOperationReconcileRequest) => Promise<{ Ok: RawShardOperationInfo } | { Err: string }>;
  revoke_database_access: (databaseId: string, principal: string) => Promise<{ Ok: null } | { Err: string }>;
  revoke_database_token: (databaseId: string, tokenId: string) => Promise<{ Ok: RawDatabaseTokenInfo } | { Err: string }>;
  set_database_quota: (request: { database_id: string; max_logical_size_bytes: bigint }) => Promise<
    { Ok: RawDatabaseUsage } | { Err: string }
  >;
  sql_execute: (request: RawSqlExecuteRequest) => Promise<{ Ok: RawSqlExecuteResponse } | { Err: string }>;
  sql_batch: (request: RawSqlBatchRequest) => Promise<{ Ok: RawSqlExecuteResponse[] } | { Err: string }>;
  sql_query: (request: RawSqlExecuteRequest) => Promise<{ Ok: RawSqlExecuteResponse } | { Err: string }>;
  write_database_restore_chunk: (request: RawDatabaseRestoreChunkRequest) => Promise<{ Ok: null } | { Err: string }>;
};

const actorCache = new Map<string, Promise<IcpdbActor>>();

export function validateCanisterId(canisterId: string): Principal | string {
  try {
    return Principal.fromText(canisterId);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid canister id";
  }
}

export async function createIcpdbActor(canisterId: string): Promise<IcpdbActor> {
  const principal = validateCanisterId(canisterId);
  if (typeof principal === "string") {
    const error = invalidCanisterIdError(principal);
    throw new ApiError(error.error, 400, error.hint, error.code);
  }
  const host = process.env.NEXT_PUBLIC_ICPDB_IC_HOST ?? "https://icp0.io";
  const cacheKey = `${host}\n${canisterId}`;
  const cached = actorCache.get(cacheKey);
  if (cached) return cached;
  const actorPromise = createActor(principal, host);
  actorCache.set(cacheKey, actorPromise);
  return actorPromise;
}

export async function createAuthenticatedActor(canisterId: string, identity: Identity): Promise<IcpdbActor> {
  const principal = validateCanisterId(canisterId);
  if (typeof principal === "string") {
    const error = invalidCanisterIdError(principal);
    throw new ApiError(error.error, 400, error.hint, error.code);
  }
  const host = process.env.NEXT_PUBLIC_ICPDB_IC_HOST ?? "https://icp0.io";
  const agent = HttpAgent.createSync({ host, identity });
  if (isLocalHost(host)) await agent.fetchRootKey();
  return Actor.createActor<IcpdbActor>((idl) => idlFactory(idl), { agent, canisterId: principal });
}

export async function callIcpdb<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const host = process.env.NEXT_PUBLIC_ICPDB_IC_HOST ?? "https://icp0.io";
    const publicError = classifyApiError(error, host);
    throw new ApiError(publicError.error, 502, publicError.hint, publicError.code);
  }
}

export function throwCanisterError(message: string): never {
  throw new ApiError(message, 400);
}

async function createActor(principal: Principal, host: string): Promise<IcpdbActor> {
  const agent = HttpAgent.createSync({ host });
  if (isLocalHost(host)) await agent.fetchRootKey();
  return Actor.createActor<IcpdbActor>((idl) => idlFactory(idl), { agent, canisterId: principal });
}

function isLocalHost(host: string): boolean {
  return host.includes("127.0.0.1") || host.includes("localhost");
}
