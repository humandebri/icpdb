// Where: crates/icpdb_runtime/src/sqlite_facade.rs
// What: SQLite facade over ic-sqlite-vfs with the subset used by ICPDB runtime.
// Why: Runtime code should not depend on rusqlite or a WASI filesystem.
use std::cell::{Cell, RefCell};
use std::ffi::{CStr, CString, c_int};
use std::fmt;
use std::marker::PhantomData;
use std::path::Path;
use std::rc::Rc;

use ic_sqlite_vfs::DbHandle;
use ic_sqlite_vfs::db::DbError;
use ic_sqlite_vfs::db::connection::Connection as VfsConnection;
use ic_sqlite_vfs::sqlite_vfs::ffi;
#[cfg(not(target_arch = "wasm32"))]
use ic_sqlite_vfs::{DefaultMemoryImpl, MemoryId, MemoryManager};

macro_rules! params {
    ($($value:expr),* $(,)?) => {
        $crate::sqlite_facade::ParamsList(vec![$($crate::sqlite_facade::to_value(&$value)),*])
    };
}

pub(crate) use params;

thread_local! {
    static PATH_HANDLES: RefCell<Vec<(String, DbHandle)>> = const { RefCell::new(Vec::new()) };
    #[cfg(not(target_arch = "wasm32"))]
    static LOCAL_CATALOGS: RefCell<Vec<(String, MemoryManager<DefaultMemoryImpl>)>> = const { RefCell::new(Vec::new()) };
    #[cfg(not(target_arch = "wasm32"))]
    static LOCAL_PATH_IDS: RefCell<Vec<(String, u8)>> = const { RefCell::new(Vec::new()) };
}

pub fn register_path_handle(path: impl Into<String>, handle: DbHandle) {
    let path = path.into();
    PATH_HANDLES.with(|handles| {
        let mut handles = handles.borrow_mut();
        handles.retain(|(stored_path, _)| stored_path != &path);
        handles.push((path, handle));
    });
}

pub fn unregister_path_handle(path: &str) {
    PATH_HANDLES.with(|handles| {
        handles
            .borrow_mut()
            .retain(|(stored_path, _)| stored_path != path);
    });
}

pub fn clear_registered_connections() {
    PATH_HANDLES.with(|handles| {
        for (_, handle) in handles.borrow().iter() {
            let _ = handle.cancel_import();
        }
    });
}

#[cfg(not(target_arch = "wasm32"))]
pub fn register_local_path(catalog_id: &str, path: impl Into<String>, memory_id: u8) -> Result<()> {
    let path = path.into();
    if LOCAL_PATH_IDS.with(|ids| ids.borrow().contains(&(path.clone(), memory_id))) {
        return Ok(());
    }
    let manager = LOCAL_CATALOGS.with(|catalogs| {
        let mut catalogs = catalogs.borrow_mut();
        if let Some((_, manager)) = catalogs
            .iter()
            .find(|(stored_catalog_id, _)| stored_catalog_id == catalog_id)
        {
            return manager.clone();
        }
        let manager = MemoryManager::init(DefaultMemoryImpl::default());
        catalogs.push((catalog_id.to_string(), manager.clone()));
        manager
    });
    let handle = DbHandle::init(manager.get(MemoryId::new(memory_id))).map_err(Error::from)?;
    register_path_handle(path.clone(), handle);
    LOCAL_PATH_IDS.with(|ids| {
        let mut ids = ids.borrow_mut();
        ids.retain(|(stored_path, _)| stored_path != &path);
        ids.push((path, memory_id));
    });
    Ok(())
}

pub mod types {
    #[derive(Clone, Debug, PartialEq)]
    pub enum Value {
        Null,
        Integer(i64),
        Real(f64),
        Text(String),
        Blob(Vec<u8>),
    }

