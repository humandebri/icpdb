"use client";

// icpdb-console/lib/use-icpdb-database-actions.ts
// Database lifecycle hook: creates, deletes, and cancels archive flows while refreshing console state.

import type { AuthClient } from "@icp-sdk/auth/client";
import type { Dispatch, SetStateAction } from "react";
import {
  cancelDatabaseArchiveAuthenticated,
  createDatabaseAuthenticated,
  deleteDatabaseAuthenticated
} from "@/lib/icpdb-client";
import type {
  DatabaseBilling,
  DatabaseMember,
  DatabaseTokenInfo,
  DatabaseUsage,
  PaymentRecord
} from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

type DatabaseActionOptions = {
  authClient: AuthClient | null;
  canisterId: string;
  canDeleteDatabase: boolean;
  databaseId: string;
  principal: string | null;
  clearTableState: () => void;
  refreshDatabaseAccount: (client: AuthClient, databaseId: string) => Promise<void>;
  refreshDatabaseDetails: (client: AuthClient, databaseId: string, preferredTableName: string) => Promise<void>;
  refreshDatabases: (client: AuthClient) => Promise<void>;
  resetDepositApproval: () => void;
  setArchiveStatus: Dispatch<SetStateAction<string>>;
  setBilling: Dispatch<SetStateAction<DatabaseBilling | null>>;
  setDatabaseId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setMembers: Dispatch<SetStateAction<DatabaseMember[]>>;
  setPayments: Dispatch<SetStateAction<PaymentRecord[]>>;
  setTokens: Dispatch<SetStateAction<DatabaseTokenInfo[]>>;
  setUsage: Dispatch<SetStateAction<DatabaseUsage | null>>;
};

export function useIcpdbDatabaseActions(options: DatabaseActionOptions) {
  const {
    authClient,
    canisterId,
    canDeleteDatabase,
    databaseId,
    principal,
    clearTableState,
    refreshDatabaseAccount,
    refreshDatabaseDetails,
    refreshDatabases,
    resetDepositApproval,
    setArchiveStatus,
    setBilling,
    setDatabaseId,
    setError,
    setLoadState,
    setMembers,
    setPayments,
    setTokens,
    setUsage
  } = options;

  async function createDatabase() {
    if (!authClient || !principal || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      const nextDatabaseId = await createDatabaseAuthenticated(canisterId, authClient.getIdentity());
      await refreshDatabases(authClient);
      setDatabaseId(nextDatabaseId);
      clearTableState();
      await refreshDatabaseDetails(authClient, nextDatabaseId, "");
      resetDepositApproval();
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function deleteSelectedDatabase() {
    if (!authClient || !canDeleteDatabase || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      await deleteDatabaseAuthenticated(canisterId, authClient.getIdentity(), databaseId);
      clearTableState();
      resetDepositApproval();
      await refreshDatabases(authClient);
      setDatabaseId("");
      setUsage(null);
      setBilling(null);
      setTokens([]);
      setMembers([]);
      setPayments([]);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  async function cancelArchive() {
    if (!authClient || !databaseId || !canisterId) return;
    setLoadState("loading");
    setError(null);
    try {
      await cancelDatabaseArchiveAuthenticated(canisterId, authClient.getIdentity(), databaseId);
      setArchiveStatus("Archive cancelled");
      await refreshDatabases(authClient);
      await refreshDatabaseAccount(authClient, databaseId);
      setLoadState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }

  return { cancelArchive, createDatabase, deleteSelectedDatabase };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}
