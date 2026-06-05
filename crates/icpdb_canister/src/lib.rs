// Where: crates/icpdb_canister/src/lib.rs
// What: ICP canister entrypoints backed by IcpdbService for ICPDB SQL hosting.
// Why: The canister exposes database lifecycle, SQL, billing, deposit, and token APIs.
use std::cell::RefCell;
use std::collections::BTreeSet;
#[cfg(not(test))]
use std::ops::Range;

#[cfg(target_arch = "wasm32")]
use candid::Encode;
use candid::{CandidType, Deserialize, Nat, Principal, export_service};
use ic_cdk::call::Call;
use ic_cdk::{init, post_upgrade, query, update};
use ic_sqlite_vfs::{DbHandle, DefaultMemoryImpl, MemoryId, MemoryManager};
use icpdb_runtime::{
    AuthenticatedDatabaseToken, DatabaseMeta, IcpdbService, MAX_ARCHIVE_CHUNK_BYTES,
    RemoteDatabaseCreatePlan, RequiredRole, RoutedWriteBegin, SQL_EXECUTE_BILLING_UNITS,
    UsageEvent, hash_api_token,
};
use icpdb_types::{
    CanisterHealth, CreateDatabaseShardRequest, CreateDatabaseSlotRequest,
    CreateDatabaseTokenRequest, CreateDatabaseTokenResponse, CreateRemoteDatabaseRequest,
    DataPlaneOperationInfo, DataPlaneSqlBatchRequest, DataPlaneSqlExecuteRequest,
    DatabaseArchiveChunk, DatabaseArchiveFinalizeRequest, DatabaseArchiveInfo,
    DatabaseArchiveReadRequest, DatabaseBalanceTopUpRequest, DatabaseBilling, DatabaseInfo,
    DatabaseMember, DatabaseQuotaRequest, DatabaseRestoreBeginRequest, DatabaseRestoreChunkRequest,
    DatabaseRole, DatabaseShardInfo, DatabaseShardMaintenanceAction,
    DatabaseShardMaintenanceReport, DatabaseShardPlacement, DatabaseShardStatus,
    DatabaseShardStatusRequest, DatabaseStatus, DatabaseSummary, DatabaseTable, DatabaseTokenInfo,
    DatabaseUsage, DatabaseUsageEventSummary, DepositQuote, DepositResult,
    MaintainDatabaseShardsRequest, MigrateDatabaseToShardRequest, PaymentRecord,
    RegisterDatabaseShardRequest, RoutedOperationInfo, RoutedOperationRequest,
    RoutedOperationStatus, ShardOperationInfo, ShardOperationReconcileRequest, SqlBatchRequest,
    SqlExecuteRequest, SqlExecuteResponse, TableDescription, TablePreviewRequest,
    TablePreviewResponse, TopUpDatabaseShardRequest,
};
#[cfg(not(test))]
use icrc_ledger_types::icrc1::account::Account;
#[cfg(not(test))]
use icrc_ledger_types::icrc2::transfer_from::TransferFromArgs;
use icrc_ledger_types::icrc2::transfer_from::TransferFromError;
use serde_json::json;
use sha2::{Digest, Sha256};

mod http;

use crate::http::{
    DatabaseIdRequest, DescribeTableRequest, GrantDatabaseAccessRequest, HeaderField, HttpRequest,
    HttpResponse, HttpUpdateRequest, HttpUpdateResponse, HttpUpdateRoute, HttpUsageContext,
    RevokeDatabaseAccessRequest, RevokeDatabaseTokenRequest, bearer_token, decode_json_body,
    http_error_status, idempotency_key, json_response, parse_update_route,
    route_http_query_request, token_scope_role,
};

const INDEX_DB_PATH: &str = "./DB/index.sqlite3";
const DATABASES_DIR: &str = "./DB/databases";
#[cfg(not(test))]
// MemoryId 255 is reserved by ic-sqlite-vfs' MemoryManager-compatible layout.
// User DB capacity is therefore explicit and bounded until the storage layout is sharded.
const DATABASE_MEMORY_RANGE: Range<u8> = 11..255;
const INDEX_DB_MEMORY_ID: u8 = 10;
const API_TOKEN_PREFIX: &str = "icpdb_";
const ICP_LEDGER_CANISTER_ID: &str = "ryjl3-tyaaa-aaaaa-aaaba-cai";
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
const DEFAULT_DATABASE_SHARD_MAX_DATABASES: u16 = 200;
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
const DEFAULT_DATABASE_SHARD_INITIAL_CYCLES: u128 = 1_000_000_000_000;
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
const DATABASE_CANISTER_WASM_CHUNK_SIZE: usize = 900_000;

#[cfg(target_arch = "wasm32")]
const DATABASE_CANISTER_WASM: &[u8] =
    include_bytes!("../../../target/wasm32-unknown-unknown/release/icpdb_database_canister.wasm");

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static SERVICE: RefCell<Option<IcpdbService>> = const { RefCell::new(None) };
    static DATABASE_HANDLES: RefCell<Vec<(String, DbHandle)>> = const { RefCell::new(Vec::new()) };
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
fn canister_health() -> CanisterHealth {
    CanisterHealth {
        cycles_balance: ic_cdk::api::canister_cycle_balance(),
    }
}

#[update]
async fn create_database() -> Result<String, String> {
    require_authenticated()?;
    let caller = caller_text();
    let now = now_millis();
    let remote_plan = with_service(|service| service.remote_database_create_plan(&caller, now))?;
    if let Some(plan) = remote_plan {
        return create_remote_database_from_plan(plan, &caller, now).await;
    }
    if provision_database_shard_for_allocation(now)
        .await?
        .is_some()
    {
        let remote_plan =
            with_service(|service| service.remote_database_create_plan(&caller, now))?;
        let plan = remote_plan
            .ok_or_else(|| "created database shard has no allocatable capacity".to_string())?;
        return create_remote_database_from_plan(plan, &caller, now).await;
    }
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
async fn create_database_shard(
    request: CreateDatabaseShardRequest,
) -> Result<DatabaseShardInfo, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    let now = now_millis();
    let operation_id =
        begin_shard_operation_journal("create_shard", None, shard_request_hash(&request)?, now)?;
    let result = provision_database_shard(request.max_databases, request.initial_cycles, now).await;
    finish_shard_operation_journal(
        &operation_id,
        &result.as_ref().map(|_| ()).map_err(String::clone),
        now_millis(),
    );
    result
}

#[update]
fn register_database_shard(
    request: RegisterDatabaseShardRequest,
) -> Result<DatabaseShardInfo, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    Principal::from_text(&request.database_canister_id)
        .map_err(|error| format!("invalid database_canister_id: {error}"))?;
    with_service(|service| service.register_database_shard(request, now_millis()))
}

#[query]
fn list_database_shards() -> Result<Vec<DatabaseShardInfo>, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    with_service(|service| service.list_database_shards())
}

#[query]
fn list_shard_operations() -> Result<Vec<ShardOperationInfo>, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    with_service(|service| service.list_shard_operations())
}

#[query]
fn get_routed_operation(request: RoutedOperationRequest) -> Result<RoutedOperationInfo, String> {
    with_service(|service| service.routed_operation_for_caller(request, &caller_text()))
}

#[update]
fn reconcile_shard_operation(
    request: ShardOperationReconcileRequest,
) -> Result<ShardOperationInfo, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    with_service(|service| {
        service.reconcile_shard_operation(
            &request.operation_id,
            request.status,
            request.error.as_deref(),
            now_millis(),
        )
    })
}

#[update]
async fn reconcile_routed_operation(
    request: RoutedOperationRequest,
) -> Result<RoutedOperationInfo, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    let operation = with_service(|service| {
        service
            .routed_operation(&request.operation_id)?
            .ok_or_else(|| format!("routed operation not found: {}", request.operation_id))
    })?;
    if operation.database_id != request.database_id {
        return Err("routed operation database_id mismatch".to_string());
    }
    if operation.status != RoutedOperationStatus::Unknown {
        return Err(format!(
            "routed operation is not unknown: {}",
            operation.operation_id
        ));
    }
    let proof = call_database_canister_with_arg::<Option<DataPlaneOperationInfo>, _>(
        &operation.database_canister_id,
        "get_data_plane_operation_internal",
        request,
    )
    .await?
    .ok_or_else(|| {
        format!(
            "data-plane operation proof not found: {}",
            operation.operation_id
        )
    })?;
    if proof.method != operation.method || proof.request_hash != operation.request_hash {
        return Err(format!(
            "data-plane operation proof mismatch: {}",
            operation.operation_id
        ));
    }
    let usage = call_database_canister_with_arg::<DatabaseUsage, _>(
        &operation.database_canister_id,
        "database_usage_internal",
        operation.database_id.clone(),
    )
    .await?;
    with_service(|service| {
        service.reconcile_routed_write_from_data_plane(
            &operation.operation_id,
            usage.logical_size_bytes,
            now_millis(),
        )
    })
}

#[update]
async fn maintain_database_shards(
    request: MaintainDatabaseShardsRequest,
) -> Result<DatabaseShardMaintenanceReport, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    validate_database_shard_maintenance_request(&request)?;
    let now = now_millis();
    let operation_id =
        begin_shard_operation_journal("maintain_shards", None, shard_request_hash(&request)?, now)?;
    let result = async {
        let mut actions = Vec::new();
        let mut inspected_shards = Vec::new();
        let shards = with_service(|service| service.list_database_shards())?;
        for shard in shards {
            let canister_id = Principal::from_text(&shard.canister_id)
                .map_err(|error| format!("invalid database canister id: {error}"))?;
            let status = database_canister_status(canister_id).await?;
            let cycles_balance = status.cycles;
            let shard_status = DatabaseShardStatus {
                shard: shard.clone(),
                canister_status: status.status.to_db_label().to_string(),
                cycles_balance,
                memory_size_bytes: status.memory_size,
                idle_cycles_burned_per_day: status.idle_cycles_burned_per_day,
                module_hash: status.module_hash,
            };
            if cycles_balance < request.min_cycles_balance && request.top_up_cycles > 0 {
                deposit_cycles_to_canister(canister_id, request.top_up_cycles).await?;
                actions.push(DatabaseShardMaintenanceAction {
                    action: "top_up".to_string(),
                    database_canister_id: Some(shard.canister_id.clone()),
                    shard_id: Some(shard.shard_id.clone()),
                    cycles: request.top_up_cycles,
                    reason: "cycles_balance below min_cycles_balance".to_string(),
                });
            }
            inspected_shards.push(shard_status);
        }
        let mut available_slots = available_database_slots(&inspected_shards);
        while available_slots < request.min_available_slots
            && actions
                .iter()
                .filter(|action| action.action == "create_shard")
                .count()
                < usize::from(request.max_new_shards)
        {
            let shard = provision_database_shard(
                request.new_shard_max_databases,
                request.new_shard_initial_cycles,
                now_millis(),
            )
            .await?;
            available_slots = available_slots.saturating_add(
                u64::from(shard.max_databases).saturating_sub(shard.assigned_databases),
            );
            actions.push(DatabaseShardMaintenanceAction {
                action: "create_shard".to_string(),
                database_canister_id: Some(shard.canister_id.clone()),
                shard_id: Some(shard.shard_id.clone()),
                cycles: request.new_shard_initial_cycles,
                reason: "available slots below min_available_slots".to_string(),
            });
        }
        if available_slots < request.min_available_slots {
            return Err(format!(
                "available database shard slots below target: {available_slots} < {}",
                request.min_available_slots
            ));
        }
        Ok(DatabaseShardMaintenanceReport {
            inspected_shards,
            actions,
            available_slots,
        })
    }
    .await;
    finish_shard_operation_journal(
        &operation_id,
        &result.as_ref().map(|_| ()).map_err(String::clone),
        now_millis(),
    );
    result
}

#[update]
async fn get_database_shard_status(
    request: DatabaseShardStatusRequest,
) -> Result<DatabaseShardStatus, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    let canister_id = Principal::from_text(&request.database_canister_id)
        .map_err(|error| format!("invalid database_canister_id: {error}"))?;
    let shard =
        with_service(|service| service.database_shard_for_canister(&request.database_canister_id))?;
    let status = database_canister_status(canister_id).await?;
    Ok(DatabaseShardStatus {
        shard,
        canister_status: status.status.to_db_label().to_string(),
        cycles_balance: status.cycles,
        memory_size_bytes: status.memory_size,
        idle_cycles_burned_per_day: status.idle_cycles_burned_per_day,
        module_hash: status.module_hash,
    })
}

