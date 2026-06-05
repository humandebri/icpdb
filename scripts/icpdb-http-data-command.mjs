// Where: scripts/icpdb-http-data-command.mjs
// What: SQL, shell, table, schema, dump, and load command builders for the ICPDB HTTP CLI.
// Why: Turso-like data commands need a focused parser surface.

import {
  databaseIdArg,
  filePathArg,
  idempotencyKeyOption,
  isReadSql,
  outputFormatOption,
  optionalTableNameArg,
  parseSqlStatementsJson,
  requiredArg,
  sqlParams,
  tableNameArg
} from "./icpdb-http-command-utils.mjs";

export function buildDataCommand(command, databaseId, tableNameOrSql, rest, options, auth) {
  const { baseUrl, token } = auth;
  if (command === "tables") return http(baseUrl, token, "/v1/tables/list", { database_id: databaseIdArg(databaseId) }, options);
  if (command === "views") return dataFlag("databaseViews", baseUrl, token, databaseId, options);
  if (command === "stats") return dataFlag("stats", baseUrl, token, databaseId, options);
  if (command === "describe") {
    return http(baseUrl, token, "/v1/tables/describe", {
      database_id: databaseIdArg(databaseId),
      table_name: tableNameArg(tableNameOrSql)
    }, options);
  }
  if (command === "preview") {
    return http(baseUrl, token, "/v1/tables/preview", {
      database_id: databaseIdArg(databaseId),
      table_name: tableNameArg(tableNameOrSql),
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
      databaseId: databaseIdArg(databaseId),
      tableName: optionalTableNameArg(tableNameOrSql),
      includeAccess: options.includeAccess,
      limit: options.limit,
      offset: options.offset,
      ...outputFormatOption(options)
    };
  }
  if (command === "schema") return optionalTableFlag("schema", baseUrl, token, databaseId, tableNameOrSql, options);
  if (command === "dump") return { dump: true, baseUrl, token, databaseId: databaseIdArg(databaseId), tableName: optionalTableNameArg(tableNameOrSql), limit: options.limit };
  if (command === "load") {
    assertReadFileModeOptions(options, "load");
    return {
      load: true,
      baseUrl,
      token,
      databaseId: databaseIdArg(databaseId),
      filePath: filePathArg(tableNameOrSql),
      ...(options.batchMode === "read" ? { batchMode: "read" } : {}),
      maxRows: options.maxRows,
      ...(options.batchMode === "write" ? idempotencyKeyOption(options) : {}),
      ...outputFormatOption(options)
    };
  }
  if (command === "script") {
    assertReadFileModeOptions(options, "script");
    return {
      script: true,
      baseUrl,
      token,
      databaseId: databaseIdArg(databaseId),
      filePath: filePathArg(tableNameOrSql),
      ...(options.batchMode === "read" ? { batchMode: "read" } : {}),
      maxRows: options.maxRows,
      ...(options.batchMode === "write" ? idempotencyKeyOption(options) : {}),
      ...outputFormatOption(options)
    };
  }
  if (command === "migrate") {
    return {
      migrate: true,
      baseUrl,
      token,
      databaseId: databaseIdArg(databaseId),
      filePath: filePathArg(tableNameOrSql),
      maxRows: options.maxRows,
      ...idempotencyKeyOption(options),
      ...outputFormatOption(options)
    };
  }
  if (command === "query" || command === "execute" || command === "scalar") {
    const sql = [requiredArg(tableNameOrSql, "sql"), ...rest].join(" ");
    if ((command === "query" || command === "scalar") && options.idempotencyKey) throw new Error("--idempotency-key is only valid for write SQL");
    return {
      baseUrl,
      token,
      endpoint: command === "execute" ? "/v1/sql/execute" : "/v1/sql/query",
      body: { database_id: databaseIdArg(databaseId), sql, params: sqlParams(sql, options.params), max_rows: command === "scalar" ? 1 : options.maxRows },
      ...(command === "scalar" ? { scalar: true } : {}),
      ...(command === "execute" ? idempotencyKeyOption(options) : {}),
      ...outputFormatOption(options)
    };
  }
  if (command === "batch") {
    const statements = options.statements.length > 0
      ? options.statements
      : parseSqlStatementsJson(requiredArg(tableNameOrSql, "statements_json"));
    if (options.batchMode === "read") {
      assertReadBatchOptions(statements, options);
      return {
        readBatch: true,
        baseUrl,
        token,
        databaseId: databaseIdArg(databaseId),
        statements: sqlBatchStatements(statements),
        maxRows: options.maxRows,
        ...outputFormatOption(options)
      };
    }
    return {
      baseUrl,
      token,
      endpoint: "/v1/sql/batch",
      body: { database_id: databaseIdArg(databaseId), statements: sqlBatchStatements(statements), max_rows: options.maxRows },
      ...idempotencyKeyOption(options),
      ...outputFormatOption(options)
    };
  }
  if (command === "shell") {
    return {
      shell: true,
      baseUrl,
      token,
      databaseId: databaseIdArg(databaseId),
      maxRows: options.maxRows,
      shellSql: tableNameOrSql ? [tableNameOrSql, ...rest].join(" ") : null,
      ...(options.idempotencyKey ? { idempotencyKeyPrefix: options.idempotencyKey } : {}),
      ...(options.waitForRoutedOperation ? { waitForRoutedOperation: true } : {}),
      ...outputFormatOption(options)
    };
  }
  return null;
}

function assertReadBatchOptions(statements, options) {
  if (options.idempotencyKey) throw new Error("--idempotency-key is only valid for write batch");
  if (options.waitForRoutedOperation) throw new Error("--wait is only valid for write batch");
  statements.forEach((statement, index) => {
    if (!isReadSql(statement.sql)) {
      throw new Error(`read batch statement ${index + 1} is not read-only`);
    }
  });
}

function assertReadFileModeOptions(options, label) {
  if (options.batchMode !== "read") return;
  if (options.idempotencyKey) throw new Error(`--idempotency-key is only valid for write ${label}`);
  if (options.waitForRoutedOperation) throw new Error(`--wait is only valid for write ${label}`);
}

function sqlBatchStatements(statements) {
  return statements.map((statement) => ({
    ...statement,
    params: sqlParams(statement.sql, statement.params ?? [])
  }));
}

function http(baseUrl, token, endpoint, body, options) {
  return { baseUrl, token, endpoint, body, ...outputFormatOption(options) };
}

function dataFlag(flag, baseUrl, token, databaseId, options) {
  return { [flag]: true, baseUrl, token, databaseId: databaseIdArg(databaseId), ...outputFormatOption(options) };
}

function tableFlag(flag, baseUrl, token, databaseId, tableName, options) {
  return { ...dataFlag(flag, baseUrl, token, databaseId, options), tableName: tableNameArg(tableName) };
}

function optionalTableFlag(flag, baseUrl, token, databaseId, tableName, options) {
  return { ...dataFlag(flag, baseUrl, token, databaseId, options), tableName: optionalTableNameArg(tableName) };
}
