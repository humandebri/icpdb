// icpdb-console/lib/icpdb-libsql.ts
// Re-export the SQL client surface under a libSQL-shaped subpath for migration ergonomics.

export * from "./icpdb-sdk.js";

export {
  connectClient as connectLibsqlClient,
  connectIcpdbDatabase as connectLibsqlDatabase,
  createDatabase as createLibsqlDatabase,
  formatIcpdbCanisterUrl as formatLibsqlCanisterUrl,
  formatIcpdbDatabaseUrl as formatLibsqlDatabaseUrl,
  parseIcpdbDatabaseUrl as parseLibsqlDatabaseUrl
} from "./icpdb-sdk.js";

export type {
  BatchResult as LibsqlBatchResult,
  BatchStatement as LibsqlBatchStatement,
  Client as LibsqlClient,
  IcpdbConnectSqlClientOptions as ConnectLibsqlClientOptions,
  IcpdbConnectDatabaseOptions as ConnectLibsqlDatabaseOptions,
  IcpdbCreateDatabaseOptions as CreateLibsqlDatabaseOptions,
  IcpdbDatabaseClient as LibsqlDatabaseClient,
  IcpdbCreateSqlClientOptions as CreateLibsqlClientOptions,
  Config as LibsqlConfig,
  InArgs as LibsqlInArgs,
  InStatement as LibsqlInStatement,
  InValue as LibsqlInValue,
  IntMode as LibsqlIntMode,
  PreparedStatement as LibsqlPreparedStatement,
  ResultSet as LibsqlResultSet,
  Row as LibsqlRow,
  Sql as LibsqlSql,
  Statement as LibsqlStatement,
  TransactionMode as LibsqlTransactionMode,
  Value as LibsqlValue
} from "./icpdb-sdk.js";
