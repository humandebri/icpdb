// icpdb-console/lib/icpdb-database-codec.ts
// Convert control-plane Candid DTOs into console model values.

import type {
  CanisterHealth,
  DatabaseArchiveInfo,
  DatabaseBilling,
  DatabaseMember,
  DatabaseRole,
  DatabaseShardPlacement,
  DatabaseStatus,
  DatabaseSummary,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  DepositQuote,
  DepositResult,
  PaymentRecord,
  RoutedOperationStatus,
  ShardOperationInfo,
  ShardOperationReconcileRequest,
  ShardOperationReconcileStatus
} from "@/lib/types";
import type {
  RawCanisterHealth,
  RawDatabaseArchiveInfo,
  RawDatabaseBilling,
  RawDatabaseMember,
  RawDatabaseShardPlacement,
  RawDatabaseSummary,
  RawDatabaseTokenInfo,
  RawDatabaseUsage,
  RawDatabaseUsageEventSummary,
  RawDepositQuote,
  RawDepositResult,
  RawPaymentRecord,
  RawShardOperationInfo,
  RawShardOperationReconcileRequest,
  Variant
} from "@/lib/icpdb-raw-types";

export function normalizeCanisterHealth(raw: RawCanisterHealth): CanisterHealth {
  return { cyclesBalance: raw.cycles_balance };
}

export function normalizeDatabaseSummary(raw: RawDatabaseSummary): DatabaseSummary {
  return {
    databaseId: raw.database_id,
    role: normalizeDatabaseRole(raw.role),
    status: normalizeDatabaseStatus(raw.status),
    logicalSizeBytes: raw.logical_size_bytes.toString(),
    archivedAtMs: raw.archived_at_ms[0]?.toString() ?? null,
    deletedAtMs: raw.deleted_at_ms[0]?.toString() ?? null
  };
}

export function normalizeDatabaseShardPlacement(raw: RawDatabaseShardPlacement): DatabaseShardPlacement {
  return {
    databaseId: raw.database_id,
    shardId: raw.shard_id,
    canisterId: raw.canister_id[0] ?? null,
    mountId: raw.mount_id[0] ?? null,
    status: normalizeDatabaseStatus(raw.status),
    schemaVersion: raw.schema_version,
    createdAtMs: raw.created_at_ms.toString(),
    updatedAtMs: raw.updated_at_ms.toString()
  };
}

export function normalizeShardOperationInfo(raw: RawShardOperationInfo): ShardOperationInfo {
  return {
    operationId: raw.operation_id,
    operationKind: raw.operation_kind,
    target: raw.target[0] ?? null,
    requestHash: raw.request_hash,
    status: normalizeRoutedOperationStatus(raw.status),
    error: raw.error[0] ?? null,
    createdAtMs: raw.created_at_ms.toString(),
    updatedAtMs: raw.updated_at_ms.toString()
  };
}

export function rawShardOperationReconcileRequest(request: ShardOperationReconcileRequest): RawShardOperationReconcileRequest {
  return {
    operation_id: request.operationId,
    status: routedOperationStatusVariant(request.status),
    error: request.error ? [request.error] : []
  };
}

export function normalizeDatabaseMember(raw: RawDatabaseMember): DatabaseMember {
  return {
    databaseId: raw.database_id,
    principal: raw.principal,
    role: normalizeDatabaseRole(raw.role),
    createdAtMs: raw.created_at_ms.toString()
  };
}

export function normalizeDatabaseUsage(raw: RawDatabaseUsage): DatabaseUsage {
  return {
    databaseId: raw.database_id,
    status: normalizeDatabaseStatus(raw.status),
    logicalSizeBytes: raw.logical_size_bytes.toString(),
    maxLogicalSizeBytes: raw.max_logical_size_bytes.toString(),
    usageEventCount: raw.usage_event_count.toString()
  };
}

