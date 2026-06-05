// Where: crates/icpdb_canister/src/tests.rs
// What: Entry-point level tests for the ICPDB canister surface.
// Why: SQL hosting, billing, deposit, and lifecycle wrappers need direct coverage.
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};

use candid::Nat;
use icpdb_runtime::{IcpdbService, RoutedWriteBegin, SQL_EXECUTE_BILLING_UNITS, hash_api_token};
use icpdb_types::{
    CreateDatabaseShardRequest, CreateDatabaseTokenRequest, DataPlaneSqlExecuteRequest,
    DatabaseArchiveChunk, DatabaseArchiveInfo, DatabaseBalanceTopUpRequest, DatabaseBillingStatus,
    DatabaseRestoreChunkRequest, DatabaseRole, DatabaseShardStatusRequest, DatabaseStatus,
    DatabaseTable, DatabaseTokenScope, MaintainDatabaseShardsRequest,
    MigrateDatabaseToShardRequest, RoutedOperationRequest, RoutedOperationStatus,
    ShardOperationReconcileRequest, SqlBatchRequest, SqlExecuteRequest, SqlExecuteResponse,
    SqlStatement, SqlValue, TableDescription, TablePreviewRequest, TablePreviewResponse,
    TopUpDatabaseShardRequest,
};
use icrc_ledger_types::icrc2::transfer_from::TransferFromError;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

use super::{
    HeaderField, HttpRequest, PENDING_DEPOSITS, RemotePrincipalWriteContext, SERVICE,
    acquire_deposit_guard_for_test, bearer_token, candid_routed_operation_id,
    clear_test_icp_transfer_from, create_database, create_database_shard, create_database_token,
    deposit_with_approval, describe_transfer_from_error, fail_next_mount_database_file_for_test,
    finish_remote_lifecycle_operation_journal, get_billing, get_database_shard_status,
    get_deposit_quote, get_routed_operation, get_usage_event_summaries, grant_database_access,
    http_error_status, http_request, idempotency_key, list_all_database_placements,
    list_database_placements, list_databases, list_payments, maintain_database_shards,
    mark_routed_write_completion_failed, migrate_database_to_shard, reconcile_shard_operation,
    remote_lifecycle_operation_status, remote_sql_write_for_caller, revoke_database_access,
    routed_request_hash, set_test_caller_is_controller, set_test_caller_text,
    set_test_icp_transfer_from, sql_batch_response_with_routed_operation_id,
    sql_response_with_routed_operation_id, top_up_database_balance, top_up_database_shard,
};

struct NoopWaker;

impl Wake for NoopWaker {
    fn wake(self: Arc<Self>) {}
}

fn block_on_ready<T>(future: impl Future<Output = T>) -> T {
    let waker = Waker::from(Arc::new(NoopWaker));
    let mut context = Context::from_waker(&waker);
    let mut future = Box::pin(future);
    match Future::poll(future.as_mut(), &mut context) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("test future unexpectedly pending"),
    }
}

fn sql_query(request: SqlExecuteRequest) -> Result<SqlExecuteResponse, String> {
    block_on_ready(super::sql_query(request))
}

fn sql_execute(request: SqlExecuteRequest) -> Result<SqlExecuteResponse, String> {
    block_on_ready(super::sql_execute(request))
}

fn list_tables(database_id: String) -> Result<Vec<DatabaseTable>, String> {
    block_on_ready(super::list_tables(database_id))
}

fn describe_table(database_id: String, table_name: String) -> Result<TableDescription, String> {
    block_on_ready(super::describe_table(database_id, table_name))
}

fn preview_table(request: TablePreviewRequest) -> Result<TablePreviewResponse, String> {
    block_on_ready(super::preview_table(request))
}

fn begin_database_archive(database_id: String) -> Result<DatabaseArchiveInfo, String> {
    block_on_ready(super::begin_database_archive(database_id))
}

fn read_database_archive_chunk(
    database_id: String,
    offset: u64,
    max_bytes: u32,
) -> Result<DatabaseArchiveChunk, String> {
    block_on_ready(super::read_database_archive_chunk(
        database_id,
        offset,
        max_bytes,
    ))
}

fn finalize_database_archive(database_id: String, snapshot_hash: Vec<u8>) -> Result<(), String> {
    block_on_ready(super::finalize_database_archive(database_id, snapshot_hash))
}

fn cancel_database_archive(database_id: String) -> Result<(), String> {
    block_on_ready(super::cancel_database_archive(database_id))
}

fn begin_database_restore(
    database_id: String,
    snapshot_hash: Vec<u8>,
    size_bytes: u64,
) -> Result<(), String> {
    block_on_ready(super::begin_database_restore(
        database_id,
        snapshot_hash,
        size_bytes,
    ))
}

fn write_database_restore_chunk(request: DatabaseRestoreChunkRequest) -> Result<(), String> {
    block_on_ready(super::write_database_restore_chunk(request))
}

fn finalize_database_restore(database_id: String) -> Result<(), String> {
    block_on_ready(super::finalize_database_restore(database_id))
}

fn install_test_service() {
    set_test_caller_text(None);
    set_test_caller_is_controller(false);
    clear_test_icp_transfer_from();
    PENDING_DEPOSITS.with(|pending| pending.borrow_mut().clear());
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = test_service_for_root(&root);
    service
        .run_index_migrations()
        .expect("index migrations should run");
    service
        .create_database("default", "2vxsx-fae", 1_700_000_000_000)
        .expect("default database should create");
    SERVICE.with(|slot| *slot.borrow_mut() = Some(service));
}

fn install_empty_test_service() {
    set_test_caller_text(None);
    set_test_caller_is_controller(false);
    clear_test_icp_transfer_from();
    PENDING_DEPOSITS.with(|pending| pending.borrow_mut().clear());
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = test_service_for_root(&root);
    service
        .run_index_migrations()
        .expect("index migrations should run");
    SERVICE.with(|slot| *slot.borrow_mut() = Some(service));
}

fn usage_event_count() -> u64 {
    SERVICE.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .usage_event_count()
            .expect("usage count should load")
    })
}