    #[derive(Clone, Copy, Debug, PartialEq)]
    pub enum ValueRef<'a> {
        Null,
        Integer(i64),
        Real(f64),
        Text(&'a [u8]),
        Blob(&'a [u8]),
    }
}

use types::{Value, ValueRef};

const FNV1A64_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV1A64_PRIME: u64 = 0x0000_0100_0000_01b3;

#[derive(Clone, Debug)]
pub struct ParamsList(pub Vec<Value>);

pub fn params_from_iter<'value, I>(values: I) -> ParamsList
where
    I: IntoIterator<Item = &'value Value>,
{
    ParamsList(values.into_iter().cloned().collect())
}

pub trait ToValue {
    fn to_value(&self) -> Value;
}

pub fn to_value(value: &impl ToValue) -> Value {
    value.to_value()
}

impl ToValue for String {
    fn to_value(&self) -> Value {
        Value::Text(self.clone())
    }
}

impl ToValue for &String {
    fn to_value(&self) -> Value {
        Value::Text((*self).clone())
    }
}

impl ToValue for &str {
    fn to_value(&self) -> Value {
        Value::Text((*self).to_string())
    }
}

impl ToValue for &&str {
    fn to_value(&self) -> Value {
        Value::Text((**self).to_string())
    }
}

impl ToValue for i64 {
    fn to_value(&self) -> Value {
        Value::Integer(*self)
    }
}

impl ToValue for u64 {
    fn to_value(&self) -> Value {
        Value::Integer(i64::try_from(*self).unwrap_or(i64::MAX))
    }
}

impl ToValue for Vec<u8> {
    fn to_value(&self) -> Value {
        Value::Blob(self.clone())
    }
}

impl ToValue for &Vec<u8> {
    fn to_value(&self) -> Value {
        Value::Blob((*self).clone())
    }
}

impl ToValue for &[u8] {
    fn to_value(&self) -> Value {
        Value::Blob((*self).to_vec())
    }
}

impl ToValue for Option<i64> {
    fn to_value(&self) -> Value {
        self.map(Value::Integer).unwrap_or(Value::Null)
    }
}

impl ToValue for Option<u16> {
    fn to_value(&self) -> Value {
        self.map(|value| Value::Integer(i64::from(value)))
            .unwrap_or(Value::Null)
    }
}

impl ToValue for Option<u64> {
    fn to_value(&self) -> Value {
        self.map(|value| Value::Integer(i64::try_from(value).unwrap_or(i64::MAX)))
            .unwrap_or(Value::Null)
    }
}

impl ToValue for Option<Vec<u8>> {
    fn to_value(&self) -> Value {
        self.as_ref()
            .map(|value| Value::Blob(value.clone()))
            .unwrap_or(Value::Null)
    }
}

impl ToValue for Option<&str> {
    fn to_value(&self) -> Value {
        self.map(|value| Value::Text(value.to_string()))
            .unwrap_or(Value::Null)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct OpenFlags(u32);

impl OpenFlags {
    pub const SQLITE_OPEN_READ_ONLY: Self = Self(1);
    pub const SQLITE_OPEN_NO_MUTEX: Self = Self(2);
}

impl std::ops::BitOr for OpenFlags {
    type Output = Self;

    fn bitor(self, rhs: Self) -> Self::Output {
        Self(self.0 | rhs.0)
    }
}

#[derive(Debug)]
pub enum Error {
    QueryReturnedNoRows,
    InvalidQuery,
    IntegralValueOutOfRange(usize, i64),
    Sqlite(c_int, String),
    InteriorNul,
    PathNotRegistered(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::QueryReturnedNoRows => write!(f, "query returned no rows"),
            Self::InvalidQuery => write!(f, "invalid query"),
            Self::IntegralValueOutOfRange(index, value) => {
                write!(f, "integral value out of range at column {index}: {value}")
            }
            Self::Sqlite(code, message) => write!(f, "sqlite error {code}: {message}"),
            Self::InteriorNul => write!(f, "SQL contains an interior NUL byte"),
            Self::PathNotRegistered(path) => write!(f, "sqlite path is not registered: {path}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<DbError> for Error {
    fn from(error: DbError) -> Self {
        match error {
            DbError::NotFound => Self::QueryReturnedNoRows,
            error => Self::Sqlite(-1, error.to_string()),
        }
    }
}

fn error_to_db_error(error: Error) -> DbError {
    DbError::Sqlite(-1, error.to_string())
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn database_image_size(path: &str) -> Result<u64> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let page_count: i64 = conn.query_row("PRAGMA page_count", params![], |row| row.get(0))?;
    let page_size: i64 = conn.query_row("PRAGMA page_size", params![], |row| row.get(0))?;
    let page_count = u64::try_from(page_count).map_err(|_| Error::InvalidQuery)?;
    let page_size = u64::try_from(page_size).map_err(|_| Error::InvalidQuery)?;
    page_count.checked_mul(page_size).ok_or(Error::InvalidQuery)
}

pub fn export_database_image_chunk(path: &str, offset: u64, len: u64) -> Result<Vec<u8>> {
    path_handle(path)?
        .export_chunk(offset, len)
        .map_err(Error::from)
}

pub fn begin_database_image_import(path: &str, total_size: u64, checksum: u64) -> Result<()> {
    path_handle(path)?
        .begin_import(total_size, checksum)
        .map_err(Error::from)
}

pub fn import_database_image_chunk(path: &str, offset: u64, bytes: &[u8]) -> Result<()> {
    path_handle(path)?
        .import_chunk(offset, bytes)
        .map_err(Error::from)
}

pub fn finish_database_image_import(path: &str) -> Result<()> {
    path_handle(path)?.finish_import().map_err(Error::from)
}

pub fn cancel_database_image_import(path: &str) {
    if let Ok(handle) = path_handle(path) {
        let _ = handle.cancel_import();
    }
}

pub fn fnv1a64_init() -> u64 {
    FNV1A64_OFFSET
}

pub fn fnv1a64_update(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV1A64_PRIME);
    }
    hash
}

fn path_handle(path: &str) -> Result<DbHandle> {
    PATH_HANDLES
        .with(|handles| {
            handles
                .borrow()
                .iter()
                .find(|(stored_path, _)| stored_path == path)
                .map(|(_, handle)| *handle)
        })
        .ok_or_else(|| Error::PathNotRegistered(path.to_string()))
}

pub trait OptionalExtension<T> {
    fn optional(self) -> Result<Option<T>>;
}

impl<T> OptionalExtension<T> for Result<T> {
    fn optional(self) -> Result<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[derive(Clone)]
pub struct Connection {
    handle: DbHandle,
    read_only: bool,
    last_insert_rowid: Rc<Cell<i64>>,
}

impl Connection {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        Self::from_path(path, false)
    }

    pub fn open_with_flags<P: AsRef<Path>>(path: P, _flags: OpenFlags) -> Result<Self> {
        Self::from_path(path, true)
    }

    fn from_path<P: AsRef<Path>>(path: P, read_only: bool) -> Result<Self> {
        let path = path.as_ref().to_string_lossy().into_owned();
        let handle = PATH_HANDLES.with(|handles| {
            handles
                .borrow()
                .iter()
                .find(|(stored_path, _)| stored_path == &path)
                .map(|(_, handle)| *handle)
        });
        let handle = handle.ok_or(Error::PathNotRegistered(path))?;
        Ok(Self {
            handle,
            read_only,
            last_insert_rowid: Rc::new(Cell::new(0)),
        })
    }

    pub fn transaction(&mut self) -> Result<Transaction> {
        Ok(Transaction { conn: self.clone() })
    }

    pub fn execute<P: Into<ParamsList>>(&self, sql: &str, params: P) -> Result<usize> {
        let params = params.into();
        self.with_write_connection(|connection| {
            let changes = execute_raw(connection, sql, &params.0)?;
            self.last_insert_rowid
                .set(last_insert_rowid(connection.raw()));
            Ok(changes)
        })
    }

    pub fn execute_batch(&self, sql: &str) -> Result<()> {
        self.with_write_connection(|connection| {
            connection.execute_batch(sql).map_err(Error::from)?;
            self.last_insert_rowid
                .set(last_insert_rowid(connection.raw()));
            Ok(())
        })
    }

    pub fn prepare(&self, sql: &str) -> Result<Statement<'_>> {
        let meta = self.with_connection(|connection| statement_meta(connection, sql))?;
        Ok(Statement {
            conn: self.clone(),
            sql: sql.to_string(),
            parameter_count: meta.parameter_count,
            columns: meta.columns,
            _marker: PhantomData,
        })
    }

    pub fn query_row<T, P, F>(&self, sql: &str, params: P, f: F) -> Result<T>
    where
        P: Into<ParamsList>,
        F: FnOnce(&Row<'_>) -> Result<T>,
    {
        let mut statement = self.prepare(sql)?;
        let mut rows = statement.query(params)?;
        let row = rows.next()?.ok_or(Error::QueryReturnedNoRows)?;
        f(&row)
    }

    pub fn last_insert_rowid(&self) -> i64 {
        self.last_insert_rowid.get()
    }

    fn with_connection<T>(&self, f: impl FnOnce(&VfsConnection) -> Result<T>) -> Result<T> {
        let result = if self.read_only {
            self.handle
                .query(|connection| f(connection).map_err(error_to_db_error))
                .map_err(Error::from)
        } else {
            self.with_write_connection(f)
        };
        clear_handle_connections(self.handle);
        result
    }

    fn with_write_connection<T>(&self, f: impl FnOnce(&VfsConnection) -> Result<T>) -> Result<T> {
        let result = self
            .handle
            .update(|connection| f(connection).map_err(error_to_db_error))
            .map_err(Error::from);
        clear_handle_connections(self.handle);
        result
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn clear_handle_connections(handle: DbHandle) {
    let _ = handle.cancel_import();
}

#[cfg(target_arch = "wasm32")]
fn clear_handle_connections(_handle: DbHandle) {}

#[derive(Clone)]
pub struct Transaction {
    conn: Connection,
}

impl Transaction {
    pub fn execute<P: Into<ParamsList>>(&self, sql: &str, params: P) -> Result<usize> {
        self.conn.execute(sql, params)
    }

    pub fn execute_batch(&self, sql: &str) -> Result<()> {
        self.conn.execute_batch(sql)
    }

    #[allow(dead_code)]
    pub fn query_row<T, P, F>(&self, sql: &str, params: P, f: F) -> Result<T>
    where
        P: Into<ParamsList>,
        F: FnOnce(&Row<'_>) -> Result<T>,
    {
        self.conn.query_row(sql, params, f)
    }

    #[allow(dead_code)]
    pub fn prepare(&self, sql: &str) -> Result<Statement<'_>> {
        self.conn.prepare(sql)
    }

    pub fn commit(self) -> Result<()> {
        Ok(())
    }
}

impl std::ops::Deref for Transaction {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        &self.conn
    }
}

pub struct Statement<'conn> {
    conn: Connection,
    sql: String,
    parameter_count: usize,
    columns: Vec<String>,
    _marker: PhantomData<&'conn ()>,
}

impl Statement<'_> {
    pub fn parameter_count(&self) -> usize {
        self.parameter_count
    }

    pub fn column_count(&self) -> usize {
        self.columns.len()
    }

    pub fn column_names(&self) -> Vec<&str> {
        self.columns.iter().map(String::as_str).collect()
    }

    pub fn execute<P: Into<ParamsList>>(&mut self, params: P) -> Result<usize> {
        self.conn.execute(&self.sql, params)
    }

    pub fn query<P: Into<ParamsList>>(&mut self, params: P) -> Result<Rows<'_>> {
        let params = params.into();
        let result = self.conn.with_connection(|connection| {
            collect_rows(
                connection,
                &self.sql,
                &params.0,
                &self.conn.last_insert_rowid,
            )
        })?;
        self.columns = result.columns;
        Ok(Rows {
            rows: result.rows,
            index: 0,
            _marker: PhantomData,
        })
    }

