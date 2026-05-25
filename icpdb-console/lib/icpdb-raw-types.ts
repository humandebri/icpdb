// icpdb-console/lib/icpdb-raw-types.ts
// Raw Candid DTOs for the ICPDB canister client.

export type Variant = Record<string, null>;

export type RawCanisterHealth = {
  cycles_balance: bigint;
};

export type RawDatabaseSummary = {
  status: Variant;
  role: Variant;
  logical_size_bytes: bigint;
  database_id: string;
  archived_at_ms: [] | [bigint];
  deleted_at_ms: [] | [bigint];
};

export type RawDatabaseShardPlacement = {
  database_id: string;
  shard_id: string;
  canister_id: [] | [string];
  mount_id: [] | [number];
  status: Variant;
  schema_version: string;
  created_at_ms: bigint;
  updated_at_ms: bigint;
};

export type RawShardOperationInfo = {
  operation_id: string;
  operation_kind: string;
  target: [] | [string];
  request_hash: number[];
  status: Variant;
  error: [] | [string];
  created_at_ms: bigint;
  updated_at_ms: bigint;
};

export type RawRoutedOperationInfo = {
  operation_id: string;
  database_id: string;
  database_canister_id: string;
  method: string;
  request_hash: number[];
  status: Variant;
  error: [] | [string];
  created_at_ms: bigint;
  updated_at_ms: bigint;
};

export type RawShardOperationReconcileRequest = {
  operation_id: string;
  status: Variant;
  error: [] | [string];
};

export type RawDatabaseMember = {
  database_id: string;
  principal: string;
  role: Variant;
  created_at_ms: bigint;
};

export type RawDatabaseUsage = {
  database_id: string;
  status: Variant;
  logical_size_bytes: bigint;
  max_logical_size_bytes: bigint;
  usage_event_count: bigint;
};

export type RawDatabaseUsageEventSummary = {
  method: string;
  operation: [] | [string];
  success: boolean;
  event_count: bigint;
  total_cycles_delta: bigint;
  total_rows_returned: bigint;
  total_rows_affected: bigint;
  last_created_at_ms: bigint;
};

export type RawDatabaseBilling = {
  database_id: string;
  status: Variant;
  balance_units: bigint;
  spent_units: bigint;
  usage_event_count: bigint;
};

export type RawDatabaseArchiveInfo = {
  database_id: string;
  size_bytes: bigint;
};

export type RawDatabaseArchiveChunk = {
  bytes: number[];
};

export type RawDatabaseRestoreChunkRequest = {
  database_id: string;
  offset: bigint;
  bytes: number[];
};

export type RawDepositQuote = {
  database_id: string;
  amount_e8s: bigint;
  expected_fee_e8s: bigint;
  credited_units: bigint;
  ledger_canister_id: string;
  spender_principal: string;
};

export type RawDepositResult = {
  database_id: string;
  amount_e8s: bigint;
  credited_units: bigint;
  block_index: bigint;
  balance_units: bigint;
};

export type RawPaymentRecord = {
  payment_id: string;
  database_id: string;
  payer_principal: string;
  amount_e8s: bigint;
  credited_units: bigint;
  block_index: bigint;
  created_at_ms: bigint;
};

export type RawDatabaseTokenInfo = {
  token_id: string;
  database_id: string;
  name: string;
  scope: Variant;
  created_at_ms: bigint;
  last_used_at_ms: [] | [bigint];
  revoked_at_ms: [] | [bigint];
};

export type RawCreateDatabaseTokenResponse = {
  token: string;
  info: RawDatabaseTokenInfo;
};

export type RawDatabaseObjectType = { Table: null } | { View: null };

export type RawDatabaseTable = {
  name: string;
  object_type: RawDatabaseObjectType;
  schema_sql: [] | [string];
};

export type RawDatabaseColumn = {
  cid: number;
  name: string;
  declared_type: string;
  not_null: boolean;
  default_value: [] | [string];
  primary_key_position: number;
  hidden: number;
};

export type RawDatabaseIndex = {
  name: string;
  table_name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: RawDatabaseIndexColumn[];
  schema_sql: [] | [string];
};

export type RawDatabaseIndexColumn = {
  seqno: number;
  cid: bigint;
  name: [] | [string];
  descending: boolean;
  collation: string;
  key: boolean;
};

export type RawDatabaseTrigger = {
  name: string;
  table_name: string;
  schema_sql: [] | [string];
};

export type RawDatabaseForeignKey = {
  id: number;
  seq: number;
  table_name: string;
  from_column: string;
  to_column: [] | [string];
  on_update: string;
  on_delete: string;
  match_clause: string;
};

export type RawTableDescription = {
  database_id: string;
  table_name: string;
  object_type: RawDatabaseObjectType;
  schema_sql: [] | [string];
  columns: RawDatabaseColumn[];
  indexes: RawDatabaseIndex[];
  triggers: RawDatabaseTrigger[];
  foreign_keys: RawDatabaseForeignKey[];
};

export type RawTablePreviewRequest = {
  database_id: string;
  table_name: string;
  limit: [] | [number];
  offset: [] | [number];
};

export type RawTablePreviewResponse = {
  database_id: string;
  table_name: string;
  columns: string[];
  rows: RawSqlValue[][];
  offset: number;
  limit: number;
  total_count: bigint;
  truncated: boolean;
};

export type RawSqlValue =
  | { Null: null }
  | { Integer: bigint }
  | { Real: number }
  | { Text: string }
  | { Blob: number[] };

export type RawSqlExecuteRequest = {
  database_id: string;
  sql: string;
  params: RawSqlValue[];
  max_rows: [] | [number];
};

export type RawSqlStatement = {
  sql: string;
  params: RawSqlValue[];
};

export type RawSqlBatchRequest = {
  database_id: string;
  statements: RawSqlStatement[];
  max_rows: [] | [number];
};

export type RawSqlExecuteResponse = {
  columns: string[];
  rows: RawSqlValue[][];
  rows_affected: bigint;
  last_insert_rowid: bigint;
  truncated: boolean;
};