fn sha256_bytes(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

fn test_service_for_root(root: &std::path::Path) -> IcpdbService {
    IcpdbService::new(
        path_string(root.join("index.sqlite3")),
        path_string(root.join("databases")),
    )
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn sql_request(database_id: &str, sql: &str) -> SqlExecuteRequest {
    SqlExecuteRequest {
        database_id: database_id.to_string(),
        sql: sql.to_string(),
        params: Vec::new(),
        max_rows: None,
        idempotency_key: None,
    }
}

fn http_sql_request(method: &str, url: &str) -> HttpRequest {
    HttpRequest {
        method: method.to_string(),
        url: url.to_string(),
        headers: Vec::new(),
        body: Vec::new(),
        certificate_version: None,
    }
}

fn http_update_json(url: &str, token: &str, value: serde_json::Value) -> super::HttpUpdateRequest {
    super::HttpUpdateRequest {
        method: "POST".to_string(),
        url: url.to_string(),
        headers: vec![("authorization".to_string(), format!("Bearer {token}"))],
        body: serde_json::to_vec(&value).expect("JSON body should encode"),
    }
}

fn json_body(response: &super::HttpUpdateResponse) -> serde_json::Value {
    serde_json::from_slice(&response.body).expect("response body should be JSON")
}

fn http_request_update(request: super::HttpUpdateRequest) -> super::HttpUpdateResponse {
    block_on_ready(super::http_request_update(request))
}

#[test]
fn empty_index_does_not_create_default_database() {
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = test_service_for_root(&root);
    service
        .run_index_migrations()
        .expect("index migrations should run");

    let databases = service
        .list_databases()
        .expect("empty index should be readable");
    assert!(databases.is_empty());
}

#[test]
fn existing_database_index_is_loaded_without_implicit_default() {
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = test_service_for_root(&root);
    service
        .run_index_migrations()
        .expect("index migrations should run");
    service
        .create_database("alpha", "owner", 1)
        .expect("existing database should create");

    let databases = service
        .list_databases()
        .expect("existing index should load");

    assert_eq!(databases.len(), 1);
    assert_eq!(databases[0].database_id, "alpha");
}

#[test]
fn canister_list_databases_returns_caller_membership_summaries() {
    install_test_service();

    let summaries = list_databases().expect("database summaries should load");
    let placements = list_database_placements().expect("database placements should load");
    assert!(list_all_database_placements().is_err());
    set_test_caller_is_controller(true);
    let all_placements =
        list_all_database_placements().expect("all database placements should load");
    set_test_caller_is_controller(false);

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].database_id, "default");
    assert_eq!(summaries[0].role, DatabaseRole::Owner);
    assert_eq!(summaries[0].status, DatabaseStatus::Hot);
    assert_eq!(placements.len(), 1);
    assert_eq!(placements[0].database_id, "default");
    assert_eq!(placements[0].shard_id, "local");
    assert_eq!(placements[0].mount_id, Some(11));
    assert_eq!(all_placements.len(), 1);
    assert_eq!(all_placements[0].database_id, "default");
}

#[test]
fn update_entrypoints_record_usage_events() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));

    let database_id = block_on_ready(create_database()).expect("database should create");
    assert_eq!(usage_event_count(), 1);

    let failed = sql_execute(sql_request(&database_id, ""));
    assert!(failed.is_err());
    assert_eq!(usage_event_count(), 2);

    sql_execute(sql_request(
        &database_id,
        "CREATE TABLE usage_probe (body TEXT)",
    ))
    .expect("table should create");
    sql_execute(sql_request(
        &database_id,
        "INSERT INTO usage_probe (body) VALUES ('tracked')",
    ))
    .expect("row should insert");
    let events = get_usage_event_summaries(database_id).expect("usage event summaries should load");
    assert!(events.iter().any(|event| event.method == "sql_execute"
        && event.operation.as_deref() == Some("INSERT")
        && event.success
        && event.total_rows_affected == 1));
}

#[test]
fn table_editor_queries_use_caller_role() {
    install_test_service();

    sql_execute(SqlExecuteRequest {
        database_id: "default".to_string(),
        sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)".to_string(),
        params: Vec::new(),
        max_rows: None,
        idempotency_key: None,
    })
    .expect("table should create");
    sql_execute(SqlExecuteRequest {
        database_id: "default".to_string(),
        sql: "INSERT INTO notes (body) VALUES ('hello')".to_string(),
        params: Vec::new(),
        max_rows: None,
        idempotency_key: None,
    })
    .expect("row should insert");

    let tables = list_tables("default".to_string()).expect("tables should list");
    assert_eq!(tables[0].name, "notes");

    let description =
        describe_table("default".to_string(), "notes".to_string()).expect("table should describe");
    assert_eq!(description.columns[1].name, "body");
    assert_eq!(description.columns[1].hidden, 0);

    let preview = preview_table(TablePreviewRequest {
        database_id: "default".to_string(),
        table_name: "notes".to_string(),
        limit: Some(10),
        offset: None,
    })
    .expect("preview should load");
    assert_eq!(preview.rows[0][1], SqlValue::Text("hello".to_string()));
    assert_eq!(preview.total_count, 1);

    set_test_caller_text(Some("aaaaa-aa"));
    let error = list_tables("default".to_string()).expect_err("non-member should be rejected");
    assert!(error.contains("principal has no access"));
}

#[test]
fn anonymous_create_database_is_rejected() {
    install_empty_test_service();

    let error = block_on_ready(create_database()).expect_err("anonymous create should fail");

    assert_eq!(error, "anonymous caller not allowed");
    assert!(
        list_databases()
            .expect("database summaries should load")
            .is_empty()
    );
}

#[test]
fn create_database_token_authorizes_before_raw_rand() {
    install_test_service();
    set_test_caller_text(Some("aaaaa-aa"));

    let error = block_on_ready(create_database_token(CreateDatabaseTokenRequest {
        database_id: "default".to_string(),
        name: "read".to_string(),
        scope: DatabaseTokenScope::Read,
    }))
    .expect_err("non-owner should fail before raw_rand");

    assert!(error.contains("principal has no access"));
}

#[test]
fn deposit_with_approval_records_ledger_payment() {
    install_test_service();
    set_test_icp_transfer_from(Ok(99));

    let quote = block_on_ready(get_deposit_quote("default".to_string(), 1_000_000))
        .expect("quote should load");
    assert_eq!(quote.expected_fee_e8s, 10_000);
    assert_eq!(quote.credited_units, 1_000);

    let result = block_on_ready(deposit_with_approval("default".to_string(), 1_000_000))
        .expect("deposit should record");
    assert_eq!(result.block_index, 99);
    assert_eq!(result.credited_units, 1_000);
    assert_eq!(
        get_billing("default".to_string())
            .expect("billing should load")
            .status,
        DatabaseBillingStatus::Active
    );
    let payments = list_payments("default".to_string()).expect("payments should list");
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].block_index, 99);
}

#[test]
fn deposit_guard_rejects_same_payer_database_until_released() {
    install_test_service();
    let guard =
        acquire_deposit_guard_for_test("2vxsx-fae", "default").expect("test guard should acquire");

    let blocked = block_on_ready(deposit_with_approval("default".to_string(), 1_000_000))
        .expect_err("pending deposit should block");
    assert_eq!(blocked, "deposit already in progress");
    assert_eq!(
        list_payments("default".to_string())
            .expect("payments should list")
            .len(),
        0
    );

    drop(guard);
    set_test_icp_transfer_from(Ok(100));
    let result = block_on_ready(deposit_with_approval("default".to_string(), 1_000_000))
        .expect("deposit should run after guard release");
    assert_eq!(result.block_index, 100);
}

#[test]
fn deposit_duplicate_block_returns_existing_payment() {
    install_test_service();
    set_test_icp_transfer_from(Ok(101));
    block_on_ready(deposit_with_approval("default".to_string(), 1_000_000))
        .expect("first deposit should record");

    set_test_icp_transfer_from(Err(TransferFromError::Duplicate {
        duplicate_of: Nat::from(101_u64),
    }));
    let duplicate = block_on_ready(deposit_with_approval("default".to_string(), 1_000_000))
        .expect("known duplicate should be success");

    assert_eq!(duplicate.block_index, 101);
    assert_eq!(
        list_payments("default".to_string())
            .expect("payments should list")
            .len(),
        1
    );
}

