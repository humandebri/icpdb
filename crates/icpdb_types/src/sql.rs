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
pub struct DataPlaneSqlExecuteRequest {
    pub operation_id: String,
    pub request: SqlExecuteRequest,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, CandidType)]
pub struct DataPlaneSqlBatchRequest {
    pub operation_id: String,
    pub request: SqlBatchRequest,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, CandidType)]
pub struct SqlExecuteResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<SqlValue>>,
    pub rows_affected: u64,
    pub last_insert_rowid: i64,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseObjectType {
    #[serde(alias = "Table")]
    Table,
    #[serde(alias = "View")]
    View,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseTable {
    pub name: String,
    pub object_type: DatabaseObjectType,
    pub schema_sql: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseColumn {
    pub cid: u32,
    pub name: String,
    pub declared_type: String,
    pub not_null: bool,
    pub default_value: Option<String>,
    pub primary_key_position: u32,
    pub hidden: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseIndex {
    pub name: String,
    pub table_name: String,
    pub unique: bool,
    pub origin: String,
    pub partial: bool,
    pub columns: Vec<DatabaseIndexColumn>,
    pub schema_sql: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseIndexColumn {
    pub seqno: u32,
    pub cid: i64,
    pub name: Option<String>,
    pub descending: bool,
    pub collation: String,
    pub key: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseTrigger {
    pub name: String,
    pub table_name: String,
    pub schema_sql: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct DatabaseForeignKey {
    pub id: u32,
    pub seq: u32,
    pub table_name: String,
    pub from_column: String,
    pub to_column: Option<String>,
    pub on_update: String,
    pub on_delete: String,
    pub match_clause: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct TableDescription {
    pub database_id: String,
    pub table_name: String,
    pub object_type: DatabaseObjectType,
    pub schema_sql: Option<String>,
    pub columns: Vec<DatabaseColumn>,
    pub indexes: Vec<DatabaseIndex>,
    pub triggers: Vec<DatabaseTrigger>,
    pub foreign_keys: Vec<DatabaseForeignKey>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, CandidType)]
pub struct TablePreviewRequest {
    pub database_id: String,
    pub table_name: String,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, CandidType)]
pub struct TablePreviewResponse {
    pub database_id: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<SqlValue>>,
    pub offset: u32,
    pub limit: u32,
    pub total_count: u64,
    pub truncated: bool,
}
