// Where: icpdb-console/scripts/check-sdk-client.mjs
// What: Runtime checks for the package-built createClient SQL facade.
// Why: The Turso-like SDK path should be verified without requiring a live IC network.
import assert from "node:assert/strict";
import { Actor } from "@icp-sdk/core/agent";
import { ICPDB_LIBSQL_ERROR_CODES, LibsqlBatchError, LibsqlError, classifyLibsqlErrorMessage, connectClient, connectDatabase, connectIcpdbDatabase, createClient, createClientFromDatabase, createDatabase, createIcpdbClient, createIcpdbDatabase, createLibsqlClient, createTursoLikeClient, formatIcpdbCanisterUrl, formatIcpdbDatabaseUrl, isIcpdbLibsqlErrorCode, isLibsqlBatchError, isLibsqlError, parseIcpdbDatabaseUrl, snapshotInfo, sql } from "../dist-sdk/icpdb-sdk.js";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  createIcpdbServiceClient,
  createIcpdbServiceClientFromEnv,
  createIcpdbServiceClientFromEnvFile,
  createIcpdbServiceDatabase,
  createIcpdbServiceDatabaseFromEnv,
  createIcpdbServiceSqlClient,
  createIcpdbServiceSqlClientFromEnv,
  createIcpdbServiceSqlClientFromEnvFile,
  formatIcpdbServiceEnv,
  generateIcpdbServiceIdentity,
  grantIcpdbServiceIdentity,
  createIcpdbPersistedServiceSqlClientFromEnvFile,
  inspectIcpdbServiceEnv,
  inspectIcpdbServiceEnvFile,
  loadIcpdbServiceEnvFile,
  loadIcpdbServiceIdentity,
  loadIcpdbServicePrincipal,
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
  writeIcpdbServiceEnvFile
} from "../dist-sdk/icpdb-service-identity.js";

assert.equal(connectDatabase, connectIcpdbDatabase);
assert.equal(createDatabase, createIcpdbDatabase);
assert.equal(typeof connectDatabaseFromEnv, "function");
assert.equal(typeof connectDatabaseFromEnvFile, "function");
assert.equal(typeof connectClientFromEnv, "function");
assert.equal(typeof connectClientFromEnvFile, "function");
assert.equal(typeof createClientFromEnv, "function");
assert.equal(typeof createClientFromEnvFile, "function");
assert.equal(typeof createDatabaseFromEnv, "function");
assert.equal(typeof createDatabaseFromEnvFile, "function");
assert.equal(typeof provisionIcpdbServiceDatabaseEnvFile, "function");
assert.equal(typeof archiveDatabaseToFile, "function");
assert.equal(typeof archiveDatabaseToFileFromEnv, "function");
assert.equal(typeof archiveDatabaseToFileFromEnvFile, "function");
assert.equal(typeof createIcpdbServiceDatabase, "function");
assert.equal(typeof archiveIcpdbServiceDatabaseToFileFromEnv, "function");
assert.equal(typeof archiveIcpdbServiceDatabaseToFileFromEnvFile, "function");
assert.equal(typeof restoreDatabaseFromFile, "function");
assert.equal(typeof restoreDatabaseFromFileFromEnv, "function");
assert.equal(typeof restoreDatabaseFromFileFromEnvFile, "function");
assert.equal(typeof snapshotInfoFile, "function");
assert.equal(typeof restoreIcpdbServiceDatabaseFromFileFromEnv, "function");
assert.equal(typeof restoreIcpdbServiceDatabaseFromFileFromEnvFile, "function");

assert.deepEqual(parseIcpdbDatabaseUrl("icpdb://aaaaa-aa/db_alpha"), {
  canisterId: "aaaaa-aa",
  databaseId: "db_alpha"
});
const libsqlError = new LibsqlError("UNIQUE constraint failed: notes.id", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT");
assert.equal(libsqlError.name, "LibsqlError");
assert.equal(libsqlError.code, "SQLITE_CONSTRAINT");
assert.equal(libsqlError.extendedCode, "SQLITE_CONSTRAINT");
assert.equal(ICPDB_LIBSQL_ERROR_CODES.includes("ICPDB_AUTH"), true);
assert.equal(isIcpdbLibsqlErrorCode("ICPDB_AUTH"), true);
assert.equal(isIcpdbLibsqlErrorCode("NOT_ICPDB"), false);
assert.equal(isLibsqlError(libsqlError), true);
assert.equal(isLibsqlError({ name: "LibsqlError", message: "permission denied", code: "ICPDB_AUTH" }), true);
assert.equal(isLibsqlError(new Error("plain")), false);
const libsqlBatchError = new LibsqlBatchError("read batch mode only accepts read SQL", 2, "SQLITE_READONLY");
assert.equal(libsqlBatchError.name, "LibsqlBatchError");
assert.equal(libsqlBatchError.code, "SQLITE_READONLY");
assert.equal(libsqlBatchError.statementIndex, 2);
assert.equal(isLibsqlBatchError(libsqlBatchError), true);
assert.equal(isLibsqlBatchError({ name: "LibsqlBatchError", message: "read batch mode only accepts read SQL", code: "SQLITE_READONLY", statementIndex: 2 }), true);
assert.equal(isLibsqlBatchError(libsqlError), false);
assert.deepEqual(classifyLibsqlErrorMessage("UNIQUE constraint failed: notes.id"), {
  code: "SQLITE_CONSTRAINT",
  extendedCode: "SQLITE_CONSTRAINT"
});
assert.deepEqual(classifyLibsqlErrorMessage("query only accepts read SQL"), {
  code: "SQLITE_READONLY",
  extendedCode: "SQLITE_READONLY"
});
assert.deepEqual(classifyLibsqlErrorMessage("read batch mode only accepts read SQL"), {
  code: "SQLITE_READONLY",
  extendedCode: "SQLITE_READONLY"
});
assert.deepEqual(classifyLibsqlErrorMessage("unsupported libSQL option: authToken"), {
  code: "SQLITE_MISUSE",
  extendedCode: "SQLITE_MISUSE"
});
assert.deepEqual(classifyLibsqlErrorMessage("idempotencyKey is only valid for write SQL"), {
  code: "SQLITE_MISUSE",
  extendedCode: "SQLITE_MISUSE"
});
assert.deepEqual(classifyLibsqlErrorMessage("use either args or params, not both"), {
  code: "SQLITE_MISUSE",
  extendedCode: "SQLITE_MISUSE"
});
assert.deepEqual(classifyLibsqlErrorMessage("SQL args must be an array or named object"), {
  code: "SQLITE_MISUSE",
  extendedCode: "SQLITE_MISUSE"
});
assert.deepEqual(classifyLibsqlErrorMessage("maxRows must be an integer from 1 to 500"), {
  code: "SQLITE_MISUSE",
  extendedCode: "SQLITE_MISUSE"
});
assert.deepEqual(classifyLibsqlErrorMessage("missing client options"), {
  code: "SQLITE_MISUSE",
  extendedCode: "SQLITE_MISUSE"
});
assert.deepEqual(classifyLibsqlErrorMessage("missing canisterId; pass canisterId, url, or connectionUrl"), {
  code: "SQLITE_MISUSE",
  extendedCode: "SQLITE_MISUSE"
});
assert.deepEqual(classifyLibsqlErrorMessage("principal lacks required database role"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("missing identity; pass an IC identity"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("anonymous identity cannot be used; call authClient.login(...) and pass authClient.getIdentity()"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("anonymous client metadata principal is not allowed"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("anonymous caller not allowed"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("principal has no access to database: notes"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("database is not visible to caller: notes"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("database token not found: token_1"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("api token scope does not allow this operation"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("owner cannot revoke own access"), {
  code: "ICPDB_AUTH"
});
assert.deepEqual(classifyLibsqlErrorMessage("database must keep at least one owner principal: notes"), {
  code: "ICPDB_AUTH"
});
assert.equal(formatIcpdbDatabaseUrl("aaaaa-aa", "db_alpha"), "icpdb://aaaaa-aa/db_alpha");
assert.equal(formatIcpdbDatabaseUrl(" aaaaa-aa ", "db_alpha"), "icpdb://aaaaa-aa/db_alpha");
assert.equal(formatIcpdbDatabaseUrl("aaaaa-aa", " db_alpha "), "icpdb://aaaaa-aa/db_alpha");
assert.equal(formatIcpdbDatabaseUrl("aaaaa-aa", "db/alpha"), "icpdb://aaaaa-aa/db%2Falpha");
assert.equal(formatIcpdbCanisterUrl("aaaaa-aa"), "icpdb://aaaaa-aa");
assert.equal(formatIcpdbCanisterUrl(" aaaaa-aa "), "icpdb://aaaaa-aa");
assert.throws(() => formatIcpdbDatabaseUrl("aaaaa-aa", ""), /databaseId must be a non-empty string/);
assert.throws(() => formatIcpdbDatabaseUrl("", "db_alpha"), /canisterId must be a non-empty string/);
assert.throws(() => formatIcpdbCanisterUrl(""), /canisterId must be a non-empty string/);
assert.deepEqual(parseIcpdbDatabaseUrl(formatIcpdbDatabaseUrl("aaaaa-aa", "db/alpha")), {
  canisterId: "aaaaa-aa",
  databaseId: "db/alpha"
});
assert.deepEqual(parseIcpdbDatabaseUrl(formatIcpdbCanisterUrl("aaaaa-aa")), {
  canisterId: "aaaaa-aa",
  databaseId: undefined
});
assert.deepEqual(parseIcpdbDatabaseUrl("icpdb://aaaaa-aa"), {
  canisterId: "aaaaa-aa",
  databaseId: undefined
});
assert.deepEqual(parseIcpdbDatabaseUrl("icpdb://aaaaa-aa/db%5Falpha"), {
  canisterId: "aaaaa-aa",
  databaseId: "db_alpha"
});
assert.deepEqual(parseIcpdbDatabaseUrl("icpdb://aaaaa-aa/%20db_alpha%20"), {
  canisterId: "aaaaa-aa",
  databaseId: "db_alpha"
});
assert.throws(() => createIcpdbClient(undefined), /missing client options/);
await assert.rejects(() => createIcpdbDatabase(undefined), /missing client options/);
assert.throws(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  identity: undefined
}), /missing identity; pass an IC identity/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  identity: undefined
}), /missing identity; pass an IC identity/);
assert.throws(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  identity: { getPrincipal: () => ({ toText: () => "2vxsx-fae" }) }
}), /anonymous identity cannot be used; call authClient\.login\(\.\.\.\) and pass authClient\.getIdentity\(\)/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  identity: { getPrincipal: () => ({ toText: () => "2vxsx-fae" }) }
}), /anonymous identity cannot be used; call authClient\.login\(\.\.\.\) and pass authClient\.getIdentity\(\)/);
await assert.rejects(() => createIcpdbDatabase({
  canisterId: "aaaaa-aa",
  identity: { getPrincipal: () => ({ toText: () => "2vxsx-fae" }) }
}), /anonymous identity cannot be used; call authClient\.login\(\.\.\.\) and pass authClient\.getIdentity\(\)/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  databaseId: "",
  identity: { getPrincipal: () => ({ toText: () => "aaaaa-aa" }) }
}), /databaseId must be a non-empty string/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  databaseId: "   ",
  identity: { getPrincipal: () => ({ toText: () => "aaaaa-aa" }) }
}), /databaseId must be a non-empty string/);
assert.throws(() => createClient({
  canisterId: "   ",
  identity: { getPrincipal: () => ({ toText: () => "aaaaa-aa" }) }
}), /canisterId must be a non-empty string/);
assert.throws(() => createClient({
  connectionUrl: "   ",
  identity: { getPrincipal: () => ({ toText: () => "aaaaa-aa" }) }
}), /connectionUrl must be a non-empty string/);
await assert.rejects(() => createIcpdbDatabase({
  canisterId: "aaaaa-aa",
  databaseId: "",
  identity: { getPrincipal: () => ({ toText: () => "aaaaa-aa" }) }
}), /databaseId must be a non-empty string/);
await assert.rejects(() => createIcpdbDatabase({
  canisterId: "aaaaa-aa",
  databaseId: "   ",
  identity: { getPrincipal: () => ({ toText: () => "aaaaa-aa" }) }
}), /databaseId must be a non-empty string/);
assert.deepEqual(await snapshotInfo(new Uint8Array([1, 2, 3])), {
  sizeBytes: 3,
  sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
  snapshotHash: [3, 144, 88, 198, 242, 192, 203, 73, 44, 83, 59, 10, 77, 20, 239, 119, 204, 15, 120, 171, 204, 206, 213, 40, 125, 132, 161, 162, 1, 28, 251, 129]
});
const snapshot456Info = {
  sizeBytes: 3,
  sha256: "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472",
  snapshotHash: [120, 124, 121, 142, 57, 165, 188, 25, 16, 53, 91, 174, 109, 12, 216, 122, 54, 178, 225, 15, 208, 32, 42, 131, 227, 187, 107, 0, 93, 168, 52, 114]
};
assert.deepEqual(await snapshotInfo([4, 5, 6]), snapshot456Info);
assert.throws(() => parseIcpdbDatabaseUrl("https://aaaaa-aa.icp0.io/db_alpha"), /ICPDB url must use icpdb:\/\//);
assert.throws(() => parseIcpdbDatabaseUrl("icpdb://aaaaa-aa:123/db_alpha"), /must not include a port/);
assert.throws(() => parseIcpdbDatabaseUrl("icpdb://aaaaa-aa/db_alpha/extra"), /path must be/);
assert.throws(() => parseIcpdbDatabaseUrl("icpdb://aaaaa-aa//db_alpha"), /path must be/);
assert.throws(() => parseIcpdbDatabaseUrl("icpdb://aaaaa-aa/db_alpha/"), /path must be/);
assert.throws(() => parseIcpdbDatabaseUrl("icpdb://aaaaa-aa/db%ZZ"), /database id encoding/);
assert.throws(() => parseIcpdbDatabaseUrl("icpdb://aaaaa-aa/%20%20"), /databaseId must be a non-empty string/);
const sdkIdentity = {
  getPrincipal: () => ({ toText: () => "aaaaa-aa" }),
  transformRequest: async (request) => request
};
assert.deepEqual(await createIcpdbClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: sdkIdentity
}).snapshotInfo([4, 5, 6]), snapshot456Info);
assert.deepEqual(await createIcpdbClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}).database("db_existing").snapshotInfo([4, 5, 6]), snapshot456Info);
assert.deepEqual(await createIcpdbClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}).database(" db_existing ").snapshotInfo([4, 5, 6]), snapshot456Info);
assert.throws(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}).database("   "), /databaseId must be a non-empty string/);
await assert.rejects(() => createIcpdbDatabase({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity
}), /createIcpdbDatabase creates a new database/);
await assert.rejects(() => connectIcpdbDatabase({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}), /databaseId is required/);
await assert.rejects(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}).connectDatabase(), /databaseId is required/);
const shardClient = createIcpdbClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: sdkIdentity
});
const directLifecycleDb = shardClient.database("db_existing");
assert.equal(typeof directLifecycleDb.close, "function");
directLifecycleDb.close();
{
  const lowLevelCreateSetupCalls = [];
  const originalLowLevelCreateActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      lowLevelCreateSetupCalls.push({ method: "create_database" });
      return { Ok: "db_low_level_setup" };
    },
    sql_batch: async (request) => {
      lowLevelCreateSetupCalls.push({
        method: "sql_batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return {
        Ok: request.statements.map(() => ({
          columns: [],
          rows: [],
          rows_affected: 1n,
          last_insert_rowid: 0n,
          truncated: false,
          routed_operation_id: []
        }))
      };
    },
    delete_database: async (databaseId) => {
      lowLevelCreateSetupCalls.push({ method: "delete_database", databaseId });
      return { Ok: null };
    }
  });
  try {
    await assert.rejects(() => createIcpdbClient({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity
    }).createDatabase({
      databaseId: "db_existing"
    }), /create setup databaseId is not supported/);
    assert.deepEqual(lowLevelCreateSetupCalls, []);
    const lowLevelCreatedDb = await createIcpdbClient({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity
    }).createDatabase({
      setupSql: "CREATE TABLE low_level_setup(id INTEGER PRIMARY KEY, body TEXT)",
      setupStatements: [
        { sql: "INSERT INTO low_level_setup(body) VALUES (:body)", args: { body: "from-low-level-create" } }
      ]
    });
    assert.equal(lowLevelCreatedDb.databaseId, "db_low_level_setup");
    assert.deepEqual(lowLevelCreateSetupCalls, [
      { method: "create_database" },
      {
        method: "sql_batch",
        databaseId: "db_low_level_setup",
        statements: ["CREATE TABLE low_level_setup(id INTEGER PRIMARY KEY, body TEXT)"]
      },
      {
        method: "sql_batch",
        databaseId: "db_low_level_setup",
        statements: ["INSERT INTO low_level_setup(body) VALUES (:body)"]
      }
    ]);
  } finally {
    Actor.createActor = originalLowLevelCreateActor;
  }
}
{
  const lowLevelSetupFailureCalls = [];
  const originalLowLevelFailureActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      lowLevelSetupFailureCalls.push({ method: "create_database" });
      return { Ok: "db_low_level_setup_fail" };
    },
    sql_batch: async () => {
      lowLevelSetupFailureCalls.push({ method: "sql_batch" });
      return { Err: "no such table: low_level_missing_setup_target" };
    },
    delete_database: async (databaseId) => {
      lowLevelSetupFailureCalls.push({ method: "delete_database", databaseId });
      return { Ok: null };
    }
  });
  try {
    await assert.rejects(() => createIcpdbClient({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity
    }).createDatabase({
      setupStatements: [
        "INSERT INTO low_level_missing_setup_target(body) VALUES ('fail-before-handoff')"
      ]
    }), /low_level_missing_setup_target/);
    assert.deepEqual(lowLevelSetupFailureCalls, [
      { method: "create_database" },
      { method: "sql_batch" },
      { method: "delete_database", databaseId: "db_low_level_setup_fail" }
    ]);
  } finally {
    Actor.createActor = originalLowLevelFailureActor;
  }
}
{
  const directCreateAliasCalls = [];
  const originalDirectCreateAliasActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      directCreateAliasCalls.push({ method: "create_database" });
      return { Ok: "db_direct_alias" };
    },
    sql_batch: async (request) => {
      directCreateAliasCalls.push({
        method: "sql_batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    },
    sql_execute: async (request) => {
      directCreateAliasCalls.push({ method: "sql_execute", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk([], [], 1n, 7n);
    },
    sql_query: async (request) => {
      directCreateAliasCalls.push({ method: "sql_query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["body"], [[{ Text: "from-create-database-alias" }]], 0n, 0n);
    },
    delete_database: async (databaseId) => {
      directCreateAliasCalls.push({ method: "delete_database", databaseId });
      return { Ok: null };
    }
  });
  try {
    const directDb = await createDatabase({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity,
      setupSql: "CREATE TABLE direct_alias_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"
    });
    await directDb.execute(sql`INSERT INTO direct_alias_notes(body) VALUES (${"from-create-database-alias"})`);
    const directRows = await directDb.queryRows("SELECT body FROM direct_alias_notes ORDER BY id DESC");
    assert.equal(directRows[0]?.body, "from-create-database-alias");
    assert.equal(directDb.connectionUrl(), "icpdb://aaaaa-aa/db_direct_alias");
    assert.equal(directDb.url(), "icpdb://aaaaa-aa/db_direct_alias");
    assert.deepEqual(directDb.info(), {
      canisterId: "aaaaa-aa",
      databaseId: "db_direct_alias",
      connectionUrl: "icpdb://aaaaa-aa/db_direct_alias",
      url: "icpdb://aaaaa-aa/db_direct_alias"
    });
    await directDb.delete();
    assert.deepEqual(directCreateAliasCalls, [
      { method: "create_database" },
      {
        method: "sql_batch",
        databaseId: "db_direct_alias",
        statements: ["CREATE TABLE direct_alias_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"]
      },
      { method: "sql_execute", databaseId: "db_direct_alias", sql: "INSERT INTO direct_alias_notes(body) VALUES (?1)" },
      { method: "sql_query", databaseId: "db_direct_alias", sql: "SELECT body FROM direct_alias_notes ORDER BY id DESC" },
      { method: "delete_database", databaseId: "db_direct_alias" }
    ]);
  } finally {
    Actor.createActor = originalDirectCreateAliasActor;
  }
}
{
  const normalizedShardCalls = [];
  const shardInfo = {
    shard_id: "shard_1",
    canister_id: "rrkah-fqaaa-aaaaa-aaaaq-cai",
    status: "active",
    max_databases: 64,
    assigned_databases: 1n,
    created_at_ms: 1n,
    updated_at_ms: 2n
  };
  const originalShardCreateActor = Actor.createActor;
  Actor.createActor = () => ({
    create_remote_database: async (request) => {
      normalizedShardCalls.push({ method: "createRemoteDatabase", databaseCanisterId: request.database_canister_id });
      return { Ok: { database_id: request.database_id, status: { Hot: null }, logical_size_bytes: 0n, schema_version: "1", mount_id: [0], snapshot_hash: [], archived_at_ms: [], deleted_at_ms: [] } };
    },
    register_database_shard: async (request) => {
      normalizedShardCalls.push({ method: "registerDatabaseShard", databaseCanisterId: request.database_canister_id });
      return { Ok: shardInfo };
    },
    get_database_shard_status: async (request) => {
      normalizedShardCalls.push({ method: "getShardStatus", databaseCanisterId: request.database_canister_id });
      return { Ok: { shard: shardInfo, canister_status: "running", cycles_balance: 1n, memory_size_bytes: 2n, idle_cycles_burned_per_day: 3n, module_hash: [] } };
    },
    top_up_database_shard: async (request) => {
      normalizedShardCalls.push({ method: "topUpShard", databaseCanisterId: request.database_canister_id, cycles: request.cycles });
      return { Ok: shardInfo };
    },
    migrate_database_to_shard: async (request) => {
      normalizedShardCalls.push({ method: "migrateDatabaseToShard", databaseCanisterId: request.database_canister_id });
      return { Ok: { database_id: request.database_id, shard_id: "shard_1", canister_id: [request.database_canister_id], mount_id: [], status: { Hot: null }, schema_version: "1", created_at_ms: 1n, updated_at_ms: 2n } };
    },
    grant_database_access: async (_databaseId, principal, role) => {
      normalizedShardCalls.push({ method: "grantMember", principal, role });
      return { Ok: null };
    },
    revoke_database_access: async (_databaseId, principal) => {
      normalizedShardCalls.push({ method: "revokeMember", principal });
      return { Ok: null };
    }
  });
  try {
    const normalizingShardClient = createIcpdbClient({
      canisterId: "aaaaa-aa",
      databaseId: "db_existing",
      identity: sdkIdentity
    });
    await normalizingShardClient.createRemoteDatabase({ databaseId: "db_remote", databaseCanisterId: " rrkah-fqaaa-aaaaa-aaaaq-cai " });
    await normalizingShardClient.registerDatabaseShard({ databaseCanisterId: " rrkah-fqaaa-aaaaa-aaaaq-cai ", maxDatabases: 64 });
    await normalizingShardClient.getShardStatus(" rrkah-fqaaa-aaaaa-aaaaq-cai ");
    await normalizingShardClient.topUpShard(" rrkah-fqaaa-aaaaa-aaaaq-cai ", 1000);
    await normalizingShardClient.migrateDatabaseToShard("db_existing", " rrkah-fqaaa-aaaaa-aaaaq-cai ");
    await normalizingShardClient.grantMember(" rrkah-fqaaa-aaaaa-aaaaq-cai ", "writer");
    await normalizingShardClient.revokeMember(" rrkah-fqaaa-aaaaa-aaaaq-cai ");
    assert.deepEqual(normalizedShardCalls.map((call) => ("cycles" in call ? { ...call, cycles: call.cycles.toString() } : call)), [
      { method: "createRemoteDatabase", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" },
      { method: "registerDatabaseShard", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" },
      { method: "getShardStatus", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" },
      { method: "topUpShard", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai", cycles: "1000" },
      { method: "migrateDatabaseToShard", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" },
      { method: "grantMember", principal: "rrkah-fqaaa-aaaaa-aaaaq-cai", role: { Writer: null } },
      { method: "revokeMember", principal: "rrkah-fqaaa-aaaaa-aaaaq-cai" }
    ]);
  } finally {
    Actor.createActor = originalShardCreateActor;
  }
}
await assert.rejects(() => shardClient.createRemoteDatabase({
  databaseId: "db_remote",
  databaseCanisterId: "   "
}), /databaseCanisterId must be a non-empty string/);
await assert.rejects(() => shardClient.registerDatabaseShard({
  databaseCanisterId: "   ",
  maxDatabases: 64
}), /databaseCanisterId must be a non-empty string/);
await assert.rejects(() => shardClient.registerDatabaseShard({
  databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
  maxDatabases: 65536
}), /maxDatabases must be an integer from 0 to 65535/);
await assert.rejects(() => shardClient.getShardStatus("   "), /databaseCanisterId must be a non-empty string/);
await assert.rejects(() => shardClient.topUpShard("   ", 1000), /databaseCanisterId must be a non-empty string/);
await assert.rejects(() => shardClient.createDatabaseShard({
  initialCycles: "   ",
  maxDatabases: 64
}), /initialCycles must be a non-negative integer/);
await assert.rejects(() => shardClient.createDatabaseShard({
  initialCycles: 0,
  maxDatabases: 65536
}), /maxDatabases must be an integer from 0 to 65535/);
await assert.rejects(() => shardClient.topUpShard("rrkah-fqaaa-aaaaa-aaaaq-cai", "   "), /cycles must be a non-negative integer/);
await assert.rejects(() => shardClient.topUpDatabaseBalance("   "), /units must be a non-negative integer/);
await assert.rejects(() => shardClient.topUpDatabaseBalance("db_existing", "   "), /units must be a non-negative integer/);
await assert.rejects(() => shardClient.maintainShards({
  minAvailableSlots: "   ",
  minCyclesBalance: 0,
  topUpCycles: 0,
  maxNewShards: 0,
  newShardMaxDatabases: 0,
  newShardInitialCycles: 0
}), /minAvailableSlots must be a non-negative integer/);
await assert.rejects(() => shardClient.maintainShards({
  minAvailableSlots: 0,
  minCyclesBalance: 0,
  topUpCycles: 0,
  maxNewShards: 65536,
  newShardMaxDatabases: 0,
  newShardInitialCycles: 0
}), /maxNewShards must be an integer from 0 to 65535/);
await assert.rejects(() => shardClient.maintainShards({
  minAvailableSlots: 0,
  minCyclesBalance: 0,
  topUpCycles: 0,
  maxNewShards: 0,
  newShardMaxDatabases: 65536,
  newShardInitialCycles: 0
}), /newShardMaxDatabases must be an integer from 0 to 65535/);
await assert.rejects(() => shardClient.readArchiveChunk("   "), /archive offset must be a non-negative integer/);
await assert.rejects(() => shardClient.readArchiveChunk("0", 0), /archive maxBytes must be an integer from 1 to 4294967295/);
await assert.rejects(() => shardClient.finalizeArchive([1, 2, 3]), /snapshotHash must be a 32-byte SHA-256 hash/);
await assert.rejects(() => shardClient.beginRestore(new Array(32).fill(0), "   "), /restore sizeBytes must be a non-negative integer/);
await assert.rejects(() => shardClient.beginRestore(new Array(32).fill(0), "18446744073709551616"), /restore sizeBytes exceeds nat64 range/);
await assert.rejects(() => shardClient.beginRestore([1, 2, 3], "0"), /snapshotHash must be a 32-byte SHA-256 hash/);
await assert.rejects(() => shardClient.writeRestoreChunk("   ", new Uint8Array()), /restore offset must be a non-negative integer/);
assert.throws(
  () => shardClient.restore([999], { expectedSha256: "" }),
  /expectedSha256 must be a 64-character hex SHA-256 hash/
);
await assert.rejects(
  async () => shardClient.restore([999], { databaseId: "db_other" }),
  /database restore option databaseId is not supported; choose database at the client, low-level restore argument, or database handle/
);
await assert.rejects(
  () => shardClient.reconcileShardOperation({ operationId: "   ", status: "applied", error: null }),
  /operationId must be a non-empty string/
);
await assert.rejects(
  () => shardClient.reconcileShardOperation({ operationId: "op_1", status: "failed", error: null }),
  /error must be a non-empty string/
);
await assert.rejects(
  () => shardClient.reconcileShardOperation({ operationId: "op_1", status: "applied", error: "not needed" }),
  /error is only valid when shard reconcile status is failed/
);
await assert.rejects(
  () => shardClient.reconcileShardOperation({ operationId: "op_1", status: "pending", error: null }),
  /status must be applied or failed/
);
assert.throws(() => shardClient.migrateDatabaseToShard("db_existing", "   "), /databaseCanisterId must be a non-empty string/);
assert.throws(() => shardClient.migrateDatabaseToShard("   "), /databaseCanisterId must be a non-empty string/);
assert.throws(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}).listMembers(), /databaseId is required/);
await assert.rejects(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: sdkIdentity
}).grantMember("2vxsx-fae", "reader"), /anonymous principal cannot be granted database access/);
assert.throws(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: sdkIdentity
}).grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "admin"), /database role must be reader, writer, or owner/);
assert.throws(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}).database(""), /databaseId is required/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: sdkIdentity,
  setupSql: "CREATE TABLE setup(id INTEGER)"
}), /setupSql\/setupStatements\/setupMigrations require creating a database/);
assert.throws(() => createClient({
  url: "icpdb://aaaaa-aa/db_existing",
  connectionUrl: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity
}), /use either url or connectionUrl, not both/);
assert.throws(() => createIcpdbClient({
  url: "icpdb://aaaaa-aa/db_existing",
  connectionUrl: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity
}), /use either url or connectionUrl, not both/);
assert.throws(() => createClient({
  connectionUrl: "icpdb://bbbbb-bb/db_existing",
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}), /canisterId does not match ICPDB url/);
assert.throws(() => createClient({
  connectionUrl: "icpdb://aaaaa-aa/db_other",
  databaseId: "db_existing",
  identity: sdkIdentity
}), /databaseId does not match ICPDB url/);
assert.throws(() => createClient({
  connectionUrl: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  setupSql: "CREATE TABLE setup(id INTEGER)"
}), /setupSql\/setupStatements\/setupMigrations require creating a database/);
await assert.rejects(() => createIcpdbDatabase({
  connectionUrl: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  setupSql: "CREATE TABLE setup(id INTEGER)"
}), /createIcpdbDatabase creates a new database; omit databaseId and use a canister-only ICPDB url/);
await assert.rejects(() => createIcpdbDatabase({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity,
  setupSql: ""
}), /setupSql must be a non-empty string/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity,
  setupStatements: []
}), /setupStatements must be a non-empty array/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity,
  setupMigrations: []
}), /setupMigrations must be a non-empty array/);
assert.throws(() => createTursoLikeClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  setupStatements: []
}), /setupSql\/setupStatements\/setupMigrations require creating a database/);
assert.throws(() => createTursoLikeClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  authToken: "not-used"
}), /unsupported libSQL option: authToken/);
assert.throws(() => createLibsqlClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  authToken: "not-used"
}), /unsupported libSQL option: authToken/);
assert.throws(() => createIcpdbClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  authToken: "not-used"
}), /unsupported libSQL option: authToken/);
assert.throws(() => createClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  syncUrl: "libsql://example.turso.io"
}), /unsupported libSQL option: syncUrl/);
for (const unsupportedLibsqlOption of [
  "syncInterval",
  "tls",
  "fetch",
  "concurrency",
  "offline",
  "readYourWrites",
  "encryptionKey"
]) {
  assert.throws(() => createClient({
    url: "icpdb://aaaaa-aa/db_existing",
    identity: sdkIdentity,
    [unsupportedLibsqlOption]: true
  }), new RegExp(`unsupported libSQL option: ${unsupportedLibsqlOption}`));
}
assert.throws(() => createClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  intMode: "unsafe"
}), /intMode must be number, bigint, or string/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  host: "",
  identity: sdkIdentity
}), /host must be a non-empty string/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  host: "   ",
  identity: sdkIdentity
}), /host must be a non-empty string/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  rootKey: new Uint8Array(),
  identity: sdkIdentity
}), /rootKey must be non-empty bytes/);
assert.throws(() => connectClient({
  connectionUrl: "icpdb://aaaaa-aa",
  identity: sdkIdentity
}), /databaseId is required/);
assert.throws(() => connectClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity,
  setupSql: "CREATE TABLE should_not_create(id INTEGER)"
}), /databaseId is required/);
assert.throws(() => connectClient({
  connectionUrl: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity,
  setupSql: "CREATE TABLE should_not_connect_setup(id INTEGER)"
}), /setupSql\/setupStatements\/setupMigrations require creating a database/);
assert.equal(await createClient({
  canisterId: "aaaaa-aa",
  identity: sdkIdentity
}).principal(), "aaaaa-aa");
assert.equal(await connectClient({
  connectionUrl: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity
}).principal(), "aaaaa-aa");
assert.equal(await createTursoLikeClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity
}).principal(), "aaaaa-aa");
assert.equal(await createLibsqlClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity
}).principal(), "aaaaa-aa");
const paddedPrincipalIdentity = {
  getPrincipal: () => ({ toText: () => " aaaaa-aa " }),
  transformRequest: async (request) => request
};
assert.equal(createIcpdbClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: paddedPrincipalIdentity
}).principal(), "aaaaa-aa");
assert.equal(await createClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: paddedPrincipalIdentity
}).principal(), "aaaaa-aa");
const blankPrincipalIdentity = {
  getPrincipal: () => ({ toText: () => "   " }),
  transformRequest: async (request) => request
};
assert.throws(() => createIcpdbClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: blankPrincipalIdentity
}), /principal must be a non-empty string/);
assert.throws(() => createClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_existing",
  identity: blankPrincipalIdentity
}), /principal must be a non-empty string/);
{
  let blankPrincipalStatusActorCalls = 0;
  const originalBlankPrincipalStatusActor = Actor.createActor;
  Actor.createActor = () => {
    blankPrincipalStatusActorCalls += 1;
    return {
      list_databases: async () => ({ Ok: [] })
    };
  };
  try {
    assert.throws(() => createIcpdbClient({
      canisterId: "aaaaa-aa",
      databaseId: "db_existing",
      identity: blankPrincipalIdentity
    }), /principal must be a non-empty string/);
    assert.equal(blankPrincipalStatusActorCalls, 0);
  } finally {
    Actor.createActor = originalBlankPrincipalStatusActor;
  }
}
const lifecycleClient = createTursoLikeClient({
  url: "icpdb://aaaaa-aa/db_existing",
  identity: sdkIdentity
});
assert.equal(lifecycleClient.protocol, "icpdb");
assert.equal(lifecycleClient.closed, false);
lifecycleClient.close();
assert.equal(lifecycleClient.closed, true);
lifecycleClient.reconnect();
assert.equal(lifecycleClient.closed, false);
await assert.rejects(() => lifecycleClient.sync(), /sync is not supported/);
await assert.rejects(() => lifecycleClient.transaction(), /interactive transactions are not supported/);
await assert.rejects(() => lifecycleClient.transaction("write"), /interactive transactions are not supported/);

