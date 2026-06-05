// Where: crates/icpdb_runtime/src/lib.rs
// What: Service orchestration for the hosted SQLite Admin Protocol reference canister.
// Why: ICPDB demonstrates isolated SQL databases with shared lifecycle, quota, and access control.
mod database_executor;
mod sql;
mod sql_guard;
mod sql_identifier;
mod sql_snapshot;
mod sqlite_facade;
mod table_inspection;
pub use sqlite_facade::{register_path_handle, unregister_path_handle};

use crate::database_executor::{DatabaseExecutor, LocalDatabaseExecutor};
use crate::sqlite_facade::{Connection, OptionalExtension, params};
use icpdb_types::{
    CreateRemoteDatabaseRequest, DataPlaneOperationInfo, DatabaseArchiveInfo,
    DatabaseBalanceTopUpRequest, DatabaseBilling, DatabaseBillingStatus, DatabaseInfo,
    DatabaseMember, DatabaseQuotaRequest, DatabaseRole, DatabaseShardInfo, DatabaseShardPlacement,
    DatabaseStatus, DatabaseSummary, DatabaseTable, DatabaseTokenInfo, DatabaseTokenScope,
    DatabaseUsage, DatabaseUsageEventSummary, DepositQuote, DepositResult,
    MigrateDatabaseToShardRequest, PaymentRecord, RegisterDatabaseShardRequest,
    RoutedOperationInfo, RoutedOperationRequest, RoutedOperationStatus, ShardOperationInfo,
    SqlBatchRequest, SqlExecuteRequest, SqlExecuteResponse, SqlValue, TableDescription,
    TablePreviewRequest, TablePreviewResponse,
};
use sha2::{Digest, Sha256};

const INDEX_SCHEMA_VERSION_INITIAL: &str = "database_index:000_initial";
const INDEX_SCHEMA_VERSION_LIFECYCLE: &str = "database_index:001_lifecycle";
const INDEX_SCHEMA_VERSION_RESTORE_SIZE: &str = "database_index:002_restore_size";
const INDEX_SCHEMA_VERSION_RESTORE_CHUNKS: &str = "database_index:003_restore_chunks";
const INDEX_SCHEMA_VERSION_USAGE_EVENTS: &str = "database_index:004_usage_events";
const INDEX_SCHEMA_VERSION_MOUNT_HISTORY: &str = "database_index:005_mount_history";
const INDEX_SCHEMA_VERSION_QUOTAS: &str = "database_index:006_quotas";
const INDEX_SCHEMA_VERSION_BILLING: &str = "database_index:007_billing";
const INDEX_SCHEMA_VERSION_TOKENS: &str = "database_index:008_tokens";
const INDEX_SCHEMA_VERSION_PAYMENTS: &str = "database_index:009_payments";
const INDEX_SCHEMA_VERSION_BILLING_CONFIG: &str = "database_index:010_billing_config";
const INDEX_SCHEMA_VERSION_RESTORE_CHUNK_BYTES: &str = "database_index:011_restore_chunk_bytes";
const INDEX_SCHEMA_VERSION_USAGE_EVENT_ROWS: &str = "database_index:012_usage_event_rows";
const INDEX_SCHEMA_VERSION_USAGE_EVENT_OPERATION: &str = "database_index:013_usage_event_operation";
const INDEX_SCHEMA_VERSION_SHARD_PLACEMENTS: &str = "database_index:014_shard_placements";
const INDEX_SCHEMA_VERSION_ROUTED_OPERATIONS: &str = "database_index:015_routed_operations";
const INDEX_SCHEMA_VERSION_DATABASE_SHARDS: &str = "database_index:016_database_shards";
const INDEX_SCHEMA_VERSION_SHARD_OPERATIONS: &str = "database_index:017_shard_operations";
const INDEX_SCHEMA_VERSION_DATA_PLANE_OPERATIONS: &str = "database_index:018_data_plane_operations";
const INDEX_SCHEMA_VERSION_ROUTED_OPERATION_BILLING: &str =
    "database_index:019_routed_operation_billing";