    pub fn query_map<T, P, F>(&mut self, params: P, mut f: F) -> Result<MappedRows<T>>
    where
        P: Into<ParamsList>,
        F: FnMut(&Row<'_>) -> Result<T>,
    {
        let mut rows = self.query(params)?;
        let mut values = Vec::new();
        while let Some(row) = rows.next()? {
            values.push(f(&row));
        }
        Ok(MappedRows {
            values: values.into_iter(),
        })
    }
}

pub struct Rows<'stmt> {
    rows: Vec<Vec<Value>>,
    index: usize,
    _marker: PhantomData<&'stmt ()>,
}

impl Rows<'_> {
    pub fn next(&mut self) -> Result<Option<Row<'_>>> {
        let Some(values) = self.rows.get(self.index).cloned() else {
            return Ok(None);
        };
        self.index += 1;
        Ok(Some(Row {
            values,
            _marker: PhantomData,
        }))
    }
}

pub struct MappedRows<T> {
    values: std::vec::IntoIter<Result<T>>,
}

impl<T> Iterator for MappedRows<T> {
    type Item = Result<T>;

    fn next(&mut self) -> Option<Self::Item> {
        self.values.next()
    }
}

#[derive(Clone)]
pub struct Row<'row> {
    values: Vec<Value>,
    _marker: PhantomData<&'row ()>,
}

