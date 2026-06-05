// icpdb-console/lib/icpdb-service-identity.ts
// Node-only helpers for service identity SDK clients in server and CI jobs.

import { createHash } from "node:crypto";
import { chmod, open, readFile, stat, writeFile } from "node:fs/promises";
import type { Identity } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { Secp256k1KeyIdentity } from "@icp-sdk/core/identity/secp256k1";
import {
  connectIcpdbDatabase,
  createClient,
  createClientFromDatabase,
  createIcpdbDatabase,
  createIcpdbClient,
  formatIcpdbDatabaseUrl,
  parseIcpdbDatabaseUrl,
  type IcpdbClient,
  type IcpdbClientOptions,
  type IcpdbDatabaseClient,
  type IcpdbMigration,
  type IcpdbSqlArgsInput,
  type IcpdbSqlClient,
  type IcpdbSqlClientBatchStatement,
  type IcpdbSqlValueInput
} from "./icpdb-sdk.js";
import type { DatabaseRole } from "./types.js";

const SERVICE_ENV_FILE_MODE = 0o600;
const DEFAULT_SERVICE_ENV_FILE = "service.env";
const SERVICE_SNAPSHOT_CHUNK_BYTES = 256 * 1024;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const SERVICE_SETUP_ENV_KEYS: readonly string[] = [
  "ICPDB_SETUP_SQL",
  "ICPDB_SETUP_SQL_FILE",
  "ICPDB_SETUP_STATEMENTS",
  "ICPDB_SETUP_STATEMENTS_FILE",
  "ICPDB_SETUP_MIGRATIONS",
  "ICPDB_SETUP_MIGRATIONS_FILE"
];

export type IcpdbServiceIdentityType = "auto" | "ed25519" | "secp256k1";

export type IcpdbServiceIdentityOptions = {
  identityPem?: string;
  identityPemFile?: string;
  identityJson?: string;
  identityJsonFile?: string;
  identityType?: IcpdbServiceIdentityType;
  identityPrincipal?: string;
};

export type IcpdbServiceClientOptions = Omit<IcpdbClientOptions, "identity"> & IcpdbServiceIdentityOptions;

export type IcpdbServiceSetupOptions = {
  setupSql?: string;
  setupStatements?: readonly IcpdbSqlClientBatchStatement[];
  setupMigrations?: readonly IcpdbMigration[];
};

export type IcpdbServiceExistingDatabaseSqlClientOptions = IcpdbServiceClientOptions & {
  setupSql?: never;
  setupStatements?: never;
  setupMigrations?: never;
};

export type IcpdbServiceCreateSqlClientOptions = Omit<IcpdbServiceClientOptions, "databaseId"> & {
  databaseId?: never;
} & IcpdbServiceSetupOptions;

export type IcpdbServiceSqlClientOptions = IcpdbServiceExistingDatabaseSqlClientOptions | IcpdbServiceCreateSqlClientOptions;

export type IcpdbServiceGrantTarget = Pick<IcpdbDatabaseClient, "grantMember">;
export type IcpdbServiceEnvTarget = Pick<IcpdbDatabaseClient, "databaseId" | "connectionUrl" | "grantMember">;

export type IcpdbGeneratedServiceIdentity = {
  identityType: "ed25519" | "secp256k1";
  principal: string;
  identityJson: string;
  env: Record<string, string>;
  envText: string;
  warning: string;
};

export type IcpdbGeneratedServiceIdentityTargetOptions = {
  canisterId?: string;
  databaseId?: string;
  networkUrl?: string;
  rootKey?: string;
};

export type IcpdbProvisionedServiceEnv = IcpdbGeneratedServiceIdentity & {
  databaseId: string;
  connectionUrl: string;
  role: DatabaseRole;
};

export type IcpdbServiceEnvInspection = {
  canisterId: string;
  hasDatabase: boolean;
  databaseId?: string;
  url?: string;
  connectionUrl?: string;
  networkUrl?: string;
  principal: string;
  identityType: IcpdbServiceIdentityType;
  hasRootKey: boolean;
  hasSetupSql: boolean;
  setupStatementCount: number;
  setupMigrationCount: number;
};

export type IcpdbServiceEnvFileMode = {
  modeOctal: string;
  ownerOnly: true;
};

export type IcpdbServiceSnapshotFileInfo = {
  filePath: string;
  sizeBytes: number;
  sha256: string;
  snapshotHash: number[];
};

export type IcpdbServiceArchiveFileResult = IcpdbServiceSnapshotFileInfo & {
  databaseId: string;
};

export type IcpdbServiceRestoreFileOptions = {
  expectedSha256?: string;
};

export type IcpdbServiceEnvFileOptions = {
  envPath?: string;
};

export type IcpdbServiceEnvSourceOptions = {
  env?: Record<string, string | undefined>;
};

export type IcpdbServiceRestoreFileFromEnvOptions = IcpdbServiceRestoreFileOptions & IcpdbServiceEnvFileOptions;
export type IcpdbServiceRestoreFileFromEnvSourceOptions = IcpdbServiceRestoreFileOptions & IcpdbServiceEnvSourceOptions;

export type IcpdbServiceArchiveFileSource =
  Pick<IcpdbDatabaseClient, "databaseId" | "beginArchive" | "readArchiveChunk" | "finalizeArchive" | "cancelArchive">;

export type IcpdbServiceRestoreFileTarget =
  Pick<IcpdbDatabaseClient, "databaseId" | "beginRestore" | "writeRestoreChunk" | "finalizeRestore">;

export function generateIcpdbServiceIdentity(
  identityType: IcpdbServiceIdentityType = "ed25519",
  target: IcpdbGeneratedServiceIdentityTargetOptions = {}
): IcpdbGeneratedServiceIdentity {
  const normalizedType = serviceIdentityType(identityType, "ed25519");
  const resolvedType = normalizedType === "secp256k1" ? "secp256k1" : "ed25519";
  const identity = resolvedType === "secp256k1" ? Secp256k1KeyIdentity.generate() : Ed25519KeyIdentity.generate();
  const identityJson = JSON.stringify(identity.toJSON());
  const env = {
    ...generatedServiceIdentityTargetEnv(target),
    ICPDB_IDENTITY_TYPE: resolvedType,
    ICPDB_IDENTITY_PRINCIPAL: identity.getPrincipal().toText(),
    ICPDB_IDENTITY_JSON: identityJson
  };
  return {
    identityType: resolvedType,
    principal: identity.getPrincipal().toText(),
    identityJson,
    env,
    envText: formatIcpdbServiceEnv(env),
    warning: "Store ICPDB_IDENTITY_JSON in a secret manager. It contains the service identity private key."
  };
}

export async function writeGeneratedIcpdbServiceEnvFile(
  path: string,
  identityType: IcpdbServiceIdentityType = "ed25519",
  target: IcpdbGeneratedServiceIdentityTargetOptions = {}
): Promise<IcpdbGeneratedServiceIdentity> {
  const generated = generateIcpdbServiceIdentity(identityType, target);
  await writeIcpdbServiceEnvFile(path, generated.env);
  return generated;
}

