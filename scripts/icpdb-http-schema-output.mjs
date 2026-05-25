// Where: scripts/icpdb-http-schema-output.mjs
// What: Table schema and inspect metadata rendering for the ICPDB HTTP CLI.
// Why: Schema display grows with Supabase-style table browsing and should stay isolated.

import { formatRecordTable } from "./icpdb-http-table-format.mjs";

export function formatTableDescription(description) {
  const sections = [`table ${description.table_name}`];
  if (description.schema_sql) sections.push(description.schema_sql);
  sections.push("columns", formatRecordTable(description.columns.map(columnRecord)));
  if (description.indexes?.length) sections.push("indexes", formatRecordTable(description.indexes.map(indexRecord)));
  if (description.triggers?.length) sections.push("triggers", formatRecordTable(description.triggers.map(triggerRecord)));
  if (description.foreign_keys?.length) sections.push("foreign keys", formatRecordTable(description.foreign_keys.map(foreignKeyRecord)));
  return sections.join("\n");
}

export function formatTableColumnsResult(result) {
  return [`columns ${result.table_name} (${result.column_count})`, formatRecordTable((result.columns ?? []).map(columnDetailRecord))].join("\n");
}

export function formatTableIndexesResult(result) {
  return [`indexes ${result.table_name}`, formatRecordTable((result.indexes ?? []).map(indexRecord))].join("\n");
}

export function formatTableTriggersResult(result) {
  return [`triggers ${result.table_name}`, formatRecordTable((result.triggers ?? []).map(triggerRecord))].join("\n");
}

export function formatTableForeignKeysResult(result) {
  return [`foreign keys ${result.table_name}`, formatRecordTable((result.foreign_keys ?? []).map(foreignKeyRecord))].join("\n");
}

function columnRecord(column) {
  return {
    name: column.name,
    type: column.declared_type || "dynamic",
    null: column.not_null ? "no" : "yes",
    pk: column.primary_key_position > 0 ? String(column.primary_key_position) : ""
  };
}

function columnDetailRecord(column) {
  return {
    cid: column.cid ?? "",
    name: column.name,
    type: column.declared_type || "dynamic",
    null: column.not_null ? "no" : "yes",
    pk: column.primary_key_position > 0 ? String(column.primary_key_position) : "",
    default: column.default_value ?? "",
    hidden: column.hidden ?? 0
  };
}

function indexRecord(index) {
  return {
    name: index.name,
    columns: indexColumnsLabel(index),
    unique: index.unique ? "yes" : "no",
    origin: index.origin,
    partial: index.partial ? "yes" : "no",
    schema_sql: index.schema_sql ?? ""
  };
}

function indexColumnsLabel(index) {
  const columns = (index.columns ?? []).filter((column) => column.key);
  if (columns.length === 0) return "";
  return columns.map((column) => column.name ?? expressionIndexColumnLabel(column.cid)).join(", ");
}

function expressionIndexColumnLabel(cid) {
  const value = String(cid);
  if (value === "-1") return "rowid";
  if (value === "-2") return "expression";
  return `cid ${value}`;
}

function foreignKeyRecord(key) {
  return {
    group: key.id ?? "",
    seq: key.seq ?? "",
    from: key.from_column,
    references: `${key.table_name}.${key.to_column ?? ""}`,
    on_update: key.on_update,
    on_delete: key.on_delete,
    match: key.match_clause
  };
}

function triggerRecord(trigger) {
  return {
    name: trigger.name,
    table: trigger.table_name,
    schema_sql: trigger.schema_sql ?? ""
  };
}