{
  const urlCreateDatabaseCalls = [];
  const urlSqlCalls = [];
  const originalUrlCreateActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      urlCreateDatabaseCalls.push("create_database");
      return { Ok: "db_url_auto" };
    },
    sql_execute: async (request) => {
      urlSqlCalls.push({ method: "execute", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk([], [], 1n, 0n);
    },
    sql_query: async (request) => {
      urlSqlCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["total"], [[{ Integer: 1n }]], 0n, 0n);
    },
    sql_batch: async (request) => {
      const idempotencyKey = request.idempotency_key[0];
      urlSqlCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey })
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    }
  });
  try {
    const urlCreateClient = createClient({
      url: formatIcpdbCanisterUrl("aaaaa-aa"),
      identity: sdkIdentity
    });
    await urlCreateClient.execute({ sql: "CREATE TABLE url_notes(id INTEGER)" });
    const urlRows = await urlCreateClient.queryRows("SELECT count(*) AS total FROM url_notes");
    assert.equal(urlRows[0]?.total, "1");
    assert.equal(await urlCreateClient.databaseId(), "db_url_auto");
    assert.equal(await urlCreateClient.connectionUrl(), formatIcpdbDatabaseUrl("aaaaa-aa", "db_url_auto"));
    assert.equal(await urlCreateClient.url(), formatIcpdbDatabaseUrl("aaaaa-aa", "db_url_auto"));
    urlCreateClient.close();
    await urlCreateClient.execute("INSERT INTO url_notes(id) VALUES (?1)", [1]);
    const urlReconnectClient = connectClient({
      url: await urlCreateClient.connectionUrl(),
      identity: sdkIdentity
    });
    assert.equal((await urlReconnectClient.get("SELECT count(*) AS total FROM url_notes"))?.total, "1");
    const connectionUrlReconnectClient = connectClient({
      connectionUrl: await urlCreateClient.connectionUrl(),
      identity: sdkIdentity
    });
    assert.equal((await connectionUrlReconnectClient.get("SELECT count(*) AS total FROM url_notes"))?.total, "1");
    const urlLowLevelClient = createIcpdbClient({
      url: formatIcpdbDatabaseUrl("aaaaa-aa", "db_url_auto"),
      identity: sdkIdentity
    });
    assert.equal(urlLowLevelClient.url(), formatIcpdbDatabaseUrl("aaaaa-aa", "db_url_auto"));
    const connectionUrlLowLevelClient = createIcpdbClient({
      connectionUrl: formatIcpdbDatabaseUrl("aaaaa-aa", "db_url_auto"),
      identity: sdkIdentity
    });
    assert.equal(connectionUrlLowLevelClient.connectionUrl(), formatIcpdbDatabaseUrl("aaaaa-aa", "db_url_auto"));
    await urlLowLevelClient.batch(["SELECT count(*) AS total FROM url_notes"], "read");
    await urlLowLevelClient.batch(["INSERT INTO url_notes(id) VALUES (2)"], "write");
    const lowLevelLibsqlMigrate = await urlLowLevelClient.migrate([
      "CREATE TABLE low_level_libsql_migrated(id INTEGER)",
      sql`INSERT INTO low_level_libsql_migrated(id) VALUES (${2})`
    ]);
    assert.equal(lowLevelLibsqlMigrate.length, 2);
    assert.deepEqual(urlSqlCalls.slice(-3), [
      { method: "execute", databaseId: "db_url_auto", sql: "PRAGMA foreign_keys=off" },
      { method: "batch", databaseId: "db_url_auto", statements: ["CREATE TABLE low_level_libsql_migrated(id INTEGER)", "INSERT INTO low_level_libsql_migrated(id) VALUES (?1)"] },
      { method: "execute", databaseId: "db_url_auto", sql: "PRAGMA foreign_keys=on" }
    ]);
    assert.equal((await urlLowLevelClient.prepare("SELECT count(*) AS total FROM url_notes").get())?.total, "1");
    assert.deepEqual(await urlLowLevelClient.values("SELECT count(*) AS total FROM url_notes"), [["1"]]);
    assert.equal((await urlLowLevelClient.first("SELECT count(*) AS total FROM url_notes"))?.total, "1");
    assert.equal(await urlLowLevelClient.firstValue("SELECT count(*) AS total FROM url_notes"), "1");
    assert.equal(await urlLowLevelClient.scalar("SELECT count(*) AS total FROM url_notes"), "1");
    await urlLowLevelClient.execute("SELECT count(*) AS total FROM url_notes");
    assert.deepEqual(urlSqlCalls.at(-1), { method: "query", databaseId: "db_url_auto", sql: "SELECT count(*) AS total FROM url_notes" });
    await urlLowLevelClient.database("db_url_auto").execute("SELECT count(*) AS total FROM url_notes");
    assert.deepEqual(urlSqlCalls.at(-1), { method: "query", databaseId: "db_url_auto", sql: "SELECT count(*) AS total FROM url_notes" });
    const urlDirectPrepared = urlLowLevelClient.database("db_url_auto").prepare("SELECT count(*) AS total FROM url_notes");
    assert.equal((await urlDirectPrepared.get())?.total, "1");
    await assert.rejects(() => urlLowLevelClient.execute({ sql: "INSERT", idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
    await assert.rejects(() => urlLowLevelClient.execute({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
    await assert.rejects(() => urlLowLevelClient.query({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
    await assert.rejects(() => urlLowLevelClient.database("db_url_auto").execute({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
    const lowLevelReadRejectCallCount = urlSqlCalls.length;
    await assert.rejects(() => urlLowLevelClient.query("INSERT INTO url_notes(id) VALUES (999)"), /query only accepts read SQL/);
    await assert.rejects(() => urlLowLevelClient.queryRows("INSERT INTO url_notes(id) VALUES (999)"), /query only accepts read SQL/);
    await assert.rejects(() => urlLowLevelClient.database("db_url_auto").query("INSERT INTO url_notes(id) VALUES (999)"), /query only accepts read SQL/);
    assert.equal(urlSqlCalls.length, lowLevelReadRejectCallCount);
    await assert.rejects(() => urlLowLevelClient.batch(["INSERT"], { idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
    await assert.rejects(() => urlLowLevelClient.batch([{ sql: "INSERT", idempotencyKey: "statement_retry" }], "write"), /batch statement idempotencyKey is not supported; use batch option idempotencyKey/);
    await assert.rejects(() => urlLowLevelClient.database("db_url_auto").batch([{ sql: "INSERT", idempotencyKey: "statement_retry" }], "write"), /batch statement idempotencyKey is not supported; use batch option idempotencyKey/);
    await assert.rejects(() => urlLowLevelClient.batch([{ sql: "SELECT 1", maxRows: 1 }], "read"), /batch statement maxRows is not supported; use batch option maxRows/);
    await assert.rejects(() => urlLowLevelClient.database("db_url_auto").batch([{ sql: "SELECT 1", maxRows: 1 }], "read"), /batch statement maxRows is not supported; use batch option maxRows/);
    await assert.rejects(() => urlLowLevelClient.batch([{ sql: "INSERT", databaseId: "db_other" }], "write"), /batch statement databaseId is not supported; choose database at the client or batch option/);
    await assert.rejects(() => urlLowLevelClient.database("db_url_auto").batch([{ sql: "INSERT", databaseId: "db_other" }], "write"), /batch statement databaseId is not supported; choose database at the client or batch option/);
    const lowLevelChunkedScriptCallsBefore = urlSqlCalls.length;
    const lowLevelChunkedScript = Array.from({ length: 33 }, (_, index) => `INSERT INTO url_notes(id) VALUES (${300 + index})`).join(";");
    await urlLowLevelClient.executeScript(lowLevelChunkedScript, { databaseId: "db_url_auto", idempotencyKey: "sdk_retry_low_level_chunked_script" });
    assert.deepEqual(urlSqlCalls.slice(lowLevelChunkedScriptCallsBefore).map((call) => call.idempotencyKey), [
      "sdk_retry_low_level_chunked_script:chunk:1:of:2",
      "sdk_retry_low_level_chunked_script:chunk:2:of:2"
    ]);
    const databaseHandleChunkedDumpCallsBefore = urlSqlCalls.length;
    const databaseHandleChunkedDump = Array.from({ length: 33 }, (_, index) => `INSERT INTO url_notes(id) VALUES (${400 + index});`).join("\n");
    await urlLowLevelClient.database("db_url_auto").loadSqlDump(databaseHandleChunkedDump, { idempotencyKey: "sdk_retry_database_handle_chunked_load" });
    assert.deepEqual(urlSqlCalls.slice(databaseHandleChunkedDumpCallsBefore).map((call) => call.idempotencyKey), [
      "sdk_retry_database_handle_chunked_load:chunk:1:of:2",
      "sdk_retry_database_handle_chunked_load:chunk:2:of:2"
    ]);
    await assert.rejects(async () => urlLowLevelClient.dumpSql({ databaseId: "db_other" }), /database dump option databaseId is not supported; choose database at the client, low-level dump argument, or database handle/);
    await assert.rejects(async () => urlLowLevelClient.dumpSql("db_url_auto", { databaseId: "db_other" }), /database dump option databaseId is not supported; choose database at the client, low-level dump argument, or database handle/);
    await assert.rejects(async () => urlLowLevelClient.inspect("db_url_auto", { databaseId: "db_other" }), /database inspect option databaseId is not supported; choose database at the client, low-level inspect argument, or database handle/);
    await assert.rejects(async () => urlLowLevelClient.restore([999], "db_url_auto", { databaseId: "db_other" }), /database restore option databaseId is not supported; choose database at the client, low-level restore argument, or database handle/);
    await assert.rejects(async () => urlLowLevelClient.waitForRoutedOperation("op_1", { databaseId: "db_other" }), /database wait option databaseId is not supported; choose database at the client, low-level wait argument, or database handle/);
    await assert.rejects(async () => urlLowLevelClient.waitForRoutedOperation("db_url_auto", "op_1", { databaseId: "db_other" }), /database wait option databaseId is not supported; choose database at the client, low-level wait argument, or database handle/);
    await assert.rejects(() => urlLowLevelClient.batch([]), /batch requires at least one SQL statement/);
    await assert.rejects(() => urlLowLevelClient.batch(["SELECT 1"], { mode: "read", idempotencyKey: "read_retry" }), /read batch mode does not accept idempotencyKey/);
    assert.deepEqual(urlCreateDatabaseCalls, ["create_database"]);
    assert.deepEqual(urlSqlCalls.map(({ method, databaseId }) => ({ method, databaseId })), [
      { method: "execute", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "execute", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "batch", databaseId: "db_url_auto" },
      { method: "execute", databaseId: "db_url_auto" },
      { method: "batch", databaseId: "db_url_auto" },
      { method: "execute", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "query", databaseId: "db_url_auto" },
      { method: "batch", databaseId: "db_url_auto" },
      { method: "batch", databaseId: "db_url_auto" },
      { method: "batch", databaseId: "db_url_auto" },
      { method: "batch", databaseId: "db_url_auto" }
    ]);
  } finally {
    Actor.createActor = originalUrlCreateActor;
  }
}

{
  const queryOnlyCalls = [];
  const originalQueryOnlyActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      queryOnlyCalls.push({ method: "create_database" });
      return { Ok: "db_query_only" };
    },
    sql_query: async (request) => {
      queryOnlyCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["value"], [[{ Integer: "1" }]], 0n, 0n);
    }
  });
  try {
    const queryOnlyClient = createClient({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity
    });
    assert.equal(await queryOnlyClient.scalar("SELECT 1 AS value"), "1");
    assert.equal(await queryOnlyClient.databaseId(), "db_query_only");
    assert.equal(await queryOnlyClient.connectionUrl(), "icpdb://aaaaa-aa/db_query_only");
    assert.deepEqual(queryOnlyCalls, [
      { method: "create_database" },
      { method: "query", databaseId: "db_query_only", sql: "SELECT 1 AS value" }
    ]);
  } finally {
    Actor.createActor = originalQueryOnlyActor;
  }
}

{
  const firstQueryCalls = [];
  const originalFirstQueryActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      firstQueryCalls.push({ method: "create_database" });
      return { Ok: "db_first_query" };
    },
    sql_batch: async (request) => {
      firstQueryCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    },
    sql_query: async (request) => {
      firstQueryCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["body"], [[{ Text: "from-first-query-setup" }]], 0n, 0n);
    }
  });
  try {
    const firstQueryClient = createClient({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity,
      setupSql: `
        CREATE TABLE first_query_notes(id INTEGER PRIMARY KEY, body TEXT);
        CREATE TRIGGER first_query_guard AFTER INSERT ON first_query_notes BEGIN SELECT 1; END;
        INSERT INTO first_query_notes(body) VALUES ('from-first-query-setup');
      `
    });
    assert.equal((await firstQueryClient.queryRows("SELECT body FROM first_query_notes"))[0]?.body, "from-first-query-setup");
    assert.equal(await firstQueryClient.databaseId(), "db_first_query");
    assert.equal(await firstQueryClient.connectionUrl(), "icpdb://aaaaa-aa/db_first_query");
    assert.deepEqual(firstQueryCalls, [
      { method: "create_database" },
      {
        method: "batch",
        databaseId: "db_first_query",
        statements: [
          "CREATE TABLE first_query_notes(id INTEGER PRIMARY KEY, body TEXT)",
          "CREATE TRIGGER first_query_guard AFTER INSERT ON first_query_notes BEGIN SELECT 1; END",
          "INSERT INTO first_query_notes(body) VALUES ('from-first-query-setup')"
        ]
      },
      { method: "query", databaseId: "db_first_query", sql: "SELECT body FROM first_query_notes" }
    ]);
  } finally {
    Actor.createActor = originalFirstQueryActor;
  }
}

{
  const firstSetupStatementCalls = [];
  const originalFirstSetupStatementActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      firstSetupStatementCalls.push({ method: "create_database" });
      return { Ok: "db_first_setup_statements" };
    },
    sql_batch: async (request) => {
      firstSetupStatementCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => ({
          sql: statement.sql,
          params: statement.params
        }))
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    },
    sql_query: async (request) => {
      firstSetupStatementCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["body"], [[{ Text: "from-first-setup-statements" }]], 0n, 0n);
    }
  });
  try {
    const firstSetupStatementClient = createClient({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity,
      setupStatements: [
        "CREATE TABLE setup_statement_notes(id INTEGER PRIMARY KEY, body TEXT)",
        { sql: "INSERT INTO setup_statement_notes(body) VALUES (:body)", args: { body: "from-first-setup-statements" } }
      ]
    });
    assert.equal((await firstSetupStatementClient.get("SELECT body FROM setup_statement_notes"))?.body, "from-first-setup-statements");
    assert.equal(await firstSetupStatementClient.databaseId(), "db_first_setup_statements");
    assert.equal(await firstSetupStatementClient.connectionUrl(), "icpdb://aaaaa-aa/db_first_setup_statements");
    assert.deepEqual(firstSetupStatementCalls, [
      { method: "create_database" },
      {
        method: "batch",
        databaseId: "db_first_setup_statements",
        statements: [
          { sql: "CREATE TABLE setup_statement_notes(id INTEGER PRIMARY KEY, body TEXT)", params: [] },
          { sql: "INSERT INTO setup_statement_notes(body) VALUES (:body)", params: [{ Text: "from-first-setup-statements" }] }
        ]
      },
      { method: "query", databaseId: "db_first_setup_statements", sql: "SELECT body FROM setup_statement_notes" }
    ]);
  } finally {
    Actor.createActor = originalFirstSetupStatementActor;
  }
}

{
  const firstMigrationCalls = [];
  const originalFirstMigrationActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      firstMigrationCalls.push({ method: "create_database" });
      return { Ok: "db_first_migration" };
    },
    sql_query: async (request) => {
      firstMigrationCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql, params: request.params });
      if (request.sql.includes("sqlite_master")) return rawSqlOk(["name"], [], 0n, 0n);
      if (request.sql.includes("icpdb_schema_migrations")) return rawSqlOk(["version"], [], 0n, 0n);
      return rawSqlOk(["body"], [[{ Text: "from-first-migration" }]], 0n, 0n);
    },
    sql_batch: async (request) => {
      firstMigrationCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    }
  });
  try {
    const firstMigrationClient = createClient({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity,
      setupMigrations: [
        {
          version: "001",
          name: "create_notes",
          sql: `
            CREATE TABLE migration_notes(id INTEGER PRIMARY KEY, body TEXT);
            INSERT INTO migration_notes(body) VALUES ('from-first-migration');
          `
        }
      ]
    });
    assert.equal((await firstMigrationClient.get("SELECT body FROM migration_notes"))?.body, "from-first-migration");
    assert.equal(await firstMigrationClient.databaseId(), "db_first_migration");
    assert.equal(await firstMigrationClient.connectionUrl(), "icpdb://aaaaa-aa/db_first_migration");
    assert.deepEqual(firstMigrationCalls.map((call) => call.method === "query" ? { method: call.method, databaseId: call.databaseId, sql: call.sql } : call), [
      { method: "create_database" },
      {
        method: "query",
        databaseId: "db_first_migration",
        sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1"
      },
      {
        method: "batch",
        databaseId: "db_first_migration",
        statements: [
          "CREATE TABLE icpdb_schema_migrations(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at_ms TEXT NOT NULL)"
        ]
      },
      {
        method: "query",
        databaseId: "db_first_migration",
        sql: "SELECT version FROM icpdb_schema_migrations ORDER BY version"
      },
      {
        method: "batch",
        databaseId: "db_first_migration",
        statements: [
          "CREATE TABLE migration_notes(id INTEGER PRIMARY KEY, body TEXT)",
          "INSERT INTO migration_notes(body) VALUES ('from-first-migration')",
          "INSERT INTO icpdb_schema_migrations(version, name, applied_at_ms) VALUES (?1, ?2, ?3)"
        ]
      },
      { method: "query", databaseId: "db_first_migration", sql: "SELECT body FROM migration_notes" }
    ]);
  } finally {
    Actor.createActor = originalFirstMigrationActor;
  }
}

{
  const connectionUrlFirstCalls = [];
  const originalConnectionUrlFirstActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      connectionUrlFirstCalls.push({ method: "create_database" });
      return { Ok: "db_connection_url_first" };
    },
    sql_batch: async (request) => {
      connectionUrlFirstCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    },
    sql_query: async (request) => {
      connectionUrlFirstCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["body"], [[{ Text: "from-connection-url-first" }]], 0n, 0n);
    }
  });
  try {
    const connectionUrlFirstClient = createClient({
      canisterId: "aaaaa-aa",
      identity: sdkIdentity,
      setupSql: `
        CREATE TABLE connection_url_notes(id INTEGER PRIMARY KEY, body TEXT);
        INSERT INTO connection_url_notes(body) VALUES ('from-connection-url-first');
      `
    });
    assert.equal(await connectionUrlFirstClient.connectionUrl(), "icpdb://aaaaa-aa/db_connection_url_first");
    assert.equal(await connectionUrlFirstClient.url(), "icpdb://aaaaa-aa/db_connection_url_first");
    assert.equal(await connectionUrlFirstClient.databaseId(), "db_connection_url_first");
    assert.equal((await connectionUrlFirstClient.get("SELECT body FROM connection_url_notes"))?.body, "from-connection-url-first");
    assert.deepEqual(connectionUrlFirstCalls, [
      { method: "create_database" },
      {
        method: "batch",
        databaseId: "db_connection_url_first",
        statements: [
          "CREATE TABLE connection_url_notes(id INTEGER PRIMARY KEY, body TEXT)",
          "INSERT INTO connection_url_notes(body) VALUES ('from-connection-url-first')"
        ]
      },
      { method: "query", databaseId: "db_connection_url_first", sql: "SELECT body FROM connection_url_notes" }
    ]);
  } finally {
    Actor.createActor = originalConnectionUrlFirstActor;
  }
}

