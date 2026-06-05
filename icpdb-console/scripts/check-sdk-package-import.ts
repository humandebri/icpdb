// icpdb-console/scripts/check-sdk-package-import.ts
// Typecheck-only fixture for ICPDB SDK package subpath imports.

import type { Identity } from "@icp-sdk/core/agent";
import {
  ICPDB_LIBSQL_ERROR_CODES,
  connectClient,
  connectDatabase,
  connectIcpdbDatabase,
  classifyLibsqlErrorMessage,
  createClient,
  createClientFromDatabase,
  createDatabase,
  createIcpdbDatabase,
  createIcpdbClient,
  createLibsqlClient,
  createTursoLikeClient,
  formatIcpdbCanisterUrl,
  formatIcpdbDatabaseUrl,
  isIcpdbLibsqlErrorCode,
  isLibsqlBatchError,
  isLibsqlError,
  parseIcpdbDatabaseUrl,
  snapshotInfo,
  sql,
  type CanisterHealth,
  type Client,
  type Config,
  type CreateDatabaseShardRequest,
  type CreateRemoteDatabaseRequest,
  type DatabaseArchiveInfo,
  type DatabaseBilling,
  type DatabaseColumn,
  type DatabaseForeignKey,
  type DatabaseInfo,
  type DatabaseIndex,
  type DatabaseMember,
  type DatabaseRole,
  type InArgs,
  type InStatement,
  type InValue,
  type IntMode,
  type IcpdbCellValue,
  type IcpdbClient,
  type IcpdbConnectSqlClientOptions,
  type IcpdbCreateDatabaseOptions,
  type IcpdbCreateSetupOptions,
  type IcpdbDatabaseClient,
  type IcpdbDatabaseInspection,
  type IcpdbDatabaseStatus,
  type IcpdbJsonCellValue,
  type IcpdbJsonRow,
  type IcpdbLibsqlErrorCode,
  type IcpdbLibsqlErrorClassification,
  type IcpdbRestoreOptions,
  type IcpdbSnapshotInfo,
  LibsqlBatchError,
  LibsqlError,
  type DatabaseShardInfo,
  type DatabaseShardMaintenanceReport,
  type DatabaseShardPlacement,
  type DatabaseShardStatus,
  type DatabaseSummary,
  type DatabaseTable,
  type DatabaseTrigger,
  type DatabaseUsage,
  type DatabaseUsageEventSummary,
  type RegisterDatabaseShardRequest,
  type RoutedOperationInfo,
  type ShardOperationInfo,
  type ShardOperationReconcileRequest,
  type IcpdbPreparedStatement,
  type IcpdbResultSet,
  type IcpdbRow,
  type IcpdbDatabaseBatchOptionsObject,
  type IcpdbDatabasePreviewOptionsObject,
  type IcpdbDatabaseStatementInput,
  type IcpdbInspectOptions,
  type IcpdbSqlClient,
  type IcpdbSqlClientBatchOptionsObject,
  type IcpdbSqlClientBatchStatementObject,
  type IcpdbSqlClientDatabase,
  type IcpdbSqlClientDatabaseSource,
  type IcpdbSqlClientInfo,
  type IcpdbSqlClientResult,
  type IcpdbSqlClientScriptOptionsObject,
  type IcpdbSqlClientStatement,
  type IcpdbSqlDumpOptions,
  type IcpdbSqlTemplateStatement,
  type IcpdbWaitForRoutedOperationOptions,
  type IcpdbWriteWaitOption,
  type ResultSet,
  type Row,
  type SqlExecuteResponse,
  type SqlStatement,
  type SqlValue,
  type TableDescription,
  type TablePreviewResponse,
  type TransactionMode,
  type Value
} from "icpdb-console";
import {
  archiveDatabaseToFile,
  archiveDatabaseToFileFromEnv,
  archiveDatabaseToFileFromEnvFile,
  archiveIcpdbServiceDatabaseToFile,
  archiveIcpdbServiceDatabaseToFileFromEnv,
  archiveIcpdbServiceDatabaseToFileFromEnvFile,
  connectClientFromEnv,
  connectClientFromEnvFile,
  connectDatabaseFromEnv,
  connectDatabaseFromEnvFile,
  connectIcpdbServiceDatabase,
  connectIcpdbServiceDatabaseFromEnv,
  connectIcpdbServiceDatabaseFromEnvFile,
  createClientFromEnv,
  createClientFromEnvFile,
  createDatabaseFromEnv,
  createDatabaseFromEnvFile,
  checkIcpdbServiceEnvFileMode,
  createIcpdbPersistedServiceSqlClientFromEnvFile,
  createIcpdbServiceClient,
  createIcpdbServiceDatabase,
  createIcpdbServiceDatabaseFromEnv,
  createIcpdbServiceDatabaseFromEnvFile,
  createIcpdbServiceSqlClient,
  createIcpdbServiceSqlClientFromEnv,
  createIcpdbServiceSqlClientFromEnvFile,
  createIcpdbServiceClientFromEnv,
  createIcpdbServiceClientFromEnvFile,
  formatIcpdbServiceEnv,
  generateIcpdbServiceIdentity,
  grantIcpdbServiceIdentityFromEnv,
  grantIcpdbServiceIdentityFromEnvFile,
  inspectIcpdbServiceEnv,
  inspectIcpdbServiceEnvFile,
  loadIcpdbServiceEnvFile,
  loadIcpdbServicePrincipalFromEnv,
  loadIcpdbServicePrincipalFromEnvFile,
  loadIcpdbServiceSetupFromEnv,
  loadIcpdbServiceSetupFromEnvFile,
  persistIcpdbServiceDatabaseId,
  provisionIcpdbServiceDatabaseEnvFile,
  provisionIcpdbServiceEnvFile,
  provisionIcpdbServiceIdentity,
  restoreDatabaseFromFile,
  restoreDatabaseFromFileFromEnv,
  restoreDatabaseFromFileFromEnvFile,
  restoreIcpdbServiceDatabaseFromFile,
  restoreIcpdbServiceDatabaseFromFileFromEnv,
  restoreIcpdbServiceDatabaseFromFileFromEnvFile,
  snapshotInfoFile,
  snapshotInfoIcpdbServiceFile,
  writeGeneratedIcpdbServiceEnvFile,
  writeIcpdbServiceEnvFile,
  type IcpdbServiceArchiveFileResult,
  type IcpdbServiceCreateDatabaseOptions,
  type IcpdbGeneratedServiceIdentityTargetOptions,
  type IcpdbServiceEnvFileOptions,
  type IcpdbServiceEnvFileMode,
  type IcpdbServiceEnvSourceOptions,
  type IcpdbServiceEnvInspection,
  type IcpdbServiceRestoreFileFromEnvOptions,
  type IcpdbServiceRestoreFileFromEnvSourceOptions,
  type IcpdbServiceSqlClientOptions,
  type IcpdbServiceSnapshotFileInfo
} from "icpdb-console/service-identity";

type WebClient = import("icpdb-console/web").Client;
type BrowserClient = import("icpdb-console/browser").Client;
type NodeClient = import("icpdb-console/node").Client;
type LibsqlClient = import("icpdb-console/libsql").Client;
type LibsqlConfig = import("icpdb-console/libsql").Config;
type LibsqlResultSet = import("icpdb-console/libsql").ResultSet;
type ConnectLibsqlClientOptions = import("icpdb-console/libsql").ConnectLibsqlClientOptions;
type ConnectLibsqlDatabaseOptions = import("icpdb-console/libsql").ConnectLibsqlDatabaseOptions;
type CreateLibsqlDatabaseOptions = import("icpdb-console/libsql").CreateLibsqlDatabaseOptions;
type LibsqlDatabaseClient = import("icpdb-console/libsql").LibsqlDatabaseClient;
type NamedLibsqlClient = import("icpdb-console/libsql").LibsqlClient;
type NamedLibsqlConfig = import("icpdb-console/libsql").LibsqlConfig;
type NamedLibsqlParsedUrl = ReturnType<typeof import("icpdb-console/libsql").parseLibsqlDatabaseUrl>;
type NamedLibsqlBatchResult = import("icpdb-console/libsql").LibsqlBatchResult;
type NamedLibsqlBatchStatement = import("icpdb-console/libsql").LibsqlBatchStatement;
type NamedLibsqlResultSet = import("icpdb-console/libsql").LibsqlResultSet;
type NamedLibsqlRow = import("icpdb-console/libsql").LibsqlRow;
type NamedLibsqlSql = import("icpdb-console/libsql").LibsqlSql;
type NamedLibsqlValue = import("icpdb-console/libsql").LibsqlValue;
type SqliteClient = import("icpdb-console/sqlite").SqliteClient;
type SqliteConfig = import("icpdb-console/sqlite").SqliteClientOptions;
type ConnectSqliteConfig = import("icpdb-console/sqlite").ConnectSqliteClientOptions;
type CreateSqliteDatabaseConfig = import("icpdb-console/sqlite").CreateSqliteDatabaseOptions;
type ConnectSqliteDatabaseConfig = import("icpdb-console/sqlite").ConnectSqliteDatabaseOptions;
type SqliteDatabaseClient = import("icpdb-console/sqlite").SqliteDatabaseClient;
type SqliteParsedDatabaseUrl = import("icpdb-console/sqlite").SqliteParsedDatabaseUrl;
type SqliteArgs = import("icpdb-console/sqlite").SqliteArgs;
type SqliteBatchResult = import("icpdb-console/sqlite").SqliteBatchResult;
type SqliteBatchStatement = import("icpdb-console/sqlite").SqliteBatchStatement;
type SqlitePreparedStatement = import("icpdb-console/sqlite").SqlitePreparedStatement;
type SqliteResultSet = import("icpdb-console/sqlite").SqliteResultSet;
type SqliteRow = import("icpdb-console/sqlite").SqliteRow;
type SqliteSql = import("icpdb-console/sqlite").SqliteSql;
type SqliteValue = import("icpdb-console/sqlite").SqliteValue;
type NodeServiceSqlClient = Awaited<ReturnType<typeof import("icpdb-console/node").createClientFromEnvFile>>;
type NodeConnectedServiceSqlClient = Awaited<ReturnType<typeof import("icpdb-console/node").connectClientFromEnvFile>>;
type NodeDirectServiceSqlClient = Awaited<ReturnType<typeof import("icpdb-console/node").createIcpdbServiceSqlClient>>;
type ServerClient = import("icpdb-console/server").Client;
type ServerServiceSqlClient = Awaited<ReturnType<typeof import("icpdb-console/server").createClientFromEnvFile>>;
type ServerConnectedServiceSqlClient = Awaited<ReturnType<typeof import("icpdb-console/server").connectClientFromEnvFile>>;
type ServerDirectServiceSqlClient = Awaited<ReturnType<typeof import("icpdb-console/server").createIcpdbServiceSqlClient>>;