export async function loadIcpdbServiceIdentity(options: IcpdbServiceIdentityOptions): Promise<Identity> {
  assertSingleServiceIdentitySecret(options);
  const identityType = serviceIdentityType(options.identityType, "auto");
  const json = optionalInlineSecretText(options.identityJson, "identityJson") ?? await readOptionalSecretText(options.identityJsonFile, "service identity file");
  if (json) return assertServiceIdentityPrincipal(identityFromJson(json, identityType), options.identityPrincipal);
  const pem = optionalInlineSecretText(options.identityPem, "identityPem")?.replaceAll("\\n", "\n") ?? await readOptionalSecretText(options.identityPemFile, "service identity file");
  if (pem) return assertServiceIdentityPrincipal(Secp256k1KeyIdentity.fromPem(pem), options.identityPrincipal);
  throw new Error("missing service identity");
}

export async function loadIcpdbServicePrincipal(options: IcpdbServiceIdentityOptions): Promise<string> {
  return (await loadIcpdbServiceIdentity(options)).getPrincipal().toText();
}

export async function createIcpdbServiceClient(options: IcpdbServiceClientOptions): Promise<IcpdbClient> {
  const identity = await loadIcpdbServiceIdentity(options);
  return createIcpdbClient({
    canisterId: options.canisterId,
    databaseId: options.databaseId,
    url: options.url,
    connectionUrl: options.connectionUrl,
    host: options.host,
    identity,
    rootKey: options.rootKey
  });
}

export async function connectIcpdbServiceDatabase(options: IcpdbServiceClientOptions): Promise<IcpdbDatabaseClient> {
  const identity = await loadIcpdbServiceIdentity(options);
  if (options.connectionUrl !== undefined) {
    return connectIcpdbDatabase({
      canisterId: options.canisterId,
      databaseId: options.databaseId,
      connectionUrl: options.connectionUrl,
      url: options.url,
      host: options.host,
      identity,
      rootKey: options.rootKey
    });
  }
  if (options.url !== undefined) {
    return connectIcpdbDatabase({
      canisterId: options.canisterId,
      url: options.url,
      databaseId: options.databaseId,
      host: options.host,
      identity,
      rootKey: options.rootKey
    });
  }
  if (options.databaseId !== undefined && options.canisterId !== undefined) {
    return connectIcpdbDatabase({
      canisterId: options.canisterId,
      databaseId: options.databaseId,
      host: options.host,
      identity,
      rootKey: options.rootKey
    });
  }
  if (options.databaseId !== undefined) throw new Error("missing canisterId; pass canisterId, url, or connectionUrl");
  throw new Error("databaseId is required");
}

export type IcpdbServiceCreateDatabaseOptions = Omit<IcpdbServiceClientOptions, "databaseId"> & {
  databaseId?: never;
} & IcpdbServiceSetupOptions;

export async function createIcpdbServiceDatabase(options: IcpdbServiceCreateDatabaseOptions): Promise<IcpdbDatabaseClient> {
  assertServiceCreateDatabaseOptions(options);
  const identity = await loadIcpdbServiceIdentity(options);
  return createIcpdbDatabase({
    canisterId: options.canisterId,
    url: options.url,
    connectionUrl: options.connectionUrl,
    host: options.host,
    identity,
    rootKey: options.rootKey,
    setupSql: options.setupSql,
    setupStatements: options.setupStatements,
    setupMigrations: options.setupMigrations
  });
}

export async function createIcpdbServiceSqlClient(options: IcpdbServiceSqlClientOptions): Promise<IcpdbSqlClient> {
  assertServiceSqlClientSetupOptions(options, options.databaseId);
  const identity = await loadIcpdbServiceIdentity(options);
  const clientOptions = {
    canisterId: options.canisterId,
    url: options.url,
    connectionUrl: options.connectionUrl,
    host: options.host,
    identity,
    rootKey: options.rootKey
  };
  if (options.databaseId !== undefined) {
    return createClient({
      ...clientOptions,
      databaseId: options.databaseId
    });
  }
  return createClient({
    ...clientOptions,
    setupSql: options.setupSql,
    setupStatements: options.setupStatements,
    setupMigrations: options.setupMigrations
  });
}

export async function grantIcpdbServiceIdentity(
  database: IcpdbServiceGrantTarget,
  options: IcpdbServiceIdentityOptions,
  role: DatabaseRole = "writer"
): Promise<string> {
  assertServiceGrantTarget(database);
  assertDatabaseRole(role);
  const principal = await loadIcpdbServicePrincipal(options);
  await database.grantMember(principal, role);
  return principal;
}

export async function provisionIcpdbServiceIdentity(
  database: IcpdbServiceGrantTarget,
  role: DatabaseRole = "writer",
  identityType: IcpdbServiceIdentityType = "ed25519"
): Promise<IcpdbGeneratedServiceIdentity> {
  assertServiceGrantTarget(database);
  assertDatabaseRole(role);
  const generated = generateIcpdbServiceIdentity(identityType);
  await database.grantMember(generated.principal, role);
  return generated;
}

export async function provisionIcpdbServiceEnvFile(
  database: IcpdbServiceEnvTarget,
  path: string,
  role: DatabaseRole = "writer",
  identityType: IcpdbServiceIdentityType = "ed25519",
  extraEnv: Record<string, string | undefined> = {}
): Promise<IcpdbProvisionedServiceEnv> {
  const filePath = requiredFilePath(path, "service env file");
  assertServiceEnvTarget(database);
  assertServiceOptionsObject(extraEnv, "extra service env");
  const extraServiceEnv = normalizeServiceEnv(extraEnv);
  const databaseId = serviceEnvTargetDatabaseId(database);
  const connectionUrl = serviceEnvTargetConnectionUrl(database);
  const parsed = parseIcpdbDatabaseUrl(connectionUrl);
  if (parsed.databaseId !== databaseId) {
    throw new Error("database connection URL does not match databaseId");
  }
  const generated = await provisionIcpdbServiceIdentity(database, role, identityType);
  const env = {
    ...extraServiceEnv,
    ...generated.env,
    ICPDB_CANISTER_ID: parsed.canisterId,
    ICPDB_DATABASE_ID: databaseId,
    ICPDB_URL: connectionUrl
  };
  const envText = formatIcpdbServiceEnv(env);
  await writeIcpdbServiceEnvFile(filePath, env);
  return {
    ...generated,
    databaseId,
    connectionUrl,
    role,
    env,
    envText
  };
}

export async function provisionIcpdbServiceDatabaseEnvFile(
  ownerOptions: IcpdbServiceCreateDatabaseOptions,
  path: string,
  role: DatabaseRole = "writer",
  generatedIdentityType: IcpdbServiceIdentityType = "ed25519",
  extraEnv: Record<string, string | undefined> = {}
): Promise<IcpdbProvisionedServiceEnv> {
  const filePath = requiredFilePath(path, "service env file");
  assertDatabaseRole(role);
  serviceIdentityType(generatedIdentityType, "ed25519");
  assertServiceOptionsObject(extraEnv, "extra service env");
  const database = await createIcpdbServiceDatabase(ownerOptions);
  try {
    return await provisionIcpdbServiceEnvFile(database, filePath, role, generatedIdentityType, extraEnv);
  } catch (error) {
    try {
      await database.delete();
    } catch {
      // Preserve the provisioning failure; deleting the just-created DB is best-effort cleanup.
    }
    throw error;
  }
}

function assertServiceCreateDatabaseOptions(options: Pick<IcpdbServiceCreateDatabaseOptions, "databaseId" | "url" | "connectionUrl">): void {
  if (options.databaseId) {
    throw new Error("createIcpdbServiceDatabase creates a new database; omit databaseId and use a canister-only ICPDB url");
  }
  const url = optionalServiceConnectionUrlOption(options);
  const parsed = url ? parseIcpdbDatabaseUrl(url) : null;
  if (parsed?.databaseId) {
    throw new Error("createIcpdbServiceDatabase creates a new database; omit databaseId and use a canister-only ICPDB url");
  }
}

