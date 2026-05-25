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
  DatabaseShardPlacement: {
    kind: "record",
    fields: {
      status: "DatabaseStatus",
      shard_id: "text",
      updated_at_ms: "int64",
      database_id: "text",
      created_at_ms: "int64",
      schema_version: "text",
      canister_id: "opt text",
      mount_id: "opt nat16"
    }
  },
  RoutedOperationStatus: { kind: "variant", cases: { Applied: "null", Failed: "null", Unknown: "null", Pending: "null" } },
  RoutedOperationInfo: {
    kind: "record",
    fields: {
      request_hash: "blob",
      status: "RoutedOperationStatus",
      method: "text",
      database_canister_id: "text",
      updated_at_ms: "int64",
      operation_id: "text",
      error: "opt text",
      created_at_ms: "int64",
      database_id: "text"
    }
  },
  RoutedOperationRequest: {
    kind: "record",
    fields: {
      operation_id: "text",
      database_id: "text"
    }
  },
  ShardOperationInfo: {
    kind: "record",
    fields: {
      request_hash: "blob",
      status: "RoutedOperationStatus",
      operation_kind: "text",
      updated_at_ms: "int64",
      operation_id: "text",
      error: "opt text",
      created_at_ms: "int64",
      target: "opt text"
    }
  },
  ShardOperationReconcileRequest: {
    kind: "record",
    fields: {
      status: "RoutedOperationStatus",
      operation_id: "text",
      error: "opt text"
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
  DatabaseArchiveInfo: {
    kind: "record",
    fields: { size_bytes: "nat64", database_id: "text" }
  },
  DatabaseArchiveChunk: {
    kind: "record",
    fields: { bytes: "blob" }
  },
  DatabaseQuotaRequest: {
    kind: "record",
    fields: { max_logical_size_bytes: "nat64", database_id: "text" }
  },
  DatabaseMember: {
    kind: "record",
    fields: { principal: "text", role: "DatabaseRole", created_at_ms: "int64", database_id: "text" }
  },
  DatabaseRestoreChunkRequest: {
    kind: "record",
    fields: { offset: "nat64", database_id: "text", bytes: "blob" }
  },
  DatabaseColumn: {
    kind: "record",
    fields: {
      cid: "nat32",
      name: "text",
      primary_key_position: "nat32",
      declared_type: "text",
      default_value: "opt text",
      not_null: "bool",
      hidden: "nat32"
    }
  },
  DatabaseForeignKey: {
    kind: "record",
    fields: {
      id: "nat32",
      seq: "nat32",
      match_clause: "text",
      to_column: "opt text",
      table_name: "text",
      on_delete: "text",
      on_update: "text",
      from_column: "text"
    }
  },
  DatabaseIndex: {
    kind: "record",
    fields: {
      schema_sql: "opt text",
      name: "text",
      origin: "text",
      unique: "bool",
      table_name: "text",
      partial: "bool",
      columns: "vec DatabaseIndexColumn"
    }
  },
  DatabaseIndexColumn: {
    kind: "record",
    fields: {
      cid: "int64",
      key: "bool",
      descending: "bool",
      collation: "text",
      name: "opt text",
      seqno: "nat32"
    }
  },
  DatabaseTrigger: {
    kind: "record",
    fields: {
      schema_sql: "opt text",
      name: "text",
      table_name: "text"
    }
  },
  DatabaseObjectType: { kind: "variant", cases: { View: "null", Table: "null" } },
  DatabaseTable: {
    kind: "record",
    fields: {
      schema_sql: "opt text",
      name: "text",
      object_type: "DatabaseObjectType"
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
  DatabaseTokenScope: { kind: "variant", cases: { Read: "null", Write: "null", Owner: "null" } },
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
  DatabaseUsageEventSummary: {
    kind: "record",
    fields: {
      method: "text",
      operation: "opt text",
      success: "bool",
      total_cycles_delta: "nat64",
      total_rows_returned: "nat64",
      total_rows_affected: "nat64",
      event_count: "nat64",
      last_created_at_ms: "int64"
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
  TableDescription: {
    kind: "record",
    fields: {
      foreign_keys: "vec DatabaseForeignKey",
      schema_sql: "opt text",
      database_id: "text",
      object_type: "DatabaseObjectType",
      table_name: "text",
      indexes: "vec DatabaseIndex",
      columns: "vec DatabaseColumn",
      triggers: "vec DatabaseTrigger"
    }
  },
  TablePreviewRequest: {
    kind: "record",
    fields: {
      offset: "opt nat32",
      limit: "opt nat32",
      database_id: "text",
      table_name: "text"
    }
  },
  TablePreviewResponse: {
    kind: "record",
    fields: {
      truncated: "bool",
      rows: "vec vec SqlValue",
      offset: "nat32",
      limit: "nat32",
      database_id: "text",
      total_count: "nat64",
      table_name: "text",
      columns: "vec text"
    }
  },
  ResultSql: { kind: "variant", cases: { Ok: "SqlExecuteResponse", Err: "text" } },
  ResultUnit: { kind: "variant", cases: { Ok: "null", Err: "text" } },
  ResultArchiveInfo: { kind: "variant", cases: { Ok: "DatabaseArchiveInfo", Err: "text" } },
  ResultArchiveChunk: { kind: "variant", cases: { Ok: "DatabaseArchiveChunk", Err: "text" } },
  ResultSqlBatch: { kind: "variant", cases: { Ok: "vec SqlExecuteResponse", Err: "text" } },
  ResultCreateDatabase: { kind: "variant", cases: { Ok: "text", Err: "text" } },
  ResultDatabases: { kind: "variant", cases: { Ok: "vec DatabaseSummary", Err: "text" } },
  ResultUsage: { kind: "variant", cases: { Ok: "DatabaseUsage", Err: "text" } },
  ResultUsageEvents: { kind: "variant", cases: { Ok: "vec DatabaseUsageEventSummary", Err: "text" } },
  ResultBilling: { kind: "variant", cases: { Ok: "DatabaseBilling", Err: "text" } },
  ResultDepositQuote: { kind: "variant", cases: { Ok: "DepositQuote", Err: "text" } },
  ResultDeposit: { kind: "variant", cases: { Ok: "DepositResult", Err: "text" } },
  ResultPayments: { kind: "variant", cases: { Ok: "vec PaymentRecord", Err: "text" } },
  ResultTokens: { kind: "variant", cases: { Ok: "vec DatabaseTokenInfo", Err: "text" } },
  ResultShardPlacements: { kind: "variant", cases: { Ok: "vec DatabaseShardPlacement", Err: "text" } },
  ResultShardOperations: { kind: "variant", cases: { Ok: "vec ShardOperationInfo", Err: "text" } },
  ResultShardOperation: { kind: "variant", cases: { Ok: "ShardOperationInfo", Err: "text" } },
  ResultCreateToken: { kind: "variant", cases: { Ok: "CreateDatabaseTokenResponse", Err: "text" } },
  ResultMembers: { kind: "variant", cases: { Ok: "vec DatabaseMember", Err: "text" } },
  ResultRevokedToken: { kind: "variant", cases: { Ok: "DatabaseTokenInfo", Err: "text" } },
  ResultTables: { kind: "variant", cases: { Ok: "vec DatabaseTable", Err: "text" } },
  ResultTableDescription: { kind: "variant", cases: { Ok: "TableDescription", Err: "text" } },
  ResultTablePreview: { kind: "variant", cases: { Ok: "TablePreviewResponse", Err: "text" } }
};

export const didTypeAliases = {
  ResultArchiveInfo: "Result",
  ResultUnit: "Result_1",
  ResultCreateDatabase: "Result_2",
  ResultCreateToken: "Result_4",
  ResultDeposit: "Result_6",
  ResultTableDescription: "Result_7",
  ResultBilling: "Result_8",
  ResultDepositQuote: "Result_10",
  ResultRoutedOperation: "Result_11",
  ResultUsage: "Result_12",
  ResultUsageEvents: "Result_13",
  ResultShardPlacements: "Result_14",
  ResultMembers: "Result_15",
  ResultShardInfos: "Result_16",
  ResultTokens: "Result_17",
  ResultDatabases: "Result_18",
  ResultPayments: "Result_19",
  ResultShardOperations: "Result_20",
  ResultTables: "Result_21",
  ResultMaintenance: "Result_22",
  ResultShardPlacement: "Result_23",
  ResultTablePreview: "Result_24",
  ResultArchiveChunk: "Result_25",
  ResultShardOperation: "Result_26",
  ResultRevokedToken: "Result_27",
  ResultSqlBatch: "Result_28",
  ResultSql: "Result_29"
};

export const expectedMethods = {
  begin_database_archive: { input: ["text"], output: "ResultArchiveInfo", mode: "update" },
  begin_database_restore: { input: ["text", "blob", "nat64"], output: "ResultUnit", mode: "update" },
  cancel_database_archive: { input: ["text"], output: "ResultUnit", mode: "update" },
  canister_health: { input: [], output: "CanisterHealth", mode: "query" },
  create_database: { input: [], output: "ResultCreateDatabase", mode: "update" },
  create_database_token: { input: ["CreateDatabaseTokenRequest"], output: "ResultCreateToken", mode: "update" },
  delete_database: { input: ["text"], output: "ResultUnit", mode: "update" },
  deposit_with_approval: { input: ["text", "nat64"], output: "ResultDeposit", mode: "update" },
  describe_table: { input: ["text", "text"], output: "ResultTableDescription", mode: "query" },
  finalize_database_archive: { input: ["text", "blob"], output: "ResultUnit", mode: "update" },
  finalize_database_restore: { input: ["text"], output: "ResultUnit", mode: "update" },
  get_billing: { input: ["text"], output: "ResultBilling", mode: "query" },
  get_deposit_quote: { input: ["text", "nat64"], output: "ResultDepositQuote", mode: "update" },
  get_routed_operation: { input: ["RoutedOperationRequest"], output: "ResultRoutedOperation", mode: "query" },
  get_usage: { input: ["text"], output: "ResultUsage", mode: "query" },
  get_usage_event_summaries: { input: ["text"], output: "ResultUsageEvents", mode: "query" },
  grant_database_access: { input: ["text", "text", "DatabaseRole"], output: "ResultUnit", mode: "update" },
  list_database_members: { input: ["text"], output: "ResultMembers", mode: "query" },
  list_all_database_placements: { input: [], output: "ResultShardPlacements", mode: "query" },
  list_database_placements: { input: [], output: "ResultShardPlacements", mode: "query" },
  list_databases: { input: [], output: "ResultDatabases", mode: "query" },
  list_database_tokens: { input: ["text"], output: "ResultTokens", mode: "query" },
  list_payments: { input: ["text"], output: "ResultPayments", mode: "query" },
  list_shard_operations: { input: [], output: "ResultShardOperations", mode: "query" },
  list_tables: { input: ["text"], output: "ResultTables", mode: "query" },
  preview_table: { input: ["TablePreviewRequest"], output: "ResultTablePreview", mode: "query" },
  read_database_archive_chunk: { input: ["text", "nat64", "nat32"], output: "ResultArchiveChunk", mode: "query" },
  reconcile_routed_operation: { input: ["RoutedOperationRequest"], output: "ResultRoutedOperation", mode: "update" },
  reconcile_shard_operation: { input: ["ShardOperationReconcileRequest"], output: "ResultShardOperation", mode: "update" },
  revoke_database_access: { input: ["text", "text"], output: "ResultUnit", mode: "update" },
  revoke_database_token: { input: ["text", "text"], output: "ResultRevokedToken", mode: "update" },
  set_database_quota: { input: ["DatabaseQuotaRequest"], output: "ResultUsage", mode: "update" },
  sql_batch: { input: ["SqlBatchRequest"], output: "ResultSqlBatch", mode: "update" },
  sql_execute: { input: ["SqlExecuteRequest"], output: "ResultSql", mode: "update" },
  sql_query: { input: ["SqlExecuteRequest"], output: "ResultSql", mode: "query" },
  write_database_restore_chunk: { input: ["DatabaseRestoreChunkRequest"], output: "ResultUnit", mode: "update" }
};
