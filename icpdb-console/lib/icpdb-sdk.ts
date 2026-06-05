// icpdb-console/lib/icpdb-sdk.ts
// Identity-first SDK facade for app code that wants database-shaped ICPDB calls.

import type { Identity } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { callIcpdb, createAuthenticatedActor } from "./icpdb-actor.js";
import {
  databaseRoleVariant,
  normalizeCanisterHealth,
  normalizeDatabaseArchiveInfo,
  normalizeDatabaseBilling,
  normalizeDatabaseInfo,
  normalizeDatabaseMember,
  normalizeDatabaseShardInfo,
  normalizeDatabaseShardMaintenanceReport,
  normalizeDatabaseShardPlacement,
  normalizeDatabaseShardStatus,
  normalizeDatabaseSummary,
  normalizeDatabaseUsage,
  normalizeDatabaseUsageEventSummary,
  normalizeRoutedOperationInfo,
  normalizeShardOperationInfo,
  rawCreateDatabaseShardRequest,
  rawCreateRemoteDatabaseRequest,
  rawMaintainDatabaseShardsRequest,
  rawRegisterDatabaseShardRequest,
  rawShardOperationReconcileRequest
} from "./icpdb-database-codec.js";
import {
  normalizeDatabaseTable,
  normalizeSqlResponse,
  normalizeTableDescription,
  normalizeTablePreview,
  rawSqlBatchRequest,
  rawSqlRequest,
  rawTablePreviewRequest
} from "./icpdb-table-codec.js";
import { isReadSql, splitSqlDumpStatements, splitSqlStatements, trimSqlSemicolon } from "./icpdb-sql-script.js";
import type {
  CanisterHealth,
  CreateDatabaseShardRequest,
  CreateRemoteDatabaseRequest,
  DatabaseMember,
  DatabaseRole,
  DatabaseArchiveInfo,
  DatabaseBilling,
  DatabaseColumn,
  DatabaseForeignKey,
  DatabaseInfo,
  DatabaseIndex,
  DatabaseIndexColumn,
  DatabaseShardInfo,
  DatabaseShardMaintenanceReport,
  DatabaseShardPlacement,
  DatabaseShardStatus,
  DatabaseSummary,
  DatabaseTrigger,
  DatabaseTable,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  MaintainDatabaseShardsRequest,
  RegisterDatabaseShardRequest,
  RoutedOperationInfo,
  ShardOperationInfo,
  ShardOperationReconcileRequest,
  SqlBatchRequest,
  SqlExecuteRequest,
  SqlExecuteResponse,
  SqlStatement,
  SqlValue,
  TableDescription,
  TablePreviewResponse
} from "./types.js";

export type {
  CanisterHealth,
  CreateDatabaseShardRequest,
  CreateRemoteDatabaseRequest,
  DatabaseArchiveInfo,
  DatabaseBilling,
  DatabaseColumn,
  DatabaseForeignKey,
  DatabaseIndex,
  DatabaseInfo,
  DatabaseMember,
  DatabaseRole,
  DatabaseShardInfo,
  DatabaseShardMaintenanceReport,
  DatabaseShardMaintenanceAction,
  DatabaseShardPlacement,
  DatabaseShardStatus,
  DatabaseSummary,
  DatabaseTable,
  DatabaseTrigger,
  DatabaseUsage,
  DatabaseUsageEventSummary,
  MaintainDatabaseShardsRequest,
  RegisterDatabaseShardRequest,
  RoutedOperationInfo,
  ShardOperationInfo,
  ShardOperationReconcileRequest,
  SqlExecuteResponse,
  SqlStatement,
  SqlValue,
  TableDescription,
  TablePreviewResponse
} from "./types.js";

const TRANSFER_CHUNK_BYTES = 256 * 1024;
const SCRIPT_BATCH_STATEMENTS = 32;
const MIGRATIONS_TABLE = "icpdb_schema_migrations";
const ANONYMOUS_PRINCIPAL = "2vxsx-fae";
const MAX_SQL_ROWS = 500;
const MAX_NAT32 = 4_294_967_295;
const MAX_NAT64 = (1n << 64n) - 1n;
const noop = () => undefined;
const UNSUPPORTED_LIBSQL_OPTIONS = [
  "authToken",
  "syncUrl",
  "syncInterval",
  "tls",
  "fetch",
  "concurrency",
  "offline",
  "readYourWrites",
  "encryptionKey"
];

export type IcpdbClientOptions = {
  canisterId?: string;
  url?: string;
  connectionUrl?: string;
  identity: Identity;
  databaseId?: string;
  host?: string;
  rootKey?: Uint8Array;
};

type NormalizedIcpdbClientOptions = {
  canisterId: string;
  identity: Identity;
  databaseId?: string;
  host?: string;
  rootKey?: Uint8Array;
};

type UnknownSqlValue = {
  kind: unknown;
  value?: unknown;
};

export type IcpdbCreateSetupOptions = {
  databaseId?: never;
  setupSql?: string;
  setupStatements?: readonly IcpdbSqlClientBatchStatement[];
  setupMigrations?: readonly IcpdbMigration[];
};

export type IcpdbCreateDatabaseOptions = Omit<IcpdbClientOptions, "databaseId"> & {
  databaseId?: never;
} & IcpdbCreateSetupOptions;

export type IcpdbExistingDatabaseSqlClientOptions = IcpdbClientOptions & {
  intMode?: IcpdbIntMode;
  setupSql?: never;
  setupStatements?: never;
  setupMigrations?: never;
};

type IcpdbExistingDatabaseLocator =
  | { canisterId: string; databaseId: string }
  | { connectionUrl: string; databaseId?: string }
  | { url: string; databaseId?: string };

export type IcpdbConnectDatabaseOptions = IcpdbExistingDatabaseSqlClientOptions & IcpdbExistingDatabaseLocator;
export type IcpdbConnectSqlClientOptions = IcpdbConnectDatabaseOptions;

export type IcpdbCreateSqlClientOptions = Omit<IcpdbClientOptions, "databaseId"> & {
  databaseId?: never;
  intMode?: IcpdbIntMode;
} & IcpdbCreateSetupOptions;

export type IcpdbSqlClientOptions = IcpdbExistingDatabaseSqlClientOptions | IcpdbCreateSqlClientOptions;

export type IcpdbIntMode = "number" | "bigint" | "string";
export type IcpdbSqlValueInput = SqlValue | null | string | number | bigint | boolean | Date | ArrayBuffer | ArrayBufferView | readonly number[];
export type IcpdbSqlArgsInput = readonly IcpdbSqlValueInput[] | Readonly<Record<string, IcpdbSqlValueInput>>;
export type IcpdbCellValue = null | string | number | bigint | ArrayBuffer;
export type IcpdbRow = Record<string, IcpdbCellValue> & { readonly [index: number]: IcpdbCellValue; readonly length?: number };
export type IcpdbJsonCellValue = null | string | number | number[];
export type IcpdbJsonRow = Record<string, IcpdbJsonCellValue>;

export type IcpdbStatementInput = {
  sql: string;
  args?: IcpdbSqlArgsInput;
  params?: IcpdbSqlArgsInput;
  maxRows?: number | null;
  databaseId?: string;
  idempotencyKey?: string | null;
  wait?: IcpdbWriteWaitOption | null;
};

export type IcpdbDatabaseStatementInput = Omit<IcpdbStatementInput, "databaseId"> & {
  databaseId?: never;
};

export type IcpdbSqlClientStatement = {
  sql: string;
  args?: IcpdbSqlArgsInput;
  params?: IcpdbSqlArgsInput;
  maxRows?: number | null;
  idempotencyKey?: string | null;
  wait?: IcpdbWriteWaitOption | null;
  databaseId?: never;
};

export type IcpdbSqlClientBatchStatementObject = {
  sql: string;
  args?: IcpdbSqlArgsInput;
  params?: IcpdbSqlArgsInput;
  idempotencyKey?: never;
  maxRows?: never;
  databaseId?: never;
};

export type IcpdbSqlClientStatementInput = string | IcpdbSqlClientStatement | readonly [string, IcpdbSqlArgsInput?];
export type IcpdbSqlClientBatchStatement = string | IcpdbSqlClientBatchStatementObject | readonly [string, IcpdbSqlArgsInput?];
export type IcpdbSqlTemplateStatement = IcpdbSqlClientBatchStatementObject;
export type IcpdbPreparedStatementInput = IcpdbSqlClientBatchStatement;

type IcpdbNormalizedBatchStatementInput = {
  sql: string;
  args?: IcpdbSqlArgsInput;
  params?: IcpdbSqlArgsInput;
};

type IcpdbNormalizedLowLevelBatchOptions = {
  databaseId: string;
  maxRows: number | null;
  idempotencyKey: string | null;
  mode: IcpdbBatchMode | null;
};
export type IcpdbBatchStatementInput = IcpdbSqlClientBatchStatement;

export type IcpdbBatchOptions = {
  databaseId?: string;
  maxRows?: number | null;
  idempotencyKey?: string | null;
  mode?: IcpdbBatchMode;
};

export type IcpdbBatchMode = "read" | "write" | "deferred";
export type IcpdbLowLevelBatchOptions = IcpdbBatchOptions | IcpdbBatchMode;
export type IcpdbSqlClientBatchOptionsObject = Omit<IcpdbBatchOptions, "databaseId"> & {
  mode?: IcpdbBatchMode;
  databaseId?: never;
};
export type IcpdbSqlClientBatchOptions = IcpdbSqlClientBatchOptionsObject | IcpdbBatchMode;
export type IcpdbSqlClientScriptOptionsObject = Omit<IcpdbBatchOptions, "databaseId"> & {
  databaseId?: never;
};
export type IcpdbDatabaseBatchOptionsObject = Omit<IcpdbBatchOptions, "databaseId"> & {
  databaseId?: never;
};

export type IcpdbSqlDumpOptions = {
  databaseId?: never;
  tableName?: string | null;
  pageSize?: number | null;
};

export type IcpdbInspectOptions = {
  databaseId?: never;
  tableName?: string | null;
  previewLimit?: number | null;
  previewOffset?: number | null;
};

export type IcpdbWaitForRoutedOperationOptions = {
  databaseId?: never;
  intervalMs?: number | null;
  timeoutMs?: number | null;
  reconcileUnknown?: boolean | null;
};

export type IcpdbWriteWaitOption = boolean | IcpdbWaitForRoutedOperationOptions;

export type IcpdbMigration = {
  version: string | number;
  name?: string;
  sql: string;
};

export type IcpdbMigrationResult = {
  applied: string[];
  skipped: string[];
};

export type IcpdbMigrateInput = readonly IcpdbMigration[] | readonly IcpdbSqlClientBatchStatement[];

