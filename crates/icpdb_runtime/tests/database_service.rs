// Where: crates/icpdb_runtime/tests/database_service.rs
// What: Multi-database service tests over local SQLite files.
// Why: The canister mount layer depends on runtime index and role semantics being deterministic.
use std::path::PathBuf;

use icpdb_runtime::{
    ICP_TRANSFER_FEE_E8S_DEFAULT, ICPDB_UNITS_PER_ICP, IcpdbService, MAX_ARCHIVE_CHUNK_BYTES,
    MAX_DATABASE_SIZE_BYTES, MAX_RESTORE_CHUNK_BYTES, MIN_DEPOSIT_E8S, SQL_EXECUTE_BILLING_UNITS,
    USAGE_EVENTS_RETENTION_LIMIT, UsageEvent, hash_api_token,
};
use icpdb_types::{
    CreateDatabaseTokenRequest, DatabaseBalanceTopUpRequest, DatabaseBillingStatus, DatabaseRole,
    DatabaseStatus, DatabaseTokenScope, SqlBatchRequest, SqlExecuteRequest, SqlStatement, SqlValue,
};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn service() -> IcpdbService {
    service_with_root().0
}

fn service_with_root() -> (IcpdbService, PathBuf) {
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = IcpdbService::new(root.join("index.sqlite3"), root.join("databases"));
    service
        .run_index_migrations()
        .expect("index migrations should run");
    (service, root)
}

fn assert_restore_size(root: &std::path::Path, database_id: &str, expected: Option<u64>) {
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    let actual: Option<i64> = conn
        .query_row(
            "SELECT restore_size_bytes FROM databases WHERE database_id = ?1",
            params![database_id],
            |row| row.get(0),
        )
        .expect("restore size row should exist");
    assert_eq!(actual.map(|size| size as u64), expected);
}

fn sha256_bytes(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

fn database_index_row(
    root: &std::path::Path,
    database_id: &str,
) -> (String, Option<u16>, u64, Option<u64>) {
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.query_row(
        "SELECT status, active_mount_id, logical_size_bytes, restore_size_bytes
         FROM databases WHERE database_id = ?1",
        params![database_id],
        |row| {
            let active_mount_id: Option<i64> = row.get(1)?;
            let logical_size_bytes: i64 = row.get(2)?;
            let restore_size_bytes: Option<i64> = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                active_mount_id.map(|value| value as u16),
                logical_size_bytes.max(0) as u64,
                restore_size_bytes.map(|value| value.max(0) as u64),
            ))
        },
    )
    .expect("database index row should exist")
}

fn database_updated_at_ms(root: &std::path::Path, database_id: &str) -> i64 {
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.query_row(
        "SELECT updated_at_ms FROM databases WHERE database_id = ?1",
        params![database_id],
        |row| row.get(0),
    )
    .expect("database updated_at_ms should load")
}

fn database_member_count(root: &std::path::Path, database_id: &str) -> i64 {
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.query_row(
        "SELECT COUNT(*) FROM database_members WHERE database_id = ?1",
        params![database_id],
        |row| row.get(0),
    )
    .expect("member count should load")
}

fn assert_generated_database_id(database_id: &str) {
    assert!(database_id.starts_with("db_"));
    assert_eq!(database_id.len(), 15);
    assert!(database_id.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_')
    }));
}

fn schema_migration_count(root: &std::path::Path, version: &str) -> i64 {
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
        params![version],
        |row| row.get(0),
    )
    .expect("migration count should load")
}

fn mount_history_row(root: &std::path::Path, mount_id: u16) -> (String, String) {
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.query_row(
        "SELECT database_id, reason FROM database_mount_history WHERE mount_id = ?1",
        params![i64::from(mount_id)],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .expect("mount history row should exist")
}

fn database_restore_chunk_count(root: &std::path::Path, database_id: &str) -> i64 {
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.query_row(
        "SELECT COUNT(*) FROM database_restore_chunks WHERE database_id = ?1",
        params![database_id],
        |row| row.get(0),
    )
    .expect("restore chunk count should load")
}

type UsageEventTuple = (
    String,
    Option<String>,
    String,
    i64,
    i64,
    Option<String>,
    i64,
);

fn usage_event_rows(root: &std::path::Path) -> Vec<UsageEventTuple> {
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.prepare(
        "SELECT method, database_id, caller, success, cycles_delta, error, created_at_ms
         FROM usage_events
         ORDER BY event_id ASC",
    )
    .expect("usage query should prepare")
    .query_map([], |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
        ))
    })
    .expect("usage query should run")
    .collect::<Result<Vec<_>, _>>()
    .expect("usage rows should collect")
}

fn read_archive_in_chunks(
    service: &IcpdbService,
    database_id: &str,
    size_bytes: u64,
    chunk_size: u32,
) -> Vec<u8> {
    let mut offset = 0_u64;
    let mut bytes = Vec::new();
    while offset < size_bytes {
        let chunk = service
            .read_database_archive_chunk(database_id, "owner", offset, chunk_size)
            .expect("archive chunk should read");
        assert!(chunk.len() <= chunk_size as usize);
        assert!(!chunk.is_empty());
        offset += chunk.len() as u64;
        bytes.extend(chunk);
    }
    bytes
}

fn archive_bytes_for_chunk_size(
    service: &IcpdbService,
    database_id: &str,
    size_bytes: u64,
    chunk_size: u32,
) -> Vec<u8> {
    if chunk_size >= size_bytes as u32 {
        return service
            .read_database_archive_chunk(database_id, "owner", 0, chunk_size)
            .expect("single archive chunk should read");
    }
    read_archive_in_chunks(service, database_id, size_bytes, chunk_size)
}

fn sql_request(database_id: &str, sql: &str) -> SqlExecuteRequest {
    SqlExecuteRequest {
        database_id: database_id.to_string(),
        sql: sql.to_string(),
        params: Vec::new(),
        max_rows: None,
    }
}

#[test]
fn index_migrations_create_usage_events_and_mount_history_once() {
    let (service, root) = service_with_root();

    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    for table_name in ["usage_events", "database_mount_history"] {
        let table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table_name],
                |row| row.get(0),
            )
            .expect("table lookup should work");
        assert_eq!(table_exists, 1);
    }
    assert_eq!(
        schema_migration_count(&root, "database_index:004_usage_events"),
        1
    );
    assert_eq!(
        schema_migration_count(&root, "database_index:005_mount_history"),
        1
    );

    service
        .run_index_migrations()
        .expect("index migrations should be idempotent");
    assert_eq!(
        schema_migration_count(&root, "database_index:004_usage_events"),
        1
    );
    assert_eq!(
        schema_migration_count(&root, "database_index:005_mount_history"),
        1
    );
}