impl Row<'_> {
    pub fn get<I, T>(&self, index: I) -> Result<T>
    where
        I: TryInto<usize>,
        T: FromValue,
    {
        let index = index.try_into().map_err(|_| Error::InvalidQuery)?;
        let value = self.values.get(index).ok_or(Error::QueryReturnedNoRows)?;
        T::from_value(value)
    }

    pub fn get_ref(&self, index: usize) -> Result<ValueRef<'_>> {
        match self.values.get(index).ok_or(Error::QueryReturnedNoRows)? {
            Value::Null => Ok(ValueRef::Null),
            Value::Integer(value) => Ok(ValueRef::Integer(*value)),
            Value::Real(value) => Ok(ValueRef::Real(*value)),
            Value::Text(value) => Ok(ValueRef::Text(value.as_bytes())),
            Value::Blob(value) => Ok(ValueRef::Blob(value)),
        }
    }
}

pub trait FromValue: Sized {
    fn from_value(value: &Value) -> Result<Self>;
}

impl FromValue for String {
    fn from_value(value: &Value) -> Result<Self> {
        match value {
            Value::Text(value) => Ok(value.clone()),
            _ => Err(Error::InvalidQuery),
        }
    }
}

impl FromValue for i64 {
    fn from_value(value: &Value) -> Result<Self> {
        match value {
            Value::Integer(value) => Ok(*value),
            _ => Err(Error::InvalidQuery),
        }
    }
}