export type IcpdbPreparedStatement = {
  sql: string;
  bind: (args?: IcpdbSqlArgsInput) => IcpdbPreparedStatement;
  execute: (args?: IcpdbSqlArgsInput) => Promise<IcpdbSqlClientResult>;
  query: (args?: IcpdbSqlArgsInput) => Promise<IcpdbSqlClientResult>;
  queryRows: (args?: IcpdbSqlArgsInput) => Promise<IcpdbRow[]>;
  queryOne: (args?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  all: (args?: IcpdbSqlArgsInput) => Promise<IcpdbRow[]>;
  get: (args?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  values: (args?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue[][]>;
  first: (args?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  firstValue: (args?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue | undefined>;
  scalar: (args?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue | undefined>;
  run: (args?: IcpdbSqlArgsInput) => Promise<IcpdbSqlClientResult>;
};

export type IcpdbPreviewOptions = {
  databaseId?: string;
  limit?: number | null;
  offset?: number | null;
};

export type IcpdbDatabasePreviewOptionsObject = Omit<IcpdbPreviewOptions, "databaseId"> & {
  databaseId?: never;
};

export type IcpdbRestoreInput = Uint8Array | readonly number[];
export type IcpdbNatInput = string | number | bigint;

export type IcpdbRestoreOptions = {
  databaseId?: never;
  expectedSha256?: string | null;
};

export type IcpdbSqlClientResult = {
  columns: string[];
  columnTypes: string[];
  rows: IcpdbRow[];
  rowsAffected: number;
  affectedRows: number;
  changes: number;
  lastInsertRowid: bigint | undefined;
  lastInsertRowId: bigint | undefined;
  truncated: boolean;
  routedOperationId: string | null;
  raw: SqlExecuteResponse;
  toJSON: () => IcpdbSqlClientJsonResult;
};

export type IcpdbSqlClientJsonResult = {
  columns: string[];
  columnTypes: string[];
  rows: IcpdbJsonRow[];
  rowsAffected: number;
  affectedRows: number;
  changes: number;
  lastInsertRowid: string | null;
  lastInsertRowId: string | null;
  truncated: boolean;
  routedOperationId: string | null;
  raw: SqlExecuteResponse;
};

export type IcpdbLibsqlErrorCode =
  | "SQLITE_CONSTRAINT"
  | "SQLITE_READONLY"
  | "SQLITE_BUSY"
  | "SQLITE_MISUSE"
  | "SQLITE_ERROR"
  | "ICPDB_AUTH"
  | "ICPDB_QUOTA"
  | "ICPDB_BATCH_MODE"
  | "ICPDB_ERROR";

export const ICPDB_LIBSQL_ERROR_CODES: readonly IcpdbLibsqlErrorCode[] = [
  "SQLITE_CONSTRAINT",
  "SQLITE_READONLY",
  "SQLITE_BUSY",
  "SQLITE_MISUSE",
  "SQLITE_ERROR",
  "ICPDB_AUTH",
  "ICPDB_QUOTA",
  "ICPDB_BATCH_MODE",
  "ICPDB_ERROR"
];

export type IcpdbLibsqlErrorClassification = {
  code: IcpdbLibsqlErrorCode;
  extendedCode?: string;
  rawCode?: number;
};

export class LibsqlError extends Error {
  readonly code: IcpdbLibsqlErrorCode;
  readonly extendedCode?: string;
  readonly rawCode?: number;
  readonly status = 400;

  constructor(message: string, code: IcpdbLibsqlErrorCode, extendedCode?: string, rawCode?: number, cause?: Error) {
    super(message);
    this.name = "LibsqlError";
    this.code = code;
    this.extendedCode = extendedCode;
    this.rawCode = rawCode;
    if (cause) this.cause = cause;
  }
}

export class LibsqlBatchError extends LibsqlError {
  readonly statementIndex: number;

  constructor(message: string, statementIndex: number, code: IcpdbLibsqlErrorCode, rawCode?: number, cause?: Error) {
    super(message, code, undefined, rawCode, cause);
    this.name = "LibsqlBatchError";
    this.statementIndex = statementIndex;
  }
}

const ICPDB_LIBSQL_ERROR_CODE_SET = new Set<string>(ICPDB_LIBSQL_ERROR_CODES);

export function isIcpdbLibsqlErrorCode(value: string): value is IcpdbLibsqlErrorCode {
  return ICPDB_LIBSQL_ERROR_CODE_SET.has(value);
}

export function isLibsqlError(error: unknown): error is LibsqlError {
  if (error instanceof LibsqlError) return true;
  if (typeof error !== "object" || error === null) return false;
  const name = Reflect.get(error, "name");
  const message = Reflect.get(error, "message");
  const code = Reflect.get(error, "code");
  return (name === "LibsqlError" || name === "LibsqlBatchError") && typeof message === "string" && typeof code === "string" && isIcpdbLibsqlErrorCode(code);
}

export function isLibsqlBatchError(error: unknown): error is LibsqlBatchError {
  if (error instanceof LibsqlBatchError) return true;
  if (!isLibsqlError(error)) return false;
  const name = Reflect.get(error, "name");
  const statementIndex = Reflect.get(error, "statementIndex");
  return name === "LibsqlBatchError" && Number.isSafeInteger(statementIndex) && statementIndex >= 0;
}

export type IcpdbResultSet = IcpdbSqlClientResult;
export type IcpdbCreateClientOptions = IcpdbSqlClientOptions;
export type Client = IcpdbSqlClient;
export type Config = IcpdbSqlClientOptions;
export type ResultSet = IcpdbSqlClientResult;
export type Row = IcpdbRow;
export type InValue = IcpdbSqlValueInput;
export type Value = IcpdbCellValue;
export type InArgs = IcpdbSqlArgsInput;
export type InStatement = IcpdbSqlClientStatementInput;
export type Statement = IcpdbSqlClientStatementInput;
export type BatchStatement = IcpdbSqlClientBatchStatement;
export type BatchResult = IcpdbSqlClientResult[];
export type PreparedStatement = IcpdbPreparedStatement;
export type Sql = (strings: TemplateStringsArray, ...values: IcpdbSqlValueInput[]) => IcpdbSqlTemplateStatement;
export type TransactionMode = IcpdbBatchMode;
export type IntMode = IcpdbIntMode;

export type IcpdbTableStatus = {
  tableName: string;
  objectType: DatabaseTable["objectType"];
  rowCount: string;
  columnCount: number;
  columns: string[];
  indexCount: number;
  triggerCount: number;
  foreignKeyCount: number;
};

export type IcpdbDatabaseStats = {
  tableCount: number;
  viewCount: number;
  rowCount: string;
  columnCount: number;
  indexCount: number;
  triggerCount: number;
  foreignKeyCount: number;
};

export type IcpdbDatabaseStatus = {
  databaseId: string;
  connectionUrl: string;
  callerPrincipal?: string;
  callerRole?: DatabaseRole;
  placement: DatabaseShardPlacement | null;
  usage: DatabaseUsage;
  stats: IcpdbDatabaseStats;
  tableStatuses: IcpdbTableStatus[];
};

export type IcpdbSqlClientInfo = {
  canisterId?: string;
  databaseId: string;
  connectionUrl: string;
  url: string;
  principal?: string;
};

export type IcpdbTableInspection = {
  table: DatabaseTable;
  description: TableDescription;
  preview: TablePreviewResponse;
};

export type IcpdbDatabaseInspection = {
  databaseId: string;
  schema: string;
  tables: IcpdbTableInspection[];
};

export type IcpdbSqlClientDatabaseSource =
  Pick<IcpdbDatabaseClient, "databaseId" | "query" | "execute"> &
  Partial<Pick<IcpdbDatabaseClient, "batch" | "queryRows" | "queryOne" | "all" | "get" | "values" | "first" | "firstValue" | "scalar" | "prepare" | "run" | "transaction" | "exec" | "executeMultiple" | "executeScript" | "migrate" | "dumpSql" | "loadSqlDump" | "schema" | "listTables" | "tables" | "views" | "describeTable" | "describe" | "listColumns" | "columns" | "listIndexes" | "indexes" | "listTriggers" | "triggers" | "listForeignKeys" | "foreignKeys" | "previewTable" | "preview" | "inspect" | "snapshotInfo" | "connectionUrl" | "url" | "info" | "delete" | "getUsage" | "status" | "listUsageEvents" | "getRoutedOperation" | "reconcileRoutedOperation" | "waitForRoutedOperation" | "placement" | "archive" | "restore" | "grantMember" | "revokeMember" | "listMembers" | "close">>;

type IcpdbSqlClientDatabaseDerivedMethods =
  Pick<IcpdbDatabaseClient, "batch" | "queryRows" | "queryOne" | "all" | "get" | "values" | "first" | "firstValue" | "scalar" | "prepare" | "run" | "transaction" | "exec" | "executeMultiple" | "executeScript" | "migrate" | "dumpSql" | "loadSqlDump" | "schema" | "listTables" | "tables" | "views" | "describeTable" | "describe" | "listColumns" | "columns" | "listIndexes" | "indexes" | "listTriggers" | "triggers" | "listForeignKeys" | "foreignKeys" | "previewTable" | "preview" | "inspect" | "connectionUrl" | "url" | "info" | "delete" | "getUsage" | "status" | "listUsageEvents" | "getRoutedOperation" | "reconcileRoutedOperation" | "waitForRoutedOperation" | "grantMember" | "revokeMember" | "listMembers" | "placement" | "archive" | "snapshotInfo" | "restore" | "close">;

export type IcpdbSqlClientDatabase =
  Omit<IcpdbSqlClientDatabaseSource, keyof IcpdbSqlClientDatabaseDerivedMethods> &
  IcpdbSqlClientDatabaseDerivedMethods;

export type IcpdbSqlClient = {
  readonly closed: boolean;
  readonly protocol: string;
  database: () => Promise<IcpdbSqlClientDatabase>;
  principal: () => Promise<string>;
  health: () => Promise<CanisterHealth>;
  databaseId: () => Promise<string>;
  connectionUrl: () => Promise<string>;
  url: () => Promise<string>;
  info: () => Promise<IcpdbSqlClientInfo>;
  execute: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbSqlClientResult>;
  query: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbSqlClientResult>;
  queryRows: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbRow[]>;
  queryOne: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  all: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbRow[]>;
  get: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  values: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue[][]>;
  first: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  firstValue: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue | undefined>;
  scalar: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue | undefined>;
  run: (statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput) => Promise<IcpdbSqlClientResult>;
  prepare: (statement: IcpdbPreparedStatementInput, args?: IcpdbSqlArgsInput) => IcpdbPreparedStatement;
  batch: (statements: readonly IcpdbSqlClientBatchStatement[], options?: IcpdbSqlClientBatchOptions) => Promise<IcpdbSqlClientResult[]>;
  transaction: {
    (statements: readonly IcpdbSqlClientBatchStatement[], options?: IcpdbSqlClientBatchOptions): Promise<IcpdbSqlClientResult[]>;
    (mode?: IcpdbBatchMode): Promise<never>;
  };
  exec: (source: string, options?: IcpdbSqlClientScriptOptionsObject) => Promise<void>;
  executeMultiple: (source: string, options?: IcpdbSqlClientScriptOptionsObject) => Promise<void>;
  executeScript: (source: string, options?: IcpdbSqlClientScriptOptionsObject) => Promise<IcpdbSqlClientResult[]>;
  migrate: {
    (migrations: readonly IcpdbMigration[]): Promise<IcpdbMigrationResult>;
    (statements: readonly IcpdbSqlClientBatchStatement[]): Promise<IcpdbSqlClientResult[]>;
  };
  dumpSql: (options?: IcpdbSqlDumpOptions) => Promise<string>;
  loadSqlDump: (source: string, options?: IcpdbSqlClientScriptOptionsObject) => Promise<IcpdbSqlClientResult[]>;
  delete: () => Promise<void>;
  getUsage: () => Promise<DatabaseUsage>;
  status: () => Promise<IcpdbDatabaseStatus>;
  listUsageEvents: () => Promise<DatabaseUsageEventSummary[]>;
  getRoutedOperation: (operationId: string) => Promise<RoutedOperationInfo>;
  reconcileRoutedOperation: (operationId: string) => Promise<RoutedOperationInfo>;
  waitForRoutedOperation: (operationId: string, options?: IcpdbWaitForRoutedOperationOptions) => Promise<RoutedOperationInfo>;
  grantMember: (principal: string, role: DatabaseRole) => Promise<void>;
  revokeMember: (principal: string) => Promise<void>;
  listMembers: () => Promise<DatabaseMember[]>;
  placement: () => Promise<DatabaseShardPlacement | null>;
  archive: () => Promise<Uint8Array>;
  snapshotInfo: (snapshot: IcpdbRestoreInput) => Promise<IcpdbSnapshotInfo>;
  restore: (snapshot: IcpdbRestoreInput, options?: IcpdbRestoreOptions) => Promise<void>;
  listTables: () => Promise<DatabaseTable[]>;
  tables: () => Promise<DatabaseTable[]>;
  views: () => Promise<DatabaseTable[]>;
  describeTable: (tableName: string) => Promise<TableDescription>;
  describe: (tableName: string) => Promise<TableDescription>;
  listColumns: (tableName: string) => Promise<DatabaseColumn[]>;
  columns: (tableName: string) => Promise<DatabaseColumn[]>;
  listIndexes: (tableName: string) => Promise<DatabaseIndex[]>;
  indexes: (tableName: string) => Promise<DatabaseIndex[]>;
  listTriggers: (tableName: string) => Promise<DatabaseTrigger[]>;
  triggers: (tableName: string) => Promise<DatabaseTrigger[]>;
  listForeignKeys: (tableName: string) => Promise<DatabaseForeignKey[]>;
  foreignKeys: (tableName: string) => Promise<DatabaseForeignKey[]>;
  previewTable: (tableName: string, options?: IcpdbDatabasePreviewOptionsObject) => Promise<TablePreviewResponse>;
  preview: (tableName: string, options?: IcpdbDatabasePreviewOptionsObject) => Promise<TablePreviewResponse>;
  schema: (tableName?: string) => Promise<string>;
  inspect: (options?: IcpdbInspectOptions) => Promise<IcpdbDatabaseInspection>;
  close: () => void;
  reconnect: () => void;
  sync: () => Promise<never>;
};

export type IcpdbSqlClientMetadata = {
  principal?: () => string | Promise<string>;
  health?: () => CanisterHealth | Promise<CanisterHealth>;
  intMode?: IcpdbIntMode;
};

export type IcpdbClient = {
  principal: () => string;
  connectionUrl: (databaseId?: string) => string;
  url: (databaseId?: string) => string;
  database: (databaseId: string) => IcpdbDatabaseClient;
  connectDatabase: () => Promise<IcpdbDatabaseClient>;
  createDatabase: (setup?: IcpdbCreateSetupOptions) => Promise<IcpdbDatabaseClient>;
  health: () => Promise<CanisterHealth>;
  deleteDatabase: (databaseId: string) => Promise<void>;
  listDatabases: () => Promise<DatabaseSummary[]>;
  listPlacements: () => Promise<DatabaseShardPlacement[]>;
  listAllPlacements: () => Promise<DatabaseShardPlacement[]>;
  placement: (databaseId?: string) => Promise<DatabaseShardPlacement | null>;
  listShards: () => Promise<DatabaseShardInfo[]>;
  createDatabaseShard: (request: CreateDatabaseShardRequest) => Promise<DatabaseShardInfo>;
  createRemoteDatabase: (request: CreateRemoteDatabaseRequest) => Promise<DatabaseInfo>;
  registerDatabaseShard: (request: RegisterDatabaseShardRequest) => Promise<DatabaseShardInfo>;
  getShardStatus: (databaseCanisterId: string) => Promise<DatabaseShardStatus>;
  topUpShard: (databaseCanisterId: string, cycles: IcpdbNatInput) => Promise<DatabaseShardInfo>;
  topUpDatabaseBalance: {
    (units: IcpdbNatInput): Promise<DatabaseBilling>;
    (databaseId: string, units: IcpdbNatInput): Promise<DatabaseBilling>;
  };
  maintainShards: (request: MaintainDatabaseShardsRequest) => Promise<DatabaseShardMaintenanceReport>;
  migrateDatabaseToShard: {
    (databaseCanisterId: string): Promise<DatabaseShardPlacement>;
    (databaseId: string, databaseCanisterId: string): Promise<DatabaseShardPlacement>;
  };
  listShardOperations: () => Promise<ShardOperationInfo[]>;
  reconcileShardOperation: (request: ShardOperationReconcileRequest) => Promise<ShardOperationInfo>;
  grantMember: {
    (principal: string, role: DatabaseRole): Promise<void>;
    (databaseId: string, principal: string, role: DatabaseRole): Promise<void>;
  };
  revokeMember: {
    (principal: string): Promise<void>;
    (databaseId: string, principal: string): Promise<void>;
  };
  listMembers: (databaseId?: string) => Promise<DatabaseMember[]>;
  getUsage: (databaseId?: string) => Promise<DatabaseUsage>;
  status: (databaseId?: string) => Promise<IcpdbDatabaseStatus>;
  listUsageEvents: (databaseId?: string) => Promise<DatabaseUsageEventSummary[]>;
  getRoutedOperation: {
    (operationId: string): Promise<RoutedOperationInfo>;
    (databaseId: string, operationId: string): Promise<RoutedOperationInfo>;
  };
  reconcileRoutedOperation: {
    (operationId: string): Promise<RoutedOperationInfo>;
    (databaseId: string, operationId: string): Promise<RoutedOperationInfo>;
  };
  waitForRoutedOperation: {
    (operationId: string, options?: IcpdbWaitForRoutedOperationOptions): Promise<RoutedOperationInfo>;
    (databaseId: string, operationId: string, options?: IcpdbWaitForRoutedOperationOptions): Promise<RoutedOperationInfo>;
  };
  beginArchive: (databaseId?: string) => Promise<DatabaseArchiveInfo>;
  readArchiveChunk: (offset: string, maxBytes?: number, databaseId?: string) => Promise<number[]>;
  finalizeArchive: (snapshotHash: readonly number[], databaseId?: string) => Promise<void>;
  cancelArchive: (databaseId?: string) => Promise<void>;
  archive: (databaseId?: string) => Promise<Uint8Array>;
  snapshotInfo: (snapshot: IcpdbRestoreInput) => Promise<IcpdbSnapshotInfo>;
  beginRestore: (snapshotHash: readonly number[], sizeBytes: string, databaseId?: string) => Promise<void>;
  writeRestoreChunk: (offset: string, bytes: IcpdbRestoreInput, databaseId?: string) => Promise<void>;
  finalizeRestore: (databaseId?: string) => Promise<void>;
  restore: {
    (snapshot: IcpdbRestoreInput, options?: IcpdbRestoreOptions): Promise<void>;
    (snapshot: IcpdbRestoreInput, databaseId: string, options?: IcpdbRestoreOptions): Promise<void>;
  };
  query: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<SqlExecuteResponse>;
  queryRows: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow[]>;
  queryOne: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  execute: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<SqlExecuteResponse>;
  all: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow[]>;
  get: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  values: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue[][]>;
  first: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  firstValue: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue | undefined>;
  scalar: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue | undefined>;
  prepare: {
    (statement: IcpdbPreparedStatementInput, args?: IcpdbSqlArgsInput): IcpdbPreparedStatement;
    (statement: IcpdbPreparedStatementInput, args: IcpdbSqlArgsInput | undefined, databaseId: string): IcpdbPreparedStatement;
  };
  run: (statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput) => Promise<SqlExecuteResponse>;
  batch: (statements: readonly IcpdbBatchStatementInput[], options?: IcpdbLowLevelBatchOptions) => Promise<SqlExecuteResponse[]>;
  transaction: (statements: readonly IcpdbBatchStatementInput[], options?: IcpdbLowLevelBatchOptions) => Promise<SqlExecuteResponse[]>;
  exec: (source: string, options?: IcpdbBatchOptions) => Promise<void>;
  executeMultiple: (source: string, options?: IcpdbBatchOptions) => Promise<void>;
  executeScript: (source: string, options?: IcpdbBatchOptions) => Promise<SqlExecuteResponse[]>;
  migrate: {
    (migrations: readonly IcpdbMigration[], databaseId?: string): Promise<IcpdbMigrationResult>;
    (statements: readonly IcpdbSqlClientBatchStatement[], databaseId?: string): Promise<IcpdbSqlClientResult[]>;
  };
  dumpSql: {
    (options?: IcpdbSqlDumpOptions): Promise<string>;
    (databaseId: string, options?: IcpdbSqlDumpOptions): Promise<string>;
  };
  loadSqlDump: (source: string, options?: IcpdbBatchOptions) => Promise<SqlExecuteResponse[]>;
  listTables: (databaseId?: string) => Promise<DatabaseTable[]>;
  tables: (databaseId?: string) => Promise<DatabaseTable[]>;
  views: (databaseId?: string) => Promise<DatabaseTable[]>;
  describeTable: (tableName: string, databaseId?: string) => Promise<TableDescription>;
  describe: (tableName: string, databaseId?: string) => Promise<TableDescription>;
  listColumns: (tableName: string, databaseId?: string) => Promise<DatabaseColumn[]>;
  columns: (tableName: string, databaseId?: string) => Promise<DatabaseColumn[]>;
  listIndexes: (tableName: string, databaseId?: string) => Promise<DatabaseIndex[]>;
  indexes: (tableName: string, databaseId?: string) => Promise<DatabaseIndex[]>;
  listTriggers: (tableName: string, databaseId?: string) => Promise<DatabaseTrigger[]>;
  triggers: (tableName: string, databaseId?: string) => Promise<DatabaseTrigger[]>;
  listForeignKeys: (tableName: string, databaseId?: string) => Promise<DatabaseForeignKey[]>;
  foreignKeys: (tableName: string, databaseId?: string) => Promise<DatabaseForeignKey[]>;
  schema: (tableName?: string, databaseId?: string) => Promise<string>;
  inspect: {
    (options?: IcpdbInspectOptions): Promise<IcpdbDatabaseInspection>;
    (databaseId: string, options?: IcpdbInspectOptions): Promise<IcpdbDatabaseInspection>;
  };
  previewTable: (tableName: string, options?: IcpdbPreviewOptions) => Promise<TablePreviewResponse>;
  preview: (tableName: string, options?: IcpdbPreviewOptions) => Promise<TablePreviewResponse>;
};

export type IcpdbDatabaseClient = {
  databaseId: string;
  connectionUrl: () => string;
  url: () => string;
  info: () => IcpdbSqlClientInfo;
  delete: () => Promise<void>;
  getUsage: () => Promise<DatabaseUsage>;
  status: () => Promise<IcpdbDatabaseStatus>;
  listUsageEvents: () => Promise<DatabaseUsageEventSummary[]>;
  getRoutedOperation: (operationId: string) => Promise<RoutedOperationInfo>;
  reconcileRoutedOperation: (operationId: string) => Promise<RoutedOperationInfo>;
  waitForRoutedOperation: (operationId: string, options?: IcpdbWaitForRoutedOperationOptions) => Promise<RoutedOperationInfo>;
  placement: () => Promise<DatabaseShardPlacement | null>;
  beginArchive: () => Promise<DatabaseArchiveInfo>;
  readArchiveChunk: (offset: string, maxBytes?: number) => Promise<number[]>;
  finalizeArchive: (snapshotHash: readonly number[]) => Promise<void>;
  cancelArchive: () => Promise<void>;
  archive: () => Promise<Uint8Array>;
  snapshotInfo: (snapshot: IcpdbRestoreInput) => Promise<IcpdbSnapshotInfo>;
  beginRestore: (snapshotHash: readonly number[], sizeBytes: string) => Promise<void>;
  writeRestoreChunk: (offset: string, bytes: IcpdbRestoreInput) => Promise<void>;
  finalizeRestore: () => Promise<void>;
  restore: (snapshot: IcpdbRestoreInput, options?: IcpdbRestoreOptions) => Promise<void>;
  query: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<SqlExecuteResponse>;
  queryRows: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow[]>;
  queryOne: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  all: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow[]>;
  get: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  values: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue[][]>;
  first: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbRow | null>;
  firstValue: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue | undefined>;
  scalar: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<IcpdbCellValue | undefined>;
  prepare: (statement: IcpdbPreparedStatementInput, args?: IcpdbSqlArgsInput) => IcpdbPreparedStatement;
  execute: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<SqlExecuteResponse>;
  run: (statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput) => Promise<SqlExecuteResponse>;
  batch: (statements: readonly IcpdbBatchStatementInput[], options?: IcpdbSqlClientBatchOptions) => Promise<SqlExecuteResponse[]>;
  transaction: (statements: readonly IcpdbBatchStatementInput[], options?: IcpdbSqlClientBatchOptions) => Promise<SqlExecuteResponse[]>;
  exec: (source: string, options?: IcpdbDatabaseBatchOptionsObject) => Promise<void>;
  executeMultiple: (source: string, options?: IcpdbDatabaseBatchOptionsObject) => Promise<void>;
  executeScript: (source: string, options?: IcpdbDatabaseBatchOptionsObject) => Promise<SqlExecuteResponse[]>;
  migrate: {
    (migrations: readonly IcpdbMigration[]): Promise<IcpdbMigrationResult>;
    (statements: readonly IcpdbSqlClientBatchStatement[]): Promise<IcpdbSqlClientResult[]>;
  };
  dumpSql: (options?: IcpdbSqlDumpOptions) => Promise<string>;
  loadSqlDump: (source: string, options?: IcpdbDatabaseBatchOptionsObject) => Promise<SqlExecuteResponse[]>;
  listTables: () => Promise<DatabaseTable[]>;
  tables: () => Promise<DatabaseTable[]>;
  views: () => Promise<DatabaseTable[]>;
  describeTable: (tableName: string) => Promise<TableDescription>;
  describe: (tableName: string) => Promise<TableDescription>;
  listColumns: (tableName: string) => Promise<DatabaseColumn[]>;
  columns: (tableName: string) => Promise<DatabaseColumn[]>;
  listIndexes: (tableName: string) => Promise<DatabaseIndex[]>;
  indexes: (tableName: string) => Promise<DatabaseIndex[]>;
  listTriggers: (tableName: string) => Promise<DatabaseTrigger[]>;
  triggers: (tableName: string) => Promise<DatabaseTrigger[]>;
  listForeignKeys: (tableName: string) => Promise<DatabaseForeignKey[]>;
  foreignKeys: (tableName: string) => Promise<DatabaseForeignKey[]>;
  schema: (tableName?: string) => Promise<string>;
  inspect: (options?: IcpdbInspectOptions) => Promise<IcpdbDatabaseInspection>;
  previewTable: (tableName: string, options?: IcpdbDatabasePreviewOptionsObject) => Promise<TablePreviewResponse>;
  preview: (tableName: string, options?: IcpdbDatabasePreviewOptionsObject) => Promise<TablePreviewResponse>;
  grantMember: (principal: string, role: DatabaseRole) => Promise<void>;
  revokeMember: (principal: string) => Promise<void>;
  listMembers: () => Promise<DatabaseMember[]>;
  close: () => void;
};

export async function connectIcpdbDatabase(options: IcpdbConnectDatabaseOptions): Promise<IcpdbDatabaseClient> {
  return createIcpdbClient(options).connectDatabase();
}

export async function createIcpdbDatabase(options: IcpdbCreateDatabaseOptions): Promise<IcpdbDatabaseClient> {
  assertCreateDatabaseOptions(options);
  assertCreateSetupOptions(options);
  return createDatabaseWithSetup(createIcpdbClient(options), {
    setupSql: options.setupSql,
    setupStatements: options.setupStatements,
    setupMigrations: options.setupMigrations
  });
}

export const connectDatabase = connectIcpdbDatabase;
export const createDatabase = createIcpdbDatabase;

export function createClient(options: IcpdbSqlClientOptions): IcpdbSqlClient {
  const connection = normalizeIcpdbClientOptions(options);
  assertSqlClientSetupOptions(options, connection.databaseId);
  assertCreateSetupOptions({
    setupSql: options.setupSql,
    setupStatements: options.setupStatements,
    setupMigrations: options.setupMigrations
  });
  const client = createIcpdbClient(options);
  let connectedDatabaseId = connection.databaseId;
  return createClientFromDatabase(async () => {
    if (connectedDatabaseId) return client.database(connectedDatabaseId);
    const db = await createDatabaseWithSetup(client, {
      setupSql: options.setupSql,
      setupStatements: options.setupStatements,
      setupMigrations: options.setupMigrations
    });
    connectedDatabaseId = db.databaseId;
    return db;
  }, {
    principal: () => client.principal(),
    health: () => client.health(),
    intMode: options.intMode
  });
}

export function connectClient(options: IcpdbConnectSqlClientOptions): IcpdbSqlClient {
  const connection = normalizeIcpdbClientOptions(options);
  requiredDatabaseId(undefined, connection.databaseId);
  return createClient(options);
}

export function createTursoLikeClient(options: IcpdbCreateClientOptions): IcpdbSqlClient {
  return createClient(options);
}

export function createLibsqlClient(options: IcpdbCreateClientOptions): IcpdbSqlClient {
  return createClient(options);
}

export function sql(strings: TemplateStringsArray, ...values: IcpdbSqlValueInput[]): IcpdbSqlTemplateStatement {
  if (!Array.isArray(strings) || !("raw" in strings)) {
    throw new Error("sql template must use tagged template syntax");
  }
  if (strings.length === 0 || values.length !== strings.length - 1) {
    throw new Error("sql template values must match template holes");
  }
  let source = "";
  for (let index = 0; index < strings.length; index += 1) {
    const segment = strings[index];
    if (typeof segment !== "string") throw new Error("sql template segments must be strings");
    source += segment;
    if (index >= values.length) continue;
    validateSqlValueInput(values[index]);
    source += `?${index + 1}`;
  }
  return {
    sql: requiredSqlString(source, "SQL template SQL"),
    args: values
  };
}

export function createClientFromDatabase(
  databaseSource: IcpdbSqlClientDatabaseSource | (() => Promise<IcpdbSqlClientDatabaseSource>),
  metadata: IcpdbSqlClientMetadata = {}
): IcpdbSqlClient {
  let databasePromise: Promise<IcpdbSqlClientDatabase> | null = null;
  let closed = false;
  let deleted = false;
  const intMode = normalizeIntMode(metadata.intMode);

  function database(): Promise<IcpdbSqlClientDatabase> {
    if (deleted) throw new Error("database client has been deleted; create a new client");
    closed = false;
    if (!databasePromise) {
      const nextPromise = typeof databaseSource === "function" ? Promise.resolve().then(databaseSource) : Promise.resolve(databaseSource);
      let cachedPromise: Promise<IcpdbSqlClientDatabase>;
      cachedPromise = nextPromise.then((source) => {
        const enriched = enrichSqlClientDatabase(source, intMode);
        return {
          ...enriched,
          delete: async () => {
            await enriched.delete();
            try {
              void Promise.resolve(enriched.close()).catch(noop);
            } catch {
              // Deleting the hosted DB is terminal for this client; keep that state even if local close cleanup fails.
            }
            deleted = true;
            closed = true;
            databasePromise = null;
          }
        };
      }).catch((error) => {
        if (databasePromise === cachedPromise) databasePromise = null;
        throw error;
      });
      databasePromise = cachedPromise;
    }
    return databasePromise;
  }

  function closeCachedDatabase(): void {
    const currentDatabase = databasePromise;
    databasePromise = null;
    if (currentDatabase) void currentDatabase.then((db) => db.close()).catch(noop);
  }

  async function principal(): Promise<string> {
    if (!metadata.principal) throw new Error("principal is not available on this database source");
    const principal = requiredNonEmptyString(await metadata.principal(), "principal");
    if (principal === ANONYMOUS_PRINCIPAL) {
      throw new Error("anonymous client metadata principal is not allowed");
    }
    return principal;
  }

  async function health(): Promise<CanisterHealth> {
    if (!metadata.health) throw new Error("health is not available on this database source");
    return metadata.health();
  }

  async function execute(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbSqlClientResult> {
    const request = sqlClientStatement(statement, args);
    const wait = statementWaitOption(statement);
    if (isReadSql(request.sql)) validateWriteSqlIdempotencyKey(request);
    if (isReadSql(request.sql)) rejectReadSqlWaitOption(wait);
    const db = await database();
    const response = isReadSql(request.sql) ? await db.query(request) : await db.execute(request);
    if (!isReadSql(request.sql)) await waitForStatementRoutedOperation(db, response, wait);
    return sqlClientResult(response, intMode);
  }

  async function query(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbSqlClientResult> {
    const request = sqlClientStatement(statement, args);
    rejectReadSqlWaitOption(statementWaitOption(statement));
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    const db = await database();
    return sqlClientResult(await db.query(request), intMode);
  }

  async function queryRows(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbRow[]> {
    return (await query(statement, args)).rows;
  }

  async function queryOne(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbRow | null> {
    return (await queryRows(statement, args))[0] ?? null;
  }

  async function all(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbRow[]> {
    return queryRows(statement, args);
  }

  async function get(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbRow | null> {
    return queryOne(statement, args);
  }

  async function values(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbCellValue[][]> {
    return resultValues(await query(statement, args));
  }

  async function first(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbRow | null> {
    return queryOne(statement, args);
  }

  async function firstValue(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbCellValue | undefined> {
    return firstResultValue(await query(statement, args));
  }

  async function scalar(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbCellValue | undefined> {
    return firstValue(statement, args);
  }

  async function run(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): Promise<IcpdbSqlClientResult> {
    return execute(statement, args);
  }

  function prepare(statement: IcpdbPreparedStatementInput, boundArgs?: IcpdbSqlArgsInput): IcpdbPreparedStatement {
    if (typeof statement !== "string" && !isSqlClientStatementTuple(statement)) rejectPreparedStatementOptions(statement);
    const request = sqlClientStatement(statement, boundArgs);
    const normalizedSql = request.sql;
    const initialArgs = request.params;
    const statementArgs = (args?: IcpdbSqlArgsInput) => args ?? initialArgs;
    return {
      sql: normalizedSql,
      bind: (args) => prepare(normalizedSql, statementArgs(args)),
      execute: (args) => execute({ sql: normalizedSql, args: statementArgs(args) }),
      query: (args) => query({ sql: normalizedSql, args: statementArgs(args) }),
      queryRows: (args) => queryRows({ sql: normalizedSql, args: statementArgs(args) }),
      queryOne: (args) => queryOne({ sql: normalizedSql, args: statementArgs(args) }),
      all: (args) => queryRows({ sql: normalizedSql, args: statementArgs(args) }),
      get: (args) => queryOne({ sql: normalizedSql, args: statementArgs(args) }),
      values: (args) => values({ sql: normalizedSql, args: statementArgs(args) }),
      first: (args) => queryOne({ sql: normalizedSql, args: statementArgs(args) }),
      firstValue: (args) => firstValue({ sql: normalizedSql, args: statementArgs(args) }),
      scalar: (args) => firstValue({ sql: normalizedSql, args: statementArgs(args) }),
      run: (args) => execute({ sql: normalizedSql, args: statementArgs(args) })
    };
  }

  async function batch(statements: readonly IcpdbSqlClientBatchStatement[], options?: IcpdbSqlClientBatchOptions): Promise<IcpdbSqlClientResult[]> {
    const request = requiredBatchStatements(statements, "batch").map(sqlClientBatchStatement);
    rejectSqlClientBatchOptionDatabaseId(options);
    const mode = batchMode(options);
    validateReadBatchOptions(options, mode);
    if (mode === "read") {
      validateReadBatchStatements(request, "read");
      const maxRows = batchMaxRows(options);
      const db = await database();
      const responses: SqlExecuteResponse[] = [];
      for (const statement of request) responses.push(await db.query({ ...statement, maxRows }));
      return responses.map((response) => sqlClientResult(response, intMode));
    }
    const batchOptions = sqlClientBatchOptions(request, options);
    const db = await database();
    const responses = await db.batch(request, batchOptions);
    return responses.map((response) => sqlClientResult(response, intMode));
  }

  async function transaction(statements: readonly IcpdbSqlClientBatchStatement[], options?: IcpdbSqlClientBatchOptions): Promise<IcpdbSqlClientResult[]>;
  async function transaction(mode?: IcpdbBatchMode): Promise<never>;
  async function transaction(
    statementsOrMode?: readonly IcpdbSqlClientBatchStatement[] | IcpdbBatchMode,
    options?: IcpdbSqlClientBatchOptions
  ): Promise<IcpdbSqlClientResult[]> {
    if (!Array.isArray(statementsOrMode)) {
      throw new Error("interactive transactions are not supported; use batch(statements, \"write\") or transaction(statements)");
    }
    return batch(requiredBatchStatements(statementsOrMode, "transaction"), options);
  }

  async function executeScript(source: string, options?: IcpdbSqlClientScriptOptionsObject): Promise<IcpdbSqlClientResult[]> {
    const statements = sqlScriptStatements(source);
    const batchOptions = sqlClientBatchOptions(statements, options);
    const db = await database();
    const responses = await executeStatementBatches(
      (batchStatements, chunkOptions) => db.batch(batchStatements, chunkOptions),
      statements,
      batchOptions
    );
    return responses.map((response) => sqlClientResult(response, intMode));
  }

  async function executeMultiple(source: string, options?: IcpdbSqlClientScriptOptionsObject): Promise<void> {
    const statements = sqlScriptStatements(source);
    if (options !== undefined) {
      await executeScript(source, options);
      return;
    }
    await executeMultipleOnDatabase(await database(), statements);
  }

  async function exec(source: string, options?: IcpdbSqlClientScriptOptionsObject): Promise<void> {
    await executeScript(source, options);
  }

  async function migrate(migrations: readonly IcpdbMigration[]): Promise<IcpdbMigrationResult>;
  async function migrate(statements: readonly IcpdbSqlClientBatchStatement[]): Promise<IcpdbSqlClientResult[]>;
  async function migrate(input: IcpdbMigrateInput): Promise<IcpdbMigrationResult | IcpdbSqlClientResult[]> {
    const migrateInput = requiredMigrateInput(input);
    if (!isVersionedMigrations(migrateInput)) return libsqlMigrate(migrateInput);
    const migrations = migrateInput;
    const normalized = normalizeMigrations(migrations);
    await ensureMigrationTable();
    const appliedVersions = new Set((await queryRows(`SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`)).map((row) => String(row.version)));
    const result: IcpdbMigrationResult = { applied: [], skipped: [] };
    for (const migration of normalized) {
      if (appliedVersions.has(migration.version)) {
        result.skipped.push(migration.version);
        continue;
      }
      const statements = splitSqlStatements(migration.sql);
      if (statements.length === 0) throw new Error(`migration ${migration.version} has no SQL statements`);
      await batch([
        ...statements.map((sql) => ({ sql, params: [] })),
        {
          sql: `INSERT INTO ${MIGRATIONS_TABLE}(version, name, applied_at_ms) VALUES (?1, ?2, ?3)`,
          args: [migration.version, migration.name, String(Date.now())]
        }
      ], "write");
      appliedVersions.add(migration.version);
      result.applied.push(migration.version);
    }
    return result;
  }

  async function libsqlMigrate(statements: readonly IcpdbSqlClientBatchStatement[]): Promise<IcpdbSqlClientResult[]> {
    const db = await database();
    const request = statements.map(sqlClientBatchStatement);
    await db.execute({ sql: "PRAGMA foreign_keys=off", params: [] });
    let responses: SqlExecuteResponse[] | undefined;
    let batchError: unknown;
    try {
      responses = await db.batch(request, "deferred");
    } catch (error) {
      batchError = error;
    }
    try {
      await db.execute({ sql: "PRAGMA foreign_keys=on", params: [] });
    } catch (error) {
      if (batchError !== undefined) throw batchError;
      throw error;
    }
    if (batchError !== undefined) throw batchError;
    if (responses === undefined) throw new Error("migrate batch did not return responses");
    return responses.map((response) => sqlClientResult(response, intMode));
  }

  async function dumpSql(options?: IcpdbSqlDumpOptions): Promise<string> {
    const dumpOptions = normalizedSqlDumpOptions(options);
    return dumpSqlFromDatabase(await database(), dumpOptions);
  }

  async function loadSqlDump(source: string, options?: IcpdbSqlClientScriptOptionsObject): Promise<IcpdbSqlClientResult[]> {
    const statements = sqlDumpStatements(source);
    const batchOptions = sqlClientBatchOptions(statements, options);
    const db = await database();
    const responses = await executeStatementBatches(
      (batchStatements, chunkOptions) => db.batch(batchStatements, chunkOptions),
      statements,
      batchOptions
    );
    return responses.map((response) => sqlClientResult(response, intMode));
  }

  async function deleteDatabase(): Promise<void> {
    const db = await database();
    await db.delete();
    deleted = true;
    closed = true;
    databasePromise = null;
  }

  async function getUsage(): Promise<DatabaseUsage> {
    const db = await database();
    if (!db.getUsage) throw new Error("getUsage is not available on this database source");
    return db.getUsage();
  }

  async function status(): Promise<IcpdbDatabaseStatus> {
    const db = await database();
    const callerPrincipal = metadata.principal ? await principal() : undefined;
    const dbStatus = await db.status();
    if (callerPrincipal && !dbStatus.callerPrincipal) return { ...dbStatus, callerPrincipal };
    return dbStatus;
  }

  async function listUsageEvents(): Promise<DatabaseUsageEventSummary[]> {
    const db = await database();
    if (!db.listUsageEvents) throw new Error("listUsageEvents is not available on this database source");
    return db.listUsageEvents();
  }

  async function getRoutedOperation(operationId: string): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    const db = await database();
    if (!db.getRoutedOperation) throw new Error("getRoutedOperation is not available on this database source");
    return db.getRoutedOperation(normalizedOperationId);
  }

  async function reconcileRoutedOperation(operationId: string): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    const db = await database();
    if (!db.reconcileRoutedOperation) throw new Error("reconcileRoutedOperation is not available on this database source");
    return db.reconcileRoutedOperation(normalizedOperationId);
  }

  async function waitForRoutedOperation(operationId: string, waitOptions?: IcpdbWaitForRoutedOperationOptions): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    const normalizedWaitOptions = normalizedWaitForRoutedOperationOptions(waitOptions);
    const db = await database();
    return db.waitForRoutedOperation(normalizedOperationId, normalizedWaitOptions);
  }

  async function grantMember(principal: string, role: DatabaseRole): Promise<void> {
    const normalizedPrincipal = grantablePrincipal(principal);
    assertDatabaseRole(role);
    const db = await database();
    if (!db.grantMember) throw new Error("grantMember is not available on this database source");
    await db.grantMember(normalizedPrincipal, role);
  }

  async function revokeMember(principal: string): Promise<void> {
    const normalizedPrincipal = memberPrincipal(principal);
    const db = await database();
    if (!db.revokeMember) throw new Error("revokeMember is not available on this database source");
    await db.revokeMember(normalizedPrincipal);
  }

  async function listMembers(): Promise<DatabaseMember[]> {
    const db = await database();
    if (!db.listMembers) throw new Error("listMembers is not available on this database source");
    return db.listMembers();
  }

  async function placement(): Promise<DatabaseShardPlacement | null> {
    const db = await database();
    if (!db.placement) throw new Error("placement is not available on this database source");
    return db.placement();
  }

  async function connectionUrl(): Promise<string> {
    const db = await database();
    if (!db.connectionUrl) throw new Error("connectionUrl is not available on this database source");
    return db.connectionUrl();
  }

  async function url(): Promise<string> {
    return connectionUrl();
  }

  async function info(): Promise<IcpdbSqlClientInfo> {
    const db = await database();
    const baseInfo = db.info();
    if (!metadata.principal) return baseInfo;
    return {
      ...baseInfo,
      principal: await principal()
    };
  }

  async function archive(): Promise<Uint8Array> {
    const db = await database();
    if (!db.archive) throw new Error("archive is not available on this database source");
    return db.archive();
  }

  async function restore(snapshot: IcpdbRestoreInput, options?: IcpdbRestoreOptions): Promise<void> {
    const db = await database();
    await db.restore(snapshot, options);
  }

  async function listTables(): Promise<DatabaseTable[]> {
    return (await database()).listTables();
  }

  async function views(): Promise<DatabaseTable[]> {
    return (await database()).views();
  }

  async function describeTable(tableName: string): Promise<TableDescription> {
    const normalizedTableName = requiredTableName(tableName);
    return (await database()).describeTable(normalizedTableName);
  }

  async function listColumns(tableName: string): Promise<DatabaseColumn[]> {
    const normalizedTableName = requiredTableName(tableName);
    return (await database()).listColumns(normalizedTableName);
  }

  async function listIndexes(tableName: string): Promise<DatabaseIndex[]> {
    const normalizedTableName = requiredTableName(tableName);
    return (await database()).listIndexes(normalizedTableName);
  }

  async function listTriggers(tableName: string): Promise<DatabaseTrigger[]> {
    const normalizedTableName = requiredTableName(tableName);
    return (await database()).listTriggers(normalizedTableName);
  }

  async function listForeignKeys(tableName: string): Promise<DatabaseForeignKey[]> {
    const normalizedTableName = requiredTableName(tableName);
    return (await database()).listForeignKeys(normalizedTableName);
  }

  async function previewTable(tableName: string, options?: IcpdbDatabasePreviewOptionsObject): Promise<TablePreviewResponse> {
    const normalizedTableName = requiredTableName(tableName);
    return (await database()).previewTable(normalizedTableName, normalizePreviewOptions(options));
  }

  async function inspect(options?: IcpdbInspectOptions): Promise<IcpdbDatabaseInspection> {
    const inspectOptions = normalizedInspectOptions(options);
    return inspectDatabase(await database(), inspectOptions);
  }

  async function ensureMigrationTable(): Promise<void> {
    const existing = await queryRows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1", [MIGRATIONS_TABLE]);
    if (existing.length > 0) return;
    await batch([{
      sql: `CREATE TABLE ${MIGRATIONS_TABLE}(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at_ms TEXT NOT NULL)`,
      params: []
    }], "write");
  }

  return {
    get closed() {
      return closed;
    },
    protocol: "icpdb",
    database,
    principal,
    health,
    databaseId: async () => (await database()).databaseId,
    connectionUrl,
    url,
    info,
    execute,
    query,
    queryRows,
    queryOne,
    all,
    get,
    values,
    first,
    firstValue,
    scalar,
    run,
    prepare,
    batch,
    transaction,
    exec,
    executeMultiple,
    executeScript,
    migrate,
    dumpSql,
    loadSqlDump,
    delete: deleteDatabase,
    getUsage,
    status,
    listUsageEvents,
    getRoutedOperation,
    reconcileRoutedOperation,
    waitForRoutedOperation,
    grantMember,
    revokeMember,
    listMembers,
    placement,
    archive,
    snapshotInfo,
    restore,
    listTables,
    tables: listTables,
    views,
    describeTable,
    describe: describeTable,
    listColumns,
    columns: listColumns,
    listIndexes,
    indexes: listIndexes,
    listTriggers,
    triggers: listTriggers,
    listForeignKeys,
    foreignKeys: listForeignKeys,
    previewTable,
    preview: previewTable,
    inspect,
    schema: async (tableName) => {
      const normalizedTableName = optionalTableName(tableName);
      return (await database()).schema(normalizedTableName ?? undefined);
    },
    close: () => {
      closed = true;
      closeCachedDatabase();
    },
    reconnect: () => {
      if (deleted) throw new Error("database client has been deleted; create a new client");
      closed = false;
      closeCachedDatabase();
    },
    sync: async () => {
      throw new Error("sync is not supported; ICPDB does not provide embedded replica sync");
    }
  };
}

export type IcpdbParsedDatabaseUrl = {
  canisterId: string;
  databaseId?: string;
};

export type IcpdbSnapshotInfo = {
  sizeBytes: number;
  sha256: string;
  snapshotHash: number[];
};

export function formatIcpdbDatabaseUrl(canisterId: string, databaseId: string): string {
  return `icpdb://${requiredNonEmptyString(canisterId, "canisterId")}/${encodeURIComponent(normalizeDatabaseId(databaseId))}`;
}

export function formatIcpdbCanisterUrl(canisterId: string): string {
  return `icpdb://${requiredNonEmptyString(canisterId, "canisterId")}`;
}

function databaseClientInfo(databaseId: string, connectionUrl: string, url: string, canisterId?: string): IcpdbSqlClientInfo {
  const normalizedDatabaseId = normalizeDatabaseId(databaseId);
  const normalizedConnectionUrl = requiredNonEmptyString(connectionUrl, "connectionUrl");
  const normalizedUrl = requiredNonEmptyString(url, "url");
  const derivedCanisterId = canisterIdFromMatchingIcpdbUrl(normalizedConnectionUrl, normalizedDatabaseId);
  const normalizedCanisterId = canisterId === undefined ? derivedCanisterId : requiredNonEmptyString(canisterId, "canisterId");
  if (derivedCanisterId !== undefined && normalizedCanisterId !== undefined && normalizedCanisterId !== derivedCanisterId) {
    throw new Error("canisterId does not match connectionUrl");
  }
  return {
    ...(normalizedCanisterId === undefined ? {} : { canisterId: normalizedCanisterId }),
    databaseId: normalizedDatabaseId,
    connectionUrl: normalizedConnectionUrl,
    url: normalizedUrl
  };
}

function canisterIdFromMatchingIcpdbUrl(connectionUrl: string, databaseId: string): string | undefined {
  try {
    const parsed = parseIcpdbDatabaseUrl(connectionUrl);
    return parsed.databaseId === databaseId ? parsed.canisterId : undefined;
  } catch {
    return undefined;
  }
}

export async function snapshotInfo(snapshot: IcpdbRestoreInput): Promise<IcpdbSnapshotInfo> {
  const bytes = transferUint8Array(snapshot);
  const snapshotHash = await sha256(bytes);
  return normalizeSnapshotInfo({
    sizeBytes: bytes.byteLength,
    sha256: bytesToHex(snapshotHash),
    snapshotHash
  }, { sizeBytes: bytes.byteLength, sha256: bytesToHex(snapshotHash) });
}

type IcpdbRuntimeRestoreOptions = Omit<IcpdbRestoreOptions, "databaseId"> & {
  databaseId?: string | null;
};

function normalizeRestoreOptions(options: IcpdbRuntimeRestoreOptions | undefined): IcpdbRestoreOptions | undefined {
  if (options === undefined) return undefined;
  rejectRestoreOptionDatabaseId(options);
  const expectedSha256 = expectedSnapshotSha256(options);
  return {
    ...(expectedSha256 === undefined ? {} : { expectedSha256 })
  };
}

function rejectRestoreOptionDatabaseId(options: IcpdbRuntimeRestoreOptions | undefined): void {
  if (typeof options !== "object" || options === null) return;
  if (!("databaseId" in options) || options.databaseId === undefined || options.databaseId === null) return;
  throw new Error("database restore option databaseId is not supported; choose database at the client, low-level restore argument, or database handle");
}

async function normalizedRestorePayload(snapshot: IcpdbRestoreInput, options?: IcpdbRestoreOptions): Promise<{ bytes: Uint8Array; options?: IcpdbRestoreOptions; snapshotHash: number[] }> {
  const restoreOptions = normalizeRestoreOptions(options);
  const expectedSha256 = expectedSnapshotSha256(restoreOptions);
  const bytes = transferUint8Array(snapshot);
  const snapshotHash = await sha256(bytes);
  assertExpectedSnapshotHashBytes(snapshotHash, expectedSha256);
  return { bytes, options: restoreOptions, snapshotHash };
}

function normalizeSnapshotInfo(info: IcpdbSnapshotInfo, expected?: { sizeBytes: number; sha256: string }): IcpdbSnapshotInfo {
  if (typeof info !== "object" || info === null) throw new Error("snapshot info must be an object");
  if (!Number.isSafeInteger(info.sizeBytes) || info.sizeBytes < 0) throw new Error("snapshot sizeBytes must be a non-negative safe integer");
  const sha256Text = snapshotSha256Text(info.sha256);
  const snapshotHash = snapshotHashBytes(info.snapshotHash, "snapshotHash");
  if (bytesToHex(snapshotHash) !== sha256Text) throw new Error("snapshot hash bytes do not match snapshot sha256");
  if (expected !== undefined) {
    if (info.sizeBytes !== expected.sizeBytes) throw new Error("snapshot sizeBytes does not match snapshot byte length");
    if (sha256Text !== expected.sha256) throw new Error(`snapshot hash mismatch: expected ${expected.sha256}, got ${sha256Text}`);
  }
  return {
    sizeBytes: info.sizeBytes,
    sha256: sha256Text,
    snapshotHash
  };
}

function snapshotSha256Text(value: unknown): string {
  if (typeof value !== "string") throw new Error("snapshot sha256 must be a 64-character hex SHA-256 hash");
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error("snapshot sha256 must be a 64-character hex SHA-256 hash");
  return normalized;
}

function assertExpectedSnapshotHashBytes(snapshotHash: readonly number[], expectedSha256?: string): void {
  if (!expectedSha256) return;
  const actual = bytesToHex(snapshotHash);
  if (actual !== expectedSha256) throw new Error(`snapshot hash mismatch: expected ${expectedSha256}, got ${actual}`);
}

function expectedSnapshotSha256(options?: { expectedSha256?: string | null }): string | undefined {
  if (!options || options.expectedSha256 === undefined || options.expectedSha256 === null) return undefined;
  if (typeof options.expectedSha256 !== "string") throw new Error("expectedSha256 must be a 64-character hex SHA-256 hash");
  const expected = options.expectedSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error("expectedSha256 must be a 64-character hex SHA-256 hash");
  return expected;
}

export function parseIcpdbDatabaseUrl(url: string): IcpdbParsedDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`invalid ICPDB url: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.protocol !== "icpdb:") {
    throw new Error("ICPDB url must use icpdb://");
  }
  if (parsed.username || parsed.password) {
    throw new Error("ICPDB url must not include username or password");
  }
  if (parsed.port) {
    throw new Error("ICPDB url must not include a port");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("ICPDB url must not include query or fragment");
  }
  if (!parsed.hostname) {
    throw new Error("ICPDB url must include a canister id");
  }
  const hasDatabasePath = parsed.pathname !== "" && parsed.pathname !== "/";
  if (hasDatabasePath && !/^\/[^/]+$/.test(parsed.pathname)) {
    throw new Error("ICPDB url path must be /<database-id>");
  }
  let databaseId: string | undefined;
  try {
    databaseId = hasDatabasePath ? decodeURIComponent(parsed.pathname.slice(1)) : undefined;
  } catch (error) {
    throw new Error(`invalid ICPDB url database id encoding: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (databaseId !== undefined) databaseId = normalizeDatabaseId(databaseId);
  return {
    canisterId: parsed.hostname,
    databaseId
  };
}

export function classifyLibsqlErrorMessage(message: string): IcpdbLibsqlErrorClassification {
  if (/constraint/i.test(message)) return { code: "SQLITE_CONSTRAINT", extendedCode: "SQLITE_CONSTRAINT" };
  if (/readonly|read-only|query only accepts read SQL|read batch mode only accepts read SQL/i.test(message)) return { code: "SQLITE_READONLY", extendedCode: "SQLITE_READONLY" };
  if (/busy|locked/i.test(message)) return { code: "SQLITE_BUSY", extendedCode: "SQLITE_BUSY" };
  if (/permission|principal lacks|principal has no access|database is not visible to caller|database token not found|access denied|missing identity|anonymous (?:caller|identity|principal|client metadata principal)|api token scope does not allow|owner cannot (?:downgrade|revoke) own access|at least one owner principal/i.test(message)) return { code: "ICPDB_AUTH" };
  if (/quota|logical size|cycles|balance/i.test(message)) return { code: "ICPDB_QUOTA" };
  if (/unsupported libSQL option|not supported|missing client options|missing canisterId|idempotencyKey is only valid for write SQL|read batch mode does not accept idempotencyKey|batch mode must be read, write, or deferred|use either .* or .* not both|SQL (?:statement|args|bind value|number bind value|integer bind value|real bind value|text bind value|blob bind value)|maxRows must be|must be a non-empty string|must be an array or named object/i.test(message)) return { code: "SQLITE_MISUSE", extendedCode: "SQLITE_MISUSE" };
  if (/sql|sqlite|syntax|no such table|no such column|database/i.test(message)) return { code: "SQLITE_ERROR" };
  return { code: "ICPDB_ERROR" };
}

function normalizeIcpdbClientOptions(options: IcpdbClientOptions | null | undefined): NormalizedIcpdbClientOptions {
  assertClientOptions(options);
  assertNoUnsupportedLibsqlOptions(options);
  assertIdentity(options.identity);
  const url = optionalConnectionUrl(options);
  const optionCanisterId = optionalNonEmptyString(options.canisterId, "canisterId");
  const optionDatabaseId = optionalDatabaseId(options.databaseId);
  const host = optionalNonEmptyString(options.host, "host");
  const rootKey = optionalNonEmptyBytes(options.rootKey, "rootKey");
  const parsed = url ? parseIcpdbDatabaseUrl(url) : null;
  if (parsed && optionCanisterId && parsed.canisterId !== optionCanisterId) {
    throw new Error("canisterId does not match ICPDB url");
  }
  if (parsed?.databaseId && optionDatabaseId && parsed.databaseId !== optionDatabaseId) {
    throw new Error("databaseId does not match ICPDB url");
  }
  const canisterId = optionCanisterId ?? parsed?.canisterId;
  if (!canisterId) {
    throw new Error("missing canisterId; pass canisterId, url, or connectionUrl");
  }
  return {
    canisterId,
    identity: options.identity,
    databaseId: optionDatabaseId ?? parsed?.databaseId,
    host,
    rootKey
  };
}

function assertClientOptions<T extends object>(options: T | null | undefined): asserts options is T {
  if (typeof options !== "object" || options === null) throw new Error("missing client options");
}

function assertIdentity(identity: Identity | undefined): asserts identity is Identity {
  if (!hasGetPrincipal(identity)) throw new Error("missing identity; pass an IC identity");
  const principal = identityPrincipalText(identity);
  if (principal === ANONYMOUS_PRINCIPAL) {
    throw new Error("anonymous identity cannot be used; call authClient.login(...) and pass authClient.getIdentity()");
  }
}

function hasGetPrincipal(value: unknown): value is { getPrincipal: () => unknown } {
  return typeof value === "object" && value !== null && "getPrincipal" in value && typeof value.getPrincipal === "function";
}

function identityPrincipalText(identity: Identity): string {
  return requiredNonEmptyString(identity.getPrincipal().toText(), "principal");
}

function optionalNonEmptyString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredNonEmptyString(value, label);
}

function requiredNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalConnectionUrl(options: { url?: string; connectionUrl?: string }): string | undefined {
  const url = optionalNonEmptyString(options.url, "url");
  const connectionUrl = optionalNonEmptyString(options.connectionUrl, "connectionUrl");
  if (url !== undefined && connectionUrl !== undefined) {
    throw new Error("use either url or connectionUrl, not both");
  }
  return url ?? connectionUrl;
}

function requiredSqlString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalIdempotencyKey(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("idempotencyKey must be a non-empty string");
  }
  return value.trim();
}

function requiredTableName(value: string | undefined | null): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("tableName must be a non-empty string");
  return value.trim();
}

function requiredOperationId(value: string | undefined | null): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("operationId must be a non-empty string");
  return value.trim();
}

function requiredDatabaseCanisterId(value: string | undefined | null): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("databaseCanisterId must be a non-empty string");
  return value.trim();
}

function optionalTableName(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  return requiredTableName(value);
}

type IcpdbRuntimeSqlDumpOptions = Omit<IcpdbSqlDumpOptions, "databaseId"> & {
  databaseId?: string | null;
};

function normalizedSqlDumpOptions(options: IcpdbRuntimeSqlDumpOptions | undefined): IcpdbSqlDumpOptions | undefined {
  if (options === undefined) return undefined;
  rejectSqlDumpOptionDatabaseId(options);
  return {
    tableName: optionalTableName(options.tableName),
    pageSize: options.pageSize
  };
}

function rejectSqlDumpOptionDatabaseId(options: IcpdbRuntimeSqlDumpOptions | undefined): void {
  if (typeof options !== "object" || options === null) return;
  if (!("databaseId" in options) || options.databaseId === undefined || options.databaseId === null) return;
  throw new Error("database dump option databaseId is not supported; choose database at the client, low-level dump argument, or database handle");
}

type IcpdbRuntimeInspectOptions = Omit<IcpdbInspectOptions, "databaseId"> & {
  databaseId?: string | null;
};

function normalizedInspectOptions(options: IcpdbRuntimeInspectOptions | undefined): IcpdbInspectOptions | undefined {
  if (options === undefined) return undefined;
  rejectInspectOptionDatabaseId(options);
  return {
    tableName: optionalTableName(options.tableName),
    previewLimit: options.previewLimit,
    previewOffset: options.previewOffset
  };
}

function rejectInspectOptionDatabaseId(options: IcpdbRuntimeInspectOptions | undefined): void {
  if (typeof options !== "object" || options === null) return;
  if (!("databaseId" in options) || options.databaseId === undefined || options.databaseId === null) return;
  throw new Error("database inspect option databaseId is not supported; choose database at the client, low-level inspect argument, or database handle");
}

function optionalNonEmptyBytes(value: Uint8Array | undefined, label: string): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Uint8Array) || value.byteLength === 0) throw new Error(`${label} must be non-empty bytes`);
  return value;
}

function throwCanisterError(message: string): never {
  const classified = classifyLibsqlErrorMessage(message);
  throw new LibsqlError(message, classified.code, classified.extendedCode, classified.rawCode);
}

function assertNoUnsupportedLibsqlOptions(options: object): void {
  for (const key of UNSUPPORTED_LIBSQL_OPTIONS) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
    throw new Error(`unsupported libSQL option: ${key}; ICPDB uses IC identities and icpdb:// URLs instead of @libsql/client authToken/replica options`);
  }
}

function assertCreateDatabaseOptions(options: { url?: string; connectionUrl?: string; databaseId?: string } | null | undefined): void {
  assertClientOptions(options);
  const url = optionalConnectionUrl(options);
  const databaseId = optionalNonEmptyString(options.databaseId, "databaseId");
  const parsed = url ? parseIcpdbDatabaseUrl(url) : null;
  if (databaseId || parsed?.databaseId) {
    throw new Error("createIcpdbDatabase creates a new database; omit databaseId and use a canister-only ICPDB url");
  }
}

function assertSqlClientSetupOptions(setup: Omit<IcpdbCreateSetup, "databaseId">, databaseId: string | undefined): void {
  if (!databaseId) return;
  if (setup.setupSql === undefined && setup.setupStatements === undefined && setup.setupMigrations === undefined) return;
  throw new Error("setupSql/setupStatements/setupMigrations require creating a database; omit databaseId or call exec/batch/migrate explicitly");
}

function assertCreateSetupOptions(setup: IcpdbCreateSetup): void {
  if (setup.databaseId !== undefined && setup.databaseId !== null) {
    throw new Error("create setup databaseId is not supported; createDatabase always creates a new database");
  }
  if (setup.setupSql !== undefined) requiredSqlString(setup.setupSql, "setupSql");
  if (setup.setupStatements !== undefined) {
    if (!Array.isArray(setup.setupStatements) || setup.setupStatements.length === 0) {
      throw new Error("setupStatements must be a non-empty array");
    }
  }
  if (setup.setupMigrations !== undefined) {
    if (!Array.isArray(setup.setupMigrations) || setup.setupMigrations.length === 0) {
      throw new Error("setupMigrations must be a non-empty array");
    }
  }
}

export function createIcpdbClient(options: IcpdbClientOptions): IcpdbClient {
  const connection = normalizeIcpdbClientOptions(options);
  const actorOptions = connection.host || connection.rootKey ? { host: connection.host, rootKey: connection.rootKey } : undefined;

  async function actor() {
    return createAuthenticatedActor(connection.canisterId, connection.identity, actorOptions);
  }

  function database(databaseId: string): IcpdbDatabaseClient {
    const resolvedDatabaseId = requiredDatabaseId(databaseId, undefined);
    const connectionUrl = () => formatIcpdbDatabaseUrl(connection.canisterId, resolvedDatabaseId);
    function migrateDatabase(migrations: readonly IcpdbMigration[]): Promise<IcpdbMigrationResult>;
    function migrateDatabase(statements: readonly IcpdbSqlClientBatchStatement[]): Promise<IcpdbSqlClientResult[]>;
    function migrateDatabase(input: IcpdbMigrateInput): Promise<IcpdbMigrationResult | IcpdbSqlClientResult[]> {
      const sqlClient = createClientFromDatabase(database(resolvedDatabaseId));
      if (isVersionedMigrations(input)) return sqlClient.migrate(input);
      return sqlClient.migrate(input);
    }
    return {
      databaseId: resolvedDatabaseId,
      connectionUrl,
      url: connectionUrl,
      info: () => databaseClientInfo(resolvedDatabaseId, connectionUrl(), connectionUrl()),
      delete: () => deleteDatabaseWithDatabase(resolvedDatabaseId),
      getUsage: () => getUsageWithDatabase(resolvedDatabaseId),
      status: () => statusWithDatabase(resolvedDatabaseId),
      listUsageEvents: () => listUsageEventsWithDatabase(resolvedDatabaseId),
      getRoutedOperation: (operationId) => getRoutedOperationWithDatabase(resolvedDatabaseId, operationId),
      reconcileRoutedOperation: (operationId) => reconcileRoutedOperationWithDatabase(resolvedDatabaseId, operationId),
      waitForRoutedOperation: (operationId, waitOptions) => waitForRoutedOperationWithDatabase(resolvedDatabaseId, operationId, waitOptions),
      placement: () => placementWithDatabase(resolvedDatabaseId),
      beginArchive: () => beginArchiveWithDatabase(resolvedDatabaseId),
      readArchiveChunk: (offset, maxBytes) => readArchiveChunkWithDatabase(resolvedDatabaseId, offset, maxBytes ?? TRANSFER_CHUNK_BYTES),
      finalizeArchive: (snapshotHash) => finalizeArchiveWithDatabase(resolvedDatabaseId, snapshotHash),
      cancelArchive: () => cancelArchiveWithDatabase(resolvedDatabaseId),
      archive: () => archiveWithDatabase(resolvedDatabaseId),
      snapshotInfo,
      beginRestore: (snapshotHash, sizeBytes) => beginRestoreWithDatabase(resolvedDatabaseId, snapshotHash, sizeBytes),
      writeRestoreChunk: (offset, bytes) => writeRestoreChunkWithDatabase(resolvedDatabaseId, offset, bytes),
      finalizeRestore: () => finalizeRestoreWithDatabase(resolvedDatabaseId),
      restore: (snapshot, restoreOptions) => restoreWithDatabase(resolvedDatabaseId, snapshot, restoreOptions),
      query: (statement, params) => queryWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params),
      queryRows: (statement, params) => queryRowsWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params),
      queryOne: (statement, params) => queryOneWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params),
      all: (statement, params) => queryRowsWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params),
      get: (statement, params) => queryOneWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params),
      values: async (statement, params) => responseValues(await queryWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params), "string"),
      first: (statement, params) => queryOneWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params),
      firstValue: async (statement, params) => firstResponseValue(await queryWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params), "string"),
      scalar: async (statement, params) => firstResponseValue(await queryWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params), "string"),
      prepare: (sql, args) => createClientFromDatabase(database(resolvedDatabaseId)).prepare(sql, args),
      execute: (statement, params) => executeWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params),
      run: (statement, params) => executeWithDatabase(resolvedDatabaseId, databaseBoundStatement(statement), params),
      batch: (statements, batchOptions) => batchWithDatabase(statements, databaseBoundBatchOptions(resolvedDatabaseId, batchOptions)),
      transaction: (statements, batchOptions) => batchWithDatabase(statements, databaseBoundBatchOptions(resolvedDatabaseId, batchOptions)),
      exec: async (source, scriptOptions) => {
        rejectSqlClientBatchOptionDatabaseId(scriptOptions);
        await executeScriptWithDatabase(resolvedDatabaseId, source, {
          databaseId: resolvedDatabaseId,
          maxRows: scriptOptions?.maxRows ?? null,
          idempotencyKey: scriptOptions?.idempotencyKey ?? null
        });
      },
      executeMultiple: (source, scriptOptions) => {
        rejectSqlClientBatchOptionDatabaseId(scriptOptions);
        return executeMultipleWithDatabase(resolvedDatabaseId, source, {
          databaseId: resolvedDatabaseId,
          maxRows: scriptOptions?.maxRows ?? null,
          idempotencyKey: scriptOptions?.idempotencyKey ?? null,
          mode: scriptOptions?.mode
        });
      },
      executeScript: async (source, scriptOptions) => {
        rejectSqlClientBatchOptionDatabaseId(scriptOptions);
        return executeScriptWithDatabase(resolvedDatabaseId, source, {
          databaseId: resolvedDatabaseId,
          maxRows: scriptOptions?.maxRows ?? null,
          idempotencyKey: scriptOptions?.idempotencyKey ?? null
        });
      },
      migrate: migrateDatabase,
      dumpSql: (dumpOptions) => dumpSqlWithDatabase(resolvedDatabaseId, dumpOptions),
      loadSqlDump: async (source, dumpOptions) => {
        rejectSqlClientBatchOptionDatabaseId(dumpOptions);
        return loadSqlDumpWithDatabase(resolvedDatabaseId, source, {
          databaseId: resolvedDatabaseId,
          maxRows: dumpOptions?.maxRows ?? null,
          idempotencyKey: dumpOptions?.idempotencyKey ?? null
        });
      },
      listTables: () => listTablesWithDatabase(resolvedDatabaseId),
      tables: () => listTablesWithDatabase(resolvedDatabaseId),
      views: () => viewsWithDatabase(resolvedDatabaseId),
      describeTable: (tableName) => describeTableWithDatabase(tableName, resolvedDatabaseId),
      describe: (tableName) => describeTableWithDatabase(tableName, resolvedDatabaseId),
      listColumns: (tableName) => listColumnsWithDatabase(tableName, resolvedDatabaseId),
      columns: (tableName) => listColumnsWithDatabase(tableName, resolvedDatabaseId),
      listIndexes: (tableName) => listIndexesWithDatabase(tableName, resolvedDatabaseId),
      indexes: (tableName) => listIndexesWithDatabase(tableName, resolvedDatabaseId),
      listTriggers: (tableName) => listTriggersWithDatabase(tableName, resolvedDatabaseId),
      triggers: (tableName) => listTriggersWithDatabase(tableName, resolvedDatabaseId),
      listForeignKeys: (tableName) => listForeignKeysWithDatabase(tableName, resolvedDatabaseId),
      foreignKeys: (tableName) => listForeignKeysWithDatabase(tableName, resolvedDatabaseId),
      schema: (tableName) => schemaWithDatabase(resolvedDatabaseId, tableName),
      inspect: (inspectOptions) => inspectWithDatabase(resolvedDatabaseId, inspectOptions),
      previewTable: (tableName, previewOptions) => previewTableWithDatabase(tableName, databaseBoundPreviewOptions(resolvedDatabaseId, previewOptions)),
      preview: (tableName, previewOptions) => previewTableWithDatabase(tableName, databaseBoundPreviewOptions(resolvedDatabaseId, previewOptions)),
      grantMember: (principal, role) => grantMemberWithDatabase(resolvedDatabaseId, principal, role),
      revokeMember: (principal) => revokeMemberWithDatabase(resolvedDatabaseId, principal),
      listMembers: () => listMembersWithDatabase(resolvedDatabaseId),
      close: noop
    };
  }

  async function createDatabase(setup: IcpdbCreateSetupOptions = {}): Promise<IcpdbDatabaseClient> {
    assertCreateSetupOptions(setup);
    const db = await callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.create_database();
      if ("Err" in result) throwCanisterError(result.Err);
      return database(result.Ok);
    });
    return applyCreateSetup(db, setup);
  }

  async function connectDatabase(): Promise<IcpdbDatabaseClient> {
    return database(requiredDatabaseId(undefined, connection.databaseId));
  }

  function prepareLowLevel(statement: IcpdbPreparedStatementInput, args?: IcpdbSqlArgsInput): IcpdbPreparedStatement;
  function prepareLowLevel(statement: IcpdbPreparedStatementInput, args: IcpdbSqlArgsInput | undefined, databaseId: string): IcpdbPreparedStatement;
  function prepareLowLevel(statement: IcpdbPreparedStatementInput, args?: IcpdbSqlArgsInput, databaseId?: string): IcpdbPreparedStatement {
    return createClientFromDatabase(database(requiredDatabaseId(databaseId, connection.databaseId))).prepare(statement, args);
  }

  function migrateLowLevel(migrations: readonly IcpdbMigration[], databaseId?: string): Promise<IcpdbMigrationResult>;
  function migrateLowLevel(statements: readonly IcpdbSqlClientBatchStatement[], databaseId?: string): Promise<IcpdbSqlClientResult[]>;
  function migrateLowLevel(input: IcpdbMigrateInput, databaseId?: string): Promise<IcpdbMigrationResult | IcpdbSqlClientResult[]> {
    return migrateWithDatabase(requiredDatabaseId(databaseId, connection.databaseId), input);
  }

  async function health(): Promise<CanisterHealth> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      return normalizeCanisterHealth(await nextActor.canister_health());
    });
  }

  async function listDatabases(): Promise<DatabaseSummary[]> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.list_databases();
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeDatabaseSummary);
    });
  }

  async function deleteDatabaseWithDatabase(databaseId: string): Promise<void> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.delete_database(databaseId);
      if ("Err" in result) throwCanisterError(result.Err);
    });
  }

  async function listPlacements(): Promise<DatabaseShardPlacement[]> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.list_database_placements();
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeDatabaseShardPlacement);
    });
  }

  async function listAllPlacements(): Promise<DatabaseShardPlacement[]> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.list_all_database_placements();
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeDatabaseShardPlacement);
    });
  }

  async function listShards(): Promise<DatabaseShardInfo[]> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.list_database_shards();
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeDatabaseShardInfo);
    });
  }

  async function createDatabaseShard(request: CreateDatabaseShardRequest): Promise<DatabaseShardInfo> {
    const rawRequest = rawCreateDatabaseShardRequest(request);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.create_database_shard(rawRequest);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseShardInfo(result.Ok);
    });
  }

  async function createRemoteDatabase(request: CreateRemoteDatabaseRequest): Promise<DatabaseInfo> {
    const normalizedRequest = {
      ...request,
      databaseId: requiredDatabaseId(request.databaseId, undefined),
      databaseCanisterId: requiredDatabaseCanisterId(request.databaseCanisterId)
    };
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.create_remote_database(rawCreateRemoteDatabaseRequest(normalizedRequest));
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseInfo(result.Ok);
    });
  }

  async function registerDatabaseShard(request: RegisterDatabaseShardRequest): Promise<DatabaseShardInfo> {
    const normalizedRequest = {
      ...request,
      databaseCanisterId: requiredDatabaseCanisterId(request.databaseCanisterId)
    };
    const rawRequest = rawRegisterDatabaseShardRequest(normalizedRequest);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.register_database_shard(rawRequest);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseShardInfo(result.Ok);
    });
  }

  async function getShardStatus(databaseCanisterId: string): Promise<DatabaseShardStatus> {
    const normalizedDatabaseCanisterId = requiredDatabaseCanisterId(databaseCanisterId);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.get_database_shard_status({ database_canister_id: normalizedDatabaseCanisterId });
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseShardStatus(result.Ok);
    });
  }

  async function topUpShard(databaseCanisterId: string, cycles: IcpdbNatInput): Promise<DatabaseShardInfo> {
    const normalizedDatabaseCanisterId = requiredDatabaseCanisterId(databaseCanisterId);
    const normalizedCycles = natInput(cycles, "cycles");
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.top_up_database_shard({ database_canister_id: normalizedDatabaseCanisterId, cycles: normalizedCycles });
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseShardInfo(result.Ok);
    });
  }

  async function topUpDatabaseBalance(databaseId: string, units: IcpdbNatInput): Promise<DatabaseBilling> {
    const normalizedDatabaseId = requiredDatabaseId(databaseId, undefined);
    const normalizedUnits = natInput(units, "units");
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.top_up_database_balance({ database_id: normalizedDatabaseId, units: normalizedUnits });
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseBilling(result.Ok);
    });
  }

  async function maintainShards(request: MaintainDatabaseShardsRequest): Promise<DatabaseShardMaintenanceReport> {
    const rawRequest = rawMaintainDatabaseShardsRequest(request);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.maintain_database_shards(rawRequest);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseShardMaintenanceReport(result.Ok);
    });
  }

  async function migrateDatabaseToShard(databaseId: string, databaseCanisterId: string): Promise<DatabaseShardPlacement> {
    const normalizedDatabaseId = requiredDatabaseId(databaseId, undefined);
    const normalizedDatabaseCanisterId = requiredDatabaseCanisterId(databaseCanisterId);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.migrate_database_to_shard({ database_id: normalizedDatabaseId, database_canister_id: normalizedDatabaseCanisterId });
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseShardPlacement(result.Ok);
    });
  }

  async function listShardOperations(): Promise<ShardOperationInfo[]> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.list_shard_operations();
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeShardOperationInfo);
    });
  }

  async function reconcileShardOperation(request: ShardOperationReconcileRequest): Promise<ShardOperationInfo> {
    const rawRequest = rawShardOperationReconcileRequest(request);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.reconcile_shard_operation(rawRequest);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeShardOperationInfo(result.Ok);
    });
  }

  async function getRoutedOperationWithDatabase(databaseId: string, operationId: string): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.get_routed_operation({ database_id: databaseId, operation_id: normalizedOperationId });
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeRoutedOperationInfo(result.Ok);
    });
  }

  async function reconcileRoutedOperationWithDatabase(databaseId: string, operationId: string): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.reconcile_routed_operation({ database_id: databaseId, operation_id: normalizedOperationId });
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeRoutedOperationInfo(result.Ok);
    });
  }

  async function waitForRoutedOperationWithDatabase(
    databaseId: string,
    operationId: string,
    waitOptions?: IcpdbWaitForRoutedOperationOptions
  ): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    const normalizedWaitOptions = normalizedWaitForRoutedOperationOptions(waitOptions);
    return waitForRoutedOperationStatus(
      normalizedOperationId,
      () => getRoutedOperationWithDatabase(databaseId, normalizedOperationId),
      normalizedWaitOptions?.reconcileUnknown ? () => reconcileRoutedOperationWithDatabase(databaseId, normalizedOperationId) : undefined,
      normalizedWaitOptions
    );
  }

  async function placementWithDatabase(databaseId: string): Promise<DatabaseShardPlacement | null> {
    return (await listPlacements()).find((placement) => placement.databaseId === databaseId) ?? null;
  }

  async function getUsageWithDatabase(databaseId: string): Promise<DatabaseUsage> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.get_usage(databaseId);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseUsage(result.Ok);
    });
  }

  async function statusWithDatabase(databaseId: string): Promise<IcpdbDatabaseStatus> {
    return databaseStatusFromDatabase(database(databaseId), identityPrincipalText(connection.identity), await callerRoleWithDatabase(databaseId));
  }

  async function callerRoleWithDatabase(databaseId: string): Promise<DatabaseRole> {
    const summary = (await listDatabases()).find((item) => item.databaseId === databaseId);
    if (!summary) throw new Error(`database is not visible to caller: ${databaseId}`);
    return summary.role;
  }

  async function listUsageEventsWithDatabase(databaseId: string): Promise<DatabaseUsageEventSummary[]> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.get_usage_event_summaries(databaseId);
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeDatabaseUsageEventSummary);
    });
  }

  async function beginArchiveWithDatabase(databaseId: string): Promise<DatabaseArchiveInfo> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.begin_database_archive(databaseId);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeDatabaseArchiveInfo(result.Ok);
    });
  }

  async function readArchiveChunkWithDatabase(databaseId: string, offset: string, maxBytes: number): Promise<number[]> {
    const normalizedOffset = nat64TextInput(offset, "archive offset");
    const normalizedMaxBytes = positiveNat32(maxBytes, "archive maxBytes");
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.read_database_archive_chunk(databaseId, normalizedOffset, normalizedMaxBytes);
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.bytes;
    });
  }

  async function finalizeArchiveWithDatabase(databaseId: string, snapshotHash: readonly number[]): Promise<void> {
    const normalizedSnapshotHash = snapshotHashBytes(snapshotHash, "snapshotHash");
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.finalize_database_archive(databaseId, normalizedSnapshotHash);
      if ("Err" in result) throwCanisterError(result.Err);
    });
  }

  async function cancelArchiveWithDatabase(databaseId: string): Promise<void> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.cancel_database_archive(databaseId);
      if ("Err" in result) throwCanisterError(result.Err);
    });
  }

  async function archiveWithDatabase(databaseId: string): Promise<Uint8Array> {
    const archiveInfo = await beginArchiveWithDatabase(databaseId);
    const sizeBytes = transferSize(archiveInfo.sizeBytes);
    const snapshot = new Uint8Array(sizeBytes);
    let offset = 0;
    try {
      while (offset < sizeBytes) {
        const maxBytes = Math.min(TRANSFER_CHUNK_BYTES, sizeBytes - offset);
        const chunk = await readArchiveChunkWithDatabase(databaseId, String(offset), maxBytes);
        if (chunk.length === 0) throw new Error("archive chunk stream stopped before snapshot end");
        snapshot.set(chunk.map(byteValue), offset);
        offset += chunk.length;
      }
      await finalizeArchiveWithDatabase(databaseId, await sha256(snapshot));
      return snapshot;
    } catch (error) {
      try {
        await cancelArchiveWithDatabase(databaseId);
      } catch {
        // Preserve the original transfer failure; cancel is best-effort cleanup.
      }
      throw error;
    }
  }

  async function beginRestoreWithDatabase(databaseId: string, snapshotHash: readonly number[], sizeBytes: string): Promise<void> {
    const normalizedSnapshotHash = snapshotHashBytes(snapshotHash, "snapshotHash");
    const normalizedSizeBytes = nat64TextInput(sizeBytes, "restore sizeBytes");
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.begin_database_restore(databaseId, normalizedSnapshotHash, normalizedSizeBytes);
      if ("Err" in result) throwCanisterError(result.Err);
    });
  }

  async function writeRestoreChunkWithDatabase(databaseId: string, offset: string, bytes: IcpdbRestoreInput): Promise<void> {
    const normalizedOffset = nat64TextInput(offset, "restore offset");
    const normalizedBytes = transferBytes(bytes);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.write_database_restore_chunk({
        database_id: databaseId,
        offset: normalizedOffset,
        bytes: normalizedBytes
      });
      if ("Err" in result) throwCanisterError(result.Err);
    });
  }

  async function finalizeRestoreWithDatabase(databaseId: string): Promise<void> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.finalize_database_restore(databaseId);
      if ("Err" in result) throwCanisterError(result.Err);
    });
  }

  async function restoreWithDatabase(databaseId: string, snapshot: IcpdbRestoreInput, options?: IcpdbRestoreOptions): Promise<void> {
    const { bytes, snapshotHash } = await normalizedRestorePayload(snapshot, options);
    await beginRestoreWithDatabase(databaseId, snapshotHash, String(bytes.length));
    for (let offset = 0; offset < bytes.length; offset += TRANSFER_CHUNK_BYTES) {
      await writeRestoreChunkWithDatabase(databaseId, String(offset), bytes.subarray(offset, offset + TRANSFER_CHUNK_BYTES));
    }
    await finalizeRestoreWithDatabase(databaseId);
  }

  async function queryWithDatabase(databaseId: string, statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput): Promise<SqlExecuteResponse> {
    const normalized = sqlRequest(databaseId, statement, params);
    rejectReadSqlWaitOption(statementWaitOption(statement));
    validateWriteSqlIdempotencyKey(normalized);
    validateReadSqlStatement(normalized);
    const request = rawSqlRequest(normalized);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.sql_query(request);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeSqlResponse(result.Ok);
    });
  }

  async function queryRowsWithDatabase(databaseId: string, statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbRow[]> {
    return responseRows(await queryWithDatabase(databaseId, statement, params), "string");
  }

  async function queryOneWithDatabase(databaseId: string, statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbRow | null> {
    return (await queryRowsWithDatabase(databaseId, statement, params))[0] ?? null;
  }

  async function executeWithDatabase(databaseId: string, statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput): Promise<SqlExecuteResponse> {
    const normalized = sqlRequest(databaseId, statement, params);
    const wait = statementWaitOption(statement);
    if (isReadSql(normalized.sql)) {
      rejectReadSqlWaitOption(wait);
      return queryWithDatabase(databaseId, normalized);
    }
    const request = rawSqlRequest(normalized);
    const response = await callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.sql_execute(request);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeSqlResponse(result.Ok);
    });
    await waitForRoutedOperationFromResponse(response, (operationId) => waitForRoutedOperationWithDatabase(databaseId, operationId, wait.options), wait);
    return response;
  }

  async function batchWithDatabase(statements: readonly IcpdbBatchStatementInput[], batchOptions?: IcpdbLowLevelBatchOptions): Promise<SqlExecuteResponse[]> {
    const normalizedBatch = lowLevelBatchOptions(statements, batchOptions, connection.databaseId);
    const normalizedStatements = statements.map(sqlStatement);
    if (normalizedBatch.mode === "read") {
      const responses: SqlExecuteResponse[] = [];
      for (const statement of normalizedStatements) {
        responses.push(await queryWithDatabase(normalizedBatch.databaseId, { ...statement, maxRows: normalizedBatch.maxRows }));
      }
      return responses;
    }
    return callIcpdb(async () => {
      const nextActor = await actor();
      const request: SqlBatchRequest = {
        databaseId: normalizedBatch.databaseId,
        statements: normalizedStatements,
        maxRows: normalizedBatch.maxRows,
        idempotencyKey: normalizedBatch.idempotencyKey
      };
      const result = await nextActor.sql_batch(rawSqlBatchRequest(request));
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeSqlResponse);
    });
  }

  async function executeScriptWithDatabase(databaseId: string, source: string, scriptOptions?: IcpdbBatchOptions): Promise<SqlExecuteResponse[]> {
    const options: IcpdbBatchOptions = {
      databaseId,
      maxRows: scriptOptions?.maxRows ?? null,
      idempotencyKey: scriptOptions?.idempotencyKey ?? null,
      mode: scriptOptions?.mode
    };
    return executeScriptBatches(
      (statements, chunkOptions) => batchWithDatabase(statements, chunkOptions ?? options),
      source,
      options
    );
  }

  async function execWithDatabase(databaseId: string, source: string, scriptOptions?: IcpdbBatchOptions): Promise<void> {
    await executeScriptWithDatabase(databaseId, source, scriptOptions);
  }

  function migrateWithDatabase(databaseId: string, migrations: readonly IcpdbMigration[]): Promise<IcpdbMigrationResult>;
  function migrateWithDatabase(databaseId: string, statements: readonly IcpdbSqlClientBatchStatement[]): Promise<IcpdbSqlClientResult[]>;
  function migrateWithDatabase(databaseId: string, input: IcpdbMigrateInput): Promise<IcpdbMigrationResult | IcpdbSqlClientResult[]> {
    const client = createClientFromDatabase(database(databaseId));
    if (isVersionedMigrations(input)) return client.migrate(input);
    return client.migrate(input);
  }

  async function dumpSqlWithDatabase(databaseId: string, dumpOptions?: IcpdbSqlDumpOptions): Promise<string> {
    return dumpSqlFromDatabase(database(databaseId), normalizedSqlDumpOptions(dumpOptions));
  }

  async function loadSqlDumpWithDatabase(databaseId: string, source: string, dumpOptions?: IcpdbBatchOptions): Promise<SqlExecuteResponse[]> {
    const options: IcpdbBatchOptions = {
      databaseId,
      maxRows: dumpOptions?.maxRows ?? null,
      idempotencyKey: dumpOptions?.idempotencyKey ?? null,
      mode: dumpOptions?.mode
    };
    return loadSqlDumpBatches(
      (statements, chunkOptions) => batchWithDatabase(statements, chunkOptions ?? options),
      source,
      options
    );
  }

  async function executeMultipleWithDatabase(databaseId: string, source: string, scriptOptions?: IcpdbBatchOptions): Promise<void> {
    if (scriptOptions !== undefined) {
      await executeScriptWithDatabase(databaseId, source, scriptOptions);
      return;
    }
    for (const statement of sqlScriptStatements(source)) {
      if (isReadSql(statement.sql)) {
        await queryWithDatabase(databaseId, statement);
      } else {
        await executeWithDatabase(databaseId, statement);
      }
    }
  }

  async function listTablesWithDatabase(databaseId: string): Promise<DatabaseTable[]> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.list_tables(databaseId);
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeDatabaseTable);
    });
  }

  async function viewsWithDatabase(databaseId: string): Promise<DatabaseTable[]> {
    return (await listTablesWithDatabase(databaseId)).filter((table) => table.objectType === "view");
  }

  async function describeTableWithDatabase(tableName: string, databaseId: string): Promise<TableDescription> {
    const normalizedTableName = requiredTableName(tableName);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.describe_table(databaseId, normalizedTableName);
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeTableDescription(result.Ok);
    });
  }

  async function listColumnsWithDatabase(tableName: string, databaseId: string): Promise<DatabaseColumn[]> {
    return (await describeTableWithDatabase(tableName, databaseId)).columns;
  }

  async function listIndexesWithDatabase(tableName: string, databaseId: string): Promise<DatabaseIndex[]> {
    return (await describeTableWithDatabase(tableName, databaseId)).indexes;
  }

  async function listTriggersWithDatabase(tableName: string, databaseId: string): Promise<DatabaseTrigger[]> {
    return (await describeTableWithDatabase(tableName, databaseId)).triggers;
  }

  async function listForeignKeysWithDatabase(tableName: string, databaseId: string): Promise<DatabaseForeignKey[]> {
    return (await describeTableWithDatabase(tableName, databaseId)).foreignKeys;
  }

  async function schemaWithDatabase(databaseId: string, tableName?: string): Promise<string> {
    const normalizedTableName = optionalTableName(tableName);
    if (normalizedTableName !== null) return schemaFromDescriptions([await describeTableWithDatabase(normalizedTableName, databaseId)]);
    const tables = await listTablesWithDatabase(databaseId);
    const descriptions = await Promise.all(tables.map((table) => describeTableWithDatabase(table.name, databaseId)));
    return schemaFromDescriptions(descriptions);
  }

  async function inspectWithDatabase(databaseId: string, inspectOptions?: IcpdbInspectOptions): Promise<IcpdbDatabaseInspection> {
    return inspectDatabase(database(databaseId), normalizedInspectOptions(inspectOptions));
  }

  async function previewTableWithDatabase(tableName: string, previewOptions?: IcpdbPreviewOptions): Promise<TablePreviewResponse> {
    const normalizedTableName = requiredTableName(tableName);
    return callIcpdb(async () => {
      const databaseId = requiredDatabaseId(previewOptions?.databaseId, connection.databaseId);
      const nextActor = await actor();
      const result = await nextActor.preview_table(rawTablePreviewRequest({
        databaseId,
        tableName: normalizedTableName,
        limit: sqlRowLimit(previewOptions?.limit ?? null, "preview limit"),
        offset: nonNegativeNat32(previewOptions?.offset ?? null, "preview offset")
      }));
      if ("Err" in result) throwCanisterError(result.Err);
      return normalizeTablePreview(result.Ok);
    });
  }

  async function grantMemberWithDatabase(databaseId: string, principal: string, role: DatabaseRole): Promise<void> {
    const normalizedPrincipal = grantablePrincipal(principal);
    assertDatabaseRole(role);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.grant_database_access(databaseId, normalizedPrincipal, databaseRoleVariant(role));
      if ("Err" in result) throwCanisterError(result.Err);
    });
  }

  async function revokeMemberWithDatabase(databaseId: string, principal: string): Promise<void> {
    const normalizedPrincipal = memberPrincipal(principal);
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.revoke_database_access(databaseId, normalizedPrincipal);
      if ("Err" in result) throwCanisterError(result.Err);
    });
  }

  async function listMembersWithDatabase(databaseId: string): Promise<DatabaseMember[]> {
    return callIcpdb(async () => {
      const nextActor = await actor();
      const result = await nextActor.list_database_members(databaseId);
      if ("Err" in result) throwCanisterError(result.Err);
      return result.Ok.map(normalizeDatabaseMember);
    });
  }

  return {
    principal: () => identityPrincipalText(connection.identity),
    connectionUrl: (databaseId) => formatIcpdbDatabaseUrl(connection.canisterId, requiredDatabaseId(databaseId, connection.databaseId)),
    url: (databaseId) => formatIcpdbDatabaseUrl(connection.canisterId, requiredDatabaseId(databaseId, connection.databaseId)),
    database,
    connectDatabase,
    createDatabase,
    health,
    deleteDatabase: deleteDatabaseWithDatabase,
    listDatabases,
    listPlacements,
    listAllPlacements,
    placement: (databaseId) => placementWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    listShards,
    createDatabaseShard,
    createRemoteDatabase,
    registerDatabaseShard,
    getShardStatus,
    topUpShard,
    topUpDatabaseBalance: (databaseIdOrUnits: IcpdbNatInput, maybeUnits?: IcpdbNatInput) => {
      const resolved = resolveDatabaseUnitsArguments(databaseIdOrUnits, maybeUnits, connection.databaseId);
      return topUpDatabaseBalance(resolved.databaseId, resolved.units);
    },
    maintainShards,
    migrateDatabaseToShard: (databaseIdOrCanisterId: string, maybeCanisterId?: string) => {
      const resolved = resolveDatabaseCanisterArguments(databaseIdOrCanisterId, maybeCanisterId, connection.databaseId);
      return migrateDatabaseToShard(resolved.databaseId, resolved.databaseCanisterId);
    },
    listShardOperations,
    reconcileShardOperation,
    getRoutedOperation: (databaseIdOrOperationId: string, maybeOperationId?: string) => {
      const resolved = resolveRoutedOperationArguments(databaseIdOrOperationId, maybeOperationId, connection.databaseId);
      return getRoutedOperationWithDatabase(resolved.databaseId, resolved.operationId);
    },
    reconcileRoutedOperation: (databaseIdOrOperationId: string, maybeOperationId?: string) => {
      const resolved = resolveRoutedOperationArguments(databaseIdOrOperationId, maybeOperationId, connection.databaseId);
      return reconcileRoutedOperationWithDatabase(resolved.databaseId, resolved.operationId);
    },
    waitForRoutedOperation: (
      databaseIdOrOperationId: string,
      operationIdOrOptions?: string | IcpdbWaitForRoutedOperationOptions,
      waitOptions?: IcpdbWaitForRoutedOperationOptions
    ) => {
      const resolved = resolveWaitForRoutedOperationArguments(databaseIdOrOperationId, operationIdOrOptions, waitOptions, connection.databaseId);
      return waitForRoutedOperationWithDatabase(resolved.databaseId, resolved.operationId, resolved.options);
    },
    grantMember: (databaseIdOrPrincipal: string, principalOrRole: string, maybeRole?: DatabaseRole) => {
      const resolved = resolveGrantMemberArguments(databaseIdOrPrincipal, principalOrRole, maybeRole, connection.databaseId);
      return grantMemberWithDatabase(resolved.databaseId, resolved.principal, resolved.role);
    },
    revokeMember: (databaseIdOrPrincipal: string, maybePrincipal?: string) => {
      const resolved = resolveMemberPrincipalArguments(databaseIdOrPrincipal, maybePrincipal, connection.databaseId);
      return revokeMemberWithDatabase(resolved.databaseId, resolved.principal);
    },
    listMembers: (databaseId) => listMembersWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    getUsage: (databaseId) => getUsageWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    status: (databaseId) => statusWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    listUsageEvents: (databaseId) => listUsageEventsWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    beginArchive: (databaseId) => beginArchiveWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    readArchiveChunk: (offset, maxBytes, databaseId) => readArchiveChunkWithDatabase(requiredDatabaseId(databaseId, connection.databaseId), offset, maxBytes ?? TRANSFER_CHUNK_BYTES),
    finalizeArchive: (snapshotHash, databaseId) => finalizeArchiveWithDatabase(requiredDatabaseId(databaseId, connection.databaseId), snapshotHash),
    cancelArchive: (databaseId) => cancelArchiveWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    archive: (databaseId) => archiveWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    snapshotInfo,
    beginRestore: (snapshotHash, sizeBytes, databaseId) => beginRestoreWithDatabase(requiredDatabaseId(databaseId, connection.databaseId), snapshotHash, sizeBytes),
    writeRestoreChunk: (offset, bytes, databaseId) => writeRestoreChunkWithDatabase(requiredDatabaseId(databaseId, connection.databaseId), offset, bytes),
    finalizeRestore: (databaseId) => finalizeRestoreWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    restore: (snapshot, databaseIdOrOptions?: string | IcpdbRestoreOptions, restoreOptions?: IcpdbRestoreOptions) => {
      const resolved = resolveRestoreArguments(databaseIdOrOptions, restoreOptions, connection.databaseId);
      return restoreWithDatabase(resolved.databaseId, snapshot, resolved.options);
    },
    query: (statement, params) => queryWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params),
    queryRows: (statement, params) => queryRowsWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params),
    queryOne: (statement, params) => queryOneWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params),
    execute: (statement, params) => executeWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params),
    all: (statement, params) => queryRowsWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params),
    get: (statement, params) => queryOneWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params),
    values: async (statement, params) => responseValues(await queryWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params), "string"),
    first: (statement, params) => queryOneWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params),
    firstValue: async (statement, params) => firstResponseValue(await queryWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params), "string"),
    scalar: async (statement, params) => firstResponseValue(await queryWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params), "string"),
    prepare: prepareLowLevel,
    run: (statement, params) => executeWithDatabase(statementDatabaseId(statement, connection.databaseId), statement, params),
    batch: batchWithDatabase,
    transaction: batchWithDatabase,
    exec: (source, scriptOptions) => execWithDatabase(requiredDatabaseId(scriptOptions?.databaseId, connection.databaseId), source, scriptOptions),
    executeMultiple: (source, scriptOptions) => executeMultipleWithDatabase(requiredDatabaseId(undefined, connection.databaseId), source, scriptOptions),
    executeScript: (source, scriptOptions) => executeScriptWithDatabase(requiredDatabaseId(scriptOptions?.databaseId, connection.databaseId), source, scriptOptions),
    migrate: migrateLowLevel,
    dumpSql: (databaseIdOrOptions?: string | IcpdbSqlDumpOptions, dumpOptions?: IcpdbSqlDumpOptions) => {
      const resolved = resolveDumpArguments(databaseIdOrOptions, dumpOptions, connection.databaseId);
      return dumpSqlWithDatabase(resolved.databaseId, resolved.options);
    },
    loadSqlDump: (source, dumpOptions) => loadSqlDumpWithDatabase(requiredDatabaseId(dumpOptions?.databaseId, connection.databaseId), source, dumpOptions),
    listTables: (databaseId) => listTablesWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    tables: (databaseId) => listTablesWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    views: (databaseId) => viewsWithDatabase(requiredDatabaseId(databaseId, connection.databaseId)),
    describeTable: (tableName, databaseId) => describeTableWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    describe: (tableName, databaseId) => describeTableWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    listColumns: (tableName, databaseId) => listColumnsWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    columns: (tableName, databaseId) => listColumnsWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    listIndexes: (tableName, databaseId) => listIndexesWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    indexes: (tableName, databaseId) => listIndexesWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    listTriggers: (tableName, databaseId) => listTriggersWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    triggers: (tableName, databaseId) => listTriggersWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    listForeignKeys: (tableName, databaseId) => listForeignKeysWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    foreignKeys: (tableName, databaseId) => listForeignKeysWithDatabase(tableName, requiredDatabaseId(databaseId, connection.databaseId)),
    schema: (tableName, databaseId) => schemaWithDatabase(requiredDatabaseId(databaseId, connection.databaseId), tableName),
    inspect: (databaseIdOrOptions?: string | IcpdbInspectOptions, inspectOptions?: IcpdbInspectOptions) => {
      const resolved = resolveInspectArguments(databaseIdOrOptions, inspectOptions, connection.databaseId);
      return inspectWithDatabase(resolved.databaseId, resolved.options);
    },
    previewTable: previewTableWithDatabase,
    preview: previewTableWithDatabase
  };
}

