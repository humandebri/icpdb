"use client";

// icpdb-console/lib/icpdb-token-session.ts
// Token session parsing: validate the browser HTTP token connection fields.

import type { IcpdbTokenSession } from "@/lib/icpdb-http-client";

export function normalizeTokenSession(baseUrl: string, token: string, databaseId: string): IcpdbTokenSession {
  const session = { baseUrl: baseUrl.trim(), token: token.trim(), databaseId: databaseId.trim() };
  if (!session.baseUrl) throw new Error("HTTP base URL is required");
  if (!session.databaseId) throw new Error("database_id is required");
  if (!session.token) throw new Error("api token is required");
  return session;
}