impl FromValue for Vec<u8> {
    fn from_value(value: &Value) -> Result<Self> {
        match value {
            Value::Blob(value) => Ok(value.clone()),
            _ => Err(Error::InvalidQuery),
        }
    }
}

impl<T: FromValue> FromValue for Option<T> {
    fn from_value(value: &Value) -> Result<Self> {
        match value {
            Value::Null => Ok(None),
            value => T::from_value(value).map(Some),
        }
    }
}

struct StatementMeta {
    parameter_count: usize,
    columns: Vec<String>,
}

struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
}

fn statement_meta(connection: &VfsConnection, sql: &str) -> Result<StatementMeta> {
    with_prepared_unbound(connection, sql, |statement| {
        Ok(StatementMeta {
            parameter_count: parameter_count(statement)?,
            columns: column_names(statement)?,
        })
    })
}

fn execute_raw(connection: &VfsConnection, sql: &str, params: &[Value]) -> Result<usize> {
    with_prepared(connection, sql, params, |statement| {
        let rc = unsafe { ffi::sqlite3_step(statement) };
        if rc != ffi::SQLITE_DONE {
            return Err(sqlite_error(connection.raw(), rc));
        }
        Ok(unsafe { ffi::sqlite3_changes64(connection.raw()) as usize })
    })
}