const DATABASE_SCHEMA_VERSION: &str = "sqlite:raw";
const LOCAL_SHARD_ID: &str = "local";
const ROUTED_OPERATION_ID_MAX_BYTES: usize = 128;
const ROUTED_OPERATION_METHOD_MAX_BYTES: usize = 96;
const SHARD_OPERATION_ID_MAX_BYTES: usize = 128;
const SHARD_OPERATION_KIND_MAX_BYTES: usize = 96;
const MIN_DATABASE_MOUNT_ID: u16 = 11;
const MAX_DATABASE_MOUNT_ID: u16 = 254;
pub const MAX_ARCHIVE_CHUNK_BYTES: u32 = 1024 * 1024;
pub const MAX_RESTORE_CHUNK_BYTES: usize = 1024 * 1024;
pub const MAX_DATABASE_SIZE_BYTES: u64 = i64::MAX as u64;
pub const DEFAULT_DATABASE_QUOTA_BYTES: u64 = 64 * 1024 * 1024;
pub const DEFAULT_DATABASE_BALANCE_UNITS: u64 = 1_000;
pub const USAGE_EVENTS_RETENTION_LIMIT: u64 = 100_000;
pub use sql::{
    DEFAULT_SQL_MAX_ROWS, MAX_SQL_BATCH_STATEMENTS, MAX_SQL_PARAMS, MAX_SQL_RESPONSE_BYTES,
    MAX_SQL_ROWS, MAX_SQL_TEXT_BYTES,
};
const USAGE_EVENTS_PURGE_INTERVAL: i64 = 100;
const SHA256_DIGEST_BYTES: usize = 32;
const GENERATED_DATABASE_ID_PREFIX: &str = "db_";
const GENERATED_DATABASE_ID_HASH_CHARS: usize = 12;
const GENERATED_TOKEN_ID_PREFIX: &str = "tok_";
const GENERATED_TOKEN_ID_HASH_CHARS: usize = 12;
const GENERATED_PAYMENT_ID_PREFIX: &str = "pay_";
const GENERATED_PAYMENT_ID_HASH_CHARS: usize = 12;
pub const SQL_EXECUTE_BILLING_UNITS: u64 = 5;
pub const ICP_E8S_PER_ICP: u64 = 100_000_000;
pub const ICPDB_UNITS_PER_ICP: u64 = 100_000;
pub const MIN_DEPOSIT_E8S: u64 = 1_000_000;
pub const ICP_TRANSFER_FEE_E8S_DEFAULT: u64 = 10_000;
const BILLING_CONFIG_ICP_TRANSFER_FEE_E8S: &str = "icp_transfer_fee_e8s";
const ANONYMOUS_PRINCIPAL_TEXT: &str = "2vxsx-fae";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DatabaseMeta {
    pub database_id: String,
    pub db_file_name: String,
    pub mount_id: u16,
    pub schema_version: String,
    pub logical_size_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DatabaseRestoreBegin {
    pub meta: DatabaseMeta,
    pub rollback: DatabaseRestoreRollback,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DatabaseRestoreRollback {
    database_id: String,
    status: DatabaseStatus,
    active_mount_id: Option<u16>,
    snapshot_hash: Option<Vec<u8>>,
    archived_at_ms: Option<i64>,
    deleted_at_ms: Option<i64>,
    restore_size_bytes: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteDatabaseCreatePlan {
    pub database_id: String,
    pub database_canister_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequiredRole {
    Reader,
    Writer,
    Owner,
}

pub struct UsageEvent<'a> {
    pub method: &'a str,
    pub operation: Option<&'a str>,
    pub database_id: Option<&'a str>,
    pub caller: &'a str,
    pub success: bool,
    pub cycles_delta: u128,
    pub rows_returned: u64,
    pub rows_affected: u64,
    pub error: Option<&'a str>,
    pub now: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthenticatedDatabaseToken {
    pub token_id: String,
    pub database_id: String,
    pub scope: DatabaseTokenScope,
}

pub struct RoutedWriteBegin<'a> {
    pub operation_id: &'a str,
    pub database_canister_id: &'a str,
    pub method: &'a str,
    pub request_hash: Vec<u8>,
    pub billing_units: u64,
    pub now: i64,
}

struct RoutedOperationBegin<'a> {
    operation_id: &'a str,
    database_id: &'a str,
    database_canister_id: &'a str,
    method: &'a str,
    request_hash: Vec<u8>,
    billing_units: u64,
    now: i64,
}

pub struct IcpdbService {
    index_path: String,
    databases_dir: String,
    database_executor: LocalDatabaseExecutor,
}

impl Drop for IcpdbService {
    fn drop(&mut self) {
        sqlite_facade::clear_registered_connections();
    }
}

impl IcpdbService {
    pub fn new(index_path: impl Into<String>, databases_dir: impl Into<String>) -> Self {
        Self {
            index_path: index_path.into(),
            databases_dir: databases_dir.into(),
            database_executor: LocalDatabaseExecutor,
        }
    }

    pub fn run_index_migrations(&self) -> Result<(), String> {
        let mut conn = self.open_index()?;
        run_index_migrations(&mut conn)
    }

    pub fn list_databases(&self) -> Result<Vec<DatabaseMeta>, String> {
        let conn = self.open_index()?;
        load_databases(&conn)
    }

    pub fn list_database_infos(&self) -> Result<Vec<DatabaseInfo>, String> {
        let conn = self.open_index()?;
        load_database_infos(&conn)
    }

    pub fn list_database_summaries_for_caller(
        &self,
        caller: &str,
    ) -> Result<Vec<DatabaseSummary>, String> {
        let conn = self.open_index()?;
        load_database_summaries_for_caller(&conn, caller)
    }

    pub fn list_database_shard_placements_for_caller(
        &self,
        caller: &str,
    ) -> Result<Vec<DatabaseShardPlacement>, String> {
        let conn = self.open_index()?;
        load_database_shard_placements_for_caller(&conn, caller)
    }

    pub fn list_all_database_shard_placements(
        &self,
    ) -> Result<Vec<DatabaseShardPlacement>, String> {
        let conn = self.open_index()?;
        load_all_database_shard_placements(&conn)
    }

    pub fn register_database_shard(
        &self,
        request: RegisterDatabaseShardRequest,
        now: i64,
    ) -> Result<DatabaseShardInfo, String> {
        validate_database_canister_id(&request.database_canister_id)?;
        if request.max_databases == 0 {
            return Err("max_databases must be greater than zero".to_string());
        }
        let shard_id = database_shard_id(&request.database_canister_id);
        let conn = self.open_index()?;
        conn.execute(
            "INSERT INTO database_shards
             (shard_id, canister_id, status, max_databases, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, 'active', ?3, ?4, ?4)
             ON CONFLICT(shard_id) DO UPDATE SET
               canister_id = excluded.canister_id,
               status = 'active',
               max_databases = excluded.max_databases,
               updated_at_ms = excluded.updated_at_ms",
            params![
                &shard_id,
                &request.database_canister_id,
                i64::from(request.max_databases),
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        load_database_shard(&conn, &shard_id)?
            .ok_or_else(|| "database shard not found after registration".to_string())
    }

    pub fn list_database_shards(&self) -> Result<Vec<DatabaseShardInfo>, String> {
        let conn = self.open_index()?;
        load_database_shards(&conn)
    }

    pub fn database_shard_for_canister(
        &self,
        database_canister_id: &str,
    ) -> Result<DatabaseShardInfo, String> {
        validate_database_canister_id(database_canister_id)?;
        let conn = self.open_index()?;
        load_database_shard(&conn, &database_shard_id(database_canister_id))?
            .ok_or_else(|| "database shard is not registered".to_string())
    }

    pub fn begin_local_database_migration(
        &self,
        request: &MigrateDatabaseToShardRequest,
        now: i64,
    ) -> Result<DatabaseArchiveInfo, String> {
        validate_database_id(&request.database_id)?;
        validate_database_canister_id(&request.database_canister_id)?;
        let conn = self.open_index()?;
        let placement =
            load_database_shard_placement(&conn, &request.database_id)?.ok_or_else(|| {
                format!(
                    "database shard placement not found: {}",
                    request.database_id
                )
            })?;
        if placement.canister_id.is_some() {
            return Err(format!(
                "database is already remote: {}",
                request.database_id
            ));
        }
        if placement.status != DatabaseStatus::Hot {
            return Err(format!(
                "database route is {}: {}",
                status_to_db(placement.status),
                request.database_id
            ));
        }
        ensure_database_shard_has_capacity(&conn, &request.database_canister_id)?;
        self.begin_database_archive_unchecked(&request.database_id, now)
    }

    pub fn cancel_local_database_migration(
        &self,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        let conn = self.open_index()?;
        let placement = load_database_shard_placement(&conn, database_id)?
            .ok_or_else(|| format!("database shard placement not found: {database_id}"))?;
        if placement.canister_id.is_some() {
            return Err(format!("database is already remote: {database_id}"));
        }
        self.cancel_database_archive_unchecked(database_id, now)
    }

    pub fn read_local_database_migration_chunk(
        &self,
        database_id: &str,
        offset: u64,
        max_bytes: u32,
    ) -> Result<Vec<u8>, String> {
        let conn = self.open_index()?;
        let placement = load_database_shard_placement(&conn, database_id)?
            .ok_or_else(|| format!("database shard placement not found: {database_id}"))?;
        if placement.canister_id.is_some() {
            return Err(format!("database is already remote: {database_id}"));
        }
        if placement.status != DatabaseStatus::Archiving {
            return Err(format!(
                "database route is {}: {database_id}",
                status_to_db(placement.status)
            ));
        }
        self.read_database_archive_chunk_unchecked(database_id, offset, max_bytes)
    }

    pub fn complete_local_database_migration(
        &self,
        request: &MigrateDatabaseToShardRequest,
        logical_size_bytes: u64,
        now: i64,
    ) -> Result<(DatabaseShardPlacement, DatabaseMeta), String> {
        validate_database_id(&request.database_id)?;
        validate_database_canister_id(&request.database_canister_id)?;
        let old_meta =
            self.database_meta_with_statuses(&request.database_id, &[DatabaseStatus::Archiving])?;
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let placement =
            load_database_shard_placement(&tx, &request.database_id)?.ok_or_else(|| {
                format!(
                    "database shard placement not found: {}",
                    request.database_id
                )
            })?;
        if placement.canister_id.is_some() {
            return Err(format!(
                "database is already remote: {}",
                request.database_id
            ));
        }
        if placement.status != DatabaseStatus::Archiving {
            return Err(format!(
                "database route is {}: {}",
                status_to_db(placement.status),
                request.database_id
            ));
        }
        ensure_database_shard_has_capacity(&tx, &request.database_canister_id)?;
        let remote_file_name = format!(
            "remote:{}:{}",
            request.database_canister_id, request.database_id
        );
        tx.execute(
            "UPDATE databases
             SET db_file_name = ?2,
                 active_mount_id = NULL,
                 status = 'hot',
                 logical_size_bytes = ?3,
                 snapshot_hash = NULL,
                 archived_at_ms = NULL,
                 restore_size_bytes = NULL,
                 updated_at_ms = ?4
             WHERE database_id = ?1",
            params![
                &request.database_id,
                remote_file_name,
                i64::try_from(logical_size_bytes).map_err(|error| error.to_string())?,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE database_shard_placements
             SET shard_id = ?2,
                 canister_id = ?3,
                 mount_id = NULL,
                 status = 'hot',
                 schema_version = ?4,
                 updated_at_ms = ?5
             WHERE database_id = ?1",
            params![
                &request.database_id,
                database_shard_id(&request.database_canister_id),
                &request.database_canister_id,
                DATABASE_SCHEMA_VERSION,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        let placement = self.database_shard_placement_unchecked(&request.database_id)?;
        Ok((placement, old_meta))
    }

    pub fn remote_database_create_plan(
        &self,
        caller: &str,
        now: i64,
    ) -> Result<Option<RemoteDatabaseCreatePlan>, String> {
        let conn = self.open_index()?;
        let Some(shard) = select_database_shard_for_create(&conn)? else {
            return Ok(None);
        };
        let mut selected_database_id = None;
        for attempt in 0_u32..100 {
            let database_id =
                generated_remote_database_id(caller, now, &shard.canister_id, attempt);
            if !database_exists(&conn, &database_id)? {
                selected_database_id = Some(database_id);
                break;
            }
        }
        let database_id = selected_database_id
            .ok_or_else(|| "failed to generate unique database id".to_string())?;
        Ok(Some(RemoteDatabaseCreatePlan {
            database_id,
            database_canister_id: shard.canister_id,
        }))
    }

    pub fn begin_routed_operation(
        &self,
        operation_id: &str,
        database_id: &str,
        database_canister_id: &str,
        method: &str,
        request_hash: Vec<u8>,
        now: i64,
    ) -> Result<RoutedOperationInfo, String> {
        self.begin_routed_operation_with_billing(RoutedOperationBegin {
            operation_id,
            database_id,
            database_canister_id,
            method,
            request_hash,
            billing_units: 0,
            now,
        })
    }

    fn begin_routed_operation_with_billing(
        &self,
        request: RoutedOperationBegin<'_>,
    ) -> Result<RoutedOperationInfo, String> {
        validate_routed_operation_input(
            request.operation_id,
            request.database_id,
            request.database_canister_id,
            request.method,
            &request.request_hash,
        )?;
        let billing_units_i64 = u64_to_sqlite_i64(request.billing_units, "billing_units")?;
        let mut conn = self.open_index()?;
        load_database_status(&conn, request.database_id)?;
        if let Some(existing) = load_routed_operation(&conn, request.operation_id)? {
            validate_routed_operation_replay(
                &existing,
                request.database_id,
                request.database_canister_id,
                request.method,
                &request.request_hash,
            )?;
            return Ok(existing);
        }
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO routed_operations
             (operation_id, database_id, database_canister_id, method, request_hash,
              status, error, billing_units, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', NULL, ?6, ?7, ?7)",
            params![
                request.operation_id,
                request.database_id,
                request.database_canister_id,
                request.method,
                request.request_hash,
                billing_units_i64,
                request.now
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        load_routed_operation(&conn, request.operation_id)?.ok_or_else(|| {
            format!(
                "routed operation not found after insert: {}",
                request.operation_id
            )
        })
    }

    pub fn update_routed_operation_status(
        &self,
        operation_id: &str,
        status: RoutedOperationStatus,
        error: Option<&str>,
        now: i64,
    ) -> Result<RoutedOperationInfo, String> {
        validate_routed_operation_id(operation_id)?;
        let conn = self.open_index()?;
        let changed = conn
            .execute(
                "UPDATE routed_operations
                 SET status = ?2,
                     error = ?3,
                     updated_at_ms = ?4
                 WHERE operation_id = ?1",
                params![
                    operation_id,
                    routed_operation_status_to_db(status),
                    error,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err(format!("routed operation not found: {operation_id}"));
        }
        load_routed_operation(&conn, operation_id)?
            .ok_or_else(|| format!("routed operation not found after update: {operation_id}"))
    }

    pub fn begin_routed_write_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: RoutedWriteBegin<'_>,
    ) -> Result<RoutedOperationInfo, String> {
        if !token_scope_allows(auth.scope, RequiredRole::Writer) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.ensure_database_has_units(&auth.database_id, request.billing_units)?;
        self.begin_routed_operation_with_billing(RoutedOperationBegin {
            operation_id: request.operation_id,
            database_id: &auth.database_id,
            database_canister_id: request.database_canister_id,
            method: request.method,
            request_hash: request.request_hash,
            billing_units: request.billing_units,
            now: request.now,
        })
    }

    pub fn begin_routed_write(
        &self,
        caller: &str,
        database_id: &str,
        request: RoutedWriteBegin<'_>,
    ) -> Result<RoutedOperationInfo, String> {
        self.require_role(database_id, caller, RequiredRole::Writer)?;
        self.ensure_database_has_units(database_id, request.billing_units)?;
        self.begin_routed_operation_with_billing(RoutedOperationBegin {
            operation_id: request.operation_id,
            database_id,
            database_canister_id: request.database_canister_id,
            method: request.method,
            request_hash: request.request_hash,
            billing_units: request.billing_units,
            now: request.now,
        })
    }

    pub fn complete_routed_write_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        operation_id: &str,
        billing_units: u64,
        logical_size_bytes: u64,
        now: i64,
    ) -> Result<RoutedOperationInfo, String> {
        if !token_scope_allows(auth.scope, RequiredRole::Writer) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.charge_database_units(&auth.database_id, billing_units)?;
        self.set_logical_size(&auth.database_id, logical_size_bytes)?;
        self.update_routed_operation_status(operation_id, RoutedOperationStatus::Applied, None, now)
    }

    pub fn complete_routed_write(
        &self,
        caller: &str,
        database_id: &str,
        operation_id: &str,
        billing_units: u64,
        logical_size_bytes: u64,
        now: i64,
    ) -> Result<RoutedOperationInfo, String> {
        self.require_role(database_id, caller, RequiredRole::Writer)?;
        self.charge_database_units(database_id, billing_units)?;
        self.set_logical_size(database_id, logical_size_bytes)?;
        self.update_routed_operation_status(operation_id, RoutedOperationStatus::Applied, None, now)
    }

    pub fn reconcile_routed_write_from_data_plane(
        &self,
        operation_id: &str,
        logical_size_bytes: u64,
        now: i64,
    ) -> Result<RoutedOperationInfo, String> {
        validate_routed_operation_id(operation_id)?;
        let conn = self.open_index()?;
        let operation = load_routed_operation(&conn, operation_id)?
            .ok_or_else(|| format!("routed operation not found: {operation_id}"))?;
        if operation.status != RoutedOperationStatus::Unknown {
            return Err(format!("routed operation is not unknown: {operation_id}"));
        }
        let billing_units = load_routed_operation_billing_units(&conn, operation_id)?;
        if billing_units == 0 {
            return Err(format!(
                "routed operation has no billable write units: {operation_id}"
            ));
        }
        drop(conn);
        self.charge_database_units(&operation.database_id, billing_units)?;
        self.set_logical_size(&operation.database_id, logical_size_bytes)?;
        self.update_routed_operation_status(operation_id, RoutedOperationStatus::Applied, None, now)
    }

    pub fn begin_shard_operation(
        &self,
        operation_id: &str,
        operation_kind: &str,
        target: Option<&str>,
        request_hash: Vec<u8>,
        now: i64,
    ) -> Result<ShardOperationInfo, String> {
        validate_shard_operation_input(operation_id, operation_kind, target, &request_hash)?;
        let mut conn = self.open_index()?;
        if let Some(existing) = load_shard_operation(&conn, operation_id)? {
            validate_shard_operation_replay(&existing, operation_kind, target, &request_hash)?;
            return Ok(existing);
        }
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO shard_operations
             (operation_id, operation_kind, target, request_hash, status,
              error, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, 'pending', NULL, ?5, ?5)",
            params![operation_id, operation_kind, target, request_hash, now],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        load_shard_operation(&conn, operation_id)?
            .ok_or_else(|| format!("shard operation not found after insert: {operation_id}"))
    }

    pub fn update_shard_operation_status(
        &self,
        operation_id: &str,
        status: RoutedOperationStatus,
        error: Option<&str>,
        now: i64,
    ) -> Result<ShardOperationInfo, String> {
        validate_shard_operation_id(operation_id)?;
        let conn = self.open_index()?;
        let changed = conn
            .execute(
                "UPDATE shard_operations
                 SET status = ?2,
                     error = ?3,
                     updated_at_ms = ?4
                 WHERE operation_id = ?1",
                params![
                    operation_id,
                    routed_operation_status_to_db(status),
                    error,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err(format!("shard operation not found: {operation_id}"));
        }
        load_shard_operation(&conn, operation_id)?
            .ok_or_else(|| format!("shard operation not found after update: {operation_id}"))
    }

    pub fn shard_operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<ShardOperationInfo>, String> {
        validate_shard_operation_id(operation_id)?;
        load_shard_operation(&self.open_index()?, operation_id)
    }

    pub fn reconcile_shard_operation(
        &self,
        operation_id: &str,
        status: RoutedOperationStatus,
        error: Option<&str>,
        now: i64,
    ) -> Result<ShardOperationInfo, String> {
        validate_shard_operation_id(operation_id)?;
        validate_shard_operation_reconcile(status, error)?;
        let conn = self.open_index()?;
        let existing = load_shard_operation(&conn, operation_id)?
            .ok_or_else(|| format!("shard operation not found: {operation_id}"))?;
        if existing.status != RoutedOperationStatus::Unknown {
            return Err(format!("shard operation is not unknown: {operation_id}"));
        }
        let next_error = match status {
            RoutedOperationStatus::Applied => None,
            RoutedOperationStatus::Failed => error,
            RoutedOperationStatus::Pending | RoutedOperationStatus::Unknown => {
                return Err(
                    "shard operation reconcile status must be applied or failed".to_string()
                );
            }
        };
        conn.execute(
            "UPDATE shard_operations
             SET status = ?2,
                 error = ?3,
                 updated_at_ms = ?4
             WHERE operation_id = ?1",
            params![
                operation_id,
                routed_operation_status_to_db(status),
                next_error,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        load_shard_operation(&conn, operation_id)?
            .ok_or_else(|| format!("shard operation not found after reconcile: {operation_id}"))
    }

    pub fn list_shard_operations(&self) -> Result<Vec<ShardOperationInfo>, String> {
        load_shard_operations(&self.open_index()?)
    }

    pub fn mark_remote_database_archiving_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        now: i64,
    ) -> Result<(), String> {
        self.remote_database_route_with_token(
            auth,
            database_id,
            RequiredRole::Owner,
            &[DatabaseStatus::Hot],
        )?;
        self.mark_remote_database_archiving_unchecked(database_id, now)
    }

    pub fn mark_remote_database_archiving(
        &self,
        caller: &str,
        database_id: &str,
        now: i64,
    ) -> Result<(), String> {
        self.remote_database_route(
            database_id,
            caller,
            RequiredRole::Owner,
            &[DatabaseStatus::Hot],
        )?;
        self.mark_remote_database_archiving_unchecked(database_id, now)
    }

    fn mark_remote_database_archiving_unchecked(
        &self,
        database_id: &str,
        now: i64,
    ) -> Result<(), String> {
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET status = 'archiving',
                 updated_at_ms = ?2
             WHERE database_id = ?1",
            params![database_id, now],
        )
        .map_err(|error| error.to_string())?;
        update_shard_placement_status(&conn, database_id, DatabaseStatus::Archiving, now)
    }

    pub fn mark_remote_database_archived_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        now: i64,
    ) -> Result<(), String> {
        validate_snapshot_hash(&snapshot_hash)?;
        self.remote_database_route_with_token(
            auth,
            database_id,
            RequiredRole::Owner,
            &[DatabaseStatus::Archiving],
        )?;
        self.mark_remote_database_archived_unchecked(database_id, snapshot_hash, now)
    }

    pub fn mark_remote_database_archived(
        &self,
        caller: &str,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        now: i64,
    ) -> Result<(), String> {
        validate_snapshot_hash(&snapshot_hash)?;
        self.remote_database_route(
            database_id,
            caller,
            RequiredRole::Owner,
            &[DatabaseStatus::Archiving],
        )?;
        self.mark_remote_database_archived_unchecked(database_id, snapshot_hash, now)
    }

    fn mark_remote_database_archived_unchecked(
        &self,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        now: i64,
    ) -> Result<(), String> {
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET status = 'archived',
                 active_mount_id = NULL,
                 snapshot_hash = ?2,
                 restore_size_bytes = NULL,
                 archived_at_ms = ?3,
                 updated_at_ms = ?3
             WHERE database_id = ?1",
            params![database_id, snapshot_hash, now],
        )
        .map_err(|error| error.to_string())?;
        update_shard_placement_status(&conn, database_id, DatabaseStatus::Archived, now)
    }

    pub fn mark_remote_database_restoring_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        size_bytes: u64,
        now: i64,
    ) -> Result<(), String> {
        validate_snapshot_hash(&snapshot_hash)?;
        if size_bytes > MAX_DATABASE_SIZE_BYTES {
            return Err(format!(
                "database size exceeds limit: {size_bytes} > {MAX_DATABASE_SIZE_BYTES}"
            ));
        }
        self.remote_database_route_with_token(
            auth,
            database_id,
            RequiredRole::Owner,
            &[DatabaseStatus::Archived, DatabaseStatus::Deleted],
        )?;
        self.mark_remote_database_restoring_unchecked(database_id, snapshot_hash, size_bytes, now)
    }

    pub fn mark_remote_database_restoring(
        &self,
        caller: &str,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        size_bytes: u64,
        now: i64,
    ) -> Result<(), String> {
        validate_snapshot_hash(&snapshot_hash)?;
        if size_bytes > MAX_DATABASE_SIZE_BYTES {
            return Err(format!(
                "database size exceeds limit: {size_bytes} > {MAX_DATABASE_SIZE_BYTES}"
            ));
        }
        self.remote_database_route(
            database_id,
            caller,
            RequiredRole::Owner,
            &[DatabaseStatus::Archived, DatabaseStatus::Deleted],
        )?;
        self.mark_remote_database_restoring_unchecked(database_id, snapshot_hash, size_bytes, now)
    }

    fn mark_remote_database_restoring_unchecked(
        &self,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        size_bytes: u64,
        now: i64,
    ) -> Result<(), String> {
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET status = 'restoring',
                 active_mount_id = NULL,
                 snapshot_hash = ?2,
                 archived_at_ms = NULL,
                 deleted_at_ms = NULL,
                 restore_size_bytes = ?3,
                 updated_at_ms = ?4
             WHERE database_id = ?1",
            params![
                database_id,
                snapshot_hash,
                i64::try_from(size_bytes).map_err(|error| error.to_string())?,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        update_shard_placement_status(&conn, database_id, DatabaseStatus::Restoring, now)
    }

    pub fn mark_remote_database_hot_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        logical_size_bytes: u64,
        now: i64,
    ) -> Result<(), String> {
        self.remote_database_route_with_token(
            auth,
            database_id,
            RequiredRole::Owner,
            &[DatabaseStatus::Archiving, DatabaseStatus::Restoring],
        )?;
        self.mark_remote_database_hot_unchecked(database_id, logical_size_bytes, now)
    }

    pub fn mark_remote_database_hot(
        &self,
        caller: &str,
        database_id: &str,
        logical_size_bytes: u64,
        now: i64,
    ) -> Result<(), String> {
        self.remote_database_route(
            database_id,
            caller,
            RequiredRole::Owner,
            &[DatabaseStatus::Archiving, DatabaseStatus::Restoring],
        )?;
        self.mark_remote_database_hot_unchecked(database_id, logical_size_bytes, now)
    }

    fn mark_remote_database_hot_unchecked(
        &self,
        database_id: &str,
        logical_size_bytes: u64,
        now: i64,
    ) -> Result<(), String> {
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET status = 'hot',
                 logical_size_bytes = ?2,
                 restore_size_bytes = NULL,
                 updated_at_ms = ?3
             WHERE database_id = ?1",
            params![
                database_id,
                i64::try_from(logical_size_bytes).unwrap_or(i64::MAX),
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        update_shard_placement_status(&conn, database_id, DatabaseStatus::Hot, now)
    }

    pub fn mark_remote_database_deleted_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        now: i64,
    ) -> Result<(), String> {
        self.remote_database_route_with_token(
            auth,
            database_id,
            RequiredRole::Owner,
            &[DatabaseStatus::Hot, DatabaseStatus::Archived],
        )?;
        self.mark_remote_database_deleted_unchecked(database_id, now)
    }

    pub fn mark_remote_database_deleted(
        &self,
        caller: &str,
        database_id: &str,
        now: i64,
    ) -> Result<(), String> {
        self.remote_database_route(
            database_id,
            caller,
            RequiredRole::Owner,
            &[DatabaseStatus::Hot, DatabaseStatus::Archived],
        )?;
        self.mark_remote_database_deleted_unchecked(database_id, now)
    }

    fn mark_remote_database_deleted_unchecked(
        &self,
        database_id: &str,
        now: i64,
    ) -> Result<(), String> {
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET status = 'deleted',
                 active_mount_id = NULL,
                 logical_size_bytes = 0,
                 restore_size_bytes = NULL,
                 deleted_at_ms = ?2,
                 updated_at_ms = ?2
             WHERE database_id = ?1",
            params![database_id, now],
        )
        .map_err(|error| error.to_string())?;
        update_shard_placement_status(&tx, database_id, DatabaseStatus::Deleted, now)?;
        tx.commit().map_err(|error| error.to_string())
    }

    pub fn routed_operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<RoutedOperationInfo>, String> {
        validate_routed_operation_id(operation_id)?;
        let conn = self.open_index()?;
        load_routed_operation(&conn, operation_id)
    }

    pub fn record_data_plane_operation(
        &self,
        operation_id: &str,
        database_id: &str,
        method: &str,
        request_hash: Vec<u8>,
        now: i64,
    ) -> Result<DataPlaneOperationInfo, String> {
        validate_data_plane_operation_input(operation_id, database_id, method, &request_hash)?;
        let conn = self.open_index()?;
        if let Some(existing) = load_data_plane_operation(&conn, operation_id)? {
            validate_data_plane_operation_replay(&existing, database_id, method, &request_hash)?;
            return Ok(existing);
        }
        conn.execute(
            "INSERT INTO data_plane_operations
             (operation_id, database_id, method, request_hash, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![operation_id, database_id, method, request_hash, now],
        )
        .map_err(|error| error.to_string())?;
        load_data_plane_operation(&conn, operation_id)?
            .ok_or_else(|| format!("data-plane operation not found after insert: {operation_id}"))
    }

    pub fn data_plane_operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<DataPlaneOperationInfo>, String> {
        validate_routed_operation_id(operation_id)?;
        let conn = self.open_index()?;
        load_data_plane_operation(&conn, operation_id)
    }

    pub fn routed_operation_for_caller(
        &self,
        request: RoutedOperationRequest,
        caller: &str,
    ) -> Result<RoutedOperationInfo, String> {
        self.require_role(&request.database_id, caller, RequiredRole::Reader)?;
        self.routed_operation_for_database(&request.database_id, &request.operation_id)
    }

    pub fn routed_operation_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: RoutedOperationRequest,
    ) -> Result<RoutedOperationInfo, String> {
        if auth.database_id != request.database_id {
            return Err("api token database_id does not match request".to_string());
        }
        if !token_scope_allows(auth.scope, RequiredRole::Reader) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.routed_operation_for_database(&request.database_id, &request.operation_id)
    }

    fn routed_operation_for_database(
        &self,
        database_id: &str,
        operation_id: &str,
    ) -> Result<RoutedOperationInfo, String> {
        let operation = self
            .routed_operation(operation_id)?
            .ok_or_else(|| format!("routed operation not found: {operation_id}"))?;
        if operation.database_id != database_id {
            return Err(format!("routed operation not found: {operation_id}"));
        }
        Ok(operation)
    }

    pub fn record_usage_event(&self, event: UsageEvent<'_>) -> Result<(), String> {
        let conn = self.open_index()?;
        conn.execute(
            "INSERT INTO usage_events
             (method, operation, database_id, caller, success, cycles_delta, rows_returned, rows_affected, error, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                event.method,
                event.operation,
                event.database_id,
                event.caller,
                if event.success { 1_i64 } else { 0_i64 },
                i64::try_from(event.cycles_delta).unwrap_or(i64::MAX),
                i64::try_from(event.rows_returned).unwrap_or(i64::MAX),
                i64::try_from(event.rows_affected).unwrap_or(i64::MAX),
                event.error,
                event.now
            ],
        )
        .map_err(|error| error.to_string())?;
        let event_id = conn.last_insert_rowid();
        if event_id % USAGE_EVENTS_PURGE_INTERVAL == 0 {
            let _ = purge_old_usage_events(&conn);
        }
        Ok(())
    }

    pub fn usage_event_count(&self) -> Result<u64, String> {
        let conn = self.open_index()?;
        conn.query_row("SELECT COUNT(*) FROM usage_events", params![], |row| {
            row.get::<_, i64>(0)
        })
        .map(|count| count.max(0) as u64)
        .map_err(|error| error.to_string())
    }

    #[doc(hidden)]
    pub fn debug_index_execute_sql(&self, sql: &str, params: Vec<SqlValue>) -> Result<(), String> {
        let conn = self.open_index()?;
        let values = params
            .iter()
            .map(sql::sql_value_to_sqlite)
            .collect::<Vec<_>>();
        conn.execute(sql, sqlite_facade::params_from_iter(values.iter()))
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    #[doc(hidden)]
    pub fn debug_index_query_sql(
        &self,
        sql: &str,
        params: Vec<SqlValue>,
    ) -> Result<Vec<Vec<SqlValue>>, String> {
        let conn = self.open_index()?;
        let values = params
            .iter()
            .map(sql::sql_value_to_sqlite)
            .collect::<Vec<_>>();
        let mut statement = conn.prepare(sql).map_err(|error| error.to_string())?;
        let column_count = statement.column_count();
        let mut rows = statement
            .query(sqlite_facade::params_from_iter(values.iter()))
            .map_err(|error| error.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|error| error.to_string())? {
            let mut out_row = Vec::with_capacity(column_count);
            for index in 0..column_count {
                out_row.push(sql::sql_value_from_ref(
                    row.get_ref(index).map_err(|error| error.to_string())?,
                ));
            }
            out.push(out_row);
        }
        Ok(out)
    }

    pub fn database_usage(&self, database_id: &str, caller: &str) -> Result<DatabaseUsage, String> {
        self.require_role(database_id, caller, RequiredRole::Reader)?;
        self.database_usage_unchecked(database_id)
    }

    pub fn database_usage_event_summaries(
        &self,
        database_id: &str,
        caller: &str,
    ) -> Result<Vec<DatabaseUsageEventSummary>, String> {
        self.require_role(database_id, caller, RequiredRole::Reader)?;
        self.database_usage_event_summaries_unchecked(database_id)
    }

    fn database_usage_unchecked(&self, database_id: &str) -> Result<DatabaseUsage, String> {
        let conn = self.open_index()?;
        load_database_usage(&conn, database_id)
    }

    fn database_usage_event_summaries_unchecked(
        &self,
        database_id: &str,
    ) -> Result<Vec<DatabaseUsageEventSummary>, String> {
        let conn = self.open_index()?;
        load_database_usage(&conn, database_id)?;
        load_database_usage_event_summaries(&conn, database_id)
    }

    pub fn set_database_quota(
        &self,
        caller: &str,
        request: DatabaseQuotaRequest,
    ) -> Result<DatabaseUsage, String> {
        self.require_role(&request.database_id, caller, RequiredRole::Owner)?;
        self.set_database_quota_unchecked(request)
    }

    pub fn set_database_quota_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: DatabaseQuotaRequest,
    ) -> Result<DatabaseUsage, String> {
        if auth.database_id != request.database_id {
            return Err("api token database_id does not match request".to_string());
        }
        if !token_scope_allows(auth.scope, RequiredRole::Owner) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.set_database_quota_unchecked(request)
    }

    fn set_database_quota_unchecked(
        &self,
        request: DatabaseQuotaRequest,
    ) -> Result<DatabaseUsage, String> {
        if request.max_logical_size_bytes == 0 {
            return Err("max_logical_size_bytes must be greater than 0".to_string());
        }
        let current_size = self
            .database_usage_unchecked(&request.database_id)?
            .logical_size_bytes;
        if request.max_logical_size_bytes < current_size {
            return Err(format!(
                "quota is below current database size: {} < {}",
                request.max_logical_size_bytes, current_size
            ));
        }
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET max_logical_size_bytes = ?2
             WHERE database_id = ?1",
            params![
                &request.database_id,
                i64::try_from(request.max_logical_size_bytes).unwrap_or(i64::MAX)
            ],
        )
        .map_err(|error| error.to_string())?;
        self.database_usage_unchecked(&request.database_id)
    }

    pub fn database_billing(
        &self,
        database_id: &str,
        caller: &str,
    ) -> Result<DatabaseBilling, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.load_database_billing(database_id)
    }

    pub fn top_up_database_balance(
        &self,
        request: DatabaseBalanceTopUpRequest,
    ) -> Result<DatabaseBilling, String> {
        if request.units == 0 {
            return Err("units must be greater than 0".to_string());
        }
        let units = u64_to_sqlite_i64(request.units, "units")?;
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET billing_balance_units = billing_balance_units + ?2,
                 billing_status = 'active'
             WHERE database_id = ?1",
            params![&request.database_id, units],
        )
        .map_err(|error| error.to_string())?;
        self.load_database_billing(&request.database_id)
    }

    pub fn icp_transfer_fee_e8s(&self) -> Result<u64, String> {
        let conn = self.open_index()?;
        load_billing_config_u64(&conn, BILLING_CONFIG_ICP_TRANSFER_FEE_E8S)
            .map(|fee| fee.unwrap_or(ICP_TRANSFER_FEE_E8S_DEFAULT))
    }

    pub fn update_icp_transfer_fee_from_bad_fee(
        &self,
        expected_fee_e8s: u64,
        now: i64,
    ) -> Result<u64, String> {
        if expected_fee_e8s == 0 {
            return Err("expected_fee_e8s must be greater than 0".to_string());
        }
        let expected_fee_i64 = u64_to_sqlite_i64(expected_fee_e8s, "expected_fee_e8s")?;
        let conn = self.open_index()?;
        conn.execute(
            "INSERT INTO billing_config (key, value_u64, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
               value_u64 = excluded.value_u64,
               updated_at_ms = excluded.updated_at_ms",
            params![BILLING_CONFIG_ICP_TRANSFER_FEE_E8S, expected_fee_i64, now],
        )
        .map_err(|error| error.to_string())?;
        Ok(expected_fee_e8s)
    }

    pub fn deposit_quote(
        &self,
        database_id: &str,
        caller: &str,
        amount_e8s: u64,
        ledger_canister_id: &str,
        spender_principal: &str,
    ) -> Result<DepositQuote, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        let expected_fee_e8s = self.icp_transfer_fee_e8s()?;
        Ok(DepositQuote {
            database_id: database_id.to_string(),
            amount_e8s,
            expected_fee_e8s,
            credited_units: credited_units_for_deposit(amount_e8s)?,
            ledger_canister_id: ledger_canister_id.to_string(),
            spender_principal: spender_principal.to_string(),
        })
    }

    pub fn record_approved_deposit(
        &self,
        database_id: &str,
        payer_principal: &str,
        amount_e8s: u64,
        ledger_canister_id: &str,
        block_index: u64,
        now: i64,
    ) -> Result<DepositResult, String> {
        self.require_role(database_id, payer_principal, RequiredRole::Owner)?;
        let credited_units = credited_units_for_deposit(amount_e8s)?;
        let payment_id = generated_payment_id(
            database_id,
            payer_principal,
            ledger_canister_id,
            block_index,
        );
        let original_amount_e8s = amount_e8s;
        let amount_e8s = u64_to_sqlite_i64(amount_e8s, "amount_e8s")?;
        let credited_units_i64 = u64_to_sqlite_i64(credited_units, "credited_units")?;
        let block_index_i64 = u64_to_sqlite_i64(block_index, "block_index")?;
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        if load_payment_by_block(&tx, block_index)?.is_some() {
            return Err(format!("payment block already recorded: {block_index}"));
        }
        tx.execute(
            "INSERT INTO payments
             (payment_id, database_id, payer_principal, amount_e8s, credited_units,
              ledger_canister_id, block_index, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &payment_id,
                database_id,
                payer_principal,
                amount_e8s,
                credited_units_i64,
                ledger_canister_id,
                block_index_i64,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET billing_balance_units = billing_balance_units + ?2,
                 billing_status = 'active'
             WHERE database_id = ?1",
            params![database_id, credited_units_i64],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        let balance = self.load_database_billing(database_id)?;
        Ok(DepositResult {
            database_id: database_id.to_string(),
            amount_e8s: original_amount_e8s,
            credited_units,
            block_index,
            balance_units: balance.balance_units,
        })
    }

    pub fn deposit_result_for_existing_payment(
        &self,
        database_id: &str,
        payer_principal: &str,
        block_index: u64,
    ) -> Result<DepositResult, String> {
        self.require_role(database_id, payer_principal, RequiredRole::Owner)?;
        let payment = self
            .payment_for_block(block_index)?
            .ok_or_else(|| format!("duplicate block is not recorded: {block_index}"))?;
        if payment.database_id != database_id || payment.payer_principal != payer_principal {
            return Err(format!(
                "duplicate block belongs to another payment: {block_index}"
            ));
        }
        let balance = self.load_database_billing(database_id)?;
        Ok(DepositResult {
            database_id: payment.database_id,
            amount_e8s: payment.amount_e8s,
            credited_units: payment.credited_units,
            block_index: payment.block_index,
            balance_units: balance.balance_units,
        })
    }

    pub fn payment_for_block(&self, block_index: u64) -> Result<Option<PaymentRecord>, String> {
        let conn = self.open_index()?;
        load_payment_by_block(&conn, block_index)
    }

    pub fn list_payments(
        &self,
        database_id: &str,
        caller: &str,
    ) -> Result<Vec<PaymentRecord>, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        let conn = self.open_index()?;
        load_payments(&conn, database_id)
    }

    pub fn list_payments_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<Vec<PaymentRecord>, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        let conn = self.open_index()?;
        load_payments(&conn, database_id)
    }

    pub fn create_database_token(
        &self,
        caller: &str,
        request: icpdb_types::CreateDatabaseTokenRequest,
        token_hash: Vec<u8>,
        now: i64,
    ) -> Result<DatabaseTokenInfo, String> {
        self.validate_create_database_token(caller, &request)?;
        self.create_database_token_unchecked(request, token_hash, now)
    }

    pub fn create_database_token_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: icpdb_types::CreateDatabaseTokenRequest,
        token_hash: Vec<u8>,
        now: i64,
    ) -> Result<DatabaseTokenInfo, String> {
        self.require_owner_token_for_database(auth, &request.database_id)?;
        validate_database_token_name(&request.name)?;
        self.create_database_token_unchecked(request, token_hash, now)
    }

    fn create_database_token_unchecked(
        &self,
        request: icpdb_types::CreateDatabaseTokenRequest,
        token_hash: Vec<u8>,
        now: i64,
    ) -> Result<DatabaseTokenInfo, String> {
        validate_token_hash(&token_hash)?;
        let token_id = generated_token_id(&token_hash);
        let conn = self.open_index()?;
        conn.execute(
            "INSERT INTO database_tokens
             (token_id, database_id, name, scope, token_hash, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                &token_id,
                &request.database_id,
                &request.name,
                token_scope_to_db(request.scope),
                token_hash,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        Ok(DatabaseTokenInfo {
            token_id,
            database_id: request.database_id,
            name: request.name,
            scope: request.scope,
            created_at_ms: now,
            last_used_at_ms: None,
            revoked_at_ms: None,
        })
    }

    pub fn validate_create_database_token(
        &self,
        caller: &str,
        request: &icpdb_types::CreateDatabaseTokenRequest,
    ) -> Result<(), String> {
        self.require_role(&request.database_id, caller, RequiredRole::Owner)?;
        validate_database_token_name(&request.name)
    }

    pub fn list_database_tokens(
        &self,
        database_id: &str,
        caller: &str,
    ) -> Result<Vec<DatabaseTokenInfo>, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.list_database_tokens_unchecked(database_id)
    }

    pub fn list_database_tokens_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<Vec<DatabaseTokenInfo>, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.list_database_tokens_unchecked(database_id)
    }

    fn list_database_tokens_unchecked(
        &self,
        database_id: &str,
    ) -> Result<Vec<DatabaseTokenInfo>, String> {
        let conn = self.open_index()?;
        load_database_tokens(&conn, database_id)
    }

    pub fn revoke_database_token(
        &self,
        database_id: &str,
        token_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseTokenInfo, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.revoke_database_token_unchecked(database_id, token_id, now)
    }

    pub fn revoke_database_token_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        token_id: &str,
        now: i64,
    ) -> Result<DatabaseTokenInfo, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.revoke_database_token_unchecked(database_id, token_id, now)
    }

    fn revoke_database_token_unchecked(
        &self,
        database_id: &str,
        token_id: &str,
        now: i64,
    ) -> Result<DatabaseTokenInfo, String> {
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE database_tokens
             SET revoked_at_ms = COALESCE(revoked_at_ms, ?3)
             WHERE database_id = ?1 AND token_id = ?2",
            params![database_id, token_id, now],
        )
        .map_err(|error| error.to_string())?;
        load_database_token(&conn, database_id, token_id)?
            .ok_or_else(|| format!("database token not found: {token_id}"))
    }

    fn require_owner_token_for_database(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<(), String> {
        if auth.database_id != database_id {
            return Err("api token database_id does not match request".to_string());
        }
        if !token_scope_allows(auth.scope, RequiredRole::Owner) {
            return Err("api token scope does not allow this operation".to_string());
        }
        Ok(())
    }

    pub fn authenticate_database_token(
        &self,
        token: &str,
        required_role: RequiredRole,
        now: i64,
    ) -> Result<AuthenticatedDatabaseToken, String> {
        let token_hash = hash_api_token(token);
        let conn = self.open_index()?;
        let token = conn
            .query_row(
                "SELECT token_id, database_id, scope, revoked_at_ms
                 FROM database_tokens
                 WHERE token_hash = ?1",
                params![token_hash],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        token_scope_from_db(&row.get::<_, String>(2)?)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "invalid api token".to_string())?;
        if token.3.is_some() {
            return Err("api token revoked".to_string());
        }
        if !token_scope_allows(token.2, required_role) {
            return Err("api token scope does not allow this operation".to_string());
        }
        conn.execute(
            "UPDATE database_tokens
             SET last_used_at_ms = ?2
             WHERE token_id = ?1",
            params![&token.0, now],
        )
        .map_err(|error| error.to_string())?;
        Ok(AuthenticatedDatabaseToken {
            token_id: token.0,
            database_id: token.1,
            scope: token.2,
        })
    }

    pub fn create_database(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        let meta = self.reserve_database(database_id, caller, now)?;
        self.run_database_migrations(database_id)?;
        Ok(meta)
    }

    pub fn create_generated_database(
        &self,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        let meta = self.reserve_generated_database(caller, now)?;
        self.run_database_migrations(&meta.database_id)?;
        Ok(meta)
    }

    pub fn reserve_generated_database(
        &self,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let mount_id = allocate_mount_id(&tx)?;
        let mut selected_database_id = None;
        for attempt in 0_u32..100 {
            let database_id = generated_database_id(caller, now, mount_id, attempt);
            if !database_exists(&tx, &database_id)? {
                selected_database_id = Some(database_id);
                break;
            }
        }
        let database_id = selected_database_id
            .ok_or_else(|| "failed to generate unique database id".to_string())?;
        let db_file_name = database_file_name(&self.databases_dir, &database_id)?;
        tx.execute(
            "INSERT INTO databases
             (database_id, db_file_name, mount_id, active_mount_id, status, schema_version,
              logical_size_bytes, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?3, 'hot', ?4, 0, ?5, ?5)",
            params![
                database_id,
                db_file_name,
                i64::from(mount_id),
                DATABASE_SCHEMA_VERSION,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        record_mount_history(&tx, &database_id, mount_id, "create", now)?;
        record_shard_placement(
            &tx,
            &database_id,
            Some(mount_id),
            DatabaseStatus::Hot,
            DATABASE_SCHEMA_VERSION,
            now,
        )?;
        tx.execute(
            "INSERT INTO database_members
             (database_id, principal, role, created_at_ms)
             VALUES (?1, ?2, 'owner', ?3)",
            params![database_id, caller, now],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(DatabaseMeta {
            database_id,
            db_file_name,
            mount_id,
            schema_version: DATABASE_SCHEMA_VERSION.to_string(),
            logical_size_bytes: 0,
        })
    }

    pub fn reserve_database(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        validate_database_id(database_id)?;
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        if database_exists(&tx, database_id)? {
            return Err(format!("database already exists: {database_id}"));
        }
        let mount_id = allocate_mount_id(&tx)?;
        let db_file_name = database_file_name(&self.databases_dir, database_id)?;
        tx.execute(
            "INSERT INTO databases
             (database_id, db_file_name, mount_id, active_mount_id, status, schema_version,
              logical_size_bytes, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?3, 'hot', ?4, 0, ?5, ?5)",
            params![
                database_id,
                db_file_name,
                i64::from(mount_id),
                DATABASE_SCHEMA_VERSION,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        record_mount_history(&tx, database_id, mount_id, "create", now)?;
        record_shard_placement(
            &tx,
            database_id,
            Some(mount_id),
            DatabaseStatus::Hot,
            DATABASE_SCHEMA_VERSION,
            now,
        )?;
        tx.execute(
            "INSERT INTO database_members
             (database_id, principal, role, created_at_ms)
             VALUES (?1, ?2, 'owner', ?3)",
            params![database_id, caller, now],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(DatabaseMeta {
            database_id: database_id.to_string(),
            db_file_name,
            mount_id,
            schema_version: DATABASE_SCHEMA_VERSION.to_string(),
            logical_size_bytes: 0,
        })
    }

    pub fn register_remote_database(
        &self,
        request: CreateRemoteDatabaseRequest,
        owner: &str,
        now: i64,
    ) -> Result<DatabaseInfo, String> {
        validate_database_id(&request.database_id)?;
        if request.database_canister_id.trim().is_empty() {
            return Err("database_canister_id must not be empty".to_string());
        }
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        if database_exists(&tx, &request.database_id)? {
            return Err(format!("database already exists: {}", request.database_id));
        }
        ensure_database_shard_has_capacity(&tx, &request.database_canister_id)?;
        let mount_id = allocate_mount_id(&tx)?;
        let db_file_name = format!(
            "remote:{}:{}",
            request.database_canister_id, request.database_id
        );
        tx.execute(
            "INSERT INTO databases
             (database_id, db_file_name, mount_id, active_mount_id, status, schema_version,
              logical_size_bytes, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, NULL, 'hot', ?4, 0, ?5, ?5)",
            params![
                &request.database_id,
                db_file_name,
                i64::from(mount_id),
                DATABASE_SCHEMA_VERSION,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        record_shard_placement(
            &tx,
            &request.database_id,
            None,
            DatabaseStatus::Hot,
            DATABASE_SCHEMA_VERSION,
            now,
        )?;
        tx.execute(
            "UPDATE database_shard_placements
             SET shard_id = ?2,
                 canister_id = ?3,
                 updated_at_ms = ?4
             WHERE database_id = ?1",
            params![
                &request.database_id,
                format!("database:{}", request.database_canister_id),
                &request.database_canister_id,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO database_members
             (database_id, principal, role, created_at_ms)
             VALUES (?1, ?2, 'owner', ?3)",
            params![&request.database_id, owner, now],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(DatabaseInfo {
            database_id: request.database_id,
            status: DatabaseStatus::Hot,
            mount_id: None,
            schema_version: DATABASE_SCHEMA_VERSION.to_string(),
            logical_size_bytes: 0,
            snapshot_hash: None,
            archived_at_ms: None,
            deleted_at_ms: None,
        })
    }

    pub fn discard_database_reservation(&self, database_id: &str) -> Result<(), String> {
        let mut conn = self.open_index()?;
        let db_file_name: Option<String> = conn
            .query_row(
                "SELECT db_file_name
                 FROM databases
                 WHERE database_id = ?1",
                params![database_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM database_members WHERE database_id = ?1",
            params![database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM database_restore_chunks WHERE database_id = ?1",
            params![database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM database_mount_history WHERE database_id = ?1",
            params![database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM database_shard_placements WHERE database_id = ?1",
            params![database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM databases WHERE database_id = ?1",
            params![database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        if let Some(db_file_name) = db_file_name {
            remove_database_image(&db_file_name)?;
        }
        Ok(())
    }

    pub fn run_database_migrations(&self, database_id: &str) -> Result<(), String> {
        let meta = self.database_meta(database_id)?;
        self.ensure_database_image_registered(&meta)?;
        let result = Connection::open(&meta.db_file_name)
            .and_then(|conn| conn.execute_batch("PRAGMA application_id = 0x49435044;"));
        if result.is_ok() {
            self.refresh_logical_size(database_id)?;
        }
        result.map_err(|error| error.to_string())
    }

    pub fn delete_database(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.delete_database_unchecked(database_id, now)
    }

    pub fn delete_database_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.delete_database_unchecked(database_id, now)
    }

    fn delete_database_unchecked(
        &self,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        let meta = self.database_meta_for_delete(database_id)?;
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET status = 'deleted',
                 active_mount_id = NULL,
                 logical_size_bytes = 0,
                 restore_size_bytes = NULL,
                 deleted_at_ms = ?2,
                 updated_at_ms = ?2
             WHERE database_id = ?1",
            params![database_id, now],
        )
        .map_err(|error| error.to_string())?;
        record_shard_placement(
            &tx,
            database_id,
            None,
            DatabaseStatus::Deleted,
            &meta.schema_version,
            now,
        )?;
        remove_database_image(&meta.db_file_name)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(meta)
    }

    pub fn begin_database_archive(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseArchiveInfo, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.begin_database_archive_unchecked(database_id, now)
    }

    pub fn begin_database_archive_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseArchiveInfo, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.begin_database_archive_unchecked(database_id, now)
    }

    fn begin_database_archive_unchecked(
        &self,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseArchiveInfo, String> {
        let meta = self.database_meta(database_id)?;
        let size_bytes = file_size(&meta.db_file_name)?;
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET status = 'archiving',
                 updated_at_ms = ?2
             WHERE database_id = ?1",
            params![database_id, now],
        )
        .map_err(|error| error.to_string())?;
        record_shard_placement(
            &tx,
            database_id,
            Some(meta.mount_id),
            DatabaseStatus::Archiving,
            &meta.schema_version,
            now,
        )?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(DatabaseArchiveInfo {
            database_id: database_id.to_string(),
            size_bytes,
        })
    }

    pub fn read_database_archive_chunk(
        &self,
        database_id: &str,
        caller: &str,
        offset: u64,
        max_bytes: u32,
    ) -> Result<Vec<u8>, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.read_database_archive_chunk_unchecked(database_id, offset, max_bytes)
    }

    pub fn read_database_archive_chunk_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        offset: u64,
        max_bytes: u32,
    ) -> Result<Vec<u8>, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.read_database_archive_chunk_unchecked(database_id, offset, max_bytes)
    }

    fn read_database_archive_chunk_unchecked(
        &self,
        database_id: &str,
        offset: u64,
        max_bytes: u32,
    ) -> Result<Vec<u8>, String> {
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Archiving])?;
        if max_bytes == 0 {
            return Ok(Vec::new());
        }
        if max_bytes > MAX_ARCHIVE_CHUNK_BYTES {
            return Err(format!(
                "archive chunk size exceeds limit: {max_bytes} > {MAX_ARCHIVE_CHUNK_BYTES}"
            ));
        }
        let size = file_size(&meta.db_file_name)?;
        if offset >= size {
            return Ok(Vec::new());
        }
        let remaining = size.saturating_sub(offset);
        let chunk_len = remaining.min(u64::from(max_bytes));
        self.database_executor
            .read_archive_chunk(&meta.db_file_name, offset, chunk_len)
    }

    pub fn finalize_database_archive(
        &self,
        database_id: &str,
        caller: &str,
        snapshot_hash: Vec<u8>,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.finalize_database_archive_unchecked(database_id, snapshot_hash, now)
    }

    pub fn finalize_database_archive_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.finalize_database_archive_unchecked(database_id, snapshot_hash, now)
    }

    fn finalize_database_archive_unchecked(
        &self,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Archiving])?;
        validate_snapshot_hash(&snapshot_hash)?;
        let actual_hash = file_sha256(&meta.db_file_name)?;
        if actual_hash != snapshot_hash {
            return Err("snapshot_hash does not match archived database bytes".to_string());
        }
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET status = 'archived',
                 active_mount_id = NULL,
                 snapshot_hash = ?2,
                 restore_size_bytes = NULL,
                 archived_at_ms = ?3,
                 updated_at_ms = ?3
             WHERE database_id = ?1",
            params![database_id, snapshot_hash, now],
        )
        .map_err(|error| error.to_string())?;
        record_shard_placement(
            &tx,
            database_id,
            None,
            DatabaseStatus::Archived,
            &meta.schema_version,
            now,
        )?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(meta)
    }

    pub fn cancel_database_archive(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.cancel_database_archive_unchecked(database_id, now)
    }

    pub fn cancel_database_archive_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.cancel_database_archive_unchecked(database_id, now)
    }

    fn cancel_database_archive_unchecked(
        &self,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Archiving])?;
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET status = 'hot',
                 updated_at_ms = ?2
             WHERE database_id = ?1",
            params![database_id, now],
        )
        .map_err(|error| error.to_string())?;
        record_shard_placement(
            &tx,
            database_id,
            Some(meta.mount_id),
            DatabaseStatus::Hot,
            &meta.schema_version,
            now,
        )?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(meta)
    }

    pub fn begin_database_restore(
        &self,
        database_id: &str,
        caller: &str,
        snapshot_hash: Vec<u8>,
        size_bytes: u64,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.begin_database_restore_session(database_id, caller, snapshot_hash, size_bytes, now)
            .map(|restore| restore.meta)
    }

    pub fn begin_database_restore_session(
        &self,
        database_id: &str,
        caller: &str,
        snapshot_hash: Vec<u8>,
        size_bytes: u64,
        now: i64,
    ) -> Result<DatabaseRestoreBegin, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.begin_database_restore_session_unchecked(database_id, snapshot_hash, size_bytes, now)
    }

    pub fn begin_database_restore_session_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        size_bytes: u64,
        now: i64,
    ) -> Result<DatabaseRestoreBegin, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.begin_database_restore_session_unchecked(database_id, snapshot_hash, size_bytes, now)
    }

    fn begin_database_restore_session_unchecked(
        &self,
        database_id: &str,
        snapshot_hash: Vec<u8>,
        size_bytes: u64,
        now: i64,
    ) -> Result<DatabaseRestoreBegin, String> {
        validate_snapshot_hash(&snapshot_hash)?;
        if size_bytes > MAX_DATABASE_SIZE_BYTES {
            return Err(format!(
                "database size exceeds limit: {size_bytes} > {MAX_DATABASE_SIZE_BYTES}"
            ));
        }
        let rollback = self.database_restore_rollback(database_id)?;
        if !matches!(
            rollback.status,
            DatabaseStatus::Archived | DatabaseStatus::Deleted
        ) {
            return Err(
                "database restore can only begin from archived or deleted status".to_string(),
            );
        }
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let mount_id = allocate_mount_id(&tx)?;
        record_mount_history(&tx, database_id, mount_id, "restore", now)?;
        tx.execute(
            "DELETE FROM database_restore_chunks WHERE database_id = ?1",
            params![database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET status = 'restoring',
                 active_mount_id = ?2,
                 snapshot_hash = ?3,
                 archived_at_ms = NULL,
                 deleted_at_ms = NULL,
                 restore_size_bytes = ?4,
                 updated_at_ms = ?5
             WHERE database_id = ?1",
            params![
                database_id,
                i64::from(mount_id),
                snapshot_hash,
                i64::try_from(size_bytes).map_err(|error| error.to_string())?,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        record_shard_placement(
            &tx,
            database_id,
            Some(mount_id),
            DatabaseStatus::Restoring,
            DATABASE_SCHEMA_VERSION,
            now,
        )?;
        tx.commit().map_err(|error| error.to_string())?;
        let meta = self.database_meta_allowing_restoring(database_id)?;
        self.ensure_database_image_registered(&meta)?;
        remove_database_image(&meta.db_file_name)?;
        Ok(DatabaseRestoreBegin { meta, rollback })
    }

    pub fn rollback_database_restore_begin(
        &self,
        rollback: DatabaseRestoreRollback,
        now: i64,
    ) -> Result<(), String> {
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let current_status = load_database_status(&tx, &rollback.database_id)?;
        if current_status != DatabaseStatus::Restoring {
            return Err(format!(
                "database restore rollback requires restoring status: {}",
                rollback.database_id
            ));
        }
        tx.execute(
            "DELETE FROM database_restore_chunks WHERE database_id = ?1",
            params![&rollback.database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET status = ?2,
                 active_mount_id = ?3,
                 snapshot_hash = ?4,
                 archived_at_ms = ?5,
                 deleted_at_ms = ?6,
                 restore_size_bytes = ?7,
                 updated_at_ms = ?8
            WHERE database_id = ?1",
            params![
                &rollback.database_id,
                status_to_db(rollback.status),
                rollback.active_mount_id.map(i64::from),
                rollback.snapshot_hash,
                rollback.archived_at_ms,
                rollback.deleted_at_ms,
                rollback
                    .restore_size_bytes
                    .map(i64::try_from)
                    .transpose()
                    .map_err(|error| error.to_string())?,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        record_shard_placement(
            &tx,
            &rollback.database_id,
            rollback.active_mount_id,
            rollback.status,
            DATABASE_SCHEMA_VERSION,
            now,
        )?;
        tx.commit().map_err(|error| error.to_string())
    }

    pub fn write_database_restore_chunk(
        &self,
        database_id: &str,
        caller: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.write_database_restore_chunk_unchecked(database_id, offset, bytes)
    }

    pub fn write_database_restore_chunk_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.write_database_restore_chunk_unchecked(database_id, offset, bytes)
    }

    fn write_database_restore_chunk_unchecked(
        &self,
        database_id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), String> {
        if bytes.len() > MAX_RESTORE_CHUNK_BYTES {
            return Err(format!(
                "restore chunk size exceeds limit: {} > {MAX_RESTORE_CHUNK_BYTES}",
                bytes.len()
            ));
        }
        self.database_meta_with_statuses(database_id, &[DatabaseStatus::Restoring])?;
        let expected_size = self.restore_size_bytes(database_id)?;
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "restore chunk range overflows u64".to_string())?;
        if end > expected_size {
            return Err(format!(
                "restore chunk exceeds expected size: end {end} > {expected_size}"
            ));
        }
        let conn = self.open_index()?;
        self.database_executor
            .write_restore_chunk(&conn, database_id, offset, end, bytes)?;
        Ok(())
    }

    pub fn finalize_database_restore(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.prepare_database_restore_finalize(database_id, caller)?;
        self.complete_database_restore(database_id, caller, now)
    }

    pub fn prepare_database_restore_finalize(
        &self,
        database_id: &str,
        caller: &str,
    ) -> Result<DatabaseMeta, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.prepare_database_restore_finalize_unchecked(database_id)
    }

    pub fn prepare_database_restore_finalize_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<DatabaseMeta, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.prepare_database_restore_finalize_unchecked(database_id)
    }

    fn prepare_database_restore_finalize_unchecked(
        &self,
        database_id: &str,
    ) -> Result<DatabaseMeta, String> {
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Restoring])?;
        let expected_size = self.restore_size_bytes(database_id)?;
        if !restore_chunks_cover_expected_size(&self.open_index()?, database_id, expected_size)? {
            return Err(format!(
                "restore chunks are incomplete for expected size {expected_size} bytes"
            ));
        }
        let expected_hash = self.restore_snapshot_hash(database_id)?;
        self.database_executor.finalize_restore(
            &self.open_index()?,
            &meta.db_file_name,
            database_id,
            expected_size,
            expected_hash,
        )?;
        Ok(meta)
    }

    pub fn complete_database_restore(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.complete_database_restore_unchecked(database_id, now)
    }

    pub fn complete_database_restore_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.complete_database_restore_unchecked(database_id, now)
    }

    fn complete_database_restore_unchecked(
        &self,
        database_id: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Restoring])?;
        let size = file_size(&meta.db_file_name)?;
        let mut conn = self.open_index()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM database_restore_chunks WHERE database_id = ?1",
            params![database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE databases
             SET status = 'hot',
                 logical_size_bytes = ?2,
                 restore_size_bytes = NULL,
                 updated_at_ms = ?3
             WHERE database_id = ?1",
            params![
                database_id,
                i64::try_from(size).map_err(|error| error.to_string())?,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
        record_shard_placement(
            &tx,
            database_id,
            Some(meta.mount_id),
            DatabaseStatus::Hot,
            &meta.schema_version,
            now,
        )?;
        tx.commit().map_err(|error| error.to_string())?;
        self.database_meta(database_id)
    }

    pub fn grant_database_access(
        &self,
        database_id: &str,
        caller: &str,
        principal: &str,
        role: DatabaseRole,
        now: i64,
    ) -> Result<(), String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.grant_database_access_checked(database_id, principal, role, now, Some(caller))
    }

    pub fn grant_database_access_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        principal: &str,
        role: DatabaseRole,
        now: i64,
    ) -> Result<(), String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.grant_database_access_checked(database_id, principal, role, now, None)
    }

    fn grant_database_access_checked(
        &self,
        database_id: &str,
        principal: &str,
        role: DatabaseRole,
        now: i64,
        caller: Option<&str>,
    ) -> Result<(), String> {
        self.hot_database_route_unchecked(database_id)?;
        if principal == ANONYMOUS_PRINCIPAL_TEXT {
            return Err("anonymous principal cannot be granted database access".to_string());
        }
        if caller == Some(principal) && role != DatabaseRole::Owner {
            return Err("owner cannot downgrade own access".to_string());
        }
        let conn = self.open_index()?;
        if role != DatabaseRole::Owner {
            reject_last_owner_removal(&conn, database_id, principal)?;
        }
        conn.execute(
            "INSERT INTO database_members (database_id, principal, role, created_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(database_id, principal)
             DO UPDATE SET role = excluded.role",
            params![database_id, principal, role_to_db(role), now],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn revoke_database_access(
        &self,
        database_id: &str,
        caller: &str,
        principal: &str,
    ) -> Result<(), String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.revoke_database_access_checked(database_id, principal, Some(caller))
    }

    pub fn revoke_database_access_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        principal: &str,
    ) -> Result<(), String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.revoke_database_access_checked(database_id, principal, None)
    }

    fn revoke_database_access_checked(
        &self,
        database_id: &str,
        principal: &str,
        caller: Option<&str>,
    ) -> Result<(), String> {
        self.hot_database_route_unchecked(database_id)?;
        if caller == Some(principal) {
            return Err("owner cannot revoke own access".to_string());
        }
        let conn = self.open_index()?;
        reject_last_owner_removal(&conn, database_id, principal)?;
        conn.execute(
            "DELETE FROM database_members WHERE database_id = ?1 AND principal = ?2",
            params![database_id, principal],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn list_database_members(
        &self,
        database_id: &str,
        caller: &str,
    ) -> Result<Vec<DatabaseMember>, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        self.list_database_members_unchecked(database_id)
    }

    pub fn list_database_members_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<Vec<DatabaseMember>, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.list_database_members_unchecked(database_id)
    }

    fn list_database_members_unchecked(
        &self,
        database_id: &str,
    ) -> Result<Vec<DatabaseMember>, String> {
        let conn = self.open_index()?;
        load_database_status(&conn, database_id)?;
        conn.prepare(
            "SELECT database_id, principal, role, created_at_ms
             FROM database_members
             WHERE database_id = ?1
             ORDER BY principal ASC",
        )
        .map_err(|error| error.to_string())?
        .query_map(params![database_id], |row| {
            Ok(DatabaseMember {
                database_id: row.get(0)?,
                principal: row.get(1)?,
                role: role_from_db(&row.get::<_, String>(2)?)?,
                created_at_ms: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
    }

    pub fn sql_query(
        &self,
        caller: &str,
        request: SqlExecuteRequest,
    ) -> Result<SqlExecuteResponse, String> {
        let database_id = request.database_id.clone();
        self.with_database_path(
            &database_id,
            caller,
            RequiredRole::Reader,
            |database_path, max_database_size_bytes| {
                self.database_executor
                    .sql_query(database_path, request, max_database_size_bytes)
            },
        )
    }

    pub fn sql_execute(
        &self,
        caller: &str,
        request: SqlExecuteRequest,
    ) -> Result<SqlExecuteResponse, String> {
        let database_id = request.database_id.clone();
        self.ensure_database_has_units(&database_id, SQL_EXECUTE_BILLING_UNITS)?;
        let result = self.with_database_path(
            &database_id,
            caller,
            RequiredRole::Writer,
            |database_path, max_database_size_bytes| {
                self.database_executor
                    .sql_execute(database_path, request, max_database_size_bytes)
            },
        );
        if result.is_ok() {
            self.charge_database_units(&database_id, SQL_EXECUTE_BILLING_UNITS)?;
            self.refresh_logical_size(&database_id)?;
        }
        result
    }

    pub fn sql_batch(
        &self,
        caller: &str,
        request: SqlBatchRequest,
    ) -> Result<Vec<SqlExecuteResponse>, String> {
        let database_id = request.database_id.clone();
        let billing_units =
            SQL_EXECUTE_BILLING_UNITS.saturating_mul(request.statements.len().max(1) as u64);
        self.ensure_database_has_units(&database_id, billing_units)?;
        let result = self.with_database_path(
            &database_id,
            caller,
            RequiredRole::Writer,
            |database_path, max_database_size_bytes| {
                self.database_executor
                    .sql_batch(database_path, request, max_database_size_bytes)
            },
        );
        if result.is_ok() {
            self.charge_database_units(&database_id, billing_units)?;
            self.refresh_logical_size(&database_id)?;
        }
        result
    }

    pub fn sql_execute_data_plane(
        &self,
        caller: &str,
        request: SqlExecuteRequest,
    ) -> Result<SqlExecuteResponse, String> {
        let database_id = request.database_id.clone();
        let result = self.with_database_path(
            &database_id,
            caller,
            RequiredRole::Writer,
            |database_path, max_database_size_bytes| {
                self.database_executor
                    .sql_execute(database_path, request, max_database_size_bytes)
            },
        );
        if result.is_ok() {
            self.refresh_logical_size(&database_id)?;
        }
        result
    }

    pub fn sql_batch_data_plane(
        &self,
        caller: &str,
        request: SqlBatchRequest,
    ) -> Result<Vec<SqlExecuteResponse>, String> {
        let database_id = request.database_id.clone();
        let result = self.with_database_path(
            &database_id,
            caller,
            RequiredRole::Writer,
            |database_path, max_database_size_bytes| {
                self.database_executor
                    .sql_batch(database_path, request, max_database_size_bytes)
            },
        );
        if result.is_ok() {
            self.refresh_logical_size(&database_id)?;
        }
        result
    }

    pub fn list_tables(
        &self,
        database_id: &str,
        caller: &str,
    ) -> Result<Vec<DatabaseTable>, String> {
        self.with_database_path(
            database_id,
            caller,
            RequiredRole::Reader,
            |database_path, _| self.database_executor.list_tables(database_path),
        )
    }

    pub fn describe_table(
        &self,
        database_id: &str,
        table_name: &str,
        caller: &str,
    ) -> Result<TableDescription, String> {
        self.with_database_path(
            database_id,
            caller,
            RequiredRole::Reader,
            |database_path, _| {
                self.database_executor
                    .describe_table(database_path, database_id, table_name)
            },
        )
    }

    pub fn preview_table(
        &self,
        caller: &str,
        request: TablePreviewRequest,
    ) -> Result<TablePreviewResponse, String> {
        let database_id = request.database_id.clone();
        self.with_database_path(
            &database_id,
            caller,
            RequiredRole::Reader,
            |database_path, _| self.database_executor.preview_table(database_path, request),
        )
    }

    pub fn list_tables_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<Vec<DatabaseTable>, String> {
        if auth.database_id != database_id {
            return Err("api token database_id does not match request".to_string());
        }
        self.with_database_path_for_token(
            &auth.database_id,
            RequiredRole::Reader,
            auth.scope,
            |database_path, _| self.database_executor.list_tables(database_path),
        )
    }

    pub fn describe_table_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        table_name: &str,
    ) -> Result<TableDescription, String> {
        if auth.database_id != database_id {
            return Err("api token database_id does not match request".to_string());
        }
        self.with_database_path_for_token(
            &auth.database_id,
            RequiredRole::Reader,
            auth.scope,
            |database_path, _| {
                self.database_executor
                    .describe_table(database_path, database_id, table_name)
            },
        )
    }

    pub fn preview_table_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: TablePreviewRequest,
    ) -> Result<TablePreviewResponse, String> {
        if auth.database_id != request.database_id {
            return Err("api token database_id does not match request".to_string());
        }
        self.with_database_path_for_token(
            &auth.database_id,
            RequiredRole::Reader,
            auth.scope,
            |database_path, _| self.database_executor.preview_table(database_path, request),
        )
    }

    pub fn database_usage_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<DatabaseUsage, String> {
        if auth.database_id != database_id {
            return Err("api token database_id does not match request".to_string());
        }
        if !token_scope_allows(auth.scope, RequiredRole::Reader) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.database_usage_unchecked(database_id)
    }

    pub fn database_shard_placement_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<DatabaseShardPlacement, String> {
        if auth.database_id != database_id {
            return Err("api token database_id does not match request".to_string());
        }
        if !token_scope_allows(auth.scope, RequiredRole::Reader) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.database_shard_placement_unchecked(database_id)
    }

    pub fn hot_database_route(
        &self,
        database_id: &str,
        caller: &str,
        required_role: RequiredRole,
    ) -> Result<DatabaseShardPlacement, String> {
        self.require_role(database_id, caller, required_role)?;
        self.hot_database_route_unchecked(database_id)
    }

    pub fn database_route(
        &self,
        database_id: &str,
        caller: &str,
        required_role: RequiredRole,
        allowed_statuses: &[DatabaseStatus],
    ) -> Result<DatabaseShardPlacement, String> {
        self.require_role(database_id, caller, required_role)?;
        self.database_route_unchecked(database_id, allowed_statuses)
    }

    pub fn remote_database_route(
        &self,
        database_id: &str,
        caller: &str,
        required_role: RequiredRole,
        allowed_statuses: &[DatabaseStatus],
    ) -> Result<DatabaseShardPlacement, String> {
        let placement =
            self.database_route(database_id, caller, required_role, allowed_statuses)?;
        if placement.canister_id.is_none() {
            return Err(format!("database is not remote: {database_id}"));
        }
        Ok(placement)
    }

    pub fn hot_database_route_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        required_role: RequiredRole,
    ) -> Result<DatabaseShardPlacement, String> {
        if auth.database_id != database_id {
            return Err("api token database_id does not match request".to_string());
        }
        if !token_scope_allows(auth.scope, required_role) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.hot_database_route_unchecked(database_id)
    }

    pub fn database_route_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        required_role: RequiredRole,
        allowed_statuses: &[DatabaseStatus],
    ) -> Result<DatabaseShardPlacement, String> {
        if auth.database_id != database_id {
            return Err("api token database_id does not match request".to_string());
        }
        if !token_scope_allows(auth.scope, required_role) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.database_route_unchecked(database_id, allowed_statuses)
    }

    pub fn remote_database_route_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
        required_role: RequiredRole,
        allowed_statuses: &[DatabaseStatus],
    ) -> Result<DatabaseShardPlacement, String> {
        let placement =
            self.database_route_with_token(auth, database_id, required_role, allowed_statuses)?;
        if placement.canister_id.is_none() {
            return Err(format!("database is not remote: {database_id}"));
        }
        Ok(placement)
    }

    fn database_shard_placement_unchecked(
        &self,
        database_id: &str,
    ) -> Result<DatabaseShardPlacement, String> {
        let conn = self.open_index()?;
        load_database_shard_placement(&conn, database_id)?
            .ok_or_else(|| format!("database shard placement not found: {database_id}"))
    }

    fn database_route_unchecked(
        &self,
        database_id: &str,
        allowed_statuses: &[DatabaseStatus],
    ) -> Result<DatabaseShardPlacement, String> {
        let conn = self.open_index()?;
        let status = load_database_status(&conn, database_id)?;
        if !allowed_statuses.contains(&status) {
            return Err(database_meta_error(&conn, database_id));
        }
        let placement = load_database_shard_placement(&conn, database_id)?
            .ok_or_else(|| format!("database shard placement not found: {database_id}"))?;
        if !allowed_statuses.contains(&placement.status) {
            return Err(format!(
                "database route is {}: {database_id}",
                status_to_db(placement.status)
            ));
        }
        Ok(placement)
    }

    fn hot_database_route_unchecked(
        &self,
        database_id: &str,
    ) -> Result<DatabaseShardPlacement, String> {
        let conn = self.open_index()?;
        let status = load_database_status(&conn, database_id)?;
        if status != DatabaseStatus::Hot {
            return Err(database_meta_error(&conn, database_id));
        }
        let placement = load_database_shard_placement(&conn, database_id)?
            .ok_or_else(|| format!("database shard placement not found: {database_id}"))?;
        if placement.status != DatabaseStatus::Hot {
            return Err(format!(
                "database route is {}: {database_id}",
                status_to_db(placement.status)
            ));
        }
        Ok(placement)
    }

    pub fn database_usage_event_summaries_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<Vec<DatabaseUsageEventSummary>, String> {
        if auth.database_id != database_id {
            return Err("api token database_id does not match request".to_string());
        }
        if !token_scope_allows(auth.scope, RequiredRole::Reader) {
            return Err("api token scope does not allow this operation".to_string());
        }
        self.database_usage_event_summaries_unchecked(database_id)
    }

    pub fn database_billing_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        database_id: &str,
    ) -> Result<DatabaseBilling, String> {
        self.require_owner_token_for_database(auth, database_id)?;
        self.load_database_billing(database_id)
    }

    pub fn sql_query_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: SqlExecuteRequest,
    ) -> Result<SqlExecuteResponse, String> {
        if auth.database_id != request.database_id {
            return Err("api token database_id does not match request".to_string());
        }
        self.with_database_path_for_token(
            &auth.database_id,
            RequiredRole::Reader,
            auth.scope,
            |database_path, max_database_size_bytes| {
                self.database_executor
                    .sql_query(database_path, request, max_database_size_bytes)
            },
        )
    }

    pub fn sql_execute_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: SqlExecuteRequest,
    ) -> Result<SqlExecuteResponse, String> {
        if auth.database_id != request.database_id {
            return Err("api token database_id does not match request".to_string());
        }
        self.ensure_database_has_units(&auth.database_id, SQL_EXECUTE_BILLING_UNITS)?;
        let result = self.with_database_path_for_token(
            &auth.database_id,
            RequiredRole::Writer,
            auth.scope,
            |database_path, max_database_size_bytes| {
                self.database_executor
                    .sql_execute(database_path, request, max_database_size_bytes)
            },
        );
        if result.is_ok() {
            self.charge_database_units(&auth.database_id, SQL_EXECUTE_BILLING_UNITS)?;
            self.refresh_logical_size(&auth.database_id)?;
        }
        result
    }

    pub fn sql_batch_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: SqlBatchRequest,
    ) -> Result<Vec<SqlExecuteResponse>, String> {
        if auth.database_id != request.database_id {
            return Err("api token database_id does not match request".to_string());
        }
        let billing_units =
            SQL_EXECUTE_BILLING_UNITS.saturating_mul(request.statements.len().max(1) as u64);
        self.ensure_database_has_units(&auth.database_id, billing_units)?;
        let result = self.with_database_path_for_token(
            &auth.database_id,
            RequiredRole::Writer,
            auth.scope,
            |database_path, max_database_size_bytes| {
                self.database_executor
                    .sql_batch(database_path, request, max_database_size_bytes)
            },
        );
        if result.is_ok() {
            self.charge_database_units(&auth.database_id, billing_units)?;
            self.refresh_logical_size(&auth.database_id)?;
        }
        result
    }

    fn with_database_path<T>(
        &self,
        database_id: &str,
        caller: &str,
        required_role: RequiredRole,
        f: impl FnOnce(&str, u64) -> Result<T, String>,
    ) -> Result<T, String> {
        self.require_role(database_id, caller, required_role)?;
        let meta = self.database_meta(database_id)?;
        f(&meta.db_file_name, self.database_quota(database_id)?)
    }

    fn with_database_path_for_token<T>(
        &self,
        database_id: &str,
        required_role: RequiredRole,
        scope: DatabaseTokenScope,
        f: impl FnOnce(&str, u64) -> Result<T, String>,
    ) -> Result<T, String> {
        if !token_scope_allows(scope, required_role) {
            return Err("api token scope does not allow this operation".to_string());
        }
        let meta = self.database_meta(database_id)?;
        f(&meta.db_file_name, self.database_quota(database_id)?)
    }

    fn require_role(
        &self,
        database_id: &str,
        caller: &str,
        required_role: RequiredRole,
    ) -> Result<(), String> {
        let conn = self.open_index()?;
        let role = load_member_role(&conn, database_id, caller)?
            .ok_or_else(|| format!("principal has no access to database: {database_id}"))?;
        if role_allows(role, required_role) {
            Ok(())
        } else {
            Err(format!(
                "principal lacks required database role: {database_id}"
            ))
        }
    }

    fn database_meta(&self, database_id: &str) -> Result<DatabaseMeta, String> {
        let conn = self.open_index()?;
        load_database(&conn, database_id)?.ok_or_else(|| database_meta_error(&conn, database_id))
    }

    fn database_meta_allowing_restoring(&self, database_id: &str) -> Result<DatabaseMeta, String> {
        self.database_meta_with_statuses(
            database_id,
            &[DatabaseStatus::Hot, DatabaseStatus::Restoring],
        )
    }

    fn database_meta_with_statuses(
        &self,
        database_id: &str,
        statuses: &[DatabaseStatus],
    ) -> Result<DatabaseMeta, String> {
        let conn = self.open_index()?;
        load_database_with_statuses(&conn, database_id, statuses)?
            .ok_or_else(|| database_meta_error(&conn, database_id))
    }

    fn database_meta_for_delete(&self, database_id: &str) -> Result<DatabaseMeta, String> {
        let conn = self.open_index()?;
        conn.query_row(
            "SELECT database_id, db_file_name, mount_id, schema_version, logical_size_bytes, status
             FROM databases
             WHERE database_id = ?1",
            params![database_id],
            |row| {
                map_database_meta_with_statuses(
                    row,
                    &[DatabaseStatus::Hot, DatabaseStatus::Archived],
                )
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| database_meta_error(&conn, database_id))
    }

    fn database_restore_rollback(
        &self,
        database_id: &str,
    ) -> Result<DatabaseRestoreRollback, String> {
        let conn = self.open_index()?;
        conn.query_row(
            "SELECT database_id, status, active_mount_id, snapshot_hash, archived_at_ms,
                    deleted_at_ms, restore_size_bytes
             FROM databases
             WHERE database_id = ?1",
            params![database_id],
            |row| {
                let active_mount_id: Option<i64> = row.get(2)?;
                let restore_size_bytes: Option<i64> = row.get(6)?;
                Ok(DatabaseRestoreRollback {
                    database_id: row.get(0)?,
                    status: status_from_db(&row.get::<_, String>(1)?)?,
                    active_mount_id: active_mount_id.map(mount_id_from_db).transpose()?,
                    snapshot_hash: row.get(3)?,
                    archived_at_ms: row.get(4)?,
                    deleted_at_ms: row.get(5)?,
                    restore_size_bytes: restore_size_bytes.map(|size| size.max(0) as u64),
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("database not found: {database_id}"))
    }

    fn restore_size_bytes(&self, database_id: &str) -> Result<u64, String> {
        let conn = self.open_index()?;
        let size: Option<i64> = conn
            .query_row(
                "SELECT restore_size_bytes FROM databases WHERE database_id = ?1",
                params![database_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("database not found: {database_id}"))?;
        size.map(|size| size.max(0) as u64)
            .ok_or_else(|| format!("restore size is missing: {database_id}"))
    }

    fn restore_snapshot_hash(&self, database_id: &str) -> Result<Vec<u8>, String> {
        let conn = self.open_index()?;
        let hash: Option<Vec<u8>> = conn
            .query_row(
                "SELECT snapshot_hash FROM databases WHERE database_id = ?1",
                params![database_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("database not found: {database_id}"))?;
        hash.ok_or_else(|| format!("snapshot_hash is missing: {database_id}"))
    }

    fn database_quota(&self, database_id: &str) -> Result<u64, String> {
        let conn = self.open_index()?;
        conn.query_row(
            "SELECT max_logical_size_bytes FROM databases WHERE database_id = ?1",
            params![database_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|quota| quota.max(0) as u64)
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("database not found: {database_id}"))
    }

    fn load_database_billing(&self, database_id: &str) -> Result<DatabaseBilling, String> {
        let conn = self.open_index()?;
        conn.query_row(
            "SELECT database_id, billing_status, billing_balance_units, billing_spent_units,
                    (SELECT COUNT(*) FROM usage_events WHERE database_id = databases.database_id)
             FROM databases
             WHERE database_id = ?1",
            params![database_id],
            |row| {
                let balance_units: i64 = row.get(2)?;
                let spent_units: i64 = row.get(3)?;
                let usage_event_count: i64 = row.get(4)?;
                Ok(DatabaseBilling {
                    database_id: row.get(0)?,
                    status: billing_status_from_db(&row.get::<_, String>(1)?)?,
                    balance_units: balance_units.max(0) as u64,
                    spent_units: spent_units.max(0) as u64,
                    usage_event_count: usage_event_count.max(0) as u64,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("database not found: {database_id}"))
    }

    fn ensure_database_has_units(&self, database_id: &str, units: u64) -> Result<(), String> {
        let billing = self.load_database_billing(database_id)?;
        if billing.status != DatabaseBillingStatus::Active {
            return Err(format!("database billing is suspended: {database_id}"));
        }
        if billing.balance_units < units {
            let conn = self.open_index()?;
            conn.execute(
                "UPDATE databases
                 SET billing_status = 'suspended'
                 WHERE database_id = ?1",
                params![database_id],
            )
            .map_err(|error| error.to_string())?;
            return Err(format!(
                "database billing balance exhausted: {} < {}",
                billing.balance_units, units
            ));
        }
        Ok(())
    }

    fn charge_database_units(&self, database_id: &str, units: u64) -> Result<(), String> {
        if units == 0 {
            return Ok(());
        }
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET billing_balance_units = MAX(billing_balance_units - ?2, 0),
                 billing_spent_units = billing_spent_units + ?2
             WHERE database_id = ?1",
            params![database_id, i64::try_from(units).unwrap_or(i64::MAX)],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn refresh_logical_size(&self, database_id: &str) -> Result<(), String> {
        let meta = self.database_meta_allowing_restoring(database_id)?;
        let size = file_size(&meta.db_file_name)?;
        self.set_logical_size(database_id, size)
    }

    fn set_logical_size(&self, database_id: &str, size: u64) -> Result<(), String> {
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET logical_size_bytes = ?2
             WHERE database_id = ?1",
            params![database_id, i64::try_from(size).unwrap_or(i64::MAX)],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn open_index(&self) -> Result<Connection, String> {
        self.ensure_index_image_registered()?;
        Connection::open(&self.index_path).map_err(|error| error.to_string())
    }

    fn ensure_index_image_registered(&self) -> Result<(), String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            sqlite_facade::register_local_path(&self.index_path, &self.index_path, 10)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn ensure_database_image_registered(&self, _meta: &DatabaseMeta) -> Result<(), String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let meta = _meta;
            let memory_id = u8::try_from(meta.mount_id).map_err(|error| error.to_string())?;
            sqlite_facade::register_local_path(&self.index_path, &meta.db_file_name, memory_id)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

fn run_index_migrations(conn: &mut Connection) -> Result<(), String> {
    ensure_schema_migrations_table(conn)?;
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_INITIAL)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE databases (
               database_id TEXT PRIMARY KEY,
               db_file_name TEXT NOT NULL,
               mount_id INTEGER NOT NULL,
               schema_version TEXT NOT NULL,
               created_at_ms INTEGER NOT NULL,
               updated_at_ms INTEGER NOT NULL
             );
             CREATE UNIQUE INDEX databases_mount_id_idx ON databases(mount_id);
             CREATE TABLE database_members (
               database_id TEXT NOT NULL,
               principal TEXT NOT NULL,
               role TEXT NOT NULL,
               created_at_ms INTEGER NOT NULL,
               PRIMARY KEY (database_id, principal),
               FOREIGN KEY (database_id) REFERENCES databases(database_id)
             );",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_INITIAL],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_LIFECYCLE)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "DROP INDEX databases_mount_id_idx;
             ALTER TABLE databases ADD COLUMN active_mount_id INTEGER;
             ALTER TABLE databases ADD COLUMN status TEXT NOT NULL DEFAULT 'hot';
             ALTER TABLE databases ADD COLUMN logical_size_bytes INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE databases ADD COLUMN snapshot_hash BLOB;
             ALTER TABLE databases ADD COLUMN archived_at_ms INTEGER;
             ALTER TABLE databases ADD COLUMN deleted_at_ms INTEGER;
             UPDATE databases SET active_mount_id = mount_id WHERE active_mount_id IS NULL;
             CREATE UNIQUE INDEX databases_active_mount_id_idx
               ON databases(active_mount_id)
               WHERE active_mount_id IS NOT NULL;",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_LIFECYCLE],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_RESTORE_SIZE)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch("ALTER TABLE databases ADD COLUMN restore_size_bytes INTEGER;")
            .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_RESTORE_SIZE],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_RESTORE_CHUNKS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE database_restore_chunks (
               database_id TEXT NOT NULL,
               offset_bytes INTEGER NOT NULL,
               end_bytes INTEGER NOT NULL,
               PRIMARY KEY (database_id, offset_bytes, end_bytes),
               FOREIGN KEY (database_id) REFERENCES databases(database_id)
             );
             CREATE INDEX database_restore_chunks_database_id_idx
               ON database_restore_chunks(database_id, offset_bytes);",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_RESTORE_CHUNKS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_USAGE_EVENTS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE usage_events (
               event_id INTEGER PRIMARY KEY AUTOINCREMENT,
               method TEXT NOT NULL,
               database_id TEXT,
               caller TEXT NOT NULL,
               success INTEGER NOT NULL,
               cycles_delta INTEGER NOT NULL,
               error TEXT,
               created_at_ms INTEGER NOT NULL
             );
             CREATE INDEX usage_events_database_id_created_at_idx
               ON usage_events(database_id, created_at_ms);
             CREATE INDEX usage_events_caller_created_at_idx
               ON usage_events(caller, created_at_ms);",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_USAGE_EVENTS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_MOUNT_HISTORY)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE database_mount_history (
               database_id TEXT NOT NULL,
               mount_id INTEGER NOT NULL,
               reason TEXT NOT NULL,
               created_at_ms INTEGER NOT NULL,
               PRIMARY KEY (mount_id)
             );
             INSERT OR IGNORE INTO database_mount_history
               (database_id, mount_id, reason, created_at_ms)
               SELECT database_id, mount_id, 'create', created_at_ms FROM databases;",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_MOUNT_HISTORY],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_QUOTAS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(&format!(
            "ALTER TABLE databases
             ADD COLUMN max_logical_size_bytes INTEGER NOT NULL DEFAULT {DEFAULT_DATABASE_QUOTA_BYTES};"
        ))
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_QUOTAS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_BILLING)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(&format!(
            "ALTER TABLE databases
               ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'active';
             ALTER TABLE databases
               ADD COLUMN billing_balance_units INTEGER NOT NULL DEFAULT {DEFAULT_DATABASE_BALANCE_UNITS};
             ALTER TABLE databases
               ADD COLUMN billing_spent_units INTEGER NOT NULL DEFAULT 0;"
        ))
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_BILLING],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_TOKENS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE database_tokens (
               token_id TEXT PRIMARY KEY,
               database_id TEXT NOT NULL,
               name TEXT NOT NULL,
               scope TEXT NOT NULL,
               token_hash BLOB NOT NULL UNIQUE,
               created_at_ms INTEGER NOT NULL,
               last_used_at_ms INTEGER,
               revoked_at_ms INTEGER,
               FOREIGN KEY (database_id) REFERENCES databases(database_id)
             );
             CREATE INDEX database_tokens_database_id_idx
               ON database_tokens(database_id, revoked_at_ms);",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_TOKENS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_PAYMENTS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE payments (
               payment_id TEXT PRIMARY KEY,
               database_id TEXT NOT NULL,
               payer_principal TEXT NOT NULL,
               amount_e8s INTEGER NOT NULL,
               credited_units INTEGER NOT NULL,
               ledger_canister_id TEXT NOT NULL,
               block_index INTEGER NOT NULL UNIQUE,
               created_at_ms INTEGER NOT NULL,
               FOREIGN KEY (database_id) REFERENCES databases(database_id)
             );
             CREATE INDEX payments_database_id_created_at_idx
               ON payments(database_id, created_at_ms DESC);",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_PAYMENTS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_BILLING_CONFIG)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE billing_config (
               key TEXT PRIMARY KEY,
               value_u64 INTEGER NOT NULL,
               updated_at_ms INTEGER NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO billing_config (key, value_u64, updated_at_ms)
             VALUES (?1, ?2, 0)",
            params![
                BILLING_CONFIG_ICP_TRANSFER_FEE_E8S,
                i64::try_from(ICP_TRANSFER_FEE_E8S_DEFAULT).unwrap_or(i64::MAX)
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_BILLING_CONFIG],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_RESTORE_CHUNK_BYTES)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch("ALTER TABLE database_restore_chunks ADD COLUMN bytes BLOB;")
            .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_RESTORE_CHUNK_BYTES],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_USAGE_EVENT_ROWS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "ALTER TABLE usage_events ADD COLUMN rows_returned INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE usage_events ADD COLUMN rows_affected INTEGER NOT NULL DEFAULT 0;",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_USAGE_EVENT_ROWS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_USAGE_EVENT_OPERATION)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch("ALTER TABLE usage_events ADD COLUMN operation TEXT;")
            .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_USAGE_EVENT_OPERATION],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_SHARD_PLACEMENTS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE database_shard_placements (
               database_id TEXT PRIMARY KEY,
               shard_id TEXT NOT NULL,
               canister_id TEXT,
               mount_id INTEGER,
               status TEXT NOT NULL,
               schema_version TEXT NOT NULL,
               created_at_ms INTEGER NOT NULL,
               updated_at_ms INTEGER NOT NULL,
               FOREIGN KEY (database_id) REFERENCES databases(database_id)
             );
             CREATE INDEX database_shard_placements_shard_status_idx
               ON database_shard_placements(shard_id, status);
             INSERT INTO database_shard_placements
               (database_id, shard_id, canister_id, mount_id, status, schema_version,
                created_at_ms, updated_at_ms)
               SELECT database_id, 'local', NULL, active_mount_id, status, schema_version,
                      created_at_ms, updated_at_ms
               FROM databases;",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_SHARD_PLACEMENTS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_ROUTED_OPERATIONS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE routed_operations (
               operation_id TEXT PRIMARY KEY,
               database_id TEXT NOT NULL,
               database_canister_id TEXT NOT NULL,
               method TEXT NOT NULL,
               request_hash BLOB NOT NULL,
               status TEXT NOT NULL,
               error TEXT,
               created_at_ms INTEGER NOT NULL,
               updated_at_ms INTEGER NOT NULL,
               FOREIGN KEY (database_id) REFERENCES databases(database_id)
             );
             CREATE INDEX routed_operations_database_status_idx
               ON routed_operations(database_id, status, updated_at_ms);
             CREATE INDEX routed_operations_canister_status_idx
               ON routed_operations(database_canister_id, status, updated_at_ms);",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_ROUTED_OPERATIONS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_DATABASE_SHARDS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE database_shards (
               shard_id TEXT PRIMARY KEY,
               canister_id TEXT NOT NULL UNIQUE,
               status TEXT NOT NULL,
               max_databases INTEGER NOT NULL,
               created_at_ms INTEGER NOT NULL,
               updated_at_ms INTEGER NOT NULL
             );
             CREATE INDEX database_shards_status_idx
               ON database_shards(status, updated_at_ms);",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_DATABASE_SHARDS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_SHARD_OPERATIONS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE shard_operations (
               operation_id TEXT PRIMARY KEY,
               operation_kind TEXT NOT NULL,
               target TEXT,
               request_hash BLOB NOT NULL,
               status TEXT NOT NULL,
               error TEXT,
               created_at_ms INTEGER NOT NULL,
               updated_at_ms INTEGER NOT NULL
             );
             CREATE INDEX shard_operations_status_idx
               ON shard_operations(status, updated_at_ms);
             CREATE INDEX shard_operations_target_idx
               ON shard_operations(target, status, updated_at_ms);",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_SHARD_OPERATIONS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_DATA_PLANE_OPERATIONS)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute_batch(
            "CREATE TABLE data_plane_operations (
               operation_id TEXT PRIMARY KEY,
               database_id TEXT NOT NULL,
               method TEXT NOT NULL,
               request_hash BLOB NOT NULL,
               created_at_ms INTEGER NOT NULL
             );
             CREATE INDEX data_plane_operations_database_idx
               ON data_plane_operations(database_id, created_at_ms);",
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_DATA_PLANE_OPERATIONS],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    if !migration_applied(conn, INDEX_SCHEMA_VERSION_ROUTED_OPERATION_BILLING)? {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "ALTER TABLE routed_operations
             ADD COLUMN billing_units INTEGER NOT NULL DEFAULT 0",
            params![],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
            params![INDEX_SCHEMA_VERSION_ROUTED_OPERATION_BILLING],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn ensure_schema_migrations_table(conn: &Connection) -> Result<(), String> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
            params![],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if exists {
        return Ok(());
    }
    conn.execute_batch(
        "CREATE TABLE schema_migrations (
           version TEXT PRIMARY KEY,
           applied_at INTEGER NOT NULL
         );",
    )
    .map_err(|error| error.to_string())
}

