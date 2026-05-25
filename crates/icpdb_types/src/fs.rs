// Where: crates/icpdb_types/src/fs.rs
// What: Shared database lifecycle, billing, deposit, and token contracts.
// Why: Runtime, canister, and frontend bindings must agree on stable ICPDB transport types.
use candid::CandidType;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseRole {
    #[serde(alias = "Owner")]
    Owner,
    #[serde(alias = "Writer")]
    Writer,
    #[serde(alias = "Reader")]
    Reader,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseMember {
    pub database_id: String,
    pub principal: String,
    pub role: DatabaseRole,
    pub created_at_ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseStatus {
    #[serde(alias = "Hot")]
    Hot,
    #[serde(alias = "Archiving")]
    Archiving,
    #[serde(alias = "Archived")]
    Archived,
    #[serde(alias = "Deleted")]
    Deleted,
    #[serde(alias = "Restoring")]
    Restoring,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseInfo {
    pub database_id: String,
    pub status: DatabaseStatus,
    pub mount_id: Option<u16>,
    pub schema_version: String,
    pub logical_size_bytes: u64,
    pub snapshot_hash: Option<Vec<u8>>,
    pub archived_at_ms: Option<i64>,
    pub deleted_at_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseCanisterInitArgs {
    pub control_canister_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct CreateDatabaseSlotRequest {
    pub database_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct CreateRemoteDatabaseRequest {
    pub database_id: String,
    pub database_canister_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct CreateDatabaseShardRequest {
    pub max_databases: u16,
    pub initial_cycles: u128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct RegisterDatabaseShardRequest {
    pub database_canister_id: String,
    pub max_databases: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct TopUpDatabaseShardRequest {
    pub database_canister_id: String,
    pub cycles: u128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseShardStatusRequest {
    pub database_canister_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct MigrateDatabaseToShardRequest {
    pub database_id: String,
    pub database_canister_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseSummary {
    pub database_id: String,
    pub status: DatabaseStatus,
    pub role: DatabaseRole,
    pub logical_size_bytes: u64,
    pub archived_at_ms: Option<i64>,
    pub deleted_at_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseShardPlacement {
    pub database_id: String,
    pub shard_id: String,
    pub canister_id: Option<String>,
    pub mount_id: Option<u16>,
    pub status: DatabaseStatus,
    pub schema_version: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseShardInfo {
    pub shard_id: String,
    pub canister_id: String,
    pub status: String,
    pub max_databases: u16,
    pub assigned_databases: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseShardStatus {
    pub shard: DatabaseShardInfo,
    pub canister_status: String,
    pub cycles_balance: u128,
    pub memory_size_bytes: u128,
    pub idle_cycles_burned_per_day: u128,
    pub module_hash: Option<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct MaintainDatabaseShardsRequest {
    pub min_available_slots: u64,
    pub min_cycles_balance: u128,
    pub top_up_cycles: u128,
    pub max_new_shards: u16,
    pub new_shard_max_databases: u16,
    pub new_shard_initial_cycles: u128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseShardMaintenanceAction {
    pub action: String,
    pub database_canister_id: Option<String>,
    pub shard_id: Option<String>,
    pub cycles: u128,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseShardMaintenanceReport {
    pub inspected_shards: Vec<DatabaseShardStatus>,
    pub actions: Vec<DatabaseShardMaintenanceAction>,
    pub available_slots: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
#[serde(rename_all = "snake_case")]
pub enum RoutedOperationStatus {
    #[serde(alias = "Pending")]
    Pending,
    #[serde(alias = "Applied")]
    Applied,
    #[serde(alias = "Failed")]
    Failed,
    #[serde(alias = "Unknown")]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct RoutedOperationInfo {
    pub operation_id: String,
    pub database_id: String,
    pub database_canister_id: String,
    pub method: String,
    pub request_hash: Vec<u8>,
    pub status: RoutedOperationStatus,
    pub error: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct RoutedOperationRequest {
    pub database_id: String,
    pub operation_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DataPlaneOperationInfo {
    pub operation_id: String,
    pub database_id: String,
    pub method: String,
    pub request_hash: Vec<u8>,
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct ShardOperationInfo {
    pub operation_id: String,
    pub operation_kind: String,
    pub target: Option<String>,
    pub request_hash: Vec<u8>,
    pub status: RoutedOperationStatus,
    pub error: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct ShardOperationReconcileRequest {
    pub operation_id: String,
    pub status: RoutedOperationStatus,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseUsage {
    pub database_id: String,
    pub status: DatabaseStatus,
    pub logical_size_bytes: u64,
    pub max_logical_size_bytes: u64,
    pub usage_event_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseUsageEventSummary {
    pub method: String,
    pub operation: Option<String>,
    pub success: bool,
    pub event_count: u64,
    pub total_cycles_delta: u64,
    pub total_rows_returned: u64,
    pub total_rows_affected: u64,
    pub last_created_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseQuotaRequest {
    pub database_id: String,
    pub max_logical_size_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseBillingStatus {
    #[serde(alias = "Active")]
    Active,
    #[serde(alias = "Suspended")]
    Suspended,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseBilling {
    pub database_id: String,
    pub status: DatabaseBillingStatus,
    pub balance_units: u64,
    pub spent_units: u64,
    pub usage_event_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseBalanceTopUpRequest {
    pub database_id: String,
    pub units: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DepositQuote {
    pub database_id: String,
    pub amount_e8s: u64,
    pub expected_fee_e8s: u64,
    pub credited_units: u64,
    pub ledger_canister_id: String,
    pub spender_principal: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DepositResult {
    pub database_id: String,
    pub amount_e8s: u64,
    pub credited_units: u64,
    pub block_index: u64,
    pub balance_units: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct PaymentRecord {
    pub payment_id: String,
    pub database_id: String,
    pub payer_principal: String,
    pub amount_e8s: u64,
    pub credited_units: u64,
    pub block_index: u64,
    pub created_at_ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseTokenScope {
    #[serde(alias = "Read")]
    Read,
    #[serde(alias = "Write")]
    Write,
    #[serde(alias = "Owner")]
    Owner,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseTokenInfo {
    pub token_id: String,
    pub database_id: String,
    pub name: String,
    pub scope: DatabaseTokenScope,
    pub created_at_ms: i64,
    pub last_used_at_ms: Option<i64>,
    pub revoked_at_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct CreateDatabaseTokenRequest {
    pub database_id: String,
    pub name: String,
    pub scope: DatabaseTokenScope,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct CreateDatabaseTokenResponse {
    pub token: String,
    pub info: DatabaseTokenInfo,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseArchiveInfo {
    pub database_id: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseArchiveChunk {
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseArchiveReadRequest {
    pub database_id: String,
    pub offset: u64,
    pub max_bytes: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseArchiveFinalizeRequest {
    pub database_id: String,
    pub snapshot_hash: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseRestoreBeginRequest {
    pub database_id: String,
    pub snapshot_hash: Vec<u8>,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseRestoreChunkRequest {
    pub database_id: String,
    pub offset: u64,
    pub bytes: Vec<u8>,
}
