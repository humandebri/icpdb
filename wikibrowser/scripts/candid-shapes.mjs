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
  DatabaseMember: {
    kind: "record",
    fields: {
      principal: "text",
      role: "DatabaseRole",
      created_at_ms: "int64",
      database_id: "text"
    }
  },
  DatabaseQuotaRequest: {
    kind: "record",
    fields: { max_logical_size_bytes: "nat64", database_id: "text" }
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
  DatabaseBalanceTopUpRequest: {
    kind: "record",
    fields: { database_id: "text", units: "nat64" }
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
  CanonicalRole: {
    kind: "record",
    fields: { name: "text", path_pattern: "text", purpose: "text" }
  },
  ChildNode: {
    kind: "record",
    fields: {
      updated_at: "opt int64",
      etag: "opt text",
      kind: "NodeEntryKind",
      name: "text",
      size_bytes: "opt nat64",
      path: "text",
      has_children: "bool",
      is_virtual: "bool"
    }
  },
  ListChildrenRequest: { kind: "record", fields: { path: "text", database_id: "text" } },
  Node: {
    kind: "record",
    fields: {
      updated_at: "int64",
      content: "text",
      etag: "text",
      kind: "NodeKind",
      path: "text",
      created_at: "int64",
      metadata_json: "text"
    }
  },
  NodeEntryKind: { kind: "variant", cases: { File: "null", Source: "null", Directory: "null" } },
  NodeKind: { kind: "variant", cases: { File: "null", Source: "null" } },
  WriteNodeRequest: {
    kind: "record",
    fields: {
      content: "text",
      kind: "NodeKind",
      path: "text",
      expected_etag: "opt text",
      metadata_json: "text",
      database_id: "text"
    }
  },
  WriteNodeResult: {
    kind: "record",
    fields: { created: "bool", node: "RecentNodeHit" }
  },
  MemoryCapability: { kind: "record", fields: { name: "text", description: "text" } },
  MemoryManifest: {
    kind: "record",
    fields: {
      api_version: "text",
      budget_unit: "text",
      capabilities: "vec MemoryCapability",
      max_depth: "nat32",
      max_query_limit: "nat32",
      recommended_entrypoint: "text",
      write_policy: "text",
      canonical_roles: "vec CanonicalRole",
      purpose: "text",
      roots: "vec MemoryRoot"
    }
  },
  MemoryRoot: { kind: "record", fields: { kind: "text", path: "text" } },
  QueryContext: {
    kind: "record",
    fields: {
      truncated: "bool",
      task: "text",
      evidence: "vec SourceEvidence",
      nodes: "vec NodeContext",
      graph_links: "vec LinkEdge",
      search_hits: "vec SearchNodeHit",
      namespace: "text"
    }
  },
  QueryContextRequest: {
    kind: "record",
    fields: {
      task: "text",
      include_evidence: "bool",
      entities: "vec text",
      budget_tokens: "nat32",
      database_id: "text",
      depth: "nat32",
      namespace: "opt text"
    }
  },
  RecentNodeHit: {
    kind: "record",
    fields: { updated_at: "int64", etag: "text", kind: "NodeKind", path: "text" }
  },
  RecentNodesRequest: { kind: "record", fields: { path: "opt text", limit: "nat32", database_id: "text" } },
  GraphLinksRequest: { kind: "record", fields: { limit: "nat32", database_id: "text", prefix: "text" } },
  GraphNeighborhoodRequest: { kind: "record", fields: { center_path: "text", limit: "nat32", database_id: "text", depth: "nat32" } },
  IncomingLinksRequest: { kind: "record", fields: { path: "text", limit: "nat32", database_id: "text" } },
  NodeContextRequest: { kind: "record", fields: { link_limit: "nat32", path: "text", database_id: "text" } },
  OutgoingLinksRequest: { kind: "record", fields: { path: "text", limit: "nat32", database_id: "text" } },
  LinkEdge: {
    kind: "record",
    fields: {
      updated_at: "int64",
      link_kind: "text",
      link_text: "text",
      source_path: "text",
      raw_href: "text",
      target_path: "text"
    }
  },
  NodeContext: {
    kind: "record",
    fields: { incoming_links: "vec LinkEdge", node: "Node", outgoing_links: "vec LinkEdge" }
  },
  ResultChildren: { kind: "variant", cases: { Ok: "vec ChildNode", Err: "text" } },
  ResultCreateDatabase: { kind: "variant", cases: { Ok: "text", Err: "text" } },
  ResultDatabases: { kind: "variant", cases: { Ok: "vec DatabaseSummary", Err: "text" } },
  ResultMembers: { kind: "variant", cases: { Ok: "vec DatabaseMember", Err: "text" } },
  ResultUnit: { kind: "variant", cases: { Ok: "null", Err: "text" } },
  ResultWriteNode: { kind: "variant", cases: { Ok: "WriteNodeResult", Err: "text" } },
  ResultLinks: { kind: "variant", cases: { Ok: "vec LinkEdge", Err: "text" } },
  ResultNode: { kind: "variant", cases: { Ok: "opt Node", Err: "text" } },
  ResultNodeContext: { kind: "variant", cases: { Ok: "opt NodeContext", Err: "text" } },
  ResultQueryContext: { kind: "variant", cases: { Ok: "QueryContext", Err: "text" } },
  ResultRecent: { kind: "variant", cases: { Ok: "vec RecentNodeHit", Err: "text" } },
  ResultSearch: { kind: "variant", cases: { Ok: "vec SearchNodeHit", Err: "text" } },
  ResultSourceEvidence: { kind: "variant", cases: { Ok: "SourceEvidence", Err: "text" } },
  ResultUsage: { kind: "variant", cases: { Ok: "DatabaseUsage", Err: "text" } },
  ResultBilling: { kind: "variant", cases: { Ok: "DatabaseBilling", Err: "text" } },
  ResultDepositQuote: { kind: "variant", cases: { Ok: "DepositQuote", Err: "text" } },
  ResultDeposit: { kind: "variant", cases: { Ok: "DepositResult", Err: "text" } },
  ResultPayments: { kind: "variant", cases: { Ok: "vec PaymentRecord", Err: "text" } },
  ResultToken: { kind: "variant", cases: { Ok: "DatabaseTokenInfo", Err: "text" } },
  ResultTokens: { kind: "variant", cases: { Ok: "vec DatabaseTokenInfo", Err: "text" } },
  ResultCreateToken: { kind: "variant", cases: { Ok: "CreateDatabaseTokenResponse", Err: "text" } },
  SearchNodeHit: {
    kind: "record",
    fields: {
      preview: "opt SearchPreview",
      kind: "NodeKind",
      path: "text",
      match_reasons: "vec text",
      snippet: "opt text",
      score: "float32"
    }
  },
  SearchNodePathsRequest: {
    kind: "record",
    fields: {
      top_k: "nat32",
      database_id: "text",
      preview_mode: "opt SearchPreviewMode",
      prefix: "opt text",
      query_text: "text"
    }
  },
  SearchNodesRequest: {
    kind: "record",
    fields: {
      top_k: "nat32",
      database_id: "text",
      preview_mode: "opt SearchPreviewMode",
      prefix: "opt text",
      query_text: "text"
    }
  },
  SearchPreview: {
    kind: "record",
    fields: {
      field: "SearchPreviewField",
      char_offset: "nat32",
      match_reason: "text",
      excerpt: "opt text"
    }
  },
  SearchPreviewField: { kind: "variant", cases: { Path: "null", Content: "null" } },
  SearchPreviewMode: { kind: "variant", cases: { Light: "null", ContentStart: "null", None: "null" } },
  SourceEvidence: {
    kind: "record",
    fields: { node_path: "text", refs: "vec SourceEvidenceRef" }
  },
  SourceEvidenceRef: {
    kind: "record",
    fields: {
      link_text: "text",
      via_path: "text",
      source_path: "text",
      raw_href: "text"
    }
  },
  SourceEvidenceRequest: { kind: "record", fields: { node_path: "text", database_id: "text" } },
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
  ResultSqlBatch: { kind: "variant", cases: { Ok: "vec SqlExecuteResponse", Err: "text" } }
};

export const didTypeAliases = {
  ResultBilling: "Result_10",
  ResultChildren: "Result_15",
  ResultCreateDatabase: "Result_3",
  ResultCreateToken: "Result_4",
  ResultDatabases: "Result_18",
  ResultDeposit: "Result_6",
  ResultDepositQuote: "Result_11",
  ResultMembers: "Result_16",
  ResultPayments: "Result_20",
  ResultUnit: "Result_2",
  ResultWriteNode: "Result",
  ResultLinks: "Result_14",
  ResultNode: "Result_25",
  ResultNodeContext: "Result_26",
  ResultQueryContext: "Result_23",
  ResultRecent: "Result_27",
  ResultSearch: "Result_29",
  ResultSourceEvidence: "Result_30",
  ResultToken: "Result_28",
  ResultTokens: "Result_17",
  ResultUsage: "Result_12",
  ResultSqlBatch: "Result_31",
  ResultSql: "Result_32"
};

export const expectedMethods = {
  canister_health: { input: [], output: "CanisterHealth", mode: "query" },
  create_database: { input: [], output: "ResultCreateDatabase", mode: "update" },
  create_database_token: { input: ["CreateDatabaseTokenRequest"], output: "ResultCreateToken", mode: "update" },
  deposit_with_approval: { input: ["text", "nat64"], output: "ResultDeposit", mode: "update" },
  get_billing: { input: ["text"], output: "ResultBilling", mode: "query" },
  get_deposit_quote: { input: ["text", "nat64"], output: "ResultDepositQuote", mode: "update" },
  grant_database_access: { input: ["text", "text", "DatabaseRole"], output: "ResultUnit", mode: "update" },
  graph_links: { input: ["GraphLinksRequest"], output: "ResultLinks", mode: "query" },
  graph_neighborhood: { input: ["GraphNeighborhoodRequest"], output: "ResultLinks", mode: "query" },
  get_usage: { input: ["text"], output: "ResultUsage", mode: "query" },
  incoming_links: { input: ["IncomingLinksRequest"], output: "ResultLinks", mode: "query" },
  list_children: { input: ["ListChildrenRequest"], output: "ResultChildren", mode: "query" },
  list_databases: { input: [], output: "ResultDatabases", mode: "query" },
  list_database_members: { input: ["text"], output: "ResultMembers", mode: "query" },
  list_database_tokens: { input: ["text"], output: "ResultTokens", mode: "query" },
  list_payments: { input: ["text"], output: "ResultPayments", mode: "query" },
  memory_manifest: { input: [], output: "MemoryManifest", mode: "query" },
  outgoing_links: { input: ["OutgoingLinksRequest"], output: "ResultLinks", mode: "query" },
  query_context: { input: ["QueryContextRequest"], output: "ResultQueryContext", mode: "query" },
  read_node: { input: ["text", "text"], output: "ResultNode", mode: "query" },
  read_node_context: { input: ["NodeContextRequest"], output: "ResultNodeContext", mode: "query" },
  recent_nodes: { input: ["RecentNodesRequest"], output: "ResultRecent", mode: "query" },
  revoke_database_access: { input: ["text", "text"], output: "ResultUnit", mode: "update" },
  revoke_database_token: { input: ["text", "text"], output: "ResultToken", mode: "update" },
  search_node_paths: { input: ["SearchNodePathsRequest"], output: "ResultSearch", mode: "query" },
  search_nodes: { input: ["SearchNodesRequest"], output: "ResultSearch", mode: "query" },
  set_database_quota: { input: ["DatabaseQuotaRequest"], output: "ResultUsage", mode: "update" },
  source_evidence: { input: ["SourceEvidenceRequest"], output: "ResultSourceEvidence", mode: "query" },
  sql_batch: { input: ["SqlBatchRequest"], output: "ResultSqlBatch", mode: "update" },
  sql_execute: { input: ["SqlExecuteRequest"], output: "ResultSql", mode: "update" },
  sql_query: { input: ["SqlExecuteRequest"], output: "ResultSql", mode: "query" },
  top_up_database_balance: { input: ["DatabaseBalanceTopUpRequest"], output: "ResultBilling", mode: "update" },
  write_node: { input: ["WriteNodeRequest"], output: "ResultWriteNode", mode: "update" }
};
