// Where: crates/vfs_runtime/src/lib.rs
// What: Service orchestration for multiple hosted SQLite databases.
// Why: One canister can host isolated SQL databases with shared lifecycle, quota, and billing.
mod sql;

use std::fs::{File, OpenOptions, create_dir_all, metadata, remove_file};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};
use vfs_types::{
    DatabaseArchiveInfo, DatabaseBalanceTopUpRequest, DatabaseBilling, DatabaseBillingStatus,
    DatabaseInfo, DatabaseMember, DatabaseQuotaRequest, DatabaseRole, DatabaseStatus,
    DatabaseSummary, DatabaseTokenInfo, DatabaseTokenScope, DatabaseUsage, DepositQuote,
    DepositResult, PaymentRecord, SqlBatchRequest, SqlExecuteRequest, SqlExecuteResponse,
};

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
const DATABASE_SCHEMA_VERSION: &str = "sqlite:raw";
const MIN_DATABASE_MOUNT_ID: u16 = 11;
const MAX_DATABASE_MOUNT_ID: u16 = 32767;
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
pub const SQL_QUERY_BILLING_UNITS: u64 = 1;
pub const SQL_EXECUTE_BILLING_UNITS: u64 = 5;
pub const ICP_E8S_PER_ICP: u64 = 100_000_000;
pub const ICPDB_UNITS_PER_ICP: u64 = 100_000;
pub const MIN_DEPOSIT_E8S: u64 = 1_000_000;
pub const ICP_TRANSFER_FEE_E8S_DEFAULT: u64 = 10_000;
const BILLING_CONFIG_ICP_TRANSFER_FEE_E8S: &str = "icp_transfer_fee_e8s";

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequiredRole {
    Reader,
    Writer,
    Owner,
}

pub struct UsageEvent<'a> {
    pub method: &'a str,
    pub database_id: Option<&'a str>,
    pub caller: &'a str,
    pub success: bool,
    pub cycles_delta: u128,
    pub error: Option<&'a str>,
    pub now: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthenticatedDatabaseToken {
    pub token_id: String,
    pub database_id: String,
    pub scope: DatabaseTokenScope,
}

pub struct VfsService {
    index_path: PathBuf,
    databases_dir: PathBuf,
}