function optionalServiceConnectionUrlOption(options: Pick<IcpdbServiceCreateDatabaseOptions, "url" | "connectionUrl">): string | undefined {
  const url = optionalServiceConnectionUrlValue(options.url, "url");
  const connectionUrl = optionalServiceConnectionUrlValue(options.connectionUrl, "connectionUrl");
  if (url && connectionUrl) {
    throw new Error("use either url or connectionUrl, not both");
  }
  return url || connectionUrl;
}

function optionalServiceConnectionUrlValue(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertServiceSqlClientSetupOptions(setup: IcpdbServiceSetupOptions, databaseId: string | undefined): void {
  if (!databaseId) return;
  if (setup.setupSql === undefined && setup.setupStatements === undefined && setup.setupMigrations === undefined) return;
  throw new Error("setupSql/setupStatements/setupMigrations require creating a database; omit databaseId or call exec/batch/migrate explicitly");
}

export async function loadIcpdbServiceEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<Record<string, string>> {
  const filePath = requiredFilePath(path, "service env file");
  await checkIcpdbServiceEnvFileMode(filePath);
  return parseServiceEnvFile(await readFile(filePath, "utf8"), filePath);
}

export async function checkIcpdbServiceEnvFileMode(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbServiceEnvFileMode> {
  return checkOwnerOnlyFileMode(requiredFilePath(path, "service env file"), "service env file");
}

async function checkOwnerOnlyFileMode(path: string, label: string): Promise<IcpdbServiceEnvFileMode> {
  const filePath = requiredFilePath(path, label);
  const stats = await stat(filePath);
  const mode = stats.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`${label} must be owner-only (0600 or stricter): ${filePath} is ${modeToOctal(mode)}`);
  }
  return {
    modeOctal: modeToOctal(mode),
    ownerOnly: true
  };
}

export function formatIcpdbServiceEnv(env: Record<string, string | undefined>): string {
  const lines = Object.entries(normalizeServiceEnv(env))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return `${lines.join("\n")}\n`;
}

export async function writeIcpdbServiceEnvFile(path: string, env: Record<string, string | undefined>): Promise<void> {
  const filePath = requiredFilePath(path, "service env file");
  await writeFile(filePath, formatIcpdbServiceEnv(env), { encoding: "utf8", mode: SERVICE_ENV_FILE_MODE });
  await chmod(filePath, SERVICE_ENV_FILE_MODE);
}

export async function persistIcpdbServiceDatabaseId(path: string, databaseId: string): Promise<Record<string, string>> {
  const filePath = requiredFilePath(path, "service env file");
  if (typeof databaseId !== "string" || databaseId.trim().length === 0) throw new Error("databaseId is required");
  const normalizedDatabaseId = databaseId.trim();
  const env = await loadIcpdbServiceEnvFile(filePath);
  const parsed = validateServiceConnectionEnv(env);
  const canisterId = optionalTrimmedEnvValue(env.ICPDB_CANISTER_ID, "ICPDB_CANISTER_ID") ?? parsed?.canisterId;
  const nextEnv = {
    ...serviceEnvWithoutSetup(env),
    ICPDB_DATABASE_ID: normalizedDatabaseId,
    ...(env.ICPDB_CANISTER_ID !== undefined && canisterId ? { ICPDB_CANISTER_ID: canisterId } : {}),
    ...(canisterId ? {
      ICPDB_URL: formatIcpdbDatabaseUrl(canisterId, normalizedDatabaseId)
    } : {})
  };
  await writeIcpdbServiceEnvFile(filePath, nextEnv);
  return nextEnv;
}

export async function createIcpdbServiceClientFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbClient> {
  const connection = serviceConnectionOptionsFromEnv(env);
  return createIcpdbServiceClient({
    ...connection,
    ...serviceIdentityOptionsFromEnv(env)
  });
}

export async function createIcpdbServiceClientFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbClient> {
  return createIcpdbServiceClientFromEnv(await loadIcpdbServiceEnvFile(path));
}

export async function connectIcpdbServiceDatabaseFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbDatabaseClient> {
  const connection = serviceConnectionOptionsFromEnv(env);
  return connectIcpdbServiceDatabase({
    ...connection,
    ...serviceIdentityOptionsFromEnv(env)
  });
}

export async function connectIcpdbServiceDatabaseFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbDatabaseClient> {
  return connectIcpdbServiceDatabaseFromEnv(await loadIcpdbServiceEnvFile(path));
}

export async function connectDatabaseFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbDatabaseClient> {
  return connectIcpdbServiceDatabaseFromEnv(env);
}

export async function connectDatabaseFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbDatabaseClient> {
  return connectIcpdbServiceDatabaseFromEnvFile(path);
}

export async function createIcpdbServiceDatabaseFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbDatabaseClient> {
  const connection = serviceConnectionOptionsFromEnv(env);
  if (connection.databaseId) {
    throw new Error("createIcpdbServiceDatabaseFromEnv creates a new database; omit ICPDB_DATABASE_ID and use a canister-only ICPDB_URL");
  }
  const setup = await loadIcpdbServiceSetupFromEnv(env);
  return createIcpdbServiceDatabase({
    canisterId: connection.canisterId,
    url: connection.url,
    host: connection.host,
    rootKey: connection.rootKey,
    ...serviceIdentityOptionsFromEnv(env),
    setupSql: setup.setupSql,
    setupStatements: setup.setupStatements,
    setupMigrations: setup.setupMigrations
  });
}

export async function createIcpdbServiceDatabaseFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbDatabaseClient> {
  return createIcpdbServiceDatabaseFromEnv(await loadIcpdbServiceEnvFile(path));
}

export async function createDatabaseFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbDatabaseClient> {
  return createIcpdbServiceDatabaseFromEnv(env);
}

export async function createDatabaseFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbDatabaseClient> {
  return createIcpdbServiceDatabaseFromEnvFile(path);
}

export async function createIcpdbServiceSqlClientFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbSqlClient> {
  const connection = serviceConnectionOptionsFromEnv(env);
  const setup = await loadIcpdbServiceSetupFromEnv(env);
  assertServiceSqlClientSetupOptions(setup, connection.databaseId);
  const identityOptions = serviceIdentityOptionsFromEnv(env);
  if (connection.databaseId !== undefined) {
    return createIcpdbServiceSqlClient({
      ...connection,
      ...identityOptions
    });
  }
  return createIcpdbServiceSqlClient({
    canisterId: connection.canisterId,
    url: connection.url,
    host: connection.host,
    rootKey: connection.rootKey,
    ...identityOptions,
    setupSql: setup.setupSql,
    setupStatements: setup.setupStatements,
    setupMigrations: setup.setupMigrations
  });
}

export async function createIcpdbServiceSqlClientFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbSqlClient> {
  return createIcpdbServiceSqlClientFromEnv(await loadIcpdbServiceEnvFile(path));
}

export async function createClientFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbSqlClient> {
  assertServiceConnectionHasDatabase(env, "createClientFromEnv");
  return createIcpdbServiceSqlClientFromEnv(env);
}

export async function connectClientFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbSqlClient> {
  assertServiceConnectionHasDatabase(env, "connectClientFromEnv");
  return createIcpdbServiceSqlClientFromEnv(env);
}

