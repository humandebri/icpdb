// icpdb-console/lib/icpdb-sqlite.ts
// Re-export the SQL client surface under a hosted SQLite-shaped subpath.
export * from "./icpdb-sdk.js";

export {
  connectClient as connectSqliteClient,
  connectDatabase as connectSqliteDatabase,
  connectIcpdbDatabase as connectIcpdbSqliteDatabase,
  createClient as createSqliteClient,
  createDatabase as createSqliteDatabase,
  createIcpdbDatabase as createIcpdbSqliteDatabase,
  formatIcpdbCanisterUrl as formatSqliteCanisterUrl,
  formatIcpdbDatabaseUrl as formatSqliteDatabaseUrl,
  parseIcpdbDatabaseUrl as parseSqliteDatabaseUrl
} from "./icpdb-sdk.js";

export type {
  IcpdbConnectDatabaseOptions as ConnectSqliteDatabaseOptions,
  BatchResult as SqliteBatchResult,
  IcpdbCellValue as SqliteValue,
  IcpdbSqlArgsInput as SqliteArgs,
  IcpdbSqlClientBatchStatement as SqliteBatchStatement,
  IcpdbConnectSqlClientOptions as ConnectSqliteClientOptions,
  IcpdbCreateDatabaseOptions as CreateSqliteDatabaseOptions,
  IcpdbCreateSqlClientOptions as CreateSqliteClientOptions,
  IcpdbDatabaseClient as SqliteDatabaseClient,
  IcpdbParsedDatabaseUrl as SqliteParsedDatabaseUrl,
  IcpdbPreparedStatement as SqlitePreparedStatement,
  IcpdbRow as SqliteRow,
  IcpdbSqlClient as SqliteClient,
  IcpdbSqlClientOptions as SqliteClientOptions,
  IcpdbSqlClientResult as SqliteResultSet,
  IcpdbSqlClientStatementInput as SqliteStatement,
  Sql as SqliteSql
} from "./icpdb-sdk.js";