#[update]
async fn top_up_database_shard(
    request: TopUpDatabaseShardRequest,
) -> Result<DatabaseShardInfo, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    if request.cycles == 0 {
        return Err("cycles must be greater than zero".to_string());
    }
    let now = now_millis();
    let operation_id = begin_shard_operation_journal(
        "top_up_shard",
        Some(&request.database_canister_id),
        shard_request_hash(&request)?,
        now,
    )?;
    let result = async {
        let canister_id = Principal::from_text(&request.database_canister_id)
            .map_err(|error| format!("invalid database_canister_id: {error}"))?;
        let shard = with_service(|service| {
            service.database_shard_for_canister(&request.database_canister_id)
        })?;
        deposit_cycles_to_canister(canister_id, request.cycles)
            .await
            .map(|_| shard)
    }
    .await;
    finish_shard_operation_journal(
        &operation_id,
        &result.as_ref().map(|_| ()).map_err(String::clone),
        now_millis(),
    );
    result
}

#[update]
async fn create_remote_database(
    request: CreateRemoteDatabaseRequest,
) -> Result<DatabaseInfo, String> {
    let caller = caller_text();
    let caller_principal =
        Principal::from_text(&caller).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller_principal) {
        return Err("caller is not a controller".to_string());
    }
    Principal::from_text(&request.database_canister_id)
        .map_err(|error| format!("invalid database_canister_id: {error}"))?;
    let now = now_millis();
    let operation_id = begin_shard_operation_journal(
        "create_remote_database",
        Some(&request.database_id),
        shard_request_hash(&request)?,
        now,
    )?;
    let database_id = request.database_id.clone();
    let remote_result = call_database_canister_with_arg::<DatabaseInfo, _>(
        &request.database_canister_id,
        "create_database_slot",
        CreateDatabaseSlotRequest {
            database_id: request.database_id.clone(),
        },
    )
    .await;
    let result = remote_result.and_then(|_| {
        with_service(|service| service.register_remote_database(request, &caller, now))
    });
    let error = result.as_ref().err().map(String::as_str);
    let _ = with_service(|service| {
        service.record_usage_event(UsageEvent {
            method: "create_remote_database",
            operation: None,
            database_id: Some(&database_id),
            caller: &caller,
            success: result.is_ok(),
            cycles_delta: 0,
            rows_returned: 0,
            rows_affected: 0,
            error,
            now,
        })
    });
    finish_shard_operation_journal(
        &operation_id,
        &result.as_ref().map(|_| ()).map_err(String::clone),
        now_millis(),
    );
    result
}

#[update]
async fn migrate_database_to_shard(
    request: MigrateDatabaseToShardRequest,
) -> Result<DatabaseShardPlacement, String> {
    let caller = caller_text();
    let caller_principal =
        Principal::from_text(&caller).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller_principal) {
        return Err("caller is not a controller".to_string());
    }
    Principal::from_text(&request.database_canister_id)
        .map_err(|error| format!("invalid database_canister_id: {error}"))?;
    let now = now_millis();
    let operation_id = begin_shard_operation_journal(
        "migrate_database",
        Some(&request.database_id),
        shard_request_hash(&request)?,
        now,
    )?;
    let mut migration_started = false;
    let result = match with_service(|service| {
        service.begin_local_database_migration(&request, now_millis())
    }) {
        Ok(started) => {
            migration_started = true;
            migrate_local_archive_to_database_canister(&request, started.size_bytes)
                .await
                .and_then(|remote_info| {
                    with_service(|service| {
                        service.complete_local_database_migration(
                            &request,
                            remote_info.logical_size_bytes,
                            now_millis(),
                        )
                    })
                    .map(|(placement, old_meta)| {
                        unmount_database_file(&old_meta.db_file_name);
                        placement
                    })
                })
        }
        Err(error) => Err(error),
    };
    if result.is_err() && migration_started {
        let _ = call_database_canister_with_arg::<(), _>(
            &request.database_canister_id,
            "discard_database_slot_internal",
            request.database_id.clone(),
        )
        .await;
        let _ = with_service(|service| {
            service.cancel_local_database_migration(&request.database_id, now_millis())
        });
    }
    let error = result.as_ref().err().map(String::as_str);
    let _ = with_service(|service| {
        service.record_usage_event(UsageEvent {
            method: "migrate_database_to_shard",
            operation: Some("local_to_remote"),
            database_id: Some(&request.database_id),
            caller: &caller,
            success: result.is_ok(),
            cycles_delta: 0,
            rows_returned: 0,
            rows_affected: 0,
            error,
            now: now_millis(),
        })
    });
    finish_shard_operation_journal(
        &operation_id,
        &result.as_ref().map(|_| ()).map_err(String::clone),
        now_millis(),
    );
    result
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
fn list_database_placements() -> Result<Vec<DatabaseShardPlacement>, String> {
    with_service(|service| service.list_database_shard_placements_for_caller(&caller_text()))
}

#[query]
fn list_all_database_placements() -> Result<Vec<DatabaseShardPlacement>, String> {
    let caller =
        Principal::from_text(caller_text()).map_err(|error| format!("invalid caller: {error}"))?;
    if !caller_is_controller(&caller) {
        return Err("caller is not a controller".to_string());
    }
    with_service(|service| service.list_all_database_shard_placements())
}

#[query]
fn get_usage(database_id: String) -> Result<DatabaseUsage, String> {
    with_service(|service| service.database_usage(&database_id, &caller_text()))
}

