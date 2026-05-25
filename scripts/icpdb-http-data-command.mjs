// Where: scripts/icpdb-http-data-command.mjs
// What: SQL, shell, table, schema, dump, and load command builders for the ICPDB HTTP CLI.
// Why: Turso-like data commands need a focused parser surface.

import {
  idempotencyKeyOption,
  outputFormatOption,
  parseSqlStatementsJson,
  requiredArg
} from "./icpdb-http-command-utils.mjs";

export function buildDataCommand(command, databaseId, tableNameOrSql, rest, options, auth) {
  const { baseUrl, token } = auth;
  if (command === "tables") return http(baseUrl, token, "/v1/tables/list", { database_id: requiredArg(databaseId, "database_id") }, options);
  if (command === "views") return dataFlag("databaseViews", baseUrl, token, databaseId, options);
  if (command === "stats") return dataFlag("stats", baseUrl, token, databaseId, options);
  if (command === "describe") {
    return http(baseUrl, token, "/v1/tables/describe", {
      database_id: requiredArg(databaseId, "database_id"),
      table_name: requiredArg(tableNameOrSql, "table_name")
    }, options);
  }
  if (command === "preview") {
    return http(baseUrl, token, "/v1/tables/preview", {
      database_id: requiredArg(databaseId, "database_id"),
      table_name: requiredArg(tableNameOrSql, "table_name"),
      limit: options.limit,
      offset: options.offset
    }, options);
  }
  if (command === "columns") return tableFlag("tableColumns", baseUrl, token, databaseId, tableNameOrSql, options);
  if (command === "indexes") return tableFlag("tableIndexes", baseUrl, token, databaseId, tableNameOrSql, options);
  if (command === "triggers") return tableFlag("tableTriggers", baseUrl, token, databaseId, tableNameOrSql, options);
  if (command === "foreign-keys") return tableFlag("tableForeignKeys", baseUrl, token, databaseId, tableNameOrSql, options);
  if (command === "inspect") {
    return {
      inspect: true,
      baseUrl,
      token,
      databaseId: requiredArg(databaseId, "database_id"),
      tableName: tableNameOrSql ?? null,
      includeAccess: options.includeAccess,
      limit: options.limit,
      offset: options.offset,
      ...outputFormatOption(options)
    };
  }
  if (command === "schema") return optionalTableFlag("schema", baseUrl, token, databaseId, tableNameOrSql, options);
  if (command === "dump") return { dump: true, baseUrl, token, databaseId: requiredArg(databaseId, "database_id"), tableName: tableNameOrSql ?? null, limit: options.limit };
  if (command === "load") {
    return {
      load: true,
      baseUrl,
      token,
      databaseId: requiredArg(databaseId, "database_id"),
      filePath: requiredArg(tableNameOrSql, "file"),
      maxRows: options.maxRows,
      ...idempotencyKeyOption(options),
      ...outputFormatOption(options)
    };
  }
  if (command === "query" || command === "execute") {
    const sql = [requiredArg(tableNameOrSql, "sql"), ...rest].join(" ");
    return {
      baseUrl,
      token,
      endpoint: command === "query" ? "/v1/sql/query" : "/v1/sql/execute",
      body: { database_id: requiredArg(databaseId, "database_id"), sql, params: options.params, max_rows: options.maxRows },
      ...idempotencyKeyOption(options),
      ...outputFormatOption(options)
    };
  }
  if (command === "batch") {
    const statements = options.statements.length > 0
      ? options.statements
      : parseSqlStatementsJson(requiredArg(tableNameOrSql, "statements_json"));
    return {
      baseUrl,
      token,
      endpoint: "/v1/sql/batch",
      body: { database_id: requiredArg(databaseId, "database_id"), statements, max_rows: options.maxRows },
      ...idempotencyKeyOption(options),
      ...outputFormatOption(options)
    };
  }
  if (command === "shell") {
    return {
      shell: true,
      baseUrl,
      token,
      databaseId: requiredArg(databaseId, "database_id"),
      maxRows: options.maxRows,
      shellSql: tableNameOrSql ? [tableNameOrSql, ...rest].join(" ") : null,
      ...(options.idempotencyKey ? { idempotencyKeyPrefix: options.idempotencyKey } : {}),
      ...outputFormatOption(options)
    };
  }
  return null;
}

function http(baseUrl, token, endpoint, body, options) {
  return { baseUrl, token, endpoint, body, ...outputFormatOption(options) };
}

function dataFlag(flag, baseUrl, token, databaseId, options) {
  return { [flag]: true, baseUrl, token, databaseId: requiredArg(databaseId, "database_id"), ...outputFormatOption(options) };
}

function tableFlag(flag, baseUrl, token, databaseId, tableName, options) {
  return { ...dataFlag(flag, baseUrl, token, databaseId, options), tableName: requiredArg(tableName, "table_name") };
}

function optionalTableFlag(flag, baseUrl, token, databaseId, tableName, options) {
  return { ...dataFlag(flag, baseUrl, token, databaseId, options), tableName: tableName ?? null };
}
