// icpdb-console/lib/console-connection.ts
// Console connection targeting: separates hosted ICPDB mode from generic SQLite Admin Protocol adapter mode.

import type { DatabaseSummary } from "@/lib/types";

export type ConsoleConnectionMode = "hosted" | "adapter";

export type ConsoleSearchParams = {
  mode?: string | string[] | undefined;
  canisterId?: string | string[] | undefined;
  databaseId?: string | string[] | undefined;
};

export type ConsoleConnection = {
  mode: ConsoleConnectionMode;
  canisterId: string;
  databaseId: string;
};

export function consoleConnectionFromSearchParams(searchParams: ConsoleSearchParams, hostedCanisterId: string): ConsoleConnection {
  const modeValue = firstSearchParam(searchParams.mode).trim();
  if (modeValue !== "adapter") {
    return { mode: "hosted", canisterId: hostedCanisterId, databaseId: "" };
  }
  const canisterIdValue = firstSearchParam(searchParams.canisterId).trim();
  const databaseIdValue = firstSearchParam(searchParams.databaseId).trim();
  return { mode: "adapter", canisterId: canisterIdValue, databaseId: databaseIdValue || "default" };
}

export function adapterDatabaseSummary(databaseId: string): DatabaseSummary {
  return {
    databaseId,
    role: "writer",
    status: "hot",
    logicalSizeBytes: "0",
    archivedAtMs: null,
    deletedAtMs: null
  };
}

function firstSearchParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
