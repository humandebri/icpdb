// icpdb-console/lib/icpdb-http-client.ts
// Bearer-token HTTP client for browser-side ICPDB table and SQL operations.

import type {
  DatabaseTable,
  DatabaseRole,
  DatabaseTokenScope,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  RoutedOperationInfo,
  RoutedOperationStatus,
  SqlBatchRequest,
  SqlExecuteRequest,
  SqlExecuteResponse,
  SqlValue,
  TableDescription,
  TablePreviewRequest,
  TablePreviewResponse
} from "@/lib/types";

export type IcpdbTokenSession = {
  baseUrl: string;
  token: string;
  databaseId: string;
};

export type IcpdbTokenSessionInfo = {
  databaseId: string;
  tokenId: string;
  scope: DatabaseTokenScope;
  role: DatabaseRole;
};

export type IcpdbWriteOptions = {
  onIdempotencyKey?: (idempotencyKey: string) => void;
};

export async function getSessionInfoWithToken(session: IcpdbTokenSession): Promise<IcpdbTokenSessionInfo> {
  return normalizeSessionInfo(await postJson(session, "/v1/session", { database_id: session.databaseId }));
}

export async function getUsageWithToken(session: IcpdbTokenSession): Promise<DatabaseUsage> {
  return normalizeUsage(await postJson(session, "/v1/usage", { database_id: session.databaseId }));
}

export async function getUsageEventsWithToken(session: IcpdbTokenSession): Promise<DatabaseUsageEventSummary[]> {
  const value = await postJson(session, "/v1/usage/events", { database_id: session.databaseId });
  return arrayValue(value, "usage events").map(normalizeUsageEvent);
}

export async function getRoutedOperationWithToken(session: IcpdbTokenSession, operationId: string): Promise<RoutedOperationInfo> {
  return normalizeRoutedOperation(await postJson(session, "/v1/operations/get", {
    database_id: session.databaseId,
    operation_id: operationId
  }));
}

export async function listTablesWithToken(session: IcpdbTokenSession): Promise<DatabaseTable[]> {
  const value = await postJson(session, "/v1/tables/list", { database_id: session.databaseId });
  return arrayValue(value, "tables").map(normalizeTable);
}

export async function describeTableWithToken(session: IcpdbTokenSession, tableName: string): Promise<TableDescription> {
  return normalizeDescription(await postJson(session, "/v1/tables/describe", {
    database_id: session.databaseId,
    table_name: tableName
  }));
}

export async function previewTableWithToken(session: IcpdbTokenSession, request: TablePreviewRequest): Promise<TablePreviewResponse> {
  return normalizePreview(await postJson(session, "/v1/tables/preview", {
    database_id: session.databaseId,
    table_name: request.tableName,
    limit: request.limit ?? 100,
    offset: request.offset ?? 0
  }));
}

export async function sqlQueryWithToken(session: IcpdbTokenSession, request: SqlExecuteRequest): Promise<SqlExecuteResponse> {
  return normalizeSqlResponse(await postJson(session, "/v1/sql/query", sqlRequestBody(request)));
}

export async function sqlExecuteWithToken(session: IcpdbTokenSession, request: SqlExecuteRequest, options?: IcpdbWriteOptions): Promise<SqlExecuteResponse> {
  const idempotencyKey = nextIdempotencyKey("sql_execute", request.databaseId);
  options?.onIdempotencyKey?.(idempotencyKey);
  return normalizeSqlResponse(await postJson(session, "/v1/sql/execute", sqlRequestBody(request), {
    "idempotency-key": idempotencyKey
  }));
}

export async function sqlBatchWithToken(session: IcpdbTokenSession, request: SqlBatchRequest, options?: IcpdbWriteOptions): Promise<SqlExecuteResponse[]> {
  const idempotencyKey = nextIdempotencyKey("sql_batch", request.databaseId);
  options?.onIdempotencyKey?.(idempotencyKey);
  const value = await postJson(session, "/v1/sql/batch", {
    database_id: session.databaseId,
    statements: request.statements.map((statement) => ({
      sql: statement.sql,
      params: statement.params.map(sqlValueBody)
    })),
    max_rows: request.maxRows
  }, {
    "idempotency-key": idempotencyKey
  });
  return arrayValue(value, "batch response").map(normalizeSqlResponse);
}