{
  const invalidLazyScriptCalls = [];
  const originalInvalidLazyScriptActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      invalidLazyScriptCalls.push({ method: "create_database" });
      return { Ok: "db_invalid_lazy_script" };
    },
    sql_batch: async () => {
      invalidLazyScriptCalls.push({ method: "batch" });
      return { Ok: [] };
    }
  });
  const invalidLazyScriptClient = createClient({
    canisterId: "aaaaa-aa",
    identity: sdkIdentity
  });
  try {
    await assert.rejects(() => invalidLazyScriptClient.executeScript("  ;  "), /script requires at least one SQL statement/);
    await assert.rejects(() => invalidLazyScriptClient.exec("  ;  "), /script requires at least one SQL statement/);
    await assert.rejects(() => invalidLazyScriptClient.executeMultiple("  ;  "), /script requires at least one SQL statement/);
    await assert.rejects(() => invalidLazyScriptClient.loadSqlDump("BEGIN; COMMIT;"), /SQL dump has no executable statements/);
    await assert.rejects(() => invalidLazyScriptClient.executeScript("SELECT 1", { maxRows: 0 }), /maxRows must be an integer from 1 to 500/);
    await assert.rejects(() => invalidLazyScriptClient.executeScript("SELECT 1", { mode: "read", idempotencyKey: "read_script_retry" }), /read batch mode does not accept idempotencyKey/);
    await assert.rejects(() => invalidLazyScriptClient.executeScript("INSERT INTO notes(id) VALUES (1)", { mode: "read" }), /read batch mode only accepts read SQL/);
    await assert.rejects(() => invalidLazyScriptClient.executeScript("INSERT INTO notes(id) VALUES (1)", { idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
    assert.deepEqual(invalidLazyScriptCalls, []);
  } finally {
    invalidLazyScriptClient.close();
    Actor.createActor = originalInvalidLazyScriptActor;
  }
}

const calls = [];
let migrationTableExists = false;
const migrationVersions = new Set(["000"]);
let waitOperationPolls = 0;
const fakeDatabase = {
  databaseId: "db_sdk",
  connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
  query: async (statement) => {
    calls.push({ method: "query", statement });
    if (statement.sql.includes("sqlite_master") && JSON.stringify(statement).includes("sqlite_sequence")) {
      return sqlResponse(["name"], [[{ kind: "text", value: "sqlite_sequence" }]], "0", "0");
    }
    if (statement.sql.includes("FROM sqlite_sequence")) {
      return sqlResponse(["name", "seq"], [[{ kind: "text", value: "notes" }, { kind: "integer", value: "44" }]], "0", "0");
    }
    if (statement.sql.includes("sqlite_master")) {
      return sqlResponse(["name"], migrationTableExists ? [[{ kind: "text", value: "icpdb_schema_migrations" }]] : [], "0", "0");
    }
    if (statement.sql.includes("FROM icpdb_schema_migrations")) {
      return sqlResponse(["version"], [...migrationVersions].sort().map((version) => [{ kind: "text", value: version }]), "0", "0");
    }
    if (statement.sql.includes("SELECT :payload AS payload")) {
      return sqlResponse(["payload"], [[{ kind: "blob", value: [1, 2, 3] }]], "0", "0");
    }
    if (statement.sql.includes("SELECT 'cell-length' AS length")) {
      return sqlResponse(["length"], [[{ kind: "text", value: "cell-length" }]], "0", "0");
    }
    if (statement.sql.includes("SELECT ?1 AS value, ?2 AS label")) {
      return sqlResponse(["value", "label"], [[{ kind: "integer", value: "7" }, { kind: "text", value: "seven" }]], "0", "0");
    }
    if (statement.sql.includes("SELECT 'proto' AS __proto__")) {
      return sqlResponse(["__proto__", "constructor"], [[
        { kind: "text", value: "proto" },
        { kind: "text", value: "ctor" }
      ]], "0", "0");
    }
    return sqlResponse(["value"], [[{ kind: "integer", value: "7" }]], "0", "0");
  },
  execute: async (statement) => {
    calls.push({ method: "execute", statement });
    return sqlResponse([], [], "1", "42");
  },
  batch: async (statements, options) => {
    calls.push({ method: "batch", statements, options });
    for (const statement of statements) {
      if (statement.sql.startsWith("CREATE TABLE icpdb_schema_migrations")) migrationTableExists = true;
      if (statement.sql.startsWith("INSERT INTO icpdb_schema_migrations")) migrationVersions.add(String(statement.params[0]));
    }
    return statements.map((statement) => statement.sql.startsWith("SELECT count(*)")
      ? sqlResponse(["total"], [[{ kind: "integer", value: "2" }]], "0", "0")
      : sqlResponse([], [], "1", "43"));
  },
  schema: async (tableName) => {
    calls.push({ method: "schema", tableName });
    return "CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL);\n";
  },
  listTables: async () => {
    calls.push({ method: "listTables" });
    return [
      { name: "notes", objectType: "table", schemaSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL)" },
      { name: "notes_view", objectType: "view", schemaSql: "CREATE VIEW notes_view AS SELECT id, body FROM notes" }
    ];
  },
  describeTable: async (tableName) => {
    calls.push({ method: "describeTable", tableName });
    if (tableName === "notes_view") {
      return {
        databaseId: "db_sdk",
        tableName,
        objectType: "view",
        schemaSql: "CREATE VIEW notes_view AS SELECT id, body FROM notes",
        columns: [
          { cid: 0, name: "id", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 },
          { cid: 1, name: "body", declaredType: "TEXT", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 },
          { cid: 2, name: "body_len", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 }
        ],
        indexes: [],
        triggers: [],
        foreignKeys: []
      };
    }
    return {
      databaseId: "db_sdk",
      tableName,
      objectType: "table",
      schemaSql: "CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL)",
      columns: [
        { cid: 0, name: "id", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 },
        { cid: 1, name: "body", declaredType: "TEXT", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 },
        { cid: 2, name: "body_len", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 2 }
      ],
      indexes: [{ name: "idx_notes_body", tableName, unique: false, origin: "c", partial: false, columns: [], schemaSql: "CREATE INDEX idx_notes_body ON notes(body)" }],
      triggers: [{ name: "trg_notes", tableName, schemaSql: "CREATE TRIGGER trg_notes AFTER INSERT ON notes BEGIN SELECT 1; END" }],
      foreignKeys: []
    };
  },
  listColumns: async (tableName) => {
    calls.push({ method: "listColumns", tableName });
    return (await fakeDatabase.describeTable(tableName)).columns;
  },
  listIndexes: async (tableName) => {
    calls.push({ method: "listIndexes", tableName });
    return (await fakeDatabase.describeTable(tableName)).indexes;
  },
  listTriggers: async (tableName) => {
    calls.push({ method: "listTriggers", tableName });
    return (await fakeDatabase.describeTable(tableName)).triggers;
  },
  listForeignKeys: async (tableName) => {
    calls.push({ method: "listForeignKeys", tableName });
    return (await fakeDatabase.describeTable(tableName)).foreignKeys;
  },
  previewTable: async (tableName, options) => {
    calls.push({ method: "previewTable", tableName, options });
    return {
      databaseId: "db_sdk",
      tableName,
      columns: ["id", "body", "body_len"],
      rows: [[{ kind: "integer", value: "1" }, { kind: "text", value: "quote ' semi; blob" }, { kind: "integer", value: "18" }]],
      offset: 0,
      limit: 250,
      totalCount: "1",
      truncated: false
    };
  },
  delete: async () => {
    calls.push({ method: "delete" });
  },
  getUsage: async () => {
    calls.push({ method: "getUsage" });
    return {
      databaseId: "db_sdk",
      status: "hot",
      logicalSizeBytes: "128",
      maxLogicalSizeBytes: "1048576",
      usageEventCount: "3"
    };
  },
  listUsageEvents: async () => {
    calls.push({ method: "listUsageEvents" });
    return [{
      method: "sql_query",
      operation: null,
      success: true,
      eventCount: "1",
      totalCyclesDelta: "0",
      totalRowsReturned: "1",
      totalRowsAffected: "0",
      lastCreatedAtMs: "1"
    }];
  },
  getRoutedOperation: async (operationId) => {
    calls.push({ method: "getRoutedOperation", operationId });
    if (operationId === "op_wait") {
      waitOperationPolls += 1;
      return {
        operationId,
        databaseId: "db_sdk",
        databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
        method: "sql_execute",
        requestHash: [1, 2],
        status: waitOperationPolls === 1 ? "pending" : "applied",
        error: null,
        createdAtMs: "1",
        updatedAtMs: String(waitOperationPolls)
      };
    }
    return {
      operationId,
      databaseId: "db_sdk",
      databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
      method: "sql_execute",
      requestHash: [1, 2],
      status: "unknown",
      error: null,
      createdAtMs: "1",
      updatedAtMs: "2"
    };
  },
  reconcileRoutedOperation: async (operationId) => {
    calls.push({ method: "reconcileRoutedOperation", operationId });
    return {
      operationId,
      databaseId: "db_sdk",
      databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
      method: "sql_execute",
      requestHash: [1, 2],
      status: "applied",
      error: null,
      createdAtMs: "1",
      updatedAtMs: "3"
    };
  },
  placement: async () => {
    calls.push({ method: "placement" });
    return {
      databaseId: "db_sdk",
      shardId: "local",
      canisterId: "aaaaa-aa",
      mountId: 0,
      status: "hot",
      schemaVersion: "1",
      createdAtMs: "1",
      updatedAtMs: "1"
    };
  },
  grantMember: async (principal, role) => {
    calls.push({ method: "grantMember", principal, role });
  },
  revokeMember: async (principal) => {
    calls.push({ method: "revokeMember", principal });
  },
  listMembers: async () => {
    calls.push({ method: "listMembers" });
    return [{ databaseId: "db_sdk", principal: "aaaaa-aa", role: "owner", createdAtMs: "1" }];
  },
  archive: async () => {
    calls.push({ method: "archive" });
    return new Uint8Array([1, 2, 3]);
  },
  restore: async (snapshot, options) => {
    calls.push({ method: "restore", snapshot: Array.from(snapshot), options });
  }
};

const client = createClientFromDatabase(fakeDatabase, {
  principal: () => "aaaaa-aa",
  health: () => ({ cyclesBalance: 42n })
});
const trimmedPrincipalClient = createClientFromDatabase(fakeDatabase, {
  principal: () => " aaaaa-aa "
});
assert.equal(await trimmedPrincipalClient.principal(), "aaaaa-aa");
await assert.rejects(() => createClientFromDatabase(fakeDatabase, {
  principal: () => "   "
}).principal(), /principal must be a non-empty string/);
await assert.rejects(() => createClientFromDatabase(fakeDatabase, {
  principal: () => undefined
}).principal(), /principal must be a non-empty string/);
await assert.rejects(() => createClientFromDatabase(fakeDatabase, {
  principal: () => "2vxsx-fae"
}).principal(), /anonymous client metadata principal is not allowed/);
assert.equal(await client.databaseId(), "db_sdk");
assert.equal(await client.connectionUrl(), "icpdb://aaaaa-aa/db_sdk");
assert.equal(await client.url(), "icpdb://aaaaa-aa/db_sdk");
assert.deepEqual(await client.info(), {
  canisterId: "aaaaa-aa",
  databaseId: "db_sdk",
  connectionUrl: "icpdb://aaaaa-aa/db_sdk",
  url: "icpdb://aaaaa-aa/db_sdk",
  principal: "aaaaa-aa"
});
assert.equal((await client.health()).cyclesBalance, 42n);
const clientDatabase = await client.database();
assert.deepEqual(clientDatabase.info(), {
  canisterId: "aaaaa-aa",
  databaseId: "db_sdk",
  connectionUrl: "icpdb://aaaaa-aa/db_sdk",
  url: "icpdb://aaaaa-aa/db_sdk"
});
assert.equal((await clientDatabase.queryRows("SELECT ?1 AS value", [7]))[0].value, "7");
assert.equal((await clientDatabase.queryOne("SELECT ?1 AS value", [7]))?.value, "7");
assert.equal((await clientDatabase.all("SELECT ?1 AS value", [7]))[0].value, "7");
assert.equal((await clientDatabase.get("SELECT ?1 AS value", [7]))?.value, "7");
assert.deepEqual(await clientDatabase.values("SELECT ?1 AS value", [7]), [["7"]]);
assert.equal((await clientDatabase.first("SELECT ?1 AS value", [7]))?.value, "7");
assert.equal(await clientDatabase.firstValue("SELECT ?1 AS value", [7]), "7");
assert.equal(await clientDatabase.scalar("SELECT ?1 AS value", [7]), "7");
assert.equal((await clientDatabase.execute("SELECT ?1 AS value", [7])).rows[0][0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT ?1 AS value", params: [7], maxRows: null }
});
assert.equal((await clientDatabase.run("SELECT ?1 AS value", [7])).rows[0][0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT ?1 AS value", params: [7], maxRows: null }
});
assert.equal((await clientDatabase.prepare("SELECT ?1 AS value").get([7]))?.value, "7");
assert.equal((await clientDatabase.prepare(sql`SELECT ${7} AS value`).get())?.value, "7");
assert.deepEqual(calls.at(-1).statement.params, [7]);
assert.equal((await clientDatabase.prepare({ sql: "SELECT :value AS value", params: { value: 7 } }).get())?.value, "7");
assert.deepEqual(calls.at(-1).statement.params, [7]);
assert.equal((await clientDatabase.prepare(["SELECT ?1 AS value", [7]]).get())?.value, "7");
assert.deepEqual(calls.at(-1).statement.params, [7]);
const databaseHandleCallCount = calls.length;
await assert.rejects(() => clientDatabase.query({ sql: "SELECT 1", databaseId: "db_other" }), /database handle statement databaseId is not supported; choose database when creating the handle/);
await assert.rejects(() => clientDatabase.execute({ sql: "INSERT INTO notes(id) VALUES (24)", databaseId: "db_other" }), /database handle statement databaseId is not supported; choose database when creating the handle/);
await assert.rejects(() => clientDatabase.run({ sql: "INSERT INTO notes(id) VALUES (25)", databaseId: "db_other" }), /database handle statement databaseId is not supported; choose database when creating the handle/);
await assert.rejects(() => clientDatabase.exec("INSERT INTO notes(id) VALUES (26)", { databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => clientDatabase.executeScript("INSERT INTO notes(id) VALUES (27)", { databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => clientDatabase.loadSqlDump("INSERT INTO notes(id) VALUES (28)", { databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(async () => clientDatabase.previewTable("notes", { databaseId: "db_other" }), /database preview option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(async () => clientDatabase.inspect({ databaseId: "db_other" }), /database inspect option databaseId is not supported; choose database at the client, low-level inspect argument, or database handle/);
await assert.rejects(async () => clientDatabase.dumpSql({ databaseId: "db_other" }), /database dump option databaseId is not supported; choose database at the client, low-level dump argument, or database handle/);
await assert.rejects(async () => clientDatabase.waitForRoutedOperation("op_db_handle_unknown", { databaseId: "db_other" }), /database wait option databaseId is not supported; choose database at the client, low-level wait argument, or database handle/);
assert.equal(calls.length, databaseHandleCallCount);
assert.equal((await clientDatabase.tables())[0]?.name, "notes");
assert.deepEqual((await clientDatabase.views()).map((table) => table.name), ["notes_view"]);
assert.equal((await clientDatabase.describe("notes")).tableName, "notes");
assert.equal((await clientDatabase.preview("notes")).tableName, "notes");
assert.equal((await clientDatabase.describe(" notes ")).tableName, "notes");
assert.deepEqual(calls.at(-1), { method: "describeTable", tableName: "notes" });
const tableNameCallCount = calls.length;
await assert.rejects(() => clientDatabase.schema("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.describeTable("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.describe("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.listColumns("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.columns("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.listIndexes("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.indexes("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.listTriggers("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.triggers("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.listForeignKeys("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.foreignKeys("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.previewTable("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.preview("   "), /tableName must be a non-empty string/);
await assert.rejects(() => clientDatabase.previewTable("notes", { limit: 0 }), /preview limit must be an integer from 1 to 500/);
assert.equal(calls.length, tableNameCallCount);
await clientDatabase.run("INSERT INTO notes(id) VALUES (?1)", [1]);
const handleReadBatch = await clientDatabase.batch(["SELECT count(*) AS total FROM notes"], "read");
assert.equal(handleReadBatch[0].rows[0][0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: null }
});
const handleReadTransaction = await clientDatabase.transaction(["SELECT count(*) AS total FROM notes"], "read");
assert.equal(handleReadTransaction[0].rows[0][0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: null }
});
const handleReadScript = await clientDatabase.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
assert.equal(handleReadScript[0].rows[0][0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: 1 }
});
const handleReadDump = await clientDatabase.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
assert.equal(handleReadDump[0].rows[0][0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: 1 }
});
const customTablesClient = createClientFromDatabase({
  ...fakeDatabase,
  listTables: async () => [
    { name: " notes ", objectType: "table", schemaSql: "CREATE TABLE notes(id INTEGER)" },
    { name: " notes_view ", objectType: "view", schemaSql: null }
  ]
});
const customTablesDatabase = await customTablesClient.database();
assert.deepEqual(await customTablesDatabase.listTables(), [
  { name: "notes", objectType: "table", schemaSql: "CREATE TABLE notes(id INTEGER)" },
  { name: "notes_view", objectType: "view", schemaSql: null }
]);
assert.deepEqual(await customTablesDatabase.views(), [
  { name: "notes_view", objectType: "view", schemaSql: null }
]);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, listTables: async () => [{ name: "bad", objectType: "index", schemaSql: null }] }).database()).listTables(),
  /database table objectType must be table or view/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, listTables: async () => "bad" }).database()).listTables(),
  /database table list must be an array/
);
const customDescriptionCalls = [];
const customDescriptionBase = {
  databaseId: " db_description ",
  tableName: " notes ",
  objectType: "table",
  schemaSql: "CREATE TABLE notes(id INTEGER, body TEXT)",
  columns: [
    { cid: 0, name: " id ", declaredType: "INTEGER", notNull: true, defaultValue: null, primaryKeyPosition: 1, hidden: 0 },
    { cid: 1, name: " body ", declaredType: "TEXT", notNull: false, defaultValue: null, primaryKeyPosition: 0, hidden: 0 }
  ],
  indexes: [
    { name: " idx_notes_body ", tableName: " notes ", unique: false, origin: "c", partial: false, columns: [{ seqno: 0, cid: "1", name: "body", descending: false, collation: "BINARY", key: true }], schemaSql: null }
  ],
  triggers: [
    { name: " trg_notes ", tableName: " notes ", schemaSql: "CREATE TRIGGER trg_notes AFTER INSERT ON notes BEGIN SELECT 1; END" }
  ],
  foreignKeys: [
    { id: 0, seq: 0, tableName: " parent ", fromColumn: " parent_id ", toColumn: " id", onUpdate: "NO ACTION", onDelete: "CASCADE", matchClause: "NONE" }
  ]
};
const customDescriptionClient = createClientFromDatabase({
  ...fakeDatabase,
  describeTable: async (tableName) => {
    customDescriptionCalls.push({ method: "describeTable", tableName });
    return customDescriptionBase;
  },
  listColumns: async (tableName) => {
    customDescriptionCalls.push({ method: "listColumns", tableName });
    return customDescriptionBase.columns;
  },
  listIndexes: async (tableName) => {
    customDescriptionCalls.push({ method: "listIndexes", tableName });
    return customDescriptionBase.indexes;
  },
  listTriggers: async (tableName) => {
    customDescriptionCalls.push({ method: "listTriggers", tableName });
    return customDescriptionBase.triggers;
  },
  listForeignKeys: async (tableName) => {
    customDescriptionCalls.push({ method: "listForeignKeys", tableName });
    return customDescriptionBase.foreignKeys;
  }
});
const customDescriptionDatabase = await customDescriptionClient.database();
const customDescription = await customDescriptionDatabase.describeTable(" notes ");
assert.equal(customDescription.databaseId, "db_description");
assert.equal(customDescription.tableName, "notes");
assert.equal(customDescription.columns[0]?.name, "id");
assert.equal(customDescription.indexes[0]?.name, "idx_notes_body");
assert.equal(customDescription.triggers[0]?.name, "trg_notes");
assert.equal(customDescription.foreignKeys[0]?.tableName, "parent");
assert.deepEqual(customDescriptionCalls.at(-1), { method: "describeTable", tableName: "notes" });
assert.equal((await customDescriptionDatabase.listColumns(" notes "))[1]?.name, "body");
assert.equal((await customDescriptionDatabase.listIndexes(" notes "))[0]?.tableName, "notes");
assert.equal((await customDescriptionDatabase.listTriggers(" notes "))[0]?.tableName, "notes");
assert.equal((await customDescriptionDatabase.listForeignKeys(" notes "))[0]?.fromColumn, "parent_id");
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, describeTable: async () => ({ ...customDescriptionBase, tableName: "other" }) }).database()).describeTable("notes"),
  /table description tableName does not match requested table/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, listColumns: async () => [{ ...customDescriptionBase.columns[0], name: "   " }] }).database()).listColumns("notes"),
  /database column name must be a non-empty string/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, listIndexes: async () => [{ ...customDescriptionBase.indexes[0], tableName: "other" }] }).database()).listIndexes("notes"),
  /database index tableName does not match requested table/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, listTriggers: async () => [{ ...customDescriptionBase.triggers[0], tableName: "other" }] }).database()).listTriggers("notes"),
  /database trigger tableName does not match requested table/
);
await clientDatabase.exec("CREATE TABLE database_exec(id INTEGER); INSERT INTO database_exec(id) VALUES (1);");
await clientDatabase.executeMultiple("CREATE TABLE database_multiple(id INTEGER); INSERT INTO database_multiple(id) VALUES (1);");
assert.equal((await clientDatabase.executeScript("CREATE TABLE database_script(id INTEGER);")).length, 1);
assert.match(await clientDatabase.dumpSql({ pageSize: 10 }), /CREATE TABLE notes/);
assert.equal((await clientDatabase.loadSqlDump("CREATE TABLE database_dump(id INTEGER);")).length, 1);
assert.equal((await clientDatabase.inspect({ tableName: "notes" })).databaseId, "db_sdk");
assert.deepEqual(await clientDatabase.snapshotInfo([4, 5, 6]), snapshot456Info);
assert.equal((await clientDatabase.waitForRoutedOperation("op_db_handle_unknown", { intervalMs: 0, timeoutMs: 1000, reconcileUnknown: true })).status, "applied");
assert.deepEqual(calls.at(-1), { method: "reconcileRoutedOperation", operationId: "op_db_handle_unknown" });
assert.equal(clientDatabase.connectionUrl(), "icpdb://aaaaa-aa/db_sdk");
assert.equal(clientDatabase.url(), "icpdb://aaaaa-aa/db_sdk");
assert.equal((await clientDatabase.getUsage()).databaseId, "db_sdk");
assert.equal((await clientDatabase.status()).databaseId, "db_sdk");
assert.equal((await clientDatabase.listUsageEvents())[0]?.method, "sql_query");
assert.equal((await clientDatabase.getRoutedOperation("op_db_handle_get")).operationId, "op_db_handle_get");
assert.equal((await clientDatabase.reconcileRoutedOperation("op_db_handle_reconcile")).status, "applied");
await clientDatabase.grantMember(" rrkah-fqaaa-aaaaa-aaaaq-cai ", "writer");
assert.deepEqual(calls.at(-1), { method: "grantMember", principal: "rrkah-fqaaa-aaaaa-aaaaq-cai", role: "writer" });
assert.equal((await clientDatabase.listMembers())[0]?.role, "owner");
await clientDatabase.revokeMember(" rrkah-fqaaa-aaaaa-aaaaq-cai ");
assert.deepEqual(calls.at(-1), { method: "revokeMember", principal: "rrkah-fqaaa-aaaaa-aaaaq-cai" });
assert.equal((await clientDatabase.placement())?.databaseId, "db_sdk");
assert.deepEqual(Array.from(await clientDatabase.archive()), [1, 2, 3]);
await clientDatabase.restore(new Uint8Array([4, 5, 6]), { expectedSha256: "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472" });
assert.deepEqual(calls.at(-1), {
  method: "restore",
  snapshot: [4, 5, 6],
  options: { expectedSha256: "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472" }
});
const directRestoreCallCount = calls.length;
await assert.rejects(
  async () => clientDatabase.restore(new Uint8Array([4, 5, 6]), { databaseId: "db_other" }),
  /database restore option databaseId is not supported; choose database at the client, low-level restore argument, or database handle/
);
assert.equal(calls.length, directRestoreCallCount);
const customPreviewCalls = [];
const customPreviewBase = {
  databaseId: " db_preview ",
  tableName: " notes ",
  columns: ["id"],
  rows: [[{ kind: "integer", value: "1" }]],
  offset: 2,
  limit: 5,
  totalCount: "9",
  truncated: false
};
const customPreviewClient = createClientFromDatabase({
  ...fakeDatabase,
  previewTable: async (tableName, options) => {
    customPreviewCalls.push({ tableName, options });
    return customPreviewBase;
  }
});
const customPreviewDatabase = await customPreviewClient.database();
assert.deepEqual(await customPreviewDatabase.previewTable(" notes ", { limit: 5, offset: 2 }), {
  databaseId: "db_preview",
  tableName: "notes",
  columns: ["id"],
  rows: [[{ kind: "integer", value: "1" }]],
  offset: 2,
  limit: 5,
  totalCount: "9",
  truncated: false
});
assert.deepEqual(customPreviewCalls.at(-1), { tableName: "notes", options: { limit: 5, offset: 2 } });
const customPreviewCallCount = customPreviewCalls.length;
await assert.rejects(() => customPreviewDatabase.previewTable("notes", { limit: 0 }), /preview limit must be an integer from 1 to 500/);
assert.equal(customPreviewCalls.length, customPreviewCallCount);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, previewTable: async () => ({ ...customPreviewBase, tableName: "other" }) }).database()).previewTable("notes"),
  /table preview tableName does not match requested table/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, previewTable: async () => ({ ...customPreviewBase, rows: [[{ kind: "integer", value: "1" }, { kind: "integer", value: "2" }]] }) }).database()).previewTable("notes"),
  /SQL result row length must match columns length/
);
const customInspectionCalls = [];
const customInspectionClient = createClientFromDatabase({
  ...fakeDatabase,
  schema: async (tableName) => {
    customInspectionCalls.push({ method: "schema", tableName });
    return "";
  },
  dumpSql: async (options) => {
    customInspectionCalls.push({ method: "dumpSql", options });
    return "CREATE TABLE notes(id INTEGER);\n";
  },
  inspect: async (options) => {
    customInspectionCalls.push({ method: "inspect", options });
    return {
      databaseId: " db_inspect ",
      schema: "CREATE TABLE notes(id INTEGER);\n",
      tables: [{
        table: { name: " notes ", objectType: "table", schemaSql: null },
        description: customDescriptionBase,
        preview: customPreviewBase
      }]
    };
  }
});
const customInspectionDatabase = await customInspectionClient.database();
assert.equal(await customInspectionDatabase.schema(" notes "), "");
assert.deepEqual(customInspectionCalls.at(-1), { method: "schema", tableName: "notes" });
assert.equal(await customInspectionDatabase.dumpSql({ tableName: " notes ", pageSize: 10 }), "CREATE TABLE notes(id INTEGER);\n");
assert.deepEqual(customInspectionCalls.at(-1), { method: "dumpSql", options: { tableName: "notes", pageSize: 10 } });
const customInspection = await customInspectionDatabase.inspect({ tableName: " notes ", previewLimit: 5, previewOffset: 2 });
assert.equal(customInspection.databaseId, "db_inspect");
assert.equal(customInspection.tables[0]?.table.name, "notes");
assert.equal(customInspection.tables[0]?.description.tableName, "notes");
assert.equal(customInspection.tables[0]?.preview.tableName, "notes");
assert.deepEqual(customInspectionCalls.at(-1), { method: "inspect", options: { tableName: "notes", previewLimit: 5, previewOffset: 2 } });
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, schema: async () => 7 }).database()).schema(),
  /schema result must be a string/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, dumpSql: async () => 7 }).database()).dumpSql(),
  /SQL dump result must be a string/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, inspect: async () => "bad" }).database()).inspect(),
  /database inspection must be an object/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, inspect: async () => ({ databaseId: "db", schema: "", tables: "bad" }) }).database()).inspect(),
  /database inspection tables must be an array/
);
await assert.rejects(
  async () => (await createClientFromDatabase({
    ...fakeDatabase,
    inspect: async () => ({
      databaseId: "db",
      schema: "",
      tables: [{
        table: { name: "notes", objectType: "table", schemaSql: null },
        description: { ...customDescriptionBase, tableName: "other" },
        preview: customPreviewBase
      }]
    })
  }).database()).inspect(),
  /table description tableName does not match requested table/
);
const customMetadataClient = createClientFromDatabase({
  ...fakeDatabase,
  getUsage: async () => ({
    databaseId: " db_meta ",
    status: "hot",
    logicalSizeBytes: " 128 ",
    maxLogicalSizeBytes: " 1048576 ",
    usageEventCount: " 3 "
  }),
  listUsageEvents: async () => [{
    method: " sql_query ",
    operation: " read ",
    success: true,
    eventCount: " 1 ",
    totalCyclesDelta: " -2 ",
    totalRowsReturned: " 3 ",
    totalRowsAffected: " 0 ",
    lastCreatedAtMs: " 9 "
  }],
  getRoutedOperation: async (operationId) => ({
    operationId: ` ${operationId} `,
    databaseId: " db_meta ",
    databaseCanisterId: " rrkah-fqaaa-aaaaa-aaaaq-cai ",
    method: " sql_execute ",
    requestHash: [1, 2, 3],
    status: "unknown",
    error: null,
    createdAtMs: " 1 ",
    updatedAtMs: " 2 "
  }),
  reconcileRoutedOperation: async (operationId) => ({
    operationId: ` ${operationId} `,
    databaseId: " db_meta ",
    databaseCanisterId: " rrkah-fqaaa-aaaaa-aaaaq-cai ",
    method: " sql_execute ",
    requestHash: [4, 5, 6],
    status: "applied",
    error: null,
    createdAtMs: " 1 ",
    updatedAtMs: " 3 "
  }),
  placement: async () => ({
    databaseId: " db_meta ",
    shardId: " shard_1 ",
    canisterId: " rrkah-fqaaa-aaaaa-aaaaq-cai ",
    mountId: 0,
    status: "hot",
    schemaVersion: " 1 ",
    createdAtMs: " 1 ",
    updatedAtMs: " 2 "
  }),
  listMembers: async () => [{
    databaseId: " db_meta ",
    principal: " aaaaa-aa ",
    role: "owner",
    createdAtMs: " 1 "
  }],
  status: async () => ({
    databaseId: " db_meta ",
    connectionUrl: " icpdb://aaaaa-aa/db_meta ",
    callerPrincipal: " aaaaa-aa ",
    callerRole: "owner",
    placement: {
      databaseId: " db_meta ",
      shardId: " shard_1 ",
      canisterId: null,
      mountId: null,
      status: "hot",
      schemaVersion: " 1 ",
      createdAtMs: " 1 ",
      updatedAtMs: " 2 "
    },
    usage: {
      databaseId: " db_meta ",
      status: "hot",
      logicalSizeBytes: " 128 ",
      maxLogicalSizeBytes: " 1048576 ",
      usageEventCount: " 3 "
    },
    stats: {
      tableCount: 1,
      viewCount: 0,
      rowCount: " 4 ",
      columnCount: 2,
      indexCount: 1,
      triggerCount: 0,
      foreignKeyCount: 0
    },
    tableStatuses: [{
      tableName: " notes ",
      objectType: "table",
      rowCount: " 4 ",
      columnCount: 2,
      columns: [" id ", " body "],
      indexCount: 1,
      triggerCount: 0,
      foreignKeyCount: 0
    }]
  })
});
const customMetadataDatabase = await customMetadataClient.database();
assert.deepEqual(await customMetadataDatabase.getUsage(), {
  databaseId: "db_meta",
  status: "hot",
  logicalSizeBytes: "128",
  maxLogicalSizeBytes: "1048576",
  usageEventCount: "3"
});
assert.deepEqual(await customMetadataDatabase.listUsageEvents(), [{
  method: "sql_query",
  operation: "read",
  success: true,
  eventCount: "1",
  totalCyclesDelta: "-2",
  totalRowsReturned: "3",
  totalRowsAffected: "0",
  lastCreatedAtMs: "9"
}]);
assert.deepEqual(await customMetadataDatabase.getRoutedOperation(" op_meta "), {
  operationId: "op_meta",
  databaseId: "db_meta",
  databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
  method: "sql_execute",
  requestHash: [1, 2, 3],
  status: "unknown",
  error: null,
  createdAtMs: "1",
  updatedAtMs: "2"
});
assert.equal((await customMetadataDatabase.reconcileRoutedOperation(" op_meta ")).updatedAtMs, "3");
assert.deepEqual(
  (await (await createClientFromDatabase({
    ...fakeDatabase,
    getRoutedOperation: async () => ({
      operationId: "op_bytes",
      databaseId: "db",
      databaseCanisterId: "canister",
      method: "sql_execute",
      requestHash: new Uint8Array([1, 2, 3]),
      status: "applied",
      error: null,
      createdAtMs: "1",
      updatedAtMs: "2"
    })
  }).database()).getRoutedOperation("op_bytes")).requestHash,
  [1, 2, 3]
);
assert.equal((await customMetadataDatabase.placement())?.shardId, "shard_1");
assert.equal((await customMetadataDatabase.listMembers())[0]?.principal, "aaaaa-aa");
const customMetadataStatus = await customMetadataDatabase.status();
assert.equal(customMetadataStatus.databaseId, "db_meta");
assert.equal(customMetadataStatus.placement?.canisterId, null);
assert.equal(customMetadataStatus.tableStatuses[0]?.columns[1], "body");
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, getUsage: async () => ({ databaseId: "db", status: "bad", logicalSizeBytes: "1", maxLogicalSizeBytes: "2", usageEventCount: "3" }) }).database()).getUsage(),
  /database status must be hot, restoring, archiving, archived, or deleted/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, listUsageEvents: async () => "bad" }).database()).listUsageEvents(),
  /database usage events must be an array/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, getRoutedOperation: async () => ({ operationId: "op", databaseId: "db", databaseCanisterId: "canister", method: "sql_execute", requestHash: "bad", status: "applied", error: null, createdAtMs: "1", updatedAtMs: "2" }) }).database()).getRoutedOperation("op"),
  /routed operation requestHash must be a byte array/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, listMembers: async () => [{ databaseId: "db", principal: "aaaaa-aa", role: "admin", createdAtMs: "1" }] }).database()).listMembers(),
  /database role must be reader, writer, or owner/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, placement: async () => ({ databaseId: "db", shardId: "shard", canisterId: null, mountId: -1, status: "hot", schemaVersion: "1", createdAtMs: "1", updatedAtMs: "2" }) }).database()).placement(),
  /database shard placement mountId must be a non-negative safe integer/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, status: async () => ({ databaseId: "db", connectionUrl: "icpdb://aaaaa-aa/db", placement: null, usage: { databaseId: "db", status: "hot", logicalSizeBytes: "1", maxLogicalSizeBytes: "2", usageEventCount: "3" }, stats: { tableCount: 1, viewCount: 0, rowCount: "1", columnCount: 1, indexCount: 0, triggerCount: 0, foreignKeyCount: 0 }, tableStatuses: [{ tableName: "notes", objectType: "index", rowCount: "1", columnCount: 1, columns: ["id"], indexCount: 0, triggerCount: 0, foreignKeyCount: 0 }] }) }).database()).status(),
  /database table status objectType must be table or view/
);
const customSourceOutputTransactionCalls = [];
const customSourceOutputDatabase = await createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse([" value "], [[{ kind: "integer", value: "7" }]], "0", "0"),
  execute: async () => sqlResponse([], [], "1", "42"),
  batch: async () => [sqlResponse([], [], "1", "42")],
  transaction: async (statements, options) => {
    customSourceOutputTransactionCalls.push({ statements, options });
    return [sqlResponse([], [], "1", "42")];
  },
  executeScript: async () => [sqlResponse([], [], "1", "42")],
  loadSqlDump: async () => [sqlResponse([], [], "1", "42")],
  migrate: async (input) => Array.isArray(input) && input[0]?.version !== undefined
    ? { applied: [" 001 "], skipped: [" 000 "] }
    : [{
      columns: [],
      columnTypes: [],
      rows: [],
      rowsAffected: 1,
      affectedRows: 1,
      changes: 1,
      lastInsertRowid: 42n,
      lastInsertRowId: 42n,
      truncated: false,
      routedOperationId: null,
      raw: sqlResponse([], [], "1", "42"),
      toJSON: () => ({ columns: [], columnTypes: [], rows: [], rowsAffected: 1, affectedRows: 1, changes: 1, lastInsertRowid: "42", lastInsertRowId: "42", truncated: false, routedOperationId: null, raw: sqlResponse([], [], "1", "42") })
    }]
}).database();
assert.deepEqual(await customSourceOutputDatabase.query("SELECT 7"), sqlResponse([" value "], [[{ kind: "integer", value: "7" }]], "0", "0"));
assert.equal((await customSourceOutputDatabase.execute("INSERT INTO notes(id) VALUES (1)")).rowsAffected, "1");
assert.equal((await customSourceOutputDatabase.batch(["INSERT INTO notes(id) VALUES (1)"], "write"))[0]?.lastInsertRowId, "42");
assert.equal((await customSourceOutputDatabase.transaction([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 42 } }], { mode: "write", idempotencyKey: "custom_tx" }))[0]?.lastInsertRowId, "42");
assert.deepEqual(customSourceOutputTransactionCalls.at(-1), {
  statements: [{ sql: "INSERT INTO notes(id) VALUES (:id)", params: [42] }],
  options: { idempotencyKey: "custom_tx", mode: "write" }
});
assert.equal((await customSourceOutputDatabase.executeScript("INSERT INTO notes(id) VALUES (1);"))[0]?.rowsAffected, "1");
assert.equal((await customSourceOutputDatabase.loadSqlDump("INSERT INTO notes(id) VALUES (1);"))[0]?.rowsAffected, "1");
assert.deepEqual(await customSourceOutputDatabase.migrate([{ version: "001", sql: "CREATE TABLE output_check(id INTEGER)" }]), {
  applied: ["001"],
  skipped: ["000"]
});
assert.equal((await customSourceOutputDatabase.migrate(["CREATE TABLE output_check_2(id INTEGER)"]))[0]?.changes, 1);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, query: async () => ({ ...sqlResponse(["id"], [[{ kind: "integer", value: "1" }]], "-1", "0") }) }).database()).query("SELECT id FROM notes"),
  /rowsAffected must be a non-negative integer/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, execute: async () => ({ ...sqlResponse([], [], "1", "bad") }) }).database()).execute("INSERT INTO notes(id) VALUES (1)"),
  /lastInsertRowid must be an integer/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, batch: async () => "bad" }).database()).batch(["INSERT INTO notes(id) VALUES (1)"], "write"),
  /SQL result list must be an array/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, transaction: async () => "bad" }).database()).transaction(["INSERT INTO notes(id) VALUES (1)"], "write"),
  /SQL result list must be an array/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, executeScript: async () => [{ ...sqlResponse(["id"], [[{ kind: "unknown", value: "1" }]], "0", "0") }] }).database()).executeScript("SELECT id FROM notes;", { mode: "read" }),
  /SQL result value kind must be null, integer, real, text, or blob/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, loadSqlDump: async () => [{ ...sqlResponse([], [], "1", "1"), truncated: "no" }] }).database()).loadSqlDump("INSERT INTO notes(id) VALUES (1);"),
  /SQL result truncated must be a boolean/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, migrate: async () => ({ applied: "bad", skipped: [] }) }).database()).migrate([{ version: "001", sql: "CREATE TABLE bad_migration(id INTEGER)" }]),
  /migration applied versions must be an array/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, migrate: async () => [{ columns: [], columnTypes: ["extra"], rows: [], rowsAffected: 1, affectedRows: 1, changes: 1, lastInsertRowid: undefined, lastInsertRowId: undefined, truncated: false, routedOperationId: null, raw: sqlResponse([], [], "1", "0"), toJSON: () => ({}) }] }).database()).migrate(["CREATE TABLE bad_migration_result(id INTEGER)"]),
  /SQL client result columnTypes length must match columns length/
);
clientDatabase.close();
const tursoLikeClient = createTursoLikeClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_sdk",
  identity: sdkIdentity
});
const libsqlNamedClient = createLibsqlClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_sdk",
  identity: sdkIdentity
});
assert.equal(typeof tursoLikeClient.execute, "function");
assert.equal(typeof tursoLikeClient.batch, "function");
assert.equal(typeof libsqlNamedClient.execute, "function");
assert.equal(typeof libsqlNamedClient.batch, "function");
const readResult = await client.execute({ sql: "SELECT ?1 AS value", args: [7] });
assert.equal(readResult.rows[0].value, "7");
assert.equal(readResult.rows[0][0], "7");
assert.equal(readResult.rows[0].length, 1);
assert.deepEqual(Object.keys(readResult.rows[0]), ["value"]);
assert.deepEqual(readResult.columnTypes, ["integer"]);
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT ?1 AS value", params: [7], maxRows: null }
});
const taggedReadResult = await client.query(sql`SELECT ${7} AS value`);
assert.equal(taggedReadResult.rows[0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT ?1 AS value", params: [7], maxRows: null }
});
await client.query(sql`SELECT ${new Date("2026-05-29T00:00:00.000Z")} AS created_at`);
assert.deepEqual(calls.at(-1).statement, {
  sql: "SELECT ?1 AS created_at",
  params: [new Date("2026-05-29T00:00:00.000Z")],
  maxRows: null
});
await client.query(sql`SELECT ${new Uint8Array([1, 2, 3])} AS payload`);
assert.deepEqual(calls.at(-1).statement, {
  sql: "SELECT ?1 AS payload",
  params: [new Uint8Array([1, 2, 3])],
  maxRows: null
});
await client.execute(sql`INSERT INTO notes(id) VALUES (${12})`);
assert.deepEqual(calls.at(-1).statement, {
  sql: "INSERT INTO notes(id) VALUES (?1)",
  params: [12],
  maxRows: null
});
assert.throws(() => sql`SELECT ${Number.NaN} AS value`, /SQL number bind value must be finite/);
assert.throws(() => sql("SELECT 1"), /sql template must use tagged template syntax/);
const numberIntClient = createClientFromDatabase(fakeDatabase, { intMode: "number" });
const numberIntResult = await numberIntClient.execute("SELECT ?1 AS value", [7]);
assert.equal(numberIntResult.rows[0].value, 7);
assert.equal(numberIntResult.toJSON().rows[0].value, 7);
const bigintIntClient = createTursoLikeClient({
  canisterId: "aaaaa-aa",
  databaseId: "db_sdk",
  identity: sdkIdentity,
  intMode: "bigint"
});
const bigintIntResult = await createClientFromDatabase(fakeDatabase, { intMode: "bigint" }).execute("SELECT ?1 AS value", [7]);
assert.equal(bigintIntResult.rows[0].value, 7n);
assert.equal(bigintIntResult.toJSON().rows[0].value, "7");
assert.equal(bigintIntClient.protocol, "icpdb");
const lengthColumnResult = await client.execute("SELECT 'cell-length' AS length");
assert.equal(lengthColumnResult.rows[0].length, "cell-length");
assert.equal(lengthColumnResult.rows[0][0], "cell-length");
assert.deepEqual(Object.keys(lengthColumnResult.rows[0]), ["length"]);
assert.deepEqual(await client.values("SELECT 'cell-length' AS length"), [["cell-length"]]);
const reservedColumnResult = await client.execute("SELECT 'proto' AS __proto__, 'ctor' AS constructor");
assert.equal(Object.getPrototypeOf(reservedColumnResult.rows[0]), null);
assert.equal(reservedColumnResult.rows[0].__proto__, "proto");
assert.equal(reservedColumnResult.rows[0].constructor, "ctor");
assert.equal(reservedColumnResult.rows[0][0], "proto");
assert.equal(reservedColumnResult.rows[0].length, 2);
assert.deepEqual(Object.keys(reservedColumnResult.rows[0]), ["__proto__", "constructor"]);
assert.equal(Object.getPrototypeOf(reservedColumnResult.toJSON().rows[0]), null);
assert.equal(reservedColumnResult.toJSON().rows[0].__proto__, "proto");
assert.match(JSON.stringify(reservedColumnResult), /"__proto__":"proto"/);
const readIdempotencyCallCount = calls.length;
await assert.rejects(() => client.execute({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => client.query({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => client.query("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
await assert.rejects(() => client.queryRows("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
await assert.rejects(() => client.get("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
assert.equal(calls.length, readIdempotencyCallCount);

const writeResult = await client.execute("INSERT INTO notes(id) VALUES (1)");
assert.equal(writeResult.rowsAffected, 1);
assert.equal(writeResult.affectedRows, 1);
assert.equal(writeResult.changes, 1);
assert.equal(writeResult.lastInsertRowid, 42n);
assert.equal(writeResult.lastInsertRowId, 42n);
assert.deepEqual(writeResult.columnTypes, []);
assert.equal(writeResult.routedOperationId, null);
assert.deepEqual(writeResult.toJSON().affectedRows, 1);
assert.deepEqual(writeResult.toJSON().changes, 1);
assert.deepEqual(writeResult.toJSON().lastInsertRowid, "42");
assert.deepEqual(writeResult.toJSON().lastInsertRowId, "42");
assert.match(JSON.stringify(writeResult), /"lastInsertRowid":"42"/);
assert.match(JSON.stringify(writeResult), /"lastInsertRowId":"42"/);
assert.equal(calls.at(-1).method, "execute");
await client.execute({ sql: "INSERT INTO notes(id) VALUES (?1)", args: [10], idempotencyKey: "sdk_retry_insert_1" });
assert.deepEqual(calls.at(-1).statement, {
  sql: "INSERT INTO notes(id) VALUES (?1)",
  params: [10],
  maxRows: null,
  idempotencyKey: "sdk_retry_insert_1"
});
await client.execute({ sql: "INSERT INTO notes(id) VALUES (?1)", args: [11], idempotencyKey: " sdk_retry_insert_trim " });
assert.deepEqual(calls.at(-1).statement, {
  sql: "INSERT INTO notes(id) VALUES (?1)",
  params: [11],
  maxRows: null,
  idempotencyKey: "sdk_retry_insert_trim"
});

const queryResult = await client.query("WITH values(value) AS (SELECT 1) SELECT value");
assert.equal(queryResult.rows[0].value, "7");
assert.equal(calls.at(-1).method, "query");
const commentedReadResult = await client.execute("-- leading comment\n/* block comment */\nSELECT ?1 AS value", [7]);
assert.equal(commentedReadResult.rows[0].value, "7");
assert.equal(calls.at(-1).method, "query");
const cteReadResult = await client.execute("WITH payload(value) AS (SELECT ?1) SELECT value FROM payload", [7]);
assert.equal(cteReadResult.rows[0].value, "7");
assert.equal(calls.at(-1).method, "query");
const pragmaReadResult = await client.execute("PRAGMA table_info(notes)");
assert.equal(pragmaReadResult.rows[0].value, "7");
assert.equal(calls.at(-1).method, "query");
await client.execute("PRAGMA foreign_keys=off");
assert.equal(calls.at(-1).method, "execute");
await client.execute("PRAGMA main.user_version = 7");
assert.equal(calls.at(-1).method, "execute");
await client.execute("WITH payload(value) AS (SELECT ?1) INSERT INTO notes(id) SELECT value FROM payload", [11]);
assert.equal(calls.at(-1).method, "execute");
const namedQueryResult = await client.query({
  sql: "SELECT :value AS value, ':ignored' AS literal, @value AS again, $token AS token -- :ignored\n/* @ignored */",
  args: { value: 7, token: "ok" }
});
assert.equal(namedQueryResult.rows[0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: {
    sql: "SELECT :value AS value, ':ignored' AS literal, @value AS again, $token AS token -- :ignored\n/* @ignored */",
    params: [7, 7, "ok"],
    maxRows: null
  }
});
await client.query({
  sql: "SELECT :value AS first, :value AS second, @value AS third",
  args: { value: 7 }
});
assert.deepEqual(calls.at(-1).statement.params, [7, 7]);
const namedParamsResult = await client.query({
  sql: "SELECT :value AS value",
  params: { value: 8 }
});
assert.equal(namedParamsResult.rows[0].value, "7");
assert.deepEqual(calls.at(-1).statement.params, [8]);
const blobResult = await client.query({
  sql: "SELECT :payload AS payload",
  args: { payload: new Uint8Array([1, 2, 3]) }
});
assert.equal(blobResult.rows[0].payload instanceof ArrayBuffer, true);
assert.deepEqual(Array.from(new Uint8Array(blobResult.rows[0].payload)), [1, 2, 3]);
assert.deepEqual(blobResult.toJSON().rows[0].payload, [1, 2, 3]);
assert.match(JSON.stringify(blobResult), /"payload":\[1,2,3\]/);
await client.query({
  sql: "SELECT :enabled AS enabled, :disabled AS disabled",
  args: { enabled: true, disabled: false }
});
assert.deepEqual(calls.at(-1).statement.params, [true, false]);
await assert.rejects(
  () => client.query({ sql: "SELECT :value AS value", args: { value: Number.NaN } }),
  /SQL number bind value must be finite/
);
await assert.rejects(
  () => client.query({ sql: "SELECT :value AS value", args: { value: Number.POSITIVE_INFINITY } }),
  /SQL number bind value must be finite/
);
await assert.rejects(
  () => client.query({ sql: "SELECT :value AS value", args: { value: 9007199254740992 } }),
  /integer SQL bind number exceeds JavaScript safe integer range/
);
await client.query({ sql: "SELECT :value AS value", args: { value: { kind: "integer", value: "9007199254740993" } } });
assert.deepEqual(calls.at(-1).statement.params, [{ kind: "integer", value: "9007199254740993" }]);
await client.query({ sql: "SELECT :value AS value", args: { value: { kind: "real", value: 1.5 } } });
assert.deepEqual(calls.at(-1).statement.params, [{ kind: "real", value: 1.5 }]);
await client.query({ sql: "SELECT :value AS value", args: { value: { kind: "text", value: "typed" } } });
assert.deepEqual(calls.at(-1).statement.params, [{ kind: "text", value: "typed" }]);
await client.query({ sql: "SELECT :value AS value", args: { value: { kind: "blob", value: [1, 2, 3] } } });
assert.deepEqual(calls.at(-1).statement.params, [{ kind: "blob", value: [1, 2, 3] }]);
await client.query({ sql: "SELECT :value AS value", args: { value: { kind: "null" } } });
assert.deepEqual(calls.at(-1).statement.params, [{ kind: "null" }]);
await assert.rejects(
  () => client.query({ sql: "SELECT :value AS value", args: { value: { kind: "integer", value: "1.5" } } }),
  /SQL integer bind value must be a base-10 integer string/
);
await assert.rejects(
  () => client.query({ sql: "SELECT :value AS value", args: { value: { kind: "real", value: Number.NaN } } }),
  /SQL real bind value must be a finite number/
);
await assert.rejects(
  () => client.query({ sql: "SELECT :value AS value", args: { value: { kind: "blob", value: [256] } } }),
  /blob bytes must be integers from 0 to 255/
);
await assert.rejects(
  () => client.query({ sql: "SELECT :value AS value", args: { value: { kind: "json", value: "{}" } } }),
  /SqlValue object kind must be null, integer, real, text, or blob/
);
await client.query({
  sql: "SELECT :created_at AS created_at",
  args: { created_at: new Date("2026-05-29T00:00:00.000Z") }
});
assert.equal(calls.at(-1).statement.params[0].toISOString(), "2026-05-29T00:00:00.000Z");
const positionalParamsResult = await client.queryRows({ sql: "SELECT ?1 AS value", params: [9] });
assert.equal(positionalParamsResult[0]?.value, "7");
assert.deepEqual(calls.at(-1).statement.params, [9]);
await client.query("SELECT :value AS value", { ":value": 7 });
assert.deepEqual(calls.at(-1).statement.params, [7]);
await assert.rejects(() => client.query("SELECT :missing AS value", { value: 7 }), /missing SQL named arg: missing/);
await assert.rejects(() => client.query("SELECT 1", { value: 7 }), /named SQL args require named placeholders/);
const statementDatabaseIdCallCount = calls.length;
await assert.rejects(() => client.execute({ sql: "SELECT 1", databaseId: "db_other" }), /SQL client statement databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.query({ sql: "SELECT 1", databaseId: "db_other" }), /SQL client statement databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.run({ sql: "INSERT INTO notes(id) VALUES (18)", databaseId: "db_other" }), /SQL client statement databaseId is not supported; choose database at the client or database handle/);
assert.equal(calls.length, statementDatabaseIdCallCount);
const queryRows = await client.queryRows({ sql: "SELECT ?1 AS value", args: [7] });
assert.equal(queryRows[0].value, "7");
const queryOne = await client.queryOne("SELECT ?1 AS value", [7]);
assert.equal(queryOne?.value, "7");
assert.equal((await client.all("SELECT ?1 AS value", [7]))[0]?.value, "7");
assert.equal((await client.get("SELECT ?1 AS value", [7]))?.value, "7");
assert.equal((await client.get(["SELECT ?1 AS value", [7]]))?.value, "7");
assert.deepEqual(await client.values("SELECT ?1 AS value, ?2 AS label", [7, "seven"]), [["7", "seven"]]);
assert.equal((await client.first("SELECT ?1 AS value", [7]))?.value, "7");
assert.equal(await client.firstValue("SELECT ?1 AS value", [7]), "7");
assert.equal(await client.scalar("SELECT ?1 AS value", [7]), "7");
assert.equal(calls.at(-1).statement.params[0], 7);
assert.equal((await client.run("INSERT INTO notes(id) VALUES (?1)", [8])).rowsAffected, 1);
assert.equal(calls.at(-1).method, "execute");
assert.equal((await client.run(["INSERT INTO notes(id) VALUES (?1)", [9]])).rowsAffected, 1);
assert.deepEqual(calls.at(-1).statement.params, [9]);
const preparedSelect = client.prepare("SELECT ?1 AS value");
assert.equal(preparedSelect.sql, "SELECT ?1 AS value");
assert.equal((await preparedSelect.query([7])).rows[0].value, "7");
assert.equal((await preparedSelect.execute([7])).rows[0].value, "7");
assert.equal((await preparedSelect.queryRows([7]))[0].value, "7");
assert.equal((await preparedSelect.queryOne([7]))?.value, "7");
assert.equal((await preparedSelect.all([7]))[0].value, "7");
assert.equal((await preparedSelect.get([7]))?.value, "7");
assert.deepEqual(await preparedSelect.values([7]), [["7"]]);
assert.equal((await preparedSelect.first([7]))?.value, "7");
assert.equal(await preparedSelect.firstValue([7]), "7");
assert.equal(await preparedSelect.scalar([7]), "7");
assert.equal((await preparedSelect.bind([7]).all())[0].value, "7");
assert.deepEqual(calls.at(-1).statement.params, [7]);
assert.equal((await client.prepare("SELECT ?1 AS value", [7]).get())?.value, "7");
assert.deepEqual(calls.at(-1).statement.params, [7]);
assert.equal((await client.prepare(sql`SELECT ${7} AS value`).get())?.value, "7");
assert.deepEqual(calls.at(-1).statement.params, [7]);
assert.equal((await client.prepare({ sql: "SELECT :value AS value", params: { value: 7 } }).get())?.value, "7");
assert.deepEqual(calls.at(-1).statement.params, [7]);
assert.equal((await client.prepare(["SELECT ?1 AS value", [7]]).get())?.value, "7");
assert.deepEqual(calls.at(-1).statement.params, [7]);
assert.throws(() => client.prepare({ sql: "SELECT 1", idempotencyKey: "statement_retry" }), /prepared statement idempotencyKey is not supported/);
assert.throws(() => client.prepare({ sql: "SELECT 1", maxRows: 1 }), /prepared statement maxRows is not supported/);
assert.throws(() => client.prepare({ sql: "SELECT 1", databaseId: "db_other" }), /prepared statement databaseId is not supported/);
const preparedInsert = client.prepare("INSERT INTO notes(id) VALUES (?1)");
assert.equal((await preparedInsert.run([8])).rowsAffected, 1);
assert.equal(calls.at(-1).method, "execute");
assert.equal((await preparedInsert.bind([8]).run()).rowsAffected, 1);
assert.equal(calls.at(-1).method, "execute");
const preparedNamed = client.prepare("SELECT :value AS value");
assert.equal((await preparedNamed.get({ value: 7 }))?.value, "7");
assert.equal((await preparedNamed.bind({ value: 7 }).get())?.value, "7");

const batchResult = await client.batch([
  { sql: "INSERT INTO notes(id) VALUES (?1)", args: [2] },
  "SELECT count(*) AS total FROM notes"
], "write");
assert.equal(batchResult[1].rows[0].total, "2");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "INSERT INTO notes(id) VALUES (?1)", params: [2] },
    { sql: "SELECT count(*) AS total FROM notes", params: [] }
  ],
  options: "write"
});
await client.batch([
  { sql: "INSERT INTO notes(id) VALUES (?1)", params: [3] },
  "SELECT count(*) AS total FROM notes"
], "write");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "INSERT INTO notes(id) VALUES (?1)", params: [3] },
    { sql: "SELECT count(*) AS total FROM notes", params: [] }
  ],
  options: "write"
});
await client.batch([
  sql`INSERT INTO notes(id) VALUES (${14})`,
  sql`SELECT count(*) AS total FROM notes`
], "write");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "INSERT INTO notes(id) VALUES (?1)", params: [14] },
    { sql: "SELECT count(*) AS total FROM notes", params: [] }
  ],
  options: "write"
});
await client.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [13] }], "deferred");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [{ sql: "INSERT INTO notes(id) VALUES (?1)", params: [13] }],
  options: "deferred"
});
await client.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [6] }], { idempotencyKey: "sdk_retry_batch_1" });
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [{ sql: "INSERT INTO notes(id) VALUES (?1)", params: [6] }],
  options: { idempotencyKey: "sdk_retry_batch_1" }
});
await client.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [12] }], { mode: "write", idempotencyKey: "sdk_retry_batch_mode_1" });
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [{ sql: "INSERT INTO notes(id) VALUES (?1)", params: [12] }],
  options: { idempotencyKey: "sdk_retry_batch_mode_1", mode: "write" }
});
await client.batch(["SELECT count(*) AS total FROM notes"], "read");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: null }
});
await client.batch(["SELECT count(*) AS total FROM notes"], { mode: "read", maxRows: 1 });
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: 1 }
});
await assert.rejects(() => client.batch(["SELECT count(*) AS total FROM notes"], { mode: "read", maxRows: 0 }), /maxRows must be an integer from 1 to 500/);
await assert.rejects(() => client.batch(["SELECT count(*) AS total FROM notes"], { mode: "read", maxRows: 501 }), /maxRows must be an integer from 1 to 500/);
const readBatchOptionCallCount = calls.length;
await assert.rejects(() => client.batch(["SELECT count(*) AS total FROM notes"], { mode: "read", databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.batch(["INSERT INTO notes(id) VALUES (19)"], { mode: "write", databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.transaction(["INSERT INTO notes(id) VALUES (20)"], { mode: "write", databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.exec("INSERT INTO notes(id) VALUES (21)", { databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.executeScript("INSERT INTO notes(id) VALUES (22)", { databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.loadSqlDump("INSERT INTO notes(id) VALUES (23)", { databaseId: "db_other" }), /SQL client batch option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.batch(["SELECT count(*) AS total FROM notes"], { mode: "read", idempotencyKey: "read_retry" }), /read batch mode does not accept idempotencyKey/);
await assert.rejects(() => client.transaction([["SELECT count(*) AS total FROM notes"]], { mode: "read", idempotencyKey: "read_retry_tx" }), /read batch mode does not accept idempotencyKey/);
await assert.rejects(() => client.batch([{ sql: "INSERT INTO notes(id) VALUES (14)", idempotencyKey: "statement_retry" }], "write"), /batch statement idempotencyKey is not supported; use batch option idempotencyKey/);
await assert.rejects(() => client.transaction([{ sql: "INSERT INTO notes(id) VALUES (15)", idempotencyKey: "statement_retry" }], "write"), /batch statement idempotencyKey is not supported; use batch option idempotencyKey/);
await assert.rejects(() => client.batch([{ sql: "SELECT count(*) AS total FROM notes", maxRows: 1 }], "read"), /batch statement maxRows is not supported; use batch option maxRows/);
await assert.rejects(() => client.transaction([{ sql: "SELECT count(*) AS total FROM notes", maxRows: 1 }], "read"), /batch statement maxRows is not supported; use batch option maxRows/);
await assert.rejects(() => client.batch([{ sql: "INSERT INTO notes(id) VALUES (16)", databaseId: "db_other" }], "write"), /batch statement databaseId is not supported; choose database at the client or batch option/);
await assert.rejects(() => client.transaction([{ sql: "INSERT INTO notes(id) VALUES (17)", databaseId: "db_other" }], "write"), /batch statement databaseId is not supported; choose database at the client or batch option/);
assert.equal(calls.length, readBatchOptionCallCount);
await client.batch(["-- comment\n/* block */\nSELECT count(*) AS total FROM notes"], "read");
assert.equal(calls.at(-1).method, "query");
await client.batch(["WITH payload(value) AS (SELECT 1) SELECT value FROM payload"], "read");
assert.equal(calls.at(-1).method, "query");
await client.batch(["PRAGMA table_info(notes)"], "read");
assert.equal(calls.at(-1).method, "query");
await assert.rejects(
  () => client.batch(["SELECT 1", "INSERT INTO notes(id) VALUES (3)"], "read"),
  (error) => error instanceof LibsqlBatchError && error.code === "SQLITE_READONLY" && error.statementIndex === 1
);
await assert.rejects(() => client.batch(["INSERT INTO notes(id) VALUES (3)"], { mode: "read" }), /read batch mode only accepts read SQL/);
await assert.rejects(() => client.batch(["WITH payload(value) AS (SELECT 3) INSERT INTO notes(id) SELECT value FROM payload"], "read"), /read batch mode only accepts read SQL/);
await assert.rejects(() => client.batch(["PRAGMA foreign_keys=off"], "read"), /read batch mode only accepts read SQL/);
await assert.rejects(() => client.batch(["SELECT 1"], "invalid"), /batch mode must be read, write, or deferred/);
await assert.rejects(() => client.batch(["SELECT 1"], { mode: "invalid" }), /batch mode must be read, write, or deferred/);
await client.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: 1 }
});
await client.exec("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: 1 }
});
const readDumpResult = await client.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
assert.equal(readDumpResult[0].rows[0].value, "7");
assert.deepEqual(calls.at(-1), {
  method: "query",
  statement: { sql: "SELECT count(*) AS total FROM notes", params: [], maxRows: 1 }
});
await assert.rejects(() => client.executeScript("INSERT INTO notes(id) VALUES (31);", { mode: "read" }), /read batch mode only accepts read SQL/);
await assert.rejects(() => client.executeScript("SELECT 1;", { mode: "read", idempotencyKey: "read_script_retry" }), /read batch mode does not accept idempotencyKey/);
await assert.rejects(() => client.loadSqlDump("INSERT INTO notes(id) VALUES (32);", { mode: "read" }), /read batch mode only accepts read SQL/);
await client.batch([
  ["INSERT INTO notes(id) VALUES (?1)", [4]],
  ["SELECT count(*) AS total FROM notes"]
], "write");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "INSERT INTO notes(id) VALUES (?1)", params: [4] },
    { sql: "SELECT count(*) AS total FROM notes", params: [] }
  ],
  options: "write"
});
const transactionResult = await client.transaction([
  { sql: "INSERT INTO notes(id) VALUES (?1)", args: [5] },
  ["SELECT count(*) AS total FROM notes"]
], { mode: "write", maxRows: 5 });
assert.equal(transactionResult[1].rows[0].total, "2");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "INSERT INTO notes(id) VALUES (?1)", params: [5] },
    { sql: "SELECT count(*) AS total FROM notes", params: [] }
  ],
  options: { maxRows: 5, mode: "write" }
});
await client.transaction([["SELECT count(*) AS total FROM notes"]], "read");
assert.equal(calls.at(-1).method, "query");
await assert.rejects(() => client.transaction(["INSERT INTO notes(id) VALUES (6)"], "read"), /read batch mode only accepts read SQL/);
const emptyBatchCallCount = calls.length;
await assert.rejects(() => client.batch([]), /batch requires at least one SQL statement/);
await assert.rejects(() => client.batch(null), /batch statements must be an array/);
await assert.rejects(() => client.transaction([]), /transaction requires at least one SQL statement/);
assert.equal(calls.length, emptyBatchCallCount);