#[test]
fn deposit_bad_fee_updates_cached_fee_without_recording_payment() {
    install_test_service();
    set_test_icp_transfer_from(Err(TransferFromError::BadFee {
        expected_fee: Nat::from(12_345_u64),
    }));

    let error = block_on_ready(deposit_with_approval("default".to_string(), 1_000_000))
        .expect_err("bad fee should ask for requote");
    assert!(error.contains("fee更新済み"), "{error}");
    assert_eq!(
        list_payments("default".to_string())
            .expect("payments should list")
            .len(),
        0
    );

    let quote = block_on_ready(get_deposit_quote("default".to_string(), 1_000_000))
        .expect("quote should load updated fee");
    assert_eq!(quote.expected_fee_e8s, 12_345);
}

#[test]
fn deposit_unknown_duplicate_requires_operator_verification() {
    install_test_service();
    set_test_icp_transfer_from(Err(TransferFromError::Duplicate {
        duplicate_of: Nat::from(404_u64),
    }));

    let error = block_on_ready(deposit_with_approval("default".to_string(), 1_000_000))
        .expect_err("unknown duplicate should fail");

    assert!(error.contains("operator verification required"));
}

#[test]
fn manual_top_up_requires_controller() {
    install_test_service();
    set_test_caller_text(Some("aaaaa-aa"));

    let rejected = top_up_database_balance(DatabaseBalanceTopUpRequest {
        database_id: "default".to_string(),
        units: 1,
    })
    .expect_err("non-controller should not top up");
    assert!(rejected.contains("caller is not a canister controller"));

    set_test_caller_is_controller(true);
    let billing = top_up_database_balance(DatabaseBalanceTopUpRequest {
        database_id: "default".to_string(),
        units: 1,
    })
    .expect("controller should top up");

    assert_eq!(billing.status, DatabaseBillingStatus::Active);
}

#[test]
fn create_database_shard_requires_controller_before_management_calls() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));

    let error = block_on_ready(create_database_shard(CreateDatabaseShardRequest {
        max_databases: 8,
        initial_cycles: 1,
    }))
    .expect_err("non-controller should not create shards");

    assert_eq!(error, "caller is not a controller");
}

#[test]
fn top_up_database_shard_requires_registered_shard_before_deposit() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));
    set_test_caller_is_controller(true);

    let error = block_on_ready(top_up_database_shard(TopUpDatabaseShardRequest {
        database_canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai".to_string(),
        cycles: 1,
    }))
    .expect_err("unregistered shard should fail before deposit");

    assert_eq!(error, "database shard is not registered");
}

#[test]
fn get_database_shard_status_requires_registered_shard_before_management_call() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));
    set_test_caller_is_controller(true);

    let error = block_on_ready(get_database_shard_status(DatabaseShardStatusRequest {
        database_canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai".to_string(),
    }))
    .expect_err("unregistered shard should fail before status call");

    assert_eq!(error, "database shard is not registered");
}

#[test]
fn maintain_database_shards_requires_controller_before_status_calls() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));

    let error = block_on_ready(maintain_database_shards(MaintainDatabaseShardsRequest {
        min_available_slots: 1,
        min_cycles_balance: 0,
        top_up_cycles: 0,
        max_new_shards: 1,
        new_shard_max_databases: 8,
        new_shard_initial_cycles: 1,
    }))
    .expect_err("non-controller should not maintain shards");

    assert_eq!(error, "caller is not a controller");
}

#[test]
fn reconcile_shard_operation_requires_controller_and_unknown_status() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));

    let request = ShardOperationReconcileRequest {
        operation_id: "op_create_shard".to_string(),
        status: RoutedOperationStatus::Applied,
        error: None,
    };
    let error = reconcile_shard_operation(request.clone())
        .expect_err("non-controller should not reconcile shard operations");
    assert_eq!(error, "caller is not a controller");

    set_test_caller_is_controller(true);
    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        service
            .begin_shard_operation(
                "op_create_shard",
                "create_shard",
                Some("database:aaaaa-aa"),
                sha256_bytes(b"create shard"),
                1,
            )
            .expect("operation should begin");
    });
    let not_unknown =
        reconcile_shard_operation(request).expect_err("pending operation should not reconcile");
    assert!(not_unknown.contains("shard operation is not unknown"));

    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        service
            .update_shard_operation_status(
                "op_create_shard",
                RoutedOperationStatus::Unknown,
                Some("bounded wait timed out"),
                2,
            )
            .expect("operation should become unknown");
    });
    let reconciled = reconcile_shard_operation(ShardOperationReconcileRequest {
        operation_id: "op_create_shard".to_string(),
        status: RoutedOperationStatus::Failed,
        error: Some("operator verified no shard was created".to_string()),
    })
    .expect("controller should reconcile unknown operation");
    assert_eq!(reconciled.status, RoutedOperationStatus::Failed);
    assert_eq!(
        reconciled.error.as_deref(),
        Some("operator verified no shard was created")
    );
}

#[test]
fn remote_lifecycle_operation_status_classifies_remote_and_local_outcomes() {
    let ok: Result<(), String> = Ok(());
    let err: Result<(), String> = Err("controller update failed".to_string());

    assert_eq!(
        remote_lifecycle_operation_status(false, &err),
        RoutedOperationStatus::Failed
    );
    assert_eq!(
        remote_lifecycle_operation_status(true, &ok),
        RoutedOperationStatus::Applied
    );
    assert_eq!(
        remote_lifecycle_operation_status(true, &err),
        RoutedOperationStatus::Unknown
    );
}

#[test]
fn remote_lifecycle_journal_records_unknown_after_remote_success_local_failure() {
    install_empty_test_service();
    let request_hash = sha256_bytes(b"remote lifecycle");

    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        for operation_id in ["op_remote_failed", "op_remote_applied", "op_remote_unknown"] {
            service
                .begin_shard_operation(
                    operation_id,
                    "begin_remote_database_archive",
                    Some("default"),
                    request_hash.clone(),
                    1,
                )
                .expect("operation should begin");
        }
    });

    let remote_error: Result<(), String> = Err("remote call failed".to_string());
    finish_remote_lifecycle_operation_journal("op_remote_failed", false, &remote_error, 2);
    let applied: Result<(), String> = Ok(());
    finish_remote_lifecycle_operation_journal("op_remote_applied", true, &applied, 3);
    let local_error: Result<(), String> = Err("controller update failed".to_string());
    finish_remote_lifecycle_operation_journal("op_remote_unknown", true, &local_error, 4);

    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        let failed = service
            .shard_operation("op_remote_failed")
            .expect("operation should load")
            .expect("operation should exist");
        assert_eq!(failed.status, RoutedOperationStatus::Failed);
        assert_eq!(failed.error.as_deref(), Some("remote call failed"));

        let applied = service
            .shard_operation("op_remote_applied")
            .expect("operation should load")
            .expect("operation should exist");
        assert_eq!(applied.status, RoutedOperationStatus::Applied);
        assert_eq!(applied.error, None);

        let unknown = service
            .shard_operation("op_remote_unknown")
            .expect("operation should load")
            .expect("operation should exist");
        assert_eq!(unknown.status, RoutedOperationStatus::Unknown);
        assert_eq!(unknown.error.as_deref(), Some("controller update failed"));
    });
}

