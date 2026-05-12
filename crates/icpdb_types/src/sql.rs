// Where: crates/icpdb_types/src/sql.rs
// What: SQL hosting request and response contracts.
// Why: Raw SQLite execution needs a transport-safe value model shared by canister and clients.
use candid::CandidType;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, CandidType)]
#[serde(rename_all = "snake_case")]
pub enum SqlValue {
    #[serde(alias = "Null")]
    Null,
    #[serde(alias = "Integer")]
    Integer(i64),
    #[serde(alias = "Real")]
    Real(f64),
    #[serde(alias = "Text")]
    Text(String),
    #[serde(alias = "Blob")]
    Blob(Vec<u8>),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, CandidType)]
pub struct SqlExecuteRequest {
    pub database_id: String,
    pub sql: String,
    pub params: Vec<SqlValue>,
    pub max_rows: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, CandidType)]
pub struct SqlStatement {
    pub sql: String,
    pub params: Vec<SqlValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, CandidType)]
pub struct SqlBatchRequest {
    pub database_id: String,
    pub statements: Vec<SqlStatement>,
    pub max_rows: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, CandidType)]
pub struct SqlExecuteResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<SqlValue>>,
    pub rows_affected: u64,
    pub last_insert_rowid: i64,
    pub truncated: bool,
}
