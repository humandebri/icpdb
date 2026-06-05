// icpdb-console/lib/icpdb-table-codec.ts
// Convert table inspection and SQL Candid DTOs.

import type {
  DatabaseColumn,
  DatabaseForeignKey,
  DatabaseIndex,
  DatabaseIndexColumn,
  DatabaseObjectType,
  DatabaseTable,
  DatabaseTrigger,
  SqlBatchRequest,
  SqlExecuteRequest,
  SqlExecuteResponse,
  SqlStatement,
  SqlValue,
  TableDescription,
  TablePreviewRequest,
  TablePreviewResponse
} from "./types.js";
import type {
  RawDatabaseColumn,
  RawDatabaseForeignKey,
  RawDatabaseIndex,
  RawDatabaseIndexColumn,
  RawDatabaseObjectType,
  RawDatabaseTable,
  RawDatabaseTrigger,
  RawSqlBatchRequest,
  RawSqlExecuteRequest,
  RawSqlExecuteResponse,
  RawSqlStatement,
  RawSqlValue,
  RawTableDescription,
  RawTablePreviewRequest,
  RawTablePreviewResponse
} from "./icpdb-raw-types.js";

export function normalizeDatabaseTable(raw: RawDatabaseTable): DatabaseTable {
  return {
    name: raw.name,
    objectType: normalizeDatabaseObjectType(raw.object_type),
    schemaSql: raw.schema_sql[0] ?? null
  };
}

export function normalizeTableDescription(raw: RawTableDescription): TableDescription {
  return {
    databaseId: raw.database_id,
    tableName: raw.table_name,
    objectType: normalizeDatabaseObjectType(raw.object_type),
    schemaSql: raw.schema_sql[0] ?? null,
    columns: raw.columns.map(normalizeDatabaseColumn),
    indexes: raw.indexes.map(normalizeDatabaseIndex),
    triggers: raw.triggers.map(normalizeDatabaseTrigger),
    foreignKeys: raw.foreign_keys.map(normalizeDatabaseForeignKey)
  };
}

export function normalizeTablePreview(raw: RawTablePreviewResponse): TablePreviewResponse {
  return {
    databaseId: raw.database_id,
    tableName: raw.table_name,
    columns: raw.columns,
    rows: raw.rows.map((row) => row.map(normalizeSqlValue)),
    offset: raw.offset,
    limit: raw.limit,
    totalCount: raw.total_count.toString(),
    truncated: raw.truncated
  };
}

export function rawTablePreviewRequest(request: TablePreviewRequest): RawTablePreviewRequest {
  return {
    database_id: request.databaseId,
    table_name: request.tableName,
    limit: request.limit === null ? [] : [request.limit],
    offset: request.offset === null ? [] : [request.offset]
  };
}

export function rawSqlRequest(request: SqlExecuteRequest): RawSqlExecuteRequest {
  return {
    database_id: request.databaseId,
    sql: request.sql,
    params: request.params.map(rawSqlValue),
    max_rows: request.maxRows === null ? [] : [request.maxRows],
    idempotency_key: request.idempotencyKey === null || request.idempotencyKey === undefined ? [] : [request.idempotencyKey]
  };
}

export function rawSqlBatchRequest(request: SqlBatchRequest): RawSqlBatchRequest {
  return {
    database_id: request.databaseId,
    statements: request.statements.map(rawSqlStatement),
    max_rows: request.maxRows === null ? [] : [request.maxRows],
    idempotency_key: request.idempotencyKey === null || request.idempotencyKey === undefined ? [] : [request.idempotencyKey]
  };
}

export function normalizeSqlResponse(raw: RawSqlExecuteResponse): SqlExecuteResponse {
  return {
    columns: raw.columns,
    rows: raw.rows.map((row) => row.map(normalizeSqlValue)),
    rowsAffected: raw.rows_affected.toString(),
    lastInsertRowId: raw.last_insert_rowid.toString(),
    truncated: raw.truncated,
    routedOperationId: raw.routed_operation_id[0] ?? null
  };
}

function normalizeDatabaseColumn(raw: RawDatabaseColumn): DatabaseColumn {
  return {
    cid: raw.cid,
    name: raw.name,
    declaredType: raw.declared_type,
    notNull: raw.not_null,
    defaultValue: raw.default_value[0] ?? null,
    primaryKeyPosition: raw.primary_key_position,
    hidden: raw.hidden
  };
}

function normalizeDatabaseIndex(raw: RawDatabaseIndex): DatabaseIndex {
  return {
    name: raw.name,
    tableName: raw.table_name,
    unique: raw.unique,
    origin: raw.origin,
    partial: raw.partial,
    columns: raw.columns.map(normalizeDatabaseIndexColumn),
    schemaSql: raw.schema_sql[0] ?? null
  };
}

function normalizeDatabaseIndexColumn(raw: RawDatabaseIndexColumn): DatabaseIndexColumn {
  return {
    seqno: raw.seqno,
    cid: raw.cid.toString(),
    name: raw.name[0] ?? null,
    descending: raw.descending,
    collation: raw.collation,
    key: raw.key
  };
}

function normalizeDatabaseTrigger(raw: RawDatabaseTrigger): DatabaseTrigger {
  return {
    name: raw.name,
    tableName: raw.table_name,
    schemaSql: raw.schema_sql[0] ?? null
  };
}

function normalizeDatabaseForeignKey(raw: RawDatabaseForeignKey): DatabaseForeignKey {
  return {
    id: raw.id,
    seq: raw.seq,
    tableName: raw.table_name,
    fromColumn: raw.from_column,
    toColumn: raw.to_column[0] ?? null,
    onUpdate: raw.on_update,
    onDelete: raw.on_delete,
    matchClause: raw.match_clause
  };
}

function normalizeDatabaseObjectType(value: RawDatabaseObjectType): DatabaseObjectType {
  return "View" in value ? "view" : "table";
}

function rawSqlStatement(statement: SqlStatement): RawSqlStatement {
  return {
    sql: statement.sql,
    params: statement.params.map(rawSqlValue)
  };
}

function rawSqlValue(value: SqlValue): RawSqlValue {
  if (value.kind === "null") return { Null: null };
  if (value.kind === "integer") return { Integer: BigInt(value.value) };
  if (value.kind === "real") return { Real: value.value };
  if (value.kind === "text") return { Text: value.value };
  return { Blob: value.value };
}

function normalizeSqlValue(value: RawSqlValue): SqlValue {
  if ("Null" in value) return { kind: "null" };
  if ("Integer" in value) return { kind: "integer", value: value.Integer.toString() };
  if ("Real" in value) return { kind: "real", value: value.Real };
  if ("Text" in value) return { kind: "text", value: value.Text };
  return { kind: "blob", value: value.Blob };
}