#[test]
fn routed_write_completion_failure_marks_operation_unknown() {
    install_test_service();
    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        service
            .begin_routed_write(
                "2vxsx-fae",
                "default",
                RoutedWriteBegin {
                    operation_id: "op_completion_failed",
                    database_canister_id: "aaaaa-aa",
                    method: "sql_execute_internal",
                    request_hash: sha256_bytes(b"principal routed write"),
                    billing_units: SQL_EXECUTE_BILLING_UNITS,
                    now: 1,
                },
            )
            .expect("routed write should begin");
    });

    mark_routed_write_completion_failed("op_completion_failed", "unit charge failed", 2);

    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        let operation = service
            .routed_operation("op_completion_failed")
            .expect("operation should load")
            .expect("operation should exist");
        assert_eq!(operation.status, RoutedOperationStatus::Unknown);
        assert_eq!(operation.error.as_deref(), Some("unit charge failed"));
    });
}

#[test]
fn maintain_database_shards_validates_capacity_policy_before_management_calls() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));
    set_test_caller_is_controller(true);

    let error = block_on_ready(maintain_database_shards(MaintainDatabaseShardsRequest {
        min_available_slots: 1,
        min_cycles_balance: 0,
        top_up_cycles: 0,
        max_new_shards: 0,
        new_shard_max_databases: 8,
        new_shard_initial_cycles: 1,
    }))
    .expect_err("invalid autoscale policy should fail before management calls");

    assert_eq!(
        error,
        "max_new_shards must be greater than zero when min_available_slots is set"
    );
}

#[test]
fn migrate_database_to_shard_requires_controller_before_remote_calls() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));

    let error = block_on_ready(migrate_database_to_shard(MigrateDatabaseToShardRequest {
        database_id: "default".to_string(),
        database_canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai".to_string(),
    }))
    .expect_err("non-controller should not migrate databases");

    assert_eq!(error, "caller is not a controller");
}

#[test]
fn transfer_from_errors_are_user_actionable() {
    assert!(
        describe_transfer_from_error(&TransferFromError::BadFee {
            expected_fee: Nat::from(10_000_u64)
        })
        .contains("bad ICP ledger fee")
    );
    assert!(
        describe_transfer_from_error(&TransferFromError::InsufficientAllowance {
            allowance: Nat::from(0_u64)
        })
        .contains("approve不足")
    );
    assert!(
        describe_transfer_from_error(&TransferFromError::TemporarilyUnavailable)
            .contains("balance unchanged")
    );
}

#[test]
fn http_request_upgrades_only_supported_post_sql_endpoints() {
    let upgraded = http_request(http_sql_request("POST", "/v1/sql/query"));
    assert_eq!(upgraded.status_code, 200);
    assert_eq!(upgraded.upgrade, Some(true));
    assert!(
        upgraded
            .headers
            .iter()
            .any(|(name, value)| { name == "access-control-allow-origin" && value == "*" })
    );

    for endpoint in [
        "/v1/sql/execute",
        "/v1/sql/batch",
        "/v1/session",
        "/v1/tables/list",
        "/v1/tables/describe",
        "/v1/tables/preview",
        "/v1/usage",
        "/v1/placements/get",
        "/v1/billing",
        "/v1/payments/list",
        "/v1/quota/set",
        "/v1/tokens/create",
        "/v1/tokens/list",
        "/v1/tokens/revoke",
        "/v1/archive/begin",
        "/v1/archive/read",
        "/v1/archive/finalize",
        "/v1/archive/cancel",
        "/v1/restore/begin",
        "/v1/restore/write",
        "/v1/restore/finalize",
        "/v1/members/list",
        "/v1/members/grant",
        "/v1/members/revoke",
        "/v1/operations/get",
        "/v1/database/delete",
    ] {
        let upgraded = http_request(http_sql_request("POST", endpoint));
        assert_eq!(upgraded.status_code, 200);
        assert_eq!(upgraded.upgrade, Some(true));
    }

    let get_rejected = http_request(http_sql_request("GET", "/v1/sql/query"));
    assert_eq!(get_rejected.status_code, 405);
    assert_eq!(get_rejected.upgrade, None);

    let preflight = http_request(http_sql_request("OPTIONS", "/v1/sql/query"));
    assert_eq!(preflight.status_code, 204);
    assert_eq!(preflight.upgrade, None);
    assert!(preflight.headers.iter().any(|(name, value)| {
        name == "access-control-allow-methods" && value.contains("OPTIONS")
    }));
    assert!(preflight.headers.iter().any(|(name, value)| {
        name == "access-control-allow-headers" && value.contains("authorization")
    }));
    assert!(preflight.headers.iter().any(|(name, value)| {
        name == "access-control-allow-headers" && value.contains("idempotency-key")
    }));

    let unknown_rejected = http_request(http_sql_request("POST", "/unknown"));
    assert_eq!(unknown_rejected.status_code, 404);
    assert_eq!(unknown_rejected.upgrade, None);
}

#[test]
fn bearer_token_scheme_is_case_insensitive_and_scope_error_is_forbidden() {
    let headers: Vec<HeaderField> = vec![(
        "authorization".to_string(),
        "bearer icpdb_token".to_string(),
    )];

    assert_eq!(bearer_token(&headers), Some("icpdb_token"));
    let idempotency_headers: Vec<HeaderField> = vec![(
        "Idempotency-Key".to_string(),
        "  op_remote_write_1  ".to_string(),
    )];
    assert_eq!(
        idempotency_key(&idempotency_headers),
        Some("op_remote_write_1")
    );
    assert_eq!(
        http_error_status("api token scope does not allow this operation"),
        403
    );
    assert_eq!(http_error_status("invalid api token"), 401);
}

#[test]
fn http_token_can_get_routed_operation_status() {
    install_test_service();
    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        service
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-read".to_string(),
                    scope: DatabaseTokenScope::Read,
                },
                hash_api_token("secret-read"),
                10,
            )
            .expect("read token should create");
        service
            .begin_routed_operation(
                "op_remote_1",
                "default",
                "aaaaa-aa",
                "sql_execute_internal",
                sha256_bytes(b"remote write"),
                11,
            )
            .expect("routed operation should begin");
    });

    let response = http_request_update(http_update_json(
        "/v1/operations/get",
        "secret-read",
        serde_json::json!({ "database_id": "default", "operation_id": "op_remote_1" }),
    ));
    assert_eq!(response.status_code, 200);
    let body = json_body(&response);
    assert_eq!(body["operation_id"], "op_remote_1");
    assert_eq!(body["database_id"], "default");
    assert_eq!(body["method"], "sql_execute_internal");
    assert_eq!(body["status"], "pending");

    set_test_caller_text(Some("2vxsx-fae"));
    let candid = get_routed_operation(RoutedOperationRequest {
        database_id: "default".to_string(),
        operation_id: "op_remote_1".to_string(),
    })
    .expect("caller should get routed operation");
    assert_eq!(candid.operation_id, "op_remote_1");
}