#[test]
fn generated_database_create_returns_hash_id_and_owner_member() {
    let (service, root) = service_with_root();

    let meta = service
        .create_generated_database("owner", 1)
        .expect("generated database should create");

    assert_generated_database_id(&meta.database_id);
    assert_eq!(meta.mount_id, 11);
    assert_eq!(database_member_count(&root, &meta.database_id), 1);
    let row = database_index_row(&root, &meta.database_id);
    assert_eq!(row.0, "hot");
    assert_eq!(row.1, Some(11));
    assert!(row.2 > 0);
    assert_eq!(row.3, None);
}

#[test]
fn generated_database_create_avoids_same_input_collision_by_mount_id() {
    let service = service();

    let first = service
        .create_generated_database("owner", 1)
        .expect("first generated database should create");
    let second = service
        .create_generated_database("owner", 1)
        .expect("second generated database should create");

    assert_generated_database_id(&first.database_id);
    assert_generated_database_id(&second.database_id);
    assert_ne!(first.database_id, second.database_id);
    assert_eq!(first.mount_id, 11);
    assert_eq!(second.mount_id, 12);
}

#[test]
fn sql_execute_writes_and_sql_query_reads_rows() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");

    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"
                    .to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect("table create should execute");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "INSERT INTO accounts (name) VALUES (?1)".to_string(),
                params: vec![SqlValue::Text("alice".to_string())],
                max_rows: None,
            },
        )
        .expect("insert should execute");

    let response = service
        .sql_query(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id,
                sql: "SELECT id, name FROM accounts WHERE name = ?1".to_string(),
                params: vec![SqlValue::Text("alice".to_string())],
                max_rows: Some(10),
            },
        )
        .expect("select should query");

    assert_eq!(response.columns, vec!["id", "name"]);
    assert_eq!(
        response.rows,
        vec![vec![
            SqlValue::Integer(1),
            SqlValue::Text("alice".to_string())
        ]]
    );
    assert!(!response.truncated);
}

#[test]
fn sql_query_rejects_writes() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");

    let error = service
        .sql_query(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id,
                sql: "CREATE TABLE blocked (id INTEGER)".to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect_err("query endpoint should reject write SQL");

    assert_eq!(error, "sql_query only accepts read-only SQL");
}

#[test]
fn sql_query_is_free_and_allows_empty_balance() {
    let (service, root) = service_with_root();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");
    let initial = service
        .database_billing(&meta.database_id, "owner")
        .expect("billing should load");

    service
        .sql_query(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "SELECT 1".to_string(),
                params: vec![],
                max_rows: Some(1),
            },
        )
        .expect("query should succeed");
    let charged = service
        .database_billing(&meta.database_id, "owner")
        .expect("billing should load after query");
    assert_eq!(charged.balance_units, initial.balance_units);
    assert_eq!(charged.spent_units, initial.spent_units);

    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.execute(
        "UPDATE databases SET billing_balance_units = 0 WHERE database_id = ?1",
        params![meta.database_id],
    )
    .expect("test balance should update");
    let response = service
        .sql_query(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "SELECT 1".to_string(),
                params: vec![],
                max_rows: Some(1),
            },
        )
        .expect("empty balance should still allow query");
    assert_eq!(response.rows.len(), 1);
    assert_eq!(
        service
            .database_billing(&meta.database_id, "owner")
            .expect("billing should load")
            .status,
        DatabaseBillingStatus::Active
    );
}

#[test]
fn sql_execute_rejects_file_affecting_statements() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");

    for sql in [
        "ATTACH DATABASE 'outside.sqlite3' AS outside",
        "DETACH DATABASE outside",
        "VACUUM",
        "PRAGMA journal_mode = WAL",
        "  -- leading comment\nATTACH DATABASE 'outside.sqlite3' AS outside",
        "/* leading block */ VACUUM",
    ] {
        let error = service
            .sql_execute(
                "owner",
                SqlExecuteRequest {
                    database_id: meta.database_id.clone(),
                    sql: sql.to_string(),
                    params: vec![],
                    max_rows: None,
                },
            )
            .expect_err("file-affecting SQL should be rejected");
        assert_eq!(error, "sql statement is not allowed for hosted databases");
    }
}

#[test]
fn sql_batch_rejects_forbidden_statement_and_rolls_back() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");

    let error = service
        .sql_batch(
            "owner",
            SqlBatchRequest {
                database_id: meta.database_id.clone(),
                statements: vec![
                    SqlStatement {
                        sql: "CREATE TABLE rollback_probe (id INTEGER)".to_string(),
                        params: vec![],
                    },
                    SqlStatement {
                        sql: "VACUUM".to_string(),
                        params: vec![],
                    },
                ],
                max_rows: None,
            },
        )
        .expect_err("forbidden batch statement should fail");
    assert_eq!(error, "sql statement is not allowed for hosted databases");

    let error = service
        .sql_query(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id,
                sql: "SELECT COUNT(*) FROM rollback_probe".to_string(),
                params: vec![],
                max_rows: Some(1),
            },
        )
        .expect_err("table creation should roll back");
    assert!(error.contains("no such table: rollback_probe"));
}

#[test]
fn database_usage_counts_database_scoped_usage_events() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");

    service
        .record_usage_event(UsageEvent {
            method: "sql_execute",
            database_id: Some(&meta.database_id),
            caller: "owner",
            success: true,
            cycles_delta: 10,
            error: None,
            now: 2,
        })
        .expect("usage should record");
    service
        .record_usage_event(UsageEvent {
            method: "list_databases",
            database_id: None,
            caller: "owner",
            success: true,
            cycles_delta: 1,
            error: None,
            now: 3,
        })
        .expect("global usage should record");

    let usage = service
        .database_usage(&meta.database_id, "owner")
        .expect("database usage should load");

    assert_eq!(usage.database_id, meta.database_id);
    assert_eq!(usage.status, DatabaseStatus::Hot);
    assert_eq!(usage.usage_event_count, 1);
    assert!(usage.max_logical_size_bytes >= usage.logical_size_bytes);
}

