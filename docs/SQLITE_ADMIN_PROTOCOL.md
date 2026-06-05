# SQLite Admin Protocol

SQLite Admin Protocol is the minimal Candid contract used by the console to
inspect and operate a canister-owned SQLite database.

The ICPDB canister implements this contract as a multi-tenant hosted reference
canister. Application canisters can implement the same contract directly. A
single-database canister should use `database_id = "default"` and keep the wire
shape unchanged.

## Candid surface

```did
type SqlValue = variant {
  Null;
  Integer : int64;
  Real : float64;
  Text : text;
  Blob : blob;
};

type SqlExecuteRequest = record {
  database_id : text;
  sql : text;
  params : vec SqlValue;
  max_rows : opt nat32;
  idempotency_key : opt text;
};

type SqlStatement = record {
  sql : text;
  params : vec SqlValue;
};

type SqlBatchRequest = record {
  database_id : text;
  statements : vec SqlStatement;
  max_rows : opt nat32;
  idempotency_key : opt text;
};

type SqlExecuteResponse = record {
  columns : vec text;
  rows : vec vec SqlValue;
  routed_operation_id : opt text;
  rows_affected : nat64;
  last_insert_rowid : int64;
  truncated : bool;
};

type DatabaseObjectType = variant { View; Table };

type DatabaseTable = record {
  schema_sql : opt text;
  name : text;
  object_type : DatabaseObjectType;
};

type DatabaseColumn = record {
  cid : nat32;
  name : text;
  hidden : nat32;
  primary_key_position : nat32;
  declared_type : text;
  default_value : opt text;
  not_null : bool;
};

type DatabaseIndexColumn = record {
  cid : int64;
  key : bool;
  descending : bool;
  collation : text;
  name : opt text;
  seqno : nat32;
};

type DatabaseIndex = record {
  schema_sql : opt text;
  name : text;
  origin : text;
  unique : bool;
  table_name : text;
  partial : bool;
  columns : vec DatabaseIndexColumn;
};

type DatabaseTrigger = record {
  schema_sql : opt text;
  name : text;
  table_name : text;
};

type DatabaseForeignKey = record {
  id : nat32;
  seq : nat32;
  match_clause : text;
  to_column : opt text;
  table_name : text;
  on_delete : text;
  on_update : text;
  from_column : text;
};

type TableDescription = record {
  foreign_keys : vec DatabaseForeignKey;
  schema_sql : opt text;
  database_id : text;
  object_type : DatabaseObjectType;
  table_name : text;
  indexes : vec DatabaseIndex;
  columns : vec DatabaseColumn;
  triggers : vec DatabaseTrigger;
};

type TablePreviewRequest = record {
  database_id : text;
  table_name : text;
  limit : opt nat32;
  offset : opt nat32;
};

type TablePreviewResponse = record {
  truncated : bool;
  rows : vec vec SqlValue;
  offset : nat32;
  limit : nat32;
  database_id : text;
  total_count : nat64;
  table_name : text;
  columns : vec text;
};

type ResultSql = variant { Ok : SqlExecuteResponse; Err : text };
type ResultSqlBatch = variant { Ok : vec SqlExecuteResponse; Err : text };
type ResultTables = variant { Ok : vec DatabaseTable; Err : text };
type ResultTableDescription = variant { Ok : TableDescription; Err : text };
type ResultTablePreview = variant { Ok : TablePreviewResponse; Err : text };

service : {
  list_tables : (text) -> (ResultTables);
  describe_table : (text, text) -> (ResultTableDescription);
  preview_table : (TablePreviewRequest) -> (ResultTablePreview);
  sql_query : (SqlExecuteRequest) -> (ResultSql);
  sql_execute : (SqlExecuteRequest) -> (ResultSql);
  sql_batch : (SqlBatchRequest) -> (ResultSqlBatch);
}
```

`sql_batch` is required for v1 protocol compatibility because the console uses
it for batch SQL and SQL dump load.

## Required behavior

- `sql_query` accepts only read-only SQL such as `SELECT`, `WITH`, `PRAGMA`, or
  `EXPLAIN`.
- `sql_execute` is an update call and must require an authenticated writer or
  admin.
- `list_tables`, `describe_table`, and `preview_table` require reader access.
- `routed_operation_id` should be `null` for direct/local execution. Hosted
  sharded implementations should set it when a write is routed through a
  database canister and can be inspected later. This is routed writes metadata,
  not a separate auth token.
- `idempotency_key` is optional and should only affect write-routed
  `sql_execute` / `sql_batch` calls. Hosted sharded implementations can use it
  as the returned `routed_operation_id` for retry-safe Server/CI writes.
- SQL text, parameter count, returned rows, and response size must be bounded.
- Anonymous callers must be rejected for every protected method.
- Access checks must run inside each method. `canister_inspect_message` can only
  be a cycle-saving filter, not an authorization boundary.

## Non-goals

- Billing, deposits, and payment history are not part of this protocol.
- Database creation, deletion, archive, restore, and sharding are hosted-demo
  features, not required adapter features.
- Compatibility shims for alternate wire shapes are not part of v1.