#[test]
fn remote_sql_response_includes_routed_operation_id() {
    let response = SqlExecuteResponse {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: 1,
        last_insert_rowid: 7,
        truncated: false,
        routed_operation_id: None,
    };
    let tagged = sql_response_with_routed_operation_id(response, "op_remote_result");
    assert_eq!(
        tagged.routed_operation_id.as_deref(),
        Some("op_remote_result")
    );

    let batch = sql_batch_response_with_routed_operation_id(vec![tagged], "op_remote_batch");
    assert_eq!(
        batch[0].routed_operation_id.as_deref(),
        Some("op_remote_batch")
    );
}

#[test]
fn remote_sql_applied_retry_returns_success_without_duplicate_write() {
    install_test_service();
    let request = sql_request("default", "INSERT INTO notes(id) VALUES (1)");
    let request_hash =
        routed_request_hash("sql_execute_internal", &request).expect("request hash should build");
    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        service
            .begin_routed_write(
                "2vxsx-fae",
                "default",
                RoutedWriteBegin {
                    operation_id: "op_remote_applied_retry",
                    database_canister_id: "aaaaa-aa",
                    method: "sql_execute_internal",
                    request_hash,
                    billing_units: SQL_EXECUTE_BILLING_UNITS,
                    now: 10,
                },
            )
            .expect("operation should begin");
        service
            .update_routed_operation_status(
                "op_remote_applied_retry",
                RoutedOperationStatus::Applied,
                None,
                11,
            )
            .expect("operation should mark applied");
    });

    let response = block_on_ready(remote_sql_write_for_caller(
        "2vxsx-fae",
        &request,
        DataPlaneSqlExecuteRequest {
            operation_id: "op_remote_applied_retry".to_string(),
            request: request.clone(),
        },
        RemotePrincipalWriteContext {
            canister_id: "aaaaa-aa",
            internal_method: "sql_execute_internal",
            operation_id: "op_remote_applied_retry",
            billing_units: SQL_EXECUTE_BILLING_UNITS,
            now: 12,
            method: "sql_execute",
            operation: Some("insert"),
            database_id: "default",
        },
        |_| (0, 0),
        super::applied_replay_sql_response,
    ))
    .expect("applied retry should return success");
    assert_eq!(response.rows_affected, 0);

    let mismatch = SqlExecuteRequest {
        sql: "INSERT INTO notes(id) VALUES (2)".to_string(),
        ..request
    };
    let error = block_on_ready(remote_sql_write_for_caller(
        "2vxsx-fae",
        &mismatch,
        DataPlaneSqlExecuteRequest {
            operation_id: "op_remote_applied_retry".to_string(),
            request: mismatch.clone(),
        },
        RemotePrincipalWriteContext {
            canister_id: "aaaaa-aa",
            internal_method: "sql_execute_internal",
            operation_id: "op_remote_applied_retry",
            billing_units: SQL_EXECUTE_BILLING_UNITS,
            now: 13,
            method: "sql_execute",
            operation: Some("insert"),
            database_id: "default",
        },
        |_| (0, 0),
        super::applied_replay_sql_response,
    ))
    .expect_err("different retry request should stay rejected");
    assert!(error.contains("routed operation request mismatch"));
}

#[test]
fn candid_sql_requests_can_supply_routed_operation_id() {
    let execute = SqlExecuteRequest {
        database_id: "default".to_string(),
        sql: "INSERT INTO notes (body) VALUES ('hello')".to_string(),
        params: Vec::new(),
        max_rows: None,
        idempotency_key: Some("sdk_retry_insert_1".to_string()),
    };
    assert_eq!(
        candid_routed_operation_id("sql_execute", &execute).expect("key should load"),
        "sdk_retry_insert_1"
    );

    let batch = SqlBatchRequest {
        database_id: "default".to_string(),
        statements: vec![SqlStatement {
            sql: "INSERT INTO notes (body) VALUES ('hello')".to_string(),
            params: Vec::new(),
        }],
        max_rows: None,
        idempotency_key: Some("sdk_retry_batch_1".to_string()),
    };
    assert_eq!(
        candid_routed_operation_id("sql_batch", &batch).expect("key should load"),
        "sdk_retry_batch_1"
    );
}

