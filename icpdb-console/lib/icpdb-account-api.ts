// icpdb-console/lib/icpdb-account-api.ts
// Billing, quota, token, and permission API calls.

import type { Identity } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { callIcpdb, createAuthenticatedActor, throwCanisterError } from "@/lib/icpdb-actor";
import {
  databaseRoleVariant,
  databaseTokenScopeVariant,
  normalizeDatabaseBilling,
  normalizeDatabaseMember,
  normalizeDatabaseTokenInfo,
  normalizeDatabaseUsage,
  normalizeDatabaseUsageEventSummary,
  normalizeDepositQuote,
  normalizeDepositResult,
  normalizePaymentRecord
} from "@/lib/icpdb-database-codec";
import type {
  CreateDatabaseTokenResponse,
  DatabaseBilling,
  DatabaseMember,
  DatabaseRole,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  DepositQuote,
  DepositResult,
  PaymentRecord
} from "@/lib/types";

const ANONYMOUS_PRINCIPAL = "2vxsx-fae";

export async function getUsageAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseUsage> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_usage(databaseId);
    if ("Err" in result) throw new Error(result.Err);
    return normalizeDatabaseUsage(result.Ok);
  });
}

export async function getUsageEventSummariesAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string
): Promise<DatabaseUsageEventSummary[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_usage_event_summaries(databaseId);
    if ("Err" in result) throw new Error(result.Err);
    return result.Ok.map(normalizeDatabaseUsageEventSummary);
  });
}

export async function setDatabaseQuotaAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  maxLogicalSizeBytes: string
): Promise<DatabaseUsage> {
  const normalizedQuotaBytes = quotaBytesBigInt(maxLogicalSizeBytes);
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.set_database_quota({
      database_id: databaseId,
      max_logical_size_bytes: normalizedQuotaBytes
    });
    if ("Err" in result) throwCanisterError(result.Err);
    return normalizeDatabaseUsage(result.Ok);
  });
}

export async function getBillingAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseBilling> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_billing(databaseId);
    if ("Err" in result) throw new Error(result.Err);
    return normalizeDatabaseBilling(result.Ok);
  });
}

export async function getDepositQuoteAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  amountE8s: string
): Promise<DepositQuote> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.get_deposit_quote(databaseId, BigInt(amountE8s));
    if ("Err" in result) throw new Error(result.Err);
    return normalizeDepositQuote(result.Ok);
  });
}

export async function depositWithApprovalAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  amountE8s: string
): Promise<DepositResult> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.deposit_with_approval(databaseId, BigInt(amountE8s));
    if ("Err" in result) throw new Error(result.Err);
    return normalizeDepositResult(result.Ok);
  });
}

export async function listPaymentsAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<PaymentRecord[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_payments(databaseId);
    if ("Err" in result) throw new Error(result.Err);
    return result.Ok.map(normalizePaymentRecord);
  });
}

export async function listDatabaseMembersAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseMember[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_database_members(databaseId);
    if ("Err" in result) throwCanisterError(result.Err);
    return result.Ok.map(normalizeDatabaseMember);
  });
}

export async function grantDatabaseAccessAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  memberPrincipal: string,
  role: DatabaseRole
): Promise<void> {
  const normalizedPrincipal = grantablePrincipalValue(memberPrincipal);
  assertDatabaseRole(role);
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.grant_database_access(databaseId, normalizedPrincipal, databaseRoleVariant(role));
    if ("Err" in result) throwCanisterError(result.Err);
  });
}

export async function revokeDatabaseAccessAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  memberPrincipal: string
): Promise<void> {
  const normalizedPrincipal = memberPrincipalValue(memberPrincipal);
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.revoke_database_access(databaseId, normalizedPrincipal);
    if ("Err" in result) throwCanisterError(result.Err);
  });
}

export async function createDatabaseTokenAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  name: string,
  scope: DatabaseTokenScope
): Promise<CreateDatabaseTokenResponse> {
  const normalizedName = tokenNameValue(name);
  assertDatabaseTokenScope(scope);
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.create_database_token({
      database_id: databaseId,
      name: normalizedName,
      scope: databaseTokenScopeVariant(scope)
    });
    if ("Err" in result) throw new Error(result.Err);
    return { token: result.Ok.token, info: normalizeDatabaseTokenInfo(result.Ok.info) };
  });
}

export async function revokeDatabaseTokenAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  tokenId: string
): Promise<DatabaseTokenInfo> {
  const normalizedTokenId = tokenIdValue(tokenId);
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.revoke_database_token(databaseId, normalizedTokenId);
    if ("Err" in result) throwCanisterError(result.Err);
    return normalizeDatabaseTokenInfo(result.Ok);
  });
}

export async function listDatabaseTokensAuthenticated(canisterId: string, identity: Identity, databaseId: string): Promise<DatabaseTokenInfo[]> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.list_database_tokens(databaseId);
    if ("Err" in result) throw new Error(result.Err);
    return result.Ok.map(normalizeDatabaseTokenInfo);
  });
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

function quotaBytesBigInt(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("quota bytes must be a non-negative safe integer");
  }
  const parsed = BigInt(trimmed);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("quota bytes must be a non-negative safe integer");
  }
  return parsed;
}