impl VfsService {
    pub fn new(index_path: PathBuf, databases_dir: PathBuf) -> Self {
        Self {
            index_path,
            databases_dir,
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

    pub fn record_usage_event(&self, event: UsageEvent<'_>) -> Result<(), String> {
        let conn = self.open_index()?;
        conn.execute(
            "INSERT INTO usage_events
             (method, database_id, caller, success, cycles_delta, error, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                event.method,
                event.database_id,
                event.caller,
                if event.success { 1_i64 } else { 0_i64 },
                i64::try_from(event.cycles_delta).unwrap_or(i64::MAX),
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
        conn.query_row("SELECT COUNT(*) FROM usage_events", [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|count| count.max(0) as u64)
        .map_err(|error| error.to_string())
    }

    pub fn database_usage(&self, database_id: &str, caller: &str) -> Result<DatabaseUsage, String> {
        self.require_role(database_id, caller, RequiredRole::Reader)?;
        let conn = self.open_index()?;
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

    pub fn set_database_quota(
        &self,
        caller: &str,
        request: DatabaseQuotaRequest,
    ) -> Result<DatabaseUsage, String> {
        self.require_role(&request.database_id, caller, RequiredRole::Owner)?;
        if request.max_logical_size_bytes == 0 {
            return Err("max_logical_size_bytes must be greater than 0".to_string());
        }
        let current_size = self
            .database_usage(&request.database_id, caller)?
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
        self.database_usage(&request.database_id, caller)
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
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET billing_balance_units = billing_balance_units + ?2,
                 billing_status = 'active'
             WHERE database_id = ?1",
            params![
                &request.database_id,
                i64::try_from(request.units).unwrap_or(i64::MAX)
            ],
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

    pub fn create_database_token(
        &self,
        caller: &str,
        request: vfs_types::CreateDatabaseTokenRequest,
        token_hash: Vec<u8>,
        now: i64,
    ) -> Result<DatabaseTokenInfo, String> {
        self.require_role(&request.database_id, caller, RequiredRole::Owner)?;
        validate_database_token_name(&request.name)?;
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

    pub fn list_database_tokens(
        &self,
        database_id: &str,
        caller: &str,
    ) -> Result<Vec<DatabaseTokenInfo>, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
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
            "DELETE FROM databases WHERE database_id = ?1",
            params![database_id],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        if let Some(db_file_name) = db_file_name
            && let Err(error) = remove_file(&db_file_name)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            return Err(error.to_string());
        }
        Ok(())
    }

    pub fn run_database_migrations(&self, database_id: &str) -> Result<(), String> {
        let meta = self.database_meta(database_id)?;
        if let Some(parent) = Path::new(&meta.db_file_name).parent() {
            create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let result = Connection::open(&meta.db_file_name)
            .and_then(|conn| conn.execute_batch("PRAGMA application_id = 0x49435044;"));
        if result.is_ok() {
            self.refresh_logical_size(database_id)?;
        }
        result.map_err(|error| error.to_string())
    }

    pub fn delete_database(&self, database_id: &str, caller: &str, now: i64) -> Result<(), String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        let meta = self.database_meta(database_id)?;
        if let Err(error) = remove_file(&meta.db_file_name)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            return Err(error.to_string());
        }
        let conn = self.open_index()?;
        conn.execute(
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
        Ok(())
    }

    pub fn begin_database_archive(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseArchiveInfo, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        let meta = self.database_meta(database_id)?;
        let size_bytes = file_size(&meta.db_file_name)?;
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET status = 'archiving',
                 updated_at_ms = ?2
             WHERE database_id = ?1",
            params![database_id, now],
        )
        .map_err(|error| error.to_string())?;
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
        let mut file = File::open(&meta.db_file_name).map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        let remaining = size.saturating_sub(offset);
        let chunk_len = remaining.min(u64::from(max_bytes));
        let mut bytes = Vec::with_capacity(chunk_len as usize);
        file.take(chunk_len)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    }

    pub fn finalize_database_archive(
        &self,
        database_id: &str,
        caller: &str,
        snapshot_hash: Vec<u8>,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Archiving])?;
        validate_snapshot_hash(&snapshot_hash)?;
        let actual_hash = file_sha256(&meta.db_file_name)?;
        if actual_hash != snapshot_hash {
            return Err("snapshot_hash does not match archived database bytes".to_string());
        }
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
        Ok(meta)
    }

    pub fn cancel_database_archive(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Archiving])?;
        let conn = self.open_index()?;
        conn.execute(
            "UPDATE databases
             SET status = 'hot',
                 updated_at_ms = ?2
             WHERE database_id = ?1",
            params![database_id, now],
        )
        .map_err(|error| error.to_string())?;
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
        tx.commit().map_err(|error| error.to_string())?;
        let meta = self.database_meta_allowing_restoring(database_id)?;
        let _ = remove_file(&meta.db_file_name);
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
        if bytes.len() > MAX_RESTORE_CHUNK_BYTES {
            return Err(format!(
                "restore chunk size exceeds limit: {} > {MAX_RESTORE_CHUNK_BYTES}",
                bytes.len()
            ));
        }
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Restoring])?;
        let expected_size = self.restore_size_bytes(database_id)?;
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "restore chunk range overflows u64".to_string())?;
        if end > expected_size {
            return Err(format!(
                "restore chunk exceeds expected size: end {end} > {expected_size}"
            ));
        }
        if let Some(parent) = Path::new(&meta.db_file_name).parent() {
            create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&meta.db_file_name)
            .map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        let conn = self.open_index()?;
        conn.execute(
            "INSERT OR REPLACE INTO database_restore_chunks (database_id, offset_bytes, end_bytes)
             VALUES (?1, ?2, ?3)",
            params![
                database_id,
                i64::try_from(offset).map_err(|error| error.to_string())?,
                i64::try_from(end).map_err(|error| error.to_string())?
            ],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn finalize_database_restore(
        &self,
        database_id: &str,
        caller: &str,
        now: i64,
    ) -> Result<DatabaseMeta, String> {
        self.require_role(database_id, caller, RequiredRole::Owner)?;
        let meta = self.database_meta_with_statuses(database_id, &[DatabaseStatus::Restoring])?;
        let expected_size = self.restore_size_bytes(database_id)?;
        if !restore_chunks_cover_expected_size(&self.open_index()?, database_id, expected_size)? {
            return Err(format!(
                "restore chunks are incomplete for expected size {expected_size} bytes"
            ));
        }
        OpenOptions::new()
            .write(true)
            .open(&meta.db_file_name)
            .and_then(|file| file.set_len(expected_size))
            .map_err(|error| error.to_string())?;
        let size = file_size(&meta.db_file_name)?;
        if size != expected_size {
            return Err(format!(
                "restore size mismatch: expected {expected_size} bytes, got {size} bytes"
            ));
        }
        let expected_hash = self.restore_snapshot_hash(database_id)?;
        let actual_hash = file_sha256(&meta.db_file_name)?;
        if actual_hash != expected_hash {
            return Err("snapshot_hash does not match restored database bytes".to_string());
        }
        Connection::open(&meta.db_file_name)
            .and_then(|conn| conn.execute_batch("PRAGMA application_id = 0x49435044;"))
            .map_err(|error| error.to_string())?;
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
        if caller == principal && role != DatabaseRole::Owner {
            return Err("owner cannot downgrade own access".to_string());
        }
        let conn = self.open_index()?;
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
        self.database_meta(database_id)?;
        if caller == principal {
            return Err("owner cannot revoke own access".to_string());
        }
        let conn = self.open_index()?;
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
        self.database_meta(database_id)?;
        let conn = self.open_index()?;
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
        self.ensure_database_has_units(&database_id, SQL_QUERY_BILLING_UNITS)?;
        let result = self.with_database_path(
            &database_id,
            caller,
            RequiredRole::Reader,
            |database_path, max_database_size_bytes| {
                sql::execute_sql_file(
                    database_path,
                    request,
                    sql::SqlMode::ReadOnly,
                    max_database_size_bytes,
                )
            },
        );
        if result.is_ok() {
            self.charge_database_units(&database_id, SQL_QUERY_BILLING_UNITS)?;
        }
        result
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
                sql::execute_sql_file(
                    database_path,
                    request,
                    sql::SqlMode::ReadWrite,
                    max_database_size_bytes,
                )
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
                sql::execute_sql_batch_file(
                    database_path,
                    request.statements,
                    request.max_rows,
                    max_database_size_bytes,
                )
            },
        );
        if result.is_ok() {
            self.charge_database_units(&database_id, billing_units)?;
            self.refresh_logical_size(&database_id)?;
        }
        result
    }

    pub fn sql_query_with_token(
        &self,
        auth: &AuthenticatedDatabaseToken,
        request: SqlExecuteRequest,
    ) -> Result<SqlExecuteResponse, String> {
        if auth.database_id != request.database_id {
            return Err("api token database_id does not match request".to_string());
        }
        self.ensure_database_has_units(&auth.database_id, SQL_QUERY_BILLING_UNITS)?;
        let result = self.with_database_path_for_token(
            &auth.database_id,
            RequiredRole::Reader,
            auth.scope,
            |database_path, max_database_size_bytes| {
                sql::execute_sql_file(
                    database_path,
                    request,
                    sql::SqlMode::ReadOnly,
                    max_database_size_bytes,
                )
            },
        );
        if result.is_ok() {
            self.charge_database_units(&auth.database_id, SQL_QUERY_BILLING_UNITS)?;
        }
        result
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
                sql::execute_sql_file(
                    database_path,
                    request,
                    sql::SqlMode::ReadWrite,
                    max_database_size_bytes,
                )
            },
        );
        if result.is_ok() {
            self.charge_database_units(&auth.database_id, SQL_EXECUTE_BILLING_UNITS)?;
            self.refresh_logical_size(&auth.database_id)?;
        }
        result
    }

    fn with_database_path<T>(
        &self,
        database_id: &str,
        caller: &str,
        required_role: RequiredRole,
        f: impl FnOnce(&Path, u64) -> Result<T, String>,
    ) -> Result<T, String> {
        self.require_role(database_id, caller, required_role)?;
        let meta = self.database_meta(database_id)?;
        f(
            Path::new(&meta.db_file_name),
            self.database_quota(database_id)?,
        )
    }

    fn with_database_path_for_token<T>(
        &self,
        database_id: &str,
        required_role: RequiredRole,
        scope: DatabaseTokenScope,
        f: impl FnOnce(&Path, u64) -> Result<T, String>,
    ) -> Result<T, String> {
        if !token_scope_allows(scope, required_role) {
            return Err("api token scope does not allow this operation".to_string());
        }
        let meta = self.database_meta(database_id)?;
        f(
            Path::new(&meta.db_file_name),
            self.database_quota(database_id)?,
        )
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
        Connection::open(&self.index_path).map_err(|error| error.to_string())
    }
}