#[test]
fn database_quota_blocks_oversized_sql_write_and_rolls_back() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "CREATE TABLE quota_probe (payload BLOB)".to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect("table should create before quota is lowered");
    let usage = service
        .database_usage(&meta.database_id, "owner")
        .expect("usage should load");
    service
        .set_database_quota(
            "owner",
            icpdb_types::DatabaseQuotaRequest {
                database_id: meta.database_id.clone(),
                max_logical_size_bytes: usage.logical_size_bytes + 4096,
            },
        )
        .expect("quota should lower above current size");

    let error = service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "INSERT INTO quota_probe (payload) VALUES (zeroblob(1000000))".to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect_err("oversized insert should fail");
    assert!(error.starts_with("database quota exceeded:"));

    let response = service
        .sql_query(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id,
                sql: "SELECT COUNT(*) FROM quota_probe".to_string(),
                params: vec![],
                max_rows: Some(1),
            },
        )
        .expect("count query should work");
    assert_eq!(response.rows, vec![vec![SqlValue::Integer(0)]]);
}

#[test]
fn set_database_quota_rejects_values_below_current_size() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");
    let usage = service
        .database_usage(&meta.database_id, "owner")
        .expect("usage should load");

    let error = service
        .set_database_quota(
            "owner",
            icpdb_types::DatabaseQuotaRequest {
                database_id: meta.database_id,
                max_logical_size_bytes: usage.logical_size_bytes.saturating_sub(1),
            },
        )
        .expect_err("quota below current size should fail");

    assert!(error.starts_with("quota is below current database size:"));
}

#[test]
fn database_tokens_authorize_http_sql_by_scope_and_track_last_use() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("database should create");
    service
        .create_database_token(
            "owner",
            CreateDatabaseTokenRequest {
                database_id: "alpha".to_string(),
                name: "web-read".to_string(),
                scope: DatabaseTokenScope::Read,
            },
            hash_api_token("secret-read"),
            10,
        )
        .expect("read token should create");
    let auth = service
        .authenticate_database_token("secret-read", icpdb_runtime::RequiredRole::Reader, 11)
        .expect("read token should authenticate");
    assert_eq!(auth.database_id, "alpha");

    let usage = service
        .sql_query_with_token(
            &auth,
            SqlExecuteRequest {
                database_id: "alpha".to_string(),
                sql: "SELECT 1".to_string(),
                params: Vec::new(),
                max_rows: None,
            },
        )
        .expect("read token should query");
    assert_eq!(usage.rows.len(), 1);
    let error = service
        .authenticate_database_token("secret-read", icpdb_runtime::RequiredRole::Writer, 12)
        .expect_err("read token should not write");
    assert_eq!(error, "api token scope does not allow this operation");

    let tokens = service
        .list_database_tokens("alpha", "owner")
        .expect("tokens should list");
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens[0].last_used_at_ms, Some(11));
}

#[test]
fn billing_units_are_charged_and_exhaustion_suspends_database() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("database should create");
    let initial = service
        .database_billing("alpha", "owner")
        .expect("billing should load");
    assert_eq!(initial.status, DatabaseBillingStatus::Active);

    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: "alpha".to_string(),
                sql: "CREATE TABLE billing_probe (id INTEGER)".to_string(),
                params: Vec::new(),
                max_rows: None,
            },
        )
        .expect("write should charge");
    let charged = service
        .database_billing("alpha", "owner")
        .expect("billing should load after charge");
    assert_eq!(
        initial.balance_units - charged.balance_units,
        SQL_EXECUTE_BILLING_UNITS
    );
    assert_eq!(charged.spent_units, SQL_EXECUTE_BILLING_UNITS);

    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.execute(
        "UPDATE databases SET billing_balance_units = 0 WHERE database_id = 'alpha'",
        [],
    )
    .expect("test balance should update");
    let error = service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: "alpha".to_string(),
                sql: "INSERT INTO billing_probe (id) VALUES (1)".to_string(),
                params: Vec::new(),
                max_rows: None,
            },
        )
        .expect_err("empty balance should block write");
    assert!(error.starts_with("database billing balance exhausted:"));
    assert_eq!(
        service
            .database_billing("alpha", "owner")
            .expect("billing should load suspended")
            .status,
        DatabaseBillingStatus::Suspended
    );

    service
        .top_up_database_balance(DatabaseBalanceTopUpRequest {
            database_id: "alpha".to_string(),
            units: 1,
        })
        .expect("top-up should reactivate");
}

#[test]
fn icp_transfer_fee_config_defaults_and_updates_from_bad_fee() {
    let service = service();

    assert_eq!(
        service
            .icp_transfer_fee_e8s()
            .expect("default fee should load"),
        ICP_TRANSFER_FEE_E8S_DEFAULT
    );

    service
        .update_icp_transfer_fee_from_bad_fee(12_345, 2)
        .expect("bad fee should update cache");

    assert_eq!(
        service
            .icp_transfer_fee_e8s()
            .expect("updated fee should load"),
        12_345
    );
}

#[test]
fn approved_deposit_records_payment_and_reactivates_billing() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("database should create");
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.execute(
        "UPDATE databases SET billing_status = 'suspended' WHERE database_id = 'alpha'",
        [],
    )
    .expect("test billing status should update");

    let quote = service
        .deposit_quote(
            "alpha",
            "owner",
            MIN_DEPOSIT_E8S,
            "ryjl3-tyaaa-aaaaa-aaaba-cai",
            "aaaaa-aa",
        )
        .expect("quote should convert units");
    assert_eq!(quote.credited_units, ICPDB_UNITS_PER_ICP / 100);

    let result = service
        .record_approved_deposit(
            "alpha",
            "owner",
            MIN_DEPOSIT_E8S,
            "ryjl3-tyaaa-aaaaa-aaaba-cai",
            42,
            2,
        )
        .expect("deposit should record");
    assert_eq!(result.credited_units, quote.credited_units);
    assert_eq!(result.block_index, 42);
    assert_eq!(
        service
            .database_billing("alpha", "owner")
            .expect("billing should load")
            .status,
        DatabaseBillingStatus::Active
    );

    let payments = service
        .list_payments("alpha", "owner")
        .expect("payments should list");
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].amount_e8s, MIN_DEPOSIT_E8S);
    assert_eq!(payments[0].credited_units, quote.credited_units);
}