export async function connectClientFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbSqlClient> {
  const env = await loadIcpdbServiceEnvFile(path);
  assertServiceConnectionHasDatabase(env, "connectClientFromEnvFile");
  return createIcpdbServiceSqlClientFromEnv(env);
}

export async function createClientFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbSqlClient> {
  return createIcpdbPersistedServiceSqlClientFromEnvFile(path);
}

export async function createIcpdbPersistedServiceSqlClientFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbSqlClient> {
  return createClientFromDatabase(() => persistedServiceDatabaseFromEnvFile(path), {
    principal: () => loadIcpdbServicePrincipalFromEnvFile(path),
    health: async () => (await createIcpdbServiceClientFromEnvFile(path)).health()
  });
}

export async function loadIcpdbServicePrincipalFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  return loadIcpdbServicePrincipal(serviceIdentityOptionsFromEnv(env));
}

export async function loadIcpdbServicePrincipalFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<string> {
  return loadIcpdbServicePrincipalFromEnv(await loadIcpdbServiceEnvFile(path));
}

export async function inspectIcpdbServiceEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbServiceEnvInspection> {
  const connection = serviceConnectionOptionsFromEnv(env);
  if (!connection.canisterId) throw new Error("ICPDB_CANISTER_ID or ICPDB_URL is required");
  const setup = await loadIcpdbServiceSetupFromEnv(env);
  const principal = await loadIcpdbServicePrincipalFromEnv(env);
  const databaseId = connection.databaseId;
  return {
    canisterId: connection.canisterId,
    hasDatabase: databaseId !== undefined,
    ...(databaseId ? { databaseId, connectionUrl: formatIcpdbDatabaseUrl(connection.canisterId, databaseId) } : {}),
    ...(connection.url ? { url: connection.url } : {}),
    ...(connection.host ? { networkUrl: connection.host } : {}),
    principal,
    identityType: identityTypeFromEnv(optionalTrimmedEnvValue(env.ICPDB_IDENTITY_TYPE, "ICPDB_IDENTITY_TYPE")),
    hasRootKey: Boolean(env.ICPDB_ROOT_KEY),
    hasSetupSql: setup.setupSql !== undefined,
    setupStatementCount: setup.setupStatements?.length ?? 0,
    setupMigrationCount: setup.setupMigrations?.length ?? 0
  };
}

export async function inspectIcpdbServiceEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbServiceEnvInspection> {
  return inspectIcpdbServiceEnv(await loadIcpdbServiceEnvFile(path));
}

export async function loadIcpdbServiceSetupFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<IcpdbServiceSetupOptions> {
  assertServiceEnvObject(env);
  return {
    setupSql: await setupSqlFromEnv(env),
    setupStatements: await setupStatementsFromEnv(env),
    setupMigrations: await setupMigrationsFromEnv(env)
  };
}

export async function loadIcpdbServiceSetupFromEnvFile(path: string = DEFAULT_SERVICE_ENV_FILE): Promise<IcpdbServiceSetupOptions> {
  return loadIcpdbServiceSetupFromEnv(await loadIcpdbServiceEnvFile(path));
}

export async function grantIcpdbServiceIdentityFromEnv(
  database: IcpdbServiceGrantTarget,
  env: Record<string, string | undefined> = process.env,
  role: DatabaseRole = "writer"
): Promise<string> {
  assertServiceGrantTarget(database);
  assertDatabaseRole(role);
  return grantIcpdbServiceIdentity(database, serviceIdentityOptionsFromEnv(env), role);
}

export async function grantIcpdbServiceIdentityFromEnvFile(
  database: IcpdbServiceGrantTarget,
  path: string = DEFAULT_SERVICE_ENV_FILE,
  role: DatabaseRole = "writer"
): Promise<string> {
  assertServiceGrantTarget(database);
  assertDatabaseRole(role);
  return grantIcpdbServiceIdentityFromEnv(database, await loadIcpdbServiceEnvFile(path), role);
}

