// Where: scripts/icpdb-http-csv-output.mjs
// What: CSV output formatting for SQL, inspect, schema, and account records.
// Why: CSV export behavior should be isolated from interactive shell/table display rendering.

import { escapeCsvField, formatCsvRecords, formatCsvRows, sqlScalarRecord, sqlValueToDisplay } from "./icpdb-http-table-format.mjs";

export function formatCsvOutput(value, shapes) {
  if (value === null) return "";
  if (shapes.isSqlScalarResult(value)) return formatCsvRecords([sqlScalarRecord(value)]);
  if (shapes.isTablePreview(value) || shapes.isSqlResponse(value)) return formatSqlCsv(value);
  if (value && typeof value === "object" && value.table && value.preview) return formatSqlCsv(value.preview);
  if (value && typeof value === "object" && Array.isArray(value.schemas)) return formatSchemaCsv(value);
  if (value && typeof value === "object" && value.stats && Array.isArray(value.table_summaries)) return formatStatsCsv(value);
  if (shapes.isTableDescription(value)) return formatCsvRecords((value.columns ?? []).map(columnCsvRecord));
  if (shapes.isTableColumnsResult(value)) return formatCsvRecords(value.columns ?? []);
  if (shapes.isTableIndexesResult(value)) return formatCsvRecords((value.indexes ?? []).map(indexCsvRecord));
  if (shapes.isTableTriggersResult(value)) return formatCsvRecords((value.triggers ?? []).map(triggerRecord));
  if (shapes.isTableForeignKeysResult(value)) return formatCsvRecords((value.foreign_keys ?? []).map(foreignKeyCsvRecord));
  if (value && typeof value === "object" && Array.isArray(value.table_summaries)) return formatCsvRecords(value.table_summaries);
  if (Array.isArray(value)) return formatCsvRecords(value);
  if (value && typeof value === "object") return formatCsvRecords([value]);
  return escapeCsvField(String(value));
}

function formatSchemaCsv(value) {
  const rows = [];
  for (const schema of value.schemas ?? []) {
    if (schema.schema_sql) rows.push(schemaCsvRecord(schema, "table", schema.schema_sql));
    for (const schemaSql of schema.index_schemas ?? []) {
      rows.push(schemaCsvRecord(schema, "index", schemaSql));
    }
    for (const schemaSql of schema.trigger_schemas ?? []) {
      rows.push(schemaCsvRecord(schema, "trigger", schemaSql));
    }
  }
  return formatCsvRecords(rows);
}

function schemaCsvRecord(schema, kind, schemaSql) {
  return {
    table_name: schema.table_name,
    object_type: schema.object_type ?? "table",
    schema_sql_kind: kind,
    schema_sql: schemaSql
  };
}

function formatStatsCsv(value) {
  const rows = [
    {
      section: "database",
      name: value.database_id,
      type: "",
      rows: value.stats.row_count,
      tables: value.stats.table_count,
      views: value.stats.view_count,
      columns: value.stats.column_count,
      indexes: value.stats.index_count,
      triggers: value.stats.trigger_count,
      foreign_keys: value.stats.foreign_key_count,
      column_names: ""
    },
    ...value.table_summaries.map((table) => ({
      section: "table",
      name: table.table_name,
      type: table.object_type ?? "table",
      rows: table.row_count,
      tables: "",
      views: "",
      columns: table.column_count ?? (table.columns ?? []).length,
      indexes: table.index_count ?? "",
      triggers: table.trigger_count ?? "",
      foreign_keys: table.foreign_key_count ?? "",
      column_names: (table.columns ?? []).join(", ")
    }))
  ];
  return formatCsvRecords(rows);
}

function formatSqlCsv(response) {
  const columns = response.columns ?? [];
  const rows = response.rows ?? [];
  return formatCsvRows(columns, rows.map((row) => row.map(sqlValueToDisplay)));
}

function columnCsvRecord(column) {
  return {
    name: column.name,
    type: column.declared_type || "dynamic",
    null: column.not_null ? "no" : "yes",
    pk: column.primary_key_position > 0 ? String(column.primary_key_position) : "",
    default: column.default_value ?? "",
    hidden: column.hidden ?? 0
  };
}

function indexCsvRecord(index) {
  return {
    name: index.name,
    columns: indexColumnsLabel(index),
    unique: index.unique ? "yes" : "no",
    origin: index.origin,
    partial: index.partial ? "yes" : "no",
    schema_sql: index.schema_sql ?? ""
  };
}

function foreignKeyCsvRecord(key) {
  return {
    group: key.id,
    seq: key.seq,
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
