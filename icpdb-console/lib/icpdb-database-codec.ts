// icpdb-console/lib/icpdb-database-codec.ts
// Convert control-plane Candid DTOs into console model values.

import type {
  CanisterHealth,
  CreateDatabaseShardRequest,
  CreateRemoteDatabaseRequest,
  DatabaseArchiveInfo,
  DatabaseBilling,
  DatabaseInfo,
  DatabaseMember,
  DatabaseRole,
  DatabaseShardInfo,
  DatabaseShardMaintenanceReport,
  DatabaseShardPlacement,
  DatabaseShardStatus,
  DatabaseStatus,
  DatabaseSummary,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  DepositQuote,
  DepositResult,
  MaintainDatabaseShardsRequest,
  PaymentRecord,
  RegisterDatabaseShardRequest,
  RoutedOperationInfo,
  RoutedOperationStatus,
  ShardOperationInfo,
  ShardOperationReconcileRequest,
  ShardOperationReconcileStatus
} from "./types.js";
import type {
  RawCanisterHealth,
  RawCreateDatabaseShardRequest,
  RawCreateRemoteDatabaseRequest,
  RawDatabaseArchiveInfo,
  RawDatabaseBilling,
  RawDatabaseInfo,
  RawDatabaseMember,
  RawDatabaseShardInfo,
  RawDatabaseShardMaintenanceReport,
  RawDatabaseShardPlacement,
  RawDatabaseShardStatus,
  RawDatabaseSummary,
  RawDatabaseTokenInfo,
  RawDatabaseUsage,
  RawDatabaseUsageEventSummary,
  RawDepositQuote,
  RawDepositResult,
  RawMaintainDatabaseShardsRequest,
  RawPaymentRecord,
  RawRegisterDatabaseShardRequest,
  RawRoutedOperationInfo,
  RawShardOperationInfo,
  RawShardOperationReconcileRequest,
  Variant
} from "./icpdb-raw-types.js";

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

