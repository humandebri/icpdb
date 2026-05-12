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
  const DatabaseUsage = idl.Record({
    status: DatabaseStatus,
    max_logical_size_bytes: idl.Nat64,
    logical_size_bytes: idl.Nat64,
    usage_event_count: idl.Nat64,
    database_id: idl.Text
  });
  const DatabaseBillingStatus = idl.Variant({ Active: idl.Null, Suspended: idl.Null });
  const DatabaseBilling = idl.Record({
    status: DatabaseBillingStatus,
    spent_units: idl.Nat64,
    usage_event_count: idl.Nat64,
    database_id: idl.Text,
    balance_units: idl.Nat64
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
  const DatabaseTokenScope = idl.Variant({ Read: idl.Null, Write: idl.Null });
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
    statements: idl.Vec(SqlStatement)
  });
  const SqlExecuteRequest = idl.Record({
    sql: idl.Text,
    max_rows: idl.Opt(idl.Nat32),
    database_id: idl.Text,
    params: idl.Vec(SqlValue)
  });
  const SqlExecuteResponse = idl.Record({
    truncated: idl.Bool,
    rows: idl.Vec(idl.Vec(SqlValue)),
    rows_affected: idl.Nat64,
    last_insert_rowid: idl.Int64,
    columns: idl.Vec(idl.Text)
  });
  const ResultSql = idl.Variant({ Ok: SqlExecuteResponse, Err: idl.Text });
  const ResultSqlBatch = idl.Variant({ Ok: idl.Vec(SqlExecuteResponse), Err: idl.Text });
  const ResultCreateDatabase = idl.Variant({ Ok: idl.Text, Err: idl.Text });
  const ResultDatabases = idl.Variant({ Ok: idl.Vec(DatabaseSummary), Err: idl.Text });
  const ResultUsage = idl.Variant({ Ok: DatabaseUsage, Err: idl.Text });
  const ResultBilling = idl.Variant({ Ok: DatabaseBilling, Err: idl.Text });
  const ResultDepositQuote = idl.Variant({ Ok: DepositQuote, Err: idl.Text });
  const ResultDeposit = idl.Variant({ Ok: DepositResult, Err: idl.Text });
  const ResultPayments = idl.Variant({ Ok: idl.Vec(PaymentRecord), Err: idl.Text });
  const ResultTokens = idl.Variant({ Ok: idl.Vec(DatabaseTokenInfo), Err: idl.Text });
  const ResultCreateToken = idl.Variant({ Ok: CreateDatabaseTokenResponse, Err: idl.Text });

  return idl.Service({
    canister_health: idl.Func([], [CanisterHealth], ["query"]),
    create_database: idl.Func([], [ResultCreateDatabase], []),
    create_database_token: idl.Func([CreateDatabaseTokenRequest], [ResultCreateToken], []),
    deposit_with_approval: idl.Func([idl.Text, idl.Nat64], [ResultDeposit], []),
    get_billing: idl.Func([idl.Text], [ResultBilling], ["query"]),
    get_deposit_quote: idl.Func([idl.Text, idl.Nat64], [ResultDepositQuote], []),
    get_usage: idl.Func([idl.Text], [ResultUsage], ["query"]),
    list_databases: idl.Func([], [ResultDatabases], ["query"]),
    list_database_tokens: idl.Func([idl.Text], [ResultTokens], ["query"]),
    list_payments: idl.Func([idl.Text], [ResultPayments], ["query"]),
    sql_batch: idl.Func([SqlBatchRequest], [ResultSqlBatch], []),
    sql_execute: idl.Func([SqlExecuteRequest], [ResultSql], []),
    sql_query: idl.Func([SqlExecuteRequest], [ResultSql], ["query"])
  });
};