export async function checkIcpdbSdkPackageImports(identity: Identity): Promise<IcpdbRow | null> {
  const db = await connectIcpdbDatabase({
    canisterId: "aaaaa-aa",
    databaseId: "db_alpha",
    identity
  });
  const shortDb: IcpdbDatabaseClient = await createDatabase({
    canisterId: "aaaaa-aa",
    identity
  });
  // @ts-expect-error createDatabase creates a new database; connectDatabase handles existing database ids
  const invalidCreateOptions: IcpdbCreateDatabaseOptions = { canisterId: "aaaaa-aa", databaseId: "db_existing", identity };
  invalidCreateOptions.canisterId?.toString();
  // @ts-expect-error connectDatabase connects existing DBs; pass databaseId, connectionUrl, or a DB URL
  const invalidConnectDatabaseOptions: IcpdbConnectSqlClientOptions = { canisterId: "aaaaa-aa", identity };
  invalidConnectDatabaseOptions.canisterId?.toString();
  // @ts-expect-error databaseId alone is not enough; connectDatabase also needs canisterId, connectionUrl, or a DB URL
  const invalidConnectDatabaseIdOnlyOptions: IcpdbConnectSqlClientOptions = { databaseId: "db_alpha", identity };
  invalidConnectDatabaseIdOnlyOptions.databaseId?.toString();
  const shortConnectedDb: IcpdbDatabaseClient = await connectDatabase({
    canisterId: "aaaaa-aa",
    databaseId: "db_alpha",
    identity
  });
  const directDbInfo: IcpdbSqlClientInfo = shortConnectedDb.info();
  const directLibsqlMigrateResults: IcpdbSqlClientResult[] = await shortDb.migrate([
    "CREATE TABLE direct_libsql_migrated(id INTEGER)",
    { sql: "INSERT INTO direct_libsql_migrated(id) VALUES (:id)", args: { id: 1 } }
  ]);
  const client = createIcpdbClient({
    canisterId: "aaaaa-aa",
    databaseId: "db_alpha",
    identity
  });
  const lowLevelConnectionUrlClient: IcpdbClient = createIcpdbClient({
    connectionUrl: "icpdb://aaaaa-aa/db_alpha",
    identity
  });
  const lowLevelConnectionUrl: string = client.connectionUrl();
  const lowLevelConnectionUrlOption: string = lowLevelConnectionUrlClient.connectionUrl();
  const lowLevelUrl: string = client.url();
  directDbInfo.connectionUrl.toString();
  directDbInfo.canisterId?.toString();
  const packageSnapshotInfo: IcpdbSnapshotInfo = await snapshotInfo(new Uint8Array([1, 2, 3]));
  const typedRole: DatabaseRole = "owner";
  const typedSqlValue: SqlValue = { kind: "text", value: "typed" };
  const typedSqlStatement: SqlStatement = { sql: "SELECT ?1 AS value", params: [typedSqlValue] };
  const typedWriteWait: IcpdbWriteWaitOption = { intervalMs: 0, timeoutMs: 1000, reconcileUnknown: true };
  const localNodeServiceClient: NodeServiceSqlClient = await import("icpdb-console/node").then((node) => node.createClientFromEnvFile("./service.env"));
  const localNodeConnectedServiceClient: NodeConnectedServiceSqlClient = await import("icpdb-console/node").then((node) => node.connectClientFromEnvFile("./service.env"));
  const localServerServiceClient: ServerServiceSqlClient = await import("icpdb-console/server").then((server) => server.createClientFromEnvFile("./service.env"));
  const localServerConnectedServiceClient: ServerConnectedServiceSqlClient = await import("icpdb-console/server").then((server) => server.connectClientFromEnvFile("./service.env"));
  const localNodeDirectServiceClient: NodeDirectServiceSqlClient = await import("icpdb-console/node").then((node) => node.createIcpdbServiceSqlClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identityJson: "[]" }));
  const localServerDirectServiceClient: ServerDirectServiceSqlClient = await import("icpdb-console/server").then((server) => server.createIcpdbServiceSqlClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identityJson: "[]" }));
  const sdkSqlError = new LibsqlError("UNIQUE constraint failed", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT");
  const sdkBatchError = new LibsqlBatchError("read batch mode only accepts read SQL", 1, "SQLITE_READONLY");
  const sdkSqlErrorCode: IcpdbLibsqlErrorCode = sdkSqlError.code;
  const sdkBatchStatementIndex: number = sdkBatchError.statementIndex;
  const sdkSqlErrorClassification: IcpdbLibsqlErrorClassification = classifyLibsqlErrorMessage("UNIQUE constraint failed");
  const libsqlConfig: LibsqlConfig = {
    connectionUrl: "icpdb://aaaaa-aa/db_alpha",
    identity
  };
  const namedLibsqlConfig: NamedLibsqlConfig = libsqlConfig;
  const connectLibsqlConfig: ConnectLibsqlClientOptions = {
    connectionUrl: "icpdb://aaaaa-aa/db_alpha",
    identity
  };
  // @ts-expect-error connectLibsqlDatabase connects existing DBs; pass databaseId, connectionUrl, or a DB URL
  const invalidConnectLibsqlDatabaseConfig: ConnectLibsqlDatabaseOptions = { canisterId: "aaaaa-aa", identity };
  invalidConnectLibsqlDatabaseConfig.canisterId?.toString();
  // @ts-expect-error databaseId alone is not enough; libSQL-shaped connect also needs canisterId, connectionUrl, or a DB URL
  const invalidConnectLibsqlDatabaseIdOnlyConfig: ConnectLibsqlDatabaseOptions = { databaseId: "db_alpha", identity };
  invalidConnectLibsqlDatabaseIdOnlyConfig.databaseId?.toString();
  const connectLibsqlDatabaseConfig: ConnectLibsqlDatabaseOptions = connectLibsqlConfig;
  const createLibsqlDatabaseConfig: CreateLibsqlDatabaseOptions = { canisterId: "aaaaa-aa", identity };
  const libsqlClient: LibsqlClient = await import("icpdb-console/libsql").then((libsql) => libsql.createClient(libsqlConfig));
  const namedLibsqlClient: NamedLibsqlClient = await import("icpdb-console/libsql").then((libsql) => libsql.connectLibsqlClient(connectLibsqlConfig));
  const connectedLibsqlDatabase: LibsqlDatabaseClient = await import("icpdb-console/libsql").then((libsql) => libsql.connectLibsqlDatabase(connectLibsqlDatabaseConfig));
  const createdLibsqlDatabase: LibsqlDatabaseClient = await import("icpdb-console/libsql").then((libsql) => libsql.createLibsqlDatabase(createLibsqlDatabaseConfig));
  const namedLibsqlParsedUrl: NamedLibsqlParsedUrl = await import("icpdb-console/libsql").then((libsql) => libsql.parseLibsqlDatabaseUrl("icpdb://aaaaa-aa/db_alpha"));
  const namedLibsqlDatabaseUrl: string = await import("icpdb-console/libsql").then((libsql) => libsql.formatLibsqlDatabaseUrl("aaaaa-aa", "db_alpha"));
  const libsqlResult: LibsqlResultSet = await libsqlClient.execute({ sql: "INSERT INTO typed_wait(value) VALUES (?1)", args: ["typed-libsql-subpath"], wait: typedWriteWait });
  const namedLibsqlResult: NamedLibsqlResultSet = await namedLibsqlClient.execute({ sql: "SELECT ?1 AS value", args: ["typed-named-libsql-subpath"] });
  const namedLibsqlBatchStatement: NamedLibsqlBatchStatement = { sql: "SELECT ?1 AS value", args: ["typed-libsql-batch"] };
  const namedLibsqlBatchResult: NamedLibsqlBatchResult = await namedLibsqlClient.batch([namedLibsqlBatchStatement], "read");
  const namedLibsqlSqlTag: NamedLibsqlSql = await import("icpdb-console/libsql").then((libsql) => libsql.sql);
  await connectedLibsqlDatabase.query("SELECT 1 AS value");
  await createdLibsqlDatabase.query("SELECT 1 AS value");
  const namedLibsqlRow: NamedLibsqlRow | undefined = namedLibsqlResult.rows[0];
  const namedLibsqlValue: NamedLibsqlValue | undefined = namedLibsqlRow?.[0];
  const sdkSqlClassifiedCode: IcpdbLibsqlErrorCode = sdkSqlErrorClassification.code;
  const sdkSqlKnownCode: IcpdbLibsqlErrorCode | undefined = ICPDB_LIBSQL_ERROR_CODES[0];
  const sdkSqlErrorIsLibsql: boolean = isLibsqlError(sdkSqlError);
  const sdkBatchErrorIsLibsqlBatch: boolean = isLibsqlBatchError(sdkBatchError);
  const sdkSqlCodeIsKnown: boolean = isIcpdbLibsqlErrorCode(sdkSqlError.code);
  namedLibsqlConfig.connectionUrl?.toString();
  await localNodeDirectServiceClient.connectionUrl();
  await localServerDirectServiceClient.connectionUrl();
  await namedLibsqlClient.execute(namedLibsqlSqlTag`SELECT ${"typed-libsql-template"} AS value`);
  namedLibsqlClient.close();
  localNodeDirectServiceClient.close();
  localServerDirectServiceClient.close();
  namedLibsqlParsedUrl.databaseId?.toString();
  namedLibsqlDatabaseUrl.toString();
  namedLibsqlBatchResult.length.toString();
  namedLibsqlValue?.valueOf();
  typedRole.toString();
  typedSqlStatement.sql.toString();
  await localNodeServiceClient.query("SELECT 1 AS value");
  await localServerServiceClient.scalar("SELECT count(*) FROM notes");
  localNodeServiceClient.close();
  localServerServiceClient.close();
  sdkSqlErrorCode.toString();
  sdkBatchStatementIndex.toString();
  sdkSqlErrorClassification.code.toString();
  sdkSqlClassifiedCode.toString();
  sdkSqlKnownCode?.toString();
  sdkSqlErrorIsLibsql.toString();
  sdkBatchErrorIsLibsqlBatch.toString();
  sdkSqlCodeIsKnown.toString();
  packageSnapshotInfo.sha256.toUpperCase();
  packageSnapshotInfo.snapshotHash.join(",");
  directLibsqlMigrateResults[0]?.columns.join(",");
  const lowLevelSnapshotInfo: IcpdbSnapshotInfo = await client.snapshotInfo(new Uint8Array([1, 2, 3]));
  lowLevelSnapshotInfo.sha256.toUpperCase();
  lowLevelConnectionUrlOption.toString();
  const connectedDb: IcpdbDatabaseClient = await client.connectDatabase();
  const connectedDbConnectionUrl: string = connectedDb.connectionUrl();
  const connectedDbUrl: string = connectedDb.url();
  const connectedDbSnapshotInfo: IcpdbSnapshotInfo = await connectedDb.snapshotInfo(new Uint8Array([1, 2, 3]));
  connectedDbSnapshotInfo.snapshotHash.join(",");
  const lowLevelRows: IcpdbRow[] = await client.all("SELECT ?1 AS value", [1]);
  const lowLevelValues: IcpdbCellValue[][] = await client.values("SELECT ?1 AS value", [1]);
  const lowLevelCreateSetup: IcpdbCreateSetupOptions = {
    setupSql: "CREATE TABLE low_level_created(id INTEGER PRIMARY KEY, body TEXT)",
    setupStatements: [
      { sql: "INSERT INTO low_level_created(body) VALUES (:body)", args: { body: "from-low-level-create" } }
    ]
  };
  // @ts-expect-error low-level create setup always creates a new database
  const invalidLowLevelCreateSetup: IcpdbCreateSetupOptions = { databaseId: "db_existing" };
  invalidLowLevelCreateSetup.setupSql?.toString();
  const lowLevelCreatedDb: IcpdbDatabaseClient = await client.createDatabase(lowLevelCreateSetup);
  await lowLevelCreatedDb.queryRows("SELECT body FROM low_level_created ORDER BY id DESC");
  const lowLevelRow: IcpdbRow | null = await client.get("SELECT ?1 AS value", [1]);
  const lowLevelFirst: IcpdbRow | null = await client.first("SELECT ?1 AS value", [1]);
  const lowLevelFirstValue: IcpdbCellValue | undefined = await client.firstValue("SELECT ?1 AS value", [1]);
  const lowLevelScalar: IcpdbCellValue | undefined = await client.scalar("SELECT ?1 AS value", [1]);
  const lowLevelPrepared: IcpdbPreparedStatement = client.prepare("SELECT ?1 AS value");
  const lowLevelTaggedPrepared: IcpdbPreparedStatement = client.prepare(sql`SELECT ${1} AS value`);
  const lowLevelPreparedRow: IcpdbRow | null = await lowLevelPrepared.get([1]);
  await lowLevelTaggedPrepared.get();
  await client.prepare("SELECT ?1 AS value", [1], "db_alpha").get();
  await client.prepare(sql`SELECT ${1} AS value`, undefined, "db_alpha").get();
  const lowLevelHealth: CanisterHealth = await client.health();
  const lowLevelStatus: IcpdbDatabaseStatus = await client.status();
  lowLevelStatus.callerRole?.toString();
  const lowLevelInspection: IcpdbDatabaseInspection = await client.inspect();
  const lowLevelTableInspection: IcpdbDatabaseInspection = await client.inspect({ tableName: "notes", previewLimit: 1 });
  const lowLevelSummary: DatabaseSummary | undefined = (await client.listDatabases())[0];
  const lowLevelArchiveInfo: DatabaseArchiveInfo = await client.beginArchive();
  const lowLevelUsage: DatabaseUsage = await client.getUsage();
  const lowLevelUsageEvent: DatabaseUsageEventSummary | undefined = (await client.listUsageEvents())[0];
  const lowLevelMember: DatabaseMember | undefined = (await client.listMembers("db_alpha"))[0];
  await client.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "writer");
  const lowLevelDefaultMember: DatabaseMember | undefined = (await client.listMembers())[0];
  await client.revokeMember("rrkah-fqaaa-aaaaa-aaaaq-cai");
  const lowLevelTable: DatabaseTable | undefined = (await client.listTables())[0];
  const lowLevelShortTable: DatabaseTable | undefined = (await client.tables())[0];
  const lowLevelView: DatabaseTable | undefined = (await client.views())[0];
  const lowLevelDescription: TableDescription = await client.describeTable("notes");
  const lowLevelShortDescription: TableDescription = await client.describe("notes");
  const lowLevelColumn: DatabaseColumn | undefined = (await client.listColumns("notes"))[0];
  const lowLevelShortColumn: DatabaseColumn | undefined = (await client.columns("notes"))[0];
  const lowLevelIndex: DatabaseIndex | undefined = (await client.listIndexes("notes"))[0];
  const lowLevelShortIndex: DatabaseIndex | undefined = (await client.indexes("notes"))[0];
  const lowLevelTrigger: DatabaseTrigger | undefined = (await client.listTriggers("notes"))[0];
  const lowLevelShortTrigger: DatabaseTrigger | undefined = (await client.triggers("notes"))[0];
  const lowLevelForeignKey: DatabaseForeignKey | undefined = (await client.listForeignKeys("notes"))[0];
  const lowLevelShortForeignKey: DatabaseForeignKey | undefined = (await client.foreignKeys("notes"))[0];
  const lowLevelPreview: TablePreviewResponse = await client.previewTable("notes");
  const lowLevelShortPreview: TablePreviewResponse = await client.preview("notes");
  const lowLevelResponse: SqlExecuteResponse = await client.execute("SELECT 1 AS value");
  const lowLevelOperation: RoutedOperationInfo = await client.getRoutedOperation("db_alpha", "op_1");
  const lowLevelShardOperation: ShardOperationInfo | undefined = (await client.listShardOperations())[0];
  const lowLevelShardReconcileRequest: ShardOperationReconcileRequest = { operationId: "op_1", status: "failed", error: "typed check" };
  const lowLevelShardInfo: DatabaseShardInfo[] = await client.listShards();
  const createShardRequest: CreateDatabaseShardRequest = { initialCycles: 1000n, maxDatabases: 8 };
  const createRemoteRequest: CreateRemoteDatabaseRequest = { databaseId: "db_remote", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" };
  const registerShardRequest: RegisterDatabaseShardRequest = { databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai", maxDatabases: 8 };
  await client.createDatabaseShard(createShardRequest);
  const remoteDatabase: DatabaseInfo = await client.createRemoteDatabase(createRemoteRequest);
  await client.registerDatabaseShard(registerShardRequest);
  const lowLevelShardStatus: DatabaseShardStatus = await client.getShardStatus("rrkah-fqaaa-aaaaa-aaaaq-cai");
  const toppedUpShard: DatabaseShardInfo = await client.topUpShard("rrkah-fqaaa-aaaaa-aaaaq-cai", "1000");
  const toppedUpDatabaseBalance: DatabaseBilling = await client.topUpDatabaseBalance("db_alpha", 1000n);
  const toppedUpDefaultDatabaseBalance: DatabaseBilling = await client.topUpDatabaseBalance(1000n);
  const maintainedShards: DatabaseShardMaintenanceReport = await client.maintainShards({
    minAvailableSlots: 1,
    minCyclesBalance: 0n,
    topUpCycles: "0",
    maxNewShards: 1,
    newShardMaxDatabases: 8,
    newShardInitialCycles: 0
  });
  const migratedPlacement: DatabaseShardPlacement = await client.migrateDatabaseToShard("db_alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai");
  const defaultMigratedPlacement: DatabaseShardPlacement = await client.migrateDatabaseToShard("rrkah-fqaaa-aaaaa-aaaaq-cai");
  const defaultPlacement: DatabaseShardPlacement | null = await client.placement();
  await client.listAllPlacements();
  await client.listShardOperations();
  await client.reconcileShardOperation({ operationId: "op_1", status: "applied", error: null });
  await client.getRoutedOperation("db_alpha", "op_1");
  await client.getRoutedOperation("op_1");
  await client.reconcileRoutedOperation("db_alpha", "op_1");
  await client.reconcileRoutedOperation("op_1");
  const waitOptions: IcpdbWaitForRoutedOperationOptions = { intervalMs: 250, timeoutMs: 5000, reconcileUnknown: true };
  // @ts-expect-error routed wait options choose the DB at the client, low-level wait argument, or database handle
  const invalidWaitOptions: IcpdbWaitForRoutedOperationOptions = { databaseId: "db_other" };
  invalidWaitOptions.intervalMs?.toFixed();
  await client.waitForRoutedOperation("db_alpha", "op_1", waitOptions);
  await client.waitForRoutedOperation("op_1", waitOptions);
  await client.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  const taggedStatement: IcpdbSqlTemplateStatement = sql`SELECT ${1} AS value`;
  // @ts-expect-error SQL client statements choose the DB at the client or database handle
  const invalidSqlClientDatabaseStatement: IcpdbSqlClientStatement = { sql: "SELECT 1", databaseId: "db_other" };
  invalidSqlClientDatabaseStatement.sql.toString();
  await client.execute(taggedStatement);
  await client.query(sql`SELECT ${"typed"} AS value`);
  await client.query(sql`SELECT ${new Date("2026-05-29T00:00:00.000Z")} AS created_at`);
  await client.query(sql`SELECT ${new Uint8Array([1, 2, 3])} AS payload`);
  await client.execute({ sql: "INSERT INTO notes(id) VALUES (?1)", args: [5], idempotencyKey: "sdk_retry_insert_1" });
  await client.execute({ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 3 } });
  await client.execute({ sql: "SELECT :enabled AS enabled", args: { enabled: true } });
  await client.execute({ sql: "SELECT :created_at AS created_at", args: { created_at: new Date("2026-05-29T00:00:00.000Z") } });
  await client.execute({ sql: "SELECT :payload AS payload", args: { payload: new ArrayBuffer(2) } });
  await client.execute({ sql: "SELECT :payload AS payload", args: { payload: new DataView(new ArrayBuffer(2)) } });
  await client.execute({ sql: "INSERT INTO notes(id) VALUES (:id)", params: { id: 2 } });
  await client.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 4 } }], { databaseId: "db_alpha" });
  await client.batch([sql`INSERT INTO notes(id) VALUES (${7})`], { databaseId: "db_alpha" });
  await client.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 5 } }], { databaseId: "db_alpha", idempotencyKey: "sdk_retry_batch_1" });
  await client.transaction([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 6 } }], { databaseId: "db_alpha", mode: "write", idempotencyKey: "sdk_retry_transaction_1" });
  await client.transaction([sql`INSERT INTO notes(id) VALUES (${8})`], { databaseId: "db_alpha", mode: "write" });
  await client.transaction([{ sql: "SELECT count(*) AS total FROM notes" }], { databaseId: "db_alpha", mode: "read" });
  await client.get("SELECT id FROM notes WHERE id = :id", { id: 2 });
  await client.database("db_alpha").executeMultiple("CREATE TABLE low_level_multiple(id INTEGER); INSERT INTO low_level_multiple(id) VALUES (1);");
  await client.database("db_alpha").executeMultiple("INSERT INTO low_level_multiple(id) VALUES (2);", { idempotencyKey: "sdk_retry_low_level_multiple_1" });
  await client.executeScript("CREATE TABLE low_level_script(id INTEGER);", { databaseId: "db_alpha", idempotencyKey: "sdk_retry_low_level_script_1" });
  await client.executeScript("SELECT count(*) AS total FROM notes;", { databaseId: "db_alpha", mode: "read", maxRows: 1 });
  await client.loadSqlDump("CREATE TABLE low_level_dump(id INTEGER);", { databaseId: "db_alpha", idempotencyKey: "sdk_retry_low_level_load_1" });
  await client.loadSqlDump("SELECT count(*) AS total FROM notes;", { databaseId: "db_alpha", mode: "read", maxRows: 1 });
  const lowLevelDump: string = await client.dumpSql({ pageSize: 10 });
  const lowLevelSnapshot = await client.archive();
  await client.restore(lowLevelSnapshot, { expectedSha256: (await client.snapshotInfo(lowLevelSnapshot)).sha256 });
  await client.migrate([{ version: "low-level-001", sql: "CREATE TABLE low_level_migrated(id INTEGER);" }]);
  const lowLevelLibsqlMigrateResults: IcpdbSqlClientResult[] = await client.migrate([
    "CREATE TABLE low_level_libsql_migrated(id INTEGER)",
    sql`INSERT INTO low_level_libsql_migrated(id) VALUES (${2})`
  ]);
  const explicitCreatedDb: IcpdbDatabaseClient = await createIcpdbDatabase({
    canisterId: "aaaaa-aa",
    identity,
    setupSql: "CREATE TABLE package_setup(id INTEGER);",
    setupStatements: [{ sql: "SELECT :id, :payload", args: { id: { kind: "integer", value: "9007199254740993" }, payload: { kind: "blob", value: [1, 2, 3] } } }],
    setupMigrations: [{ version: "setup-001", name: "create_package_setup_migrated", sql: "CREATE TABLE package_setup_migrated(id INTEGER);" }]
  });
  await shortDb.queryRows("SELECT 1");
  await shortConnectedDb.queryOne("SELECT 1");
  const rows: IcpdbRow[] = await db.queryRows("SELECT 1");
  const directPrepared: IcpdbPreparedStatement = db.prepare("SELECT ?1 AS value");
  const directTaggedPrepared: IcpdbPreparedStatement = db.prepare(sql`SELECT ${1} AS value`);
  const directObjectPrepared: IcpdbPreparedStatement = db.prepare({ sql: "SELECT :value AS value", params: { value: 1 } });
  const directTuplePrepared: IcpdbPreparedStatement = db.prepare(["SELECT ?1 AS value", [1]]);
  const directPreparedRow: IcpdbRow | null = await directPrepared.get([1]);
  await directTaggedPrepared.get();
  await directObjectPrepared.get();
  await directTuplePrepared.get();
  const sqlClient: IcpdbSqlClient = createClient({
    canisterId: "aaaaa-aa",
    databaseId: "db_alpha",
    identity
  });
  // @ts-expect-error createClient setup creates a new database; existing database setup uses exec, batch, or migrate
  const invalidCreateClientSetupOptions: Config = { canisterId: "aaaaa-aa", databaseId: "db_existing", identity, setupSql: "CREATE TABLE invalid_existing_setup(id INTEGER);" };
  invalidCreateClientSetupOptions.canisterId?.toString();
  // @ts-expect-error connectClient connects existing DBs; setup belongs to createClient.
  const invalidConnectClientSetupOptions: IcpdbConnectSqlClientOptions = { connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity, setupSql: "CREATE TABLE invalid_connect_setup(id INTEGER);" };
  invalidConnectClientSetupOptions.connectionUrl?.toString();
  const libsqlShapedConfig: Config = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const connectLibsqlShapedConfig: ConnectLibsqlClientOptions = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const sqliteSubpathConfig: SqliteConfig = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const sqliteConnectSubpathConfig: ConnectSqliteConfig = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const sqliteDirectCreateConfig: CreateSqliteDatabaseConfig = { canisterId: "aaaaa-aa", identity };
  // @ts-expect-error connectSqliteDatabase connects existing DBs; pass databaseId, connectionUrl, or a DB URL
  const invalidSqliteDirectConnectConfig: ConnectSqliteDatabaseConfig = { canisterId: "aaaaa-aa", identity };
  invalidSqliteDirectConnectConfig.canisterId?.toString();
  // @ts-expect-error databaseId alone is not enough; SQLite connect also needs canisterId, connectionUrl, or a DB URL
  const invalidSqliteDirectConnectIdOnlyConfig: ConnectSqliteDatabaseConfig = { databaseId: "db_alpha", identity };
  invalidSqliteDirectConnectIdOnlyConfig.databaseId?.toString();
  const sqliteDirectConnectConfig: ConnectSqliteDatabaseConfig = { canisterId: "aaaaa-aa", databaseId: "db_alpha", identity };
  const connectionUrlConfig: IcpdbConnectSqlClientOptions = { connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity };
  const connectedSqlClient: IcpdbSqlClient = connectClient(connectionUrlConfig);
  const libsqlShapedClient: Client = createTursoLikeClient(libsqlShapedConfig);
  const libsqlNamedClient: Client = createLibsqlClient(libsqlShapedConfig);
  const libsqlSubpathNamedClient: LibsqlClient = await import("icpdb-console/libsql").then((libsql) => libsql.createLibsqlClient(libsqlShapedConfig));
  const libsqlSubpathConnectedClient: NamedLibsqlClient = await import("icpdb-console/libsql").then((libsql) => libsql.connectLibsqlClient(connectLibsqlShapedConfig));
  const libsqlSubpathParsedUrl: NamedLibsqlParsedUrl = await import("icpdb-console/libsql").then((libsql) => libsql.parseLibsqlDatabaseUrl("icpdb://aaaaa-aa/db_alpha"));
  const sqliteSubpathClient: SqliteClient = await import("icpdb-console/sqlite").then((sqlite) => sqlite.createSqliteClient(sqliteSubpathConfig));
  const connectedSqliteSubpathClient: SqliteClient = await import("icpdb-console/sqlite").then((sqlite) => sqlite.connectSqliteClient(sqliteConnectSubpathConfig));
  const sqliteCreatedDb: SqliteDatabaseClient = await import("icpdb-console/sqlite").then((sqlite) => sqlite.createSqliteDatabase(sqliteDirectCreateConfig));
  const sqliteConnectedDb: SqliteDatabaseClient = await import("icpdb-console/sqlite").then((sqlite) => sqlite.connectSqliteDatabase(sqliteDirectConnectConfig));
  const sqliteParsedUrl: SqliteParsedDatabaseUrl = await import("icpdb-console/sqlite").then((sqlite) => sqlite.parseSqliteDatabaseUrl("icpdb://aaaaa-aa/db_alpha"));
  const sqliteArgs: SqliteArgs = { value: "typed-local-sqlite-args" };
  const sqliteBatchStatement: SqliteBatchStatement = { sql: "SELECT :value AS value", args: sqliteArgs };
  const sqliteSqlTag: SqliteSql = (await import("icpdb-console/sqlite")).sql;
  const connectionUrlClient: IcpdbSqlClient = createClient(connectionUrlConfig);
  const webModule = await import("icpdb-console/web");
  const browserModule = await import("icpdb-console/browser");
  const nodeModule = await import("icpdb-console/node");
  const serverModule = await import("icpdb-console/server");
  const webClient: WebClient = webModule.createClient(libsqlShapedConfig);
  const webTursoLikeClient: WebClient = webModule.createTursoLikeClient(libsqlShapedConfig);
  const browserClient: BrowserClient = browserModule.createClient(libsqlShapedConfig);
  const browserTursoLikeClient: BrowserClient = browserModule.createTursoLikeClient(libsqlShapedConfig);
  const nodeClient: NodeClient = nodeModule.createClient(libsqlShapedConfig);
  const nodeTursoLikeClient: NodeClient = nodeModule.createTursoLikeClient(libsqlShapedConfig);
  const serverClient: ServerClient = serverModule.createClient(libsqlShapedConfig);
  const serverTursoLikeClient: ServerClient = serverModule.createTursoLikeClient(libsqlShapedConfig);
  const serverArchiveInfo: IcpdbServiceArchiveFileResult = await serverModule.archiveDatabaseToFileFromEnvFile("./server-backup.sqlite");
  const serverSnapshotInfo: IcpdbServiceSnapshotFileInfo = await serverModule.snapshotInfoFile("./server-backup.sqlite");
  await serverModule.restoreDatabaseFromFileFromEnvFile("./server-backup.sqlite", { expectedSha256: serverSnapshotInfo.sha256 });
  serverArchiveInfo.sha256.toString();
  const libsqlShapedIntMode: IntMode = "bigint";
  const libsqlShapedBigintClient: Client = createTursoLikeClient({ ...libsqlShapedConfig, intMode: libsqlShapedIntMode });
  const libsqlShapedMode: TransactionMode = "write";
  const libsqlShapedArgs: InArgs = { id: 1 };
  const libsqlShapedInput: InValue = true;
  const libsqlShapedDateInput: InValue = new Date("2026-05-29T00:00:00.000Z");
  const libsqlShapedStatement: InStatement = { sql: "SELECT :id AS id", args: libsqlShapedArgs };
  const libsqlShapedResult: ResultSet = await libsqlShapedClient.execute(libsqlShapedStatement);
  const libsqlNamedResult: ResultSet = await libsqlNamedClient.execute(libsqlShapedStatement);
  const libsqlSubpathNamedResult: LibsqlResultSet = await libsqlSubpathNamedClient.execute({ sql: "SELECT :id AS id", args: libsqlShapedArgs });
  const libsqlSubpathConnectedResult: NamedLibsqlResultSet = await libsqlSubpathConnectedClient.execute({ sql: "SELECT :id AS id", args: libsqlShapedArgs });
  const sqliteSubpathResult: SqliteResultSet = await sqliteSubpathClient.execute((await import("icpdb-console/sqlite")).sql`SELECT ${"typed-sqlite-subpath"} AS value`);
  const sqliteBatchResult: SqliteBatchResult = await sqliteSubpathClient.batch([sqliteBatchStatement], "read");
  const sqliteSubpathRows: SqliteRow[] = sqliteSubpathResult.rows;
  const sqliteSubpathValue: SqliteValue | undefined = sqliteSubpathRows[0]?.value;
  const sqlitePrepared: SqlitePreparedStatement = sqliteSubpathClient.prepare(sqliteSqlTag`SELECT ${"typed-local-sqlite-prepared"} AS value`);
  await connectedSqliteSubpathClient.query("SELECT 1");
  await sqliteCreatedDb.queryRows("SELECT 1");
  await sqliteConnectedDb.queryOne("SELECT 1");
  await sqlitePrepared.get();
  sqliteParsedUrl.databaseId?.toString();
  sqliteBatchResult[0]?.columns[0]?.toString();
  sqliteSubpathValue?.valueOf();
  const libsqlShapedBigintResult: ResultSet = await libsqlShapedBigintClient.execute(libsqlShapedStatement);
  const libsqlShapedRow: Row | undefined = libsqlShapedResult.rows[0];
  const libsqlNamedRow: Row | undefined = libsqlNamedResult.rows[0];
  const libsqlSubpathNamedRow: import("icpdb-console/libsql").Row | undefined = libsqlSubpathNamedResult.rows[0];
  const libsqlSubpathConnectedRow: NamedLibsqlRow | undefined = libsqlSubpathConnectedResult.rows[0];
  const sqliteSubpathRow: import("icpdb-console/sqlite").Row | undefined = sqliteSubpathResult.rows[0];
  const libsqlShapedValue: Value = libsqlShapedRow?.id ?? null;
  const libsqlShapedIndexedValue: Value | undefined = libsqlShapedRow?.[0];
  const libsqlShapedBigintValue: Value = libsqlShapedBigintResult.rows[0]?.id ?? null;
  const libsqlShapedLength: number | undefined = libsqlShapedRow?.length;
  libsqlNamedRow?.id?.toString();
  libsqlSubpathNamedRow?.id?.toString();
  libsqlSubpathConnectedRow?.id?.toString();
  libsqlSubpathParsedUrl.databaseId?.toString();
  libsqlSubpathConnectedClient.close();
  sqliteSubpathRow?.value?.toString();
  const sqlClientClosed: boolean = sqlClient.closed;
  const connectedSqlClientProtocol: string = connectedSqlClient.protocol;
  const sqlClientProtocol: string = sqlClient.protocol;
  sqlClient.reconnect();
  const tursoLikeClient: IcpdbSqlClient = createTursoLikeClient({
    canisterId: "aaaaa-aa",
    databaseId: "db_alpha",
    identity
  });
  const setupSqlClient: IcpdbSqlClient = createClient({
    canisterId: "aaaaa-aa",
    identity,
    setupSql: "CREATE TABLE package_client_setup(id INTEGER);",
    setupStatements: [["INSERT INTO package_client_setup(id) VALUES (?1)", [1]], sql`INSERT INTO package_client_setup(id) VALUES (${2})`],
    setupMigrations: [{ version: "client-setup-001", sql: "CREATE TABLE package_client_setup_migrated(id INTEGER);" }]
  });
  const fakeSqlClient: IcpdbSqlClient = createClientFromDatabase(connectedDb);
  const minimalSqlResponse: SqlExecuteResponse = {
    columns: ["value"],
    rows: [[{ kind: "integer", value: "1" }]],
    rowsAffected: "0",
    lastInsertRowId: "0",
    truncated: false,
    routedOperationId: null
  };
  const minimalSqlClient: IcpdbSqlClient = createClientFromDatabase({
    databaseId: "db_minimal",
    query: async () => minimalSqlResponse,
    execute: async () => minimalSqlResponse
  });
  const batchedSqlClient: IcpdbSqlClient = createClientFromDatabase({
    databaseId: "db_batched",
    query: async () => minimalSqlResponse,
    execute: async () => minimalSqlResponse,
    batch: async () => [minimalSqlResponse]
  });
  const sqlClientHealth: CanisterHealth = await sqlClient.health();
  await sqlClient.sync().catch((error: unknown) => {
    if (error instanceof Error) return error.message;
    return String(error);
  });
  const result = await sqlClient.execute({ sql: "SELECT ?1 AS value", args: [1] });
  const tursoLikeResult: IcpdbResultSet = await tursoLikeClient.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [1] });
  const rowsAffected: number = result.rowsAffected;
  const affectedRows: number = result.affectedRows;
  const changes: number = result.changes;
  const lastInsertRowid: bigint | undefined = result.lastInsertRowid;
  const lastInsertRowId: bigint | undefined = result.lastInsertRowId;
  const jsonLastInsertRowid: string | null = result.toJSON().lastInsertRowid;
  const jsonLastInsertRowId: string | null = result.toJSON().lastInsertRowId;
  const jsonRows: IcpdbJsonRow[] = result.toJSON().rows;
  const typedBlobCell: IcpdbCellValue = new ArrayBuffer(3);
  const jsonBlobCell: IcpdbJsonCellValue = [1, 2, 3];
  const columnTypes: string[] = result.columnTypes;
  const routedOperationId: string | null = result.routedOperationId;
  webClient.close();
  webTursoLikeClient.close();
  browserClient.close();
  browserTursoLikeClient.close();
  sqliteSubpathClient.close();
  nodeClient.close();
  nodeTursoLikeClient.close();
  serverClient.close();
  serverTursoLikeClient.close();
  tursoLikeResult.columns.join(",");
  await sqlClient.execute({ sql: "SELECT :value AS value", args: { value: 1 } });
  await sqlClient.execute({ sql: "SELECT :enabled AS enabled", args: { enabled: true } });
  await sqlClient.execute({ sql: "SELECT :created_at AS created_at", args: { created_at: libsqlShapedDateInput } });
  await sqlClient.execute({ sql: "SELECT :payload AS payload", args: { payload: new ArrayBuffer(2) } });
  await sqlClient.execute({ sql: "SELECT :payload AS payload", args: { payload: new DataView(new ArrayBuffer(2)) } });
  await sqlClient.execute({ sql: "SELECT :value AS value", params: { value: 1 } });
  await setupSqlClient.execute("INSERT INTO package_client_setup(id) VALUES (?1)", [3]);
  const setupSqlClientQuery: IcpdbSqlClientResult = await setupSqlClient.query("SELECT id FROM package_client_setup ORDER BY id DESC");
  await setupSqlClient.execute(sql`INSERT INTO package_client_setup(id) VALUES (${4})`);
  const fastStartResult: IcpdbSqlClientResult = await setupSqlClient.query("SELECT id FROM package_client_setup ORDER BY id DESC");
  const fastStartRows: IcpdbRow[] = fastStartResult.rows;
  const fastStartConnectionUrl: string = await setupSqlClient.connectionUrl();
  const fastStartInfo: IcpdbSqlClientInfo = await setupSqlClient.info();
  const setupSqlClientUrl: string = await setupSqlClient.url();
  setupSqlClientQuery.columns.join(",");
  fastStartRows.length.toString();
  fastStartConnectionUrl.toString();
  fastStartInfo.databaseId.toString();
  setupSqlClientUrl.toString();
  setupSqlClient.close();
  await sqlClient.query("SELECT :value AS value", { value: 1 });
  await sqlClient.query({ sql: "SELECT ?1 AS value", params: [1] });
  const sqlRows: IcpdbRow[] = await sqlClient.queryRows({ sql: "SELECT ?1 AS value", args: [1] });
  const sqlRow: IcpdbRow | null = await sqlClient.queryOne("SELECT ?1 AS value", [1]);
  const allRows: IcpdbRow[] = await sqlClient.all("SELECT ?1 AS value", [1]);
  const getRow: IcpdbRow | null = await sqlClient.get("SELECT ?1 AS value", [1]);
  const valueRows: IcpdbCellValue[][] = await sqlClient.values("SELECT ?1 AS value", [1]);
  const firstRow: IcpdbRow | null = await sqlClient.first("SELECT ?1 AS value", [1]);
  const firstCell: IcpdbCellValue | undefined = await sqlClient.firstValue("SELECT ?1 AS value", [1]);
  const scalarCell: IcpdbCellValue | undefined = await sqlClient.scalar("SELECT ?1 AS value", [1]);
  const tupleGetRow: IcpdbRow | null = await sqlClient.get(["SELECT ?1 AS value", [1]]);
  await sqlClient.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  await sqlClient.execute({ sql: "INSERT INTO notes(id) VALUES (?1)", args: [5], idempotencyKey: "sdk_retry_insert_2" });
  await sqlClient.run(["INSERT INTO notes(id) VALUES (?1)", [1]]);
  const prepared: IcpdbPreparedStatement = sqlClient.prepare("SELECT ?1 AS value");
  const preparedRows: IcpdbRow[] = await prepared.all([1]);
  const boundPreparedRows: IcpdbRow[] = await prepared.bind([1]).all();
  const initiallyBoundPreparedRows: IcpdbRow[] = await sqlClient.prepare("SELECT ?1 AS value", [1]).all();
  const taggedPreparedRows: IcpdbRow[] = await sqlClient.prepare(sql`SELECT ${1} AS value`).all();
  const objectPreparedRows: IcpdbRow[] = await sqlClient.prepare({ sql: "SELECT :value AS value", params: { value: 1 } }).all();
  const tuplePreparedRows: IcpdbRow[] = await sqlClient.prepare(["SELECT ?1 AS value", [1]]).all();
  const preparedValues: IcpdbCellValue[][] = await prepared.values([1]);
  const preparedFirst: IcpdbRow | null = await prepared.first([1]);
  const preparedFirstValue: IcpdbCellValue | undefined = await prepared.firstValue([1]);
  const preparedScalar: IcpdbCellValue | undefined = await prepared.scalar([1]);
  await prepared.query([1]);
  await prepared.execute([1]);
  await prepared.run([1]);
  await prepared.get([1]);
  await sqlClient.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [1] }], "write");
  await sqlClient.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", params: [1] }], "write");
  await sqlClient.batch([sql`INSERT INTO notes(id) VALUES (${2})`], "write");
  await sqlClient.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [5] }], { idempotencyKey: "sdk_retry_batch_2" });
  await sqlClient.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [6] }], { mode: "write", idempotencyKey: "sdk_retry_batch_mode_2" });
  await sqlClient.batch(["SELECT count(*) AS total FROM notes"], { mode: "read", maxRows: 1 });
  // @ts-expect-error SQL client batch options choose the DB at the client or database handle
  const invalidSqlClientBatchOptions: IcpdbSqlClientBatchOptionsObject = { mode: "write", databaseId: "db_other" };
  invalidSqlClientBatchOptions.mode?.toString();
  // @ts-expect-error SQL client script options choose the DB at the client or database handle
  const invalidSqlClientScriptOptions: IcpdbSqlClientScriptOptionsObject = { databaseId: "db_other" };
  invalidSqlClientScriptOptions.maxRows?.toFixed();
  const typedBatchStatement: IcpdbSqlClientBatchStatementObject = { sql: "INSERT INTO notes(id) VALUES (?1)", args: [7] };
  await sqlClient.batch([typedBatchStatement], "write");
  // @ts-expect-error per-statement idempotencyKey belongs on batch options
  const invalidBatchRetryStatement: IcpdbSqlClientBatchStatementObject = { sql: "INSERT INTO notes(id) VALUES (8)", idempotencyKey: "retry" };
  // @ts-expect-error per-statement maxRows belongs on batch options
  const invalidBatchMaxRowsStatement: IcpdbSqlClientBatchStatementObject = { sql: "SELECT 1", maxRows: 1 };
  // @ts-expect-error per-statement databaseId belongs on the client/database or low-level batch options
  const invalidBatchDatabaseStatement: IcpdbSqlClientBatchStatementObject = { sql: "INSERT INTO notes(id) VALUES (9)", databaseId: "db_other" };
  invalidBatchRetryStatement.sql.toString();
  invalidBatchMaxRowsStatement.sql.toString();
  invalidBatchDatabaseStatement.sql.toString();
  await sqlClient.batch([["INSERT INTO notes(id) VALUES (?1)", [2]], ["SELECT count(*) AS total FROM notes"]], "write");
  await libsqlShapedClient.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: libsqlShapedArgs }], libsqlShapedMode);
  const libsqlShapedMigrationResults: ResultSet[] = await libsqlShapedClient.migrate([
    "CREATE TABLE libsql_shaped_migrated(id INTEGER)",
    { sql: "INSERT INTO libsql_shaped_migrated(id) VALUES (:id)", args: libsqlShapedArgs },
    sql`INSERT INTO libsql_shaped_migrated(id) VALUES (${2})`
  ]);
  await sqlClient.transaction([["INSERT INTO notes(id) VALUES (?1)", [3]], ["SELECT count(*) AS total FROM notes"]], { mode: "write", maxRows: 10 });
  await sqlClient.transaction([sql`INSERT INTO notes(id) VALUES (${4})`], "write");
  await sqlClient.transaction([["SELECT count(*) AS total FROM notes"]], "read");
  const createdDatabaseId: string = await sqlClient.databaseId();
  const createdConnectionUrl: string = await sqlClient.connectionUrl();
  const createdUrl: string = await sqlClient.url();
  const optionConnectionUrl: string = await connectionUrlClient.connectionUrl();
  const sqlClientInfo: IcpdbSqlClientInfo = await sqlClient.info();
  sqlClientInfo.canisterId?.toString();
  sqlClientInfo.databaseId.toString();
  const sqlClientDatabase: IcpdbSqlClientDatabase = await sqlClient.database();
  const sqlClientDatabaseSource: IcpdbSqlClientDatabaseSource = sqlClientDatabase;
  // @ts-expect-error database handles choose the DB when the handle is created
  const invalidDatabaseHandleStatement: IcpdbDatabaseStatementInput = { sql: "SELECT 1", databaseId: "db_other" };
  invalidDatabaseHandleStatement.sql.toString();
  // @ts-expect-error database handle batch options choose the DB when the handle is created
  const invalidDatabaseHandleBatchOptions: IcpdbDatabaseBatchOptionsObject = { databaseId: "db_other" };
  invalidDatabaseHandleBatchOptions.maxRows?.toFixed();
  // @ts-expect-error database preview options choose the DB at the client or database handle
  const invalidDatabasePreviewOptions: IcpdbDatabasePreviewOptionsObject = { databaseId: "db_other" };
  invalidDatabasePreviewOptions.limit?.toFixed();
  // @ts-expect-error database inspect options choose the DB at the client, low-level inspect argument, or database handle
  const invalidDatabaseInspectOptions: IcpdbInspectOptions = { databaseId: "db_other" };
  invalidDatabaseInspectOptions.previewLimit?.toFixed();
  // @ts-expect-error database dump options choose the DB at the client, low-level dump argument, or database handle
  const invalidDatabaseDumpOptions: IcpdbSqlDumpOptions = { databaseId: "db_other" };
  invalidDatabaseDumpOptions.pageSize?.toFixed();
  // @ts-expect-error database restore options choose the DB at the client, low-level restore argument, or database handle
  const invalidDatabaseRestoreOptions: IcpdbRestoreOptions = { databaseId: "db_other" };
  invalidDatabaseRestoreOptions.expectedSha256?.toString();
  const sqlClientDatabaseRows: IcpdbRow[] = await sqlClientDatabase.queryRows("SELECT ?1 AS value", [1]);
  const sqlClientDatabaseValues: IcpdbCellValue[][] = await sqlClientDatabase.values("SELECT ?1 AS value", [1]);
  const sqlClientDatabaseFirst: IcpdbRow | null = await sqlClientDatabase.first("SELECT ?1 AS value", [1]);
  const sqlClientDatabaseFirstValue: IcpdbCellValue | undefined = await sqlClientDatabase.firstValue("SELECT ?1 AS value", [1]);
  const sqlClientDatabaseScalar: IcpdbCellValue | undefined = await sqlClientDatabase.scalar("SELECT ?1 AS value", [1]);
  const sqlClientDatabaseRow: IcpdbRow | null = await sqlClientDatabase.get("SELECT ?1 AS value", [1]);
  const sqlClientDatabasePrepared: IcpdbPreparedStatement = sqlClientDatabase.prepare("SELECT ?1 AS value");
  const sqlClientDatabaseTaggedPrepared: IcpdbPreparedStatement = sqlClientDatabase.prepare(sql`SELECT ${1} AS value`);
  const sqlClientDatabaseObjectPrepared: IcpdbPreparedStatement = sqlClientDatabase.prepare({ sql: "SELECT :value AS value", params: { value: 1 } });
  const sqlClientDatabaseTuplePrepared: IcpdbPreparedStatement = sqlClientDatabase.prepare(["SELECT ?1 AS value", [1]]);
  const sqlClientDatabaseView: DatabaseTable | undefined = (await sqlClientDatabase.views())[0];
  const formattedCreateUrl: string = formatIcpdbCanisterUrl("aaaaa-aa");
  const setupConnectionUrlClient: IcpdbSqlClient = createClient({ connectionUrl: formattedCreateUrl, identity, setupSql: "CREATE TABLE package_connection_url_setup(id INTEGER);" });
  const formattedConnectionUrl: string = formatIcpdbDatabaseUrl("aaaaa-aa", createdDatabaseId);
  parseIcpdbDatabaseUrl(formattedCreateUrl).canisterId.toString();
  parseIcpdbDatabaseUrl(createdConnectionUrl).databaseId?.toString();
  parseIcpdbDatabaseUrl(createdUrl).databaseId?.toString();
  parseIcpdbDatabaseUrl(lowLevelUrl).databaseId?.toString();
  parseIcpdbDatabaseUrl(connectedDbUrl).databaseId?.toString();
  optionConnectionUrl.toString();
  (await setupConnectionUrlClient.databaseId()).toString();
  await sqlClient.exec("CREATE TABLE package_exec(id INTEGER); INSERT INTO package_exec(id) VALUES (1);");
  await sqlClient.exec("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await sqlClient.executeMultiple("CREATE TABLE package_multiple(id INTEGER); INSERT INTO package_multiple(id) VALUES (1);");
  await sqlClient.executeMultiple("INSERT INTO package_multiple(id) VALUES (2);", { idempotencyKey: "sdk_retry_multiple_1" });
  await sqlClient.migrate([{ version: "001", name: "package_migration", sql: "CREATE TABLE package_migrated(id INTEGER);" }]);
  await sqlClient.executeScript("CREATE TABLE package_script(id INTEGER); INSERT INTO package_script(id) VALUES (1);");
  await sqlClient.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await sqlClient.dumpSql();
  await sqlClient.loadSqlDump("CREATE TABLE package_dump(id INTEGER);");
  await sqlClient.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  connectionUrlClient.close();
  connectedSqlClient.close();
  setupConnectionUrlClient.close();
  sqlClient.close();
  const sqlSnapshot: Uint8Array = await sqlClient.archive();
  await sqlClient.restore(sqlSnapshot, { expectedSha256: (await sqlClient.snapshotInfo(sqlSnapshot)).sha256 });
  await sqlClient.listTables();
  await sqlClient.tables();
  await sqlClient.views();
  await sqlClientDatabase.tables();
  await sqlClientDatabase.describe("notes");
  await sqlClientDatabase.preview("notes");
  await sqlClientDatabase.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  await sqlClientDatabase.transaction(["SELECT count(*) AS total FROM notes"], "read");
  await sqlClientDatabase.exec("CREATE TABLE db_handle_exec(id INTEGER);");
  await sqlClientDatabase.executeMultiple("CREATE TABLE db_handle_multiple(id INTEGER);");
  await sqlClientDatabase.executeMultiple("INSERT INTO db_handle_multiple(id) VALUES (2);", { idempotencyKey: "sdk_retry_db_handle_multiple_1" });
  await sqlClientDatabase.executeScript("CREATE TABLE db_handle_script(id INTEGER);");
  await sqlClientDatabase.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await sqlClientDatabase.migrate([{ version: "db-handle-001", sql: "CREATE TABLE db_handle_migrated(id INTEGER);" }]);
  await sqlClientDatabase.dumpSql();
  await sqlClientDatabase.loadSqlDump("CREATE TABLE db_handle_dump(id INTEGER);");
  await sqlClientDatabase.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await sqlClientDatabase.inspect({ tableName: "notes" });
  await sqlClientDatabase.snapshotInfo(new Uint8Array([1, 2, 3]));
  await sqlClientDatabase.waitForRoutedOperation("op_1", waitOptions);
  sqlClientDatabase.connectionUrl().toString();
  sqlClientDatabase.url().toString();
  await sqlClientDatabase.getUsage();
  await sqlClientDatabase.status();
  await sqlClientDatabase.listUsageEvents();
  await sqlClientDatabase.getRoutedOperation("op_1");
  await sqlClientDatabase.reconcileRoutedOperation("op_1");
  await sqlClientDatabase.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "writer");
  await sqlClientDatabase.listMembers();
  await sqlClientDatabase.revokeMember("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await sqlClientDatabase.placement();
  const sqlClientDatabaseSnapshot = await sqlClientDatabase.archive();
  await sqlClientDatabase.restore(sqlClientDatabaseSnapshot, { expectedSha256: (await sqlClientDatabase.snapshotInfo(sqlClientDatabaseSnapshot)).sha256 });
  await sqlClientDatabase.delete();
  sqlClientDatabase.close();
  sqlClientDatabaseView?.name.toString();
  sqlClientDatabaseSource.databaseId.toString();
  sqlClientDatabaseRows[0]?.valueOf();
  sqlClientDatabaseRow?.valueOf();
  await sqlClientDatabasePrepared.get([1]);
  await sqlClientDatabaseTaggedPrepared.get();
  await sqlClientDatabaseObjectPrepared.get();
  await sqlClientDatabaseTuplePrepared.get();
  await sqlClient.describeTable("notes");
  await sqlClient.describe("notes");
  await sqlClient.listColumns("notes");
  await sqlClient.columns("notes");
  await sqlClient.listIndexes("notes");
  await sqlClient.indexes("notes");
  await sqlClient.listTriggers("notes");
  await sqlClient.triggers("notes");
  await sqlClient.listForeignKeys("notes");
  await sqlClient.foreignKeys("notes");
  await sqlClient.previewTable("notes", { limit: 10 });
  await sqlClient.preview("notes", { limit: 10 });
  const sqlInspection: IcpdbDatabaseInspection = await sqlClient.inspect({ tableName: "notes", previewLimit: 10 });
  await sqlClient.getUsage();
  const sqlStatus: IcpdbDatabaseStatus = await sqlClient.status();
  sqlStatus.callerRole?.toString();
  await sqlClient.listUsageEvents();
  await sqlClient.getRoutedOperation("op_1");
  await sqlClient.reconcileRoutedOperation("op_1");
  await sqlClient.waitForRoutedOperation("op_1", waitOptions);
  await sqlClient.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "writer");
  await sqlClient.listMembers();
  await sqlClient.revokeMember("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await sqlClient.placement();
  await minimalSqlClient.query("SELECT 1");
  await minimalSqlClient.values("SELECT 1");
  await minimalSqlClient.run("INSERT INTO notes(id) VALUES (1)");
  await minimalSqlClient.prepare("SELECT 1").get();
  await minimalSqlClient.prepare("INSERT INTO notes(id) VALUES (1)").run();
  await minimalSqlClient.batch(["SELECT count(*) AS total FROM notes"], { mode: "read", maxRows: 1 });
  await minimalSqlClient.transaction(["SELECT count(*) AS total FROM notes"], { mode: "read", maxRows: 1 });
  await minimalSqlClient.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await minimalSqlClient.exec("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await minimalSqlClient.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await batchedSqlClient.batch(["INSERT INTO notes(id) VALUES (1)"], "write");
  await batchedSqlClient.transaction(["INSERT INTO notes(id) VALUES (1)"], "write");
  await batchedSqlClient.executeScript("INSERT INTO notes(id) VALUES (1);");
  await batchedSqlClient.exec("INSERT INTO notes(id) VALUES (1);");
  await fakeSqlClient.query("SELECT 1");
  await fakeSqlClient.databaseId();
  await fakeSqlClient.exec("CREATE TABLE fake_exec(id INTEGER);");
  await fakeSqlClient.migrate([{ version: 1, sql: "CREATE TABLE fake_migrated(id INTEGER);" }]);
  await fakeSqlClient.executeMultiple("CREATE TABLE fake_multiple(id INTEGER);");
  await fakeSqlClient.executeMultiple("INSERT INTO fake_multiple(id) VALUES (2);", { idempotencyKey: "sdk_retry_fake_multiple_1" });
  await fakeSqlClient.executeScript("CREATE TABLE fake_script(id INTEGER);");
  await fakeSqlClient.dumpSql({ pageSize: 10 });
  await fakeSqlClient.loadSqlDump("CREATE TABLE fake_dump(id INTEGER);");
  await fakeSqlClient.inspect({ previewLimit: 5 });
  await fakeSqlClient.getUsage();
  await fakeSqlClient.status();
  await fakeSqlClient.listUsageEvents();
  await fakeSqlClient.getRoutedOperation("op_1");
  await fakeSqlClient.reconcileRoutedOperation("op_1");
  await fakeSqlClient.waitForRoutedOperation("op_1", waitOptions);
  await fakeSqlClient.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "reader");
  await fakeSqlClient.listMembers();
  await fakeSqlClient.revokeMember("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await fakeSqlClient.placement();
  await fakeSqlClient.restore(await fakeSqlClient.archive());
  fakeSqlClient.close();
  await connectedDb.execute("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)");
  await connectedDb.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  await connectedDb.execute({ sql: "INSERT INTO notes(id) VALUES (?1)", args: [5], idempotencyKey: "sdk_retry_insert_3" });
  await connectedDb.execute({ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 3 } });
  await connectedDb.execute({ sql: "SELECT :enabled AS enabled", args: { enabled: true } });
  await connectedDb.execute({ sql: "SELECT :payload AS payload", args: { payload: new ArrayBuffer(2) } });
  await connectedDb.execute({ sql: "SELECT :payload AS payload", args: { payload: new DataView(new ArrayBuffer(2)) } });
  await connectedDb.execute({ sql: "INSERT INTO notes(id) VALUES (:id)", params: { id: 2 } });
  await connectedDb.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 4 } }]);
  await connectedDb.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 5 } }], { idempotencyKey: "sdk_retry_batch_3" });
  await connectedDb.transaction([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 6 } }], { mode: "write", idempotencyKey: "sdk_retry_transaction_3" });
  await connectedDb.transaction([{ sql: "SELECT count(*) AS total FROM notes" }], "read");
  await connectedDb.get("SELECT id FROM notes WHERE id = :id", { id: 2 });
  await connectedDb.get("SELECT id FROM notes WHERE id = ?1", [1]);
  await connectedDb.all("SELECT id FROM notes");
  await connectedDb.exec("CREATE TABLE connected_exec(id INTEGER); INSERT INTO connected_exec(id) VALUES (1);", { idempotencyKey: "sdk_retry_connected_exec_1" });
  await connectedDb.executeMultiple("CREATE TABLE connected_multiple(id INTEGER); INSERT INTO connected_multiple(id) VALUES (1);");
  await connectedDb.migrate([{ version: "connected-001", sql: "CREATE TABLE connected_migrated(id INTEGER);" }]);
  await explicitCreatedDb.execute("CREATE TABLE explicit_notes(id INTEGER PRIMARY KEY, body TEXT)");
  await connectedDb.schema("notes");
  await connectedDb.listTables();
  await connectedDb.tables();
  await connectedDb.views();
  await connectedDb.describeTable("notes");
  await connectedDb.describe("notes");
  await connectedDb.listColumns("notes");
  await connectedDb.columns("notes");
  await connectedDb.listIndexes("notes");
  await connectedDb.indexes("notes");
  await connectedDb.listTriggers("notes");
  await connectedDb.triggers("notes");
  await connectedDb.listForeignKeys("notes");
  await connectedDb.foreignKeys("notes");
  await connectedDb.previewTable("notes", { limit: 10 });
  await connectedDb.preview("notes", { limit: 10 });
  await connectedDb.waitForRoutedOperation("op_1", waitOptions);
  await explicitCreatedDb.queryRows("SELECT id, body FROM explicit_notes");
  await connectedDb.dumpSql();
  await connectedDb.loadSqlDump("CREATE TABLE connected_dump(id INTEGER);", { idempotencyKey: "sdk_retry_connected_load_1" });
  const connectedInspection: IcpdbDatabaseInspection = await connectedDb.inspect({ tableName: "notes" });
  const connectedStatus: IcpdbDatabaseStatus = await connectedDb.status();
  connectedStatus.callerRole?.toString();
  createdDatabaseId.toString();
  lowLevelConnectionUrl.toString();
  connectedDbConnectionUrl.toString();
  lowLevelHealth.cyclesBalance.toString();
  formattedConnectionUrl.toString();
  createdConnectionUrl.toString();
  lowLevelStatus.databaseId.toString();
  lowLevelInspection.tables.map((table) => table.table.name).join(",");
  lowLevelTableInspection.schema.toString();
  sqlStatus.stats.rowCount.toString();
  sqlInspection.schema.toString();
  connectedInspection.databaseId.toString();
  connectedStatus.tableStatuses.map((table) => table.tableName).join(",");
  rowsAffected.toString();
  affectedRows.toString();
  changes.toString();
  lastInsertRowid?.toString();
  lastInsertRowId?.toString();
  jsonLastInsertRowid?.toString();
  jsonLastInsertRowId?.toString();
  jsonRows.length.toString();
  typedBlobCell.byteLength.toString();
  jsonBlobCell.join(",");
  String(libsqlShapedInput);
  libsqlShapedValue?.toString();
  libsqlShapedIndexedValue?.toString();
  libsqlShapedLength?.toString();
  columnTypes.join(",");
  routedOperationId?.toString();
  libsqlShapedMigrationResults.length.toString();
  lowLevelSummary?.databaseId.toString();
  lowLevelArchiveInfo.databaseId.toString();
  lowLevelUsage.databaseId.toString();
  lowLevelUsageEvent?.method.toString();
  lowLevelMember?.role.toString();
  lowLevelDefaultMember?.role.toString();
  lowLevelTable?.name.toString();
  lowLevelShortTable?.name.toString();
  lowLevelDescription.tableName.toString();
  lowLevelShortDescription.tableName.toString();
  lowLevelColumn?.name.toString();
  lowLevelShortColumn?.name.toString();
  lowLevelIndex?.name.toString();
  lowLevelShortIndex?.name.toString();
  lowLevelTrigger?.name.toString();
  lowLevelShortTrigger?.name.toString();
  lowLevelForeignKey?.tableName.toString();
  lowLevelShortForeignKey?.tableName.toString();
  lowLevelPreview.tableName.toString();
  lowLevelShortPreview.tableName.toString();
  lowLevelResponse.columns.join(",");
  lowLevelOperation.operationId.toString();
  lowLevelShardOperation?.operationId.toString();
  lowLevelShardReconcileRequest.error?.toString();
  lowLevelShardInfo.map((shard) => shard.shardId).join(",");
  lowLevelShardStatus.cyclesBalance.toString();
  toppedUpShard.assignedDatabases.toString();
  toppedUpDefaultDatabaseBalance.databaseId.toString();
  maintainedShards.availableSlots.toString();
  migratedPlacement.databaseId.toString();
  defaultMigratedPlacement.databaseId.toString();
  defaultPlacement?.databaseId.toString();
  remoteDatabase.schemaVersion.toString();
  sqlClientHealth.cyclesBalance.toString();
  sqlClientClosed.toString();
  sqlClientProtocol.toString();
  connectedSqlClientProtocol.toString();
  return directPreparedRow ?? lowLevelPreparedRow ?? lowLevelFirst ?? lowLevelRow ?? lowLevelRows[0] ?? tupleGetRow ?? getRow ?? firstRow ?? allRows[0] ?? sqlRow ?? preparedFirst ?? preparedRows[0] ?? boundPreparedRows[0] ?? taggedPreparedRows[0] ?? objectPreparedRows[0] ?? tuplePreparedRows[0] ?? sqlRows[0] ?? sqlClientDatabaseFirst ?? result.rows[0] ?? lowLevelLibsqlMigrateResults[0]?.rows[0] ?? rows[0] ?? await explicitCreatedDb.queryOne("SELECT 1") ?? await connectedDb.queryOne("SELECT 1") ?? (firstCell === undefined || scalarCell === undefined || lowLevelFirstValue === undefined || lowLevelScalar === undefined || preparedFirstValue === undefined || preparedScalar === undefined || sqlClientDatabaseFirstValue === undefined || sqlClientDatabaseScalar === undefined || valueRows.length === 0 || lowLevelValues.length === 0 || preparedValues.length === 0 || sqlClientDatabaseValues.length === 0 ? null : { value: firstCell });
}

