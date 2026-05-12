// Where: crates/vfs_canister/src/tests.rs
// What: Entry-point level tests for the ICPDB canister surface.
// Why: SQL hosting, billing, deposit, and lifecycle wrappers need direct coverage.
use std::future::Future;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};

use candid::Nat;
use icrc_ledger_types::icrc2::transfer_from::TransferFromError;
use sha2::{Digest, Sha256};
use tempfile::tempdir;
use vfs_runtime::VfsService;
use vfs_types::{
    DatabaseBalanceTopUpRequest, DatabaseBillingStatus, DatabaseRole, DatabaseStatus,
    SqlExecuteRequest,
};

use super::{
    PENDING_DEPOSITS, SERVICE, acquire_deposit_guard_for_test, begin_database_archive,
    begin_database_restore, cancel_database_archive, clear_test_icp_transfer_from, create_database,
    deposit_with_approval, describe_transfer_from_error, fail_next_mount_database_file_for_test,
    finalize_database_archive, get_billing, get_deposit_quote, grant_database_access,
    list_databases, list_payments, read_database_archive_chunk, revoke_database_access,
    set_test_caller_is_controller, set_test_caller_text, set_test_icp_transfer_from, sql_execute,
    sql_query, top_up_database_balance,
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

fn install_test_service() {
    set_test_caller_text(None);
    set_test_caller_is_controller(false);
    clear_test_icp_transfer_from();
    PENDING_DEPOSITS.with(|pending| pending.borrow_mut().clear());
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = VfsService::new(root.join("index.sqlite3"), root.join("databases"));
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
    let service = VfsService::new(root.join("index.sqlite3"), root.join("databases"));
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

fn sql_request(database_id: &str, sql: &str) -> SqlExecuteRequest {
    SqlExecuteRequest {
        database_id: database_id.to_string(),
        sql: sql.to_string(),
        params: Vec::new(),
        max_rows: None,
    }
}

#[test]
fn empty_index_does_not_create_default_database() {
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = VfsService::new(root.join("index.sqlite3"), root.join("databases"));
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
    let service = VfsService::new(root.join("index.sqlite3"), root.join("databases"));
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

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].database_id, "default");
    assert_eq!(summaries[0].role, DatabaseRole::Owner);
    assert_eq!(summaries[0].status, DatabaseStatus::Hot);
}

#[test]
fn update_entrypoints_record_usage_events() {
    install_empty_test_service();

    let database_id = create_database().expect("database should create");
    assert_eq!(usage_event_count(), 1);

    let failed = sql_execute(sql_request(&database_id, ""));
    assert!(failed.is_err());
    assert_eq!(usage_event_count(), 2);
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
fn canister_create_database_returns_generated_id_for_followup_reads() {
    install_empty_test_service();

    let database_id = create_database().expect("database should create");
    assert!(database_id.starts_with("db_"));
    assert_eq!(database_id.len(), 15);

    let response =
        sql_query(sql_request(&database_id, "SELECT 1")).expect("generated database should query");
    assert_eq!(response.rows.len(), 1);
}

#[test]
fn sql_query_charges_billing_without_usage_event() {
    install_test_service();

    let before = get_billing("default".to_string()).expect("billing should load");
    let response = sql_query(sql_request("default", "SELECT 1")).expect("query should succeed");
    let after = get_billing("default".to_string()).expect("billing should load");

    assert_eq!(response.rows.len(), 1);
    assert_eq!(after.spent_units, before.spent_units + 1);
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
fn anonymous_reader_grant_allows_public_query() {
    let dir = tempdir().expect("tempdir should create");
    let root = dir.keep();
    let service = VfsService::new(root.join("index.sqlite3"), root.join("databases"));
    service
        .run_index_migrations()
        .expect("index migrations should run");
    service
        .create_database("public", "owner", 1)
        .expect("database should create");
    service
        .grant_database_access("public", "owner", "2vxsx-fae", DatabaseRole::Reader, 2)
        .expect("anonymous reader should grant");
    SERVICE.with(|slot| *slot.borrow_mut() = Some(service));

    let response = sql_query(sql_request("public", "SELECT 1"))
        .expect("anonymous reader query should pass role check");

    assert_eq!(response.rows.len(), 1);
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
    let service = VfsService::new(root.join("index.sqlite3"), root.join("databases"));
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