#[query]
fn get_usage_event_summaries(
    database_id: String,
) -> Result<Vec<DatabaseUsageEventSummary>, String> {
    with_service(|service| service.database_usage_event_summaries(&database_id, &caller_text()))
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
    let caller = caller_text();
    with_service(|service| service.validate_create_database_token(&caller, &request))?;
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
async fn delete_database(database_id: String) -> Result<(), String> {
    let caller = caller_text();
    let now = now_millis();
    let route = route_for_caller(
        &caller,
        RequiredRole::Owner,
        &database_id,
        &[DatabaseStatus::Hot, DatabaseStatus::Archived],
    )?;
    match route.canister_id.clone() {
        Some(canister_id) => {
            let operation_hash = shard_request_hash(&(database_id.clone(), canister_id.clone()))?;
            let operation_id = begin_shard_operation_journal(
                "delete_remote_database",
                Some(&database_id),
                operation_hash,
                now,
            )?;
            let remote_result = call_database_canister_with_arg::<(), _>(
                &canister_id,
                "delete_database_slot",
                database_id.clone(),
            )
            .await;
            let result = match &remote_result {
                Ok(()) => with_service(|service| {
                    service.mark_remote_database_deleted(&caller, &database_id, now)
                }),
                Err(error) => Err(error.clone()),
            };
            let status = match (&remote_result, &result) {
                (Err(_), _) => RoutedOperationStatus::Failed,
                (Ok(()), Ok(())) => RoutedOperationStatus::Applied,
                (Ok(()), Err(_)) => RoutedOperationStatus::Unknown,
            };
            let error = result.as_ref().err().map(String::as_str);
            finish_shard_operation_journal_with_status(&operation_id, status, error, now_millis());
            result
        }
        None => with_usage(
            "delete_database",
            Some(database_id.clone()),
            |service, caller, now| {
                let meta = service.delete_database(&database_id, caller, now)?;
                unmount_database_file(&meta.db_file_name);
                Ok(())
            },
        ),
    }
}

#[update]
async fn begin_database_archive(database_id: String) -> Result<DatabaseArchiveInfo, String> {
    let caller = caller_text();
    let now = now_millis();
    let route = hot_route_for_caller(&caller, RequiredRole::Owner, &database_id)?;
    match route.canister_id {
        Some(canister_id) => {
            let operation_hash = shard_request_hash(&(canister_id.clone(), database_id.clone()))?;
            let operation_id = begin_shard_operation_journal(
                "begin_remote_database_archive",
                Some(&database_id),
                operation_hash,
                now,
            )?;
            let remote_result = call_database_canister_with_arg::<DatabaseArchiveInfo, _>(
                &canister_id,
                "begin_database_archive_internal",
                database_id.clone(),
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(info) => with_service(|service| {
                    service.mark_remote_database_archiving(&caller, &database_id, now)
                })
                .map(|_| info),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            result
        }
        None => with_usage(
            "begin_database_archive",
            Some(database_id.clone()),
            |service, caller, now| service.begin_database_archive(&database_id, caller, now),
        ),
    }
}

#[update]
async fn read_database_archive_chunk(
    database_id: String,
    offset: u64,
    max_bytes: u32,
) -> Result<DatabaseArchiveChunk, String> {
    let caller = caller_text();
    let route = route_for_caller(
        &caller,
        RequiredRole::Owner,
        &database_id,
        &[DatabaseStatus::Archiving],
    )?;
    match route.canister_id {
        Some(canister_id) => {
            call_database_canister_with_arg(
                &canister_id,
                "read_database_archive_chunk_internal",
                DatabaseArchiveReadRequest {
                    database_id,
                    offset,
                    max_bytes,
                },
            )
            .await
        }
        None => with_service(|service| {
            service
                .read_database_archive_chunk(&database_id, &caller, offset, max_bytes)
                .map(|bytes| DatabaseArchiveChunk { bytes })
        }),
    }
}

#[update]
async fn finalize_database_archive(
    database_id: String,
    snapshot_hash: Vec<u8>,
) -> Result<(), String> {
    let caller = caller_text();
    let now = now_millis();
    let route = route_for_caller(
        &caller,
        RequiredRole::Owner,
        &database_id,
        &[DatabaseStatus::Archiving],
    )?;
    match route.canister_id {
        Some(canister_id) => {
            let operation_hash = shard_request_hash(&(
                canister_id.clone(),
                database_id.clone(),
                snapshot_hash.clone(),
            ))?;
            let operation_id = begin_shard_operation_journal(
                "finalize_remote_database_archive",
                Some(&database_id),
                operation_hash,
                now,
            )?;
            let remote_result = call_database_canister_with_arg::<(), _>(
                &canister_id,
                "finalize_database_archive_internal",
                DatabaseArchiveFinalizeRequest {
                    database_id: database_id.clone(),
                    snapshot_hash: snapshot_hash.clone(),
                },
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(()) => with_service(|service| {
                    service.mark_remote_database_archived(&caller, &database_id, snapshot_hash, now)
                }),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            result
        }
        None => with_usage(
            "finalize_database_archive",
            Some(database_id.clone()),
            |service, caller, now| {
                let meta =
                    service.finalize_database_archive(&database_id, caller, snapshot_hash, now)?;
                unmount_database_file(&meta.db_file_name);
                Ok(())
            },
        ),
    }
}

#[update]
async fn cancel_database_archive(database_id: String) -> Result<(), String> {
    let caller = caller_text();
    let now = now_millis();
    let route = route_for_caller(
        &caller,
        RequiredRole::Owner,
        &database_id,
        &[DatabaseStatus::Archiving],
    )?;
    match route.canister_id {
        Some(canister_id) => {
            let operation_hash = shard_request_hash(&(canister_id.clone(), database_id.clone()))?;
            let operation_id = begin_shard_operation_journal(
                "cancel_remote_database_archive",
                Some(&database_id),
                operation_hash,
                now,
            )?;
            let remote_result = call_database_canister_with_arg::<(), _>(
                &canister_id,
                "cancel_database_archive_internal",
                database_id.clone(),
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(()) => with_service(|service| service.database_usage(&database_id, &caller))
                    .and_then(|usage| {
                        with_service(|service| {
                            service.mark_remote_database_hot(
                                &caller,
                                &database_id,
                                usage.logical_size_bytes,
                                now,
                            )
                        })
                    }),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            result
        }
        None => with_usage(
            "cancel_database_archive",
            Some(database_id.clone()),
            |service, caller, now| {
                service.cancel_database_archive(&database_id, caller, now)?;
                Ok(())
            },
        ),
    }
}

#[update]
async fn begin_database_restore(
    database_id: String,
    snapshot_hash: Vec<u8>,
    size_bytes: u64,
) -> Result<(), String> {
    let caller = caller_text();
    let now = now_millis();
    let route = route_for_caller(
        &caller,
        RequiredRole::Owner,
        &database_id,
        &[DatabaseStatus::Archived, DatabaseStatus::Deleted],
    )?;
    match route.canister_id {
        Some(canister_id) => {
            let operation_hash = shard_request_hash(&(
                canister_id.clone(),
                database_id.clone(),
                snapshot_hash.clone(),
                size_bytes,
            ))?;
            let operation_id = begin_shard_operation_journal(
                "begin_remote_database_restore",
                Some(&database_id),
                operation_hash,
                now,
            )?;
            let remote_result = call_database_canister_with_arg::<DatabaseInfo, _>(
                &canister_id,
                "begin_database_restore_internal",
                DatabaseRestoreBeginRequest {
                    database_id: database_id.clone(),
                    snapshot_hash: snapshot_hash.clone(),
                    size_bytes,
                },
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(_) => with_service(|service| {
                    service.mark_remote_database_restoring(
                        &caller,
                        &database_id,
                        snapshot_hash,
                        size_bytes,
                        now,
                    )
                }),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            result
        }
        None => with_usage(
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
        ),
    }
}

#[update]
async fn write_database_restore_chunk(request: DatabaseRestoreChunkRequest) -> Result<(), String> {
    let database_id = request.database_id.clone();
    let caller = caller_text();
    let route = route_for_caller(
        &caller,
        RequiredRole::Owner,
        &database_id,
        &[DatabaseStatus::Restoring],
    )?;
    match route.canister_id {
        Some(canister_id) => {
            call_database_canister_with_arg::<(), _>(
                &canister_id,
                "write_database_restore_chunk_internal",
                request,
            )
            .await
        }
        None => with_usage(
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
        ),
    }
}

#[update]
async fn finalize_database_restore(database_id: String) -> Result<(), String> {
    let caller = caller_text();
    let now = now_millis();
    let route = route_for_caller(
        &caller,
        RequiredRole::Owner,
        &database_id,
        &[DatabaseStatus::Restoring],
    )?;
    match route.canister_id {
        Some(canister_id) => {
            let operation_hash = shard_request_hash(&(canister_id.clone(), database_id.clone()))?;
            let operation_id = begin_shard_operation_journal(
                "finalize_remote_database_restore",
                Some(&database_id),
                operation_hash,
                now,
            )?;
            let remote_result = call_database_canister_with_arg::<DatabaseInfo, _>(
                &canister_id,
                "finalize_database_restore_internal",
                database_id.clone(),
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(info) => with_service(|service| {
                    service.mark_remote_database_hot(
                        &caller,
                        &database_id,
                        info.logical_size_bytes,
                        now,
                    )
                }),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            result
        }
        None => with_usage(
            "finalize_database_restore",
            Some(database_id.clone()),
            |service, caller, now| {
                let meta = service.prepare_database_restore_finalize(&database_id, caller)?;
                mount_database_file(&meta)?;
                if let Err(error) = service.complete_database_restore(&database_id, caller, now) {
                    unmount_database_file(&meta.db_file_name);
                    return Err(error);
                }
                Ok(())
            },
        ),
    }
}

#[update]
async fn sql_query(request: SqlExecuteRequest) -> Result<SqlExecuteResponse, String> {
    let caller = caller_text();
    let route = hot_route_for_caller(&caller, RequiredRole::Reader, &request.database_id)?;
    match route.canister_id {
        Some(canister_id) => {
            call_database_canister_with_arg(&canister_id, "sql_query_internal", request).await
        }
        None => with_service(|service| service.sql_query(&caller, request)),
    }
}

#[update]
async fn list_tables(database_id: String) -> Result<Vec<DatabaseTable>, String> {
    let caller = caller_text();
    let route = hot_route_for_caller(&caller, RequiredRole::Reader, &database_id)?;
    match route.canister_id {
        Some(canister_id) => {
            call_database_canister_with_arg(&canister_id, "list_tables_internal", database_id).await
        }
        None => with_service(|service| service.list_tables(&database_id, &caller)),
    }
}

#[update]
async fn describe_table(
    database_id: String,
    table_name: String,
) -> Result<TableDescription, String> {
    let caller = caller_text();
    let route = hot_route_for_caller(&caller, RequiredRole::Reader, &database_id)?;
    match route.canister_id {
        Some(canister_id) => {
            call_database_canister_describe(&canister_id, database_id, table_name).await
        }
        None => with_service(|service| service.describe_table(&database_id, &table_name, &caller)),
    }
}

#[update]
async fn preview_table(request: TablePreviewRequest) -> Result<TablePreviewResponse, String> {
    let caller = caller_text();
    let route = hot_route_for_caller(&caller, RequiredRole::Reader, &request.database_id)?;
    match route.canister_id {
        Some(canister_id) => {
            call_database_canister_with_arg(&canister_id, "preview_table_internal", request).await
        }
        None => with_service(|service| service.preview_table(&caller, request)),
    }
}

#[update]
async fn sql_execute(request: SqlExecuteRequest) -> Result<SqlExecuteResponse, String> {
    let database_id = request.database_id.clone();
    let operation = sql_operation(&request.sql);
    let caller = caller_text();
    let now = now_millis();
    let route = hot_route_for_caller(&caller, RequiredRole::Writer, &database_id)?;
    match route.canister_id {
        Some(canister_id) => {
            let operation_id = candid_routed_operation_id("sql_execute", &request)?;
            let response = remote_sql_write_for_caller(
                &caller,
                &request,
                DataPlaneSqlExecuteRequest {
                    operation_id: operation_id.clone(),
                    request: request.clone(),
                },
                RemotePrincipalWriteContext {
                    canister_id: &canister_id,
                    internal_method: "sql_execute_internal",
                    operation_id: &operation_id,
                    billing_units: SQL_EXECUTE_BILLING_UNITS,
                    now,
                    method: "sql_execute",
                    operation: operation.as_deref(),
                    database_id: &database_id,
                },
                sql_response_usage_metrics,
                applied_replay_sql_response,
            )
            .await?;
            Ok(sql_response_with_routed_operation_id(
                response,
                &operation_id,
            ))
        }
        None => with_usage_metrics(
            "sql_execute",
            operation.as_deref(),
            Some(database_id),
            |service, caller, _now| service.sql_execute(caller, request),
            sql_response_usage_metrics,
        ),
    }
}

#[update]
async fn sql_batch(request: SqlBatchRequest) -> Result<Vec<SqlExecuteResponse>, String> {
    let database_id = request.database_id.clone();
    let operation = sql_batch_operation(&request);
    let billing_units =
        SQL_EXECUTE_BILLING_UNITS.saturating_mul(request.statements.len().max(1) as u64);
    let caller = caller_text();
    let now = now_millis();
    let route = hot_route_for_caller(&caller, RequiredRole::Writer, &database_id)?;
    match route.canister_id {
        Some(canister_id) => {
            let operation_id = candid_routed_operation_id("sql_batch", &request)?;
            let statement_count = request.statements.len();
            let responses = remote_sql_write_for_caller(
                &caller,
                &request,
                DataPlaneSqlBatchRequest {
                    operation_id: operation_id.clone(),
                    request: request.clone(),
                },
                RemotePrincipalWriteContext {
                    canister_id: &canister_id,
                    internal_method: "sql_batch_internal",
                    operation_id: &operation_id,
                    billing_units,
                    now,
                    method: "sql_batch",
                    operation: operation.as_deref(),
                    database_id: &database_id,
                },
                |responses: &Vec<SqlExecuteResponse>| sql_batch_usage_metrics(responses),
                || applied_replay_sql_batch_response(statement_count),
            )
            .await?;
            Ok(sql_batch_response_with_routed_operation_id(
                responses,
                &operation_id,
            ))
        }
        None => with_usage_metrics(
            "sql_batch",
            operation.as_deref(),
            Some(database_id),
            |service, caller, _now| service.sql_batch(caller, request),
            |responses| sql_batch_usage_metrics(responses),
        ),
    }
}

#[query]
fn http_request(request: HttpRequest) -> HttpResponse {
    route_http_query_request(&request)
}

#[update]
async fn http_request_update(request: HttpUpdateRequest) -> HttpUpdateResponse {
    match handle_http_json(request).await {
        Ok(response) => response,
        Err((status_code, message)) => json_response(status_code, json!({ "error": message })),
    }
}

fn initialize_or_trap() {
    initialize_service().unwrap_or_else(|error| ic_cdk::trap(&error));
}

fn initialize_service() -> Result<(), String> {
    initialize_sqlite_storage()?;
    let service = IcpdbService::new(INDEX_DB_PATH, DATABASES_DIR);
    service.run_index_migrations()?;
    DATABASE_HANDLES.with(|handles| handles.borrow_mut().clear());
    for meta in service.list_databases()? {
        mount_database_file(&meta)?;
    }
    SERVICE.with(|slot| *slot.borrow_mut() = Some(service));
    Ok(())
}

fn initialize_sqlite_storage() -> Result<(), String> {
    MEMORY_MANAGER.with(|manager| {
        let manager = manager.borrow();
        let memory = manager.get(MemoryId::new(INDEX_DB_MEMORY_ID));
        #[cfg(target_arch = "wasm32")]
        {
            let handle = DbHandle::init(memory).map_err(|error| error.to_string())?;
            icpdb_runtime::register_path_handle(INDEX_DB_PATH, handle);
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            DbHandle::init(memory).map_err(|error| error.to_string())?;
        }
        Ok(())
    })
}

#[cfg(not(test))]
fn mount_database_file(meta: &DatabaseMeta) -> Result<(), String> {
    let memory_id = u8::try_from(meta.mount_id).map_err(|error| error.to_string())?;
    if !DATABASE_MEMORY_RANGE.contains(&memory_id) {
        return Err(format!(
            "database MemoryId is outside ic-sqlite-vfs range: {}",
            meta.mount_id
        ));
    }
    MEMORY_MANAGER.with(|manager| {
        let manager = manager.borrow();
        let handle = DbHandle::init(manager.get(MemoryId::new(memory_id)))
            .map_err(|error| error.to_string())?;
        #[cfg(target_arch = "wasm32")]
        icpdb_runtime::register_path_handle(meta.db_file_name.clone(), handle);
        DATABASE_HANDLES.with(|handles| {
            let mut handles = handles.borrow_mut();
            handles.retain(|(database_id, _)| database_id != &meta.database_id);
            handles.push((meta.database_id.clone(), handle));
        });
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
    #[cfg(target_arch = "wasm32")]
    icpdb_runtime::unregister_path_handle(db_file_name);
    DATABASE_HANDLES.with(|handles| {
        handles
            .borrow_mut()
            .retain(|(database_id, _)| !db_file_name.contains(database_id));
    });
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

fn shard_operation_id(kind: &str, target: Option<&str>, request_hash: &[u8], now: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"icpdb-shard-operation-v1");
    hasher.update(kind.as_bytes());
    hasher.update(target.unwrap_or("").as_bytes());
    hasher.update(request_hash);
    hasher.update(caller_text().as_bytes());
    hasher.update(now.to_be_bytes());
    format!("shard_{}", &base32_lower(&hasher.finalize())[..20])
}

fn shard_request_hash<T: serde::Serialize>(request: &T) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(request).map_err(|error| error.to_string())?;
    Ok(Sha256::digest(bytes).to_vec())
}

fn begin_shard_operation_journal(
    kind: &str,
    target: Option<&str>,
    request_hash: Vec<u8>,
    now: i64,
) -> Result<String, String> {
    let operation_id = shard_operation_id(kind, target, &request_hash, now);
    let started = with_service(|service| {
        service.begin_shard_operation(&operation_id, kind, target, request_hash, now)
    })?;
    match started.status {
        RoutedOperationStatus::Pending | RoutedOperationStatus::Failed => Ok(operation_id),
        RoutedOperationStatus::Applied => Err("shard operation already applied".to_string()),
        RoutedOperationStatus::Unknown => Err("shard operation outcome is unknown".to_string()),
    }
}

fn finish_shard_operation_journal(operation_id: &str, result: &Result<(), String>, now: i64) {
    let (status, error) = match result {
        Ok(()) => (RoutedOperationStatus::Applied, None),
        Err(error) => (RoutedOperationStatus::Unknown, Some(error.as_str())),
    };
    finish_shard_operation_journal_with_status(operation_id, status, error, now);
}

fn finish_shard_operation_journal_with_status(
    operation_id: &str,
    status: RoutedOperationStatus,
    error: Option<&str>,
    now: i64,
) {
    let _ = with_service(|service| {
        service.update_shard_operation_status(operation_id, status, error, now)
    });
}

fn remote_lifecycle_operation_status<T>(
    remote_succeeded: bool,
    result: &Result<T, String>,
) -> RoutedOperationStatus {
    match (remote_succeeded, result.is_ok()) {
        (false, _) => RoutedOperationStatus::Failed,
        (true, true) => RoutedOperationStatus::Applied,
        (true, false) => RoutedOperationStatus::Unknown,
    }
}

fn finish_remote_lifecycle_operation_journal<T>(
    operation_id: &str,
    remote_succeeded: bool,
    result: &Result<T, String>,
    now: i64,
) {
    let status = remote_lifecycle_operation_status(remote_succeeded, result);
    let error = result.as_ref().err().map(String::as_str);
    finish_shard_operation_journal_with_status(operation_id, status, error, now);
}

fn mark_routed_write_completion_failed(operation_id: &str, error: &str, now: i64) {
    let _ = with_service(|service| {
        service.update_routed_operation_status(
            operation_id,
            RoutedOperationStatus::Unknown,
            Some(error),
            now,
        )
    });
}

fn validate_database_shard_maintenance_request(
    request: &MaintainDatabaseShardsRequest,
) -> Result<(), String> {
    if request.min_available_slots > 0 {
        if request.max_new_shards == 0 {
            return Err(
                "max_new_shards must be greater than zero when min_available_slots is set"
                    .to_string(),
            );
        }
        if request.new_shard_max_databases == 0 {
            return Err("new_shard_max_databases must be greater than zero".to_string());
        }
        if request.new_shard_initial_cycles == 0 {
            return Err("new_shard_initial_cycles must be greater than zero".to_string());
        }
    }
    Ok(())
}

fn available_database_slots(statuses: &[DatabaseShardStatus]) -> u64 {
    statuses
        .iter()
        .filter(|status| status.shard.status == "active")
        .map(|status| {
            u64::from(status.shard.max_databases).saturating_sub(status.shard.assigned_databases)
        })
        .sum()
}

async fn create_remote_database_from_plan(
    plan: RemoteDatabaseCreatePlan,
    caller: &str,
    now: i64,
) -> Result<String, String> {
    let request = CreateRemoteDatabaseRequest {
        database_id: plan.database_id.clone(),
        database_canister_id: plan.database_canister_id.clone(),
    };
    let operation_id = begin_shard_operation_journal(
        "allocate_remote_database",
        Some(&plan.database_id),
        shard_request_hash(&request)?,
        now,
    )?;
    let result = call_database_canister_with_arg::<DatabaseInfo, _>(
        &plan.database_canister_id,
        "create_database_slot",
        CreateDatabaseSlotRequest {
            database_id: plan.database_id.clone(),
        },
    )
    .await
    .and_then(|_| {
        with_service(|service| service.register_remote_database(request, caller, now))
            .map(|_| plan.database_id.clone())
    });
    if result.is_err() {
        let _ = call_database_canister_with_arg::<(), _>(
            &plan.database_canister_id,
            "delete_database_slot",
            plan.database_id.clone(),
        )
        .await;
    }
    let error = result.as_ref().err().map(String::as_str);
    let _ = with_service(|service| {
        service.record_usage_event(UsageEvent {
            method: "create_database",
            operation: Some("remote_allocate"),
            database_id: Some(&plan.database_id),
            caller,
            success: result.is_ok(),
            cycles_delta: 0,
            rows_returned: 0,
            rows_affected: 0,
            error,
            now,
        })
    });
    finish_shard_operation_journal(
        &operation_id,
        &result.as_ref().map(|_| ()).map_err(String::clone),
        now_millis(),
    );
    result
}

async fn migrate_local_archive_to_database_canister(
    request: &MigrateDatabaseToShardRequest,
    size_bytes: u64,
) -> Result<DatabaseInfo, String> {
    let snapshot_hash = local_migration_snapshot_hash(&request.database_id, size_bytes)?;
    call_database_canister_with_arg::<DatabaseInfo, _>(
        &request.database_canister_id,
        "create_database_slot",
        CreateDatabaseSlotRequest {
            database_id: request.database_id.clone(),
        },
    )
    .await?;
    call_database_canister_with_arg::<(), _>(
        &request.database_canister_id,
        "delete_database_slot",
        request.database_id.clone(),
    )
    .await?;
    call_database_canister_with_arg::<DatabaseInfo, _>(
        &request.database_canister_id,
        "begin_database_restore_internal",
        DatabaseRestoreBeginRequest {
            database_id: request.database_id.clone(),
            snapshot_hash,
            size_bytes,
        },
    )
    .await?;
    let mut offset = 0_u64;
    while offset < size_bytes {
        let chunk = with_service(|service| {
            service.read_local_database_migration_chunk(
                &request.database_id,
                offset,
                MAX_ARCHIVE_CHUNK_BYTES,
            )
        })?;
        if chunk.is_empty() {
            return Err(format!(
                "local migration archive ended early at offset {offset}"
            ));
        }
        call_database_canister_with_arg::<(), _>(
            &request.database_canister_id,
            "write_database_restore_chunk_internal",
            DatabaseRestoreChunkRequest {
                database_id: request.database_id.clone(),
                offset,
                bytes: chunk.clone(),
            },
        )
        .await?;
        offset = offset
            .checked_add(u64::try_from(chunk.len()).map_err(|error| error.to_string())?)
            .ok_or_else(|| "migration offset overflows u64".to_string())?;
    }
    call_database_canister_with_arg::<DatabaseInfo, _>(
        &request.database_canister_id,
        "finalize_database_restore_internal",
        request.database_id.clone(),
    )
    .await
}

fn local_migration_snapshot_hash(database_id: &str, size_bytes: u64) -> Result<Vec<u8>, String> {
    let mut hasher = Sha256::new();
    let mut offset = 0_u64;
    while offset < size_bytes {
        let chunk = with_service(|service| {
            service.read_local_database_migration_chunk(
                database_id,
                offset,
                MAX_ARCHIVE_CHUNK_BYTES,
            )
        })?;
        if chunk.is_empty() {
            return Err(format!(
                "local migration archive ended early at offset {offset}"
            ));
        }
        hasher.update(&chunk);
        offset = offset
            .checked_add(u64::try_from(chunk.len()).map_err(|error| error.to_string())?)
            .ok_or_else(|| "migration offset overflows u64".to_string())?;
    }
    Ok(hasher.finalize().to_vec())
}

async fn provision_database_shard_for_allocation(
    now: i64,
) -> Result<Option<DatabaseShardInfo>, String> {
    #[cfg(target_arch = "wasm32")]
    {
        provision_database_shard(
            DEFAULT_DATABASE_SHARD_MAX_DATABASES,
            DEFAULT_DATABASE_SHARD_INITIAL_CYCLES,
            now,
        )
        .await
        .map(Some)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = now;
        Ok(None)
    }
}

async fn provision_database_shard(
    max_databases: u16,
    initial_cycles: u128,
    now: i64,
) -> Result<DatabaseShardInfo, String> {
    if max_databases == 0 {
        return Err("max_databases must be greater than zero".to_string());
    }
    if initial_cycles == 0 {
        return Err("initial_cycles must be greater than zero".to_string());
    }
    let canister_id = create_empty_database_canister(initial_cycles).await?;
    let install_result = install_database_canister(canister_id).await;
    if let Err(error) = install_result {
        let cleanup_error = delete_empty_database_canister(canister_id).await.err();
        return Err(database_create_error(error, cleanup_error));
    }
    with_service(|service| {
        service.register_database_shard(
            RegisterDatabaseShardRequest {
                database_canister_id: canister_id.to_text(),
                max_databases,
            },
            now,
        )
    })
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
#[derive(Clone, Debug, CandidType)]
struct ManagementCanisterSettings {
    controllers: Option<Vec<Principal>>,
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
#[derive(Clone, Debug, CandidType)]
struct ManagementCreateCanisterArgs {
    settings: Option<ManagementCanisterSettings>,
    sender_canister_version: Option<u64>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct ManagementCanisterIdRecord {
    canister_id: Principal,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
enum ManagementCanisterStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "stopping")]
    Stopping,
    #[serde(rename = "stopped")]
    Stopped,
}

impl ManagementCanisterStatus {
    fn to_db_label(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Stopping => "stopping",
            Self::Stopped => "stopped",
        }
    }
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct ManagementCanisterStatusResult {
    status: ManagementCanisterStatus,
    module_hash: Option<Vec<u8>>,
    memory_size: u128,
    cycles: u128,
    idle_cycles_burned_per_day: u128,
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
#[derive(Clone, Copy, Debug, CandidType, Deserialize)]
enum ManagementCanisterInstallMode {
    #[serde(rename = "install")]
    Install,
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
#[derive(Clone, Debug, CandidType, Deserialize)]
struct ManagementChunkHash {
    hash: Vec<u8>,
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
#[derive(Clone, Debug, CandidType)]
struct ManagementUploadChunkArgs {
    canister_id: Principal,
    chunk: Vec<u8>,
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
#[derive(Clone, Debug, CandidType)]
struct ManagementInstallChunkedCodeArgs {
    mode: ManagementCanisterInstallMode,
    target_canister: Principal,
    store_canister: Option<Principal>,
    chunk_hashes_list: Vec<ManagementChunkHash>,
    wasm_module_hash: Vec<u8>,
    arg: Vec<u8>,
    sender_canister_version: Option<u64>,
}

async fn create_empty_database_canister(initial_cycles: u128) -> Result<Principal, String> {
    #[cfg(target_arch = "wasm32")]
    {
        let control = ic_cdk::api::canister_self();
        let response = Call::bounded_wait(Principal::management_canister(), "create_canister")
            .with_cycles(initial_cycles)
            .with_arg(ManagementCreateCanisterArgs {
                settings: Some(ManagementCanisterSettings {
                    controllers: Some(vec![control]),
                }),
                sender_canister_version: None,
            })
            .await
            .map_err(|error| format!("create_canister failed: {error}"))?;
        let result: ManagementCanisterIdRecord = response
            .candid()
            .map_err(|error| format!("create_canister decode failed: {error}"))?;
        Ok(result.canister_id)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = initial_cycles;
        Err("database shard creation is only available on wasm32 canisters".to_string())
    }
}

async fn install_database_canister(canister_id: Principal) -> Result<(), String> {
    #[cfg(target_arch = "wasm32")]
    {
        let wasm_hash = Sha256::digest(DATABASE_CANISTER_WASM).to_vec();
        let mut chunk_hashes = Vec::new();
        for chunk in DATABASE_CANISTER_WASM.chunks(DATABASE_CANISTER_WASM_CHUNK_SIZE) {
            let response = Call::bounded_wait(Principal::management_canister(), "upload_chunk")
                .with_arg(ManagementUploadChunkArgs {
                    canister_id,
                    chunk: chunk.to_vec(),
                })
                .await
                .map_err(|error| format!("upload_chunk failed: {error}"))?;
            let chunk_hash: ManagementChunkHash = response
                .candid()
                .map_err(|error| format!("upload_chunk decode failed: {error}"))?;
            chunk_hashes.push(chunk_hash);
        }
        let arg = candid::Encode!(&icpdb_types::DatabaseCanisterInitArgs {
            control_canister_id: ic_cdk::api::canister_self().to_text(),
        })
        .map_err(|error| format!("database canister init arg encode failed: {error}"))?;
        let response = Call::bounded_wait(Principal::management_canister(), "install_chunked_code")
            .with_arg(ManagementInstallChunkedCodeArgs {
                mode: ManagementCanisterInstallMode::Install,
                target_canister: canister_id,
                store_canister: None,
                chunk_hashes_list: chunk_hashes,
                wasm_module_hash: wasm_hash,
                arg,
                sender_canister_version: None,
            })
            .await
            .map_err(|error| format!("install_chunked_code failed: {error}"))?;
        response
            .candid_tuple::<()>()
            .map_err(|error| format!("install_chunked_code decode failed: {error}"))?;
        Ok(())
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = canister_id;
        Err("database shard install is only available on wasm32 canisters".to_string())
    }
}

async fn delete_empty_database_canister(canister_id: Principal) -> Result<(), String> {
    let _ =
        call_management_canister_unit("stop_canister", ManagementCanisterIdRecord { canister_id })
            .await;
    call_management_canister_unit(
        "delete_canister",
        ManagementCanisterIdRecord { canister_id },
    )
    .await
}

async fn database_canister_status(
    canister_id: Principal,
) -> Result<ManagementCanisterStatusResult, String> {
    let response = Call::bounded_wait(Principal::management_canister(), "canister_status")
        .with_arg(ManagementCanisterIdRecord { canister_id })
        .await
        .map_err(|error| format!("canister_status failed: {error}"))?;
    response
        .candid()
        .map_err(|error| format!("canister_status decode failed: {error}"))
}

async fn deposit_cycles_to_canister(canister_id: Principal, cycles: u128) -> Result<(), String> {
    let response = Call::bounded_wait(Principal::management_canister(), "deposit_cycles")
        .with_cycles(cycles)
        .with_arg(ManagementCanisterIdRecord { canister_id })
        .await
        .map_err(|error| format!("deposit_cycles failed: {error}"))?;
    response
        .candid_tuple::<()>()
        .map_err(|error| format!("deposit_cycles decode failed: {error}"))?;
    Ok(())
}

async fn call_management_canister_unit<T: CandidType>(method: &str, arg: T) -> Result<(), String> {
    let response = Call::bounded_wait(Principal::management_canister(), method)
        .with_arg(arg)
        .await
        .map_err(|error| format!("{method} failed: {error}"))?;
    response
        .candid_tuple::<()>()
        .map_err(|error| format!("{method} decode failed: {error}"))?;
    Ok(())
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
        TEST_ICP_TRANSFER_FROM.with(|result| result.borrow().clone().unwrap_or(Ok(1)))
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
    require_authenticated()?;
    if caller_is_controller(&caller) {
        Ok(())
    } else {
        Err("caller is not a canister controller".to_string())
    }
}

fn require_authenticated() -> Result<(), String> {
    if caller_principal() == Principal::anonymous() {
        return Err("anonymous caller not allowed".to_string());
    }
    Ok(())
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

async fn handle_http_json(request: HttpUpdateRequest) -> Result<HttpUpdateResponse, (u16, String)> {
    if !request.method.eq_ignore_ascii_case("POST") {
        return Err((405, "only POST is supported".to_string()));
    }
    let token =
        bearer_token(&request.headers).ok_or_else(|| (401, "missing bearer token".to_string()))?;
    let now = now_millis();
    let route = parse_update_route(&request.url)?;
    match route {
        HttpUpdateRoute::SqlBatch | HttpUpdateRoute::SqlExecute | HttpUpdateRoute::SqlQuery => {
            handle_http_sql_json(route, token, &request.headers, &request.body, now).await
        }
        HttpUpdateRoute::TablesDescribe
        | HttpUpdateRoute::TablesList
        | HttpUpdateRoute::TablesPreview => {
            handle_http_table_json(route, token, &request.body, now).await
        }
        HttpUpdateRoute::ArchiveBegin
        | HttpUpdateRoute::ArchiveCancel
        | HttpUpdateRoute::ArchiveFinalize
        | HttpUpdateRoute::ArchiveRead
        | HttpUpdateRoute::RestoreBegin
        | HttpUpdateRoute::RestoreFinalize
        | HttpUpdateRoute::RestoreWrite => {
            handle_http_transfer_json(route, token, &request.body, now).await
        }
        route => handle_http_account_json(route, token, &request.body, now).await,
    }
}

async fn handle_http_sql_json(
    route: HttpUpdateRoute,
    token: &str,
    headers: &[HeaderField],
    body: &[u8],
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    match route {
        HttpUpdateRoute::SqlQuery => {
            let sql_request = decode_json_body::<SqlExecuteRequest>(body, "SQL request")?;
            http_sql_query_with_token(token, sql_request, now).await
        }
        HttpUpdateRoute::SqlExecute => {
            let sql_request = decode_json_body::<SqlExecuteRequest>(body, "SQL request")?;
            http_sql_execute_with_token(token, headers, sql_request, now).await
        }
        HttpUpdateRoute::SqlBatch => {
            let sql_request = decode_json_body::<SqlBatchRequest>(body, "SQL batch request")?;
            http_sql_batch_with_token(token, headers, sql_request, now).await
        }
        _ => Err((404, "unknown endpoint".to_string())),
    }
}

async fn handle_http_table_json(
    route: HttpUpdateRoute,
    token: &str,
    body: &[u8],
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    match route {
        HttpUpdateRoute::TablesList => {
            let table_request = decode_json_body::<DatabaseIdRequest>(body, "table list request")?;
            http_list_tables_with_token(token, table_request, now).await
        }
        HttpUpdateRoute::TablesDescribe => {
            let table_request =
                decode_json_body::<DescribeTableRequest>(body, "table describe request")?;
            http_describe_table_with_token(token, table_request, now).await
        }
        HttpUpdateRoute::TablesPreview => {
            let table_request =
                decode_json_body::<TablePreviewRequest>(body, "table preview request")?;
            http_preview_table_with_token(token, table_request, now).await
        }
        _ => Err((404, "unknown endpoint".to_string())),
    }
}

async fn handle_http_transfer_json(
    route: HttpUpdateRoute,
    token: &str,
    body: &[u8],
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    match route {
        HttpUpdateRoute::ArchiveBegin => {
            let archive_request =
                decode_json_body::<DatabaseIdRequest>(body, "archive begin request")?;
            http_begin_database_archive(token, archive_request, now).await
        }
        HttpUpdateRoute::ArchiveRead => {
            let archive_request =
                decode_json_body::<DatabaseArchiveReadRequest>(body, "archive read request")?;
            http_read_database_archive(token, archive_request, now).await
        }
        HttpUpdateRoute::ArchiveFinalize => {
            let archive_request = decode_json_body::<DatabaseArchiveFinalizeRequest>(
                body,
                "archive finalize request",
            )?;
            http_finalize_database_archive(token, archive_request, now).await
        }
        HttpUpdateRoute::ArchiveCancel => {
            let archive_request =
                decode_json_body::<DatabaseIdRequest>(body, "archive cancel request")?;
            http_cancel_database_archive(token, archive_request, now).await
        }
        HttpUpdateRoute::RestoreBegin => {
            let restore_request =
                decode_json_body::<DatabaseRestoreBeginRequest>(body, "restore begin request")?;
            http_begin_database_restore(token, restore_request, now).await
        }
        HttpUpdateRoute::RestoreWrite => {
            let restore_request =
                decode_json_body::<DatabaseRestoreChunkRequest>(body, "restore write request")?;
            http_write_database_restore(token, restore_request, now).await
        }
        HttpUpdateRoute::RestoreFinalize => {
            let restore_request =
                decode_json_body::<DatabaseIdRequest>(body, "restore finalize request")?;
            http_finalize_database_restore(token, restore_request, now).await
        }
        _ => Err((404, "unknown endpoint".to_string())),
    }
}

async fn handle_http_account_json(
    route: HttpUpdateRoute,
    token: &str,
    body: &[u8],
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    match route {
        HttpUpdateRoute::Session => handle_http_session_json(token, body, now),
        HttpUpdateRoute::Usage => {
            let usage_request = decode_json_body::<DatabaseIdRequest>(body, "usage request")?;
            http_json_with_token(token, RequiredRole::Reader, now, |service, auth| {
                service.database_usage_with_token(&auth, &usage_request.database_id)
            })
        }
        HttpUpdateRoute::UsageEvents => {
            let usage_request = decode_json_body::<DatabaseIdRequest>(body, "usage event request")?;
            http_json_with_token(token, RequiredRole::Reader, now, |service, auth| {
                service.database_usage_event_summaries_with_token(&auth, &usage_request.database_id)
            })
        }
        HttpUpdateRoute::PlacementsGet => {
            let placement_request =
                decode_json_body::<DatabaseIdRequest>(body, "placement request")?;
            http_json_with_token(token, RequiredRole::Reader, now, |service, auth| {
                service.database_shard_placement_with_token(&auth, &placement_request.database_id)
            })
        }
        HttpUpdateRoute::Billing => {
            let billing_request = decode_json_body::<DatabaseIdRequest>(body, "billing request")?;
            http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
                service.database_billing_with_token(&auth, &billing_request.database_id)
            })
        }
        HttpUpdateRoute::PaymentsList => {
            let payment_request =
                decode_json_body::<DatabaseIdRequest>(body, "payment list request")?;
            http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
                service.list_payments_with_token(&auth, &payment_request.database_id)
            })
        }
        HttpUpdateRoute::OperationsGet => {
            let operation_request =
                decode_json_body::<RoutedOperationRequest>(body, "operation request")?;
            http_json_with_token(token, RequiredRole::Reader, now, |service, auth| {
                service.routed_operation_with_token(&auth, operation_request)
            })
        }
        HttpUpdateRoute::QuotaSet => {
            let quota_request = decode_json_body::<DatabaseQuotaRequest>(body, "quota request")?;
            http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
                service.set_database_quota_with_token(&auth, quota_request)
            })
        }
        HttpUpdateRoute::TokensCreate => {
            let token_request =
                decode_json_body::<CreateDatabaseTokenRequest>(body, "token create request")?;
            http_create_database_token(token, token_request, now).await
        }
        HttpUpdateRoute::TokensList => {
            let token_request = decode_json_body::<DatabaseIdRequest>(body, "token list request")?;
            http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
                service.list_database_tokens_with_token(&auth, &token_request.database_id)
            })
        }
        HttpUpdateRoute::TokensRevoke => {
            let token_request =
                decode_json_body::<RevokeDatabaseTokenRequest>(body, "token revoke request")?;
            http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
                service.revoke_database_token_with_token(
                    &auth,
                    &token_request.database_id,
                    &token_request.token_id,
                    now,
                )
            })
        }
        HttpUpdateRoute::MembersList => {
            let member_request =
                decode_json_body::<DatabaseIdRequest>(body, "member list request")?;
            http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
                service.list_database_members_with_token(&auth, &member_request.database_id)
            })
        }
        HttpUpdateRoute::MembersGrant => handle_http_member_grant_json(token, body, now),
        HttpUpdateRoute::MembersRevoke => handle_http_member_revoke_json(token, body, now),
        HttpUpdateRoute::DatabaseDelete => {
            let delete_request =
                decode_json_body::<DatabaseIdRequest>(body, "database delete request")?;
            http_delete_database(token, delete_request, now).await
        }
        _ => Err((404, "unknown endpoint".to_string())),
    }
}

fn handle_http_session_json(
    token: &str,
    body: &[u8],
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let session_request = decode_json_body::<DatabaseIdRequest>(body, "session request")?;
    let auth = with_service(|service| {
        service.authenticate_database_token(token, RequiredRole::Reader, now)
    })
    .map_err(|message| (http_error_status(&message), message))?;
    if auth.database_id != session_request.database_id {
        return Err((
            403,
            "api token database_id does not match request".to_string(),
        ));
    }
    Ok(json_response(
        200,
        json!({
            "database_id": auth.database_id,
            "token_id": auth.token_id,
            "scope": auth.scope,
            "role": token_scope_role(auth.scope),
        }),
    ))
}

fn handle_http_member_grant_json(
    token: &str,
    body: &[u8],
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let member_request =
        decode_json_body::<GrantDatabaseAccessRequest>(body, "member grant request")?;
    let principal = Principal::from_text(&member_request.principal)
        .map_err(|error| (400, format!("invalid principal: {error}")))?
        .to_text();
    http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
        service.grant_database_access_with_token(
            &auth,
            &member_request.database_id,
            &principal,
            member_request.role,
            now,
        )
    })
}