#[test]
fn http_token_can_inspect_tables() {
    install_test_service();
    sql_execute(SqlExecuteRequest {
        database_id: "default".to_string(),
        sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)".to_string(),
        params: Vec::new(),
        max_rows: None,
        idempotency_key: None,
    })
    .expect("table should create");
    sql_execute(SqlExecuteRequest {
        database_id: "default".to_string(),
        sql: "INSERT INTO notes (body) VALUES ('hello')".to_string(),
        params: Vec::new(),
        max_rows: None,
        idempotency_key: None,
    })
    .expect("row should insert");
    SERVICE.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-read".to_string(),
                    scope: DatabaseTokenScope::Read,
                },
                hash_api_token("secret-read"),
                10,
            )
            .expect("read token should create");
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-owner".to_string(),
                    scope: DatabaseTokenScope::Owner,
                },
                hash_api_token("secret-owner"),
                11,
            )
            .expect("owner token should create");
    });

    let list = http_request_update(http_update_json(
        "/v1/tables/list",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(list.status_code, 200);
    assert_eq!(json_body(&list)[0]["name"], "notes");

    let description = http_request_update(http_update_json(
        "/v1/tables/describe",
        "secret-read",
        serde_json::json!({ "database_id": "default", "table_name": "notes" }),
    ));
    assert_eq!(description.status_code, 200);
    assert_eq!(json_body(&description)["columns"][1]["name"], "body");
    assert_eq!(json_body(&description)["columns"][1]["hidden"], 0);

    let preview = http_request_update(http_update_json(
        "/v1/tables/preview",
        "secret-read",
        serde_json::json!({ "database_id": "default", "table_name": "notes", "limit": 10, "offset": 0 }),
    ));
    assert_eq!(preview.status_code, 200);
    assert_eq!(json_body(&preview)["rows"][0][1]["text"], "hello");

    let usage = http_request_update(http_update_json(
        "/v1/usage",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(usage.status_code, 200);
    assert_eq!(json_body(&usage)["database_id"], "default");

    let usage_events = http_request_update(http_update_json(
        "/v1/usage/events",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(usage_events.status_code, 200);
    assert!(
        json_body(&usage_events)
            .as_array()
            .expect("usage events should be array")
            .iter()
            .any(|event| event["method"] == "sql_execute" && event["success"] == true)
    );

    let placement = http_request_update(http_update_json(
        "/v1/placements/get",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(placement.status_code, 200);
    assert_eq!(json_body(&placement)["database_id"], "default");
    assert_eq!(json_body(&placement)["shard_id"], "local");

    let billing = http_request_update(http_update_json(
        "/v1/billing",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(billing.status_code, 403);

    let owner_billing = http_request_update(http_update_json(
        "/v1/billing",
        "secret-owner",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(owner_billing.status_code, 200);
    assert_eq!(json_body(&owner_billing)["database_id"], "default");
}

#[test]
fn http_token_can_run_sql_batch() {
    install_test_service();
    SERVICE.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-write".to_string(),
                    scope: DatabaseTokenScope::Write,
                },
                hash_api_token("secret-write"),
                10,
            )
            .expect("write token should create");
    });

    let response = http_request_update(http_update_json(
        "/v1/sql/batch",
        "secret-write",
        serde_json::json!({
            "database_id": "default",
            "statements": [
                { "sql": "CREATE TABLE batch_notes (id INTEGER PRIMARY KEY, body TEXT)", "params": [] },
                { "sql": "INSERT INTO batch_notes (body) VALUES ('batched')", "params": [] },
                { "sql": "SELECT body FROM batch_notes", "params": [] }
            ],
            "max_rows": 10
        }),
    ));
    assert_eq!(response.status_code, 200);
    let body = json_body(&response);
    assert_eq!(body[2]["rows"][0][0]["text"], "batched");

    let usage_events = http_request_update(http_update_json(
        "/v1/usage/events",
        "secret-write",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(usage_events.status_code, 200);
    assert!(
        json_body(&usage_events)
            .as_array()
            .expect("usage events should be array")
            .iter()
            .any(|event| event["method"] == "sql_batch"
                && event["operation"] == "CREATE+INSERT+SELECT"
                && event["success"] == true
                && event["total_rows_returned"] == 1
                && event["total_rows_affected"] == 1)
    );
}

#[test]
fn http_owner_token_can_list_payments() {
    install_test_service();
    set_test_icp_transfer_from(Ok(202));
    block_on_ready(deposit_with_approval("default".to_string(), 1_000_000))
        .expect("deposit should record");
    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        service
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-owner".to_string(),
                    scope: DatabaseTokenScope::Owner,
                },
                hash_api_token("secret-owner"),
                10,
            )
            .expect("owner token should create");
        service
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-read".to_string(),
                    scope: DatabaseTokenScope::Read,
                },
                hash_api_token("secret-read"),
                11,
            )
            .expect("read token should create");
    });

    let rejected = http_request_update(http_update_json(
        "/v1/payments/list",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(rejected.status_code, 403);

    let listed = http_request_update(http_update_json(
        "/v1/payments/list",
        "secret-owner",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(listed.status_code, 200);
    let payments = json_body(&listed);
    assert_eq!(
        payments.as_array().expect("payments should be array").len(),
        1
    );
    assert_eq!(payments[0]["block_index"], 202);
    assert_eq!(payments[0]["credited_units"], 1_000);
}

#[test]
fn http_owner_token_can_update_quota() {
    install_test_service();
    SERVICE.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-owner".to_string(),
                    scope: DatabaseTokenScope::Owner,
                },
                hash_api_token("secret-owner"),
                10,
            )
            .expect("owner token should create");
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-read".to_string(),
                    scope: DatabaseTokenScope::Read,
                },
                hash_api_token("secret-read"),
                10,
            )
            .expect("read token should create");
    });

    let rejected = http_request_update(http_update_json(
        "/v1/quota/set",
        "secret-read",
        serde_json::json!({ "database_id": "default", "max_logical_size_bytes": 134217728 }),
    ));
    assert_eq!(rejected.status_code, 403);

    let accepted = http_request_update(http_update_json(
        "/v1/quota/set",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "max_logical_size_bytes": 134217728 }),
    ));
    assert_eq!(accepted.status_code, 200);
    assert_eq!(json_body(&accepted)["max_logical_size_bytes"], 134217728);
}

#[test]
fn http_owner_token_can_list_and_revoke_tokens() {
    install_test_service();
    let read_token_id = SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service.as_ref().expect("service should be installed");
        service
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-owner".to_string(),
                    scope: DatabaseTokenScope::Owner,
                },
                hash_api_token("secret-owner"),
                10,
            )
            .expect("owner token should create");
        service
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-read".to_string(),
                    scope: DatabaseTokenScope::Read,
                },
                hash_api_token("secret-read"),
                11,
            )
            .expect("read token should create")
            .token_id
    });

    let rejected = http_request_update(http_update_json(
        "/v1/tokens/list",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(rejected.status_code, 403);

    let listed = http_request_update(http_update_json(
        "/v1/tokens/list",
        "secret-owner",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(listed.status_code, 200);
    let listed_body = json_body(&listed);
    assert_eq!(
        listed_body
            .as_array()
            .expect("tokens should be array")
            .len(),
        2
    );
    assert!(
        listed_body
            .as_array()
            .expect("tokens should be array")
            .iter()
            .any(|token| token["name"] == "http-read")
    );

    let revoked = http_request_update(http_update_json(
        "/v1/tokens/revoke",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "token_id": read_token_id }),
    ));
    assert_eq!(revoked.status_code, 200);
    assert_eq!(json_body(&revoked)["name"], "http-read");
    assert!(json_body(&revoked)["revoked_at_ms"].is_number());

    let blocked = http_request_update(http_update_json(
        "/v1/usage",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(blocked.status_code, 401);
}

#[test]
fn http_token_create_rejects_non_owner_before_randomness() {
    install_test_service();
    SERVICE.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-read".to_string(),
                    scope: DatabaseTokenScope::Read,
                },
                hash_api_token("secret-read"),
                10,
            )
            .expect("read token should create");
    });

    let rejected = http_request_update(http_update_json(
        "/v1/tokens/create",
        "secret-read",
        serde_json::json!({ "database_id": "default", "name": "http-write", "scope": "write" }),
    ));
    assert_eq!(rejected.status_code, 403);
}

