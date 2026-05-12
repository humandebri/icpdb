// Where: crates/vfs_runtime/src/sql.rs
// What: Bounded raw SQLite execution for canister-hosted databases.
// Why: ICPDB exposes SQLite directly while keeping read/write calls and response size constrained.
use std::path::Path;

use rusqlite::{
    Connection, OpenFlags, Statement, params_from_iter,
    types::{Value, ValueRef},
};
use vfs_types::{SqlExecuteRequest, SqlExecuteResponse, SqlStatement, SqlValue};

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
    database_path: &Path,
    request: SqlExecuteRequest,
    mode: SqlMode,
    max_database_size_bytes: u64,
) -> Result<SqlExecuteResponse, String> {
    validate_sql_request(&request.sql, request.params.len(), mode)?;
    if mode == SqlMode::ReadOnly && !is_read_only_sql(&request.sql) {
        return Err("sql_query only accepts read-only SQL".to_string());
    }
    let mut conn = open_sql_connection(database_path, mode)?;
    if mode == SqlMode::ReadOnly {
        return execute_prepared(
            &conn,
            &request.sql,
            &request.params,
            row_limit(request.max_rows),
        );
    }
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let response = execute_prepared(
        &tx,
        &request.sql,
        &request.params,
        row_limit(request.max_rows),
    )?;
    enforce_database_size_quota(&tx, max_database_size_bytes)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(response)
}

pub fn execute_sql_batch_file(
    database_path: &Path,
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
    let mut conn = open_sql_connection(database_path, SqlMode::ReadWrite)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let limit = row_limit(max_rows);
    let mut responses = Vec::with_capacity(statements.len());
    for statement in statements {
        validate_sql_request(&statement.sql, statement.params.len(), SqlMode::ReadWrite)?;
        responses.push(execute_prepared(
            &tx,
            &statement.sql,
            &statement.params,
            limit,
        )?);
        enforce_database_size_quota(&tx, max_database_size_bytes)?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(responses)
}

fn open_sql_connection(database_path: &Path, mode: SqlMode) -> Result<Connection, String> {
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
    let values = params.iter().map(sql_value_to_rusqlite).collect::<Vec<_>>();
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

fn validate_sql_request(sql: &str, param_count: usize, mode: SqlMode) -> Result<(), String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("sql must not be empty".to_string());
    }
    if sql.len() > MAX_SQL_TEXT_BYTES {
        return Err(format!(
            "sql text exceeds limit: {} > {MAX_SQL_TEXT_BYTES}",
            sql.len()
        ));
    }
    if param_count > MAX_SQL_PARAMS {
        return Err(format!(
            "sql parameter count exceeds limit: {param_count} > {MAX_SQL_PARAMS}"
        ));
    }
    if mode == SqlMode::ReadWrite && is_forbidden_write_sql(trimmed) {
        return Err("sql statement is not allowed for hosted databases".to_string());
    }
    Ok(())
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
    conn.query_row(&format!("PRAGMA {name}"), [], |row| row.get::<_, i64>(0))
        .map(|value| value.max(0) as u64)
        .map_err(|error| error.to_string())
}

fn row_limit(max_rows: Option<u32>) -> u32 {
    max_rows
        .unwrap_or(DEFAULT_SQL_MAX_ROWS)
        .clamp(1, MAX_SQL_ROWS)
}

fn is_read_only_sql(sql: &str) -> bool {
    let lowered = strip_leading_sql_comments(sql).to_ascii_lowercase();
    ["select", "with", "pragma", "explain"]
        .iter()
        .any(|keyword| lowered.starts_with(keyword))
}

fn is_forbidden_write_sql(sql: &str) -> bool {
    ["attach", "detach", "vacuum", "pragma"]
        .iter()
        .any(|keyword| starts_with_sql_keyword(strip_leading_sql_comments(sql), keyword))
}

fn starts_with_sql_keyword(sql: &str, keyword: &str) -> bool {
    let Some(prefix) = sql.get(..keyword.len()) else {
        return false;
    };
    if !prefix.eq_ignore_ascii_case(keyword) {
        return false;
    }
    match sql
        .get(keyword.len()..)
        .and_then(|tail| tail.chars().next())
    {
        Some(value) => !value.is_ascii_alphanumeric() && value != '_',
        None => true,
    }
}

fn strip_leading_sql_comments(sql: &str) -> &str {
    let mut remaining = sql.trim_start();
    loop {
        if let Some(after_dash) = remaining.strip_prefix("--") {
            remaining = after_dash
                .split_once('\n')
                .map(|(_, rest)| rest)
                .unwrap_or("")
                .trim_start();
            continue;
        }
        if let Some(after_open) = remaining.strip_prefix("/*") {
            if let Some((_, rest)) = after_open.split_once("*/") {
                remaining = rest.trim_start();
                continue;
            }
            return "";
        }
        return remaining;
    }
}

fn sql_value_to_rusqlite(value: &SqlValue) -> Value {
    match value {
        SqlValue::Null => Value::Null,
        SqlValue::Integer(value) => Value::Integer(*value),
        SqlValue::Real(value) => Value::Real(*value),
        SqlValue::Text(value) => Value::Text(value.clone()),
        SqlValue::Blob(value) => Value::Blob(value.clone()),
    }
}

fn sql_value_from_ref(value: ValueRef<'_>) -> SqlValue {
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