fn handle_http_member_revoke_json(
    token: &str,
    body: &[u8],
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let member_request =
        decode_json_body::<RevokeDatabaseAccessRequest>(body, "member revoke request")?;
    let principal = Principal::from_text(&member_request.principal)
        .map_err(|error| (400, format!("invalid principal: {error}")))?
        .to_text();
    http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
        service.revoke_database_access_with_token(&auth, &member_request.database_id, &principal)
    })
}

async fn http_create_database_token(
    owner_token: &str,
    request: CreateDatabaseTokenRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let auth = with_service(|service| {
        service.authenticate_database_token(owner_token, icpdb_runtime::RequiredRole::Owner, now)
    })
    .map_err(|error| (http_error_status(&error), error))?;
    if auth.database_id != request.database_id {
        return Err((
            400,
            "api token database_id does not match request".to_string(),
        ));
    }
    let token = random_api_token()
        .await
        .map_err(|error| (http_error_status(&error), error))?;
    let token_hash = hash_api_token(&token);
    with_service(|service| {
        service.create_database_token_with_token(&auth, request, token_hash, now)
    })
    .map(|info| json_response(200, json!(CreateDatabaseTokenResponse { token, info })))
    .map_err(|error| (http_error_status(&error), error))
}

async fn http_begin_database_archive(
    token: &str,
    request: DatabaseIdRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = hot_route_for_token(token, RequiredRole::Owner, now, &request.database_id)?;
    match route.placement.canister_id.clone() {
        Some(canister_id) => {
            let operation_hash =
                shard_request_hash(&(canister_id.clone(), request.database_id.clone()))
                    .map_err(|error| (400, error))?;
            let operation_id = begin_shard_operation_journal(
                "begin_remote_database_archive",
                Some(&request.database_id),
                operation_hash,
                now,
            )
            .map_err(|error| (http_error_status(&error), error))?;
            let remote_result = call_database_canister_with_arg::<DatabaseArchiveInfo, _>(
                &canister_id,
                "begin_database_archive_internal",
                request.database_id.clone(),
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(info) => with_service(|service| {
                    service.mark_remote_database_archiving_with_token(
                        &route.auth,
                        &request.database_id,
                        now,
                    )
                })
                .map(|_| info),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            http_json_result(result)
        }
        None => http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
            service.begin_database_archive_with_token(&auth, &request.database_id, now)
        }),
    }
}