export async function snapshotInfoIcpdbServiceFile(filePath: string): Promise<IcpdbServiceSnapshotFileInfo> {
  const snapshotPath = requiredFilePath(filePath, "snapshot file");
  const file = await stat(snapshotPath);
  if (!Number.isSafeInteger(file.size)) {
    throw new Error("snapshot file size exceeds JavaScript safe integer range");
  }
  const input = await open(snapshotPath, "r");
  const hash = createHash("sha256");
  let offset = 0;
  try {
    while (offset < file.size) {
      const length = Math.min(SERVICE_SNAPSHOT_CHUNK_BYTES, file.size - offset);
      const buffer = new Uint8Array(length);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (bytesRead === 0) throw new Error("snapshot file ended before expected size");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    await input.close();
  }
  const snapshotHash = Array.from(hash.digest());
  return {
    filePath: snapshotPath,
    sizeBytes: file.size,
    sha256: bytesToHex(snapshotHash),
    snapshotHash
  };
}

export async function snapshotInfoFile(filePath: string): Promise<IcpdbServiceSnapshotFileInfo> {
  return snapshotInfoIcpdbServiceFile(filePath);
}

export async function archiveIcpdbServiceDatabaseToFile(
  database: IcpdbServiceArchiveFileSource,
  filePath: string
): Promise<IcpdbServiceArchiveFileResult> {
  const archivePath = requiredFilePath(filePath, "archive file");
  assertServiceArchiveFileSource(database);
  const databaseId = serviceArchiveSourceDatabaseId(database);
  const rawInfo = await database.beginArchive();
  let info: { databaseId: string; sizeBytes: string };
  let sizeBytes: number;
  try {
    info = archiveBeginInfo(rawInfo, databaseId);
    sizeBytes = archiveSizeBytes(info.sizeBytes);
  } catch (error) {
    try {
      await database.cancelArchive();
    } catch {
      // Preserve the malformed archive metadata failure; archive cancellation is best-effort cleanup.
    }
    throw error;
  }
  let output: Awaited<ReturnType<typeof open>> | undefined;
  const hash = createHash("sha256");
  let offset = 0;
  try {
    output = await open(archivePath, "w");
    while (offset < sizeBytes) {
      const maxBytes = Math.min(SERVICE_SNAPSHOT_CHUNK_BYTES, sizeBytes - offset);
      const chunk = archiveChunkBytes(await database.readArchiveChunk(String(offset), maxBytes));
      if (chunk.byteLength === 0) throw new Error("archive stream ended before expected size");
      await output.write(chunk, 0, chunk.byteLength, offset);
      hash.update(chunk);
      offset += chunk.byteLength;
    }
    await output.close();
    output = undefined;
  } catch (error) {
    if (output) {
      try {
        await output.close();
      } catch {
        // Preserve the archive transfer failure; output close is best-effort cleanup.
      }
    }
    try {
      await database.cancelArchive();
    } catch {
      // Preserve the open/transfer failure; archive cancellation is best-effort cleanup.
    }
    throw error;
  }
  const snapshotHash = Array.from(hash.digest());
  try {
    await database.finalizeArchive(snapshotHash);
  } catch (error) {
    try {
      await database.cancelArchive();
    } catch {
      // Preserve the finalize failure; archive cancellation is best-effort cleanup.
    }
    throw error;
  }
  return {
    databaseId: info.databaseId,
    filePath: archivePath,
    sizeBytes,
    sha256: bytesToHex(snapshotHash),
    snapshotHash
  };
}

export async function archiveDatabaseToFile(
  database: IcpdbServiceArchiveFileSource,
  filePath: string
): Promise<IcpdbServiceArchiveFileResult> {
  return archiveIcpdbServiceDatabaseToFile(database, filePath);
}

export async function restoreIcpdbServiceDatabaseFromFile(
  database: IcpdbServiceRestoreFileTarget,
  filePath: string,
  options?: IcpdbServiceRestoreFileOptions
): Promise<IcpdbServiceSnapshotFileInfo> {
  requiredFilePath(filePath, "snapshot file");
  assertServiceRestoreFileTarget(database);
  serviceRestoreTargetDatabaseId(database);
  assertServiceOptionsObject(options, "restore options");
  const expectedSha256 = expectedServiceSnapshotSha256(options);
  const snapshot = await snapshotInfoIcpdbServiceFile(filePath);
  assertExpectedServiceSnapshotHash(snapshot, expectedSha256);
  await database.beginRestore(snapshot.snapshotHash, String(snapshot.sizeBytes));
  const input = await open(snapshot.filePath, "r");
  let offset = 0;
  try {
    while (offset < snapshot.sizeBytes) {
      const length = Math.min(SERVICE_SNAPSHOT_CHUNK_BYTES, snapshot.sizeBytes - offset);
      const buffer = new Uint8Array(length);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (bytesRead === 0) throw new Error("restore file ended before expected size");
      await database.writeRestoreChunk(String(offset), buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    await input.close();
  }
  await database.finalizeRestore();
  return snapshot;
}

export async function restoreDatabaseFromFile(
  database: IcpdbServiceRestoreFileTarget,
  filePath: string,
  options?: IcpdbServiceRestoreFileOptions
): Promise<IcpdbServiceSnapshotFileInfo> {
  return restoreIcpdbServiceDatabaseFromFile(database, filePath, options);
}

function assertServiceArchiveFileSource(database: IcpdbServiceArchiveFileSource): void {
  if (typeof database !== "object" || database === null) throw new Error("archive database source must be an object");
  serviceArchiveSourceDatabaseId(database);
  if (typeof database.beginArchive !== "function") throw new Error("archive database source beginArchive must be a function");
  if (typeof database.readArchiveChunk !== "function") throw new Error("archive database source readArchiveChunk must be a function");
  if (typeof database.finalizeArchive !== "function") throw new Error("archive database source finalizeArchive must be a function");
  if (typeof database.cancelArchive !== "function") throw new Error("archive database source cancelArchive must be a function");
}

function assertServiceRestoreFileTarget(database: IcpdbServiceRestoreFileTarget): void {
  if (typeof database !== "object" || database === null) throw new Error("restore database target must be an object");
  serviceRestoreTargetDatabaseId(database);
  if (typeof database.beginRestore !== "function") throw new Error("restore database target beginRestore must be a function");
  if (typeof database.writeRestoreChunk !== "function") throw new Error("restore database target writeRestoreChunk must be a function");
  if (typeof database.finalizeRestore !== "function") throw new Error("restore database target finalizeRestore must be a function");
}

function serviceArchiveSourceDatabaseId(database: IcpdbServiceArchiveFileSource): string {
  if (typeof database.databaseId !== "string" || database.databaseId.trim().length === 0) {
    throw new Error("archive database source databaseId must be a non-empty string");
  }
  return database.databaseId.trim();
}

function serviceRestoreTargetDatabaseId(database: IcpdbServiceRestoreFileTarget): string {
  if (typeof database.databaseId !== "string" || database.databaseId.trim().length === 0) {
    throw new Error("restore database target databaseId must be a non-empty string");
  }
  return database.databaseId.trim();
}

function assertServiceOptionsObject(options: unknown, label: string): void {
  if (options === undefined) return;
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertServiceGrantTarget(database: IcpdbServiceGrantTarget): void {
  if (typeof database !== "object" || database === null || Array.isArray(database)) {
    throw new Error("service grant target must be an object");
  }
  if (typeof database.grantMember !== "function") throw new Error("service grant target grantMember must be a function");
}

function assertServiceEnvTarget(database: IcpdbServiceEnvTarget): void {
  if (typeof database !== "object" || database === null || Array.isArray(database)) {
    throw new Error("service env target must be an object");
  }
  serviceEnvTargetDatabaseId(database);
  if (typeof database.connectionUrl !== "function") throw new Error("service env target connectionUrl must be a function");
  if (typeof database.grantMember !== "function") throw new Error("service env target grantMember must be a function");
}

function serviceEnvTargetDatabaseId(database: IcpdbServiceEnvTarget): string {
  if (typeof database.databaseId !== "string" || database.databaseId.trim().length === 0) {
    throw new Error("service env target databaseId must be a non-empty string");
  }
  return database.databaseId.trim();
}

function serviceEnvTargetConnectionUrl(database: IcpdbServiceEnvTarget): string {
  const connectionUrl = database.connectionUrl();
  if (typeof connectionUrl !== "string" || connectionUrl.trim().length === 0) {
    throw new Error("service env target connectionUrl must be a non-empty string");
  }
  return connectionUrl.trim();
}

export async function archiveIcpdbServiceDatabaseToFileFromEnvFile(
  filePath: string,
  options?: IcpdbServiceEnvFileOptions
): Promise<IcpdbServiceArchiveFileResult> {
  const archivePath = requiredFilePath(filePath, "archive file");
  assertServiceOptionsObject(options, "archive env-file options");
  return archiveIcpdbServiceDatabaseToFile(
    await connectIcpdbServiceDatabaseFromEnvFile(options?.envPath ?? DEFAULT_SERVICE_ENV_FILE),
    archivePath
  );
}

export async function archiveDatabaseToFileFromEnvFile(
  filePath: string,
  options?: IcpdbServiceEnvFileOptions
): Promise<IcpdbServiceArchiveFileResult> {
  return archiveIcpdbServiceDatabaseToFileFromEnvFile(filePath, options);
}

export async function archiveIcpdbServiceDatabaseToFileFromEnv(
  filePath: string,
  options?: IcpdbServiceEnvSourceOptions
): Promise<IcpdbServiceArchiveFileResult> {
  const archivePath = requiredFilePath(filePath, "archive file");
  assertServiceOptionsObject(options, "archive env options");
  return archiveIcpdbServiceDatabaseToFile(
    await connectIcpdbServiceDatabaseFromEnv(options?.env ?? process.env),
    archivePath
  );
}

export async function archiveDatabaseToFileFromEnv(
  filePath: string,
  options?: IcpdbServiceEnvSourceOptions
): Promise<IcpdbServiceArchiveFileResult> {
  return archiveIcpdbServiceDatabaseToFileFromEnv(filePath, options);
}

export async function restoreIcpdbServiceDatabaseFromFileFromEnvFile(
  filePath: string,
  options?: IcpdbServiceRestoreFileFromEnvOptions
): Promise<IcpdbServiceSnapshotFileInfo> {
  const snapshotPath = requiredFilePath(filePath, "snapshot file");
  assertServiceOptionsObject(options, "restore env-file options");
  const expectedSha256 = expectedServiceSnapshotSha256(options);
  const restoreOptions = expectedSha256 === undefined ? undefined : { expectedSha256 };
  return restoreIcpdbServiceDatabaseFromFile(
    await connectIcpdbServiceDatabaseFromEnvFile(options?.envPath ?? DEFAULT_SERVICE_ENV_FILE),
    snapshotPath,
    restoreOptions
  );
}

export async function restoreDatabaseFromFileFromEnvFile(
  filePath: string,
  options?: IcpdbServiceRestoreFileFromEnvOptions
): Promise<IcpdbServiceSnapshotFileInfo> {
  return restoreIcpdbServiceDatabaseFromFileFromEnvFile(filePath, options);
}

export async function restoreIcpdbServiceDatabaseFromFileFromEnv(
  filePath: string,
  options?: IcpdbServiceRestoreFileFromEnvSourceOptions
): Promise<IcpdbServiceSnapshotFileInfo> {
  const snapshotPath = requiredFilePath(filePath, "snapshot file");
  assertServiceOptionsObject(options, "restore env options");
  const expectedSha256 = expectedServiceSnapshotSha256(options);
  const restoreOptions = expectedSha256 === undefined ? undefined : { expectedSha256 };
  return restoreIcpdbServiceDatabaseFromFile(
    await connectIcpdbServiceDatabaseFromEnv(options?.env ?? process.env),
    snapshotPath,
    restoreOptions
  );
}

export async function restoreDatabaseFromFileFromEnv(
  filePath: string,
  options?: IcpdbServiceRestoreFileFromEnvSourceOptions
): Promise<IcpdbServiceSnapshotFileInfo> {
  return restoreIcpdbServiceDatabaseFromFileFromEnv(filePath, options);
}

async function readOptionalText(path: string | undefined): Promise<string> {
  return path ? (await readFile(requiredFilePath(path, "file"), "utf8")).trim() : "";
}

async function readOptionalSecretText(path: string | undefined, label: string): Promise<string> {
  if (!path) return "";
  const filePath = requiredFilePath(path, label);
  await checkOwnerOnlyFileMode(filePath, label);
  const text = await readOptionalText(filePath);
  if (text.length === 0) throw new Error(`${label} must be a non-empty string`);
  return text;
}

function requiredFilePath(path: string | undefined, label: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error(`${label} path must be a non-empty string`);
  }
  return path.trim();
}

function identityFromJson(json: string, identityType: IcpdbServiceIdentityType): Identity {
  if (identityType === "ed25519") return Ed25519KeyIdentity.fromJSON(json);
  if (identityType === "secp256k1") return Secp256k1KeyIdentity.fromJSON(json);
  try {
    return Secp256k1KeyIdentity.fromJSON(json);
  } catch (_secpError) {
    return Ed25519KeyIdentity.fromJSON(json);
  }
}

function modeToOctal(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function identityTypeFromEnv(value: string | undefined): IcpdbServiceIdentityType {
  return serviceIdentityType(value, "auto");
}

function serviceIdentityOptionsFromEnv(env: Record<string, string | undefined>): IcpdbServiceIdentityOptions {
  assertServiceEnvObject(env);
  return {
    identityPem: optionalNonEmptyEnvValue(env.ICPDB_IDENTITY_PEM, "ICPDB_IDENTITY_PEM"),
    identityPemFile: optionalNonEmptyEnvValue(env.ICPDB_IDENTITY_PEM_FILE, "ICPDB_IDENTITY_PEM_FILE"),
    identityJson: optionalNonEmptyEnvValue(env.ICPDB_IDENTITY_JSON, "ICPDB_IDENTITY_JSON"),
    identityJsonFile: optionalNonEmptyEnvValue(env.ICPDB_IDENTITY_JSON_FILE, "ICPDB_IDENTITY_JSON_FILE"),
    identityType: identityTypeFromEnv(optionalTrimmedEnvValue(env.ICPDB_IDENTITY_TYPE, "ICPDB_IDENTITY_TYPE")),
    identityPrincipal: optionalTrimmedEnvValue(env.ICPDB_IDENTITY_PRINCIPAL, "ICPDB_IDENTITY_PRINCIPAL")
  };
}

function assertServiceIdentityPrincipal(identity: Identity, expectedPrincipal: string | undefined): Identity {
  if (expectedPrincipal === undefined) return identity;
  if (typeof expectedPrincipal !== "string" || expectedPrincipal.trim().length === 0) {
    throw new Error("identityPrincipal must be a non-empty string");
  }
  const normalizedExpectedPrincipal = expectedPrincipal.trim();
  const actualPrincipal = identity.getPrincipal().toText();
  if (actualPrincipal !== normalizedExpectedPrincipal) {
    throw new Error(`service identity principal mismatch: expected ${normalizedExpectedPrincipal}, got ${actualPrincipal}`);
  }
  return identity;
}

function serviceIdentityType(value: string | undefined, defaultType: IcpdbServiceIdentityType): IcpdbServiceIdentityType {
  if (value === undefined) return defaultType;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1");
  }
  const normalizedType = value.trim();
  if (normalizedType === "auto" || normalizedType === "ed25519" || normalizedType === "secp256k1") return normalizedType;
  throw new Error("ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1");
}

function assertSingleServiceIdentitySecret(options: IcpdbServiceIdentityOptions): void {
  const sources = [
    ["identityJson", options.identityJson],
    ["identityJsonFile", options.identityJsonFile],
    ["identityPem", options.identityPem],
    ["identityPemFile", options.identityPemFile]
  ].filter(([_name, value]) => value !== undefined && value !== "");
  if (sources.length > 1) {
    throw new Error(`service identity must use exactly one secret source: ${sources.map(([name]) => name).join(", ")}`);
  }
}

function optionalInlineSecretText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function serviceConnectionOptionsFromEnv(env: Record<string, string | undefined>): Pick<IcpdbServiceClientOptions, "canisterId" | "databaseId" | "url" | "host" | "rootKey"> {
  assertServiceEnvObject(env);
  const parsed = validateServiceConnectionEnv(env);
  const canisterId = optionalTrimmedEnvValue(env.ICPDB_CANISTER_ID, "ICPDB_CANISTER_ID");
  const databaseId = optionalTrimmedEnvValue(env.ICPDB_DATABASE_ID, "ICPDB_DATABASE_ID");
  const url = optionalTrimmedEnvValue(env.ICPDB_URL, "ICPDB_URL");
  const host = optionalTrimmedEnvValue(env.ICPDB_NETWORK_URL, "ICPDB_NETWORK_URL");
  const rootKey = optionalTrimmedEnvValue(env.ICPDB_ROOT_KEY, "ICPDB_ROOT_KEY");
  if (!canisterId && !parsed?.canisterId) {
    throw new Error("ICPDB_CANISTER_ID or ICPDB_URL is required");
  }
  return {
    canisterId: canisterId ?? parsed?.canisterId,
    databaseId: databaseId ?? parsed?.databaseId,
    url,
    host,
    rootKey: rootKey ? hexToBytes(rootKey) : undefined
  };
}

function validateServiceConnectionEnv(env: Record<string, string | undefined>): ReturnType<typeof parseIcpdbDatabaseUrl> | null {
  const url = optionalTrimmedEnvValue(env.ICPDB_URL, "ICPDB_URL");
  const canisterId = optionalTrimmedEnvValue(env.ICPDB_CANISTER_ID, "ICPDB_CANISTER_ID");
  const databaseId = optionalTrimmedEnvValue(env.ICPDB_DATABASE_ID, "ICPDB_DATABASE_ID");
  const parsed = url ? parseIcpdbDatabaseUrl(url) : null;
  if (canisterId && parsed?.canisterId && canisterId !== parsed.canisterId) {
    throw new Error("ICPDB_CANISTER_ID does not match ICPDB_URL");
  }
  if (databaseId && parsed?.databaseId && databaseId !== parsed.databaseId) {
    throw new Error("ICPDB_DATABASE_ID does not match ICPDB_URL");
  }
  return parsed;
}

function serviceConnectionHasDatabase(env: Record<string, string | undefined>): boolean {
  const parsed = validateServiceConnectionEnv(env);
  return Boolean(optionalTrimmedEnvValue(env.ICPDB_DATABASE_ID, "ICPDB_DATABASE_ID") || parsed?.databaseId);
}

function assertServiceConnectionHasDatabase(env: Record<string, string | undefined>, helperName: string): void {
  if (serviceConnectionHasDatabase(env)) return;
  throw new Error(`${helperName} requires a database-bearing ICPDB_URL or ICPDB_DATABASE_ID; use createClientFromEnvFile() to auto-create once and persist ICPDB_DATABASE_ID`);
}

function optionalNonEmptyEnvValue(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredNonEmptyEnvValue(value, name);
}

function requiredEnvKey(key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`${key} must be a valid env key`);
  }
  return key;
}

function assertServiceEnvObject(env: Record<string, string | undefined>): void {
  if (typeof env !== "object" || env === null || Array.isArray(env)) {
    throw new Error("service env must be an object");
  }
}

function normalizeServiceEnv(env: Record<string, string | undefined>): Record<string, string> {
  assertServiceEnvObject(env);
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    normalized[requiredEnvKey(key)] = requiredNonEmptyEnvValue(value, key);
  }
  return normalized;
}