#[test]
fn http_owner_token_can_archive_and_restore_database() {
    install_test_service();
    sql_execute(sql_request(
        "default",
        "CREATE TABLE http_archive_smoke (body TEXT NOT NULL)",
    ))
    .expect("table should create");
    sql_execute(sql_request(
        "default",
        "INSERT INTO http_archive_smoke (body) VALUES ('archived')",
    ))
    .expect("row should insert");
    SERVICE.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-owner".to_string(),
                    scope: DatabaseTokenScope::Owner,
                },
                hash_api_token("secret-owner"),
                10,
            )
            .expect("owner token should create");
    });

    let begin = http_request_update(http_update_json(
        "/v1/archive/begin",
        "secret-owner",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(begin.status_code, 200);
    let size = json_body(&begin)["size_bytes"]
        .as_u64()
        .expect("archive size should be u64");
    assert!(size > 0);

    let chunk = http_request_update(http_update_json(
        "/v1/archive/read",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "offset": 0, "max_bytes": size }),
    ));
    assert_eq!(chunk.status_code, 200);
    let bytes = json_body(&chunk)["bytes"]
        .as_array()
        .expect("chunk bytes should be array")
        .iter()
        .map(|value| value.as_u64().expect("byte should be u64") as u8)
        .collect::<Vec<_>>();
    assert_eq!(bytes.len() as u64, size);
    let snapshot_hash = sha256_bytes(&bytes);

    let finalized_archive = http_request_update(http_update_json(
        "/v1/archive/finalize",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "snapshot_hash": snapshot_hash }),
    ));
    assert_eq!(finalized_archive.status_code, 200);

    let restore_begin = http_request_update(http_update_json(
        "/v1/restore/begin",
        "secret-owner",
        serde_json::json!({
            "database_id": "default",
            "snapshot_hash": sha256_bytes(&bytes),
            "size_bytes": size
        }),
    ));
    assert_eq!(restore_begin.status_code, 200);

    let write = http_request_update(http_update_json(
        "/v1/restore/write",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "offset": 0, "bytes": bytes }),
    ));
    assert_eq!(write.status_code, 200);

    let finalized_restore = http_request_update(http_update_json(
        "/v1/restore/finalize",
        "secret-owner",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(finalized_restore.status_code, 200);

    let response = sql_query(sql_request(
        "default",
        "SELECT body FROM http_archive_smoke",
    ))
    .expect("restored database should query");
    assert_eq!(response.rows[0][0], SqlValue::Text("archived".to_string()));
}

#[test]
fn http_owner_token_can_manage_database_members() {
    install_test_service();
    SERVICE.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-owner".to_string(),
                    scope: DatabaseTokenScope::Owner,
                },
                hash_api_token("secret-owner"),
                10,
            )
            .expect("owner token should create");
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-read".to_string(),
                    scope: DatabaseTokenScope::Read,
                },
                hash_api_token("secret-read"),
                11,
            )
            .expect("read token should create");
    });

    let rejected = http_request_update(http_update_json(
        "/v1/members/list",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(rejected.status_code, 403);

    let granted = http_request_update(http_update_json(
        "/v1/members/grant",
        "secret-owner",
        serde_json::json!({
            "database_id": "default",
            "principal": "aaaaa-aa",
            "role": "reader"
        }),
    ));
    assert_eq!(granted.status_code, 200);

    let listed = http_request_update(http_update_json(
        "/v1/members/list",
        "secret-owner",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(listed.status_code, 200);
    assert!(
        json_body(&listed)
            .as_array()
            .expect("members should be array")
            .iter()
            .any(|member| member["principal"] == "aaaaa-aa" && member["role"] == "reader")
    );

    let revoked = http_request_update(http_update_json(
        "/v1/members/revoke",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "principal": "aaaaa-aa" }),
    ));
    assert_eq!(revoked.status_code, 200);

    let grant_anonymous_reader = http_request_update(http_update_json(
        "/v1/members/grant",
        "secret-owner",
        serde_json::json!({
            "database_id": "default",
            "principal": "2vxsx-fae",
            "role": "reader"
        }),
    ));
    assert_eq!(grant_anonymous_reader.status_code, 400);
    assert!(
        json_body(&grant_anonymous_reader)["error"]
            .as_str()
            .expect("error should be text")
            .contains("anonymous principal")
    );

    let revoke_last_owner = http_request_update(http_update_json(
        "/v1/members/revoke",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "principal": "2vxsx-fae" }),
    ));
    assert_eq!(revoke_last_owner.status_code, 400);
    assert!(
        json_body(&revoke_last_owner)["error"]
            .as_str()
            .expect("error should be text")
            .contains("at least one owner principal")
    );

    let backup_owner = http_request_update(http_update_json(
        "/v1/members/grant",
        "secret-owner",
        serde_json::json!({
            "database_id": "default",
            "principal": "aaaaa-aa",
            "role": "owner"
        }),
    ));
    assert_eq!(backup_owner.status_code, 200);

    let revoke_original_owner = http_request_update(http_update_json(
        "/v1/members/revoke",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "principal": "2vxsx-fae" }),
    ));
    assert_eq!(revoke_original_owner.status_code, 200);

    let revoke_remaining_owner = http_request_update(http_update_json(
        "/v1/members/revoke",
        "secret-owner",
        serde_json::json!({ "database_id": "default", "principal": "aaaaa-aa" }),
    ));
    assert_eq!(revoke_remaining_owner.status_code, 400);
    assert!(
        json_body(&revoke_remaining_owner)["error"]
            .as_str()
            .expect("error should be text")
            .contains("at least one owner principal")
    );
}

