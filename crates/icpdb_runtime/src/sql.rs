// Where: crates/icpdb_runtime/src/sql.rs
// What: Bounded raw SQLite execution for canister-hosted databases.
// Why: ICPDB exposes SQLite directly while keeping read/write calls and response size constrained.

use crate::sql_guard::{is_read_only_sql, row_limit, validate_sql_request};
use crate::sql_snapshot::DatabaseSnapshot;
use crate::sqlite_facade::{
    Connection, OpenFlags, Statement, params, params_from_iter,
    types::{Value, ValueRef},
};
use icpdb_types::{SqlExecuteRequest, SqlExecuteResponse, SqlStatement, SqlValue};

pub const DEFAULT_SQL_MAX_ROWS: u32 = 100;
pub const MAX_SQL_ROWS: u32 = 500;
pub const MAX_SQL_TEXT_BYTES: usize = 32 * 1024;
pub const MAX_SQL_PARAMS: usize = 128;
pub const MAX_SQL_BATCH_STATEMENTS: usize = 32;
pub const MAX_SQL_RESPONSE_BYTES: usize = 1_500_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SqlMode {
    ReadOnly,
    ReadWrite,
}

pub fn execute_sql_file(
    database_path: &str,
    request: SqlExecuteRequest,
    mode: SqlMode,
    max_database_size_bytes: u64,
) -> Result<SqlExecuteResponse, String> {
    validate_sql_request(&request.sql, request.params.len(), mode)?;
    if mode == SqlMode::ReadOnly && !is_read_only_sql(&request.sql) {
        return Err("sql_query only accepts read-only SQL".to_string());
    }
    let conn = open_sql_connection(database_path, mode)?;
    if mode == SqlMode::ReadOnly {
        return execute_prepared(
            &conn,
            &request.sql,
            &request.params,
            row_limit(request.max_rows),
        );
    }
    let snapshot = DatabaseSnapshot::capture(database_path)?;
    let result = execute_prepared(
        &conn,
        &request.sql,
        &request.params,
        row_limit(request.max_rows),
    )
    .and_then(|response| {
        enforce_database_size_quota(&conn, max_database_size_bytes)?;
        Ok(response)
    });
    if result.is_err() {
        snapshot.restore(database_path)?;
    }
    result
}

pub fn execute_sql_batch_file(
    database_path: &str,
    statements: Vec<SqlStatement>,
    max_rows: Option<u32>,
    max_database_size_bytes: u64,
) -> Result<Vec<SqlExecuteResponse>, String> {
    if statements.len() > MAX_SQL_BATCH_STATEMENTS {
        return Err(format!(
            "batch statement count exceeds limit: {} > {MAX_SQL_BATCH_STATEMENTS}",
            statements.len()
        ));
    }
    let limit = row_limit(max_rows);
    for statement in &statements {
        validate_sql_request(&statement.sql, statement.params.len(), SqlMode::ReadWrite)?;
    }
    let conn = open_sql_connection(database_path, SqlMode::ReadWrite)?;
    let snapshot = DatabaseSnapshot::capture(database_path)?;
    let mut responses = Vec::with_capacity(statements.len());
    for statement in statements {
        let result = execute_prepared(&conn, &statement.sql, &statement.params, limit).and_then(
            |response| {
                enforce_database_size_quota(&conn, max_database_size_bytes)?;
                Ok(response)
            },
        );
        match result {
            Ok(response) => responses.push(response),
            Err(error) => {
                snapshot.restore(database_path)?;
                return Err(error);
            }
        }
    }
    Ok(responses)
}

fn open_sql_connection(database_path: &str, mode: SqlMode) -> Result<Connection, String> {
    match mode {
        SqlMode::ReadOnly => Connection::open_with_flags(
            database_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ),
        SqlMode::ReadWrite => Connection::open(database_path),
    }
    .map_err(|error| error.to_string())
}

