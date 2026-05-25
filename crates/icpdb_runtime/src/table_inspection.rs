// Where: crates/icpdb_runtime/src/table_inspection.rs
// What: SQLite table/list/describe/preview inspection helpers.
// Why: Turso-like inspect and Supabase-style table browsing should evolve apart from raw SQL execution.

use crate::sql_guard::row_limit;
use crate::sql_identifier::quote_sql_identifier;
use crate::sqlite_facade::{Connection, OpenFlags, OptionalExtension, params};
use icpdb_types::{
    DatabaseColumn, DatabaseForeignKey, DatabaseIndex, DatabaseIndexColumn, DatabaseObjectType,
    DatabaseTable, DatabaseTrigger, SqlExecuteRequest, SqlExecuteResponse, SqlValue,
    TableDescription, TablePreviewRequest, TablePreviewResponse,
};

const MAX_TABLE_PREVIEW_OFFSET: u32 = 100_000;

pub fn list_database_tables(database_path: &str) -> Result<Vec<DatabaseTable>, String> {
    let conn = open_read_only_connection(database_path)?;
    let mut statement = conn
        .prepare(
            "SELECT name, type, sql
             FROM sqlite_schema
             WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
             ORDER BY type ASC, name ASC",
        )
        .map_err(|error| error.to_string())?;
    statement
        .query_map(params![], |row| {
            Ok(DatabaseTable {
                name: row.get(0)?,
                object_type: database_object_type_from_db(&row.get::<_, String>(1)?)?,
                schema_sql: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn describe_database_table(
    database_path: &str,
    database_id: &str,
    table_name: &str,
) -> Result<TableDescription, String> {
    let conn = open_read_only_connection(database_path)?;
    let table = load_table_object(&conn, table_name)?;
    Ok(TableDescription {
        database_id: database_id.to_string(),
        table_name: table.name.clone(),
        object_type: table.object_type,
        schema_sql: table.schema_sql,
        columns: load_table_columns(&conn, &table.name)?,
        indexes: load_table_indexes(&conn, &table.name)?,
        triggers: load_table_triggers(&conn, &table.name)?,
        foreign_keys: load_table_foreign_keys(&conn, &table.name)?,
    })
}

pub fn preview_database_table(
    database_path: &str,
    request: TablePreviewRequest,
) -> Result<TablePreviewResponse, String> {
    let conn = open_read_only_connection(database_path)?;
    let table = load_table_object(&conn, &request.table_name)?;
    let limit = row_limit(request.limit);
    let offset = request.offset.unwrap_or(0).min(MAX_TABLE_PREVIEW_OFFSET);
    let total_count = load_table_row_count(&conn, &table.name)?;
    let preview_limit = limit.saturating_add(1);
    let sql = format!(
        "SELECT * FROM {} LIMIT ?1 OFFSET ?2",
        quote_sql_identifier(&table.name)?
    );
    let response = execute_read_only_preview(
        database_path,
        SqlExecuteRequest {
            database_id: request.database_id.clone(),
            sql,
            params: vec![
                SqlValue::Integer(i64::from(preview_limit)),
                SqlValue::Integer(i64::from(offset)),
            ],
            max_rows: Some(limit),
        },
    )?;
    Ok(TablePreviewResponse {
        database_id: request.database_id,
        table_name: table.name,
        columns: response.columns,
        rows: response.rows,
        offset,
        limit,
        total_count,
        truncated: response.truncated,
    })
}

fn open_read_only_connection(database_path: &str) -> Result<Connection, String> {
    Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| error.to_string())
}

fn execute_read_only_preview(
    database_path: &str,
    request: SqlExecuteRequest,
) -> Result<SqlExecuteResponse, String> {
    crate::sql::execute_sql_file(
        database_path,
        request,
        crate::sql::SqlMode::ReadOnly,
        u64::MAX,
    )
}

fn load_table_object(conn: &Connection, table_name: &str) -> Result<DatabaseTable, String> {
    if table_name.contains('\0') {
        return Err("table name contains an invalid character".to_string());
    }
    conn.query_row(
        "SELECT name, type, sql
         FROM sqlite_schema
         WHERE name = ?1 AND type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'",
        params![table_name],
        |row| {
            Ok(DatabaseTable {
                name: row.get(0)?,
                object_type: database_object_type_from_db(&row.get::<_, String>(1)?)?,
                schema_sql: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("table not found: {table_name}"))
}

fn load_table_columns(conn: &Connection, table_name: &str) -> Result<Vec<DatabaseColumn>, String> {
    let sql = format!("PRAGMA table_xinfo({})", quote_sql_identifier(table_name)?);
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    statement
        .query_map(params![], |row| {
            let cid: i64 = row.get(0)?;
            let not_null: i64 = row.get(3)?;
            let primary_key_position: i64 = row.get(5)?;
            let hidden: i64 = row.get(6)?;
            Ok(DatabaseColumn {
                cid: u32::try_from(cid).map_err(|_| crate::sqlite_facade::Error::InvalidQuery)?,
                name: row.get(1)?,
                declared_type: row.get(2)?,
                not_null: not_null != 0,
                default_value: row.get(4)?,
                primary_key_position: u32::try_from(primary_key_position)
                    .map_err(|_| crate::sqlite_facade::Error::InvalidQuery)?,
                hidden: u32::try_from(hidden)
                    .map_err(|_| crate::sqlite_facade::Error::InvalidQuery)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_table_row_count(conn: &Connection, table_name: &str) -> Result<u64, String> {
    let sql = format!("SELECT COUNT(*) FROM {}", quote_sql_identifier(table_name)?);
    conn.query_row(&sql, params![], |row| row.get::<_, i64>(0))
        .map(|count| count.max(0) as u64)
        .map_err(|error| error.to_string())
}

fn load_table_indexes(conn: &Connection, table_name: &str) -> Result<Vec<DatabaseIndex>, String> {
    let sql = format!("PRAGMA index_list({})", quote_sql_identifier(table_name)?);
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    statement
        .query_map(params![], |row| {
            let unique: i64 = row.get(2)?;
            let name: String = row.get(1)?;
            let partial: i64 = row.get(4)?;
            let schema_sql = load_index_schema_sql(conn, &name)?;
            let columns = load_index_columns(conn, &name)?;
            Ok(DatabaseIndex {
                name,
                table_name: table_name.to_string(),
                unique: unique != 0,
                origin: row.get(3)?,
                partial: partial != 0,
                columns,
                schema_sql,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_index_schema_sql(
    conn: &Connection,
    index_name: &str,
) -> crate::sqlite_facade::Result<Option<String>> {
    conn.query_row(
        "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?1",
        params![index_name],
        |row| row.get(0),
    )
    .optional()
}

fn load_index_columns(
    conn: &Connection,
    index_name: &str,
) -> crate::sqlite_facade::Result<Vec<DatabaseIndexColumn>> {
    let sql = format!(
        "PRAGMA index_xinfo({})",
        quote_sql_identifier(index_name).map_err(|_| crate::sqlite_facade::Error::InvalidQuery)?
    );
    let mut statement = conn.prepare(&sql)?;
    statement
        .query_map(params![], |row| {
            let seqno: i64 = row.get(0)?;
            let desc: i64 = row.get(3)?;
            let key: i64 = row.get(5)?;
            Ok(DatabaseIndexColumn {
                seqno: u32::try_from(seqno)
                    .map_err(|_| crate::sqlite_facade::Error::InvalidQuery)?,
                cid: row.get(1)?,
                name: row.get(2)?,
                descending: desc != 0,
                collation: row.get(4)?,
                key: key != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
}

fn load_table_foreign_keys(
    conn: &Connection,
    table_name: &str,
) -> Result<Vec<DatabaseForeignKey>, String> {
    let sql = format!(
        "PRAGMA foreign_key_list({})",
        quote_sql_identifier(table_name)?
    );
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    statement
        .query_map(params![], |row| {
            let id: i64 = row.get(0)?;
            let seq: i64 = row.get(1)?;
            Ok(DatabaseForeignKey {
                id: u32::try_from(id).map_err(|_| crate::sqlite_facade::Error::InvalidQuery)?,
                seq: u32::try_from(seq).map_err(|_| crate::sqlite_facade::Error::InvalidQuery)?,
                table_name: row.get(2)?,
                from_column: row.get(3)?,
                to_column: row.get(4)?,
                on_update: row.get(5)?,
                on_delete: row.get(6)?,
                match_clause: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_table_triggers(
    conn: &Connection,
    table_name: &str,
) -> Result<Vec<DatabaseTrigger>, String> {
    let mut statement = conn
        .prepare(
            "SELECT name, tbl_name, sql
             FROM sqlite_schema
             WHERE type = 'trigger' AND tbl_name = ?1
             ORDER BY name ASC",
        )
        .map_err(|error| error.to_string())?;
    statement
        .query_map(params![table_name], |row| {
            Ok(DatabaseTrigger {
                name: row.get(0)?,
                table_name: row.get(1)?,
                schema_sql: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn database_object_type_from_db(value: &str) -> crate::sqlite_facade::Result<DatabaseObjectType> {
    match value {
        "table" => Ok(DatabaseObjectType::Table),
        "view" => Ok(DatabaseObjectType::View),
        _ => Err(crate::sqlite_facade::Error::InvalidQuery),
    }
}
