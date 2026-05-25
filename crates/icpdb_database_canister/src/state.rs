// Where: crates/icpdb_database_canister/src/state.rs
// What: State, storage handles, and guard helpers for the database canister.
// Why: Entrypoints stay small while memory registration and control-caller checks stay shared.
use std::cell::RefCell;

use candid::Principal;
use ic_sqlite_vfs::{DbHandle, DefaultMemoryImpl, MemoryId, MemoryManager};
use icpdb_runtime::{DatabaseMeta, IcpdbService};
use icpdb_types::{DatabaseCanisterInitArgs, DatabaseInfo, DatabaseStatus};

const INDEX_DB_PATH: &str = "./DB/index.sqlite3";
const DATABASES_DIR: &str = "./DB/databases";
const INDEX_DB_MEMORY_ID: u8 = 10;
const DATABASE_MEMORY_MIN: u8 = 11;
const DATABASE_MEMORY_MAX: u8 = 254;

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static SERVICE: RefCell<Option<IcpdbService>> = const { RefCell::new(None) };
    static DATABASE_HANDLES: RefCell<Vec<(String, DbHandle)>> = const { RefCell::new(Vec::new()) };
    static CONTROL_CANISTER: RefCell<Option<Principal>> = const { RefCell::new(None) };
    #[cfg(test)]
    static TEST_CALLER: RefCell<Principal> =
        RefCell::new(Principal::from_text("aaaaa-aa").expect("principal should parse"));
}

pub(crate) fn initialize_or_trap(args: DatabaseCanisterInitArgs) {
    initialize(args).unwrap_or_else(|error| ic_cdk::trap(&error));
}

pub(crate) fn initialize(args: DatabaseCanisterInitArgs) -> Result<(), String> {
    let control = Principal::from_text(&args.control_canister_id)
        .map_err(|error| format!("invalid control_canister_id: {error}"))?;
    CONTROL_CANISTER.with(|slot| *slot.borrow_mut() = Some(control));
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

pub(crate) fn mount_database_file(meta: &DatabaseMeta) -> Result<(), String> {
    let memory_id = u8::try_from(meta.mount_id).map_err(|error| error.to_string())?;
    if !(DATABASE_MEMORY_MIN..=DATABASE_MEMORY_MAX).contains(&memory_id) {
        return Err(format!(
            "database MemoryId is outside shard range: {}",
            meta.mount_id
        ));
    }
    MEMORY_MANAGER.with(|manager| {
        let handle = DbHandle::init(manager.borrow().get(MemoryId::new(memory_id)))
            .map_err(|error| error.to_string())?;
        icpdb_runtime::register_path_handle(meta.db_file_name.clone(), handle);
        DATABASE_HANDLES.with(|handles| {
            let mut handles = handles.borrow_mut();
            handles.retain(|(path, _)| path != &meta.db_file_name);
            handles.push((meta.db_file_name.clone(), handle));
        });
        Ok(())
    })
}

pub(crate) fn unmount_database_file(path: &str) {
    icpdb_runtime::unregister_path_handle(path);
    DATABASE_HANDLES.with(|handles| {
        handles
            .borrow_mut()
            .retain(|(stored_path, _)| stored_path != path);
    });
}

pub(crate) fn with_service<T>(
    f: impl FnOnce(&IcpdbService) -> Result<T, String>,
) -> Result<T, String> {
    SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service
            .as_ref()
            .ok_or_else(|| "database canister is not initialized".to_string())?;
        f(service)
    })
}

pub(crate) fn require_control_caller() -> Result<Principal, String> {
    let caller = caller_principal();
    let control = CONTROL_CANISTER
        .with(|slot| *slot.borrow())
        .ok_or_else(|| "control canister is not configured".to_string())?;
    if caller == control {
        Ok(control)
    } else {
        Err("caller is not the configured control canister".to_string())
    }
}

pub(crate) fn database_info_from_meta(meta: DatabaseMeta, status: DatabaseStatus) -> DatabaseInfo {
    DatabaseInfo {
        database_id: meta.database_id,
        status,
        mount_id: Some(meta.mount_id),
        schema_version: meta.schema_version,
        logical_size_bytes: meta.logical_size_bytes,
        snapshot_hash: None,
        archived_at_ms: None,
        deleted_at_ms: None,
    }
}

pub(crate) fn database_operation_error(error: String, cleanup_error: Option<String>) -> String {
    cleanup_error
        .map(|cleanup| format!("{error}; cleanup failed: {cleanup}"))
        .unwrap_or(error)
}

pub(crate) fn now_millis() -> i64 {
    #[cfg(test)]
    {
        1_700_000_000_000
    }
    #[cfg(not(test))]
    {
        (ic_cdk::api::time() / 1_000_000) as i64
    }
}

fn initialize_sqlite_storage() -> Result<(), String> {
    MEMORY_MANAGER.with(|manager| {
        let memory = manager.borrow().get(MemoryId::new(INDEX_DB_MEMORY_ID));
        let handle = DbHandle::init(memory).map_err(|error| error.to_string())?;
        icpdb_runtime::register_path_handle(INDEX_DB_PATH, handle);
        Ok(())
    })
}

fn caller_principal() -> Principal {
    #[cfg(test)]
    {
        TEST_CALLER.with(|caller| *caller.borrow())
    }
    #[cfg(not(test))]
    {
        ic_cdk::api::msg_caller()
    }
}

#[cfg(test)]
pub(crate) fn set_test_caller(caller: Principal) {
    TEST_CALLER.with(|slot| *slot.borrow_mut() = caller);
}
