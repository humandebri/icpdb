// Where: crates/icpdb_runtime/tests/database_service.rs
// What: Multi-database service tests over local SQLite files.
// Why: The canister mount layer depends on runtime index and role semantics being deterministic.
use std::path::PathBuf;

use icpdb_runtime::{
    AuthenticatedDatabaseToken, ICP_TRANSFER_FEE_E8S_DEFAULT, ICPDB_UNITS_PER_ICP, IcpdbService,
    MAX_ARCHIVE_CHUNK_BYTES, MAX_DATABASE_SIZE_BYTES, MAX_RESTORE_CHUNK_BYTES, MIN_DEPOSIT_E8S,
    RequiredRole, RoutedWriteBegin, SQL_EXECUTE_BILLING_UNITS, USAGE_EVENTS_RETENTION_LIMIT,
    UsageEvent, hash_api_token,
};
use icpdb_types::{
    CreateDatabaseTokenRequest, CreateRemoteDatabaseRequest, DatabaseBalanceTopUpRequest,
    DatabaseBillingStatus, DatabaseObjectType, DatabaseRole, DatabaseStatus, DatabaseTokenScope,
    MigrateDatabaseToShardRequest, RegisterDatabaseShardRequest, RoutedOperationRequest,
    RoutedOperationStatus, SqlBatchRequest, SqlExecuteRequest, SqlStatement, SqlValue,
    TablePreviewRequest,
};
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn service() -> IcpdbService {
    service_with_root().0
}

fn service_with_root() -> (IcpdbService, PathBuf) {
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = IcpdbService::new(
        path_string(root.join("index.sqlite3")),
        path_string(root.join("databases")),
    );
    service
        .run_index_migrations()
        .expect("index migrations should run");
    (service, root)
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn index_service(root: &std::path::Path) -> IcpdbService {
    IcpdbService::new(
        path_string(root.join("index.sqlite3")),
        path_string(root.join("databases")),
    )
}

fn index_query(root: &std::path::Path, sql: &str, params: Vec<SqlValue>) -> Vec<Vec<SqlValue>> {
    index_service(root)
        .debug_index_query_sql(sql, params)
        .expect("index query should run")
}

fn index_execute(root: &std::path::Path, sql: &str, params: Vec<SqlValue>) {
    index_service(root)
        .debug_index_execute_sql(sql, params)
        .expect("index execute should run");
}

fn sql_text(value: &SqlValue) -> String {
    match value {
        SqlValue::Text(value) => value.clone(),
        value => panic!("expected text value, got {value:?}"),
    }
}

fn sql_i64(value: &SqlValue) -> i64 {
    match value {
        SqlValue::Integer(value) => *value,
        value => panic!("expected integer value, got {value:?}"),
    }
}

fn sql_opt_i64(value: &SqlValue) -> Option<i64> {
    match value {
        SqlValue::Null => None,
        SqlValue::Integer(value) => Some(*value),
        value => panic!("expected nullable integer value, got {value:?}"),
    }
}

fn assert_restore_size(root: &std::path::Path, database_id: &str, expected: Option<u64>) {
    let rows = index_query(
        root,
        "SELECT restore_size_bytes FROM databases WHERE database_id = ?1",
        vec![SqlValue::Text(database_id.to_string())],
    );
    let actual = sql_opt_i64(&rows[0][0]);
    assert_eq!(actual.map(|size| size as u64), expected);
}

fn sha256_bytes(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

fn database_index_row(
    root: &std::path::Path,
    database_id: &str,
) -> (String, Option<u16>, u64, Option<u64>) {
    let rows = index_query(
        root,
        "SELECT status, active_mount_id, logical_size_bytes, restore_size_bytes
         FROM databases WHERE database_id = ?1",
        vec![SqlValue::Text(database_id.to_string())],
    );
    let row = &rows[0];
    (
        sql_text(&row[0]),
        sql_opt_i64(&row[1]).map(|value| value as u16),
        sql_i64(&row[2]).max(0) as u64,
        sql_opt_i64(&row[3]).map(|value| value.max(0) as u64),
    )
}

fn database_updated_at_ms(root: &std::path::Path, database_id: &str) -> i64 {
    let rows = index_query(
        root,
        "SELECT updated_at_ms FROM databases WHERE database_id = ?1",
        vec![SqlValue::Text(database_id.to_string())],
    );
    sql_i64(&rows[0][0])
}

fn database_member_count(root: &std::path::Path, database_id: &str) -> i64 {
    let rows = index_query(
        root,
        "SELECT COUNT(*) FROM database_members WHERE database_id = ?1",
        vec![SqlValue::Text(database_id.to_string())],
    );
    sql_i64(&rows[0][0])
}

fn billing_balance_storage_type(root: &std::path::Path, database_id: &str) -> String {
    let rows = index_query(
        root,
        "SELECT typeof(billing_balance_units) FROM databases WHERE database_id = ?1",
        vec![SqlValue::Text(database_id.to_string())],
    );
    sql_text(&rows[0][0])
}

fn assert_generated_database_id(database_id: &str) {
    assert!(database_id.starts_with("db_"));
    assert_eq!(database_id.len(), 15);
    assert!(database_id.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_')
    }));
}

fn schema_migration_count(root: &std::path::Path, version: &str) -> i64 {
    let rows = index_query(
        root,
        "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
        vec![SqlValue::Text(version.to_string())],
    );
    sql_i64(&rows[0][0])
}

fn mount_history_row(root: &std::path::Path, mount_id: u16) -> (String, String) {
    let rows = index_query(
        root,
        "SELECT database_id, reason FROM database_mount_history WHERE mount_id = ?1",
        vec![SqlValue::Integer(i64::from(mount_id))],
    );
    (sql_text(&rows[0][0]), sql_text(&rows[0][1]))
}

fn shard_placement_row(
    root: &std::path::Path,
    database_id: &str,
) -> (String, Option<u16>, String, Option<String>, String) {
    let rows = index_query(
        root,
        "SELECT shard_id, mount_id, status, canister_id, schema_version
         FROM database_shard_placements
         WHERE database_id = ?1",
        vec![SqlValue::Text(database_id.to_string())],
    );
    (
        sql_text(&rows[0][0]),
        sql_opt_i64(&rows[0][1]).map(|value| value as u16),
        sql_text(&rows[0][2]),
        match &rows[0][3] {
            SqlValue::Null => None,
            value => Some(sql_text(value)),
        },
        sql_text(&rows[0][4]),
    )
}

fn database_restore_chunk_count(root: &std::path::Path, database_id: &str) -> i64 {
    let rows = index_query(
        root,
        "SELECT COUNT(*) FROM database_restore_chunks WHERE database_id = ?1",
        vec![SqlValue::Text(database_id.to_string())],
    );
    sql_i64(&rows[0][0])
}

type UsageEventTuple = (
    String,
    Option<String>,
    Option<String>,
    String,
    i64,
    i64,
    i64,
    i64,
    Option<String>,
    i64,
);

