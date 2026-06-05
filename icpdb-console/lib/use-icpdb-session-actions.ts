"use client";

// icpdb-console/lib/use-icpdb-session-actions.ts
// Session action hook: initializes Internet Identity auth, syncs DB list, and handles database selection.

import { AuthClient } from "@icp-sdk/auth/client";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect } from "react";
import { DELEGATION_TTL_NS, identityProviderUrl } from "@/lib/auth";
import { adapterDatabaseSummary, type ConsoleConnection } from "@/lib/console-connection";
import { listDatabasePlacementsAuthenticated, listDatabasesAuthenticated } from "@/lib/icpdb-client";
import type {
  DatabaseBilling,
  DatabaseShardPlacement,
  DatabaseSummary,
  DatabaseUsage,
  DatabaseUsageEventSummary
} from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

type SessionActionOptions = {
  canisterId: string;
  connection: ConsoleConnection;
  clearTableState: () => void;
  resetDepositApproval: () => void;
  setAuthClient: Dispatch<SetStateAction<AuthClient | null>>;
  setBilling: Dispatch<SetStateAction<DatabaseBilling | null>>;
  setDatabaseId: Dispatch<SetStateAction<string>>;
  setDatabases: Dispatch<SetStateAction<DatabaseSummary[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setPrincipal: Dispatch<SetStateAction<string | null>>;
  setShardPlacements: Dispatch<SetStateAction<DatabaseShardPlacement[]>>;
  setShardPlacementStatus: Dispatch<SetStateAction<string>>;
  setUsage: Dispatch<SetStateAction<DatabaseUsage | null>>;
  setUsageEvents: Dispatch<SetStateAction<DatabaseUsageEventSummary[]>>;
};

export function useIcpdbSessionActions(options: SessionActionOptions) {
  const {
    canisterId,
    connection,
    clearTableState,
    resetDepositApproval,
    setAuthClient,
    setBilling,
    setDatabaseId,
    setDatabases,
    setError,
    setLoadState,
    setPrincipal,
    setShardPlacements,
    setShardPlacementStatus,
    setUsage,
    setUsageEvents
  } = options;

  const refreshDatabases = useCallback(
    async (client: AuthClient) => {
      if (!canisterId) {
        setError(connection.mode === "adapter" ? "adapter canisterId query parameter is required." : "NEXT_PUBLIC_ICPDB_CANISTER_ID is not configured.");
        setLoadState("error");
        return;
      }
      setLoadState("loading");
      setError(null);
      try {
        const identity = client.getIdentity();
        if (connection.mode === "adapter") {
          const nextDatabases = [adapterDatabaseSummary(connection.databaseId)];
          setDatabases(nextDatabases);
          setShardPlacements([]);
          setShardPlacementStatus("Adapter mode");
          setPrincipal(identity.getPrincipal().toText());
          setDatabaseId(connection.databaseId);
          setLoadState("ready");
          return;
        }
        const [nextDatabases, nextShardPlacements] = await Promise.all([
          listDatabasesAuthenticated(canisterId, identity),
          listDatabasePlacementsAuthenticated(canisterId, identity)
        ]);
        setDatabases(nextDatabases);
        setShardPlacements(nextShardPlacements);
        setShardPlacementStatus(`Caller placements: ${nextShardPlacements.length}`);
        setPrincipal(identity.getPrincipal().toText());
        setDatabaseId((current) => current || (nextDatabases[0]?.databaseId ?? ""));
        setLoadState("ready");
      } catch (cause) {
        setError(errorMessage(cause));
        setLoadState("error");
      }
    },
    [canisterId, connection, setDatabaseId, setDatabases, setError, setLoadState, setPrincipal, setShardPlacements, setShardPlacementStatus]
  );

  useEffect(() => {
    let cancelled = false;
    AuthClient.create()
      .then(async (client) => {
        if (cancelled) return;
        setAuthClient(client);
        if (await client.isAuthenticated()) {
          await refreshDatabases(client);
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(errorMessage(cause));
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshDatabases, setAuthClient, setError, setLoadState]);

  function selectDatabase(nextDatabaseId: string) {
    setDatabaseId(nextDatabaseId);
    setUsage(null);
    setUsageEvents([]);
    setBilling(null);
    clearTableState();
    resetDepositApproval();
  }

  async function login(authClient: AuthClient | null) {
    if (!authClient) return;
    setError(null);
    await authClient.login({
      identityProvider: identityProviderUrl(),
      maxTimeToLive: DELEGATION_TTL_NS,
      onSuccess: () => {
        void refreshDatabases(authClient);
      },
      onError: (cause) => {
        setError(errorMessage(cause));
        setLoadState("error");
      }
    });
  }

  return { login, refreshDatabases, selectDatabase };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}
