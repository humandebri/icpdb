"use client";

// icpdb-console/lib/use-icpdb-shard-actions.ts
// Workbench shard actions: loads placement inventory and reconciles routed operation journal entries.

import type { AuthClient } from "@icp-sdk/auth/client";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import {
  listAllDatabasePlacementsAuthenticated,
  listShardOperationsAuthenticated,
  reconcileShardOperationAuthenticated
} from "@/lib/icpdb-client";
import type { LoadState } from "@/lib/use-icpdb-workbench-state";
import type { DatabaseShardPlacement, ShardOperationInfo, ShardOperationReconcileStatus } from "@/lib/types";

type UseIcpdbShardActionsParams = {
  authClient: AuthClient | null;
  canisterId: string;
  shardReconcileError: string;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setShardJournalStatus: Dispatch<SetStateAction<string>>;
  setShardOperations: Dispatch<SetStateAction<ShardOperationInfo[]>>;
  setShardPlacements: Dispatch<SetStateAction<DatabaseShardPlacement[]>>;
  setShardPlacementStatus: Dispatch<SetStateAction<string>>;
  setShardReconcileError: Dispatch<SetStateAction<string>>;
};

export function useIcpdbShardActions({
  authClient,
  canisterId,
  shardReconcileError,
  setError,
  setLoadState,
  setShardJournalStatus,
  setShardOperations,
  setShardPlacements,
  setShardPlacementStatus,
  setShardReconcileError
}: UseIcpdbShardActionsParams) {
  const refreshAllShardPlacements = useCallback(async () => {
    if (!authClient || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setShardPlacementStatus("Loading all placements");
    try {
      const placements = await listAllDatabasePlacementsAuthenticated(canisterId, authClient.getIdentity());
      setShardPlacements(placements);
      setShardPlacementStatus(`All placements: ${placements.length}`);
      setLoadState("ready");
    } catch (cause) {
      setShardPlacementStatus(errorMessage(cause));
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }, [authClient, canisterId, setError, setLoadState, setShardPlacements, setShardPlacementStatus]);

  const refreshShardOperations = useCallback(async () => {
    if (!authClient || !canisterId) return;
    setLoadState("loading");
    setError(null);
    setShardJournalStatus("Loading");
    try {
      const operations = await listShardOperationsAuthenticated(canisterId, authClient.getIdentity());
      setShardOperations(operations);
      setShardJournalStatus(`${operations.length} operations`);
      setLoadState("ready");
    } catch (cause) {
      setShardJournalStatus(errorMessage(cause));
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }, [authClient, canisterId, setError, setLoadState, setShardJournalStatus, setShardOperations]);

  const reconcileShardOperation = useCallback(async (
    operation: ShardOperationInfo,
    status: ShardOperationReconcileStatus
  ) => {
    if (!authClient || !canisterId) return;
    const error = status === "failed" ? shardReconcileError.trim() : null;
    if (status === "failed" && !error) {
      setShardJournalStatus("Failure reason required");
      return;
    }
    setLoadState("loading");
    setError(null);
    setShardJournalStatus("Reconciling");
    try {
      const reconciled = await reconcileShardOperationAuthenticated(canisterId, authClient.getIdentity(), {
        operationId: operation.operationId,
        status,
        error
      });
      setShardOperations((current) => current.map((item) => item.operationId === reconciled.operationId ? reconciled : item));
      if (status === "failed") setShardReconcileError("");
      setShardJournalStatus(`Reconciled ${reconciled.operationId}`);
      setLoadState("ready");
    } catch (cause) {
      setShardJournalStatus(errorMessage(cause));
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }, [
    authClient,
    canisterId,
    setError,
    setLoadState,
    setShardJournalStatus,
    setShardOperations,
    setShardReconcileError,
    shardReconcileError
  ]);

  return { refreshAllShardPlacements, refreshShardOperations, reconcileShardOperation };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}
