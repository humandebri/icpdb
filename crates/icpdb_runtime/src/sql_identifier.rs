// Where: crates/icpdb_runtime/src/sql_identifier.rs
// What: SQLite identifier quoting shared by inspection helpers.
// Why: Table and index names are SQL syntax, not parameters, so quoting must stay centralized.

pub(crate) fn quote_sql_identifier(identifier: &str) -> Result<String, String> {
    if identifier.is_empty() {
        return Err("identifier must not be empty".to_string());
    }
    if identifier.contains('\0') {
        return Err("identifier contains an invalid character".to_string());
    }
    Ok(format!("\"{}\"", identifier.replace('"', "\"\"")))
}