export async function checkIcpdbServiceIdentityPackageImports(): Promise<IcpdbDatabaseClient> {
  const serviceEnvFileMode: IcpdbServiceEnvFileMode = await checkIcpdbServiceEnvFileMode("./service.env");
  const defaultServiceEnvFileMode: Promise<IcpdbServiceEnvFileMode> = checkIcpdbServiceEnvFileMode();
  defaultServiceEnvFileMode.catch(() => undefined);
  serviceEnvFileMode.modeOctal.toString();
  const serviceEnv: Record<string, string> = await loadIcpdbServiceEnvFile("./service.env");
  const defaultServiceEnv: Promise<Record<string, string>> = loadIcpdbServiceEnvFile();
  defaultServiceEnv.catch(() => undefined);
  serviceEnv.ICPDB_CANISTER_ID?.toString();
  const fileClient = await createIcpdbServiceClientFromEnvFile("./service.env");
  const defaultFileClient: Promise<IcpdbClient> = createIcpdbServiceClientFromEnvFile();
  defaultFileClient.catch(() => undefined);
  await fileClient.principal();
  await fileClient.health();
  await fileClient.listAllPlacements();
  await fileClient.listShards();
  await fileClient.createDatabaseShard({ initialCycles: "1000", maxDatabases: 8 });
  await fileClient.createRemoteDatabase({ databaseId: "db_remote_file", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" });
  await fileClient.registerDatabaseShard({ databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai", maxDatabases: 8 });
  await fileClient.getShardStatus("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await fileClient.topUpShard("rrkah-fqaaa-aaaaa-aaaaq-cai", 1000n);
  await fileClient.maintainShards({
    minAvailableSlots: 1,
    minCyclesBalance: 0,
    topUpCycles: 0,
    maxNewShards: 1,
    newShardMaxDatabases: 8,
    newShardInitialCycles: 0
  });
  await fileClient.migrateDatabaseToShard("db_alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai");
  await fileClient.listShardOperations();
  await fileClient.reconcileShardOperation({ operationId: "op_2", status: "failed", error: "operator verified failure" });
  await fileClient.getRoutedOperation("db_alpha", "op_2");
  await fileClient.reconcileRoutedOperation("db_alpha", "op_2");
  const fileSqlClient: IcpdbSqlClient = await createIcpdbServiceSqlClientFromEnvFile("./service.env");
  const defaultFileSqlClient: Promise<IcpdbSqlClient> = createIcpdbServiceSqlClientFromEnvFile();
  defaultFileSqlClient.catch(() => undefined);
  await fileSqlClient.principal();
  await fileSqlClient.health();
  await fileSqlClient.databaseId();
  fileSqlClient.close();
  const shortFileSqlClient: IcpdbSqlClient = await createClientFromEnvFile("./service.env");
  await shortFileSqlClient.principal();
  await shortFileSqlClient.databaseId();
  await shortFileSqlClient.execute("INSERT INTO notes(body) VALUES (?1)", ["from-ci"]);
  const serviceCreateResult = await shortFileSqlClient.execute({
    sql: "CREATE TABLE readiness_query_only(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
    idempotencyKey: "readiness-query-only-create-table-001"
  });
  if (serviceCreateResult.routedOperationId) await shortFileSqlClient.waitForRoutedOperation(serviceCreateResult.routedOperationId);
  const serviceWriteResult = await shortFileSqlClient.execute({
    sql: "INSERT INTO readiness_query_only(body) VALUES (?1)",
    args: ["readiness-query-only"],
    idempotencyKey: "readiness-query-only-write-001"
  });
  if (serviceWriteResult.routedOperationId) await shortFileSqlClient.waitForRoutedOperation(serviceWriteResult.routedOperationId);
  const serviceFastStartResult: IcpdbSqlClientResult = await shortFileSqlClient.query("SELECT id, body FROM notes ORDER BY id DESC");
  const serviceFastStartRows: IcpdbRow[] = serviceFastStartResult.rows;
  const serviceFastStartConnectionUrl: string = await shortFileSqlClient.connectionUrl();
  const serviceFastStartInfo: IcpdbSqlClientInfo = await shortFileSqlClient.info();
  await shortFileSqlClient.query("SELECT 1 AS value");
  await shortFileSqlClient.scalar("SELECT count(*) FROM notes");
  serviceFastStartRows.length.toString();
  serviceFastStartConnectionUrl.toString();
  serviceFastStartInfo.databaseId.toString();
  shortFileSqlClient.close();
  const defaultShortFileSqlClient: Promise<IcpdbSqlClient> = createClientFromEnvFile();
  defaultShortFileSqlClient.catch(() => undefined);
  const shortConnectedFileSqlClient: IcpdbSqlClient = await connectClientFromEnvFile("./service.env");
  await shortConnectedFileSqlClient.databaseId();
  shortConnectedFileSqlClient.close();
  const defaultShortConnectedFileSqlClient: Promise<IcpdbSqlClient> = connectClientFromEnvFile();
  defaultShortConnectedFileSqlClient.catch(() => undefined);
  const persistedFileSqlClient: IcpdbSqlClient = await createIcpdbPersistedServiceSqlClientFromEnvFile("./service.env");
  const defaultPersistedFileSqlClient: Promise<IcpdbSqlClient> = createIcpdbPersistedServiceSqlClientFromEnvFile();
  defaultPersistedFileSqlClient.catch(() => undefined);
  await persistedFileSqlClient.principal();
  await persistedFileSqlClient.health();
  await persistedFileSqlClient.databaseId();
  persistedFileSqlClient.close();
  const fileCreatedDb = await createIcpdbServiceDatabaseFromEnvFile("./service.env");
  const defaultFileCreatedDb: Promise<IcpdbDatabaseClient> = createIcpdbServiceDatabaseFromEnvFile();
  defaultFileCreatedDb.catch(() => undefined);
  await fileCreatedDb.schema();
  const directServiceCreateOptions: IcpdbServiceCreateDatabaseOptions = {
    canisterId: "aaaaa-aa",
    identityJson: "[]",
    setupSql: "CREATE TABLE service_direct_create(id INTEGER);"
  };
  const directServiceConnectionUrlCreateOptions: IcpdbServiceCreateDatabaseOptions = {
    connectionUrl: "icpdb://aaaaa-aa",
    identityJson: "[]",
    setupSql: "CREATE TABLE service_direct_connection_url_create(id INTEGER);"
  };
  // @ts-expect-error createIcpdbServiceDatabase creates a new database; connect helpers handle existing database ids
  const invalidServiceCreateOptions: IcpdbServiceCreateDatabaseOptions = { canisterId: "aaaaa-aa", databaseId: "db_existing", identityJson: "[]" };
  invalidServiceCreateOptions.canisterId?.toString();
  const directServiceSqlClientOptions: IcpdbServiceSqlClientOptions = { canisterId: "aaaaa-aa", identityJson: "[]", setupSql: "CREATE TABLE service_sql_client_create(id INTEGER);" };
  const directServiceConnectionUrlSqlClientOptions: IcpdbServiceSqlClientOptions = { connectionUrl: "icpdb://aaaaa-aa/db_alpha", identityJson: "[]" };
  directServiceSqlClientOptions.canisterId?.toString();
  directServiceConnectionUrlCreateOptions.connectionUrl?.toString();
  directServiceConnectionUrlSqlClientOptions.connectionUrl?.toString();
  // @ts-expect-error service SQL client setup creates a new database; existing database setup uses exec, batch, or migrate
  const invalidServiceSqlClientSetupOptions: IcpdbServiceSqlClientOptions = { canisterId: "aaaaa-aa", databaseId: "db_existing", identityJson: "[]", setupSql: "CREATE TABLE invalid_service_existing_setup(id INTEGER);" };
  invalidServiceSqlClientSetupOptions.canisterId?.toString();
  const directServiceCreatedDb = await createIcpdbServiceDatabase(directServiceCreateOptions);
  const directServiceConnectionUrlClient: IcpdbClient = await createIcpdbServiceClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identityJson: "[]" });
  const directServiceConnectionUrlDb: IcpdbDatabaseClient = await connectIcpdbServiceDatabase({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identityJson: "[]" });
  const directServiceConnectionUrlSqlClient: IcpdbSqlClient = await createIcpdbServiceSqlClient(directServiceConnectionUrlSqlClientOptions);
  directServiceConnectionUrlClient.connectionUrl().toString();
  directServiceConnectionUrlDb.connectionUrl().toString();
  await directServiceConnectionUrlSqlClient.connectionUrl();
  await directServiceCreatedDb.schema();
  await loadIcpdbServicePrincipalFromEnvFile("./service.env");
  await loadIcpdbServicePrincipalFromEnvFile();
  await loadIcpdbServiceSetupFromEnvFile("./service.env");
  await loadIcpdbServiceSetupFromEnvFile();
  const provisionedDatabaseEnv = await provisionIcpdbServiceDatabaseEnvFile({
    canisterId: "aaaaa-aa",
    identityJson: "[]",
    setupSql: "CREATE TABLE service_bootstrap(id INTEGER);"
  }, "./generated-service-db.env", "writer", "ed25519");
  provisionedDatabaseEnv.connectionUrl.toString();
  const inspectedFileEnv: IcpdbServiceEnvInspection = await inspectIcpdbServiceEnvFile("./service.env");
  const defaultInspectedFileEnv: Promise<IcpdbServiceEnvInspection> = inspectIcpdbServiceEnvFile();
  defaultInspectedFileEnv.catch(() => undefined);
  inspectedFileEnv.principal.toString();
  inspectedFileEnv.setupStatementCount.toString();
  await loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_SQL_FILE: "./schema.sql",
    ICPDB_SETUP_STATEMENTS_FILE: "./statements.json",
    ICPDB_SETUP_MIGRATIONS_FILE: "./migrations.json"
  });
  const inspectedEnv: IcpdbServiceEnvInspection = await inspectIcpdbServiceEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_alpha",
    ICPDB_NETWORK_URL: "https://aaaaa-aa.icp0.io",
    ICPDB_IDENTITY_PEM: "unused",
    ICPDB_SETUP_SQL: "CREATE TABLE inspected(id INTEGER);"
  });
  inspectedEnv.connectionUrl?.toString();
  const targetOptions: IcpdbGeneratedServiceIdentityTargetOptions = { canisterId: "aaaaa-aa", databaseId: "db_alpha", networkUrl: "https://icp-api.io" };
  const generated = generateIcpdbServiceIdentity("ed25519", targetOptions);
  generated.principal.toString();
  await writeGeneratedIcpdbServiceEnvFile("./generated-service.env", "secp256k1", targetOptions);
  await provisionIcpdbServiceIdentity({
    grantMember: async (_principal, _role) => {}
  }, "writer", "ed25519");
  await provisionIcpdbServiceEnvFile({
    databaseId: "db_alpha",
    connectionUrl: () => "icpdb://aaaaa-aa/db_alpha",
    grantMember: async (_principal, _role) => {}
  }, "./generated-service.env", "writer", "ed25519");
  await writeIcpdbServiceEnvFile("./service.env", serviceEnv);
  await persistIcpdbServiceDatabaseId("./service.env", "db_alpha");
  formatIcpdbServiceEnv({ ICPDB_DATABASE_ID: "db_alpha" }).toString();
  await grantIcpdbServiceIdentityFromEnvFile({
    grantMember: async (_principal, _role) => {}
  }, "./service.env");
  await grantIcpdbServiceIdentityFromEnvFile({
    grantMember: async (_principal, _role) => {}
  });
  const client = await createIcpdbServiceClientFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  await client.principal();
  await client.health();
  await client.listAllPlacements();
  await client.listShards();
  await client.createDatabaseShard({ initialCycles: 1000, maxDatabases: 8 });
  await client.createRemoteDatabase({ databaseId: "db_remote_service", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" });
  await client.registerDatabaseShard({ databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai", maxDatabases: 8 });
  await client.getShardStatus("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await client.topUpShard("rrkah-fqaaa-aaaaa-aaaaq-cai", 1000);
  await client.maintainShards({
    minAvailableSlots: 1,
    minCyclesBalance: 0,
    topUpCycles: 0,
    maxNewShards: 1,
    newShardMaxDatabases: 8,
    newShardInitialCycles: 0
  });
  await client.migrateDatabaseToShard("db_alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai");
  await client.listShardOperations();
  await client.reconcileShardOperation({ operationId: "op_3", status: "applied", error: null });
  await client.getRoutedOperation("db_alpha", "op_3");
  await client.reconcileRoutedOperation("db_alpha", "op_3");
  const sqlClient: IcpdbSqlClient = await createIcpdbServiceSqlClientFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "db_alpha",
    ICPDB_IDENTITY_PEM: "unused",
    ICPDB_SETUP_STATEMENTS: "[{\"sql\":\"INSERT INTO service_client_seed(id) VALUES (:id)\",\"args\":{\"id\":1}}]",
    ICPDB_SETUP_MIGRATIONS: "[{\"version\":\"service-client-001\",\"sql\":\"CREATE TABLE service_client_migrated(id INTEGER);\"}]"
  });
  const shortSqlClient: IcpdbSqlClient = await createClientFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  await shortSqlClient.databaseId();
  shortSqlClient.close();
  const shortConnectedSqlClient: IcpdbSqlClient = await connectClientFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  await shortConnectedSqlClient.databaseId();
  shortConnectedSqlClient.close();
  await sqlClient.health();
  await sqlClient.schema();
  await sqlClient.databaseId();
  await sqlClient.exec("CREATE TABLE service_exec(id INTEGER);");
  await sqlClient.executeMultiple("CREATE TABLE service_multiple(id INTEGER);");
  await sqlClient.executeScript("CREATE TABLE service_script(id INTEGER);");
  await sqlClient.getUsage();
  await sqlClient.status();
  await sqlClient.inspect({ previewLimit: 1 });
  await sqlClient.placement();
  await sqlClient.dumpSql();
  await sqlClient.loadSqlDump("CREATE TABLE service_dump(id INTEGER);");
  sqlClient.close();
  const principal: string = await loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_PEM: "unused"
  });
  await grantIcpdbServiceIdentityFromEnv({
    grantMember: async (_principal, _role) => {}
  }, {
    ICPDB_IDENTITY_PEM: "unused"
  });
  const createdDb = await createIcpdbServiceDatabaseFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_PEM: "unused",
    ICPDB_SETUP_SQL: "CREATE TABLE service_created_setup(id INTEGER);",
    ICPDB_SETUP_STATEMENTS: "[[\"INSERT INTO service_created_setup(id) VALUES (?1)\",[1]]]",
    ICPDB_SETUP_MIGRATIONS: "[{\"version\":\"service-created-001\",\"name\":\"create_service_created_migrated\",\"sql\":\"CREATE TABLE service_created_migrated(id INTEGER);\"}]"
  });
  const shortCreatedDb: IcpdbDatabaseClient = await createDatabaseFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_PEM: "unused"
  });
  const connectedFileDb = await connectIcpdbServiceDatabaseFromEnvFile("./service.env");
  const shortConnectedDb: IcpdbDatabaseClient = await connectDatabaseFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  const shortConnectedFileDb: IcpdbDatabaseClient = await connectDatabaseFromEnvFile("./service.env");
  const shortCreatedFileDb: IcpdbDatabaseClient = await createDatabaseFromEnvFile("./service-create.env");
  const defaultConnectedFileDb: Promise<IcpdbDatabaseClient> = connectIcpdbServiceDatabaseFromEnvFile();
  const defaultShortConnectedFileDb: Promise<IcpdbDatabaseClient> = connectDatabaseFromEnvFile();
  const defaultShortCreatedFileDb: Promise<IcpdbDatabaseClient> = createDatabaseFromEnvFile();
  defaultConnectedFileDb.catch(() => undefined);
  defaultShortConnectedFileDb.catch(() => undefined);
  defaultShortCreatedFileDb.catch(() => undefined);
  const serviceArchiveFile: IcpdbServiceArchiveFileResult = await archiveIcpdbServiceDatabaseToFile(connectedFileDb, "./backup.sqlite");
  const serviceSnapshotFile: IcpdbServiceSnapshotFileInfo = await snapshotInfoIcpdbServiceFile("./backup.sqlite");
  await restoreIcpdbServiceDatabaseFromFile(connectedFileDb, "./backup.sqlite", { expectedSha256: serviceSnapshotFile.sha256 });
  const shortServiceArchiveFile: IcpdbServiceArchiveFileResult = await archiveDatabaseToFile(connectedFileDb, "./backup-short.sqlite");
  const shortServiceSnapshotFile: IcpdbServiceSnapshotFileInfo = await snapshotInfoFile("./backup-short.sqlite");
  await restoreDatabaseFromFile(connectedFileDb, "./backup-short.sqlite", { expectedSha256: shortServiceSnapshotFile.sha256 });
  const envArchiveOptions: IcpdbServiceEnvFileOptions = { envPath: "./service.env" };
  const envRestoreOptions: IcpdbServiceRestoreFileFromEnvOptions = { envPath: "./service.env", expectedSha256: serviceArchiveFile.sha256 };
  const envObjectArchiveOptions: IcpdbServiceEnvSourceOptions = { env: process.env };
  const envObjectRestoreOptions: IcpdbServiceRestoreFileFromEnvSourceOptions = { env: process.env, expectedSha256: serviceArchiveFile.sha256 };
  await archiveIcpdbServiceDatabaseToFileFromEnv("./backup-default-process-env.sqlite");
  await restoreIcpdbServiceDatabaseFromFileFromEnv("./backup-default-process-env.sqlite", { expectedSha256: serviceArchiveFile.sha256 });
  await archiveDatabaseToFileFromEnv("./backup-default-short-process-env.sqlite");
  await restoreDatabaseFromFileFromEnv("./backup-default-short-process-env.sqlite", { expectedSha256: shortServiceArchiveFile.sha256 });
  await archiveIcpdbServiceDatabaseToFileFromEnv("./backup-from-env-object.sqlite", envObjectArchiveOptions);
  await restoreIcpdbServiceDatabaseFromFileFromEnv("./backup-from-env-object.sqlite", envObjectRestoreOptions);
  await archiveDatabaseToFileFromEnv("./backup-from-short-env-object.sqlite", envObjectArchiveOptions);
  await restoreDatabaseFromFileFromEnv("./backup-from-short-env-object.sqlite", envObjectRestoreOptions);
  await archiveIcpdbServiceDatabaseToFileFromEnvFile("./backup-default-env.sqlite");
  await restoreIcpdbServiceDatabaseFromFileFromEnvFile("./backup-default-env.sqlite", { expectedSha256: serviceArchiveFile.sha256 });
  await archiveDatabaseToFileFromEnvFile("./backup-default-short-env.sqlite");
  await restoreDatabaseFromFileFromEnvFile("./backup-default-short-env.sqlite", { expectedSha256: shortServiceArchiveFile.sha256 });
  await archiveIcpdbServiceDatabaseToFileFromEnvFile("./backup-from-env.sqlite", envArchiveOptions);
  await restoreIcpdbServiceDatabaseFromFileFromEnvFile("./backup-from-env.sqlite", envRestoreOptions);
  await archiveDatabaseToFileFromEnvFile("./backup-from-short-env.sqlite", envArchiveOptions);
  await restoreDatabaseFromFileFromEnvFile("./backup-from-short-env.sqlite", envRestoreOptions);
  await connectedFileDb.databaseId.toString();
  await createdDb.execute("CREATE TABLE created_notes(id INTEGER)");
  createdDb.databaseId.toString();
  shortCreatedDb.databaseId.toString();
  shortConnectedDb.databaseId.toString();
  shortConnectedFileDb.databaseId.toString();
  shortCreatedFileDb.databaseId.toString();
  principal.toString();
  return connectIcpdbServiceDatabaseFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
}