fn collect_rows(
    connection: &VfsConnection,
    sql: &str,
    params: &[Value],
    last_insert_rowid_cell: &Cell<i64>,
) -> Result<QueryResult> {
    with_prepared(connection, sql, params, |statement| {
        let columns = column_names(statement)?;
        let column_count = columns.len();
        let mut rows = Vec::new();
        loop {
            let rc = unsafe { ffi::sqlite3_step(statement) };
            match rc {
                ffi::SQLITE_ROW => {
                    let mut values = Vec::with_capacity(column_count);
                    for index in 0..column_count {
                        values.push(column_value(statement, index)?);
                    }
                    rows.push(values);
                }
                ffi::SQLITE_DONE => {
                    last_insert_rowid_cell.set(last_insert_rowid(connection.raw()));
                    return Ok(QueryResult { columns, rows });
                }
                _ => return Err(sqlite_error(connection.raw(), rc)),
            }
        }
    })
}

fn with_prepared<T>(
    connection: &VfsConnection,
    sql: &str,
    params: &[Value],
    f: impl FnOnce(*mut ffi::sqlite3_stmt) -> Result<T>,
) -> Result<T> {
    with_prepared_inner(connection, sql, Some(params), f)
}

fn with_prepared_unbound<T>(
    connection: &VfsConnection,
    sql: &str,
    f: impl FnOnce(*mut ffi::sqlite3_stmt) -> Result<T>,
) -> Result<T> {
    with_prepared_inner(connection, sql, None, f)
}

fn with_prepared_inner<T>(
    connection: &VfsConnection,
    sql: &str,
    params: Option<&[Value]>,
    f: impl FnOnce(*mut ffi::sqlite3_stmt) -> Result<T>,
) -> Result<T> {
    let sql = CString::new(sql).map_err(|_| Error::InteriorNul)?;
    let mut statement = std::ptr::null_mut();
    let mut tail = std::ptr::null();
    let rc = unsafe {
        ffi::sqlite3_prepare_v2(
            connection.raw(),
            sql.as_ptr(),
            -1,
            &mut statement,
            &mut tail,
        )
    };
    if rc != ffi::SQLITE_OK {
        return Err(sqlite_error(connection.raw(), rc));
    }
    if statement.is_null() {
        return Err(Error::Sqlite(
            ffi::SQLITE_MISUSE,
            "sqlite prepare returned no statement".to_string(),
        ));
    }
    if !tail_is_empty(tail) {
        unsafe {
            ffi::sqlite3_finalize(statement);
        }
        return Err(Error::Sqlite(
            ffi::SQLITE_MISUSE,
            "sqlite statement contains trailing SQL".to_string(),
        ));
    }
    if let Some(params) = params
        && let Err(error) = bind_values(statement, params)
    {
        unsafe {
            ffi::sqlite3_finalize(statement);
        }
        return Err(error);
    }
    let result = f(statement);
    unsafe {
        ffi::sqlite3_finalize(statement);
    }
    result
}

fn bind_values(statement: *mut ffi::sqlite3_stmt, params: &[Value]) -> Result<()> {
    let expected = parameter_count(statement)?;
    if expected != params.len() {
        return Err(Error::Sqlite(
            ffi::SQLITE_MISUSE,
            format!(
                "sqlite parameter count mismatch: expected {expected}, got {}",
                params.len()
            ),
        ));
    }
    for (index, value) in params.iter().enumerate() {
        let index = c_int::try_from(index + 1).map_err(|_| Error::InvalidQuery)?;
        let rc = match value {
            Value::Null => unsafe { ffi::sqlite3_bind_null(statement, index) },
            Value::Integer(value) => unsafe { ffi::sqlite3_bind_int64(statement, index, *value) },
            Value::Real(value) => unsafe { ffi::sqlite3_bind_double(statement, index, *value) },
            Value::Text(value) => bind_text(statement, index, value)?,
            Value::Blob(value) => bind_blob(statement, index, value)?,
        };
        if rc != ffi::SQLITE_OK {
            return Err(Error::Sqlite(rc, "sqlite bind failed".to_string()));
        }
    }
    Ok(())
}

fn bind_text(statement: *mut ffi::sqlite3_stmt, index: c_int, value: &str) -> Result<c_int> {
    let len = c_int::try_from(value.len()).map_err(|_| Error::InvalidQuery)?;
    Ok(unsafe {
        ffi::sqlite3_bind_text(
            statement,
            index,
            value.as_ptr().cast(),
            len,
            ffi::SQLITE_TRANSIENT(),
        )
    })
}

