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
import { Principal } from "@icp-sdk/core/principal";

const ANONYMOUS_PRINCIPAL = "2vxsx-fae";

export async function getBillingWithToken(session: IcpdbTokenSession): Promise<DatabaseBilling> {
  return normalizeBilling(await postJson(session, "/v1/billing", { database_id: sessionDatabaseId(session) }));
}

export async function setQuotaWithToken(session: IcpdbTokenSession, maxLogicalSizeBytes: string): Promise<DatabaseUsage> {
  return normalizeUsage(await postJson(session, "/v1/quota/set", {
    database_id: sessionDatabaseId(session),
    max_logical_size_bytes: quotaBytesNumber(maxLogicalSizeBytes)
  }));
}

export async function listTokensWithToken(session: IcpdbTokenSession): Promise<DatabaseTokenInfo[]> {
  const value = await postJson(session, "/v1/tokens/list", { database_id: sessionDatabaseId(session) });
  return arrayValue(value, "tokens").map(normalizeToken);
}

export async function createTokenWithToken(
  session: IcpdbTokenSession,
  name: string,
  scope: DatabaseTokenScope
): Promise<CreateDatabaseTokenResponse> {
  const normalizedName = tokenNameValue(name);
  assertDatabaseTokenScope(scope);
  return normalizeCreatedToken(await postJson(session, "/v1/tokens/create", {
    database_id: sessionDatabaseId(session),
    name: normalizedName,
    scope
  }));
}

export async function revokeTokenWithToken(session: IcpdbTokenSession, tokenId: string): Promise<DatabaseTokenInfo> {
  const normalizedTokenId = tokenIdValue(tokenId);
  return normalizeToken(await postJson(session, "/v1/tokens/revoke", {
    database_id: sessionDatabaseId(session),
    token_id: normalizedTokenId
  }));
}

export async function listMembersWithToken(session: IcpdbTokenSession): Promise<DatabaseMember[]> {
  const value = await postJson(session, "/v1/members/list", { database_id: sessionDatabaseId(session) });
  return arrayValue(value, "members").map(normalizeMember);
}

export async function listPaymentsWithToken(session: IcpdbTokenSession): Promise<PaymentRecord[]> {
  const value = await postJson(session, "/v1/payments/list", { database_id: sessionDatabaseId(session) });
  return arrayValue(value, "payments").map(normalizePayment);
}

export async function grantMemberWithToken(session: IcpdbTokenSession, principal: string, role: DatabaseRole): Promise<void> {
  const normalizedPrincipal = grantablePrincipalValue(principal);
  assertDatabaseRole(role);
  await postJson(session, "/v1/members/grant", {
    database_id: sessionDatabaseId(session),
    principal: normalizedPrincipal,
    role
  });
}

export async function revokeMemberWithToken(session: IcpdbTokenSession, principal: string): Promise<void> {
  const normalizedPrincipal = memberPrincipalValue(principal);
  await postJson(session, "/v1/members/revoke", {
    database_id: sessionDatabaseId(session),
    principal: normalizedPrincipal
  });
}

export async function deleteDatabaseWithToken(session: IcpdbTokenSession): Promise<void> {
  await postJson(session, "/v1/database/delete", { database_id: sessionDatabaseId(session) });
}

export async function cancelArchiveWithToken(session: IcpdbTokenSession): Promise<void> {
  await postJson(session, "/v1/archive/cancel", { database_id: sessionDatabaseId(session) });
}

export async function beginArchiveWithToken(session: IcpdbTokenSession): Promise<DatabaseArchiveInfo> {
  const value = await postJson(session, "/v1/archive/begin", { database_id: sessionDatabaseId(session) });
  return {
    databaseId: requiredString(value, "database_id"),
    sizeBytes: numericString(value, "size_bytes")
  };
}

export async function readArchiveChunkWithToken(session: IcpdbTokenSession, offset: number, maxBytes: number): Promise<number[]> {
  const normalizedOffset = nonNegativeSafeInteger(offset, "archive offset");
  const normalizedMaxBytes = positiveUint32(maxBytes, "archive maxBytes");
  const value = await postJson(session, "/v1/archive/read", {
    database_id: sessionDatabaseId(session),
    offset: normalizedOffset,
    max_bytes: normalizedMaxBytes
  });
  return byteArrayValue(field(value, "bytes"), "archive chunk bytes");
}

export async function finalizeArchiveWithToken(session: IcpdbTokenSession, snapshotHash: number[]): Promise<void> {
  const normalizedSnapshotHash = snapshotHashBytes(snapshotHash);
  await postJson(session, "/v1/archive/finalize", {
    database_id: sessionDatabaseId(session),
    snapshot_hash: normalizedSnapshotHash
  });
}