fn migration_applied(conn: &Connection, version: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM schema_migrations WHERE version = ?1",
        params![version],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|row| row.is_some())
    .map_err(|error| error.to_string())
}

fn restore_chunks_cover_expected_size(
    conn: &Connection,
    database_id: &str,
    expected_size: u64,
) -> Result<bool, String> {
    if expected_size == 0 {
        return Ok(true);
    }
    let chunks = conn
        .prepare(
            "SELECT offset_bytes, end_bytes
             FROM database_restore_chunks
             WHERE database_id = ?1
             ORDER BY offset_bytes ASC, end_bytes ASC",
        )
        .map_err(|error| error.to_string())?
        .query_map(params![database_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut covered_end = 0_u64;
    for (offset, end) in chunks {
        let offset = u64::try_from(offset).map_err(|error| error.to_string())?;
        let end = u64::try_from(end).map_err(|error| error.to_string())?;
        if offset > covered_end {
            return Ok(false);
        }
        if end > expected_size {
            return Ok(false);
        }
        covered_end = covered_end.max(end);
        if covered_end == expected_size {
            return Ok(true);
        }
    }
    Ok(false)
}

fn validate_database_id(database_id: &str) -> Result<(), String> {
    if database_id.is_empty() || database_id.len() > 64 {
        return Err("database_id must be 1..64 characters".to_string());
    }
    if !database_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("database_id may only contain ASCII letters, digits, '-' and '_'".to_string());
    }
    Ok(())
}

fn validate_database_token_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("token name must be 1..64 characters".to_string());
    }
    if !name
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(
            "token name may only contain ASCII letters, digits, '-', '_' and '.'".to_string(),
        );
    }
    Ok(())
}