function enrichSqlClientDatabase(source: IcpdbSqlClientDatabaseSource, intMode: IcpdbIntMode): IcpdbSqlClientDatabase {
  assertSqlClientDatabaseSource(source);
  let enriched: IcpdbSqlClientDatabase;
  const databaseId = normalizeDatabaseId(source.databaseId);

  async function queryOnSource(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<SqlExecuteResponse> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    return normalizeSourceSqlResponse(await source.query(request));
  }

  async function executeOnSource(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<SqlExecuteResponse> {
    const request = databaseStatementRequest(statement, params);
    const wait = statementWaitOption(statement);
    if (isReadSql(request.sql)) {
      validateWriteSqlIdempotencyKey(request);
      rejectReadSqlWaitOption(wait);
      return normalizeSourceSqlResponse(await source.query(request));
    }
    const response = normalizeSourceSqlResponse(await source.execute(request));
    await waitForRoutedOperationFromResponse(response, (operationId) => enriched.waitForRoutedOperation(operationId, wait.options), wait);
    return response;
  }

  async function queryRows(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbRow[]> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    return source.queryRows ? normalizeSourceRows(await source.queryRows(request)) : responseRows(await queryOnSource(request), intMode);
  }

  async function queryOne(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbRow | null> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    if (source.queryOne) return normalizeSourceOptionalRow(await source.queryOne(request));
    return (await queryRows(statement, params))[0] ?? null;
  }

  async function allRows(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbRow[]> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    return source.all ? normalizeSourceRows(await source.all(request)) : queryRows(request);
  }

  async function getOne(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbRow | null> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    return source.get ? normalizeSourceOptionalRow(await source.get(request)) : queryOne(request);
  }

  async function values(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbCellValue[][]> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    if (source.values) return normalizeSourceCellValueRows(await source.values(request));
    return responseValues(await queryOnSource(request), intMode);
  }

  async function first(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbRow | null> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    if (source.first) return normalizeSourceOptionalRow(await source.first(request));
    return queryOne(statement, params);
  }

  async function firstValue(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbCellValue | undefined> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    if (source.firstValue) return normalizeSourceOptionalCellValue(await source.firstValue(request), "firstValue result");
    return firstResponseValue(await queryOnSource(request), intMode);
  }

  async function scalar(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<IcpdbCellValue | undefined> {
    rejectReadSqlWaitOption(statementWaitOption(statement));
    const request = databaseStatementRequest(statement, params);
    validateWriteSqlIdempotencyKey(request);
    validateReadSqlStatement(request);
    if (source.scalar) return normalizeSourceOptionalCellValue(await source.scalar(request), "scalar result");
    return firstValue(request);
  }

  function preparedStatement(statement: IcpdbPreparedStatementInput, args?: IcpdbSqlArgsInput): IcpdbPreparedStatement {
    if (!source.prepare) return createClientFromDatabase(source, { intMode }).prepare(statement, args);
    if (typeof statement !== "string" && !isSqlClientStatementTuple(statement)) rejectPreparedStatementOptions(statement);
    const request = sqlClientStatement(statement, args);
    return normalizeSourcePreparedStatement(source.prepare(request.sql, request.params), request.sql);
  }

  async function runStatement(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): Promise<SqlExecuteResponse> {
    const request = databaseStatementRequest(statement, params);
    const wait = statementWaitOption(statement);
    if (isReadSql(request.sql)) {
      validateWriteSqlIdempotencyKey(request);
      rejectReadSqlWaitOption(wait);
      return normalizeSourceSqlResponse(await source.query(request));
    }
    const response = normalizeSourceSqlResponse(await (source.run ? source.run(request) : source.execute(request)));
    await waitForRoutedOperationFromResponse(response, (operationId) => enriched.waitForRoutedOperation(operationId, wait.options), wait);
    return response;
  }

  async function batchOnSource(statements: readonly IcpdbBatchStatementInput[], options?: IcpdbSqlClientBatchOptions): Promise<SqlExecuteResponse[]> {
    const request = requiredBatchStatements(statements, "batch").map(normalizeBatchStatement);
    rejectSqlClientBatchOptionDatabaseId(options);
    const mode = batchMode(options);
    validateReadBatchOptions(options, mode);
    if (mode === "read") {
      validateReadBatchStatements(request, "read");
      const maxRows = batchMaxRows(options);
      const responses: SqlExecuteResponse[] = [];
      for (const statement of request) responses.push(await queryOnSource({ ...statement, maxRows }));
      return responses;
    }
    if (!source.batch) throw new Error("batch is not available on this database source");
    return normalizeSourceSqlResponses(await source.batch(request, sqlClientBatchOptions(request, options)));
  }

  async function transactionStatements(statements: readonly IcpdbBatchStatementInput[], options?: IcpdbSqlClientBatchOptions): Promise<SqlExecuteResponse[]> {
    const request = requiredBatchStatements(statements, "transaction").map(normalizeBatchStatement);
    const normalizedOptions = sqlClientBatchOptions(request, options);
    if (batchMode(normalizedOptions) === "read") return batchOnSource(request, normalizedOptions);
    return source.transaction ? normalizeSourceSqlResponses(await source.transaction(request, normalizedOptions)) : batchOnSource(request, normalizedOptions);
  }

  async function executeScriptOnSource(sourceText: string, options?: IcpdbDatabaseBatchOptionsObject): Promise<SqlExecuteResponse[]> {
    rejectSqlClientBatchOptionDatabaseId(options);
    const normalizedOptions = normalizedSqlScriptBatchOptions(sourceText, options);
    if (source.executeScript) return normalizeSourceSqlResponses(await source.executeScript(sourceText, normalizedOptions));
    return executeScriptBatches((statements, chunkOptions) => batchOnSource(statements, chunkOptions), sourceText, options);
  }

  async function executeMultipleOnSource(sourceText: string, options?: IcpdbDatabaseBatchOptionsObject): Promise<void> {
    sqlScriptStatements(sourceText);
    if (options !== undefined) {
      await executeScriptOnSource(sourceText, options);
      return;
    }
    if (source.executeMultiple) return source.executeMultiple(sourceText);
    return executeMultipleOnDatabase(enriched, sourceText);
  }

  async function execOnSource(sourceText: string, options?: IcpdbDatabaseBatchOptionsObject): Promise<void> {
    rejectSqlClientBatchOptionDatabaseId(options);
    const normalizedOptions = normalizedSqlScriptBatchOptions(sourceText, options);
    if (source.exec) return source.exec(sourceText, normalizedOptions);
    await executeScriptOnSource(sourceText, options);
  }

  function migrateOnSource(migrations: readonly IcpdbMigration[]): Promise<IcpdbMigrationResult>;
  function migrateOnSource(statements: readonly IcpdbSqlClientBatchStatement[]): Promise<IcpdbSqlClientResult[]>;
  async function migrateOnSource(input: IcpdbMigrateInput): Promise<IcpdbMigrationResult | IcpdbSqlClientResult[]> {
    const migrateInput = requiredMigrateInput(input);
    if (source.migrate) {
      if (isVersionedMigrations(migrateInput)) return normalizeSourceMigrationResult(await source.migrate(normalizeMigrations(migrateInput)));
      return normalizeSourceSqlClientResults(await source.migrate(migrateInput.map(sqlClientBatchStatement)));
    }
    if (!isVersionedMigrations(migrateInput)) return libsqlMigrateOnSource(migrateInput);
    const normalized = normalizeMigrations(migrateInput);
    await ensureMigrationTableOnSource();
    const appliedVersions = new Set((await queryRows(`SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`)).map((row) => String(row.version)));
    const result: IcpdbMigrationResult = { applied: [], skipped: [] };
    for (const migration of normalized) {
      if (appliedVersions.has(migration.version)) {
        result.skipped.push(migration.version);
        continue;
      }
      const statements = splitSqlStatements(migration.sql);
      if (statements.length === 0) throw new Error(`migration ${migration.version} has no SQL statements`);
      await batchOnSource([
        ...statements.map((sql) => ({ sql, params: [] })),
        {
          sql: `INSERT INTO ${MIGRATIONS_TABLE}(version, name, applied_at_ms) VALUES (?1, ?2, ?3)`,
          args: [migration.version, migration.name, String(Date.now())]
        }
      ], "write");
      appliedVersions.add(migration.version);
      result.applied.push(migration.version);
    }
    return result;
  }

  async function libsqlMigrateOnSource(statements: readonly IcpdbSqlClientBatchStatement[]): Promise<IcpdbSqlClientResult[]> {
    const request = statements.map(sqlClientBatchStatement);
    await executeOnSource({ sql: "PRAGMA foreign_keys=off", params: [] });
    let responses: SqlExecuteResponse[] | undefined;
    let batchError: unknown;
    try {
      responses = await batchOnSource(request, "deferred");
    } catch (error) {
      batchError = error;
    }
    try {
      await executeOnSource({ sql: "PRAGMA foreign_keys=on", params: [] });
    } catch (error) {
      if (batchError !== undefined) throw batchError;
      throw error;
    }
    if (batchError !== undefined) throw batchError;
    if (responses === undefined) throw new Error("migrate batch did not return responses");
    return responses.map((response) => sqlClientResult(response, intMode));
  }

  async function ensureMigrationTableOnSource(): Promise<void> {
    const existing = await queryRows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1", [MIGRATIONS_TABLE]);
    if (existing.length > 0) return;
    await batchOnSource([{
      sql: `CREATE TABLE ${MIGRATIONS_TABLE}(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at_ms TEXT NOT NULL)`,
      params: []
    }], "write");
  }

  async function dumpSqlOnSource(options?: IcpdbSqlDumpOptions): Promise<string> {
    const dumpOptions = normalizedSqlDumpOptions(options);
    return source.dumpSql ? normalizeSourceString(await source.dumpSql(dumpOptions), "SQL dump result") : dumpSqlFromDatabase(enriched, dumpOptions);
  }

  async function loadSqlDumpOnSource(sourceText: string, options?: IcpdbDatabaseBatchOptionsObject): Promise<SqlExecuteResponse[]> {
    rejectSqlClientBatchOptionDatabaseId(options);
    const normalizedOptions = normalizedSqlDumpBatchOptions(sourceText, options);
    if (source.loadSqlDump) return normalizeSourceSqlResponses(await source.loadSqlDump(sourceText, normalizedOptions));
    return loadSqlDumpBatches((statements, chunkOptions) => batchOnSource(statements, chunkOptions), sourceText, options);
  }

  async function inspectOnSource(options?: IcpdbInspectOptions): Promise<IcpdbDatabaseInspection> {
    const inspectOptions = normalizedInspectOptions(options);
    return source.inspect ? normalizeSourceDatabaseInspection(await source.inspect(inspectOptions)) : inspectDatabase(enriched, inspectOptions);
  }

  async function schemaOnSource(tableName?: string): Promise<string> {
    if (!source.schema) throw new Error("schema is not available on this database source");
    const normalizedTableName = optionalTableName(tableName);
    return normalizeSourceString(await source.schema(normalizedTableName ?? undefined), "schema result");
  }

  async function listTablesOnSource(): Promise<DatabaseTable[]> {
    if (!source.listTables) throw new Error("listTables is not available on this database source");
    return normalizeSourceDatabaseTables(await source.listTables());
  }

  async function viewsOnSource(): Promise<DatabaseTable[]> {
    if (source.views) return normalizeSourceDatabaseTables(await source.views());
    if (!source.listTables) throw new Error("views is not available on this database source because listTables is unavailable");
    return (await listTablesOnSource()).filter((table) => table.objectType === "view");
  }

  async function describeTableOnSource(tableName: string): Promise<TableDescription> {
    const describe = source.describeTable ?? source.describe;
    if (!describe) throw new Error("describeTable is not available on this database source");
    const normalizedTableName = requiredTableName(tableName);
    return normalizeSourceTableDescription(await describe(normalizedTableName), normalizedTableName);
  }

  async function listColumnsOnSource(tableName: string): Promise<DatabaseColumn[]> {
    const listColumns = source.listColumns ?? source.columns;
    if (!listColumns) throw new Error("listColumns is not available on this database source");
    return normalizeSourceDatabaseColumns(await listColumns(requiredTableName(tableName)));
  }

  async function listIndexesOnSource(tableName: string): Promise<DatabaseIndex[]> {
    const listIndexes = source.listIndexes ?? source.indexes;
    if (!listIndexes) throw new Error("listIndexes is not available on this database source");
    const normalizedTableName = requiredTableName(tableName);
    return normalizeSourceDatabaseIndexes(await listIndexes(normalizedTableName), normalizedTableName);
  }

  async function listTriggersOnSource(tableName: string): Promise<DatabaseTrigger[]> {
    const listTriggers = source.listTriggers ?? source.triggers;
    if (!listTriggers) throw new Error("listTriggers is not available on this database source");
    const normalizedTableName = requiredTableName(tableName);
    return normalizeSourceDatabaseTriggers(await listTriggers(normalizedTableName), normalizedTableName);
  }

  async function listForeignKeysOnSource(tableName: string): Promise<DatabaseForeignKey[]> {
    const listForeignKeys = source.listForeignKeys ?? source.foreignKeys;
    if (!listForeignKeys) throw new Error("listForeignKeys is not available on this database source");
    return normalizeSourceDatabaseForeignKeys(await listForeignKeys(requiredTableName(tableName)));
  }

  async function previewTableOnSource(tableName: string, options?: IcpdbDatabasePreviewOptionsObject): Promise<TablePreviewResponse> {
    rejectPreviewOptionDatabaseId(options);
    const previewTable = source.previewTable ?? source.preview;
    if (!previewTable) throw new Error("previewTable is not available on this database source");
    const normalizedTableName = requiredTableName(tableName);
    return normalizeSourceTablePreview(await previewTable(normalizedTableName, normalizePreviewOptions(options)), normalizedTableName);
  }

  async function waitForRoutedOperationOnSource(operationId: string, waitOptions?: IcpdbWaitForRoutedOperationOptions): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    const normalizedWaitOptions = normalizedWaitForRoutedOperationOptions(waitOptions);
    if (source.waitForRoutedOperation) {
      return normalizeSourceRoutedOperationInfo(await source.waitForRoutedOperation(normalizedOperationId, normalizedWaitOptions));
    }
    if (!source.getRoutedOperation) throw new Error("waitForRoutedOperation is not available on this database source because getRoutedOperation is unavailable");
    const getOperation = source.getRoutedOperation;
    let reconcileOperation: (() => Promise<RoutedOperationInfo>) | undefined;
    if (normalizedWaitOptions?.reconcileUnknown && !source.reconcileRoutedOperation) {
      throw new Error("waitForRoutedOperation reconcileUnknown requires reconcileRoutedOperation on this database source");
    }
    if (normalizedWaitOptions?.reconcileUnknown && source.reconcileRoutedOperation) {
      const reconcileRouted = source.reconcileRoutedOperation;
      reconcileOperation = async () => normalizeSourceRoutedOperationInfo(await reconcileRouted(normalizedOperationId));
    }
    return waitForRoutedOperationStatus(
      normalizedOperationId,
      async () => normalizeSourceRoutedOperationInfo(await getOperation(normalizedOperationId)),
      reconcileOperation,
      normalizedWaitOptions
    );
  }

  function connectionUrlOnSource(): string {
    if (!source.connectionUrl) throw new Error("connectionUrl is not available on this database source");
    return requiredNonEmptyString(source.connectionUrl(), "connectionUrl");
  }

  function urlOnSource(): string {
    return source.url ? requiredNonEmptyString(source.url(), "url") : connectionUrlOnSource();
  }

  function infoOnSource(): IcpdbSqlClientInfo {
    if (source.info) {
      const info = source.info();
      const baseInfo = databaseClientInfo(info.databaseId, info.connectionUrl, info.url, info.canisterId);
      if (info.principal === undefined) return baseInfo;
      return { ...baseInfo, principal: requiredNonEmptyString(info.principal, "principal") };
    }
    return databaseClientInfo(databaseId, connectionUrlOnSource(), urlOnSource());
  }

  async function deleteOnSource(): Promise<void> {
    if (!source.delete) throw new Error("delete is not available on this database source");
    await source.delete();
  }

  async function getUsageOnSource(): Promise<DatabaseUsage> {
    if (!source.getUsage) throw new Error("getUsage is not available on this database source");
    return normalizeSourceDatabaseUsage(await source.getUsage());
  }

  async function statusOnSource(): Promise<IcpdbDatabaseStatus> {
    if (source.status) return normalizeSourceDatabaseStatus(await source.status());
    if (!source.connectionUrl) throw new Error("status is not available on this database source because connectionUrl is unavailable");
    if (!source.getUsage) throw new Error("status is not available on this database source because getUsage is unavailable");
    if (!source.placement) throw new Error("status is not available on this database source because placement is unavailable");
    return databaseStatusFromDatabase(enriched);
  }

  async function listUsageEventsOnSource(): Promise<DatabaseUsageEventSummary[]> {
    if (!source.listUsageEvents) throw new Error("listUsageEvents is not available on this database source");
    return normalizeSourceDatabaseUsageEvents(await source.listUsageEvents());
  }

  async function getRoutedOperationOnSource(operationId: string): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    if (!source.getRoutedOperation) throw new Error("getRoutedOperation is not available on this database source");
    return normalizeSourceRoutedOperationInfo(await source.getRoutedOperation(normalizedOperationId));
  }

  async function reconcileRoutedOperationOnSource(operationId: string): Promise<RoutedOperationInfo> {
    const normalizedOperationId = requiredOperationId(operationId);
    if (!source.reconcileRoutedOperation) throw new Error("reconcileRoutedOperation is not available on this database source");
    return normalizeSourceRoutedOperationInfo(await source.reconcileRoutedOperation(normalizedOperationId));
  }

  async function grantMemberOnSource(principal: string, role: DatabaseRole): Promise<void> {
    const normalizedPrincipal = grantablePrincipal(principal);
    assertDatabaseRole(role);
    if (!source.grantMember) throw new Error("grantMember is not available on this database source");
    await source.grantMember(normalizedPrincipal, role);
  }

  async function revokeMemberOnSource(principal: string): Promise<void> {
    const normalizedPrincipal = memberPrincipal(principal);
    if (!source.revokeMember) throw new Error("revokeMember is not available on this database source");
    await source.revokeMember(normalizedPrincipal);
  }

  async function listMembersOnSource(): Promise<DatabaseMember[]> {
    if (!source.listMembers) throw new Error("listMembers is not available on this database source");
    return normalizeSourceDatabaseMembers(await source.listMembers());
  }

  async function placementOnSource(): Promise<DatabaseShardPlacement | null> {
    if (!source.placement) throw new Error("placement is not available on this database source");
    return normalizeSourceDatabaseShardPlacementOrNull(await source.placement());
  }

  async function archiveOnSource(): Promise<Uint8Array> {
    if (!source.archive) throw new Error("archive is not available on this database source");
    return transferUint8Array(await source.archive());
  }

  async function restoreOnSource(snapshot: IcpdbRestoreInput, options?: IcpdbRestoreOptions): Promise<void> {
    if (!source.restore) throw new Error("restore is not available on this database source");
    const payload = await normalizedRestorePayload(snapshot, options);
    await source.restore(payload.bytes, payload.options);
  }

  async function snapshotInfoOnSource(snapshot: IcpdbRestoreInput): Promise<IcpdbSnapshotInfo> {
    const bytes = transferUint8Array(snapshot);
    const snapshotHash = await sha256(bytes);
    const expected = { sizeBytes: bytes.byteLength, sha256: bytesToHex(snapshotHash) };
    if (!source.snapshotInfo) return normalizeSnapshotInfo({ ...expected, snapshotHash }, expected);
    return normalizeSnapshotInfo(await source.snapshotInfo(bytes), expected);
  }

  enriched = {
    ...source,
    databaseId,
    query: queryOnSource,
    execute: executeOnSource,
    queryRows,
    queryOne,
    all: allRows,
    get: getOne,
    values,
    first,
    firstValue,
    scalar,
    prepare: preparedStatement,
    run: runStatement,
    batch: batchOnSource,
    transaction: transactionStatements,
    exec: execOnSource,
    executeMultiple: executeMultipleOnSource,
    executeScript: executeScriptOnSource,
    migrate: migrateOnSource,
    dumpSql: dumpSqlOnSource,
    loadSqlDump: loadSqlDumpOnSource,
    schema: schemaOnSource,
    listTables: listTablesOnSource,
    tables: source.tables ?? listTablesOnSource,
    views: viewsOnSource,
    describeTable: describeTableOnSource,
    describe: describeTableOnSource,
    listColumns: listColumnsOnSource,
    columns: listColumnsOnSource,
    listIndexes: listIndexesOnSource,
    indexes: listIndexesOnSource,
    listTriggers: listTriggersOnSource,
    triggers: listTriggersOnSource,
    listForeignKeys: listForeignKeysOnSource,
    foreignKeys: listForeignKeysOnSource,
    previewTable: previewTableOnSource,
    preview: previewTableOnSource,
    inspect: inspectOnSource,
    connectionUrl: connectionUrlOnSource,
    url: urlOnSource,
    info: infoOnSource,
    delete: deleteOnSource,
    getUsage: getUsageOnSource,
    status: statusOnSource,
    listUsageEvents: listUsageEventsOnSource,
    getRoutedOperation: getRoutedOperationOnSource,
    reconcileRoutedOperation: reconcileRoutedOperationOnSource,
    snapshotInfo: snapshotInfoOnSource,
    waitForRoutedOperation: waitForRoutedOperationOnSource,
    grantMember: grantMemberOnSource,
    revokeMember: revokeMemberOnSource,
    listMembers: listMembersOnSource,
    placement: placementOnSource,
    archive: archiveOnSource,
    restore: restoreOnSource,
    close: source.close ?? noop
  };
  return enriched;
}