const scriptResult = await client.executeScript(`
  CREATE TABLE script_notes(id INTEGER PRIMARY KEY, body TEXT);
  INSERT INTO script_notes(body) VALUES ('semi;colon');
`, { maxRows: 10, idempotencyKey: "sdk_retry_script_1" });
assert.equal(scriptResult.length, 2);
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "CREATE TABLE script_notes(id INTEGER PRIMARY KEY, body TEXT)", params: [] },
    { sql: "INSERT INTO script_notes(body) VALUES ('semi;colon')", params: [] }
  ],
  options: { maxRows: 10, idempotencyKey: "sdk_retry_script_1" }
});
const chunkedScriptCallsBefore = calls.length;
const chunkedScriptSql = Array.from({ length: 33 }, (_, index) => `INSERT INTO script_notes(id, body) VALUES (${100 + index}, 'chunk-${index}')`).join(";");
await client.executeScript(chunkedScriptSql, { idempotencyKey: "sdk_retry_chunked_script" });
const chunkedScriptCalls = calls.slice(chunkedScriptCallsBefore);
assert.equal(chunkedScriptCalls.length, 2);
assert.deepEqual(chunkedScriptCalls.map((call) => call.options?.idempotencyKey), [
  "sdk_retry_chunked_script:chunk:1:of:2",
  "sdk_retry_chunked_script:chunk:2:of:2"
]);
await client.executeScript("CREATE TABLE `script;quoted`(id INTEGER); INSERT INTO `script;quoted`(id) VALUES (1);");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "CREATE TABLE `script;quoted`(id INTEGER)", params: [] },
    { sql: "INSERT INTO `script;quoted`(id) VALUES (1)", params: [] }
  ],
  options: undefined
});
await client.executeScript("CREATE TABLE [script;bracketed](id INTEGER); INSERT INTO [script;bracketed](id) VALUES (1);");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "CREATE TABLE [script;bracketed](id INTEGER)", params: [] },
    { sql: "INSERT INTO [script;bracketed](id) VALUES (1)", params: [] }
  ],
  options: undefined
});
await client.executeScript("-- trigger setup\nCREATE TRIGGER script_comment_guard BEFORE INSERT ON script_notes BEGIN SELECT 1; END;");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "-- trigger setup\nCREATE TRIGGER script_comment_guard BEFORE INSERT ON script_notes BEGIN SELECT 1; END", params: [] }
  ],
  options: undefined
});
await client.executeScript("CREATE TEMP TRIGGER temp_script_guard BEFORE INSERT ON script_notes BEGIN SELECT 1; END;");
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "CREATE TEMP TRIGGER temp_script_guard BEFORE INSERT ON script_notes BEGIN SELECT 1; END", params: [] }
  ],
  options: undefined
});
await client.executeMultiple(`
  CREATE TABLE multiple_notes(id INTEGER PRIMARY KEY, body TEXT);
  INSERT INTO multiple_notes(body) VALUES ('from-multiple');
`);
assert.deepEqual(calls.slice(-2), [
  { method: "execute", statement: { sql: "CREATE TABLE multiple_notes(id INTEGER PRIMARY KEY, body TEXT)", params: [] } },
  { method: "execute", statement: { sql: "INSERT INTO multiple_notes(body) VALUES ('from-multiple')", params: [] } }
]);
await client.executeMultiple("INSERT INTO multiple_notes(body) VALUES ('from-multiple-retry');", {
  idempotencyKey: " sdk_retry_multiple_1 ",
  mode: "write"
});
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "INSERT INTO multiple_notes(body) VALUES ('from-multiple-retry')", params: [] }
  ],
  options: { idempotencyKey: "sdk_retry_multiple_1", mode: "write" }
});
await client.exec(`
  CREATE TABLE exec_notes(id INTEGER PRIMARY KEY, body TEXT);
  INSERT INTO exec_notes(body) VALUES ('from-exec');
`, { maxRows: 4, idempotencyKey: "sdk_retry_exec_1" });
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "CREATE TABLE exec_notes(id INTEGER PRIMARY KEY, body TEXT)", params: [] },
    { sql: "INSERT INTO exec_notes(body) VALUES ('from-exec')", params: [] }
  ],
  options: { maxRows: 4, idempotencyKey: "sdk_retry_exec_1" }
});