fn validate_routed_operation_input(
    operation_id: &str,
    database_id: &str,
    database_canister_id: &str,
    method: &str,
    request_hash: &[u8],
) -> Result<(), String> {
    validate_routed_operation_id(operation_id)?;
    validate_database_id(database_id)?;
    validate_database_canister_id(database_canister_id)?;
    validate_routed_operation_method(method)?;
    validate_routed_request_hash(request_hash)
}

fn validate_routed_operation_id(operation_id: &str) -> Result<(), String> {
    validate_ascii_identifier(operation_id, ROUTED_OPERATION_ID_MAX_BYTES, "operation_id")
}

fn validate_database_canister_id(database_canister_id: &str) -> Result<(), String> {
    if database_canister_id.is_empty() || database_canister_id.len() > 128 {
        return Err("database_canister_id must be 1..128 characters".to_string());
    }
    if !database_canister_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-'))
    {
        return Err(
            "database_canister_id may only contain ASCII letters, digits and '-'".to_string(),
        );
    }
    Ok(())
}

fn validate_routed_operation_method(method: &str) -> Result<(), String> {
    validate_ascii_identifier(method, ROUTED_OPERATION_METHOD_MAX_BYTES, "method")
}

fn validate_ascii_identifier(value: &str, max_len: usize, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > max_len {
        return Err(format!("{label} must be 1..{max_len} characters"));
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!(
            "{label} may only contain ASCII letters, digits, '-' and '_'"
        ));
    }
    Ok(())
}

