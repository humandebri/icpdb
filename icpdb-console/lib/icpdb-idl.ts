import { Actor } from "@icp-sdk/core/agent";

type ActorInterfaceFactory = Parameters<typeof Actor.createActor>[0];

export const idlFactory: ActorInterfaceFactory = ({ IDL: idl }) => {
  const CanisterHealth = idl.Record({ cycles_balance: idl.Nat });
  const DatabaseRole = idl.Variant({ Reader: idl.Null, Writer: idl.Null, Owner: idl.Null });
  const DatabaseStatus = idl.Variant({
    Hot: idl.Null,
    Restoring: idl.Null,
    Archiving: idl.Null,
    Archived: idl.Null,
    Deleted: idl.Null
  });
  const DatabaseSummary = idl.Record({
    status: DatabaseStatus,
    role: DatabaseRole,
    logical_size_bytes: idl.Nat64,
    database_id: idl.Text,
    archived_at_ms: idl.Opt(idl.Int64),
    deleted_at_ms: idl.Opt(idl.Int64)
  });
  const DatabaseInfo = idl.Record({
    status: DatabaseStatus,
    logical_size_bytes: idl.Nat64,
    schema_version: idl.Text,
    database_id: idl.Text,
    archived_at_ms: idl.Opt(idl.Int64),
    mount_id: idl.Opt(idl.Nat16),
    snapshot_hash: idl.Opt(idl.Vec(idl.Nat8)),
    deleted_at_ms: idl.Opt(idl.Int64)
  });
  const DatabaseBalanceTopUpRequest = idl.Record({ database_id: idl.Text, units: idl.Nat64 });
  const DatabaseShardPlacement = idl.Record({
    status: DatabaseStatus,
    shard_id: idl.Text,
    updated_at_ms: idl.Int64,
    database_id: idl.Text,
    created_at_ms: idl.Int64,
    schema_version: idl.Text,
    canister_id: idl.Opt(idl.Text),
    mount_id: idl.Opt(idl.Nat16)
  });
  const DatabaseShardInfo = idl.Record({
    status: idl.Text,
    shard_id: idl.Text,
    canister_id: idl.Text,
    updated_at_ms: idl.Int64,
    created_at_ms: idl.Int64,
    assigned_databases: idl.Nat64,
    max_databases: idl.Nat16
  });
  const DatabaseShardStatus = idl.Record({
    cycles_balance: idl.Nat,
    memory_size_bytes: idl.Nat,
    shard: DatabaseShardInfo,
    canister_status: idl.Text,
    idle_cycles_burned_per_day: idl.Nat,
    module_hash: idl.Opt(idl.Vec(idl.Nat8))
  });
  const DatabaseShardMaintenanceAction = idl.Record({
    action: idl.Text,
    database_canister_id: idl.Opt(idl.Text),
    shard_id: idl.Opt(idl.Text),
    cycles: idl.Nat,
    reason: idl.Text
  });
  const DatabaseShardMaintenanceReport = idl.Record({
    actions: idl.Vec(DatabaseShardMaintenanceAction),
    available_slots: idl.Nat64,
    inspected_shards: idl.Vec(DatabaseShardStatus)
  });
  const CreateDatabaseShardRequest = idl.Record({
    initial_cycles: idl.Nat,
    max_databases: idl.Nat16
  });
  const RegisterDatabaseShardRequest = idl.Record({
    database_canister_id: idl.Text,
    max_databases: idl.Nat16
  });
  const RoutedOperationStatus = idl.Variant({
    Applied: idl.Null,
    Failed: idl.Null,
    Unknown: idl.Null,
    Pending: idl.Null
  });
  const ShardOperationInfo = idl.Record({
    request_hash: idl.Vec(idl.Nat8),
    status: RoutedOperationStatus,
    operation_kind: idl.Text,
    updated_at_ms: idl.Int64,
    operation_id: idl.Text,
    error: idl.Opt(idl.Text),
    created_at_ms: idl.Int64,
    target: idl.Opt(idl.Text)
  });
  const RoutedOperationInfo = idl.Record({
    request_hash: idl.Vec(idl.Nat8),
    status: RoutedOperationStatus,
    method: idl.Text,
    database_canister_id: idl.Text,
    updated_at_ms: idl.Int64,
    operation_id: idl.Text,
    error: idl.Opt(idl.Text),
    created_at_ms: idl.Int64,
    database_id: idl.Text
  });
  const RoutedOperationRequest = idl.Record({
    operation_id: idl.Text,
    database_id: idl.Text
  });
  const DatabaseShardStatusRequest = idl.Record({ database_canister_id: idl.Text });
  const TopUpDatabaseShardRequest = idl.Record({ database_canister_id: idl.Text, cycles: idl.Nat });
  const MaintainDatabaseShardsRequest = idl.Record({
    top_up_cycles: idl.Nat,
    new_shard_initial_cycles: idl.Nat,
    new_shard_max_databases: idl.Nat16,
    min_cycles_balance: idl.Nat,
    min_available_slots: idl.Nat64,
    max_new_shards: idl.Nat16
  });
  const CreateRemoteDatabaseRequest = idl.Record({ database_canister_id: idl.Text, database_id: idl.Text });
  const ShardOperationReconcileRequest = idl.Record({
    status: RoutedOperationStatus,
    operation_id: idl.Text,
    error: idl.Opt(idl.Text)
  });
  const DatabaseUsage = idl.Record({
    status: DatabaseStatus,
    max_logical_size_bytes: idl.Nat64,
    logical_size_bytes: idl.Nat64,
    usage_event_count: idl.Nat64,
    database_id: idl.Text
  });
  const DatabaseUsageEventSummary = idl.Record({
    method: idl.Text,
    operation: idl.Opt(idl.Text),
    success: idl.Bool,
    total_cycles_delta: idl.Nat64,
    total_rows_returned: idl.Nat64,
    total_rows_affected: idl.Nat64,
    event_count: idl.Nat64,
    last_created_at_ms: idl.Int64
  });
  const DatabaseBillingStatus = idl.Variant({ Active: idl.Null, Suspended: idl.Null });
  const DatabaseBilling = idl.Record({
    status: DatabaseBillingStatus,
    spent_units: idl.Nat64,
    usage_event_count: idl.Nat64,
    database_id: idl.Text,
    balance_units: idl.Nat64
  });
  const DatabaseArchiveInfo = idl.Record({ size_bytes: idl.Nat64, database_id: idl.Text });
  const DatabaseArchiveChunk = idl.Record({ bytes: idl.Vec(idl.Nat8) });
  const DatabaseQuotaRequest = idl.Record({
    max_logical_size_bytes: idl.Nat64,
    database_id: idl.Text
  });
  const DatabaseMember = idl.Record({
    principal: idl.Text,
    role: DatabaseRole,
    created_at_ms: idl.Int64,
    database_id: idl.Text
  });
  const DatabaseRestoreChunkRequest = idl.Record({
    offset: idl.Nat64,
    database_id: idl.Text,
    bytes: idl.Vec(idl.Nat8)
  });
  const DatabaseColumn = idl.Record({
    cid: idl.Nat32,
    name: idl.Text,
    primary_key_position: idl.Nat32,
    declared_type: idl.Text,
    default_value: idl.Opt(idl.Text),
    not_null: idl.Bool,
    hidden: idl.Nat32
  });
  const DatabaseForeignKey = idl.Record({
    id: idl.Nat32,
    seq: idl.Nat32,
    match_clause: idl.Text,
    to_column: idl.Opt(idl.Text),
    table_name: idl.Text,
    on_delete: idl.Text,
    on_update: idl.Text,
    from_column: idl.Text
  });
  const DatabaseIndexColumn = idl.Record({
    cid: idl.Int64,
    key: idl.Bool,
    descending: idl.Bool,
    collation: idl.Text,
    name: idl.Opt(idl.Text),
    seqno: idl.Nat32
  });
  const DatabaseIndex = idl.Record({
    schema_sql: idl.Opt(idl.Text),
    name: idl.Text,
    origin: idl.Text,
    unique: idl.Bool,
    table_name: idl.Text,
    partial: idl.Bool,
    columns: idl.Vec(DatabaseIndexColumn)
  });
  const DatabaseTrigger = idl.Record({
    schema_sql: idl.Opt(idl.Text),
    name: idl.Text,
    table_name: idl.Text
  });
  const DatabaseObjectType = idl.Variant({ View: idl.Null, Table: idl.Null });
  const DatabaseTable = idl.Record({
    schema_sql: idl.Opt(idl.Text),
    name: idl.Text,
    object_type: DatabaseObjectType
  });
  const DepositQuote = idl.Record({
    spender_principal: idl.Text,
    amount_e8s: idl.Nat64,
    credited_units: idl.Nat64,
    database_id: idl.Text,
    ledger_canister_id: idl.Text,
    expected_fee_e8s: idl.Nat64
  });
  const DepositResult = idl.Record({
    block_index: idl.Nat64,
    amount_e8s: idl.Nat64,
    credited_units: idl.Nat64,
    database_id: idl.Text,
    balance_units: idl.Nat64
  });
  const PaymentRecord = idl.Record({
    block_index: idl.Nat64,
    created_at_ms: idl.Int64,
    amount_e8s: idl.Nat64,
    credited_units: idl.Nat64,
    database_id: idl.Text,
    payer_principal: idl.Text,
    payment_id: idl.Text
  });
  const DatabaseTokenScope = idl.Variant({ Read: idl.Null, Write: idl.Null, Owner: idl.Null });
  const DatabaseTokenInfo = idl.Record({
    last_used_at_ms: idl.Opt(idl.Int64),
    token_id: idl.Text,
    name: idl.Text,
    scope: DatabaseTokenScope,
    created_at_ms: idl.Int64,
    database_id: idl.Text,
    revoked_at_ms: idl.Opt(idl.Int64)
  });
  const CreateDatabaseTokenRequest = idl.Record({
    name: idl.Text,
    scope: DatabaseTokenScope,
    database_id: idl.Text
  });
  const CreateDatabaseTokenResponse = idl.Record({
    token: idl.Text,
    info: DatabaseTokenInfo
  });
  const SqlValue = idl.Variant({
    Blob: idl.Vec(idl.Nat8),
    Null: idl.Null,
    Real: idl.Float64,
    Text: idl.Text,
    Integer: idl.Int64
  });
  const SqlStatement = idl.Record({ sql: idl.Text, params: idl.Vec(SqlValue) });
  const SqlBatchRequest = idl.Record({
    max_rows: idl.Opt(idl.Nat32),
    database_id: idl.Text,
    statements: idl.Vec(SqlStatement),
    idempotency_key: idl.Opt(idl.Text)
  });
  const SqlExecuteRequest = idl.Record({
    sql: idl.Text,
    max_rows: idl.Opt(idl.Nat32),
    database_id: idl.Text,
    params: idl.Vec(SqlValue),
    idempotency_key: idl.Opt(idl.Text)
  });
  const SqlExecuteResponse = idl.Record({
    truncated: idl.Bool,
    routed_operation_id: idl.Opt(idl.Text),
    rows: idl.Vec(idl.Vec(SqlValue)),
    rows_affected: idl.Nat64,
    last_insert_rowid: idl.Int64,
    columns: idl.Vec(idl.Text)
  });
  const TableDescription = idl.Record({
    foreign_keys: idl.Vec(DatabaseForeignKey),
    schema_sql: idl.Opt(idl.Text),
    database_id: idl.Text,
    object_type: DatabaseObjectType,
    table_name: idl.Text,
    indexes: idl.Vec(DatabaseIndex),
    columns: idl.Vec(DatabaseColumn),
    triggers: idl.Vec(DatabaseTrigger)
  });
  const TablePreviewRequest = idl.Record({
    offset: idl.Opt(idl.Nat32),
    limit: idl.Opt(idl.Nat32),
    database_id: idl.Text,
    table_name: idl.Text
  });
  const TablePreviewResponse = idl.Record({
    truncated: idl.Bool,
    rows: idl.Vec(idl.Vec(SqlValue)),
    offset: idl.Nat32,
    limit: idl.Nat32,
    database_id: idl.Text,
    total_count: idl.Nat64,
    table_name: idl.Text,
    columns: idl.Vec(idl.Text)
  });
  const ResultSql = idl.Variant({ Ok: SqlExecuteResponse, Err: idl.Text });
  const ResultUnit = idl.Variant({ Ok: idl.Null, Err: idl.Text });
  const ResultArchiveInfo = idl.Variant({ Ok: DatabaseArchiveInfo, Err: idl.Text });
  const ResultArchiveChunk = idl.Variant({ Ok: DatabaseArchiveChunk, Err: idl.Text });
  const ResultSqlBatch = idl.Variant({ Ok: idl.Vec(SqlExecuteResponse), Err: idl.Text });
  const ResultCreateDatabase = idl.Variant({ Ok: idl.Text, Err: idl.Text });
  const ResultDatabaseInfo = idl.Variant({ Ok: DatabaseInfo, Err: idl.Text });
  const ResultDatabases = idl.Variant({ Ok: idl.Vec(DatabaseSummary), Err: idl.Text });
  const ResultShardPlacements = idl.Variant({ Ok: idl.Vec(DatabaseShardPlacement), Err: idl.Text });
  const ResultShardPlacement = idl.Variant({ Ok: DatabaseShardPlacement, Err: idl.Text });
  const ResultDatabaseShards = idl.Variant({ Ok: idl.Vec(DatabaseShardInfo), Err: idl.Text });
  const ResultDatabaseShardInfo = idl.Variant({ Ok: DatabaseShardInfo, Err: idl.Text });
  const ResultDatabaseShardStatus = idl.Variant({ Ok: DatabaseShardStatus, Err: idl.Text });
  const ResultDatabaseShardMaintenanceReport = idl.Variant({ Ok: DatabaseShardMaintenanceReport, Err: idl.Text });
  const ResultShardOperations = idl.Variant({ Ok: idl.Vec(ShardOperationInfo), Err: idl.Text });
  const ResultShardOperation = idl.Variant({ Ok: ShardOperationInfo, Err: idl.Text });
  const ResultRoutedOperation = idl.Variant({ Ok: RoutedOperationInfo, Err: idl.Text });
  const ResultUsage = idl.Variant({ Ok: DatabaseUsage, Err: idl.Text });
  const ResultUsageEvents = idl.Variant({ Ok: idl.Vec(DatabaseUsageEventSummary), Err: idl.Text });
  const ResultBilling = idl.Variant({ Ok: DatabaseBilling, Err: idl.Text });
  const ResultDepositQuote = idl.Variant({ Ok: DepositQuote, Err: idl.Text });
  const ResultDeposit = idl.Variant({ Ok: DepositResult, Err: idl.Text });
  const ResultPayments = idl.Variant({ Ok: idl.Vec(PaymentRecord), Err: idl.Text });
  const ResultTokens = idl.Variant({ Ok: idl.Vec(DatabaseTokenInfo), Err: idl.Text });
  const ResultCreateToken = idl.Variant({ Ok: CreateDatabaseTokenResponse, Err: idl.Text });
  const ResultMembers = idl.Variant({ Ok: idl.Vec(DatabaseMember), Err: idl.Text });
  const ResultRevokedToken = idl.Variant({ Ok: DatabaseTokenInfo, Err: idl.Text });
  const ResultTables = idl.Variant({ Ok: idl.Vec(DatabaseTable), Err: idl.Text });
  const ResultTableDescription = idl.Variant({ Ok: TableDescription, Err: idl.Text });
  const ResultTablePreview = idl.Variant({ Ok: TablePreviewResponse, Err: idl.Text });

  return idl.Service({
    begin_database_archive: idl.Func([idl.Text], [ResultArchiveInfo], []),
    begin_database_restore: idl.Func([idl.Text, idl.Vec(idl.Nat8), idl.Nat64], [ResultUnit], []),
    cancel_database_archive: idl.Func([idl.Text], [ResultUnit], []),
    canister_health: idl.Func([], [CanisterHealth], ["query"]),
    create_database: idl.Func([], [ResultCreateDatabase], []),
    create_database_shard: idl.Func([CreateDatabaseShardRequest], [ResultDatabaseShardInfo], []),
    create_remote_database: idl.Func([CreateRemoteDatabaseRequest], [ResultDatabaseInfo], []),
    create_database_token: idl.Func([CreateDatabaseTokenRequest], [ResultCreateToken], []),
    delete_database: idl.Func([idl.Text], [ResultUnit], []),
    deposit_with_approval: idl.Func([idl.Text, idl.Nat64], [ResultDeposit], []),
    describe_table: idl.Func([idl.Text, idl.Text], [ResultTableDescription], []),
    get_billing: idl.Func([idl.Text], [ResultBilling], ["query"]),
    get_database_shard_status: idl.Func([DatabaseShardStatusRequest], [ResultDatabaseShardStatus], []),
    get_deposit_quote: idl.Func([idl.Text, idl.Nat64], [ResultDepositQuote], []),
    get_routed_operation: idl.Func([RoutedOperationRequest], [ResultRoutedOperation], ["query"]),
    get_usage: idl.Func([idl.Text], [ResultUsage], ["query"]),
    get_usage_event_summaries: idl.Func([idl.Text], [ResultUsageEvents], ["query"]),
    grant_database_access: idl.Func([idl.Text, idl.Text, DatabaseRole], [ResultUnit], []),
    list_database_members: idl.Func([idl.Text], [ResultMembers], ["query"]),
    list_all_database_placements: idl.Func([], [ResultShardPlacements], ["query"]),
    list_database_placements: idl.Func([], [ResultShardPlacements], ["query"]),
    list_database_shards: idl.Func([], [ResultDatabaseShards], ["query"]),
    list_databases: idl.Func([], [ResultDatabases], ["query"]),
    list_database_tokens: idl.Func([idl.Text], [ResultTokens], ["query"]),
    list_payments: idl.Func([idl.Text], [ResultPayments], ["query"]),
    list_shard_operations: idl.Func([], [ResultShardOperations], ["query"]),
    list_tables: idl.Func([idl.Text], [ResultTables], []),
    maintain_database_shards: idl.Func([MaintainDatabaseShardsRequest], [ResultDatabaseShardMaintenanceReport], []),
    migrate_database_to_shard: idl.Func([CreateRemoteDatabaseRequest], [ResultShardPlacement], []),
    preview_table: idl.Func([TablePreviewRequest], [ResultTablePreview], []),
    read_database_archive_chunk: idl.Func([idl.Text, idl.Nat64, idl.Nat32], [ResultArchiveChunk], []),
    reconcile_routed_operation: idl.Func([RoutedOperationRequest], [ResultRoutedOperation], []),
    reconcile_shard_operation: idl.Func([ShardOperationReconcileRequest], [ResultShardOperation], []),
    register_database_shard: idl.Func([RegisterDatabaseShardRequest], [ResultDatabaseShardInfo], []),
    revoke_database_access: idl.Func([idl.Text, idl.Text], [ResultUnit], []),
    revoke_database_token: idl.Func([idl.Text, idl.Text], [ResultRevokedToken], []),
    set_database_quota: idl.Func([DatabaseQuotaRequest], [ResultUsage], []),
    finalize_database_archive: idl.Func([idl.Text, idl.Vec(idl.Nat8)], [ResultUnit], []),
    finalize_database_restore: idl.Func([idl.Text], [ResultUnit], []),
    sql_batch: idl.Func([SqlBatchRequest], [ResultSqlBatch], []),
    sql_execute: idl.Func([SqlExecuteRequest], [ResultSql], []),
    sql_query: idl.Func([SqlExecuteRequest], [ResultSql], []),
    top_up_database_balance: idl.Func([DatabaseBalanceTopUpRequest], [ResultBilling], []),
    top_up_database_shard: idl.Func([TopUpDatabaseShardRequest], [ResultDatabaseShardInfo], []),
    write_database_restore_chunk: idl.Func([DatabaseRestoreChunkRequest], [ResultUnit], [])
  });
};