#[test]
fn duplicate_payment_block_is_rejected_but_existing_result_can_be_loaded() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("database should create");
    service
        .record_approved_deposit(
            "alpha",
            "owner",
            MIN_DEPOSIT_E8S,
            "ryjl3-tyaaa-aaaaa-aaaba-cai",
            77,
            2,
        )
        .expect("first payment should record");

    let duplicate = service
        .record_approved_deposit(
            "alpha",
            "owner",
            MIN_DEPOSIT_E8S,
            "ryjl3-tyaaa-aaaaa-aaaba-cai",
            77,
            3,
        )
        .expect_err("duplicate block should fail");
    assert_eq!(duplicate, "payment block already recorded: 77");

    let existing = service
        .deposit_result_for_existing_payment("alpha", "owner", 77)
        .expect("recorded duplicate block should load");
    assert_eq!(existing.block_index, 77);
    assert_eq!(existing.amount_e8s, MIN_DEPOSIT_E8S);
}

#[test]
fn sql_batch_runs_statements_in_one_write_call() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");

    let responses = service
        .sql_batch(
            "owner",
            SqlBatchRequest {
                database_id: meta.database_id.clone(),
                statements: vec![
                    SqlStatement {
                        sql: "CREATE TABLE events (id INTEGER PRIMARY KEY, label TEXT)".to_string(),
                        params: vec![],
                    },
                    SqlStatement {
                        sql: "INSERT INTO events (label) VALUES (?1)".to_string(),
                        params: vec![SqlValue::Text("created".to_string())],
                    },
                    SqlStatement {
                        sql: "SELECT label FROM events".to_string(),
                        params: vec![],
                    },
                ],
                max_rows: Some(10),
            },
        )
        .expect("batch should execute");

    assert_eq!(responses.len(), 3);
    assert_eq!(responses[1].rows_affected, 1);
    assert_eq!(
        responses[2].rows,
        vec![vec![SqlValue::Text("created".to_string())]]
    );
}

#[test]
fn records_minimal_usage_events() {
    let (service, root) = service_with_root();

    service
        .record_usage_event(UsageEvent {
            method: "sql_execute",
            database_id: Some("alpha"),
            caller: "owner",
            success: true,
            cycles_delta: 12,
            error: None,
            now: 10,
        })
        .expect("success event should record");
    service
        .record_usage_event(UsageEvent {
            method: "create_database",
            database_id: None,
            caller: "owner",
            success: false,
            cycles_delta: 34,
            error: Some("database already exists"),
            now: 11,
        })
        .expect("failure event should record");

    let rows = usage_event_rows(&root);
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0],
        (
            "sql_execute".to_string(),
            Some("alpha".to_string()),
            "owner".to_string(),
            1,
            12,
            None,
            10
        )
    );
    assert_eq!(
        rows[1],
        (
            "create_database".to_string(),
            None,
            "owner".to_string(),
            0,
            34,
            Some("database already exists".to_string()),
            11
        )
    );
}

#[test]
fn usage_events_keep_recent_retention_window() {
    let (service, root) = service_with_root();
    let mut conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    let tx = conn.transaction().expect("transaction should start");

    for index in 0..USAGE_EVENTS_RETENTION_LIMIT + 98 {
        tx.execute(
            "INSERT INTO usage_events
             (method, database_id, caller, success, cycles_delta, error, created_at_ms)
             VALUES ('sql_execute', 'alpha', 'owner', 1, 1, NULL, ?1)",
            params![i64::try_from(index).expect("index should fit")],
        )
        .expect("usage event should insert");
    }
    tx.commit().expect("transaction should commit");

    service
        .record_usage_event(UsageEvent {
            method: "sql_execute",
            database_id: Some("alpha"),
            caller: "owner",
            success: true,
            cycles_delta: 1,
            error: None,
            now: i64::try_from(USAGE_EVENTS_RETENTION_LIMIT + 98).expect("index should fit"),
        })
        .expect("usage event should record");
    assert_eq!(
        service
            .usage_event_count()
            .expect("usage count should load"),
        USAGE_EVENTS_RETENTION_LIMIT + 99
    );

    service
        .record_usage_event(UsageEvent {
            method: "sql_execute",
            database_id: Some("alpha"),
            caller: "owner",
            success: true,
            cycles_delta: 1,
            error: None,
            now: i64::try_from(USAGE_EVENTS_RETENTION_LIMIT + 99).expect("index should fit"),
        })
        .expect("usage event should record");

    assert_eq!(
        service
            .usage_event_count()
            .expect("usage count should load"),
        USAGE_EVENTS_RETENTION_LIMIT
    );
}

#[test]
fn creates_databases_with_unique_mount_ids() {
    let service = service();

    let alpha = service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    let beta = service
        .create_database("beta", "owner", 2)
        .expect("beta should create");

    assert_eq!(alpha.mount_id, 11);
    assert_eq!(beta.mount_id, 12);
    assert_ne!(alpha.db_file_name, beta.db_file_name);
}

#[test]
fn lists_database_summaries_for_caller_memberships_only() {
    let service = service();
    service
        .create_database("alpha", "owner_a", 1)
        .expect("alpha should create");
    service
        .create_database("beta", "owner_b", 2)
        .expect("beta should create");
    service
        .grant_database_access("alpha", "owner_a", "owner_b", DatabaseRole::Reader, 3)
        .expect("shared grant should succeed");

    let owner_a_summaries = service
        .list_database_summaries_for_caller("owner_a")
        .expect("owner_a summaries should load");
    assert_eq!(owner_a_summaries.len(), 1);
    assert_eq!(owner_a_summaries[0].database_id, "alpha");
    assert_eq!(owner_a_summaries[0].role, DatabaseRole::Owner);
    assert_eq!(owner_a_summaries[0].status, DatabaseStatus::Hot);

    let owner_b_summaries = service
        .list_database_summaries_for_caller("owner_b")
        .expect("owner_b summaries should load");
    let owner_b_ids = owner_b_summaries
        .iter()
        .map(|summary| summary.database_id.clone())
        .collect::<Vec<_>>();
    let owner_b_roles = owner_b_summaries
        .into_iter()
        .map(|summary| summary.role)
        .collect::<Vec<_>>();
    assert_eq!(owner_b_ids, vec!["alpha".to_string(), "beta".to_string()]);
    assert_eq!(
        owner_b_roles,
        vec![DatabaseRole::Reader, DatabaseRole::Owner]
    );

    let outsider_summaries = service
        .list_database_summaries_for_caller("outsider")
        .expect("outsider summaries should load");
    assert!(outsider_summaries.is_empty());
}