async fn http_read_database_archive(
    token: &str,
    request: DatabaseArchiveReadRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = route_for_token(
        token,
        RequiredRole::Owner,
        now,
        &request.database_id,
        &[DatabaseStatus::Archiving],
    )?;
    let result = match route.placement.canister_id {
        Some(canister_id) => {
            call_database_canister_with_arg(
                &canister_id,
                "read_database_archive_chunk_internal",
                request,
            )
            .await
        }
        None => with_service(|service| {
            service
                .read_database_archive_chunk_with_token(
                    &route.auth,
                    &request.database_id,
                    request.offset,
                    request.max_bytes,
                )
                .map(|bytes| DatabaseArchiveChunk { bytes })
        }),
    };
    http_json_result(result)
}

async fn http_finalize_database_archive(
    token: &str,
    request: DatabaseArchiveFinalizeRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = route_for_token(
        token,
        RequiredRole::Owner,
        now,
        &request.database_id,
        &[DatabaseStatus::Archiving],
    )?;
    match route.placement.canister_id.clone() {
        Some(canister_id) => {
            let operation_hash = shard_request_hash(&(
                canister_id.clone(),
                request.database_id.clone(),
                request.snapshot_hash.clone(),
            ))
            .map_err(|error| (400, error))?;
            let operation_id = begin_shard_operation_journal(
                "finalize_remote_database_archive",
                Some(&request.database_id),
                operation_hash,
                now,
            )
            .map_err(|error| (http_error_status(&error), error))?;
            let remote_result = call_database_canister_with_arg::<(), _>(
                &canister_id,
                "finalize_database_archive_internal",
                request.clone(),
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(()) => with_service(|service| {
                    service.mark_remote_database_archived_with_token(
                        &route.auth,
                        &request.database_id,
                        request.snapshot_hash,
                        now,
                    )
                }),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            http_json_result(result)
        }
        None => {
            let result = with_service(|service| {
                service.finalize_database_archive_with_token(
                    &route.auth,
                    &request.database_id,
                    request.snapshot_hash,
                    now,
                )
            });
            match result {
                Ok(meta) => {
                    unmount_database_file(&meta.db_file_name);
                    Ok(json_response(200, json!(null)))
                }
                Err(error) => Err((http_error_status(&error), error)),
            }
        }
    }
}

async fn http_cancel_database_archive(
    token: &str,
    request: DatabaseIdRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = route_for_token(
        token,
        RequiredRole::Owner,
        now,
        &request.database_id,
        &[DatabaseStatus::Archiving],
    )?;
    match route.placement.canister_id.clone() {
        Some(canister_id) => {
            let operation_hash =
                shard_request_hash(&(canister_id.clone(), request.database_id.clone()))
                    .map_err(|error| (400, error))?;
            let operation_id = begin_shard_operation_journal(
                "cancel_remote_database_archive",
                Some(&request.database_id),
                operation_hash,
                now,
            )
            .map_err(|error| (http_error_status(&error), error))?;
            let remote_result = call_database_canister_with_arg::<(), _>(
                &canister_id,
                "cancel_database_archive_internal",
                request.database_id.clone(),
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(()) => with_service(|service| {
                    service.database_usage_with_token(&route.auth, &request.database_id)
                })
                .and_then(|usage| {
                    with_service(|service| {
                        service.mark_remote_database_hot_with_token(
                            &route.auth,
                            &request.database_id,
                            usage.logical_size_bytes,
                            now,
                        )
                    })
                }),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            http_json_result(result)
        }
        None => http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
            service
                .cancel_database_archive_with_token(&auth, &request.database_id, now)
                .map(|_| ())
        }),
    }
}