fn execute_prepared(
    conn: &Connection,
    sql: &str,
    params: &[SqlValue],
    max_rows: u32,
) -> Result<SqlExecuteResponse, String> {
    let values = params.iter().map(sql_value_to_sqlite).collect::<Vec<_>>();
    let mut statement = conn.prepare(sql).map_err(|error| error.to_string())?;
    if statement.parameter_count() != values.len() {
        return Err(format!(
            "sql parameter count mismatch: expected {}, got {}",
            statement.parameter_count(),
            values.len()
        ));
    }
    if statement.column_count() == 0 {
        let rows_affected = statement
            .execute(params_from_iter(values.iter()))
            .map_err(|error| error.to_string())?;
        return Ok(SqlExecuteResponse {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: rows_affected as u64,
            last_insert_rowid: conn.last_insert_rowid(),
            truncated: false,
        });
    }
    query_rows(statement, &values, max_rows, conn.last_insert_rowid())
}

fn query_rows(
    mut statement: Statement<'_>,
    values: &[Value],
    max_rows: u32,
    last_insert_rowid: i64,
) -> Result<SqlExecuteResponse, String> {
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let column_count = statement.column_count();
    let mut rows = statement
        .query(params_from_iter(values.iter()))
        .map_err(|error| error.to_string())?;
    let mut response_rows = Vec::new();
    let mut approx_bytes = columns.iter().map(String::len).sum::<usize>();
    let mut truncated = false;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        if response_rows.len() >= max_rows as usize {
            truncated = true;
            break;
        }
        let mut response_row = Vec::with_capacity(column_count);
        for index in 0..column_count {
            let value = sql_value_from_ref(row.get_ref(index).map_err(|error| error.to_string())?);
            approx_bytes = approx_bytes.saturating_add(approx_sql_value_bytes(&value));
            if approx_bytes > MAX_SQL_RESPONSE_BYTES {
                truncated = true;
                return Ok(SqlExecuteResponse {
                    columns,
                    rows: response_rows,
                    rows_affected: 0,
                    last_insert_rowid,
                    truncated,
                });
            }
            response_row.push(value);
        }
        response_rows.push(response_row);
    }
    Ok(SqlExecuteResponse {
        columns,
        rows: response_rows,
        rows_affected: 0,
        last_insert_rowid,
        truncated,
    })
}

fn enforce_database_size_quota(
    conn: &Connection,
    max_database_size_bytes: u64,
) -> Result<(), String> {
    let page_size = pragma_u64(conn, "page_size")?;
    let page_count = pragma_u64(conn, "page_count")?;
    let size_bytes = page_size.saturating_mul(page_count);
    if size_bytes > max_database_size_bytes {
        return Err(format!(
            "database quota exceeded: {size_bytes} > {max_database_size_bytes} bytes"
        ));
    }
    Ok(())
}

fn pragma_u64(conn: &Connection, name: &str) -> Result<u64, String> {
    conn.query_row(&format!("PRAGMA {name}"), params![], |row| {
        row.get::<_, i64>(0)
    })
    .map(|value| value.max(0) as u64)
    .map_err(|error| error.to_string())
}

pub(crate) fn sql_value_to_sqlite(value: &SqlValue) -> Value {
    match value {
        SqlValue::Null => Value::Null,
        SqlValue::Integer(value) => Value::Integer(*value),
        SqlValue::Real(value) => Value::Real(*value),
        SqlValue::Text(value) => Value::Text(value.clone()),
        SqlValue::Blob(value) => Value::Blob(value.clone()),
    }
}

pub(crate) fn sql_value_from_ref(value: ValueRef<'_>) -> SqlValue {
    match value {
        ValueRef::Null => SqlValue::Null,
        ValueRef::Integer(value) => SqlValue::Integer(value),
        ValueRef::Real(value) => SqlValue::Real(value),
        ValueRef::Text(value) => SqlValue::Text(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => SqlValue::Blob(value.to_vec()),
    }
}

fn approx_sql_value_bytes(value: &SqlValue) -> usize {
    match value {
        SqlValue::Null => 4,
        SqlValue::Integer(_) | SqlValue::Real(_) => 8,
        SqlValue::Text(value) => value.len(),
        SqlValue::Blob(value) => value.len(),
    }
}