fn usage_event_rows(root: &std::path::Path) -> Vec<UsageEventTuple> {
    index_query(
        root,
        "SELECT method, operation, database_id, caller, success, cycles_delta, rows_returned, rows_affected, error, created_at_ms
         FROM usage_events
         ORDER BY event_id ASC",
        vec![],
    )
    .into_iter()
    .map(|row| {
        (
            sql_text(&row[0]),
            match &row[1] {
                SqlValue::Null => None,
                value => Some(sql_text(value)),
            },
            match &row[2] {
                SqlValue::Null => None,
                value => Some(sql_text(value)),
            },
            sql_text(&row[3]),
            sql_i64(&row[4]),
            sql_i64(&row[5]),
            sql_i64(&row[6]),
            sql_i64(&row[7]),
            match &row[8] {
                SqlValue::Null => None,
                value => Some(sql_text(value)),
            },
            sql_i64(&row[9]),
        )
    })
    .collect()
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

    for table_name in [
        "usage_events",
        "database_mount_history",
        "database_shard_placements",
        "routed_operations",
        "shard_operations",
    ] {
        let rows = index_query(
            &root,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            vec![SqlValue::Text(table_name.to_string())],
        );
        let table_exists = sql_i64(&rows[0][0]);
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
    assert_eq!(
        schema_migration_count(&root, "database_index:014_shard_placements"),
        1
    );
    assert_eq!(
        schema_migration_count(&root, "database_index:015_routed_operations"),
        1
    );
    assert_eq!(
        schema_migration_count(&root, "database_index:017_shard_operations"),
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
    assert_eq!(
        schema_migration_count(&root, "database_index:014_shard_placements"),
        1
    );
    assert_eq!(
        schema_migration_count(&root, "database_index:015_routed_operations"),
        1
    );
    assert_eq!(
        schema_migration_count(&root, "database_index:017_shard_operations"),
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
    assert_eq!(
        shard_placement_row(&root, &meta.database_id),
        (
            "local".to_string(),
            Some(11),
            "hot".to_string(),
            None,
            "sqlite:raw".to_string()
        )
    );
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
fn table_inspection_lists_describes_and_previews_rows() {
    let service = service();
    let meta = service
        .create_generated_database("owner", 1)
        .expect("database should create");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)"
                    .to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect("parent table should create");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "CREATE TABLE members (
                    id INTEGER PRIMARY KEY,
                    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                    name TEXT NOT NULL DEFAULT 'anon',
                    name_length INTEGER GENERATED ALWAYS AS (length(name)) STORED
                )"
                .to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect("child table should create");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "CREATE INDEX members_team_name_idx ON members (team_id, name)".to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect("index should create");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "CREATE TRIGGER members_name_guard
                    BEFORE INSERT ON members
                    WHEN NEW.name = ''
                    BEGIN
                        SELECT RAISE(ABORT, 'member name required');
                    END"
                .to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect("trigger should create");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "INSERT INTO teams (name) VALUES ('core')".to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect("team should insert");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: meta.database_id.clone(),
                sql: "INSERT INTO members (team_id, name) VALUES (1, 'alice'), (1, 'bob')"
                    .to_string(),
                params: vec![],
                max_rows: None,
            },
        )
        .expect("members should insert");

    let tables = service
        .list_tables(&meta.database_id, "owner")
        .expect("tables should list");
    assert_eq!(
        tables
            .iter()
            .map(|table| table.name.as_str())
            .collect::<Vec<_>>(),
        vec!["members", "teams"]
    );
    assert!(
        tables
            .iter()
            .all(|table| table.object_type == DatabaseObjectType::Table)
    );

    let description = service
        .describe_table(&meta.database_id, "members", "owner")
        .expect("table should describe");
    assert_eq!(description.database_id, meta.database_id);
    assert_eq!(description.table_name, "members");
    assert_eq!(
        description
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["id", "team_id", "name", "name_length"]
    );
    assert_eq!(
        description
            .columns
            .iter()
            .map(|column| column.hidden)
            .collect::<Vec<_>>(),
        vec![0, 0, 0, 3]
    );
    assert_eq!(description.foreign_keys.len(), 1);
    assert_eq!(description.foreign_keys[0].table_name, "teams");
    let user_index = description
        .indexes
        .iter()
        .find(|index| index.name == "members_team_name_idx")
        .expect("created index should describe");
    assert_eq!(
        user_index
            .columns
            .iter()
            .filter(|column| column.key)
            .map(|column| column.name.as_deref().unwrap_or_default())
            .collect::<Vec<_>>(),
        vec!["team_id", "name"]
    );
    assert_eq!(description.triggers.len(), 1);
    assert_eq!(description.triggers[0].name, "members_name_guard");
    assert_eq!(description.triggers[0].table_name, "members");
    assert!(
        description.triggers[0]
            .schema_sql
            .as_deref()
            .unwrap_or_default()
            .contains("CREATE TRIGGER members_name_guard")
    );

    let preview = service
        .preview_table(
            "owner",
            TablePreviewRequest {
                database_id: description.database_id,
                table_name: "members".to_string(),
                limit: Some(1),
                offset: Some(1),
            },
        )
        .expect("table preview should load");
    assert_eq!(
        preview.columns,
        vec!["id", "team_id", "name", "name_length"]
    );
    assert_eq!(
        preview.rows,
        vec![vec![
            SqlValue::Integer(2),
            SqlValue::Integer(1),
            SqlValue::Text("bob".to_string()),
            SqlValue::Integer(3)
        ]]
    );
    assert_eq!(preview.total_count, 2);
    assert!(!preview.truncated);
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

    index_execute(
        &root,
        "UPDATE databases SET billing_balance_units = 0 WHERE database_id = ?1",
        vec![SqlValue::Text(meta.database_id.clone())],
    );
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
            operation: Some("INSERT"),
            database_id: Some(&meta.database_id),
            caller: "owner",
            success: true,
            cycles_delta: 10,
            rows_returned: 3,
            rows_affected: 2,
            error: None,
            now: 2,
        })
        .expect("usage should record");
    service
        .record_usage_event(UsageEvent {
            method: "sql_execute",
            operation: Some("INSERT"),
            database_id: Some(&meta.database_id),
            caller: "owner",
            success: false,
            cycles_delta: 20,
            rows_returned: 0,
            rows_affected: 0,
            error: Some("rejected"),
            now: 4,
        })
        .expect("failed usage should record");
    service
        .record_usage_event(UsageEvent {
            method: "list_databases",
            operation: None,
            database_id: None,
            caller: "owner",
            success: true,
            cycles_delta: 1,
            rows_returned: 0,
            rows_affected: 0,
            error: None,
            now: 3,
        })
        .expect("global usage should record");

    let usage = service
        .database_usage(&meta.database_id, "owner")
        .expect("database usage should load");

    assert_eq!(usage.database_id, meta.database_id);
    assert_eq!(usage.status, DatabaseStatus::Hot);
    assert_eq!(usage.usage_event_count, 2);
    assert!(usage.max_logical_size_bytes >= usage.logical_size_bytes);

    let summaries = service
        .database_usage_event_summaries(&meta.database_id, "owner")
        .expect("usage event summaries should load");
    assert_eq!(summaries.len(), 2);
    assert_eq!(summaries[0].method, "sql_execute");
    assert_eq!(summaries[0].operation.as_deref(), Some("INSERT"));
    assert!(!summaries[0].success);
    assert_eq!(summaries[0].event_count, 1);
    assert_eq!(summaries[0].total_cycles_delta, 20);
    assert_eq!(summaries[0].last_created_at_ms, 4);
    assert_eq!(summaries[1].method, "sql_execute");
    assert_eq!(summaries[1].operation.as_deref(), Some("INSERT"));
    assert!(summaries[1].success);
    assert_eq!(summaries[1].event_count, 1);
    assert_eq!(summaries[1].total_cycles_delta, 10);
    assert_eq!(summaries[1].total_rows_returned, 3);
    assert_eq!(summaries[1].total_rows_affected, 2);
}