#[test]
fn discards_failed_database_reservation_for_retry() {
    let (service, root) = service_with_root();
    service
        .reserve_database("retryable", "owner", 1)
        .expect("reservation should create");
    assert_eq!(database_member_count(&root, "retryable"), 1);

    service
        .discard_database_reservation("retryable")
        .expect("reservation should discard");
    assert_eq!(database_member_count(&root, "retryable"), 0);

    let meta = service
        .create_database("retryable", "owner", 2)
        .expect("same database_id should create after discard");
    assert_eq!(meta.database_id, "retryable");
    assert_eq!(database_member_count(&root, "retryable"), 1);
}

#[test]
fn rejects_invalid_database_ids() {
    let service = service();

    for database_id in ["", "../escape", "has/slash", "has.dot", "has space"] {
        let error = service
            .create_database(database_id, "owner", 1)
            .expect_err("invalid database_id should be rejected");
        assert!(
            error.contains("database_id"),
            "error should mention database_id for {database_id:?}: {error}"
        );
    }

    let too_long = "a".repeat(65);
    let error = service
        .create_database(&too_long, "owner", 1)
        .expect_err("too long database_id should be rejected");
    assert!(error.contains("1..64"));
}

#[test]
fn rejects_database_creation_after_mount_capacity() {
    let (service, root) = service_with_root();
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");

    for mount_id in 11..32767 {
        conn.execute(
            "INSERT INTO databases
             (database_id, db_file_name, mount_id, active_mount_id, status, schema_version,
              logical_size_bytes, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?3, 'hot', 'sqlite:raw', 0, 1, 1)",
            params![
                format!("reserved_{mount_id}"),
                format!("reserved_{mount_id}.sqlite3"),
                i64::from(mount_id)
            ],
        )
        .expect("reserved mount_id should insert");
        conn.execute(
            "INSERT INTO database_mount_history
             (database_id, mount_id, reason, created_at_ms)
             VALUES (?1, ?2, 'create', 1)",
            params![format!("reserved_{mount_id}"), i64::from(mount_id)],
        )
        .expect("reserved mount history should insert");
    }

    let meta = service
        .create_database("db_32767", "owner", 32767)
        .expect("last mount_id should create");
    assert_eq!(meta.mount_id, 32767);

    let error = service
        .create_database("db_32768", "owner", 32768)
        .expect_err("next database should exceed mount capacity");
    assert_eq!(error, "database mount_id capacity exhausted");
}

#[test]
fn isolates_sql_tables_between_databases() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .create_database("beta", "owner", 2)
        .expect("beta should create");

    for database_id in ["alpha", "beta"] {
        service
            .sql_execute(
                "owner",
                SqlExecuteRequest {
                    database_id: database_id.to_string(),
                    sql: "CREATE TABLE shared (body TEXT)".to_string(),
                    params: vec![],
                    max_rows: None,
                },
            )
            .expect("table create should succeed");
        service
            .sql_execute(
                "owner",
                SqlExecuteRequest {
                    database_id: database_id.to_string(),
                    sql: "INSERT INTO shared (body) VALUES (?1)".to_string(),
                    params: vec![SqlValue::Text(format!("{database_id} body"))],
                    max_rows: None,
                },
            )
            .expect("insert should succeed");
    }

    let alpha = service
        .sql_query("owner", sql_request("alpha", "SELECT body FROM shared"))
        .expect("alpha query should succeed");
    let beta = service
        .sql_query("owner", sql_request("beta", "SELECT body FROM shared"))
        .expect("beta query should succeed");

    assert_eq!(alpha.rows[0][0], SqlValue::Text("alpha body".to_string()));
    assert_eq!(beta.rows[0][0], SqlValue::Text("beta body".to_string()));
}

#[test]
fn tracks_logical_size_and_does_not_reuse_deleted_slots() {
    let (service, root) = service_with_root();
    let alpha = service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute(
            "owner",
            sql_request("alpha", "CREATE TABLE size_smoke (body TEXT)"),
        )
        .expect("sql write should succeed");

    let alpha_info = service
        .list_database_infos()
        .expect("infos should load")
        .into_iter()
        .find(|info| info.database_id == "alpha")
        .expect("alpha info should exist");
    assert_eq!(alpha_info.status, DatabaseStatus::Hot);
    assert!(alpha_info.logical_size_bytes > 0);

    service
        .delete_database("alpha", "owner", 3)
        .expect("delete should succeed");
    assert_restore_size(&root, "alpha", None);
    assert!(
        service
            .sql_query("owner", sql_request("alpha", "SELECT 1"))
            .expect_err("deleted DB should reject reads")
            .contains("database is deleted")
    );

    let beta = service
        .create_database("beta", "owner", 4)
        .expect("beta should create with a fresh slot");
    assert_ne!(beta.mount_id, alpha.mount_id);
    assert_eq!(
        mount_history_row(&root, alpha.mount_id),
        ("alpha".to_string(), "create".to_string())
    );
    assert_eq!(
        mount_history_row(&root, beta.mount_id),
        ("beta".to_string(), "create".to_string())
    );
}

#[test]
fn delete_database_allows_missing_file_but_rejects_other_remove_errors() {
    let (service, root) = service_with_root();
    service
        .create_database("missing_file", "owner", 1)
        .expect("database should create");
    let missing_file = service
        .list_databases()
        .expect("databases should load")
        .into_iter()
        .find(|meta| meta.database_id == "missing_file")
        .expect("database meta should exist")
        .db_file_name;
    std::fs::remove_file(&missing_file).expect("database file should delete");
    service
        .delete_database("missing_file", "owner", 2)
        .expect("missing file should not block delete");
    assert_eq!(database_index_row(&root, "missing_file").0, "deleted");

    service
        .create_database("remove_error", "owner", 3)
        .expect("database should create");
    let conn = Connection::open(root.join("index.sqlite3")).expect("index should open");
    conn.execute(
        "UPDATE databases SET db_file_name = ?2 WHERE database_id = ?1",
        params!["remove_error", root.to_string_lossy().as_ref()],
    )
    .expect("db file path should update");

    let error = service
        .delete_database("remove_error", "owner", 4)
        .expect_err("non-NotFound remove error should fail");
    assert!(!error.is_empty());
    assert_eq!(database_index_row(&root, "remove_error").0, "hot");
}