function assertSqlClientDatabaseSource(source: IcpdbSqlClientDatabaseSource): void {
  if (typeof source !== "object" || source === null) throw new Error("database source must be an object");
  if (typeof source.query !== "function") throw new Error("database source query must be a function");
  if (typeof source.execute !== "function") throw new Error("database source execute must be a function");
  for (const method of OPTIONAL_DATABASE_SOURCE_METHODS) {
    if (source[method] !== undefined && typeof source[method] !== "function") {
      throw new Error(`database source ${method} must be a function`);
    }
  }
}

const OPTIONAL_DATABASE_SOURCE_METHODS: readonly (keyof IcpdbSqlClientDatabaseSource)[] = [
  "batch",
  "queryRows",
  "queryOne",
  "all",
  "get",
  "values",
  "first",
  "firstValue",
  "scalar",
  "prepare",
  "run",
  "transaction",
  "exec",
  "executeMultiple",
  "executeScript",
  "migrate",
  "dumpSql",
  "loadSqlDump",
  "schema",
  "listTables",
  "tables",
  "views",
  "describeTable",
  "describe",
  "listColumns",
  "columns",
  "listIndexes",
  "indexes",
  "listTriggers",
  "triggers",
  "listForeignKeys",
  "foreignKeys",
  "previewTable",
  "preview",
  "inspect",
  "snapshotInfo",
  "connectionUrl",
  "url",
  "info",
  "delete",
  "getUsage",
  "status",
  "listUsageEvents",
  "getRoutedOperation",
  "reconcileRoutedOperation",
  "waitForRoutedOperation",
  "placement",
  "archive",
  "restore",
  "grantMember",
  "revokeMember",
  "listMembers",
  "close"
];