#[test]
fn data_plane_writes_refresh_size_without_charging_billing() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    let before = service
        .database_billing("alpha", "owner")
        .expect("billing should load");

    service
        .sql_execute_data_plane(
            "owner",
            sql_request(
                "alpha",
                "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
            ),
        )
        .expect("data-plane table create should succeed");
    service
        .sql_execute_data_plane(
            "owner",
            SqlExecuteRequest {
                database_id: "alpha".to_string(),
                sql: "INSERT INTO notes (body) VALUES (?1)".to_string(),
                params: vec![SqlValue::Text("from data plane".to_string())],
                max_rows: None,
            },
        )
        .expect("data-plane insert should succeed");

    let after = service
        .database_billing("alpha", "owner")
        .expect("billing should reload");
    let usage = service
        .database_usage("alpha", "owner")
        .expect("usage should load");
    assert_eq!(after.balance_units, before.balance_units);
    assert_eq!(after.spent_units, before.spent_units);
    assert!(usage.logical_size_bytes > 0);
}

#[test]
fn routed_write_completion_charges_and_syncs_logical_size() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    let auth = AuthenticatedDatabaseToken {
        token_id: "tok_alpha_write".to_string(),
        database_id: "alpha".to_string(),
        scope: DatabaseTokenScope::Write,
    };
    let hash = sha256_bytes(b"remote write request");

    let pending = service
        .begin_routed_write_with_token(
            &auth,
            RoutedWriteBegin {
                operation_id: "op_remote_insert",
                database_canister_id: "aaaaa-aa",
                method: "sql_execute_internal",
                request_hash: hash.clone(),
                billing_units: SQL_EXECUTE_BILLING_UNITS,
                now: 2,
            },
        )
        .expect("routed write should begin");
    assert_eq!(pending.status, RoutedOperationStatus::Pending);

    let completed = service
        .complete_routed_write_with_token(
            &auth,
            "op_remote_insert",
            SQL_EXECUTE_BILLING_UNITS,
            12_345,
            3,
        )
        .expect("routed write should complete");
    assert_eq!(completed.status, RoutedOperationStatus::Applied);
    let billing = service
        .database_billing("alpha", "owner")
        .expect("billing should load");
    let usage = service
        .database_usage("alpha", "owner")
        .expect("usage should load");
    assert_eq!(
        billing.balance_units,
        icpdb_runtime::DEFAULT_DATABASE_BALANCE_UNITS - SQL_EXECUTE_BILLING_UNITS
    );
    assert_eq!(billing.spent_units, SQL_EXECUTE_BILLING_UNITS);
    assert_eq!(usage.logical_size_bytes, 12_345);

    let replay = service
        .begin_routed_write_with_token(
            &auth,
            RoutedWriteBegin {
                operation_id: "op_remote_insert",
                database_canister_id: "aaaaa-aa",
                method: "sql_execute_internal",
                request_hash: hash,
                billing_units: SQL_EXECUTE_BILLING_UNITS,
                now: 4,
            },
        )
        .expect("routed write replay should load existing operation");
    assert_eq!(replay.status, RoutedOperationStatus::Applied);
}

#[test]
fn routed_write_reconcile_charges_unknown_data_plane_write() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    let auth = AuthenticatedDatabaseToken {
        token_id: "tok_alpha_write".to_string(),
        database_id: "alpha".to_string(),
        scope: DatabaseTokenScope::Write,
    };
    let before = service
        .database_billing("alpha", "owner")
        .expect("billing should load");

    service
        .begin_routed_write_with_token(
            &auth,
            RoutedWriteBegin {
                operation_id: "op_unknown_insert",
                database_canister_id: "aaaaa-aa",
                method: "sql_execute_internal",
                request_hash: sha256_bytes(b"remote write request"),
                billing_units: SQL_EXECUTE_BILLING_UNITS,
                now: 2,
            },
        )
        .expect("routed write should begin");
    service
        .update_routed_operation_status(
            "op_unknown_insert",
            RoutedOperationStatus::Unknown,
            Some("post-write usage unavailable"),
            3,
        )
        .expect("operation should become unknown");

    let reconciled = service
        .reconcile_routed_write_from_data_plane("op_unknown_insert", 44_444, 4)
        .expect("unknown routed write should reconcile");
    assert_eq!(reconciled.status, RoutedOperationStatus::Applied);
    assert_eq!(reconciled.error, None);
    let after = service
        .database_billing("alpha", "owner")
        .expect("billing should reload");
    let usage = service
        .database_usage("alpha", "owner")
        .expect("usage should load");
    assert_eq!(
        after.balance_units,
        before.balance_units - SQL_EXECUTE_BILLING_UNITS
    );
    assert_eq!(
        after.spent_units,
        before.spent_units + SQL_EXECUTE_BILLING_UNITS
    );
    assert_eq!(usage.logical_size_bytes, 44_444);

    let rejected = service
        .reconcile_routed_write_from_data_plane("op_unknown_insert", 44_444, 5)
        .expect_err("applied operation should not reconcile twice");
    assert!(rejected.contains("routed operation is not unknown"));
}