#[test]
fn begin_database_archive_updates_updated_at_ms() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    assert_eq!(database_updated_at_ms(&root, "alpha"), 1);

    service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");

    assert_eq!(database_updated_at_ms(&root, "alpha"), 2);
}

#[test]
fn archives_and_restores_database_bytes() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute(
            "owner",
            sql_request("alpha", "CREATE TABLE archived_rows (body TEXT)"),
        )
        .expect("table create should succeed");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: "alpha".to_string(),
                sql: "INSERT INTO archived_rows (body) VALUES (?1)".to_string(),
                params: vec![SqlValue::Text("alpha body".to_string())],
                max_rows: None,
            },
        )
        .expect("insert should succeed");

    assert!(
        service
            .read_database_archive_chunk("alpha", "owner", 0, 17)
            .expect_err("hot DB should reject archive chunk reads")
            .contains("database")
    );
    let archive = service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    assert_eq!(database_updated_at_ms(&root, "alpha"), 2);
    assert!(archive.size_bytes > 0);
    let archiving = database_index_row(&root, "alpha");
    let archiving_mount_id = archiving.1;
    assert_eq!(
        archiving,
        (
            "archiving".to_string(),
            archiving_mount_id,
            archive.size_bytes,
            None
        )
    );
    assert!(
        service
            .sql_query(
                "owner",
                sql_request("alpha", "SELECT body FROM archived_rows")
            )
            .expect_err("archiving DB should reject reads")
            .contains("database is archiving")
    );
    assert!(
        service
            .sql_execute(
                "owner",
                sql_request(
                    "alpha",
                    "INSERT INTO archived_rows (body) VALUES ('blocked')"
                )
            )
            .expect_err("archiving DB should reject writes")
            .contains("database is archiving")
    );
    assert!(
        service
            .read_database_archive_chunk("alpha", "owner", 0, MAX_ARCHIVE_CHUNK_BYTES + 1)
            .expect_err("oversized archive chunk should fail")
            .contains("archive chunk size exceeds limit")
    );
    let bytes = read_archive_in_chunks(&service, "alpha", archive.size_bytes, 17);
    assert_eq!(bytes.len() as u64, archive.size_bytes);
    assert_eq!(
        archive_bytes_for_chunk_size(&service, "alpha", archive.size_bytes, 64 * 1024),
        bytes
    );
    assert!(
        service
            .read_database_archive_chunk("alpha", "owner", 0, 0)
            .expect("zero-byte archive chunk should read")
            .is_empty()
    );
    let snapshot_hash = sha256_bytes(&bytes);
    service
        .finalize_database_archive("alpha", "owner", snapshot_hash.clone(), 3)
        .expect("archive should finalize");
    assert_eq!(
        database_index_row(&root, "alpha"),
        ("archived".to_string(), None, archive.size_bytes, None)
    );
    assert!(
        service
            .sql_query(
                "owner",
                sql_request("alpha", "SELECT body FROM archived_rows")
            )
            .expect_err("archived DB should reject reads")
            .contains("database is archived")
    );

    service
        .begin_database_restore(
            "alpha",
            "owner",
            snapshot_hash.clone(),
            archive.size_bytes,
            4,
        )
        .expect("restore should begin");
    let restoring = database_index_row(&root, "alpha");
    assert_eq!(restoring.0, "restoring");
    assert!(restoring.1.is_some());
    assert_eq!(restoring.2, archive.size_bytes);
    assert_eq!(restoring.3, Some(archive.size_bytes));
    service
        .write_database_restore_chunk("alpha", "owner", 0, &bytes)
        .expect("restore chunk should write");
    service
        .finalize_database_restore("alpha", "owner", 5)
        .expect("restore should finalize");

    let rows = service
        .sql_query(
            "owner",
            sql_request("alpha", "SELECT body FROM archived_rows"),
        )
        .expect("restored query should succeed");
    assert_eq!(rows.rows[0][0], SqlValue::Text("alpha body".to_string()));
    let info = service
        .list_database_infos()
        .expect("infos should load")
        .into_iter()
        .find(|info| info.database_id == "alpha")
        .expect("alpha info should exist");
    assert_eq!(info.status, DatabaseStatus::Hot);
    assert_eq!(info.snapshot_hash, Some(snapshot_hash));
    assert_restore_size(&root, "alpha", None);
    assert_eq!(
        database_index_row(&root, "alpha").1,
        Some(restoring.1.unwrap())
    );
}

#[test]
fn restored_mount_id_is_not_reused_after_rearchive() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (id INTEGER)"))
        .expect("table create should succeed");

    let archive = service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    let bytes = archive_bytes_for_chunk_size(&service, "alpha", archive.size_bytes, 17);
    let snapshot_hash = sha256_bytes(&bytes);
    service
        .finalize_database_archive("alpha", "owner", snapshot_hash.clone(), 3)
        .expect("archive should finalize");
    let restored = service
        .begin_database_restore("alpha", "owner", snapshot_hash, archive.size_bytes, 4)
        .expect("restore should begin");
    service
        .write_database_restore_chunk("alpha", "owner", 0, &bytes)
        .expect("restore chunk should write");
    service
        .finalize_database_restore("alpha", "owner", 5)
        .expect("restore should finalize");

    let second_archive = service
        .begin_database_archive("alpha", "owner", 6)
        .expect("second archive should begin");
    let second_bytes =
        archive_bytes_for_chunk_size(&service, "alpha", second_archive.size_bytes, 17);
    service
        .finalize_database_archive("alpha", "owner", sha256_bytes(&second_bytes), 7)
        .expect("second archive should finalize");
    let beta = service
        .create_database("beta", "owner", 8)
        .expect("beta should create");

    assert_ne!(beta.mount_id, restored.mount_id);
    assert_eq!(
        mount_history_row(&root, restored.mount_id),
        ("alpha".to_string(), "restore".to_string())
    );
}