#[test]
fn http_owner_token_can_delete_database() {
    install_test_service();
    SERVICE.with(|slot| {
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-owner".to_string(),
                    scope: DatabaseTokenScope::Owner,
                },
                hash_api_token("secret-owner"),
                10,
            )
            .expect("owner token should create");
        slot.borrow()
            .as_ref()
            .expect("service should be installed")
            .create_database_token(
                "2vxsx-fae",
                CreateDatabaseTokenRequest {
                    database_id: "default".to_string(),
                    name: "http-read".to_string(),
                    scope: DatabaseTokenScope::Read,
                },
                hash_api_token("secret-read"),
                11,
            )
            .expect("read token should create");
    });

    let rejected = http_request_update(http_update_json(
        "/v1/database/delete",
        "secret-read",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(rejected.status_code, 403);

    let deleted = http_request_update(http_update_json(
        "/v1/database/delete",
        "secret-owner",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(deleted.status_code, 200);

    let usage = http_request_update(http_update_json(
        "/v1/usage",
        "secret-owner",
        serde_json::json!({ "database_id": "default" }),
    ));
    assert_eq!(usage.status_code, 200);
    assert_eq!(json_body(&usage)["status"], "deleted");
}

#[test]
fn canister_create_database_returns_generated_id_for_followup_reads() {
    install_empty_test_service();
    set_test_caller_text(Some("aaaaa-aa"));

    let database_id = block_on_ready(create_database()).expect("database should create");
    assert!(database_id.starts_with("db_"));
    assert_eq!(database_id.len(), 15);

    let response =
        sql_query(sql_request(&database_id, "SELECT 1")).expect("generated database should query");
    assert_eq!(response.rows.len(), 1);
}

#[test]
fn sql_query_does_not_charge_billing_or_usage_event() {
    install_test_service();

    let before = get_billing("default".to_string()).expect("billing should load");
    let response = sql_query(sql_request("default", "SELECT 1")).expect("query should succeed");
    let after = get_billing("default".to_string()).expect("billing should load");

    assert_eq!(response.rows.len(), 1);
    assert_eq!(after.balance_units, before.balance_units);
    assert_eq!(after.spent_units, before.spent_units);
    assert_eq!(usage_event_count(), 0);
}

#[test]
fn grant_database_access_rejects_invalid_principal() {
    install_test_service();

    let error = grant_database_access(
        "default".to_string(),
        "not a principal".to_string(),
        DatabaseRole::Reader,
    )
    .expect_err("invalid principal should fail");

    assert!(error.contains("invalid principal"));
}

#[test]
fn revoke_database_access_validates_and_canonicalizes_principal() {
    install_test_service();

    let invalid = revoke_database_access("default".to_string(), "not a principal".to_string())
        .expect_err("invalid principal should fail");
    assert!(invalid.contains("invalid principal"));

    grant_database_access(
        "default".to_string(),
        "aaaaa-aa".to_string(),
        DatabaseRole::Reader,
    )
    .expect("valid principal should grant");
    revoke_database_access("default".to_string(), "aaaaa-aa".to_string())
        .expect("valid principal should revoke");
}

#[test]
fn anonymous_reader_grant_is_rejected() {
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = test_service_for_root(&root);
    service
        .run_index_migrations()
        .expect("index migrations should run");
    service
        .create_database("public", "owner", 1)
        .expect("database should create");
    let error = service
        .grant_database_access("public", "owner", "2vxsx-fae", DatabaseRole::Reader, 2)
        .expect_err("anonymous reader should fail");
    assert!(error.contains("anonymous principal"));
    SERVICE.with(|slot| *slot.borrow_mut() = Some(service));

    let query_error = sql_query(sql_request("public", "SELECT 1"))
        .expect_err("anonymous query should fail role check");
    assert!(query_error.contains("no access"));
}

#[test]
fn database_archive_entrypoints_export_bytes_and_block_normal_reads() {
    install_test_service();

    sql_execute(sql_request(
        "default",
        "CREATE TABLE archive_smoke (id INTEGER PRIMARY KEY, body TEXT)",
    ))
    .expect("table create should succeed");
    sql_execute(sql_request(
        "default",
        "INSERT INTO archive_smoke (body) VALUES ('alpha')",
    ))
    .expect("insert should succeed");

    let archive = begin_database_archive("default".to_string()).expect("archive should begin");
    assert!(archive.size_bytes > 0);
    let mut offset = 0_u64;
    let mut bytes = Vec::new();
    while offset < archive.size_bytes {
        let chunk = read_database_archive_chunk("default".to_string(), offset, 17)
            .expect("archive chunk should read")
            .bytes;
        assert!(!chunk.is_empty());
        offset += chunk.len() as u64;
        bytes.extend(chunk);
    }
    assert_eq!(bytes.len() as u64, archive.size_bytes);

    let snapshot_hash = sha256_bytes(&bytes);
    finalize_database_archive("default".to_string(), snapshot_hash.clone())
        .expect("archive should finalize");
    assert!(
        sql_query(sql_request("default", "SELECT body FROM archive_smoke"))
            .expect_err("archived DB should reject normal reads")
            .contains("database is archived")
    );

    let info = list_databases()
        .expect("database summaries should load")
        .into_iter()
        .find(|info| info.database_id == "default")
        .expect("default info should exist");
    assert_eq!(info.status, DatabaseStatus::Archived);
    assert_eq!(info.role, DatabaseRole::Owner);
}

#[test]
fn begin_database_restore_rolls_back_when_mount_fails() {
    install_test_service();
    sql_execute(sql_request(
        "default",
        "CREATE TABLE restore_smoke (id INTEGER)",
    ))
    .expect("table create should succeed");

    let archive = begin_database_archive("default".to_string()).expect("archive should begin");
    let bytes = read_database_archive_chunk("default".to_string(), 0, archive.size_bytes as u32)
        .expect("archive chunk should read")
        .bytes;
    let snapshot_hash = sha256_bytes(&bytes);
    finalize_database_archive("default".to_string(), snapshot_hash.clone())
        .expect("archive should finalize");

    fail_next_mount_database_file_for_test();
    let error = begin_database_restore(
        "default".to_string(),
        snapshot_hash.clone(),
        archive.size_bytes,
    )
    .expect_err("mount failure should fail restore begin");
    assert!(error.contains("test mount failure"));
    let rolled_back = list_databases()
        .expect("database summaries should load")
        .into_iter()
        .find(|info| info.database_id == "default")
        .expect("default info should exist");
    assert_eq!(rolled_back.status, DatabaseStatus::Archived);
    assert_eq!(rolled_back.role, DatabaseRole::Owner);

    begin_database_restore("default".to_string(), snapshot_hash, archive.size_bytes)
        .expect("restore begin should retry after rollback");
    let restoring = list_databases()
        .expect("database summaries should load")
        .into_iter()
        .find(|info| info.database_id == "default")
        .expect("default info should exist");
    assert_eq!(restoring.status, DatabaseStatus::Restoring);
    assert_eq!(restoring.role, DatabaseRole::Owner);
}

#[test]
fn finalize_database_restore_keeps_restoring_when_mount_fails() {
    install_test_service();
    sql_execute(sql_request(
        "default",
        "CREATE TABLE restore_finalize_smoke (id INTEGER)",
    ))
    .expect("table create should succeed");
    let archive = begin_database_archive("default".to_string()).expect("archive should begin");
    let bytes = read_database_archive_chunk("default".to_string(), 0, archive.size_bytes as u32)
        .expect("archive chunk should read")
        .bytes;
    let snapshot_hash = sha256_bytes(&bytes);
    finalize_database_archive("default".to_string(), snapshot_hash.clone())
        .expect("archive should finalize");
    begin_database_restore("default".to_string(), snapshot_hash, archive.size_bytes)
        .expect("restore begin should succeed");
    write_database_restore_chunk(DatabaseRestoreChunkRequest {
        database_id: "default".to_string(),
        offset: 0,
        bytes,
    })
    .expect("restore chunk should write");

    fail_next_mount_database_file_for_test();
    let error = finalize_database_restore("default".to_string())
        .expect_err("mount failure should fail finalize");
    assert!(error.contains("test mount failure"));
    let info = list_databases()
        .expect("database summaries should load")
        .into_iter()
        .find(|info| info.database_id == "default")
        .expect("default info should exist");
    assert_eq!(info.status, DatabaseStatus::Restoring);
}

#[test]
fn cancel_database_archive_entrypoint_returns_database_to_hot() {
    install_test_service();
    sql_execute(sql_request(
        "default",
        "CREATE TABLE cancel_smoke (id INTEGER)",
    ))
    .expect("table create should succeed");

    begin_database_archive("default".to_string()).expect("archive should begin");
    assert!(
        sql_execute(sql_request(
            "default",
            "INSERT INTO cancel_smoke (id) VALUES (1)"
        ))
        .expect_err("archiving DB should reject writes")
        .contains("database is archiving")
    );

    cancel_database_archive("default".to_string()).expect("archive cancel should succeed");
    sql_execute(sql_request(
        "default",
        "INSERT INTO cancel_smoke (id) VALUES (1)",
    ))
    .expect("write should succeed after cancel");
    let info = list_databases()
        .expect("database summaries should load")
        .into_iter()
        .find(|info| info.database_id == "default")
        .expect("default info should exist");
    assert_eq!(info.status, DatabaseStatus::Hot);
    assert_eq!(info.role, DatabaseRole::Owner);
}

#[test]
fn cancel_database_archive_entrypoint_rejects_non_owner() {
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = test_service_for_root(&root);
    service
        .run_index_migrations()
        .expect("index migrations should run");
    service
        .create_database("default", "owner", 1_700_000_000_000)
        .expect("default database should create");
    service
        .begin_database_archive("default", "owner", 1_700_000_000_001)
        .expect("archive should begin");
    SERVICE.with(|slot| *slot.borrow_mut() = Some(service));

    assert!(
        cancel_database_archive("default".to_string())
            .expect_err("non-owner cancel should fail")
            .contains("principal has no access")
    );
}