#[test]
fn data_plane_operation_log_is_idempotent() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    let request_hash = sha256_bytes(b"data plane write");

    let recorded = service
        .record_data_plane_operation(
            "op_data_plane_insert",
            "alpha",
            "sql_execute_internal",
            request_hash.clone(),
            2,
        )
        .expect("data-plane operation should record");
    assert_eq!(recorded.operation_id, "op_data_plane_insert");
    assert_eq!(recorded.database_id, "alpha");
    assert_eq!(recorded.method, "sql_execute_internal");

    let replay = service
        .record_data_plane_operation(
            "op_data_plane_insert",
            "alpha",
            "sql_execute_internal",
            request_hash,
            3,
        )
        .expect("same data-plane operation should replay");
    assert_eq!(replay.created_at_ms, 2);

    let mismatch = service
        .record_data_plane_operation(
            "op_data_plane_insert",
            "alpha",
            "sql_batch_internal",
            sha256_bytes(b"other write"),
            4,
        )
        .expect_err("mismatched data-plane replay should reject");
    assert!(mismatch.contains("data-plane operation request mismatch"));
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

    service
        .create_database_token(
            "owner",
            CreateDatabaseTokenRequest {
                database_id: "alpha".to_string(),
                name: "web-owner".to_string(),
                scope: DatabaseTokenScope::Owner,
            },
            hash_api_token("secret-owner"),
            13,
        )
        .expect("owner token should create");
    let owner_auth = service
        .authenticate_database_token("secret-owner", icpdb_runtime::RequiredRole::Owner, 14)
        .expect("owner token should authenticate");
    let quota = service
        .set_database_quota_with_token(
            &owner_auth,
            icpdb_types::DatabaseQuotaRequest {
                database_id: "alpha".to_string(),
                max_logical_size_bytes: 128 * 1024 * 1024,
            },
        )
        .expect("owner token should set quota");
    assert_eq!(quota.max_logical_size_bytes, 128 * 1024 * 1024);

    let tokens = service
        .list_database_tokens_with_token(&owner_auth, "alpha")
        .expect("owner token should list tokens");
    assert_eq!(tokens.len(), 2);
    let read_token = tokens
        .iter()
        .find(|token| token.name == "web-read")
        .expect("read token should list");
    assert_eq!(read_token.last_used_at_ms, Some(11));
    let read_token_id = read_token.token_id.clone();

    let revoked = service
        .revoke_database_token_with_token(&owner_auth, "alpha", &read_token_id, 15)
        .expect("owner token should revoke token");
    assert_eq!(revoked.token_id, read_token_id);
    assert_eq!(revoked.revoked_at_ms, Some(15));
    let error = service
        .authenticate_database_token("secret-read", icpdb_runtime::RequiredRole::Reader, 16)
        .expect_err("revoked token should not authenticate");
    assert_eq!(error, "api token revoked");
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

    index_execute(
        &root,
        "UPDATE databases SET billing_balance_units = 0 WHERE database_id = 'alpha'",
        vec![],
    );
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
fn manual_top_up_rejects_values_outside_sqlite_integer_range() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("database should create");

    let error = service
        .top_up_database_balance(DatabaseBalanceTopUpRequest {
            database_id: "alpha".to_string(),
            units: u64::MAX,
        })
        .expect_err("oversized top-up should fail");

    assert_eq!(error, "units exceeds SQLite integer range");
    assert_eq!(billing_balance_storage_type(&root, "alpha"), "integer");
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
    index_execute(
        &root,
        "UPDATE databases SET billing_status = 'suspended' WHERE database_id = 'alpha'",
        vec![],
    );

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
            operation: Some("INSERT"),
            database_id: Some("alpha"),
            caller: "owner",
            success: true,
            cycles_delta: 12,
            rows_returned: 4,
            rows_affected: 5,
            error: None,
            now: 10,
        })
        .expect("success event should record");
    service
        .record_usage_event(UsageEvent {
            method: "create_database",
            operation: None,
            database_id: None,
            caller: "owner",
            success: false,
            cycles_delta: 34,
            rows_returned: 0,
            rows_affected: 0,
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
            Some("INSERT".to_string()),
            Some("alpha".to_string()),
            "owner".to_string(),
            1,
            12,
            4,
            5,
            None,
            10
        )
    );
    assert_eq!(
        rows[1],
        (
            "create_database".to_string(),
            None,
            None,
            "owner".to_string(),
            0,
            34,
            0,
            0,
            Some("database already exists".to_string()),
            11
        )
    );
}