assert.match(await client.schema("notes"), /CREATE TABLE notes/);
assert.equal((await client.listTables())[0]?.name, "notes");
assert.equal((await client.tables())[0]?.name, "notes");
assert.deepEqual((await client.views()).map((table) => table.name), ["notes_view"]);
assert.equal((await client.describeTable("notes")).tableName, "notes");
assert.equal((await client.describe("notes")).tableName, "notes");
assert.equal((await client.describe(" notes ")).tableName, "notes");
assert.deepEqual(calls.at(-1), { method: "describeTable", tableName: "notes" });
assert.equal((await client.listColumns("notes"))[1]?.name, "body");
assert.equal((await client.columns("notes"))[1]?.name, "body");
assert.equal((await client.listIndexes("notes"))[0]?.name, "idx_notes_body");
assert.equal((await client.indexes("notes"))[0]?.name, "idx_notes_body");
assert.equal((await client.listTriggers("notes"))[0]?.name, "trg_notes");
assert.equal((await client.triggers("notes"))[0]?.name, "trg_notes");
assert.deepEqual(await client.listForeignKeys("notes"), []);
assert.deepEqual(await client.foreignKeys("notes"), []);
assert.equal((await client.previewTable("notes", { limit: 10 })).rows[0]?.[1]?.value, "quote ' semi; blob");
assert.equal((await client.preview("notes", { limit: 10 })).rows[0]?.[1]?.value, "quote ' semi; blob");
await assert.rejects(() => client.previewTable("notes", { limit: 0 }), /preview limit must be an integer from 1 to 500/);
await assert.rejects(() => client.previewTable("notes", { offset: -1 }), /preview offset must be an integer from 0 to 4294967295/);
await assert.rejects(() => client.previewTable("notes", { databaseId: "db_other" }), /database preview option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.preview("notes", { databaseId: "db_other" }), /database preview option databaseId is not supported; choose database at the client or database handle/);
await assert.rejects(() => client.inspect({ databaseId: "db_other" }), /database inspect option databaseId is not supported; choose database at the client, low-level inspect argument, or database handle/);
await assert.rejects(() => client.describeTable("   "), /tableName must be a non-empty string/);
await assert.rejects(() => client.describe("   "), /tableName must be a non-empty string/);
await assert.rejects(() => client.listColumns("   "), /tableName must be a non-empty string/);
await assert.rejects(() => client.columns("   "), /tableName must be a non-empty string/);
await assert.rejects(() => client.previewTable("   "), /tableName must be a non-empty string/);
await assert.rejects(() => client.schema("   "), /tableName must be a non-empty string/);
const inspection = await client.inspect({ tableName: "notes", previewLimit: 1, previewOffset: 0 });
assert.equal(inspection.databaseId, "db_sdk");
assert.match(inspection.schema, /CREATE TABLE notes/);
assert.equal(inspection.tables[0]?.table.name, "notes");
assert.equal(inspection.tables[0]?.description.tableName, "notes");
assert.equal(inspection.tables[0]?.preview.rows[0]?.[1]?.value, "quote ' semi; blob");
await assert.rejects(() => client.inspect({ tableName: "   " }), /tableName must be a non-empty string/);
await assert.rejects(() => client.inspect({ tableName: "notes", previewLimit: 501 }), /previewLimit must be an integer from 1 to 500/);
await assert.rejects(() => client.dumpSql({ pageSize: 0 }), /dump pageSize must be an integer from 1 to 500/);
await assert.rejects(() => client.dumpSql({ tableName: "   " }), /tableName must be a non-empty string/);
await assert.rejects(() => client.dumpSql({ databaseId: "db_other" }), /database dump option databaseId is not supported; choose database at the client, low-level dump argument, or database handle/);
await assert.rejects(async () => client.waitForRoutedOperation("op_wait", { databaseId: "db_other" }), /database wait option databaseId is not supported; choose database at the client, low-level wait argument, or database handle/);
assert.equal((await client.getUsage()).databaseId, "db_sdk");
assert.equal((await client.listUsageEvents())[0]?.method, "sql_query");
assert.equal((await client.getRoutedOperation("op_1")).status, "unknown");
assert.deepEqual(calls.at(-1), { method: "getRoutedOperation", operationId: "op_1" });
assert.equal((await client.reconcileRoutedOperation("op_1")).status, "applied");
assert.deepEqual(calls.at(-1), { method: "reconcileRoutedOperation", operationId: "op_1" });
assert.equal((await client.waitForRoutedOperation("op_wait", { intervalMs: 0, timeoutMs: 1000 })).status, "applied");
assert.equal(waitOperationPolls, 2);
assert.equal((await client.waitForRoutedOperation("op_unknown", { intervalMs: 0, timeoutMs: 1000, reconcileUnknown: true })).status, "applied");
assert.deepEqual(calls.at(-1), { method: "reconcileRoutedOperation", operationId: "op_unknown" });
await assert.rejects(() => client.getRoutedOperation("   "), /operationId must be a non-empty string/);
await assert.rejects(() => client.reconcileRoutedOperation("   "), /operationId must be a non-empty string/);
await assert.rejects(() => client.waitForRoutedOperation("   "), /operationId must be a non-empty string/);
assert.equal((await client.placement())?.databaseId, "db_sdk");
const status = await client.status();
assert.equal(status.databaseId, "db_sdk");
assert.equal(status.connectionUrl, "icpdb://aaaaa-aa/db_sdk");
assert.equal(status.callerPrincipal, "aaaaa-aa");
assert.equal(status.usage.logicalSizeBytes, "128");
assert.equal(status.placement?.shardId, "local");
assert.deepEqual(status.stats, {
  tableCount: 1,
  viewCount: 1,
  rowCount: "2",
  columnCount: 6,
  indexCount: 1,
  triggerCount: 1,
  foreignKeyCount: 0
});
assert.deepEqual(status.tableStatuses[0], {
  tableName: "notes",
  objectType: "table",
  rowCount: "1",
  columnCount: 3,
  columns: ["id", "body", "body_len"],
  indexCount: 1,
  triggerCount: 1,
  foreignKeyCount: 0
});
const delegatedStatusClient = createClientFromDatabase({
  ...fakeDatabase,
  status: async () => ({ ...status, callerRole: "writer" })
}, { principal: () => "aaaaa-aa" });
assert.equal((await delegatedStatusClient.status()).callerRole, "writer");
await client.grantMember(" rrkah-fqaaa-aaaaa-aaaaq-cai ", "writer");
assert.deepEqual(calls.at(-1), { method: "grantMember", principal: "rrkah-fqaaa-aaaaa-aaaaq-cai", role: "writer" });
const grantCallCount = calls.length;
await assert.rejects(() => client.grantMember("", "reader"), /database member principal must be a non-empty string/);
assert.equal(calls.length, grantCallCount);
await assert.rejects(() => client.grantMember("   ", "reader"), /database member principal must be a non-empty string/);
assert.equal(calls.length, grantCallCount);
await assert.rejects(() => client.grantMember("not-principal", "reader"), /database member principal must be a valid principal/);
assert.equal(calls.length, grantCallCount);
await assert.rejects(() => client.grantMember("2vxsx-fae", "reader"), /anonymous principal cannot be granted database access/);
assert.equal(calls.length, grantCallCount);
await assert.rejects(() => client.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "admin"), /database role must be reader, writer, or owner/);
assert.equal(calls.length, grantCallCount);
assert.equal((await client.listMembers())[0]?.role, "owner");
assert.deepEqual(calls.at(-1), { method: "listMembers" });
await client.revokeMember(" rrkah-fqaaa-aaaaa-aaaaq-cai ");
assert.deepEqual(calls.at(-1), { method: "revokeMember", principal: "rrkah-fqaaa-aaaaa-aaaaq-cai" });
const revokeCallCount = calls.length;
await assert.rejects(() => client.revokeMember(""), /database member principal must be a non-empty string/);
assert.equal(calls.length, revokeCallCount);
await assert.rejects(() => client.revokeMember("not-principal"), /database member principal must be a valid principal/);
assert.equal(calls.length, revokeCallCount);
await assert.rejects(() => client.execute({ sql: "SELECT 1", args: [1], params: [1] }), /use either args or params/);
await assert.rejects(() => client.execute({ sql: "SELECT ?1", args: [1] }, [2]), /use either statement args or call args/);
await assert.rejects(() => client.execute(["SELECT ?1", [1]], [2]), /use either tuple args or call args/);
await assert.rejects(() => client.execute(["SELECT ?1", [1], [2]]), /SQL statement tuple must be \[sql, args\?\]/);
await assert.rejects(() => client.execute([1, [2]]), /SQL statement tuple SQL must be a string/);
await assert.rejects(() => client.execute(null), /SQL statement must be a string, \[sql, args\?\] tuple, or \{ sql, args\? \} object/);
await assert.rejects(() => client.batch([null], "write"), /SQL statement must be a string, \[sql, args\?\] tuple, or \{ sql, args\? \} object/);
await assert.rejects(() => client.execute({ sql: "INSERT", idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
await assert.rejects(() => client.execute("   "), /SQL statement SQL must be a non-empty string/);
await assert.rejects(() => client.execute({ sql: 1 }), /SQL statement SQL must be a string/);
await assert.rejects(() => client.execute({ sql: " " }), /SQL statement SQL must be a non-empty string/);
assert.throws(() => client.prepare(" "), /SQL statement SQL must be a non-empty string/);
await assert.rejects(() => client.batch([" "], "read"), /SQL statement SQL must be a non-empty string/);
await assert.rejects(() => client.batch([{ sql: 1 }], "write"), /SQL statement SQL must be a string/);
await assert.rejects(() => client.batch(["INSERT"], { idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
await assert.rejects(() => client.execute(["SELECT ?1", 1]), /SQL statement tuple args must be an array or named object/);
await assert.rejects(() => client.execute(["SELECT ?1", new Date("2026-05-29T00:00:00.000Z")]), /SQL statement tuple args must be an array or named object/);
await assert.rejects(() => client.execute(["SELECT ?1", new Uint8Array([1])]), /SQL statement tuple args must be an array or named object/);
await assert.rejects(() => client.execute("SELECT ?1", new Date("2026-05-29T00:00:00.000Z")), /SQL args must be an array or named object/);
await assert.rejects(() => client.query({ sql: "SELECT 1", maxRows: 0 }), /maxRows must be an integer from 1 to 500/);
await assert.rejects(() => client.query({ sql: "SELECT 1", maxRows: 1.5 }), /maxRows must be an integer from 1 to 500/);
await assert.rejects(() => client.executeScript("  ;  "), /script requires/);
await assert.rejects(() => client.executeMultiple("  ;  "), /script requires/);
await assert.rejects(() => client.exec("  ;  "), /script requires/);
await assert.rejects(() => client.executeScript("SELECT 1", { maxRows: Number.NaN }), /maxRows must be an integer from 1 to 500/);
await assert.rejects(() => client.executeScript("INSERT", { idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
const migrationResult = await client.migrate([
  { version: "000", sql: "CREATE TABLE already_applied(id INTEGER)" },
  {
    version: "001",
    name: "create_migrated_notes",
    sql: "CREATE TABLE migrated_notes(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO migrated_notes(body) VALUES ('from-migration');"
  }
]);
assert.deepEqual(migrationResult, { applied: ["001"], skipped: ["000"] });
assert.equal(migrationTableExists, true);
assert.deepEqual(calls.at(-1).statements.map((statement) => statement.sql), [
  "CREATE TABLE migrated_notes(id INTEGER PRIMARY KEY, body TEXT)",
  "INSERT INTO migrated_notes(body) VALUES ('from-migration')",
  "INSERT INTO icpdb_schema_migrations(version, name, applied_at_ms) VALUES (?1, ?2, ?3)"
]);
assert.deepEqual(calls.at(-1).statements.at(-1).params.slice(0, 2), ["001", "create_migrated_notes"]);
assert.deepEqual(await client.migrate([{ version: "001", sql: "CREATE TABLE skipped(id INTEGER)" }]), { applied: [], skipped: ["001"] });
await assert.rejects(() => client.migrate([{ version: "002", sql: "  ;  " }]), /migration 002 has no SQL statements/);
await assert.rejects(() => client.migrate([{ version: "3", sql: "SELECT 1" }, { version: 3, sql: "SELECT 2" }]), /duplicate migration version: 3/);
await assert.rejects(() => client.migrate(null), /migrate input must be an array/);
await assert.rejects(() => client.migrate({ version: "004", sql: "SELECT 1" }), /migrate input must be an array/);
await assert.rejects(() => client.migrate([{ version: undefined, sql: "SELECT 1" }]), /migration version is required/);
await assert.rejects(() => client.migrate([{ version: "004", name: 1, sql: "SELECT 1" }]), /migration name must be a string/);
await assert.rejects(() => client.migrate([{ version: "004", sql: 1 }]), /migration SQL must be a string/);
await assert.rejects(() => client.migrate([{ version: "004", sql: "   " }]), /migration SQL must be a non-empty string/);
const customMigrateClient = createClientFromDatabase({
  ...fakeDatabase,
  migrate: async (input) => {
    calls.push({ method: "customMigrate", input });
    return { applied: ["005"], skipped: [] };
  }
});
const customMigrateDatabase = await customMigrateClient.database();
assert.deepEqual(await customMigrateDatabase.migrate([{ version: " 005 ", name: " custom ", sql: "CREATE TABLE custom_migrated(id INTEGER);" }]), { applied: ["005"], skipped: [] });
assert.deepEqual(calls.at(-1), {
  method: "customMigrate",
  input: [{ version: "005", name: "custom", sql: "CREATE TABLE custom_migrated(id INTEGER);" }]
});
const customMigrateCallCount = calls.length;
await assert.rejects(() => customMigrateDatabase.migrate([{ version: "006", sql: "   " }]), /migration SQL must be a non-empty string/);
assert.equal(calls.length, customMigrateCallCount);
const customLibsqlMigrateResponse = {
  columns: [],
  columnTypes: [],
  rows: [],
  rowsAffected: 1,
  affectedRows: 1,
  changes: 1,
  lastInsertRowid: 46n,
  lastInsertRowId: 46n,
  truncated: false,
  routedOperationId: null,
  raw: sqlResponse([], [], "1", "46"),
  toJSON: () => ({ columns: [], columnTypes: [], rows: [], rowsAffected: 1, affectedRows: 1, changes: 1, lastInsertRowid: "46", lastInsertRowId: "46", truncated: false, routedOperationId: null, raw: sqlResponse([], [], "1", "46") })
};
const customLibsqlMigrateClient = createClientFromDatabase({
  ...fakeDatabase,
  migrate: async (input) => {
    calls.push({ method: "customLibsqlMigrate", input });
    return [customLibsqlMigrateResponse];
  }
});
const customLibsqlMigrateDatabase = await customLibsqlMigrateClient.database();
assert.deepEqual(await customLibsqlMigrateDatabase.migrate([{ sql: "INSERT INTO custom_migrated(id) VALUES (:id)", args: { id: 7 } }]), [customLibsqlMigrateResponse]);
assert.deepEqual(calls.at(-1), {
  method: "customLibsqlMigrate",
  input: [{ sql: "INSERT INTO custom_migrated(id) VALUES (:id)", params: [7] }]
});
const customLibsqlMigrateCallCount = calls.length;
await assert.rejects(() => customLibsqlMigrateDatabase.migrate(["   "]), /SQL statement SQL must be a non-empty string/);
assert.equal(calls.length, customLibsqlMigrateCallCount);
const customScriptCalls = [];
const customScriptResponse = sqlResponse([], [], "1", "47");
const customScriptClient = createClientFromDatabase({
  ...fakeDatabase,
  executeScript: async (source, options) => {
    customScriptCalls.push({ method: "executeScript", source, options });
    return [customScriptResponse];
  },
  exec: async (source, options) => {
    customScriptCalls.push({ method: "exec", source, options });
  },
  executeMultiple: async (source) => {
    customScriptCalls.push({ method: "executeMultiple", source });
  },
  loadSqlDump: async (source, options) => {
    customScriptCalls.push({ method: "loadSqlDump", source, options });
    return [customScriptResponse];
  }
});
const customScriptDatabase = await customScriptClient.database();
assert.deepEqual(await customScriptDatabase.executeScript("INSERT INTO custom_migrated(id) VALUES (8);", { mode: "write", idempotencyKey: " script_retry " }), [customScriptResponse]);
assert.deepEqual(customScriptCalls.at(-1), {
  method: "executeScript",
  source: "INSERT INTO custom_migrated(id) VALUES (8);",
  options: { idempotencyKey: "script_retry", mode: "write" }
});
await customScriptDatabase.exec("INSERT INTO custom_migrated(id) VALUES (9);", { idempotencyKey: " exec_retry " });
assert.deepEqual(customScriptCalls.at(-1), {
  method: "exec",
  source: "INSERT INTO custom_migrated(id) VALUES (9);",
  options: { idempotencyKey: "exec_retry" }
});
await customScriptDatabase.executeMultiple("INSERT INTO custom_migrated(id) VALUES (10);");
assert.deepEqual(customScriptCalls.at(-1), {
  method: "executeMultiple",
  source: "INSERT INTO custom_migrated(id) VALUES (10);"
});
await customScriptDatabase.executeMultiple("INSERT INTO custom_migrated(id) VALUES (10);", { idempotencyKey: " multiple_retry " });
assert.deepEqual(customScriptCalls.at(-1), {
  method: "executeScript",
  source: "INSERT INTO custom_migrated(id) VALUES (10);",
  options: { idempotencyKey: "multiple_retry" }
});
assert.deepEqual(await customScriptDatabase.loadSqlDump("INSERT INTO custom_migrated(id) VALUES (11);", { idempotencyKey: " dump_retry " }), [customScriptResponse]);
assert.deepEqual(customScriptCalls.at(-1), {
  method: "loadSqlDump",
  source: "INSERT INTO custom_migrated(id) VALUES (11);",
  options: { idempotencyKey: "dump_retry" }
});
const customScriptCallCount = customScriptCalls.length;
await assert.rejects(() => customScriptDatabase.executeScript("  ;  "), /script requires at least one SQL statement/);
await assert.rejects(() => customScriptDatabase.executeScript("INSERT INTO custom_migrated(id) VALUES (12);", { mode: "read" }), /read batch mode only accepts read SQL/);
await assert.rejects(() => customScriptDatabase.executeScript("SELECT 1;", { mode: "read", idempotencyKey: "read_script_retry" }), /read batch mode does not accept idempotencyKey/);
await assert.rejects(() => customScriptDatabase.exec("  ;  "), /script requires at least one SQL statement/);
await assert.rejects(() => customScriptDatabase.executeMultiple("  ;  "), /script requires at least one SQL statement/);
await assert.rejects(() => customScriptDatabase.loadSqlDump("BEGIN; COMMIT;"), /SQL dump has no executable statements/);
await assert.rejects(() => customScriptDatabase.loadSqlDump("INSERT INTO custom_migrated(id) VALUES (13);", { idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
assert.equal(customScriptCalls.length, customScriptCallCount);
const libsqlMigrateResult = await client.migrate([
  "CREATE TABLE libsql_migrated(id INTEGER PRIMARY KEY)",
  { sql: "INSERT INTO libsql_migrated(id) VALUES (:id)", args: { id: 1 } },
  sql`INSERT INTO libsql_migrated(id) VALUES (${2})`
]);
assert.equal(libsqlMigrateResult.length, 3);
const libsqlMigrateCalls = calls.slice(-3);
assert.deepEqual(libsqlMigrateCalls[0], {
  method: "execute",
  statement: { sql: "PRAGMA foreign_keys=off", params: [] }
});
assert.deepEqual(libsqlMigrateCalls[1], {
  method: "batch",
  statements: [
    { sql: "CREATE TABLE libsql_migrated(id INTEGER PRIMARY KEY)", params: [] },
    { sql: "INSERT INTO libsql_migrated(id) VALUES (:id)", params: [1] },
    { sql: "INSERT INTO libsql_migrated(id) VALUES (?1)", params: [2] }
  ],
  options: "deferred"
});
assert.deepEqual(libsqlMigrateCalls[2], {
  method: "execute",
  statement: { sql: "PRAGMA foreign_keys=on", params: [] }
});
const failingMigrateCalls = [];
const failingMigrateClient = createClientFromDatabase({
  ...fakeDatabase,
  execute: async (statement) => {
    failingMigrateCalls.push({ method: "execute", statement });
    if (statement.sql === "PRAGMA foreign_keys=on") throw new Error("foreign key restore failed");
    return sqlResponse([], [], "0", "0");
  },
  batch: async (statements, options) => {
    failingMigrateCalls.push({ method: "batch", statements, options });
    throw new Error("migration batch failed");
  }
});
await assert.rejects(() => failingMigrateClient.migrate(["CREATE TABLE failed_migration(id INTEGER)"]), /migration batch failed/);
assert.deepEqual(failingMigrateCalls.map((call) => call.method), ["execute", "batch", "execute"]);
const tooLargeClient = createClientFromDatabase({
  ...fakeDatabase,
  execute: async () => sqlResponse([], [], "9007199254740992", "0")
});
await assert.rejects(() => tooLargeClient.execute("INSERT INTO notes(id) VALUES (9)"), /rowsAffected exceeds JavaScript safe integer range/);
const negativeRowsAffectedClient = createClientFromDatabase({
  ...fakeDatabase,
  execute: async () => sqlResponse([], [], "-1", "0")
});
await assert.rejects(() => negativeRowsAffectedClient.execute("INSERT INTO notes(id) VALUES (10)"), /rowsAffected must be a non-negative integer/);
const invalidRowsAffectedClient = createClientFromDatabase({
  ...fakeDatabase,
  execute: async () => sqlResponse([], [], "1.5", "0")
});
await assert.rejects(() => invalidRowsAffectedClient.execute("INSERT INTO notes(id) VALUES (11)"), /rowsAffected must be a non-negative integer/);
const invalidLastInsertRowidClient = createClientFromDatabase({
  ...fakeDatabase,
  execute: async () => sqlResponse([], [], "1", "1.5")
});
await assert.rejects(() => invalidLastInsertRowidClient.execute("INSERT INTO notes(id) VALUES (12)"), /lastInsertRowid must be an integer/);
const negativeLastInsertRowidResult = await createClientFromDatabase({
  ...fakeDatabase,
  execute: async () => sqlResponse([], [], "1", "-7")
}).execute("INSERT INTO notes(id) VALUES (-7)");
assert.equal(negativeLastInsertRowidResult.lastInsertRowid, -7n);
const invalidColumnsResultClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => ({ ...sqlResponse(["id"], [[{ kind: "integer", value: "1" }]], "0", "0"), columns: "id" })
});
await assert.rejects(() => invalidColumnsResultClient.query("SELECT id FROM notes"), /SQL result columns must be an array/);
const invalidColumnNameResultClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse([1], [[{ kind: "integer", value: "1" }]], "0", "0")
});
await assert.rejects(() => invalidColumnNameResultClient.query("SELECT id FROM notes"), /SQL result column name must be a string/);
const invalidRowsResultClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => ({ ...sqlResponse(["id"], [[{ kind: "integer", value: "1" }]], "0", "0"), rows: "rows" })
});
await assert.rejects(() => invalidRowsResultClient.query("SELECT id FROM notes"), /SQL result rows must be an array/);
const invalidRowResultClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => ({ ...sqlResponse(["id"], [[{ kind: "integer", value: "1" }]], "0", "0"), rows: [{ kind: "integer", value: "1" }] })
});
await assert.rejects(() => invalidRowResultClient.query("SELECT id FROM notes"), /SQL result row must be an array/);
const shortResultRowClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse(["id", "body"], [[{ kind: "integer", value: "1" }]], "0", "0")
});
await assert.rejects(() => shortResultRowClient.query("SELECT id, body FROM notes"), /SQL result row length must match columns length/);
const wideResultRowClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse(["id"], [[{ kind: "integer", value: "1" }, { kind: "text", value: "extra" }]], "0", "0")
});
await assert.rejects(() => wideResultRowClient.query("SELECT id FROM notes"), /SQL result row length must match columns length/);
const invalidIntegerResultClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse(["value"], [[{ kind: "integer", value: "1.5" }]], "0", "0")
});
await assert.rejects(() => invalidIntegerResultClient.query("SELECT value FROM notes"), /integer result must be a base-10 integer string/);
const invalidRealResultClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse(["value"], [[{ kind: "real", value: Number.POSITIVE_INFINITY }]], "0", "0")
});
await assert.rejects(() => invalidRealResultClient.query("SELECT value FROM notes"), /real result must be a finite number/);
const invalidBlobResultClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse(["value"], [[{ kind: "blob", value: "bytes" }]], "0", "0")
});
await assert.rejects(() => invalidBlobResultClient.query("SELECT value FROM notes"), /blob result must be a byte array/);
const uint8ArrayBlobResultClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse(["value"], [[{ kind: "blob", value: new Uint8Array([1, 2, 3]) }]], "0", "0")
});
const uint8ArrayBlobResult = await uint8ArrayBlobResultClient.query("SELECT value FROM notes");
assert.equal(uint8ArrayBlobResult.rows[0]?.value instanceof ArrayBuffer, true);
assert.deepEqual(Array.from(new Uint8Array(uint8ArrayBlobResult.rows[0]?.value)), [1, 2, 3]);
assert.deepEqual(uint8ArrayBlobResult.toJSON().rows[0]?.value, [1, 2, 3]);
const unknownResultKindClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse(["value"], [[{ kind: "json", value: {} }]], "0", "0")
});
await assert.rejects(() => unknownResultKindClient.query("SELECT value FROM notes"), /SQL result value kind must be null, integer, real, text, or blob/);
const unsafeNumberIntClient = createClientFromDatabase({
  ...fakeDatabase,
  query: async () => sqlResponse(["value"], [[{ kind: "integer", value: "9007199254740992" }]], "0", "0")
}, { intMode: "number" });
await assert.rejects(() => unsafeNumberIntClient.query("SELECT ?1 AS value", [7]), /integer result exceeds JavaScript safe integer range/);

const dump = await client.dumpSql();
assert.match(dump, /CREATE TABLE notes\(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS \(length\(body\)\) VIRTUAL\)/);
assert.match(dump, /INSERT INTO "notes" \("id", "body"\) VALUES \(1, 'quote '' semi; blob'\);/);
assert.doesNotMatch(dump, /"body_len"/);
assert.match(dump, /DELETE FROM sqlite_sequence WHERE name = 'notes';/);
assert.match(dump, /INSERT INTO sqlite_sequence\(name, seq\) VALUES \('notes', 44\);/);
assert.match(dump, /CREATE INDEX idx_notes_body/);
assert.match(dump, /CREATE TRIGGER trg_notes/);
assert.equal(calls.at(-1).method, "query");

const sequenceTableNames = Array.from({ length: 120 }, (_, index) => `seq_${String(index).padStart(3, "0")}`);
const sequenceDumpClient = createClientFromDatabase({
  databaseId: "db_sequences",
  query: async (statement) => {
    if (statement.sql.includes("sqlite_master")) return sqlResponse(["name"], [[{ kind: "text", value: "sqlite_sequence" }]], "0", "0");
    const lastName = String(statement.params?.[0] ?? "");
    const rows = sequenceTableNames
      .filter((name) => name > lastName)
      .slice(0, 50)
      .map((name, index) => [
        { kind: "text", value: name },
        { kind: "integer", value: String(index + 1) }
      ]);
    return {
      columns: ["name", "seq"],
      rows,
      rowsAffected: "0",
      lastInsertRowId: "0",
      truncated: rows.length === 50,
      routedOperationId: null
    };
  },
  execute: async () => sqlResponse([], [], "0", "0"),
  listTables: async () => sequenceTableNames.map((name) => ({ name, objectType: "table", schemaSql: `CREATE TABLE ${name}(id INTEGER PRIMARY KEY AUTOINCREMENT)` })),
  describeTable: async (tableName) => ({
    databaseId: "db_sequences",
    tableName,
    objectType: "table",
    schemaSql: `CREATE TABLE ${tableName}(id INTEGER PRIMARY KEY AUTOINCREMENT)`,
    columns: [{ cid: 0, name: "id", declaredType: "INTEGER", notNull: false, defaultValue: null, primaryKeyPosition: 1, hidden: 0 }],
    indexes: [],
    triggers: [],
    foreignKeys: []
  }),
  previewTable: async (tableName, options) => ({
    databaseId: "db_sequences",
    tableName,
    columns: ["id"],
    rows: [],
    offset: options?.offset ?? 0,
    limit: options?.limit ?? 50,
    totalCount: "0",
    truncated: false
  })
});
const sequenceDump = await sequenceDumpClient.dumpSql({ pageSize: 50 });
assert.equal((sequenceDump.match(/INSERT INTO sqlite_sequence/g) ?? []).length, 120);

const loadedDump = await client.loadSqlDump(`
  -- dump pragma
  PRAGMA foreign_keys=OFF;
  /* dump begin */
  BEGIN TRANSACTION;
  CREATE TABLE loaded(id INTEGER);
  INSERT INTO loaded(id) VALUES (1);
  CREATE TABLE [loaded;bracketed](id INTEGER);
  INSERT INTO [loaded;bracketed](id) VALUES (1);
  -- trigger load
  CREATE TRIGGER loaded_guard AFTER INSERT ON loaded BEGIN UPDATE loaded SET id = CASE WHEN NEW.id IS NULL THEN 0 ELSE NEW.id END; END;
  -- dump commit
  COMMIT;
`, { idempotencyKey: "sdk_retry_load_1" });
assert.equal(loadedDump.length, 5);
assert.deepEqual(calls.at(-1), {
  method: "batch",
  statements: [
    { sql: "CREATE TABLE loaded(id INTEGER)", params: [] },
    { sql: "INSERT INTO loaded(id) VALUES (1)", params: [] },
    { sql: "CREATE TABLE [loaded;bracketed](id INTEGER)", params: [] },
    { sql: "INSERT INTO [loaded;bracketed](id) VALUES (1)", params: [] },
    { sql: "-- trigger load\n  CREATE TRIGGER loaded_guard AFTER INSERT ON loaded BEGIN UPDATE loaded SET id = CASE WHEN NEW.id IS NULL THEN 0 ELSE NEW.id END; END", params: [] }
  ],
  options: { idempotencyKey: "sdk_retry_load_1" }
});
const chunkedDumpCallsBefore = calls.length;
const chunkedDumpSql = Array.from({ length: 33 }, (_, index) => `INSERT INTO loaded(id) VALUES (${200 + index});`).join("\n");
await client.loadSqlDump(chunkedDumpSql, { idempotencyKey: "sdk_retry_chunked_load" });
const chunkedDumpCalls = calls.slice(chunkedDumpCallsBefore);
assert.equal(chunkedDumpCalls.length, 2);
assert.deepEqual(chunkedDumpCalls.map((call) => call.options?.idempotencyKey), [
  "sdk_retry_chunked_load:chunk:1:of:2",
  "sdk_retry_chunked_load:chunk:2:of:2"
]);
await assert.rejects(() => client.loadSqlDump("BEGIN; COMMIT;"), /SQL dump has no executable statements/);