function optionalTrimmedEnvValue(value: string | undefined, name: string): string | undefined {
  return optionalNonEmptyEnvValue(value, name)?.trim();
}

function requiredNonEmptyEnvValue(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function generatedServiceIdentityTargetEnv(target: IcpdbGeneratedServiceIdentityTargetOptions): Record<string, string> {
  assertGeneratedServiceIdentityTarget(target);
  const canisterId = optionalGeneratedTargetEnvValue(target.canisterId, "ICPDB_CANISTER_ID");
  const databaseId = optionalGeneratedTargetEnvValue(target.databaseId, "ICPDB_DATABASE_ID");
  const networkUrl = optionalGeneratedTargetEnvValue(target.networkUrl, "ICPDB_NETWORK_URL");
  const rootKey = optionalGeneratedTargetRootKey(target.rootKey);
  if (databaseId && !canisterId) {
    throw new Error("ICPDB_CANISTER_ID is required when ICPDB_DATABASE_ID is set");
  }
  const databaseUrl = databaseId && canisterId ? formatIcpdbDatabaseUrl(canisterId, databaseId) : undefined;
  return {
    ...(canisterId ? { ICPDB_CANISTER_ID: canisterId } : {}),
    ...(databaseId && databaseUrl ? { ICPDB_DATABASE_ID: databaseId, ICPDB_URL: databaseUrl } : {}),
    ...(networkUrl ? { ICPDB_NETWORK_URL: networkUrl } : {}),
    ...(rootKey ? { ICPDB_ROOT_KEY: rootKey } : {})
  };
}

function assertGeneratedServiceIdentityTarget(target: IcpdbGeneratedServiceIdentityTargetOptions): void {
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    throw new Error("service identity target must be an object");
  }
}