#[test]
fn usage_events_keep_recent_retention_window() {
    let (service, root) = service_with_root();
    index_execute(
        &root,
        "WITH RECURSIVE usage_seed(created_at_ms) AS (
           SELECT 0
           UNION ALL
           SELECT created_at_ms + 1 FROM usage_seed WHERE created_at_ms < ?1
         )
         INSERT INTO usage_events
           (method, database_id, caller, success, cycles_delta, rows_returned, rows_affected, error, created_at_ms)
         SELECT 'sql_execute', 'alpha', 'owner', 1, 1, 0, 0, NULL, created_at_ms
         FROM usage_seed",
        vec![SqlValue::Integer(
            i64::try_from(USAGE_EVENTS_RETENTION_LIMIT + 97).expect("index should fit"),
        )],
    );

    service
        .record_usage_event(UsageEvent {
            method: "sql_execute",
            operation: Some("INSERT"),
            database_id: Some("alpha"),
            caller: "owner",
            success: true,
            cycles_delta: 1,
            rows_returned: 0,
            rows_affected: 0,
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
            operation: Some("INSERT"),
            database_id: Some("alpha"),
            caller: "owner",
            success: true,
            cycles_delta: 1,
            rows_returned: 0,
            rows_affected: 0,
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
    for mount_id in 11..254 {
        index_execute(
            &root,
            "INSERT INTO databases
             (database_id, db_file_name, mount_id, active_mount_id, status, schema_version,
              logical_size_bytes, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?3, 'hot', 'sqlite:raw', 0, 1, 1)",
            vec![
                SqlValue::Text(format!("reserved_{mount_id}")),
                SqlValue::Text(format!("reserved_{mount_id}.sqlite3")),
                SqlValue::Integer(i64::from(mount_id)),
            ],
        );
        index_execute(
            &root,
            "INSERT INTO database_mount_history
             (database_id, mount_id, reason, created_at_ms)
             VALUES (?1, ?2, 'create', 1)",
            vec![
                SqlValue::Text(format!("reserved_{mount_id}")),
                SqlValue::Integer(i64::from(mount_id)),
            ],
        );
    }

    let meta = service
        .create_database("db_254", "owner", 254)
        .expect("last mount_id should create");
    assert_eq!(meta.mount_id, 254);

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
fn reopens_database_content_from_same_mount_id_after_service_recreation() {
    let (service, root) = service_with_root();
    let meta = service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute(
            "owner",
            sql_request(
                "alpha",
                "CREATE TABLE persisted_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
            ),
        )
        .expect("table create should succeed");
    service
        .sql_execute(
            "owner",
            SqlExecuteRequest {
                database_id: "alpha".to_string(),
                sql: "INSERT INTO persisted_notes (body) VALUES (?1)".to_string(),
                params: vec![SqlValue::Text("survives reopen".to_string())],
                max_rows: None,
            },
        )
        .expect("insert should succeed");
    drop(service);

    let reopened = index_service(&root);
    reopened
        .run_index_migrations()
        .expect("index migrations should rerun");
    reopened
        .run_database_migrations("alpha")
        .expect("database image should remount by mount_id");
    let reopened_meta = reopened
        .list_databases()
        .expect("databases should list")
        .into_iter()
        .find(|candidate| candidate.database_id == "alpha")
        .expect("alpha should remain indexed");
    assert_eq!(reopened_meta.mount_id, meta.mount_id);
    assert_eq!(reopened_meta.db_file_name, meta.db_file_name);

    let response = reopened
        .sql_query(
            "owner",
            sql_request("alpha", "SELECT body FROM persisted_notes ORDER BY id"),
        )
        .expect("persisted row should read after reopen");
    assert_eq!(
        response.rows,
        vec![vec![SqlValue::Text("survives reopen".to_string())]]
    );
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
fn delete_database_marks_hot_database_deleted() {
    let (service, root) = service_with_root();
    service
        .create_database("deleted_file", "owner", 1)
        .expect("database should create");
    service
        .delete_database("deleted_file", "owner", 2)
        .expect("delete should succeed");
    assert_eq!(database_index_row(&root, "deleted_file").0, "deleted");
}

#[test]
fn delete_database_accepts_archived_database() {
    let (service, root) = service_with_root();
    service
        .create_database("archived", "owner", 1)
        .expect("database should create");
    service
        .sql_execute(
            "owner",
            sql_request("archived", "CREATE TABLE t (id INTEGER)"),
        )
        .expect("table create should succeed");
    let archive = service
        .begin_database_archive("archived", "owner", 2)
        .expect("archive should begin");
    let bytes = read_archive_in_chunks(&service, "archived", archive.size_bytes, 64);
    service
        .finalize_database_archive("archived", "owner", sha256_bytes(&bytes), 3)
        .expect("archive should finalize");

    service
        .delete_database("archived", "owner", 4)
        .expect("archived database should delete");

    assert_eq!(database_index_row(&root, "archived").0, "deleted");
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
fn shard_placement_tracks_archive_restore_and_delete() {
    let (service, root) = service_with_root();
    let meta = service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .sql_execute("owner", sql_request("alpha", "CREATE TABLE t (id INTEGER)"))
        .expect("table create should succeed");
    assert_eq!(
        shard_placement_row(&root, "alpha"),
        (
            "local".to_string(),
            Some(meta.mount_id),
            "hot".to_string(),
            None,
            "sqlite:raw".to_string()
        )
    );

    let archive = service
        .begin_database_archive("alpha", "owner", 2)
        .expect("archive should begin");
    assert_eq!(
        shard_placement_row(&root, "alpha"),
        (
            "local".to_string(),
            Some(meta.mount_id),
            "archiving".to_string(),
            None,
            "sqlite:raw".to_string()
        )
    );
    let bytes = archive_bytes_for_chunk_size(&service, "alpha", archive.size_bytes, 17);
    let snapshot_hash = sha256_bytes(&bytes);
    service
        .finalize_database_archive("alpha", "owner", snapshot_hash.clone(), 3)
        .expect("archive should finalize");
    assert_eq!(
        shard_placement_row(&root, "alpha"),
        (
            "local".to_string(),
            None,
            "archived".to_string(),
            None,
            "sqlite:raw".to_string()
        )
    );

    let restored = service
        .begin_database_restore("alpha", "owner", snapshot_hash, archive.size_bytes, 4)
        .expect("restore should begin");
    assert_eq!(
        shard_placement_row(&root, "alpha"),
        (
            "local".to_string(),
            Some(restored.mount_id),
            "restoring".to_string(),
            None,
            "sqlite:raw".to_string()
        )
    );
    service
        .write_database_restore_chunk("alpha", "owner", 0, &bytes)
        .expect("restore chunk should write");
    service
        .finalize_database_restore("alpha", "owner", 5)
        .expect("restore should finalize");
    assert_eq!(
        shard_placement_row(&root, "alpha"),
        (
            "local".to_string(),
            Some(restored.mount_id),
            "hot".to_string(),
            None,
            "sqlite:raw".to_string()
        )
    );

    service
        .delete_database("alpha", "owner", 6)
        .expect("delete should succeed");
    assert_eq!(
        shard_placement_row(&root, "alpha"),
        (
            "local".to_string(),
            None,
            "deleted".to_string(),
            None,
            "sqlite:raw".to_string()
        )
    );
}

#[test]
fn shard_placements_are_visible_to_database_members() {
    let (service, _root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .create_database("beta", "other", 2)
        .expect("beta should create");
    service
        .grant_database_access("alpha", "owner", "writer", DatabaseRole::Writer, 3)
        .expect("writer grant should succeed");

    let owner_placements = service
        .list_database_shard_placements_for_caller("owner")
        .expect("owner placements should load");
    let writer_placements = service
        .list_database_shard_placements_for_caller("writer")
        .expect("writer placements should load");
    let all_placements = service
        .list_all_database_shard_placements()
        .expect("all placements should load");

    assert_eq!(owner_placements.len(), 1);
    assert_eq!(owner_placements[0].database_id, "alpha");
    assert_eq!(owner_placements[0].shard_id, "local");
    assert_eq!(owner_placements[0].mount_id, Some(11));
    assert_eq!(owner_placements[0].canister_id, None);
    assert_eq!(writer_placements.len(), 1);
    assert_eq!(writer_placements[0].database_id, "alpha");
    assert_eq!(all_placements.len(), 2);
    assert_eq!(all_placements[0].database_id, "alpha");
    assert_eq!(all_placements[1].database_id, "beta");
}

#[test]
fn hot_database_route_resolves_local_remote_and_enforces_access() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .grant_database_access("alpha", "owner", "reader", DatabaseRole::Reader, 2)
        .expect("reader grant should succeed");

    let local = service
        .hot_database_route("alpha", "reader", RequiredRole::Reader)
        .expect("reader should resolve local route");
    assert_eq!(local.database_id, "alpha");
    assert_eq!(local.shard_id, "local");
    assert_eq!(local.canister_id, None);
    assert_eq!(local.mount_id, Some(11));

    let denied = service
        .hot_database_route("alpha", "stranger", RequiredRole::Reader)
        .expect_err("non-member should not resolve route");
    assert_eq!(denied, "principal has no access to database: alpha");

    index_execute(
        &root,
        "UPDATE database_shard_placements
         SET shard_id = 'database-0',
             canister_id = 'aaaaa-aa',
             mount_id = NULL,
             updated_at_ms = 3
         WHERE database_id = ?1",
        vec![SqlValue::Text("alpha".to_string())],
    );

    let remote = service
        .hot_database_route("alpha", "owner", RequiredRole::Owner)
        .expect("owner should resolve remote route");
    assert_eq!(remote.shard_id, "database-0");
    assert_eq!(remote.canister_id, Some("aaaaa-aa".to_string()));
    assert_eq!(remote.mount_id, None);

    let auth = AuthenticatedDatabaseToken {
        token_id: "tok_alpha_read".to_string(),
        database_id: "alpha".to_string(),
        scope: DatabaseTokenScope::Read,
    };
    let token_route = service
        .hot_database_route_with_token(&auth, "alpha", RequiredRole::Reader)
        .expect("read token should resolve read route");
    assert_eq!(token_route.canister_id, Some("aaaaa-aa".to_string()));

    let write_error = service
        .hot_database_route_with_token(&auth, "alpha", RequiredRole::Writer)
        .expect_err("read token should not resolve write route");
    assert_eq!(write_error, "api token scope does not allow this operation");

    index_execute(
        &root,
        "UPDATE databases SET status = 'archived' WHERE database_id = ?1",
        vec![SqlValue::Text("alpha".to_string())],
    );
    index_execute(
        &root,
        "UPDATE database_shard_placements SET status = 'archived' WHERE database_id = ?1",
        vec![SqlValue::Text("alpha".to_string())],
    );

    let archived = service
        .hot_database_route("alpha", "owner", RequiredRole::Reader)
        .expect_err("archived database should not resolve hot route");
    assert_eq!(archived, "database is archived: alpha");
}

#[test]
fn register_remote_database_records_owner_and_remote_placement() {
    let service = service();
    let info = service
        .register_remote_database(
            CreateRemoteDatabaseRequest {
                database_id: "remote_alpha".to_string(),
                database_canister_id: "aaaaa-aa".to_string(),
            },
            "owner",
            1,
        )
        .expect("remote database should register");

    assert_eq!(info.database_id, "remote_alpha");
    assert_eq!(info.mount_id, None);
    let route = service
        .hot_database_route("remote_alpha", "owner", RequiredRole::Owner)
        .expect("remote route should resolve");
    assert_eq!(route.canister_id, Some("aaaaa-aa".to_string()));
    assert_eq!(route.mount_id, None);
    assert_eq!(route.shard_id, "database:aaaaa-aa");
}

#[test]
fn registered_database_shards_drive_remote_create_plan_capacity() {
    let service = service();
    let shard = service
        .register_database_shard(
            RegisterDatabaseShardRequest {
                database_canister_id: "aaaaa-aa".to_string(),
                max_databases: 1,
            },
            1,
        )
        .expect("database shard should register");
    assert_eq!(shard.shard_id, "database:aaaaa-aa");
    assert_eq!(shard.assigned_databases, 0);

    let plan = service
        .remote_database_create_plan("owner", 2)
        .expect("remote plan should load")
        .expect("registered shard should be selected");
    assert_eq!(plan.database_canister_id, "aaaaa-aa");

    service
        .register_remote_database(
            CreateRemoteDatabaseRequest {
                database_id: plan.database_id,
                database_canister_id: plan.database_canister_id,
            },
            "owner",
            3,
        )
        .expect("planned remote database should register");
    let shards = service
        .list_database_shards()
        .expect("database shards should load");
    assert_eq!(shards.len(), 1);
    assert_eq!(shards[0].assigned_databases, 1);
    assert!(
        service
            .remote_database_create_plan("owner", 4)
            .expect("remote plan should load")
            .is_none(),
        "full shard should not be selected"
    );
}

#[test]
fn local_database_migration_switches_catalog_to_remote_shard() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("local database should create");
    service
        .sql_execute(
            "owner",
            sql_request("alpha", "CREATE TABLE notes (body TEXT)"),
        )
        .expect("local schema should write");
    service
        .register_database_shard(
            RegisterDatabaseShardRequest {
                database_canister_id: "aaaaa-aa".to_string(),
                max_databases: 2,
            },
            2,
        )
        .expect("target shard should register");

    let request = MigrateDatabaseToShardRequest {
        database_id: "alpha".to_string(),
        database_canister_id: "aaaaa-aa".to_string(),
    };
    let archive = service
        .begin_local_database_migration(&request, 3)
        .expect("local migration should begin");
    assert!(archive.size_bytes > 0);
    assert_eq!(database_index_row(&root, "alpha").0, "archiving");

    let (placement, old_meta) = service
        .complete_local_database_migration(&request, archive.size_bytes, 4)
        .expect("local migration should complete");

    assert_eq!(old_meta.database_id, "alpha");
    assert_eq!(placement.database_id, "alpha");
    assert_eq!(placement.shard_id, "database:aaaaa-aa");
    assert_eq!(placement.canister_id, Some("aaaaa-aa".to_string()));
    assert_eq!(placement.mount_id, None);
    assert_eq!(placement.status, DatabaseStatus::Hot);
    let route = service
        .hot_database_route("alpha", "owner", RequiredRole::Owner)
        .expect("owner route should remain available");
    assert_eq!(route.canister_id, Some("aaaaa-aa".to_string()));
    assert_eq!(database_index_row(&root, "alpha").0, "hot");
}

#[test]
fn remote_archive_restore_status_markers_preserve_remote_placement() {
    let service = service();
    service
        .register_remote_database(
            CreateRemoteDatabaseRequest {
                database_id: "remote_alpha".to_string(),
                database_canister_id: "aaaaa-aa".to_string(),
            },
            "owner",
            1,
        )
        .expect("remote database should register");
    let auth = AuthenticatedDatabaseToken {
        token_id: "tok_remote_owner".to_string(),
        database_id: "remote_alpha".to_string(),
        scope: DatabaseTokenScope::Owner,
    };
    let snapshot_hash = vec![7_u8; 32];

    service
        .mark_remote_database_archiving_with_token(&auth, "remote_alpha", 2)
        .expect("remote database should mark archiving");
    let archiving = service
        .database_route_with_token(
            &auth,
            "remote_alpha",
            RequiredRole::Owner,
            &[DatabaseStatus::Archiving],
        )
        .expect("archiving remote route should resolve");
    assert_eq!(archiving.canister_id, Some("aaaaa-aa".to_string()));
    assert_eq!(archiving.mount_id, None);

    service
        .mark_remote_database_hot_with_token(&auth, "remote_alpha", 99, 3)
        .expect("remote cancel should return database to hot");
    let hot_usage = service
        .database_usage_with_token(&auth, "remote_alpha")
        .expect("hot usage should load");
    assert_eq!(hot_usage.status, DatabaseStatus::Hot);
    assert_eq!(hot_usage.logical_size_bytes, 99);

    service
        .mark_remote_database_archiving_with_token(&auth, "remote_alpha", 4)
        .expect("remote database should mark archiving again");
    service
        .mark_remote_database_archived_with_token(&auth, "remote_alpha", snapshot_hash.clone(), 5)
        .expect("remote database should mark archived");
    let archived = service
        .database_route_with_token(
            &auth,
            "remote_alpha",
            RequiredRole::Owner,
            &[DatabaseStatus::Archived],
        )
        .expect("archived remote route should resolve");
    assert_eq!(archived.canister_id, Some("aaaaa-aa".to_string()));

    service
        .mark_remote_database_restoring_with_token(&auth, "remote_alpha", snapshot_hash, 4096, 6)
        .expect("remote database should mark restoring");
    service
        .mark_remote_database_hot_with_token(&auth, "remote_alpha", 2048, 7)
        .expect("remote restore should return database to hot");
    let hot = service
        .hot_database_route_with_token(&auth, "remote_alpha", RequiredRole::Owner)
        .expect("hot remote route should resolve after restore");
    assert_eq!(hot.canister_id, Some("aaaaa-aa".to_string()));
    let usage = service
        .database_usage_with_token(&auth, "remote_alpha")
        .expect("usage should load");
    assert_eq!(usage.status, DatabaseStatus::Hot);
    assert_eq!(usage.logical_size_bytes, 2048);
}

#[test]
fn remote_delete_marker_preserves_remote_placement_and_frees_capacity() {
    let service = service();
    service
        .register_database_shard(
            RegisterDatabaseShardRequest {
                database_canister_id: "aaaaa-aa".to_string(),
                max_databases: 1,
            },
            1,
        )
        .expect("database shard should register");
    service
        .register_remote_database(
            CreateRemoteDatabaseRequest {
                database_id: "remote_delete".to_string(),
                database_canister_id: "aaaaa-aa".to_string(),
            },
            "owner",
            2,
        )
        .expect("remote database should register");
    let auth = AuthenticatedDatabaseToken {
        token_id: "tok_remote_owner".to_string(),
        database_id: "remote_delete".to_string(),
        scope: DatabaseTokenScope::Owner,
    };

    service
        .mark_remote_database_deleted_with_token(&auth, "remote_delete", 3)
        .expect("remote database should mark deleted");

    let usage = service
        .database_usage_with_token(&auth, "remote_delete")
        .expect("deleted usage should load");
    assert_eq!(usage.status, DatabaseStatus::Deleted);
    assert_eq!(usage.logical_size_bytes, 0);
    let placement = service
        .database_shard_placement_with_token(&auth, "remote_delete")
        .expect("deleted placement should load");
    assert_eq!(placement.status, DatabaseStatus::Deleted);
    assert_eq!(placement.canister_id, Some("aaaaa-aa".to_string()));
    let shards = service
        .list_database_shards()
        .expect("database shards should load");
    assert_eq!(shards[0].assigned_databases, 0);
}

#[test]
fn database_billing_with_token_requires_owner_scope() {
    let service = service();
    service
        .create_database("billing_scope", "owner", 1)
        .expect("database should create");
    let read_auth = AuthenticatedDatabaseToken {
        token_id: "tok_read".to_string(),
        database_id: "billing_scope".to_string(),
        scope: DatabaseTokenScope::Read,
    };
    let write_auth = AuthenticatedDatabaseToken {
        token_id: "tok_write".to_string(),
        database_id: "billing_scope".to_string(),
        scope: DatabaseTokenScope::Write,
    };
    let owner_auth = AuthenticatedDatabaseToken {
        token_id: "tok_owner".to_string(),
        database_id: "billing_scope".to_string(),
        scope: DatabaseTokenScope::Owner,
    };

    assert!(
        service
            .database_billing_with_token(&read_auth, "billing_scope")
            .expect_err("read token should reject billing")
            .contains("api token scope does not allow this operation")
    );
    assert!(
        service
            .database_billing_with_token(&write_auth, "billing_scope")
            .expect_err("write token should reject billing")
            .contains("api token scope does not allow this operation")
    );
    let billing = service
        .database_billing_with_token(&owner_auth, "billing_scope")
        .expect("owner token should read billing");
    assert_eq!(billing.database_id, "billing_scope");
}

#[test]
fn remote_database_membership_mutation_uses_controller_metadata() {
    let service = service();
    service
        .register_remote_database(
            CreateRemoteDatabaseRequest {
                database_id: "remote_members".to_string(),
                database_canister_id: "aaaaa-aa".to_string(),
            },
            "owner",
            1,
        )
        .expect("remote database should register");

    service
        .grant_database_access("remote_members", "owner", "reader", DatabaseRole::Reader, 2)
        .expect("owner should grant remote database access");
    let members = service
        .list_database_members("remote_members", "owner")
        .expect("owner should list remote database members");
    assert!(
        members
            .iter()
            .any(|member| member.principal == "reader" && member.role == DatabaseRole::Reader)
    );

    service
        .revoke_database_access("remote_members", "owner", "reader")
        .expect("owner should revoke remote database access");
    let members = service
        .list_database_members("remote_members", "owner")
        .expect("owner should list remote database members after revoke");
    assert!(!members.iter().any(|member| member.principal == "reader"));
}

#[test]
fn routed_operation_log_is_idempotent_and_tracks_status() {
    let service = service();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    let request_hash = sha256_bytes(b"sql_execute_internal alpha create table");

    let pending = service
        .begin_routed_operation(
            "op_alpha_create",
            "alpha",
            "aaaaa-aa",
            "sql_execute_internal",
            request_hash.clone(),
            2,
        )
        .expect("routed operation should begin");
    assert_eq!(pending.status, RoutedOperationStatus::Pending);
    assert_eq!(pending.database_id, "alpha");
    assert_eq!(pending.database_canister_id, "aaaaa-aa");
    assert_eq!(pending.request_hash, request_hash);

    let replay = service
        .begin_routed_operation(
            "op_alpha_create",
            "alpha",
            "aaaaa-aa",
            "sql_execute_internal",
            pending.request_hash.clone(),
            3,
        )
        .expect("same routed operation should replay");
    assert_eq!(replay.created_at_ms, 2);
    assert_eq!(replay.updated_at_ms, 2);

    let mismatch = service
        .begin_routed_operation(
            "op_alpha_create",
            "alpha",
            "aaaaa-aa",
            "sql_execute_internal",
            sha256_bytes(b"different request"),
            4,
        )
        .expect_err("different request should be rejected");
    assert!(mismatch.contains("routed operation request mismatch"));

    let applied = service
        .update_routed_operation_status("op_alpha_create", RoutedOperationStatus::Applied, None, 5)
        .expect("routed operation should mark applied");
    assert_eq!(applied.status, RoutedOperationStatus::Applied);
    assert_eq!(applied.updated_at_ms, 5);
    assert_eq!(
        service
            .routed_operation("op_alpha_create")
            .expect("routed operation should load")
            .expect("routed operation should exist")
            .status,
        RoutedOperationStatus::Applied
    );
    assert_eq!(
        service
            .routed_operation_for_caller(
                RoutedOperationRequest {
                    database_id: "alpha".to_string(),
                    operation_id: "op_alpha_create".to_string()
                },
                "owner"
            )
            .expect("owner should inspect routed operation")
            .status,
        RoutedOperationStatus::Applied
    );
    let read_auth = AuthenticatedDatabaseToken {
        token_id: "tok_read".to_string(),
        database_id: "alpha".to_string(),
        scope: DatabaseTokenScope::Read,
    };
    assert_eq!(
        service
            .routed_operation_with_token(
                &read_auth,
                RoutedOperationRequest {
                    database_id: "alpha".to_string(),
                    operation_id: "op_alpha_create".to_string()
                }
            )
            .expect("read token should inspect routed operation")
            .method,
        "sql_execute_internal"
    );
    let wrong_database = service
        .routed_operation_for_caller(
            RoutedOperationRequest {
                database_id: "beta".to_string(),
                operation_id: "op_alpha_create".to_string(),
            },
            "owner",
        )
        .expect_err("operation should not leak across database ids");
    assert!(wrong_database.contains("principal has no access to database: beta"));
}

#[test]
fn shard_operation_log_tracks_unknown_outcomes() {
    let service = service();
    let request_hash = sha256_bytes(b"create shard policy");

    let pending = service
        .begin_shard_operation(
            "op_shard_create",
            "create_shard",
            Some("database:aaaaa-aa"),
            request_hash.clone(),
            2,
        )
        .expect("shard operation should begin");
    assert_eq!(pending.status, RoutedOperationStatus::Pending);
    assert_eq!(pending.operation_kind, "create_shard");
    assert_eq!(pending.target.as_deref(), Some("database:aaaaa-aa"));

    let replay = service
        .begin_shard_operation(
            "op_shard_create",
            "create_shard",
            Some("database:aaaaa-aa"),
            request_hash.clone(),
            3,
        )
        .expect("same shard operation should replay");
    assert_eq!(replay.created_at_ms, 2);

    let mismatch = service
        .begin_shard_operation(
            "op_shard_create",
            "top_up_shard",
            Some("database:aaaaa-aa"),
            request_hash,
            4,
        )
        .expect_err("different shard operation should be rejected");
    assert!(mismatch.contains("shard operation request mismatch"));

    let unknown = service
        .update_shard_operation_status(
            "op_shard_create",
            RoutedOperationStatus::Unknown,
            Some("bounded wait timed out"),
            5,
        )
        .expect("shard operation should mark unknown");
    assert_eq!(unknown.status, RoutedOperationStatus::Unknown);
    assert_eq!(unknown.error.as_deref(), Some("bounded wait timed out"));

    let operations = service
        .list_shard_operations()
        .expect("shard operations should list");
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].operation_id, "op_shard_create");

    let rejected_status = service
        .reconcile_shard_operation("op_shard_create", RoutedOperationStatus::Pending, None, 6)
        .expect_err("pending should not be a reconcile target");
    assert!(rejected_status.contains("must be applied or failed"));

    let rejected_error = service
        .reconcile_shard_operation("op_shard_create", RoutedOperationStatus::Failed, None, 7)
        .expect_err("failed reconcile should require an error");
    assert!(rejected_error.contains("requires an error"));

    let failed = service
        .reconcile_shard_operation(
            "op_shard_create",
            RoutedOperationStatus::Failed,
            Some("operator verified remote failure"),
            8,
        )
        .expect("unknown operation should reconcile to failed");
    assert_eq!(failed.status, RoutedOperationStatus::Failed);
    assert_eq!(
        failed.error.as_deref(),
        Some("operator verified remote failure")
    );

    let already_resolved = service
        .reconcile_shard_operation("op_shard_create", RoutedOperationStatus::Applied, None, 9)
        .expect_err("resolved operation should not reconcile again");
    assert!(already_resolved.contains("shard operation is not unknown"));
}

#[test]
fn shard_placement_migration_backfills_existing_databases() {
    let (service, root) = service_with_root();
    service
        .create_database("alpha", "owner", 1)
        .expect("alpha should create");
    service
        .create_database("beta", "owner", 2)
        .expect("beta should create");
    service
        .delete_database("beta", "owner", 3)
        .expect("beta should delete");

    index_execute(&root, "DROP TABLE database_shard_placements", Vec::new());
    index_execute(
        &root,
        "DELETE FROM schema_migrations WHERE version = ?1",
        vec![SqlValue::Text(
            "database_index:014_shard_placements".to_string(),
        )],
    );
    service
        .run_index_migrations()
        .expect("shard placement migration should backfill");

    assert_eq!(
        shard_placement_row(&root, "alpha"),
        (
            "local".to_string(),
            Some(11),
            "hot".to_string(),
            None,
            "sqlite:raw".to_string()
        )
    );
    assert_eq!(
        shard_placement_row(&root, "beta"),
        (
            "local".to_string(),
            None,
            "deleted".to_string(),
            None,
            "sqlite:raw".to_string()
        )
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

    let archive = service
        .begin_database_archive("shared", "owner", 15)
        .expect("archive should begin");
    let bytes = read_archive_in_chunks(&service, "shared", archive.size_bytes, 64);
    service
        .finalize_database_archive("shared", "owner", sha256_bytes(&bytes), 16)
        .expect("archive should finalize");
    let archived_members = service
        .list_database_members("shared", "owner")
        .expect("owner should list archived database members");
    assert_eq!(archived_members.len(), 3);

    service
        .revoke_database_access("shared", "owner", "reader")
        .expect_err("archived database should reject membership mutation");
    service
        .begin_database_restore(
            "shared",
            "owner",
            sha256_bytes(&bytes),
            archive.size_bytes,
            17,
        )
        .expect("restore should begin");
    service
        .write_database_restore_chunk("shared", "owner", 0, &bytes)
        .expect("restore chunk should write");
    service
        .finalize_database_restore("shared", "owner", 18)
        .expect("restore should finalize");
    service
        .revoke_database_access("shared", "owner", "reader")
        .expect("owner should revoke reader after restore");
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

#[test]
fn anonymous_principal_can_only_receive_reader_access() {
    let service = service();
    service
        .create_database("public", "owner", 1)
        .expect("database should create");

    service
        .grant_database_access("public", "owner", "2vxsx-fae", DatabaseRole::Reader, 2)
        .expect("anonymous reader should be allowed");
    let writer_error = service
        .grant_database_access("public", "owner", "2vxsx-fae", DatabaseRole::Writer, 3)
        .expect_err("anonymous writer should fail");
    let owner_error = service
        .grant_database_access("public", "owner", "2vxsx-fae", DatabaseRole::Owner, 4)
        .expect_err("anonymous owner should fail");

    assert!(writer_error.contains("anonymous principal"));
    assert!(owner_error.contains("anonymous principal"));
    service
        .sql_query("2vxsx-fae", sql_request("public", "SELECT 1"))
        .expect("anonymous reader query should pass");
    assert!(
        service
            .sql_execute(
                "2vxsx-fae",
                sql_request("public", "CREATE TABLE nope (id INTEGER)")
            )
            .expect_err("anonymous reader write should fail")
            .contains("lacks required database role")
    );
}