assert.deepEqual(Array.from(await client.archive()), [1, 2, 3]);
assert.deepEqual(calls.at(-1), { method: "archive" });
assert.deepEqual(await client.snapshotInfo(new Uint8Array([4, 5, 6])), snapshot456Info);
await client.restore(new Uint8Array([4, 5, 6]), { expectedSha256: "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472" });
assert.deepEqual(calls.at(-1), {
  method: "restore",
  snapshot: [4, 5, 6],
  options: { expectedSha256: "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472" }
});
await client.restore(new Uint8Array([4, 5, 6]), { expectedSha256: ` ${snapshot456Info.sha256.toUpperCase()} ` });
assert.deepEqual(calls.at(-1), {
  method: "restore",
  snapshot: [4, 5, 6],
  options: { expectedSha256: snapshot456Info.sha256 }
});
const sqlClientRestoreCallCount = calls.length;
await assert.rejects(
  () => client.restore(new Uint8Array([4, 5, 6]), { databaseId: "db_other" }),
  /database restore option databaseId is not supported; choose database at the client, low-level restore argument, or database handle/
);
assert.equal(calls.length, sqlClientRestoreCallCount);
await assert.rejects(
  () => client.restore(new Uint8Array([4, 5, 6]), { expectedSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81" }),
  /snapshot hash mismatch/
);
await assert.rejects(
  () => client.restore(new Uint8Array([4, 5, 6]), { expectedSha256: "not-a-sha256" }),
  /expectedSha256 must be a 64-character hex SHA-256 hash/
);
await assert.rejects(
  () => client.restore(new Uint8Array([4, 5, 6]), { expectedSha256: "" }),
  /expectedSha256 must be a 64-character hex SHA-256 hash/
);
await assert.rejects(
  () => client.restore(new Uint8Array([4, 5, 6]), { expectedSha256: "   " }),
  /expectedSha256 must be a 64-character hex SHA-256 hash/
);
const customSnapshotInfoCalls = [];
const customSnapshotInfoClient = createClientFromDatabase({
  ...fakeDatabase,
  snapshotInfo: async (snapshot) => {
    customSnapshotInfoCalls.push({ snapshotIsUint8Array: snapshot instanceof Uint8Array, snapshot: Array.from(snapshot) });
    return {
      sizeBytes: 3,
      sha256: ` ${snapshot456Info.sha256.toUpperCase()} `,
      snapshotHash: snapshot456Info.snapshotHash
    };
  }
});
const customSnapshotInfoDatabase = await customSnapshotInfoClient.database();
assert.deepEqual(await customSnapshotInfoDatabase.snapshotInfo([4, 5, 6]), snapshot456Info);
assert.deepEqual(customSnapshotInfoCalls.at(-1), { snapshotIsUint8Array: true, snapshot: [4, 5, 6] });
const customSnapshotInfoCallCount = customSnapshotInfoCalls.length;
assert.deepEqual(await createClientFromDatabase(fakeDatabase).snapshotInfo([4, 5, 6]), snapshot456Info);
await assert.rejects(() => customSnapshotInfoDatabase.snapshotInfo([999]), /blob bytes must be integers from 0 to 255/);
assert.equal(customSnapshotInfoCalls.length, customSnapshotInfoCallCount);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, snapshotInfo: async () => ({ ...snapshot456Info, sizeBytes: 4 }) }).database()).snapshotInfo([4, 5, 6]),
  /snapshot sizeBytes does not match snapshot byte length/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, snapshotInfo: async () => ({ ...snapshot456Info, snapshotHash: new Array(32).fill(0) }) }).database()).snapshotInfo([4, 5, 6]),
  /snapshot hash bytes do not match snapshot sha256/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, snapshotInfo: async () => ({
    sizeBytes: 3,
    sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    snapshotHash: [3, 144, 88, 198, 242, 192, 203, 73, 44, 83, 59, 10, 77, 20, 239, 119, 204, 15, 120, 171, 204, 206, 213, 40, 125, 132, 161, 162, 1, 28, 251, 129]
  }) }).database()).snapshotInfo([4, 5, 6]),
  /snapshot hash mismatch/
);
const customArchiveClient = createClientFromDatabase({
  ...fakeDatabase,
  archive: async () => [4, 5, 6]
});
const customArchiveSnapshot = await (await customArchiveClient.database()).archive();
assert.equal(customArchiveSnapshot instanceof Uint8Array, true);
assert.deepEqual(Array.from(customArchiveSnapshot), [4, 5, 6]);
await assert.rejects(
  () => createClientFromDatabase({ ...fakeDatabase, archive: async () => [999] }).archive(),
  /blob bytes must be integers from 0 to 255/
);
const customRestoreCalls = [];
const customRestoreClient = createClientFromDatabase({
  ...fakeDatabase,
  restore: async (snapshot, options) => {
    customRestoreCalls.push({ snapshotIsUint8Array: snapshot instanceof Uint8Array, snapshot: Array.from(snapshot), options });
  }
});
const customRestoreDatabase = await customRestoreClient.database();
await customRestoreDatabase.restore([4, 5, 6], { expectedSha256: ` ${snapshot456Info.sha256.toUpperCase()} ` });
assert.deepEqual(customRestoreCalls.at(-1), {
  snapshotIsUint8Array: true,
  snapshot: [4, 5, 6],
  options: { expectedSha256: snapshot456Info.sha256 }
});
await customRestoreClient.restore([4, 5, 6], { expectedSha256: snapshot456Info.sha256 });
assert.deepEqual(customRestoreCalls.at(-1), {
  snapshotIsUint8Array: true,
  snapshot: [4, 5, 6],
  options: { expectedSha256: snapshot456Info.sha256 }
});
const customRestoreCallCount = customRestoreCalls.length;
await assert.rejects(() => customRestoreDatabase.restore([999]), /blob bytes must be integers from 0 to 255/);
await assert.rejects(
  () => customRestoreDatabase.restore([4, 5, 6], { expectedSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81" }),
  /snapshot hash mismatch/
);
assert.equal(customRestoreCalls.length, customRestoreCallCount);
await client.delete();
assert.deepEqual(calls.at(-1), { method: "delete" });
assert.equal(client.closed, true);
assert.throws(() => client.reconnect(), /database client has been deleted/);
await assert.rejects(() => client.databaseId(), /database client has been deleted/);
const databaseHandleDeleteClient = createClientFromDatabase(fakeDatabase);
const databaseHandleToDelete = await databaseHandleDeleteClient.database();
await databaseHandleToDelete.delete();
assert.deepEqual(calls.at(-1), { method: "delete" });
assert.equal(databaseHandleDeleteClient.closed, true);
await assert.rejects(() => databaseHandleDeleteClient.databaseId(), /database client has been deleted/);

const sqlOnlyClient = createClientFromDatabase({
  ...fakeDatabase,
  connectionUrl: undefined,
  delete: undefined,
  getUsage: undefined,
  listUsageEvents: undefined,
  getRoutedOperation: undefined,
  reconcileRoutedOperation: undefined,
  grantMember: undefined,
  revokeMember: undefined,
  listMembers: undefined,
  placement: undefined,
  archive: undefined,
  restore: undefined
});
const sqlOnlyDatabase = await sqlOnlyClient.database();
await assert.rejects(() => sqlOnlyDatabase.delete(), /delete is not available/);
await assert.rejects(() => sqlOnlyClient.delete(), /delete is not available/);
const minimalSqlCalls = [];
const minimalSqlClient = createClientFromDatabase({
  databaseId: "db_minimal",
  query: async (statement) => {
    minimalSqlCalls.push({ method: "query", statement });
    return sqlResponse(["value"], [[{ kind: "integer", value: "7" }]], "0", "0");
  },
  execute: async (statement) => {
    minimalSqlCalls.push({ method: "execute", statement });
    return sqlResponse([], [], "1", "7");
  }
});
assert.equal((await minimalSqlClient.get("SELECT ?1 AS value", [7]))?.value, "7");
assert.deepEqual(await minimalSqlClient.values("SELECT ?1 AS value", [7]), [["7"]]);
assert.equal(await minimalSqlClient.scalar("SELECT ?1 AS value", [7]), "7");
assert.equal((await minimalSqlClient.run("INSERT INTO notes(id) VALUES (?1)", [7])).rowsAffected, 1);
assert.equal((await minimalSqlClient.prepare("SELECT ?1 AS value").get([7]))?.value, "7");
assert.equal((await minimalSqlClient.prepare("INSERT INTO notes(id) VALUES (?1)").run([7])).rowsAffected, 1);
assert.equal((await minimalSqlClient.batch(["SELECT ?1 AS value"], { mode: "read", maxRows: 1 }))[0].rows[0]?.value, "7");
assert.equal((await minimalSqlClient.transaction(["SELECT ?1 AS value"], { mode: "read", maxRows: 1 }))[0].rows[0]?.value, "7");
await minimalSqlClient.executeMultiple("INSERT INTO notes(id) VALUES (8);");
assert.equal((await minimalSqlClient.executeScript("SELECT ?1 AS value;", { mode: "read", maxRows: 1 }))[0].rows[0]?.value, "7");
await minimalSqlClient.exec("SELECT ?1 AS value;", { mode: "read", maxRows: 1 });
assert.equal((await minimalSqlClient.loadSqlDump("SELECT ?1 AS value;", { mode: "read", maxRows: 1 }))[0].rows[0]?.value, "7");
await assert.rejects(() => minimalSqlClient.batch(["INSERT INTO notes(id) VALUES (9)"], "write"), /batch is not available on this database source/);
await assert.rejects(() => minimalSqlClient.transaction(["INSERT INTO notes(id) VALUES (10)"], "write"), /batch is not available on this database source/);
await assert.rejects(() => minimalSqlClient.executeScript("INSERT INTO notes(id) VALUES (11);"), /batch is not available on this database source/);
await assert.rejects(() => minimalSqlClient.exec("INSERT INTO notes(id) VALUES (12);"), /batch is not available on this database source/);
await assert.rejects(() => minimalSqlClient.loadSqlDump("INSERT INTO notes(id) VALUES (13);"), /batch is not available on this database source/);
assert.deepEqual(minimalSqlCalls.map((call) => call.method), [
  "query",
  "query",
  "query",
  "execute",
  "query",
  "execute",
  "query",
  "query",
  "execute",
  "query",
  "query",
  "query"
]);
const customReadHelperCalls = [];
const customReadHelperClient = createClientFromDatabase({
  databaseId: "db_custom_read_helpers",
  query: async (statement) => {
    customReadHelperCalls.push({ method: "query", statement });
    return sqlResponse(["value"], [[{ kind: "integer", value: "7" }]], "0", "0");
  },
  execute: async (statement) => {
    customReadHelperCalls.push({ method: "execute", statement });
    return sqlResponse([], [], "1", "7");
  },
  batch: async (statements, options) => {
    customReadHelperCalls.push({ method: "batch", statements, options });
    return statements.map(() => sqlResponse([], [], "1", "7"));
  },
  queryOne: async (statement) => {
    customReadHelperCalls.push({ method: "queryOne", statement });
    return { value: "7" };
  },
  all: async (statement) => {
    customReadHelperCalls.push({ method: "all", statement });
    return [{ value: "7" }];
  },
  get: async (statement) => {
    customReadHelperCalls.push({ method: "get", statement });
    return { value: "7" };
  },
  values: async (statement) => {
    customReadHelperCalls.push({ method: "values", statement });
    return [["7"]];
  },
  first: async (statement) => {
    customReadHelperCalls.push({ method: "first", statement });
    return { value: "7" };
  },
  firstValue: async (statement) => {
    customReadHelperCalls.push({ method: "firstValue", statement });
    return "7";
  },
  scalar: async (statement) => {
    customReadHelperCalls.push({ method: "scalar", statement });
    return "7";
  }
});
const customReadHelperDatabase = await customReadHelperClient.database();
assert.equal((await customReadHelperDatabase.queryOne("SELECT ?1 AS value", [7]))?.value, "7");
assert.equal((await customReadHelperDatabase.all("SELECT ?1 AS value", [7]))[0]?.value, "7");
assert.equal((await customReadHelperDatabase.get("SELECT ?1 AS value", [7]))?.value, "7");
assert.deepEqual(await customReadHelperDatabase.values("SELECT ?1 AS value", [7]), [["7"]]);
assert.equal((await customReadHelperDatabase.first("SELECT ?1 AS value", [7]))?.value, "7");
assert.equal(await customReadHelperDatabase.firstValue("SELECT ?1 AS value", [7]), "7");
assert.equal(await customReadHelperDatabase.scalar("SELECT ?1 AS value", [7]), "7");
assert.deepEqual(customReadHelperCalls.map((call) => call.method), ["queryOne", "all", "get", "values", "first", "firstValue", "scalar"]);
const customReadHelperCallCount = customReadHelperCalls.length;
await assert.rejects(() => customReadHelperDatabase.queryOne({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => customReadHelperDatabase.all({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => customReadHelperDatabase.get({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => customReadHelperDatabase.values({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => customReadHelperDatabase.first({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => customReadHelperDatabase.firstValue({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => customReadHelperDatabase.scalar({ sql: "SELECT 1", idempotencyKey: "read_retry" }), /idempotencyKey is only valid for write SQL/);
await assert.rejects(() => customReadHelperDatabase.queryOne("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
await assert.rejects(() => customReadHelperDatabase.all("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
await assert.rejects(() => customReadHelperDatabase.get("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
await assert.rejects(() => customReadHelperDatabase.values("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
await assert.rejects(() => customReadHelperDatabase.first("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
await assert.rejects(() => customReadHelperDatabase.firstValue("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
await assert.rejects(() => customReadHelperDatabase.scalar("INSERT INTO notes(id) VALUES (999)"), /query only accepts read SQL/);
assert.equal(customReadHelperCalls.length, customReadHelperCallCount);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, queryRows: async () => "bad" }).database()).queryRows("SELECT value FROM notes"),
  /SQL row list must be an array/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, queryOne: async () => "bad" }).database()).queryOne("SELECT value FROM notes"),
  /SQL row must be an object/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, all: async () => [{ value: Number.NaN }] }).database()).all("SELECT value FROM notes"),
  /SQL row value number must be finite/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, values: async () => "bad" }).database()).values("SELECT value FROM notes"),
  /SQL value rows must be an array/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, values: async () => [[new Uint8Array([1])]] }).database()).values("SELECT value FROM notes"),
  /SQL value row cell must be null, string, number, bigint, or ArrayBuffer/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, first: async () => ["bad"] }).database()).first("SELECT value FROM notes"),
  /SQL row must be an object/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, firstValue: async () => Number.POSITIVE_INFINITY }).database()).firstValue("SELECT value FROM notes"),
  /firstValue result number must be finite/
);
await assert.rejects(
  async () => (await createClientFromDatabase({ ...fakeDatabase, scalar: async () => new Uint8Array([1]) }).database()).scalar("SELECT value FROM notes"),
  /scalar result must be null, string, number, bigint, or ArrayBuffer/
);
const customPrepareCalls = [];
const customPreparedResult = {
  columns: ["value"],
  columnTypes: ["integer"],
  rows: [{ value: "7", 0: "7" }],
  rowsAffected: 0,
  affectedRows: 0,
  changes: 0,
  lastInsertRowid: undefined,
  lastInsertRowId: undefined,
  truncated: false,
  routedOperationId: null,
  raw: sqlResponse(["value"], [[{ kind: "integer", value: "7" }]], "0", "0"),
  toJSON: () => ({ columns: ["value"], columnTypes: ["integer"], rows: [{ value: "7" }], rowsAffected: 0, affectedRows: 0, changes: 0, lastInsertRowid: null, lastInsertRowId: null, truncated: false, routedOperationId: null, raw: sqlResponse(["value"], [[{ kind: "integer", value: "7" }]], "0", "0") })
};
function customPreparedStatement(sqlText, initialArgs) {
  return {
    sql: sqlText,
    bind: (args) => {
      customPrepareCalls.push({ method: "preparedBind", args });
      return customPreparedStatement(sqlText, args);
    },
    execute: async (args) => {
      customPrepareCalls.push({ method: "preparedExecute", args });
      return customPreparedResult;
    },
    query: async (args) => {
      customPrepareCalls.push({ method: "preparedQuery", args });
      return customPreparedResult;
    },
    queryRows: async (args) => {
      customPrepareCalls.push({ method: "preparedQueryRows", args });
      return customPreparedResult.rows;
    },
    queryOne: async (args) => {
      customPrepareCalls.push({ method: "preparedQueryOne", args });
      return customPreparedResult.rows[0];
    },
    all: async (args) => {
      customPrepareCalls.push({ method: "preparedAll", args });
      return customPreparedResult.rows;
    },
    get: async (args) => {
      customPrepareCalls.push({ method: "preparedGet", args });
      return customPreparedResult.rows[0];
    },
    values: async (args) => {
      customPrepareCalls.push({ method: "preparedValues", args });
      return [["7"]];
    },
    first: async (args) => {
      customPrepareCalls.push({ method: "preparedFirst", args });
      return customPreparedResult.rows[0];
    },
    firstValue: async (args) => {
      customPrepareCalls.push({ method: "preparedFirstValue", args });
      return "7";
    },
    scalar: async (args) => {
      customPrepareCalls.push({ method: "preparedScalar", args });
      return "7";
    },
    run: async (args) => {
      customPrepareCalls.push({ method: "preparedRun", args });
      return customPreparedResult;
    }
  };
}
const customPrepareDatabase = await createClientFromDatabase({
  ...fakeDatabase,
  prepare: (sqlText, args) => {
    customPrepareCalls.push({ method: "prepare", sql: sqlText, args });
    return customPreparedStatement(sqlText, args);
  }
}).database();
const customPrepared = customPrepareDatabase.prepare({ sql: "SELECT :value AS value", args: { value: 7 } });
assert.equal(customPrepared.sql, "SELECT :value AS value");
assert.deepEqual(customPrepareCalls.at(-1), { method: "prepare", sql: "SELECT :value AS value", args: [7] });
assert.equal((await customPrepared.query({ value: 8 })).rows[0]?.value, "7");
assert.deepEqual(customPrepareCalls.at(-1), { method: "preparedQuery", args: [8] });
assert.equal((await customPrepared.execute([9])).rows[0]?.value, "7");
assert.equal((await customPrepared.queryRows([10]))[0]?.value, "7");
assert.equal((await customPrepared.queryOne([11]))?.value, "7");
assert.equal((await customPrepared.all([12]))[0]?.value, "7");
assert.equal((await customPrepared.get([13]))?.value, "7");
assert.deepEqual(await customPrepared.values([14]), [["7"]]);
assert.equal((await customPrepared.first([15]))?.value, "7");
assert.equal(await customPrepared.firstValue([16]), "7");
assert.equal(await customPrepared.scalar([17]), "7");
assert.equal((await customPrepared.run([18])).rowsAffected, 0);
assert.equal((await customPrepared.bind({ value: 19 }).get())?.value, "7");
assert.deepEqual(customPrepareCalls.at(-2), { method: "preparedBind", args: [19] });
await assert.rejects(() => customPrepared.query({ missing: 1 }), /missing SQL named arg: value/);
const malformedPrepareDatabase = await createClientFromDatabase({ ...fakeDatabase, prepare: () => "bad" }).database();
assert.throws(() => malformedPrepareDatabase.prepare("SELECT 1"), /prepared statement must be an object/);
const mismatchedPrepareDatabase = await createClientFromDatabase({ ...fakeDatabase, prepare: () => ({ ...customPreparedStatement("SELECT 2"), sql: "SELECT 2" }) }).database();
assert.throws(() => mismatchedPrepareDatabase.prepare("SELECT 1"), /prepared statement sql does not match requested SQL/);
const malformedPreparedMethodDatabase = await createClientFromDatabase({
  ...fakeDatabase,
  prepare: (sqlText) => ({ ...customPreparedStatement(sqlText), values: async () => [[new Uint8Array([1])]] })
}).database();
await assert.rejects(
  () => malformedPreparedMethodDatabase.prepare("SELECT 1").values(),
  /SQL value row cell must be null, string, number, bigint, or ArrayBuffer/
);
const customWaitCalls = [];
const customWaitClient = createClientFromDatabase({
  ...fakeDatabase,
  waitForRoutedOperation: async (operationId, options) => {
    customWaitCalls.push({ operationId, options });
    return {
      operationId,
      databaseId: "db_sdk",
      databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
      method: "sql_execute",
      requestHash: [1],
      status: "applied",
      error: null,
      createdAtMs: "1",
      updatedAtMs: "2"
    };
  }
});
const customWaitDatabase = await customWaitClient.database();
assert.equal((await customWaitDatabase.waitForRoutedOperation("op_wait_custom", { intervalMs: 0, timeoutMs: 1000 })).status, "applied");
assert.deepEqual(customWaitCalls.at(-1), {
  operationId: "op_wait_custom",
  options: { intervalMs: 0, timeoutMs: 1000, reconcileUnknown: undefined }
});
assert.equal((await customWaitDatabase.waitForRoutedOperation(" op_wait_custom_trim ", { intervalMs: 0, timeoutMs: 1000 })).operationId, "op_wait_custom_trim");
assert.deepEqual(customWaitCalls.at(-1), {
  operationId: "op_wait_custom_trim",
  options: { intervalMs: 0, timeoutMs: 1000, reconcileUnknown: undefined }
});
const customWaitCallCount = customWaitCalls.length;
await assert.rejects(() => customWaitDatabase.waitForRoutedOperation("op_wait_custom", { intervalMs: -1 }), /waitForRoutedOperation intervalMs must be a non-negative number/);
await assert.rejects(() => customWaitDatabase.waitForRoutedOperation("op_wait_custom", { timeoutMs: Number.POSITIVE_INFINITY }), /waitForRoutedOperation timeoutMs must be a non-negative number/);
assert.equal(customWaitCalls.length, customWaitCallCount);
const executeWaitCalls = [];
const executeWaitClient = createClientFromDatabase({
  ...fakeDatabase,
  execute: async (statement) => {
    executeWaitCalls.push({ method: "execute", statement });
    return sqlResponse([], [], "1", "0", "op_execute_wait");
  },
  waitForRoutedOperation: async (operationId, options) => {
    executeWaitCalls.push({ method: "wait", operationId, options });
    return {
      operationId,
      databaseId: "db_sdk",
      databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
      method: "sql_execute",
      requestHash: [1],
      status: "applied",
      error: null,
      createdAtMs: "1",
      updatedAtMs: "2"
    };
  }
});
await executeWaitClient.execute({ sql: "INSERT INTO wait_notes(id) VALUES (?1)", args: [1], wait: { intervalMs: 0, timeoutMs: 1000, reconcileUnknown: true } });
assert.deepEqual(executeWaitCalls, [
  {
    method: "execute",
    statement: {
      sql: "INSERT INTO wait_notes(id) VALUES (?1)",
      params: [1],
      maxRows: null
    }
  },
  {
    method: "wait",
    operationId: "op_execute_wait",
    options: { intervalMs: 0, timeoutMs: 1000, reconcileUnknown: true }
  }
]);
const executeWaitReadRejectCount = executeWaitCalls.length;
await assert.rejects(() => executeWaitClient.execute({ sql: "SELECT 1", wait: true }), /wait is only valid for write SQL/);
await assert.rejects(() => executeWaitClient.query({ sql: "SELECT 1", wait: true }), /wait is only valid for write SQL/);
await assert.rejects(() => executeWaitClient.execute({ sql: "INSERT INTO wait_notes(id) VALUES (2)", wait: { intervalMs: -1 } }), /waitForRoutedOperation intervalMs must be a non-negative number/);
await assert.rejects(() => executeWaitClient.execute({ sql: "INSERT INTO wait_notes(id) VALUES (2)", wait: { reconcileUnknown: "yes" } }), /waitForRoutedOperation reconcileUnknown must be a boolean/);
assert.equal(executeWaitCalls.length, executeWaitReadRejectCount);
await assert.rejects(() => minimalSqlClient.schema(), /schema is not available/);
await assert.rejects(() => minimalSqlClient.listTables(), /listTables is not available/);
await assert.rejects(() => minimalSqlClient.views(), /views is not available/);
await assert.rejects(() => minimalSqlClient.describeTable("notes"), /describeTable is not available/);
await assert.rejects(() => minimalSqlClient.previewTable("notes"), /previewTable is not available/);
await assert.rejects(async () => (await minimalSqlClient.database()).listTables(), /listTables is not available/);
await assert.rejects(() => sqlOnlyClient.connectionUrl(), /connectionUrl is not available/);
await assert.rejects(() => sqlOnlyClient.url(), /connectionUrl is not available/);
await assert.rejects(() => sqlOnlyClient.delete(), /delete is not available/);
await assert.rejects(() => sqlOnlyClient.getUsage(), /getUsage is not available/);
await assert.rejects(() => sqlOnlyClient.health(), /health is not available/);
await assert.rejects(() => sqlOnlyClient.status(), /status is not available/);
await assert.rejects(() => sqlOnlyClient.listUsageEvents(), /listUsageEvents is not available/);
await assert.rejects(() => sqlOnlyClient.getRoutedOperation("op_1"), /getRoutedOperation is not available/);
await assert.rejects(() => sqlOnlyClient.reconcileRoutedOperation("op_1"), /reconcileRoutedOperation is not available/);
await assert.rejects(() => sqlOnlyClient.waitForRoutedOperation("op_1"), /waitForRoutedOperation is not available/);
await assert.rejects(async () => (await sqlOnlyClient.database()).waitForRoutedOperation("op_1"), /waitForRoutedOperation is not available/);
await assert.rejects(async () => (await sqlOnlyClient.database()).getUsage(), /getUsage is not available/);
await assert.rejects(async () => (await sqlOnlyClient.database()).status(), /status is not available/);
await assert.rejects(async () => (await sqlOnlyClient.database()).archive(), /archive is not available/);
await assert.rejects(async () => (await sqlOnlyClient.database()).restore(new Uint8Array([1])), /restore is not available/);
await assert.rejects(() => sqlOnlyClient.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "writer"), /grantMember is not available/);
await assert.rejects(() => sqlOnlyClient.revokeMember("rrkah-fqaaa-aaaaa-aaaaq-cai"), /revokeMember is not available/);
await assert.rejects(() => sqlOnlyClient.listMembers(), /listMembers is not available/);
await assert.rejects(() => sqlOnlyClient.placement(), /placement is not available/);
await assert.rejects(() => sqlOnlyClient.archive(), /archive is not available/);
await assert.rejects(() => sqlOnlyClient.restore(new Uint8Array([1])), /restore is not available/);
await assert.rejects(() => sqlOnlyClient.restore([999], { expectedSha256: "" }), /restore is not available/);

const tempDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-client-"));
try {
  const generated = generateIcpdbServiceIdentity("ed25519");
  assert.equal(generated.identityType, "ed25519");
  assert.equal(typeof generated.principal, "string");
  assert.equal(generated.env.ICPDB_IDENTITY_PRINCIPAL, generated.principal);
  assert.equal(generated.env.ICPDB_IDENTITY_JSON, generated.identityJson);
  assert.match(generated.envText, /ICPDB_IDENTITY_PRINCIPAL=/);
  assert.match(generated.envText, /ICPDB_IDENTITY_JSON=/);
  assert.equal(generateIcpdbServiceIdentity(" secp256k1 ").identityType, "secp256k1");
  assert.equal(generateIcpdbServiceIdentity(" auto ").identityType, "ed25519");
  assert.throws(() => generateIcpdbServiceIdentity("ed25519", null), /service identity target must be an object/);
  assert.throws(() => generateIcpdbServiceIdentity("ed25519", []), /service identity target must be an object/);
  const targetedGenerated = generateIcpdbServiceIdentity("ed25519", {
    canisterId: " aaaaa-aa ",
    databaseId: " db_browser ",
    networkUrl: " https://icp-api.io ",
    rootKey: " aabbcc "
  });
  assert.equal(targetedGenerated.env.ICPDB_CANISTER_ID, "aaaaa-aa");
  assert.equal(targetedGenerated.env.ICPDB_DATABASE_ID, "db_browser");
  assert.equal(targetedGenerated.env.ICPDB_URL, "icpdb://aaaaa-aa/db_browser");
  assert.equal(targetedGenerated.env.ICPDB_NETWORK_URL, "https://icp-api.io");
  assert.equal(targetedGenerated.env.ICPDB_ROOT_KEY, "aabbcc");
  assert.match(targetedGenerated.envText, /ICPDB_CANISTER_ID="aaaaa-aa"/);
  assert.match(targetedGenerated.envText, /ICPDB_URL="icpdb:\/\/aaaaa-aa\/db_browser"/);
  assert.throws(() => generateIcpdbServiceIdentity("ed25519", { canisterId: "   " }), /ICPDB_CANISTER_ID must be a non-empty string/);
  assert.throws(() => generateIcpdbServiceIdentity("ed25519", { databaseId: "db_browser" }), /ICPDB_CANISTER_ID is required when ICPDB_DATABASE_ID is set/);
  assert.throws(() => generateIcpdbServiceIdentity("ed25519", { canisterId: "aaaaa-aa", databaseId: "   " }), /ICPDB_DATABASE_ID must be a non-empty string/);
  assert.throws(() => generateIcpdbServiceIdentity("ed25519", { networkUrl: "   " }), /ICPDB_NETWORK_URL must be a non-empty string/);
  assert.throws(() => generateIcpdbServiceIdentity("ed25519", { rootKey: "abc" }), /ICPDB_ROOT_KEY must be hex bytes/);
  assert.throws(() => generateIcpdbServiceIdentity("unsafe"), /ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1/);
  await assert.rejects(() => grantIcpdbServiceIdentity(null, {}), /service grant target must be an object/);
  await assert.rejects(() => grantIcpdbServiceIdentity({
    grantMember: "grantMember"
  }, {}), /service grant target grantMember must be a function/);
  const grantCalls = [];
  const provisioned = await provisionIcpdbServiceIdentity({
    grantMember: async (principal, role) => {
      grantCalls.push({ principal, role });
    }
  }, "reader", "secp256k1");
  assert.equal(provisioned.identityType, "secp256k1");
  assert.deepEqual(grantCalls, [{ principal: provisioned.principal, role: "reader" }]);
  await assert.rejects(() => provisionIcpdbServiceIdentity(null), /service grant target must be an object/);
  await assert.rejects(() => provisionIcpdbServiceIdentity({
    grantMember: "grantMember"
  }), /service grant target grantMember must be a function/);
  await assert.rejects(() => provisionIcpdbServiceIdentity({
    grantMember: async (principal, role) => {
      grantCalls.push({ principal, role });
    }
  }, "admin"), /database role must be reader, writer, or owner/);
  assert.deepEqual(grantCalls, [{ principal: provisioned.principal, role: "reader" }]);
  const provisionedEnvPath = join(tempDir, "provisioned-service.env");
  const serviceEnvGrantCalls = [];
  const provisionedServiceEnv = await provisionIcpdbServiceEnvFile({
    databaseId: "db_sdk",
    connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
    grantMember: async (principal, role) => {
      serviceEnvGrantCalls.push({ principal, role });
    }
  }, provisionedEnvPath, "writer", "ed25519", {
    ICPDB_NETWORK_URL: "http://127.0.0.1:8001",
    ICPDB_ROOT_KEY: "abcd"
  });
  assert.equal(provisionedServiceEnv.databaseId, "db_sdk");
  assert.equal(provisionedServiceEnv.connectionUrl, "icpdb://aaaaa-aa/db_sdk");
  assert.equal(provisionedServiceEnv.role, "writer");
  assert.equal(provisionedServiceEnv.env.ICPDB_NETWORK_URL, "http://127.0.0.1:8001");
  assert.equal(provisionedServiceEnv.env.ICPDB_ROOT_KEY, "abcd");
  assert.deepEqual(serviceEnvGrantCalls, [{ principal: provisionedServiceEnv.principal, role: "writer" }]);
  assert.match(provisionedServiceEnv.envText, /ICPDB_URL="icpdb:\/\/aaaaa-aa\/db_sdk"/);
  assert.equal((await stat(provisionedEnvPath)).mode & 0o777, 0o600);
  assert.deepEqual(await loadIcpdbServiceEnvFile(provisionedEnvPath), provisionedServiceEnv.env);
  const trimmedProvisionedServiceEnv = await provisionIcpdbServiceEnvFile({
    databaseId: " db_sdk ",
    connectionUrl: () => " icpdb://aaaaa-aa/db_sdk ",
    grantMember: async () => {}
  }, join(tempDir, "trimmed-provisioned-service.env"));
  assert.equal(trimmedProvisionedServiceEnv.databaseId, "db_sdk");
  assert.equal(trimmedProvisionedServiceEnv.connectionUrl, "icpdb://aaaaa-aa/db_sdk");
  assert.equal(trimmedProvisionedServiceEnv.env.ICPDB_DATABASE_ID, "db_sdk");
  assert.equal(trimmedProvisionedServiceEnv.env.ICPDB_URL, "icpdb://aaaaa-aa/db_sdk");
  await assert.rejects(() => provisionIcpdbServiceEnvFile(null, join(tempDir, "bad-target-service.env")), /service env target must be an object/);
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "   ",
    connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
    grantMember: async () => {}
  }, join(tempDir, "bad-target-service.env")), /service env target databaseId must be a non-empty string/);
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "db_sdk",
    connectionUrl: "icpdb://aaaaa-aa/db_sdk",
    grantMember: async () => {}
  }, join(tempDir, "bad-target-service.env")), /service env target connectionUrl must be a function/);
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "db_sdk",
    connectionUrl: () => "   ",
    grantMember: async () => {}
  }, join(tempDir, "bad-target-service.env")), /service env target connectionUrl must be a non-empty string/);
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "db_sdk",
    connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
    grantMember: "grantMember"
  }, join(tempDir, "bad-target-service.env")), /service env target grantMember must be a function/);
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "db_sdk",
    connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
    grantMember: async () => {}
  }, join(tempDir, "bad-extra-service.env"), "writer", "ed25519", null), /extra service env must be an object/);
  const invalidExtraEnvGrantCalls = [];
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "db_sdk",
    connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
    grantMember: async (principal, role) => {
      invalidExtraEnvGrantCalls.push({ principal, role });
    }
  }, join(tempDir, "bad-extra-service.env"), "writer", "ed25519", {
    "ICPDB-BAD": "bad"
  }), /ICPDB-BAD must be a valid env key/);
  assert.deepEqual(invalidExtraEnvGrantCalls, []);
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "db_sdk",
    connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
    grantMember: async (principal, role) => {
      invalidExtraEnvGrantCalls.push({ principal, role });
    }
  }, join(tempDir, "bad-extra-service.env"), "writer", "ed25519", {
    ICPDB_NETWORK_URL: "   "
  }), /ICPDB_NETWORK_URL must be a non-empty string/);
  assert.deepEqual(invalidExtraEnvGrantCalls, []);
  let mismatchedGrantCalls = 0;
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "db_other",
    connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
    grantMember: async () => {
      mismatchedGrantCalls += 1;
    }
  }, join(tempDir, "mismatched-service.env")), /database connection URL does not match databaseId/);
  assert.equal(mismatchedGrantCalls, 0);
  const serviceEnvGrantCallCount = serviceEnvGrantCalls.length;
  await assert.rejects(() => provisionIcpdbServiceEnvFile({
    databaseId: "db_sdk",
    connectionUrl: () => "icpdb://aaaaa-aa/db_sdk",
    grantMember: async (principal, role) => {
      serviceEnvGrantCalls.push({ principal, role });
    }
  }, "   "), /service env file path must be a non-empty string/);
  assert.equal(serviceEnvGrantCalls.length, serviceEnvGrantCallCount);
  const generatedEnvPath = join(tempDir, "generated.env");
  const writtenGenerated = await writeGeneratedIcpdbServiceEnvFile(generatedEnvPath, "ed25519", {
    canisterId: "aaaaa-aa",
    databaseId: "db_browser",
    networkUrl: "https://icp-api.io"
  });
  assert.equal((await stat(generatedEnvPath)).mode & 0o777, 0o600);
  assert.equal((await loadIcpdbServiceEnvFile(generatedEnvPath)).ICPDB_IDENTITY_JSON, writtenGenerated.identityJson);
  assert.equal((await loadIcpdbServiceEnvFile(generatedEnvPath)).ICPDB_IDENTITY_PRINCIPAL, writtenGenerated.principal);
  assert.equal((await loadIcpdbServiceEnvFile(generatedEnvPath)).ICPDB_CANISTER_ID, "aaaaa-aa");
  assert.equal((await loadIcpdbServiceEnvFile(generatedEnvPath)).ICPDB_DATABASE_ID, "db_browser");
  assert.equal((await loadIcpdbServiceEnvFile(generatedEnvPath)).ICPDB_URL, "icpdb://aaaaa-aa/db_browser");
  assert.equal((await loadIcpdbServiceEnvFile(generatedEnvPath)).ICPDB_NETWORK_URL, "https://icp-api.io");
  const directServiceLowLevelClient = await createIcpdbServiceClient({
    connectionUrl: "icpdb://aaaaa-aa/db_sdk",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  });
  assert.equal(directServiceLowLevelClient.connectionUrl(), "icpdb://aaaaa-aa/db_sdk");
  const directServiceDatabase = await connectIcpdbServiceDatabase({
    connectionUrl: "icpdb://aaaaa-aa/db_sdk",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  });
  assert.equal(directServiceDatabase.connectionUrl(), "icpdb://aaaaa-aa/db_sdk");
  const directServiceSqlClient = await createIcpdbServiceSqlClient({
    connectionUrl: "icpdb://aaaaa-aa/db_sdk",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  });
  assert.equal(await directServiceSqlClient.connectionUrl(), "icpdb://aaaaa-aa/db_sdk");
  directServiceSqlClient.close();
  await assert.rejects(() => createIcpdbServiceClient({
    url: "icpdb://aaaaa-aa/db_sdk",
    connectionUrl: "icpdb://aaaaa-aa/db_sdk",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  }), /use either url or connectionUrl, not both/);
  await assert.rejects(() => createIcpdbServiceDatabase({
    connectionUrl: "icpdb://aaaaa-aa/db_sdk",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  }), /createIcpdbServiceDatabase creates a new database; omit databaseId and use a canister-only ICPDB url/);
  await assert.rejects(() => createIcpdbServiceDatabase({
    url: "icpdb://aaaaa-aa",
    connectionUrl: "icpdb://aaaaa-aa",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  }), /use either url or connectionUrl, not both/);
  const generatedTrimmedEnvPath = join(tempDir, "generated-trimmed.env");
  await writeGeneratedIcpdbServiceEnvFile(` ${generatedTrimmedEnvPath} `, "ed25519");
  assert.equal((await stat(generatedTrimmedEnvPath)).mode & 0o777, 0o600);
  await assert.rejects(() => writeGeneratedIcpdbServiceEnvFile("   ", "ed25519"), /service env file path must be a non-empty string/);
  await assert.rejects(() => writeGeneratedIcpdbServiceEnvFile(join(tempDir, "bad-target.env"), "ed25519", null), /service identity target must be an object/);
  await assert.rejects(() => writeIcpdbServiceEnvFile("   ", { ICPDB_CANISTER_ID: "aaaaa-aa" }), /service env file path must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServiceEnvFile("   "), /service env file path must be a non-empty string/);
  await assert.rejects(() => checkIcpdbServiceEnvFileMode("   "), /service env file path must be a non-empty string/);
  await assert.rejects(() => persistIcpdbServiceDatabaseId("   ", "db_next"), /service env file path must be a non-empty string/);
  const secretIdentityPath = join(tempDir, "service-identity.json");
  await writeFile(secretIdentityPath, writtenGenerated.identityJson, { mode: 0o600 });
  await chmod(secretIdentityPath, 0o600);
  assert.equal(await loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_PRINCIPAL: writtenGenerated.principal,
    ICPDB_IDENTITY_JSON_FILE: secretIdentityPath
  }), writtenGenerated.principal);
  assert.equal(await loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_TYPE: ` ${writtenGenerated.identityType} `,
    ICPDB_IDENTITY_PRINCIPAL: ` ${writtenGenerated.principal} `,
    ICPDB_IDENTITY_JSON_FILE: ` ${secretIdentityPath} `
  }), writtenGenerated.principal);
  assert.equal(await loadIcpdbServicePrincipal({
    identityType: ` ${writtenGenerated.identityType} `,
    identityPrincipal: ` ${writtenGenerated.principal} `,
    identityJson: writtenGenerated.identityJson
  }), writtenGenerated.principal);
  await assert.rejects(() => loadIcpdbServicePrincipal({
    identityType: "unsafe",
    identityJson: writtenGenerated.identityJson
  }), /ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1/);
  assert.deepEqual(await inspectIcpdbServiceEnv({
    ICPDB_CANISTER_ID: " aaaaa-aa ",
    ICPDB_DATABASE_ID: " db_existing ",
    ICPDB_URL: " icpdb://aaaaa-aa/db_existing ",
    ICPDB_NETWORK_URL: " http://127.0.0.1:8001 ",
    ICPDB_IDENTITY_TYPE: ` ${writtenGenerated.identityType} `,
    ICPDB_IDENTITY_PRINCIPAL: ` ${writtenGenerated.principal} `,
    ICPDB_IDENTITY_JSON_FILE: ` ${secretIdentityPath} `
  }), {
    canisterId: "aaaaa-aa",
    hasDatabase: true,
    databaseId: "db_existing",
    connectionUrl: "icpdb://aaaaa-aa/db_existing",
    url: "icpdb://aaaaa-aa/db_existing",
    networkUrl: "http://127.0.0.1:8001",
    principal: writtenGenerated.principal,
    identityType: writtenGenerated.identityType,
    hasRootKey: false,
    hasSetupSql: false,
    setupStatementCount: 0,
    setupMigrationCount: 0
  });
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_PRINCIPAL: "aaaaa-aa",
    ICPDB_IDENTITY_JSON_FILE: secretIdentityPath
  }), /service identity principal mismatch/);
  const openSecretIdentityPath = join(tempDir, "open-service-identity.json");
  await writeFile(openSecretIdentityPath, writtenGenerated.identityJson, { mode: 0o644 });
  await chmod(openSecretIdentityPath, 0o644);
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON_FILE: openSecretIdentityPath
  }), /service identity file must be owner-only/);
  const emptySecretIdentityPath = join(tempDir, "empty-service-identity.json");
  await writeFile(emptySecretIdentityPath, "   \n", { mode: 0o600 });
  await chmod(emptySecretIdentityPath, 0o600);
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON_FILE: emptySecretIdentityPath
  }), /service identity file must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServiceIdentity({
    identityJson: "   ",
    identityType: writtenGenerated.identityType
  }), /identityJson must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServiceIdentity({
    identityPem: "   ",
    identityType: writtenGenerated.identityType
  }), /identityPem must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServiceIdentity({
    identityJson: writtenGenerated.identityJson,
    identityJsonFile: secretIdentityPath,
    identityType: writtenGenerated.identityType
  }), /service identity must use exactly one secret source: identityJson, identityJsonFile/);
  await assert.rejects(() => loadIcpdbServiceIdentity({
    identityJsonFile: "   ",
    identityType: writtenGenerated.identityType
  }), /service identity file path must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
    ICPDB_IDENTITY_JSON_FILE: secretIdentityPath
  }), /service identity must use exactly one secret source: identityJson, identityJsonFile/);
  const persistedExistingPath = join(tempDir, "persisted-existing.env");
  await writeIcpdbServiceEnvFile(persistedExistingPath, {
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "db_existing",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  });
  assert.deepEqual(await inspectIcpdbServiceEnvFile(persistedExistingPath), {
    canisterId: "aaaaa-aa",
    hasDatabase: true,
    databaseId: "db_existing",
    connectionUrl: "icpdb://aaaaa-aa/db_existing",
    principal: writtenGenerated.principal,
    identityType: "ed25519",
    hasRootKey: false,
    hasSetupSql: false,
    setupStatementCount: 0,
    setupMigrationCount: 0
  });
  assert.deepEqual(await inspectIcpdbServiceEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_sdk",
    ICPDB_NETWORK_URL: "http://127.0.0.1:8001",
    ICPDB_ROOT_KEY: "abcd",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
    ICPDB_SETUP_SQL: "CREATE TABLE inspect_setup(id INTEGER);",
    ICPDB_SETUP_STATEMENTS: "[{\"sql\":\"INSERT INTO inspect_setup(id) VALUES (:id)\",\"args\":{\"id\":1}}]",
    ICPDB_SETUP_MIGRATIONS: "[{\"version\":\"inspect-001\",\"sql\":\"CREATE TABLE inspect_migrated(id INTEGER);\"}]"
  }), {
    canisterId: "aaaaa-aa",
    hasDatabase: true,
    databaseId: "db_sdk",
    url: "icpdb://aaaaa-aa/db_sdk",
    connectionUrl: "icpdb://aaaaa-aa/db_sdk",
    networkUrl: "http://127.0.0.1:8001",
    principal: writtenGenerated.principal,
    identityType: "ed25519",
    hasRootKey: true,
    hasSetupSql: true,
    setupStatementCount: 1,
    setupMigrationCount: 1
  });
  await assert.rejects(() => inspectIcpdbServiceEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_sdk",
    ICPDB_DATABASE_ID: "db_other",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_DATABASE_ID does not match ICPDB_URL/);
  await assert.rejects(() => createIcpdbServiceClientFromEnv({
    ICPDB_CANISTER_ID: "bbbbb-bb",
    ICPDB_URL: "icpdb://aaaaa-aa/db_existing",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_CANISTER_ID does not match ICPDB_URL/);
  await assert.rejects(() => createIcpdbServiceSqlClientFromEnv({
    ICPDB_DATABASE_ID: "db_other",
    ICPDB_URL: "icpdb://aaaaa-aa/db_existing",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_DATABASE_ID does not match ICPDB_URL/);
  await assert.rejects(() => createIcpdbServiceSqlClientFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_DATABASE_ID must be a non-empty string/);
  await assert.rejects(() => createIcpdbServiceSqlClient({
    canisterId: "aaaaa-aa",
    databaseId: "db_existing",
    identityJson: "[]",
    setupSql: "CREATE TABLE invalid_service_existing_setup(id INTEGER);"
  }), /setupSql\/setupStatements\/setupMigrations require creating a database/);
  await assert.rejects(() => createIcpdbServiceSqlClientFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "db_existing",
    ICPDB_IDENTITY_JSON: "[]",
    ICPDB_SETUP_SQL: "CREATE TABLE invalid_service_existing_setup(id INTEGER);"
  }), /setupSql\/setupStatements\/setupMigrations require creating a database/);
  const persistedEmptyDatabasePath = join(tempDir, "persisted-empty-database.env");
  await writeFile(persistedEmptyDatabasePath, [
    'ICPDB_CANISTER_ID="aaaaa-aa"',
    'ICPDB_DATABASE_ID=""',
    `ICPDB_IDENTITY_TYPE="${writtenGenerated.identityType}"`,
    `ICPDB_IDENTITY_JSON=${JSON.stringify(writtenGenerated.identityJson)}`
  ].join("\n") + "\n", { mode: 0o600 });
  await chmod(persistedEmptyDatabasePath, 0o600);
  await assert.rejects(async () => {
    await (await createIcpdbPersistedServiceSqlClientFromEnvFile(persistedEmptyDatabasePath)).databaseId();
  }, /ICPDB_DATABASE_ID must be a non-empty string/);
  await assert.rejects(() => createIcpdbServiceDatabaseFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "db_existing",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /createIcpdbServiceDatabaseFromEnv creates a new database/);
  await assert.rejects(() => createIcpdbServiceDatabaseFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_existing",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /createIcpdbServiceDatabaseFromEnv creates a new database/);
  await assert.rejects(() => createIcpdbServiceDatabase({
    canisterId: "aaaaa-aa",
    databaseId: "db_existing",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  }), /createIcpdbServiceDatabase creates a new database/);
  await assert.rejects(() => createIcpdbServiceDatabase({
    url: "icpdb://aaaaa-aa/db_existing",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  }), /createIcpdbServiceDatabase creates a new database/);
  await assert.rejects(() => provisionIcpdbServiceDatabaseEnvFile({
    canisterId: "aaaaa-aa",
    databaseId: "db_existing",
    identityType: writtenGenerated.identityType,
    identityJson: writtenGenerated.identityJson
  }, join(tempDir, "should-not-write.env")), /createIcpdbServiceDatabase creates a new database/);
  const invalidProvisionCreateCalls = [];
  const originalInvalidProvisionActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      invalidProvisionCreateCalls.push({ method: "create_database" });
      return { Ok: "db_should_not_create" };
    },
    delete_database: async (databaseId) => {
      invalidProvisionCreateCalls.push({ method: "delete_database", databaseId });
      return { Ok: null };
    }
  });
  try {
    const validOwnerProvisionOptions = {
      canisterId: "aaaaa-aa",
      identityType: writtenGenerated.identityType,
      identityJson: writtenGenerated.identityJson
    };
    await assert.rejects(() => provisionIcpdbServiceDatabaseEnvFile(
      validOwnerProvisionOptions,
      join(tempDir, "invalid-role-before-create.env"),
      "admin"
    ), /database role must be reader, writer, or owner/);
    await assert.rejects(() => provisionIcpdbServiceDatabaseEnvFile(
      validOwnerProvisionOptions,
      join(tempDir, "invalid-service-identity-before-create.env"),
      "writer",
      "unsafe"
    ), /ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1/);
    await assert.rejects(() => provisionIcpdbServiceDatabaseEnvFile(
      validOwnerProvisionOptions,
      join(tempDir, "invalid-extra-env-before-create.env"),
      "writer",
      "ed25519",
      null
    ), /extra service env must be an object/);
    assert.deepEqual(invalidProvisionCreateCalls, []);
  } finally {
    Actor.createActor = originalInvalidProvisionActor;
  }
  await assert.rejects(() => connectIcpdbServiceDatabaseFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /databaseId is required/);
  await assert.rejects(() => connectDatabaseFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /databaseId is required/);
  await assert.rejects(() => createClientFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /createClientFromEnv requires a database-bearing ICPDB_URL or ICPDB_DATABASE_ID/);
  const connectedServiceClient = await connectClientFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_existing",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  });
  assert.equal(await connectedServiceClient.principal(), writtenGenerated.principal);
  assert.equal(await connectedServiceClient.databaseId(), "db_existing");
  connectedServiceClient.close();
  await assert.rejects(() => connectClientFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /connectClientFromEnv requires a database-bearing ICPDB_URL or ICPDB_DATABASE_ID/);
  const persistedExistingClient = await createIcpdbPersistedServiceSqlClientFromEnvFile(persistedExistingPath);
  assert.equal(await persistedExistingClient.principal(), writtenGenerated.principal);
  assert.equal(await persistedExistingClient.databaseId(), "db_existing");
  persistedExistingClient.close();
  const persistedLazyPath = join(tempDir, "persisted-lazy.env");
  await writeIcpdbServiceEnvFile(persistedLazyPath, {
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  });
  const persistedLazyClient = await createIcpdbPersistedServiceSqlClientFromEnvFile(persistedLazyPath);
  assert.equal(await persistedLazyClient.principal(), writtenGenerated.principal);
  persistedLazyClient.close();
  const persistedCanisterUrlPath = join(tempDir, "persisted-canister-url.env");
  await writeIcpdbServiceEnvFile(persistedCanisterUrlPath, {
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  });
  let persistedCreateDatabaseCalls = 0;
  const persistedSqlExecuteDatabaseIds = [];
  const originalCreateActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      persistedCreateDatabaseCalls += 1;
      return { Ok: "db_persisted_auto" };
    },
    sql_execute: async (request) => {
      persistedSqlExecuteDatabaseIds.push(request.database_id);
      return {
        Ok: {
          columns: [],
          rows: [],
          rows_affected: 1n,
          last_insert_rowid: 0n,
          truncated: false,
          routed_operation_id: []
        }
      };
    }
  });
  try {
    const persistedCanisterUrlClient = await createIcpdbPersistedServiceSqlClientFromEnvFile(persistedCanisterUrlPath);
    await persistedCanisterUrlClient.execute("CREATE TABLE persisted_auto(id INTEGER)");
    assert.equal(await persistedCanisterUrlClient.databaseId(), "db_persisted_auto");
    assert.deepEqual(await loadIcpdbServiceEnvFile(persistedCanisterUrlPath), {
      ICPDB_URL: "icpdb://aaaaa-aa/db_persisted_auto",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
      ICPDB_DATABASE_ID: "db_persisted_auto"
    });
    persistedCanisterUrlClient.close();
    await persistedCanisterUrlClient.execute("INSERT INTO persisted_auto(id) VALUES (1)");
    assert.equal(persistedCreateDatabaseCalls, 1);
    assert.deepEqual(persistedSqlExecuteDatabaseIds, ["db_persisted_auto", "db_persisted_auto"]);
  } finally {
    Actor.createActor = originalCreateActor;
  }
  const persistedFirstReadPath = join(tempDir, "persisted-first-read.env");
  await writeIcpdbServiceEnvFile(persistedFirstReadPath, {
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
    ICPDB_SETUP_SQL: `
      CREATE TABLE service_first_read(id INTEGER PRIMARY KEY, body TEXT);
      INSERT INTO service_first_read(body) VALUES ('from-service-first-read-setup');
    `
  });
  const persistedFirstReadCalls = [];
  const originalFirstReadActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      persistedFirstReadCalls.push({ method: "create_database" });
      return { Ok: "db_service_first_read" };
    },
    sql_batch: async (request) => {
      persistedFirstReadCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    },
    sql_query: async (request) => {
      persistedFirstReadCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["body"], [[{ Text: "from-service-first-read-setup" }]], 0n, 0n);
    }
  });
  try {
    const persistedFirstReadClient = await createClientFromEnvFile(persistedFirstReadPath);
    assert.equal((await persistedFirstReadClient.get("SELECT body FROM service_first_read"))?.body, "from-service-first-read-setup");
    assert.equal(await persistedFirstReadClient.databaseId(), "db_service_first_read");
    assert.equal(await persistedFirstReadClient.connectionUrl(), "icpdb://aaaaa-aa/db_service_first_read");
    assert.deepEqual(await loadIcpdbServiceEnvFile(persistedFirstReadPath), {
      ICPDB_URL: "icpdb://aaaaa-aa/db_service_first_read",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
      ICPDB_DATABASE_ID: "db_service_first_read"
    });
    assert.deepEqual(persistedFirstReadCalls, [
      { method: "create_database" },
      {
        method: "batch",
        databaseId: "db_service_first_read",
        statements: [
          "CREATE TABLE service_first_read(id INTEGER PRIMARY KEY, body TEXT)",
          "INSERT INTO service_first_read(body) VALUES ('from-service-first-read-setup')"
        ]
      },
      { method: "query", databaseId: "db_service_first_read", sql: "SELECT body FROM service_first_read" }
    ]);
  } finally {
    Actor.createActor = originalFirstReadActor;
  }
  const persistedQueryOnlyPath = join(tempDir, "persisted-query-only.env");
  await writeIcpdbServiceEnvFile(persistedQueryOnlyPath, {
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  });
  const persistedQueryOnlyCalls = [];
  const originalQueryOnlyActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      persistedQueryOnlyCalls.push({ method: "create_database" });
      return { Ok: "db_service_query_only" };
    },
    sql_query: async (request) => {
      persistedQueryOnlyCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["value"], [[{ Integer: "1" }]], 0n, 0n);
    }
  });
  try {
    const persistedQueryOnlyClient = await createClientFromEnvFile(persistedQueryOnlyPath);
    assert.equal(await persistedQueryOnlyClient.scalar("SELECT 1 AS value"), "1");
    assert.equal(await persistedQueryOnlyClient.databaseId(), "db_service_query_only");
    assert.equal(await persistedQueryOnlyClient.connectionUrl(), "icpdb://aaaaa-aa/db_service_query_only");
    assert.deepEqual(await loadIcpdbServiceEnvFile(persistedQueryOnlyPath), {
      ICPDB_URL: "icpdb://aaaaa-aa/db_service_query_only",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
      ICPDB_DATABASE_ID: "db_service_query_only"
    });
    assert.deepEqual(persistedQueryOnlyCalls, [
      { method: "create_database" },
      { method: "query", databaseId: "db_service_query_only", sql: "SELECT 1 AS value" }
    ]);
  } finally {
    Actor.createActor = originalQueryOnlyActor;
  }
  const persistedSetupStatementsFirstReadPath = join(tempDir, "persisted-setup-statements-first-read.env");
  await writeIcpdbServiceEnvFile(persistedSetupStatementsFirstReadPath, {
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
    ICPDB_SETUP_STATEMENTS: JSON.stringify([
      "CREATE TABLE service_setup_statement_read(id INTEGER PRIMARY KEY, body TEXT)",
      { sql: "INSERT INTO service_setup_statement_read(body) VALUES (:body)", args: { body: "from-service-setup-statements-first-read" } }
    ])
  });
  const persistedSetupStatementsFirstReadCalls = [];
  const originalSetupStatementsFirstReadActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      persistedSetupStatementsFirstReadCalls.push({ method: "create_database" });
      return { Ok: "db_service_setup_statements_first_read" };
    },
    sql_batch: async (request) => {
      persistedSetupStatementsFirstReadCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => ({
          sql: statement.sql,
          params: statement.params
        }))
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    },
    sql_query: async (request) => {
      persistedSetupStatementsFirstReadCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql });
      return rawSqlOk(["body"], [[{ Text: "from-service-setup-statements-first-read" }]], 0n, 0n);
    }
  });
  try {
    const persistedSetupStatementsFirstReadClient = await createClientFromEnvFile(persistedSetupStatementsFirstReadPath);
    assert.equal(
      (await persistedSetupStatementsFirstReadClient.get("SELECT body FROM service_setup_statement_read"))?.body,
      "from-service-setup-statements-first-read"
    );
    assert.equal(await persistedSetupStatementsFirstReadClient.databaseId(), "db_service_setup_statements_first_read");
    assert.equal(await persistedSetupStatementsFirstReadClient.connectionUrl(), "icpdb://aaaaa-aa/db_service_setup_statements_first_read");
    assert.deepEqual(await loadIcpdbServiceEnvFile(persistedSetupStatementsFirstReadPath), {
      ICPDB_URL: "icpdb://aaaaa-aa/db_service_setup_statements_first_read",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
      ICPDB_DATABASE_ID: "db_service_setup_statements_first_read"
    });
    assert.deepEqual(persistedSetupStatementsFirstReadCalls, [
      { method: "create_database" },
      {
        method: "batch",
        databaseId: "db_service_setup_statements_first_read",
        statements: [
          { sql: "CREATE TABLE service_setup_statement_read(id INTEGER PRIMARY KEY, body TEXT)", params: [] },
          { sql: "INSERT INTO service_setup_statement_read(body) VALUES (:body)", params: [{ Text: "from-service-setup-statements-first-read" }] }
        ]
      },
      { method: "query", databaseId: "db_service_setup_statements_first_read", sql: "SELECT body FROM service_setup_statement_read" }
    ]);
  } finally {
    Actor.createActor = originalSetupStatementsFirstReadActor;
  }
  const persistedSetupMigrationsFirstReadPath = join(tempDir, "persisted-setup-migrations-first-read.env");
  await writeIcpdbServiceEnvFile(persistedSetupMigrationsFirstReadPath, {
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
    ICPDB_SETUP_MIGRATIONS: JSON.stringify([
      {
        version: "001",
        name: "create_service_migration_read",
        sql: `
          CREATE TABLE service_migration_read(id INTEGER PRIMARY KEY, body TEXT);
          INSERT INTO service_migration_read(body) VALUES ('from-service-migration-first-read');
        `
      }
    ])
  });
  const persistedSetupMigrationsFirstReadCalls = [];
  const originalSetupMigrationsFirstReadActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      persistedSetupMigrationsFirstReadCalls.push({ method: "create_database" });
      return { Ok: "db_service_setup_migrations_first_read" };
    },
    sql_query: async (request) => {
      persistedSetupMigrationsFirstReadCalls.push({ method: "query", databaseId: request.database_id, sql: request.sql, params: request.params });
      if (request.sql.includes("sqlite_master")) return rawSqlOk(["name"], [], 0n, 0n);
      if (request.sql.includes("icpdb_schema_migrations")) return rawSqlOk(["version"], [], 0n, 0n);
      return rawSqlOk(["body"], [[{ Text: "from-service-migration-first-read" }]], 0n, 0n);
    },
    sql_batch: async (request) => {
      persistedSetupMigrationsFirstReadCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    }
  });
  try {
    const persistedSetupMigrationsFirstReadClient = await createClientFromEnvFile(persistedSetupMigrationsFirstReadPath);
    assert.equal(
      (await persistedSetupMigrationsFirstReadClient.get("SELECT body FROM service_migration_read"))?.body,
      "from-service-migration-first-read"
    );
    assert.equal(await persistedSetupMigrationsFirstReadClient.databaseId(), "db_service_setup_migrations_first_read");
    assert.equal(await persistedSetupMigrationsFirstReadClient.connectionUrl(), "icpdb://aaaaa-aa/db_service_setup_migrations_first_read");
    assert.deepEqual(await loadIcpdbServiceEnvFile(persistedSetupMigrationsFirstReadPath), {
      ICPDB_URL: "icpdb://aaaaa-aa/db_service_setup_migrations_first_read",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
      ICPDB_DATABASE_ID: "db_service_setup_migrations_first_read"
    });
    assert.deepEqual(persistedSetupMigrationsFirstReadCalls.map((call) => call.method === "query" ? { method: call.method, databaseId: call.databaseId, sql: call.sql } : call), [
      { method: "create_database" },
      {
        method: "query",
        databaseId: "db_service_setup_migrations_first_read",
        sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1"
      },
      {
        method: "batch",
        databaseId: "db_service_setup_migrations_first_read",
        statements: [
          "CREATE TABLE icpdb_schema_migrations(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at_ms TEXT NOT NULL)"
        ]
      },
      {
        method: "query",
        databaseId: "db_service_setup_migrations_first_read",
        sql: "SELECT version FROM icpdb_schema_migrations ORDER BY version"
      },
      {
        method: "batch",
        databaseId: "db_service_setup_migrations_first_read",
        statements: [
          "CREATE TABLE service_migration_read(id INTEGER PRIMARY KEY, body TEXT)",
          "INSERT INTO service_migration_read(body) VALUES ('from-service-migration-first-read')",
          "INSERT INTO icpdb_schema_migrations(version, name, applied_at_ms) VALUES (?1, ?2, ?3)"
        ]
      },
      { method: "query", databaseId: "db_service_setup_migrations_first_read", sql: "SELECT body FROM service_migration_read" }
    ]);
  } finally {
    Actor.createActor = originalSetupMigrationsFirstReadActor;
  }
  const persistedInfoFirstPath = join(tempDir, "persisted-info-first.env");
  await writeIcpdbServiceEnvFile(persistedInfoFirstPath, {
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
    ICPDB_SETUP_SQL: "CREATE TABLE service_info_first(id INTEGER PRIMARY KEY, body TEXT);"
  });
  const persistedInfoFirstCalls = [];
  const originalInfoFirstActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      persistedInfoFirstCalls.push({ method: "create_database" });
      return { Ok: "db_service_info_first" };
    },
    sql_batch: async (request) => {
      persistedInfoFirstCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    }
  });
  try {
    const persistedInfoFirstClient = await createClientFromEnvFile(persistedInfoFirstPath);
    assert.deepEqual(await persistedInfoFirstClient.info(), {
      canisterId: "aaaaa-aa",
      databaseId: "db_service_info_first",
      connectionUrl: "icpdb://aaaaa-aa/db_service_info_first",
      url: "icpdb://aaaaa-aa/db_service_info_first",
      principal: writtenGenerated.principal
    });
    assert.deepEqual(await loadIcpdbServiceEnvFile(persistedInfoFirstPath), {
      ICPDB_URL: "icpdb://aaaaa-aa/db_service_info_first",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
      ICPDB_DATABASE_ID: "db_service_info_first"
    });
    assert.deepEqual(persistedInfoFirstCalls, [
      { method: "create_database" },
      {
        method: "batch",
        databaseId: "db_service_info_first",
        statements: ["CREATE TABLE service_info_first(id INTEGER PRIMARY KEY, body TEXT)"]
      }
    ]);
  } finally {
    Actor.createActor = originalInfoFirstActor;
  }
  const persistedUrlFirstPath = join(tempDir, "persisted-url-first.env");
  await writeIcpdbServiceEnvFile(persistedUrlFirstPath, {
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
    ICPDB_SETUP_SQL: "CREATE TABLE service_url_first(id INTEGER PRIMARY KEY, body TEXT);"
  });
  const persistedUrlFirstCalls = [];
  const originalUrlFirstActor = Actor.createActor;
  Actor.createActor = () => ({
    create_database: async () => {
      persistedUrlFirstCalls.push({ method: "create_database" });
      return { Ok: "db_service_url_first" };
    },
    sql_batch: async (request) => {
      persistedUrlFirstCalls.push({
        method: "batch",
        databaseId: request.database_id,
        statements: request.statements.map((statement) => statement.sql)
      });
      return { Ok: request.statements.map(() => rawSqlOk([], [], 1n, 0n).Ok) };
    }
  });
  try {
    const persistedUrlFirstClient = await createClientFromEnvFile(persistedUrlFirstPath);
    assert.equal(await persistedUrlFirstClient.connectionUrl(), "icpdb://aaaaa-aa/db_service_url_first");
    assert.equal(await persistedUrlFirstClient.url(), "icpdb://aaaaa-aa/db_service_url_first");
    assert.deepEqual(await loadIcpdbServiceEnvFile(persistedUrlFirstPath), {
      ICPDB_URL: "icpdb://aaaaa-aa/db_service_url_first",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
      ICPDB_DATABASE_ID: "db_service_url_first"
    });
    assert.deepEqual(persistedUrlFirstCalls, [
      { method: "create_database" },
      {
        method: "batch",
        databaseId: "db_service_url_first",
        statements: ["CREATE TABLE service_url_first(id INTEGER PRIMARY KEY, body TEXT)"]
      }
    ]);
  } finally {
    Actor.createActor = originalUrlFirstActor;
  }
  const persistedDbBearingSetupPath = join(tempDir, "persisted-db-bearing-setup.env");
  await writeIcpdbServiceEnvFile(persistedDbBearingSetupPath, {
    ICPDB_URL: "icpdb://aaaaa-aa/db_existing",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson,
    ICPDB_SETUP_SQL: "CREATE TABLE stale_setup(id INTEGER);"
  });
  await assert.rejects(async () => (await createClientFromEnvFile(persistedDbBearingSetupPath)).databaseId(), /setupSql\/setupStatements\/setupMigrations require creating a database/);
  await assert.rejects(async () => (await connectClientFromEnvFile(persistedDbBearingSetupPath)).databaseId(), /setupSql\/setupStatements\/setupMigrations require creating a database/);
  const connectOnlyCanisterPath = join(tempDir, "connect-only-canister.env");
  await writeIcpdbServiceEnvFile(connectOnlyCanisterPath, {
    ICPDB_URL: "icpdb://aaaaa-aa",
    ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  });
  await assert.rejects(() => connectClientFromEnvFile(connectOnlyCanisterPath), /connectClientFromEnvFile requires a database-bearing ICPDB_URL or ICPDB_DATABASE_ID/);
  const originalCwd = process.cwd();
  try {
    await writeIcpdbServiceEnvFile(join(tempDir, "service.env"), {
      ICPDB_URL: "icpdb://aaaaa-aa/db_existing",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
    });
    process.chdir(tempDir);
    const defaultPathClient = await createClientFromEnvFile();
    assert.equal(await defaultPathClient.principal(), writtenGenerated.principal);
    assert.equal(await defaultPathClient.databaseId(), "db_existing");
    defaultPathClient.close();
    const defaultConnectPathClient = await connectClientFromEnvFile();
    assert.equal(await defaultConnectPathClient.principal(), writtenGenerated.principal);
    assert.equal(await defaultConnectPathClient.databaseId(), "db_existing");
    defaultConnectPathClient.close();
    const defaultPathServiceClient = await createIcpdbServiceClientFromEnvFile();
    assert.equal(defaultPathServiceClient.connectionUrl("db_existing"), "icpdb://aaaaa-aa/db_existing");
    const defaultPathDb = await connectIcpdbServiceDatabaseFromEnvFile();
    assert.equal(defaultPathDb.databaseId, "db_existing");
    const defaultShortPathDb = await connectDatabaseFromEnvFile();
    assert.equal(defaultShortPathDb.databaseId, "db_existing");
    await assert.rejects(() => createDatabaseFromEnvFile(), /createIcpdbServiceDatabaseFromEnv creates a new database/);
    const defaultPathSqlClient = await createIcpdbServiceSqlClientFromEnvFile();
    assert.equal(await defaultPathSqlClient.databaseId(), "db_existing");
    defaultPathSqlClient.close();
    assert.deepEqual(await checkIcpdbServiceEnvFileMode(), {
      modeOctal: "0600",
      ownerOnly: true
    });
    assert.equal((await loadIcpdbServiceEnvFile()).ICPDB_URL, "icpdb://aaaaa-aa/db_existing");
    assert.equal((await inspectIcpdbServiceEnvFile()).databaseId, "db_existing");
    assert.deepEqual(await loadIcpdbServiceSetupFromEnvFile(), {
      setupSql: undefined,
      setupStatements: undefined,
      setupMigrations: undefined
    });
    assert.equal(await loadIcpdbServicePrincipalFromEnvFile(), writtenGenerated.principal);
  } finally {
    process.chdir(originalCwd);
  }
  const envPath = join(tempDir, "service.env");
  await writeFile(envPath, [
    "# service identity",
    "ICPDB_URL=icpdb://aaaaa-aa/db_sdk",
    "ICPDB_DATABASE_ID='db_sdk'",
    "ICPDB_IDENTITY_TYPE=ed25519",
    "ICPDB_IDENTITY_JSON=\"[\\\"json\\\",{\\\"_inner\\\":{}}]\"",
    "ICPDB_SETUP_SQL=\"CREATE TABLE env_setup(id INTEGER);\"",
    "ICPDB_SETUP_STATEMENTS='[{\"sql\":\"INSERT INTO env_setup(id) VALUES (:id)\",\"args\":{\"id\":1}}]'",
    "ICPDB_SETUP_MIGRATIONS='[{\"version\":\"env-001\",\"name\":\"create_env_migrated\",\"sql\":\"CREATE TABLE env_migrated(id INTEGER);\"}]'",
    ""
  ].join("\n"));
  await chmod(envPath, 0o600);
  assert.deepEqual(await checkIcpdbServiceEnvFileMode(envPath), {
    modeOctal: "0600",
    ownerOnly: true
  });
  assert.deepEqual(await loadIcpdbServiceEnvFile(envPath), {
    ICPDB_URL: "icpdb://aaaaa-aa/db_sdk",
    ICPDB_DATABASE_ID: "db_sdk",
    ICPDB_IDENTITY_TYPE: "ed25519",
    ICPDB_IDENTITY_JSON: "[\"json\",{\"_inner\":{}}]",
    ICPDB_SETUP_SQL: "CREATE TABLE env_setup(id INTEGER);",
    ICPDB_SETUP_STATEMENTS: "[{\"sql\":\"INSERT INTO env_setup(id) VALUES (:id)\",\"args\":{\"id\":1}}]",
    ICPDB_SETUP_MIGRATIONS: "[{\"version\":\"env-001\",\"name\":\"create_env_migrated\",\"sql\":\"CREATE TABLE env_migrated(id INTEGER);\"}]"
  });
  const setupSqlPath = join(tempDir, "setup.sql");
  const setupStatementsPath = join(tempDir, "setup-statements.json");
  const setupMigrationsPath = join(tempDir, "setup-migrations.json");
  const typedSetupArgs = {
    id: { kind: "integer", value: "9007199254740993" },
    note: { kind: "text", value: "typed" },
    ratio: { kind: "real", value: 1.5 },
    payload: { kind: "blob", value: [1, 2, 3] },
    none: { kind: "null" }
  };
  await writeFile(setupSqlPath, "CREATE TABLE file_setup(id INTEGER);\n");
  await writeFile(setupStatementsPath, JSON.stringify([
    { sql: "SELECT :id, :note, :ratio, :payload, :none", args: typedSetupArgs }
  ]));
  await writeFile(setupMigrationsPath, JSON.stringify([
    { version: "file-001", name: "create_file_migrated", sql: "CREATE TABLE file_migrated(id INTEGER);" }
  ]));
  const fileSetupEnvPath = join(tempDir, "file-setup.env");
  await writeFile(fileSetupEnvPath, [
    `ICPDB_SETUP_SQL_FILE=${JSON.stringify(setupSqlPath)}`,
    `ICPDB_SETUP_STATEMENTS_FILE=${JSON.stringify(setupStatementsPath)}`,
    `ICPDB_SETUP_MIGRATIONS_FILE=${JSON.stringify(setupMigrationsPath)}`,
    ""
  ].join("\n"));
  await chmod(fileSetupEnvPath, 0o600);
  assert.deepEqual(await loadIcpdbServiceSetupFromEnvFile(fileSetupEnvPath), {
    setupSql: "CREATE TABLE file_setup(id INTEGER);\n",
    setupStatements: [{ sql: "SELECT :id, :note, :ratio, :payload, :none", args: typedSetupArgs }],
    setupMigrations: [{ version: "file-001", name: "create_file_migrated", sql: "CREATE TABLE file_migrated(id INTEGER);" }]
  });
  assert.deepEqual(await loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_STATEMENTS: JSON.stringify([{ sql: "SELECT :id, :payload, :none", args: {
      id: { kind: "integer", value: "9007199254740993" },
      payload: { kind: "blob", value: [1, 2, 3] },
      none: { kind: "null" }
    } }])
  }), {
    setupSql: undefined,
    setupStatements: [{ sql: "SELECT :id, :payload, :none", args: {
      id: { kind: "integer", value: "9007199254740993" },
      payload: { kind: "blob", value: [1, 2, 3] },
      none: { kind: "null" }
    } }],
    setupMigrations: undefined
  });
  const openServiceEnvPath = join(tempDir, "open-service.env");
  await writeFile(openServiceEnvPath, "ICPDB_CANISTER_ID=aaaaa-aa\nICPDB_IDENTITY_JSON=[]\n");
  await chmod(openServiceEnvPath, 0o644);
  await assert.rejects(() => checkIcpdbServiceEnvFileMode(openServiceEnvPath), /owner-only/);
  await assert.rejects(() => loadIcpdbServiceEnvFile(openServiceEnvPath), /owner-only/);
  await assert.rejects(() => inspectIcpdbServiceEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_NETWORK_URL: "",
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_NETWORK_URL must be a non-empty string/);
  await assert.rejects(() => inspectIcpdbServiceEnv({
    ICPDB_CANISTER_ID: "   ",
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_CANISTER_ID must be a non-empty string/);
  await assert.rejects(() => inspectIcpdbServiceEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "   ",
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_DATABASE_ID must be a non-empty string/);
  await assert.rejects(() => inspectIcpdbServiceEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_ROOT_KEY: "",
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_ROOT_KEY must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_JSON: ""
  }), /ICPDB_IDENTITY_JSON must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_PRINCIPAL: "",
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_IDENTITY_PRINCIPAL must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_JSON_FILE: ""
  }), /ICPDB_IDENTITY_JSON_FILE must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv({
    ICPDB_IDENTITY_TYPE: "rsa",
    ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
  }), /ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_SQL: "SELECT 1",
    ICPDB_SETUP_SQL_FILE: setupSqlPath
  }), /ICPDB_SETUP_SQL and ICPDB_SETUP_SQL_FILE cannot both be set/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_SQL: ""
  }), /ICPDB_SETUP_SQL must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_SQL_FILE: "  "
  }), /ICPDB_SETUP_SQL_FILE must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_STATEMENTS: ""
  }), /ICPDB_SETUP_STATEMENTS must be a non-empty string/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_STATEMENTS: "[]"
  }), /ICPDB_SETUP_STATEMENTS must be a non-empty JSON array/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_MIGRATIONS: "[]"
  }), /ICPDB_SETUP_MIGRATIONS must be a non-empty JSON array/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_STATEMENTS: JSON.stringify([{ sql: "SELECT :id", args: { id: { kind: "integer", value: "1.5" } } }])
  }), /ICPDB_SETUP_STATEMENTS\[0\]\.args\.id\.value must be a base-10 integer string/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_STATEMENTS: JSON.stringify([{ sql: "SELECT :id", args: { id: { kind: "json", value: {} } } }])
  }), /ICPDB_SETUP_STATEMENTS\[0\]\.args\.id\.kind must be null, integer, real, text, or blob/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_STATEMENTS: JSON.stringify([{ sql: "SELECT :payload", args: { payload: { kind: "blob", value: [256] } } }])
  }), /ICPDB_SETUP_STATEMENTS\[0\]\.args\.payload\.value\[0\] must be an integer byte/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_MIGRATIONS_FILE: ""
  }), /ICPDB_SETUP_MIGRATIONS_FILE must be a non-empty string/);
  const invalidSetupStatementsPath = join(tempDir, "invalid-statements.json");
  await writeFile(invalidSetupStatementsPath, "{");
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv({
    ICPDB_SETUP_STATEMENTS_FILE: invalidSetupStatementsPath
  }), /ICPDB_SETUP_STATEMENTS must be JSON/);
  assert.equal(formatIcpdbServiceEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: undefined,
    ICPDB_IDENTITY_JSON: "[\"json\"]"
  }), "ICPDB_CANISTER_ID=\"aaaaa-aa\"\nICPDB_IDENTITY_JSON=\"[\\\"json\\\"]\"\n");
  assert.throws(() => formatIcpdbServiceEnv(null), /service env must be an object/);
  assert.throws(() => formatIcpdbServiceEnv([]), /service env must be an object/);
  await assert.rejects(() => loadIcpdbServicePrincipalFromEnv(null), /service env must be an object/);
  await assert.rejects(() => inspectIcpdbServiceEnv(null), /service env must be an object/);
  await assert.rejects(() => loadIcpdbServiceSetupFromEnv(null), /service env must be an object/);
  assert.throws(() => formatIcpdbServiceEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "",
    ICPDB_IDENTITY_JSON: "[\"json\"]"
  }), /ICPDB_DATABASE_ID must be a non-empty string/);
  assert.throws(() => formatIcpdbServiceEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_DATABASE_ID: "   ",
    ICPDB_IDENTITY_JSON: "[\"json\"]"
  }), /ICPDB_DATABASE_ID must be a non-empty string/);
  assert.throws(() => formatIcpdbServiceEnv({
    "ICPDB-BAD": "bad"
  }), /ICPDB-BAD must be a valid env key/);
  await assert.rejects(() => writeIcpdbServiceEnvFile(join(tempDir, "bad-key.env"), {
    "ICPDB BAD": "bad"
  }), /ICPDB BAD must be a valid env key/);
  const writtenEnvPath = join(tempDir, "written.env");
  await writeIcpdbServiceEnvFile(writtenEnvPath, {
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_JSON: "[\"json\"]"
  });
  assert.equal((await stat(writtenEnvPath)).mode & 0o777, 0o600);
  assert.deepEqual(await persistIcpdbServiceDatabaseId(writtenEnvPath, " db_persisted "), {
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_JSON: "[\"json\"]",
    ICPDB_DATABASE_ID: "db_persisted",
    ICPDB_URL: "icpdb://aaaaa-aa/db_persisted"
  });
  assert.deepEqual(await persistIcpdbServiceDatabaseId(writtenEnvPath, "db/persisted"), {
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_JSON: "[\"json\"]",
    ICPDB_DATABASE_ID: "db/persisted",
    ICPDB_URL: "icpdb://aaaaa-aa/db%2Fpersisted"
  });
  assert.equal((await stat(writtenEnvPath)).mode & 0o777, 0o600);
  assert.deepEqual(await loadIcpdbServiceEnvFile(writtenEnvPath), {
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_JSON: "[\"json\"]",
    ICPDB_DATABASE_ID: "db/persisted",
    ICPDB_URL: "icpdb://aaaaa-aa/db%2Fpersisted"
  });
  await assert.rejects(() => persistIcpdbServiceDatabaseId(writtenEnvPath, ""), /databaseId is required/);
  await assert.rejects(() => persistIcpdbServiceDatabaseId(writtenEnvPath, "   "), /databaseId is required/);
  const mismatchedPersistEnvPath = join(tempDir, "mismatched-persist.env");
  await writeIcpdbServiceEnvFile(mismatchedPersistEnvPath, {
    ICPDB_CANISTER_ID: "bbbbb-bb",
    ICPDB_URL: "icpdb://aaaaa-aa/db_existing",
    ICPDB_IDENTITY_JSON: "[\"json\"]"
  });
  await assert.rejects(() => persistIcpdbServiceDatabaseId(mismatchedPersistEnvPath, "db_next"), /ICPDB_CANISTER_ID does not match ICPDB_URL/);
  await writeIcpdbServiceEnvFile(mismatchedPersistEnvPath, {
    ICPDB_DATABASE_ID: "db_other",
    ICPDB_URL: "icpdb://aaaaa-aa/db_existing",
    ICPDB_IDENTITY_JSON: "[\"json\"]"
  });
  await assert.rejects(() => persistIcpdbServiceDatabaseId(mismatchedPersistEnvPath, "db_next"), /ICPDB_DATABASE_ID does not match ICPDB_URL/);
  const invalidEnvPath = join(tempDir, "invalid.env");
  await writeFile(invalidEnvPath, "not valid\n");
  await chmod(invalidEnvPath, 0o600);
  await assert.rejects(() => loadIcpdbServiceEnvFile(invalidEnvPath), /invalid env file line 1/);
  const duplicateEnvPath = join(tempDir, "duplicate.env");
  await writeFile(duplicateEnvPath, "ICPDB_CANISTER_ID=\"aaaaa-aa\"\nICPDB_CANISTER_ID=\"bbbbb-bb\"\n");
  await chmod(duplicateEnvPath, 0o600);
  await assert.rejects(() => loadIcpdbServiceEnvFile(duplicateEnvPath), /duplicate env key ICPDB_CANISTER_ID/);

  const serviceSnapshotBytes = new Uint8Array((256 * 1024) + 5);
  for (let index = 0; index < serviceSnapshotBytes.byteLength; index += 1) {
    serviceSnapshotBytes[index] = index % 251;
  }
  const serviceArchivePath = join(tempDir, "service-archive.sqlite");
  const serviceRestorePath = join(tempDir, "service-restore.sqlite");
  await writeFile(serviceRestorePath, serviceSnapshotBytes);
  const serviceArchiveCalls = [];
  const restoredChunks = [];
  const serviceTransferDatabase = {
    databaseId: "db_service_transfer",
    beginArchive: async () => {
      serviceArchiveCalls.push({ method: "beginArchive" });
      return { databaseId: "db_service_transfer", sizeBytes: String(serviceSnapshotBytes.byteLength) };
    },
    readArchiveChunk: async (offset, maxBytes) => {
      serviceArchiveCalls.push({ method: "readArchiveChunk", offset, maxBytes });
      const start = Number(offset);
      return Array.from(serviceSnapshotBytes.slice(start, start + maxBytes));
    },
    finalizeArchive: async (snapshotHash) => {
      serviceArchiveCalls.push({ method: "finalizeArchive", snapshotHash });
    },
    cancelArchive: async () => {
      serviceArchiveCalls.push({ method: "cancelArchive" });
    },
    beginRestore: async (snapshotHash, sizeBytes) => {
      serviceArchiveCalls.push({ method: "beginRestore", snapshotHash, sizeBytes });
    },
    writeRestoreChunk: async (offset, bytes) => {
      serviceArchiveCalls.push({ method: "writeRestoreChunk", offset, byteLength: bytes.byteLength });
      restoredChunks.push(Array.from(bytes));
    },
    finalizeRestore: async () => {
      serviceArchiveCalls.push({ method: "finalizeRestore" });
    }
  };
  await assert.rejects(() => snapshotInfoFile("   "), /snapshot file path must be a non-empty string/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile(serviceTransferDatabase, "   "), /archive file path must be a non-empty string/);
  assert.equal(serviceArchiveCalls.length, 0);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFile(serviceTransferDatabase, "   "), /snapshot file path must be a non-empty string/);
  assert.equal(serviceArchiveCalls.length, 0);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile(null, join(tempDir, "bad-source.sqlite")), /archive database source must be an object/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile({
    ...serviceTransferDatabase,
    databaseId: "   "
  }, join(tempDir, "bad-source.sqlite")), /archive database source databaseId must be a non-empty string/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile({
    ...serviceTransferDatabase,
    beginArchive: "beginArchive"
  }, join(tempDir, "bad-source.sqlite")), /archive database source beginArchive must be a function/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFile(null, serviceRestorePath), /restore database target must be an object/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFile({
    ...serviceTransferDatabase,
    databaseId: "   "
  }, serviceRestorePath), /restore database target databaseId must be a non-empty string/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFile({
    ...serviceTransferDatabase,
    writeRestoreChunk: "writeRestoreChunk"
  }, serviceRestorePath), /restore database target writeRestoreChunk must be a function/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFile(serviceTransferDatabase, serviceRestorePath, "bad-options"), /restore options must be an object/);
  assert.equal(serviceArchiveCalls.length, 0);
  const badArchiveBeginCalls = [];
  const badArchiveBeginDatabase = {
    ...serviceTransferDatabase,
    beginArchive: async () => {
      badArchiveBeginCalls.push({ method: "beginArchive" });
      return null;
    },
    cancelArchive: async () => {
      badArchiveBeginCalls.push({ method: "cancelArchive" });
    }
  };
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile(badArchiveBeginDatabase, join(tempDir, "bad-begin.sqlite")), /archive begin result must be an object/);
  assert.deepEqual(badArchiveBeginCalls.map((call) => call.method), ["beginArchive", "cancelArchive"]);
  const malformedArchiveDatabase = {
    ...serviceTransferDatabase,
    beginArchive: async () => ({ databaseId: "db_service_transfer", sizeBytes: String(serviceSnapshotBytes.byteLength) }),
    cancelArchive: async () => {}
  };
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile({
    ...malformedArchiveDatabase,
    beginArchive: async () => ({ sizeBytes: "0" })
  }, join(tempDir, "bad-begin-database.sqlite")), /archive begin result databaseId must be a non-empty string/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile({
    ...malformedArchiveDatabase,
    beginArchive: async () => ({ databaseId: "db_other", sizeBytes: "0" })
  }, join(tempDir, "bad-begin-mismatch.sqlite")), /archive begin result databaseId does not match archive database source databaseId/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile({
    ...malformedArchiveDatabase,
    beginArchive: async () => ({ databaseId: "db_service_transfer", sizeBytes: 0 })
  }, join(tempDir, "bad-begin-size.sqlite")), /archive size_bytes must be a string/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile({
    ...malformedArchiveDatabase,
    readArchiveChunk: async () => null
  }, join(tempDir, "bad-chunk.sqlite")), /archive chunk must be a byte array/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFileFromEnvFile("   ", {
    envPath: join(tempDir, "missing-service.env")
  }), /archive file path must be a non-empty string/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFileFromEnvFile(join(tempDir, "bad-options.sqlite"), "bad-options"), /archive env-file options must be an object/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFileFromEnv("   ", {
    env: {}
  }), /archive file path must be a non-empty string/);
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFileFromEnv(join(tempDir, "bad-options.sqlite"), []), /archive env options must be an object/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFileFromEnvFile("   ", {
    envPath: join(tempDir, "missing-service.env")
  }), /snapshot file path must be a non-empty string/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFileFromEnvFile(serviceRestorePath, null), /restore env-file options must be an object/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFileFromEnv("   ", {
    env: {}
  }), /snapshot file path must be a non-empty string/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFileFromEnv(serviceRestorePath, "bad-options"), /restore env options must be an object/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFileFromEnvFile(serviceRestorePath, {
    envPath: join(tempDir, "missing-service.env"),
    expectedSha256: "not-a-sha256"
  }), /expectedSha256 must be a 64-character hex SHA-256 hash/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFileFromEnv(serviceRestorePath, {
    env: {},
    expectedSha256: "not-a-sha256"
  }), /expectedSha256 must be a 64-character hex SHA-256 hash/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFileFromEnvFile(serviceRestorePath, {
    envPath: join(tempDir, "missing-service.env"),
    expectedSha256: ""
  }), /expectedSha256 must be a 64-character hex SHA-256 hash/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFileFromEnvFile(serviceRestorePath, {
    envPath: join(tempDir, "missing-service.env"),
    expectedSha256: "   "
  }), /expectedSha256 must be a 64-character hex SHA-256 hash/);
  const trimmedArchiveCalls = [];
  const trimmedArchivePath = join(tempDir, "trimmed-service-archive.sqlite");
  const trimmedArchive = await archiveIcpdbServiceDatabaseToFile({
    ...serviceTransferDatabase,
    databaseId: " db_service_transfer ",
    beginArchive: async () => {
      trimmedArchiveCalls.push({ method: "beginArchive" });
      return { databaseId: " db_service_transfer ", sizeBytes: ` ${serviceSnapshotBytes.byteLength} ` };
    },
    readArchiveChunk: async (offset, maxBytes) => {
      trimmedArchiveCalls.push({ method: "readArchiveChunk", offset, maxBytes });
      const start = Number(offset);
      return serviceSnapshotBytes.slice(start, start + maxBytes);
    },
    finalizeArchive: async () => {
      trimmedArchiveCalls.push({ method: "finalizeArchive" });
    }
  }, trimmedArchivePath);
  assert.equal(trimmedArchive.databaseId, "db_service_transfer");
  assert.deepEqual(trimmedArchiveCalls.map((call) => call.method), [
    "beginArchive",
    "readArchiveChunk",
    "readArchiveChunk",
    "finalizeArchive"
  ]);
  const serviceArchive = await archiveIcpdbServiceDatabaseToFile(serviceTransferDatabase, serviceArchivePath);
  assert.equal(serviceArchive.databaseId, "db_service_transfer");
  assert.equal(serviceArchive.filePath, serviceArchivePath);
  assert.equal(serviceArchive.sizeBytes, serviceSnapshotBytes.byteLength);
  assert.deepEqual(new Uint8Array(await readFile(serviceArchivePath)), serviceSnapshotBytes);
  assert.deepEqual(serviceArchive, await snapshotInfoIcpdbServiceFile(serviceArchivePath).then((info) => ({
    ...info,
    databaseId: "db_service_transfer"
  })));
  assert.deepEqual(serviceArchiveCalls.map((call) => call.method), [
    "beginArchive",
    "readArchiveChunk",
    "readArchiveChunk",
    "finalizeArchive"
  ]);
  const shortServiceSnapshot = await snapshotInfoFile(serviceArchivePath);
  assert.equal(shortServiceSnapshot.sha256, serviceArchive.sha256);
  const serviceRestore = await restoreIcpdbServiceDatabaseFromFile(serviceTransferDatabase, serviceRestorePath, {
    expectedSha256: serviceArchive.sha256
  });
  assert.equal(serviceRestore.sha256, serviceArchive.sha256);
  const paddedExpectedServiceRestore = await restoreIcpdbServiceDatabaseFromFile(serviceTransferDatabase, serviceRestorePath, {
    expectedSha256: ` ${serviceArchive.sha256.toUpperCase()} `
  });
  assert.equal(paddedExpectedServiceRestore.sha256, serviceArchive.sha256);
  assert.deepEqual(restoredChunks.slice(0, 2).flat(), Array.from(serviceSnapshotBytes));
  assert.deepEqual(serviceArchiveCalls.slice(4).map((call) => call.method), [
    "beginRestore",
    "writeRestoreChunk",
    "writeRestoreChunk",
    "finalizeRestore",
    "beginRestore",
    "writeRestoreChunk",
    "writeRestoreChunk",
    "finalizeRestore"
  ]);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFile(serviceTransferDatabase, serviceRestorePath, {
    expectedSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"
  }), /snapshot hash mismatch/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFile(serviceTransferDatabase, serviceRestorePath, {
    expectedSha256: "not-a-sha256"
  }), /expectedSha256 must be a 64-character hex SHA-256 hash/);
  await assert.rejects(() => restoreIcpdbServiceDatabaseFromFile(serviceTransferDatabase, serviceRestorePath, {
    expectedSha256: ""
  }), /expectedSha256 must be a 64-character hex SHA-256 hash/);
  const shortServiceArchivePath = join(tempDir, "service-short-archive.sqlite");
  const shortServiceArchive = await archiveDatabaseToFile(serviceTransferDatabase, shortServiceArchivePath);
  assert.equal(shortServiceArchive.sha256, serviceArchive.sha256);
  const shortServiceRestore = await restoreDatabaseFromFile(serviceTransferDatabase, serviceRestorePath, {
    expectedSha256: serviceArchive.sha256
  });
  assert.equal(shortServiceRestore.sha256, serviceArchive.sha256);
  const envServiceCalls = [];
  const originalEnvArchiveActor = Actor.createActor;
  Actor.createActor = () => ({
    begin_database_archive: async (databaseId) => {
      envServiceCalls.push({ method: "beginArchive", databaseId });
      return { Ok: { database_id: databaseId, size_bytes: BigInt(serviceSnapshotBytes.byteLength) } };
    },
    read_database_archive_chunk: async (databaseId, offset, maxBytes) => {
      envServiceCalls.push({ method: "readArchiveChunk", databaseId, offset: offset.toString(), maxBytes });
      const start = Number(offset);
      return { Ok: { bytes: Array.from(serviceSnapshotBytes.slice(start, start + Number(maxBytes))) } };
    },
    finalize_database_archive: async (databaseId, snapshotHash) => {
      envServiceCalls.push({ method: "finalizeArchive", databaseId, snapshotHash });
      return { Ok: null };
    },
    begin_database_restore: async (databaseId, snapshotHash, sizeBytes) => {
      envServiceCalls.push({ method: "beginRestore", databaseId, snapshotHash, sizeBytes: sizeBytes.toString() });
      return { Ok: null };
    },
    write_database_restore_chunk: async (request) => {
      envServiceCalls.push({
        method: "writeRestoreChunk",
        databaseId: request.database_id,
        offset: request.offset.toString(),
        byteLength: request.bytes.length
      });
      return { Ok: null };
    },
    finalize_database_restore: async (databaseId) => {
      envServiceCalls.push({ method: "finalizeRestore", databaseId });
      return { Ok: null };
    }
  });
  try {
    const envTransferPath = join(tempDir, "service-env-object.sqlite");
    const envTransferEnv = {
      ICPDB_URL: "icpdb://aaaaa-aa/db_env_object",
      ICPDB_IDENTITY_TYPE: writtenGenerated.identityType,
      ICPDB_IDENTITY_JSON: writtenGenerated.identityJson
    };
    const envArchive = await archiveIcpdbServiceDatabaseToFileFromEnv(envTransferPath, { env: envTransferEnv });
    assert.equal(envArchive.databaseId, "db_env_object");
    assert.equal(envArchive.sha256, serviceArchive.sha256);
    await restoreIcpdbServiceDatabaseFromFileFromEnv(envTransferPath, {
      env: envTransferEnv,
      expectedSha256: envArchive.sha256
    });
    await archiveDatabaseToFileFromEnv(join(tempDir, "service-env-object-short.sqlite"), { env: envTransferEnv });
    await restoreDatabaseFromFileFromEnv(envTransferPath, {
      env: envTransferEnv,
      expectedSha256: envArchive.sha256
    });
    assert.deepEqual(envServiceCalls.map((call) => call.method), [
      "beginArchive",
      "readArchiveChunk",
      "readArchiveChunk",
      "finalizeArchive",
      "beginRestore",
      "writeRestoreChunk",
      "writeRestoreChunk",
      "finalizeRestore",
      "beginArchive",
      "readArchiveChunk",
      "readArchiveChunk",
      "finalizeArchive",
      "beginRestore",
      "writeRestoreChunk",
      "writeRestoreChunk",
      "finalizeRestore"
    ]);
    assert.equal(envServiceCalls.every((call) => call.databaseId === "db_env_object"), true);
  } finally {
    Actor.createActor = originalEnvArchiveActor;
  }
  const openFailureCalls = [];
  const openFailureDatabase = {
    ...serviceTransferDatabase,
    beginArchive: async () => {
      openFailureCalls.push({ method: "beginArchive" });
      return { databaseId: "db_service_transfer", sizeBytes: String(serviceSnapshotBytes.byteLength) };
    },
    readArchiveChunk: async (offset, maxBytes) => {
      openFailureCalls.push({ method: "readArchiveChunk", offset, maxBytes });
      return Array.from(serviceSnapshotBytes.slice(Number(offset), Number(offset) + maxBytes));
    },
    cancelArchive: async () => {
      openFailureCalls.push({ method: "cancelArchive" });
    }
  };
  await assert.rejects(
    () => archiveIcpdbServiceDatabaseToFile(openFailureDatabase, join(tempDir, "missing-archive-dir", "archive.sqlite")),
    /ENOENT|no such file/i
  );
  assert.deepEqual(openFailureCalls.map((call) => call.method), ["beginArchive", "cancelArchive"]);
  const unsafeArchiveDatabase = {
    ...serviceTransferDatabase,
    beginArchive: async () => ({
      databaseId: "db_service_transfer",
      sizeBytes: String(BigInt(Number.MAX_SAFE_INTEGER) + 1n)
    })
  };
  await assert.rejects(() => archiveIcpdbServiceDatabaseToFile(unsafeArchiveDatabase, join(tempDir, "unsafe.sqlite")), /archive size_bytes exceeds JavaScript safe integer range/);
  const finalizeFailureCalls = [];
  const finalizeFailureDatabase = {
    databaseId: "db_finalize_failure",
    beginArchive: async () => {
      finalizeFailureCalls.push({ method: "beginArchive" });
      return { databaseId: "db_finalize_failure", sizeBytes: String(serviceSnapshotBytes.byteLength) };
    },
    readArchiveChunk: async (offset, maxBytes) => {
      finalizeFailureCalls.push({ method: "readArchiveChunk", offset, maxBytes });
      const start = Number(offset);
      return Array.from(serviceSnapshotBytes.slice(start, start + maxBytes));
    },
    finalizeArchive: async () => {
      finalizeFailureCalls.push({ method: "finalizeArchive" });
      throw new Error("finalize failed");
    },
    cancelArchive: async () => {
      finalizeFailureCalls.push({ method: "cancelArchive" });
    }
  };
  await assert.rejects(
    () => archiveIcpdbServiceDatabaseToFile(finalizeFailureDatabase, join(tempDir, "finalize-failure.sqlite")),
    /finalize failed/
  );
  assert.deepEqual(finalizeFailureCalls.map((call) => call.method), [
    "beginArchive",
    "readArchiveChunk",
    "readArchiveChunk",
    "finalizeArchive",
    "cancelArchive"
  ]);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