fn validate_routed_request_hash(request_hash: &[u8]) -> Result<(), String> {
    if request_hash.len() == SHA256_DIGEST_BYTES {
        Ok(())
    } else {
        Err(format!(
            "request_hash must be a {SHA256_DIGEST_BYTES}-byte SHA-256 digest"
        ))
    }
}

fn validate_routed_operation_replay(
    existing: &RoutedOperationInfo,
    database_id: &str,
    database_canister_id: &str,
    method: &str,
    request_hash: &[u8],
) -> Result<(), String> {
    if existing.database_id == database_id
        && existing.database_canister_id == database_canister_id
        && existing.method == method
        && existing.request_hash == request_hash
    {
        Ok(())
    } else {
        Err(format!(
            "routed operation request mismatch: {}",
            existing.operation_id
        ))
    }
}

fn validate_data_plane_operation_input(
    operation_id: &str,
    database_id: &str,
    method: &str,
    request_hash: &[u8],
) -> Result<(), String> {
    validate_routed_operation_id(operation_id)?;
    validate_database_id(database_id)?;
    validate_routed_operation_method(method)?;
    validate_routed_request_hash(request_hash)
}

fn validate_data_plane_operation_replay(
    existing: &DataPlaneOperationInfo,
    database_id: &str,
    method: &str,
    request_hash: &[u8],
) -> Result<(), String> {
    if existing.database_id == database_id
        && existing.method == method
        && existing.request_hash == request_hash
    {
        Ok(())
    } else {
        Err(format!(
            "data-plane operation request mismatch: {}",
            existing.operation_id
        ))
    }
}

