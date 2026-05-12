export const expectedTypes = {
  CanisterHealth: { kind: "record", fields: { cycles_balance: "nat" } },
  DatabaseRole: { kind: "variant", cases: { Reader: "null", Writer: "null", Owner: "null" } },
  DatabaseStatus: { kind: "variant", cases: { Hot: "null", Restoring: "null", Archiving: "null", Archived: "null", Deleted: "null" } },
  DatabaseSummary: {
    kind: "record",
    fields: {
      status: "DatabaseStatus",
      role: "DatabaseRole",
      logical_size_bytes: "nat64",
      database_id: "text",
      archived_at_ms: "opt int64",
      deleted_at_ms: "opt int64"
    }
  },
  DatabaseBillingStatus: { kind: "variant", cases: { Active: "null", Suspended: "null" } },
  DatabaseBilling: {
    kind: "record",
    fields: {
      status: "DatabaseBillingStatus",
      spent_units: "nat64",
      usage_event_count: "nat64",
      database_id: "text",
      balance_units: "nat64"
    }
  },
  DepositQuote: {
    kind: "record",
    fields: {
      spender_principal: "text",
      amount_e8s: "nat64",
      credited_units: "nat64",
      database_id: "text",
      ledger_canister_id: "text",
      expected_fee_e8s: "nat64"
    }
  },
  DepositResult: {
    kind: "record",
    fields: {
      block_index: "nat64",
      amount_e8s: "nat64",
      credited_units: "nat64",
      database_id: "text",
      balance_units: "nat64"
    }
  },
  PaymentRecord: {
    kind: "record",
    fields: {
      block_index: "nat64",
      created_at_ms: "int64",
      amount_e8s: "nat64",
      credited_units: "nat64",
      database_id: "text",
      payer_principal: "text",
      payment_id: "text"
    }
  },
  DatabaseTokenScope: { kind: "variant", cases: { Read: "null", Write: "null" } },
  DatabaseTokenInfo: {
    kind: "record",
    fields: {
      last_used_at_ms: "opt int64",
      token_id: "text",
      name: "text",
      scope: "DatabaseTokenScope",
      created_at_ms: "int64",
      database_id: "text",
      revoked_at_ms: "opt int64"
    }
  },
  CreateDatabaseTokenRequest: {
    kind: "record",
    fields: { name: "text", scope: "DatabaseTokenScope", database_id: "text" }
  },
  CreateDatabaseTokenResponse: {
    kind: "record",
    fields: { token: "text", info: "DatabaseTokenInfo" }
  },
  DatabaseUsage: {
    kind: "record",
    fields: {
      status: "DatabaseStatus",
      max_logical_size_bytes: "nat64",
      logical_size_bytes: "nat64",
      usage_event_count: "nat64",
      database_id: "text"
    }
  },
  SqlValue: {
    kind: "variant",
    cases: {
      Blob: "blob",
      Null: "null",
      Real: "float64",
      Text: "text",
      Integer: "int64"
    }
  },
  SqlStatement: { kind: "record", fields: { sql: "text", params: "vec SqlValue" } },
  SqlBatchRequest: {
    kind: "record",
    fields: {
      max_rows: "opt nat32",
      database_id: "text",
      statements: "vec SqlStatement"
    }
  },
  SqlExecuteRequest: {
    kind: "record",
    fields: {
      sql: "text",
      max_rows: "opt nat32",
      database_id: "text",
      params: "vec SqlValue"
    }
  },
  SqlExecuteResponse: {
    kind: "record",
    fields: {
      truncated: "bool",
      rows: "vec vec SqlValue",
      rows_affected: "nat64",
      last_insert_rowid: "int64",
      columns: "vec text"
    }
  },
  ResultSql: { kind: "variant", cases: { Ok: "SqlExecuteResponse", Err: "text" } },
  ResultSqlBatch: { kind: "variant", cases: { Ok: "vec SqlExecuteResponse", Err: "text" } },
  ResultCreateDatabase: { kind: "variant", cases: { Ok: "text", Err: "text" } },
  ResultDatabases: { kind: "variant", cases: { Ok: "vec DatabaseSummary", Err: "text" } },
  ResultUsage: { kind: "variant", cases: { Ok: "DatabaseUsage", Err: "text" } },
  ResultBilling: { kind: "variant", cases: { Ok: "DatabaseBilling", Err: "text" } },
  ResultDepositQuote: { kind: "variant", cases: { Ok: "DepositQuote", Err: "text" } },
  ResultDeposit: { kind: "variant", cases: { Ok: "DepositResult", Err: "text" } },
  ResultPayments: { kind: "variant", cases: { Ok: "vec PaymentRecord", Err: "text" } },
  ResultTokens: { kind: "variant", cases: { Ok: "vec DatabaseTokenInfo", Err: "text" } },
  ResultCreateToken: { kind: "variant", cases: { Ok: "CreateDatabaseTokenResponse", Err: "text" } }
};

export const didTypeAliases = {
  ResultCreateDatabase: "Result_2",
  ResultCreateToken: "Result_3",
  ResultDeposit: "Result_4",
  ResultBilling: "Result_5",
  ResultDepositQuote: "Result_6",
  ResultUsage: "Result_7",
  ResultTokens: "Result_9",
  ResultDatabases: "Result_10",
  ResultPayments: "Result_11",
  ResultSqlBatch: "Result_14",
  ResultSql: "Result_15"
};

export const expectedMethods = {
  canister_health: { input: [], output: "CanisterHealth", mode: "query" },
  create_database: { input: [], output: "ResultCreateDatabase", mode: "update" },
  create_database_token: { input: ["CreateDatabaseTokenRequest"], output: "ResultCreateToken", mode: "update" },
  deposit_with_approval: { input: ["text", "nat64"], output: "ResultDeposit", mode: "update" },
  get_billing: { input: ["text"], output: "ResultBilling", mode: "query" },
  get_deposit_quote: { input: ["text", "nat64"], output: "ResultDepositQuote", mode: "update" },
  get_usage: { input: ["text"], output: "ResultUsage", mode: "query" },
  list_databases: { input: [], output: "ResultDatabases", mode: "query" },
  list_database_tokens: { input: ["text"], output: "ResultTokens", mode: "query" },
  list_payments: { input: ["text"], output: "ResultPayments", mode: "query" },
  sql_batch: { input: ["SqlBatchRequest"], output: "ResultSqlBatch", mode: "update" },
  sql_execute: { input: ["SqlExecuteRequest"], output: "ResultSql", mode: "update" },
  sql_query: { input: ["SqlExecuteRequest"], output: "ResultSql", mode: "query" }
};