function optionalGeneratedTargetEnvValue(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredNonEmptyEnvValue(value, name).trim();
}

function optionalGeneratedTargetRootKey(value: string | undefined): string | undefined {
  const rootKey = optionalGeneratedTargetEnvValue(value, "ICPDB_ROOT_KEY");
  if (rootKey === undefined) return undefined;
  hexToBytes(rootKey);
  return rootKey;
}

function assertDatabaseRole(role: DatabaseRole): void {
  if (role !== "reader" && role !== "writer" && role !== "owner") {
    throw new Error("database role must be reader, writer, or owner");
  }
}

async function persistServiceDatabaseIdOrDelete(path: string, db: IcpdbDatabaseClient): Promise<void> {
  try {
    await persistIcpdbServiceDatabaseId(path, db.databaseId);
  } catch (error) {
    try {
      await db.delete();
    } catch {
      // Preserve the persistence failure; delete is best-effort cleanup.
    }
    throw error;
  }
}

async function persistedServiceDatabaseFromEnvFile(path: string): Promise<IcpdbDatabaseClient> {
  const env = await loadIcpdbServiceEnvFile(path);
  if (serviceConnectionHasDatabase(env)) {
    assertServiceSqlClientSetupOptions(await loadIcpdbServiceSetupFromEnv(env), serviceConnectionOptionsFromEnv(env).databaseId);
    return connectIcpdbServiceDatabaseFromEnv(env);
  }
  const db = await createIcpdbServiceDatabaseFromEnv(env);
  await persistServiceDatabaseIdOrDelete(path, db);
  return db;
}

function serviceEnvWithoutSetup(env: Record<string, string>): Record<string, string> {
  const nextEnv = { ...env };
  for (const key of SERVICE_SETUP_ENV_KEYS) delete nextEnv[key];
  return nextEnv;
}

async function setupSqlFromEnv(env: Record<string, string | undefined>): Promise<string | undefined> {
  return setupTextFromEnv(env.ICPDB_SETUP_SQL, env.ICPDB_SETUP_SQL_FILE, "ICPDB_SETUP_SQL", "ICPDB_SETUP_SQL_FILE");
}

async function setupStatementsFromEnv(env: Record<string, string | undefined>): Promise<IcpdbSqlClientBatchStatement[] | undefined> {
  const value = await setupTextFromEnv(env.ICPDB_SETUP_STATEMENTS, env.ICPDB_SETUP_STATEMENTS_FILE, "ICPDB_SETUP_STATEMENTS", "ICPDB_SETUP_STATEMENTS_FILE");
  return setupStatementsFromText(value, "ICPDB_SETUP_STATEMENTS");
}

async function setupMigrationsFromEnv(env: Record<string, string | undefined>): Promise<IcpdbMigration[] | undefined> {
  const value = await setupTextFromEnv(env.ICPDB_SETUP_MIGRATIONS, env.ICPDB_SETUP_MIGRATIONS_FILE, "ICPDB_SETUP_MIGRATIONS", "ICPDB_SETUP_MIGRATIONS_FILE");
  return setupMigrationsFromText(value, "ICPDB_SETUP_MIGRATIONS");
}

async function setupTextFromEnv(
  value: string | undefined,
  filePath: string | undefined,
  valueName: string,
  fileName: string
): Promise<string | undefined> {
  const setupValue = optionalNonEmptySetupEnvValue(value, valueName);
  const setupFilePath = optionalNonEmptySetupEnvValue(filePath, fileName);
  if (setupValue !== undefined && setupFilePath !== undefined) {
    throw new Error(`${valueName} and ${fileName} cannot both be set`);
  }
  if (setupValue !== undefined) return setupValue;
  if (setupFilePath === undefined) return undefined;
  return readFile(setupFilePath, "utf8");
}

