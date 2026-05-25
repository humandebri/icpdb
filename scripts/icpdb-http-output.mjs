// Where: scripts/icpdb-http-output.mjs
// What: High-level human and CSV output formatting for the ICPDB HTTP CLI.
// Why: Turso-like shell and inspect output should be maintained separately from command execution.

import {
  formatCreatedDatabase,
  formatCreatedToken,
  formatDatabaseAccess,
  formatMemberList,
  formatPaymentList,
  formatTokenList,
  formatUsageEventSummaries
} from "./icpdb-http-account-output.mjs";
import { formatCsvOutput } from "./icpdb-http-csv-output.mjs";
import {
  formatTableColumnsResult,
  formatTableDescription,
  formatTableForeignKeysResult,
  formatTableIndexesResult,
  formatTableTriggersResult
} from "./icpdb-http-schema-output.mjs";
import { formatRecordTable, formatTable, sqlValueToDisplay } from "./icpdb-http-table-format.mjs";

export function formatCliOutput(value, command = {}, defaultFormat = "json") {
  const outputFormat = command.outputFormat ?? defaultFormat;
  if (outputFormat === "json") {
    return JSON.stringify(value, null, 2);
  }
  if (outputFormat === "csv") {
    return formatCsvOutput(value, outputShapes);
  }
  if (command.createDatabase && isCreatedDatabase(value)) {
    return formatCreatedDatabase(value);
  }
  if (command.endpoint === "/v1/tokens/create" && isCreatedToken(value)) {
    return formatCreatedToken(value);
  }
  if (command.endpoint === "/v1/tokens/list" && Array.isArray(value)) {
    return formatTokenList(value);
  }
  if (command.endpoint === "/v1/members/list" && Array.isArray(value)) {
    return formatMemberList(value);
  }
  if (command.endpoint === "/v1/payments/list" && Array.isArray(value)) {
    return formatPaymentList(value);
  }
  return formatHumanOutput(value);
}

export function schemaEntry(description) {
  return {
    table_name: description.table_name,
    object_type: (description.object_type ?? "table").toLowerCase() === "view" ? "view" : "table",
    schema_sql: description.schema_sql ?? "",
    index_schemas: (description.indexes ?? [])
      .map((index) => index.schema_sql ?? "")
      .filter((schemaSql) => schemaSql.length > 0),
    trigger_schemas: (description.triggers ?? [])
      .map((trigger) => trigger.schema_sql ?? "")
      .filter((schemaSql) => schemaSql.length > 0)
  };
}

function formatHumanOutput(value) {
  if (value === null) return "OK";
  if (Array.isArray(value)) {
    return isUsageEventSummaries(value) ? formatUsageEventSummaries(value) : formatRecordTable(value);
  }
  if (isTablePreview(value)) return formatTablePreview(value);
  if (isSqlResponse(value)) return formatSqlResponse(value);
  if (isTableColumnsResult(value)) return formatTableColumnsResult(value);
  if (isTableDescription(value)) return formatTableDescription(value);
  if (isTableIndexesResult(value)) return formatTableIndexesResult(value);
  if (isTableTriggersResult(value)) return formatTableTriggersResult(value);
  if (isTableForeignKeysResult(value)) return formatTableForeignKeysResult(value);
  if (isSchemaResult(value)) return formatSchemaResult(value);
  if (value && typeof value === "object") {
    if (Array.isArray(value.tables)) {
      const placement = value.placement ? ["placement", formatRecordTable([value.placement])] : [];
      const account = value.usage || value.billing ? ["account", formatDatabaseAccount(value.usage, value.billing)] : [];
      const usageEvents = Array.isArray(value.usage_events) && value.usage_events.length > 0
        ? ["usage events", formatUsageEventSummaries(value.usage_events)]
        : [];
      const access = value.access ? ["access", formatDatabaseAccess(value.access)] : [];
      const summary = Array.isArray(value.table_summaries)
        ? ["table summary", formatRecordTable(value.table_summaries.map(tableSummaryRecord))]
        : [];
      return [`database ${value.database_id}`, ...placement, ...account, ...usageEvents, ...access, ...summary, ...value.tables.map(formatTableDescription)].join("\n\n");
    }
    if (value.stats && Array.isArray(value.table_summaries)) return formatStatsResult(value);
    if (value.table && value.preview) {
      return [formatTableDescription(value.table), "preview", formatTablePreview(value.preview)].join("\n\n");
    }
    return formatRecordTable([value]);
  }
  return String(value);
}

function isSqlResponse(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.columns) && Array.isArray(value.rows));
}

function isTablePreview(value) {
  return isSqlResponse(value) && typeof value.table_name === "string";
}

function isTableDescription(value) {
  return Boolean(value && typeof value === "object" && typeof value.table_name === "string" && Array.isArray(value.columns));
}

