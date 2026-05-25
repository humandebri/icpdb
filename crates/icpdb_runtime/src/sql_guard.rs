// Where: crates/icpdb_runtime/src/sql_guard.rs
// What: Shared bounds and mode checks for hosted SQL execution.
// Why: SQL execution and table preview need the same limits without mixing parser checks into either path.

use crate::sql::{DEFAULT_SQL_MAX_ROWS, MAX_SQL_PARAMS, MAX_SQL_ROWS, MAX_SQL_TEXT_BYTES, SqlMode};

pub(crate) fn validate_sql_request(
    sql: &str,
    param_count: usize,
    mode: SqlMode,
) -> Result<(), String> {
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

pub(crate) fn row_limit(max_rows: Option<u32>) -> u32 {
    max_rows
        .unwrap_or(DEFAULT_SQL_MAX_ROWS)
        .clamp(1, MAX_SQL_ROWS)
}

pub(crate) fn is_read_only_sql(sql: &str) -> bool {
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