type IcpdbCreateSetup = IcpdbCreateSetupOptions;

async function createDatabaseWithSetup(client: IcpdbClient, setup: IcpdbCreateSetup): Promise<IcpdbDatabaseClient> {
  assertCreateSetupOptions(setup);
  const db = await client.createDatabase();
  return applyCreateSetup(db, setup);
}

async function applyCreateSetup(db: IcpdbDatabaseClient, setup: IcpdbCreateSetup): Promise<IcpdbDatabaseClient> {
  if (setup.setupSql === undefined && setup.setupStatements === undefined && setup.setupMigrations === undefined) return db;
  try {
    if (setup.setupSql !== undefined) await db.executeScript(setup.setupSql);
    if (setup.setupMigrations !== undefined) await db.migrate(setup.setupMigrations);
    if (setup.setupStatements !== undefined && setup.setupStatements.length > 0) await createClientFromDatabase(db).batch(setup.setupStatements, "write");
    return db;
  } catch (error) {
    try {
      await db.delete();
    } catch {
      // Preserve the setup failure; delete is best-effort cleanup.
    }
    throw error;
  }
}

function schemaFromDescriptions(descriptions: readonly TableDescription[]): string {
  const statements: string[] = [];
  for (const description of descriptions) pushSchemaStatement(statements, description.schemaSql);
  for (const description of descriptions) {
    for (const index of description.indexes) pushSchemaStatement(statements, index.schemaSql);
    for (const trigger of description.triggers) pushSchemaStatement(statements, trigger.schemaSql);
  }
  return statements.length === 0 ? "" : `${statements.join("\n")}\n`;
}

function sqlClientStatement(statement: IcpdbSqlClientStatementInput, args?: IcpdbSqlArgsInput): IcpdbDatabaseStatementInput {
  if (typeof statement === "string") {
    const sql = requiredSqlString(statement, "SQL statement SQL");
    return { sql, params: validatedSqlClientParams(sql, args ?? []), maxRows: null };
  }
  if (isSqlClientStatementTuple(statement)) {
    const tuple = sqlClientStatementTuple(statement);
    if (tuple.args !== undefined && args !== undefined) throw new Error("use either tuple args or call args, not both");
    return { sql: tuple.sql, params: validatedSqlClientParams(tuple.sql, tuple.args ?? args ?? []), maxRows: null };
  }
  if (!isSqlClientStatementObject(statement)) {
    throw new Error("SQL statement must be a string, [sql, args?] tuple, or { sql, args? } object");
  }
  if (statement.args !== undefined && statement.params !== undefined) throw new Error("use either args or params, not both");
  if ((statement.args !== undefined || statement.params !== undefined) && args !== undefined) {
    throw new Error("use either statement args or call args, not both");
  }
  rejectSqlClientStatementDatabaseId(statement);
  const sql = requiredSqlString(statement.sql, "SQL statement SQL");
  const request = {
    sql,
    params: validatedSqlClientParams(sql, statement.args ?? statement.params ?? args ?? []),
    maxRows: sqlRowLimit(statement.maxRows ?? null, "maxRows")
  };
  return statement.idempotencyKey === undefined ? request : { ...request, idempotencyKey: optionalIdempotencyKey(statement.idempotencyKey) };
}

type IcpdbRuntimeSqlClientStatement = IcpdbSqlClientStatement & {
  databaseId?: string | null;
};

function rejectSqlClientStatementDatabaseId(statement: IcpdbRuntimeSqlClientStatement): void {
  if (!("databaseId" in statement) || statement.databaseId === undefined || statement.databaseId === null) return;
  throw new Error("SQL client statement databaseId is not supported; choose database at the client or database handle");
}

function sqlClientBatchStatement(statement: IcpdbSqlClientBatchStatement): IcpdbNormalizedBatchStatementInput {
  return normalizeBatchStatement(statement);
}

function requiredBatchStatements<T>(statements: readonly T[], label: string): readonly T[] {
  if (!Array.isArray(statements)) throw new Error(`${label} statements must be an array`);
  if (statements.length === 0) throw new Error(`${label} requires at least one SQL statement`);
  return statements;
}

function normalizeBatchStatement(statement: IcpdbBatchStatementInput): IcpdbNormalizedBatchStatementInput {
  if (isSqlClientBatchTuple(statement)) {
    const tuple = sqlClientStatementTuple(statement);
    return normalizeBatchStatement({ sql: tuple.sql, args: tuple.args ?? [] });
  }
  if (typeof statement === "string") return { sql: requiredSqlString(statement, "SQL statement SQL"), params: [] };
  if (!isSqlClientStatementObject(statement)) {
    throw new Error("SQL statement must be a string, [sql, args?] tuple, or { sql, args? } object");
  }
  rejectBatchStatementOptions(statement);
  const request = sqlClientStatement(statement);
  return {
    sql: request.sql,
    params: request.params
  };
}

type IcpdbRuntimeBatchStatementObject = IcpdbSqlClientStatement & {
  databaseId?: string | null;
};