async fn http_delete_database(
    token: &str,
    request: DatabaseIdRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = route_for_token(
        token,
        RequiredRole::Owner,
        now,
        &request.database_id,
        &[DatabaseStatus::Hot, DatabaseStatus::Archived],
    )?;
    match route.placement.canister_id.clone() {
        Some(canister_id) => {
            let operation_hash =
                shard_request_hash(&(request.database_id.clone(), canister_id.clone()))
                    .map_err(|error| (400, error))?;
            let operation_id = begin_shard_operation_journal(
                "delete_remote_database",
                Some(&request.database_id),
                operation_hash,
                now,
            )
            .map_err(|error| (http_error_status(&error), error))?;
            let remote_result = call_database_canister_with_arg::<(), _>(
                &canister_id,
                "delete_database_slot",
                request.database_id.clone(),
            )
            .await;
            let result = match &remote_result {
                Ok(()) => with_service(|service| {
                    service.mark_remote_database_deleted_with_token(
                        &route.auth,
                        &request.database_id,
                        now,
                    )
                }),
                Err(error) => Err(error.clone()),
            };
            let status = match (&remote_result, &result) {
                (Err(_), _) => RoutedOperationStatus::Failed,
                (Ok(()), Ok(())) => RoutedOperationStatus::Applied,
                (Ok(()), Err(_)) => RoutedOperationStatus::Unknown,
            };
            let error = result.as_ref().err().map(String::as_str);
            finish_shard_operation_journal_with_status(&operation_id, status, error, now_millis());
            http_json_result(result.map(|_| ()))
        }
        None => {
            let result = with_service(|service| {
                service.delete_database_with_token(&route.auth, &request.database_id, now)
            });
            match result {
                Ok(meta) => {
                    unmount_database_file(&meta.db_file_name);
                    Ok(json_response(200, json!(null)))
                }
                Err(error) => Err((http_error_status(&error), error)),
            }
        }
    }
}

async fn http_begin_database_restore(
    token: &str,
    request: DatabaseRestoreBeginRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = route_for_token(
        token,
        RequiredRole::Owner,
        now,
        &request.database_id,
        &[DatabaseStatus::Archived, DatabaseStatus::Deleted],
    )?;
    match route.placement.canister_id.clone() {
        Some(canister_id) => {
            let operation_hash = shard_request_hash(&(
                canister_id.clone(),
                request.database_id.clone(),
                request.snapshot_hash.clone(),
                request.size_bytes,
            ))
            .map_err(|error| (400, error))?;
            let operation_id = begin_shard_operation_journal(
                "begin_remote_database_restore",
                Some(&request.database_id),
                operation_hash,
                now,
            )
            .map_err(|error| (http_error_status(&error), error))?;
            let remote_result = call_database_canister_with_arg::<DatabaseInfo, _>(
                &canister_id,
                "begin_database_restore_internal",
                request.clone(),
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(_) => with_service(|service| {
                    service.mark_remote_database_restoring_with_token(
                        &route.auth,
                        &request.database_id,
                        request.snapshot_hash,
                        request.size_bytes,
                        now,
                    )
                }),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            http_json_result(result)
        }
        None => {
            let result = with_service(|service| {
                service.begin_database_restore_session_with_token(
                    &route.auth,
                    &request.database_id,
                    request.snapshot_hash,
                    request.size_bytes,
                    now,
                )
            });
            let restore = result.map_err(|error| (http_error_status(&error), error))?;
            if let Err(error) = mount_database_file(&restore.meta) {
                let rollback_error = with_service(|service| {
                    service.rollback_database_restore_begin(restore.rollback, now)
                })
                .err();
                let message = match rollback_error {
                    Some(rollback_error) => {
                        format!("{error}; restore rollback failed: {rollback_error}")
                    }
                    None => error,
                };
                return Err((400, message));
            }
            Ok(json_response(200, json!(null)))
        }
    }
}

async fn http_write_database_restore(
    token: &str,
    request: DatabaseRestoreChunkRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = route_for_token(
        token,
        RequiredRole::Owner,
        now,
        &request.database_id,
        &[DatabaseStatus::Restoring],
    )?;
    match route.placement.canister_id {
        Some(canister_id) => {
            let result = call_database_canister_with_arg::<(), _>(
                &canister_id,
                "write_database_restore_chunk_internal",
                request,
            )
            .await;
            http_json_result(result)
        }
        None => http_json_with_token(token, RequiredRole::Owner, now, |service, auth| {
            service.write_database_restore_chunk_with_token(
                &auth,
                &request.database_id,
                request.offset,
                &request.bytes,
            )
        }),
    }
}

async fn http_finalize_database_restore(
    token: &str,
    request: DatabaseIdRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = route_for_token(
        token,
        RequiredRole::Owner,
        now,
        &request.database_id,
        &[DatabaseStatus::Restoring],
    )?;
    match route.placement.canister_id.clone() {
        Some(canister_id) => {
            let operation_hash =
                shard_request_hash(&(canister_id.clone(), request.database_id.clone()))
                    .map_err(|error| (400, error))?;
            let operation_id = begin_shard_operation_journal(
                "finalize_remote_database_restore",
                Some(&request.database_id),
                operation_hash,
                now,
            )
            .map_err(|error| (http_error_status(&error), error))?;
            let remote_result = call_database_canister_with_arg::<DatabaseInfo, _>(
                &canister_id,
                "finalize_database_restore_internal",
                request.database_id.clone(),
            )
            .await;
            let remote_succeeded = remote_result.is_ok();
            let result = match remote_result {
                Ok(info) => with_service(|service| {
                    service.mark_remote_database_hot_with_token(
                        &route.auth,
                        &request.database_id,
                        info.logical_size_bytes,
                        now,
                    )
                }),
                Err(error) => Err(error),
            };
            finish_remote_lifecycle_operation_journal(
                &operation_id,
                remote_succeeded,
                &result,
                now_millis(),
            );
            http_json_result(result)
        }
        None => {
            let result = with_service(|service| {
                service
                    .prepare_database_restore_finalize_with_token(&route.auth, &request.database_id)
                    .map(|meta| (route.auth, meta))
            });
            let (auth, meta) = result.map_err(|error| (http_error_status(&error), error))?;
            mount_database_file(&meta).map_err(|error| (400, error))?;
            let result = with_service(|service| {
                service.complete_database_restore_with_token(&auth, &request.database_id, now)
            });
            match result {
                Ok(_) => Ok(json_response(200, json!(null))),
                Err(error) => {
                    unmount_database_file(&meta.db_file_name);
                    Err((http_error_status(&error), error))
                }
            }
        }
    }
}

struct RoutedTokenAuth {
    auth: AuthenticatedDatabaseToken,
    placement: DatabaseShardPlacement,
}

struct RemoteWriteContext<'a> {
    canister_id: &'a str,
    internal_method: &'static str,
    operation_id: &'a str,
    billing_units: u64,
    usage: HttpUsageContext<'a>,
}