fn validate_shard_operation_input(
    operation_id: &str,
    operation_kind: &str,
    target: Option<&str>,
    request_hash: &[u8],
) -> Result<(), String> {
    validate_shard_operation_id(operation_id)?;
    validate_ascii_identifier(
        operation_kind,
        SHARD_OPERATION_KIND_MAX_BYTES,
        "operation_kind",
    )?;
    if let Some(target) = target {
        validate_shard_operation_target(target)?;
    }
    validate_routed_request_hash(request_hash)
}

fn validate_shard_operation_id(operation_id: &str) -> Result<(), String> {
    validate_ascii_identifier(operation_id, SHARD_OPERATION_ID_MAX_BYTES, "operation_id")
}

fn validate_shard_operation_target(target: &str) -> Result<(), String> {
    if target.is_empty() || target.len() > 256 {
        return Err("target must be 1..256 characters".to_string());
    }
    if !target
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err(
            "target may only contain ASCII letters, digits, '-', '_', ':' and '.'".to_string(),
        );
    }
    Ok(())
}

fn validate_shard_operation_replay(
    existing: &ShardOperationInfo,
    operation_kind: &str,
    target: Option<&str>,
    request_hash: &[u8],
) -> Result<(), String> {
    if existing.operation_kind == operation_kind
        && existing.target.as_deref() == target
        && existing.request_hash == request_hash
    {
        Ok(())
    } else {
        Err(format!(
            "shard operation request mismatch: {}",
            existing.operation_id
        ))
    }
}

fn validate_shard_operation_reconcile(
    status: RoutedOperationStatus,
    error: Option<&str>,
) -> Result<(), String> {
    match status {
        RoutedOperationStatus::Applied => Ok(()),
        RoutedOperationStatus::Failed => {
            if error
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
            {
                return Err("failed shard operation reconcile requires an error".to_string());
            }
            Ok(())
        }
        RoutedOperationStatus::Pending | RoutedOperationStatus::Unknown => {
            Err("shard operation reconcile status must be applied or failed".to_string())
        }
    }
}