fn run_index_migrations(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version TEXT PRIMARY KEY,
           applied_at INTEGER NOT NULL
         );",
    )
    .map_err(|error| error.to_string())?;
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
            "DROP INDEX IF EXISTS databases_mount_id_idx;
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
    Ok(())
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

fn database_file_name(databases_dir: &Path, database_id: &str) -> Result<String, String> {
    validate_database_id(database_id)?;
    Ok(databases_dir
        .join(format!("{database_id}.sqlite3"))
        .to_string_lossy()
        .into_owned())
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
        .query_map([], |row| row.get::<_, i64>(0))
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

fn validate_snapshot_hash(snapshot_hash: &[u8]) -> Result<(), String> {
    if snapshot_hash.len() == SHA256_DIGEST_BYTES {
        Ok(())
    } else {
        Err(format!(
            "snapshot_hash must be a {SHA256_DIGEST_BYTES}-byte SHA-256 digest"
        ))
    }
}

fn file_sha256(path: &str) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
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
    .query_map([], map_database_meta)
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
    .query_map([], |row| {
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

fn map_database_meta_with_statuses(
    row: &rusqlite::Row<'_>,
    statuses: &[DatabaseStatus],
) -> rusqlite::Result<DatabaseMeta> {
    let status: String = row.get(5).unwrap_or_else(|_| "hot".to_string());
    let status = status_from_db(&status)?;
    if !statuses.contains(&status) {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    map_database_meta(row)
}

fn map_database_meta(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseMeta> {
    let mount_id: Option<i64> = row.get(2)?;
    let mount_id = mount_id.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    let logical_size_bytes: i64 = row.get(4)?;
    Ok(DatabaseMeta {
        database_id: row.get(0)?,
        db_file_name: row.get(1)?,
        mount_id: mount_id_from_db(mount_id)?,
        schema_version: row.get(3)?,
        logical_size_bytes: logical_size_bytes.max(0) as u64,
    })
}

fn mount_id_from_db(mount_id: i64) -> rusqlite::Result<u16> {
    u16::try_from(mount_id).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(2, mount_id))
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

fn map_payment_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<PaymentRecord> {
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

fn map_database_token(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseTokenInfo> {
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

fn role_from_db(role: &str) -> rusqlite::Result<DatabaseRole> {
    match role {
        "owner" => Ok(DatabaseRole::Owner),
        "writer" => Ok(DatabaseRole::Writer),
        "reader" => Ok(DatabaseRole::Reader),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn role_to_db(role: DatabaseRole) -> &'static str {
    match role {
        DatabaseRole::Owner => "owner",
        DatabaseRole::Writer => "writer",
        DatabaseRole::Reader => "reader",
    }
}

fn billing_status_from_db(status: &str) -> rusqlite::Result<DatabaseBillingStatus> {
    match status {
        "active" => Ok(DatabaseBillingStatus::Active),
        "suspended" => Ok(DatabaseBillingStatus::Suspended),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn token_scope_from_db(scope: &str) -> rusqlite::Result<DatabaseTokenScope> {
    match scope {
        "read" => Ok(DatabaseTokenScope::Read),
        "write" => Ok(DatabaseTokenScope::Write),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn token_scope_to_db(scope: DatabaseTokenScope) -> &'static str {
    match scope {
        DatabaseTokenScope::Read => "read",
        DatabaseTokenScope::Write => "write",
    }
}

fn token_scope_allows(scope: DatabaseTokenScope, required_role: RequiredRole) -> bool {
    match scope {
        DatabaseTokenScope::Read => required_role == RequiredRole::Reader,
        DatabaseTokenScope::Write => {
            required_role == RequiredRole::Reader || required_role == RequiredRole::Writer
        }
    }
}

fn status_from_db(status: &str) -> rusqlite::Result<DatabaseStatus> {
    match status {
        "hot" => Ok(DatabaseStatus::Hot),
        "archiving" => Ok(DatabaseStatus::Archiving),
        "archived" => Ok(DatabaseStatus::Archived),
        "deleted" => Ok(DatabaseStatus::Deleted),
        "restoring" => Ok(DatabaseStatus::Restoring),
        _ => Err(rusqlite::Error::InvalidQuery),
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
    metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|error| error.to_string())
}