struct RemotePrincipalWriteContext<'a> {
    canister_id: &'a str,
    internal_method: &'static str,
    operation_id: &'a str,
    billing_units: u64,
    now: i64,
    method: &'static str,
    operation: Option<&'a str>,
    database_id: &'a str,
}

fn hot_route_for_caller(
    caller: &str,
    required_role: RequiredRole,
    database_id: &str,
) -> Result<DatabaseShardPlacement, String> {
    with_service(|service| service.hot_database_route(database_id, caller, required_role))
}

fn route_for_caller(
    caller: &str,
    required_role: RequiredRole,
    database_id: &str,
    allowed_statuses: &[DatabaseStatus],
) -> Result<DatabaseShardPlacement, String> {
    with_service(|service| {
        service.database_route(database_id, caller, required_role, allowed_statuses)
    })
}

fn hot_route_for_token(
    token: &str,
    required_role: RequiredRole,
    now: i64,
    database_id: &str,
) -> Result<RoutedTokenAuth, (u16, String)> {
    with_service(|service| {
        let auth = service.authenticate_database_token(token, required_role, now)?;
        let placement = service.hot_database_route_with_token(&auth, database_id, required_role)?;
        Ok(RoutedTokenAuth { auth, placement })
    })
    .map_err(|error| (http_error_status(&error), error))
}

fn route_for_token(
    token: &str,
    required_role: RequiredRole,
    now: i64,
    database_id: &str,
    allowed_statuses: &[DatabaseStatus],
) -> Result<RoutedTokenAuth, (u16, String)> {
    with_service(|service| {
        let auth = service.authenticate_database_token(token, required_role, now)?;
        let placement = service.database_route_with_token(
            &auth,
            database_id,
            required_role,
            allowed_statuses,
        )?;
        Ok(RoutedTokenAuth { auth, placement })
    })
    .map_err(|error| (http_error_status(&error), error))
}

async fn http_sql_query_with_token(
    token: &str,
    request: SqlExecuteRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = hot_route_for_token(token, RequiredRole::Reader, now, &request.database_id)?;
    let result = match route.placement.canister_id {
        Some(ref canister_id) => {
            call_database_canister_with_arg(canister_id, "sql_query_internal", request).await
        }
        None => with_service(|service| service.sql_query_with_token(&route.auth, request)),
    };
    http_json_result(result)
}

async fn http_sql_execute_with_token(
    token: &str,
    headers: &[HeaderField],
    request: SqlExecuteRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let database_id = request.database_id.clone();
    let operation = sql_operation(&request.sql);
    let route = hot_route_for_token(token, RequiredRole::Writer, now, &database_id)?;
    match route.placement.canister_id.clone() {
        Some(canister_id) => {
            let operation_id = idempotency_key(headers)
                .ok_or_else(|| (400, "missing idempotency-key header".to_string()))?;
            let result = remote_sql_write_with_token(
                route,
                &request,
                DataPlaneSqlExecuteRequest {
                    operation_id: operation_id.to_string(),
                    request: request.clone(),
                },
                RemoteWriteContext {
                    canister_id: &canister_id,
                    internal_method: "sql_execute_internal",
                    operation_id,
                    billing_units: SQL_EXECUTE_BILLING_UNITS,
                    usage: HttpUsageContext {
                        required_role: RequiredRole::Writer,
                        now,
                        method: "sql_execute",
                        operation: operation.as_deref(),
                        database_id: &database_id,
                    },
                },
                sql_response_usage_metrics,
                applied_replay_sql_response,
            )
            .await
            .map(|response| sql_response_with_routed_operation_id(response, operation_id));
            http_json_result(result)
        }
        None => http_json_with_token_usage_metrics(
            token,
            HttpUsageContext {
                required_role: RequiredRole::Writer,
                now,
                method: "sql_execute",
                operation: operation.as_deref(),
                database_id: &database_id,
            },
            |service, auth| service.sql_execute_with_token(&auth, request),
            sql_response_usage_metrics,
        ),
    }
}

async fn http_sql_batch_with_token(
    token: &str,
    headers: &[HeaderField],
    request: SqlBatchRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let database_id = request.database_id.clone();
    let operation = sql_batch_operation(&request);
    let billing_units =
        SQL_EXECUTE_BILLING_UNITS.saturating_mul(request.statements.len().max(1) as u64);
    let route = hot_route_for_token(token, RequiredRole::Writer, now, &database_id)?;
    match route.placement.canister_id.clone() {
        Some(canister_id) => {
            let operation_id = idempotency_key(headers)
                .ok_or_else(|| (400, "missing idempotency-key header".to_string()))?;
            let statement_count = request.statements.len();
            let result = remote_sql_write_with_token(
                route,
                &request,
                DataPlaneSqlBatchRequest {
                    operation_id: operation_id.to_string(),
                    request: request.clone(),
                },
                RemoteWriteContext {
                    canister_id: &canister_id,
                    internal_method: "sql_batch_internal",
                    operation_id,
                    billing_units,
                    usage: HttpUsageContext {
                        required_role: RequiredRole::Writer,
                        now,
                        method: "sql_batch",
                        operation: operation.as_deref(),
                        database_id: &database_id,
                    },
                },
                |responses: &Vec<SqlExecuteResponse>| sql_batch_usage_metrics(responses),
                || applied_replay_sql_batch_response(statement_count),
            )
            .await
            .map(|responses| sql_batch_response_with_routed_operation_id(responses, operation_id));
            http_json_result(result)
        }
        None => http_json_with_token_usage_metrics(
            token,
            HttpUsageContext {
                required_role: RequiredRole::Writer,
                now,
                method: "sql_batch",
                operation: operation.as_deref(),
                database_id: &database_id,
            },
            |service, auth| service.sql_batch_with_token(&auth, request),
            |responses| sql_batch_usage_metrics(responses),
        ),
    }
}

async fn http_list_tables_with_token(
    token: &str,
    request: DatabaseIdRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = hot_route_for_token(token, RequiredRole::Reader, now, &request.database_id)?;
    let result = match route.placement.canister_id {
        Some(canister_id) => {
            call_database_canister_with_arg(
                &canister_id,
                "list_tables_internal",
                request.database_id,
            )
            .await
        }
        None => with_service(|service| {
            service.list_tables_with_token(&route.auth, &request.database_id)
        }),
    };
    http_json_result(result)
}

async fn http_describe_table_with_token(
    token: &str,
    request: DescribeTableRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = hot_route_for_token(token, RequiredRole::Reader, now, &request.database_id)?;
    let result = match route.placement.canister_id {
        Some(canister_id) => {
            call_database_canister_describe(&canister_id, request.database_id, request.table_name)
                .await
        }
        None => with_service(|service| {
            service.describe_table_with_token(
                &route.auth,
                &request.database_id,
                &request.table_name,
            )
        }),
    };
    http_json_result(result)
}

async fn http_preview_table_with_token(
    token: &str,
    request: TablePreviewRequest,
    now: i64,
) -> Result<HttpUpdateResponse, (u16, String)> {
    let route = hot_route_for_token(token, RequiredRole::Reader, now, &request.database_id)?;
    let result = match route.placement.canister_id {
        Some(canister_id) => {
            call_database_canister_with_arg(&canister_id, "preview_table_internal", request).await
        }
        None => with_service(|service| service.preview_table_with_token(&route.auth, request)),
    };
    http_json_result(result)
}

async fn remote_sql_write_with_token<T, H, A, M>(
    route: RoutedTokenAuth,
    hash_request: &H,
    call_request: A,
    context: RemoteWriteContext<'_>,
    metrics: M,
    applied_replay_response: impl FnOnce() -> T,
) -> Result<T, String>
where
    T: CandidType + for<'de> Deserialize<'de> + serde::Serialize,
    H: serde::Serialize,
    A: CandidType,
    M: FnOnce(&T) -> (u64, u64),
{
    let request_hash = routed_request_hash(context.internal_method, hash_request)?;
    let started = with_service(|service| {
        service.begin_routed_write_with_token(
            &route.auth,
            RoutedWriteBegin {
                operation_id: context.operation_id,
                database_canister_id: context.canister_id,
                method: context.internal_method,
                request_hash,
                billing_units: context.billing_units,
                now: context.usage.now,
            },
        )
    })?;
    match started.status {
        RoutedOperationStatus::Pending | RoutedOperationStatus::Failed => {}
        RoutedOperationStatus::Applied => return Ok(applied_replay_response()),
        RoutedOperationStatus::Unknown => {
            return Err("routed operation outcome is unknown".to_string());
        }
    }

    let before_cycles = cycle_balance();
    let result =
        call_database_canister_with_arg(context.canister_id, context.internal_method, call_request)
            .await;
    let after_cycles = cycle_balance();
    let cycles_delta = before_cycles.saturating_sub(after_cycles);
    match result {
        Ok(response) => {
            let usage = call_database_canister_with_arg::<DatabaseUsage, _>(
                context.canister_id,
                "database_usage_internal",
                context.usage.database_id.to_string(),
            )
            .await;
            match usage {
                Ok(usage) => {
                    let completion = with_service(|service| {
                        service.complete_routed_write_with_token(
                            &route.auth,
                            context.operation_id,
                            context.billing_units,
                            usage.logical_size_bytes,
                            context.usage.now,
                        )
                    });
                    if let Err(error) = completion {
                        mark_routed_write_completion_failed(
                            context.operation_id,
                            &error,
                            context.usage.now,
                        );
                        record_token_usage(
                            &route.auth,
                            &context.usage,
                            false,
                            cycles_delta,
                            0,
                            0,
                            Some(&error),
                        );
                        return Err(error);
                    }
                    let (rows_returned, rows_affected) = metrics(&response);
                    record_token_usage(
                        &route.auth,
                        &context.usage,
                        true,
                        cycles_delta,
                        rows_returned,
                        rows_affected,
                        None,
                    );
                    Ok(response)
                }
                Err(error) => {
                    let _ = with_service(|service| {
                        service.update_routed_operation_status(
                            context.operation_id,
                            RoutedOperationStatus::Unknown,
                            Some(&error),
                            context.usage.now,
                        )
                    });
                    record_token_usage(
                        &route.auth,
                        &context.usage,
                        false,
                        cycles_delta,
                        0,
                        0,
                        Some(&error),
                    );
                    Err(error)
                }
            }
        }
        Err(error) => {
            let _ = with_service(|service| {
                service.update_routed_operation_status(
                    context.operation_id,
                    RoutedOperationStatus::Failed,
                    Some(&error),
                    context.usage.now,
                )
            });
            record_token_usage(
                &route.auth,
                &context.usage,
                false,
                cycles_delta,
                0,
                0,
                Some(&error),
            );
            Err(error)
        }
    }
}

async fn remote_sql_write_for_caller<T, H, A, M>(
    caller: &str,
    hash_request: &H,
    call_request: A,
    context: RemotePrincipalWriteContext<'_>,
    metrics: M,
    applied_replay_response: impl FnOnce() -> T,
) -> Result<T, String>
where
    T: CandidType + for<'de> Deserialize<'de> + serde::Serialize,
    H: serde::Serialize,
    A: CandidType,
    M: FnOnce(&T) -> (u64, u64),
{
    let request_hash = routed_request_hash(context.internal_method, hash_request)?;
    let started = with_service(|service| {
        service.begin_routed_write(
            caller,
            context.database_id,
            RoutedWriteBegin {
                operation_id: context.operation_id,
                database_canister_id: context.canister_id,
                method: context.internal_method,
                request_hash,
                billing_units: context.billing_units,
                now: context.now,
            },
        )
    })?;
    match started.status {
        RoutedOperationStatus::Pending | RoutedOperationStatus::Failed => {}
        RoutedOperationStatus::Applied => return Ok(applied_replay_response()),
        RoutedOperationStatus::Unknown => {
            return Err("routed operation outcome is unknown".to_string());
        }
    }

    let before_cycles = cycle_balance();
    let result =
        call_database_canister_with_arg(context.canister_id, context.internal_method, call_request)
            .await;
    let after_cycles = cycle_balance();
    let cycles_delta = before_cycles.saturating_sub(after_cycles);
    match result {
        Ok(response) => {
            let usage = call_database_canister_with_arg::<DatabaseUsage, _>(
                context.canister_id,
                "database_usage_internal",
                context.database_id.to_string(),
            )
            .await;
            match usage {
                Ok(usage) => {
                    let completion = with_service(|service| {
                        service.complete_routed_write(
                            caller,
                            context.database_id,
                            context.operation_id,
                            context.billing_units,
                            usage.logical_size_bytes,
                            context.now,
                        )
                    });
                    if let Err(error) = completion {
                        mark_routed_write_completion_failed(
                            context.operation_id,
                            &error,
                            context.now,
                        );
                        record_principal_usage(
                            caller,
                            &context,
                            false,
                            cycles_delta,
                            0,
                            0,
                            Some(&error),
                        );
                        return Err(error);
                    }
                    let (rows_returned, rows_affected) = metrics(&response);
                    record_principal_usage(
                        caller,
                        &context,
                        true,
                        cycles_delta,
                        rows_returned,
                        rows_affected,
                        None,
                    );
                    Ok(response)
                }
                Err(error) => {
                    let _ = with_service(|service| {
                        service.update_routed_operation_status(
                            context.operation_id,
                            RoutedOperationStatus::Unknown,
                            Some(&error),
                            context.now,
                        )
                    });
                    record_principal_usage(
                        caller,
                        &context,
                        false,
                        cycles_delta,
                        0,
                        0,
                        Some(&error),
                    );
                    Err(error)
                }
            }
        }
        Err(error) => {
            let _ = with_service(|service| {
                service.update_routed_operation_status(
                    context.operation_id,
                    RoutedOperationStatus::Failed,
                    Some(&error),
                    context.now,
                )
            });
            record_principal_usage(caller, &context, false, cycles_delta, 0, 0, Some(&error));
            Err(error)
        }
    }
}