#[test]
fn cancel_database_archive_returns_archiving_database_to_hot() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (id INTEGER)"))
        .expect("table create should succeed");

    let before = database_index_row(&root, "alpha");
    service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    let archiving = database_index_row(&root, "alpha");
    assert_eq!(archiving.0, "archiving");
    assert_eq!(archiving.1, before.1);

    let canceled = service
        .cancel_database_archive("alpha", "owner", 3)
        .expect("archive cancel should succeed");
    assert_eq!(canceled.database_id, "alpha");
    let after = database_index_row(&root, "alpha");
    assert_eq!(after.0, "hot");
    assert_eq!(after.1, before.1);

    service
        .sql_execute(
            "owner",
            sql_request("alpha", "INSERT INTO t (id) VALUES (1)"),
        )
        .expect("write should succeed after cancel");
    let rows = service
        .sql_query("owner", sql_request("alpha", "SELECT id FROM t"))
        .expect("read should succeed after cancel");
    assert_eq!(rows.rows[0][0], SqlValue::Integer(1));
}

#[test]
fn cancel_database_archive_after_hash_mismatch_keeps_mount_id() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (id INTEGER)"))
        .expect("table create should succeed");
    let before = database_index_row(&root, "alpha");
    let archive = service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    let bytes = read_archive_in_chunks(&service, "alpha", archive.size_bytes, 17);
    let mut wrong_hash = sha256_bytes(&bytes);
    wrong_hash[0] ^= 0xff;
    service
        .finalize_database_archive("alpha", "owner", wrong_hash, 3)
        .expect_err("wrong hash should fail");

    service
        .cancel_database_archive("alpha", "owner", 4)
        .expect("archive cancel should succeed");
    let after = database_index_row(&root, "alpha");
    assert_eq!(after.0, "hot");
    assert_eq!(after.1, before.1);
}

#[test]
fn cancel_database_archive_rejects_invalid_statuses_and_non_owner() {
    let service = service();
    service
        .create_database("hot_db", "owner", 1)
        .expect("hot_db should create");
    assert!(
        service
            .cancel_database_archive("hot_db", "owner", 2)
            .expect_err("hot cancel should fail")
            .contains("database is hot")
    );

    service
        .create_database("archiving_db", "owner", 3)
        .expect("archiving_db should create");
    service
        .begin_database_archive("archiving_db", "owner", 4)
        .expect("archive should begin");
    assert!(
        service
            .cancel_database_archive("archiving_db", "writer", 5)
            .expect_err("non-owner cancel should fail")
            .contains("principal has no access")
    );
    service
        .cancel_database_archive("archiving_db", "owner", 6)
        .expect("archive cancel should succeed");

    service
        .create_database("deleted_db", "owner", 7)
        .expect("deleted_db should create");
    service
        .delete_database("deleted_db", "owner", 8)
        .expect("delete should succeed");
    assert!(
        service
            .cancel_database_archive("deleted_db", "owner", 9)
            .expect_err("deleted cancel should fail")
            .contains("database is deleted")
    );
}

#[test]
fn restore_finalize_rejects_size_mismatch_until_missing_bytes_arrive() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (body TEXT)"))
        .expect("table create should succeed");

    let archive = service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    let bytes = service
        .read_database_archive_chunk("alpha", "owner", 0, archive.size_bytes as u32)
        .expect("archive chunk should read");
    let snapshot_hash = sha256_bytes(&bytes);
    service
        .finalize_database_archive("alpha", "owner", snapshot_hash.clone(), 3)
        .expect("archive should finalize");
    assert_restore_size(&root, "alpha", None);

    service
        .begin_database_restore("alpha", "owner", snapshot_hash, archive.size_bytes, 4)
        .expect("restore should begin");
    assert_restore_size(&root, "alpha", Some(archive.size_bytes));
    let overflow_error = service
        .write_database_restore_chunk("alpha", "owner", archive.size_bytes, &[0])
        .expect_err("restore chunk past declared size should fail");
    assert!(overflow_error.contains("restore chunk exceeds expected size"));

    let split_at = bytes.len() / 2;
    service
        .write_database_restore_chunk("alpha", "owner", 0, &bytes[..split_at])
        .expect("first restore chunk should write");
    let error = service
        .finalize_database_restore("alpha", "owner", 5)
        .expect_err("short restore should fail");
    assert!(error.contains("restore chunks are incomplete"));

    service
        .write_database_restore_chunk("alpha", "owner", split_at as u64, &bytes[split_at..])
        .expect("second restore chunk should write");
    service
        .finalize_database_restore("alpha", "owner", 6)
        .expect("complete restore should finalize");
    assert_restore_size(&root, "alpha", None);
}

#[test]
fn archive_and_restore_reject_snapshot_hash_mismatch() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (id INTEGER)"))
        .expect("table create should succeed");

    let archive = service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    let bytes = service
        .read_database_archive_chunk("alpha", "owner", 0, archive.size_bytes as u32)
        .expect("archive chunk should read");
    let mut wrong_hash = sha256_bytes(&bytes);
    wrong_hash[0] ^= 0xff;
    let error = service
        .finalize_database_archive("alpha", "owner", wrong_hash, 3)
        .expect_err("wrong archive hash should fail");
    assert!(error.contains("snapshot_hash does not match archived"));
    assert_eq!(database_index_row(&root, "alpha").0, "archiving");

    let snapshot_hash = sha256_bytes(&bytes);
    service
        .finalize_database_archive("alpha", "owner", snapshot_hash.clone(), 4)
        .expect("archive should finalize");
    service
        .begin_database_restore("alpha", "owner", snapshot_hash, archive.size_bytes, 5)
        .expect("restore should begin");
    let mut changed = bytes;
    let last = changed.len() - 1;
    changed[last] ^= 0xff;
    service
        .write_database_restore_chunk("alpha", "owner", 0, &changed)
        .expect("restore chunk should write");
    let error = service
        .finalize_database_restore("alpha", "owner", 6)
        .expect_err("wrong restored bytes should fail");
    assert!(error.contains("snapshot_hash does not match restored"));
}

