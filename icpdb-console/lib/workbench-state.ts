// icpdb-console/lib/workbench-state.ts
// Pure workbench helpers: keep form parsing, pagination labels, and small policy checks outside React state.

import type {
  DatabaseRole,
  DatabaseSummary,
  DatabaseTable,
  DatabaseTokenScope,
  SqlValue,
  TablePreviewResponse
} from "@/lib/types";

export const tableLimitOptions = [25, 50, 100, 250];

export function parseParams(source: string): SqlValue[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) {
    throw new Error("params must be a JSON array");
  }
  return parsed.map(jsonToSqlValue);
}

export function tablePageLabel(preview: TablePreviewResponse): string {
  if (preview.rows.length === 0) {
    return `Rows 0 of ${preview.totalCount}`;
  }
  const start = preview.offset + 1;
  const end = preview.offset + preview.rows.length;
  return `Rows ${start}-${end} of ${preview.totalCount}`;
}

export function hasNextTablePage(preview: TablePreviewResponse): boolean {
  return BigInt(preview.offset + preview.rows.length) < BigInt(preview.totalCount);
}

export function parseTableLimit(source: string): number {
  const parsed = Number(source);
  return tableLimitOptions.includes(parsed) ? parsed : 100;
}

export function parseSqlMaxRows(source: string): number {
  const trimmed = source.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("max rows must be an integer from 1 to 500");
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("max rows must be an integer from 1 to 500");
  }
  return parsed;
}

export function selectPreferredTableName(tables: DatabaseTable[], preferredTableName: string): string {
  return tables.find((table) => table.name === preferredTableName)?.name ?? tables[0]?.name ?? "";
}

export function canLoadOwnerResources(databases: DatabaseSummary[], databaseId: string): boolean {
  return databases.find((database) => database.databaseId === databaseId)?.role === "owner";
}

export function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function quotaUsagePercent(logicalSizeBytes: string, maxLogicalSizeBytes: string): number {
  try {
    const used = BigInt(logicalSizeBytes);
    const max = BigInt(maxLogicalSizeBytes);
    if (used <= 0n || max <= 0n) return 0;
    const clamped = used > max ? max : used;
    return Number((clamped * 10_000n) / max) / 100;
  } catch {
    return 0;
  }
}

export function parseIcpToE8s(source: string): string {
  const trimmed = source.trim();
  if (!/^\d+(\.\d{0,8})?$/.test(trimmed)) {
    throw new Error("ICP amount must have up to 8 decimal places");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const e8s = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0") || "0");
  if (e8s <= 0n) {
    throw new Error("ICP amount must be greater than 0");
  }
  return e8s.toString();
}

export function formatIcpE8s(value: string): string {
  const e8s = BigInt(value);
  const whole = e8s / 100_000_000n;
  const fraction = (e8s % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function parseTokenScope(value: string): DatabaseTokenScope {
  if (value === "owner") return "owner";
  return value === "write" ? "write" : "read";
}

export function parseDatabaseRole(value: string): DatabaseRole {
  if (value === "owner") return "owner";
  if (value === "writer") return "writer";
  return "reader";
}

export function canWriteDatabaseRole(role: DatabaseRole): boolean {
  return role === "owner" || role === "writer";
}

export function normalizeCreateTableName(source: string): string {
  const value = source.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("table name must use letters, digits, and underscore");
  }
  return value;
}

export function normalizeCreateTableColumns(source: string): string {
  const value = source.trim();
  if (!value) {
    throw new Error("table columns are required");
  }
  if (value.includes(";")) {
    throw new Error("table columns must not contain semicolons");
  }
  return value;
}

export function archiveSnapshotFileName(databaseId: string, hashHex: string): string {
  const safeDatabaseId = databaseId.replace(/[^A-Za-z0-9_.-]/g, "_") || "database";
  return `${safeDatabaseId}-${hashHex.slice(0, 12)}.sqlite3`;
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function appendBytes(target: number[], source: number[]) {
  for (const byte of source) {
    target.push(byte);
  }
}

function jsonToSqlValue(value: unknown): SqlValue {
  if (value === null) return { kind: "null" };
  if (typeof value === "string") return { kind: "text", value };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!Number.isInteger(value)) return { kind: "real", value };
    if (!Number.isSafeInteger(value)) {
      throw new Error("integer params must be safe JS integers; use a string for large values");
    }
    return { kind: "integer", value: String(value) };
  }
  throw new Error("params may contain only null, string, or number values");
}
