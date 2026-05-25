"use client";

// icpdb-console/lib/use-icpdb-account-actions.ts
// Account action hook: mutates tokens, members, and quota for the console side panel.

import { AuthClient } from "@icp-sdk/auth/client";
import type { Dispatch, SetStateAction } from "react";
import {
  createDatabaseTokenAuthenticated,
  grantDatabaseAccessAuthenticated,
  listDatabaseMembersAuthenticated,
  listDatabaseTokensAuthenticated,
  revokeDatabaseAccessAuthenticated,
  revokeDatabaseTokenAuthenticated,
  setDatabaseQuotaAuthenticated
} from "@/lib/icpdb-client";
import type {
  DatabaseMember,
  DatabaseRole,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage
} from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

type AccountActionOptions = {
  authClient: AuthClient | null;
  canisterId: string;
  databaseId: string;
  principal: string | null;
  canManageDatabase: boolean;
  canGrantMember: boolean;
  canMutateMembers: boolean;
  canSetQuota: boolean;
  tokenName: string;
  tokenScope: DatabaseTokenScope;
  memberPrincipal: string;
  memberRole: DatabaseRole;
  quotaBytes: string;
  setError: Dispatch<SetStateAction<string | null>>;
  setIssuedToken: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setMemberPrincipal: Dispatch<SetStateAction<string>>;
  setMembers: Dispatch<SetStateAction<DatabaseMember[]>>;
  setQuotaBytes: Dispatch<SetStateAction<string>>;
  setTokens: Dispatch<SetStateAction<DatabaseTokenInfo[]>>;
  setUsage: Dispatch<SetStateAction<DatabaseUsage | null>>;
};

export function useIcpdbAccountActions(options: AccountActionOptions) {
  const {
    authClient,
    canisterId,
    databaseId,
    principal,
    canManageDatabase,
    canGrantMember,
    canMutateMembers,
    canSetQuota,
    tokenName,
    tokenScope,
    memberPrincipal,
    memberRole,
    quotaBytes,
    setError,
    setIssuedToken,
    setLoadState,
    setMemberPrincipal,
    setMembers,
    setQuotaBytes,
    setTokens,
    setUsage
  } = options;

  async function createReadToken() {
    if (!authClient || !principal || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setIssuedToken(null);
    try {
      const identity = authClient.getIdentity();
      const nextToken = await createDatabaseTokenAuthenticated(canisterId, identity, databaseId, `web-read-${Date.now()}`, "read");
      setIssuedToken(nextToken.token);
      setTokens(await listDatabaseTokensAuthenticated(canisterId, identity, databaseId));
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function createToken() {
    if (!authClient || !canManageDatabase || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setIssuedToken(null);
    try {
      const identity = authClient.getIdentity();
      const name = tokenName.trim() || `web-${tokenScope}-${Date.now()}`;
      const nextToken = await createDatabaseTokenAuthenticated(canisterId, identity, databaseId, name, tokenScope);
      setIssuedToken(nextToken.token);
      setTokens(await listDatabaseTokensAuthenticated(canisterId, identity, databaseId));
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function revokeToken(tokenId: string) {
    if (!authClient || !canManageDatabase || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      const identity = authClient.getIdentity();
      await revokeDatabaseTokenAuthenticated(canisterId, identity, databaseId, tokenId);
      setTokens(await listDatabaseTokensAuthenticated(canisterId, identity, databaseId));
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function grantMember() {
    if (!authClient || !canGrantMember || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      const identity = authClient.getIdentity();
      await grantDatabaseAccessAuthenticated(canisterId, identity, databaseId, memberPrincipal.trim(), memberRole);
      setMembers(await listDatabaseMembersAuthenticated(canisterId, identity, databaseId));
      setMemberPrincipal("");
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function revokeMember(member: DatabaseMember) {
    if (!authClient || !canMutateMembers || !databaseId || !canisterId || member.principal === principal) return;
    setLoadState("loading");
    setError(null);
    try {
      const identity = authClient.getIdentity();
      await revokeDatabaseAccessAuthenticated(canisterId, identity, databaseId, member.principal);
      setMembers(await listDatabaseMembersAuthenticated(canisterId, identity, databaseId));
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function setQuota() {
    if (!authClient || !canSetQuota || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      const nextUsage = await setDatabaseQuotaAuthenticated(canisterId, authClient.getIdentity(), databaseId, quotaBytes.trim());
      setUsage(nextUsage);
      setQuotaBytes(nextUsage.maxLogicalSizeBytes);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  return { createReadToken, createToken, grantMember, revokeMember, revokeToken, setQuota };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}
