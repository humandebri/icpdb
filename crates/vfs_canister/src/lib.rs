// Where: crates/vfs_canister/src/lib.rs
// What: ICP canister entrypoints backed by VfsService with an FS-first public API.
// Why: The canister now exposes node-oriented operations directly and keeps the runtime boundary thin.
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::fs::create_dir_all;
use std::ops::Range;
#[cfg(not(test))]
use std::path::Path;
use std::path::PathBuf;

use candid::{CandidType, Deserialize, Nat, Principal, export_service};
use ic_cdk::call::Call;
use ic_cdk::{init, post_upgrade, query, update};
use ic_stable_structures::DefaultMemoryImpl;
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager};
#[cfg(not(test))]
use icrc_ledger_types::icrc1::account::Account;
#[cfg(not(test))]
use icrc_ledger_types::icrc2::transfer_from::TransferFromArgs;
use icrc_ledger_types::icrc2::transfer_from::TransferFromError;
use serde_json::json;
use sha2::{Digest, Sha256};
use vfs_runtime::{DatabaseMeta, UsageEvent, VfsService, hash_api_token};
use vfs_types::{
    AppendNodeRequest, CanisterHealth, CanonicalRole, ChildNode, CreateDatabaseTokenRequest,
    CreateDatabaseTokenResponse, DatabaseArchiveChunk, DatabaseArchiveInfo,
    DatabaseBalanceTopUpRequest, DatabaseBilling, DatabaseMember, DatabaseQuotaRequest,
    DatabaseRestoreChunkRequest, DatabaseRole, DatabaseSummary, DatabaseTokenInfo, DatabaseUsage,
    DeleteNodeRequest, DeleteNodeResult, DepositQuote, DepositResult, EditNodeRequest,
    EditNodeResult, ExportSnapshotRequest, ExportSnapshotResponse, FetchUpdatesRequest,
    FetchUpdatesResponse, GlobNodeHit, GlobNodesRequest, GraphLinksRequest,
    GraphNeighborhoodRequest, IncomingLinksRequest, LinkEdge, ListChildrenRequest,
    ListNodesRequest, MemoryCapability, MemoryManifest, MemoryRoot, MkdirNodeRequest,
    MkdirNodeResult, MoveNodeRequest, MoveNodeResult, MultiEditNodeRequest, MultiEditNodeResult,
    Node, NodeContext, NodeContextRequest, NodeEntry, OutgoingLinksRequest, PaymentRecord,
    QueryContext, QueryContextRequest, RecentNodeHit, RecentNodesRequest, SearchNodeHit,
    SearchNodePathsRequest, SearchNodesRequest, SourceEvidence, SourceEvidenceRequest,
    SqlBatchRequest, SqlExecuteRequest, SqlExecuteResponse, Status, WriteNodeRequest,
    WriteNodeResult,
};

const INDEX_DB_PATH: &str = "./DB/index.sqlite3";
const DATABASES_DIR: &str = "./DB/databases";
// WASI filesystem memory is for tmp files and directory metadata, not DB slots.
// SQLite DB files are mounted separately with dedicated MemoryId values.
const WASI_FS_MEMORY_RANGE: Range<u16> = 0..10;
const INDEX_DB_MEMORY_ID: u16 = 10;
const HTTP_JSON_CONTENT_TYPE: &str = "application/json";
const API_TOKEN_PREFIX: &str = "icpdb_";
const ICP_LEDGER_CANISTER_ID: &str = "ryjl3-tyaaa-aaaaa-aaaba-cai";

type HeaderField = (String, String);

