// Where: crates/vfs_types/src/fs.rs
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
pub struct DatabaseSummary {
    pub database_id: String,
    pub status: DatabaseStatus,
    pub role: DatabaseRole,
    pub logical_size_bytes: u64,
    pub archived_at_ms: Option<i64>,
    pub deleted_at_ms: Option<i64>,
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
pub struct DatabaseRestoreChunkRequest {
    pub database_id: String,
    pub offset: u64,
    pub bytes: Vec<u8>,
}