fn validate_token_hash(token_hash: &[u8]) -> Result<(), String> {
    if token_hash.len() == SHA256_DIGEST_BYTES {
        Ok(())
    } else {
        Err(format!(
            "token_hash must be a {SHA256_DIGEST_BYTES}-byte SHA-256 digest"
        ))
    }
}

pub fn hash_api_token(token: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"icpdb-api-token-v1");
    hasher.update(token.as_bytes());
    hasher.finalize().to_vec()
}

fn generated_database_id(caller: &str, now: i64, mount_id: u16, attempt: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(caller.as_bytes());
    hasher.update(now.to_be_bytes());
    hasher.update(mount_id.to_be_bytes());
    hasher.update(attempt.to_be_bytes());
    format!(
        "{GENERATED_DATABASE_ID_PREFIX}{}",
        &base32_lower(&hasher.finalize())[..GENERATED_DATABASE_ID_HASH_CHARS]
    )
}

fn generated_remote_database_id(
    caller: &str,
    now: i64,
    database_canister_id: &str,
    attempt: u32,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(caller.as_bytes());
    hasher.update(now.to_be_bytes());
    hasher.update(database_canister_id.as_bytes());
    hasher.update(attempt.to_be_bytes());
    format!(
        "{GENERATED_DATABASE_ID_PREFIX}{}",
        &base32_lower(&hasher.finalize())[..GENERATED_DATABASE_ID_HASH_CHARS]
    )
}

fn database_shard_id(database_canister_id: &str) -> String {
    format!("database:{database_canister_id}")
}

fn generated_token_id(token_hash: &[u8]) -> String {
    format!(
        "{GENERATED_TOKEN_ID_PREFIX}{}",
        &base32_lower(token_hash)[..GENERATED_TOKEN_ID_HASH_CHARS]
    )
}

fn generated_payment_id(
    database_id: &str,
    payer_principal: &str,
    ledger_canister_id: &str,
    block_index: u64,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"icpdb-payment-v1");
    hasher.update(database_id.as_bytes());
    hasher.update(payer_principal.as_bytes());
    hasher.update(ledger_canister_id.as_bytes());
    hasher.update(block_index.to_be_bytes());
    format!(
        "{GENERATED_PAYMENT_ID_PREFIX}{}",
        &base32_lower(&hasher.finalize())[..GENERATED_PAYMENT_ID_HASH_CHARS]
    )
}

fn credited_units_for_deposit(amount_e8s: u64) -> Result<u64, String> {
    if amount_e8s < MIN_DEPOSIT_E8S {
        return Err(format!("minimum ICP deposit is {MIN_DEPOSIT_E8S} e8s"));
    }
    amount_e8s
        .checked_mul(ICPDB_UNITS_PER_ICP)
        .and_then(|amount| amount.checked_div(ICP_E8S_PER_ICP))
        .filter(|units| *units > 0)
        .ok_or_else(|| "deposit amount overflows billing unit conversion".to_string())
}

fn u64_to_sqlite_i64(value: u64, name: &str) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("{name} exceeds SQLite integer range"))
}

fn base32_lower(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut output = String::new();
    let mut buffer = 0_u16;
    let mut bit_count = 0_u8;
    for byte in bytes {
        buffer = (buffer << 8) | u16::from(*byte);
        bit_count += 8;
        while bit_count >= 5 {
            let shift = bit_count - 5;
            let index = ((buffer >> shift) & 0b11111) as usize;
            output.push(ALPHABET[index] as char);
            bit_count -= 5;
            buffer &= (1_u16 << bit_count) - 1;
        }
    }
    if bit_count > 0 {
        let index = ((buffer << (5 - bit_count)) & 0b11111) as usize;
        output.push(ALPHABET[index] as char);
    }
    output
}

fn database_file_name(databases_dir: &str, database_id: &str) -> Result<String, String> {
    validate_database_id(database_id)?;
    Ok(format!(
        "{}/{}.sqlite3",
        databases_dir.trim_end_matches('/'),
        database_id
    ))
}

fn database_exists(conn: &Connection, database_id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM databases WHERE database_id = ?1",
        params![database_id],
        |_| Ok(()),
    )
    .optional()
    .map(|row| row.is_some())
    .map_err(|error| error.to_string())
}