export async function beginRestoreWithToken(session: IcpdbTokenSession, snapshotHash: number[], sizeBytes: string): Promise<void> {
  const normalizedSnapshotHash = snapshotHashBytes(snapshotHash);
  const normalizedSizeBytes = nonNegativeSafeIntegerText(sizeBytes, "restore sizeBytes");
  await postJson(session, "/v1/restore/begin", {
    database_id: sessionDatabaseId(session),
    snapshot_hash: normalizedSnapshotHash,
    size_bytes: normalizedSizeBytes
  });
}

export async function writeRestoreChunkWithToken(session: IcpdbTokenSession, offset: number, bytes: number[]): Promise<void> {
  const normalizedOffset = nonNegativeSafeInteger(offset, "restore offset");
  const normalizedBytes = byteArrayValue(bytes, "restore bytes");
  await postJson(session, "/v1/restore/write", {
    database_id: sessionDatabaseId(session),
    offset: normalizedOffset,
    bytes: normalizedBytes
  });
}

export async function finalizeRestoreWithToken(session: IcpdbTokenSession): Promise<void> {
  await postJson(session, "/v1/restore/finalize", { database_id: sessionDatabaseId(session) });
}

async function postJson(session: IcpdbTokenSession, path: string, body: unknown): Promise<unknown> {
  const baseUrl = sessionBaseUrl(session);
  const token = sessionToken(session);
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(stringField(value, "error") || `HTTP ${response.status}`);
  return value;
}

function sessionBaseUrl(session: IcpdbTokenSession): string {
  return requiredClientString(session.baseUrl, "HTTP base URL");
}

function sessionToken(session: IcpdbTokenSession): string {
  return requiredClientString(session.token, "api token");
}

function sessionDatabaseId(session: IcpdbTokenSession): string {
  return requiredClientString(session.databaseId, "token session database_id");
}

function requiredClientString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a non-empty string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} must be a non-empty string`);
  return trimmed;
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
  if (value === "writer") return "writer";
  if (value === "reader") return "reader";
  throw new Error("database role must be reader, writer, or owner");
}

function normalizeTokenScope(value: string): DatabaseTokenScope {
  if (value === "owner") return "owner";
  if (value === "write") return "write";
  if (value === "read") return "read";
  throw new Error("database token scope must be read, write, or owner");
}

function normalizeBillingStatus(value: string): DatabaseBillingStatus {
  return value === "suspended" ? "suspended" : "active";
}

function grantablePrincipalValue(principal: string): string {
  const normalizedPrincipal = memberPrincipalValue(principal);
  if (normalizedPrincipal === ANONYMOUS_PRINCIPAL) {
    throw new Error("anonymous principal cannot be granted database access");
  }
  return normalizedPrincipal;
}

function memberPrincipalValue(principal: string): string {
  const normalizedPrincipal = typeof principal === "string" ? principal.trim() : "";
  if (normalizedPrincipal.length === 0) {
    throw new Error("database member principal must be a non-empty string");
  }
  try {
    Principal.fromText(normalizedPrincipal);
  } catch {
    throw new Error("database member principal must be a valid principal");
  }
  return normalizedPrincipal;
}

function assertDatabaseRole(role: DatabaseRole): void {
  if (role !== "reader" && role !== "writer" && role !== "owner") {
    throw new Error("database role must be reader, writer, or owner");
  }
}

function assertDatabaseTokenScope(scope: DatabaseTokenScope): void {
  if (scope !== "read" && scope !== "write" && scope !== "owner") {
    throw new Error("database token scope must be read, write, or owner");
  }
}

function tokenNameValue(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("database token name must be a non-empty string");
  }
  return trimmed;
}

function tokenIdValue(tokenId: string): string {
  const trimmed = tokenId.trim();
  if (trimmed.length === 0) {
    throw new Error("database token id must be a non-empty string");
  }
  return trimmed;
}

function quotaBytesNumber(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("quota bytes must be a non-negative safe integer");
  }
  const parsed = BigInt(trimmed);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("quota bytes must be a non-negative safe integer");
  }
  return Number(parsed);
}

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function nonNegativeSafeIntegerText(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  const parsed = BigInt(trimmed);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return Number(parsed);
}

function positiveUint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4294967295) {
    throw new Error(`${label} must be an integer from 1 to 4294967295`);
  }
  return value;
}

function snapshotHashBytes(value: number[]): number[] {
  const bytes = byteArrayValue(value, "snapshot hash");
  if (bytes.length !== 32) {
    throw new Error("snapshot hash must be a 32-byte SHA-256 digest");
  }
  return bytes;
}

function byteArrayValue(value: unknown, label: string): number[] {
  return arrayValue(value, label).map((byte, index) => byteValue(byte, `${label}[${index}]`));
}

function byteValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be a byte`);
  }
  return value;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