async function postJson(session: IcpdbTokenSession, path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<unknown> {
  const response = await fetch(`${session.baseUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new Error(stringField(value, "error") || `HTTP ${response.status}`);
  }
  return value;
}

function nextIdempotencyKey(operation: string, databaseId: string): string {
  return `icpdb-web-${operation}-${databaseId}-${crypto.randomUUID()}`;
}

function sqlRequestBody(request: SqlExecuteRequest) {
  return {
    database_id: request.databaseId,
    sql: request.sql,
    params: request.params.map(sqlValueBody),
    max_rows: request.maxRows
  };
}

function sqlValueBody(value: SqlValue): unknown {
  if (value.kind === "null") return { null: null };
  if (value.kind === "integer") return { integer: Number(value.value) };
  if (value.kind === "real") return { real: value.value };
  if (value.kind === "text") return { text: value.value };
  return { blob: value.value };
}

function normalizeUsage(value: unknown): DatabaseUsage {
  return {
    databaseId: requiredString(value, "database_id"),
    status: requiredString(value, "status") === "deleted" ? "deleted" : requiredString(value, "status") === "archived" ? "archived" : requiredString(value, "status") === "archiving" ? "archiving" : requiredString(value, "status") === "restoring" ? "restoring" : "hot",
    logicalSizeBytes: numericString(value, "logical_size_bytes"),
    maxLogicalSizeBytes: numericString(value, "max_logical_size_bytes"),
    usageEventCount: numericString(value, "usage_event_count")
  };
}

function normalizeSessionInfo(value: unknown): IcpdbTokenSessionInfo {
  return {
    databaseId: requiredString(value, "database_id"),
    tokenId: requiredString(value, "token_id"),
    scope: normalizeTokenScope(requiredString(value, "scope")),
    role: normalizeDatabaseRole(requiredString(value, "role"))
  };
}

function normalizeUsageEvent(value: unknown): DatabaseUsageEventSummary {
  return {
    method: requiredString(value, "method"),
    operation: stringField(value, "operation") || null,
    success: booleanField(value, "success"),
    eventCount: numericString(value, "event_count"),
    totalCyclesDelta: numericString(value, "total_cycles_delta"),
    totalRowsReturned: numericString(value, "total_rows_returned"),
    totalRowsAffected: numericString(value, "total_rows_affected"),
    lastCreatedAtMs: numericString(value, "last_created_at_ms")
  };
}

function normalizeRoutedOperation(value: unknown): RoutedOperationInfo {
  return {
    operationId: requiredString(value, "operation_id"),
    databaseId: requiredString(value, "database_id"),
    databaseCanisterId: requiredString(value, "database_canister_id"),
    method: requiredString(value, "method"),
    requestHash: arrayValue(field(value, "request_hash"), "request hash").map((byte) => Number(byte)),
    status: normalizeRoutedOperationStatus(requiredString(value, "status")),
    error: stringField(value, "error"),
    createdAtMs: numericString(value, "created_at_ms"),
    updatedAtMs: numericString(value, "updated_at_ms")
  };
}

function normalizeRoutedOperationStatus(value: string): RoutedOperationStatus {
  if (value === "applied" || value === "failed" || value === "unknown") return value;
  return "pending";
}

function normalizeTable(value: unknown): DatabaseTable {
  return {
    name: requiredString(value, "name"),
    objectType: requiredString(value, "object_type") === "view" ? "view" : "table",
    schemaSql: stringField(value, "schema_sql") || null
  };
}

function normalizeDescription(value: unknown): TableDescription {
  return {
    databaseId: requiredString(value, "database_id"),
    tableName: requiredString(value, "table_name"),
    objectType: requiredString(value, "object_type") === "view" ? "view" : "table",
    schemaSql: stringField(value, "schema_sql") || null,
    columns: arrayValue(field(value, "columns"), "columns").map((column) => ({
      cid: numberField(column, "cid"),
      name: requiredString(column, "name"),
      declaredType: requiredString(column, "declared_type"),
      notNull: booleanField(column, "not_null"),
      defaultValue: stringField(column, "default_value") || null,
      primaryKeyPosition: numberField(column, "primary_key_position"),
      hidden: numberField(column, "hidden")
    })),
    indexes: optionalArrayValue(field(value, "indexes")).map((index) => ({
      name: requiredString(index, "name"),
      tableName: requiredString(index, "table_name"),
      unique: booleanField(index, "unique"),
      origin: requiredString(index, "origin"),
      partial: booleanField(index, "partial"),
      columns: optionalArrayValue(field(index, "columns")).map((column) => ({
        seqno: numberField(column, "seqno"),
        cid: numericString(column, "cid"),
        name: stringField(column, "name"),
        descending: booleanField(column, "descending"),
        collation: requiredString(column, "collation"),
        key: booleanField(column, "key")
      })),
      schemaSql: stringField(index, "schema_sql") || null
    })),
    triggers: optionalArrayValue(field(value, "triggers")).map((trigger) => ({
      name: requiredString(trigger, "name"),
      tableName: requiredString(trigger, "table_name"),
      schemaSql: stringField(trigger, "schema_sql") || null
    })),
    foreignKeys: optionalArrayValue(field(value, "foreign_keys")).map((key) => ({
      id: numberField(key, "id"),
      seq: numberField(key, "seq"),
      tableName: requiredString(key, "table_name"),
      fromColumn: requiredString(key, "from_column"),
      toColumn: stringField(key, "to_column") || null,
      onUpdate: requiredString(key, "on_update"),
      onDelete: requiredString(key, "on_delete"),
      matchClause: requiredString(key, "match_clause")
    }))
  };
}

function normalizePreview(value: unknown): TablePreviewResponse {
  return {
    databaseId: requiredString(value, "database_id"),
    tableName: requiredString(value, "table_name"),
    columns: arrayValue(field(value, "columns"), "preview columns").map((column) => String(column)),
    rows: arrayValue(field(value, "rows"), "preview rows").map(normalizeSqlRow),
    offset: numberField(value, "offset"),
    limit: numberField(value, "limit"),
    totalCount: numericString(value, "total_count"),
    truncated: booleanField(value, "truncated")
  };
}

function normalizeSqlResponse(value: unknown): SqlExecuteResponse {
  return {
    columns: arrayValue(field(value, "columns"), "columns").map((column) => String(column)),
    rows: arrayValue(field(value, "rows"), "rows").map(normalizeSqlRow),
    rowsAffected: numericString(value, "rows_affected"),
    lastInsertRowId: numericString(value, "last_insert_rowid"),
    truncated: booleanField(value, "truncated")
  };
}

function normalizeSqlRow(value: unknown): SqlValue[] {
  return arrayValue(value, "row").map(normalizeSqlValue);
}

function normalizeSqlValue(value: unknown): SqlValue {
  const nullValue = field(value, "null") ?? field(value, "Null");
  if (nullValue !== undefined) return { kind: "null" };
  const integer = field(value, "integer") ?? field(value, "Integer");
  if (integer !== undefined) return { kind: "integer", value: String(integer) };
  const real = field(value, "real") ?? field(value, "Real");
  if (typeof real === "number") return { kind: "real", value: real };
  const text = field(value, "text") ?? field(value, "Text");
  if (typeof text === "string") return { kind: "text", value: text };
  const blob = field(value, "blob") ?? field(value, "Blob");
  if (Array.isArray(blob)) return { kind: "blob", value: blob.map((byte) => Number(byte)) };
  return { kind: "null" };
}

function field(source: unknown, key: string): unknown {
  return typeof source === "object" && source !== null ? Reflect.get(source, key) : undefined;
}

function requiredString(source: unknown, key: string): string {
  const value = field(source, key);
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function stringField(source: unknown, key: string): string | null {
  const value = field(source, key);
  return typeof value === "string" ? value : null;
}

function numericString(source: unknown, key: string): string {
  const value = field(source, key);
  if (typeof value !== "number" && typeof value !== "string") throw new Error(`${key} must be numeric`);
  return String(value);
}

function numberField(source: unknown, key: string): number {
  const value = field(source, key);
  if (typeof value !== "number") throw new Error(`${key} must be a number`);
  return value;
}

function booleanField(source: unknown, key: string): boolean {
  return field(source, key) === true;
}

function normalizeDatabaseRole(value: string): DatabaseRole {
  if (value === "owner") return "owner";
  return value === "writer" ? "writer" : "reader";
}

function normalizeTokenScope(value: string): DatabaseTokenScope {
  if (value === "owner") return "owner";
  return value === "write" ? "write" : "read";
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function optionalArrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