fn bind_blob(statement: *mut ffi::sqlite3_stmt, index: c_int, value: &[u8]) -> Result<c_int> {
    let len = c_int::try_from(value.len()).map_err(|_| Error::InvalidQuery)?;
    let ptr = if value.is_empty() {
        std::ptr::NonNull::<u8>::dangling().as_ptr().cast()
    } else {
        value.as_ptr().cast()
    };
    Ok(unsafe { ffi::sqlite3_bind_blob(statement, index, ptr, len, ffi::SQLITE_TRANSIENT()) })
}

fn parameter_count(statement: *mut ffi::sqlite3_stmt) -> Result<usize> {
    usize::try_from(unsafe { ffi::sqlite3_bind_parameter_count(statement) })
        .map_err(|_| Error::InvalidQuery)
}

fn column_names(statement: *mut ffi::sqlite3_stmt) -> Result<Vec<String>> {
    let count = usize::try_from(unsafe { ffi::sqlite3_column_count(statement) })
        .map_err(|_| Error::InvalidQuery)?;
    let mut names = Vec::with_capacity(count);
    for index in 0..count {
        let index = c_int::try_from(index).map_err(|_| Error::InvalidQuery)?;
        let name = unsafe { ffi::sqlite3_column_name(statement, index) };
        if name.is_null() {
            names.push(String::new());
        } else {
            names.push(
                unsafe { CStr::from_ptr(name) }
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
    Ok(names)
}

fn column_value(statement: *mut ffi::sqlite3_stmt, index: usize) -> Result<Value> {
    let index = c_int::try_from(index).map_err(|_| Error::InvalidQuery)?;
    let value = match unsafe { ffi::sqlite3_column_type(statement, index) } {
        ffi::SQLITE_NULL => Value::Null,
        ffi::SQLITE_INTEGER => {
            Value::Integer(unsafe { ffi::sqlite3_column_int64(statement, index) })
        }
        ffi::SQLITE_FLOAT => Value::Real(unsafe { ffi::sqlite3_column_double(statement, index) }),
        ffi::SQLITE_TEXT => {
            let text = unsafe { ffi::sqlite3_column_text(statement, index) };
            let len = unsafe { ffi::sqlite3_column_bytes(statement, index) };
            let len = usize::try_from(len).map_err(|_| Error::InvalidQuery)?;
            if text.is_null() || len == 0 {
                Value::Text(String::new())
            } else {
                let bytes = unsafe { std::slice::from_raw_parts(text.cast::<u8>(), len) };
                Value::Text(String::from_utf8_lossy(bytes).into_owned())
            }
        }
        ffi::SQLITE_BLOB => {
            let ptr = unsafe { ffi::sqlite3_column_blob(statement, index) };
            let len = unsafe { ffi::sqlite3_column_bytes(statement, index) };
            let len = usize::try_from(len).map_err(|_| Error::InvalidQuery)?;
            if ptr.is_null() || len == 0 {
                Value::Blob(Vec::new())
            } else {
                let bytes = unsafe { std::slice::from_raw_parts(ptr.cast::<u8>(), len) };
                Value::Blob(bytes.to_vec())
            }
        }
        _ => return Err(Error::InvalidQuery),
    };
    Ok(value)
}

fn tail_is_empty(mut tail: *const std::ffi::c_char) -> bool {
    if tail.is_null() {
        return true;
    }
    unsafe {
        while *tail != 0 {
            if !(*tail as u8 as char).is_whitespace() {
                return false;
            }
            tail = tail.add(1);
        }
    }
    true
}

fn last_insert_rowid(connection: *mut ffi::sqlite3) -> i64 {
    unsafe { ffi::sqlite3_last_insert_rowid(connection) }
}

fn sqlite_error(connection: *mut ffi::sqlite3, code: c_int) -> Error {
    let message = unsafe {
        let raw = ffi::sqlite3_errmsg(connection);
        if raw.is_null() {
            "sqlite error".to_string()
        } else {
            CStr::from_ptr(raw).to_string_lossy().into_owned()
        }
    };
    Error::Sqlite(code, message)
}