let createdDatabaseCalls = 0;
const autoClient = createClientFromDatabase(async () => {
  createdDatabaseCalls += 1;
  return { ...fakeDatabase, databaseId: "db_auto" };
});
await assert.rejects(() => autoClient.principal(), /principal is not available/);
assert.equal(await autoClient.databaseId(), "db_auto");
await autoClient.execute("SELECT 1");
await autoClient.query("SELECT 1");
assert.equal(createdDatabaseCalls, 1);
autoClient.close();
assert.equal(await autoClient.databaseId(), "db_auto");
assert.equal(createdDatabaseCalls, 2);

let closeDelegationCalls = 0;
const closeDelegationClient = createClientFromDatabase(async () => ({
  ...fakeDatabase,
  databaseId: "db_close_delegation",
  close: () => {
    closeDelegationCalls += 1;
  }
}));
assert.equal(await closeDelegationClient.databaseId(), "db_close_delegation");
closeDelegationClient.close();
await Promise.resolve();
assert.equal(closeDelegationCalls, 1);
assert.equal(await closeDelegationClient.databaseId(), "db_close_delegation");
closeDelegationClient.reconnect();
await Promise.resolve();
assert.equal(closeDelegationCalls, 2);
assert.equal(await closeDelegationClient.databaseId(), "db_close_delegation");