#[derive(Clone, Debug, CandidType, Deserialize)]
struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<HeaderField>,
    body: Vec<u8>,
    certificate_version: Option<u16>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct HttpUpdateRequest {
    method: String,
    url: String,
    headers: Vec<HeaderField>,
    body: Vec<u8>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct HttpResponse {
    status_code: u16,
    headers: Vec<HeaderField>,
    body: Vec<u8>,
    upgrade: Option<bool>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct HttpUpdateResponse {
    status_code: u16,
    headers: Vec<HeaderField>,
    body: Vec<u8>,
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static SERVICE: RefCell<Option<VfsService>> = const { RefCell::new(None) };
    static PENDING_DEPOSITS: RefCell<BTreeSet<String>> = const { RefCell::new(BTreeSet::new()) };
}

struct DepositGuard {
    key: String,
}

impl DepositGuard {
    fn new(payer: &Principal, database_id: &str) -> Result<Self, String> {
        let key = format!("{}:{database_id}", payer.to_text());
        PENDING_DEPOSITS.with(|pending| {
            if !pending.borrow_mut().insert(key.clone()) {
                return Err("deposit already in progress".to_string());
            }
            Ok(Self { key })
        })
    }
}

impl Drop for DepositGuard {
    fn drop(&mut self) {
        PENDING_DEPOSITS.with(|pending| {
            pending.borrow_mut().remove(&self.key);
        });
    }
}

#[init]
fn init_hook() {
    initialize_or_trap();
}

#[post_upgrade]
fn post_upgrade_hook() {
    initialize_or_trap();
}

#[query]
fn status(database_id: String) -> Status {
    with_service(|service| service.status(&database_id, &caller_text()))
        .unwrap_or_else(|error| ic_cdk::trap(&error))
}

#[query]
fn canister_health() -> CanisterHealth {
    CanisterHealth {
        cycles_balance: ic_cdk::api::canister_cycle_balance(),
    }
}

#[query]
fn memory_manifest() -> MemoryManifest {
    MemoryManifest {
        api_version: "agent-memory-v1".to_string(),
        purpose: "Canister-backed long-term wiki memory for agents".to_string(),
        roots: vec![
            MemoryRoot {
                path: "/Wiki".to_string(),
                kind: "wiki".to_string(),
            },
            MemoryRoot {
                path: "/Sources".to_string(),
                kind: "raw_sources".to_string(),
            },
        ],
        capabilities: memory_capabilities(),
        canonical_roles: canonical_roles(),
        write_policy: "agent_memory_read_only".to_string(),
        recommended_entrypoint: "query_context".to_string(),
        max_depth: 2,
        max_query_limit: 100,
        budget_unit: "approx_chars_from_tokens".to_string(),
    }
}

#[query]
fn read_node(database_id: String, path: String) -> Result<Option<Node>, String> {
    with_service(|service| service.read_node(&database_id, &caller_text(), &path))
}

#[query]
fn list_nodes(request: ListNodesRequest) -> Result<Vec<NodeEntry>, String> {
    with_service(|service| service.list_nodes(&caller_text(), request))
}

#[query]
fn list_children(request: ListChildrenRequest) -> Result<Vec<ChildNode>, String> {
    with_service(|service| service.list_children(&caller_text(), request))
}

#[update]
fn create_database() -> Result<String, String> {
    with_usage("create_database", None, |service, caller, now| {
        let meta = service.reserve_generated_database(caller, now)?;
        if let Err(error) = mount_database_file(&meta) {
            let cleanup_error = service
                .discard_database_reservation(&meta.database_id)
                .err();
            return Err(database_create_error(error, cleanup_error));
        }
        if let Err(error) = service.run_database_migrations(&meta.database_id) {
            unmount_database_file(&meta.db_file_name);
            let cleanup_error = service
                .discard_database_reservation(&meta.database_id)
                .err();
            return Err(database_create_error(error, cleanup_error));
        }
        Ok(meta.database_id)
    })
}

#[update]
fn grant_database_access(
    database_id: String,
    principal: String,
    role: DatabaseRole,
) -> Result<(), String> {
    with_usage(
        "grant_database_access",
        Some(database_id.clone()),
        |service, caller, now| {
            let principal = Principal::from_text(&principal)
                .map_err(|error| format!("invalid principal: {error}"))?
                .to_text();
            service.grant_database_access(&database_id, caller, &principal, role, now)
        },
    )
}

#[update]
fn revoke_database_access(database_id: String, principal: String) -> Result<(), String> {
    with_usage(
        "revoke_database_access",
        Some(database_id.clone()),
        |service, caller, _now| {
            let principal = Principal::from_text(&principal)
                .map_err(|error| format!("invalid principal: {error}"))?
                .to_text();
            service.revoke_database_access(&database_id, caller, &principal)
        },
    )
}

#[query]
fn list_database_members(database_id: String) -> Result<Vec<DatabaseMember>, String> {
    with_service(|service| service.list_database_members(&database_id, &caller_text()))
}

#[query]
fn list_databases() -> Result<Vec<DatabaseSummary>, String> {
    with_service(|service| service.list_database_summaries_for_caller(&caller_text()))
}

#[query]
fn get_usage(database_id: String) -> Result<DatabaseUsage, String> {
    with_service(|service| service.database_usage(&database_id, &caller_text()))
}

#[update]
fn set_database_quota(request: DatabaseQuotaRequest) -> Result<DatabaseUsage, String> {
    let database_id = request.database_id.clone();
    with_usage(
        "set_database_quota",
        Some(database_id),
        |service, caller, _now| service.set_database_quota(caller, request),
    )
}

#[query]
fn get_billing(database_id: String) -> Result<DatabaseBilling, String> {
    with_service(|service| service.database_billing(&database_id, &caller_text()))
}

#[update]
fn top_up_database_balance(
    request: DatabaseBalanceTopUpRequest,
) -> Result<DatabaseBilling, String> {
    require_controller()?;
    let database_id = request.database_id.clone();
    with_usage(
        "top_up_database_balance",
        Some(database_id),
        |service, _caller, _now| service.top_up_database_balance(request),
    )
}

#[update]
async fn get_deposit_quote(database_id: String, amount_e8s: u64) -> Result<DepositQuote, String> {
    let spender_principal = canister_principal().to_text();
    with_usage(
        "get_deposit_quote",
        Some(database_id.clone()),
        |service, caller, _now| {
            service.deposit_quote(
                &database_id,
                caller,
                amount_e8s,
                ICP_LEDGER_CANISTER_ID,
                &spender_principal,
            )
        },
    )
}

#[update]
async fn deposit_with_approval(
    database_id: String,
    amount_e8s: u64,
) -> Result<DepositResult, String> {
    let payer = caller_principal();
    let _deposit_guard = DepositGuard::new(&payer, &database_id)?;
    let payer_text = payer.to_text();
    let canister = canister_principal();
    let quote = with_service(|service| {
        service.deposit_quote(
            &database_id,
            &payer_text,
            amount_e8s,
            ICP_LEDGER_CANISTER_ID,
            &canister.to_text(),
        )
    })?;
    let expected_fee_e8s = quote.expected_fee_e8s;

    match icp_transfer_from(payer, canister, amount_e8s, expected_fee_e8s, now_nanos()).await {
        Ok(block_index) => with_usage(
            "deposit_with_approval",
            Some(database_id.clone()),
            |service, _caller, now| {
                service.record_approved_deposit(
                    &database_id,
                    &payer_text,
                    amount_e8s,
                    ICP_LEDGER_CANISTER_ID,
                    block_index,
                    now,
                )
            },
        ),
        Err(TransferFromError::BadFee { expected_fee }) => {
            let expected_fee_e8s = nat_to_u64(&expected_fee)?;
            let result: Result<DepositResult, String> = with_usage(
                "deposit_with_approval",
                Some(database_id.clone()),
                |service, _caller, now| {
                    service.update_icp_transfer_fee_from_bad_fee(expected_fee_e8s, now)?;
                    Err(format!(
                        "fee更新済み。再quoteしてapprove額を更新: expected_fee_e8s={expected_fee_e8s}"
                    ))
                },
            );
            result
        }
        Err(TransferFromError::Duplicate { duplicate_of }) => {
            let block_index = nat_to_u64(&duplicate_of)?;
            with_usage(
                "deposit_with_approval",
                Some(database_id.clone()),
                |service, _caller, _now| {
                    service
                        .deposit_result_for_existing_payment(&database_id, &payer_text, block_index)
                        .map_err(|_| {
                            format!(
                                "duplicate ICP ledger block is not recorded; operator verification required: {block_index}"
                            )
                        })
                },
            )
        }
        Err(error) => Err(describe_transfer_from_error(&error)),
    }
}

#[query]
fn list_payments(database_id: String) -> Result<Vec<PaymentRecord>, String> {
    with_service(|service| service.list_payments(&database_id, &caller_text()))
}

#[update]
async fn create_database_token(
    request: CreateDatabaseTokenRequest,
) -> Result<CreateDatabaseTokenResponse, String> {
    let database_id = request.database_id.clone();
    let token = random_api_token().await?;
    let token_hash = hash_api_token(&token);
    let info = with_usage(
        "create_database_token",
        Some(database_id),
        |service, caller, now| service.create_database_token(caller, request, token_hash, now),
    )?;
    Ok(CreateDatabaseTokenResponse { token, info })
}

#[query]
fn list_database_tokens(database_id: String) -> Result<Vec<DatabaseTokenInfo>, String> {
    with_service(|service| service.list_database_tokens(&database_id, &caller_text()))
}

#[update]
fn revoke_database_token(
    database_id: String,
    token_id: String,
) -> Result<DatabaseTokenInfo, String> {
    with_usage(
        "revoke_database_token",
        Some(database_id.clone()),
        |service, caller, now| service.revoke_database_token(&database_id, &token_id, caller, now),
    )
}

#[update]
fn delete_database(database_id: String) -> Result<(), String> {
    with_usage(
        "delete_database",
        Some(database_id.clone()),
        |service, caller, now| {
            let meta = service.list_databases().and_then(|databases| {
                databases
                    .into_iter()
                    .find(|meta| meta.database_id == database_id)
                    .ok_or_else(|| format!("database not found: {database_id}"))
            })?;
            service.delete_database(&database_id, caller, now)?;
            unmount_database_file(&meta.db_file_name);
            Ok(())
        },
    )
}

#[update]
fn begin_database_archive(database_id: String) -> Result<DatabaseArchiveInfo, String> {
    with_usage(
        "begin_database_archive",
        Some(database_id.clone()),
        |service, caller, now| service.begin_database_archive(&database_id, caller, now),
    )
}

#[query]
fn read_database_archive_chunk(
    database_id: String,
    offset: u64,
    max_bytes: u32,
) -> Result<DatabaseArchiveChunk, String> {
    with_service(|service| {
        service
            .read_database_archive_chunk(&database_id, &caller_text(), offset, max_bytes)
            .map(|bytes| DatabaseArchiveChunk { bytes })
    })
}

#[update]
fn finalize_database_archive(database_id: String, snapshot_hash: Vec<u8>) -> Result<(), String> {
    with_usage(
        "finalize_database_archive",
        Some(database_id.clone()),
        |service, caller, now| {
            let meta =
                service.finalize_database_archive(&database_id, caller, snapshot_hash, now)?;
            unmount_database_file(&meta.db_file_name);
            Ok(())
        },
    )
}

#[update]
fn cancel_database_archive(database_id: String) -> Result<(), String> {
    with_usage(
        "cancel_database_archive",
        Some(database_id.clone()),
        |service, caller, now| {
            service.cancel_database_archive(&database_id, caller, now)?;
            Ok(())
        },
    )
}

#[update]
fn begin_database_restore(
    database_id: String,
    snapshot_hash: Vec<u8>,
    size_bytes: u64,
) -> Result<(), String> {
    with_usage(
        "begin_database_restore",
        Some(database_id.clone()),
        |service, caller, now| {
            let restore = service.begin_database_restore_session(
                &database_id,
                caller,
                snapshot_hash,
                size_bytes,
                now,
            )?;
            if let Err(error) = mount_database_file(&restore.meta) {
                service
                    .rollback_database_restore_begin(restore.rollback, now)
                    .map_err(|rollback_error| {
                        format!("{error}; restore rollback failed: {rollback_error}")
                    })?;
                return Err(error);
            }
            Ok(())
        },
    )
}

#[update]
fn write_database_restore_chunk(request: DatabaseRestoreChunkRequest) -> Result<(), String> {
    let database_id = request.database_id.clone();
    with_usage(
        "write_database_restore_chunk",
        Some(database_id),
        |service, caller, _now| {
            service.write_database_restore_chunk(
                &request.database_id,
                caller,
                request.offset,
                &request.bytes,
            )
        },
    )
}

#[update]
fn finalize_database_restore(database_id: String) -> Result<(), String> {
    with_usage(
        "finalize_database_restore",
        Some(database_id.clone()),
        |service, caller, now| {
            let meta = service.finalize_database_restore(&database_id, caller, now)?;
            mount_database_file(&meta)
        },
    )
}

#[update]
fn write_node(request: WriteNodeRequest) -> Result<WriteNodeResult, String> {
    let database_id = request.database_id.clone();
    with_usage("write_node", Some(database_id), |service, caller, now| {
        service.write_node(caller, request, now)
    })
}

#[update]
fn append_node(request: AppendNodeRequest) -> Result<WriteNodeResult, String> {
    let database_id = request.database_id.clone();
    with_usage("append_node", Some(database_id), |service, caller, now| {
        service.append_node(caller, request, now)
    })
}

#[update]
fn edit_node(request: EditNodeRequest) -> Result<EditNodeResult, String> {
    let database_id = request.database_id.clone();
    with_usage("edit_node", Some(database_id), |service, caller, now| {
        service.edit_node(caller, request, now)
    })
}

#[update]
fn delete_node(request: DeleteNodeRequest) -> Result<DeleteNodeResult, String> {
    let database_id = request.database_id.clone();
    with_usage("delete_node", Some(database_id), |service, caller, now| {
        service.delete_node(caller, request, now)
    })
}

#[update]
fn move_node(request: MoveNodeRequest) -> Result<MoveNodeResult, String> {
    let database_id = request.database_id.clone();
    with_usage("move_node", Some(database_id), |service, caller, now| {
        service.move_node(caller, request, now)
    })
}

#[update]
fn mkdir_node(request: MkdirNodeRequest) -> Result<MkdirNodeResult, String> {
    let database_id = request.database_id.clone();
    with_usage("mkdir_node", Some(database_id), |service, caller, _now| {
        service.mkdir_node(caller, request)
    })
}

#[query]
fn glob_nodes(request: GlobNodesRequest) -> Result<Vec<GlobNodeHit>, String> {
    with_service(|service| service.glob_nodes(&caller_text(), request))
}

#[query]
fn recent_nodes(request: RecentNodesRequest) -> Result<Vec<RecentNodeHit>, String> {
    with_service(|service| service.recent_nodes(&caller_text(), request))
}

#[query]
fn incoming_links(request: IncomingLinksRequest) -> Result<Vec<LinkEdge>, String> {
    with_service(|service| service.incoming_links(&caller_text(), request))
}

#[query]
fn outgoing_links(request: OutgoingLinksRequest) -> Result<Vec<LinkEdge>, String> {
    with_service(|service| service.outgoing_links(&caller_text(), request))
}

#[query]
fn graph_links(request: GraphLinksRequest) -> Result<Vec<LinkEdge>, String> {
    with_service(|service| service.graph_links(&caller_text(), request))
}

#[query]
fn graph_neighborhood(request: GraphNeighborhoodRequest) -> Result<Vec<LinkEdge>, String> {
    with_service(|service| service.graph_neighborhood(&caller_text(), request))
}

#[query]
fn read_node_context(request: NodeContextRequest) -> Result<Option<NodeContext>, String> {
    with_service(|service| service.read_node_context(&caller_text(), request))
}

#[query]
fn query_context(request: QueryContextRequest) -> Result<QueryContext, String> {
    with_service(|service| service.query_context(&caller_text(), request))
}

#[query]
fn source_evidence(request: SourceEvidenceRequest) -> Result<SourceEvidence, String> {
    with_service(|service| service.source_evidence(&caller_text(), request))
}

#[update]
fn multi_edit_node(request: MultiEditNodeRequest) -> Result<MultiEditNodeResult, String> {
    let database_id = request.database_id.clone();
    with_usage(
        "multi_edit_node",
        Some(database_id),
        |service, caller, now| service.multi_edit_node(caller, request, now),
    )
}

#[query]
fn search_nodes(request: SearchNodesRequest) -> Result<Vec<SearchNodeHit>, String> {
    with_service(|service| service.search_nodes(&caller_text(), request))
}

#[query]
fn search_node_paths(request: SearchNodePathsRequest) -> Result<Vec<SearchNodeHit>, String> {
    with_service(|service| service.search_node_paths(&caller_text(), request))
}

#[query]
fn export_snapshot(request: ExportSnapshotRequest) -> Result<ExportSnapshotResponse, String> {
    with_service(|service| service.export_fs_snapshot(&caller_text(), request))
}

#[query]
fn fetch_updates(request: FetchUpdatesRequest) -> Result<FetchUpdatesResponse, String> {
    with_service(|service| service.fetch_fs_updates(&caller_text(), request))
}

#[query]
fn sql_query(request: SqlExecuteRequest) -> Result<SqlExecuteResponse, String> {
    with_service(|service| service.sql_query(&caller_text(), request))
}

#[update]
fn sql_execute(request: SqlExecuteRequest) -> Result<SqlExecuteResponse, String> {
    let database_id = request.database_id.clone();
    with_usage("sql_execute", Some(database_id), |service, caller, _now| {
        service.sql_execute(caller, request)
    })
}

#[update]
fn sql_batch(request: SqlBatchRequest) -> Result<Vec<SqlExecuteResponse>, String> {
    let database_id = request.database_id.clone();
    with_usage("sql_batch", Some(database_id), |service, caller, _now| {
        service.sql_batch(caller, request)
    })
}

#[query]
fn http_request(_request: HttpRequest) -> HttpResponse {
    HttpResponse {
        status_code: 200,
        headers: json_headers(),
        body: Vec::new(),
        upgrade: Some(true),
    }
}

#[update]
fn http_request_update(request: HttpUpdateRequest) -> HttpUpdateResponse {
    match handle_http_json(request) {
        Ok(response) => response,
        Err((status_code, message)) => json_response(status_code, json!({ "error": message })),
    }
}

fn initialize_or_trap() {
    initialize_service().unwrap_or_else(|error| ic_cdk::trap(&error));
}

fn initialize_service() -> Result<(), String> {
    initialize_wasi_storage()?;
    let service = VfsService::new(PathBuf::from(INDEX_DB_PATH), PathBuf::from(DATABASES_DIR));
    service.run_index_migrations()?;
    for meta in service.list_databases()? {
        mount_database_file(&meta)?;
    }
    SERVICE.with(|slot| *slot.borrow_mut() = Some(service));
    Ok(())
}

fn initialize_wasi_storage() -> Result<(), String> {
    MEMORY_MANAGER.with(|manager| {
        let manager = manager.borrow();
        ic_wasi_polyfill::init_with_memory_manager(
            &[0u8; 32],
            &[("SQLITE_TMPDIR", "tmp")],
            &manager,
            WASI_FS_MEMORY_RANGE.clone(),
        );

        create_dir_all("tmp").map_err(|error| error.to_string())?;
        create_dir_all(DATABASES_DIR).map_err(|error| error.to_string())?;

        ic_wasi_polyfill::unmount_memory_file(INDEX_DB_PATH);
        let memory = manager.get(MemoryId::new(INDEX_DB_MEMORY_ID));
        let mount_result = ic_wasi_polyfill::mount_memory_file(
            INDEX_DB_PATH,
            Box::new(memory),
            ic_wasi_polyfill::MountedFileSizePolicy::MemoryPages,
        );
        if mount_result > 0 {
            return Err(format!(
                "failed to mount index database file: {mount_result}"
            ));
        }
        Ok(())
    })
}

#[cfg(not(test))]
fn mount_database_file(meta: &DatabaseMeta) -> Result<(), String> {
    MEMORY_MANAGER.with(|manager| {
        let manager = manager.borrow();
        if let Some(parent) = Path::new(&meta.db_file_name).parent() {
            create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        ic_wasi_polyfill::unmount_memory_file(&meta.db_file_name);
        let memory = manager.get(MemoryId::new(meta.mount_id));
        let mount_result = ic_wasi_polyfill::mount_memory_file(
            &meta.db_file_name,
            Box::new(memory),
            ic_wasi_polyfill::MountedFileSizePolicy::MemoryPages,
        );
        if mount_result > 0 {
            return Err(format!(
                "failed to mount database file {}: {}",
                meta.database_id, mount_result
            ));
        }
        Ok(())
    })
}

#[cfg(test)]
fn mount_database_file(_meta: &DatabaseMeta) -> Result<(), String> {
    if TEST_MOUNT_DATABASE_FILE_FAIL_ONCE.with(|flag| flag.replace(false)) {
        return Err("test mount failure".to_string());
    }
    Ok(())
}

#[cfg(not(test))]
fn unmount_database_file(db_file_name: &str) {
    ic_wasi_polyfill::unmount_memory_file(db_file_name);
}

#[cfg(test)]
fn unmount_database_file(_db_file_name: &str) {}

#[cfg(test)]
thread_local! {
    static TEST_MOUNT_DATABASE_FILE_FAIL_ONCE: RefCell<bool> = const { RefCell::new(false) };
    static TEST_ICP_TRANSFER_FROM: RefCell<Option<Result<u64, TransferFromError>>> = const { RefCell::new(None) };
    static TEST_CALLER_IS_CONTROLLER: RefCell<bool> = const { RefCell::new(false) };
    static TEST_CALLER_TEXT: RefCell<Option<String>> = const { RefCell::new(None) };
}

#[cfg(test)]
fn fail_next_mount_database_file_for_test() {
    TEST_MOUNT_DATABASE_FILE_FAIL_ONCE.with(|flag| flag.replace(true));
}

#[cfg(test)]
fn set_test_icp_transfer_from(result: Result<u64, TransferFromError>) {
    TEST_ICP_TRANSFER_FROM.with(|transfer| transfer.replace(Some(result)));
}

#[cfg(test)]
fn clear_test_icp_transfer_from() {
    TEST_ICP_TRANSFER_FROM.with(|transfer| transfer.replace(None));
}

#[cfg(test)]
fn acquire_deposit_guard_for_test(
    payer_text: &str,
    database_id: &str,
) -> Result<DepositGuard, String> {
    let payer = Principal::from_text(payer_text).map_err(|error| error.to_string())?;
    DepositGuard::new(&payer, database_id)
}

#[cfg(test)]
fn set_test_caller_is_controller(value: bool) {
    TEST_CALLER_IS_CONTROLLER.with(|is_controller| is_controller.replace(value));
}

#[cfg(test)]
fn set_test_caller_text(value: Option<&str>) {
    TEST_CALLER_TEXT.with(|caller| caller.replace(value.map(str::to_string)));
}

fn database_create_error(error: String, cleanup_error: Option<String>) -> String {
    match cleanup_error {
        Some(cleanup_error) => format!("{error}; cleanup failed: {cleanup_error}"),
        None => error,
    }
}

async fn random_api_token() -> Result<String, String> {
    let response = Call::bounded_wait(Principal::management_canister(), "raw_rand")
        .await
        .map_err(|error| format!("raw_rand failed: {error}"))?;
    let (random_bytes,): (Vec<u8>,) = response
        .candid_tuple()
        .map_err(|error| format!("raw_rand decode failed: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(b"icpdb-token-v1");
    hasher.update(random_bytes);
    hasher.update(caller_text().as_bytes());
    hasher.update(now_millis().to_be_bytes());
    Ok(format!(
        "{API_TOKEN_PREFIX}{}",
        base32_lower(&hasher.finalize())
    ))
}

#[cfg_attr(test, allow(unused_variables))]
async fn icp_transfer_from(
    payer: Principal,
    canister: Principal,
    amount_e8s: u64,
    expected_fee_e8s: u64,
    created_at_time: u64,
) -> Result<u64, TransferFromError> {
    #[cfg(test)]
    {
        return TEST_ICP_TRANSFER_FROM.with(|result| result.borrow().clone().unwrap_or(Ok(1)));
    }
    #[cfg(not(test))]
    {
        let ledger = Principal::from_text(ICP_LEDGER_CANISTER_ID).map_err(|error| {
            TransferFromError::GenericError {
                error_code: Nat::from(0_u64),
                message: format!("invalid ICP ledger canister id: {error}"),
            }
        })?;
        let args = TransferFromArgs {
            spender_subaccount: None,
            from: Account {
                owner: payer,
                subaccount: None,
            },
            to: Account {
                owner: canister,
                subaccount: None,
            },
            amount: Nat::from(amount_e8s),
            fee: Some(Nat::from(expected_fee_e8s)),
            memo: None,
            created_at_time: Some(created_at_time),
        };
        let response = Call::bounded_wait(ledger, "icrc2_transfer_from")
            .with_arg(args)
            .await
            .map_err(|error| TransferFromError::GenericError {
                error_code: Nat::from(0_u64),
                message: format!("icrc2_transfer_from rejected: {error}"),
            })?;
        let result: Result<Nat, TransferFromError> =
            response
                .candid()
                .map_err(|error| TransferFromError::GenericError {
                    error_code: Nat::from(0_u64),
                    message: format!("icrc2_transfer_from decode failed: {error}"),
                })?;
        result.and_then(|block_index| {
            nat_to_u64(&block_index).map_err(|error| TransferFromError::GenericError {
                error_code: Nat::from(0_u64),
                message: error,
            })
        })
    }
}

fn describe_transfer_from_error(error: &TransferFromError) -> String {
    match error {
        TransferFromError::BadFee { expected_fee } => {
            format!("bad ICP ledger fee; expected {expected_fee} e8s")
        }
        TransferFromError::InsufficientAllowance { allowance } => {
            format!("approve不足: allowance {allowance} e8s")
        }
        TransferFromError::InsufficientFunds { balance } => {
            format!("ICP残高不足: balance {balance} e8s")
        }
        TransferFromError::TemporarilyUnavailable => {
            "ICP ledger temporarily unavailable; balance unchanged".to_string()
        }
        TransferFromError::TooOld => {
            "ICP ledger rejected deposit as too old; balance unchanged".to_string()
        }
        TransferFromError::CreatedInFuture { ledger_time } => {
            format!("ICP ledger rejected future timestamp; ledger_time {ledger_time}")
        }
        TransferFromError::Duplicate { duplicate_of } => {
            format!("duplicate ICP ledger transfer is not recorded: {duplicate_of}")
        }
        TransferFromError::BadBurn { min_burn_amount } => {
            format!("unsupported ICP burn error; min_burn_amount {min_burn_amount}")
        }
        TransferFromError::GenericError {
            error_code,
            message,
        } => format!("ICP ledger error {error_code}: {message}"),
    }
}

fn nat_to_u64(value: &Nat) -> Result<u64, String> {
    match value.0.to_u64_digits().as_slice() {
        [] => Ok(0),
        [value] => Ok(*value),
        _ => Err(format!("nat value exceeds u64: {value}")),
    }
}

fn require_controller() -> Result<(), String> {
    let caller = caller_principal();
    if caller == Principal::anonymous() {
        return Err("anonymous caller not allowed".to_string());
    }
    if caller_is_controller(&caller) {
        Ok(())
    } else {
        Err("caller is not a canister controller".to_string())
    }
}

fn caller_is_controller(caller: &Principal) -> bool {
    #[cfg(test)]
    {
        let _ = caller;
        TEST_CALLER_IS_CONTROLLER.with(|is_controller| *is_controller.borrow())
    }
    #[cfg(not(test))]
    {
        ic_cdk::api::is_controller(caller)
    }
}

fn handle_http_json(request: HttpUpdateRequest) -> Result<HttpUpdateResponse, (u16, String)> {
    if !request.method.eq_ignore_ascii_case("POST") {
        return Err((405, "only POST is supported".to_string()));
    }
    let token =
        bearer_token(&request.headers).ok_or_else(|| (401, "missing bearer token".to_string()))?;
    let sql_request = serde_json::from_slice::<SqlExecuteRequest>(&request.body)
        .map_err(|error| (400, format!("invalid JSON SQL request: {error}")))?;
    let now = now_millis();
    with_service(|service| {
        let required_role = match request.url.split('?').next().unwrap_or("") {
            "/v1/sql/query" => vfs_runtime::RequiredRole::Reader,
            "/v1/sql/execute" => vfs_runtime::RequiredRole::Writer,
            _ => return Err("unknown endpoint".to_string()),
        };
        let auth = service.authenticate_database_token(token, required_role, now)?;
        match required_role {
            vfs_runtime::RequiredRole::Reader => service.sql_query_with_token(&auth, sql_request),
            vfs_runtime::RequiredRole::Writer => service.sql_execute_with_token(&auth, sql_request),
            vfs_runtime::RequiredRole::Owner => {
                Err("owner token endpoint is not supported".to_string())
            }
        }
    })
    .and_then(|response| {
        serde_json::to_value(response)
            .map_err(|error| error.to_string())
            .map(|value| json_response(200, value))
    })
    .map_err(|error| {
        let status = if error.contains("token") { 401 } else { 400 };
        (status, error)
    })
}

fn bearer_token(headers: &[HeaderField]) -> Option<&str> {
    headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("authorization"))
        .and_then(|(_, value)| value.strip_prefix("Bearer "))
}

fn json_response(status_code: u16, value: serde_json::Value) -> HttpUpdateResponse {
    let body = serde_json::to_vec(&value)
        .unwrap_or_else(|_| b"{\"error\":\"failed to encode response\"}".to_vec());
    HttpUpdateResponse {
        status_code,
        headers: json_headers(),
        body,
    }
}

fn json_headers() -> Vec<HeaderField> {
    vec![(
        "content-type".to_string(),
        HTTP_JSON_CONTENT_TYPE.to_string(),
    )]
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

fn caller_text() -> String {
    #[cfg(test)]
    {
        TEST_CALLER_TEXT.with(|caller| {
            caller
                .borrow()
                .clone()
                .unwrap_or_else(|| "2vxsx-fae".to_string())
        })
    }
    #[cfg(not(test))]
    {
        ic_cdk::api::msg_caller().to_text()
    }
}

fn caller_principal() -> Principal {
    #[cfg(test)]
    {
        Principal::from_text(caller_text()).expect("test caller principal should parse")
    }
    #[cfg(not(test))]
    {
        ic_cdk::api::msg_caller()
    }
}

fn canister_principal() -> Principal {
    #[cfg(test)]
    {
        Principal::from_text("aaaaa-aa").expect("test canister principal should parse")
    }
    #[cfg(not(test))]
    {
        ic_cdk::api::canister_self()
    }
}

fn now_millis() -> i64 {
    #[cfg(test)]
    {
        1_700_000_000_000
    }
    #[cfg(not(test))]
    {
        (ic_cdk::api::time() / 1_000_000) as i64
    }
}

fn now_nanos() -> u64 {
    #[cfg(test)]
    {
        1_700_000_000_000_000_000
    }
    #[cfg(not(test))]
    {
        ic_cdk::api::time()
    }
}

fn cycle_balance() -> u128 {
    #[cfg(test)]
    {
        1_000_000_000_000
    }
    #[cfg(not(test))]
    {
        ic_cdk::api::canister_cycle_balance()
    }
}

fn with_usage<T, F>(method: &str, database_id: Option<String>, f: F) -> Result<T, String>
where
    F: FnOnce(&VfsService, &str, i64) -> Result<T, String>,
{
    let caller = caller_text();
    let now = now_millis();
    let before_cycles = cycle_balance();
    SERVICE.with(|slot| {
        let borrowed = slot.borrow();
        let service = borrowed
            .as_ref()
            .ok_or_else(|| "wiki service is not initialized".to_string())?;
        let result = f(service, &caller, now);
        let after_cycles = cycle_balance();
        let cycles_delta = before_cycles.saturating_sub(after_cycles);
        let error = result.as_ref().err().map(String::as_str);
        let _ = service.record_usage_event(UsageEvent {
            method,
            database_id: database_id.as_deref(),
            caller: &caller,
            success: result.is_ok(),
            cycles_delta,
            error,
            now,
        });
        result
    })
}

fn with_service<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce(&VfsService) -> Result<T, String>,
{
    SERVICE.with(|slot| {
        let borrowed = slot.borrow();
        let service = borrowed
            .as_ref()
            .ok_or_else(|| "wiki service is not initialized".to_string())?;
        f(service)
    })
}

fn memory_capabilities() -> Vec<MemoryCapability> {
    [
        (
            "query_context",
            "Primary agent-memory entrypoint for task-scoped context bundles",
        ),
        ("source_evidence", "Read source-path evidence for one node"),
        (
            "memory_manifest",
            "Discover memory API shape, limits, and policy",
        ),
        (
            "read_node_context",
            "Auxiliary node read with incoming and outgoing links",
        ),
        ("search_nodes", "Auxiliary search with lightweight previews"),
        (
            "graph_neighborhood",
            "Auxiliary local link graph around one node",
        ),
        ("recent_nodes", "Auxiliary recent live-node listing"),
    ]
    .into_iter()
    .map(|(name, description)| MemoryCapability {
        name: name.to_string(),
        description: description.to_string(),
    })
    .collect()
}

fn canonical_roles() -> Vec<CanonicalRole> {
    [
        (
            "index",
            "index.md",
            "Content-oriented catalog of pages in a scope",
        ),
        (
            "overview",
            "overview.md",
            "Corpus-level synthesis maintained by agents",
        ),
        ("log", "log.md", "Append-only chronological mutation log"),
        (
            "schema",
            "schema.md",
            "Scope-local conventions and write rules",
        ),
        ("topics", "topics/*.md", "Topic-level synthesis pages"),
        (
            "provenance",
            "provenance.md",
            "Source-path provenance for a scope or node",
        ),
    ]
    .into_iter()
    .map(|(name, path_pattern, purpose)| CanonicalRole {
        name: name.to_string(),
        path_pattern: path_pattern.to_string(),
        purpose: purpose.to_string(),
    })
    .collect()
}

export_service!();

pub fn candid_interface() -> String {
    normalize_candid_interface(__export_service())
}

fn normalize_candid_interface(interface: String) -> String {
    let normalized = normalize_candid_method_input(
        &interface,
        "outgoing_links",
        "IncomingLinksRequest",
        "OutgoingLinksRequest",
    );
    ensure_outgoing_links_request(normalized)
}

fn normalize_candid_method_input(
    interface: &str,
    method: &str,
    exported_input: &str,
    public_input: &str,
) -> String {
    let mut normalized = interface
        .lines()
        .map(|line| {
            let prefix = format!("  {method} : ({exported_input}) -> (");
            if line.starts_with(&prefix) && line.ends_with(" query;") {
                line.replacen(
                    &format!("{method} : ({exported_input})"),
                    &format!("{method} : ({public_input})"),
                    1,
                )
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    if interface.ends_with('\n') {
        normalized.push('\n');
    }
    normalized
}

fn ensure_outgoing_links_request(interface: String) -> String {
    if interface.contains("type OutgoingLinksRequest = record {") {
        return interface;
    }
    interface.replace(
        "type LinkEdge = record {",
        "type OutgoingLinksRequest = record { path : text; limit : nat32; database_id : text };\ntype LinkEdge = record {",
    )
}

#[cfg(feature = "canbench-rs")]
mod benches;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_sync_contract;
