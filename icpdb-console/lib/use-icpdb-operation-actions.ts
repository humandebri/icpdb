"use client";

// icpdb-console/lib/use-icpdb-operation-actions.ts
// Routed operation lookup actions: keep remote write status inspection separate from SQL execution.

import type { Dispatch, SetStateAction } from "react";
import type { AuthClient } from "@icp-sdk/auth/client";
import { getRoutedOperationAuthenticated } from "@/lib/icpdb-client";
import { getRoutedOperationWithToken, type IcpdbTokenSession } from "@/lib/icpdb-http-client";
import type { RoutedOperationInfo } from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

type OperationActionOptions = {
  authClient: AuthClient | null;
  canisterId: string;
  databaseId: string;
  operationId: string;
  tokenSession: IcpdbTokenSession | null;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadState: Dispatch<SetStateAction<LoadState>>;
  setOperationStatus: Dispatch<SetStateAction<string>>;
  setRoutedOperation: Dispatch<SetStateAction<RoutedOperationInfo | null>>;
};

export function useIcpdbOperationActions(options: OperationActionOptions) {
  const {
    authClient,
    canisterId,
    databaseId,
    operationId,
    tokenSession,
    setError,
    setLoadState,
    setOperationStatus,
    setRoutedOperation
  } = options;

  function clearRoutedOperation() {
    setRoutedOperation(null);
    setOperationStatus("No operation loaded");
  }

  async function loadRoutedOperation() {
    if (!tokenSession && (!authClient || !canisterId || !databaseId)) return;
    const nextOperationId = operationId.trim();
    if (!nextOperationId) {
      setOperationStatus("Operation id required");
      return;
    }
    setLoadState("loading");
    setError(null);
    try {
      const operation = tokenSession
        ? await getRoutedOperationWithToken(tokenSession, nextOperationId)
        : await getRoutedOperationAuthenticated(canisterId, requireIdentity(), databaseId, nextOperationId);
      setRoutedOperation(operation);
      setOperationStatus(`Operation ${operation.status}`);
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setLoadState("error");
    }
  }

  return { clearRoutedOperation, loadRoutedOperation };

  function requireIdentity() {
    if (!authClient || !canisterId || !databaseId) {
      throw new Error("Login and database required");
    }
    return authClient.getIdentity();
  }
}