let deleteDelegationCalls = 0;
const deleteDelegationClient = createClientFromDatabase(async () => ({
  ...fakeDatabase,
  databaseId: "db_delete_delegation",
  close: () => {
    deleteDelegationCalls += 1;
  }
}));
assert.equal(await deleteDelegationClient.databaseId(), "db_delete_delegation");
await deleteDelegationClient.delete();
await Promise.resolve();
assert.equal(deleteDelegationCalls, 1);
assert.equal(deleteDelegationClient.closed, true);
assert.throws(() => deleteDelegationClient.reconnect(), /database client has been deleted/);

const trimmedDatabaseIdClient = createClientFromDatabase({
  ...fakeDatabase,
  databaseId: " db_trimmed "
});
assert.equal(await trimmedDatabaseIdClient.databaseId(), "db_trimmed");
let blankDatabaseIdCalls = 0;
const blankDatabaseIdClient = createClientFromDatabase(async () => {
  blankDatabaseIdCalls += 1;
  return { ...fakeDatabase, databaseId: "   " };
});
await assert.rejects(() => blankDatabaseIdClient.databaseId(), /databaseId must be a non-empty string/);
assert.equal(blankDatabaseIdCalls, 1);
await assert.rejects(() => createClientFromDatabase(async () => null).databaseId(), /database source must be an object/);
await assert.rejects(() => createClientFromDatabase({
  databaseId: "db_missing_query",
  execute: fakeDatabase.execute,
  batch: fakeDatabase.batch
}).databaseId(), /database source query must be a function/);
await assert.rejects(() => createClientFromDatabase({
  databaseId: "db_missing_execute",
  query: fakeDatabase.query,
  batch: fakeDatabase.batch
}).databaseId(), /database source execute must be a function/);
assert.equal(await createClientFromDatabase({
  databaseId: "db_missing_batch",
  query: fakeDatabase.query,
  execute: fakeDatabase.execute
}).databaseId(), "db_missing_batch");
await assert.rejects(() => createClientFromDatabase({
  ...fakeDatabase,
  batch: "batch"
}).databaseId(), /database source batch must be a function/);
await assert.rejects(() => createClientFromDatabase({
  ...fakeDatabase,
  queryRows: "queryRows"
}).databaseId(), /database source queryRows must be a function/);
await assert.rejects(() => createClientFromDatabase({
  ...fakeDatabase,
  connectionUrl: "icpdb://aaaaa-aa/db_bad"
}).databaseId(), /database source connectionUrl must be a function/);
await assert.rejects(() => createClientFromDatabase({
  ...fakeDatabase,
  connectionUrl: () => "   "
}).connectionUrl(), /connectionUrl must be a non-empty string/);
await assert.rejects(() => createClientFromDatabase({
  ...fakeDatabase,
  url: () => "   "
}).database().then((database) => database.url()), /url must be a non-empty string/);
assert.deepEqual(await createClientFromDatabase({
  ...fakeDatabase,
  info: () => ({
    canisterId: "aaaaa-aa",
    databaseId: "db_sdk",
    connectionUrl: "custom://db_sdk",
    url: "custom://db_sdk"
  })
}).info(), {
  canisterId: "aaaaa-aa",
  databaseId: "db_sdk",
  connectionUrl: "custom://db_sdk",
  url: "custom://db_sdk"
});
await assert.rejects(() => createClientFromDatabase({
  ...fakeDatabase,
  info: () => ({
    canisterId: "   ",
    databaseId: "db_sdk",
    connectionUrl: "custom://db_sdk",
    url: "custom://db_sdk"
  })
}).info(), /canisterId must be a non-empty string/);
await assert.rejects(() => createClientFromDatabase({
  ...fakeDatabase,
  info: () => ({
    canisterId: "bbbbb-bb",
    databaseId: "db_sdk",
    connectionUrl: "icpdb://aaaaa-aa/db_sdk",
    url: "icpdb://aaaaa-aa/db_sdk"
  })
}).info(), /canisterId does not match connectionUrl/);

let retryDatabaseCalls = 0;
const retryClient = createClientFromDatabase(async () => {
  retryDatabaseCalls += 1;
  if (retryDatabaseCalls === 1) throw new Error("temporary database create failure");
  return { ...fakeDatabase, databaseId: "db_retry" };
});
await assert.rejects(() => retryClient.databaseId(), /temporary database create failure/);
assert.equal(await retryClient.databaseId(), "db_retry");
assert.equal(retryDatabaseCalls, 2);

let strictShapeDatabaseCalls = 0;
const strictShapeClient = createClientFromDatabase(async () => {
  strictShapeDatabaseCalls += 1;
  return { ...fakeDatabase, databaseId: "db_strict_shape" };
});
await assert.rejects(() => strictShapeClient.execute(" "), /SQL statement SQL must be a non-empty string/);
await assert.rejects(() => strictShapeClient.query({ sql: 1 }), /SQL statement SQL must be a string/);
await assert.rejects(() => strictShapeClient.batch([{ sql: " " }], "write"), /SQL statement SQL must be a non-empty string/);
await assert.rejects(() => strictShapeClient.execute({ sql: "INSERT", idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
await assert.rejects(() => strictShapeClient.batch(["INSERT"], { idempotencyKey: "   " }), /idempotencyKey must be a non-empty string/);
assert.equal(strictShapeDatabaseCalls, 0);

console.log("ICPDB SDK client checks OK");

function sqlResponse(columns, rows, rowsAffected, lastInsertRowId, routedOperationId = null) {
  return {
    columns,
    rows,
    rowsAffected,
    lastInsertRowId,
    truncated: false,
    routedOperationId
  };
}

function rawSqlOk(columns, rows, rowsAffected, lastInsertRowId) {
  return {
    Ok: {
      columns,
      rows,
      rows_affected: rowsAffected,
      last_insert_rowid: lastInsertRowId,
      truncated: false,
      routed_operation_id: []
    }
  };
}
