"use client";

// icpdb-console/lib/use-icpdb-token-admin-actions.ts
// Owner-token side-panel actions: token issuance, members, and quota.

import type { Dispatch, SetStateAction } from "react";
import {
  createTokenWithToken,
  grantMemberWithToken,
  listMembersWithToken,
  listTokensWithToken,
  revokeMemberWithToken,
  revokeTokenWithToken,
  setQuotaWithToken
} from "@/lib/icpdb-http-admin-client";
import type {
  DatabaseMember,
  DatabaseRole,
  DatabaseTokenInfo,
  DatabaseTokenScope,
  DatabaseUsage
} from "@/lib/types";
import type { IcpdbTokenSession } from "@/lib/icpdb-http-client";
import { normalizeMemberPrincipalInput } from "@/lib/workbench-state";

type LoadState = "idle" | "loading" | "ready" | "error";

type TokenAdminActionOptions = {
  canGrantMember: boolean;
  canManageDatabase: boolean;
  canMutateMembers: boolean;
  canSetQuota: boolean;
  memberPrincipal: string;
  memberRole: DatabaseRole;
  members: DatabaseMember[];
  quotaBytes: string;
  tableName: string;
  tokenName: string;
  tokenScope: DatabaseTokenScope;
  tokenSession: IcpdbTokenSession | null;
  refreshTokenDetails: (session: IcpdbTokenSession, preferredTableName: string) => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIssuedToken: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setMemberPrincipal: Dispatch<SetStateAction<string>>;
  setMembers: Dispatch<SetStateAction<DatabaseMember[]>>;
  setQuotaBytes: Dispatch<SetStateAction<string>>;
  setTokens: Dispatch<SetStateAction<DatabaseTokenInfo[]>>;
  setUsage: Dispatch<SetStateAction<DatabaseUsage | null>>;
};

export function useIcpdbTokenAdminActions(options: TokenAdminActionOptions) {
  const {
    canGrantMember, canManageDatabase, canMutateMembers, canSetQuota,
    memberPrincipal, memberRole, members, quotaBytes, tableName, tokenName, tokenScope, tokenSession,
    refreshTokenDetails, setError, setIssuedToken, setLoadState, setMemberPrincipal, setMembers,
    setQuotaBytes, setTokens, setUsage
  } = options;

  async function createToken() {
    if (!tokenSession || !canManageDatabase) return;
    await runTokenAdminAction(async () => {
      const name = tokenName.trim() || `web-${tokenScope}-${Date.now()}`;
      const nextToken = await createTokenWithToken(tokenSession, name, tokenScope);
      setIssuedToken(nextToken.token);
      setTokens(await listTokensWithToken(tokenSession));
    });
  }

  async function revokeToken(tokenId: string) {
    if (!tokenSession || !canManageDatabase) return;
    await runTokenAdminAction(async () => {
      await revokeTokenWithToken(tokenSession, tokenId);
      setTokens(await listTokensWithToken(tokenSession));
    });
  }

  async function grantMember() {
    if (!tokenSession || !canGrantMember) return;
    await runTokenAdminAction(async () => {
      await grantMemberWithToken(tokenSession, normalizeMemberPrincipalInput(memberPrincipal), memberRole);
      setMembers(await listMembersWithToken(tokenSession));
      setMemberPrincipal("");
    });
  }

  async function revokeMember(member: DatabaseMember) {
    if (!tokenSession || !canMutateMembers) return;
    if (isLastOwnerMember(member, members)) return;
    await runTokenAdminAction(async () => {
      await revokeMemberWithToken(tokenSession, member.principal);
      setMembers(await listMembersWithToken(tokenSession));
    });
  }

  async function setQuota() {
    if (!tokenSession || !canSetQuota) return;
    await runTokenAdminAction(async () => {
      const nextUsage = await setQuotaWithToken(tokenSession, quotaBytes.trim());
      setUsage(nextUsage);
      setQuotaBytes(nextUsage.maxLogicalSizeBytes);
      await refreshTokenDetails(tokenSession, tableName);
    });
  }

  async function runTokenAdminAction(action: () => Promise<void>) {
    setLoadState("loading");
    setError(null);
    try {
      await action();
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setLoadState("error");
    }
  }

  return { createToken, grantMember, revokeMember, revokeToken, setQuota };
}

function isLastOwnerMember(member: DatabaseMember, members: DatabaseMember[]): boolean {
  return member.role === "owner" && members.filter((item) => item.role === "owner").length <= 1;
}
