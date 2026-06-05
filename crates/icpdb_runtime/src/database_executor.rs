// Where: crates/icpdb_runtime/src/database_executor.rs
// What: Data-plane execution boundary for SQLite Admin Protocol operations.
// Why: Hosted and adapter canisters need SQL execution separated from control-plane concerns.
use crate::sql;
use crate::sqlite_facade::Connection;
use crate::table_inspection;
use icpdb_types::{
    DatabaseTable, SqlBatchRequest, SqlExecuteRequest, SqlExecuteResponse, TableDescription,
    TablePreviewRequest, TablePreviewResponse,
};

pub trait DatabaseExecutor {
    fn sql_query(
        &self,
        database_path: &str,
        request: SqlExecuteRequest,
        max_database_size_bytes: u64,
    ) -> Result<SqlExecuteResponse, String>;

    fn sql_execute(
        &self,
        database_path: &str,
        request: SqlExecuteRequest,
        max_database_size_bytes: u64,
    ) -> Result<SqlExecuteResponse, String>;

    fn sql_batch(
        &self,
        database_path: &str,
        request: SqlBatchRequest,
        max_database_size_bytes: u64,
    ) -> Result<Vec<SqlExecuteResponse>, String>;

    fn list_tables(&self, database_path: &str) -> Result<Vec<DatabaseTable>, String>;

    fn describe_table(
        &self,
        database_path: &str,
        database_id: &str,
        table_name: &str,
    ) -> Result<TableDescription, String>;

    fn preview_table(
        &self,
        database_path: &str,
        request: TablePreviewRequest,
    ) -> Result<TablePreviewResponse, String>;

    fn read_archive_chunk(
        &self,
        database_path: &str,
        offset: u64,
        chunk_len: u64,
    ) -> Result<Vec<u8>, String>;

    fn write_restore_chunk(
        &self,
        index: &Connection,
        database_id: &str,
        offset: u64,
        end: u64,
        bytes: &[u8],
    ) -> Result<(), String>;

    fn finalize_restore(
        &self,
        index: &Connection,
        database_path: &str,
        database_id: &str,
        expected_size: u64,
        expected_hash: Vec<u8>,
    ) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct LocalDatabaseExecutor;

impl DatabaseExecutor for LocalDatabaseExecutor {
    fn sql_query(
        &self,
        database_path: &str,
        request: SqlExecuteRequest,
        max_database_size_bytes: u64,
    ) -> Result<SqlExecuteResponse, String> {
        sql::execute_sql_file(
            database_path,
            request,
            sql::SqlMode::ReadOnly,
            max_database_size_bytes,
        )
    }

    fn sql_execute(
        &self,
        database_path: &str,
        request: SqlExecuteRequest,
        max_database_size_bytes: u64,
    ) -> Result<SqlExecuteResponse, String> {
        sql::execute_sql_file(
            database_path,
            request,
            sql::SqlMode::ReadWrite,
            max_database_size_bytes,
        )
    }

    fn sql_batch(
        &self,
        database_path: &str,
        request: SqlBatchRequest,
        max_database_size_bytes: u64,
    ) -> Result<Vec<SqlExecuteResponse>, String> {
        sql::execute_sql_batch_file(
            database_path,
            request.statements,
            request.max_rows,
            max_database_size_bytes,
        )
    }

    fn list_tables(&self, database_path: &str) -> Result<Vec<DatabaseTable>, String> {
        table_inspection::list_database_tables(database_path)
    }

    fn describe_table(
        &self,
        database_path: &str,
        database_id: &str,
        table_name: &str,
    ) -> Result<TableDescription, String> {
        table_inspection::describe_database_table(database_path, database_id, table_name)
    }

    fn preview_table(
        &self,
        database_path: &str,
        request: TablePreviewRequest,
    ) -> Result<TablePreviewResponse, String> {
        table_inspection::preview_database_table(database_path, request)
    }

    fn read_archive_chunk(
        &self,
        database_path: &str,
        offset: u64,
        chunk_len: u64,
    ) -> Result<Vec<u8>, String> {
        crate::read_database_image_chunk(database_path, offset, chunk_len)
    }

    fn write_restore_chunk(
        &self,
        index: &Connection,
        database_id: &str,
        offset: u64,
        end: u64,
        bytes: &[u8],
    ) -> Result<(), String> {
        crate::write_database_restore_bytes(index, database_id, offset, end, bytes)
    }

    fn finalize_restore(
        &self,
        index: &Connection,
        database_path: &str,
        database_id: &str,
        expected_size: u64,
        expected_hash: Vec<u8>,
    ) -> Result<(), String> {
        crate::finalize_database_image_restore(
            database_path,
            database_id,
            expected_size,
            expected_hash,
            index,
        )
    }
}
