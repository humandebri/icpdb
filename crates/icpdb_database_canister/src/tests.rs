// Where: crates/icpdb_database_canister/src/tests.rs
// What: Unit coverage for the internal database-shard canister surface.
// Why: Direct shard calls must be restricted to the configured control canister.
use super::*;
use icpdb_types::SqlValue;
use sha2::{Digest, Sha256};

#[test]
fn control_can_create_and_query_database_slot() {
    let control = Principal::from_text("aaaaa-aa").expect("control principal should parse");
    initialize(DatabaseCanisterInitArgs {
        control_canister_id: control.to_text(),
    })
    .expect("database canister should initialize");

    set_test_caller(Principal::from_text("2vxsx-fae").expect("caller should parse"));
    let rejected = list_tables_internal("db_shard_smoke".to_string())
        .expect_err("non-control caller should be rejected");
    assert_eq!(rejected, "caller is not the configured control canister");

    set_test_caller(control);
    let info = create_database_slot(CreateDatabaseSlotRequest {
        database_id: "db_shard_smoke".to_string(),
    })
    .expect("control should create a database slot");
    assert_eq!(info.database_id, "db_shard_smoke");
    assert_eq!(info.status, DatabaseStatus::Hot);
    assert!(info.mount_id.is_some());

    sql_execute_internal(DataPlaneSqlExecuteRequest {
        operation_id: "op_create_notes".to_string(),
        request: SqlExecuteRequest {
            database_id: "db_shard_smoke".to_string(),
            sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)".to_string(),
            params: Vec::new(),
            max_rows: None,
            idempotency_key: None,
        },
    })
    .expect("table should create");
    sql_execute_internal(DataPlaneSqlExecuteRequest {
        operation_id: "op_insert_note".to_string(),
        request: SqlExecuteRequest {
            database_id: "db_shard_smoke".to_string(),
            sql: "INSERT INTO notes (body) VALUES ('from-shard')".to_string(),
            params: Vec::new(),
            max_rows: None,
            idempotency_key: None,
        },
    })
    .expect("row should insert");
    let operation = get_data_plane_operation_internal(RoutedOperationRequest {
        database_id: "db_shard_smoke".to_string(),
        operation_id: "op_insert_note".to_string(),
    })
    .expect("control should query applied data-plane operation")
    .expect("applied operation should exist");
    assert_eq!(operation.method, "sql_execute_internal");
    assert_eq!(operation.database_id, "db_shard_smoke");
    let duplicate = sql_execute_internal(DataPlaneSqlExecuteRequest {
        operation_id: "op_insert_note".to_string(),
        request: SqlExecuteRequest {
            database_id: "db_shard_smoke".to_string(),
            sql: "INSERT INTO notes (body) VALUES ('from-shard')".to_string(),
            params: Vec::new(),
            max_rows: None,
            idempotency_key: None,
        },
    })
    .expect_err("duplicate applied operation should not re-run");
    assert!(duplicate.contains("data-plane operation already applied"));
    let usage = database_usage_internal("db_shard_smoke".to_string())
        .expect("control should load shard usage");
    assert_eq!(usage.database_id, "db_shard_smoke");
    assert!(usage.logical_size_bytes > 0);

    let tables =
        list_tables_internal("db_shard_smoke".to_string()).expect("control should list tables");
    assert_eq!(tables[0].name, "notes");
    let result = sql_query_internal(SqlExecuteRequest {
        database_id: "db_shard_smoke".to_string(),
        sql: "SELECT body FROM notes".to_string(),
        params: Vec::new(),
        max_rows: None,
        idempotency_key: None,
    })
    .expect("control should query rows");
    assert_eq!(result.rows[0][0], SqlValue::Text("from-shard".to_string()));

    let info = roundtrip_archive_restore("db_shard_smoke");
    assert_eq!(info.status, DatabaseStatus::Hot);

    let restored = sql_query_internal(SqlExecuteRequest {
        database_id: "db_shard_smoke".to_string(),
        sql: "SELECT body FROM notes".to_string(),
        params: Vec::new(),
        max_rows: None,
        idempotency_key: None,
    })
    .expect("control should query restored rows");
    assert_eq!(
        restored.rows[0][0],
        SqlValue::Text("from-shard".to_string())
    );

    delete_database_slot("db_shard_smoke".to_string()).expect("control should delete slot");
    delete_database_slot("db_shard_smoke".to_string())
        .expect("delete slot should be idempotent after remote success");
    let deleted = database_usage_internal("db_shard_smoke".to_string())
        .expect("deleted slot usage should load");
    assert_eq!(deleted.status, DatabaseStatus::Deleted);
}

#[test]
fn exported_candid_matches_checked_in_database_did() {
    assert_eq!(
        candid_service().trim_end(),
        include_str!("../icpdb_database.did").trim_end()
    );
}

fn roundtrip_archive_restore(database_id: &str) -> DatabaseInfo {
    let archive =
        begin_database_archive_internal(database_id.to_string()).expect("archive should begin");
    assert!(archive.size_bytes > 0);

    let chunk = read_database_archive_chunk_internal(DatabaseArchiveReadRequest {
        database_id: database_id.to_string(),
        offset: 0,
        max_bytes: archive.size_bytes as u32,
    })
    .expect("archive chunk should read");
    assert_eq!(chunk.bytes.len() as u64, archive.size_bytes);
    let snapshot_hash = Sha256::digest(&chunk.bytes).to_vec();

    finalize_database_archive_internal(DatabaseArchiveFinalizeRequest {
        database_id: database_id.to_string(),
        snapshot_hash: snapshot_hash.clone(),
    })
    .expect("archive should finalize");

    let restoring = begin_database_restore_internal(DatabaseRestoreBeginRequest {
        database_id: database_id.to_string(),
        snapshot_hash,
        size_bytes: archive.size_bytes,
    })
    .expect("restore should begin");
    assert_eq!(restoring.status, DatabaseStatus::Restoring);

    write_database_restore_chunk_internal(DatabaseRestoreChunkRequest {
        database_id: database_id.to_string(),
        offset: 0,
        bytes: chunk.bytes,
    })
    .expect("restore chunk should write");

    finalize_database_restore_internal(database_id.to_string()).expect("restore should finalize")
}