async fn call_database_canister_with_arg<T, A>(
    canister_id: &str,
    method: &'static str,
    arg: A,
) -> Result<T, String>
where
    T: CandidType + for<'de> Deserialize<'de>,
    A: CandidType,
{
    let principal = Principal::from_text(canister_id)
        .map_err(|error| format!("invalid database canister id: {error}"))?;
    let response = Call::bounded_wait(principal, method)
        .with_arg(arg)
        .await
        .map_err(|error| format!("database canister call failed: {error}"))?;
    let decoded: Result<T, String> = response
        .candid()
        .map_err(|error| format!("database canister response decode failed: {error}"))?;
    decoded
}

async fn call_database_canister_describe(
    canister_id: &str,
    database_id: String,
    table_name: String,
) -> Result<TableDescription, String> {
    let principal = Principal::from_text(canister_id)
        .map_err(|error| format!("invalid database canister id: {error}"))?;
    let response = Call::bounded_wait(principal, "describe_table_internal")
        .with_args(&(database_id, table_name))
        .await
        .map_err(|error| format!("database canister call failed: {error}"))?;
    let decoded: Result<TableDescription, String> = response
        .candid()
        .map_err(|error| format!("database canister response decode failed: {error}"))?;
    decoded
}

fn http_json_result<T>(result: Result<T, String>) -> Result<HttpUpdateResponse, (u16, String)>
where
    T: serde::Serialize,
{
    result
        .and_then(|response| serde_json::to_value(response).map_err(|error| error.to_string()))
        .map(|value| json_response(200, value))
        .map_err(|error| (http_error_status(&error), error))
}

fn http_json_with_token<T>(
    token: &str,
    required_role: icpdb_runtime::RequiredRole,
    now: i64,
    f: impl FnOnce(&IcpdbService, icpdb_runtime::AuthenticatedDatabaseToken) -> Result<T, String>,
) -> Result<HttpUpdateResponse, (u16, String)>
where
    T: serde::Serialize,
{
    with_service(|service| {
        let auth = service.authenticate_database_token(token, required_role, now)?;
        f(service, auth)
    })
    .and_then(|response| {
        serde_json::to_value(response)
            .map_err(|error| error.to_string())
            .map(|value| json_response(200, value))
    })
    .map_err(|error| (http_error_status(&error), error))
}

fn http_json_with_token_usage_metrics<T>(
    token: &str,
    context: HttpUsageContext<'_>,
    f: impl FnOnce(&IcpdbService, icpdb_runtime::AuthenticatedDatabaseToken) -> Result<T, String>,
    metrics: impl FnOnce(&T) -> (u64, u64),
) -> Result<HttpUpdateResponse, (u16, String)>
where
    T: serde::Serialize,
{
    let before_cycles = cycle_balance();
    with_service(|service| {
        let auth =
            service.authenticate_database_token(token, context.required_role, context.now)?;
        let caller = format!("api_token:{}", auth.token_id);
        let result = f(service, auth);
        let after_cycles = cycle_balance();
        let cycles_delta = before_cycles.saturating_sub(after_cycles);
        let error = result.as_ref().err().map(String::as_str);
        let (rows_returned, rows_affected) = match result.as_ref() {
            Ok(value) => metrics(value),
            Err(_) => (0, 0),
        };
        let _ = service.record_usage_event(UsageEvent {
            method: context.method,
            operation: context.operation,
            database_id: Some(context.database_id),
            caller: &caller,
            success: result.is_ok(),
            cycles_delta,
            rows_returned,
            rows_affected,
            error,
            now: context.now,
        });
        result
    })
    .and_then(|response| {
        serde_json::to_value(response)
            .map_err(|error| error.to_string())
            .map(|value| json_response(200, value))
    })
    .map_err(|error| (http_error_status(&error), error))
}

fn record_token_usage(
    auth: &AuthenticatedDatabaseToken,
    context: &HttpUsageContext<'_>,
    success: bool,
    cycles_delta: u128,
    rows_returned: u64,
    rows_affected: u64,
    error: Option<&str>,
) {
    let caller = format!("api_token:{}", auth.token_id);
    let _ = with_service(|service| {
        service.record_usage_event(UsageEvent {
            method: context.method,
            operation: context.operation,
            database_id: Some(context.database_id),
            caller: &caller,
            success,
            cycles_delta,
            rows_returned,
            rows_affected,
            error,
            now: context.now,
        })
    });
}

fn record_principal_usage(
    caller: &str,
    context: &RemotePrincipalWriteContext<'_>,
    success: bool,
    cycles_delta: u128,
    rows_returned: u64,
    rows_affected: u64,
    error: Option<&str>,
) {
    let _ = with_service(|service| {
        service.record_usage_event(UsageEvent {
            method: context.method,
            operation: context.operation,
            database_id: Some(context.database_id),
            caller,
            success,
            cycles_delta,
            rows_returned,
            rows_affected,
            error,
            now: context.now,
        })
    });
}

fn next_candid_routed_operation_id<T>(method: &str, request: &T) -> Result<String, String>
where
    T: serde::Serialize,
{
    let mut hash = routed_request_hash(method, request)?;
    hash.extend_from_slice(caller_text().as_bytes());
    hash.extend_from_slice(&now_nanos().to_be_bytes());
    let suffix = base32_lower(&hash);
    Ok(format!(
        "icpdb-candid-{method}-{}-{}",
        now_nanos(),
        &suffix[..suffix.len().min(26)]
    ))
}

fn candid_routed_operation_id<T>(method: &str, request: &T) -> Result<String, String>
where
    T: serde::Serialize + CandidSqlIdempotencyKey,
{
    match request.candid_idempotency_key() {
        Some(key) => Ok(key.to_string()),
        None => next_candid_routed_operation_id(method, request),
    }
}

trait CandidSqlIdempotencyKey {
    fn candid_idempotency_key(&self) -> Option<&str>;
}

impl CandidSqlIdempotencyKey for SqlExecuteRequest {
    fn candid_idempotency_key(&self) -> Option<&str> {
        self.idempotency_key.as_deref()
    }
}

impl CandidSqlIdempotencyKey for SqlBatchRequest {
    fn candid_idempotency_key(&self) -> Option<&str> {
        self.idempotency_key.as_deref()
    }
}

fn routed_request_hash<T>(method: &str, request: &T) -> Result<Vec<u8>, String>
where
    T: serde::Serialize,
{
    let bytes = serde_json::to_vec(request).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(method.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    Ok(hasher.finalize().to_vec())
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
    F: FnOnce(&IcpdbService, &str, i64) -> Result<T, String>,
{
    with_usage_metrics(method, None, database_id, f, |_| (0, 0))
}

fn with_usage_metrics<T, F, M>(
    method: &str,
    operation: Option<&str>,
    database_id: Option<String>,
    f: F,
    metrics: M,
) -> Result<T, String>
where
    F: FnOnce(&IcpdbService, &str, i64) -> Result<T, String>,
    M: FnOnce(&T) -> (u64, u64),
{
    let caller = caller_text();
    let now = now_millis();
    let before_cycles = cycle_balance();
    SERVICE.with(|slot| {
        let borrowed = slot.borrow();
        let service = borrowed
            .as_ref()
            .ok_or_else(|| "icpdb service is not initialized".to_string())?;
        let result = f(service, &caller, now);
        let after_cycles = cycle_balance();
        let cycles_delta = before_cycles.saturating_sub(after_cycles);
        let error = result.as_ref().err().map(String::as_str);
        let (rows_returned, rows_affected) = match result.as_ref() {
            Ok(value) => metrics(value),
            Err(_) => (0, 0),
        };
        let _ = service.record_usage_event(UsageEvent {
            method,
            operation,
            database_id: database_id.as_deref(),
            caller: &caller,
            success: result.is_ok(),
            cycles_delta,
            rows_returned,
            rows_affected,
            error,
            now,
        });
        result
    })
}

fn sql_response_usage_metrics(response: &SqlExecuteResponse) -> (u64, u64) {
    (
        u64::try_from(response.rows.len()).unwrap_or(u64::MAX),
        response.rows_affected,
    )
}

fn sql_batch_usage_metrics(responses: &[SqlExecuteResponse]) -> (u64, u64) {
    responses
        .iter()
        .fold((0_u64, 0_u64), |(rows, affected), response| {
            let next_rows =
                rows.saturating_add(u64::try_from(response.rows.len()).unwrap_or(u64::MAX));
            let next_affected = affected.saturating_add(response.rows_affected);
            (next_rows, next_affected)
        })
}

fn applied_replay_sql_response() -> SqlExecuteResponse {
    SqlExecuteResponse {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: 0,
        last_insert_rowid: 0,
        truncated: false,
        routed_operation_id: None,
    }
}

fn applied_replay_sql_batch_response(statement_count: usize) -> Vec<SqlExecuteResponse> {
    (0..statement_count)
        .map(|_| applied_replay_sql_response())
        .collect()
}

fn sql_response_with_routed_operation_id(
    mut response: SqlExecuteResponse,
    operation_id: &str,
) -> SqlExecuteResponse {
    response.routed_operation_id = Some(operation_id.to_string());
    response
}

fn sql_batch_response_with_routed_operation_id(
    mut responses: Vec<SqlExecuteResponse>,
    operation_id: &str,
) -> Vec<SqlExecuteResponse> {
    for response in &mut responses {
        response.routed_operation_id = Some(operation_id.to_string());
    }
    responses
}

fn sql_operation(sql: &str) -> Option<String> {
    let trimmed = sql
        .trim_start_matches(|character: char| character.is_whitespace())
        .trim_start_matches(';')
        .trim_start_matches(|character: char| character.is_whitespace());
    let operation = trimmed
        .split(|character: char| character.is_whitespace() || character == ';' || character == '(')
        .next()
        .unwrap_or("")
        .trim();
    if operation.is_empty() {
        None
    } else {
        Some(operation.to_ascii_uppercase())
    }
}

fn sql_batch_operation(request: &SqlBatchRequest) -> Option<String> {
    let mut operations = Vec::new();
    for statement in &request.statements {
        let Some(operation) = sql_operation(&statement.sql) else {
            continue;
        };
        if !operations.iter().any(|value| value == &operation) {
            operations.push(operation);
        }
        if operations.len() == 3 {
            break;
        }
    }
    if operations.is_empty() {
        None
    } else {
        Some(operations.join("+"))
    }
}

fn with_service<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce(&IcpdbService) -> Result<T, String>,
{
    SERVICE.with(|slot| {
        let borrowed = slot.borrow();
        let service = borrowed
            .as_ref()
            .ok_or_else(|| "icpdb service is not initialized".to_string())?;
        f(service)
    })
}

export_service!();

pub fn candid_interface() -> String {
    __export_service()
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_sync_contract;