function optionalNonEmptySetupEnvValue(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function setupStatementsFromText(value: string | undefined, label: string): IcpdbSqlClientBatchStatement[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
  if (parsed.length === 0) throw new Error(`${label} must be a non-empty JSON array`);
  return parsed.map((statement, index) => setupStatementFromJson(statement, `${label}[${index}]`));
}

function setupStatementFromJson(value: unknown, label: string): IcpdbSqlClientBatchStatement {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > 2) throw new Error(`${label} tuple must be [sql, args?]`);
    if (typeof value[0] !== "string") throw new Error(`${label}[0] must be SQL text`);
    const tuple: [string, IcpdbSqlArgsInput?] = value.length === 1
      ? [value[0]]
      : [value[0], setupArgsFromJson(value[1], `${label}[1]`)];
    return tuple;
  }
  if (typeof value !== "object" || value === null) throw new Error(`${label} must be a string, tuple, or object`);
  const sql = Reflect.get(value, "sql");
  const args = Reflect.get(value, "args");
  const params = Reflect.get(value, "params");
  if (typeof sql !== "string") throw new Error(`${label}.sql must be a string`);
  if (args !== undefined && params !== undefined) throw new Error(`${label} must use either args or params, not both`);
  if (args !== undefined) return { sql, args: setupArgsFromJson(args, `${label}.args`) };
  if (params !== undefined) return { sql, params: setupArgsFromJson(params, `${label}.params`) };
  return { sql };
}

function setupArgsFromJson(value: unknown, label: string): IcpdbSqlArgsInput {
  if (Array.isArray(value)) return value.map((item, index) => setupValueFromJson(item, `${label}[${index}]`));
  if (typeof value !== "object" || value === null) throw new Error(`${label} must be a JSON array or object`);
  const args: Record<string, IcpdbSqlValueInput> = {};
  for (const key of Object.keys(value)) {
    args[key] = setupValueFromJson(Reflect.get(value, key), `${label}.${key}`);
  }
  return args;
}

function setupValueFromJson(value: unknown, label: string): IcpdbSqlValueInput {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) {
        throw new Error(`${label}[${index}] must be an integer byte`);
      }
      return item;
    });
  }
  if (typeof value === "object" && value !== null) {
    const kind = Reflect.get(value, "kind");
    if (kind !== undefined) return setupStructuredValueFromJson(value, label);
  }
  throw new Error(`${label} must be null, string, number, boolean, byte array, or SqlValue object`);
}

function setupStructuredValueFromJson(value: object, label: string): IcpdbSqlValueInput {
  const kind = Reflect.get(value, "kind");
  if (kind === "null") return { kind: "null" };
  if (kind === "integer") {
    const integerValue = Reflect.get(value, "value");
    if (typeof integerValue !== "string") throw new Error(`${label}.value must be a base-10 integer string`);
    try {
      BigInt(integerValue);
    } catch {
      throw new Error(`${label}.value must be a base-10 integer string`);
    }
    return { kind: "integer", value: integerValue };
  }
  if (kind === "real") {
    const realValue = Reflect.get(value, "value");
    if (typeof realValue !== "number" || !Number.isFinite(realValue)) throw new Error(`${label}.value must be a finite number`);
    return { kind: "real", value: realValue };
  }
  if (kind === "text") {
    const textValue = Reflect.get(value, "value");
    if (typeof textValue !== "string") throw new Error(`${label}.value must be a string`);
    return { kind: "text", value: textValue };
  }
  if (kind === "blob") {
    const blobValue = Reflect.get(value, "value");
    if (!Array.isArray(blobValue)) throw new Error(`${label}.value must be a byte array`);
    return {
      kind: "blob",
      value: blobValue.map((item, index) => {
        if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) {
          throw new Error(`${label}.value[${index}] must be an integer byte`);
        }
        return item;
      })
    };
  }
  throw new Error(`${label}.kind must be null, integer, real, text, or blob`);
}

function archiveBeginInfo(value: unknown, databaseId: string): { databaseId: string; sizeBytes: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("archive begin result must be an object");
  const resultDatabaseId = Reflect.get(value, "databaseId");
  if (typeof resultDatabaseId !== "string" || resultDatabaseId.trim().length === 0) {
    throw new Error("archive begin result databaseId must be a non-empty string");
  }
  const normalizedResultDatabaseId = resultDatabaseId.trim();
  if (normalizedResultDatabaseId !== databaseId) throw new Error("archive begin result databaseId does not match archive database source databaseId");
  const sizeBytes = Reflect.get(value, "sizeBytes");
  if (typeof sizeBytes !== "string") throw new Error("archive size_bytes must be a string");
  return {
    databaseId: normalizedResultDatabaseId,
    sizeBytes
  };
}

function archiveSizeBytes(value: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("archive size_bytes must be a non-negative integer");
  const sizeBytes = BigInt(normalized);
  if (sizeBytes > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("archive size_bytes exceeds JavaScript safe integer range");
  }
  return Number(sizeBytes);
}

function archiveChunkBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk);
  if (!Array.isArray(chunk)) throw new Error("archive chunk must be a byte array");
  const bytes = new Uint8Array(chunk.length);
  for (let index = 0; index < chunk.length; index += 1) {
    const byte = chunk[index];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`archive chunk byte ${index} must be an integer from 0 to 255`);
    }
    bytes[index] = byte;
  }
  return bytes;
}

function assertExpectedServiceSnapshotHash(
  snapshot: IcpdbServiceSnapshotFileInfo,
  expectedSha256?: string
): void {
  if (!expectedSha256) return;
  if (snapshot.sha256 !== expectedSha256) throw new Error(`snapshot hash mismatch: expected ${expectedSha256}, got ${snapshot.sha256}`);
}

function expectedServiceSnapshotSha256(options?: IcpdbServiceRestoreFileOptions): string | undefined {
  if (!options || options.expectedSha256 === undefined) return undefined;
  if (typeof options.expectedSha256 !== "string") throw new Error("expectedSha256 must be a 64-character hex SHA-256 hash");
  const expected = options.expectedSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error("expectedSha256 must be a 64-character hex SHA-256 hash");
  return expected;
}

function bytesToHex(bytes: readonly number[]): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function setupMigrationsFromText(value: string | undefined, label: string): IcpdbMigration[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
  if (parsed.length === 0) throw new Error(`${label} must be a non-empty JSON array`);
  const migrations: IcpdbMigration[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const migration = parsed[index];
    if (typeof migration !== "object" || migration === null || Array.isArray(migration)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    const version = Reflect.get(migration, "version");
    const name = Reflect.get(migration, "name");
    const sql = Reflect.get(migration, "sql");
    if (typeof version !== "string" && typeof version !== "number") {
      throw new Error(`${label}[${index}].version must be a string or number`);
    }
    if (name !== undefined && typeof name !== "string") {
      throw new Error(`${label}[${index}].name must be a string`);
    }
    if (typeof sql !== "string") {
      throw new Error(`${label}[${index}].sql must be a string`);
    }
    migrations.push(name === undefined ? { version, sql } : { version, name, sql });
  }
  return migrations;
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.trim();
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("ICPDB_ROOT_KEY must be hex bytes");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function parseServiceEnvFile(source: string, path: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`invalid env file line ${index + 1} in ${path}`);
    const key = match[1];
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate env key ${key} at ${path}:${index + 1}`);
    parsed[key] = parseServiceEnvValue(match[2].trim(), path, index + 1);
  }
  return parsed;
}

function parseServiceEnvValue(source: string, path: string, lineNumber: number): string {
  if (source.startsWith("\"")) {
    try {
      const value = JSON.parse(source);
      if (typeof value !== "string") throw new Error("quoted env value must be a string");
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid JSON string";
      throw new Error(`invalid quoted env value at ${path}:${lineNumber}: ${message}`);
    }
  }
  if (source.startsWith("'")) {
    if (!source.endsWith("'")) throw new Error(`invalid quoted env value at ${path}:${lineNumber}`);
    return source.slice(1, -1);
  }
  return source;
}
