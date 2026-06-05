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
import { Principal } from "@icp-sdk/core/principal";

export const tableLimitOptions = [25, 50, 100, 250];

export function parseParams(source: string, sql = ""): SqlValue[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) {
    if (!isRecord(parsed)) throw new Error("params must be a JSON array or object");
    return namedSqlParameters(sql).map((token) => jsonToSqlValue(namedSqlParamValue(parsed, token)));
  }
  return parsed.map(jsonToSqlValue);
}

function namedSqlParameters(sql: string): string[] {
  const tokens: string[] = [];
  const seenTokens = new Set<string>();
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const nextChar = sql[index + 1] ?? "";
    if (char === "'" || char === "\"" || char === "`") {
      index = skipQuotedSql(sql, index, char);
      continue;
    }
    if (char === "[") {
      index = skipBracketedSql(sql, index);
      continue;
    }
    if (char === "-" && nextChar === "-") {
      index = skipLineComment(sql, index);
      continue;
    }
    if (char === "/" && nextChar === "*") {
      index = skipBlockComment(sql, index);
      continue;
    }
    if ((char === ":" || char === "@" || char === "$") && isSqlIdentifierStart(nextChar)) {
      const end = sqlTokenEnd(sql, index + 2);
      const token = sql.slice(index, end);
      if (!seenTokens.has(token)) {
        seenTokens.add(token);
        tokens.push(token);
      }
      index = end;
      continue;
    }
    index += 1;
  }
  if (tokens.length === 0) throw new Error("named SQL params require named placeholders");
  return tokens;
}

function namedSqlParamValue(params: Record<string, unknown>, token: string): unknown {
  if (Object.prototype.hasOwnProperty.call(params, token)) return params[token];
  const name = token.slice(1);
  if (Object.prototype.hasOwnProperty.call(params, name)) return params[name];
  throw new Error(`missing SQL named param: ${name}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function skipQuotedSql(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] !== quote) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return sql.length;
}

function skipBracketedSql(sql: string, start: number): number {
  const end = sql.indexOf("]", start + 1);
  return end < 0 ? sql.length : end + 1;
}

function skipLineComment(sql: string, start: number): number {
  const end = sql.indexOf("\n", start + 2);
  return end < 0 ? sql.length : end + 1;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf("*/", start + 2);
  return end < 0 ? sql.length : end + 2;
}

function sqlTokenEnd(sql: string, start: number): number {
  let index = start;
  while (index < sql.length && isSqlIdentifierPart(sql[index])) {
    index += 1;
  }
  return index;
}

function isSqlIdentifierStart(char: string): boolean {
  return /^[A-Za-z_]$/.test(char);
}

function isSqlIdentifierPart(char: string): boolean {
  return /^[A-Za-z0-9_]$/.test(char);
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

export function isSafeQuotaBytes(source: string): boolean {
  const trimmed = source.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  return BigInt(trimmed) <= BigInt(Number.MAX_SAFE_INTEGER);
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

export function normalizeMemberPrincipalInput(source: string): string {
  const value = source.trim();
  if (!value) return "";
  const assignment = /^\s*export\s+ICPDB_SERVICE_PRINCIPAL=(.*)$|^\s*ICPDB_SERVICE_PRINCIPAL=(.*)$/m.exec(value);
  return unquoteMemberPrincipal((assignment?.[1] ?? assignment?.[2] ?? value).trim());
}

export function isValidPrincipalText(source: string): boolean {
  try {
    Principal.fromText(source);
    return true;
  } catch {
    return false;
  }
}

export function canWriteDatabaseRole(role: DatabaseRole): boolean {
  return role === "owner" || role === "writer";
}

function unquoteMemberPrincipal(source: string): string {
  if (
    (source.startsWith("\"") && source.endsWith("\"")) ||
    (source.startsWith("'") && source.endsWith("'"))
  ) {
    return source.slice(1, -1).trim();
  }
  return source;
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
  if (typeof value === "boolean") return { kind: "integer", value: value ? "1" : "0" };
  if (typeof value === "string") return { kind: "text", value };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!Number.isInteger(value)) return { kind: "real", value };
    if (!Number.isSafeInteger(value)) {
      throw new Error("integer params must be safe JS integers; use a string for large values");
    }
    return { kind: "integer", value: String(value) };
  }
  if (Array.isArray(value) && value.every(isByteValue)) return { kind: "blob", value };
  if (isRecord(value)) return structuredSqlValue(value);
  throw new Error("params may contain only null, string, number, boolean, byte array, or SqlValue objects");
}

function structuredSqlValue(value: Record<string, unknown>): SqlValue {
  const kind = Reflect.get(value, "kind");
  if (kind === "null") return { kind: "null" };
  const rawValue = Reflect.get(value, "value");
  if (kind === "integer" && typeof rawValue === "string" && /^-?\d+$/.test(rawValue)) return { kind: "integer", value: rawValue };
  if (kind === "real" && typeof rawValue === "number" && Number.isFinite(rawValue)) return { kind: "real", value: rawValue };
  if (kind === "text" && typeof rawValue === "string") return { kind: "text", value: rawValue };
  if (kind === "blob" && Array.isArray(rawValue) && rawValue.every(isByteValue)) return { kind: "blob", value: rawValue };
  throw new Error("SqlValue object params must be null, integer, real, text, or blob");
}

function isByteValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}