function rejectPreparedStatementOptions(statement: IcpdbRuntimeBatchStatementObject): void {
  if ("idempotencyKey" in statement && statement.idempotencyKey !== undefined && statement.idempotencyKey !== null) {
    throw new Error("prepared statement idempotencyKey is not supported");
  }
  if ("maxRows" in statement && statement.maxRows !== undefined && statement.maxRows !== null) {
    throw new Error("prepared statement maxRows is not supported");
  }
  if ("databaseId" in statement && statement.databaseId !== undefined && statement.databaseId !== null) {
    throw new Error("prepared statement databaseId is not supported; choose database at the client or database handle");
  }
}

function rejectBatchStatementOptions(statement: IcpdbRuntimeBatchStatementObject): void {
  if ("idempotencyKey" in statement && statement.idempotencyKey !== undefined && statement.idempotencyKey !== null) {
    throw new Error("batch statement idempotencyKey is not supported; use batch option idempotencyKey");
  }
  if ("maxRows" in statement && statement.maxRows !== undefined && statement.maxRows !== null) {
    throw new Error("batch statement maxRows is not supported; use batch option maxRows");
  }
  if ("databaseId" in statement && statement.databaseId !== undefined && statement.databaseId !== null) {
    throw new Error("batch statement databaseId is not supported; choose database at the client or batch option");
  }
}

function isSqlClientBatchTuple(statement: IcpdbSqlClientBatchStatement): statement is readonly [string, IcpdbSqlArgsInput?] {
  return isSqlClientStatementTuple(statement);
}

function isSqlClientStatementTuple(statement: IcpdbSqlClientStatementInput): statement is readonly [string, IcpdbSqlArgsInput?] {
  return Array.isArray(statement);
}

function sqlClientStatementTuple(statement: readonly unknown[]): { sql: string; args?: IcpdbSqlArgsInput } {
  if (statement.length < 1 || statement.length > 2) throw new Error("SQL statement tuple must be [sql, args?]");
  const sql = statement[0];
  const normalizedSql = requiredSqlString(sql, "SQL statement tuple SQL");
  const args = statement[1];
  if (args === undefined) return { sql: normalizedSql };
  if (!isSqlArgsInput(args)) throw new Error("SQL statement tuple args must be an array or named object");
  return { sql: normalizedSql, args };
}

function isSqlClientStatementObject(value: unknown): value is IcpdbSqlClientStatement {
  return typeof value === "object" && value !== null;
}

function isSqlArgsInput(value: unknown): value is IcpdbSqlArgsInput {
  return Array.isArray(value) || isSqlArgsRecord(value);
}

function isSqlArgsRecord(value: unknown): value is Readonly<Record<string, IcpdbSqlValueInput>> {
  if (typeof value !== "object" || value === null) return false;
  if (value instanceof Date) return false;
  if (value instanceof ArrayBuffer) return false;
  if (ArrayBuffer.isView(value)) return false;
  if ("kind" in value) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isVersionedMigrations(input: IcpdbMigrateInput): input is readonly IcpdbMigration[] {
  return input.every((item) => typeof item === "object" && item !== null && !Array.isArray(item) && "version" in item);
}

function requiredMigrateInput(input: IcpdbMigrateInput): IcpdbMigrateInput {
  if (!Array.isArray(input)) throw new Error("migrate input must be an array");
  return input;
}

function normalizeMigrations(migrations: readonly IcpdbMigration[]): { version: string; name: string; sql: string }[] {
  const seen = new Set<string>();
  return migrations.map((migration) => {
    if (migration.version === undefined || migration.version === null) throw new Error("migration version is required");
    const version = String(migration.version).trim();
    if (!version) throw new Error("migration version is required");
    if (seen.has(version)) throw new Error(`duplicate migration version: ${version}`);
    seen.add(version);
    return {
      version,
      name: migrationName(migration.name, version),
      sql: migrationSql(migration.sql)
    };
  });
}

function migrationName(value: unknown, defaultValue: string): string {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "string") throw new Error("migration name must be a string");
  return value.trim() || defaultValue;
}

function migrationSql(value: unknown): string {
  if (typeof value !== "string") throw new Error("migration SQL must be a string");
  if (value.trim().length === 0) throw new Error("migration SQL must be a non-empty string");
  return value;
}

type NamedSqlParameter = {
  token: string;
  name: string;
};

function sqlClientParams(sql: string, args: IcpdbSqlArgsInput): readonly IcpdbSqlValueInput[] {
  if (isSqlArgsArray(args)) return args;
  if (!isSqlArgsRecord(args)) throw new Error("SQL args must be an array or named object");
  const parameters = namedSqlParameters(sql);
  if (parameters.length === 0) throw new Error("named SQL args require named placeholders");
  return parameters.map((parameter) => namedSqlArgValue(args, parameter));
}

function validatedSqlClientParams(sql: string, args: IcpdbSqlArgsInput): readonly IcpdbSqlValueInput[] {
  const params = sqlClientParams(sql, args);
  for (const value of params) validateSqlValueInput(value);
  return params;
}

function validateSqlValueInput(value: IcpdbSqlValueInput): void {
  sqlValue(value);
}

function isSqlArgsArray(args: IcpdbSqlArgsInput): args is readonly IcpdbSqlValueInput[] {
  return Array.isArray(args);
}

function namedSqlArgValue(args: Readonly<Record<string, IcpdbSqlValueInput>>, parameter: NamedSqlParameter): IcpdbSqlValueInput {
  const nameValue = args[parameter.name];
  if (nameValue !== undefined || Object.hasOwn(args, parameter.name)) {
    if (nameValue === undefined) throw new Error(`SQL named arg ${parameter.name} is undefined`);
    return nameValue;
  }
  const tokenValue = args[parameter.token];
  if (tokenValue !== undefined || Object.hasOwn(args, parameter.token)) {
    if (tokenValue === undefined) throw new Error(`SQL named arg ${parameter.token} is undefined`);
    return tokenValue;
  }
  throw new Error(`missing SQL named arg: ${parameter.name}`);
}

function namedSqlParameters(sql: string): NamedSqlParameter[] {
  const parameters: NamedSqlParameter[] = [];
  const seenTokens = new Set<string>();
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    if (char === "'") {
      index = skipQuotedSql(sql, index, "'");
    } else if (char === "\"") {
      index = skipQuotedSql(sql, index, "\"");
    } else if (char === "`") {
      index = skipQuotedSql(sql, index, "`");
    } else if (char === "[") {
      index = skipBracketQuotedSql(sql, index);
    } else if (char === "-" && sql[index + 1] === "-") {
      index = skipLineComment(sql, index);
    } else if (char === "/" && sql[index + 1] === "*") {
      index = skipBlockComment(sql, index);
    } else if (isNamedParameterPrefix(char) && isNameStart(sql[index + 1] ?? "")) {
      const start = index;
      index += 2;
      while (index < sql.length && isNamePart(sql[index] ?? "")) index += 1;
      const token = sql.slice(start, index);
      if (!seenTokens.has(token)) {
        seenTokens.add(token);
        parameters.push({ token, name: token.slice(1) });
      }
    } else {
      index += 1;
    }
  }
  return parameters;
}

function skipQuotedSql(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
      } else {
        return index + 1;
      }
    } else {
      index += 1;
    }
  }
  return sql.length;
}

function skipBracketQuotedSql(sql: string, start: number): number {
  const end = sql.indexOf("]", start + 1);
  return end === -1 ? sql.length : end + 1;
}

function skipLineComment(sql: string, start: number): number {
  const end = sql.indexOf("\n", start + 2);
  return end === -1 ? sql.length : end + 1;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf("*/", start + 2);
  return end === -1 ? sql.length : end + 2;
}

function isNamedParameterPrefix(value: string): boolean {
  return value === ":" || value === "@" || value === "$";
}

function isNameStart(value: string): boolean {
  return /^[A-Za-z_]$/.test(value);
}

function isNamePart(value: string): boolean {
  return /^[A-Za-z0-9_]$/.test(value);
}

function sqlClientBatchOptions(statements: readonly IcpdbBatchStatementInput[], options?: IcpdbSqlClientBatchOptions): IcpdbSqlClientBatchOptions | undefined {
  if (typeof options === "string") {
    validateBatchMode(options);
    validateReadBatchStatements(statements, options);
    return options;
  }
  if (options === undefined) return undefined;
  const { mode, ...batchOptions } = options;
  if (mode !== undefined) {
    validateBatchMode(mode);
    validateReadBatchOptions(options, mode);
    validateReadBatchStatements(statements, mode);
  }
  const normalized = normalizedBatchOptions(batchOptions);
  if (mode === undefined) return normalized;
  return { ...(normalized ?? {}), mode };
}

function lowLevelBatchOptions(
  statements: readonly IcpdbBatchStatementInput[],
  options: IcpdbLowLevelBatchOptions | undefined,
  defaultDatabaseId: string | undefined
): IcpdbNormalizedLowLevelBatchOptions {
  requiredBatchStatements(statements, "batch");
  if (typeof options === "string") {
    validateBatchMode(options);
    validateReadBatchStatements(statements, options);
    return {
      databaseId: requiredDatabaseId(undefined, defaultDatabaseId),
      maxRows: null,
      idempotencyKey: null,
      mode: options
    };
  }
  const mode = options?.mode;
  if (mode !== undefined) {
    validateBatchMode(mode);
    validateReadBatchOptions(options, mode);
    validateReadBatchStatements(statements, mode);
  }
  return {
    databaseId: requiredDatabaseId(options?.databaseId, defaultDatabaseId),
    maxRows: sqlRowLimit(options?.maxRows ?? null, "maxRows"),
    idempotencyKey: optionalIdempotencyKey(options?.idempotencyKey) ?? null,
    mode: mode ?? null
  };
}

function batchMode(options: IcpdbSqlClientBatchOptions | undefined): IcpdbBatchMode | undefined {
  const mode = typeof options === "string" ? options : options?.mode;
  if (mode !== undefined) validateBatchMode(mode);
  return mode;
}

function batchMaxRows(options: IcpdbSqlClientBatchOptions | undefined): number | null {
  if (typeof options === "string") return null;
  return sqlRowLimit(options?.maxRows ?? null, "maxRows");
}

function databaseBoundBatchOptions(databaseId: string, options?: IcpdbSqlClientBatchOptions): IcpdbBatchOptions {
  if (typeof options === "string") return { databaseId, mode: options };
  rejectSqlClientBatchOptionDatabaseId(options);
  return {
    databaseId,
    maxRows: options?.maxRows ?? null,
    idempotencyKey: optionalIdempotencyKey(options?.idempotencyKey) ?? null,
    mode: options?.mode
  };
}

type IcpdbRuntimeSqlClientBatchOptionsObject = Omit<IcpdbBatchOptions, "databaseId"> & {
  databaseId?: string | null;
};

function rejectSqlClientBatchOptionDatabaseId(options: IcpdbSqlClientBatchOptions | IcpdbRuntimeSqlClientBatchOptionsObject | undefined): void {
  if (typeof options !== "object" || options === null) return;
  if (!("databaseId" in options) || options.databaseId === undefined || options.databaseId === null) return;
  throw new Error("SQL client batch option databaseId is not supported; choose database at the client or database handle");
}

function normalizedBatchOptions(options: IcpdbRuntimeSqlClientBatchOptionsObject): Omit<IcpdbBatchOptions, "databaseId"> | undefined {
  rejectSqlClientBatchOptionDatabaseId(options);
  const normalized: Omit<IcpdbBatchOptions, "databaseId"> = {};
  if (options.maxRows !== undefined) normalized.maxRows = sqlRowLimit(options.maxRows, "maxRows");
  if (options.idempotencyKey !== undefined) normalized.idempotencyKey = optionalIdempotencyKey(options.idempotencyKey);
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function validateBatchMode(mode: string): asserts mode is IcpdbBatchMode {
  if (mode !== "read" && mode !== "write" && mode !== "deferred") {
    throw new LibsqlError("batch mode must be read, write, or deferred", "ICPDB_BATCH_MODE");
  }
}

function validateReadBatchOptions(options: IcpdbSqlClientBatchOptions | IcpdbLowLevelBatchOptions | undefined, mode: IcpdbBatchMode | undefined): void {
  if (mode !== "read" || typeof options !== "object" || options === null) return;
  if (options.idempotencyKey !== undefined && options.idempotencyKey !== null) {
    throw new Error("read batch mode does not accept idempotencyKey");
  }
}

function validateWriteSqlIdempotencyKey(statement: { idempotencyKey?: string | null | undefined }): void {
  if (statement.idempotencyKey !== undefined && statement.idempotencyKey !== null) {
    throw new Error("idempotencyKey is only valid for write SQL");
  }
}

function validateReadSqlStatement(statement: { sql: string }): void {
  if (!isReadSql(statement.sql)) {
    throw new LibsqlError("query only accepts read SQL", "SQLITE_READONLY", "SQLITE_READONLY");
  }
}

function validateReadBatchStatements(statements: readonly IcpdbBatchStatementInput[], mode: IcpdbBatchMode): void {
  if (mode !== "read") return;
  const statementIndex = statements.findIndex((statement) => !isReadSql(normalizeBatchStatement(statement).sql));
  if (statementIndex !== -1) {
    throw new LibsqlBatchError("read batch mode only accepts read SQL", statementIndex, "SQLITE_READONLY");
  }
}

type ChunkableBatchOptions = string | { idempotencyKey?: string | null | undefined } | undefined;

async function executeScriptBatches<TOptions extends ChunkableBatchOptions>(
  batcher: (statements: readonly IcpdbBatchStatementInput[], options?: TOptions) => Promise<SqlExecuteResponse[]>,
  source: string,
  options?: TOptions
): Promise<SqlExecuteResponse[]> {
  const statements = splitSqlStatements(source).map((sql) => ({ sql, params: [] }));
  if (statements.length === 0) throw new Error("script requires at least one SQL statement");
  return executeStatementBatches(batcher, statements, options);
}

async function loadSqlDumpBatches<TOptions extends ChunkableBatchOptions>(
  batcher: (statements: readonly IcpdbBatchStatementInput[], options?: TOptions) => Promise<SqlExecuteResponse[]>,
  source: string,
  options?: TOptions
): Promise<SqlExecuteResponse[]> {
  const statements = splitSqlDumpStatements(source).map((sql) => ({ sql, params: [] }));
  if (statements.length === 0) throw new Error("SQL dump has no executable statements");
  return executeStatementBatches(batcher, statements, options);
}

async function executeMultipleOnDatabase(database: IcpdbSqlClientDatabase, statementsOrSource: string | readonly IcpdbNormalizedBatchStatementInput[]): Promise<void> {
  const statements = typeof statementsOrSource === "string" ? sqlScriptStatements(statementsOrSource) : statementsOrSource;
  for (const statement of statements) {
    if (isReadSql(statement.sql)) {
      await database.query(statement);
    } else {
      await database.execute(statement);
    }
  }
}

function sqlScriptStatements(source: string): IcpdbNormalizedBatchStatementInput[] {
  const statements = splitSqlStatements(source).map((sql) => ({ sql, params: [] }));
  if (statements.length === 0) throw new Error("script requires at least one SQL statement");
  return statements;
}

function sqlDumpStatements(source: string): IcpdbNormalizedBatchStatementInput[] {
  const statements = splitSqlDumpStatements(source).map((sql) => ({ sql, params: [] }));
  if (statements.length === 0) throw new Error("SQL dump has no executable statements");
  return statements;
}

function normalizedSqlScriptBatchOptions(source: string, options?: IcpdbSqlClientBatchOptions): IcpdbDatabaseBatchOptionsObject | undefined {
  return databaseSourceBatchOptions(sqlClientBatchOptions(sqlScriptStatements(source), options));
}

function normalizedSqlDumpBatchOptions(source: string, options?: IcpdbSqlClientBatchOptions): IcpdbDatabaseBatchOptionsObject | undefined {
  return databaseSourceBatchOptions(sqlClientBatchOptions(sqlDumpStatements(source), options));
}

function databaseSourceBatchOptions(options: IcpdbSqlClientBatchOptions | undefined): IcpdbDatabaseBatchOptionsObject | undefined {
  if (options === undefined) return undefined;
  if (typeof options === "string") return { mode: options };
  return options;
}

async function executeStatementBatches<TOptions extends ChunkableBatchOptions>(
  batcher: (statements: readonly IcpdbBatchStatementInput[], options?: TOptions) => Promise<SqlExecuteResponse[]>,
  statements: readonly IcpdbBatchStatementInput[],
  options?: TOptions
): Promise<SqlExecuteResponse[]> {
  const responses: SqlExecuteResponse[] = [];
  const chunkCount = Math.ceil(statements.length / SCRIPT_BATCH_STATEMENTS);
  let chunkIndex = 0;
  for (let offset = 0; offset < statements.length; offset += SCRIPT_BATCH_STATEMENTS) {
    responses.push(...await batcher(
      statements.slice(offset, offset + SCRIPT_BATCH_STATEMENTS),
      batchOptionsForStatementChunk(options, chunkIndex, chunkCount)
    ));
    chunkIndex += 1;
  }
  return responses;
}

function batchOptionsForStatementChunk<TOptions extends ChunkableBatchOptions>(options: TOptions | undefined, chunkIndex: number, chunkCount: number): TOptions | undefined {
  if (chunkCount <= 1 || typeof options !== "object" || options === null) return options;
  const idempotencyKey = options.idempotencyKey;
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) return options;
  return {
    ...options,
    idempotencyKey: `${idempotencyKey.trim()}:chunk:${chunkIndex + 1}:of:${chunkCount}`
  };
}

async function databaseStatusFromDatabase(database: IcpdbSqlClientDatabase, callerPrincipal?: string, callerRole?: DatabaseRole): Promise<IcpdbDatabaseStatus> {
  if (!database.connectionUrl) throw new Error("status is not available on this database source because connectionUrl is unavailable");
  if (!database.getUsage) throw new Error("status is not available on this database source because getUsage is unavailable");
  if (!database.placement) throw new Error("status is not available on this database source because placement is unavailable");
  const usage = await database.getUsage();
  const placement = await database.placement();
  const tableStatuses = await tableStatusesFromDatabase(database);
  return {
    databaseId: database.databaseId,
    connectionUrl: database.connectionUrl(),
    ...(callerPrincipal ? { callerPrincipal } : {}),
    ...(callerRole ? { callerRole } : {}),
    placement,
    usage,
    stats: databaseStatsFromTables(tableStatuses),
    tableStatuses
  };
}

async function tableStatusesFromDatabase(database: Pick<IcpdbSqlClientDatabase, "listTables" | "describeTable" | "previewTable">): Promise<IcpdbTableStatus[]> {
  const tables = await database.listTables();
  const statuses: IcpdbTableStatus[] = [];
  for (const table of tables) {
    const description = await database.describeTable(table.name);
    const preview = await database.previewTable(table.name, { limit: 1, offset: 0 });
    statuses.push({
      tableName: preview.tableName,
      objectType: description.objectType,
      rowCount: preview.totalCount,
      columnCount: description.columns.length,
      columns: preview.columns,
      indexCount: description.indexes.length,
      triggerCount: description.triggers.length,
      foreignKeyCount: description.foreignKeys.length
    });
  }
  return statuses;
}

function databaseStatsFromTables(tableStatuses: readonly IcpdbTableStatus[]): IcpdbDatabaseStats {
  const totals = tableStatuses.reduce((next, table) => ({
    tableCount: next.tableCount + (table.objectType === "view" ? 0 : 1),
    viewCount: next.viewCount + (table.objectType === "view" ? 1 : 0),
    rowCount: next.rowCount + BigInt(table.rowCount),
    columnCount: next.columnCount + table.columnCount,
    indexCount: next.indexCount + table.indexCount,
    triggerCount: next.triggerCount + table.triggerCount,
    foreignKeyCount: next.foreignKeyCount + table.foreignKeyCount
  }), {
    tableCount: 0,
    viewCount: 0,
    rowCount: 0n,
    columnCount: 0,
    indexCount: 0,
    triggerCount: 0,
    foreignKeyCount: 0
  });
  return {
    tableCount: totals.tableCount,
    viewCount: totals.viewCount,
    rowCount: totals.rowCount.toString(),
    columnCount: totals.columnCount,
    indexCount: totals.indexCount,
    triggerCount: totals.triggerCount,
    foreignKeyCount: totals.foreignKeyCount
  };
}

async function inspectDatabase(database: IcpdbSqlClientDatabase, options?: IcpdbInspectOptions): Promise<IcpdbDatabaseInspection> {
  rejectInspectOptionDatabaseId(options);
  const tableName = optionalTableName(options?.tableName);
  const tables = tableName
    ? await tableListForInspectTable(database, tableName)
    : await database.listTables();
  const inspections: IcpdbTableInspection[] = [];
  for (const table of tables) {
    const [description, preview] = await Promise.all([
      database.describeTable(table.name),
      database.previewTable(table.name, {
        limit: sqlRowLimit(options?.previewLimit ?? 25, "previewLimit"),
        offset: nonNegativeNat32(options?.previewOffset ?? 0, "previewOffset")
      })
    ]);
    inspections.push({ table, description, preview });
  }
  return {
    databaseId: database.databaseId,
    schema: await database.schema(tableName ?? undefined),
    tables: inspections
  };
}

async function tableListForInspectTable(database: IcpdbSqlClientDatabase, tableName: string): Promise<DatabaseTable[]> {
  const table = (await database.listTables()).find((candidate) => candidate.name === tableName);
  if (table) return [table];
  const description = await database.describeTable(tableName);
  return [{
    name: description.tableName,
    objectType: description.objectType,
    schemaSql: description.schemaSql
  }];
}

async function waitForRoutedOperationStatus(
  operationId: string,
  getOperation: () => Promise<RoutedOperationInfo>,
  reconcileOperation: (() => Promise<RoutedOperationInfo>) | undefined,
  options?: IcpdbWaitForRoutedOperationOptions
): Promise<RoutedOperationInfo> {
  const waitOptions = normalizedWaitForRoutedOperationOptions(options);
  const intervalMs = waitIntervalMs(waitOptions?.intervalMs);
  const timeoutMs = waitTimeoutMs(waitOptions?.timeoutMs);
  const startedAtMs = Date.now();
  let lastStatus = "pending";
  while (true) {
    const info = await getOperation();
    lastStatus = info.status;
    if (info.status === "unknown" && reconcileOperation) {
      const reconciled = await reconcileOperation();
      lastStatus = reconciled.status;
      if (reconciled.status !== "pending") return reconciled;
    } else if (info.status !== "pending") {
      return info;
    }
    const elapsedMs = Date.now() - startedAtMs;
    if (elapsedMs >= timeoutMs) {
      throw new Error(`routed operation ${operationId} did not finish within ${timeoutMs}ms; last status: ${lastStatus}`);
    }
    await delay(Math.min(intervalMs, timeoutMs - elapsedMs));
  }
}

function waitIntervalMs(value: number | null | undefined): number {
  if (value === null || value === undefined) return 500;
  if (!Number.isFinite(value) || value < 0) throw new Error("waitForRoutedOperation intervalMs must be a non-negative number");
  return value;
}

function waitTimeoutMs(value: number | null | undefined): number {
  if (value === null || value === undefined) return 30000;
  if (!Number.isFinite(value) || value < 0) throw new Error("waitForRoutedOperation timeoutMs must be a non-negative number");
  return value;
}

type IcpdbRuntimeWaitForRoutedOperationOptions = Omit<IcpdbWaitForRoutedOperationOptions, "databaseId"> & {
  databaseId?: string | null;
};

type IcpdbNormalizedStatementWait = {
  enabled: boolean;
  options?: IcpdbWaitForRoutedOperationOptions;
};

function normalizedWaitForRoutedOperationOptions(
  options: IcpdbRuntimeWaitForRoutedOperationOptions | undefined
): IcpdbWaitForRoutedOperationOptions | undefined {
  if (options === undefined) return undefined;
  rejectWaitForRoutedOperationOptionDatabaseId(options);
  waitIntervalMs(options.intervalMs);
  waitTimeoutMs(options.timeoutMs);
  return {
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
    reconcileUnknown: options.reconcileUnknown
  };
}

function statementWaitOption(statement: unknown): IcpdbNormalizedStatementWait {
  if (typeof statement !== "object" || statement === null) return { enabled: false };
  return normalizedStatementWaitOption(Reflect.get(statement, "wait"));
}

function normalizedStatementWaitOption(wait: unknown): IcpdbNormalizedStatementWait {
  if (wait === undefined || wait === null || wait === false) return { enabled: false };
  if (wait === true) return { enabled: true };
  if (typeof wait !== "object") throw new Error("wait must be a boolean or waitForRoutedOperation options object");
  return {
    enabled: true,
    options: normalizedWaitForRoutedOperationOptions(statementWaitOptionsObject(wait))
  };
}

function statementWaitOptionsObject(value: object): IcpdbRuntimeWaitForRoutedOperationOptions {
  const databaseId = Reflect.get(value, "databaseId");
  if (databaseId !== undefined && databaseId !== null) {
    throw new Error("database wait option databaseId is not supported; choose database at the client, low-level wait argument, or database handle");
  }
  return {
    intervalMs: waitNumberOption(Reflect.get(value, "intervalMs"), "waitForRoutedOperation intervalMs"),
    timeoutMs: waitNumberOption(Reflect.get(value, "timeoutMs"), "waitForRoutedOperation timeoutMs"),
    reconcileUnknown: waitBooleanOption(Reflect.get(value, "reconcileUnknown"), "waitForRoutedOperation reconcileUnknown")
  };
}

function waitNumberOption(value: unknown, label: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "number") throw new Error(`${label} must be a non-negative number`);
  return value;
}

function waitBooleanOption(value: unknown, label: string): boolean | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function rejectReadSqlWaitOption(wait: IcpdbNormalizedStatementWait): void {
  if (wait.enabled) throw new Error("wait is only valid for write SQL");
}

async function waitForStatementRoutedOperation(
  database: Pick<IcpdbSqlClientDatabase, "waitForRoutedOperation">,
  response: Pick<SqlExecuteResponse, "routedOperationId">,
  wait: IcpdbNormalizedStatementWait
): Promise<void> {
  await waitForRoutedOperationFromResponse(response, (operationId) => database.waitForRoutedOperation(operationId, wait.options), wait);
}

async function waitForRoutedOperationFromResponse(
  response: Pick<SqlExecuteResponse, "routedOperationId">,
  waitForOperation: (operationId: string) => Promise<RoutedOperationInfo>,
  wait: IcpdbNormalizedStatementWait
): Promise<void> {
  if (!wait.enabled || !response.routedOperationId) return;
  await waitForOperation(response.routedOperationId);
}

