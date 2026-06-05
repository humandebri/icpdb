#!/usr/bin/env node
// icpdb-console/lib/icpdb-cli.ts
// Portable npm bin for Server/CI jobs that already have a service.env.
// It intentionally stays thin and delegates identity, SQL, and backup work to
// the SDK server entry so the package CLI matches programmatic Server/CI use.

import {
  archiveDatabaseToFile,
  archiveDatabaseToFileFromEnvFile,
  createClientFromEnvFile,
  createDatabaseFromEnvFile,
  createIcpdbServiceDatabaseFromEnv,
  createIcpdbServiceClientFromEnvFile,
  connectIcpdbServiceDatabaseFromEnv,
  generateIcpdbServiceIdentity,
  inspectIcpdbServiceEnvFile,
  loadIcpdbServiceEnvFile,
  loadIcpdbServiceSetupFromEnv,
  persistIcpdbServiceDatabaseId,
  provisionIcpdbServiceEnvFile,
  restoreDatabaseFromFileFromEnvFile,
  snapshotInfoFile,
  restoreDatabaseFromFile,
  writeIcpdbServiceEnvFile,
  writeGeneratedIcpdbServiceEnvFile
} from "./icpdb-server.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type {
  DatabaseRole,
  DatabaseShardInfo,
  DatabaseShardMaintenanceReport,
  DatabaseShardPlacement,
  DatabaseShardStatus,
  IcpdbBatchMode,
  IcpdbDatabaseClient,
  IcpdbSqlClient,
  IcpdbMigration,
  IcpdbSqlArgsInput,
  IcpdbSqlClientBatchOptionsObject,
  IcpdbSqlClientBatchStatement,
  IcpdbSqlClientScriptOptionsObject,
  IcpdbSqlClientStatement,
  IcpdbSqlClientResult,
  IcpdbMigrationResult,
  IcpdbDatabaseStatus,
  IcpdbWaitForRoutedOperationOptions,
  IcpdbSqlValueInput,
  IcpdbGeneratedServiceIdentityTargetOptions,
  IcpdbServiceEnvInspection,
  IcpdbServiceIdentityType,
  MaintainDatabaseShardsRequest,
  RoutedOperationInfo,
  ShardOperationInfo
} from "./icpdb-server.js";
import { isReadSql, splitSqlDumpStatements, splitSqlStatements } from "./icpdb-sql-script.js";

const DEFAULT_ENV_FILE = "service.env";
const ANONYMOUS_PRINCIPAL = "2vxsx-fae";

type CliFormat = "json" | "table" | "csv" | "env";
type CliShardOperationReconcileStatus = "applied" | "failed";
type PackageInspectEnvOutput = IcpdbServiceEnvInspection & {
  nextCreateDbCommand?: string;
  nextScalarCommand?: string;
  nextExecuteCommand?: string;
  nextQueryCommand?: string;
  nextSchemaCountCommand?: string;
  nextTablesCommand?: string;
  nextViewsCommand?: string;
  nextStatsCommand?: string;
  nextStatusCommand?: string;
  nextMembersCommand?: string;
  nextCheckEnvCommand?: string;
  nextUrlCommand?: string;
  nextInfoCommand?: string;
};
type PackageServiceEnvSqlSmoke = {
  table: string;
  selectedBody: string;
  selectedScalarBody: string;
};

type PackageServiceEnvSdkSmoke = PackageServiceEnvSqlSmoke;

type PackageServiceEnvShardSmoke = {
  canisterId: string;
  healthCyclesBalance: string;
  placementCount: number;
  shardCount: number;
  operationCount: number;
  maintenanceAvailableSlots: string;
  maintenanceActionCount: number;
  statusCanisterId?: string;
  statusCyclesBalance?: string;
};

type PackageServiceEnvSdkShardSmoke = PackageServiceEnvShardSmoke;

type PackageServiceEnvArchiveRestoreSmoke = {
  table: string;
  scratchArchiveDatabaseId: string;
  scratchRestoreDatabaseId: string;
  snapshotHash: string;
  sizeBytes: number;
  selectedBody: string;
  selectedScalarBody: string;
};

type PackageServiceEnvSdkArchiveRestoreSmoke = PackageServiceEnvArchiveRestoreSmoke;

type PackageCheckSqlExecutor = {
  execute: (statement: IcpdbSqlClientStatement) => Promise<{ routedOperationId: string | null }>;
  waitForRoutedOperation: (operationId: string, options?: IcpdbWaitForRoutedOperationOptions) => Promise<RoutedOperationInfo>;
};

type PackageReadModeFileSource =
  | { kind: "batch"; statements: IcpdbSqlClientBatchStatement[] }
  | { kind: "script"; source: string }
  | { kind: "load"; source: string };

type PackageServiceEnvCheck = {
  ok: boolean;
  envFile: string;
  skippedCall: boolean;
  canisterId: string;
  hasDatabase: boolean;
  databaseId?: string;
  connectionUrl?: string;
  principal: string;
  networkUrl?: string;
  hasRootKey?: boolean;
  callerPrincipal?: string;
  callerRole?: DatabaseRole;
  statusTableCount?: number;
  statusViewCount?: number;
  statusRowCount?: string;
  statusColumnCount?: number;
  statusIndexCount?: number;
  statusTriggerCount?: number;
  statusForeignKeyCount?: number;
  sqlSmoke?: PackageServiceEnvSqlSmoke;
  sdkSmoke?: PackageServiceEnvSdkSmoke;
  shardSmoke?: PackageServiceEnvShardSmoke;
  sdkShardSmoke?: PackageServiceEnvSdkShardSmoke;
  archiveRestoreSmoke?: PackageServiceEnvArchiveRestoreSmoke;
  sdkArchiveRestoreSmoke?: PackageServiceEnvSdkArchiveRestoreSmoke;
  checks: string[];
};
type PackageServiceEnvCheckOutput = PackageServiceEnvCheck & {
  nextInspectEnvCommand?: string;
  nextCreateDbCommand?: string;
  nextCheckEnvCommand?: string;
  nextStatusCommand?: string;
  nextMembersCommand?: string;
  nextExecuteCommand?: string;
  nextInsertCommand?: string;
  nextQueryCommand?: string;
  nextReadCommand?: string;
  nextSqlSmokeCommand?: string;
  nextSchemaCountCommand?: string;
  nextTablesCommand?: string;
  nextViewsCommand?: string;
  nextStatsCommand?: string;
  nextSchemaCommand?: string;
  nextDescribeCommand?: string;
  nextPreviewCommand?: string;
  nextArchiveCommand?: string;
  nextSnapshotInfoCommand?: string;
  nextHashPinnedRestoreCommand?: string;
  nextOwnerArchiveRestoreSmokeCommand?: string;
  nextUrlCommand?: string;
  nextInfoCommand?: string;
} & Partial<ShardOperatorNextCommands>;

type ParsedCli = {
  command: string;
  positional: string[];
  envFile: string;
  envFileExplicit?: boolean;
  format: CliFormat;
  params?: IcpdbSqlArgsInput;
  paramsFile?: string;
  mode?: IcpdbBatchMode;
  expectedSha256?: string;
  limit?: number;
  offset?: number;
  reconcileUnknown?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  confirm?: string;
  idempotencyKey?: string;
  wait?: boolean;
  setupSql?: string;
  setupFile?: string;
  setupStatementsFile?: string;
  setupMigrationsFile?: string;
  envOut?: string;
  identityType?: IcpdbServiceIdentityType;
  canisterId?: string;
  databaseId?: string;
  networkUrl?: string;
  rootKey?: string;
  skipCall?: boolean;
  smokeSql?: boolean;
  smokeSdk?: boolean;
  smokeShards?: boolean;
  smokeSdkShards?: boolean;
  smokeArchiveRestore?: boolean;
  smokeSdkArchiveRestore?: boolean;
  requireRole?: DatabaseRole;
};

const MIGRATIONS_TABLE = "icpdb_schema_migrations";
const SERVICE_SETUP_ENV_KEYS = [
  "ICPDB_SETUP_SQL",
  "ICPDB_SETUP_SQL_FILE",
  "ICPDB_SETUP_STATEMENTS",
  "ICPDB_SETUP_STATEMENTS_FILE",
  "ICPDB_SETUP_MIGRATIONS",
  "ICPDB_SETUP_MIGRATIONS_FILE"
] as const;

const ENV_FORMAT_COMMANDS = new Set<string>([
  "init",
  "generate-identity",
  "provision-service",
  "check-env",
  "inspect-env",
  "principal",
  "url",
  "info",
  "create-db",
  "archive",
  "snapshot-info"
]);

let currentOutputFormat: CliFormat = "json";

const KNOWN_COMMANDS = new Set<string>([
  "init",
  "provision-service",
  "inspect-env",
  "generate-identity",
  "check-env",
  "principal",
  "url",
  "info",
  "query",
  "execute",
  "exec",
  "sql",
  "scalar",
  "batch",
  "transaction",
  "script",
  "load",
  "dump",
  "migrate",
  "create-db",
  "health",
  "databases",
  "status",
  "stats",
  "usage",
  "usage-events",
  "placement",
  "delete-db",
  "tables",
  "views",
  "schema",
  "describe",
  "columns",
  "indexes",
  "triggers",
  "foreign-keys",
  "preview",
  "inspect",
  "members",
  "grant-member",
  "revoke-member",
  "operation",
  "operation-reconcile",
  "operation-wait",
  "placements",
  "all-placements",
  "shards",
  "shard-create",
  "shard-register",
  "shard-status",
  "shard-top-up",
  "shard-ops",
  "shard-maintain",
  "shard-migrate",
  "remote-create-db",
  "shard-reconcile",
  "archive",
  "snapshot-info",
  "restore",
  "shell"
]);

const PACKAGE_ZERO_POSITIONAL_COMMANDS = new Set<string>([
  "init",
  "inspect-env",
  "generate-identity",
  "check-env",
  "principal",
  "url",
  "info",
  "create-db",
  "health",
  "databases",
  "status",
  "stats",
  "usage",
  "usage-events",
  "placement",
  "delete-db",
  "tables",
  "views",
  "members",
  "placements",
  "all-placements",
  "shards",
  "shard-ops"
]);

const PACKAGE_ONE_POSITIONAL_COMMANDS = new Set<string>([
  "query",
  "execute",
  "exec",
  "sql",
  "scalar",
  "batch",
  "transaction",
  "script",
  "load",
  "dump",
  "migrate",
  "describe",
  "columns",
  "indexes",
  "triggers",
  "foreign-keys",
  "preview",
  "shard-status",
  "revoke-member",
  "operation",
  "operation-reconcile",
  "operation-wait",
  "snapshot-info",
  "archive",
  "restore"
]);

const PACKAGE_TWO_POSITIONAL_COMMANDS = new Set<string>([
  "grant-member",
  "provision-service",
  "shard-create",
  "shard-register",
  "shard-top-up",
  "shard-migrate",
  "remote-create-db"
]);

function usage(): string {
  return [
    "Usage:",
    "  icpdb help [quickstart|sdk|server|init|provision-service|lifecycle|database|db|databases|sql|query|execute|scalar|exec|batch|transaction|script|load|dump|migrate|inspect|schema|tables|views|describe|columns|indexes|triggers|foreign-keys|preview|status|stats|health|usage|usage-events|placement|inspect-env|principal|url|info|service-env|env|check-env|generate-identity|identity|permissions|auth|token|http|members|grant-member|revoke-member|backup|archive|snapshot-info|restore|operation|operation-wait|operation-reconcile|operations|shell|ops|placements|all-placements|shards|shard-create|shard-register|shard-status|shard-top-up|shard-ops|shard-maintain|shard-migrate|remote-create-db|shard-reconcile|controller|create-db|delete-db]",
    "  icpdb init --canister-id <id> --env-out service.env [--identity-type ed25519|secp256k1] [--network-url <url>] [--root-key <base64>] [--setup-sql <sql>|--setup-file <file|->|--setup-statements-file <file|->|--setup-migrations-file <file|->] [--format json|table|csv|env]",
    "  icpdb provision-service <database-id> <reader|writer|owner> --env-out service.env [--identity-type ed25519|secp256k1] [--service-env-file owner.env] [--format json|table|csv|env]",
    "  icpdb generate-identity [--identity-type ed25519|secp256k1] [--canister-id <id>] [--database-id <database-id>] [--network-url <url>] [--root-key <base64>] [--env-out service.env] [--format json|table|csv|env]",
    "  icpdb check-env [--skip-call] [--require-role reader|writer|owner] [--smoke-sql] [--smoke-sdk] [--smoke-archive-restore] [--smoke-sdk-archive-restore] [--smoke-shards] [--smoke-sdk-shards] [--service-env-file service.env] [--format json|table|csv|env]",
    "  icpdb inspect-env [--service-env-file service.env] [--format json|table|csv|env]",
    "  icpdb principal [--service-env-file service.env] [--format json|table|csv|env]",
    "  icpdb url [--service-env-file service.env] [--format json|table|csv|env]",
    "  icpdb info [--service-env-file service.env] [--format json|table|csv|env]",
    "  icpdb query <sql> [--params <json>|--params-file <file|->] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb execute <sql> [--params <json>|--params-file <file|->] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb exec <sql> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb sql <sql> [--params <json>|--params-file <file|->] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb scalar <sql> [--params <json>|--params-file <file|->] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb batch <statements-file|-> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb transaction <statements-file|-> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb script <file|-> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb load <file|-> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb dump <file|-> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb migrate <file|-> [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb create-db [--setup-sql <sql>|--setup-file <file|->|--setup-statements-file <file|->|--setup-migrations-file <file|->] [--service-env-file service.env] [--format json|table|csv|env]",
    "  icpdb health [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb databases [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb status [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb stats [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb usage [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb usage-events [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb placement [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb delete-db --confirm <database-id> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb tables [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb views [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb schema [table-name] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb describe <table-name> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb columns <table-name> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb indexes <table-name> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb triggers <table-name> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb foreign-keys <table-name> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb preview <table-name> [--limit rows] [--offset rows] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb inspect [table-name] [--limit rows] [--offset rows] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb members [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb grant-member <principal> <reader|writer|owner> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb revoke-member <principal> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb operation <operation-id> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb operation-reconcile <operation-id> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb operation-wait <operation-id> [--reconcile-unknown] [--interval-ms ms] [--timeout-ms ms] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb placements [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb all-placements [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shards [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shard-create <initial-cycles> <max-databases> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shard-register <database-canister-id> <max-databases> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shard-status <database-canister-id> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shard-top-up <database-canister-id> <cycles> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shard-ops [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shard-maintain <min-available-slots> <min-cycles-balance> <top-up-cycles> <max-new-shards> <new-shard-max-databases> <new-shard-initial-cycles> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shard-migrate <database-id> <database-canister-id> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb remote-create-db <database-id> <database-canister-id> [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shard-reconcile <operation-id> <applied|failed> [reason...] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb archive <file> [--service-env-file service.env] [--format json|table|csv|env]",
    "  icpdb snapshot-info <file> [--format json|table|csv|env]",
    "  icpdb restore <file> [--expect-snapshot-hash <sha256>] [--service-env-file service.env] [--format json|table|csv]",
    "  icpdb shell [sql|dot-command] [--mode read|write|deferred] [--wait] [--service-env-file service.env] [--format json|table|csv]",
    "",
    "Server/CI defaults to cwd-local service.env. Use --service-env-file only for non-default paths.",
    "Add --format table for human CI logs or --format csv for row export and spreadsheet-friendly checks.",
    "Use `icpdb help <topic-or-command>` for focused Server/CI flows; the first help line lists discoverable topics and actual command names."
  ].join("\n");
}

