// icpdb-console/lib/icpdb-http-admin-client.ts
// Owner-token HTTP client for account, permission, quota, and billing panels.

import type {
  CreateDatabaseTokenResponse,
  DatabaseArchiveInfo,
  DatabaseBilling,
  DatabaseBillingStatus,
  DatabaseMember,
  DatabaseRole,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage,
  PaymentRecord
} from "@/lib/types";
import type { IcpdbTokenSession } from "@/lib/icpdb-http-client";

export async function getBillingWithToken(session: IcpdbTokenSession): Promise<DatabaseBilling> {
  return normalizeBilling(await postJson(session, "/v1/billing", { database_id: session.databaseId }));
}

export async function setQuotaWithToken(session: IcpdbTokenSession, maxLogicalSizeBytes: string): Promise<DatabaseUsage> {
  return normalizeUsage(await postJson(session, "/v1/quota/set", {
    database_id: session.databaseId,
    max_logical_size_bytes: Number(maxLogicalSizeBytes)
  }));
}

export async function listTokensWithToken(session: IcpdbTokenSession): Promise<DatabaseTokenInfo[]> {
  const value = await postJson(session, "/v1/tokens/list", { database_id: session.databaseId });
  return arrayValue(value, "tokens").map(normalizeToken);
}

export async function createTokenWithToken(
  session: IcpdbTokenSession,
  name: string,
  scope: DatabaseTokenScope
): Promise<CreateDatabaseTokenResponse> {
  return normalizeCreatedToken(await postJson(session, "/v1/tokens/create", {
    database_id: session.databaseId,
    name,
    scope
  }));
}

export async function revokeTokenWithToken(session: IcpdbTokenSession, tokenId: string): Promise<DatabaseTokenInfo> {
  return normalizeToken(await postJson(session, "/v1/tokens/revoke", {
    database_id: session.databaseId,
    token_id: tokenId
  }));
}

export async function listMembersWithToken(session: IcpdbTokenSession): Promise<DatabaseMember[]> {
  const value = await postJson(session, "/v1/members/list", { database_id: session.databaseId });
  return arrayValue(value, "members").map(normalizeMember);
}

export async function listPaymentsWithToken(session: IcpdbTokenSession): Promise<PaymentRecord[]> {
  const value = await postJson(session, "/v1/payments/list", { database_id: session.databaseId });
  return arrayValue(value, "payments").map(normalizePayment);
}

export async function grantMemberWithToken(session: IcpdbTokenSession, principal: string, role: DatabaseRole): Promise<void> {
  await postJson(session, "/v1/members/grant", {
    database_id: session.databaseId,
    principal,
    role
  });
}

export async function revokeMemberWithToken(session: IcpdbTokenSession, principal: string): Promise<void> {
  await postJson(session, "/v1/members/revoke", {
    database_id: session.databaseId,
    principal
  });
}

export async function deleteDatabaseWithToken(session: IcpdbTokenSession): Promise<void> {
  await postJson(session, "/v1/database/delete", { database_id: session.databaseId });
}

export async function cancelArchiveWithToken(session: IcpdbTokenSession): Promise<void> {
  await postJson(session, "/v1/archive/cancel", { database_id: session.databaseId });
}

export async function beginArchiveWithToken(session: IcpdbTokenSession): Promise<DatabaseArchiveInfo> {
  const value = await postJson(session, "/v1/archive/begin", { database_id: session.databaseId });
  return {
    databaseId: requiredString(value, "database_id"),
    sizeBytes: numericString(value, "size_bytes")
  };
}

export async function readArchiveChunkWithToken(session: IcpdbTokenSession, offset: number, maxBytes: number): Promise<number[]> {
  const value = await postJson(session, "/v1/archive/read", {
    database_id: session.databaseId,
    offset,
    max_bytes: maxBytes
  });
  return arrayValue(field(value, "bytes"), "archive chunk bytes").map((byte) => Number(byte));
}

export async function finalizeArchiveWithToken(session: IcpdbTokenSession, snapshotHash: number[]): Promise<void> {
  await postJson(session, "/v1/archive/finalize", {
    database_id: session.databaseId,
    snapshot_hash: snapshotHash
  });
}