export function normalizeDatabaseUsageEventSummary(raw: RawDatabaseUsageEventSummary): DatabaseUsageEventSummary {
  return {
    method: raw.method,
    operation: raw.operation[0] ?? null,
    success: raw.success,
    eventCount: raw.event_count.toString(),
    totalCyclesDelta: raw.total_cycles_delta.toString(),
    totalRowsReturned: raw.total_rows_returned.toString(),
    totalRowsAffected: raw.total_rows_affected.toString(),
    lastCreatedAtMs: raw.last_created_at_ms.toString()
  };
}

export function normalizeDatabaseBilling(raw: RawDatabaseBilling): DatabaseBilling {
  return {
    databaseId: raw.database_id,
    status: "Suspended" in raw.status ? "suspended" : "active",
    balanceUnits: raw.balance_units.toString(),
    spentUnits: raw.spent_units.toString(),
    usageEventCount: raw.usage_event_count.toString()
  };
}

export function normalizeDatabaseArchiveInfo(raw: RawDatabaseArchiveInfo): DatabaseArchiveInfo {
  return {
    databaseId: raw.database_id,
    sizeBytes: raw.size_bytes.toString()
  };
}

export function normalizeDepositQuote(raw: RawDepositQuote): DepositQuote {
  return {
    databaseId: raw.database_id,
    amountE8s: raw.amount_e8s.toString(),
    expectedFeeE8s: raw.expected_fee_e8s.toString(),
    creditedUnits: raw.credited_units.toString(),
    ledgerCanisterId: raw.ledger_canister_id,
    spenderPrincipal: raw.spender_principal
  };
}

export function normalizeDepositResult(raw: RawDepositResult): DepositResult {
  return {
    databaseId: raw.database_id,
    amountE8s: raw.amount_e8s.toString(),
    creditedUnits: raw.credited_units.toString(),
    blockIndex: raw.block_index.toString(),
    balanceUnits: raw.balance_units.toString()
  };
}

export function normalizePaymentRecord(raw: RawPaymentRecord): PaymentRecord {
  return {
    paymentId: raw.payment_id,
    databaseId: raw.database_id,
    payerPrincipal: raw.payer_principal,
    amountE8s: raw.amount_e8s.toString(),
    creditedUnits: raw.credited_units.toString(),
    blockIndex: raw.block_index.toString(),
    createdAtMs: raw.created_at_ms.toString()
  };
}

export function normalizeDatabaseTokenInfo(raw: RawDatabaseTokenInfo): DatabaseTokenInfo {
  return {
    tokenId: raw.token_id,
    databaseId: raw.database_id,
    name: raw.name,
    scope: normalizeDatabaseTokenScope(raw.scope),
    createdAtMs: raw.created_at_ms.toString(),
    lastUsedAtMs: raw.last_used_at_ms[0]?.toString() ?? null,
    revokedAtMs: raw.revoked_at_ms[0]?.toString() ?? null
  };
}

export function databaseTokenScopeVariant(scope: DatabaseTokenScope): Variant {
  if (scope === "owner") return { Owner: null };
  return scope === "write" ? { Write: null } : { Read: null };
}

export function databaseRoleVariant(role: DatabaseRole): Variant {
  if (role === "owner") return { Owner: null };
  if (role === "writer") return { Writer: null };
  return { Reader: null };
}

function normalizeRoutedOperationStatus(status: Variant): RoutedOperationStatus {
  if ("Applied" in status) return "applied";
  if ("Failed" in status) return "failed";
  if ("Unknown" in status) return "unknown";
  return "pending";
}

function routedOperationStatusVariant(status: ShardOperationReconcileStatus): Variant {
  if (status === "applied") return { Applied: null };
  return { Failed: null };
}

function normalizeDatabaseTokenScope(scope: Variant): DatabaseTokenScope {
  if ("Owner" in scope) return "owner";
  if ("Write" in scope) return "write";
  return "read";
}

function normalizeDatabaseRole(role: Variant): DatabaseRole {
  if ("Owner" in role) return "owner";
  if ("Writer" in role) return "writer";
  return "reader";
}

function normalizeDatabaseStatus(status: Variant): DatabaseStatus {
  if ("Restoring" in status) return "restoring";
  if ("Archiving" in status) return "archiving";
  if ("Archived" in status) return "archived";
  if ("Deleted" in status) return "deleted";
  return "hot";
}