function isTableColumnsResult(value) {
  return Boolean(value && typeof value === "object" && typeof value.table_name === "string" && typeof value.column_count === "number" && Array.isArray(value.columns));
}

function isTableIndexesResult(value) {
  return Boolean(value && typeof value === "object" && typeof value.table_name === "string" && Array.isArray(value.indexes));
}

function isTableTriggersResult(value) {
  return Boolean(value && typeof value === "object" && typeof value.table_name === "string" && Array.isArray(value.triggers));
}

function isTableForeignKeysResult(value) {
  return Boolean(value && typeof value === "object" && typeof value.table_name === "string" && Array.isArray(value.foreign_keys));
}

const outputShapes = {
  isSqlResponse,
  isTableColumnsResult,
  isTableDescription,
  isTableForeignKeysResult,
  isTableIndexesResult,
  isTablePreview,
  isTableTriggersResult
};

function isSchemaResult(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.schemas));
}

function isCreatedDatabase(value) {
  return Boolean(value && typeof value === "object" && typeof value.database_id === "string" && value.owner_token);
}

function isCreatedToken(value) {
  return Boolean(value && typeof value === "object" && typeof value.token === "string" && value.info);
}

function isUsageEventSummaries(value) {
  return value.every((event) =>
    event &&
    typeof event === "object" &&
    typeof event.method === "string" &&
    Object.hasOwn(event, "event_count") &&
    Object.hasOwn(event, "total_cycles_delta")
  );
}

function formatSchemaResult(result) {
  const schemas = result.schemas ?? [];
  if (schemas.length === 0) return `database ${result.database_id}\n(no schema SQL)`;
  return [
    `database ${result.database_id}`,
    ...schemas.map((schema) => [
      `${schema.object_type === "view" ? "view" : "table"} ${schema.table_name}`,
      schema.schema_sql || "(no schema SQL)",
      ...(schema.index_schemas ?? []),
      ...(schema.trigger_schemas ?? [])
    ].join("\n"))
  ].join("\n\n");
}

function formatSqlResponse(response) {
  const rows = response.rows ?? [];
  const table = rows.length > 0
    ? formatTable(response.columns, rows.map((row) => row.map(sqlValueToDisplay)))
    : "(no rows)";
  const footer = `${rows.length} row${rows.length === 1 ? "" : "s"}; affected ${response.rows_affected ?? 0}`;
  return `${table}\n${footer}${response.truncated ? " (truncated)" : ""}`;
}

function formatTablePreview(preview) {
  const total = preview.total_count ?? preview.rows?.length ?? 0;
  return `${preview.table_name} (${total} rows; ${formatTablePreviewPage(preview)})\n${formatSqlResponse(preview)}`;
}

function formatTablePreviewPage(preview) {
  const rows = preview.rows ?? [];
  const offset = nonNegativeNumber(preview.offset, 0);
  const limit = nonNegativeNumber(preview.limit, rows.length);
  const range = rows.length === 0 ? "showing 0" : `showing ${offset + 1}-${offset + rows.length}`;
  return `${range}; limit ${limit}; offset ${offset}; next ${formatTablePreviewNextOffset(preview, offset, rows.length)}`;
}

function formatTablePreviewNextOffset(preview, offset, shown) {
  const nextOffset = offset + shown;
  const total = preview.total_count;
  if (total === undefined || total === null) return shown === 0 ? "-" : String(nextOffset);
  return BigInt(nextOffset) < BigInt(String(total)) ? String(nextOffset) : "-";
}

function nonNegativeNumber(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function formatStatsResult(value) {
  return [
    `database ${value.database_id}`,
    "summary",
    formatRecordTable([value.stats]),
    "table summary",
    formatRecordTable(value.table_summaries.map(tableSummaryRecord))
  ].join("\n\n");
}

function tableSummaryRecord(table) {
  return {
    table: table.table_name,
    type: table.object_type ?? "table",
    rows: table.row_count,
    columns: table.column_count ?? (table.columns ?? []).length,
    indexes: table.index_count ?? "",
    triggers: table.trigger_count ?? "",
    foreign_keys: table.foreign_key_count ?? "",
    column_names: (table.columns ?? []).join(", ")
  };
}

function formatDatabaseAccount(usage, billing) {
  return formatRecordTable([
    {
      status: usage?.status ?? "",
      logical_size_bytes: usage?.logical_size_bytes ?? "",
      max_logical_size_bytes: usage?.max_logical_size_bytes ?? "",
      usage_events: usage?.usage_event_count ?? "",
      billing_status: billing?.status ?? "",
      balance_units: billing?.balance_units ?? "",
      spent_units: billing?.spent_units ?? ""
    }
  ]);
}