export async function beginRestoreWithToken(session: IcpdbTokenSession, snapshotHash: number[], sizeBytes: string): Promise<void> {
  await postJson(session, "/v1/restore/begin", {
    database_id: session.databaseId,
    snapshot_hash: snapshotHash,
    size_bytes: Number(sizeBytes)
  });
}

export async function writeRestoreChunkWithToken(session: IcpdbTokenSession, offset: number, bytes: number[]): Promise<void> {
  await postJson(session, "/v1/restore/write", {
    database_id: session.databaseId,
    offset,
    bytes
  });
}

export async function finalizeRestoreWithToken(session: IcpdbTokenSession): Promise<void> {
  await postJson(session, "/v1/restore/finalize", { database_id: session.databaseId });
}

async function postJson(session: IcpdbTokenSession, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${session.baseUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(stringField(value, "error") || `HTTP ${response.status}`);
  return value;
}

function normalizeBilling(value: unknown): DatabaseBilling {
  return {
    databaseId: requiredString(value, "database_id"),
    status: normalizeBillingStatus(requiredString(value, "status")),
    balanceUnits: numericString(value, "balance_units"),
    spentUnits: numericString(value, "spent_units"),
    usageEventCount: numericString(value, "usage_event_count")
  };
}

function normalizeUsage(value: unknown): DatabaseUsage {
  const status = requiredString(value, "status");
  return {
    databaseId: requiredString(value, "database_id"),
    status: status === "deleted" ? "deleted" : status === "archived" ? "archived" : status === "archiving" ? "archiving" : status === "restoring" ? "restoring" : "hot",
    logicalSizeBytes: numericString(value, "logical_size_bytes"),
    maxLogicalSizeBytes: numericString(value, "max_logical_size_bytes"),
    usageEventCount: numericString(value, "usage_event_count")
  };
}

function normalizeCreatedToken(value: unknown): CreateDatabaseTokenResponse {
  return {
    token: requiredString(value, "token"),
    info: normalizeToken(field(value, "info"))
  };
}

function normalizeToken(value: unknown): DatabaseTokenInfo {
  return {
    tokenId: requiredString(value, "token_id"),
    databaseId: requiredString(value, "database_id"),
    name: requiredString(value, "name"),
    scope: normalizeTokenScope(requiredString(value, "scope")),
    createdAtMs: numericString(value, "created_at_ms"),
    lastUsedAtMs: nullableNumericString(value, "last_used_at_ms"),
    revokedAtMs: nullableNumericString(value, "revoked_at_ms")
  };
}

function normalizeMember(value: unknown): DatabaseMember {
  return {
    databaseId: requiredString(value, "database_id"),
    principal: requiredString(value, "principal"),
    role: normalizeDatabaseRole(requiredString(value, "role")),
    createdAtMs: numericString(value, "created_at_ms")
  };
}

function normalizePayment(value: unknown): PaymentRecord {
  return {
    paymentId: requiredString(value, "payment_id"),
    databaseId: requiredString(value, "database_id"),
    payerPrincipal: requiredString(value, "payer_principal"),
    amountE8s: numericString(value, "amount_e8s"),
    creditedUnits: numericString(value, "credited_units"),
    blockIndex: numericString(value, "block_index"),
    createdAtMs: numericString(value, "created_at_ms")
  };
}

function field(source: unknown, key: string): unknown {
  return typeof source === "object" && source !== null ? Reflect.get(source, key) : undefined;
}

function requiredString(source: unknown, key: string): string {
  const value = field(source, key);
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function stringField(source: unknown, key: string): string | null {
  const value = field(source, key);
  return typeof value === "string" ? value : null;
}

function numericString(source: unknown, key: string): string {
  const value = field(source, key);
  if (typeof value !== "number" && typeof value !== "string") throw new Error(`${key} must be numeric`);
  return String(value);
}

function nullableNumericString(source: unknown, key: string): string | null {
  const value = field(source, key);
  return value === null || value === undefined ? null : numericString(source, key);
}

function normalizeDatabaseRole(value: string): DatabaseRole {
  if (value === "owner") return "owner";
  return value === "writer" ? "writer" : "reader";
}

function normalizeTokenScope(value: string): DatabaseTokenScope {
  if (value === "owner") return "owner";
  return value === "write" ? "write" : "read";
}

function normalizeBillingStatus(value: string): DatabaseBillingStatus {
  return value === "suspended" ? "suspended" : "active";
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
