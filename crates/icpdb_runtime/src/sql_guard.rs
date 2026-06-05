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
    let token = main_sql_token(sql);
    if token.eq_ignore_ascii_case("pragma") {
        return is_read_only_pragma_sql(sql);
    }
    ["select", "explain"]
        .iter()
        .any(|keyword| token.eq_ignore_ascii_case(keyword))
}

fn is_forbidden_write_sql(sql: &str) -> bool {
    if starts_with_sql_keyword(strip_leading_sql_comments(sql), "pragma") {
        return !is_read_only_pragma_sql(sql) && !is_allowed_write_pragma_sql(sql);
    }
    ["attach", "detach", "vacuum"]
        .iter()
        .any(|keyword| starts_with_sql_keyword(strip_leading_sql_comments(sql), keyword))
}

fn is_read_only_pragma_sql(sql: &str) -> bool {
    let Some((name, tail)) = pragma_name_and_tail(sql) else {
        return false;
    };
    let tail = trim_sql_gap(tail);
    if tail.starts_with('=') {
        return false;
    }
    if read_pragmas_with_optional_args()
        .iter()
        .any(|pragma| name.eq_ignore_ascii_case(pragma))
    {
        return true;
    }
    read_pragmas_without_args()
        .iter()
        .any(|pragma| name.eq_ignore_ascii_case(pragma))
        && !tail.starts_with('(')
}

fn is_allowed_write_pragma_sql(sql: &str) -> bool {
    let Some((name, tail)) = pragma_name_and_tail(sql) else {
        return false;
    };
    let has_value = {
        let tail = trim_sql_gap(tail);
        tail.starts_with('=') || tail.starts_with('(')
    };
    has_value
        && ["defer_foreign_keys", "foreign_keys", "user_version"]
            .iter()
            .any(|pragma| name.eq_ignore_ascii_case(pragma))
}

fn read_pragmas_with_optional_args() -> &'static [&'static str] {
    &[
        "foreign_key_check",
        "foreign_key_list",
        "index_info",
        "index_list",
        "index_xinfo",
        "integrity_check",
        "quick_check",
        "table_info",
        "table_list",
        "table_xinfo",
    ]
}

fn read_pragmas_without_args() -> &'static [&'static str] {
    &[
        "application_id",
        "cache_size",
        "collation_list",
        "compile_options",
        "database_list",
        "defer_foreign_keys",
        "encoding",
        "foreign_keys",
        "freelist_count",
        "function_list",
        "journal_mode",
        "locking_mode",
        "module_list",
        "page_count",
        "page_size",
        "pragma_list",
        "recursive_triggers",
        "schema_version",
        "synchronous",
        "temp_store",
        "user_version",
    ]
}

fn pragma_name_and_tail(sql: &str) -> Option<(&str, &str)> {
    let sql = strip_leading_sql_comments(sql);
    if !starts_with_sql_keyword(sql, "pragma") {
        return None;
    }
    let mut tail = trim_sql_gap(sql.get("pragma".len()..)?);
    let (first, after_first) = split_sql_identifier(tail)?;
    tail = trim_sql_gap(after_first);
    if let Some(after_dot) = tail.strip_prefix('.') {
        let (second, after_second) = split_sql_identifier(trim_sql_gap(after_dot))?;
        return Some((second, after_second));
    }
    Some((first, after_first))
}

fn split_sql_identifier(sql: &str) -> Option<(&str, &str)> {
    let mut end = 0;
    for (index, value) in sql.char_indices() {
        if index == 0 {
            if !value.is_ascii_alphabetic() && value != '_' {
                return None;
            }
        } else if !value.is_ascii_alphanumeric() && value != '_' {
            break;
        }
        end = index + value.len_utf8();
    }
    if end == 0 {
        return None;
    }
    Some(sql.split_at(end))
}

fn trim_sql_gap(mut sql: &str) -> &str {
    loop {
        let trimmed = sql.trim_start();
        if let Some(after_dash) = trimmed.strip_prefix("--") {
            sql = after_dash
                .split_once('\n')
                .map(|(_, rest)| rest)
                .unwrap_or("");
            continue;
        }
        if let Some(after_open) = trimmed.strip_prefix("/*") {
            if let Some((_, rest)) = after_open.split_once("*/") {
                sql = rest;
                continue;
            }
            return "";
        }
        return trimmed;
    }
}

fn main_sql_token(sql: &str) -> &str {
    let first = sql_token_at(sql, 0);
    if !first.value.eq_ignore_ascii_case("with") {
        return first.value;
    }
    sql_token_at(sql, skip_with_clause_list(sql, first.end)).value
}

struct SqlToken<'a> {
    value: &'a str,
    end: usize,
}

fn sql_token_at(sql: &str, start: usize) -> SqlToken<'_> {
    let index = first_sql_token_index(sql, start);
    let end = ascii_word_end(sql, index);
    SqlToken {
        value: sql.get(index..end).unwrap_or(""),
        end,
    }
}