async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  currentOutputFormat = parsed.format;
  if (parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    process.stdout.write(`${commandUsage(parsed.positional)}\n`);
    return;
  }
  assertKnownCommand(parsed.command);
  rejectPreviewWindowOptionsForCommand(parsed);
  rejectWaitOptionsForCommand(parsed);
  rejectConfirmOptionForCommand(parsed);
  rejectExpectedSnapshotHashForCommand(parsed);
  rejectServiceEnvFileForCommand(parsed);
  rejectModeForCommand(parsed);
  rejectIdempotencyKeyForCommand(parsed);
  rejectWriteWaitForCommand(parsed);
  rejectReadSqlWriteOptionsForCommand(parsed);
  rejectSetupOptionsForCommand(parsed);
  rejectIdentityGenerationOptionsForCommand(parsed);
  rejectCheckOptionsForCommand(parsed);
  rejectEnvFormatForCommand(parsed);
  rejectSqlParamsForCommand(parsed);
  rejectPackageCommandPositionalsBeforeEnv(parsed);
  const sqlParams = await loadSqlParams(parsed);

  if (parsed.command === "init") {
    rejectExtraPositionals(parsed, 0);
    const initialized = await initPackageServiceDatabase(parsed);
    printOutput(parsed.format, packageHandoffEnv(initialized.env), initialized.output);
    return;
  }

  if (parsed.command === "generate-identity") {
    rejectExtraPositionals(parsed, 0);
    const target = generatedIdentityTargetOptions(parsed);
    const identityType = parsed.identityType ?? "ed25519";
    const generated = parsed.envOut === undefined
      ? generateIcpdbServiceIdentity(identityType, target)
      : await writeNewGeneratedIcpdbServiceEnvFile(parsed.envOut, identityType, target);
    const generatedOutput = {
      identityType: generated.identityType,
      principal: generated.principal,
      ...(parsed.envOut !== undefined && parsed.format !== "env" ? {} : { env: generated.env }),
      ...(parsed.envOut === undefined ? {} : { envOut: parsed.envOut }),
      warning: generated.warning
    };
    printOutput(parsed.format, packageHandoffEnv(generated.env), {
      ...generatedOutput
    });
    return;
  }

  if (parsed.command === "provision-service") {
    const databaseId = databaseIdArg(requiredPositional(parsed, 0, "database id"));
    const role = cliDatabaseRole(requiredPositional(parsed, 1, "role"));
    rejectExtraPositionals(parsed, 2);
    const envOut = requiredNonEmpty(parsed.envOut ?? "", "env output file");
    await rejectExistingEnvOutFile(envOut);
    const ownerEnv = await loadIcpdbServiceEnvFile(parsed.envFile);
    const ownerDatabase = await connectIcpdbServiceDatabaseFromEnv({
      ...ownerEnv,
      ICPDB_DATABASE_ID: databaseId
    });
    const provisioned = await provisionIcpdbServiceEnvFile(ownerDatabase, envOut, role, parsed.identityType ?? "ed25519", {
      ICPDB_NETWORK_URL: ownerEnv.ICPDB_NETWORK_URL,
      ICPDB_ROOT_KEY: ownerEnv.ICPDB_ROOT_KEY
    });
    printOutput(parsed.format, packageHandoffEnv(provisioned.env), {
      identityType: provisioned.identityType,
      principal: provisioned.principal,
      databaseId: provisioned.databaseId,
      url: provisioned.connectionUrl,
      role: provisioned.role,
      envOut,
      warning: provisioned.warning
    });
    return;
  }

  if (parsed.command === "check-env") {
    rejectExtraPositionals(parsed, 0);
    const check = await checkPackageServiceEnv(parsed);
    printOutput(parsed.format, packageServiceEnvCheckEnv(check), packageServiceEnvCheckOutput(check));
    return;
  }

  if (parsed.command === "inspect-env") {
    const inspection = await inspectIcpdbServiceEnvFile(parsed.envFile);
    printOutput(parsed.format, {
      ICPDB_CANISTER_ID: inspection.canisterId,
      ICPDB_HAS_DATABASE: inspection.hasDatabase ? "true" : "false",
      ICPDB_DATABASE_ID: inspection.databaseId,
      ICPDB_URL: inspection.connectionUrl,
      ...(inspection.connectionUrl === undefined ? {} : { ICPDB_CONNECTION_URL: inspection.connectionUrl }),
      ICPDB_SERVICE_PRINCIPAL: inspection.principal,
      ICPDB_NETWORK_URL: inspection.networkUrl
    }, packageInspectEnvOutput(inspection, parsed.envFile));
    return;
  }

  if (parsed.command === "principal") {
    rejectExtraPositionals(parsed, 0);
    const inspection = await inspectIcpdbServiceEnvFile(parsed.envFile);
    printOutput(parsed.format, {
      ICPDB_SERVICE_PRINCIPAL: inspection.principal
    }, {
      principal: inspection.principal
    });
    return;
  }

  if (parsed.command === "snapshot-info") {
    const file = requiredPositional(parsed, 0, "snapshot file");
    rejectExtraPositionals(parsed, 1);
    const info = await snapshotInfoFile(file);
    printOutput(parsed.format, {
      ICPDB_SNAPSHOT_FILE: info.filePath,
      ICPDB_SNAPSHOT_SIZE_BYTES: String(info.sizeBytes),
      ICPDB_SNAPSHOT_HASH: info.sha256
    }, info);
    return;
  }

  if (parsed.command === "create-db") {
    rejectExtraPositionals(parsed, 0);
    const inspection = await inspectIcpdbServiceEnvFile(parsed.envFile);
    if (inspection.databaseId) {
      throw new Error("create-db requires canister-only service env; remove ICPDB_DATABASE_ID or use an env without a database id");
    }
    const created = await createDatabaseFromCreateDbOptions(parsed);
    const createdOutput = {
      canisterId: inspection.canisterId,
      databaseId: created.databaseId,
      url: created.url,
      connectionUrl: created.url,
      principal: inspection.principal,
      networkUrl: inspection.networkUrl,
      ...postCreateNextCommands(parsed.envFile)
    };
    printOutput(parsed.format, {
      ICPDB_CANISTER_ID: inspection.canisterId,
      ICPDB_DATABASE_ID: created.databaseId,
      ICPDB_URL: created.url,
      ICPDB_CONNECTION_URL: created.url,
      ICPDB_SERVICE_PRINCIPAL: inspection.principal,
      ICPDB_NETWORK_URL: inspection.networkUrl
    }, createdOutput);
    return;
  }

  if (parsed.command === "delete-db") {
    const confirmedDatabaseId = deleteConfirmDatabaseId(parsed);
    rejectExtraPositionals(parsed, 0);
    const inspection = await inspectIcpdbServiceEnvFile(parsed.envFile);
    const targetDatabaseId = requiredNonEmpty(inspection.databaseId ?? "", "service env database id");
    if (confirmedDatabaseId !== targetDatabaseId) {
      throw new Error(`delete confirmation ${confirmedDatabaseId} does not match service env database id ${targetDatabaseId}`);
    }
    const handoff = await databaseHandoffFromEnvFile(parsed.envFile, "delete-db");
    const deleteClient = await createClientFromEnvFile(parsed.envFile);
    await deleteClient.delete();
    printJson({
      deleted: { databaseId: targetDatabaseId },
      ...handoff
    });
    return;
  }

  if (parsed.command === "health") {
    rejectExtraPositionals(parsed, 0);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    printJson(await serviceClient.health());
    return;
  }

  if (parsed.command === "databases") {
    rejectExtraPositionals(parsed, 0);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    printJson(await serviceClient.listDatabases());
    return;
  }

  if (parsed.command === "placements") {
    rejectExtraPositionals(parsed, 0);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    printJson(await serviceClient.listPlacements());
    return;
  }

  if (parsed.command === "all-placements") {
    rejectExtraPositionals(parsed, 0);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    printJson(await serviceClient.listAllPlacements());
    return;
  }

  if (parsed.command === "shards") {
    rejectExtraPositionals(parsed, 0);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    printJson(await serviceClient.listShards());
    return;
  }

  if (parsed.command === "shard-create") {
    const initialCycles = natTextArg(requiredPositional(parsed, 0, "initial cycles"), "initial cycles");
    const maxDatabases = nat16Arg(requiredPositional(parsed, 1, "max databases"), "max databases");
    rejectExtraPositionals(parsed, 2);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    const shard = await serviceClient.createDatabaseShard({ initialCycles, maxDatabases });
    printJson({
      ...shard,
      ...shardInfoNextCommands(shard, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "shard-register") {
    const databaseCanisterId = databaseCanisterIdArg(requiredPositional(parsed, 0, "database canister id"));
    const maxDatabases = nat16Arg(requiredPositional(parsed, 1, "max databases"), "max databases");
    rejectExtraPositionals(parsed, 2);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    const shard = await serviceClient.registerDatabaseShard({ databaseCanisterId, maxDatabases });
    printJson({
      ...shard,
      ...shardInfoNextCommands(shard, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "shard-status") {
    const databaseCanisterId = databaseCanisterIdArg(requiredPositional(parsed, 0, "database canister id"));
    rejectExtraPositionals(parsed, 1);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    const shardStatus = await serviceClient.getShardStatus(databaseCanisterId);
    printJson({
      ...shardStatus,
      ...shardStatusNextCommands(shardStatus, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "shard-top-up") {
    const databaseCanisterId = databaseCanisterIdArg(requiredPositional(parsed, 0, "database canister id"));
    const cycles = natTextArg(requiredPositional(parsed, 1, "cycles"), "cycles");
    rejectExtraPositionals(parsed, 2);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    const shard = await serviceClient.topUpShard(databaseCanisterId, cycles);
    printJson({
      ...shard,
      ...shardInfoNextCommands(shard, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "shard-ops") {
    rejectExtraPositionals(parsed, 0);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    printJson(await serviceClient.listShardOperations());
    return;
  }

  if (parsed.command === "shard-maintain") {
    const request = shardMaintainRequest(parsed);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    const report = await serviceClient.maintainShards(request);
    printJson({
      ...report,
      ...shardMaintenanceNextCommands(report, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "shard-migrate") {
    const databaseId = databaseIdArg(requiredPositional(parsed, 0, "database id"));
    const databaseCanisterId = databaseCanisterIdArg(requiredPositional(parsed, 1, "database canister id"));
    rejectExtraPositionals(parsed, 2);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    const placement = await serviceClient.migrateDatabaseToShard(databaseId, databaseCanisterId);
    printJson({
      ...placement,
      ...shardPlacementNextCommands(placement, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "remote-create-db") {
    const databaseId = databaseIdArg(requiredPositional(parsed, 0, "database id"));
    const databaseCanisterId = databaseCanisterIdArg(requiredPositional(parsed, 1, "database canister id"));
    rejectExtraPositionals(parsed, 2);
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    const database = await serviceClient.createRemoteDatabase({ databaseId, databaseCanisterId });
    printJson({
      ...database,
      ...shardRemoteDatabaseNextCommands(databaseCanisterId, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "shard-reconcile") {
    const operationId = operationIdArg(requiredPositional(parsed, 0, "operation id"));
    const status = shardReconcileStatusArg(requiredPositional(parsed, 1, "status"));
    const reason = parsed.positional.slice(2).join(" ").trim();
    if (status === "applied" && reason) throw new Error("shard-reconcile applied does not accept a failure reason");
    if (status === "failed" && !reason) throw new Error("shard-reconcile failed requires a failure reason");
    const serviceClient = await createIcpdbServiceClientFromEnvFile(parsed.envFile);
    const operation = await serviceClient.reconcileShardOperation({
      operationId,
      status,
      error: status === "failed" ? reason : null
    });
    printJson({
      ...operation,
      ...shardOperationNextCommands(operation, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "url") {
    rejectExtraPositionals(parsed, 0);
    const inspection = await inspectIcpdbServiceEnvFile(parsed.envFile);
    const urlClient = await createClientFromEnvFile(parsed.envFile);
    const databaseId = await urlClient.databaseId();
    const url = await urlClient.url();
    printOutput(parsed.format, {
      ICPDB_CANISTER_ID: inspection.canisterId,
      ICPDB_DATABASE_ID: databaseId,
      ICPDB_URL: url,
      ICPDB_CONNECTION_URL: url,
      ICPDB_SERVICE_PRINCIPAL: inspection.principal,
      ICPDB_NETWORK_URL: inspection.networkUrl
    }, {
      url,
      connectionUrl: url,
      databaseId,
      canisterId: inspection.canisterId,
      principal: inspection.principal,
      networkUrl: inspection.networkUrl
    });
    return;
  }

  if (parsed.command === "info") {
    rejectExtraPositionals(parsed, 0);
    const inspection = await inspectIcpdbServiceEnvFile(parsed.envFile);
    const infoClient = await createClientFromEnvFile(parsed.envFile);
    const info = await infoClient.info();
    const principal = info.principal ?? inspection.principal;
    printOutput(parsed.format, {
      ICPDB_CANISTER_ID: inspection.canisterId,
      ICPDB_DATABASE_ID: info.databaseId,
      ICPDB_URL: info.url,
      ICPDB_CONNECTION_URL: info.connectionUrl,
      ICPDB_SERVICE_PRINCIPAL: principal,
      ICPDB_NETWORK_URL: inspection.networkUrl
    }, {
      ...info,
      canisterId: inspection.canisterId,
      principal,
      networkUrl: inspection.networkUrl
    });
    return;
  }

  if (parsed.command === "shell") {
    await runPackageShell(parsed);
    return;
  }

  const readModeFileSource = await packageReadModeFileSource(parsed);
  const client = await createClientFromEnvFile(parsed.envFile);

  if (parsed.command === "query") {
    const sql = requiredPositional(parsed, 0, "SQL");
    rejectExtraPositionals(parsed, 1);
    printJson(await client.query(sql, sqlParams));
    return;
  }

  if (parsed.command === "execute" || parsed.command === "sql") {
    const sql = requiredPositional(parsed, 0, "SQL");
    rejectExtraPositionals(parsed, 1);
    printJson(await withOptionalWriteWait(client, parsed, await client.execute(sqlClientStatement(sql, sqlParams, parsed.idempotencyKey))));
    return;
  }

  if (parsed.command === "exec") {
    const sql = requiredPositional(parsed, 0, "SQL");
    rejectExtraPositionals(parsed, 1);
    printJson(await withOptionalWriteWait(client, parsed, await client.executeScript(sql, scriptOptions(parsed))));
    return;
  }

  if (parsed.command === "scalar") {
    const sql = requiredPositional(parsed, 0, "SQL");
    rejectExtraPositionals(parsed, 1);
    printJson({ value: await client.scalar(sql, sqlParams) });
    return;
  }

  if (parsed.command === "status") {
    rejectExtraPositionals(parsed, 0);
    printJson(await client.status());
    return;
  }

  if (parsed.command === "stats") {
    rejectExtraPositionals(parsed, 0);
    const status = await client.status();
    printJson({
      databaseId: status.databaseId,
      stats: status.stats,
      tableStatuses: status.tableStatuses
    });
    return;
  }

  if (parsed.command === "usage") {
    rejectExtraPositionals(parsed, 0);
    printJson(await client.getUsage());
    return;
  }

  if (parsed.command === "usage-events") {
    rejectExtraPositionals(parsed, 0);
    printJson(await client.listUsageEvents());
    return;
  }

  if (parsed.command === "placement") {
    rejectExtraPositionals(parsed, 0);
    printJson(await client.placement());
    return;
  }

  if (parsed.command === "tables") {
    rejectExtraPositionals(parsed, 0);
    printJson(await client.tables());
    return;
  }

  if (parsed.command === "views") {
    rejectExtraPositionals(parsed, 0);
    printJson(await client.views());
    return;
  }

  if (parsed.command === "schema") {
    rejectExtraPositionals(parsed, 1);
    printJson({ schema: await client.schema(parsed.positional[0]) });
    return;
  }

  if (parsed.command === "describe") {
    const tableName = requiredPositional(parsed, 0, "table name");
    rejectExtraPositionals(parsed, 1);
    printJson(await client.describe(tableName));
    return;
  }

  if (parsed.command === "columns") {
    const tableName = requiredPositional(parsed, 0, "table name");
    rejectExtraPositionals(parsed, 1);
    printJson(await client.columns(tableName));
    return;
  }

  if (parsed.command === "indexes") {
    const tableName = requiredPositional(parsed, 0, "table name");
    rejectExtraPositionals(parsed, 1);
    printJson(await client.indexes(tableName));
    return;
  }

  if (parsed.command === "triggers") {
    const tableName = requiredPositional(parsed, 0, "table name");
    rejectExtraPositionals(parsed, 1);
    printJson(await client.triggers(tableName));
    return;
  }

  if (parsed.command === "foreign-keys") {
    const tableName = requiredPositional(parsed, 0, "table name");
    rejectExtraPositionals(parsed, 1);
    printJson(await client.foreignKeys(tableName));
    return;
  }

  if (parsed.command === "preview") {
    const tableName = requiredPositional(parsed, 0, "table name");
    rejectExtraPositionals(parsed, 1);
    printJson(await client.preview(tableName, previewOptions(parsed)));
    return;
  }

  if (parsed.command === "inspect") {
    rejectExtraPositionals(parsed, 1);
    const tableName = parsed.positional[0];
    printJson(await client.inspect(inspectOptions(parsed, tableName)));
    return;
  }

  if (parsed.command === "members") {
    rejectExtraPositionals(parsed, 0);
    printJson(await client.listMembers());
    return;
  }

  if (parsed.command === "grant-member") {
    const principal = grantablePrincipalArg(requiredPositional(parsed, 0, "principal"));
    const role = cliDatabaseRole(requiredPositional(parsed, 1, "role"));
    rejectExtraPositionals(parsed, 2);
    await client.grantMember(principal, role);
    printJson({
      granted: { principal, role },
      ...await databaseHandoffFromClient(client, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "revoke-member") {
    const principal = memberPrincipalArg(requiredPositional(parsed, 0, "principal"));
    rejectExtraPositionals(parsed, 1);
    await client.revokeMember(principal);
    printJson({
      revoked: { principal },
      ...await databaseHandoffFromClient(client, parsed.envFile)
    });
    return;
  }

  if (parsed.command === "operation") {
    const operationId = operationIdArg(requiredPositional(parsed, 0, "operation id"));
    rejectExtraPositionals(parsed, 1);
    printJson(await client.getRoutedOperation(operationId));
    return;
  }

  if (parsed.command === "operation-reconcile") {
    const operationId = operationIdArg(requiredPositional(parsed, 0, "operation id"));
    rejectExtraPositionals(parsed, 1);
    printJson(await client.reconcileRoutedOperation(operationId));
    return;
  }

  if (parsed.command === "operation-wait") {
    const operationId = operationIdArg(requiredPositional(parsed, 0, "operation id"));
    rejectExtraPositionals(parsed, 1);
    printJson(await client.waitForRoutedOperation(operationId, waitOptions(parsed)));
    return;
  }

  if (parsed.command === "batch" || parsed.command === "transaction") {
    const file = requiredPositional(parsed, 0, "statements file");
    rejectExtraPositionals(parsed, 1);
    const statements = readModeFileSource?.kind === "batch" ? readModeFileSource.statements : parseBatchStatements(await readInputText(file));
    const options = batchOptions(parsed);
    const result = parsed.command === "batch" ? await client.batch(statements, options) : await client.transaction(statements, options);
    printJson(await withOptionalWriteWait(client, parsed, result));
    return;
  }

  if (parsed.command === "script") {
    const file = requiredPositional(parsed, 0, "SQL file");
    rejectExtraPositionals(parsed, 1);
    const source = readModeFileSource?.kind === "script" ? readModeFileSource.source : await readInputText(file);
    printJson(await withOptionalWriteWait(client, parsed, await client.executeScript(source, scriptOptions(parsed))));
    return;
  }

  if (parsed.command === "load") {
    const file = requiredPositional(parsed, 0, "SQL dump file");
    rejectExtraPositionals(parsed, 1);
    const source = readModeFileSource?.kind === "load" ? readModeFileSource.source : await readInputText(file);
    printJson(await withOptionalWriteWait(client, parsed, await client.loadSqlDump(source, scriptOptions(parsed))));
    return;
  }

  if (parsed.command === "dump") {
    const file = requiredPositional(parsed, 0, "SQL dump file");
    rejectExtraPositionals(parsed, 1);
    const output = await writeOutputText(file, await client.dumpSql());
    if (output === "file") {
      printJson({
        dumped: { file },
        ...await databaseHandoffFromClient(client, parsed.envFile)
      });
    }
    return;
  }

  if (parsed.command === "migrate") {
    const file = requiredPositional(parsed, 0, "migration file");
    rejectExtraPositionals(parsed, 1);
    printJson(await migrateVersioned(client, parsed, parseMigrations(await readInputText(file))));
    return;
  }

  if (parsed.command === "archive") {
    const file = requiredPositional(parsed, 0, "archive file");
    rejectExtraPositionals(parsed, 1);
    const handoff = await databaseHandoffFromEnvFile(parsed.envFile, "archive");
    const archive = await archiveDatabaseToFileFromEnvFile(file, { envPath: parsed.envFile });
    printOutput(parsed.format, {
      ICPDB_CANISTER_ID: handoff.canisterId,
      ICPDB_DATABASE_ID: archive.databaseId,
      ICPDB_URL: handoff.connectionUrl,
      ICPDB_CONNECTION_URL: handoff.connectionUrl,
      ICPDB_SNAPSHOT_FILE: archive.filePath,
      ICPDB_SNAPSHOT_SIZE_BYTES: String(archive.sizeBytes),
      ICPDB_SNAPSHOT_HASH: archive.sha256
    }, {
      ...archive,
      ...handoff,
      ...archiveNextCommands(archive.filePath, parsed.envFile, archive.sha256)
    });
    return;
  }

  if (parsed.command === "restore") {
    const file = requiredPositional(parsed, 0, "snapshot file");
    rejectExtraPositionals(parsed, 1);
    const handoff = await databaseHandoffFromEnvFile(parsed.envFile, "restore");
    const restore = await restoreDatabaseFromFileFromEnvFile(file, {
      envPath: parsed.envFile,
      expectedSha256: parsed.expectedSha256
    });
    printOutput(parsed.format, {
      ICPDB_CANISTER_ID: handoff.canisterId,
      ICPDB_DATABASE_ID: handoff.databaseId,
      ICPDB_URL: handoff.connectionUrl,
      ICPDB_CONNECTION_URL: handoff.connectionUrl,
      ICPDB_SNAPSHOT_FILE: restore.filePath,
      ICPDB_SNAPSHOT_SIZE_BYTES: String(restore.sizeBytes),
      ICPDB_SNAPSHOT_HASH: restore.sha256
    }, {
      ...restore,
      ...handoff,
      ...postRestoreNextCommands(parsed.envFile)
    });
    return;
  }

  throw new Error(`unknown command: ${parsed.command || "<empty>"}`);
}

function packageHandoffEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env.ICPDB_CONNECTION_URL !== undefined || env.ICPDB_URL === undefined) return env;
  return {
    ...env,
    ICPDB_CONNECTION_URL: env.ICPDB_URL
  };
}

async function databaseHandoffFromEnvFile(envFile: string, command: string): Promise<{
  canisterId: string;
  databaseId: string;
  url: string;
  connectionUrl: string;
}> {
  const inspection = await inspectIcpdbServiceEnvFile(envFile);
  if (!inspection.databaseId || !inspection.connectionUrl) {
    throw new Error(`${command} requires a database-bearing service.env`);
  }
  return {
    canisterId: inspection.canisterId,
    databaseId: inspection.databaseId,
    url: inspection.connectionUrl,
    connectionUrl: inspection.connectionUrl
  };
}

async function databaseHandoffFromClient(client: IcpdbSqlClient, envFile: string): Promise<{
  canisterId: string;
  databaseId: string;
  url: string;
  connectionUrl: string;
}> {
  const info = await client.info();
  if (info.canisterId) {
    return {
      canisterId: info.canisterId,
      databaseId: info.databaseId,
      url: info.url,
      connectionUrl: info.connectionUrl
    };
  }
  const inspection = await inspectIcpdbServiceEnvFile(envFile);
  return {
    canisterId: inspection.canisterId,
    databaseId: info.databaseId,
    url: info.url,
    connectionUrl: info.connectionUrl
  };
}

function commandUsage(topics: string[]): string {
  const topic = topics.join(" ").trim();
  if (!topic) return usage();
  if (topic === "quickstart" || topic === "sdk" || topic === "server") return ["Usage:", ...quickstartUsageLines()].join("\n");
  if (topic === "init" || topic === "bootstrap") return ["Usage:", ...initUsageLines()].join("\n");
  if (topic === "provision-service") return ["Usage:", ...provisionServiceUsageLines()].join("\n");
  if (topic === "lifecycle" || topic === "database" || topic === "db") return ["Usage:", ...lifecycleUsageLines()].join("\n");
  if (topic === "databases" || topic === "list-databases" || topic === "delete-db" || topic === "usage" || topic === "usage-events" || topic === "placement") return ["Usage:", ...databaseOpsUsageLines()].join("\n");
  if (topic === "sql") return ["Usage:", ...sqlUsageLines()].join("\n");
  if (topic === "query" || topic === "read" || topic === "select" || topic === "scalar") return ["Usage:", ...readSqlUsageLines()].join("\n");
  if (topic === "execute" || topic === "write") return ["Usage:", ...writeSqlUsageLines()].join("\n");
  if (topic === "exec" || topic === "script-sql") return ["Usage:", ...execUsageLines()].join("\n");
  if (topic === "batch" || topic === "transaction" || topic === "statements" || topic === "script" || topic === "load" || topic === "dump") return ["Usage:", ...statementFileUsageLines()].join("\n");
  if (topic === "migrate" || topic === "migration" || topic === "migrations") return ["Usage:", ...migrateUsageLines()].join("\n");
  if (topic === "inspect") return ["Usage:", ...inspectUsageLines()].join("\n");
  if (topic === "schema" || topic === "table" || topic === "tables" || topic === "views" || topic === "describe" || topic === "columns" || topic === "indexes" || topic === "triggers" || topic === "foreign-keys" || topic === "preview") return ["Usage:", ...schemaUsageLines()].join("\n");
  if (topic === "status") return ["Usage:", ...statusUsageLines()].join("\n");
  if (topic === "stats") return ["Usage:", ...statsUsageLines()].join("\n");
  if (topic === "health" || topic === "canister-health") return ["Usage:", ...healthUsageLines()].join("\n");
  if (topic === "inspect-env" || topic === "diagnose-env") return ["Usage:", ...inspectEnvUsageLines()].join("\n");
  if (topic === "principal" || topic === "whoami") return ["Usage:", ...principalUsageLines()].join("\n");
  if (topic === "url" || topic === "connection" || topic === "connection-url") return ["Usage:", ...urlUsageLines()].join("\n");
  if (topic === "info" || topic === "handoff") return ["Usage:", ...infoUsageLines()].join("\n");
  if (topic === "service-env" || topic === "env") return ["Usage:", ...serviceEnvUsageLines()].join("\n");
  if (topic === "check-env" || topic === "check") return ["Usage:", ...checkEnvUsageLines()].join("\n");
  if (topic === "generate-identity" || topic === "identity") return ["Usage:", ...generateIdentityUsageLines()].join("\n");
  if (topic === "permissions" || topic === "auth") return ["Usage:", ...permissionsUsageLines()].join("\n");
  if (topic === "token" || topic === "tokens" || topic === "bearer-token" || topic === "bearer-tokens" || topic === "http" || topic === "curl") return ["Usage:", ...tokenUsageLines()].join("\n");
  if (topic === "members" || topic === "member" || topic === "grant-member" || topic === "revoke-member" || topic === "acl") return ["Usage:", ...membersUsageLines()].join("\n");
  if (topic === "backup" || topic === "archive" || topic === "restore" || topic === "snapshot" || topic === "snapshot-info") return ["Usage:", ...backupUsageLines()].join("\n");
  if (topic === "operation" || topic === "operations" || topic === "operation-wait" || topic === "operation-reconcile" || topic === "routed-operation" || topic === "routed-operations") return ["Usage:", ...operationUsageLines()].join("\n");
  if (topic === "shell") return packageShellUsage();
  if (topic.startsWith("shell ")) return packageShellUsage(topic.slice("shell ".length));
  if (topic === "ops" || topic === "shard" || topic === "shards" || topic === "sharding" || topic === "controller" || topic === "controllers" || topic === "placements" || topic === "all-placements" || topic === "shard-create" || topic === "shard-register" || topic === "shard-status" || topic === "shard-top-up" || topic === "shard-ops" || topic === "shard-maintain" || topic === "shard-migrate" || topic === "remote-create-db" || topic === "shard-reconcile") return ["Usage:", ...opsUsageLines()].join("\n");
  if (topic === "create-db") return ["Usage:", ...createDbUsageLines()].join("\n");
  const matches = usage().split("\n").filter((line) => lineMatchesCommand(line, topic));
  if (matches.length > 0) return ["Usage:", ...matches].join("\n");
  throw new Error(`unknown help command: ${topic}`);
}

function quickstartUsageLines(): string[] {
  return [
    "  # App SDK shortest path",
    "  import { AuthClient } from \"@icp-sdk/auth/client\";",
    "  import { createClient, sql } from \"@icpdb/client\";",
    "  // Browser/II apps can import the same browser-safe client from \"@icpdb/client/browser\".",
    "  // Hosted SQLite apps can use the explicit SQL DB import path: import { createSqliteClient, sql as sqliteSql, type SqliteRow } from \"@icpdb/client/sqlite\";",
    "  const DELEGATION_TTL_NS = BigInt(8) * BigInt(3_600_000_000_000);",
    "  const host = window.location.hostname;",
    "  const identityProvider = host === \"localhost\" || host === \"127.0.0.1\" || host.endsWith(\".localhost\")",
    "    ? \"http://id.ai.localhost:8000\"",
    "    : \"https://id.ai\";",
    "  const authClient = await AuthClient.create();",
    "  if (!(await authClient.isAuthenticated())) {",
    "    await new Promise<void>((resolve, reject) => {",
    "      authClient.login({",
    "        identityProvider,",
    "        maxTimeToLive: DELEGATION_TTL_NS,",
    "        onSuccess: () => resolve(),",
    "        onError: (error) => reject(new Error(error ?? \"Internet Identity login failed\"))",
    "      });",
    "    });",
    "  }",
    "  const identity = authClient.getIdentity();",
    "  const db = createClient({ canisterId: \"<id>\", identity, setupSql: \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" });",
    "  await db.execute(sql`INSERT INTO notes(body) VALUES (${\"hello\"})`);",
    "  const result = await db.query(\"SELECT id, body FROM notes ORDER BY id DESC\");",
    "  console.log(result.rows);",
    "  console.log(await db.connectionUrl());",
    "  console.log(await db.info());",
    "",
    "  # Hosted SQLite subpath; same client shape with explicit SQL DB import",
    "  import { createSqliteClient, sql as sqliteSql, type SqliteRow } from \"@icpdb/client/sqlite\";",
    "  const sqliteDb = createSqliteClient({ canisterId: \"<id>\", identity, setupSql: \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" });",
    "  await sqliteDb.execute(sqliteSql`INSERT INTO notes(body) VALUES (${\"from-sqlite\"})`);",
    "  const sqliteRows: SqliteRow[] = (await sqliteDb.query(\"SELECT id, body FROM notes ORDER BY id DESC\")).rows;",
    "  console.log(sqliteRows);",
    "  console.log(await sqliteDb.connectionUrl());",
    "",
    "  # libSQL-shaped migration edge; keep SQL calls, replace connection/auth with IC identity",
    "  import { createLibsqlClient } from \"@icpdb/client/libsql\";",
    "  const libsqlDb = createLibsqlClient({ url: \"icpdb://<id>/<database-id>\", identity });",
    "  await libsqlDb.execute({ sql: \"INSERT INTO notes(body) VALUES (:body)\", args: { body: \"from-libsql\" } });",
    "  const libsqlResult = await libsqlDb.execute(\"SELECT id, body FROM notes ORDER BY id DESC\");",
    "  console.log(libsqlResult.rows);",
    "  libsqlDb.close();",
    "",
    "  # One-command service.env and DB bootstrap when starting from an installed SDK",
    "  icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --format table",
    "  icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-file ./schema.sql --format table",
    "  icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-migrations-file ./migrations.json --format table",
    "  # The table/json/csv output includes nextInspectEnvCommand, nextExecuteCommand, nextInsertCommand, nextQueryCommand, nextReadCommand, nextSqlSmokeCommand, nextSchemaCountCommand, nextTablesCommand, nextViewsCommand, nextStatsCommand, nextSchemaCommand, nextDescribeCommand, nextPreviewCommand, nextStatusCommand, nextMembersCommand, nextUrlCommand, and nextInfoCommand",
    "  # Canister-only service.env without setup SQL can still create and persist an empty DB on first scalar:",
    "  icpdb generate-identity --canister-id <id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb scalar \"SELECT 1 AS value\" --format table",
    "  icpdb execute \"CREATE TABLE readiness_query_only(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --idempotency-key readiness-query-only-create-table-001 --wait --format table",
    "  icpdb execute \"INSERT INTO readiness_query_only(body) VALUES (?1)\" --params '[\"readiness-query-only\"]' --idempotency-key readiness-query-only-write-001 --wait --format table",
    "  icpdb query \"SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1\" --format table",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Server/CI SDK shortest path after init",
    "  import { createClientFromEnvFile } from \"@icpdb/client/server\";",
    "  const ciDb = await createClientFromEnvFile();",
    "  await ciDb.execute(\"INSERT INTO notes(body) VALUES (?1)\", [\"from-ci\"]);",
    "  const ciResult = await ciDb.query(\"SELECT id, body FROM notes ORDER BY id DESC\");",
    "  console.log(ciResult.rows);",
    "  console.log(await ciDb.connectionUrl());",
    "  console.log(await ciDb.info());",
    "  const ciDbFromPath = await createClientFromEnvFile(\"./ci/service.env\");",
    "  console.log(await ciDbFromPath.info());",
    "",
    "  # Server/CI CLI shortest path after init",
    "  icpdb inspect-env --format table",
    "  icpdb sql \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]' --idempotency-key ci-sql-insert-001 --wait --format table",
    "  icpdb sql \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "",
    "  # Explicit query/execute are useful when CI logs should separate reads and writes",
    "  icpdb execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]' --idempotency-key ci-notes-insert-001 --wait --format table",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  icpdb scalar \"SELECT count(*) FROM notes\" --format table",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb stats --format table",
    "  icpdb schema notes --format table",
    "  icpdb describe notes --format table",
    "  icpdb columns notes --format table",
    "  icpdb indexes notes --format table",
    "  icpdb triggers notes --format table",
    "  icpdb foreign-keys notes --format table",
    "  icpdb preview notes --limit 25 --format table",
    "  icpdb inspect notes --format table",
    "  icpdb status --format table",
    "  icpdb members --format table",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Optional owner backup check",
    "  icpdb archive ./backup.sqlite --format env",
    "  icpdb snapshot-info ./backup.sqlite --format table",
    "  icpdb restore ./backup.sqlite --expect-snapshot-hash <sha256> --format table",
    "  icpdb scalar \"SELECT count(*) FROM notes\" --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Existing DB with an owner service env",
    "  icpdb provision-service <database-id> writer --service-env-file owner.env --env-out service.env --format table",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "  icpdb status --format table",
    "  icpdb scalar \"SELECT count(*) FROM sqlite_schema\" --format table",
    "  # For archive/restore or final proof on the same existing DB, provision owner instead",
    "  icpdb provision-service <database-id> owner --service-env-file owner.env --env-out service.env --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Existing browser/II DB handoff",
    "  # Copy the console Response sidebar Connection URL first; use its database id in <database-id>",
    "  icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb principal --format table",
    "  icpdb inspect-env --format table",
    "  # Grant the printed service principal in console Permissions while logged in with browser/II",
    "  # Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access",
    "  # Browser/II and Server/CI principals stay different and are joined through the DB ACL",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "  icpdb status --format table",
    "  icpdb scalar \"SELECT count(*) FROM sqlite_schema\" --format table",
    "  icpdb stats --format table",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb schema --format table",
    "  icpdb describe <table> --format table",
    "  icpdb columns <table> --format table",
    "  icpdb indexes <table> --format table",
    "  icpdb triggers <table> --format table",
    "  icpdb foreign-keys <table> --format table",
    "  icpdb preview <table> --limit 25 --format table",
    "  icpdb inspect --format table",
    "  icpdb members --format table",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Use --service-env-file only when the handoff file is not cwd-local service.env",
    "  icpdb query \"SELECT 1\" --service-env-file ./ci/service.env"
  ];
}

function initUsageLines(): string[] {
  return [
    "  # Create service.env, create the first DB, run setup, and persist the DB id",
    "  # --env-out writes a new owner-only file and refuses to overwrite existing files",
    "  icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --format table",
    "  icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-file ./schema.sql --format env",
    "  icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-statements-file ./setup-statements.json --format env",
    "  icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-migrations-file ./migrations.json --format env",
    "  # Use --format table/json/csv when CI logs should include nextInspectEnvCommand, nextExecuteCommand, nextInsertCommand, nextQueryCommand, nextReadCommand, nextSqlSmokeCommand, nextSchemaCountCommand, nextTablesCommand, nextViewsCommand, nextStatsCommand, nextSchemaCommand, nextDescribeCommand, nextPreviewCommand, nextStatusCommand, nextMembersCommand, nextUrlCommand, and nextInfoCommand",
    "",
    "  # Verify and reuse the generated cwd-local service.env immediately",
    "  icpdb inspect-env --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "  icpdb execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]' --idempotency-key ci-notes-insert-001 --wait --format table",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  icpdb scalar \"SELECT count(*) FROM notes\" --format table",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb stats --format table",
    "  icpdb schema notes --format table",
    "  icpdb describe notes --format table",
    "  icpdb columns notes --format table",
    "  icpdb indexes notes --format table",
    "  icpdb triggers notes --format table",
    "  icpdb foreign-keys notes --format table",
    "  icpdb preview notes --limit 25 --format table",
    "  icpdb inspect notes --format table",
    "  icpdb status --format table",
    "  icpdb url --format env",
    "  icpdb info --format env"
  ];
}

function provisionServiceUsageLines(): string[] {
  return [
    "  # Existing DB with an owner service env",
    "  # Creates a new dedicated database-bearing service.env and grants it on that DB",
    "  icpdb provision-service <database-id> writer --service-env-file owner.env --env-out service.env --format table",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "",
    "  # Owner role is required for archive/restore and final release proof",
    "  icpdb provision-service <database-id> owner --service-env-file owner.env --env-out service.env --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Browser/II-owned DBs cannot share a private key; generate then grant in console",
    "  # Copy the console Response sidebar Connection URL first; use its database id in <database-id>",
    "  icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb principal --format table",
    "  icpdb inspect-env --format table",
    "  # Grant the printed service principal in console Permissions, then verify:",
    "  # Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access",
    "  # Browser/II and Server/CI principals stay different and are joined through the DB ACL",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table"
  ];
}

function lifecycleUsageLines(): string[] {
  return [
    "  # Database lifecycle from canister-only service.env",
    "  icpdb inspect-env --format table",
    "  icpdb create-db --setup-sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --format table",
    "  icpdb create-db --setup-file ./schema.sql --format env",
    "  icpdb inspect-env --format table",
    "  icpdb databases --format table",
    "",
    "  # Verify the created DB with the same persisted service.env",
    "  icpdb execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]' --idempotency-key ci-notes-insert-001 --wait",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  icpdb scalar \"SELECT count(*) FROM notes\" --format table",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb stats --format table",
    "  icpdb schema notes --format table",
    "  icpdb describe notes --format table",
    "  icpdb columns notes --format table",
    "  icpdb indexes notes --format table",
    "  icpdb triggers notes --format table",
    "  icpdb foreign-keys notes --format table",
    "  icpdb preview notes --limit 25 --format table",
    "  icpdb inspect notes --format table",
    "  icpdb status --format table",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Guarded cleanup requires a database-bearing service.env and matching confirmation",
    "  icpdb delete-db --confirm <database-id> --format table",
    "",
    "  # Non-default handoff files use --service-env-file explicitly",
    "  icpdb databases --service-env-file ./ci/service.env --format table",
    "  icpdb delete-db --confirm <database-id> --service-env-file ./ci/service.env --format table"
  ];
}

function databaseOpsUsageLines(): string[] {
  return [
    "  # Database inventory and selected-DB health",
    "  icpdb databases --format table",
    "  icpdb status --format table",
    "  icpdb usage --format table",
    "  icpdb usage-events --format table",
    "  icpdb placement --format table",
    "",
    "  # Reusable handoff fields before sharing a DB id",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Guarded cleanup requires a database-bearing service.env and matching confirmation",
    "  icpdb delete-db --confirm <database-id> --format table",
    "",
    "  # Non-default Server/CI env file",
    "  icpdb databases --service-env-file ./ci/service.env --format table",
    "  icpdb delete-db --confirm <database-id> --service-env-file ./ci/service.env --format table"
  ];
}

function sqlUsageLines(): string[] {
  return [
    "  # Read SQL",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  icpdb scalar \"SELECT count(*) FROM notes\" --format table",
    "  icpdb query \"SELECT body FROM notes WHERE body = :body\" --params '{\"body\":\"hello\"}' --format table",
    "  icpdb query \"SELECT body FROM notes WHERE body = :body\" --params-file ./params.json --format table",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format csv",
    "",
    "  # Auto-routed SQL uses query for reads and execute for writes",
    "  icpdb sql \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  # Read-routed sql rejects --idempotency-key and --wait before service.env or params files load",
    "",
    "  # Write SQL; use idempotency keys and --wait for remote shard retries",
    "  icpdb execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]' --idempotency-key ci-notes-insert-001 --wait",
    "  icpdb sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)\" --idempotency-key ci-schema-001 --wait",
    "  icpdb exec \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes(body) VALUES ('hello')\" --idempotency-key ci-exec-001 --wait",
    "  icpdb batch ./statements.json --mode write --idempotency-key ci-batch-001 --wait",
    "  icpdb transaction ./transaction.json --mode write --idempotency-key ci-transaction-001 --wait",
    "  icpdb script ./schema.sql --mode write --idempotency-key ci-script-001 --wait",
    "  icpdb migrate ./migrations.json --idempotency-key ci-migrate-001 --wait",
    "",
    "  # Reader-role script checks route through query and reject writes before send",
    "  icpdb script ./read-check.sql --mode read --format csv"
  ];
}

function readSqlUsageLines(): string[] {
  return [
    "  # Read SQL through query calls",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  icpdb scalar \"SELECT count(*) FROM notes\" --format table",
    "  icpdb query \"SELECT body FROM notes WHERE body = :body\" --params '{\"body\":\"hello\"}' --format table",
    "  icpdb query \"SELECT body FROM notes WHERE body = :body\" --params-file ./params.json --format table",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format csv",
    "",
    "  # Auto-routed read SQL",
    "  icpdb sql \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  # Read-routed sql rejects --idempotency-key and --wait before service.env or params files load",
    "",
    "  # Non-default Server/CI env file",
    "  icpdb query \"SELECT count(*) AS total FROM sqlite_schema\" --service-env-file ./ci/service.env --format table"
  ];
}

function writeSqlUsageLines(): string[] {
  return [
    "  # Write SQL through execute calls",
    "  icpdb execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]' --idempotency-key ci-notes-insert-001 --wait --format table",
    "  icpdb execute \"UPDATE notes SET body = :body WHERE id = :id\" --params '{\"id\":1,\"body\":\"updated\"}' --idempotency-key ci-notes-update-001 --wait --format table",
    "",
    "  # Auto-routed write SQL and script-style writes",
    "  icpdb sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)\" --idempotency-key ci-schema-001 --wait --format table",
    "  icpdb exec \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes(body) VALUES ('hello')\" --idempotency-key ci-exec-001 --wait --format table",
    "  icpdb batch ./statements.json --mode write --idempotency-key ci-batch-001 --wait --format table",
    "  icpdb transaction ./transaction.json --mode write --idempotency-key ci-transaction-001 --wait --format table",
    "  icpdb script ./schema.sql --mode write --idempotency-key ci-script-001 --wait --format table",
    "",
    "  # Non-default Server/CI env file",
    "  icpdb execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"from-ci\"]' --service-env-file ./ci/service.env --idempotency-key ci-notes-insert-002 --wait --format table"
  ];
}

function execUsageLines(): string[] {
  return [
    "  # Inline SQL script; file-backed scripts use `icpdb script <file|->`",
    "  icpdb exec \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes(body) VALUES ('hello')\" --idempotency-key ci-exec-001 --wait --format table",
    "  icpdb exec \"SELECT id, body FROM notes ORDER BY id DESC; SELECT count(*) FROM notes\" --mode read --format table",
    "",
    "  # Reader-role exec checks reject writes before sending",
    "  icpdb exec \"SELECT count(*) FROM sqlite_schema\" --mode read --format csv"
  ];
}

function statementFileUsageLines(): string[] {
  return [
    "  # JSON statement files for parameterized batches",
    "  icpdb batch ./statements.json --mode write --idempotency-key ci-batch-001 --wait --format table",
    "  icpdb transaction ./transaction.json --mode write --idempotency-key ci-transaction-001 --wait --format table",
    "  icpdb batch ./read-statements.json --mode read --format table",
    "",
    "  # SQL files and stdin",
    "  icpdb script ./schema.sql --mode write --idempotency-key ci-schema-001 --wait --format table",
    "  icpdb script ./read-check.sql --mode read --format csv",
    "  icpdb script - --mode write --idempotency-key ci-stdin-script-001 --wait --format table",
    "",
    "  # SQL dump export and import",
    "  icpdb dump ./dump.sql --format table",
    "  icpdb load ./dump.sql --mode write --idempotency-key ci-load-001 --wait --format table",
    "",
    "  # Non-default Server/CI env file",
    "  icpdb batch ./statements.json --mode write --service-env-file ./ci/service.env --idempotency-key ci-batch-002 --wait --format table"
  ];
}

function migrateUsageLines(): string[] {
  return [
    "  # migrations.json is a JSON array of { version, name?, sql } entries",
    "  icpdb migrate ./migrations.json --idempotency-key ci-migrate-001 --wait --format table",
    "  icpdb query \"SELECT version, name FROM icpdb_schema_migrations ORDER BY version\" --format table",
    "  icpdb schema --format table",
    "",
    "  # First DB creation can also run setup migrations from a canister-only service.env",
    "  icpdb inspect-env --format table",
    "  icpdb create-db --setup-migrations-file ./migrations.json --format env",
    "  icpdb query \"SELECT version, name FROM icpdb_schema_migrations ORDER BY version\" --format table",
    "",
    "  # Reader-role migration file checks should use script/read SQL, not migrate",
    "  icpdb script ./read-check.sql --mode read --format table"
  ];
}

function inspectUsageLines(): string[] {
  return [
    "  # Connection and role",
    "  icpdb inspect-env --format env",
    "  icpdb status --format table",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Schema and table shape",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb schema --format table",
    "  icpdb schema notes --format table",
    "  icpdb stats --format table",
    "  icpdb columns notes --format table",
    "  icpdb indexes notes --format table",
    "  icpdb triggers notes --format table",
    "  icpdb foreign-keys notes --format table",
    "  icpdb preview notes --limit 25 --offset 0 --format table",
    "  icpdb inspect notes --limit 25 --format table",
    "",
    "  # Operations and usage",
    "  icpdb members --format table",
    "  icpdb usage --format table",
    "  icpdb usage-events --format table",
    "  icpdb placement --format table",
    "  icpdb operation <operation-id> --format table",
    "  icpdb operation-wait <operation-id> --reconcile-unknown --format table"
  ];
}

function schemaUsageLines(): string[] {
  return [
    "  # Schema and table catalog",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb schema --format table",
    "  icpdb schema notes --format table",
    "  icpdb describe notes --format table",
    "",
    "  # Per-table shape",
    "  icpdb columns notes --format table",
    "  icpdb indexes notes --format table",
    "  icpdb triggers notes --format table",
    "  icpdb foreign-keys notes --format table",
    "  icpdb preview notes --limit 25 --offset 0 --format table",
    "  icpdb inspect notes --limit 25 --format table",
    "",
    "  # CI export and non-default env file",
    "  icpdb tables --format csv",
    "  icpdb schema notes --service-env-file ./ci/service.env --format table"
  ];
}

function statusUsageLines(): string[] {
  return [
    "  # DB health, caller role, connection URL, placement, usage, and table stats",
    "  icpdb status --format table",
    "  icpdb status --format json",
    "  icpdb status --format csv",
    "",
    "  # Nearby DB-shape checks for Server/CI readiness",
    "  icpdb members --format table",
    "  icpdb scalar \"SELECT count(*) FROM sqlite_schema\" --format table",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb schema --format table",
    "  icpdb stats --format table",
    "  icpdb inspect --format table",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Role-specific smoke checks before CI promotion",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Non-default Server/CI env file",
    "  icpdb status --service-env-file ./ci/service.env --format table"
  ];
}

function statsUsageLines(): string[] {
  return [
    "  # DB aggregate and table stats",
    "  icpdb stats --format table",
    "  icpdb stats --format json",
    "  icpdb stats --format csv",
    "",
    "  # Nearby shape checks",
    "  icpdb status --format table",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb inspect --format table",
    "",
    "  # Non-default Server/CI env file",
    "  icpdb stats --service-env-file ./ci/service.env --format table"
  ];
}

function healthUsageLines(): string[] {
  return [
    "  # Control canister health without selecting or creating a DB",
    "  icpdb health --format table",
    "  icpdb health --format json",
    "  icpdb health --format csv",
    "",
    "  # Canister-only controller.env before shard operations",
    "  icpdb inspect-env --service-env-file controller.env --format table",
    "  icpdb health --service-env-file controller.env --format table",
    "  icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller.env --format table",
    "",
    "  # Non-default Server/CI env file",
    "  icpdb health --service-env-file ./ci/service.env --format table"
  ];
}

function inspectEnvUsageLines(): string[] {
  return [
    "  # Local-only service.env diagnosis before any canister call",
    "  # Checks owner-only file mode, connection URL, setup fields, and derived service principal",
    "  icpdb inspect-env --format table",
    "  icpdb inspect-env --format env",
    "",
    "  # Database-bearing service.env should print database_id and connection_url",
    "  icpdb url --format env",
    "  icpdb check-env --require-role writer --format table",
    "",
    "  # Canister-only service.env can create/persist on first url/info/sql call",
    "  icpdb info --format env",
    "  # Use create-db when the first DB needs setup SQL",
    "  icpdb create-db --setup-sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --format env",
    "  icpdb inspect-env --format table",
    "",
    "  # Canister-only controller.env is diagnosed locally before shard controller checks",
    "  icpdb inspect-env --service-env-file controller.env --format table",
    "  icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller.env --format table",
    "",
    "  # Use --service-env-file only when the handoff file is not cwd-local service.env",
    "  icpdb inspect-env --service-env-file ./ci/service.env --format table"
  ];
}

function principalUsageLines(): string[] {
  return [
    "  # Print the exact service principal loaded from service.env without a canister call",
    "  icpdb inspect-env --format table",
    "  icpdb principal --format table",
    "  icpdb principal --format env",
    "",
    "  # Browser/II-owned DB handoff: grant this service principal in console Permissions",
    "  # Browser/II and Server/CI principals stay different; join them through the DB ACL",
    "  # Console: Permissions -> Member principal -> paste principal -> choose writer/owner -> Grant member access",
    "  icpdb members --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Owner service env can grant the printed principal without browser interaction",
    "  icpdb grant-member <service-principal> writer --format table",
    "  icpdb grant-member <service-principal> owner --format table",
    "  icpdb revoke-member <service-principal> --format table",
    "",
    "  # Canister-only controller.env principal is for canister controller grants, not DB ACLs",
    "  icpdb principal --service-env-file controller.env --format table",
    "  eval \"$(icpdb principal --service-env-file controller.env --format env)\" && icp canister settings update -n ic <id> --add-controller \"$ICPDB_SERVICE_PRINCIPAL\" -f",
    "",
    "  # Use --service-env-file only when the handoff file is not cwd-local service.env",
    "  icpdb principal --service-env-file ./ci/service.env --format table"
  ];
}

function urlUsageLines(): string[] {
  return [
    "  # Print the reusable icpdb://<canister-id>/<database-id> connection URL",
    "  icpdb inspect-env --format table",
    "  icpdb url --format env",
    "  icpdb status --format table",
    "",
    "  # Reconnect from that DB URL in app code",
    "  import { connectClient } from \"@icpdb/client\";",
    "  const connectionUrl = \"icpdb://<canister-id>/<database-id>\";",
    "  const db = connectClient({ connectionUrl, identity });",
    "  console.log(await db.all(\"SELECT name FROM sqlite_schema ORDER BY name\"));",
    "",
    "  # Reconnect from a DB-bearing cwd-local service.env in Server/CI",
    "  import { connectClientFromEnvFile } from \"@icpdb/client/server\";",
    "  const ciDb = await connectClientFromEnvFile();",
    "  console.log(await ciDb.url());",
    "  console.log(await ciDb.all(\"SELECT name FROM sqlite_schema ORDER BY name\"));",
    "",
    "  # Canister-only service.env creates and persists a DB id on first URL handoff",
    "  icpdb info --format env",
    "  # Use create-db when the first DB needs setup SQL",
    "  icpdb create-db --setup-sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --format env",
    "  icpdb url --format env",
    "",
    "  # Use --service-env-file only when the handoff file is not cwd-local service.env",
    "  icpdb url --service-env-file ./ci/service.env --format env"
  ];
}

function infoUsageLines(): string[] {
  return [
    "  # Print one Server/CI handoff object; can create/persist DB id from canister-only service.env",
    "  icpdb inspect-env --format table",
    "  icpdb info --format table",
    "  icpdb info --format env",
    "",
    "  # CI can persist ICPDB_DATABASE_ID, ICPDB_URL, ICPDB_CONNECTION_URL, and ICPDB_SERVICE_PRINCIPAL from env output",
    "  icpdb check-env --require-role writer --format table",
    "  icpdb query \"SELECT name FROM sqlite_schema ORDER BY name\" --format table",
    "  icpdb scalar \"SELECT count(*) FROM sqlite_schema\" --format table",
    "",
    "  # App SDK mirrors this with client.info() after createClient(...)",
    "  import { createClient } from \"@icpdb/client\";",
    "  const db = createClient({ canisterId: \"<id>\", identity, setupSql: \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" });",
    "  console.log(await db.info());",
    "",
    "  # Use --service-env-file only when the handoff file is not cwd-local service.env",
    "  icpdb info --service-env-file ./ci/service.env --format env"
  ];
}

function serviceEnvUsageLines(): string[] {
  return [
    "  # Generate an owner-only service.env before Server/CI commands",
    "  # --env-out writes a new owner-only file and refuses to overwrite existing files",
    "  icpdb generate-identity --canister-id <id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb inspect-env --format table",
    "  icpdb check-env --skip-call --format table",
    "",
    "  # Local service.env diagnosis and handoff fields",
    "  icpdb inspect-env --format table",
    "  icpdb check-env --require-role writer --format table",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "  icpdb check-env --require-role writer --smoke-sdk --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "  icpdb principal --format table",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "  icpdb status --format table",
    "",
    "  # Canister-only controller.env checks shard controller calls",
    "  icpdb generate-identity --canister-id <id> --network-url https://icp-api.io --env-out controller.env --format table",
    "  icpdb principal --service-env-file controller.env --format table",
    "  eval \"$(icpdb principal --service-env-file controller.env --format env)\" && icp canister settings update -n ic <id> --add-controller \"$ICPDB_SERVICE_PRINCIPAL\" -f",
    "  icpdb inspect-env --service-env-file controller.env --format table",
    "  icpdb health --service-env-file controller.env --format table",
    "  icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller.env --format table",
    "",
    "  # Canister-only service.env can create/persist on first info/url/sql call",
    "  icpdb info --format env",
    "  # Use create-db when the first DB needs setup SQL",
    "  icpdb create-db --setup-sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --format env",
    "  icpdb create-db --setup-file ./schema.sql --format env",
    "  icpdb inspect-env --format table",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "",
    "  # Use --service-env-file only when the handoff file is not cwd-local service.env",
    "  icpdb inspect-env --service-env-file ./ci/service.env --format table",
    "  icpdb principal --service-env-file ./ci/service.env --format table",
    "  icpdb status --service-env-file ./ci/service.env --format table",
    "  icpdb url --service-env-file ./ci/service.env --format env",
    "  icpdb info --service-env-file ./ci/service.env --format env"
  ];
}

function checkEnvUsageLines(): string[] {
  return [
    "  # Local-only service.env shape and principal check",
    "  icpdb check-env --skip-call --format table",
    "",
    "  # Database-bearing service.env canister-visible role check",
    "  icpdb check-env --require-role reader --format table",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "  icpdb check-env --require-role writer --smoke-sdk --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Canister-only controller.env shard operation check",
    "  icpdb generate-identity --canister-id <id> --network-url https://icp-api.io --env-out controller.env --format table",
    "  icpdb principal --service-env-file controller.env --format table",
    "  eval \"$(icpdb principal --service-env-file controller.env --format env)\" && icp canister settings update -n ic <id> --add-controller \"$ICPDB_SERVICE_PRINCIPAL\" -f",
    "  icpdb inspect-env --service-env-file controller.env --format table",
    "  icpdb health --service-env-file controller.env --format table",
    "  icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller.env --format table",
    "",
    "  # Browser/II DB handoff after console grants the generated service principal",
    "  # Copy the console Response sidebar Connection URL first; use its database id in <database-id>",
    "  icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb principal --format table",
    "  # Grant that service principal in console Permissions, then verify:",
    "  # Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Use --service-env-file only when the handoff file is not cwd-local service.env",
    "  icpdb check-env --service-env-file ./ci/service.env --require-role writer --format table"
  ];
}

function generateIdentityUsageLines(): string[] {
  return [
    "  # Create a dedicated Server/CI service identity without reading service.env",
    "  # --env-out writes a new owner-only file and refuses to overwrite existing files",
    "  icpdb generate-identity --canister-id <id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb generate-identity --identity-type secp256k1 --format env",
    "",
    "  # Browser/II DB handoff: grant the printed service principal in console Permissions",
    "  # Copy the console Response sidebar Connection URL first; use its database id in <database-id>",
    "  # Browser/II principal and generated Server/CI service principal are different",
    "  # Join them through the DB ACL; do not share browser private keys",
    "  # Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access",
    "  icpdb principal --format table",
    "  icpdb inspect-env --format table",
    "  icpdb status --format table",
    "  icpdb members --format table",
    "  icpdb scalar \"SELECT count(*) FROM sqlite_schema\" --format table"
  ];
}

function permissionsUsageLines(): string[] {
  return [
    "  # Browser/II-owned DB handoff after generating service.env",
    "  # Copy the console Response sidebar Connection URL first; use its database id in <database-id>",
    "  icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb principal --format table",
    "  icpdb inspect-env --format table",
    "  # Browser/II principal and Server/CI service principal are intentionally different",
    "  # Do not share private keys; grant the service principal through the DB ACL",
    "  # Grant that service principal in console Permissions as writer or owner",
    "  # Console: Permissions -> Member principal -> paste principal -> choose writer/owner -> Grant member access",
    "  # Verify writer or owner grant for normal Server/CI SQL",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "  icpdb status --format table",
    "  icpdb members --format table",
    "  icpdb scalar \"SELECT count(*) FROM sqlite_schema\" --format table",
    "  icpdb stats --format table",
    "",
    "  # Owner grant can also prove archive/restore",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Owner service.env can manage ACL members for Server/CI identities",
    "  icpdb grant-member <service-principal> writer --format table",
    "  icpdb grant-member <service-principal> owner --format table",
    "  icpdb revoke-member <service-principal> --format table",
    "  icpdb members --format table",
    "",
    "  # Backup and restore require owner role, not writer",
    "  icpdb status --format table",
    "  icpdb archive ./backup.sqlite --format env"
  ];
}

function tokenUsageLines(): string[] {
  return [
    "  # Normal Server/CI path: service identity, not a database bearer token",
    "  icpdb init --canister-id <id> --network-url https://icp-api.io --env-out service.env --setup-sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --format table",
    "  icpdb inspect-env --format table",
    "  icpdb principal --format table",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Browser/II-owned DB handoff: grant the generated service principal through the DB ACL",
    "  icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https://icp-api.io --env-out service.env --format table",
    "  icpdb principal --format table",
    "  # Console: Permissions -> Member principal -> paste principal -> choose writer/owner -> Grant member access",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "",
    "  # Optional bearer-token HTTP surface, outside the package icpdb Server/CI path",
    "  node scripts/icpdb-http.mjs help",
    "  node scripts/icpdb-http.mjs help shell sql",
    "  node scripts/icpdb-http.mjs --network-url https://icp-api.io --canister-id <canister-id> create-db owner",
    "",
    "  # Keep database bearer tokens for curl-compatible external HTTP clients, browser token sessions, or short-lived sharing.",
    "  # The package icpdb CLI intentionally has no create-token command; use service.env for normal jobs."
  ];
}

function membersUsageLines(): string[] {
  return [
    "  # Inspect DB ACL membership",
    "  icpdb members --format table",
    "  icpdb principal --format table",
    "  icpdb status --format table",
    "",
    "  # Owner service.env can manage Server/CI principals",
    "  icpdb grant-member <service-principal> writer --format table",
    "  icpdb grant-member <service-principal> owner --format table",
    "  icpdb revoke-member <service-principal> --format table",
    "  icpdb members --format table",
    "",
    "  # Writer grants are for SQL; owner grants are required for backup/ACL management",
    "  icpdb check-env --require-role writer --smoke-sql --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Non-default owner env file",
    "  icpdb grant-member <service-principal> writer --service-env-file owner.env --format table"
  ];
}

function backupUsageLines(): string[] {
  return [
    "  # Archive/restore requires owner role",
    "  icpdb status --format table",
    "  icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "  # archive --format env emits ICPDB_SNAPSHOT_HASH plus ICPDB_URL/ICPDB_CONNECTION_URL for CI handoff",
    "  icpdb archive ./backup.sqlite --format env",
    "  # archive table/json/csv output includes nextSnapshotInfoCommand, nextRestoreCommand, nextHashPinnedRestoreCommand, and post-restore schema/tables/views/stats/status/members/url/info checks",
    "  icpdb archive ./backup.sqlite --format table",
    "  icpdb snapshot-info ./backup.sqlite --format table",
    "  # snapshot-info --format env can be eval-loaded before hash-pinned restore",
    "  icpdb snapshot-info ./backup.sqlite --format env",
    "  icpdb restore ./backup.sqlite --expect-snapshot-hash <sha256> --format table",
    "  eval \"$(icpdb snapshot-info ./backup.sqlite --format env)\" && icpdb restore ./backup.sqlite --expect-snapshot-hash \"$ICPDB_SNAPSHOT_HASH\" --format table",
    "  icpdb scalar \"SELECT count(*) FROM sqlite_schema\" --format table",
    "  icpdb tables --format table",
    "  icpdb views --format table",
    "  icpdb schema --format table",
    "  icpdb inspect --format table",
    "  icpdb stats --format table",
    "  icpdb status --format table",
    "  icpdb members --format table",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Use --service-env-file only when the owner handoff file is not cwd-local service.env",
    "  icpdb archive ./backup.sqlite --service-env-file ./ci/service.env --format env",
    "  icpdb restore ./backup.sqlite --expect-snapshot-hash <sha256> --service-env-file ./ci/service.env --format table"
  ];
}

function operationUsageLines(): string[] {
  return [
    "  # Routed write recovery for remote shard writes",
    "  icpdb execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]' --idempotency-key ci-notes-insert-001 --wait --format table",
    "  icpdb operation <operation-id> --format table",
    "  icpdb operation-wait <operation-id> --reconcile-unknown --format table",
    "  icpdb operation-reconcile <operation-id> --format table",
    "",
    "  # Batch and transaction writes should carry stable idempotency keys",
    "  icpdb batch ./statements.json --mode write --idempotency-key ci-batch-001 --wait --format table",
    "  icpdb transaction ./transaction.json --mode write --idempotency-key ci-transaction-001 --wait --format table",
    "",
    "  # Use --service-env-file only when the handoff file is not cwd-local service.env",
    "  icpdb operation <operation-id> --service-env-file ./ci/service.env --format table"
  ];
}

function packageShellUsage(topic = ""): string {
  const command = topic.trim().replace(/^\./, "");
  if (!command) return packageShellUsageLines().join("\n");
  if (command === "sql") return ["SQL:", ...packageShellSqlUsageLines()].join("\n");
  const matches = packageShellUsageLines().filter((line) => packageShellUsageLineMatchesCommand(line, command));
  if (matches.length === 0) throw new Error(`unknown shell help command: ${topic}`);
  return ["Shell commands:", ...matches].join("\n");
}

function packageShellUsageLines(): string[] {
  return [
    "Shell commands:",
    "  .help",
    "  .help <command>",
    "  .help sql",
    "Connection and schema:",
    "  .principal",
    "  .health",
    "  .url",
    "  .info",
    "  .status",
    "  .tables",
    "  .views",
    "  .stats",
    "  .describe <table_name>",
    "  .schema [table_name]",
    "  .columns <table_name>",
    "  .indexes <table_name>",
    "  .triggers <table_name>",
    "  .foreign-keys <table_name>",
    "  .preview <table_name> [limit] [offset]",
    "  .inspect [table_name] [limit] [offset]",
    "  .dump [file|->]",
    "  .load <file|->",
    "  .script <file|->",
    "  .migrate <file|->",
    "Operations:",
    "  .members",
    "  .grant-member <principal> <reader|writer|owner>",
    "  .revoke-member <principal>",
    "  .delete-db <database_id>",
    "  .usage",
    "  .usage-events",
    "  .placement",
    "  .operation <operation_id>",
    "Backup and restore:",
    "  .archive <file>",
    "  .snapshot-info <file>",
    "  .restore <file> [expected_sha256]",
    "Navigation:",
    "  .quit",
    "SQL:",
    ...packageShellSqlUsageLines()
  ];
}

function packageShellSqlUsageLines(): string[] {
  return [
    "  SELECT, WITH read CTEs, read-only PRAGMA, and EXPLAIN run through query.",
    "  Other SQL statements run through execute.",
    "  Shell write SQL auto-generates an idempotency key for routed remote writes.",
    "  Pass --idempotency-key before shell to set the generated key prefix.",
    "  Pass --wait before shell to wait for returned routed operations."
  ];
}

function packageShellUsageLineMatchesCommand(line: string, command: string): boolean {
  const trimmed = line.trim();
  return trimmed === `.${command}` || trimmed.startsWith(`.${command} `);
}

function opsUsageLines(): string[] {
  return [
    ...backupUsageLines(),
    "",
    "  # Controller/shard operations use canister-only controller.env",
    "  # Do not put ICPDB_DATABASE_ID or icpdb://<canister-id>/<database-id> in controller.env",
    "  # Shard smoke is canister-level: do not combine it with --require-role or DB SQL smoke",
    "  icpdb generate-identity --canister-id <id> --network-url https://icp-api.io --env-out controller.env --format table",
    "  icpdb principal --service-env-file controller.env --format table",
    "  eval \"$(icpdb principal --service-env-file controller.env --format env)\" && icp canister settings update -n ic <id> --add-controller \"$ICPDB_SERVICE_PRINCIPAL\" -f",
    "  icpdb inspect-env --service-env-file controller.env --format table",
    "  icpdb health --service-env-file controller.env --format table",
    "  icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller.env --format table",
    "  # shard table/json/csv output includes nextShardInventoryCommand, nextAllPlacementsCommand, nextShardOpsCommand, and nextShardMaintainDryRunCommand",
    "  # shard canister output includes nextShardStatusCommand and nextShardTopUpCommand",
    "  icpdb all-placements --service-env-file controller.env --format table",
    "  icpdb shards --service-env-file controller.env --format table",
    "  icpdb shard-maintain 0 0 0 0 0 0 --service-env-file controller.env --format table",
    "  icpdb shard-create <initial-cycles> <max-databases> --service-env-file controller.env --format table",
    "  icpdb shard-register <database-canister-id> <max-databases> --service-env-file controller.env --format table",
    "  icpdb shard-status <database-canister-id> --service-env-file controller.env --format table",
    "  icpdb shard-top-up <database-canister-id> 1000000 --service-env-file controller.env --format table",
    "  icpdb shard-maintain 1 0 0 0 8 0 --service-env-file controller.env --format table",
    "  icpdb shard-migrate <database-id> <database-canister-id> --service-env-file controller.env --format table",
    "  icpdb remote-create-db <database-id> <database-canister-id> --service-env-file controller.env --format table",
    "  icpdb shard-ops --service-env-file controller.env --format table",
    "  icpdb shard-reconcile <operation-id> applied --service-env-file controller.env --format table",
    "  icpdb shard-reconcile <operation-id> failed \"operator verified failure\" --service-env-file controller.env --format table",
    "",
    "  # Routed DB writes use the database-bearing service.env, not controller.env",
    "  icpdb operation <operation-id> --format table",
    "  icpdb operation-wait <operation-id> --reconcile-unknown --format table",
    "  icpdb operation-reconcile <operation-id> --format table"
  ];
}

function createDbUsageLines(): string[] {
  return [
    "  # create-db requires canister-only service.env; no ICPDB_DATABASE_ID",
    "  # Without setup flags, create-db creates an empty DB, persists ICPDB_DATABASE_ID, then prints ICPDB_URL / ICPDB_CONNECTION_URL",
    "  icpdb inspect-env --format table",
    "  icpdb create-db --format env",
    "  icpdb create-db --setup-sql \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)\" --format table",
    "  icpdb create-db --setup-file ./schema.sql --format env",
    "  icpdb create-db --setup-statements-file ./setup-statements.json --format env",
    "  icpdb create-db --setup-migrations-file ./migrations.json --format env",
    "  icpdb create-db --setup-file ./schema.sql --format table",
    "  icpdb create-db --setup-file ./schema.sql --format csv",
    "  # table/json/csv output includes nextInspectEnvCommand, nextExecuteCommand, nextInsertCommand, nextQueryCommand, nextReadCommand, nextSqlSmokeCommand, nextSchemaCountCommand, nextTablesCommand, nextViewsCommand, nextStatsCommand, nextSchemaCommand, nextDescribeCommand, nextPreviewCommand, nextStatusCommand, nextMembersCommand, nextUrlCommand, and nextInfoCommand",
    "  icpdb url --format env",
    "  icpdb info --format env",
    "",
    "  # Reuse the persisted DB id from the same service.env",
    "  icpdb execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]' --idempotency-key ci-notes-insert-001 --wait",
    "  icpdb query \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
  "  icpdb scalar \"SELECT count(*) FROM notes\" --format table",
  "  icpdb tables --format table",
  "  icpdb views --format table",
  "  icpdb stats --format table",
  "  icpdb schema notes --format table",
  "  icpdb describe notes --format table",
  "  icpdb preview notes --limit 25 --format table",
  "  icpdb inspect notes --format table",
  "  icpdb status --format table",
  "  icpdb members --format table",
  "  icpdb url --format env",
  "  icpdb info --format env"
  ];
}

function lineMatchesCommand(line: string, command: string): boolean {
  return new RegExp(`\\bicpdb\\s+${escapeRegExp(command)}(?:\\s|$)`).test(line);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertKnownCommand(command: string): void {
  if (!KNOWN_COMMANDS.has(command)) throw new Error(`unknown command: ${command || "<empty>"}`);
}

function parseArgs(args: string[]): ParsedCli {
  const positional: string[] = [];
  let envFile = DEFAULT_ENV_FILE;
  let envFileExplicit: boolean | undefined;
  let format: CliFormat = "json";
  let params: IcpdbSqlArgsInput | undefined;
  let paramsFile: string | undefined;
  let mode: IcpdbBatchMode | undefined;
  let expectedSha256: string | undefined;
  let limit: number | undefined;
  let offset: number | undefined;
  let reconcileUnknown: boolean | undefined;
  let intervalMs: number | undefined;
  let timeoutMs: number | undefined;
  let confirm: string | undefined;
  let idempotencyKey: string | undefined;
  let wait: boolean | undefined;
  let setupSql: string | undefined;
  let setupFile: string | undefined;
  let setupStatementsFile: string | undefined;
  let setupMigrationsFile: string | undefined;
  let envOut: string | undefined;
  let identityType: IcpdbServiceIdentityType | undefined;
  let canisterId: string | undefined;
  let databaseId: string | undefined;
  let networkUrl: string | undefined;
  let rootKey: string | undefined;
  let skipCall: boolean | undefined;
  let smokeSql: boolean | undefined;
  let smokeSdk: boolean | undefined;
  let smokeShards: boolean | undefined;
  let smokeSdkShards: boolean | undefined;
  let smokeArchiveRestore: boolean | undefined;
  let smokeSdkArchiveRestore: boolean | undefined;
  let requireRole: DatabaseRole | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--service-env-file" || arg === "--env-file") {
      envFile = requiredOptionValue(args, index, arg);
      envFileExplicit = true;
      index += 1;
    } else if (arg === "--format") {
      format = cliFormat(requiredOptionValue(args, index, "--format"));
      index += 1;
    } else if (arg === "--params") {
      if (params !== undefined || paramsFile !== undefined) throw new Error("use only one of --params or --params-file");
      params = parseSqlParams(requiredOptionValue(args, index, "--params"), "--params");
      index += 1;
    } else if (arg === "--params-file") {
      if (params !== undefined || paramsFile !== undefined) throw new Error("use only one of --params or --params-file");
      paramsFile = requiredOptionValue(args, index, "--params-file");
      index += 1;
    } else if (arg === "--mode") {
      mode = cliBatchMode(requiredOptionValue(args, index, "--mode"));
      index += 1;
    } else if (arg === "--expect-snapshot-hash") {
      expectedSha256 = requiredOptionValue(args, index, "--expect-snapshot-hash");
      index += 1;
    } else if (arg === "--limit") {
      limit = positiveIntegerOption(requiredOptionValue(args, index, "--limit"), "--limit", 500);
      index += 1;
    } else if (arg === "--offset") {
      offset = nonNegativeIntegerOption(requiredOptionValue(args, index, "--offset"), "--offset", 4_294_967_295);
      index += 1;
    } else if (arg === "--reconcile-unknown") {
      reconcileUnknown = true;
    } else if (arg === "--interval-ms") {
      intervalMs = nonNegativeIntegerOption(requiredOptionValue(args, index, "--interval-ms"), "--interval-ms", Number.MAX_SAFE_INTEGER);
      index += 1;
    } else if (arg === "--timeout-ms") {
      timeoutMs = nonNegativeIntegerOption(requiredOptionValue(args, index, "--timeout-ms"), "--timeout-ms", Number.MAX_SAFE_INTEGER);
      index += 1;
    } else if (arg === "--confirm") {
      confirm = requiredOptionValue(args, index, "--confirm");
      index += 1;
    } else if (arg === "--idempotency-key") {
      idempotencyKey = requiredOptionValue(args, index, "--idempotency-key");
      index += 1;
    } else if (arg === "--wait") {
      wait = true;
    } else if (arg === "--setup-sql") {
      if (setupSql !== undefined || setupFile !== undefined || setupStatementsFile !== undefined || setupMigrationsFile !== undefined) throw new Error("use only one of --setup-sql, --setup-file, --setup-statements-file, or --setup-migrations-file");
      setupSql = requiredOptionValue(args, index, "--setup-sql");
      index += 1;
    } else if (arg === "--setup-file") {
      if (setupSql !== undefined || setupFile !== undefined || setupStatementsFile !== undefined || setupMigrationsFile !== undefined) throw new Error("use only one of --setup-sql, --setup-file, --setup-statements-file, or --setup-migrations-file");
      setupFile = requiredOptionValue(args, index, "--setup-file");
      index += 1;
    } else if (arg === "--setup-statements-file") {
      if (setupSql !== undefined || setupFile !== undefined || setupStatementsFile !== undefined || setupMigrationsFile !== undefined) throw new Error("use only one of --setup-sql, --setup-file, --setup-statements-file, or --setup-migrations-file");
      setupStatementsFile = requiredOptionValue(args, index, "--setup-statements-file");
      index += 1;
    } else if (arg === "--setup-migrations-file") {
      if (setupSql !== undefined || setupFile !== undefined || setupStatementsFile !== undefined || setupMigrationsFile !== undefined) throw new Error("use only one of --setup-sql, --setup-file, --setup-statements-file, or --setup-migrations-file");
      setupMigrationsFile = requiredOptionValue(args, index, "--setup-migrations-file");
      index += 1;
    } else if (arg === "--env-out") {
      envOut = requiredOptionValue(args, index, "--env-out");
      index += 1;
    } else if (arg === "--identity-type") {
      identityType = packageServiceIdentityType(requiredOptionValue(args, index, "--identity-type"));
      index += 1;
    } else if (arg === "--canister-id") {
      canisterId = requiredOptionValue(args, index, "--canister-id");
      index += 1;
    } else if (arg === "--database-id") {
      databaseId = requiredOptionValue(args, index, "--database-id");
      index += 1;
    } else if (arg === "--network-url") {
      networkUrl = requiredOptionValue(args, index, "--network-url");
      index += 1;
    } else if (arg === "--root-key") {
      rootKey = requiredOptionValue(args, index, "--root-key");
      index += 1;
    } else if (arg === "--skip-call") {
      skipCall = true;
    } else if (arg === "--smoke-sql") {
      smokeSql = true;
    } else if (arg === "--smoke-sdk") {
      smokeSdk = true;
    } else if (arg === "--smoke-archive-restore") {
      smokeArchiveRestore = true;
    } else if (arg === "--smoke-sdk-archive-restore") {
      smokeSdkArchiveRestore = true;
    } else if (arg === "--smoke-shards") {
      smokeShards = true;
    } else if (arg === "--smoke-sdk-shards") {
      smokeSdkShards = true;
    } else if (arg === "--require-role") {
      requireRole = cliDatabaseRole(requiredOptionValue(args, index, "--require-role"));
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const [command = "help", ...rest] = positional;
  return {
    command,
    positional: rest,
    envFile: requiredNonEmpty(envFile, "env file"),
    ...(envFileExplicit === undefined ? {} : { envFileExplicit }),
    format,
    ...(params === undefined ? {} : { params }),
    ...(paramsFile === undefined ? {} : { paramsFile: requiredNonEmpty(paramsFile, "params file") }),
    ...(mode === undefined ? {} : { mode }),
    ...(expectedSha256 === undefined ? {} : { expectedSha256: expectedSnapshotHashArg(expectedSha256) }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ...(reconcileUnknown === undefined ? {} : { reconcileUnknown }),
    ...(intervalMs === undefined ? {} : { intervalMs }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(confirm === undefined ? {} : { confirm: requiredNonEmpty(confirm, "delete confirmation database id") }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey: requiredNonEmpty(idempotencyKey, "idempotency key") }),
    ...(wait === undefined ? {} : { wait }),
    ...(setupSql === undefined ? {} : { setupSql: requiredNonEmpty(setupSql, "setup SQL") }),
    ...(setupFile === undefined ? {} : { setupFile: requiredNonEmpty(setupFile, "setup file") }),
    ...(setupStatementsFile === undefined ? {} : { setupStatementsFile: requiredNonEmpty(setupStatementsFile, "setup statements file") }),
    ...(setupMigrationsFile === undefined ? {} : { setupMigrationsFile: requiredNonEmpty(setupMigrationsFile, "setup migrations file") }),
    ...(envOut === undefined ? {} : { envOut: requiredNonEmpty(envOut, "env output file") }),
    ...(identityType === undefined ? {} : { identityType }),
    ...(canisterId === undefined ? {} : { canisterId: requiredNonEmpty(canisterId, "canister id") }),
    ...(databaseId === undefined ? {} : { databaseId: requiredNonEmpty(databaseId, "database id") }),
    ...(networkUrl === undefined ? {} : { networkUrl: requiredNonEmpty(networkUrl, "network URL") }),
    ...(rootKey === undefined ? {} : { rootKey: requiredNonEmpty(rootKey, "root key") }),
    ...(skipCall === undefined ? {} : { skipCall }),
    ...(smokeSql === undefined ? {} : { smokeSql }),
    ...(smokeSdk === undefined ? {} : { smokeSdk }),
    ...(smokeShards === undefined ? {} : { smokeShards }),
    ...(smokeSdkShards === undefined ? {} : { smokeSdkShards }),
    ...(smokeArchiveRestore === undefined ? {} : { smokeArchiveRestore }),
    ...(smokeSdkArchiveRestore === undefined ? {} : { smokeSdkArchiveRestore }),
    ...(requireRole === undefined ? {} : { requireRole })
  };
}

function requiredOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function cliFormat(value: string): CliFormat {
  if (value === "json" || value === "table" || value === "csv" || value === "env") return value;
  throw new Error("--format must be json, table, csv, or env");
}

function cliBatchMode(value: string): IcpdbBatchMode {
  if (value === "read" || value === "write" || value === "deferred") return value;
  throw new Error("--mode must be read, write, or deferred");
}

function packageServiceIdentityType(value: string): IcpdbServiceIdentityType {
  if (value === "ed25519" || value === "secp256k1") return value;
  throw new Error("--identity-type must be ed25519 or secp256k1");
}

function cliDatabaseRole(value: string): DatabaseRole {
  if (value === "reader" || value === "writer" || value === "owner") return value;
  throw new Error("role must be reader, writer, or owner");
}

function memberPrincipalArg(value: string): string {
  return requiredNonEmpty(value, "database member principal");
}

function grantablePrincipalArg(value: string): string {
  const principal = memberPrincipalArg(value);
  if (principal === ANONYMOUS_PRINCIPAL) throw new Error("anonymous principal cannot be granted database access");
  return principal;
}

function operationIdArg(value: string): string {
  return requiredNonEmpty(value, "operation id");
}

function databaseIdArg(value: string): string {
  return requiredNonEmpty(value, "database id");
}

function databaseCanisterIdArg(value: string): string {
  return requiredNonEmpty(value, "database canister id");
}

function shardReconcileStatusArg(value: string): CliShardOperationReconcileStatus {
  if (value === "applied" || value === "failed") return value;
  throw new Error("shard-reconcile status must be applied or failed");
}

function shardMaintainRequest(parsed: ParsedCli): MaintainDatabaseShardsRequest {
  rejectExtraPositionals(parsed, 6);
  return {
    minAvailableSlots: natTextArg(requiredPositional(parsed, 0, "min available slots"), "min available slots"),
    minCyclesBalance: natTextArg(requiredPositional(parsed, 1, "min cycles balance"), "min cycles balance"),
    topUpCycles: natTextArg(requiredPositional(parsed, 2, "top up cycles"), "top up cycles"),
    maxNewShards: nat16Arg(requiredPositional(parsed, 3, "max new shards"), "max new shards"),
    newShardMaxDatabases: nat16Arg(requiredPositional(parsed, 4, "new shard max databases"), "new shard max databases"),
    newShardInitialCycles: natTextArg(requiredPositional(parsed, 5, "new shard initial cycles"), "new shard initial cycles")
  };
}

function natTextArg(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) throw new Error(`${label} must be a non-negative integer`);
  return trimmed;
}

function nat16Arg(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) throw new Error(`${label} must be an integer from 0 to 65535`);
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65535) throw new Error(`${label} must be an integer from 0 to 65535`);
  return parsed;
}

function positiveIntegerOption(value: string, option: string, max: number): number {
  const parsed = integerOption(value, option);
  if (parsed < 1 || parsed > max) throw new Error(`${option} must be an integer from 1 to ${max}`);
  return parsed;
}

function nonNegativeIntegerOption(value: string, option: string, max: number): number {
  const parsed = integerOption(value, option);
  if (parsed < 0 || parsed > max) throw new Error(`${option} must be an integer from 0 to ${max}`);
  return parsed;
}

function integerOption(value: string, option: string): number {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) throw new Error(`${option} must be an integer`);
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${option} must be a safe integer`);
  return parsed;
}

function rejectPreviewWindowOptionsForCommand(parsed: ParsedCli): void {
  if (parsed.limit === undefined && parsed.offset === undefined) return;
  if (parsed.command === "preview" || parsed.command === "inspect") return;
  throw new Error("--limit and --offset are only valid for preview and inspect");
}

function rejectWaitOptionsForCommand(parsed: ParsedCli): void {
  if (parsed.reconcileUnknown === undefined && parsed.intervalMs === undefined && parsed.timeoutMs === undefined) return;
  if (parsed.command === "operation-wait") return;
  if (parsed.wait === true && isWriteWaitCommand(parsed.command)) return;
  throw new Error("--reconcile-unknown, --interval-ms, and --timeout-ms are only valid for operation-wait or write commands with --wait");
}

function rejectConfirmOptionForCommand(parsed: ParsedCli): void {
  if (parsed.confirm === undefined) return;
  if (parsed.command === "delete-db") return;
  throw new Error("--confirm is only valid for delete-db");
}

function rejectExpectedSnapshotHashForCommand(parsed: ParsedCli): void {
  if (parsed.expectedSha256 === undefined || parsed.command === "restore") return;
  throw new Error("--expect-snapshot-hash is only valid for restore");
}

function rejectServiceEnvFileForCommand(parsed: ParsedCli): void {
  if (parsed.envFileExplicit !== true || !isNonEnvReadingCommand(parsed.command)) return;
  throw new Error("--service-env-file and --env-file are not valid for init, generate-identity, or snapshot-info");
}

function rejectModeForCommand(parsed: ParsedCli): void {
  if (parsed.mode === undefined || isBatchModeCommand(parsed.command)) return;
  throw new Error("--mode is only valid for exec, batch, transaction, script, load, and shell");
}

function rejectIdempotencyKeyForCommand(parsed: ParsedCli): void {
  if (parsed.idempotencyKey === undefined) return;
  if (!isWriteWaitCommand(parsed.command)) {
    throw new Error("--idempotency-key is only valid for execute, exec, sql, batch, transaction, script, load, migrate, and shell");
  }
  if (parsed.mode === "read") throw new Error("--idempotency-key is only valid for write SQL");
}

function rejectWriteWaitForCommand(parsed: ParsedCli): void {
  if (parsed.wait !== true) return;
  if (!isWriteWaitCommand(parsed.command)) throw new Error("--wait is only valid for execute, exec, sql, batch, transaction, script, load, migrate, and shell");
  if (parsed.mode === "read") throw new Error("--wait is only valid for write SQL");
}

function rejectReadSqlWriteOptionsForCommand(parsed: ParsedCli): void {
  if (parsed.command !== "execute" && parsed.command !== "exec" && parsed.command !== "sql") return;
  if (parsed.idempotencyKey === undefined && parsed.wait !== true) return;
  const sql = requiredPositional(parsed, 0, "SQL");
  const isReadOnly = parsed.command === "exec" ? splitSqlStatements(sql).every(isReadSql) : isReadSql(sql);
  if (!isReadOnly) return;
  if (parsed.idempotencyKey !== undefined) throw new Error("--idempotency-key is only valid for write SQL");
  throw new Error("--wait is only valid for write SQL");
}

function rejectSetupOptionsForCommand(parsed: ParsedCli): void {
  if (parsed.setupSql === undefined && parsed.setupFile === undefined && parsed.setupStatementsFile === undefined && parsed.setupMigrationsFile === undefined) return;
  if (parsed.command === "create-db" || parsed.command === "init") return;
  throw new Error("--setup-sql, --setup-file, --setup-statements-file, and --setup-migrations-file are only valid for init and create-db");
}

function rejectIdentityGenerationOptionsForCommand(parsed: ParsedCli): void {
  if (
    parsed.envOut === undefined &&
    parsed.identityType === undefined &&
    parsed.canisterId === undefined &&
    parsed.databaseId === undefined &&
    parsed.networkUrl === undefined &&
    parsed.rootKey === undefined
  ) {
    return;
  }
  if (parsed.command === "generate-identity" || parsed.command === "init") return;
  if (parsed.command === "provision-service" && parsed.canisterId === undefined && parsed.databaseId === undefined && parsed.networkUrl === undefined && parsed.rootKey === undefined) return;
  throw new Error("--env-out, --identity-type, --canister-id, --database-id, --network-url, and --root-key are only valid for init, generate-identity, and provision-service");
}

function rejectCheckOptionsForCommand(parsed: ParsedCli): void {
  if (parsed.skipCall === undefined && parsed.smokeSql === undefined && parsed.smokeSdk === undefined && parsed.smokeArchiveRestore === undefined && parsed.smokeSdkArchiveRestore === undefined && parsed.smokeShards === undefined && parsed.smokeSdkShards === undefined && parsed.requireRole === undefined) return;
  if (parsed.command !== "check-env") throw new Error("--skip-call, --smoke-sql, --smoke-sdk, --smoke-archive-restore, --smoke-sdk-archive-restore, --smoke-shards, --smoke-sdk-shards, and --require-role are only valid for check-env");
  if (parsed.skipCall === true && parsed.smokeSql === true) throw new Error("--smoke-sql cannot be combined with --skip-call");
  if (parsed.skipCall === true && parsed.smokeSdk === true) throw new Error("--smoke-sdk cannot be combined with --skip-call");
  if (parsed.skipCall === true && parsed.smokeArchiveRestore === true) throw new Error("--smoke-archive-restore cannot be combined with --skip-call");
  if (parsed.skipCall === true && parsed.smokeSdkArchiveRestore === true) throw new Error("--smoke-sdk-archive-restore cannot be combined with --skip-call");
  if (parsed.skipCall === true && parsed.smokeShards === true) throw new Error("--smoke-shards cannot be combined with --skip-call");
  if (parsed.skipCall === true && parsed.smokeSdkShards === true) throw new Error("--smoke-sdk-shards cannot be combined with --skip-call");
  if (parsed.skipCall === true && parsed.requireRole !== undefined) throw new Error("--require-role cannot be combined with --skip-call");
  if (parsed.smokeShards === true && parsed.smokeSql === true) throw new Error("--smoke-shards cannot be combined with --smoke-sql");
  if (parsed.smokeShards === true && parsed.smokeSdk === true) throw new Error("--smoke-shards cannot be combined with --smoke-sdk");
  if (parsed.smokeShards === true && parsed.smokeArchiveRestore === true) throw new Error("--smoke-shards cannot be combined with --smoke-archive-restore");
  if (parsed.smokeShards === true && parsed.smokeSdkArchiveRestore === true) throw new Error("--smoke-shards cannot be combined with --smoke-sdk-archive-restore");
  if (parsed.smokeShards === true && parsed.requireRole !== undefined) throw new Error("--smoke-shards cannot be combined with --require-role");
  if (parsed.smokeSdkShards === true && parsed.smokeSql === true) throw new Error("--smoke-sdk-shards cannot be combined with --smoke-sql");
  if (parsed.smokeSdkShards === true && parsed.smokeSdk === true) throw new Error("--smoke-sdk-shards cannot be combined with --smoke-sdk");
  if (parsed.smokeSdkShards === true && parsed.smokeArchiveRestore === true) throw new Error("--smoke-sdk-shards cannot be combined with --smoke-archive-restore");
  if (parsed.smokeSdkShards === true && parsed.smokeSdkArchiveRestore === true) throw new Error("--smoke-sdk-shards cannot be combined with --smoke-sdk-archive-restore");
  if (parsed.smokeSdkShards === true && parsed.requireRole !== undefined) throw new Error("--smoke-sdk-shards cannot be combined with --require-role");
  if (parsed.smokeArchiveRestore === true && parsed.smokeSql !== true) throw new Error("--smoke-archive-restore requires --smoke-sql");
}

function rejectEnvFormatForCommand(parsed: ParsedCli): void {
  if (parsed.format !== "env" || ENV_FORMAT_COMMANDS.has(parsed.command)) return;
  throw new Error("--format env is only valid for init, generate-identity, provision-service, check-env, inspect-env, principal, url, info, create-db, archive, and snapshot-info");
}

function rejectSqlParamsForCommand(parsed: ParsedCli): void {
  if (parsed.params === undefined && parsed.paramsFile === undefined) return;
  if (isSqlParamsCommand(parsed.command)) return;
  throw new Error("--params and --params-file are only valid for query, execute, sql, and scalar");
}

function rejectPackageCommandPositionalsBeforeEnv(parsed: ParsedCli): void {
  if (parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h" || parsed.command === "shell") return;
  if (parsed.command === "schema" || parsed.command === "inspect") {
    if (parsed.positional[0] !== undefined) requiredNonEmpty(parsed.positional[0], "table name");
    rejectExtraPositionals(parsed, 1);
    return;
  }
  if (parsed.command === "grant-member") {
    grantablePrincipalArg(requiredPositional(parsed, 0, "principal"));
    cliDatabaseRole(requiredPositional(parsed, 1, "role"));
    rejectExtraPositionals(parsed, 2);
    return;
  }
  if (parsed.command === "provision-service") {
    databaseIdArg(requiredPositional(parsed, 0, "database id"));
    cliDatabaseRole(requiredPositional(parsed, 1, "role"));
    rejectExtraPositionals(parsed, 2);
    return;
  }
  if (parsed.command === "shard-create") {
    natTextArg(requiredPositional(parsed, 0, "initial cycles"), "initial cycles");
    nat16Arg(requiredPositional(parsed, 1, "max databases"), "max databases");
    rejectExtraPositionals(parsed, 2);
    return;
  }
  if (parsed.command === "shard-register") {
    databaseCanisterIdArg(requiredPositional(parsed, 0, "database canister id"));
    nat16Arg(requiredPositional(parsed, 1, "max databases"), "max databases");
    rejectExtraPositionals(parsed, 2);
    return;
  }
  if (parsed.command === "shard-top-up") {
    databaseCanisterIdArg(requiredPositional(parsed, 0, "database canister id"));
    natTextArg(requiredPositional(parsed, 1, "cycles"), "cycles");
    rejectExtraPositionals(parsed, 2);
    return;
  }
  if (parsed.command === "shard-maintain") {
    shardMaintainRequest(parsed);
    return;
  }
  if (parsed.command === "shard-migrate" || parsed.command === "remote-create-db") {
    databaseIdArg(requiredPositional(parsed, 0, "database id"));
    databaseCanisterIdArg(requiredPositional(parsed, 1, "database canister id"));
    rejectExtraPositionals(parsed, 2);
    return;
  }
  if (parsed.command === "shard-reconcile") {
    operationIdArg(requiredPositional(parsed, 0, "operation id"));
    const status = shardReconcileStatusArg(requiredPositional(parsed, 1, "status"));
    const reason = parsed.positional.slice(2).join(" ").trim();
    if (status === "applied" && reason) throw new Error("shard-reconcile applied does not accept a failure reason");
    if (status === "failed" && !reason) throw new Error("shard-reconcile failed requires a failure reason");
    return;
  }
  if (PACKAGE_ZERO_POSITIONAL_COMMANDS.has(parsed.command)) {
    rejectExtraPositionals(parsed, 0);
    return;
  }
  if (PACKAGE_ONE_POSITIONAL_COMMANDS.has(parsed.command)) {
    requiredPositional(parsed, 0, packagePositionalLabel(parsed.command, 0));
    rejectExtraPositionals(parsed, 1);
    return;
  }
  if (PACKAGE_TWO_POSITIONAL_COMMANDS.has(parsed.command)) {
    requiredPositional(parsed, 0, packagePositionalLabel(parsed.command, 0));
    requiredPositional(parsed, 1, packagePositionalLabel(parsed.command, 1));
    rejectExtraPositionals(parsed, 2);
  }
}

function packagePositionalLabel(command: string, index: number): string {
  if (command === "query" || command === "execute" || command === "exec" || command === "sql" || command === "scalar") return "SQL";
  if (command === "provision-service" && index === 0) return "database id";
  if (command === "provision-service" && index === 1) return "role";
  if (command === "batch" || command === "transaction") return "statements file";
  if (command === "script") return "SQL file";
  if (command === "load" || command === "dump") return "SQL dump file";
  if (command === "migrate") return "migration file";
  if (command === "describe" || command === "columns" || command === "indexes" || command === "triggers" || command === "foreign-keys" || command === "preview") return "table name";
  if (command === "revoke-member") return "principal";
  if (command === "operation" || command === "operation-reconcile" || command === "operation-wait") return "operation id";
  if (command === "snapshot-info" || command === "restore") return "snapshot file";
  if (command === "archive") return "archive file";
  if (command === "shard-status") return "database canister id";
  if (index === 0) return "argument";
  return `argument ${index + 1}`;
}

type PostCreateNextCommands = {
  nextInspectEnvCommand: string;
  nextExecuteCommand: string;
  nextInsertCommand: string;
  nextQueryCommand: string;
  nextReadCommand: string;
  nextSqlSmokeCommand: string;
  nextSchemaCountCommand: string;
  nextTablesCommand: string;
  nextViewsCommand: string;
  nextStatsCommand: string;
  nextSchemaCommand: string;
  nextDescribeCommand: string;
  nextPreviewCommand: string;
  nextStatusCommand: string;
  nextMembersCommand: string;
  nextUrlCommand: string;
  nextInfoCommand: string;
};

function postCreateNextCommands(envFile: string): PostCreateNextCommands {
  const envArgs = packageServiceEnvArgs(envFile);
  return {
    nextInspectEnvCommand: ["icpdb", "inspect-env", ...envArgs, "--format", "table"].join(" "),
    nextExecuteCommand: ["icpdb", "execute", ...envArgs, shellCommandArg("CREATE TABLE icpdb_next_command(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"), "--idempotency-key", "next-command-create-table-001", "--wait", "--format", "table"].join(" "),
    nextInsertCommand: ["icpdb", "execute", ...envArgs, shellCommandArg("INSERT INTO icpdb_next_command(body) VALUES (?1)"), "--params", shellCommandArg("[\"from-next-command\"]"), "--idempotency-key", "next-command-insert-001", "--wait", "--format", "table"].join(" "),
    nextQueryCommand: ["icpdb", "query", ...envArgs, shellCommandArg("SELECT count(*) FROM sqlite_schema"), "--format", "table"].join(" "),
    nextReadCommand: ["icpdb", "query", ...envArgs, shellCommandArg("SELECT id, body FROM icpdb_next_command ORDER BY id DESC LIMIT 5"), "--format", "table"].join(" "),
    nextSqlSmokeCommand: ["icpdb", "check-env", ...envArgs, "--require-role", "writer", "--smoke-sql", "--format", "table"].join(" "),
    nextSchemaCountCommand: ["icpdb", "scalar", ...envArgs, shellCommandArg("SELECT count(*) FROM sqlite_schema"), "--format", "table"].join(" "),
    nextTablesCommand: ["icpdb", "tables", ...envArgs, "--format", "table"].join(" "),
    nextViewsCommand: ["icpdb", "views", ...envArgs, "--format", "table"].join(" "),
    nextStatsCommand: ["icpdb", "stats", ...envArgs, "--format", "table"].join(" "),
    nextSchemaCommand: ["icpdb", "schema", ...envArgs, shellCommandArg("icpdb_next_command"), "--format", "table"].join(" "),
    nextDescribeCommand: ["icpdb", "describe", ...envArgs, shellCommandArg("icpdb_next_command"), "--format", "table"].join(" "),
    nextPreviewCommand: ["icpdb", "preview", ...envArgs, shellCommandArg("icpdb_next_command"), "--limit", "25", "--format", "table"].join(" "),
    nextStatusCommand: ["icpdb", "status", ...envArgs, "--format", "table"].join(" "),
    nextMembersCommand: ["icpdb", "members", ...envArgs, "--format", "table"].join(" "),
    nextUrlCommand: ["icpdb", "url", ...envArgs, "--format", "env"].join(" "),
    nextInfoCommand: ["icpdb", "info", ...envArgs, "--format", "env"].join(" ")
  };
}

function packageInspectEnvOutput(inspection: IcpdbServiceEnvInspection, envFile: string): PackageInspectEnvOutput {
  const envArgs = packageServiceEnvArgs(envFile);
  if (!inspection.hasDatabase) {
    return {
      ...inspection,
      nextCreateDbCommand: ["icpdb", "create-db", ...envArgs, "--setup-sql", shellCommandArg("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"), "--format", "table"].join(" "),
      nextScalarCommand: ["icpdb", "scalar", ...envArgs, shellCommandArg("SELECT 1 AS value"), "--format", "table"].join(" "),
      nextExecuteCommand: ["icpdb", "execute", ...envArgs, shellCommandArg("CREATE TABLE icpdb_first_sql(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"), "--idempotency-key", "inspect-env-first-create-001", "--wait", "--format", "table"].join(" "),
      nextQueryCommand: ["icpdb", "query", ...envArgs, shellCommandArg("SELECT count(*) FROM sqlite_schema"), "--format", "table"].join(" "),
      nextInfoCommand: ["icpdb", "info", ...envArgs, "--format", "env"].join(" ")
    };
  }
  return {
    ...inspection,
    nextCheckEnvCommand: ["icpdb", "check-env", ...envArgs, "--require-role", "writer", "--format", "table"].join(" "),
    nextQueryCommand: ["icpdb", "query", ...envArgs, shellCommandArg("SELECT name FROM sqlite_schema ORDER BY name"), "--format", "table"].join(" "),
    nextSchemaCountCommand: ["icpdb", "scalar", ...envArgs, shellCommandArg("SELECT count(*) FROM sqlite_schema"), "--format", "table"].join(" "),
    nextTablesCommand: ["icpdb", "tables", ...envArgs, "--format", "table"].join(" "),
    nextViewsCommand: ["icpdb", "views", ...envArgs, "--format", "table"].join(" "),
    nextStatsCommand: ["icpdb", "stats", ...envArgs, "--format", "table"].join(" "),
    nextStatusCommand: ["icpdb", "status", ...envArgs, "--format", "table"].join(" "),
    nextMembersCommand: ["icpdb", "members", ...envArgs, "--format", "table"].join(" "),
    nextUrlCommand: ["icpdb", "url", ...envArgs, "--format", "env"].join(" "),
    nextInfoCommand: ["icpdb", "info", ...envArgs, "--format", "env"].join(" ")
  };
}

function packageServiceEnvCheckOutput(check: PackageServiceEnvCheck): PackageServiceEnvCheckOutput {
  const envArgs = packageServiceEnvArgs(check.envFile);
  if (!check.hasDatabase) {
    return {
      ...check,
      nextInspectEnvCommand: ["icpdb", "inspect-env", ...envArgs, "--format", "table"].join(" "),
      nextCreateDbCommand: ["icpdb", "create-db", ...envArgs, "--setup-sql", shellCommandArg("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"), "--format", "table"].join(" "),
      nextCheckEnvCommand: ["icpdb", "check-env", ...envArgs, "--skip-call", "--format", "table"].join(" "),
      nextInfoCommand: ["icpdb", "info", ...envArgs, "--format", "env"].join(" "),
      ...((check.shardSmoke === undefined && check.sdkShardSmoke === undefined) ? {} : shardOperatorNextCommands(check.envFile))
    };
  }
  const output: PackageServiceEnvCheckOutput = {
    ...check,
    nextInspectEnvCommand: ["icpdb", "inspect-env", ...envArgs, "--format", "table"].join(" "),
    nextCheckEnvCommand: ["icpdb", "check-env", ...envArgs, "--require-role", "writer", "--format", "table"].join(" "),
    nextStatusCommand: ["icpdb", "status", ...envArgs, "--format", "table"].join(" "),
    nextMembersCommand: ["icpdb", "members", ...envArgs, "--format", "table"].join(" "),
    nextQueryCommand: ["icpdb", "query", ...envArgs, shellCommandArg("SELECT name FROM sqlite_schema ORDER BY name"), "--format", "table"].join(" "),
    nextSchemaCountCommand: ["icpdb", "scalar", ...envArgs, shellCommandArg("SELECT count(*) FROM sqlite_schema"), "--format", "table"].join(" "),
    nextTablesCommand: ["icpdb", "tables", ...envArgs, "--format", "table"].join(" "),
    nextViewsCommand: ["icpdb", "views", ...envArgs, "--format", "table"].join(" "),
    nextStatsCommand: ["icpdb", "stats", ...envArgs, "--format", "table"].join(" "),
    nextSchemaCommand: ["icpdb", "schema", ...envArgs, "--format", "table"].join(" "),
    nextUrlCommand: ["icpdb", "url", ...envArgs, "--format", "env"].join(" "),
    nextInfoCommand: ["icpdb", "info", ...envArgs, "--format", "env"].join(" ")
  };
  if (check.callerRole !== undefined && roleRank(check.callerRole) >= roleRank("writer")) {
    output.nextExecuteCommand = ["icpdb", "execute", ...envArgs, shellCommandArg("CREATE TABLE icpdb_check_env_next(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"), "--idempotency-key", "check-env-next-create-table-001", "--wait", "--format", "table"].join(" ");
    output.nextInsertCommand = ["icpdb", "execute", ...envArgs, shellCommandArg("INSERT INTO icpdb_check_env_next(body) VALUES (?1)"), "--params", shellCommandArg("[\"from-check-env-next\"]"), "--idempotency-key", "check-env-next-insert-001", "--wait", "--format", "table"].join(" ");
    output.nextReadCommand = ["icpdb", "query", ...envArgs, shellCommandArg("SELECT id, body FROM icpdb_check_env_next ORDER BY id DESC LIMIT 5"), "--format", "table"].join(" ");
    output.nextDescribeCommand = ["icpdb", "describe", ...envArgs, shellCommandArg("icpdb_check_env_next"), "--format", "table"].join(" ");
    output.nextPreviewCommand = ["icpdb", "preview", ...envArgs, shellCommandArg("icpdb_check_env_next"), "--limit", "25", "--format", "table"].join(" ");
    output.nextSqlSmokeCommand = ["icpdb", "check-env", ...envArgs, "--require-role", "writer", "--smoke-sql", "--format", "table"].join(" ");
  }
  if (check.callerRole === "owner") {
    const backupFileArg = shellCommandArg("./backup.sqlite");
    output.nextArchiveCommand = ["icpdb", "archive", backupFileArg, ...envArgs, "--format", "env"].join(" ");
    output.nextSnapshotInfoCommand = ["icpdb", "snapshot-info", backupFileArg, "--format", "env"].join(" ");
    output.nextHashPinnedRestoreCommand = `eval "$(icpdb snapshot-info ${backupFileArg} --format env)" && ${[
      "icpdb",
      "restore",
      backupFileArg,
      "--expect-snapshot-hash",
      "\"$ICPDB_SNAPSHOT_HASH\"",
      ...envArgs,
      "--format",
      "table"
    ].join(" ")}`;
    output.nextOwnerArchiveRestoreSmokeCommand = ["icpdb", "check-env", ...envArgs, "--require-role", "owner", "--smoke-sql", "--smoke-sdk", "--smoke-archive-restore", "--smoke-sdk-archive-restore", "--format", "table"].join(" ");
  }
  return output;
}

type ArchiveNextCommands = {
  nextSnapshotInfoCommand: string;
  nextRestoreCommand: string;
  nextHashPinnedRestoreCommand: string;
  nextPostRestoreSchemaCountCommand: string;
  nextPostRestoreTablesCommand: string;
  nextPostRestoreViewsCommand: string;
  nextPostRestoreSchemaCommand: string;
  nextPostRestoreInspectCommand: string;
  nextPostRestoreStatsCommand: string;
  nextPostRestoreStatusCommand: string;
  nextPostRestoreMembersCommand: string;
  nextPostRestoreUrlCommand: string;
  nextPostRestoreInfoCommand: string;
};

function archiveNextCommands(file: string, envFile: string, sha256: string): ArchiveNextCommands {
  const envArgs = packageServiceEnvArgs(envFile);
  const fileArg = shellCommandArg(file);
  const restoreCommand = ["icpdb", "restore", fileArg, "--expect-snapshot-hash", shellCommandArg(sha256), ...envArgs, "--format", "table"];
  const hashPinnedRestoreCommand = `eval "$(icpdb snapshot-info ${fileArg} --format env)" && ${[
    "icpdb",
    "restore",
    fileArg,
    "--expect-snapshot-hash",
    "\"$ICPDB_SNAPSHOT_HASH\"",
    ...envArgs,
    "--format",
    "table"
  ].join(" ")}`;
  return {
    nextSnapshotInfoCommand: ["icpdb", "snapshot-info", fileArg, "--format", "table"].join(" "),
    nextRestoreCommand: restoreCommand.join(" "),
    nextHashPinnedRestoreCommand: hashPinnedRestoreCommand,
    ...postRestoreNextCommands(envFile)
  };
}

type PostRestoreNextCommands = {
  nextPostRestoreSchemaCountCommand: string;
  nextPostRestoreTablesCommand: string;
  nextPostRestoreViewsCommand: string;
  nextPostRestoreSchemaCommand: string;
  nextPostRestoreInspectCommand: string;
  nextPostRestoreStatsCommand: string;
  nextPostRestoreStatusCommand: string;
  nextPostRestoreMembersCommand: string;
  nextPostRestoreUrlCommand: string;
  nextPostRestoreInfoCommand: string;
};

function postRestoreNextCommands(envFile: string): PostRestoreNextCommands {
  const envArgs = packageServiceEnvArgs(envFile);
  return {
    nextPostRestoreSchemaCountCommand: ["icpdb", "scalar", ...envArgs, shellCommandArg("SELECT count(*) FROM sqlite_schema"), "--format", "table"].join(" "),
    nextPostRestoreTablesCommand: ["icpdb", "tables", ...envArgs, "--format", "table"].join(" "),
    nextPostRestoreViewsCommand: ["icpdb", "views", ...envArgs, "--format", "table"].join(" "),
    nextPostRestoreSchemaCommand: ["icpdb", "schema", ...envArgs, "--format", "table"].join(" "),
    nextPostRestoreInspectCommand: ["icpdb", "inspect", ...envArgs, "--format", "table"].join(" "),
    nextPostRestoreStatsCommand: ["icpdb", "stats", ...envArgs, "--format", "table"].join(" "),
    nextPostRestoreStatusCommand: ["icpdb", "status", ...envArgs, "--format", "table"].join(" "),
    nextPostRestoreMembersCommand: ["icpdb", "members", ...envArgs, "--format", "table"].join(" "),
    nextPostRestoreUrlCommand: ["icpdb", "url", ...envArgs, "--format", "env"].join(" "),
    nextPostRestoreInfoCommand: ["icpdb", "info", ...envArgs, "--format", "env"].join(" ")
  };
}

type ShardOperatorNextCommands = {
  nextShardInventoryCommand: string;
  nextAllPlacementsCommand: string;
  nextShardOpsCommand: string;
  nextShardMaintainDryRunCommand: string;
};

type ShardCanisterNextCommands = {
  nextShardStatusCommand: string;
  nextShardTopUpCommand: string;
};

type ShardDatabaseNextCommands = {
  nextRemoteDatabasePlacementCommand: string;
};

function shardInfoNextCommands(shard: DatabaseShardInfo, envFile: string): ShardOperatorNextCommands & ShardCanisterNextCommands {
  return {
    ...shardOperatorNextCommands(envFile),
    ...shardCanisterNextCommands(shard.canisterId, envFile)
  };
}

function shardStatusNextCommands(status: DatabaseShardStatus, envFile: string): ShardOperatorNextCommands & ShardCanisterNextCommands {
  return shardInfoNextCommands(status.shard, envFile);
}

function shardMaintenanceNextCommands(report: DatabaseShardMaintenanceReport, envFile: string): ShardOperatorNextCommands {
  void report;
  return shardOperatorNextCommands(envFile);
}

function shardPlacementNextCommands(placement: DatabaseShardPlacement, envFile: string): ShardOperatorNextCommands & Partial<ShardCanisterNextCommands> & ShardDatabaseNextCommands {
  return {
    ...shardOperatorNextCommands(envFile),
    ...(placement.canisterId === null ? {} : shardCanisterNextCommands(placement.canisterId, envFile)),
    ...shardDatabaseNextCommands(envFile)
  };
}

function shardRemoteDatabaseNextCommands(databaseCanisterId: string, envFile: string): ShardOperatorNextCommands & ShardCanisterNextCommands & ShardDatabaseNextCommands {
  return {
    ...shardOperatorNextCommands(envFile),
    ...shardCanisterNextCommands(databaseCanisterId, envFile),
    ...shardDatabaseNextCommands(envFile)
  };
}

function shardOperationNextCommands(operation: ShardOperationInfo, envFile: string): ShardOperatorNextCommands {
  void operation;
  return shardOperatorNextCommands(envFile);
}

function shardOperatorNextCommands(envFile: string): ShardOperatorNextCommands {
  const envArgs = packageServiceEnvArgs(envFile);
  return {
    nextShardInventoryCommand: ["icpdb", "shards", ...envArgs, "--format", "table"].join(" "),
    nextAllPlacementsCommand: ["icpdb", "all-placements", ...envArgs, "--format", "table"].join(" "),
    nextShardOpsCommand: ["icpdb", "shard-ops", ...envArgs, "--format", "table"].join(" "),
    nextShardMaintainDryRunCommand: ["icpdb", "shard-maintain", "0", "0", "0", "0", "0", "0", ...envArgs, "--format", "table"].join(" ")
  };
}

function shardCanisterNextCommands(databaseCanisterId: string, envFile: string): ShardCanisterNextCommands {
  const envArgs = packageServiceEnvArgs(envFile);
  const canisterArg = shellCommandArg(databaseCanisterId);
  return {
    nextShardStatusCommand: ["icpdb", "shard-status", canisterArg, ...envArgs, "--format", "table"].join(" "),
    nextShardTopUpCommand: ["icpdb", "shard-top-up", canisterArg, "<cycles>", ...envArgs, "--format", "table"].join(" ")
  };
}

function shardDatabaseNextCommands(envFile: string): ShardDatabaseNextCommands {
  const envArgs = packageServiceEnvArgs(envFile);
  return {
    nextRemoteDatabasePlacementCommand: ["icpdb", "all-placements", ...envArgs, "--format", "table"].join(" ")
  };
}

function packageServiceEnvArgs(envFile: string): string[] {
  return envFile === DEFAULT_ENV_FILE ? [] : ["--service-env-file", shellCommandArg(envFile)];
}

function shellCommandArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isWriteWaitCommand(command: string): boolean {
  return command === "execute" || command === "exec" || command === "sql" || command === "batch" || command === "transaction" || command === "script" || command === "load" || command === "migrate" || command === "shell";
}

function isBatchModeCommand(command: string): boolean {
  return command === "exec" || command === "batch" || command === "transaction" || command === "script" || command === "load" || command === "shell";
}

function isNonEnvReadingCommand(command: string): boolean {
  return command === "init" || command === "generate-identity" || command === "snapshot-info";
}

function isSqlParamsCommand(command: string): boolean {
  return command === "query" || command === "execute" || command === "sql" || command === "scalar";
}

function previewOptions(parsed: ParsedCli): { limit?: number; offset?: number } | undefined {
  if (parsed.limit === undefined && parsed.offset === undefined) return undefined;
  const options: { limit?: number; offset?: number } = {};
  if (parsed.limit !== undefined) options.limit = parsed.limit;
  if (parsed.offset !== undefined) options.offset = parsed.offset;
  return options;
}

function inspectOptions(parsed: ParsedCli, tableName: string | undefined): { tableName?: string; previewLimit?: number; previewOffset?: number } | undefined {
  if (tableName === undefined && parsed.limit === undefined && parsed.offset === undefined) return undefined;
  const options: { tableName?: string; previewLimit?: number; previewOffset?: number } = {};
  if (tableName !== undefined) options.tableName = tableName;
  if (parsed.limit !== undefined) options.previewLimit = parsed.limit;
  if (parsed.offset !== undefined) options.previewOffset = parsed.offset;
  return options;
}

function waitOptions(parsed: ParsedCli): IcpdbWaitForRoutedOperationOptions | undefined {
  if (parsed.reconcileUnknown === undefined && parsed.intervalMs === undefined && parsed.timeoutMs === undefined) return undefined;
  const options: IcpdbWaitForRoutedOperationOptions = {};
  if (parsed.reconcileUnknown !== undefined) options.reconcileUnknown = parsed.reconcileUnknown;
  if (parsed.intervalMs !== undefined) options.intervalMs = parsed.intervalMs;
  if (parsed.timeoutMs !== undefined) options.timeoutMs = parsed.timeoutMs;
  return options;
}

function generatedIdentityTargetOptions(parsed: ParsedCli): IcpdbGeneratedServiceIdentityTargetOptions {
  return {
    ...(parsed.canisterId === undefined ? {} : { canisterId: parsed.canisterId }),
    ...(parsed.databaseId === undefined ? {} : { databaseId: parsed.databaseId }),
    ...(parsed.networkUrl === undefined ? {} : { networkUrl: parsed.networkUrl }),
    ...(parsed.rootKey === undefined ? {} : { rootKey: parsed.rootKey })
  };
}

async function writeNewGeneratedIcpdbServiceEnvFile(
  path: string,
  identityType: IcpdbServiceIdentityType,
  target: IcpdbGeneratedServiceIdentityTargetOptions
) {
  await rejectExistingEnvOutFile(path);
  return writeGeneratedIcpdbServiceEnvFile(path, identityType, target);
}

async function rejectExistingEnvOutFile(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`--env-out refuses to overwrite existing file: ${path}`);
}

function isErrnoException(error: unknown): error is { code?: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

async function initPackageServiceDatabase(parsed: ParsedCli): Promise<{
  env: Record<string, string>;
  output: {
    identityType: IcpdbServiceIdentityType;
    principal: string;
    envOut: string;
    canisterId: string;
    databaseId: string;
    url: string;
    connectionUrl: string;
    nextInspectEnvCommand: string;
    nextSqlSmokeCommand: string;
    nextSchemaCountCommand: string;
    nextTablesCommand: string;
    nextUrlCommand: string;
    nextInfoCommand: string;
    networkUrl?: string;
    warning: string;
  };
}> {
  if (parsed.envOut === undefined) throw new Error("init requires --env-out service.env");
  if (parsed.canisterId === undefined) throw new Error("init requires --canister-id <id>");
  if (parsed.databaseId !== undefined) throw new Error("init creates a new database; omit --database-id");
  const setupEnv = await createDbSetupEnv(parsed, { inlineFiles: true });
  await validateInitSetupEnv(setupEnv);
  const identityType = parsed.identityType ?? "ed25519";
  const generated = await writeNewGeneratedIcpdbServiceEnvFile(parsed.envOut, identityType, generatedIdentityTargetOptions(parsed));
  const created = await createDatabaseFromCreateDbOptions({
    ...parsed,
    envFile: parsed.envOut
  }, setupEnv);
  const env = await loadIcpdbServiceEnvFile(parsed.envOut);
  return {
    env,
    output: {
      identityType: generated.identityType,
      principal: generated.principal,
      envOut: parsed.envOut,
      canisterId: parsed.canisterId,
      databaseId: created.databaseId,
      url: created.url,
      connectionUrl: created.url,
      ...postCreateNextCommands(parsed.envOut),
      ...(parsed.networkUrl === undefined ? {} : { networkUrl: parsed.networkUrl }),
      warning: generated.warning
    }
  };
}

async function checkPackageServiceEnv(parsed: ParsedCli): Promise<PackageServiceEnvCheck> {
  const inspection = await inspectIcpdbServiceEnvFile(parsed.envFile);
  const base: PackageServiceEnvCheck = {
    ok: true,
    envFile: parsed.envFile,
    skippedCall: parsed.skipCall === true,
    canisterId: inspection.canisterId,
    hasDatabase: inspection.hasDatabase,
    ...(inspection.databaseId === undefined ? {} : { databaseId: inspection.databaseId }),
    ...(inspection.connectionUrl === undefined ? {} : { connectionUrl: inspection.connectionUrl }),
    principal: inspection.principal,
    ...(inspection.networkUrl === undefined ? {} : { networkUrl: inspection.networkUrl }),
    ...(inspection.hasRootKey === undefined ? {} : { hasRootKey: inspection.hasRootKey }),
    checks: ["inspect-env"]
  };
  if (parsed.skipCall === true) return base;
  if (parsed.smokeShards === true || parsed.smokeSdkShards === true) {
    if (inspection.databaseId || inspection.connectionUrl) {
      throw new Error("check-env shard smokes require a canister-only controller env; remove ICPDB_DATABASE_ID and database-bearing ICPDB_URL");
    }
    const shardSmoke = parsed.smokeShards === true ? await smokePackageServiceShards(parsed.envFile, inspection.canisterId) : undefined;
    const sdkShardSmoke = parsed.smokeSdkShards === true ? await smokePackageServiceSdkShards(parsed.envFile, inspection.canisterId) : undefined;
    return {
      ...base,
      ...(shardSmoke === undefined ? {} : { shardSmoke }),
      ...(sdkShardSmoke === undefined ? {} : { sdkShardSmoke }),
      checks: [
        ...base.checks,
        ...(shardSmoke === undefined ? [] : [
          "health",
          "all_placements",
          "shards",
          "shard_inventory_consistency",
          ...(shardSmoke.statusCanisterId === undefined ? [] : ["shard_status"]),
          "shard_ops",
          "shard_maintain_zero_action"
        ]),
        ...(sdkShardSmoke === undefined ? [] : [
          "sdk_health",
          "sdk_all_placements",
          "sdk_shards",
          "sdk_shard_inventory_consistency",
          ...(sdkShardSmoke.statusCanisterId === undefined ? [] : ["sdk_shard_status"]),
          "sdk_shard_ops",
          "sdk_shard_maintain_zero_action"
        ])
      ]
    };
  }
  if (!inspection.databaseId || !inspection.connectionUrl) {
    throw new Error("check-env requires a database-bearing service.env; pass --skip-call for local-only inspection");
  }
  const client = await createClientFromEnvFile(parsed.envFile);
  try {
    const status = await client.status();
    assertCheckStatusMatchesEnv(status, inspection);
    const requiredRole = requiredCheckRole(parsed);
    if (requiredRole !== undefined) assertRoleAtLeast(status.callerRole, requiredRole);
    const sqlSmoke = parsed.smokeSql === true ? await smokePackageServiceSql(client) : undefined;
    const sdkSmoke = parsed.smokeSdk === true ? await smokePackageServiceSdk(parsed.envFile) : undefined;
    const archiveRestoreSmoke = parsed.smokeArchiveRestore === true ? await smokePackageServiceArchiveRestore(parsed.envFile, inspection.canisterId) : undefined;
    const sdkArchiveRestoreSmoke = parsed.smokeSdkArchiveRestore === true ? await smokePackageServiceSdkArchiveRestore(parsed.envFile, inspection.canisterId) : undefined;
    return {
      ...base,
      callerPrincipal: status.callerPrincipal,
      callerRole: status.callerRole,
      statusTableCount: status.stats.tableCount,
      statusViewCount: status.stats.viewCount,
      statusRowCount: status.stats.rowCount,
      statusColumnCount: status.stats.columnCount,
      statusIndexCount: status.stats.indexCount,
      statusTriggerCount: status.stats.triggerCount,
      statusForeignKeyCount: status.stats.foreignKeyCount,
      ...(sqlSmoke === undefined ? {} : { sqlSmoke }),
      ...(sdkSmoke === undefined ? {} : { sdkSmoke }),
      ...(archiveRestoreSmoke === undefined ? {} : { archiveRestoreSmoke }),
      ...(sdkArchiveRestoreSmoke === undefined ? {} : { sdkArchiveRestoreSmoke }),
      checks: [
        ...base.checks,
        "status",
        "database_id",
        "connection_url",
        "caller_principal",
        "caller_role",
        ...(requiredRole === undefined ? [] : [`caller_role_at_least_${requiredRole}`]),
        ...(sqlSmoke === undefined ? [] : ["sql_execute", "sql_query", "sql_scalar", "sql_cleanup"]),
        ...(sdkSmoke === undefined ? [] : ["sdk_status", "sdk_execute", "sdk_query", "sdk_scalar", "sdk_cleanup"]),
        ...(archiveRestoreSmoke === undefined ? [] : ["scratch_create_db", "archive", "snapshot_info", "scratch_restore", "archive_restore_query", "archive_restore_scalar", "scratch_delete_db", "archive_restore_cleanup"]),
        ...(sdkArchiveRestoreSmoke === undefined ? [] : ["sdk_archive", "sdk_snapshot_info", "sdk_scratch_create_db", "sdk_scratch_restore", "sdk_archive_restore_query", "sdk_archive_restore_scalar", "sdk_scratch_delete_db", "sdk_archive_restore_cleanup"])
      ]
    };
  } finally {
    client.close();
  }
}

function assertCheckStatusMatchesEnv(status: IcpdbDatabaseStatus, inspection: { databaseId?: string; connectionUrl?: string; principal: string }): void {
  if (status.databaseId !== inspection.databaseId) throw new Error("status databaseId does not match inspect-env");
  if (status.connectionUrl !== inspection.connectionUrl) throw new Error("status connectionUrl does not match inspect-env");
  if (status.callerPrincipal !== inspection.principal) throw new Error("status callerPrincipal does not match service identity principal");
  if (!status.callerRole) throw new Error("status callerRole is missing; service identity role is not visible");
}

function requiredCheckRole(parsed: ParsedCli): DatabaseRole | undefined {
  if (parsed.smokeSdkArchiveRestore === true) return strongestRole(parsed.requireRole, "owner");
  if (parsed.smokeArchiveRestore === true) return strongestRole(parsed.requireRole, "owner");
  if (parsed.smokeSdk === true) return strongestRole(parsed.requireRole, "writer");
  if (parsed.smokeSql === true) return strongestRole(parsed.requireRole, "writer");
  return parsed.requireRole;
}

function strongestRole(left: DatabaseRole | undefined, right: DatabaseRole): DatabaseRole {
  if (left === undefined) return right;
  return roleRank(left) >= roleRank(right) ? left : right;
}

function assertRoleAtLeast(actual: DatabaseRole | undefined, required: DatabaseRole): void {
  if (actual === undefined) throw new Error("caller role is missing");
  if (roleRank(actual) < roleRank(required)) throw new Error(`caller role ${actual} is below required role ${required}`);
}

function roleRank(role: DatabaseRole): number {
  if (role === "reader") return 1;
  if (role === "writer") return 2;
  return 3;
}

async function smokePackageServiceSql(client: IcpdbSqlClient): Promise<PackageServiceEnvSqlSmoke> {
  const table = `icpdb_package_check_${randomUUID().replaceAll("-", "_")}`;
  const selectedBody = `package-check-${randomUUID()}`;
  const selectedScalarBody = `package-check-scalar-${randomUUID()}`;
  try {
    await executePackageCheckSql(client, { sql: `CREATE TABLE ${table}(id INTEGER PRIMARY KEY, body TEXT NOT NULL)` });
    await executePackageCheckSql(client, { sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [selectedBody] });
    await executePackageCheckSql(client, { sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [selectedScalarBody] });
    const row = await client.get(`SELECT body FROM ${table} WHERE body = ?1`, [selectedBody]);
    if (row?.body !== selectedBody) throw new Error("check-env SQL smoke query did not read the inserted row");
    const scalar = await client.scalar(`SELECT body FROM ${table} WHERE body = ?1`, [selectedScalarBody]);
    if (scalar !== selectedScalarBody) throw new Error("check-env SQL smoke scalar did not read the inserted row");
    return { table, selectedBody, selectedScalarBody };
  } finally {
    try {
      await executePackageCheckSql(client, { sql: `DROP TABLE IF EXISTS ${table}` });
    } catch {
      // Preserve the original SQL smoke failure; cleanup is best-effort.
    }
  }
}

async function smokePackageServiceSdk(envFile: string): Promise<PackageServiceEnvSdkSmoke> {
  const client = await createClientFromEnvFile(envFile);
  try {
    await client.status();
    const table = `icpdb_package_sdk_check_${randomUUID().replaceAll("-", "_")}`;
    const selectedBody = `package-sdk-check-${randomUUID()}`;
    const selectedScalarBody = `package-sdk-check-scalar-${randomUUID()}`;
    try {
      await executePackageCheckSql(client, { sql: `CREATE TABLE ${table}(id INTEGER PRIMARY KEY, body TEXT NOT NULL)` });
      await executePackageCheckSql(client, { sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [selectedBody] });
      await executePackageCheckSql(client, { sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [selectedScalarBody] });
      const row = await client.get(`SELECT body FROM ${table} WHERE body = ?1`, [selectedBody]);
      if (row?.body !== selectedBody) throw new Error("check-env SDK smoke query did not read the inserted row");
      const scalar = await client.scalar(`SELECT body FROM ${table} WHERE body = ?1`, [selectedScalarBody]);
      if (scalar !== selectedScalarBody) throw new Error("check-env SDK smoke scalar did not read the inserted row");
      return { table, selectedBody, selectedScalarBody };
    } finally {
      try {
        await executePackageCheckSql(client, { sql: `DROP TABLE IF EXISTS ${table}` });
      } catch {
        // Preserve the original SDK smoke failure; cleanup is best-effort.
      }
    }
  } finally {
    client.close();
  }
}

async function executePackageCheckSql(client: PackageCheckSqlExecutor, statement: IcpdbSqlClientStatement): Promise<void> {
  const result = await client.execute(statement);
  if (result.routedOperationId) await client.waitForRoutedOperation(result.routedOperationId, { intervalMs: 0, timeoutMs: 30_000 });
}

async function smokePackageServiceArchiveRestore(envFile: string, canisterId: string): Promise<PackageServiceEnvArchiveRestoreSmoke> {
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-package-archive-"));
  const scratchEnvPath = join(tempDir, "scratch.env");
  const snapshotPath = join(tempDir, "snapshot.sqlite");
  const table = `icpdb_package_archive_${randomUUID().replaceAll("-", "_")}`;
  const selectedBody = `package-archive-${randomUUID()}`;
  const selectedScalarBody = `package-archive-scalar-${randomUUID()}`;
  let archiveDatabase: IcpdbDatabaseClient | undefined;
  let restoreDatabase: IcpdbDatabaseClient | undefined;
  try {
    await writePackageScratchServiceEnvFile(envFile, scratchEnvPath, canisterId);
    archiveDatabase = await createDatabaseFromEnvFile(scratchEnvPath);
    await executePackageCheckSql(archiveDatabase, { sql: `CREATE TABLE ${table}(id INTEGER PRIMARY KEY, body TEXT NOT NULL)` });
    await executePackageCheckSql(archiveDatabase, { sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [selectedBody] });
    await executePackageCheckSql(archiveDatabase, { sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [selectedScalarBody] });
    const archived = await archiveDatabaseToFile(archiveDatabase, snapshotPath);
    const snapshot = await snapshotInfoFile(snapshotPath);
    if (archived.sha256 !== snapshot.sha256) throw new Error("check-env archive/restore smoke snapshot hash mismatch");
    if (archived.sizeBytes !== snapshot.sizeBytes) throw new Error("check-env archive/restore smoke snapshot size mismatch");
    restoreDatabase = await createDatabaseFromEnvFile(scratchEnvPath);
    const scratchRestoreDatabaseId = restoreDatabase.databaseId;
    await restoreDatabase.delete();
    await restoreDatabaseFromFile(restoreDatabase, snapshotPath, { expectedSha256: snapshot.sha256 });
    const row = await restoreDatabase.get(`SELECT body FROM ${table} WHERE body = ?1`, [selectedBody]);
    if (row?.body !== selectedBody) throw new Error("check-env archive/restore smoke query did not read the restored row");
    const scalar = await restoreDatabase.scalar(`SELECT body FROM ${table} WHERE body = ?1`, [selectedScalarBody]);
    if (scalar !== selectedScalarBody) throw new Error("check-env archive/restore smoke scalar did not read the restored row");
    await restoreDatabase.delete();
    restoreDatabase = undefined;
    const scratchArchiveDatabaseId = archiveDatabase.databaseId;
    await archiveDatabase.delete();
    archiveDatabase = undefined;
    return {
      table,
      scratchArchiveDatabaseId,
      scratchRestoreDatabaseId,
      snapshotHash: snapshot.sha256,
      sizeBytes: snapshot.sizeBytes,
      selectedBody,
      selectedScalarBody
    };
  } finally {
    if (restoreDatabase !== undefined) await restoreDatabase.delete().catch(() => null);
    if (archiveDatabase !== undefined) await archiveDatabase.delete().catch(() => null);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function smokePackageServiceSdkArchiveRestore(envFile: string, canisterId: string): Promise<PackageServiceEnvSdkArchiveRestoreSmoke> {
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-package-sdk-archive-"));
  const scratchEnvPath = join(tempDir, "scratch-sdk.env");
  const snapshotPath = join(tempDir, "sdk-snapshot.sqlite");
  const table = `icpdb_package_sdk_archive_${randomUUID().replaceAll("-", "_")}`;
  const selectedBody = `package-sdk-archive-${randomUUID()}`;
  const selectedScalarBody = `package-sdk-archive-scalar-${randomUUID()}`;
  const client = await createClientFromEnvFile(envFile);
  let archiveDatabase: IcpdbDatabaseClient | undefined;
  let restoreDatabase: IcpdbDatabaseClient | undefined;
  try {
    await client.status();
    await writePackageScratchServiceEnvFile(envFile, scratchEnvPath, canisterId);
    archiveDatabase = await createDatabaseFromEnvFile(scratchEnvPath);
    await executePackageCheckSql(archiveDatabase, { sql: `CREATE TABLE ${table}(id INTEGER PRIMARY KEY, body TEXT NOT NULL)` });
    await executePackageCheckSql(archiveDatabase, { sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [selectedBody] });
    await executePackageCheckSql(archiveDatabase, { sql: `INSERT INTO ${table}(body) VALUES (?1)`, args: [selectedScalarBody] });
    const archived = await archiveDatabaseToFile(archiveDatabase, snapshotPath);
    const snapshot = await snapshotInfoFile(snapshotPath);
    if (archived.sha256 !== snapshot.sha256) throw new Error("check-env SDK archive/restore smoke snapshot hash mismatch");
    if (archived.sizeBytes !== snapshot.sizeBytes) throw new Error("check-env SDK archive/restore smoke snapshot size mismatch");
    restoreDatabase = await createDatabaseFromEnvFile(scratchEnvPath);
    const scratchRestoreDatabaseId = restoreDatabase.databaseId;
    await restoreDatabase.delete();
    await restoreDatabaseFromFile(restoreDatabase, snapshotPath, { expectedSha256: snapshot.sha256 });
    const row = await restoreDatabase.get(`SELECT body FROM ${table} WHERE body = ?1`, [selectedBody]);
    if (row?.body !== selectedBody) throw new Error("check-env SDK archive/restore smoke query did not read the restored row");
    const scalar = await restoreDatabase.scalar(`SELECT body FROM ${table} WHERE body = ?1`, [selectedScalarBody]);
    if (scalar !== selectedScalarBody) throw new Error("check-env SDK archive/restore smoke scalar did not read the restored row");
    await restoreDatabase.delete();
    restoreDatabase = undefined;
    const scratchArchiveDatabaseId = archiveDatabase.databaseId;
    await archiveDatabase.delete();
    archiveDatabase = undefined;
    return {
      table,
      scratchArchiveDatabaseId,
      scratchRestoreDatabaseId,
      snapshotHash: snapshot.sha256,
      sizeBytes: snapshot.sizeBytes,
      selectedBody,
      selectedScalarBody
    };
  } finally {
    if (restoreDatabase !== undefined) await restoreDatabase.delete().catch(() => null);
    if (archiveDatabase !== undefined) await archiveDatabase.delete().catch(() => null);
    client.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writePackageScratchServiceEnvFile(sourceEnvFile: string, scratchEnvFile: string, canisterId: string): Promise<void> {
  const sourceEnv = await loadIcpdbServiceEnvFile(sourceEnvFile);
  const scratchEnv: Record<string, string> = { ...sourceEnv, ICPDB_CANISTER_ID: canisterId };
  delete scratchEnv.ICPDB_DATABASE_ID;
  delete scratchEnv.ICPDB_URL;
  for (const key of SERVICE_SETUP_ENV_KEYS) delete scratchEnv[key];
  await writeIcpdbServiceEnvFile(scratchEnvFile, scratchEnv);
}

async function smokePackageServiceShards(envFile: string, canisterId: string): Promise<PackageServiceEnvShardSmoke> {
  return smokePackageServiceShardClient(envFile, canisterId, "shard smoke");
}

async function smokePackageServiceSdkShards(envFile: string, canisterId: string): Promise<PackageServiceEnvSdkShardSmoke> {
  return smokePackageServiceShardClient(envFile, canisterId, "SDK shard smoke");
}

async function smokePackageServiceShardClient(envFile: string, canisterId: string, label: string): Promise<PackageServiceEnvShardSmoke> {
  const serviceClient = await createIcpdbServiceClientFromEnvFile(envFile);
  const health = await serviceClient.health();
  const placements = await serviceClient.listAllPlacements();
  const shards = await serviceClient.listShards();
  const operationsBefore = await serviceClient.listShardOperations();
  const maintenance = await serviceClient.maintainShards({
    minAvailableSlots: 0,
    minCyclesBalance: 0,
    topUpCycles: 0,
    maxNewShards: 0,
    newShardMaxDatabases: 0,
    newShardInitialCycles: 0
  });
  const operationsAfter = await serviceClient.listShardOperations();
  assertPackageShardInventoryMatchesPlacements(placements, shards);
  const statusShard = firstPackageRemoteShard(shards);
  let shardStatus: { shard: DatabaseShardInfo; cyclesBalance: string } | undefined;
  if (statusShard !== undefined) {
    shardStatus = await serviceClient.getShardStatus(statusShard.canisterId);
    assertPackageShardStatusMatches(statusShard, shardStatus, label);
  }
  if (maintenance.actions.length !== 0) throw new Error(`check-env ${label} expected zero maintenance actions, got ${maintenance.actions.length}`);
  return {
    canisterId,
    healthCyclesBalance: health.cyclesBalance.toString(),
    placementCount: placements.length,
    shardCount: shards.length,
    operationCount: operationsAfter.length || operationsBefore.length,
    maintenanceAvailableSlots: maintenance.availableSlots,
    maintenanceActionCount: maintenance.actions.length,
    ...(shardStatus === undefined ? {} : {
      statusCanisterId: shardStatus.shard.canisterId,
      statusCyclesBalance: shardStatus.cyclesBalance
    }),
  };
}

function assertPackageShardInventoryMatchesPlacements(placements: DatabaseShardPlacement[], shards: DatabaseShardInfo[]): void {
  const shardCanisterIds = new Map<string, string>();
  for (const shard of shards) {
    if (shard.shardId.length === 0) throw new Error("check-env shard smoke shardId is empty");
    if (shard.canisterId.length === 0) throw new Error("check-env shard smoke canisterId is empty");
    shardCanisterIds.set(shard.shardId, shard.canisterId);
  }
  for (const placement of placements) {
    if (placement.shardId === "local") continue;
    const expectedCanisterId = shardCanisterIds.get(placement.shardId);
    if (expectedCanisterId === undefined) throw new Error(`check-env shard smoke placement references unregistered shard ${placement.shardId}`);
    if (placement.canisterId !== expectedCanisterId) {
      throw new Error(`check-env shard smoke placement canisterId does not match shard ${placement.shardId}`);
    }
  }
}

function firstPackageRemoteShard(shards: DatabaseShardInfo[]): DatabaseShardInfo | undefined {
  return shards.find((shard) => shard.canisterId.length > 0);
}

function assertPackageShardStatusMatches(shard: DatabaseShardInfo, status: { shard: DatabaseShardInfo; cyclesBalance: string }, label: string): void {
  if (status.shard.shardId !== shard.shardId) throw new Error(`check-env ${label} status shardId does not match shard inventory`);
  if (status.shard.canisterId !== shard.canisterId) throw new Error(`check-env ${label} status canisterId does not match shard inventory`);
  if (!/^[0-9]+$/.test(status.cyclesBalance)) throw new Error(`check-env ${label} status cyclesBalance must be a non-negative integer string`);
}

function packageServiceEnvCheckEnv(check: PackageServiceEnvCheck): Record<string, string | undefined> {
  return {
    ICPDB_SERVICE_CHECK_OK: check.ok ? "true" : "false",
    ICPDB_SERVICE_CHECK_ENV_FILE: check.envFile,
    ICPDB_SERVICE_CHECK_CANISTER_ID: check.canisterId,
    ICPDB_SERVICE_CHECK_HAS_DATABASE: check.hasDatabase ? "true" : "false",
    ICPDB_SERVICE_CHECK_DATABASE_ID: check.databaseId,
    ICPDB_SERVICE_CHECK_URL: check.connectionUrl,
    ICPDB_SERVICE_CHECK_CONNECTION_URL: check.connectionUrl,
    ICPDB_SERVICE_CHECK_PRINCIPAL: check.principal,
    ICPDB_SERVICE_CHECK_CALLER_PRINCIPAL: check.callerPrincipal,
    ICPDB_SERVICE_CHECK_CALLER_ROLE: check.callerRole,
    ICPDB_SERVICE_CHECK_NETWORK_URL: check.networkUrl,
    ICPDB_SERVICE_CHECK_HAS_ROOT_KEY: check.hasRootKey === undefined ? undefined : check.hasRootKey ? "true" : "false",
    ICPDB_SERVICE_CHECK_STATUS_TABLE_COUNT: check.statusTableCount === undefined ? undefined : String(check.statusTableCount),
    ICPDB_SERVICE_CHECK_STATUS_VIEW_COUNT: check.statusViewCount === undefined ? undefined : String(check.statusViewCount),
    ICPDB_SERVICE_CHECK_STATUS_ROW_COUNT: check.statusRowCount,
    ICPDB_SERVICE_CHECK_STATUS_COLUMN_COUNT: check.statusColumnCount === undefined ? undefined : String(check.statusColumnCount),
    ICPDB_SERVICE_CHECK_STATUS_INDEX_COUNT: check.statusIndexCount === undefined ? undefined : String(check.statusIndexCount),
    ICPDB_SERVICE_CHECK_STATUS_TRIGGER_COUNT: check.statusTriggerCount === undefined ? undefined : String(check.statusTriggerCount),
    ICPDB_SERVICE_CHECK_STATUS_FOREIGN_KEY_COUNT: check.statusForeignKeyCount === undefined ? undefined : String(check.statusForeignKeyCount),
    ICPDB_SERVICE_CHECK_SQL_TABLE: check.sqlSmoke?.table,
    ICPDB_SERVICE_CHECK_SQL_ROW: check.sqlSmoke?.selectedBody,
    ICPDB_SERVICE_CHECK_SQL_SCALAR_ROW: check.sqlSmoke?.selectedScalarBody,
    ICPDB_SERVICE_CHECK_SDK_TABLE: check.sdkSmoke?.table,
    ICPDB_SERVICE_CHECK_SDK_ROW: check.sdkSmoke?.selectedBody,
    ICPDB_SERVICE_CHECK_SDK_SCALAR_ROW: check.sdkSmoke?.selectedScalarBody,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_TABLE: check.archiveRestoreSmoke?.table,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCRATCH_ARCHIVE_DATABASE_ID: check.archiveRestoreSmoke?.scratchArchiveDatabaseId,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCRATCH_RESTORE_DATABASE_ID: check.archiveRestoreSmoke?.scratchRestoreDatabaseId,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_HASH: check.archiveRestoreSmoke?.snapshotHash,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SIZE_BYTES: check.archiveRestoreSmoke === undefined ? undefined : String(check.archiveRestoreSmoke.sizeBytes),
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_ROW: check.archiveRestoreSmoke?.selectedBody,
    ICPDB_SERVICE_CHECK_ARCHIVE_RESTORE_SCALAR_ROW: check.archiveRestoreSmoke?.selectedScalarBody,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_TABLE: check.sdkArchiveRestoreSmoke?.table,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCRATCH_ARCHIVE_DATABASE_ID: check.sdkArchiveRestoreSmoke?.scratchArchiveDatabaseId,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCRATCH_RESTORE_DATABASE_ID: check.sdkArchiveRestoreSmoke?.scratchRestoreDatabaseId,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_HASH: check.sdkArchiveRestoreSmoke?.snapshotHash,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SIZE_BYTES: check.sdkArchiveRestoreSmoke === undefined ? undefined : String(check.sdkArchiveRestoreSmoke.sizeBytes),
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_ROW: check.sdkArchiveRestoreSmoke?.selectedBody,
    ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCALAR_ROW: check.sdkArchiveRestoreSmoke?.selectedScalarBody,
    ICPDB_SERVICE_CHECK_SHARD_CANISTER_ID: check.shardSmoke?.canisterId,
    ICPDB_SERVICE_CHECK_SHARD_HEALTH_CYCLES_BALANCE: check.shardSmoke?.healthCyclesBalance,
    ICPDB_SERVICE_CHECK_SHARD_STATUS_CANISTER_ID: check.shardSmoke?.statusCanisterId,
    ICPDB_SERVICE_CHECK_SHARD_STATUS_CYCLES_BALANCE: check.shardSmoke?.statusCyclesBalance,
    ICPDB_SERVICE_CHECK_SHARD_COUNT: check.shardSmoke === undefined ? undefined : String(check.shardSmoke.shardCount),
    ICPDB_SERVICE_CHECK_SHARD_PLACEMENT_COUNT: check.shardSmoke === undefined ? undefined : String(check.shardSmoke.placementCount),
    ICPDB_SERVICE_CHECK_SHARD_OPERATION_COUNT: check.shardSmoke === undefined ? undefined : String(check.shardSmoke.operationCount),
    ICPDB_SERVICE_CHECK_SHARD_MAINTENANCE_AVAILABLE_SLOTS: check.shardSmoke?.maintenanceAvailableSlots,
    ICPDB_SERVICE_CHECK_SHARD_MAINTENANCE_ACTIONS: check.shardSmoke === undefined ? undefined : String(check.shardSmoke.maintenanceActionCount),
    ICPDB_SERVICE_CHECK_SDK_SHARD_CANISTER_ID: check.sdkShardSmoke?.canisterId,
    ICPDB_SERVICE_CHECK_SDK_SHARD_HEALTH_CYCLES_BALANCE: check.sdkShardSmoke?.healthCyclesBalance,
    ICPDB_SERVICE_CHECK_SDK_SHARD_STATUS_CANISTER_ID: check.sdkShardSmoke?.statusCanisterId,
    ICPDB_SERVICE_CHECK_SDK_SHARD_STATUS_CYCLES_BALANCE: check.sdkShardSmoke?.statusCyclesBalance,
    ICPDB_SERVICE_CHECK_SDK_SHARD_COUNT: check.sdkShardSmoke === undefined ? undefined : String(check.sdkShardSmoke.shardCount),
    ICPDB_SERVICE_CHECK_SDK_SHARD_PLACEMENT_COUNT: check.sdkShardSmoke === undefined ? undefined : String(check.sdkShardSmoke.placementCount),
    ICPDB_SERVICE_CHECK_SDK_SHARD_OPERATION_COUNT: check.sdkShardSmoke === undefined ? undefined : String(check.sdkShardSmoke.operationCount),
    ICPDB_SERVICE_CHECK_SDK_SHARD_MAINTENANCE_AVAILABLE_SLOTS: check.sdkShardSmoke?.maintenanceAvailableSlots,
    ICPDB_SERVICE_CHECK_SDK_SHARD_MAINTENANCE_ACTIONS: check.sdkShardSmoke === undefined ? undefined : String(check.sdkShardSmoke.maintenanceActionCount),
    ICPDB_SERVICE_CHECKS: check.checks.join(",")
  };
}

function sqlClientStatement(sql: string, args: IcpdbSqlArgsInput | undefined, idempotencyKey: string | undefined): IcpdbSqlClientStatement {
  const statement: IcpdbSqlClientStatement = { sql };
  if (args !== undefined) statement.args = args;
  if (idempotencyKey !== undefined) statement.idempotencyKey = idempotencyKey;
  return statement;
}

function batchOptions(parsed: ParsedCli): IcpdbBatchMode | IcpdbSqlClientBatchOptionsObject {
  const mode = parsed.mode ?? "write";
  if (parsed.idempotencyKey === undefined) return mode;
  return { mode, idempotencyKey: parsed.idempotencyKey };
}

function scriptOptions(parsed: ParsedCli): IcpdbSqlClientScriptOptionsObject | undefined {
  if (parsed.mode === undefined && parsed.idempotencyKey === undefined) return undefined;
  const options: IcpdbSqlClientScriptOptionsObject = {};
  if (parsed.mode !== undefined) options.mode = parsed.mode;
  if (parsed.idempotencyKey !== undefined) options.idempotencyKey = parsed.idempotencyKey;
  return options;
}

async function migrateVersioned(
  client: {
    queryRows: (statement: string, args?: IcpdbSqlArgsInput) => Promise<Record<string, unknown>[]>;
    execute: (statement: IcpdbSqlClientStatement) => Promise<IcpdbSqlClientResult>;
    batch: (statements: readonly IcpdbSqlClientBatchStatement[], options?: IcpdbBatchMode | IcpdbSqlClientBatchOptionsObject) => Promise<IcpdbSqlClientResult[]>;
    waitForRoutedOperation: (operationId: string, options?: IcpdbWaitForRoutedOperationOptions) => Promise<RoutedOperationInfo>;
  },
  parsed: ParsedCli,
  migrations: readonly IcpdbMigration[]
): Promise<IcpdbMigrationResult | { migration: IcpdbMigrationResult; routedOperations: RoutedOperationInfo[] }> {
  const normalized = normalizeCliMigrations(migrations);
  const writeResults: IcpdbSqlClientResult[] = [];
  const createMigrationTableResult = await ensureCliMigrationTable(client, parsed);
  if (createMigrationTableResult !== undefined) writeResults.push(createMigrationTableResult);
  const appliedVersions = new Set((await client.queryRows(`SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`)).map((row) => String(row.version)));
  const migration: IcpdbMigrationResult = { applied: [], skipped: [] };
  for (const entry of normalized) {
    if (appliedVersions.has(entry.version)) {
      migration.skipped.push(entry.version);
      continue;
    }
    const statements = splitSqlStatements(entry.sql);
    if (statements.length === 0) throw new Error(`migration ${entry.version} has no SQL statements`);
    const results = await client.batch([
      ...statements.map((sql) => ({ sql, params: [] })),
      {
        sql: `INSERT INTO ${MIGRATIONS_TABLE}(version, name, applied_at_ms) VALUES (?1, ?2, ?3)`,
        args: [entry.version, entry.name, String(Date.now())]
      }
    ], migrationBatchOptions(parsed, entry.version));
    writeResults.push(...results);
    appliedVersions.add(entry.version);
    migration.applied.push(entry.version);
  }
  if (parsed.wait !== true) return migration;
  return { migration, routedOperations: await waitForRoutedResults(client, parsed, writeResults) };
}

async function createDatabaseFromCreateDbOptions(parsed: ParsedCli, setupEnvOverride?: Record<string, string>): Promise<{ databaseId: string; url: string }> {
  if (parsed.setupSql === undefined && parsed.setupFile === undefined && parsed.setupStatementsFile === undefined && parsed.setupMigrationsFile === undefined) {
    const createClient = await createClientFromEnvFile(parsed.envFile);
    return {
      databaseId: await createClient.databaseId(),
      url: await createClient.url()
    };
  }
  const env = await loadIcpdbServiceEnvFile(parsed.envFile);
  rejectExistingSetupEnvForCreateDbOptions(env);
  const setupEnv = {
    ...env,
    ...(setupEnvOverride ?? await createDbSetupEnv(parsed))
  };
  const database = await createIcpdbServiceDatabaseFromEnv(setupEnv);
  try {
    await persistIcpdbServiceDatabaseId(parsed.envFile, database.databaseId);
  } catch (error) {
    try {
      await database.delete();
    } catch {
      // Preserve the env persistence failure; the just-created DB cleanup is best-effort.
    }
    throw error;
  }
  return {
    databaseId: database.databaseId,
    url: database.connectionUrl()
  };
}

async function runPackageShell(parsed: ParsedCli): Promise<void> {
  const oneShot = parsed.positional.join(" ").trim();
  let clientPromise: Promise<IcpdbSqlClient> | null = null;
  const getClient = () => {
    clientPromise ??= createClientFromEnvFile(parsed.envFile);
    return clientPromise;
  };
  if (oneShot) {
    await runPackageShellLine(oneShot, parsed, getClient);
    return;
  }
  const reader = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY)
  });
  try {
    if (!process.stdin.isTTY) {
      for await (const line of reader) {
        if (await runPackageShellLine(line, parsed, getClient)) break;
      }
      return;
    }
    while (true) {
      const line = await reader.question("icpdb> ");
      if (await runPackageShellLine(line, parsed, getClient)) break;
    }
  } finally {
    reader.close();
  }
}

async function runPackageShellLine(
  line: string,
  parsed: ParsedCli,
  getClient: () => Promise<IcpdbSqlClient>
): Promise<boolean> {
  const source = line.trim();
  if (!source) return false;
  if (source === ".quit" || source === ".exit") {
    assertPackageShellMode(source, parsed);
    assertPackageShellWriteOptions(source, parsed);
    return true;
  }
  if (source === ".help") {
    assertPackageShellMode(source, parsed);
    assertPackageShellWriteOptions(source, parsed);
    process.stdout.write(`${packageShellUsage()}\n`);
    return false;
  }
  if (source.startsWith(".help ")) {
    assertPackageShellMode(source, parsed);
    assertPackageShellWriteOptions(source, parsed);
    process.stdout.write(`${packageShellUsage(source.slice(".help ".length))}\n`);
    return false;
  }
  printJson(await packageShellResult(source, parsed, getClient));
  return false;
}

async function packageShellResult(
  source: string,
  parsed: ParsedCli,
  getClient: () => Promise<IcpdbSqlClient>
): Promise<unknown> {
  if (source === ".snapshot-info" || source.startsWith(".snapshot-info ")) {
    assertPackageShellMode(source, parsed);
    assertPackageShellWriteOptions(source, parsed);
    const [file] = shellWords(source.slice(".snapshot-info".length));
    assertShellWordLimit(source, ".snapshot-info", 1);
    return snapshotInfoFile(requiredNonEmpty(file ?? "", ".snapshot-info file"));
  }
  assertKnownPackageShellDotCommand(source);
  assertPackageShellDotCommandArgs(source);
  assertPackageShellMode(source, parsed);
  assertPackageShellWriteOptions(source, parsed);
  if (!source.startsWith(".") && parsed.mode === "read" && !isReadSql(source)) {
    throw new Error("read batch mode only accepts read SQL");
  }
  const readModeFileSource = await packageShellReadModeFileSource(source, parsed);
  const client = await getClient();
  if (source === ".principal") return { principal: await client.principal() };
  if (source === ".health") return client.health();
  if (source === ".url") return databaseHandoffFromClient(client, parsed.envFile);
  if (source === ".info") return client.info();
  if (source === ".status") return client.status();
  if (source === ".stats") {
    const status = await client.status();
    return {
      databaseId: status.databaseId,
      stats: status.stats,
      tableStatuses: status.tableStatuses
    };
  }
  if (source === ".tables") return client.tables();
  if (source === ".views") return client.views();
  if (source === ".members") return client.listMembers();
  if (source === ".usage") return client.getUsage();
  if (source === ".usage-events") return client.listUsageEvents();
  if (source === ".placement") return client.placement();
  if (source === ".schema") return { schema: await client.schema() };
  if (source.startsWith(".schema ")) return { schema: await client.schema(optionalTableNameArgFromShell(source, ".schema")) };
  if (source === ".describe" || source.startsWith(".describe ")) return client.describe(requiredTableShellArg(source, ".describe"));
  if (source === ".columns" || source.startsWith(".columns ")) return client.columns(requiredTableShellArg(source, ".columns"));
  if (source === ".indexes" || source.startsWith(".indexes ")) return client.indexes(requiredTableShellArg(source, ".indexes"));
  if (source === ".triggers" || source.startsWith(".triggers ")) return client.triggers(requiredTableShellArg(source, ".triggers"));
  if (source === ".foreign-keys" || source.startsWith(".foreign-keys ")) return client.foreignKeys(requiredTableShellArg(source, ".foreign-keys"));
  if (source === ".preview" || source.startsWith(".preview ")) {
    const [tableName, limitSource, offsetSource] = shellWords(source.slice(".preview".length));
    assertShellWordLimit(source, ".preview", 3);
    return client.preview(requiredNonEmpty(tableName ?? "", "table name"), shellPreviewOptions(limitSource, offsetSource));
  }
  if (source === ".inspect") return client.inspect();
  if (source.startsWith(".inspect ")) {
    const [tableName, limitSource, offsetSource] = shellWords(source.slice(".inspect".length));
    assertShellWordLimit(source, ".inspect", 3);
    return client.inspect(shellInspectOptions(tableName, limitSource, offsetSource));
  }
  if (source === ".dump") return { dump: await client.dumpSql() };
  if (source.startsWith(".dump ")) {
    const [file] = shellWords(source.slice(".dump".length));
    assertShellWordLimit(source, ".dump", 1);
    const dumpFile = requiredNonEmpty(file ?? "", ".dump file");
    const output = await writeOutputText(dumpFile, await client.dumpSql());
    return output === "file" ? {
      dumped: { file: dumpFile },
      ...await databaseHandoffFromClient(client, parsed.envFile)
    } : { dumped: { stdout: true } };
  }
  if (source === ".load" || source.startsWith(".load ")) {
    const [file] = shellWords(source.slice(".load".length));
    assertShellWordLimit(source, ".load", 1);
    const shellParsed = packageShellWriteParsed(parsed);
    const result = await client.loadSqlDump(readModeFileSource?.source ?? await readInputText(requiredNonEmpty(file ?? "", ".load file")), scriptOptions(shellParsed));
    return withOptionalWriteWait(client, shellParsed, result);
  }
  if (source === ".script" || source.startsWith(".script ")) {
    const [file] = shellWords(source.slice(".script".length));
    assertShellWordLimit(source, ".script", 1);
    const shellParsed = packageShellWriteParsed(parsed);
    const result = await client.executeScript(readModeFileSource?.source ?? await readInputText(requiredNonEmpty(file ?? "", ".script file")), scriptOptions(shellParsed));
    return withOptionalWriteWait(client, shellParsed, result);
  }
  if (source === ".migrate" || source.startsWith(".migrate ")) {
    const [file] = shellWords(source.slice(".migrate".length));
    assertShellWordLimit(source, ".migrate", 1);
    return migrateVersioned(client, packageShellWriteParsed(parsed), parseMigrations(await readInputText(requiredNonEmpty(file ?? "", ".migrate file"))));
  }
  if (source === ".operation" || source.startsWith(".operation ")) {
    const [operationId] = shellWords(source.slice(".operation".length));
    assertShellWordLimit(source, ".operation", 1);
    return client.getRoutedOperation(operationIdArg(requiredNonEmpty(operationId ?? "", "operation id")));
  }
  if (source === ".grant-member" || source.startsWith(".grant-member ")) {
    const [principalSource, roleSource] = shellWords(source.slice(".grant-member".length));
    assertShellWordLimit(source, ".grant-member", 2);
    const principal = grantablePrincipalArg(requiredNonEmpty(principalSource ?? "", "database member principal"));
    const role = cliDatabaseRole(requiredNonEmpty(roleSource ?? "", "role"));
    await client.grantMember(principal, role);
    return {
      granted: { principal, role },
      ...await databaseHandoffFromClient(client, parsed.envFile)
    };
  }
  if (source === ".revoke-member" || source.startsWith(".revoke-member ")) {
    const [principalSource] = shellWords(source.slice(".revoke-member".length));
    assertShellWordLimit(source, ".revoke-member", 1);
    const principal = memberPrincipalArg(requiredNonEmpty(principalSource ?? "", "database member principal"));
    await client.revokeMember(principal);
    return {
      revoked: { principal },
      ...await databaseHandoffFromClient(client, parsed.envFile)
    };
  }
  if (source === ".delete-db" || source.startsWith(".delete-db ")) {
    const [confirmedDatabaseId] = shellWords(source.slice(".delete-db".length));
    assertShellWordLimit(source, ".delete-db", 1);
    const handoff = await databaseHandoffFromEnvFile(parsed.envFile, ".delete-db");
    const targetDatabaseId = requiredNonEmpty(confirmedDatabaseId ?? "", "delete confirmation database id");
    if (targetDatabaseId !== handoff.databaseId) {
      throw new Error(`delete confirmation ${targetDatabaseId} does not match service env database id ${handoff.databaseId}`);
    }
    await client.delete();
    return {
      deleted: { databaseId: handoff.databaseId },
      ...handoff
    };
  }
  if (source === ".archive" || source.startsWith(".archive ")) {
    const [file] = shellWords(source.slice(".archive".length));
    assertShellWordLimit(source, ".archive", 1);
    const handoff = await databaseHandoffFromEnvFile(parsed.envFile, ".archive");
    const archive = await archiveDatabaseToFileFromEnvFile(requiredNonEmpty(file ?? "", ".archive file"), { envPath: parsed.envFile });
    return {
      ...archive,
      ...handoff,
      ...archiveNextCommands(archive.filePath, parsed.envFile, archive.sha256)
    };
  }
  if (source === ".restore" || source.startsWith(".restore ")) {
    const [file, expectedSha256] = shellWords(source.slice(".restore".length));
    assertShellWordLimit(source, ".restore", 2);
    const handoff = await databaseHandoffFromEnvFile(parsed.envFile, ".restore");
    const restore = await restoreDatabaseFromFileFromEnvFile(requiredNonEmpty(file ?? "", ".restore file"), {
      envPath: parsed.envFile,
      expectedSha256: expectedSha256 === undefined ? undefined : expectedSnapshotHashArg(expectedSha256)
    });
    return {
      ...restore,
      ...handoff,
      ...postRestoreNextCommands(parsed.envFile)
    };
  }
  if (source.startsWith(".")) throw new Error(`unknown shell command: ${source}`);
  return packageShellSqlResult(client, parsed, source);
}

async function packageShellSqlResult(client: IcpdbSqlClient, parsed: ParsedCli, sql: string): Promise<unknown> {
  try {
    return await client.query(sql);
  } catch (error) {
    if (!(error instanceof Error) || !/query only accepts read SQL/.test(error.message)) throw error;
  }
  const result = await client.execute({
    sql,
    idempotencyKey: packageShellIdempotencyKey(parsed)
  });
  return withOptionalWriteWait(client, parsed, result);
}

function packageShellWriteParsed(parsed: ParsedCli): ParsedCli {
  if (parsed.mode === "read") return parsed;
  return {
    ...parsed,
    idempotencyKey: parsed.idempotencyKey ?? packageShellIdempotencyKey(parsed)
  };
}

async function packageReadModeFileSource(parsed: ParsedCli): Promise<PackageReadModeFileSource | undefined> {
  if (parsed.mode !== "read") return undefined;
  if (parsed.command === "batch" || parsed.command === "transaction") {
    const file = requiredPositional(parsed, 0, "statements file");
    rejectExtraPositionals(parsed, 1);
    const statements = parseBatchStatements(await readInputText(file));
    if (!statements.every((statement) => isReadSql(batchStatementSql(statement)))) throw new Error("read batch mode only accepts read SQL");
    return { kind: "batch", statements };
  }
  if (parsed.command === "script") {
    const file = requiredPositional(parsed, 0, "SQL file");
    rejectExtraPositionals(parsed, 1);
    const source = await readInputText(file);
    validateReadModeSqlScriptSource(source);
    return { kind: "script", source };
  }
  if (parsed.command === "load") {
    const file = requiredPositional(parsed, 0, "SQL dump file");
    rejectExtraPositionals(parsed, 1);
    const source = await readInputText(file);
    validateReadModeSqlDumpSource(source);
    return { kind: "load", source };
  }
  return undefined;
}

async function packageShellReadModeFileSource(source: string, parsed: ParsedCli): Promise<{ source: string } | undefined> {
  if (parsed.mode !== "read") return undefined;
  if (source !== ".load" && !source.startsWith(".load ") && source !== ".script" && !source.startsWith(".script ")) return undefined;
  const command = source === ".load" || source.startsWith(".load ") ? ".load" : ".script";
  const [file] = shellWords(source.slice(command.length));
  const sourceText = await readInputText(requiredNonEmpty(file ?? "", `${command} file`));
  if (command === ".load") {
    validateReadModeSqlDumpSource(sourceText);
  } else {
    validateReadModeSqlScriptSource(sourceText);
  }
  return { source: sourceText };
}

function validateReadModeSqlScriptSource(source: string): void {
  const statements = splitSqlStatements(source);
  if (statements.length === 0) throw new Error("script requires at least one SQL statement");
  if (!statements.every(isReadSql)) throw new Error("read batch mode only accepts read SQL");
}

function validateReadModeSqlDumpSource(source: string): void {
  const statements = splitSqlDumpStatements(source);
  if (statements.length === 0) throw new Error("SQL dump has no executable statements");
  if (!statements.every(isReadSql)) throw new Error("read batch mode only accepts read SQL");
}

function batchStatementSql(statement: IcpdbSqlClientBatchStatement): string {
  if (typeof statement === "string") return statement;
  if ("sql" in statement) return statement.sql;
  return statement[0];
}

function packageShellIdempotencyKey(parsed: ParsedCli): string {
  const prefix = parsed.idempotencyKey ?? "icpdb-shell";
  return `${prefix}-${randomUUID()}`;
}

function assertKnownPackageShellDotCommand(source: string): void {
  if (!source.startsWith(".")) return;
  if (isPackageShellDotCommand(source, ".principal", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".health", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".url", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".info", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".status", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".stats", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".tables", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".views", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".members", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".usage", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".usage-events", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".placement", 0, 0)) return;
  if (isPackageShellDotCommand(source, ".schema", 0, 1)) return;
  if (isPackageShellDotCommand(source, ".describe", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".columns", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".indexes", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".triggers", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".foreign-keys", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".preview", 1, 3)) return;
  if (isPackageShellDotCommand(source, ".inspect", 0, 3)) return;
  if (isPackageShellDotCommand(source, ".dump", 0, 1)) return;
  if (isPackageShellDotCommand(source, ".load", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".script", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".migrate", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".operation", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".grant-member", 2, 2)) return;
  if (isPackageShellDotCommand(source, ".revoke-member", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".delete-db", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".archive", 1, 1)) return;
  if (isPackageShellDotCommand(source, ".restore", 1, 2)) return;
  throw new Error(`unknown shell command: ${source}`);
}

function isPackageShellDotCommand(source: string, command: string, minArgs: number, maxArgs: number): boolean {
  if (source !== command && !source.startsWith(`${command} `)) return false;
  const words = shellWords(source.slice(command.length));
  if (words.length < minArgs) throw new Error(`${command} requires ${minArgs} argument${minArgs === 1 ? "" : "s"}`);
  if (words.length > maxArgs) throw new Error(`${command} accepts at most ${maxArgs} argument${maxArgs === 1 ? "" : "s"}`);
  return true;
}

function assertPackageShellDotCommandArgs(source: string): void {
  const schemaArgs = packageShellArgs(source, ".schema");
  if (schemaArgs?.[0] !== undefined) requiredNonEmpty(schemaArgs[0], "table name");
  const describeArgs = packageShellArgs(source, ".describe");
  if (describeArgs !== null) requiredNonEmpty(describeArgs[0] ?? "", "table name");
  const columnsArgs = packageShellArgs(source, ".columns");
  if (columnsArgs !== null) requiredNonEmpty(columnsArgs[0] ?? "", "table name");
  const indexesArgs = packageShellArgs(source, ".indexes");
  if (indexesArgs !== null) requiredNonEmpty(indexesArgs[0] ?? "", "table name");
  const triggersArgs = packageShellArgs(source, ".triggers");
  if (triggersArgs !== null) requiredNonEmpty(triggersArgs[0] ?? "", "table name");
  const foreignKeysArgs = packageShellArgs(source, ".foreign-keys");
  if (foreignKeysArgs !== null) requiredNonEmpty(foreignKeysArgs[0] ?? "", "table name");
  const previewArgs = packageShellArgs(source, ".preview");
  if (previewArgs !== null) requiredNonEmpty(previewArgs[0] ?? "", "table name");
  const inspectArgs = packageShellArgs(source, ".inspect");
  if (inspectArgs?.[0] !== undefined) requiredNonEmpty(inspectArgs[0], "table name");
  const dumpArgs = packageShellArgs(source, ".dump");
  if (dumpArgs?.[0] !== undefined) requiredNonEmpty(dumpArgs[0], ".dump file");
  assertPackageShellRequiredArg(source, ".load", ".load file");
  assertPackageShellRequiredArg(source, ".script", ".script file");
  assertPackageShellRequiredArg(source, ".migrate", ".migrate file");
  assertPackageShellRequiredArg(source, ".operation", "operation id");
  const grantArgs = packageShellArgs(source, ".grant-member");
  if (grantArgs !== null) {
    grantablePrincipalArg(grantArgs[0] ?? "");
    cliDatabaseRole(requiredNonEmpty(grantArgs[1] ?? "", "role"));
  }
  assertPackageShellRequiredArg(source, ".revoke-member", "database member principal");
  assertPackageShellRequiredArg(source, ".delete-db", "delete confirmation database id");
  assertPackageShellRequiredArg(source, ".archive", ".archive file");
  const restoreArgs = packageShellArgs(source, ".restore");
  if (restoreArgs !== null) {
    requiredNonEmpty(restoreArgs[0] ?? "", ".restore file");
    if (restoreArgs[1] !== undefined) expectedSnapshotHashArg(restoreArgs[1]);
  }
}

function assertPackageShellRequiredArg(source: string, command: string, label: string): void {
  const args = packageShellArgs(source, command);
  if (args !== null) requiredNonEmpty(args[0] ?? "", label);
}

function packageShellArgs(source: string, command: string): string[] | null {
  if (source !== command && !source.startsWith(`${command} `)) return null;
  return shellWords(source.slice(command.length));
}

function assertPackageShellMode(source: string, parsed: ParsedCli): void {
  if (parsed.mode === undefined || !source.startsWith(".")) return;
  if (source === ".load" || source.startsWith(".load ") || source === ".script" || source.startsWith(".script ")) return;
  throw new Error("--mode is only valid for shell SQL, .load, and .script");
}

function assertPackageShellWriteOptions(source: string, parsed: ParsedCli): void {
  if (parsed.idempotencyKey === undefined && parsed.wait !== true) return;
  if (!source.startsWith(".")) {
    if (!isReadSql(source)) return;
    if (parsed.idempotencyKey !== undefined) throw new Error("--idempotency-key is only valid for write SQL");
    throw new Error("--wait is only valid for write SQL");
  }
  if (
    source === ".load" || source.startsWith(".load ") ||
    source === ".script" || source.startsWith(".script ") ||
    source === ".migrate" || source.startsWith(".migrate ")
  ) return;
  if (parsed.idempotencyKey !== undefined) throw new Error("--idempotency-key is only valid for shell write SQL, .load, .script, and .migrate");
  throw new Error("--wait is only valid for shell write SQL, .load, .script, and .migrate");
}

function optionalTableNameArgFromShell(source: string, command: string): string | undefined {
  const [tableName] = shellWords(source.slice(command.length));
  assertShellWordLimit(source, command, 1);
  if (tableName === undefined) return undefined;
  return requiredNonEmpty(tableName, "table name");
}

function requiredTableShellArg(source: string, command: string): string {
  const [tableName] = shellWords(source.slice(command.length));
  assertShellWordLimit(source, command, 1);
  return requiredNonEmpty(tableName ?? "", "table name");
}

function shellPreviewOptions(limitSource: string | undefined, offsetSource: string | undefined): { limit?: number; offset?: number } | undefined {
  if (limitSource === undefined && offsetSource === undefined) return undefined;
  const options: { limit?: number; offset?: number } = {};
  if (limitSource !== undefined) options.limit = positiveIntegerOption(limitSource, "preview limit", 500);
  if (offsetSource !== undefined) options.offset = nonNegativeIntegerOption(offsetSource, "preview offset", 4_294_967_295);
  return options;
}

function shellInspectOptions(
  tableName: string | undefined,
  limitSource: string | undefined,
  offsetSource: string | undefined
): { tableName?: string; previewLimit?: number; previewOffset?: number } | undefined {
  if (tableName === undefined && limitSource === undefined && offsetSource === undefined) return undefined;
  const options: { tableName?: string; previewLimit?: number; previewOffset?: number } = {};
  if (tableName !== undefined) options.tableName = requiredNonEmpty(tableName, "table name");
  if (limitSource !== undefined) options.previewLimit = positiveIntegerOption(limitSource, "inspect limit", 500);
  if (offsetSource !== undefined) options.previewOffset = nonNegativeIntegerOption(offsetSource, "inspect offset", 4_294_967_295);
  return options;
}

function assertShellWordLimit(source: string, command: string, max: number): void {
  const words = shellWords(source.slice(command.length));
  if (words.length > max) throw new Error(`${command} accepts at most ${max} argument${max === 1 ? "" : "s"}`);
}

function shellWords(source: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaping = false;
  for (const char of source.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaping) current += "\\";
  if (quote) throw new Error("unterminated shell quote");
  if (current) words.push(current);
  return words;
}

async function createDbSetupEnv(parsed: ParsedCli, options: { inlineFiles?: boolean } = {}): Promise<Record<string, string>> {
  if (parsed.setupSql !== undefined) return { ICPDB_SETUP_SQL: parsed.setupSql };
  if (parsed.setupFile !== undefined) {
    if (parsed.setupFile === "-") return { ICPDB_SETUP_SQL: await readInputText(parsed.setupFile) };
    if (options.inlineFiles === true) return { ICPDB_SETUP_SQL: await readInputText(parsed.setupFile) };
    return { ICPDB_SETUP_SQL_FILE: parsed.setupFile };
  }
  if (parsed.setupStatementsFile !== undefined) {
    if (parsed.setupStatementsFile === "-") return { ICPDB_SETUP_STATEMENTS: await readInputText(parsed.setupStatementsFile) };
    if (options.inlineFiles === true) return { ICPDB_SETUP_STATEMENTS: await readInputText(parsed.setupStatementsFile) };
    return { ICPDB_SETUP_STATEMENTS_FILE: parsed.setupStatementsFile };
  }
  if (parsed.setupMigrationsFile !== undefined) {
    if (parsed.setupMigrationsFile === "-") return { ICPDB_SETUP_MIGRATIONS: await readInputText(parsed.setupMigrationsFile) };
    if (options.inlineFiles === true) return { ICPDB_SETUP_MIGRATIONS: await readInputText(parsed.setupMigrationsFile) };
    return { ICPDB_SETUP_MIGRATIONS_FILE: parsed.setupMigrationsFile };
  }
  return {};
}

async function validateInitSetupEnv(setupEnv: Record<string, string>): Promise<void> {
  if (setupEnv.ICPDB_SETUP_SQL !== undefined && splitSqlStatements(setupEnv.ICPDB_SETUP_SQL).length === 0) {
    throw new Error("setup SQL must contain at least one SQL statement");
  }
  await loadIcpdbServiceSetupFromEnv(setupEnv);
}

function rejectExistingSetupEnvForCreateDbOptions(env: Record<string, string>): void {
  const existingKey = SERVICE_SETUP_ENV_KEYS.find((key) => env[key] !== undefined);
  if (existingKey !== undefined) {
    throw new Error(`create-db setup options cannot be combined with ${existingKey} in service env`);
  }
}

async function ensureCliMigrationTable(
  client: {
    queryRows: (statement: string, args?: IcpdbSqlArgsInput) => Promise<Record<string, unknown>[]>;
    execute: (statement: IcpdbSqlClientStatement) => Promise<IcpdbSqlClientResult>;
  },
  parsed: ParsedCli
): Promise<IcpdbSqlClientResult | undefined> {
  const existing = await client.queryRows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1", [MIGRATIONS_TABLE]);
  if (existing.length > 0) return undefined;
  return client.execute({
    sql: `CREATE TABLE ${MIGRATIONS_TABLE}(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at_ms TEXT NOT NULL)`,
    ...(parsed.idempotencyKey === undefined ? {} : { idempotencyKey: `${parsed.idempotencyKey}:schema` })
  });
}

function migrationBatchOptions(parsed: ParsedCli, version: string): IcpdbBatchMode | IcpdbSqlClientBatchOptionsObject {
  if (parsed.idempotencyKey === undefined) return "write";
  return { mode: "write", idempotencyKey: `${parsed.idempotencyKey}:migration:${encodeURIComponent(version)}` };
}

function normalizeCliMigrations(migrations: readonly IcpdbMigration[]): { version: string; name: string; sql: string }[] {
  const seen = new Set<string>();
  return migrations.map((migration) => {
    const version = String(migration.version).trim();
    if (!version) throw new Error("migration version is required");
    if (seen.has(version)) throw new Error(`duplicate migration version: ${version}`);
    seen.add(version);
    const name = migration.name === undefined ? version : migration.name.trim() || version;
    return { version, name, sql: migration.sql };
  });
}

async function withOptionalWriteWait(
  client: { waitForRoutedOperation: (operationId: string, options?: IcpdbWaitForRoutedOperationOptions) => Promise<RoutedOperationInfo> },
  parsed: ParsedCli,
  result: IcpdbSqlClientResult | IcpdbSqlClientResult[]
): Promise<IcpdbSqlClientResult | IcpdbSqlClientResult[] | { result: IcpdbSqlClientResult; routedOperations: RoutedOperationInfo[] } | { results: IcpdbSqlClientResult[]; routedOperations: RoutedOperationInfo[] }> {
  if (parsed.wait !== true) return result;
  const results = Array.isArray(result) ? result : [result];
  const routedOperations = await waitForRoutedResults(client, parsed, results);
  return Array.isArray(result) ? { results: result, routedOperations } : { result, routedOperations };
}

async function waitForRoutedResults(
  client: { waitForRoutedOperation: (operationId: string, options?: IcpdbWaitForRoutedOperationOptions) => Promise<RoutedOperationInfo> },
  parsed: ParsedCli,
  results: IcpdbSqlClientResult[]
): Promise<RoutedOperationInfo[]> {
  const operationIds = uniqueRoutedOperationIds(results);
  const routedOperations: RoutedOperationInfo[] = [];
  for (const operationId of operationIds) {
    routedOperations.push(await client.waitForRoutedOperation(operationId, waitOptions(parsed)));
  }
  return routedOperations;
}

function uniqueRoutedOperationIds(results: IcpdbSqlClientResult[]): string[] {
  const operationIds: string[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    const operationId = result.routedOperationId;
    if (!operationId || seen.has(operationId)) continue;
    seen.add(operationId);
    operationIds.push(operationId);
  }
  return operationIds;
}

function deleteConfirmDatabaseId(parsed: ParsedCli): string {
  if (parsed.confirm === undefined) throw new Error("delete-db requires --confirm <database-id>");
  return requiredNonEmpty(parsed.confirm, "delete confirmation database id");
}

async function loadSqlParams(parsed: ParsedCli): Promise<IcpdbSqlArgsInput | undefined> {
  if (parsed.params !== undefined) return parsed.params;
  if (parsed.paramsFile === undefined) return undefined;
  return parseSqlParams(await readInputText(parsed.paramsFile), "--params-file");
}

function parseSqlParams(source: string, label: string): IcpdbSqlArgsInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must be valid JSON: ${message}`);
  }
  if (Array.isArray(parsed)) return parsed.map(sqlValueInput);
  if (isPlainObject(parsed)) {
    const result: Record<string, IcpdbSqlValueInput> = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = sqlValueInput(value);
    }
    return result;
  }
  throw new Error(`${label} must be a JSON array or object`);
}

function sqlArgsInput(value: unknown, label: string): IcpdbSqlArgsInput {
  if (Array.isArray(value)) return value.map(sqlValueInput);
  if (isPlainObject(value)) {
    const result: Record<string, IcpdbSqlValueInput> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = sqlValueInput(item);
    }
    return result;
  }
  throw new Error(`${label} must be a JSON array or object`);
}

function parseBatchStatements(source: string): IcpdbSqlClientBatchStatement[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`statements file must be valid JSON: ${message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("statements file must contain a JSON array");
  if (parsed.length === 0) throw new Error("statements file must contain at least one statement");
  return parsed.map(batchStatementInput);
}

function batchStatementInput(value: unknown): IcpdbSqlClientBatchStatement {
  if (typeof value === "string") {
    if (value.trim().length === 0) throw new Error("batch statement SQL must be a non-empty string");
    return value;
  }
  if (Array.isArray(value)) return batchTupleInput(value);
  if (isPlainObject(value)) return batchObjectInput(value);
  throw new Error("batch statements must be strings, objects, or [sql, args] tuples");
}

function batchTupleInput(value: unknown[]): readonly [string, IcpdbSqlArgsInput?] {
  if (value.length < 1 || value.length > 2) throw new Error("batch statement tuple must be [sql] or [sql, args]");
  const sql = value[0];
  if (typeof sql !== "string" || sql.trim().length === 0) throw new Error("batch statement tuple sql must be a non-empty string");
  if (value.length === 1) return [sql];
  return [sql, sqlArgsInput(value[1], "batch statement tuple args")];
}

function batchObjectInput(value: Record<string, unknown>): Exclude<IcpdbSqlClientBatchStatement, string | readonly [string, IcpdbSqlArgsInput?]> {
  const sql = value.sql;
  if (typeof sql !== "string" || sql.trim().length === 0) throw new Error("batch statement object sql must be a non-empty string");
  const statement: Exclude<IcpdbSqlClientBatchStatement, string | readonly [string, IcpdbSqlArgsInput?]> = { sql };
  if (value.args !== undefined) statement.args = sqlArgsInput(value.args, "batch statement args");
  if (value.params !== undefined) statement.params = sqlArgsInput(value.params, "batch statement params");
  return statement;
}

function sqlValueInput(value: unknown): IcpdbSqlValueInput {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("numeric SQL params must be finite");
    return value;
  }
  throw new Error("SQL params must contain only null, string, number, or boolean values");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

async function readInputText(path: string): Promise<string> {
  const normalized = requiredNonEmpty(path, "input file");
  if (normalized === "-") return readStdinText();
  return readFile(normalized, "utf8");
}

async function writeOutputText(path: string, source: string): Promise<"stdout" | "file"> {
  const normalized = requiredNonEmpty(path, "output file");
  if (normalized === "-") {
    process.stdout.write(source);
    if (!source.endsWith("\n")) process.stdout.write("\n");
    return "stdout";
  }
  await writeFile(normalized, source, "utf8");
  return "file";
}

async function readStdinText(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let source = "";
  for await (const chunk of process.stdin) {
    source += String(chunk);
  }
  return source;
}

function parseMigrations(source: string): IcpdbMigration[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`migration file must be valid JSON: ${message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("migration file must contain a JSON array");
  const migrations: IcpdbMigration[] = [];
  for (const value of parsed) {
    if (!isPlainObject(value)) throw new Error("migration entries must be objects");
    const version = value.version;
    const name = value.name;
    const sql = value.sql;
    if (typeof version !== "string" && typeof version !== "number") throw new Error("migration version must be a string or number");
    if (name !== undefined && typeof name !== "string") throw new Error("migration name must be a string");
    if (typeof sql !== "string" || sql.trim().length === 0) throw new Error("migration sql must be a non-empty string");
    migrations.push(name === undefined ? { version, sql } : { version, name, sql });
  }
  return migrations;
}

function requiredPositional(parsed: ParsedCli, index: number, label: string): string {
  const value = parsed.positional[index];
  if (value === undefined || value.trim().length === 0) throw new Error(`missing ${label}`);
  return value;
}

function rejectExtraPositionals(parsed: ParsedCli, max: number): void {
  if (parsed.positional.length > max) throw new Error(`${parsed.command} accepts at most ${max} positional argument${max === 1 ? "" : "s"}`);
}

function requiredNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must be a non-empty string`);
  return trimmed;
}

function expectedSnapshotHashArg(value: string): string {
  const expected = requiredNonEmpty(value, "expected snapshot hash").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error("expectedSha256 must be a 64-character hex SHA-256 hash");
  return expected;
}

function printOutput(format: CliFormat, env: Record<string, string | undefined>, json: unknown): void {
  if (format === "env") {
    printEnv(env);
    return;
  }
  printFormatted(json);
}

function printEnv(env: Record<string, string | undefined>): void {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === "") continue;
    lines.push(`${key}=${JSON.stringify(value)}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printJson(value: unknown): void {
  printFormatted(value);
}

function printFormatted(value: unknown): void {
  if (currentOutputFormat === "table") {
    process.stdout.write(renderTable(value));
    return;
  }
  if (currentOutputFormat === "csv") {
    process.stdout.write(renderCsv(value));
    return;
  }
  process.stdout.write(`${JSON.stringify(value, jsonReplacer, 2)}\n`);
}

function renderTable(value: unknown): string {
  const { columns, rows } = tableData(value);
  if (columns.length === 0) return "(no rows)\n";
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => (row[column] ?? "").length)));
  const header = columns.map((column, index) => column.padEnd(widths[index] ?? column.length)).join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-|-");
  const body = rows.map((row) => columns.map((column, index) => (row[column] ?? "").padEnd(widths[index] ?? column.length)).join(" | "));
  return `${[header, divider, ...body].join("\n")}\n`;
}

function tableData(value: unknown): { columns: string[]; rows: Record<string, string>[] } {
  const rows = tableRows(value);
  if (isPlainObject(value) && Array.isArray(value.rows) && value.rows.length === 0) {
    const columns = sqlResultColumns(value.columns);
    if (columns.length > 0) return { columns, rows: [] };
  }
  if (rows.length === 0) return { columns: [], rows };
  return { columns: tableColumns(rows), rows };
}

function tableRows(value: unknown): Record<string, string>[] {
  if (isPlainObject(value)) {
    const rowValues = value.rows;
    if (Array.isArray(rowValues) && rowValues.length > 0) return arrayTableRows(rowValues);
    return Object.entries(value).map(([key, item]) => ({ key, value: cellText(item) }));
  }
  if (Array.isArray(value)) return arrayTableRows(value);
  return [{ value: cellText(value) }];
}

function arrayTableRows(values: unknown[]): Record<string, string>[] {
  if (values.length === 0) return [];
  return values.map((value, index) => {
    if (isPlainObject(value)) return objectTableRow(value);
    return { index: String(index), value: cellText(value) };
  });
}

function objectTableRow(value: Record<string, unknown>): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    row[key] = cellText(item);
  }
  return row;
}

function tableColumns(rows: readonly Record<string, string>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (seen.has(column)) continue;
      seen.add(column);
      columns.push(column);
    }
  }
  return columns.length === 0 ? ["value"] : columns;
}

function sqlResultColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const columns: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return [];
    columns.push(item);
  }
  return columns;
}

function renderCsv(value: unknown): string {
  const { columns, rows } = tableData(value);
  if (columns.length === 0) return "\n";
  return `${[
    columns.map(csvField).join(","),
    ...rows.map((row) => columns.map((column) => csvField(row[column] ?? "")).join(","))
  ].join("\n")}\n`;
}

function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function cellText(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value.replace(/\r?\n/g, "\\n");
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  const json = JSON.stringify(value, jsonReplacer);
  return (json ?? "").replace(/\r?\n/g, "\\n");
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return value;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`icpdb: ${message}\n`);
  process.exitCode = 1;
});