export function normalizeDatabaseInfo(raw: RawDatabaseInfo): DatabaseInfo {
  return {
    databaseId: raw.database_id,
    status: normalizeDatabaseStatus(raw.status),
    logicalSizeBytes: raw.logical_size_bytes.toString(),
    schemaVersion: raw.schema_version,
    mountId: raw.mount_id[0] ?? null,
    snapshotHash: raw.snapshot_hash[0] ?? null,
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

export function normalizeDatabaseShardInfo(raw: RawDatabaseShardInfo): DatabaseShardInfo {
  return {
    shardId: raw.shard_id,
    canisterId: raw.canister_id,
    status: raw.status,
    maxDatabases: raw.max_databases,
    assignedDatabases: raw.assigned_databases.toString(),
    createdAtMs: raw.created_at_ms.toString(),
    updatedAtMs: raw.updated_at_ms.toString()
  };
}

export function normalizeDatabaseShardStatus(raw: RawDatabaseShardStatus): DatabaseShardStatus {
  return {
    shard: normalizeDatabaseShardInfo(raw.shard),
    canisterStatus: raw.canister_status,
    cyclesBalance: raw.cycles_balance.toString(),
    memorySizeBytes: raw.memory_size_bytes.toString(),
    idleCyclesBurnedPerDay: raw.idle_cycles_burned_per_day.toString(),
    moduleHash: raw.module_hash[0] ?? null
  };
}

export function normalizeDatabaseShardMaintenanceReport(raw: RawDatabaseShardMaintenanceReport): DatabaseShardMaintenanceReport {
  return {
    availableSlots: raw.available_slots.toString(),
    inspectedShards: raw.inspected_shards.map(normalizeDatabaseShardStatus),
    actions: raw.actions.map((action) => ({
      action: action.action,
      databaseCanisterId: action.database_canister_id[0] ?? null,
      shardId: action.shard_id[0] ?? null,
      cycles: action.cycles.toString(),
      reason: action.reason
    }))
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

export function normalizeRoutedOperationInfo(raw: RawRoutedOperationInfo): RoutedOperationInfo {
  return {
    operationId: raw.operation_id,
    databaseId: raw.database_id,
    databaseCanisterId: raw.database_canister_id,
    method: raw.method,
    requestHash: raw.request_hash,
    status: normalizeRoutedOperationStatus(raw.status),
    error: raw.error[0] ?? null,
    createdAtMs: raw.created_at_ms.toString(),
    updatedAtMs: raw.updated_at_ms.toString()
  };
}

export function rawShardOperationReconcileRequest(request: ShardOperationReconcileRequest): RawShardOperationReconcileRequest {
  const operationId = nonEmptyText(request.operationId, "operationId");
  const status = reconcileStatus(request.status);
  const error = reconcileError(status, request.error);
  return {
    operation_id: operationId,
    status: routedOperationStatusVariant(status),
    error: error === null ? [] : [error]
  };
}

export function rawMaintainDatabaseShardsRequest(request: MaintainDatabaseShardsRequest): RawMaintainDatabaseShardsRequest {
  return {
    min_available_slots: natInput(request.minAvailableSlots, "minAvailableSlots"),
    min_cycles_balance: natInput(request.minCyclesBalance, "minCyclesBalance"),
    top_up_cycles: natInput(request.topUpCycles, "topUpCycles"),
    max_new_shards: nat16Input(request.maxNewShards, "maxNewShards"),
    new_shard_max_databases: nat16Input(request.newShardMaxDatabases, "newShardMaxDatabases"),
    new_shard_initial_cycles: natInput(request.newShardInitialCycles, "newShardInitialCycles")
  };
}

export function rawCreateDatabaseShardRequest(request: CreateDatabaseShardRequest): RawCreateDatabaseShardRequest {
  return {
    initial_cycles: natInput(request.initialCycles, "initialCycles"),
    max_databases: nat16Input(request.maxDatabases, "maxDatabases")
  };
}

function natInput(value: string | number | bigint, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} must be a non-negative integer`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`${label} must be a non-negative integer`);
  return BigInt(trimmed);
}

function nat16Input(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535) {
    throw new Error(`${label} must be an integer from 0 to 65535`);
  }
  return value;
}

function nonEmptyText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function reconcileStatus(status: ShardOperationReconcileStatus): ShardOperationReconcileStatus {
  if (status === "applied" || status === "failed") return status;
  throw new Error("status must be applied or failed");
}

function reconcileError(status: ShardOperationReconcileStatus, error: string | null): string | null {
  if (status === "applied") {
    if (error !== null) throw new Error("error is only valid when shard reconcile status is failed");
    return null;
  }
  return nonEmptyText(error ?? "", "error");
}

export function rawRegisterDatabaseShardRequest(request: RegisterDatabaseShardRequest): RawRegisterDatabaseShardRequest {
  return {
    database_canister_id: request.databaseCanisterId,
    max_databases: nat16Input(request.maxDatabases, "maxDatabases")
  };
}

export function rawCreateRemoteDatabaseRequest(request: CreateRemoteDatabaseRequest): RawCreateRemoteDatabaseRequest {
  return {
    database_id: request.databaseId,
    database_canister_id: request.databaseCanisterId
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
  if (scope === "write") return { Write: null };
  if (scope === "read") return { Read: null };
  throw new Error("database token scope must be read, write, or owner");
}

export function databaseRoleVariant(role: DatabaseRole): Variant {
  if (role === "owner") return { Owner: null };
  if (role === "writer") return { Writer: null };
  if (role === "reader") return { Reader: null };
  throw new Error("database role must be reader, writer, or owner");
}

function normalizeRoutedOperationStatus(status: Variant): RoutedOperationStatus {
  if ("Applied" in status) return "applied";
  if ("Failed" in status) return "failed";
  if ("Unknown" in status) return "unknown";
  if ("Pending" in status) return "pending";
  throw new Error(`unknown routed operation status variant: ${variantKeys(status)}`);
}

function routedOperationStatusVariant(status: ShardOperationReconcileStatus): Variant {
  if (status === "applied") return { Applied: null };
  return { Failed: null };
}

function normalizeDatabaseTokenScope(scope: Variant): DatabaseTokenScope {
  if ("Owner" in scope) return "owner";
  if ("Write" in scope) return "write";
  if ("Read" in scope) return "read";
  throw new Error(`unknown database token scope variant: ${variantKeys(scope)}`);
}

function normalizeDatabaseRole(role: Variant): DatabaseRole {
  if ("Owner" in role) return "owner";
  if ("Writer" in role) return "writer";
  if ("Reader" in role) return "reader";
  throw new Error(`unknown database role variant: ${variantKeys(role)}`);
}

function normalizeDatabaseStatus(status: Variant): DatabaseStatus {
  if ("Restoring" in status) return "restoring";
  if ("Archiving" in status) return "archiving";
  if ("Archived" in status) return "archived";
  if ("Deleted" in status) return "deleted";
  if ("Hot" in status) return "hot";
  throw new Error(`unknown database status variant: ${variantKeys(status)}`);
}

function variantKeys(variant: Variant): string {
  return Object.keys(variant).join("|") || "empty";
}