fn first_sql_token_index(sql: &str, start: usize) -> usize {
    let mut index = start;
    while index < sql.len() {
        let tail = &sql[index..];
        if let Some(character) = tail.chars().next()
            && character.is_whitespace()
        {
            index += character.len_utf8();
            continue;
        }
        if tail.starts_with("--") {
            index = skip_line_comment(sql, index);
        } else if tail.starts_with("/*") {
            index = skip_block_comment(sql, index);
        } else {
            return index;
        }
    }
    sql.len()
}

fn skip_with_clause_list(sql: &str, start: usize) -> usize {
    let mut index = start;
    let recursive = sql_token_at(sql, index);
    if recursive.value.eq_ignore_ascii_case("recursive") {
        index = recursive.end;
    }
    while index < sql.len() {
        index = skip_sql_identifier(sql, first_sql_token_index(sql, index));
        index = first_sql_token_index(sql, index);
        if sql.as_bytes().get(index) == Some(&b'(') {
            index = skip_balanced_sql(sql, index);
        }
        let link = sql_token_at(sql, index);
        if !link.value.eq_ignore_ascii_case("as") {
            return index;
        }
        index = first_sql_token_index(sql, link.end);
        let first_hint = sql_token_at(sql, index);
        if first_hint.value.eq_ignore_ascii_case("not") {
            let second_hint = sql_token_at(sql, first_hint.end);
            if second_hint.value.eq_ignore_ascii_case("materialized") {
                index = first_sql_token_index(sql, second_hint.end);
            }
        } else if first_hint.value.eq_ignore_ascii_case("materialized") {
            index = first_sql_token_index(sql, first_hint.end);
        }
        if sql.as_bytes().get(index) != Some(&b'(') {
            return index;
        }
        index = first_sql_token_index(sql, skip_balanced_sql(sql, index));
        if sql.as_bytes().get(index) != Some(&b',') {
            return index;
        }
        index += 1;
    }
    sql.len()
}

fn ascii_word_end(sql: &str, start: usize) -> usize {
    let mut end = start;
    for (offset, character) in sql[start..].char_indices() {
        if !character.is_ascii_alphabetic() {
            break;
        }
        end = start + offset + character.len_utf8();
    }
    end
}

fn skip_sql_identifier(sql: &str, start: usize) -> usize {
    match sql.as_bytes().get(start) {
        Some(b'"') => skip_quoted_sql(sql, start, b'"'),
        Some(b'`') => skip_quoted_sql(sql, start, b'`'),
        Some(b'[') => skip_bracket_quoted_sql(sql, start),
        Some(value) if is_ascii_name_start(*value) => {
            let mut index = start + 1;
            while let Some(value) = sql.as_bytes().get(index) {
                if !is_ascii_name_part(*value) {
                    break;
                }
                index += 1;
            }
            index
        }
        _ => start,
    }
}

fn skip_balanced_sql(sql: &str, start: usize) -> usize {
    let mut depth = 1;
    let mut index = start + 1;
    while index < sql.len() {
        match sql.as_bytes().get(index) {
            Some(b'\'') => index = skip_quoted_sql(sql, index, b'\''),
            Some(b'"') => index = skip_quoted_sql(sql, index, b'"'),
            Some(b'`') => index = skip_quoted_sql(sql, index, b'`'),
            Some(b'[') => index = skip_bracket_quoted_sql(sql, index),
            Some(b'-') if sql.as_bytes().get(index + 1) == Some(&b'-') => {
                index = skip_line_comment(sql, index);
            }
            Some(b'/') if sql.as_bytes().get(index + 1) == Some(&b'*') => {
                index = skip_block_comment(sql, index);
            }
            Some(b'(') => {
                depth += 1;
                index += 1;
            }
            Some(b')') => {
                depth -= 1;
                index += 1;
                if depth == 0 {
                    return index;
                }
            }
            Some(_) => {
                index += 1;
            }
            None => return sql.len(),
        }
    }
    sql.len()
}

fn skip_quoted_sql(sql: &str, start: usize, quote: u8) -> usize {
    let mut index = start + 1;
    while index < sql.len() {
        if sql.as_bytes().get(index) == Some(&quote) {
            if sql.as_bytes().get(index + 1) == Some(&quote) {
                index += 2;
            } else {
                return index + 1;
            }
        } else {
            index += 1;
        }
    }
    sql.len()
}

fn skip_bracket_quoted_sql(sql: &str, start: usize) -> usize {
    sql[start + 1..]
        .find(']')
        .map(|offset| start + 1 + offset + 1)
        .unwrap_or(sql.len())
}

fn skip_line_comment(sql: &str, start: usize) -> usize {
    sql[start + 2..]
        .find('\n')
        .map(|offset| start + 2 + offset + 1)
        .unwrap_or(sql.len())
}

fn skip_block_comment(sql: &str, start: usize) -> usize {
    sql[start + 2..]
        .find("*/")
        .map(|offset| start + 2 + offset + 2)
        .unwrap_or(sql.len())
}

fn is_ascii_name_start(value: u8) -> bool {
    value.is_ascii_alphabetic() || value == b'_'
}

fn is_ascii_name_part(value: u8) -> bool {
    value.is_ascii_alphanumeric() || value == b'_'
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
