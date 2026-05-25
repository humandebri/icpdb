// icpdb-console/lib/icpdb-account-api.ts
// Billing, quota, token, and permission API calls.

import type { Identity } from "@icp-sdk/core/agent";
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
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.set_database_quota({
      database_id: databaseId,
      max_logical_size_bytes: BigInt(maxLogicalSizeBytes)
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
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.grant_database_access(databaseId, memberPrincipal, databaseRoleVariant(role));
    if ("Err" in result) throwCanisterError(result.Err);
  });
}

export async function revokeDatabaseAccessAuthenticated(
  canisterId: string,
  identity: Identity,
  databaseId: string,
  memberPrincipal: string
): Promise<void> {
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.revoke_database_access(databaseId, memberPrincipal);
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
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.create_database_token({
      database_id: databaseId,
      name,
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
  return callIcpdb(async () => {
    const actor = await createAuthenticatedActor(canisterId, identity);
    const result = await actor.revoke_database_token(databaseId, tokenId);
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