function rejectWaitForRoutedOperationOptionDatabaseId(options: IcpdbRuntimeWaitForRoutedOperationOptions | undefined): void {
  if (typeof options !== "object" || options === null) return;
  if (!("databaseId" in options) || options.databaseId === undefined || options.databaseId === null) return;
  throw new Error("database wait option databaseId is not supported; choose database at the client, low-level wait argument, or database handle");
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function grantablePrincipal(principal: string): string {
  const normalizedPrincipal = memberPrincipal(principal);
  if (normalizedPrincipal === ANONYMOUS_PRINCIPAL) {
    throw new Error("anonymous principal cannot be granted database access");
  }
  return normalizedPrincipal;
}

function memberPrincipal(principal: string): string {
  if (typeof principal !== "string" || principal.trim().length === 0) {
    throw new Error("database member principal must be a non-empty string");
  }
  const normalizedPrincipal = principal.trim();
  try {
    Principal.fromText(normalizedPrincipal);
  } catch {
    throw new Error("database member principal must be a valid principal");
  }
  return normalizedPrincipal;
}

function assertDatabaseRole(role: DatabaseRole): void {
  if (role !== "reader" && role !== "writer" && role !== "owner") {
    throw new Error("database role must be reader, writer, or owner");
  }
}

function normalizeDatabaseRole(role: string): DatabaseRole {
  if (role === "reader" || role === "writer" || role === "owner") return role;
  throw new Error("database role must be reader, writer, or owner");
}

function normalizeSourceSqlResponse(response: SqlExecuteResponse): SqlExecuteResponse {
  if (typeof response !== "object" || response === null) throw new Error("SQL result must be an object");
  assertSqlResponseShape(response);
  safeIntegerText(response.rowsAffected, "rowsAffected");
  integerTextBigInt(response.lastInsertRowId, "lastInsertRowid");
  if (typeof response.truncated !== "boolean") throw new Error("SQL result truncated must be a boolean");
  if (response.routedOperationId !== null && typeof response.routedOperationId !== "string") {
    throw new Error("SQL result routedOperationId must be a string or null");
  }
  responseRows(response, "string");
  return response;
}

function normalizeSourceSqlResponses(responses: readonly SqlExecuteResponse[]): SqlExecuteResponse[] {
  if (!Array.isArray(responses)) throw new Error("SQL result list must be an array");
  return responses.map(normalizeSourceSqlResponse);
}

function normalizeSourceMigrationResult(result: IcpdbMigrationResult): IcpdbMigrationResult {
  if (typeof result !== "object" || result === null) throw new Error("migration result must be an object");
  return {
    applied: normalizeSourceMigrationVersions(result.applied, "migration applied versions"),
    skipped: normalizeSourceMigrationVersions(result.skipped, "migration skipped versions")
  };
}

function normalizeSourceMigrationVersions(versions: readonly string[], label: string): string[] {
  if (!Array.isArray(versions)) throw new Error(`${label} must be an array`);
  return versions.map((version) => requiredNonEmptyString(version, label));
}

function normalizeSourceSqlClientResults(results: readonly IcpdbSqlClientResult[]): IcpdbSqlClientResult[] {
  if (!Array.isArray(results)) throw new Error("SQL client result list must be an array");
  return results.map(normalizeSourceSqlClientResult);
}

function normalizeSourceSqlClientResult(result: IcpdbSqlClientResult): IcpdbSqlClientResult {
  if (typeof result !== "object" || result === null) throw new Error("SQL client result must be an object");
  if (!Array.isArray(result.columns)) throw new Error("SQL client result columns must be an array");
  for (const column of result.columns) {
    if (typeof column !== "string") throw new Error("SQL client result column name must be a string");
  }
  if (!Array.isArray(result.columnTypes)) throw new Error("SQL client result columnTypes must be an array");
  if (result.columnTypes.length !== result.columns.length) throw new Error("SQL client result columnTypes length must match columns length");
  for (const columnType of result.columnTypes) {
    if (typeof columnType !== "string") throw new Error("SQL client result columnType must be a string");
  }
  if (!Array.isArray(result.rows)) throw new Error("SQL client result rows must be an array");
  for (const row of result.rows) rowValues(row, result.columns.length);
  safeNonNegativeInteger(result.rowsAffected, "SQL client result rowsAffected");
  safeNonNegativeInteger(result.affectedRows, "SQL client result affectedRows");
  safeNonNegativeInteger(result.changes, "SQL client result changes");
  optionalBigInt(result.lastInsertRowid, "SQL client result lastInsertRowid");
  optionalBigInt(result.lastInsertRowId, "SQL client result lastInsertRowId");
  if (typeof result.truncated !== "boolean") throw new Error("SQL client result truncated must be a boolean");
  if (result.routedOperationId !== null && typeof result.routedOperationId !== "string") {
    throw new Error("SQL client result routedOperationId must be a string or null");
  }
  if (typeof result.toJSON !== "function") throw new Error("SQL client result toJSON must be a function");
  return result;
}

function normalizeSourcePreparedStatement(prepared: IcpdbPreparedStatement, expectedSql: string): IcpdbPreparedStatement {
  if (typeof prepared !== "object" || prepared === null) throw new Error("prepared statement must be an object");
  const sql = requiredSqlString(prepared.sql, "prepared statement sql");
  if (sql !== expectedSql) throw new Error("prepared statement sql does not match requested SQL");
  if (typeof prepared.bind !== "function") throw new Error("prepared statement bind must be a function");
  if (typeof prepared.execute !== "function") throw new Error("prepared statement execute must be a function");
  if (typeof prepared.query !== "function") throw new Error("prepared statement query must be a function");
  if (typeof prepared.queryRows !== "function") throw new Error("prepared statement queryRows must be a function");
  if (typeof prepared.queryOne !== "function") throw new Error("prepared statement queryOne must be a function");
  if (typeof prepared.all !== "function") throw new Error("prepared statement all must be a function");
  if (typeof prepared.get !== "function") throw new Error("prepared statement get must be a function");
  if (typeof prepared.values !== "function") throw new Error("prepared statement values must be a function");
  if (typeof prepared.first !== "function") throw new Error("prepared statement first must be a function");
  if (typeof prepared.firstValue !== "function") throw new Error("prepared statement firstValue must be a function");
  if (typeof prepared.scalar !== "function") throw new Error("prepared statement scalar must be a function");
  if (typeof prepared.run !== "function") throw new Error("prepared statement run must be a function");
  return {
    sql,
    bind: (args) => normalizeSourcePreparedStatement(prepared.bind(preparedSourceArgs(sql, args)), sql),
    execute: async (args) => normalizeSourceSqlClientResult(await prepared.execute(preparedSourceArgs(sql, args))),
    query: async (args) => normalizeSourceSqlClientResult(await prepared.query(preparedSourceArgs(sql, args))),
    queryRows: async (args) => normalizeSourceRows(await prepared.queryRows(preparedSourceArgs(sql, args))),
    queryOne: async (args) => normalizeSourceOptionalRow(await prepared.queryOne(preparedSourceArgs(sql, args))),
    all: async (args) => normalizeSourceRows(await prepared.all(preparedSourceArgs(sql, args))),
    get: async (args) => normalizeSourceOptionalRow(await prepared.get(preparedSourceArgs(sql, args))),
    values: async (args) => normalizeSourceCellValueRows(await prepared.values(preparedSourceArgs(sql, args))),
    first: async (args) => normalizeSourceOptionalRow(await prepared.first(preparedSourceArgs(sql, args))),
    firstValue: async (args) => normalizeSourceOptionalCellValue(await prepared.firstValue(preparedSourceArgs(sql, args)), "prepared firstValue result"),
    scalar: async (args) => normalizeSourceOptionalCellValue(await prepared.scalar(preparedSourceArgs(sql, args)), "prepared scalar result"),
    run: async (args) => normalizeSourceSqlClientResult(await prepared.run(preparedSourceArgs(sql, args)))
  };
}

function preparedSourceArgs(sql: string, args?: IcpdbSqlArgsInput): IcpdbSqlArgsInput | undefined {
  if (args === undefined) return undefined;
  return validatedSqlClientParams(sql, args);
}

function normalizeSourceRows(rows: readonly IcpdbRow[]): IcpdbRow[] {
  if (!Array.isArray(rows)) throw new Error("SQL row list must be an array");
  return rows.map(normalizeSourceRow);
}

function normalizeSourceOptionalRow(row: IcpdbRow | null): IcpdbRow | null {
  if (row === null) return null;
  return normalizeSourceRow(row);
}

function normalizeSourceRow(row: IcpdbRow): IcpdbRow {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw new Error("SQL row must be an object");
  for (const value of Object.values(row)) normalizeSourceCellValue(value, "SQL row value");
  return row;
}

function normalizeSourceCellValueRows(rows: readonly (readonly IcpdbCellValue[])[]): IcpdbCellValue[][] {
  if (!Array.isArray(rows)) throw new Error("SQL value rows must be an array");
  return rows.map((row) => {
    if (!Array.isArray(row)) throw new Error("SQL value row must be an array");
    return row.map((value) => normalizeSourceCellValue(value, "SQL value row cell"));
  });
}

function normalizeSourceOptionalCellValue(value: IcpdbCellValue | undefined, label: string): IcpdbCellValue | undefined {
  if (value === undefined) return undefined;
  return normalizeSourceCellValue(value, label);
}

function normalizeSourceCellValue(value: IcpdbCellValue, label: string): IcpdbCellValue {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} number must be finite`);
    return value;
  }
  if (value instanceof ArrayBuffer) return value;
  throw new Error(`${label} must be null, string, number, bigint, or ArrayBuffer`);
}

function normalizeSourceDatabaseUsage(usage: DatabaseUsage): DatabaseUsage {
  if (typeof usage !== "object" || usage === null) throw new Error("database usage must be an object");
  return {
    databaseId: requiredNonEmptyString(usage.databaseId, "database usage databaseId"),
    status: normalizeSourceDatabaseStatusKind(usage.status),
    logicalSizeBytes: nonNegativeIntegerText(usage.logicalSizeBytes, "database usage logicalSizeBytes"),
    maxLogicalSizeBytes: nonNegativeIntegerText(usage.maxLogicalSizeBytes, "database usage maxLogicalSizeBytes"),
    usageEventCount: nonNegativeIntegerText(usage.usageEventCount, "database usage usageEventCount")
  };
}

function normalizeSourceDatabaseUsageEvents(events: readonly DatabaseUsageEventSummary[]): DatabaseUsageEventSummary[] {
  if (!Array.isArray(events)) throw new Error("database usage events must be an array");
  return events.map(normalizeSourceDatabaseUsageEvent);
}

function normalizeSourceDatabaseUsageEvent(event: DatabaseUsageEventSummary): DatabaseUsageEventSummary {
  if (typeof event !== "object" || event === null) throw new Error("database usage event must be an object");
  return {
    method: requiredNonEmptyString(event.method, "database usage event method"),
    operation: optionalSourceString(event.operation, "database usage event operation"),
    success: requiredBoolean(event.success, "database usage event success"),
    eventCount: nonNegativeIntegerText(event.eventCount, "database usage event eventCount"),
    totalCyclesDelta: integerText(event.totalCyclesDelta, "database usage event totalCyclesDelta"),
    totalRowsReturned: nonNegativeIntegerText(event.totalRowsReturned, "database usage event totalRowsReturned"),
    totalRowsAffected: nonNegativeIntegerText(event.totalRowsAffected, "database usage event totalRowsAffected"),
    lastCreatedAtMs: nonNegativeIntegerText(event.lastCreatedAtMs, "database usage event lastCreatedAtMs")
  };
}

function normalizeSourceRoutedOperationInfo(operation: RoutedOperationInfo): RoutedOperationInfo {
  if (typeof operation !== "object" || operation === null) throw new Error("routed operation must be an object");
  return {
    operationId: requiredOperationId(operation.operationId),
    databaseId: requiredNonEmptyString(operation.databaseId, "routed operation databaseId"),
    databaseCanisterId: requiredNonEmptyString(operation.databaseCanisterId, "routed operation databaseCanisterId"),
    method: requiredNonEmptyString(operation.method, "routed operation method"),
    requestHash: sourceByteArray(operation.requestHash, "routed operation requestHash"),
    status: normalizeSourceRoutedOperationStatus(operation.status),
    error: optionalSourceString(operation.error, "routed operation error"),
    createdAtMs: nonNegativeIntegerText(operation.createdAtMs, "routed operation createdAtMs"),
    updatedAtMs: nonNegativeIntegerText(operation.updatedAtMs, "routed operation updatedAtMs")
  };
}

function normalizeSourceDatabaseMembers(members: readonly DatabaseMember[]): DatabaseMember[] {
  if (!Array.isArray(members)) throw new Error("database members must be an array");
  return members.map(normalizeSourceDatabaseMember);
}

function normalizeSourceDatabaseMember(member: DatabaseMember): DatabaseMember {
  if (typeof member !== "object" || member === null) throw new Error("database member must be an object");
  return {
    databaseId: requiredNonEmptyString(member.databaseId, "database member databaseId"),
    principal: memberPrincipal(member.principal),
    role: normalizeDatabaseRole(member.role),
    createdAtMs: nonNegativeIntegerText(member.createdAtMs, "database member createdAtMs")
  };
}

function normalizeSourceDatabaseShardPlacementOrNull(placement: DatabaseShardPlacement | null): DatabaseShardPlacement | null {
  if (placement === null) return null;
  return normalizeSourceDatabaseShardPlacement(placement);
}

function normalizeSourceDatabaseShardPlacement(placement: DatabaseShardPlacement): DatabaseShardPlacement {
  if (typeof placement !== "object" || placement === null) throw new Error("database shard placement must be an object");
  return {
    databaseId: requiredNonEmptyString(placement.databaseId, "database shard placement databaseId"),
    shardId: requiredNonEmptyString(placement.shardId, "database shard placement shardId"),
    canisterId: optionalSourceString(placement.canisterId, "database shard placement canisterId"),
    mountId: optionalSafeNonNegativeInteger(placement.mountId, "database shard placement mountId"),
    status: normalizeSourceDatabaseStatusKind(placement.status),
    schemaVersion: requiredNonEmptyString(placement.schemaVersion, "database shard placement schemaVersion"),
    createdAtMs: nonNegativeIntegerText(placement.createdAtMs, "database shard placement createdAtMs"),
    updatedAtMs: nonNegativeIntegerText(placement.updatedAtMs, "database shard placement updatedAtMs")
  };
}

function normalizeSourceDatabaseStatus(status: IcpdbDatabaseStatus): IcpdbDatabaseStatus {
  if (typeof status !== "object" || status === null) throw new Error("database status must be an object");
  return {
    databaseId: requiredNonEmptyString(status.databaseId, "database status databaseId"),
    connectionUrl: requiredNonEmptyString(status.connectionUrl, "database status connectionUrl"),
    ...(status.callerPrincipal === undefined ? {} : { callerPrincipal: memberPrincipal(status.callerPrincipal) }),
    ...(status.callerRole === undefined ? {} : { callerRole: normalizeDatabaseRole(status.callerRole) }),
    placement: normalizeSourceDatabaseShardPlacementOrNull(status.placement),
    usage: normalizeSourceDatabaseUsage(status.usage),
    stats: normalizeSourceDatabaseStats(status.stats),
    tableStatuses: normalizeSourceTableStatuses(status.tableStatuses)
  };
}

function normalizeSourceDatabaseStats(stats: IcpdbDatabaseStats): IcpdbDatabaseStats {
  if (typeof stats !== "object" || stats === null) throw new Error("database stats must be an object");
  return {
    tableCount: safeNonNegativeInteger(stats.tableCount, "database stats tableCount"),
    viewCount: safeNonNegativeInteger(stats.viewCount, "database stats viewCount"),
    rowCount: nonNegativeIntegerText(stats.rowCount, "database stats rowCount"),
    columnCount: safeNonNegativeInteger(stats.columnCount, "database stats columnCount"),
    indexCount: safeNonNegativeInteger(stats.indexCount, "database stats indexCount"),
    triggerCount: safeNonNegativeInteger(stats.triggerCount, "database stats triggerCount"),
    foreignKeyCount: safeNonNegativeInteger(stats.foreignKeyCount, "database stats foreignKeyCount")
  };
}

function normalizeSourceTableStatuses(statuses: readonly IcpdbTableStatus[]): IcpdbTableStatus[] {
  if (!Array.isArray(statuses)) throw new Error("database table statuses must be an array");
  return statuses.map(normalizeSourceTableStatus);
}

function normalizeSourceTableStatus(status: IcpdbTableStatus): IcpdbTableStatus {
  if (typeof status !== "object" || status === null) throw new Error("database table status must be an object");
  if (status.objectType !== "table" && status.objectType !== "view") throw new Error("database table status objectType must be table or view");
  if (!Array.isArray(status.columns)) throw new Error("database table status columns must be an array");
  return {
    tableName: requiredTableName(status.tableName),
    objectType: status.objectType,
    rowCount: nonNegativeIntegerText(status.rowCount, "database table status rowCount"),
    columnCount: safeNonNegativeInteger(status.columnCount, "database table status columnCount"),
    columns: status.columns.map((column) => requiredNonEmptyString(column, "database table status column")),
    indexCount: safeNonNegativeInteger(status.indexCount, "database table status indexCount"),
    triggerCount: safeNonNegativeInteger(status.triggerCount, "database table status triggerCount"),
    foreignKeyCount: safeNonNegativeInteger(status.foreignKeyCount, "database table status foreignKeyCount")
  };
}

function normalizeSourceDatabaseInspection(inspection: IcpdbDatabaseInspection): IcpdbDatabaseInspection {
  if (typeof inspection !== "object" || inspection === null) throw new Error("database inspection must be an object");
  return {
    databaseId: requiredNonEmptyString(inspection.databaseId, "database inspection databaseId"),
    schema: normalizeSourceString(inspection.schema, "database inspection schema"),
    tables: normalizeSourceTableInspections(inspection.tables)
  };
}

function normalizeSourceTableInspections(tables: readonly IcpdbTableInspection[]): IcpdbTableInspection[] {
  if (!Array.isArray(tables)) throw new Error("database inspection tables must be an array");
  return tables.map(normalizeSourceTableInspection);
}

function normalizeSourceTableInspection(inspection: IcpdbTableInspection): IcpdbTableInspection {
  if (typeof inspection !== "object" || inspection === null) throw new Error("table inspection must be an object");
  const table = normalizeSourceDatabaseTable(inspection.table);
  return {
    table,
    description: normalizeSourceTableDescription(inspection.description, table.name),
    preview: normalizeSourceTablePreview(inspection.preview, table.name)
  };
}

function normalizeSourceString(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function normalizeSourceDatabaseStatusKind(status: DatabaseUsage["status"]): DatabaseUsage["status"] {
  if (status === "hot" || status === "restoring" || status === "archiving" || status === "archived" || status === "deleted") return status;
  throw new Error("database status must be hot, restoring, archiving, archived, or deleted");
}

function normalizeSourceRoutedOperationStatus(status: RoutedOperationInfo["status"]): RoutedOperationInfo["status"] {
  if (status === "pending" || status === "applied" || status === "failed" || status === "unknown") return status;
  throw new Error("routed operation status must be pending, applied, failed, or unknown");
}

function optionalSourceString(value: string | null, label: string): string | null {
  if (value === null) return null;
  return requiredNonEmptyString(value, label);
}

function requiredBoolean(value: boolean, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function nonNegativeIntegerText(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a non-negative integer string`);
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a non-negative integer string`);
  return normalized;
}

function integerText(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be an integer string`);
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) throw new Error(`${label} must be an integer string`);
  return normalized;
}

function safeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

function optionalBigInt(value: bigint | undefined, label: string): bigint | undefined {
  if (value === undefined || typeof value === "bigint") return value;
  throw new Error(`${label} must be a bigint or undefined`);
}

function optionalSafeNonNegativeInteger(value: number | null, label: string): number | null {
  if (value === null) return null;
  return safeNonNegativeInteger(value, label);
}

function sourceByteArray(value: readonly number[] | Uint8Array, label: string): number[] {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) throw new Error(`${label} must be a byte array`);
  return [...value].map(byteValue);
}

async function dumpSqlFromDatabase(database: IcpdbSqlClientDatabase, options?: IcpdbSqlDumpOptions): Promise<string> {
  rejectSqlDumpOptionDatabaseId(options);
  const requestedTableName = optionalTableName(options?.tableName);
  const tableNames = requestedTableName ? [requestedTableName] : (await database.listTables()).map((table) => table.name);
  const descriptions = await Promise.all(tableNames.map((tableName) => database.describeTable(tableName)));
  const lines = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const description of descriptions) {
    if (description.schemaSql) lines.push(`${trimSqlSemicolon(description.schemaSql)};`);
  }
  for (const description of sortDescriptionsForInsert(descriptions)) {
    if (description.objectType !== "table") continue;
    let offset = 0;
    const pageSize = sqlDumpPageSize(options?.pageSize);
    while (true) {
      const preview = await database.previewTable(description.tableName, { limit: pageSize, offset });
      for (const row of preview.rows) {
        lines.push(formatDumpInsertStatement(description, preview.columns, row));
      }
      offset += preview.rows.length;
      if (preview.rows.length === 0 || BigInt(offset) >= BigInt(preview.totalCount)) break;
    }
  }
  lines.push(...await sqliteSequenceDumpStatements(database, descriptions.map((description) => description.tableName), sqlDumpPageSize(options?.pageSize)));
  for (const description of descriptions) {
    for (const index of description.indexes) {
      if (index.schemaSql) lines.push(`${trimSqlSemicolon(index.schemaSql)};`);
    }
    for (const trigger of description.triggers) {
      if (trigger.schemaSql) lines.push(`${trimSqlSemicolon(trigger.schemaSql)};`);
    }
  }
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

async function sqliteSequenceDumpStatements(database: IcpdbSqlClientDatabase, tableNames: readonly string[], pageSize: number): Promise<string[]> {
  const sqliteSequence = await database.query({
    sql: "SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2",
    params: ["table", "sqlite_sequence"],
    maxRows: 1
  });
  if (sqliteSequence.rows.length === 0) return [];
  const includedTables = new Set(tableNames);
  const statements: string[] = [];
  let lastName = "";
  while (true) {
    const response = await database.query({
      sql: "SELECT name, seq FROM sqlite_sequence WHERE name > ?1 ORDER BY name",
      params: [lastName],
      maxRows: pageSize
    });
    if (response.rows.length === 0) break;
    for (const row of response.rows) {
      const name = sqlValueText(row[0]);
      lastName = name;
      if (!includedTables.has(name)) continue;
      statements.push(`DELETE FROM sqlite_sequence WHERE name = ${quoteSqlText(name)};`);
      statements.push(`INSERT INTO sqlite_sequence(name, seq) VALUES (${quoteSqlText(name)}, ${sqliteSequenceValue(sqlValueText(row[1]))});`);
    }
    if (response.rows.length < pageSize && !response.truncated) break;
  }
  return statements;
}

function sqlValueText(value: SqlValue | undefined): string {
  if (!value || value.kind === "null") return "";
  if (value.kind === "blob") return JSON.stringify(value.value);
  return String(value.value);
}

function sqliteSequenceValue(value: string): string {
  return /^[+-]?\d+$/.test(value) ? value : quoteSqlText(value);
}

function sortDescriptionsForInsert(descriptions: readonly TableDescription[]): TableDescription[] {
  const byName = new Map(descriptions.map((description) => [description.tableName, description]));
  const sorted: TableDescription[] = [];
  const temporary = new Set<string>();
  const permanent = new Set<string>();
  function visit(description: TableDescription): void {
    if (permanent.has(description.tableName)) return;
    if (temporary.has(description.tableName)) return;
    temporary.add(description.tableName);
    for (const key of description.foreignKeys) {
      const parent = byName.get(key.tableName);
      if (parent) visit(parent);
    }
    temporary.delete(description.tableName);
    permanent.add(description.tableName);
    sorted.push(description);
  }
  for (const description of descriptions) visit(description);
  return sorted;
}

function formatDumpInsertStatement(description: TableDescription, previewColumns: readonly string[], row: readonly SqlValue[]): string {
  const insertableColumns = new Set(description.columns.filter((column) => column.hidden === 0).map((column) => column.name));
  const columns: string[] = [];
  const values: SqlValue[] = [];
  for (let index = 0; index < previewColumns.length; index += 1) {
    const column = previewColumns[index] ?? "";
    if (!insertableColumns.has(column)) continue;
    columns.push(column);
    values.push(row[index] ?? { kind: "null" });
  }
  return formatInsertStatement(description.tableName, columns, values);
}

function formatInsertStatement(tableName: string, columns: readonly string[], row: readonly SqlValue[]): string {
  if (columns.length === 0) return `INSERT INTO ${quoteSqlIdentifier(tableName)} DEFAULT VALUES;`;
  const columnSql = columns.map(quoteSqlIdentifier).join(", ");
  const valueSql = row.map(sqlValueToLiteral).join(", ");
  return `INSERT INTO ${quoteSqlIdentifier(tableName)} (${columnSql}) VALUES (${valueSql});`;
}

function sqlValueToLiteral(value: SqlValue): string {
  if (value.kind === "null") return "NULL";
  if (value.kind === "integer") return value.value;
  if (value.kind === "real") return String(value.value);
  if (value.kind === "blob") return `X'${value.value.map((byte) => byte.toString(16).padStart(2, "0")).join("")}'`;
  return quoteSqlText(value.value);
}

function quoteSqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteSqlIdentifier(identifier: string): string {
  if (!identifier || identifier.includes("\0")) throw new Error("invalid SQL identifier");
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function sqlDumpPageSize(pageSize: number | null | undefined): number {
  if (pageSize === null || pageSize === undefined) return 250;
  return sqlRowLimit(pageSize, "dump pageSize") ?? 250;
}

type IcpdbRuntimeDatabasePreviewOptionsObject = IcpdbDatabasePreviewOptionsObject & {
  databaseId?: string | null;
};

function normalizePreviewOptions(options?: IcpdbRuntimeDatabasePreviewOptionsObject): IcpdbDatabasePreviewOptionsObject | undefined {
  if (options === undefined) return undefined;
  rejectPreviewOptionDatabaseId(options);
  return {
    limit: sqlRowLimit(options.limit ?? null, "preview limit"),
    offset: nonNegativeNat32(options.offset ?? null, "preview offset")
  };
}

function normalizeSourceDatabaseTables(tables: readonly DatabaseTable[]): DatabaseTable[] {
  if (!Array.isArray(tables)) throw new Error("database table list must be an array");
  return tables.map(normalizeSourceDatabaseTable);
}

function normalizeSourceDatabaseTable(table: DatabaseTable): DatabaseTable {
  if (typeof table !== "object" || table === null) throw new Error("database table must be an object");
  if (typeof table.name !== "string" || table.name.trim().length === 0) throw new Error("database table name must be a non-empty string");
  if (table.objectType !== "table" && table.objectType !== "view") throw new Error("database table objectType must be table or view");
  if (table.schemaSql !== null && typeof table.schemaSql !== "string") throw new Error("database table schemaSql must be a string or null");
  return {
    name: table.name.trim(),
    objectType: table.objectType,
    schemaSql: table.schemaSql
  };
}

function normalizeSourceTableDescription(description: TableDescription, expectedTableName: string): TableDescription {
  if (typeof description !== "object" || description === null) throw new Error("table description must be an object");
  if (typeof description.databaseId !== "string" || description.databaseId.trim().length === 0) throw new Error("table description databaseId must be a non-empty string");
  if (typeof description.tableName !== "string" || description.tableName.trim().length === 0) throw new Error("table description tableName must be a non-empty string");
  const tableName = description.tableName.trim();
  if (tableName !== expectedTableName) throw new Error("table description tableName does not match requested table");
  if (description.objectType !== "table" && description.objectType !== "view") throw new Error("table description objectType must be table or view");
  if (description.schemaSql !== null && typeof description.schemaSql !== "string") throw new Error("table description schemaSql must be a string or null");
  return {
    databaseId: description.databaseId.trim(),
    tableName,
    objectType: description.objectType,
    schemaSql: description.schemaSql,
    columns: normalizeSourceDatabaseColumns(description.columns),
    indexes: normalizeSourceDatabaseIndexes(description.indexes, tableName),
    triggers: normalizeSourceDatabaseTriggers(description.triggers, tableName),
    foreignKeys: normalizeSourceDatabaseForeignKeys(description.foreignKeys)
  };
}

function normalizeSourceDatabaseColumns(columns: readonly DatabaseColumn[]): DatabaseColumn[] {
  if (!Array.isArray(columns)) throw new Error("database columns must be an array");
  return columns.map(normalizeSourceDatabaseColumn);
}

function normalizeSourceDatabaseColumn(column: DatabaseColumn): DatabaseColumn {
  if (typeof column !== "object" || column === null) throw new Error("database column must be an object");
  if (!Number.isSafeInteger(column.cid)) throw new Error("database column cid must be a safe integer");
  if (typeof column.name !== "string" || column.name.trim().length === 0) throw new Error("database column name must be a non-empty string");
  if (typeof column.declaredType !== "string") throw new Error("database column declaredType must be a string");
  if (typeof column.notNull !== "boolean") throw new Error("database column notNull must be a boolean");
  if (column.defaultValue !== null && typeof column.defaultValue !== "string") throw new Error("database column defaultValue must be a string or null");
  if (!Number.isSafeInteger(column.primaryKeyPosition) || column.primaryKeyPosition < 0) throw new Error("database column primaryKeyPosition must be a non-negative safe integer");
  if (!Number.isSafeInteger(column.hidden) || column.hidden < 0) throw new Error("database column hidden must be a non-negative safe integer");
  return {
    cid: column.cid,
    name: column.name.trim(),
    declaredType: column.declaredType,
    notNull: column.notNull,
    defaultValue: column.defaultValue,
    primaryKeyPosition: column.primaryKeyPosition,
    hidden: column.hidden
  };
}

function normalizeSourceDatabaseIndexes(indexes: readonly DatabaseIndex[], expectedTableName: string): DatabaseIndex[] {
  if (!Array.isArray(indexes)) throw new Error("database indexes must be an array");
  return indexes.map((index) => normalizeSourceDatabaseIndex(index, expectedTableName));
}

function normalizeSourceDatabaseIndex(index: DatabaseIndex, expectedTableName: string): DatabaseIndex {
  if (typeof index !== "object" || index === null) throw new Error("database index must be an object");
  if (typeof index.name !== "string" || index.name.trim().length === 0) throw new Error("database index name must be a non-empty string");
  if (typeof index.tableName !== "string" || index.tableName.trim() !== expectedTableName) throw new Error("database index tableName does not match requested table");
  if (typeof index.unique !== "boolean") throw new Error("database index unique must be a boolean");
  if (typeof index.origin !== "string") throw new Error("database index origin must be a string");
  if (typeof index.partial !== "boolean") throw new Error("database index partial must be a boolean");
  if (index.schemaSql !== null && typeof index.schemaSql !== "string") throw new Error("database index schemaSql must be a string or null");
  return {
    name: index.name.trim(),
    tableName: index.tableName.trim(),
    unique: index.unique,
    origin: index.origin,
    partial: index.partial,
    columns: normalizeSourceDatabaseIndexColumns(index.columns),
    schemaSql: index.schemaSql
  };
}

function normalizeSourceDatabaseIndexColumns(columns: readonly DatabaseIndexColumn[]): DatabaseIndexColumn[] {
  if (!Array.isArray(columns)) throw new Error("database index columns must be an array");
  return columns.map((column) => {
    if (typeof column !== "object" || column === null) throw new Error("database index column must be an object");
    if (!Number.isSafeInteger(column.seqno) || column.seqno < 0) throw new Error("database index column seqno must be a non-negative safe integer");
    if (typeof column.cid !== "string") throw new Error("database index column cid must be a string");
    if (column.name !== null && typeof column.name !== "string") throw new Error("database index column name must be a string or null");
    if (typeof column.descending !== "boolean") throw new Error("database index column descending must be a boolean");
    if (typeof column.collation !== "string") throw new Error("database index column collation must be a string");
    if (typeof column.key !== "boolean") throw new Error("database index column key must be a boolean");
    return {
      seqno: column.seqno,
      cid: column.cid,
      name: column.name,
      descending: column.descending,
      collation: column.collation,
      key: column.key
    };
  });
}

function normalizeSourceDatabaseTriggers(triggers: readonly DatabaseTrigger[], expectedTableName: string): DatabaseTrigger[] {
  if (!Array.isArray(triggers)) throw new Error("database triggers must be an array");
  return triggers.map((trigger) => {
    if (typeof trigger !== "object" || trigger === null) throw new Error("database trigger must be an object");
    if (typeof trigger.name !== "string" || trigger.name.trim().length === 0) throw new Error("database trigger name must be a non-empty string");
    if (typeof trigger.tableName !== "string" || trigger.tableName.trim() !== expectedTableName) throw new Error("database trigger tableName does not match requested table");
    if (trigger.schemaSql !== null && typeof trigger.schemaSql !== "string") throw new Error("database trigger schemaSql must be a string or null");
    return { name: trigger.name.trim(), tableName: trigger.tableName.trim(), schemaSql: trigger.schemaSql };
  });
}

function normalizeSourceDatabaseForeignKeys(foreignKeys: readonly DatabaseForeignKey[]): DatabaseForeignKey[] {
  if (!Array.isArray(foreignKeys)) throw new Error("database foreign keys must be an array");
  return foreignKeys.map((key) => {
    if (typeof key !== "object" || key === null) throw new Error("database foreign key must be an object");
    if (!Number.isSafeInteger(key.id) || key.id < 0) throw new Error("database foreign key id must be a non-negative safe integer");
    if (!Number.isSafeInteger(key.seq) || key.seq < 0) throw new Error("database foreign key seq must be a non-negative safe integer");
    if (typeof key.tableName !== "string" || key.tableName.trim().length === 0) throw new Error("database foreign key tableName must be a non-empty string");
    if (typeof key.fromColumn !== "string" || key.fromColumn.trim().length === 0) throw new Error("database foreign key fromColumn must be a non-empty string");
    if (key.toColumn !== null && typeof key.toColumn !== "string") throw new Error("database foreign key toColumn must be a string or null");
    if (typeof key.onUpdate !== "string") throw new Error("database foreign key onUpdate must be a string");
    if (typeof key.onDelete !== "string") throw new Error("database foreign key onDelete must be a string");
    if (typeof key.matchClause !== "string") throw new Error("database foreign key matchClause must be a string");
    return {
      id: key.id,
      seq: key.seq,
      tableName: key.tableName.trim(),
      fromColumn: key.fromColumn.trim(),
      toColumn: key.toColumn,
      onUpdate: key.onUpdate,
      onDelete: key.onDelete,
      matchClause: key.matchClause
    };
  });
}

function normalizeSourceTablePreview(preview: TablePreviewResponse, expectedTableName: string): TablePreviewResponse {
  if (typeof preview !== "object" || preview === null) throw new Error("table preview result must be an object");
  if (typeof preview.databaseId !== "string" || preview.databaseId.trim().length === 0) throw new Error("table preview databaseId must be a non-empty string");
  if (typeof preview.tableName !== "string" || preview.tableName.trim().length === 0) throw new Error("table preview tableName must be a non-empty string");
  const tableName = preview.tableName.trim();
  if (tableName !== expectedTableName) throw new Error("table preview tableName does not match requested table");
  if (typeof preview.totalCount !== "string" || !/^\d+$/.test(preview.totalCount)) throw new Error("table preview totalCount must be a non-negative integer string");
  if (typeof preview.truncated !== "boolean") throw new Error("table preview truncated must be a boolean");
  const offset = nonNegativeNat32(preview.offset, "table preview offset");
  const limit = sqlRowLimit(preview.limit, "table preview limit");
  assertSqlResponseShape({
    columns: preview.columns,
    rows: preview.rows,
    rowsAffected: "0",
    lastInsertRowId: "0",
    truncated: preview.truncated,
    routedOperationId: null
  });
  return {
    databaseId: preview.databaseId.trim(),
    tableName,
    columns: preview.columns,
    rows: preview.rows,
    offset: offset ?? 0,
    limit: limit ?? 250,
    totalCount: preview.totalCount,
    truncated: preview.truncated
  };
}

function databaseBoundPreviewOptions(databaseId: string, options?: IcpdbDatabasePreviewOptionsObject): IcpdbPreviewOptions {
  rejectPreviewOptionDatabaseId(options);
  return {
    databaseId,
    limit: options?.limit ?? null,
    offset: options?.offset ?? null
  };
}

function rejectPreviewOptionDatabaseId(options: IcpdbRuntimeDatabasePreviewOptionsObject | undefined): void {
  if (typeof options !== "object" || options === null) return;
  if (!("databaseId" in options) || options.databaseId === undefined || options.databaseId === null) return;
  throw new Error("database preview option databaseId is not supported; choose database at the client or database handle");
}

function sqlRowLimit(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SQL_ROWS) {
    throw new Error(`${label} must be an integer from 1 to ${MAX_SQL_ROWS}`);
  }
  return value;
}

function nonNegativeNat32(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > MAX_NAT32) {
    throw new Error(`${label} must be an integer from 0 to ${MAX_NAT32}`);
  }
  return value;
}

function positiveNat32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_NAT32) {
    throw new Error(`${label} must be an integer from 1 to ${MAX_NAT32}`);
  }
  return value;
}

function nat64TextInput(value: string, label: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  const parsed = BigInt(value.trim());
  if (parsed > MAX_NAT64) throw new Error(`${label} exceeds nat64 range`);
  return parsed;
}

function snapshotHashBytes(value: readonly number[], label: string): number[] {
  const bytes = Array.from(value, byteValue);
  if (bytes.length !== 32) throw new Error(`${label} must be a 32-byte SHA-256 hash`);
  return bytes;
}

function sqlClientResult(response: SqlExecuteResponse, intMode: IcpdbIntMode = "string"): IcpdbSqlClientResult {
  assertSqlResponseShape(response);
  const rowsAffected = safeIntegerText(response.rowsAffected, "rowsAffected");
  const lastInsertRowid = integerTextBigInt(response.lastInsertRowId, "lastInsertRowid");
  const normalizedLastInsertRowid = lastInsertRowid === 0n ? undefined : lastInsertRowid;
  return {
    columns: response.columns,
    columnTypes: responseColumnTypes(response),
    rows: responseRows(response, intMode),
    rowsAffected,
    affectedRows: rowsAffected,
    changes: rowsAffected,
    lastInsertRowid: normalizedLastInsertRowid,
    lastInsertRowId: normalizedLastInsertRowid,
    truncated: response.truncated,
    routedOperationId: response.routedOperationId,
    raw: response,
    toJSON() {
      return {
        columns: this.columns,
        columnTypes: this.columnTypes,
        rows: jsonRows(response, intMode),
        rowsAffected: this.rowsAffected,
        affectedRows: this.affectedRows,
        changes: this.changes,
        lastInsertRowid: this.lastInsertRowid === undefined ? null : this.lastInsertRowid.toString(),
        lastInsertRowId: this.lastInsertRowId === undefined ? null : this.lastInsertRowId.toString(),
        truncated: this.truncated,
        routedOperationId: this.routedOperationId,
        raw: this.raw
      };
    }
  };
}

function safeIntegerText(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer`);
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds JavaScript safe integer range`);
  return Number(parsed);
}

function assertSqlResponseShape(response: SqlExecuteResponse): void {
  if (!Array.isArray(response.columns)) throw new Error("SQL result columns must be an array");
  for (const column of response.columns) {
    if (typeof column !== "string") throw new Error("SQL result column name must be a string");
  }
  if (!Array.isArray(response.rows)) throw new Error("SQL result rows must be an array");
  for (const row of response.rows) {
    if (!Array.isArray(row)) throw new Error("SQL result row must be an array");
    if (row.length !== response.columns.length) {
      throw new Error("SQL result row length must match columns length");
    }
  }
}

function integerTextBigInt(value: string, label: string): bigint {
  if (!/^-?\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  return BigInt(value);
}

function pushSchemaStatement(statements: string[], sql: string | null): void {
  if (!sql) return;
  statements.push(`${sql.trim().replace(/;+$/, "")};`);
}

function statementDatabaseId(statement: string | IcpdbStatementInput, defaultValue: string | undefined): string {
  if (typeof statement === "string") return requiredDatabaseId(undefined, defaultValue);
  return requiredDatabaseId(statement.databaseId, defaultValue);
}

type IcpdbRuntimeDatabaseStatementInput = IcpdbDatabaseStatementInput & {
  databaseId?: string | null;
};

function databaseBoundStatement(statement: string | IcpdbRuntimeDatabaseStatementInput): string | IcpdbDatabaseStatementInput {
  if (typeof statement !== "string" && "databaseId" in statement && statement.databaseId !== undefined && statement.databaseId !== null) {
    throw new Error("database handle statement databaseId is not supported; choose database when creating the handle");
  }
  return statement;
}

function resolveInspectArguments(
  databaseIdOrOptions: string | IcpdbInspectOptions | undefined,
  inspectOptions: IcpdbInspectOptions | undefined,
  defaultValue: string | undefined
): { databaseId: string; options: IcpdbInspectOptions | undefined } {
  if (typeof databaseIdOrOptions === "string" || databaseIdOrOptions === undefined) {
    return {
      databaseId: requiredDatabaseId(databaseIdOrOptions, defaultValue),
      options: inspectOptions
    };
  }
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    options: databaseIdOrOptions
  };
}

function resolveDumpArguments(
  databaseIdOrOptions: string | IcpdbSqlDumpOptions | undefined,
  dumpOptions: IcpdbSqlDumpOptions | undefined,
  defaultValue: string | undefined
): { databaseId: string; options: IcpdbSqlDumpOptions | undefined } {
  if (typeof databaseIdOrOptions === "string" || databaseIdOrOptions === undefined) {
    return {
      databaseId: requiredDatabaseId(databaseIdOrOptions, defaultValue),
      options: normalizedSqlDumpOptions(dumpOptions)
    };
  }
  const resolvedOptions = normalizedSqlDumpOptions(databaseIdOrOptions);
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    options: resolvedOptions
  };
}

function resolveRestoreArguments(
  databaseIdOrOptions: string | IcpdbRestoreOptions | undefined,
  restoreOptions: IcpdbRestoreOptions | undefined,
  defaultValue: string | undefined
): { databaseId: string; options: IcpdbRestoreOptions | undefined } {
  if (typeof databaseIdOrOptions === "string" || databaseIdOrOptions === undefined) {
    return {
      databaseId: requiredDatabaseId(databaseIdOrOptions, defaultValue),
      options: normalizeRestoreOptions(restoreOptions)
    };
  }
  const resolvedOptions = normalizeRestoreOptions(databaseIdOrOptions);
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    options: resolvedOptions
  };
}

function resolveGrantMemberArguments(
  databaseIdOrPrincipal: string,
  principalOrRole: string,
  maybeRole: DatabaseRole | undefined,
  defaultValue: string | undefined
): { databaseId: string; principal: string; role: DatabaseRole } {
  if (maybeRole !== undefined) {
    return {
      databaseId: requiredDatabaseId(databaseIdOrPrincipal, defaultValue),
      principal: principalOrRole,
      role: maybeRole
    };
  }
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    principal: databaseIdOrPrincipal,
    role: normalizeDatabaseRole(principalOrRole)
  };
}

function resolveMemberPrincipalArguments(
  databaseIdOrPrincipal: string,
  maybePrincipal: string | undefined,
  defaultValue: string | undefined
): { databaseId: string; principal: string } {
  if (maybePrincipal !== undefined) {
    return {
      databaseId: requiredDatabaseId(databaseIdOrPrincipal, defaultValue),
      principal: maybePrincipal
    };
  }
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    principal: databaseIdOrPrincipal
  };
}

function resolveRoutedOperationArguments(
  databaseIdOrOperationId: string,
  maybeOperationId: string | undefined,
  defaultValue: string | undefined
): { databaseId: string; operationId: string } {
  if (maybeOperationId !== undefined) {
    return {
      databaseId: requiredDatabaseId(databaseIdOrOperationId, defaultValue),
      operationId: maybeOperationId
    };
  }
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    operationId: databaseIdOrOperationId
  };
}

function resolveWaitForRoutedOperationArguments(
  databaseIdOrOperationId: string,
  operationIdOrOptions: string | IcpdbWaitForRoutedOperationOptions | undefined,
  waitOptions: IcpdbWaitForRoutedOperationOptions | undefined,
  defaultValue: string | undefined
): { databaseId: string; operationId: string; options: IcpdbWaitForRoutedOperationOptions | undefined } {
  if (typeof operationIdOrOptions === "string") {
    return {
      databaseId: requiredDatabaseId(databaseIdOrOperationId, defaultValue),
      operationId: operationIdOrOptions,
      options: normalizedWaitForRoutedOperationOptions(waitOptions)
    };
  }
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    operationId: databaseIdOrOperationId,
    options: normalizedWaitForRoutedOperationOptions(operationIdOrOptions)
  };
}

function resolveDatabaseUnitsArguments(
  databaseIdOrUnits: IcpdbNatInput,
  maybeUnits: IcpdbNatInput | undefined,
  defaultValue: string | undefined
): { databaseId: string; units: IcpdbNatInput } {
  if (maybeUnits !== undefined) {
    if (typeof databaseIdOrUnits !== "string") throw new Error("databaseId must be a non-empty string");
    return {
      databaseId: requiredDatabaseId(databaseIdOrUnits, defaultValue),
      units: maybeUnits
    };
  }
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    units: databaseIdOrUnits
  };
}

function resolveDatabaseCanisterArguments(
  databaseIdOrCanisterId: string,
  maybeCanisterId: string | undefined,
  defaultValue: string | undefined
): { databaseId: string; databaseCanisterId: string } {
  if (maybeCanisterId !== undefined) {
    return {
      databaseId: requiredDatabaseId(databaseIdOrCanisterId, defaultValue),
      databaseCanisterId: requiredDatabaseCanisterId(maybeCanisterId)
    };
  }
  return {
    databaseId: requiredDatabaseId(undefined, defaultValue),
    databaseCanisterId: requiredDatabaseCanisterId(databaseIdOrCanisterId)
  };
}

function sqlRequest(databaseId: string, statement: string | IcpdbStatementInput, params?: IcpdbSqlArgsInput): SqlExecuteRequest {
  if (typeof statement === "string") {
    const sql = requiredSqlString(statement, "SQL statement SQL");
    return {
      databaseId,
      sql,
      params: sqlParams(sql, params ?? []),
      maxRows: null
    };
  }
  const sql = requiredSqlString(statement.sql, "SQL statement SQL");
  const request = {
    databaseId: statement.databaseId ?? databaseId,
    sql,
    params: sqlParams(sql, statementInputParams(statement.args, statement.params, params)),
    maxRows: sqlRowLimit(statement.maxRows ?? null, "maxRows")
  };
  return statement.idempotencyKey === undefined ? request : { ...request, idempotencyKey: optionalIdempotencyKey(statement.idempotencyKey) };
}

function databaseStatementRequest(statement: string | IcpdbDatabaseStatementInput, params?: IcpdbSqlArgsInput): IcpdbDatabaseStatementInput {
  const boundStatement = databaseBoundStatement(statement);
  if (typeof boundStatement === "string") {
    const sql = requiredSqlString(boundStatement, "SQL statement SQL");
    return {
      sql,
      params: validatedSqlClientParams(sql, params ?? []),
      maxRows: null
    };
  }
  const sql = requiredSqlString(boundStatement.sql, "SQL statement SQL");
  const paramsValue = validatedSqlClientParams(sql, statementInputParams(boundStatement.args, boundStatement.params, params));
  if (boundStatement.maxRows === undefined) {
    const request = {
      sql,
      params: paramsValue
    };
    return boundStatement.idempotencyKey === undefined ? request : { ...request, idempotencyKey: optionalIdempotencyKey(boundStatement.idempotencyKey) };
  }
  const request = {
    sql,
    params: paramsValue,
    maxRows: sqlRowLimit(boundStatement.maxRows, "maxRows")
  };
  return boundStatement.idempotencyKey === undefined ? request : { ...request, idempotencyKey: optionalIdempotencyKey(boundStatement.idempotencyKey) };
}

function sqlStatement(statement: IcpdbBatchStatementInput): SqlStatement {
  const normalized = normalizeBatchStatement(statement);
  return {
    sql: normalized.sql,
    params: sqlParams(normalized.sql, statementInputParams(normalized.args, normalized.params))
  };
}

function statementInputParams(
  args: IcpdbSqlArgsInput | undefined,
  params: IcpdbSqlArgsInput | undefined,
  defaultValue: IcpdbSqlArgsInput = []
): IcpdbSqlArgsInput {
  if (args !== undefined && params !== undefined) throw new Error("use either args or params, not both");
  return args ?? params ?? defaultValue;
}

function sqlParams(sql: string, params: IcpdbSqlArgsInput): SqlValue[] {
  return sqlClientParams(sql, params).map(sqlValue);
}

function sqlValue(value: IcpdbSqlValueInput): SqlValue {
  if (hasSqlValueKind(value)) return structuredSqlValue(value);
  if (value === null) return { kind: "null" };
  if (typeof value === "bigint") return { kind: "integer", value: value.toString() };
  if (typeof value === "boolean") return { kind: "integer", value: value ? "1" : "0" };
  if (typeof value === "number") return numberSqlValue(value);
  if (typeof value === "string") return { kind: "text", value };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("invalid Date SQL bind value");
    return { kind: "text", value: value.toISOString() };
  }
  if (value instanceof ArrayBuffer) return { kind: "blob", value: Array.from(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { kind: "blob", value: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return { kind: "blob", value: value.map(byteValue) };
  throw new Error("unsupported SQL bind value");
}

function structuredSqlValue(value: UnknownSqlValue): SqlValue {
  if (value.kind === "null") return { kind: "null" };
  if (value.kind === "integer") {
    if (typeof value.value !== "string") throw new Error("SQL integer bind value must be a string");
    try {
      BigInt(value.value);
    } catch {
      throw new Error("SQL integer bind value must be a base-10 integer string");
    }
    return { kind: "integer", value: value.value };
  }
  if (value.kind === "real") {
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
      throw new Error("SQL real bind value must be a finite number");
    }
    return { kind: "real", value: value.value };
  }
  if (value.kind === "text") {
    if (typeof value.value !== "string") throw new Error("SQL text bind value must be a string");
    return { kind: "text", value: value.value };
  }
  if (value.kind === "blob") {
    if (!Array.isArray(value.value)) throw new Error("SQL blob bind value must be a byte array");
    return { kind: "blob", value: value.value.map(byteValue) };
  }
  throw new Error("SqlValue object kind must be null, integer, real, text, or blob");
}

function numberSqlValue(value: number): SqlValue {
  if (!Number.isFinite(value)) throw new Error("SQL number bind value must be finite");
  if (Number.isInteger(value)) {
    if (!Number.isSafeInteger(value)) {
      throw new Error("integer SQL bind number exceeds JavaScript safe integer range; use bigint or string");
    }
    return { kind: "integer", value: String(value) };
  }
  return { kind: "real", value };
}

function responseRows(response: SqlExecuteResponse, intMode: IcpdbIntMode): IcpdbRow[] {
  return response.rows.map((row) => responseRow(response.columns, row, intMode));
}

function responseValues(response: SqlExecuteResponse, intMode: IcpdbIntMode): IcpdbCellValue[][] {
  return responseRows(response, intMode).map((row) => rowValues(row, response.columns.length));
}

function firstResponseValue(response: SqlExecuteResponse, intMode: IcpdbIntMode): IcpdbCellValue | undefined {
  return responseValues(response, intMode)[0]?.[0];
}

function resultValues(result: Pick<IcpdbSqlClientResult, "columns" | "rows">): IcpdbCellValue[][] {
  return result.rows.map((row) => rowValues(row, result.columns.length));
}

function firstResultValue(result: Pick<IcpdbSqlClientResult, "columns" | "rows">): IcpdbCellValue | undefined {
  return resultValues(result)[0]?.[0];
}

function rowValues(row: IcpdbRow, length: number): IcpdbCellValue[] {
  const values: IcpdbCellValue[] = [];
  for (let index = 0; index < length; index += 1) values.push(row[index]);
  return values;
}

function jsonRows(response: SqlExecuteResponse, intMode: IcpdbIntMode): IcpdbJsonRow[] {
  return response.rows.map((row) => jsonRow(response.columns, row, intMode));
}

function responseColumnTypes(response: SqlExecuteResponse): string[] {
  return response.columns.map((_, columnIndex) => {
    for (const row of response.rows) {
      const value = row[columnIndex];
      if (value && value.kind !== "null") return value.kind;
    }
    return "null";
  });
}

function responseRow(columns: string[], row: SqlValue[], intMode: IcpdbIntMode): IcpdbRow {
  const result: IcpdbRow = Object.create(null);
  for (let index = 0; index < columns.length; index += 1) {
    const value = cellValue(row[index] ?? { kind: "null" }, intMode);
    const numericKey = String(index);
    result[columns[index] ?? `column_${index}`] = value;
    if (!(numericKey in result)) {
      Object.defineProperty(result, numericKey, {
        value,
        enumerable: false,
        configurable: true
      });
    }
  }
  if (!("length" in result)) {
    Object.defineProperty(result, "length", {
      value: columns.length,
      enumerable: false,
      configurable: true
    });
  }
  return result;
}

function jsonRow(columns: string[], row: SqlValue[], intMode: IcpdbIntMode): IcpdbJsonRow {
  const result: IcpdbJsonRow = Object.create(null);
  for (let index = 0; index < columns.length; index += 1) {
    result[columns[index] ?? `column_${index}`] = jsonCellValue(row[index] ?? { kind: "null" }, intMode);
  }
  return result;
}

function cellValue(value: SqlValue, intMode: IcpdbIntMode): IcpdbCellValue {
  if (value.kind === "null") return null;
  if (value.kind === "integer") return integerCellValue(value.value, intMode);
  if (value.kind === "real") return realCellValue(value.value);
  if (value.kind === "text") return textCellValue(value.value);
  if (value.kind === "blob") return arrayBufferCellValue(value.value);
  throw new Error("SQL result value kind must be null, integer, real, text, or blob");
}

function jsonCellValue(value: SqlValue, intMode: IcpdbIntMode): IcpdbJsonCellValue {
  if (value.kind === "null") return null;
  if (value.kind === "integer") {
    const cell = integerCellValue(value.value, intMode);
    return typeof cell === "bigint" ? cell.toString() : cell;
  }
  if (value.kind === "real") return realCellValue(value.value);
  if (value.kind === "text") return textCellValue(value.value);
  if (value.kind === "blob") return Array.from(blobBytes(value.value), byteValue);
  throw new Error("SQL result value kind must be null, integer, real, text, or blob");
}

function integerCellValue(value: unknown, intMode: IcpdbIntMode): string | number | bigint {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
    throw new Error("integer result must be a base-10 integer string");
  }
  if (intMode === "string") return value;
  if (intMode === "bigint") return BigInt(value);
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new Error("integer result exceeds JavaScript safe integer range; use intMode \"bigint\" or \"string\"");
  }
  return numberValue;
}

function realCellValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("real result must be a finite number");
  }
  return value;
}

function textCellValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("text result must be a string");
  return value;
}

function blobBytes(value: unknown): Uint8Array | readonly number[] {
  if (value instanceof Uint8Array) return value;
  if (!Array.isArray(value)) throw new Error("blob result must be a byte array");
  return value;
}

function arrayBufferCellValue(bytes: unknown): ArrayBuffer {
  const values = blobBytes(bytes);
  const byteArray = Array.from(values, byteValue);
  const buffer = new ArrayBuffer(byteArray.length);
  new Uint8Array(buffer).set(byteArray);
  return buffer;
}

function normalizeIntMode(intMode: IcpdbIntMode | undefined): IcpdbIntMode {
  if (intMode === undefined) return "string";
  if (intMode === "number" || intMode === "bigint" || intMode === "string") return intMode;
  throw new Error("intMode must be number, bigint, or string");
}

function transferSize(value: string): number {
  const size = BigInt(value);
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("snapshot is too large for this JavaScript runtime");
  return Number(size);
}

function natInput(value: IcpdbNatInput, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} must be a non-negative integer`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`${label} must be a non-negative integer`);
  return BigInt(trimmed);
}

function transferBytes(bytes: IcpdbRestoreInput): number[] {
  if (bytes instanceof Uint8Array) return Array.from(bytes, byteValue);
  return bytes.map(byteValue);
}

function transferUint8Array(bytes: IcpdbRestoreInput): Uint8Array {
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes);
  return new Uint8Array(bytes.map(byteValue));
}

async function sha256(bytes: Uint8Array): Promise<number[]> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest));
}

function bytesToHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byteValue(byte).toString(16).padStart(2, "0")).join("");
}

function hasSqlValueKind(value: unknown): value is UnknownSqlValue {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  return true;
}

function byteValue(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("blob bytes must be integers from 0 to 255");
  }
  return value;
}

function requiredDatabaseId(explicit: string | undefined, defaultValue: string | undefined): string {
  const databaseId = explicit ?? defaultValue;
  if (!databaseId) throw new Error("databaseId is required");
  return normalizeDatabaseId(databaseId);
}

function optionalDatabaseId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return normalizeDatabaseId(value);
}

function normalizeDatabaseId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("databaseId must be a non-empty string");
  return value.trim();
}
