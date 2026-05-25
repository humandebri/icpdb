// Where: crates/icpdb_database_canister/src/lib.rs
// What: Internal database-shard canister surface for ICPDB.
// Why: The public control canister needs a control-only data plane before real sharding.
mod state;

#[cfg(test)]
use candid::Principal;
use candid::export_service;
use ic_cdk::{init, post_upgrade, update};
use icpdb_types::{
    CreateDatabaseSlotRequest, DataPlaneOperationInfo, DataPlaneSqlBatchRequest,
    DataPlaneSqlExecuteRequest, DatabaseArchiveChunk, DatabaseArchiveFinalizeRequest,
    DatabaseArchiveInfo, DatabaseArchiveReadRequest, DatabaseCanisterInitArgs, DatabaseInfo,
    DatabaseRestoreBeginRequest, DatabaseRestoreChunkRequest, DatabaseStatus, DatabaseTable,
    DatabaseUsage, RoutedOperationRequest, SqlExecuteRequest, SqlExecuteResponse, TableDescription,
    TablePreviewRequest, TablePreviewResponse,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use state::{
    database_info_from_meta, database_operation_error, initialize_or_trap, mount_database_file,
    now_millis, require_control_caller, unmount_database_file, with_service,
};
#[cfg(test)]
use state::{initialize, set_test_caller};

#[init]
fn init(args: DatabaseCanisterInitArgs) {
    initialize_or_trap(args);
}

#[post_upgrade]
fn post_upgrade(args: DatabaseCanisterInitArgs) {
    initialize_or_trap(args);
}

#[update]
fn create_database_slot(request: CreateDatabaseSlotRequest) -> Result<DatabaseInfo, String> {
    let control = require_control_caller()?;
    with_service(|service| {
        let meta =
            service.reserve_database(&request.database_id, &control.to_text(), now_millis())?;
        if let Err(error) = mount_database_file(&meta) {
            let cleanup_error = service
                .discard_database_reservation(&meta.database_id)
                .err();
            return Err(database_operation_error(error, cleanup_error));
        }
        if let Err(error) = service.run_database_migrations(&meta.database_id) {
            unmount_database_file(&meta.db_file_name);
            let cleanup_error = service
                .discard_database_reservation(&meta.database_id)
                .err();
            return Err(database_operation_error(error, cleanup_error));
        }
        Ok(database_info_from_meta(meta, DatabaseStatus::Hot))
    })
}

#[update]
fn delete_database_slot(database_id: String) -> Result<(), String> {
    let control = require_control_caller()?;
    with_service(|service| {
        let control_text = control.to_text();
        match service.delete_database(&database_id, &control_text, now_millis()) {
            Ok(meta) => {
                unmount_database_file(&meta.db_file_name);
                Ok(())
            }
            Err(error) => match service.database_usage(&database_id, &control_text) {
                Ok(usage) if usage.status == DatabaseStatus::Deleted => Ok(()),
                _ => Err(error),
            },
        }
    })
}

#[update]
fn discard_database_slot_internal(database_id: String) -> Result<(), String> {
    require_control_caller()?;
    with_service(|service| service.discard_database_reservation(&database_id))
}

#[update]
fn database_usage_internal(database_id: String) -> Result<DatabaseUsage, String> {
    let control = require_control_caller()?;
    with_service(|service| service.database_usage(&database_id, &control.to_text()))
}

#[update]
fn list_tables_internal(database_id: String) -> Result<Vec<DatabaseTable>, String> {
    let control = require_control_caller()?;
    with_service(|service| service.list_tables(&database_id, &control.to_text()))
}

#[update]
fn describe_table_internal(
    database_id: String,
    table_name: String,
) -> Result<TableDescription, String> {
    let control = require_control_caller()?;
    with_service(|service| service.describe_table(&database_id, &table_name, &control.to_text()))
}

#[update]
fn preview_table_internal(request: TablePreviewRequest) -> Result<TablePreviewResponse, String> {
    let control = require_control_caller()?;
    with_service(|service| service.preview_table(&control.to_text(), request))
}

#[update]
fn sql_query_internal(request: SqlExecuteRequest) -> Result<SqlExecuteResponse, String> {
    let control = require_control_caller()?;
    with_service(|service| service.sql_query(&control.to_text(), request))
}

#[update]
fn sql_execute_internal(request: DataPlaneSqlExecuteRequest) -> Result<SqlExecuteResponse, String> {
    let control = require_control_caller()?;
    let request_hash = data_plane_request_hash("sql_execute_internal", &request.request)?;
    let operation_id = request.operation_id.clone();
    let database_id = request.request.database_id.clone();
    with_service(|service| {
        if let Some(existing) = service.data_plane_operation(&operation_id)? {
            validate_applied_operation(
                &existing,
                &database_id,
                "sql_execute_internal",
                &request_hash,
            )?;
            return Err(format!(
                "data-plane operation already applied: {operation_id}"
            ));
        }
        let response = service.sql_execute_data_plane(&control.to_text(), request.request)?;
        service.record_data_plane_operation(
            &operation_id,
            &database_id,
            "sql_execute_internal",
            request_hash,
            now_millis(),
        )?;
        Ok(response)
    })
}

#[update]
fn sql_batch_internal(
    request: DataPlaneSqlBatchRequest,
) -> Result<Vec<SqlExecuteResponse>, String> {
    let control = require_control_caller()?;
    let request_hash = data_plane_request_hash("sql_batch_internal", &request.request)?;
    let operation_id = request.operation_id.clone();
    let database_id = request.request.database_id.clone();
    with_service(|service| {
        if let Some(existing) = service.data_plane_operation(&operation_id)? {
            validate_applied_operation(
                &existing,
                &database_id,
                "sql_batch_internal",
                &request_hash,
            )?;
            return Err(format!(
                "data-plane operation already applied: {operation_id}"
            ));
        }
        let response = service.sql_batch_data_plane(&control.to_text(), request.request)?;
        service.record_data_plane_operation(
            &operation_id,
            &database_id,
            "sql_batch_internal",
            request_hash,
            now_millis(),
        )?;
        Ok(response)
    })
}

#[update]
fn get_data_plane_operation_internal(
    request: RoutedOperationRequest,
) -> Result<Option<DataPlaneOperationInfo>, String> {
    require_control_caller()?;
    with_service(|service| {
        let operation = service.data_plane_operation(&request.operation_id)?;
        if operation
            .as_ref()
            .is_some_and(|info| info.database_id != request.database_id)
        {
            return Err("data-plane operation database_id mismatch".to_string());
        }
        Ok(operation)
    })
}

#[update]
fn begin_database_archive_internal(database_id: String) -> Result<DatabaseArchiveInfo, String> {
    let control = require_control_caller()?;
    with_service(|service| {
        service.begin_database_archive(&database_id, &control.to_text(), now_millis())
    })
}

#[update]
fn read_database_archive_chunk_internal(
    request: DatabaseArchiveReadRequest,
) -> Result<DatabaseArchiveChunk, String> {
    let control = require_control_caller()?;
    with_service(|service| {
        service
            .read_database_archive_chunk(
                &request.database_id,
                &control.to_text(),
                request.offset,
                request.max_bytes,
            )
            .map(|bytes| DatabaseArchiveChunk { bytes })
    })
}

#[update]
fn finalize_database_archive_internal(
    request: DatabaseArchiveFinalizeRequest,
) -> Result<(), String> {
    let control = require_control_caller()?;
    with_service(|service| {
        let meta = service.finalize_database_archive(
            &request.database_id,
            &control.to_text(),
            request.snapshot_hash,
            now_millis(),
        )?;
        unmount_database_file(&meta.db_file_name);
        Ok(())
    })
}

#[update]
fn cancel_database_archive_internal(database_id: String) -> Result<(), String> {
    let control = require_control_caller()?;
    with_service(|service| {
        service.cancel_database_archive(&database_id, &control.to_text(), now_millis())?;
        Ok(())
    })
}

#[update]
fn begin_database_restore_internal(
    request: DatabaseRestoreBeginRequest,
) -> Result<DatabaseInfo, String> {
    let control = require_control_caller()?;
    with_service(|service| {
        let restore = service.begin_database_restore_session(
            &request.database_id,
            &control.to_text(),
            request.snapshot_hash,
            request.size_bytes,
            now_millis(),
        )?;
        if let Err(error) = mount_database_file(&restore.meta) {
            let rollback_error = service
                .rollback_database_restore_begin(restore.rollback, now_millis())
                .err();
            return Err(database_operation_error(error, rollback_error));
        }
        Ok(database_info_from_meta(
            restore.meta,
            DatabaseStatus::Restoring,
        ))
    })
}

#[update]
fn write_database_restore_chunk_internal(
    request: DatabaseRestoreChunkRequest,
) -> Result<(), String> {
    let control = require_control_caller()?;
    with_service(|service| {
        service.write_database_restore_chunk(
            &request.database_id,
            &control.to_text(),
            request.offset,
            &request.bytes,
        )
    })
}

#[update]
fn finalize_database_restore_internal(database_id: String) -> Result<DatabaseInfo, String> {
    let control = require_control_caller()?;
    with_service(|service| {
        service.prepare_database_restore_finalize(&database_id, &control.to_text())?;
        let meta =
            service.complete_database_restore(&database_id, &control.to_text(), now_millis())?;
        Ok(database_info_from_meta(meta, DatabaseStatus::Hot))
    })
}

fn data_plane_request_hash<T>(method: &str, request: &T) -> Result<Vec<u8>, String>
where
    T: Serialize,
{
    let bytes = serde_json::to_vec(request).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(method.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    Ok(hasher.finalize().to_vec())
}

fn validate_applied_operation(
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

export_service!();

pub fn candid_service() -> String {
    __export_service()
}

#[cfg(test)]
mod tests;