fn allocate_mount_id(conn: &Connection) -> Result<u16, String> {
    let used = conn
        .prepare(
            "SELECT mount_id AS used_mount_id
             FROM database_mount_history
             ORDER BY used_mount_id ASC",
        )
        .map_err(|error| error.to_string())?
        .query_map(params![], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut used = used.into_iter().map(mount_id_from_db).peekable();
    for mount_id in MIN_DATABASE_MOUNT_ID..=MAX_DATABASE_MOUNT_ID {
        while let Some(used_mount_id) = used.peek() {
            match used_mount_id {
                Ok(used_mount_id) if *used_mount_id < mount_id => {
                    used.next();
                }
                Ok(used_mount_id) if *used_mount_id == mount_id => break,
                Ok(_) => return Ok(mount_id),
                Err(error) => return Err(error.to_string()),
            }
        }
        if used.peek().is_none() {
            return Ok(mount_id);
        }
        used.next();
    }
    Err("database mount_id capacity exhausted".to_string())
}

fn record_mount_history(
    conn: &Connection,
    database_id: &str,
    mount_id: u16,
    reason: &str,
    now: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO database_mount_history
         (database_id, mount_id, reason, created_at_ms)
         VALUES (?1, ?2, ?3, ?4)",
        params![database_id, i64::from(mount_id), reason, now],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn record_shard_placement(
    conn: &Connection,
    database_id: &str,
    mount_id: Option<u16>,
    status: DatabaseStatus,
    schema_version: &str,
    now: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO database_shard_placements
         (database_id, shard_id, canister_id, mount_id, status, schema_version, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(database_id) DO UPDATE SET
           shard_id = excluded.shard_id,
           canister_id = excluded.canister_id,
           mount_id = excluded.mount_id,
           status = excluded.status,
           schema_version = excluded.schema_version,
           updated_at_ms = excluded.updated_at_ms",
        params![
            database_id,
            LOCAL_SHARD_ID,
            mount_id,
            status_to_db(status),
            schema_version,
            now
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn update_shard_placement_status(
    conn: &Connection,
    database_id: &str,
    status: DatabaseStatus,
    now: i64,
) -> Result<(), String> {
    let updated = conn
        .execute(
            "UPDATE database_shard_placements
         SET status = ?2,
             updated_at_ms = ?3
         WHERE database_id = ?1",
            params![database_id, status_to_db(status), now],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("database shard placement not found: {database_id}"));
    }
    Ok(())
}

fn validate_snapshot_hash(snapshot_hash: &[u8]) -> Result<(), String> {
    if snapshot_hash.len() == SHA256_DIGEST_BYTES {
        Ok(())
    } else {
        Err(format!(
            "snapshot_hash must be a {SHA256_DIGEST_BYTES}-byte SHA-256 digest"
        ))
    }
}

fn remove_database_image(_path: &str) -> Result<(), String> {
    Ok(())
}

fn read_database_image_chunk(path: &str, offset: u64, chunk_len: u64) -> Result<Vec<u8>, String> {
    crate::sqlite_facade::export_database_image_chunk(path, offset, chunk_len)
        .map_err(|error| error.to_string())
}

fn write_database_restore_bytes(
    conn: &Connection,
    database_id: &str,
    offset: u64,
    end: u64,
    bytes: &[u8],
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO database_restore_chunks (database_id, offset_bytes, end_bytes, bytes)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            database_id,
            i64::try_from(offset).map_err(|error| error.to_string())?,
            i64::try_from(end).map_err(|error| error.to_string())?,
            bytes
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn finalize_database_image_restore(
    path: &str,
    database_id: &str,
    expected_size: u64,
    expected_hash: Vec<u8>,
    conn: &Connection,
) -> Result<(), String> {
    let chunks = restore_chunks_with_bytes(conn, database_id)?;
    let (actual_hash, checksum, size) = restore_chunk_digests(&chunks, expected_size)?;
    if size != expected_size {
        return Err(format!(
            "restore size mismatch: expected {expected_size} bytes, got {size} bytes"
        ));
    }
    if actual_hash != expected_hash {
        return Err("snapshot_hash does not match restored database bytes".to_string());
    }
    crate::sqlite_facade::begin_database_image_import(path, expected_size, checksum)
        .map_err(|error| error.to_string())?;
    if let Err(error) = import_restore_chunks(path, &chunks, expected_size) {
        crate::sqlite_facade::cancel_database_image_import(path);
        return Err(error);
    }
    crate::sqlite_facade::finish_database_image_import(path).map_err(|error| error.to_string())?;
    Connection::open(path)
        .and_then(|conn| conn.execute_batch("PRAGMA application_id = 0x49435044;"))
        .map_err(|error| error.to_string())
}

struct RestoreChunk {
    offset: u64,
    end: u64,
    bytes: Vec<u8>,
}

fn restore_chunks_with_bytes(
    conn: &Connection,
    database_id: &str,
) -> Result<Vec<RestoreChunk>, String> {
    conn.prepare(
        "SELECT offset_bytes, end_bytes, bytes
         FROM database_restore_chunks
         WHERE database_id = ?1
         ORDER BY offset_bytes ASC, end_bytes ASC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![database_id], |row| {
        let offset = row.get::<_, i64>(0)?;
        let end = row.get::<_, i64>(1)?;
        Ok(RestoreChunk {
            offset: u64::try_from(offset).map_err(|_| sqlite_facade::Error::InvalidQuery)?,
            end: u64::try_from(end).map_err(|_| sqlite_facade::Error::InvalidQuery)?,
            bytes: row.get(2)?,
        })
    })
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn restore_chunk_digests(
    chunks: &[RestoreChunk],
    expected_size: u64,
) -> Result<(Vec<u8>, u64, u64), String> {
    let mut covered_end = 0_u64;
    let mut sha = Sha256::new();
    let mut checksum = crate::sqlite_facade::fnv1a64_init();
    for chunk in chunks {
        if chunk.end > expected_size {
            return Err(format!(
                "restore chunk exceeds expected size: end {} > {expected_size}",
                chunk.end
            ));
        }
        if chunk.offset > covered_end {
            return Err(format!(
                "restore chunks are incomplete for expected size {expected_size} bytes"
            ));
        }
        if chunk.end <= covered_end {
            continue;
        }
        let skip =
            usize::try_from(covered_end - chunk.offset).map_err(|error| error.to_string())?;
        let bytes = chunk
            .bytes
            .get(skip..)
            .ok_or_else(|| "restore chunk bytes do not match recorded range".to_string())?;
        sha.update(bytes);
        checksum = crate::sqlite_facade::fnv1a64_update(checksum, bytes);
        covered_end = chunk.end;
        if covered_end == expected_size {
            break;
        }
    }
    Ok((sha.finalize().to_vec(), checksum, covered_end))
}

fn import_restore_chunks(
    path: &str,
    chunks: &[RestoreChunk],
    expected_size: u64,
) -> Result<(), String> {
    let mut covered_end = 0_u64;
    for chunk in chunks {
        if chunk.end <= covered_end {
            continue;
        }
        let skip =
            usize::try_from(covered_end - chunk.offset).map_err(|error| error.to_string())?;
        let bytes = chunk
            .bytes
            .get(skip..)
            .ok_or_else(|| "restore chunk bytes do not match recorded range".to_string())?;
        crate::sqlite_facade::import_database_image_chunk(path, covered_end, bytes)
            .map_err(|error| error.to_string())?;
        covered_end = chunk.end;
        if covered_end == expected_size {
            return Ok(());
        }
    }
    Err(format!(
        "restore chunks are incomplete for expected size {expected_size} bytes"
    ))
}

fn file_sha256(path: &str) -> Result<Vec<u8>, String> {
    let size = file_size(path)?;
    let mut hasher = Sha256::new();
    let mut offset = 0_u64;
    while offset < size {
        let chunk_len = (size - offset).min(64 * 1024);
        let bytes = crate::sqlite_facade::export_database_image_chunk(path, offset, chunk_len)
            .map_err(|error| error.to_string())?;
        if bytes.is_empty() {
            break;
        }
        offset += u64::try_from(bytes.len()).map_err(|error| error.to_string())?;
        hasher.update(bytes);
    }
    Ok(hasher.finalize().to_vec())
}

fn purge_old_usage_events(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM usage_events
         WHERE event_id <= (
           SELECT COALESCE(MAX(event_id), 0) - ?1 FROM usage_events
         )",
        params![i64::try_from(USAGE_EVENTS_RETENTION_LIMIT).unwrap_or(i64::MAX)],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn database_meta_error(conn: &Connection, database_id: &str) -> String {
    match conn
        .query_row(
            "SELECT status FROM databases WHERE database_id = ?1",
            params![database_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
    {
        Ok(Some(status))
            if status == "hot"
                || status == "archived"
                || status == "archiving"
                || status == "restoring"
                || status == "deleted" =>
        {
            format!("database is {status}: {database_id}")
        }
        _ => format!("database not found: {database_id}"),
    }
}

fn load_database(conn: &Connection, database_id: &str) -> Result<Option<DatabaseMeta>, String> {
    load_database_with_statuses(conn, database_id, &[DatabaseStatus::Hot])
}

fn load_database_status(conn: &Connection, database_id: &str) -> Result<DatabaseStatus, String> {
    conn.query_row(
        "SELECT status FROM databases WHERE database_id = ?1",
        params![database_id],
        |row| status_from_db(&row.get::<_, String>(0)?),
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("database not found: {database_id}"))
}

fn load_database_with_statuses(
    conn: &Connection,
    database_id: &str,
    statuses: &[DatabaseStatus],
) -> Result<Option<DatabaseMeta>, String> {
    conn.query_row(
        "SELECT database_id, db_file_name, active_mount_id, schema_version, logical_size_bytes, status
         FROM databases
         WHERE database_id = ?1",
        params![database_id],
        |row| map_database_meta_with_statuses(row, statuses),
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_databases(conn: &Connection) -> Result<Vec<DatabaseMeta>, String> {
    conn.prepare(
        "SELECT database_id, db_file_name, active_mount_id, schema_version, logical_size_bytes, status
         FROM databases
         WHERE status IN ('hot', 'archiving', 'restoring') AND active_mount_id IS NOT NULL
         ORDER BY mount_id ASC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![], map_database_meta)
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn load_database_infos(conn: &Connection) -> Result<Vec<DatabaseInfo>, String> {
    conn.prepare(
        "SELECT database_id, status, active_mount_id, schema_version, logical_size_bytes,
                snapshot_hash, archived_at_ms, deleted_at_ms
         FROM databases
         ORDER BY database_id ASC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![], |row| {
        let mount_id: Option<i64> = row.get(2)?;
        let logical_size_bytes: i64 = row.get(4)?;
        Ok(DatabaseInfo {
            database_id: row.get(0)?,
            status: status_from_db(&row.get::<_, String>(1)?)?,
            mount_id: mount_id.map(mount_id_from_db).transpose()?,
            schema_version: row.get(3)?,
            logical_size_bytes: logical_size_bytes.max(0) as u64,
            snapshot_hash: row.get(5)?,
            archived_at_ms: row.get(6)?,
            deleted_at_ms: row.get(7)?,
        })
    })
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn load_database_summaries_for_caller(
    conn: &Connection,
    caller: &str,
) -> Result<Vec<DatabaseSummary>, String> {
    conn.prepare(
        "SELECT d.database_id, d.status, m.role, d.logical_size_bytes,
                d.archived_at_ms, d.deleted_at_ms
         FROM databases d
         INNER JOIN database_members m ON m.database_id = d.database_id
         WHERE m.principal = ?1
         ORDER BY d.database_id ASC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![caller], |row| {
        let logical_size_bytes: i64 = row.get(3)?;
        Ok(DatabaseSummary {
            database_id: row.get(0)?,
            status: status_from_db(&row.get::<_, String>(1)?)?,
            role: role_from_db(&row.get::<_, String>(2)?)?,
            logical_size_bytes: logical_size_bytes.max(0) as u64,
            archived_at_ms: row.get(4)?,
            deleted_at_ms: row.get(5)?,
        })
    })
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn load_database_shard_placements_for_caller(
    conn: &Connection,
    caller: &str,
) -> Result<Vec<DatabaseShardPlacement>, String> {
    conn.prepare(
        "SELECT p.database_id, p.shard_id, p.canister_id, p.mount_id, p.status,
                p.schema_version, p.created_at_ms, p.updated_at_ms
         FROM database_shard_placements p
         INNER JOIN database_members m ON m.database_id = p.database_id
         WHERE m.principal = ?1
         ORDER BY p.database_id ASC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![caller], map_database_shard_placement)
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn load_all_database_shard_placements(
    conn: &Connection,
) -> Result<Vec<DatabaseShardPlacement>, String> {
    conn.prepare(
        "SELECT database_id, shard_id, canister_id, mount_id, status,
                schema_version, created_at_ms, updated_at_ms
         FROM database_shard_placements
         ORDER BY database_id ASC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![], map_database_shard_placement)
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn load_database_shard_placement(
    conn: &Connection,
    database_id: &str,
) -> Result<Option<DatabaseShardPlacement>, String> {
    conn.query_row(
        "SELECT database_id, shard_id, canister_id, mount_id, status,
                schema_version, created_at_ms, updated_at_ms
         FROM database_shard_placements
         WHERE database_id = ?1",
        params![database_id],
        map_database_shard_placement,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_database_shards(conn: &Connection) -> Result<Vec<DatabaseShardInfo>, String> {
    conn.prepare(
        "SELECT s.shard_id, s.canister_id, s.status, s.max_databases,
                COALESCE(assigned.assigned_databases, 0),
                s.created_at_ms, s.updated_at_ms
         FROM database_shards s
         LEFT JOIN (
           SELECT canister_id, COUNT(*) AS assigned_databases
           FROM database_shard_placements
           WHERE canister_id IS NOT NULL AND status <> 'deleted'
           GROUP BY canister_id
         ) assigned ON assigned.canister_id = s.canister_id
         ORDER BY s.created_at_ms ASC, s.shard_id ASC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![], map_database_shard)
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn load_database_shard(
    conn: &Connection,
    shard_id: &str,
) -> Result<Option<DatabaseShardInfo>, String> {
    conn.query_row(
        "SELECT s.shard_id, s.canister_id, s.status, s.max_databases,
                COALESCE(assigned.assigned_databases, 0),
                s.created_at_ms, s.updated_at_ms
         FROM database_shards s
         LEFT JOIN (
           SELECT canister_id, COUNT(*) AS assigned_databases
           FROM database_shard_placements
           WHERE canister_id IS NOT NULL AND status <> 'deleted'
           GROUP BY canister_id
         ) assigned ON assigned.canister_id = s.canister_id
         WHERE s.shard_id = ?1",
        params![shard_id],
        map_database_shard,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn select_database_shard_for_create(
    conn: &Connection,
) -> Result<Option<DatabaseShardInfo>, String> {
    conn.query_row(
        "SELECT s.shard_id, s.canister_id, s.status, s.max_databases,
                COALESCE(assigned.assigned_databases, 0),
                s.created_at_ms, s.updated_at_ms
         FROM database_shards s
         LEFT JOIN (
           SELECT canister_id, COUNT(*) AS assigned_databases
           FROM database_shard_placements
           WHERE canister_id IS NOT NULL AND status <> 'deleted'
           GROUP BY canister_id
         ) assigned ON assigned.canister_id = s.canister_id
         WHERE s.status = 'active'
           AND COALESCE(assigned.assigned_databases, 0) < s.max_databases
         ORDER BY COALESCE(assigned.assigned_databases, 0) ASC,
                  s.created_at_ms ASC,
                  s.shard_id ASC
         LIMIT 1",
        params![],
        map_database_shard,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn ensure_database_shard_has_capacity(
    conn: &Connection,
    database_canister_id: &str,
) -> Result<(), String> {
    let Some(shard) = load_database_shard(conn, &database_shard_id(database_canister_id))? else {
        return Ok(());
    };
    if shard.status != "active" {
        return Err(format!("database shard is not active: {}", shard.shard_id));
    }
    if shard.assigned_databases >= u64::from(shard.max_databases) {
        return Err(format!(
            "database shard capacity exhausted: {} >= {}",
            shard.assigned_databases, shard.max_databases
        ));
    }
    Ok(())
}

fn map_database_shard(row: &sqlite_facade::Row<'_>) -> sqlite_facade::Result<DatabaseShardInfo> {
    let max_databases: i64 = row.get(3)?;
    let assigned_databases: i64 = row.get(4)?;
    Ok(DatabaseShardInfo {
        shard_id: row.get(0)?,
        canister_id: row.get(1)?,
        status: row.get(2)?,
        max_databases: mount_id_from_db(max_databases)?,
        assigned_databases: assigned_databases.max(0) as u64,
        created_at_ms: row.get(5)?,
        updated_at_ms: row.get(6)?,
    })
}

fn map_database_shard_placement(
    row: &sqlite_facade::Row<'_>,
) -> sqlite_facade::Result<DatabaseShardPlacement> {
    let mount_id: Option<i64> = row.get(3)?;
    Ok(DatabaseShardPlacement {
        database_id: row.get(0)?,
        shard_id: row.get(1)?,
        canister_id: row.get(2)?,
        mount_id: mount_id.map(mount_id_from_db).transpose()?,
        status: status_from_db(&row.get::<_, String>(4)?)?,
        schema_version: row.get(5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn load_routed_operation(
    conn: &Connection,
    operation_id: &str,
) -> Result<Option<RoutedOperationInfo>, String> {
    conn.query_row(
        "SELECT operation_id, database_id, database_canister_id, method,
                request_hash, status, error, created_at_ms, updated_at_ms
         FROM routed_operations
         WHERE operation_id = ?1",
        params![operation_id],
        map_routed_operation,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_routed_operation_billing_units(
    conn: &Connection,
    operation_id: &str,
) -> Result<u64, String> {
    conn.query_row(
        "SELECT billing_units FROM routed_operations WHERE operation_id = ?1",
        params![operation_id],
        |row| {
            let billing_units: i64 = row.get(0)?;
            Ok(billing_units.max(0) as u64)
        },
    )
    .map_err(|error| error.to_string())
}

fn map_routed_operation(
    row: &sqlite_facade::Row<'_>,
) -> sqlite_facade::Result<RoutedOperationInfo> {
    Ok(RoutedOperationInfo {
        operation_id: row.get(0)?,
        database_id: row.get(1)?,
        database_canister_id: row.get(2)?,
        method: row.get(3)?,
        request_hash: row.get(4)?,
        status: routed_operation_status_from_db(&row.get::<_, String>(5)?)?,
        error: row.get(6)?,
        created_at_ms: row.get(7)?,
        updated_at_ms: row.get(8)?,
    })
}

fn load_data_plane_operation(
    conn: &Connection,
    operation_id: &str,
) -> Result<Option<DataPlaneOperationInfo>, String> {
    conn.query_row(
        "SELECT operation_id, database_id, method, request_hash, created_at_ms
         FROM data_plane_operations
         WHERE operation_id = ?1",
        params![operation_id],
        map_data_plane_operation,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn map_data_plane_operation(
    row: &sqlite_facade::Row<'_>,
) -> sqlite_facade::Result<DataPlaneOperationInfo> {
    Ok(DataPlaneOperationInfo {
        operation_id: row.get(0)?,
        database_id: row.get(1)?,
        method: row.get(2)?,
        request_hash: row.get(3)?,
        created_at_ms: row.get(4)?,
    })
}

fn load_shard_operation(
    conn: &Connection,
    operation_id: &str,
) -> Result<Option<ShardOperationInfo>, String> {
    conn.query_row(
        "SELECT operation_id, operation_kind, target, request_hash, status,
                error, created_at_ms, updated_at_ms
         FROM shard_operations
         WHERE operation_id = ?1",
        params![operation_id],
        map_shard_operation,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_shard_operations(conn: &Connection) -> Result<Vec<ShardOperationInfo>, String> {
    let mut statement = conn
        .prepare(
            "SELECT operation_id, operation_kind, target, request_hash, status,
                    error, created_at_ms, updated_at_ms
             FROM shard_operations
             ORDER BY updated_at_ms DESC, operation_id ASC
             LIMIT 200",
        )
        .map_err(|error| error.to_string())?;
    statement
        .query_map(params![], map_shard_operation)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn map_shard_operation(row: &sqlite_facade::Row<'_>) -> sqlite_facade::Result<ShardOperationInfo> {
    Ok(ShardOperationInfo {
        operation_id: row.get(0)?,
        operation_kind: row.get(1)?,
        target: row.get(2)?,
        request_hash: row.get(3)?,
        status: routed_operation_status_from_db(&row.get::<_, String>(4)?)?,
        error: row.get(5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn load_database_usage(conn: &Connection, database_id: &str) -> Result<DatabaseUsage, String> {
    conn.query_row(
        "SELECT database_id, status, logical_size_bytes, max_logical_size_bytes,
                (SELECT COUNT(*) FROM usage_events WHERE database_id = databases.database_id)
         FROM databases
         WHERE database_id = ?1",
        params![database_id],
        |row| {
            let logical_size_bytes: i64 = row.get(2)?;
            let max_logical_size_bytes: i64 = row.get(3)?;
            let usage_event_count: i64 = row.get(4)?;
            Ok(DatabaseUsage {
                database_id: row.get(0)?,
                status: status_from_db(&row.get::<_, String>(1)?)?,
                logical_size_bytes: logical_size_bytes.max(0) as u64,
                max_logical_size_bytes: max_logical_size_bytes.max(0) as u64,
                usage_event_count: usage_event_count.max(0) as u64,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("database not found: {database_id}"))
}

fn load_database_usage_event_summaries(
    conn: &Connection,
    database_id: &str,
) -> Result<Vec<DatabaseUsageEventSummary>, String> {
    let mut statement = conn
        .prepare(
            "SELECT method, operation, success, COUNT(*), COALESCE(SUM(cycles_delta), 0),
                    COALESCE(SUM(rows_returned), 0), COALESCE(SUM(rows_affected), 0),
                    MAX(created_at_ms)
             FROM usage_events
             WHERE database_id = ?1
             GROUP BY method, operation, success
             ORDER BY MAX(created_at_ms) DESC, method ASC, success DESC
             LIMIT 25",
        )
        .map_err(|error| error.to_string())?;
    statement
        .query_map(params![database_id], |row| {
            let success: i64 = row.get(2)?;
            let event_count: i64 = row.get(3)?;
            let total_cycles_delta: i64 = row.get(4)?;
            let total_rows_returned: i64 = row.get(5)?;
            let total_rows_affected: i64 = row.get(6)?;
            Ok(DatabaseUsageEventSummary {
                method: row.get(0)?,
                operation: row.get(1)?,
                success: success != 0,
                event_count: event_count.max(0) as u64,
                total_cycles_delta: total_cycles_delta.max(0) as u64,
                total_rows_returned: total_rows_returned.max(0) as u64,
                total_rows_affected: total_rows_affected.max(0) as u64,
                last_created_at_ms: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn map_database_meta_with_statuses(
    row: &sqlite_facade::Row<'_>,
    statuses: &[DatabaseStatus],
) -> sqlite_facade::Result<DatabaseMeta> {
    let status: String = row.get(5).unwrap_or_else(|_| "hot".to_string());
    let status = status_from_db(&status)?;
    if !statuses.contains(&status) {
        return Err(sqlite_facade::Error::QueryReturnedNoRows);
    }
    map_database_meta(row)
}

fn map_database_meta(row: &sqlite_facade::Row<'_>) -> sqlite_facade::Result<DatabaseMeta> {
    let mount_id: Option<i64> = row.get(2)?;
    let mount_id = mount_id.ok_or(sqlite_facade::Error::QueryReturnedNoRows)?;
    let logical_size_bytes: i64 = row.get(4)?;
    Ok(DatabaseMeta {
        database_id: row.get(0)?,
        db_file_name: row.get(1)?,
        mount_id: mount_id_from_db(mount_id)?,
        schema_version: row.get(3)?,
        logical_size_bytes: logical_size_bytes.max(0) as u64,
    })
}

fn mount_id_from_db(mount_id: i64) -> sqlite_facade::Result<u16> {
    u16::try_from(mount_id).map_err(|_| sqlite_facade::Error::IntegralValueOutOfRange(2, mount_id))
}

fn load_member_role(
    conn: &Connection,
    database_id: &str,
    principal: &str,
) -> Result<Option<DatabaseRole>, String> {
    conn.query_row(
        "SELECT role FROM database_members WHERE database_id = ?1 AND principal = ?2",
        params![database_id, principal],
        |row| role_from_db(&row.get::<_, String>(0)?),
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn reject_last_owner_removal(
    conn: &Connection,
    database_id: &str,
    principal: &str,
) -> Result<(), String> {
    if load_member_role(conn, database_id, principal)? != Some(DatabaseRole::Owner) {
        return Ok(());
    }
    let owner_count = conn
        .query_row(
            "SELECT COUNT(*) FROM database_members WHERE database_id = ?1 AND role = 'owner'",
            params![database_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if owner_count <= 1 {
        return Err(format!(
            "database must keep at least one owner principal: {database_id}"
        ));
    }
    Ok(())
}

fn load_database_tokens(
    conn: &Connection,
    database_id: &str,
) -> Result<Vec<DatabaseTokenInfo>, String> {
    conn.prepare(
        "SELECT token_id, database_id, name, scope, created_at_ms, last_used_at_ms, revoked_at_ms
         FROM database_tokens
         WHERE database_id = ?1
         ORDER BY created_at_ms DESC, token_id ASC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![database_id], map_database_token)
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn load_database_token(
    conn: &Connection,
    database_id: &str,
    token_id: &str,
) -> Result<Option<DatabaseTokenInfo>, String> {
    conn.query_row(
        "SELECT token_id, database_id, name, scope, created_at_ms, last_used_at_ms, revoked_at_ms
         FROM database_tokens
         WHERE database_id = ?1 AND token_id = ?2",
        params![database_id, token_id],
        map_database_token,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_payments(conn: &Connection, database_id: &str) -> Result<Vec<PaymentRecord>, String> {
    conn.prepare(
        "SELECT payment_id, database_id, payer_principal, amount_e8s, credited_units,
                block_index, created_at_ms
         FROM payments
         WHERE database_id = ?1
         ORDER BY created_at_ms DESC, block_index DESC",
    )
    .map_err(|error| error.to_string())?
    .query_map(params![database_id], map_payment_record)
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())
}

fn load_payment_by_block(
    conn: &Connection,
    block_index: u64,
) -> Result<Option<PaymentRecord>, String> {
    let block_index = u64_to_sqlite_i64(block_index, "block_index")?;
    conn.query_row(
        "SELECT payment_id, database_id, payer_principal, amount_e8s, credited_units,
                block_index, created_at_ms
         FROM payments
         WHERE block_index = ?1",
        params![block_index],
        map_payment_record,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_billing_config_u64(conn: &Connection, key: &str) -> Result<Option<u64>, String> {
    conn.query_row(
        "SELECT value_u64 FROM billing_config WHERE key = ?1",
        params![key],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|value| value.map(|value| value.max(0) as u64))
    .map_err(|error| error.to_string())
}

fn map_payment_record(row: &sqlite_facade::Row<'_>) -> sqlite_facade::Result<PaymentRecord> {
    let amount_e8s: i64 = row.get(3)?;
    let credited_units: i64 = row.get(4)?;
    let block_index: i64 = row.get(5)?;
    Ok(PaymentRecord {
        payment_id: row.get(0)?,
        database_id: row.get(1)?,
        payer_principal: row.get(2)?,
        amount_e8s: amount_e8s.max(0) as u64,
        credited_units: credited_units.max(0) as u64,
        block_index: block_index.max(0) as u64,
        created_at_ms: row.get(6)?,
    })
}

fn map_database_token(row: &sqlite_facade::Row<'_>) -> sqlite_facade::Result<DatabaseTokenInfo> {
    Ok(DatabaseTokenInfo {
        token_id: row.get(0)?,
        database_id: row.get(1)?,
        name: row.get(2)?,
        scope: token_scope_from_db(&row.get::<_, String>(3)?)?,
        created_at_ms: row.get(4)?,
        last_used_at_ms: row.get(5)?,
        revoked_at_ms: row.get(6)?,
    })
}

fn role_from_db(role: &str) -> sqlite_facade::Result<DatabaseRole> {
    match role {
        "owner" => Ok(DatabaseRole::Owner),
        "writer" => Ok(DatabaseRole::Writer),
        "reader" => Ok(DatabaseRole::Reader),
        _ => Err(sqlite_facade::Error::InvalidQuery),
    }
}

fn role_to_db(role: DatabaseRole) -> &'static str {
    match role {
        DatabaseRole::Owner => "owner",
        DatabaseRole::Writer => "writer",
        DatabaseRole::Reader => "reader",
    }
}

fn billing_status_from_db(status: &str) -> sqlite_facade::Result<DatabaseBillingStatus> {
    match status {
        "active" => Ok(DatabaseBillingStatus::Active),
        "suspended" => Ok(DatabaseBillingStatus::Suspended),
        _ => Err(sqlite_facade::Error::InvalidQuery),
    }
}

fn token_scope_from_db(scope: &str) -> sqlite_facade::Result<DatabaseTokenScope> {
    match scope {
        "read" => Ok(DatabaseTokenScope::Read),
        "write" => Ok(DatabaseTokenScope::Write),
        "owner" => Ok(DatabaseTokenScope::Owner),
        _ => Err(sqlite_facade::Error::InvalidQuery),
    }
}

fn token_scope_to_db(scope: DatabaseTokenScope) -> &'static str {
    match scope {
        DatabaseTokenScope::Read => "read",
        DatabaseTokenScope::Write => "write",
        DatabaseTokenScope::Owner => "owner",
    }
}

fn token_scope_allows(scope: DatabaseTokenScope, required_role: RequiredRole) -> bool {
    match scope {
        DatabaseTokenScope::Read => required_role == RequiredRole::Reader,
        DatabaseTokenScope::Write => {
            required_role == RequiredRole::Reader || required_role == RequiredRole::Writer
        }
        DatabaseTokenScope::Owner => true,
    }
}

fn status_from_db(status: &str) -> sqlite_facade::Result<DatabaseStatus> {
    match status {
        "hot" => Ok(DatabaseStatus::Hot),
        "archiving" => Ok(DatabaseStatus::Archiving),
        "archived" => Ok(DatabaseStatus::Archived),
        "deleted" => Ok(DatabaseStatus::Deleted),
        "restoring" => Ok(DatabaseStatus::Restoring),
        _ => Err(sqlite_facade::Error::InvalidQuery),
    }
}

fn status_to_db(status: DatabaseStatus) -> &'static str {
    match status {
        DatabaseStatus::Hot => "hot",
        DatabaseStatus::Archiving => "archiving",
        DatabaseStatus::Archived => "archived",
        DatabaseStatus::Deleted => "deleted",
        DatabaseStatus::Restoring => "restoring",
    }
}

fn routed_operation_status_from_db(status: &str) -> sqlite_facade::Result<RoutedOperationStatus> {
    match status {
        "pending" => Ok(RoutedOperationStatus::Pending),
        "applied" => Ok(RoutedOperationStatus::Applied),
        "failed" => Ok(RoutedOperationStatus::Failed),
        "unknown" => Ok(RoutedOperationStatus::Unknown),
        _ => Err(sqlite_facade::Error::InvalidQuery),
    }
}

fn routed_operation_status_to_db(status: RoutedOperationStatus) -> &'static str {
    match status {
        RoutedOperationStatus::Pending => "pending",
        RoutedOperationStatus::Applied => "applied",
        RoutedOperationStatus::Failed => "failed",
        RoutedOperationStatus::Unknown => "unknown",
    }
}

fn role_allows(role: DatabaseRole, required_role: RequiredRole) -> bool {
    match required_role {
        RequiredRole::Reader => matches!(
            role,
            DatabaseRole::Reader | DatabaseRole::Writer | DatabaseRole::Owner
        ),
        RequiredRole::Writer => matches!(role, DatabaseRole::Writer | DatabaseRole::Owner),
        RequiredRole::Owner => role == DatabaseRole::Owner,
    }
}

fn file_size(path: &str) -> Result<u64, String> {
    crate::sqlite_facade::database_image_size(path).map_err(|error| error.to_string())
}