#[test]
fn archive_and_restore_enforce_size_limits_without_state_changes() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (id INTEGER)"))
        .expect("table create should succeed");

    let archive = service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    let bytes = service
        .read_database_archive_chunk("alpha", "owner", 0, archive.size_bytes as u32)
        .expect("archive chunk should read");
    let snapshot_hash = sha256_bytes(&bytes);
    service
        .finalize_database_archive("alpha", "owner", snapshot_hash.clone(), 3)
        .expect("archive should finalize");

    let state_before = database_index_row(&root, "alpha");
    let size_error = service
        .begin_database_restore(
            "alpha",
            "owner",
            snapshot_hash.clone(),
            MAX_DATABASE_SIZE_BYTES + 1,
            4,
        )
        .expect_err("oversized restore size should fail");
    assert!(size_error.contains("database size exceeds limit"));
    assert_eq!(database_index_row(&root, "alpha"), state_before);

    let oversized_restore_chunk = vec![0; MAX_RESTORE_CHUNK_BYTES + 1];
    service
        .begin_database_restore(
            "alpha",
            "owner",
            snapshot_hash.clone(),
            archive.size_bytes,
            4,
        )
        .expect("restore should begin");
    let chunk_error = service
        .write_database_restore_chunk("alpha", "owner", 0, &oversized_restore_chunk)
        .expect_err("oversized restore chunk should fail");
    assert!(chunk_error.contains("restore chunk size exceeds limit"));
}

#[test]
fn restore_accepts_in_range_chunks_written_out_of_order() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (body TEXT)"))
        .expect("table create should succeed");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: "alpha".to_string(),
                sql: "INSERT INTO t (body) VALUES (?1)".to_string(),
                params: vec![SqlValue::Text("alpha body".repeat(100))],
                max_rows: None,
            },
        )
        .expect("insert should succeed");

    let archive = service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    let bytes = service
        .read_database_archive_chunk("alpha", "owner", 0, archive.size_bytes as u32)
        .expect("archive chunk should read");
    let snapshot_hash = sha256_bytes(&bytes);
    service
        .finalize_database_archive("alpha", "owner", snapshot_hash.clone(), 3)
        .expect("archive should finalize");
    service
        .begin_database_restore(
            "alpha",
            "owner",
            snapshot_hash.clone(),
            archive.size_bytes,
            4,
        )
        .expect("restore should begin");

    let split_at = bytes.len() / 2;
    service
        .write_database_restore_chunk("alpha", "owner", split_at as u64, &bytes[split_at..])
        .expect("second half should write first");
    service
        .write_database_restore_chunk("alpha", "owner", 0, &bytes[..split_at])
        .expect("first half should write second");
    service
        .finalize_database_restore("alpha", "owner", 5)
        .expect("out-of-order restore should finalize");

    let rows = service
        .sql_query("owner", sql_request("alpha", "SELECT body FROM t"))
        .expect("restored query should succeed");
    assert_eq!(rows.rows[0][0], SqlValue::Text("alpha body".repeat(100)));
}

#[test]
fn rollback_database_restore_begin_restores_archived_state() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("database should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (id INTEGER)"))
        .expect("table create should succeed");
    let archive = service
        .begin_database_archive("alpha", "owner", 3)
        .expect("archive should begin");
    let bytes = service
        .read_database_archive_chunk("alpha", "owner", 0, archive.size_bytes as u32)
        .expect("archive chunk should read");
    let snapshot_hash = sha256_bytes(&bytes);
    service
        .finalize_database_archive("alpha", "owner", snapshot_hash.clone(), 4)
        .expect("archive should finalize");

    let restore = service
        .begin_database_restore_session(
            "alpha",
            "owner",
            snapshot_hash.clone(),
            archive.size_bytes,
            5,
        )
        .expect("restore should begin");
    let failed_mount_id = restore.meta.mount_id;
    service
        .write_database_restore_chunk("alpha", "owner", 0, &bytes)
        .expect("restore chunk should write");
    assert_eq!(database_restore_chunk_count(&root, "alpha"), 1);

    service
        .rollback_database_restore_begin(restore.rollback, 6)
        .expect("restore begin should rollback");
    assert_eq!(
        database_index_row(&root, "alpha"),
        ("archived".to_string(), None, archive.size_bytes, None)
    );
    assert_eq!(database_restore_chunk_count(&root, "alpha"), 0);
    assert_eq!(
        mount_history_row(&root, failed_mount_id),
        ("alpha".to_string(), "restore".to_string())
    );

    let retry = service
        .begin_database_restore_session("alpha", "owner", snapshot_hash, archive.size_bytes, 7)
        .expect("restore should retry");
    assert_ne!(retry.meta.mount_id, failed_mount_id);
}

#[test]
fn enforces_reader_writer_owner_roles() {
    let service = service();
    service
        .create_database("shared", "owner", 1)
        .expect("database should create");
    service
        .grant_database_access("shared", "owner", "reader", DatabaseRole::Reader, 2)
        .expect("reader grant should succeed");
    service
        .grant_database_access("shared", "owner", "writer", DatabaseRole::Writer, 3)
        .expect("writer grant should succeed");

    service
        .sql_query("reader", sql_request("shared", "SELECT 1"))
        .expect("reader query should be authorized");
    assert!(
        service
            .sql_execute(
                "reader",
                sql_request("shared", "CREATE TABLE nope (id INTEGER)")
            )
            .is_err()
    );
    service
        .sql_execute(
            "writer",
            sql_request("shared", "CREATE TABLE ok (id INTEGER)"),
        )
        .expect("writer write should succeed");
    assert!(
        service
            .grant_database_access("shared", "writer", "other", DatabaseRole::Reader, 12)
            .is_err()
    );
    assert!(
        service
            .grant_database_access("shared", "owner", "owner", DatabaseRole::Reader, 13)
            .expect_err("owner should not downgrade own access")
            .contains("downgrade own access")
    );
    service
        .grant_database_access("shared", "owner", "owner", DatabaseRole::Owner, 14)
        .expect("owner should be allowed to keep own owner access");
    assert!(
        service
            .list_database_members("shared", "writer")
            .expect_err("writer should not list members")
            .contains("lacks required database role")
    );

    let members = service
        .list_database_members("shared", "owner")
        .expect("owner should list members");
    assert_eq!(members.len(), 3);

    service
        .revoke_database_access("shared", "owner", "reader")
        .expect("owner should revoke reader");
    assert!(
        service
            .sql_query("reader", sql_request("shared", "SELECT 1"))
            .expect_err("revoked reader should lose access")
            .contains("no access")
    );
    assert!(
        service
            .revoke_database_access("shared", "owner", "owner")
            .expect_err("owner should not revoke own access")
            .contains("own access")
    );
}
