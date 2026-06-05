// Where: scripts/check-icpdb-http-cli.mjs
// What: Node-level smoke checks for the ICPDB bearer-token HTTP CLI.
// Why: CLI request shaping must stay aligned with canister HTTP endpoints without needing a live canister.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  archiveIcpdb,
  buildCommand,
  callIcpdbHttp,
  commandUsage,
  createIcpdbDatabase,
  databaseViewsIcpdb,
  dumpIcpdb,
  formatCliOutput,
  getDatabaseShardStatus,
  inspectIcpdb,
  listDatabases,
  listDatabasePlacements,
  listDatabaseShards,
  listShardOperations,
  loadIcpdb,
  maintainDatabaseShards,
  migrateIcpdb,
  migrateDatabaseToShard,
  parseCliArgs,
  reconcileRoutedOperation,
  reconcileShardOperation,
  restoreIcpdb,
  runShellSql,
  schemaIcpdb,
  scriptIcpdb,
  shellLineCommand,
  shellUsage,
  statsIcpdb,
  tableColumnsIcpdb,
  tableForeignKeysIcpdb,
  tableIndexesIcpdb,
  snapshotInfoIcpdb,
  tableTriggersIcpdb,
  topUpDatabaseShard,
  usage,
  writeHttpEnvOutputFile,
  writeHttpEnvOutputFileOrDelete
} from "./icpdb-http.mjs";
import { executeShellCommand } from "./icpdb-http-dispatch.mjs";

const env = {
  ICPDB_HTTP_BASE_URL: "https://db.example",
  ICPDB_TOKEN: "secret",
  ICPDB_CANISTER_ID: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ICPDB_NETWORK_URL: "http://localhost:8001",
  ICPDB_ROOT_KEY: "local-root-key"
};

const databaseEnv = { ...env, ICPDB_DATABASE_ID: "alpha" };
const checkTmpDir = await mkdtemp(join(tmpdir(), "icpdb-http-cli-check-"));
const checkFile = (name) => join(checkTmpDir, name);
const statementsFilePath = checkFile("statements.json");
await writeFile(statementsFilePath, JSON.stringify([
  { sql: "SELECT :body AS body", params: { body: "from-file" } }
]));
const paramsFilePath = checkFile("params.json");
await writeFile(paramsFilePath, JSON.stringify([null, "from-file"]));
const namedParamsFilePath = checkFile("named-params.json");
await writeFile(namedParamsFilePath, JSON.stringify({ body: "named-file" }));
const invalidParamsFilePath = checkFile("invalid-params.json");
await writeFile(invalidParamsFilePath, JSON.stringify("not-array-or-object"));

function captureWritable() {
  const chunks = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      callback();
    }
  });
  output.text = () => chunks.join("");
  return output;
}

assert.deepEqual(parseCliArgs(["create-db", "cli-owner"], env), {
  createDatabase: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  tokenName: "cli-owner"
});
assert.throws(() => parseCliArgs(["create-db", "   "], env), /token_name must be a non-empty string/);
assert.throws(() => parseCliArgs(["create-db"], { ...env, ICPDB_TOKEN_NAME: "   " }), /token_name must be a non-empty string/);

assert.deepEqual(parseCliArgs(["--base-url", "http://icpdb.localhost:8001", "--format", "env", "create-db"], env), {
  createDatabase: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  outputFormat: "env",
  baseUrl: "http://icpdb.localhost:8001",
  tokenName: "owner"
});

assert.deepEqual(parseCliArgs(["--base-url", "http://icpdb.localhost:8001", "--env-out", "/tmp/database.env", "create-db"], env), {
  createDatabase: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  outputFormat: "env",
  envOutFile: "/tmp/database.env",
  baseUrl: "http://icpdb.localhost:8001",
  tokenName: "owner"
});
assert.throws(() => parseCliArgs(["--env-out", "   ", "create-db"], env), /env output file must be a non-empty string/);
assert.throws(() => parseCliArgs(["--env-file", "   ", "query", "SELECT 1"], {}), /env file must be a non-empty string/);

assert.deepEqual(parseCliArgs(["--base-url", "http://icpdb.localhost:8001", "--statement", "CREATE TABLE notes(id INTEGER)", "create-db"], env), {
  createDatabase: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  baseUrl: "http://icpdb.localhost:8001",
  tokenName: "owner",
  statements: [{ sql: "CREATE TABLE notes(id INTEGER)", params: [] }],
  maxRows: 100
});

assert.deepEqual(parseCliArgs(["--base-url", "http://icpdb.localhost:8001", "--statements-file", statementsFilePath, "create-db"], env), {
  createDatabase: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  baseUrl: "http://icpdb.localhost:8001",
  tokenName: "owner",
  statements: [{ sql: "SELECT :body AS body", params: { body: "from-file" } }],
  statementsFilePath,
  maxRows: 100
});
assert.throws(() => parseCliArgs(["--statements-file", "   ", "create-db"], env), /statements file must be a non-empty string/);

assert.deepEqual(parseCliArgs(["--base-url", "http://icpdb.localhost:8001", "--setup-file", "/tmp/schema.sql", "create-db", "setup-owner"], env), {
  createDatabase: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  baseUrl: "http://icpdb.localhost:8001",
  tokenName: "setup-owner",
  setupFilePath: "/tmp/schema.sql",
  maxRows: 100
});
assert.throws(() => parseCliArgs(["--setup-file", "   ", "create-db"], env), /setup file must be a non-empty string/);

assert.deepEqual(parseCliArgs(["--base-url", "http://icpdb.localhost:8001", "--setup-migrations-file", "/tmp/migrations.json", "create-db", "migration-owner"], env), {
  createDatabase: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  baseUrl: "http://icpdb.localhost:8001",
  tokenName: "migration-owner",
  setupMigrationsFilePath: "/tmp/migrations.json",
  maxRows: 100
});
assert.throws(() => parseCliArgs(["--setup-migrations-file", "   ", "create-db"], env), /setup migrations file must be a non-empty string/);

assert.throws(() => parseCliArgs(["--database-id", "alpha", "create-db"], env), /create-db creates a new database/);
assert.throws(() => parseCliArgs(["create-db"], databaseEnv), /ICPDB_DATABASE_ID/);
assert.throws(() => parseCliArgs(["create-db"], { ...env, ICPDB_URL: "icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/alpha" }), /ICPDB_URL/);
assert.throws(() => parseCliArgs(["create-db", "owner", "extra"], env), /create-db accepts at most 1 positional argument/);
assert.throws(() => parseCliArgs(["not-a-command"], {}), /unknown command: not-a-command/);
assert.throws(() => parseCliArgs(["not-a-command"], env), /unknown command: not-a-command/);

assert.throws(
  () => parseCliArgs(["--format", "env", "databases"], env),
  /--format env is only valid for create-db/
);
assert.throws(() => parseCliArgs(["databases", "extra"], env), /databases accepts no positional arguments/);

assert.throws(
  () => parseCliArgs(["--format", "env", "query", "alpha", "SELECT 1"], env),
  /--format env is only valid for create-db/
);

assert.deepEqual(parseCliArgs(["placements"], env), {
  databasePlacements: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key"
});

assert.deepEqual(parseCliArgs(["shards"], env), {
  databaseShards: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key"
});

assert.deepEqual(parseCliArgs(["shard-status", "aaaaa-aa"], env), {
  databaseShardStatus: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  databaseCanisterId: "aaaaa-aa"
});
assert.throws(() => parseCliArgs(["shard-status", "   "], env), /database_canister_id must be a non-empty string/);
assert.throws(() => parseCliArgs(["shard-status", "aaaaa-aa", "extra"], env), /shard-status accepts at most 1 positional argument/);

assert.deepEqual(parseCliArgs(["shard-top-up", "aaaaa-aa", "1000000"], env), {
  topUpDatabaseShard: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  databaseCanisterId: "aaaaa-aa",
  cycles: "1000000"
});
assert.throws(() => parseCliArgs(["shard-top-up", "   ", "1000000"], env), /database_canister_id must be a non-empty string/);
assert.throws(() => parseCliArgs(["shard-top-up", "aaaaa-aa", "1000000", "extra"], env), /shard-top-up accepts at most 2 positional arguments/);

assert.deepEqual(parseCliArgs(["shard-maintain", "1", "2", "3", "4", "5", "6"], env), {
  maintainDatabaseShards: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  minAvailableSlots: "1",
  minCyclesBalance: "2",
  topUpCycles: "3",
  maxNewShards: "4",
  newShardMaxDatabases: "5",
  newShardInitialCycles: "6"
});
assert.throws(() => parseCliArgs(["shard-maintain", "1", "2", "3", "65536", "5", "6"], env), /max_new_shards exceeds nat16 range/);
assert.throws(() => parseCliArgs(["shard-maintain", "1", "2", "3", "4", "65536", "6"], env), /new_shard_max_databases exceeds nat16 range/);
assert.throws(() => parseCliArgs(["shard-maintain", "1", "2", "3", "4", "5", "6", "extra"], env), /shard-maintain accepts at most 6 positional arguments/);

assert.deepEqual(parseCliArgs(["shard-migrate", "alpha", "aaaaa-aa"], env), {
  migrateDatabaseToShard: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  databaseId: "alpha",
  databaseCanisterId: "aaaaa-aa"
});
assert.throws(() => parseCliArgs(["shard-migrate", "alpha", "   "], env), /database_canister_id must be a non-empty string/);
assert.throws(() => parseCliArgs(["shard-migrate", "alpha", "aaaaa-aa", "extra"], env), /shard-migrate accepts at most 2 positional arguments/);

assert.deepEqual(parseCliArgs(["databases"], env), {
  databases: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key"
});

assert.deepEqual(parseCliArgs(["shard-ops"], env), {
  shardOperations: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key"
});
assert.throws(() => parseCliArgs(["shard-ops", "extra"], env), /shard-ops accepts no positional arguments/);

assert.deepEqual(parseCliArgs(["shard-reconcile", "applied", "op_1"], env), {
  reconcileShardOperation: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  operationId: "op_1",
  status: "applied",
  error: null
});

assert.deepEqual(parseCliArgs(["shard-reconcile", "failed", "op_2", "operator", "verified"], env), {
  reconcileShardOperation: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  operationId: "op_2",
  status: "failed",
  error: "operator verified"
});
assert.throws(() => parseCliArgs(["shard-reconcile", "applied", "   "], env), /operation_id must be a non-empty string/);
assert.throws(() => parseCliArgs(["shard-reconcile", "failed", "op_2"], env), /missing failure_reason/);
assert.throws(() => parseCliArgs(["shard-reconcile", "applied", "op_2", "operator", "verified"], env), /failure_reason is only valid/);

assert.deepEqual(parseCliArgs(["operation-reconcile", "alpha", "op_3"], env), {
  reconcileRoutedOperation: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  databaseId: "alpha",
  operationId: "op_3"
});
assert.throws(() => parseCliArgs(["operation-reconcile", "alpha", "   "], env), /operation_id must be a non-empty string/);
assert.throws(() => parseCliArgs(["operation-reconcile", "alpha", "op_3", "extra"], env), /operation-reconcile accepts at most 2 positional arguments/);
assert.deepEqual(parseCliArgs(["help", "inspect"], {}), { help: true, helpTopic: "inspect" });
assert.deepEqual(parseCliArgs(["help", "shell", "sql"], {}), { help: true, helpTopic: "shell sql" });

assert.deepEqual(parseCliArgs(["tables", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/list",
  body: { database_id: "alpha" }
});
assert.throws(() => parseCliArgs(["tables", "alpha", "extra"], env), /tables accepts at most 1 positional argument/);

assert.deepEqual(parseCliArgs(["tables"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/list",
  body: { database_id: "alpha" }
});
assert.throws(
  () => parseCliArgs(["tables", "extra"], databaseEnv),
  /tables accepts no positional arguments when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);

assert.deepEqual(parseCliArgs(["views", "alpha"], env), {
  databaseViews: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha"
});

assert.deepEqual(parseCliArgs(["stats", "alpha", "--format", "table"], env), {
  stats: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  outputFormat: "table"
});

assert.deepEqual(parseCliArgs(["describe", "alpha", "notes"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/describe",
  body: { database_id: "alpha", table_name: "notes" }
});

assert.deepEqual(parseCliArgs(["preview", "alpha", "notes", "--limit", "25", "--offset", "50"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  body: { database_id: "alpha", table_name: "notes", limit: 25, offset: 50 }
});
assert.throws(() => parseCliArgs(["preview", "alpha", "notes", "--limit", "0"], env), /limit must be an integer from 1 to 500/);
assert.throws(() => parseCliArgs(["preview", "alpha", "notes", "--limit", "501"], env), /limit must be an integer from 1 to 500/);
assert.throws(() => parseCliArgs(["preview", "alpha", "notes", "--offset", "4294967296"], env), /offset must be an integer from 0 to 4294967295/);

assert.deepEqual(parseCliArgs(["preview", "alpha", "notes", "--format", "table"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  outputFormat: "table",
  body: { database_id: "alpha", table_name: "notes", limit: 100, offset: 0 }
});

assert.deepEqual(parseCliArgs(["operation", "alpha", "op_insert_1"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/operations/get",
  body: { database_id: "alpha", operation_id: "op_insert_1" }
});
assert.throws(() => parseCliArgs(["operation", "alpha", "   "], env), /operation_id must be a non-empty string/);
assert.throws(() => parseCliArgs(["operation", "alpha", "op_insert_1", "extra"], env), /operation accepts at most 2 positional arguments/);
assert.throws(
  () => parseCliArgs(["operation", "op_insert_1", "extra"], databaseEnv),
  /operation accepts at most 1 positional argument when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);

assert.deepEqual(parseCliArgs(["snapshot-info", "/tmp/backup.sqlite3"], env), {
  snapshotInfo: true,
  command: "snapshot-info",
  outputFormat: null,
  filePath: "/tmp/backup.sqlite3"
});
assert.deepEqual(parseCliArgs(["--format", "env", "snapshot-info", "/tmp/backup.sqlite3"], env), {
  snapshotInfo: true,
  command: "snapshot-info",
  outputFormat: "env",
  filePath: "/tmp/backup.sqlite3"
});
assert.deepEqual(parseCliArgs(["--format", "env", "archive", "alpha", "/tmp/backup.sqlite3"], env), {
  archive: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/backup.sqlite3",
  outputFormat: "env"
});
assert.throws(() => parseCliArgs(["--env-out", "/tmp/archive.env", "archive", "alpha", "/tmp/backup.sqlite3"], env), /--env-out is only valid for create-db/);
assert.throws(() => parseCliArgs(["snapshot-info", "   "], env), /file must be a non-empty string/);

assert.deepEqual(parseCliArgs(["restore", "alpha", "/tmp/backup.sqlite3", "--expect-snapshot-hash", "AA".repeat(32)], env), {
  restore: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/backup.sqlite3",
  expectedSnapshotHash: "aa".repeat(32)
});
assert.equal(
  parseCliArgs(["restore", "alpha", "/tmp/backup.sqlite3", "--expect-snapshot-hash", ` ${"AA".repeat(32)} `], env).expectedSnapshotHash,
  "aa".repeat(32)
);
assert.throws(() => parseCliArgs(["restore", "alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseCliArgs(["restore", "   "], databaseEnv), /file must be a non-empty string/);

assert.throws(() => parseCliArgs(["restore", "alpha", "/tmp/backup.sqlite3", "--expect-snapshot-hash", "abc"], env), /64-character SHA-256/);
assert.throws(() => parseCliArgs(["restore", "alpha", "/tmp/backup.sqlite3", "--expect-snapshot-hash", "   "], env), /64-character SHA-256/);
assert.throws(() => parseCliArgs(["archive", "alpha", "/tmp/backup.sqlite3", "--expect-snapshot-hash", "aa".repeat(32)], env), /only valid for restore/);
assert.throws(() => parseCliArgs(["--env-out", "/tmp/snapshot.env", "snapshot-info", "/tmp/backup.sqlite3"], env), /--env-out is only valid for create-db/);

assert.deepEqual(parseCliArgs(["columns", "alpha", "notes"], env), {
  tableColumns: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(parseCliArgs(["indexes", "alpha", "notes"], env), {
  tableIndexes: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(parseCliArgs(["triggers", "alpha", "notes"], env), {
  tableTriggers: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(parseCliArgs(["foreign-keys", "alpha", "notes", "--format", "table"], env), {
  tableForeignKeys: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  outputFormat: "table"
});

assert.throws(() => parseCliArgs(["describe", "alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseCliArgs(["preview", "alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseCliArgs(["columns", "alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseCliArgs(["schema", "alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseCliArgs(["dump", "alpha", "   "], env), /table_name must be a non-empty string/);

assert.deepEqual(parseCliArgs(["inspect", "alpha", "notes", "--limit", "25", "--offset", "50"], env), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  includeAccess: false,
  limit: 25,
  offset: 50
});

assert.deepEqual(parseCliArgs(["inspect", "alpha", "--access"], env), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: null,
  includeAccess: true,
  limit: 100,
  offset: 0
});

assert.deepEqual(parseCliArgs(["schema", "alpha", "notes"], env), {
  schema: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});
assert.throws(() => parseCliArgs(["schema", "alpha", "notes", "extra"], env), /schema accepts at most 2 positional arguments/);

assert.deepEqual(parseCliArgs(["schema", "notes"], databaseEnv), {
  schema: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});
assert.throws(
  () => parseCliArgs(["schema", "notes", "extra"], databaseEnv),
  /schema accepts at most 1 positional argument when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);
assert.throws(
  () => parseCliArgs(["describe", "notes", "extra"], databaseEnv),
  /describe accepts at most 1 positional argument when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);

assert.deepEqual(parseCliArgs(["dump", "alpha", "notes", "--limit", "2"], env), {
  dump: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  limit: 2
});

assert.deepEqual(parseCliArgs(["load", "alpha", "/tmp/dump.sql"], env), {
  load: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/dump.sql",
  maxRows: 100
});

assert.deepEqual(parseCliArgs(["load", "alpha", "-"], env), {
  load: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "-",
  maxRows: 100
});
assert.deepEqual(parseCliArgs(["load", "alpha", "/tmp/read.sql", "--mode", "read"], env), {
  load: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/read.sql",
  batchMode: "read",
  maxRows: 100
});
assert.throws(() => parseCliArgs(["load", "alpha", "/tmp/read.sql", "--mode", "read", "--idempotency-key", "load_read"], env), /idempotency-key is only valid for write load/);
assert.throws(() => parseCliArgs(["load", "alpha", "/tmp/read.sql", "--mode", "read", "--wait"], env), /wait is only valid for write load/);
assert.throws(() => parseCliArgs(["load", "alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseCliArgs(["load", "   "], databaseEnv), /file must be a non-empty string/);

assert.deepEqual(parseCliArgs(["script", "alpha", "/tmp/setup.sql", "--idempotency-key", "script_1", "--wait"], env), {
  script: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/setup.sql",
  maxRows: 100,
  idempotencyKey: "script_1",
  waitForRoutedOperation: true
});
assert.throws(() => parseCliArgs(["script", "alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseCliArgs(["script", "   "], databaseEnv), /file must be a non-empty string/);
assert.throws(() => parseCliArgs(["script", "alpha", "/tmp/setup.sql", "--idempotency-key", "   "], env), /idempotency_key must be a non-empty string/);
assert.equal(parseCliArgs(["script", "alpha", "/tmp/read.sql", "--mode", "read"], env).batchMode, "read");
assert.throws(() => parseCliArgs(["script", "alpha", "/tmp/read.sql", "--mode", "read", "--idempotency-key", "script_read"], env), /idempotency-key is only valid for write script/);
assert.throws(() => parseCliArgs(["script", "alpha", "/tmp/read.sql", "--mode", "read", "--wait"], env), /wait is only valid for write script/);
assert.throws(() => parseCliArgs(["execute", "alpha", "INSERT", "--idempotency-key", "   "], env), /idempotency_key must be a non-empty string/);
assert.throws(() => parseCliArgs(["execute", "alpha", "INSERT"], { ...env, ICPDB_IDEMPOTENCY_KEY: "   " }), /ICPDB_IDEMPOTENCY_KEY must be a non-empty string/);

assert.deepEqual(parseCliArgs(["script", "/tmp/setup.sql", "--idempotency-key", "script_1", "--wait"], databaseEnv), {
  script: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/setup.sql",
  maxRows: 100,
  idempotencyKey: "script_1",
  waitForRoutedOperation: true
});

assert.deepEqual(parseCliArgs(["migrate", "alpha", "/tmp/migrations.json", "--idempotency-key", "migrate_1", "--wait"], env), {
  migrate: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/migrations.json",
  maxRows: 100,
  idempotencyKey: "migrate_1",
  waitForRoutedOperation: true
});
assert.throws(() => parseCliArgs(["migrate", "alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseCliArgs(["migrate", "   "], databaseEnv), /file must be a non-empty string/);

assert.deepEqual(parseCliArgs(["migrate", "/tmp/migrations.json", "--idempotency-key", "migrate_1", "--wait"], databaseEnv), {
  migrate: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/migrations.json",
  maxRows: 100,
  idempotencyKey: "migrate_1",
  waitForRoutedOperation: true
});

assert.deepEqual(parseCliArgs(["load", "alpha", "/tmp/dump.sql", "--idempotency-key", "load_1"], env), {
  load: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/dump.sql",
  maxRows: 100,
  idempotencyKey: "load_1"
});

assert.deepEqual(parseCliArgs(["load", "alpha", "/tmp/dump.sql", "--idempotency-key", "load_1", "--wait"], env), {
  load: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/dump.sql",
  maxRows: 100,
  idempotencyKey: "load_1",
  waitForRoutedOperation: true
});

assert.throws(
  () => parseCliArgs(["query", "alpha", "SELECT 1", "--wait"], env),
  /--wait is only valid for execute, batch, script, load, and migrate/
);

assert.deepEqual(parseCliArgs(["usage", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage",
  body: { database_id: "alpha" }
});
assert.throws(() => parseCliArgs(["usage", "alpha", "extra"], env), /usage accepts at most 1 positional argument/);

assert.deepEqual(parseCliArgs(["usage"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage",
  body: { database_id: "alpha" }
});
assert.throws(
  () => parseCliArgs(["usage", "extra"], databaseEnv),
  /usage accepts no positional arguments when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);

assert.deepEqual(parseCliArgs(["usage-events", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage/events",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["billing", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/billing",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["payments", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/payments/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["placement", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/placements/get",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["quota", "alpha", "67108864"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/quota/set",
  body: { database_id: "alpha", max_logical_size_bytes: 67108864 }
});

assert.deepEqual(parseCliArgs(["tokens", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["create-token", "alpha", "web-read", "read"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/create",
  body: { database_id: "alpha", name: "web-read", scope: "read" }
});
assert.throws(() => parseCliArgs(["create-token", "alpha", "web-read", "read", "extra"], env), /create-token accepts at most 3 positional arguments/);

assert.deepEqual(parseCliArgs(["create-token", "web-read", "read"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/create",
  body: { database_id: "alpha", name: "web-read", scope: "read" }
});
assert.throws(
  () => parseCliArgs(["create-token", "web-read", "read", "extra"], databaseEnv),
  /create-token accepts at most 2 positional arguments when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);
assert.throws(() => parseCliArgs(["create-token", "alpha", "   ", "read"], env), /token_name must be a non-empty string/);
assert.throws(() => parseCliArgs(["create-token", "   ", "read"], databaseEnv), /token_name must be a non-empty string/);

assert.deepEqual(parseCliArgs(["revoke-token", "alpha", "tok_abc"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/revoke",
  body: { database_id: "alpha", token_id: "tok_abc" }
});
assert.deepEqual(parseCliArgs(["revoke-token", " tok_abc "], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/revoke",
  body: { database_id: "alpha", token_id: "tok_abc" }
});
assert.throws(
  () => parseCliArgs(["revoke-token", "tok_abc", "extra"], databaseEnv),
  /revoke-token accepts at most 1 positional argument when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);
assert.throws(() => parseCliArgs(["revoke-token", "alpha", "   "], env), /token_id must be a non-empty string/);
assert.throws(() => parseCliArgs(["revoke-token", "   "], databaseEnv), /token_id must be a non-empty string/);

assert.deepEqual(parseCliArgs(["archive", "alpha", "/tmp/alpha.sqlite3"], env), {
  archive: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/alpha.sqlite3"
});
assert.throws(() => parseCliArgs(["archive", "alpha", "/tmp/alpha.sqlite3", "extra"], env), /archive accepts at most 2 positional arguments/);
assert.throws(
  () => parseCliArgs(["archive", "/tmp/alpha.sqlite3", "extra"], databaseEnv),
  /archive accepts at most 1 positional argument when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);
assert.throws(() => parseCliArgs(["archive", "alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseCliArgs(["archive", "   "], databaseEnv), /file must be a non-empty string/);

assert.deepEqual(parseCliArgs(["restore", "alpha", "/tmp/alpha.sqlite3"], env), {
  restore: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/alpha.sqlite3"
});
assert.throws(
  () => parseCliArgs(["restore", "/tmp/alpha.sqlite3", "extra"], databaseEnv),
  /restore accepts at most 1 positional argument when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);

assert.deepEqual(parseCliArgs(["archive-cancel", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/archive/cancel",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["members", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(parseCliArgs(["grant-member", "alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai", "reader"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/grant",
  body: { database_id: "alpha", principal: "rrkah-fqaaa-aaaaa-aaaaq-cai", role: "reader" }
});
assert.throws(() => parseCliArgs(["grant-member", "alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai", "reader", "extra"], env), /grant-member accepts at most 3 positional arguments/);

assert.deepEqual(parseCliArgs(["grant-member", "rrkah-fqaaa-aaaaa-aaaaq-cai", "reader"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/grant",
  body: { database_id: "alpha", principal: "rrkah-fqaaa-aaaaa-aaaaq-cai", role: "reader" }
});
assert.throws(
  () => parseCliArgs(["grant-member", "rrkah-fqaaa-aaaaa-aaaaq-cai", "reader", "extra"], databaseEnv),
  /grant-member accepts at most 2 positional arguments when ICPDB_DATABASE_ID or ICPDB_URL selects a database/
);

assert.throws(() => parseCliArgs(["grant-member", "alpha", "2vxsx-fae", "reader"], env), /anonymous principal cannot be granted database access/);
assert.throws(() => parseCliArgs(["grant-member", "2vxsx-fae", "reader"], databaseEnv), /anonymous principal cannot be granted database access/);
assert.throws(() => parseCliArgs(["grant-member", "alpha", "   ", "reader"], env), /database member principal must be a non-empty string/);
assert.throws(() => parseCliArgs(["grant-member", "   ", "reader"], databaseEnv), /database member principal must be a non-empty string/);
assert.throws(() => parseCliArgs(["grant-member", "alpha", "not-principal", "reader"], env), /database member principal must be a valid principal/);
assert.throws(() => parseCliArgs(["grant-member", "not-principal", "reader"], databaseEnv), /database member principal must be a valid principal/);

assert.deepEqual(parseCliArgs(["revoke-member", "alpha", "2vxsx-fae"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/revoke",
  body: { database_id: "alpha", principal: "2vxsx-fae" }
});

assert.throws(() => parseCliArgs(["revoke-member", "alpha", "   "], env), /database member principal must be a non-empty string/);
assert.throws(() => parseCliArgs(["revoke-member", "   "], databaseEnv), /database member principal must be a non-empty string/);
assert.throws(() => parseCliArgs(["revoke-member", "alpha", "not-principal"], env), /database member principal must be a valid principal/);
assert.throws(() => parseCliArgs(["revoke-member", "not-principal"], databaseEnv), /database member principal must be a valid principal/);

assert.deepEqual(parseCliArgs(["delete-db", "alpha"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/database/delete",
  body: { database_id: "alpha" }
});
assert.throws(() => parseCliArgs(["delete-db", "alpha", "extra"], env), /delete-db accepts at most 1 positional argument/);

assert.deepEqual(parseCliArgs(["query", "alpha", "SELECT", "1", "--params", "[null,\"x\"]", "--max-rows", "3"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: {
    database_id: "alpha",
    sql: "SELECT 1",
    params: [null, "x"],
    max_rows: 3
  }
});
assert.deepEqual(parseCliArgs(["scalar", "alpha", "SELECT", "count(*)", "--params", "[null,\"x\"]", "--max-rows", "3"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: {
    database_id: "alpha",
    sql: "SELECT count(*)",
    params: [null, "x"],
    max_rows: 1
  },
  scalar: true
});
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT", "1", "--max-rows", "0"], env), /max-rows must be an integer from 1 to 500/);
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT", "1", "--max-rows", "501"], env), /max-rows must be an integer from 1 to 500/);

assert.deepEqual(parseCliArgs(["query", "SELECT", "1", "--params", "[null,\"x\"]", "--max-rows", "3"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: {
    database_id: "alpha",
    sql: "SELECT 1",
    params: [null, "x"],
    max_rows: 3
  }
});
assert.deepEqual(parseCliArgs(["query", "alpha", "SELECT", "?2", "--params-file", paramsFilePath, "--max-rows", "3"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: {
    database_id: "alpha",
    sql: "SELECT ?2",
    params: [null, "from-file"],
    max_rows: 3
  }
});
assert.deepEqual(parseCliArgs(["query", "alpha", "SELECT", ":body", "--params-file", namedParamsFilePath, "--max-rows", "3"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: {
    database_id: "alpha",
    sql: "SELECT :body",
    params: ["named-file"],
    max_rows: 3
  }
});
assert.deepEqual(parseCliArgs(["query", "alpha", "SELECT :body AS body, length(:body) AS size", "--params", "{\"body\":\"named-inline\"}", "--max-rows", "3"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: {
    database_id: "alpha",
    sql: "SELECT :body AS body, length(:body) AS size",
    params: ["named-inline"],
    max_rows: 3
  }
});
assert.deepEqual(parseCliArgs(["execute", "alpha", "INSERT INTO notes(body) VALUES (:body)", "--params", "{\"body\":\"named-inline\"}", "--idempotency-key", "op_named"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/execute",
  body: {
    database_id: "alpha",
    sql: "INSERT INTO notes(body) VALUES (:body)",
    params: ["named-inline"],
    max_rows: 100
  },
  idempotencyKey: "op_named"
});
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT 1", "--params", "{\"body\":\"named-inline\"}"], env), /named SQL params require named placeholders/);
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT :body", "--params", "{}"], env), /missing SQL named param: body/);
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT 1", "--params", "[]", "--params-file", paramsFilePath], env), /use only one of --params or --params-file/);
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT 1", "--params-file", paramsFilePath, "--params", "[]"], env), /use only one of --params or --params-file/);
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT 1", "--params-file", invalidParamsFilePath], env), /params must be a JSON array or object/);
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT 1", "--params-file", "   "], env), /params file must be a non-empty string/);
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT 1", "--idempotency-key", "op_read"], env), /idempotency-key is only valid for write SQL/);
assert.throws(() => parseCliArgs(["scalar", "alpha", "SELECT 1", "--idempotency-key", "op_read"], env), /idempotency-key is only valid for write SQL/);
assert.throws(() => parseCliArgs(["scalar", "alpha", "SELECT 1", "--wait"], env), /--wait is only valid for execute/);
assert.throws(() => parseCliArgs(["query", "alpha", "SELECT 1"], { ...env, ICPDB_IDEMPOTENCY_KEY: "op_read_env" }), /idempotency-key is only valid for write SQL/);

assert.deepEqual(parseCliArgs(["--database-id", "beta", "query", "SELECT 1"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "beta", sql: "SELECT 1", params: [], max_rows: 100 }
});

assert.deepEqual(parseCliArgs(["query", "beta", "SELECT 1"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "beta", sql: "SELECT 1", params: [], max_rows: 100 }
});

assert.deepEqual(parseCliArgs(["query", "/* leading */ SELECT 1"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "alpha", sql: "/* leading */ SELECT 1", params: [], max_rows: 100 }
});

assert.deepEqual(parseCliArgs(["scalar", "SELECT 1"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "alpha", sql: "SELECT 1", params: [], max_rows: 1 },
  scalar: true
});

assert.deepEqual(parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/alpha",
  ICPDB_TOKEN: "secret"
}), {
  baseUrl: "https://ryjl3-tyaaa-aaaaa-aaaba-cai.icp0.io",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "alpha", sql: "SELECT 1", params: [], max_rows: 100 }
});
assert.deepEqual(parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db%2Fslash",
  ICPDB_TOKEN: "secret"
}), {
  baseUrl: "https://ryjl3-tyaaa-aaaaa-aaaba-cai.icp0.io",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "db/slash", sql: "SELECT 1", params: [], max_rows: 100 }
});
assert.deepEqual(parseCliArgs(["databases"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/alpha",
  ICPDB_NETWORK_URL: "http://localhost:8001"
}), {
  databases: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: ""
});
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://owner@ryjl3-tyaaa-aaaaa-aaaba-cai/alpha",
  ICPDB_TOKEN: "secret"
}), /username or password/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai:123/alpha",
  ICPDB_TOKEN: "secret"
}), /must not include a port/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/alpha?mode=read",
  ICPDB_TOKEN: "secret"
}), /query or fragment/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/alpha#read",
  ICPDB_TOKEN: "secret"
}), /query or fragment/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db%ZZ",
  ICPDB_TOKEN: "secret"
}), /database id encoding/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai//alpha",
  ICPDB_TOKEN: "secret"
}), /expected icpdb:\/\/<canister-id>\/<database-id>/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/alpha",
  ICPDB_DATABASE_ID: "beta",
  ICPDB_TOKEN: "secret"
}), /ICPDB_DATABASE_ID does not match ICPDB_URL/);
assert.throws(() => parseCliArgs(["databases"], {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/alpha",
  ICPDB_CANISTER_ID: "bbbbb-bb",
  ICPDB_NETWORK_URL: "http://localhost:8001"
}), /ICPDB_CANISTER_ID does not match ICPDB_URL/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_URL: "",
  ICPDB_TOKEN: "secret"
}), /ICPDB_URL must be a non-empty string/);
assert.throws(() => parseCliArgs(["databases"], {
  ICPDB_CANISTER_ID: "",
  ICPDB_NETWORK_URL: "http://localhost:8001"
}), /ICPDB_CANISTER_ID must be a non-empty string/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_DATABASE_ID: "",
  ICPDB_HTTP_BASE_URL: "https://db.example",
  ICPDB_TOKEN: "secret"
}), /ICPDB_DATABASE_ID must be a non-empty string/);
assert.throws(() => parseCliArgs(["query", "SELECT 1"], {
  ICPDB_DATABASE_ID: "   ",
  ICPDB_HTTP_BASE_URL: "https://db.example",
  ICPDB_TOKEN: "secret"
}), /ICPDB_DATABASE_ID must be a non-empty string/);
assert.throws(() => parseCliArgs(["--database-id", "   ", "query", "SELECT 1"], {
  ICPDB_HTTP_BASE_URL: "https://db.example",
  ICPDB_TOKEN: "secret"
}), /database_id must be a non-empty string/);
assert.throws(() => parseCliArgs(["query", "   ", "SELECT 1"], env), /database_id must be a non-empty string/);

const envFilePath = checkFile("database.env");
await writeFile(envFilePath, [
  "# create-db --format env output",
  "ICPDB_HTTP_BASE_URL=\"https://file.example\"",
  "ICPDB_TOKEN=\"file-secret\"",
  "ICPDB_DATABASE_ID=\"file_db\""
].join("\n"));
await chmod(envFilePath, 0o600);
assert.deepEqual(parseCliArgs(["--env-file", envFilePath, "query", "SELECT 1"], {}), {
  baseUrl: "https://file.example",
  token: "file-secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "file_db", sql: "SELECT 1", params: [], max_rows: 100 }
});
assert.deepEqual(parseCliArgs([
  "--env-file",
  envFilePath,
  "--base-url",
  "https://override.example",
  "--database-id",
  "override_db",
  "query",
  "SELECT 1"
], {}), {
  baseUrl: "https://override.example",
  token: "file-secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "override_db", sql: "SELECT 1", params: [], max_rows: 100 }
});
assert.deepEqual(parseCliArgs([
  "--env-file",
  envFilePath,
  "--idempotency-key",
  "cli-key",
  "execute",
  "CREATE TABLE notes(id INTEGER)"
], {}), {
  baseUrl: "https://file.example",
  token: "file-secret",
  endpoint: "/v1/sql/execute",
  body: {
    database_id: "file_db",
    sql: "CREATE TABLE notes(id INTEGER)",
    params: [],
    max_rows: 100
  },
  idempotencyKey: "cli-key"
});
assert.deepEqual(parseCliArgs(["--env-file", envFilePath, "archive", "/tmp/file-backup.sqlite3"], {}), {
  archive: true,
  baseUrl: "https://file.example",
  token: "file-secret",
  databaseId: "file_db",
  filePath: "/tmp/file-backup.sqlite3"
});
assert.deepEqual(parseCliArgs([
  "--env-file",
  envFilePath,
  "restore",
  "/tmp/file-backup.sqlite3",
  "--expect-snapshot-hash",
  "bb".repeat(32)
], {}), {
  restore: true,
  baseUrl: "https://file.example",
  token: "file-secret",
  databaseId: "file_db",
  filePath: "/tmp/file-backup.sqlite3",
  expectedSnapshotHash: "bb".repeat(32)
});
const duplicateEnvFilePath = checkFile("duplicate-database.env");
await writeFile(duplicateEnvFilePath, "ICPDB_TOKEN=\"first\"\nICPDB_TOKEN=\"second\"\n");
await chmod(duplicateEnvFilePath, 0o600);
assert.throws(
  () => parseCliArgs(["--env-file", duplicateEnvFilePath, "query", "SELECT 1"], {}),
  /duplicate env key ICPDB_TOKEN/
);
assert.throws(
  () => parseCliArgs(["--env-file"], {}),
  /--env-file requires a value/
);
const openEnvFilePath = checkFile("open-database.env");
await writeFile(openEnvFilePath, "ICPDB_TOKEN=\"open-secret\"\n", { mode: 0o644 });
await chmod(openEnvFilePath, 0o644);
assert.throws(
  () => parseCliArgs(["--env-file", openEnvFilePath, "query", "SELECT 1"], {}),
  /HTTP env file must be owner-only/
);
await unlink(envFilePath);
await unlink(duplicateEnvFilePath);
await unlink(openEnvFilePath);

assert.deepEqual(
  buildCommand(["execute", "alpha", "CREATE TABLE notes(id INTEGER)"], {
    baseUrl: "https://db.example/",
    token: "secret",
    params: [],
    maxRows: 100,
    limit: 100,
    offset: 0,
    statements: [],
    idempotencyKey: "op_ddl"
  }),
  {
    baseUrl: "https://db.example/",
    token: "secret",
    endpoint: "/v1/sql/execute",
    body: {
      database_id: "alpha",
      sql: "CREATE TABLE notes(id INTEGER)",
      params: [],
      max_rows: 100
    },
    idempotencyKey: "op_ddl"
  }
);

assert.deepEqual(parseCliArgs(["execute", "CREATE", "TABLE", "notes(id INTEGER)", "--idempotency-key", "op_ddl"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/execute",
  body: {
    database_id: "alpha",
    sql: "CREATE TABLE notes(id INTEGER)",
    params: [],
    max_rows: 100
  },
  idempotencyKey: "op_ddl"
});

assert.deepEqual(parseCliArgs(["batch", "alpha", "--idempotency-key", "op_batch", "--statement", "CREATE TABLE notes(id INTEGER)", "--statement", "SELECT 1"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/batch",
  body: {
    database_id: "alpha",
    statements: [
      { sql: "CREATE TABLE notes(id INTEGER)", params: [] },
      { sql: "SELECT 1", params: [] }
    ],
    max_rows: 100
  },
  idempotencyKey: "op_batch"
});

assert.deepEqual(parseCliArgs(["batch", "--idempotency-key", "op_batch", "--statement", "CREATE TABLE notes(id INTEGER)", "--statement", "SELECT 1"], databaseEnv), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/batch",
  body: {
    database_id: "alpha",
    statements: [
      { sql: "CREATE TABLE notes(id INTEGER)", params: [] },
      { sql: "SELECT 1", params: [] }
    ],
    max_rows: 100
  },
  idempotencyKey: "op_batch"
});

assert.deepEqual(parseCliArgs(["batch", "alpha", "--mode", "read", "--statements-file", statementsFilePath], env), {
  readBatch: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  statements: [{ sql: "SELECT :body AS body", params: ["from-file"] }],
  maxRows: 100
});

assert.deepEqual(parseCliArgs(["batch", "alpha", "--statements-file", statementsFilePath], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/batch",
  body: {
    database_id: "alpha",
    statements: [{ sql: "SELECT :body AS body", params: ["from-file"] }],
    max_rows: 100
  }
});

assert.deepEqual(parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "SELECT 1", "--statement", "PRAGMA table_info(notes)"], env), {
  readBatch: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  statements: [
    { sql: "SELECT 1", params: [] },
    { sql: "PRAGMA table_info(notes)", params: [] }
  ],
  maxRows: 100
});
assert.equal(parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "WITH payload(value) AS (SELECT 1) SELECT value FROM payload"], env).readBatch, true);
assert.equal(parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "WITH payload(value) AS MATERIALIZED (SELECT 1) SELECT value FROM payload"], env).readBatch, true);
assert.equal(parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "WITH payload(value) AS NOT MATERIALIZED (SELECT 1) SELECT value FROM payload"], env).readBatch, true);
assert.throws(() => parseCliArgs(["batch", "alpha", "--mode", "readonly", "--statement", "SELECT 1"], env), /mode must be read or write/);
assert.throws(() => parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "INSERT"], env), /read batch statement 1 is not read-only/);
assert.throws(() => parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "PRAGMA foreign_keys=off"], env), /read batch statement 1 is not read-only/);
assert.throws(() => parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "SELECT 1", "--idempotency-key", "op_read"], env), /idempotency-key is only valid for write batch/);
assert.throws(() => parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "SELECT 1", "--wait"], env), /wait is only valid for write batch/);
assert.throws(() => parseCliArgs(["batch", "alpha", "--statement", "SELECT 1", "--statements-file", statementsFilePath], env), /use only one of --statement or --statements-file/);

assert.deepEqual(parseCliArgs(["shell", "alpha", "--max-rows", "7"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 7,
  shellSql: null
});

assert.deepEqual(parseCliArgs(["shell", "alpha", "--format", "json"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 100,
  shellSql: null,
  outputFormat: "json"
});

assert.deepEqual(parseCliArgs(["query", "alpha", "SELECT body FROM notes", "--format", "csv"], env), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "alpha", sql: "SELECT body FROM notes", params: [], max_rows: 100 },
  outputFormat: "csv"
});

assert.deepEqual(parseCliArgs(["shell", "alpha", "SELECT", "1"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 100,
  shellSql: "SELECT 1"
});

assert.deepEqual(parseCliArgs(["shell", "SELECT", "1"], databaseEnv), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 100,
  shellSql: "SELECT 1"
});

assert.deepEqual(parseCliArgs(["shell", "alpha", "--idempotency-key", "shell_write", "INSERT", "INTO", "notes", "VALUES", "(1)"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 100,
  shellSql: "INSERT INTO notes VALUES (1)",
  idempotencyKeyPrefix: "shell_write"
});

assert.deepEqual(parseCliArgs(["shell", "alpha", "--wait", "INSERT", "INTO", "notes", "VALUES", "(1)"], env), {
  shell: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 100,
  shellSql: "INSERT INTO notes VALUES (1)",
  waitForRoutedOperation: true
});

assert.deepEqual(shellLineCommand(".help", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  help: true
});
assert.deepEqual(shellLineCommand(".help inspect", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  help: true,
  helpTopic: "inspect"
});
const shellContext = { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 };

assert.deepEqual(shellLineCommand(".tables", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand("PRAGMA table_info(notes)", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "alpha", sql: "PRAGMA table_info(notes)", params: [], max_rows: 5 }
});
const pragmaWriteCommand = shellLineCommand("PRAGMA foreign_keys=off", shellContext);
assert.equal(pragmaWriteCommand.endpoint, "/v1/sql/execute");
assert.equal(pragmaWriteCommand.body.sql, "PRAGMA foreign_keys=off");
assert.match(pragmaWriteCommand.idempotencyKey, /^shell-alpha-[0-9a-f-]{36}$/);

assert.deepEqual(shellLineCommand(".views", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  databaseViews: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha"
});

assert.deepEqual(shellLineCommand(".stats", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  stats: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha"
});

assert.deepEqual(shellLineCommand(".usage", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".billing", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/billing",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".payments", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/payments/list",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".placement", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/placements/get",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".operation op_insert_1", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/operations/get",
  body: { database_id: "alpha", operation_id: "op_insert_1" }
});
assert.throws(() => shellLineCommand(".operation", shellContext), /\.operation requires an argument/);

assert.deepEqual(shellLineCommand(".usage-events", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/usage/events",
  body: { database_id: "alpha" }
});

assert.deepEqual(shellLineCommand(".quota 67108864", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/quota/set",
  body: { database_id: "alpha", max_logical_size_bytes: 67108864 }
});
assert.throws(() => shellLineCommand(".quota -1", shellContext), /max_logical_size_bytes must be a non-negative integer/);
assert.throws(() => shellLineCommand(".quota 9007199254740992", shellContext), /max_logical_size_bytes exceeds JS safe integer range/);
assert.throws(() => shellLineCommand(".quota", shellContext), /missing max_logical_size_bytes/);
assert.throws(() => shellLineCommand(".quota 1 extra", shellContext), /\.quota accepts at most 1 argument/);

assert.deepEqual(shellLineCommand(".tokens", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/list",
  body: { database_id: "alpha" }
});
assert.deepEqual(shellLineCommand(".create-token web-read read", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/create",
  body: { database_id: "alpha", name: "web-read", scope: "read" }
});
assert.deepEqual(shellLineCommand(".revoke-token tok_abc", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tokens/revoke",
  body: { database_id: "alpha", token_id: "tok_abc" }
});
assert.throws(() => shellLineCommand(".create-token '   ' read", shellContext), /token_name must be a non-empty string/);
assert.throws(() => shellLineCommand(".create-token", shellContext), /missing token_name/);
assert.throws(() => shellLineCommand(".create-token web-read admin", shellContext), /scope must be read, write, or owner/);
assert.throws(() => shellLineCommand(".create-token web-read", shellContext), /missing scope/);
assert.throws(() => shellLineCommand(".create-token web-read read extra", shellContext), /\.create-token accepts at most 2 arguments/);
assert.throws(() => shellLineCommand(".revoke-token", shellContext), /missing token_id/);
assert.throws(() => shellLineCommand(".revoke-token '   '", shellContext), /token_id must be a non-empty string/);
assert.throws(() => shellLineCommand(".revoke-token tok_abc extra", shellContext), /\.revoke-token accepts at most 1 argument/);

assert.deepEqual(shellLineCommand(".members", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/list",
  body: { database_id: "alpha" }
});
assert.deepEqual(shellLineCommand(".grant-member aaaaa-aa writer", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/grant",
  body: { database_id: "alpha", principal: "aaaaa-aa", role: "writer" }
});
assert.deepEqual(shellLineCommand(".revoke-member aaaaa-aa", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/members/revoke",
  body: { database_id: "alpha", principal: "aaaaa-aa" }
});
assert.throws(() => shellLineCommand(".grant-member 2vxsx-fae reader", shellContext), /anonymous principal cannot be granted database access/);
assert.throws(() => shellLineCommand(".grant-member", shellContext), /missing principal/);
assert.throws(() => shellLineCommand(".grant-member not-principal reader", shellContext), /database member principal must be a valid principal/);
assert.throws(() => shellLineCommand(".grant-member aaaaa-aa admin", shellContext), /role must be reader, writer, or owner/);
assert.throws(() => shellLineCommand(".grant-member aaaaa-aa", shellContext), /missing role/);
assert.throws(() => shellLineCommand(".grant-member aaaaa-aa writer extra", shellContext), /\.grant-member accepts at most 2 arguments/);
assert.throws(() => shellLineCommand(".revoke-member '   '", shellContext), /database member principal must be a non-empty string/);
assert.throws(() => shellLineCommand(".revoke-member not-principal", shellContext), /database member principal must be a valid principal/);
assert.throws(() => shellLineCommand(".revoke-member aaaaa-aa extra", shellContext), /\.revoke-member accepts at most 1 argument/);

assert.deepEqual(shellLineCommand(".preview notes 2", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  body: { database_id: "alpha", table_name: "notes", limit: 2, offset: 0 }
});

assert.deepEqual(shellLineCommand(".preview notes 2 10", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  body: { database_id: "alpha", table_name: "notes", limit: 2, offset: 10 }
});
assert.throws(() => shellLineCommand(".preview notes 0", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), /preview limit must be an integer from 1 to 500/);
assert.throws(() => shellLineCommand(".preview notes 2 4294967296", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), /preview offset must be an integer from 0 to 4294967295/);

assert.deepEqual(shellLineCommand(".columns notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  tableColumns: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".indexes notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  tableIndexes: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".triggers notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  tableTriggers: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".foreign-keys notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  tableForeignKeys: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".inspect notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  includeAccess: false,
  limit: 5,
  offset: 0
});

assert.deepEqual(shellLineCommand(".inspect notes 2 10", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  includeAccess: false,
  limit: 2,
  offset: 10
});
assert.throws(() => shellLineCommand(".inspect notes 0", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), /inspect limit must be an integer from 1 to 500/);
assert.throws(() => shellLineCommand(".inspect notes 2 4294967296", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), /inspect offset must be an integer from 0 to 4294967295/);

assert.deepEqual(shellLineCommand(".inspect --access", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: null,
  includeAccess: true,
  limit: 5,
  offset: 0
});

assert.deepEqual(shellLineCommand(".schema notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  schema: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes"
});

assert.deepEqual(shellLineCommand(".dump notes", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  dump: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "notes",
  limit: 5
});
const shellLoadCommand = shellLineCommand(".load /tmp/dump.sql", shellContext);
assert.deepEqual({
  ...shellLoadCommand,
  idempotencyKey: "<generated>"
}, {
  load: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/dump.sql",
  maxRows: 5,
  idempotencyKey: "<generated>"
});
assert.match(shellLoadCommand.idempotencyKey, /^shell-alpha-[0-9a-f-]{36}$/);

const shellScriptCommand = shellLineCommand(".script 'setup file.sql'", {
  ...shellContext,
  idempotencyKeyPrefix: "file-shell",
  waitForRoutedOperation: true
});
assert.deepEqual({
  ...shellScriptCommand,
  idempotencyKey: "<generated>"
}, {
  script: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "setup file.sql",
  maxRows: 5,
  idempotencyKey: "<generated>",
  waitForRoutedOperation: true
});
assert.match(shellScriptCommand.idempotencyKey, /^file-shell-[0-9a-f-]{36}$/);

const shellMigrateCommand = shellLineCommand(".migrate migrations.json", shellContext);
assert.equal(shellMigrateCommand.migrate, true);
assert.equal(shellMigrateCommand.filePath, "migrations.json");
assert.match(shellMigrateCommand.idempotencyKey, /^shell-alpha-[0-9a-f-]{36}$/);

assert.deepEqual(shellLineCommand(".archive /tmp/db.sqlite", shellContext), {
  archive: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/db.sqlite"
});
assert.deepEqual(shellLineCommand(".snapshot-info /tmp/db.sqlite", shellContext), {
  snapshotInfo: true,
  command: "snapshot-info",
  filePath: "/tmp/db.sqlite"
});
assert.deepEqual(shellLineCommand(`.restore /tmp/db.sqlite ${"AA".repeat(32)}`, shellContext), {
  restore: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  filePath: "/tmp/db.sqlite",
  expectedSnapshotHash: "aa".repeat(32)
});
assert.equal(shellLineCommand(`.restore "/tmp/db file.sqlite" " ${"AA".repeat(32)} "`, shellContext).filePath, "/tmp/db file.sqlite");
assert.equal(shellLineCommand(`.restore /tmp/db.sqlite " ${"AA".repeat(32)} "`, shellContext).expectedSnapshotHash, "aa".repeat(32));
assert.deepEqual(shellLineCommand(".archive-cancel", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/archive/cancel",
  body: { database_id: "alpha" }
});
assert.deepEqual(shellLineCommand(".delete-db", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/database/delete",
  body: { database_id: "alpha" }
});
assert.throws(() => shellLineCommand(".load", shellContext), /\.load file is required/);
assert.throws(() => shellLineCommand(".load '   '", shellContext), /\.load file is required/);
assert.throws(() => shellLineCommand(".script one.sql two.sql", shellContext), /\.script accepts at most 1 argument/);
assert.throws(() => shellLineCommand(".archive", shellContext), /\.archive file is required/);
assert.throws(() => shellLineCommand(".archive '   '", shellContext), /\.archive file is required/);
assert.throws(() => shellLineCommand(".snapshot-info '   '", shellContext), /\.snapshot-info file is required/);
assert.throws(() => shellLineCommand(".restore '   '", shellContext), /\.restore file is required/);
assert.throws(() => shellLineCommand(".restore /tmp/db.sqlite '   '", shellContext), /64-character SHA-256/);
assert.throws(() => shellLineCommand(".restore /tmp/db.sqlite aa bb", shellContext), /\.restore accepts at most 2 arguments/);
assert.throws(() => shellLineCommand(".archive-cancel extra", shellContext), /\.archive-cancel accepts at most 0 arguments/);
assert.throws(() => shellLineCommand(".delete-db extra", shellContext), /\.delete-db accepts at most 0 arguments/);
assert.equal(shellLineCommand(".schema \"space table\"", shellContext).tableName, "space table");
assert.equal(shellLineCommand(".dump 'space table'", shellContext).tableName, "space table");
assert.equal(shellLineCommand(".load escaped\\ file.sql", shellContext).filePath, "escaped file.sql");
assert.equal(shellLineCommand(".archive escaped\\ db.sqlite", shellContext).filePath, "escaped db.sqlite");
assert.equal(shellLineCommand(".columns 'space table'", shellContext).tableName, "space table");
assert.deepEqual(shellLineCommand(".preview \"space table\" 2 10", shellContext), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/tables/preview",
  body: { database_id: "alpha", table_name: "space table", limit: 2, offset: 10 }
});
assert.deepEqual(shellLineCommand(".inspect \"space table\" 2 10", shellContext), {
  inspect: true,
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  tableName: "space table",
  includeAccess: false,
  limit: 2,
  offset: 10
});
assert.equal(shellLineCommand(".operation \"op id\"", shellContext).body.operation_id, "op id");
assert.throws(() => shellLineCommand(".operation '   '", shellContext), /operation_id must be a non-empty string/);
assert.equal(shellLineCommand(".schema escaped\\ table", shellContext).tableName, "escaped table");
assert.throws(() => shellLineCommand(".schema \"unterminated", shellContext), /unterminated shell quote/);
assert.throws(() => shellLineCommand(".describe '   '", shellContext), /table_name must be a non-empty string/);
assert.throws(() => shellLineCommand(".describe", shellContext), /\.describe requires an argument/);
assert.throws(() => shellLineCommand(".preview", shellContext), /missing table_name/);
assert.throws(() => shellLineCommand(".unknown", shellContext), /unknown shell command: \.unknown/);
assert.throws(() => shellLineCommand(".schema '   '", shellContext), /table_name must be a non-empty string/);
assert.throws(() => shellLineCommand(".dump '   '", shellContext), /table_name must be a non-empty string/);
assert.throws(() => shellLineCommand(".preview '   '", shellContext), /table_name must be a non-empty string/);
assert.throws(() => shellLineCommand(".inspect '   '", shellContext), /table_name must be a non-empty string/);
assert.throws(() => shellLineCommand(".columns notes extra", shellContext), /\.columns requires exactly one argument/);
assert.throws(() => shellLineCommand(".preview notes 1 2 3", shellContext), /\.preview accepts at most 3 arguments/);

assert.deepEqual(shellLineCommand("select 1", { baseUrl: "https://db.example", token: "secret", databaseId: "alpha", maxRows: 5 }), {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/query",
  body: { database_id: "alpha", sql: "select 1", params: [], max_rows: 5 }
});
assert.equal(shellLineCommand("WITH payload(value) AS (SELECT 1) SELECT value FROM payload", {
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 5
}).endpoint, "/v1/sql/query");
assert.equal(shellLineCommand("WITH payload(value) AS (SELECT 1) INSERT INTO notes(id) SELECT value FROM payload", {
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 5
}).endpoint, "/v1/sql/execute");

const shellWriteCommand = shellLineCommand("insert into notes values (1)", {
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 5
});
assert.deepEqual({
  ...shellWriteCommand,
  idempotencyKey: "<generated>"
}, {
  baseUrl: "https://db.example",
  token: "secret",
  endpoint: "/v1/sql/execute",
  body: { database_id: "alpha", sql: "insert into notes values (1)", params: [], max_rows: 5 },
  idempotencyKey: "<generated>"
});
assert.match(shellWriteCommand.idempotencyKey, /^shell-alpha-[0-9a-f-]{36}$/);

const prefixedShellWriteCommand = shellLineCommand("insert into notes values (1)", {
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 5,
  idempotencyKeyPrefix: "shell_write"
});
assert.match(prefixedShellWriteCommand.idempotencyKey, /^shell_write-[0-9a-f-]{36}$/);

const waitingShellWriteCommand = shellLineCommand("insert into notes values (1)", {
  baseUrl: "https://db.example",
  token: "secret",
  databaseId: "alpha",
  maxRows: 5,
  waitForRoutedOperation: true
});
assert.equal(waitingShellWriteCommand.waitForRoutedOperation, true);

const shellDispatchLoadResult = await executeShellCommand({ load: true, filePath: "/tmp/dump.sql" }, {
  load: (command) => ({ kind: "load", filePath: command.filePath })
});
assert.deepEqual(shellDispatchLoadResult, { kind: "load", filePath: "/tmp/dump.sql" });

const shellDispatchArchiveResult = await executeShellCommand({ archive: true, filePath: "/tmp/db.sqlite" }, {
  archive: (command) => ({ kind: "archive", filePath: command.filePath })
});
assert.deepEqual(shellDispatchArchiveResult, { kind: "archive", filePath: "/tmp/db.sqlite" });

const calls = [];
const okResponse = await callIcpdbHttp(
  parseCliArgs(["tables", "alpha"], env),
  async (url, request) => {
    calls.push({ url, request });
    return new Response(JSON.stringify([{ name: "notes" }]), { status: 200 });
  }
);
assert.deepEqual(okResponse, [{ name: "notes" }]);
assert.equal(calls[0].url, "https://db.example/v1/tables/list");
assert.equal(calls[0].request.headers.authorization, "Bearer secret");
assert.equal(calls[0].request.headers["content-type"], "application/json");
assert.equal(calls[0].request.body, JSON.stringify({ database_id: "alpha" }));

const scalarCalls = [];
const scalarResponse = await callIcpdbHttp(
  parseCliArgs(["scalar", "alpha", "SELECT count(*) AS total"], env),
  async (url, request) => {
    scalarCalls.push({ url, request });
    return new Response(JSON.stringify({
      columns: ["total"],
      rows: [[{ Integer: "3" }]],
      rows_affected: 0,
      truncated: false
    }), { status: 200 });
  }
);
assert.deepEqual(scalarResponse, {
  scalar: true,
  column: "total",
  value: { Integer: "3" },
  row_found: true,
  rows_returned: 1,
  truncated: false
});
assert.equal(scalarCalls[0].url, "https://db.example/v1/sql/query");
assert.equal(JSON.parse(scalarCalls[0].request.body).max_rows, 1);

const idempotentCalls = [];
await callIcpdbHttp(
  parseCliArgs(["--idempotency-key", "op_insert_1", "execute", "alpha", "INSERT INTO notes VALUES (1)"], env),
  async (url, request) => {
    idempotentCalls.push({ url, request });
    return new Response(JSON.stringify({ rows: [], columns: [], rows_affected: 1, last_insert_rowid: 1, truncated: false }), { status: 200 });
  }
);
assert.equal(idempotentCalls[0].request.headers["idempotency-key"], "op_insert_1");

const readBatchCalls = [];
const readBatch = await callIcpdbHttp(
  parseCliArgs(["batch", "alpha", "--mode", "read", "--statement", "SELECT 1", "--statement", "PRAGMA table_info(notes)", "--max-rows", "3"], env),
  async (url, request) => {
    readBatchCalls.push({ url, request });
    return new Response(JSON.stringify({ rows: [[1]], columns: ["value"], rows_affected: 0, last_insert_rowid: 0, truncated: false }), { status: 200 });
  }
);
assert.equal(readBatch.length, 2);
assert.deepEqual(readBatchCalls.map((call) => call.url), [
  "https://db.example/v1/sql/query",
  "https://db.example/v1/sql/query"
]);
assert.equal(JSON.parse(readBatchCalls[0].request.body).max_rows, 3);
assert.equal(readBatchCalls[0].request.headers["idempotency-key"], undefined);

const waitedExecuteCalls = [];
const waitedExecute = await callIcpdbHttp(
  parseCliArgs(["--idempotency-key", "op_insert_wait", "--wait", "execute", "alpha", "INSERT INTO notes VALUES (1)"], env),
  async (url, request) => {
    waitedExecuteCalls.push({ url, request });
    if (url.endsWith("/v1/operations/get")) {
      return new Response(JSON.stringify({
        operation_id: "op_insert_wait",
        database_id: "alpha",
        database_canister_id: "db-canister",
        method: "sql_execute",
        request_hash: [],
        status: "applied",
        error: "",
        created_at_ms: "1",
        updated_at_ms: "2"
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      rows: [],
      columns: [],
      rows_affected: 1,
      last_insert_rowid: 1,
      truncated: false,
      routed_operation_id: "op_insert_wait"
    }), { status: 200 });
  }
);
assert.equal(waitedExecute.routed_operation.status, "applied");
assert.deepEqual(waitedExecuteCalls.map((call) => call.url), [
  "https://db.example/v1/sql/execute",
  "https://db.example/v1/operations/get"
]);
assert.equal(JSON.parse(waitedExecuteCalls[1].request.body).operation_id, "op_insert_wait");

const waitedBatch = await callIcpdbHttp(
  parseCliArgs(["--idempotency-key", "op_batch_wait", "--wait", "batch", "alpha", "[{\"sql\":\"INSERT INTO notes VALUES (1)\"}]"], env),
  async (url) => {
    if (url.endsWith("/v1/operations/get")) {
      return new Response(JSON.stringify({
        operation_id: "op_batch_wait",
        database_id: "alpha",
        database_canister_id: "db-canister",
        method: "sql_batch",
        request_hash: [],
        status: "applied",
        error: "",
        created_at_ms: "1",
        updated_at_ms: "2"
      }), { status: 200 });
    }
    return new Response(JSON.stringify([
      { rows: [], columns: [], rows_affected: 1, last_insert_rowid: 1, truncated: false, routed_operation_id: "op_batch_wait" }
    ]), { status: 200 });
  }
);
assert.equal(waitedBatch.results.length, 1);
assert.equal(waitedBatch.routed_operations[0].status, "applied");

await assert.rejects(
  callIcpdbHttp(parseCliArgs(["tables", "alpha"], env), async () => {
    return new Response(JSON.stringify({ error: "invalid api token" }), { status: 401 });
  }),
  /invalid api token/
);

const createDbCalls = [];
const createdDb = await createIcpdbDatabase(parseCliArgs(["create-db", "cli-owner"], env), async (binary, args) => {
  createDbCalls.push({ binary, args });
  if (args.includes("create_database")) {
    return { stdout: '(variant { Ok = "db_created" })' };
  }
  return {
    stdout: '(variant { Ok = record { info = record { token_id = "tok_owner" }; token = "owner-secret" } })'
  };
});
assert.deepEqual(createdDb, {
  database_id: "db_created",
  owner_token: {
    token_id: "tok_owner",
    token: "owner-secret"
  }
});
const formattedCreatedDb = formatCliOutput(createdDb, { createDatabase: true, outputFormat: "table" });
assert.match(formattedCreatedDb, /database_id\s+\|\s+owner_token_id\s+\|\s+owner_token/);
assert.match(formattedCreatedDb, /db_created\s+\|\s+tok_owner\s+\|\s+owner-secret/);
const formattedCreatedDbEnv = formatCliOutput(createdDb, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  baseUrl: "http://icpdb.localhost:8001"
});
assert.match(formattedCreatedDbEnv, /ICPDB_CANISTER_ID="ryjl3-tyaaa-aaaaa-aaaba-cai"/);
assert.match(formattedCreatedDbEnv, /ICPDB_NETWORK_URL="http:\/\/localhost:8001"/);
assert.match(formattedCreatedDbEnv, /ICPDB_DATABASE_ID="db_created"/);
assert.match(formattedCreatedDbEnv, /ICPDB_URL="icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_created"/);
assert.match(formattedCreatedDbEnv, /ICPDB_TOKEN="owner-secret"/);
assert.match(formattedCreatedDbEnv, /ICPDB_ROOT_KEY="local-root-key"/);
assert.match(formattedCreatedDbEnv, /ICPDB_HTTP_BASE_URL="http:\/\/icpdb.localhost:8001"/);
assert.match(formatCliOutput({
  ...createdDb,
  database_id: "db/slash"
}, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001"
}), /ICPDB_URL="icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db%2Fslash"/);
assert.throws(() => formatCliOutput({
  ...createdDb,
  database_id: "   "
}, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001"
}), /databaseId must be a non-empty string/);
assert.throws(() => formatCliOutput({
  ...createdDb,
  owner_token: { token_id: "tok_owner", token: "   " }
}, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001"
}), /ownerToken must be a non-empty string/);
assert.throws(() => formatCliOutput(createdDb, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "   ",
  networkUrl: "http://localhost:8001"
}), /canisterId must be a non-empty string/);
assert.throws(() => formatCliOutput(createdDb, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "   "
}), /networkUrl must be a non-empty string/);
assert.throws(() => formatCliOutput({
  ...createdDb,
  database_id: ""
}, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001"
}), /databaseId must be a non-empty string/);
assert.throws(() => formatCliOutput(createdDb, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "",
  networkUrl: "http://localhost:8001"
}), /canisterId must be a non-empty string/);
assert.throws(() => formatCliOutput(createdDb, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: ""
}), /networkUrl must be a non-empty string/);
assert.throws(() => formatCliOutput({
  ...createdDb,
  owner_token: { token_id: "tok_owner", token: "" }
}, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001"
}), /ownerToken must be a non-empty string/);
const envOutPath = checkFile("env-out.env");
await writeHttpEnvOutputFile(envOutPath, createdDb, {
  createDatabase: true,
  outputFormat: "env",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  rootKey: "local-root-key",
  baseUrl: "http://icpdb.localhost:8001"
});
assert.equal(await readFile(envOutPath, "utf8"), `${formattedCreatedDbEnv}\n`);
assert.equal((await stat(envOutPath)).mode & 0o777, 0o600);
await unlink(envOutPath);
const failingHttpEnvOutDeletes = [];
await assert.rejects(() => writeHttpEnvOutputFileOrDelete(
  checkFile("missing/database.env"),
  createdDb,
  {
    createDatabase: true,
    outputFormat: "env",
    canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
    networkUrl: "http://localhost:8001"
  },
  async (url, init) => {
    failingHttpEnvOutDeletes.push({ url, init });
    return new Response("null", { status: 200 });
  }
), /ENOENT/);
assert.equal(failingHttpEnvOutDeletes[0].url, "https://ryjl3-tyaaa-aaaaa-aaaba-cai.icp0.io/v1/database/delete");
assert.equal(failingHttpEnvOutDeletes[0].init.headers.authorization, "Bearer owner-secret");
assert.deepEqual(JSON.parse(failingHttpEnvOutDeletes[0].init.body), { database_id: "db_created" });
assert.throws(
  () => formatCliOutput({ ok: true }, { outputFormat: "env" }),
  /format env is only available for create-db, archive, or snapshot-info output/
);
assert.equal(createDbCalls[0].binary, "icp");
assert.deepEqual(createDbCalls[0].args.slice(0, 7), [
  "canister",
  "call",
  "-n",
  "http://localhost:8001",
  "-k",
  "local-root-key",
  "ryjl3-tyaaa-aaaaa-aaaba-cai"
]);
assert.match(createDbCalls[1].args.join(" "), /create_database_token/);
assert.match(createDbCalls[1].args.join(" "), /cli-owner/);
const tokenFailureCreateDbCalls = [];
await assert.rejects(
  () => createIcpdbDatabase(parseCliArgs(["create-db", "cli-owner"], env), async (_binary, args) => {
    tokenFailureCreateDbCalls.push(args);
    if (args.includes("create_database")) {
      return { stdout: '(variant { Ok = "db_token_failure" })' };
    }
    if (args.includes("delete_database")) {
      return { stdout: "(variant { Ok = null })" };
    }
    return {
      stdout: '(variant { Ok = record { info = record { token_id = "tok_missing" } } })'
    };
  }),
  /create_database_token did not return owner token/
);
assert.match(tokenFailureCreateDbCalls.at(-1).join(" "), /delete_database/);
assert.match(tokenFailureCreateDbCalls.at(-1).join(" "), /db_token_failure/);

const createDbSetupCalls = [];
const setupBatchCalls = [];
const createdDbWithSetup = await createIcpdbDatabase(
  parseCliArgs(["--base-url", "https://db.example", "--idempotency-key", "create_setup", "--statement", "CREATE TABLE notes(id INTEGER)", "create-db"], env),
  async (binary, args) => {
    createDbSetupCalls.push({ binary, args });
    if (args.includes("create_database")) {
      return { stdout: '(variant { Ok = "db_setup" })' };
    }
    return {
      stdout: '(variant { Ok = record { info = record { token_id = "tok_setup" }; token = "setup-secret" } })'
    };
  },
  async (url, init) => {
    setupBatchCalls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify([{ rows_affected: "0", columns: [], rows: [] }]), { status: 200 });
  }
);
assert.equal(createDbSetupCalls.length, 2);
assert.equal(createdDbWithSetup.database_id, "db_setup");
assert.equal(createdDbWithSetup.setup_statement_count, 1);
assert.equal(createdDbWithSetup.setup_batch_count, 1);
assert.equal(createdDbWithSetup.setup_rows_affected, "0");
assert.equal(setupBatchCalls[0].url, "https://db.example/v1/sql/batch");
assert.equal(setupBatchCalls[0].headers.authorization, "Bearer setup-secret");
assert.equal(setupBatchCalls[0].headers["idempotency-key"], "create_setup-setup-0");
assert.deepEqual(setupBatchCalls[0].body, {
  database_id: "db_setup",
  statements: [{ sql: "CREATE TABLE notes(id INTEGER)", params: [] }],
  max_rows: 100
});
const setupStatementsFileCalls = [];
const createdDbWithSetupStatementsFile = await createIcpdbDatabase(
  parseCliArgs(["--base-url", "https://db.example", "--statements-file", statementsFilePath, "create-db"], env),
  async (_binary, args) => {
    if (args.includes("create_database")) return { stdout: '(variant { Ok = "db_setup_file" })' };
    return {
      stdout: '(variant { Ok = record { info = record { token_id = "tok_setup_file" }; token = "setup-file-secret" } })'
    };
  },
  async (url, init) => {
    setupStatementsFileCalls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify([{ rows_affected: "0", columns: [], rows: [] }]), { status: 200 });
  }
);
assert.equal(createdDbWithSetupStatementsFile.setup_statement_count, 1);
assert.deepEqual(setupStatementsFileCalls[0].body.statements, [{ sql: "SELECT :body AS body", params: ["from-file"] }]);
const setupFailureCreateDbCalls = [];
await assert.rejects(
  () => createIcpdbDatabase(
    parseCliArgs(["--base-url", "https://db.example", "--statement", "CREATE TABLE notes(id INTEGER)", "create-db"], env),
    async (_binary, args) => {
      setupFailureCreateDbCalls.push(args);
      if (args.includes("create_database")) {
        return { stdout: '(variant { Ok = "db_setup_failure" })' };
      }
      if (args.includes("delete_database")) {
        return { stdout: "(variant { Ok = null })" };
      }
      return {
        stdout: '(variant { Ok = record { info = record { token_id = "tok_setup_failure" }; token = "setup-failure-secret" } })'
      };
    },
    async () => new Response(JSON.stringify({ error: "setup failed" }), { status: 500 })
  ),
  /setup failed/
);
assert.match(setupFailureCreateDbCalls.at(-1).join(" "), /delete_database/);
assert.match(setupFailureCreateDbCalls.at(-1).join(" "), /db_setup_failure/);

await assert.rejects(
  () => createIcpdbDatabase(
    parseCliArgs(["--statement", "CREATE TABLE notes(id INTEGER)", "create-db"], {
      ICPDB_CANISTER_ID: "ryjl3-tyaaa-aaaaa-aaaba-cai",
      ICPDB_NETWORK_URL: "http://localhost:8001",
      ICPDB_ROOT_KEY: "local-root-key"
    }),
    async (_binary, args) => {
      if (args.includes("create_database")) return { stdout: '(variant { Ok = "db_setup_missing_base" })' };
      return { stdout: '(variant { Ok = record { info = record { token_id = "tok_setup" }; token = "setup-secret" } })' };
    }
  ),
  /create-db setup requires --base-url or ICPDB_HTTP_BASE_URL/
);

const createDbSetupMigrationsPath = checkFile("create-setup-migrations.json");
await writeFile(createDbSetupMigrationsPath, JSON.stringify([{
  version: "create-setup-001",
  name: "create_setup_notes",
  sql: "CREATE TABLE setup_notes(id INTEGER PRIMARY KEY); INSERT INTO setup_notes(id) VALUES (1);"
}]));
const setupMigrationCalls = [];
const createdDbWithSetupMigrations = await createIcpdbDatabase(
  parseCliArgs(["--base-url", "https://db.example", "--idempotency-key", "create_migrate", "--setup-migrations-file", createDbSetupMigrationsPath, "create-db"], env),
  async (_binary, args) => {
    if (args.includes("create_database")) {
      return { stdout: '(variant { Ok = "db_setup_migrate" })' };
    }
    return {
      stdout: '(variant { Ok = record { info = record { token_id = "tok_setup_migrate" }; token = "setup-migrate-secret" } })'
    };
  },
  async (url, init) => {
    const body = JSON.parse(init.body);
    setupMigrationCalls.push({ url, body, headers: init.headers });
    if (url.endsWith("/v1/sql/query")) {
      return new Response(JSON.stringify({ columns: ["name"], rows: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(body.statements.map(() => ({ rows_affected: "1", columns: [], rows: [] }))), { status: 200 });
  }
);
assert.equal(createdDbWithSetupMigrations.database_id, "db_setup_migrate");
assert.equal(createdDbWithSetupMigrations.setup_migration_count, 1);
assert.deepEqual(createdDbWithSetupMigrations.setup_migration_applied, ["create-setup-001"]);
assert.deepEqual(createdDbWithSetupMigrations.setup_migration_skipped, []);
assert.equal(createdDbWithSetupMigrations.setup_statement_count, 2);
assert.equal(createdDbWithSetupMigrations.setup_batch_count, 2);
assert.equal(createdDbWithSetupMigrations.setup_rows_affected, "3");
assert.equal(setupMigrationCalls[1].headers["idempotency-key"], "create_migrate-setup-migrate-ensure");
assert.equal(setupMigrationCalls[3].headers["idempotency-key"], "create_migrate-setup-migrate-0");
assert.equal(setupMigrationCalls[3].body.database_id, "db_setup_migrate");
assert.equal(setupMigrationCalls[3].body.statements[0].sql, "CREATE TABLE setup_notes(id INTEGER PRIMARY KEY)");
assert.equal(setupMigrationCalls[3].body.statements[2].sql, "INSERT INTO icpdb_schema_migrations(version, name, applied_at_ms) VALUES (?1, ?2, ?3)");
await unlink(createDbSetupMigrationsPath);

await assert.rejects(
  () => createIcpdbDatabase(
    parseCliArgs(["--base-url", "https://db.example", "--statement", "CREATE TABLE notes(id INTEGER)", "--setup-migrations-file", createDbSetupMigrationsPath, "create-db"], env),
    async (_binary, args) => {
      if (args.includes("create_database")) return { stdout: '(variant { Ok = "db_setup_conflict" })' };
      return { stdout: '(variant { Ok = record { info = record { token_id = "tok_setup" }; token = "setup-secret" } })' };
    }
  ),
  /use only one of --statement, --statements-file, --setup-file, or --setup-migrations-file/
);

const databaseCalls = [];
const databases = await listDatabases(parseCliArgs(["databases"], env), async (binary, args) => {
  databaseCalls.push({ binary, args });
  return { stdout: '(variant { Ok = vec { record { database_id = "alpha"; role = variant { Owner } } } })' };
});
assert.deepEqual(databases, {
  candid: '(variant { Ok = vec { record { database_id = "alpha"; role = variant { Owner } } } })'
});
assert.equal(databaseCalls[0].binary, "icp");
assert.match(databaseCalls[0].args.join(" "), /list_databases/);

const placementCalls = [];
const placements = await listDatabasePlacements(parseCliArgs(["placements"], env), async (binary, args) => {
  placementCalls.push({ binary, args });
  return { stdout: '(variant { Ok = vec { record { database_id = "alpha"; shard_id = "local" } } })' };
});
assert.deepEqual(placements, {
  candid: '(variant { Ok = vec { record { database_id = "alpha"; shard_id = "local" } } })'
});
assert.equal(placementCalls[0].binary, "icp");
assert.match(placementCalls[0].args.join(" "), /list_all_database_placements/);

const shardCalls = [];
const shards = await listDatabaseShards(parseCliArgs(["shards"], env), async (binary, args) => {
  shardCalls.push({ binary, args });
  return { stdout: '(variant { Ok = vec { record { shard_id = "database:aaaaa-aa"; canister_id = "aaaaa-aa" } } })' };
});
assert.deepEqual(shards, {
  candid: '(variant { Ok = vec { record { shard_id = "database:aaaaa-aa"; canister_id = "aaaaa-aa" } } })'
});
assert.equal(shardCalls[0].binary, "icp");
assert.match(shardCalls[0].args.join(" "), /list_database_shards/);

const shardStatusCalls = [];
const shardStatus = await getDatabaseShardStatus(parseCliArgs(["shard-status", "aaaaa-aa"], env), async (binary, args) => {
  shardStatusCalls.push({ binary, args });
  return { stdout: '(variant { Ok = record { canister_status = "running"; cycles_balance = 1000000 } })' };
});
assert.deepEqual(shardStatus, {
  candid: '(variant { Ok = record { canister_status = "running"; cycles_balance = 1000000 } })'
});
assert.equal(shardStatusCalls[0].binary, "icp");
assert.match(shardStatusCalls[0].args.join(" "), /get_database_shard_status/);
assert.match(shardStatusCalls[0].args.join(" "), /database_canister_id = "aaaaa-aa"/);

const shardTopUpCalls = [];
const shardTopUp = await topUpDatabaseShard(parseCliArgs(["shard-top-up", "aaaaa-aa", "1000000"], env), async (binary, args) => {
  shardTopUpCalls.push({ binary, args });
  return { stdout: '(variant { Ok = record { canister_id = "aaaaa-aa"; assigned_databases = 0 } })' };
});
assert.deepEqual(shardTopUp, {
  candid: '(variant { Ok = record { canister_id = "aaaaa-aa"; assigned_databases = 0 } })'
});
assert.equal(shardTopUpCalls[0].binary, "icp");
assert.match(shardTopUpCalls[0].args.join(" "), /top_up_database_shard/);
assert.match(shardTopUpCalls[0].args.join(" "), /cycles = 1000000 : nat/);

const shardMaintainCalls = [];
const shardMaintain = await maintainDatabaseShards(parseCliArgs(["shard-maintain", "1", "2", "3", "4", "5", "6"], env), async (binary, args) => {
  shardMaintainCalls.push({ binary, args });
  return { stdout: '(variant { Ok = record { available_slots = 1 : nat64; actions = vec {} } })' };
});
assert.deepEqual(shardMaintain, {
  candid: '(variant { Ok = record { available_slots = 1 : nat64; actions = vec {} } })'
});
assert.equal(shardMaintainCalls[0].binary, "icp");
assert.match(shardMaintainCalls[0].args.join(" "), /maintain_database_shards/);
assert.match(shardMaintainCalls[0].args.join(" "), /min_available_slots = 1 : nat64/);
assert.match(shardMaintainCalls[0].args.join(" "), /new_shard_initial_cycles = 6 : nat/);

const shardMigrateCalls = [];
const shardMigrate = await migrateDatabaseToShard(parseCliArgs(["shard-migrate", "alpha", "aaaaa-aa"], env), async (binary, args) => {
  shardMigrateCalls.push({ binary, args });
  return { stdout: '(variant { Ok = record { database_id = "alpha"; shard_id = "database:aaaaa-aa" } })' };
});
assert.deepEqual(shardMigrate, {
  candid: '(variant { Ok = record { database_id = "alpha"; shard_id = "database:aaaaa-aa" } })'
});
assert.equal(shardMigrateCalls[0].binary, "icp");
assert.match(shardMigrateCalls[0].args.join(" "), /migrate_database_to_shard/);
assert.match(shardMigrateCalls[0].args.join(" "), /database_id = "alpha"/);
assert.match(shardMigrateCalls[0].args.join(" "), /database_canister_id = "aaaaa-aa"/);

const shardOpsCalls = [];
const shardOps = await listShardOperations(parseCliArgs(["shard-ops"], env), async (binary, args) => {
  shardOpsCalls.push({ binary, args });
  return { stdout: '(variant { Ok = vec { record { operation_id = "op_1"; status = variant { Unknown } } } })' };
});
assert.deepEqual(shardOps, {
  candid: '(variant { Ok = vec { record { operation_id = "op_1"; status = variant { Unknown } } } })'
});
assert.equal(shardOpsCalls[0].binary, "icp");
assert.match(shardOpsCalls[0].args.join(" "), /list_shard_operations/);

const reconcileCalls = [];
const reconciled = await reconcileShardOperation(
  parseCliArgs(["shard-reconcile", "failed", "op_1", "operator", "verified"], env),
  async (binary, args) => {
    reconcileCalls.push({ binary, args });
    return { stdout: '(variant { Ok = record { operation_id = "op_1"; status = variant { Failed } } })' };
  }
);
assert.deepEqual(reconciled, {
  candid: '(variant { Ok = record { operation_id = "op_1"; status = variant { Failed } } })'
});
assert.equal(reconcileCalls[0].binary, "icp");
assert.match(reconcileCalls[0].args.join(" "), /reconcile_shard_operation/);
assert.match(reconcileCalls[0].args.join(" "), /operation_id = "op_1"/);
assert.match(reconcileCalls[0].args.join(" "), /status = variant \{ Failed \}/);
assert.match(reconcileCalls[0].args.join(" "), /error = opt "operator verified"/);

const routedReconcileCalls = [];
const reconciledRouted = await reconcileRoutedOperation(
  parseCliArgs(["operation-reconcile", "alpha", "op_remote_1"], env),
  async (binary, args) => {
    routedReconcileCalls.push({ binary, args });
    return { stdout: '(variant { Ok = record { operation_id = "op_remote_1"; status = variant { Applied } } })' };
  }
);
assert.deepEqual(reconciledRouted, {
  candid: '(variant { Ok = record { operation_id = "op_remote_1"; status = variant { Applied } } })'
});
assert.equal(routedReconcileCalls[0].binary, "icp");
assert.match(routedReconcileCalls[0].args.join(" "), /reconcile_routed_operation/);
assert.match(routedReconcileCalls[0].args.join(" "), /database_id = "alpha"/);
assert.match(routedReconcileCalls[0].args.join(" "), /operation_id = "op_remote_1"/);

const inspectCalls = [];
const tableInspect = await inspectIcpdb(
  parseCliArgs(["inspect", "alpha", "notes"], env),
  async (url, request) => {
    inspectCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(JSON.stringify({
        table_name: "notes",
        object_type: "table",
        columns: [{ name: "body" }],
        indexes: [{ name: "notes_body_idx" }],
        triggers: [{ name: "notes_guard" }],
        foreign_keys: [{ from_column: "parent_id" }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ columns: ["body"], rows: [[{ Text: "hello" }]], total_count: 1 }), { status: 200 });
  }
);
assert.deepEqual(tableInspect.table.table_name, "notes");
assert.deepEqual(tableInspect.preview.columns, ["body"]);
assert.deepEqual(inspectCalls.map((call) => call.url), [
  "https://db.example/v1/tables/describe",
  "https://db.example/v1/tables/preview"
]);

const databaseInspectCalls = [];
const databaseInspect = await inspectIcpdb(
  parseCliArgs(["inspect", "alpha", "--access"], env),
  async (url, request) => {
    databaseInspectCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/session")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          token_id: "tok_owner",
          scope: "owner",
          role: "owner"
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/usage")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          status: "hot",
          logical_size_bytes: 4096,
          max_logical_size_bytes: 67108864,
          usage_event_count: 3
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/placements/get")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          shard_id: "local",
          canister_id: null,
          mount_id: 11,
          status: "hot",
          schema_version: "sqlite:raw",
          created_at_ms: 1,
          updated_at_ms: 2
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/billing")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          status: "active",
          balance_units: 95,
          spent_units: 5,
          usage_event_count: 3
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/usage/events")) {
      return new Response(
        JSON.stringify([
          {
            method: "sql_execute",
            operation: "INSERT",
            success: true,
            event_count: 2,
            total_cycles_delta: 30,
            total_rows_returned: 4,
            total_rows_affected: 3,
            last_created_at_ms: 1234
          }
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/tables/list")) {
      return new Response(JSON.stringify([{ name: "notes" }]), { status: 200 });
    }
    if (url.endsWith("/v1/tokens/list")) {
      return new Response(
        JSON.stringify([
          { token_id: "tok_owner", name: "owner", scope: "owner", created_at_ms: 1000, last_used_at_ms: 1200, revoked_at_ms: null }
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/members/list")) {
      return new Response(
        JSON.stringify([
          { principal: "aaaaa-aa", role: "owner", granted_at_ms: 1000 }
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/payments/list")) {
      return new Response(
        JSON.stringify([
          {
            payment_id: "pay_1",
            database_id: "alpha",
            payer_principal: "aaaaa-aa",
            amount_e8s: 1000000,
            credited_units: 1000,
            block_index: 99,
            created_at_ms: 1100
          }
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(JSON.stringify({
        table_name: "notes",
        columns: [{ name: "body" }],
        indexes: [{ name: "notes_body_idx" }],
        triggers: [{ name: "notes_guard" }],
        foreign_keys: [{ from_column: "parent_id" }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ table_name: "notes", columns: ["body"], rows: [[{ Text: "hello" }]], total_count: 7 }), {
      status: 200
    });
  }
);
assert.deepEqual(databaseInspect.placement.shard_id, "local");
assert.deepEqual(databaseInspect.usage.logical_size_bytes, 4096);
assert.deepEqual(databaseInspect.billing.balance_units, 95);
assert.deepEqual(databaseInspect.usage_events[0].method, "sql_execute");
assert.deepEqual(databaseInspect.access.tokens[0].token_id, "tok_owner");
assert.deepEqual(databaseInspect.access.members[0].principal, "aaaaa-aa");
assert.deepEqual(databaseInspect.access.payments[0].block_index, 99);
assert.deepEqual(databaseInspect.table_summaries, [{
  table_name: "notes",
  object_type: "table",
  row_count: 7,
  column_count: 1,
  columns: ["body"],
  index_count: 1,
  trigger_count: 1,
  foreign_key_count: 1
}]);
assert.deepEqual(databaseInspect.tables[0].table_name, "notes");
assert.deepEqual(databaseInspectCalls.map((call) => call.url), [
  "https://db.example/v1/session",
  "https://db.example/v1/placements/get",
  "https://db.example/v1/usage",
  "https://db.example/v1/billing",
  "https://db.example/v1/usage/events",
  "https://db.example/v1/tables/list",
  "https://db.example/v1/tokens/list",
  "https://db.example/v1/members/list",
  "https://db.example/v1/payments/list",
  "https://db.example/v1/tables/describe",
  "https://db.example/v1/tables/preview"
]);
assert.deepEqual(databaseInspectCalls[10].body, { database_id: "alpha", table_name: "notes", limit: 1, offset: 0 });

const readDatabaseInspectCalls = [];
const readDatabaseInspect = await inspectIcpdb(
  parseCliArgs(["inspect", "alpha"], env),
  async (url, request) => {
    readDatabaseInspectCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/billing")) {
      throw new Error("read-token inspect must not call /v1/billing");
    }
    if (url.endsWith("/v1/session")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          token_id: "tok_read",
          scope: "read",
          role: "reader"
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/usage")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          status: "hot",
          logical_size_bytes: 2048,
          max_logical_size_bytes: 67108864,
          usage_event_count: 1
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/placements/get")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          shard_id: "local",
          canister_id: null,
          mount_id: 11,
          status: "hot",
          schema_version: "sqlite:raw",
          created_at_ms: 1,
          updated_at_ms: 2
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/v1/usage/events")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/v1/tables/list")) {
      return new Response(JSON.stringify([{ name: "notes" }]), { status: 200 });
    }
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(JSON.stringify({
        table_name: "notes",
        columns: [{ name: "body" }],
        indexes: [],
        triggers: [],
        foreign_keys: []
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ table_name: "notes", columns: ["body"], rows: [], total_count: 0 }), { status: 200 });
  }
);
assert.equal(readDatabaseInspect.billing, null);
assert.equal(readDatabaseInspect.access, null);
assert.deepEqual(readDatabaseInspectCalls.map((call) => call.url), [
  "https://db.example/v1/session",
  "https://db.example/v1/placements/get",
  "https://db.example/v1/usage",
  "https://db.example/v1/usage/events",
  "https://db.example/v1/tables/list",
  "https://db.example/v1/tables/describe",
  "https://db.example/v1/tables/preview"
]);

await assert.rejects(
  inspectIcpdb(
    parseCliArgs(["inspect", "alpha", "--access"], env),
    async (url, request) => {
      readDatabaseInspectCalls.push({ url, body: JSON.parse(request.body) });
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          token_id: "tok_read",
          scope: "read",
          role: "reader"
        }),
        { status: 200 }
      );
    }
  ),
  /inspect --access requires an owner token/
);

const viewListCalls = [];
const databaseViews = await databaseViewsIcpdb(
  parseCliArgs(["views", "alpha"], env),
  async (url, request) => {
    viewListCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify([
      { name: "notes", object_type: "table" },
      { name: "notes_view", object_type: "view" }
    ]), { status: 200 });
  }
);
assert.deepEqual(databaseViews, [{ name: "notes_view", object_type: "view" }]);
assert.deepEqual(viewListCalls, [{
  url: "https://db.example/v1/tables/list",
  body: { database_id: "alpha" }
}]);

const statsCalls = [];
const databaseStats = await statsIcpdb(
  parseCliArgs(["stats", "alpha"], env),
  async (url, request) => {
    statsCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/tables/list")) {
      return new Response(JSON.stringify([
        { name: "notes", object_type: "table" },
        { name: "note_bodies", object_type: "view" }
      ]), { status: 200 });
    }
    if (url.endsWith("/v1/tables/describe")) {
      const { table_name: tableName } = JSON.parse(request.body);
      return new Response(JSON.stringify({
        table_name: tableName,
        object_type: tableName === "note_bodies" ? "view" : "table",
        columns: [{ name: "body" }],
        indexes: tableName === "notes" ? [{ name: "notes_body_idx" }] : [],
        triggers: [],
        foreign_keys: []
      }), { status: 200 });
    }
    const { table_name: tableName } = JSON.parse(request.body);
    return new Response(JSON.stringify({
      table_name: tableName,
      columns: ["body"],
      rows: [],
      total_count: tableName === "notes" ? 7 : 3
    }), { status: 200 });
  }
);
assert.deepEqual(databaseStats.stats, {
  table_count: 1,
  view_count: 1,
  row_count: "10",
  column_count: 2,
  index_count: 1,
  trigger_count: 0,
  foreign_key_count: 0
});
assert.equal(statsCalls.length, 5);
const formattedStats = formatCliOutput(databaseStats, { stats: true, outputFormat: "table" });
assert.match(formattedStats, /database alpha/);
assert.match(formattedStats, /table_count/);
assert.match(formattedStats, /note_bodies/);
const formattedStatsCsv = formatCliOutput(databaseStats, { stats: true, outputFormat: "csv" });
assert.match(formattedStatsCsv, /section,name,type,rows,tables,views,columns,indexes,triggers,foreign_keys,column_names/);
assert.match(formattedStatsCsv, /database,alpha,,10,1,1,2,1,0,0,/);
assert.match(formattedStatsCsv, /table,note_bodies,view,3,,,1,0,0,0,body/);

const tableColumnCalls = [];
const tableColumns = await tableColumnsIcpdb(
  parseCliArgs(["columns", "alpha", "notes"], env),
  async (url, request) => {
    tableColumnCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      table_name: "notes",
      columns: [
        { cid: 0, name: "id", declared_type: "INTEGER", not_null: false, default_value: null, primary_key_position: 1, hidden: 0 },
        { cid: 1, name: "body", declared_type: "TEXT", not_null: true, default_value: null, primary_key_position: 0, hidden: 0 }
      ]
    }), { status: 200 });
  }
);
assert.equal(tableColumns.column_count, 2);
assert.deepEqual(tableColumns.columns[1].name, "body");
assert.deepEqual(tableColumnCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);

const tableIndexCalls = [];
const tableIndexes = await tableIndexesIcpdb(
  parseCliArgs(["indexes", "alpha", "notes"], env),
  async (url, request) => {
    tableIndexCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      table_name: "notes",
      columns: [],
      indexes: [{ name: "notes_body_idx", unique: true, origin: "c", partial: false, columns: [{ seqno: 0, cid: 1, name: "body", descending: false, collation: "BINARY", key: true }], schema_sql: "CREATE UNIQUE INDEX notes_body_idx ON notes(body)" }]
    }), { status: 200 });
  }
);
assert.deepEqual(tableIndexes.indexes[0].name, "notes_body_idx");
assert.deepEqual(tableIndexes.indexes[0].columns[0].name, "body");
assert.deepEqual(tableIndexCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);

const tableTriggerCalls = [];
const tableTriggers = await tableTriggersIcpdb(
  parseCliArgs(["triggers", "alpha", "notes"], env),
  async (url, request) => {
    tableTriggerCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      table_name: "notes",
      columns: [],
      triggers: [{ name: "notes_guard", table_name: "notes", schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END" }]
    }), { status: 200 });
  }
);
assert.deepEqual(tableTriggers.triggers[0].name, "notes_guard");
assert.deepEqual(tableTriggerCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);

const tableForeignKeyCalls = [];
const tableForeignKeys = await tableForeignKeysIcpdb(
  parseCliArgs(["foreign-keys", "alpha", "notes"], env),
  async (url, request) => {
    tableForeignKeyCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      table_name: "notes",
      columns: [],
      foreign_keys: [{ id: 0, seq: 0, from_column: "parent_id", table_name: "parents", to_column: "id", on_update: "CASCADE", on_delete: "RESTRICT", match_clause: "NONE" }]
    }), { status: 200 });
  }
);
assert.deepEqual(tableForeignKeys.foreign_keys[0].from_column, "parent_id");
assert.deepEqual(tableForeignKeyCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);

const schemaCalls = [];
const schemaResult = await schemaIcpdb(
  parseCliArgs(["schema", "alpha", "notes"], env),
  async (url, request) => {
    schemaCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(
      JSON.stringify({
        table_name: "notes",
        object_type: "table",
        schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
        columns: [],
        indexes: [
          {
            name: "notes_body_idx",
            unique: true,
            origin: "c",
            partial: false,
            columns: [{ seqno: 0, cid: 1, name: "body", descending: false, collation: "BINARY", key: true }],
            schema_sql: "CREATE UNIQUE INDEX notes_body_idx ON notes(body)"
          }
        ],
        triggers: [
          {
            name: "notes_guard",
            table_name: "notes",
            schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
          }
        ],
        foreign_keys: []
      }),
      { status: 200 }
    );
  }
);
assert.deepEqual(schemaCalls.map((call) => call.url), ["https://db.example/v1/tables/describe"]);
assert.deepEqual(schemaResult.schemas, [
  {
    table_name: "notes",
    object_type: "table",
    schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
    index_schemas: ["CREATE UNIQUE INDEX notes_body_idx ON notes(body)"],
    trigger_schemas: ["CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"]
  }
]);
const formattedSchema = formatCliOutput(schemaResult, { outputFormat: "table" });
assert.match(formattedSchema, /database alpha/);
assert.match(formattedSchema, /table notes/);
assert.match(formattedSchema, /CREATE TABLE notes/);
assert.match(formattedSchema, /CREATE UNIQUE INDEX notes_body_idx ON notes\(body\)/);
assert.match(formattedSchema, /CREATE TRIGGER notes_guard BEFORE INSERT ON notes/);
const formattedSchemaCsv = formatCliOutput(schemaResult, { outputFormat: "csv" });
assert.match(formattedSchemaCsv, /table_name,object_type,schema_sql_kind,schema_sql/);
assert.match(formattedSchemaCsv, /notes,table,table,"CREATE TABLE notes/);
assert.match(formattedSchemaCsv, /notes,table,index,CREATE UNIQUE INDEX notes_body_idx/);
assert.match(formattedSchemaCsv, /notes,table,trigger,CREATE TRIGGER notes_guard/);

const formattedViewSchema = formatCliOutput(
  {
    database_id: "alpha",
    schemas: [
      {
        table_name: "note_bodies",
        object_type: "view",
        schema_sql: "CREATE VIEW note_bodies AS SELECT body FROM notes",
        index_schemas: [],
        trigger_schemas: []
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedViewSchema, /view note_bodies/);
assert.doesNotMatch(formattedViewSchema, /table note_bodies/);
assert.match(formattedViewSchema, /CREATE VIEW note_bodies/);

const dumpCalls = [];
const dumpResult = await dumpIcpdb(
  parseCliArgs(["dump", "alpha", "notes", "--limit", "1"], env),
  async (url, request) => {
    const body = JSON.parse(request.body);
    dumpCalls.push({ url, body });
    if (url.endsWith("/v1/sql/query") && body.sql.includes("sqlite_master")) {
      return new Response(JSON.stringify({ columns: ["name"], rows: [[{ Text: "sqlite_sequence" }]] }), { status: 200 });
    }
    if (url.endsWith("/v1/sql/query") && body.sql.includes("FROM sqlite_sequence")) {
      return new Response(JSON.stringify({ columns: ["name", "seq"], rows: [[{ Text: "notes" }, { Integer: "44" }]] }), { status: 200 });
    }
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          table_name: "notes",
          object_type: "table",
          schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL)",
          columns: [
            { name: "id", hidden: 0 },
            { name: "body", hidden: 0 },
            { name: "body_len", hidden: 2 }
          ]
        }),
        { status: 200 }
      );
    }
    if (body.offset === 0) {
      return new Response(
        JSON.stringify({
          database_id: "alpha",
          table_name: "notes",
          columns: ["id", "body", "body_len"],
          rows: [[{ Integer: "1" }, { Text: "hello 'sql'" }, { Integer: "11" }]],
          total_count: 2
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        database_id: "alpha",
        table_name: "notes",
        columns: ["id", "body", "body_len"],
        rows: [[{ Integer: "2" }, { Text: "bye" }, { Integer: "3" }]],
        total_count: 2
      }),
      { status: 200 }
    );
  }
);
assert.match(dumpResult, /BEGIN TRANSACTION/);
assert.match(dumpResult, /CREATE TABLE notes\(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS \(length\(body\)\) VIRTUAL\);/);
assert.match(dumpResult, /INSERT INTO "notes" \("id", "body"\) VALUES \(1, 'hello ''sql'''\);/);
assert.match(dumpResult, /INSERT INTO "notes" \("id", "body"\) VALUES \(2, 'bye'\);/);
assert.doesNotMatch(dumpResult, /"body_len"/);
assert.match(dumpResult, /DELETE FROM sqlite_sequence WHERE name = 'notes';/);
assert.match(dumpResult, /INSERT INTO sqlite_sequence\(name, seq\) VALUES \('notes', 44\);/);
assert.match(dumpResult, /COMMIT/);
assert.deepEqual(dumpCalls.map((call) => call.url), [
  "https://db.example/v1/tables/describe",
  "https://db.example/v1/tables/preview",
  "https://db.example/v1/tables/preview",
  "https://db.example/v1/sql/query",
  "https://db.example/v1/sql/query"
]);

const sequenceNames = Array.from({ length: 120 }, (_, index) => `seq_${String(index).padStart(3, "0")}`);
const pagedSequenceDump = await dumpIcpdb(
  parseCliArgs(["dump", "alpha", "seq_119", "--max-rows", "50"], env),
  async (url, request) => {
    const body = JSON.parse(request.body);
    if (url.endsWith("/v1/sql/query") && body.sql.includes("sqlite_master")) {
      return new Response(JSON.stringify({ columns: ["name"], rows: [[{ Text: "sqlite_sequence" }]] }), { status: 200 });
    }
    if (url.endsWith("/v1/sql/query") && body.sql.includes("FROM sqlite_sequence")) {
      const lastName = body.params[0]?.text ?? "";
      const rows = sequenceNames
        .filter((name) => name > lastName)
        .slice(0, 50)
        .map((name, index) => [{ Text: name }, { Integer: String(index + 1) }]);
      return new Response(JSON.stringify({ columns: ["name", "seq"], rows, truncated: rows.length === 50 }), { status: 200 });
    }
    if (url.endsWith("/v1/tables/describe")) {
      return new Response(JSON.stringify({
        database_id: "alpha",
        table_name: "seq_119",
        object_type: "table",
        schema_sql: "CREATE TABLE seq_119(id INTEGER PRIMARY KEY AUTOINCREMENT)",
        columns: [{ name: "id", hidden: 0 }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      database_id: "alpha",
      table_name: "seq_119",
      columns: ["id"],
      rows: [],
      total_count: 0
    }), { status: 200 });
  }
);
assert.match(pagedSequenceDump, /INSERT INTO sqlite_sequence\(name, seq\) VALUES \('seq_119'/);

const loadPath = checkFile("load-check.sql");
await writeFile(
  loadPath,
  [
    "-- dump pragma",
    "PRAGMA foreign_keys=OFF;",
    "/* dump begin */",
    "BEGIN TRANSACTION;",
    "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);",
    "INSERT INTO notes(body) VALUES ('hello; sql');",
    "CREATE TABLE [loaded;bracketed](id INTEGER);",
    "INSERT INTO [loaded;bracketed](id) VALUES (1);",
    "-- trigger load",
    "CREATE TRIGGER notes_guard AFTER INSERT ON notes BEGIN UPDATE notes SET body = CASE WHEN NEW.body IS NULL THEN 'empty' ELSE NEW.body END; END;",
    "-- dump commit",
    "COMMIT;"
  ].join("\n")
);
const loadCalls = [];
const loadResult = await loadIcpdb(
  parseCliArgs(["load", "alpha", loadPath, "--idempotency-key", "load_1", "--wait"], env),
  async (url, request) => {
    loadCalls.push({ url, body: JSON.parse(request.body), idempotencyKey: request.headers["idempotency-key"] });
    if (url.endsWith("/v1/operations/get")) {
      return new Response(JSON.stringify({
        operation_id: "load_1-0",
        database_id: "alpha",
        database_canister_id: "db-canister",
        method: "sql_batch",
        request_hash: [],
        status: "applied",
        error: "",
        created_at_ms: "1",
        updated_at_ms: "2"
      }), { status: 200 });
    }
    return new Response(JSON.stringify(JSON.parse(request.body).statements.map(() => ({
      rows_affected: 1,
      routed_operation_id: request.headers["idempotency-key"]
    }))), { status: 200 });
  }
);
await unlink(loadPath);
assert.deepEqual(loadCalls.map((call) => call.url), ["https://db.example/v1/sql/batch", "https://db.example/v1/operations/get"]);
assert.deepEqual(loadCalls.map((call) => call.idempotencyKey), ["load_1-0", undefined]);
assert.deepEqual(loadCalls[0].body.statements.map((statement) => statement.sql), [
  "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
  "INSERT INTO notes(body) VALUES ('hello; sql')",
  "CREATE TABLE [loaded;bracketed](id INTEGER)",
  "INSERT INTO [loaded;bracketed](id) VALUES (1)",
  "-- trigger load\nCREATE TRIGGER notes_guard AFTER INSERT ON notes BEGIN UPDATE notes SET body = CASE WHEN NEW.body IS NULL THEN 'empty' ELSE NEW.body END; END"
]);
assert.equal(loadResult.statement_count, 5);
assert.equal(loadResult.rows_affected, 5);
assert.equal(loadResult.routed_operations[0].status, "applied");

const stdinLoadCalls = [];
const stdinLoadResult = await loadIcpdb(
  parseCliArgs(["load", "alpha", "-"], env),
  async (url, request) => {
    stdinLoadCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify(JSON.parse(request.body).statements.map(() => ({ rows_affected: 1 }))), { status: 200 });
  },
  Readable.from(["CREATE TABLE stdin_notes(id INTEGER);\n", "INSERT INTO stdin_notes(id) VALUES (1);\n"])
);
assert.deepEqual(stdinLoadCalls.map((call) => call.url), ["https://db.example/v1/sql/batch"]);
assert.deepEqual(stdinLoadCalls[0].body.statements.map((statement) => statement.sql), [
  "CREATE TABLE stdin_notes(id INTEGER)",
  "INSERT INTO stdin_notes(id) VALUES (1)"
]);
assert.equal(stdinLoadResult.file, "-");
assert.equal(stdinLoadResult.statement_count, 2);

const readLoadPath = checkFile("read-load-check.sql");
await writeFile(readLoadPath, "BEGIN TRANSACTION;\nSELECT body FROM notes;\nPRAGMA table_info(notes);\nCOMMIT;\n");
const readLoadCalls = [];
const readLoadResult = await loadIcpdb(
  parseCliArgs(["load", "alpha", readLoadPath, "--mode", "read", "--max-rows", "2"], env),
  async (url, request) => {
    readLoadCalls.push({ url, body: JSON.parse(request.body), idempotencyKey: request.headers["idempotency-key"] });
    return new Response(JSON.stringify({ columns: ["body"], rows: [[{ text: "hello" }]], rows_affected: 0 }), { status: 200 });
  }
);
await unlink(readLoadPath);
assert.deepEqual(readLoadCalls.map((call) => call.url), ["https://db.example/v1/sql/query"]);
assert.deepEqual(readLoadCalls.map((call) => call.body.sql), ["SELECT body FROM notes"]);
assert.equal(readLoadCalls[0].body.max_rows, 2);
assert.equal(readLoadCalls[0].idempotencyKey, undefined);
assert.equal(readLoadResult.query_count, 1);
assert.equal(readLoadResult.batch_count, 0);
assert.equal(readLoadResult.results[0].rows[0][0].text, "hello");
await assert.rejects(
  () => loadIcpdb(parseCliArgs(["load", "alpha", "-", "--mode", "read"], env), async () => new Response("{}", { status: 200 }), Readable.from(["INSERT INTO notes(body) VALUES ('x');"])),
  /read load statement 1 is not read-only/
);

const scriptPath = checkFile("script-check.sql");
await writeFile(
  scriptPath,
  [
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE scripted_notes(id INTEGER PRIMARY KEY, body TEXT);",
    "INSERT INTO scripted_notes(body) VALUES ('from-script');",
    "CREATE TABLE [scripted;bracketed](id INTEGER);",
    "INSERT INTO [scripted;bracketed](id) VALUES (1);",
    "/* trigger script */",
    "CREATE TRIGGER scripted_guard AFTER INSERT ON scripted_notes BEGIN UPDATE scripted_notes SET body = CASE WHEN NEW.body IS NULL THEN 'empty' ELSE NEW.body END; END;",
    "CREATE TEMP TRIGGER temp_scripted_guard BEFORE INSERT ON scripted_notes BEGIN SELECT 1; END;"
  ].join("\n")
);
const scriptCalls = [];
const scriptResult = await scriptIcpdb(
  parseCliArgs(["script", "alpha", scriptPath, "--idempotency-key", "script_1", "--wait"], env),
  async (url, request) => {
    scriptCalls.push({ url, body: JSON.parse(request.body), idempotencyKey: request.headers["idempotency-key"] });
    if (url.endsWith("/v1/operations/get")) {
      return new Response(JSON.stringify({
        operation_id: "script_1-0",
        database_id: "alpha",
        database_canister_id: "db-canister",
        method: "sql_batch",
        request_hash: [],
        status: "applied",
        error: "",
        created_at_ms: "1",
        updated_at_ms: "2"
      }), { status: 200 });
    }
    return new Response(JSON.stringify(JSON.parse(request.body).statements.map(() => ({
      rows_affected: 1,
      routed_operation_id: request.headers["idempotency-key"]
    }))), { status: 200 });
  }
);
await unlink(scriptPath);
assert.deepEqual(scriptCalls.map((call) => call.url), ["https://db.example/v1/sql/batch", "https://db.example/v1/operations/get"]);
assert.deepEqual(scriptCalls[0].body.statements.map((statement) => statement.sql), [
  "PRAGMA foreign_keys=ON",
  "CREATE TABLE scripted_notes(id INTEGER PRIMARY KEY, body TEXT)",
  "INSERT INTO scripted_notes(body) VALUES ('from-script')",
  "CREATE TABLE [scripted;bracketed](id INTEGER)",
  "INSERT INTO [scripted;bracketed](id) VALUES (1)",
  "/* trigger script */\nCREATE TRIGGER scripted_guard AFTER INSERT ON scripted_notes BEGIN UPDATE scripted_notes SET body = CASE WHEN NEW.body IS NULL THEN 'empty' ELSE NEW.body END; END",
  "CREATE TEMP TRIGGER temp_scripted_guard BEFORE INSERT ON scripted_notes BEGIN SELECT 1; END"
]);
assert.equal(scriptResult.statement_count, 7);
assert.equal(scriptResult.routed_operations[0].status, "applied");

const stdinScriptCalls = [];
const stdinScriptResult = await scriptIcpdb(
  parseCliArgs(["script", "alpha", "-"], env),
  async (url, request) => {
    stdinScriptCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify(JSON.parse(request.body).statements.map(() => ({ rows_affected: 1 }))), { status: 200 });
  },
  Readable.from(["CREATE TABLE stdin_scripted(id INTEGER);\n", "INSERT INTO stdin_scripted(id) VALUES (1);\n"])
);
assert.deepEqual(stdinScriptCalls[0].body.statements.map((statement) => statement.sql), [
  "CREATE TABLE stdin_scripted(id INTEGER)",
  "INSERT INTO stdin_scripted(id) VALUES (1)"
]);
assert.equal(stdinScriptResult.file, "-");
assert.equal(stdinScriptResult.statement_count, 2);

const readScriptPath = checkFile("read-script-check.sql");
await writeFile(readScriptPath, [
  "SELECT body FROM notes;",
  "WITH payload(value) AS MATERIALIZED (SELECT 1) SELECT value FROM payload;",
  "WITH payload(value) AS NOT MATERIALIZED (SELECT 2) SELECT value FROM payload;"
].join("\n"));
const readScriptCalls = [];
const readScriptResult = await scriptIcpdb(
  parseCliArgs(["script", "alpha", readScriptPath, "--mode", "read"], env),
  async (url, request) => {
    readScriptCalls.push({ url, body: JSON.parse(request.body), idempotencyKey: request.headers["idempotency-key"] });
    return new Response(JSON.stringify({ columns: ["body"], rows: [[{ text: "hello" }]], rows_affected: 0 }), { status: 200 });
  }
);
await unlink(readScriptPath);
assert.deepEqual(readScriptCalls.map((call) => call.url), ["https://db.example/v1/sql/query", "https://db.example/v1/sql/query", "https://db.example/v1/sql/query"]);
assert.deepEqual(readScriptCalls.map((call) => call.body.sql), [
  "SELECT body FROM notes",
  "WITH payload(value) AS MATERIALIZED (SELECT 1) SELECT value FROM payload",
  "WITH payload(value) AS NOT MATERIALIZED (SELECT 2) SELECT value FROM payload"
]);
assert.equal(readScriptCalls[0].idempotencyKey, undefined);
assert.equal(readScriptResult.results[0].rows[0][0].text, "hello");
await assert.rejects(
  () => scriptIcpdb(parseCliArgs(["script", "alpha", "-", "--mode", "read"], env), async () => new Response("{}", { status: 200 }), Readable.from(["INSERT INTO notes(body) VALUES ('x');"])),
  /read script statement 1 is not read-only/
);

const migrationsPath = checkFile("migrations-check.json");
await writeFile(migrationsPath, JSON.stringify([
  { version: "existing-001", sql: "CREATE TABLE skipped_migration(id INTEGER);" },
  {
    version: "http-001",
    name: "create_http_migrated",
    sql: "CREATE TABLE http_migrated(id INTEGER); INSERT INTO http_migrated(id) VALUES (1);"
  }
]));
const migrateCalls = [];
const migrateResult = await migrateIcpdb(
  parseCliArgs(["migrate", "alpha", migrationsPath, "--idempotency-key", "migrate_1", "--wait"], env),
  async (url, request) => {
    const body = JSON.parse(request.body);
    migrateCalls.push({ url, body, idempotencyKey: request.headers["idempotency-key"] });
    if (url.endsWith("/v1/operations/get")) {
      return new Response(JSON.stringify({
        operation_id: body.operation_id,
        database_id: "alpha",
        database_canister_id: "db-canister",
        method: "sql_batch",
        request_hash: [],
        status: "applied",
        error: "",
        created_at_ms: "1",
        updated_at_ms: "2"
      }), { status: 200 });
    }
    if (url.endsWith("/v1/sql/query") && body.sql.includes("sqlite_master")) {
      assert.deepEqual(body.params, [{ text: "table" }, { text: "icpdb_schema_migrations" }]);
      return new Response(JSON.stringify({ columns: ["name"], rows: [], rows_affected: 0, last_insert_rowid: 0, truncated: false }), { status: 200 });
    }
    if (url.endsWith("/v1/sql/query") && body.sql.includes("SELECT version FROM icpdb_schema_migrations")) {
      return new Response(JSON.stringify({ columns: ["version"], rows: [[{ Text: "existing-001" }]], rows_affected: 0, last_insert_rowid: 0, truncated: false }), { status: 200 });
    }
    return new Response(JSON.stringify(body.statements.map(() => ({
      rows_affected: 1,
      routed_operation_id: request.headers["idempotency-key"]
    }))), { status: 200 });
  }
);
await unlink(migrationsPath);
assert.deepEqual(migrateResult.applied, ["http-001"]);
assert.deepEqual(migrateResult.skipped, ["existing-001"]);
assert.equal(migrateResult.statement_count, 2);
assert.equal(migrateResult.batch_count, 2);
assert.equal(migrateResult.rows_affected, "3");
assert.deepEqual(migrateResult.routed_operations.map((operation) => operation.operation_id), ["migrate_1-ensure", "migrate_1-1"]);
assert.equal(migrateCalls[1].body.statements[0].sql, "CREATE TABLE icpdb_schema_migrations(version TEXT PRIMARY KEY, name TEXT, applied_at_ms TEXT NOT NULL)");
assert.equal(migrateCalls[4].body.statements[0].sql, "CREATE TABLE http_migrated(id INTEGER)");
assert.equal(migrateCalls[4].body.statements[2].sql, "INSERT INTO icpdb_schema_migrations(version, name, applied_at_ms) VALUES (?1, ?2, ?3)");
assert.deepEqual(migrateCalls[4].body.statements[2].params.slice(0, 2), [{ text: "http-001" }, { text: "create_http_migrated" }]);
await assert.rejects(() => migrateIcpdb(
  parseCliArgs(["migrate", "alpha", "-"], env),
  async () => new Response(JSON.stringify({}), { status: 200 }),
  Readable.from([JSON.stringify([{ version: "dup", sql: "SELECT 1;" }, { version: "dup", sql: "SELECT 2;" }])])
), /duplicate migration version: dup/);

const formattedPreview = formatCliOutput(
  {
    table_name: "notes",
    columns: ["id", "body"],
    rows: [[{ integer: 1 }, { text: "hello" }]],
    total_count: 1,
    offset: 0,
    limit: 1,
    rows_affected: 0,
    truncated: false
  },
  { outputFormat: "table" }
);
assert.match(formattedPreview, /notes \(1 rows; showing 1-1; limit 1; offset 0; next -\)/);
assert.match(formattedPreview, /showing 1-1; limit 1; offset 0; next -/);
assert.match(formattedPreview, /id\s+\|\s+body/);
assert.match(formattedPreview, /1\s+\|\s+hello/);

const formattedPreviewPage = formatCliOutput(
  {
    table_name: "notes",
    columns: ["id"],
    rows: [[{ integer: 26 }]],
    total_count: 27,
    offset: 25,
    limit: 1,
    rows_affected: 0,
    truncated: false
  },
  { outputFormat: "table" }
);
assert.match(formattedPreviewPage, /notes \(27 rows; showing 26-26; limit 1; offset 25; next 26\)/);
assert.throws(
  () => formatCliOutput({
    table_name: "notes",
    columns: ["id"],
    rows: [],
    total_count: 0,
    rows_affected: 0,
    truncated: false
  }, { outputFormat: "table" }),
  /preview offset must be a non-negative integer/
);
assert.throws(
  () => formatCliOutput({
    table_name: "notes",
    columns: ["id"],
    rows: [],
    offset: 0,
    limit: 1,
    rows_affected: 0,
    truncated: false
  }, { outputFormat: "table" }),
  /preview total_count must be a non-negative integer/
);

const formattedPreviewCsv = formatCliOutput(
  {
    table_name: "notes",
    columns: ["id", "body"],
    rows: [[{ integer: 1 }, { text: "hello, csv" }]],
    total_count: 1,
    rows_affected: 0,
    truncated: false
  },
  { outputFormat: "csv" }
);
assert.equal(formattedPreviewCsv, "id,body\n1,\"hello, csv\"");

const formattedDescription = formatCliOutput(
  {
    table_name: "notes",
    schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
    columns: [
      { name: "id", declared_type: "INTEGER", not_null: false, primary_key_position: 1 },
      { name: "body", declared_type: "TEXT", not_null: true, primary_key_position: 0 }
    ],
    indexes: [
      {
        name: "notes_body_idx",
        unique: true,
        origin: "c",
        partial: false,
        columns: [{ seqno: 0, cid: 1, name: "body", descending: false, collation: "BINARY", key: true }],
        schema_sql: "CREATE UNIQUE INDEX notes_body_idx ON notes(body)"
      }
    ],
    triggers: [
      {
        name: "notes_guard",
        table_name: "notes",
        schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
      }
    ],
    foreign_keys: [
      {
        from_column: "parent_id",
        id: 0,
        seq: 0,
        table_name: "parents",
        to_column: "id",
        on_update: "CASCADE",
        on_delete: "RESTRICT",
        match_clause: "NONE"
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedDescription, /table notes/);
assert.match(formattedDescription, /columns/);
assert.match(formattedDescription, /body\s+\|\s+TEXT\s+\|\s+no/);
assert.match(formattedDescription, /indexes/);
assert.match(formattedDescription, /notes_body_idx/);
assert.match(formattedDescription, /body/);
assert.match(formattedDescription, /partial/);
assert.match(formattedDescription, /CREATE UNIQUE INDEX notes_body_idx ON notes\(body\)/);
assert.match(formattedDescription, /triggers/);
assert.match(formattedDescription, /notes_guard/);
assert.match(formattedDescription, /CREATE TRIGGER notes_guard BEFORE INSERT ON notes/);
assert.match(formattedDescription, /foreign keys/);
assert.match(formattedDescription, /group\s+\|\s+seq/);
assert.match(formattedDescription, /parent_id\s+\|\s+parents\.id/);
assert.match(formattedDescription, /CASCADE/);
assert.match(formattedDescription, /RESTRICT/);

const formattedDescriptionCsv = formatCliOutput(
  {
    table_name: "notes",
    columns: [
      { name: "id", declared_type: "INTEGER", not_null: false, primary_key_position: 1 },
      { name: "body", declared_type: "TEXT", not_null: true, primary_key_position: 0 }
    ],
    indexes: [],
    triggers: [],
    foreign_keys: []
  },
  { outputFormat: "csv" }
);
assert.match(formattedDescriptionCsv, /name,type,null,pk,default,hidden/);
assert.match(formattedDescriptionCsv, /body,TEXT,no,,,0/);

const formattedColumns = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    column_count: 2,
    columns: [
      { cid: 0, name: "id", declared_type: "INTEGER", not_null: false, default_value: null, primary_key_position: 1, hidden: 0 },
      { cid: 1, name: "body", declared_type: "TEXT", not_null: true, default_value: null, primary_key_position: 0, hidden: 0 }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedColumns, /columns notes \(2\)/);
assert.match(formattedColumns, /body\s+\|\s+TEXT\s+\|\s+no/);
assert.match(formattedColumns, /id\s+\|\s+INTEGER/);

const formattedIndexes = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    indexes: [
      {
        name: "notes_body_idx",
        unique: true,
        origin: "c",
        partial: false,
        columns: [{ seqno: 0, cid: 1, name: "body", descending: false, collation: "BINARY", key: true }],
        schema_sql: "CREATE UNIQUE INDEX notes_body_idx ON notes(body)"
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedIndexes, /indexes notes/);
assert.match(formattedIndexes, /notes_body_idx/);
assert.match(formattedIndexes, /body/);
assert.match(formattedIndexes, /CREATE UNIQUE INDEX notes_body_idx ON notes\(body\)/);

const formattedTriggers = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    triggers: [
      {
        name: "notes_guard",
        table_name: "notes",
        schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedTriggers, /triggers notes/);
assert.match(formattedTriggers, /notes_guard/);
assert.match(formattedTriggers, /CREATE TRIGGER notes_guard BEFORE INSERT ON notes/);

const formattedTriggersCsv = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    triggers: [
      {
        name: "notes_guard",
        table_name: "notes",
        schema_sql: "CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END"
      }
    ]
  },
  { outputFormat: "csv" }
);
assert.match(formattedTriggersCsv, /name,table,schema_sql/);
assert.match(formattedTriggersCsv, /notes_guard,notes,CREATE TRIGGER notes_guard BEFORE INSERT ON notes BEGIN SELECT 1; END/);

const formattedForeignKeys = formatCliOutput(
  {
    database_id: "alpha",
    table_name: "notes",
    foreign_keys: [
      {
        from_column: "parent_id",
        id: 0,
        seq: 0,
        table_name: "parents",
        to_column: "id",
        on_update: "CASCADE",
        on_delete: "RESTRICT",
        match_clause: "NONE"
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedForeignKeys, /foreign keys notes/);
assert.match(formattedForeignKeys, /group\s+\|\s+seq/);
assert.match(formattedForeignKeys, /parent_id\s+\|\s+parents\.id/);
assert.match(formattedForeignKeys, /CASCADE/);
assert.match(formattedForeignKeys, /NONE/);

const formattedDatabaseInspect = formatCliOutput(
  {
    database_id: "alpha",
    usage: {
      status: "hot",
      logical_size_bytes: 4096,
      max_logical_size_bytes: 67108864,
      usage_event_count: 3
    },
    billing: {
      status: "active",
      balance_units: 95,
      spent_units: 5,
      usage_event_count: 3
    },
    usage_events: [
      {
        method: "sql_execute",
        operation: "INSERT",
        success: true,
        event_count: 2,
        total_cycles_delta: 30,
        total_rows_returned: 4,
        total_rows_affected: 3,
        last_created_at_ms: 1234
      }
    ],
    access: {
      tokens: [
        { token_id: "tok_owner", name: "owner", scope: "owner", created_at_ms: 1000, last_used_at_ms: 1200, revoked_at_ms: null }
      ],
      members: [
        { principal: "aaaaa-aa", role: "owner", granted_at_ms: 1000 }
      ]
    },
    table_summaries: [{
      table_name: "notes",
      object_type: "table",
      row_count: 7,
      column_count: 2,
      columns: ["id", "body"],
      index_count: 1,
      trigger_count: 2,
      foreign_key_count: 3
    }],
    tables: [
      {
        table_name: "notes",
        schema_sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)",
        columns: [
          { name: "id", declared_type: "INTEGER", not_null: false, primary_key_position: 1 },
          { name: "body", declared_type: "TEXT", not_null: false, primary_key_position: 0 }
        ],
        indexes: [],
        triggers: [],
        foreign_keys: []
      }
    ]
  },
  { outputFormat: "table" }
);
assert.match(formattedDatabaseInspect, /account/);
assert.match(formattedDatabaseInspect, /logical_size_bytes/);
assert.match(formattedDatabaseInspect, /4096/);
assert.match(formattedDatabaseInspect, /balance_units/);
assert.match(formattedDatabaseInspect, /95/);
assert.match(formattedDatabaseInspect, /usage events/);
assert.match(formattedDatabaseInspect, /sql_execute\s+\|\s+INSERT\s+\|\s+yes\s+\|\s+2\s+\|\s+30/);
assert.match(formattedDatabaseInspect, /4\s+\|\s+3/);
assert.match(formattedDatabaseInspect, /access/);
assert.match(formattedDatabaseInspect, /tok_owner\s+\|\s+owner\s+\|\s+owner\s+\|\s+active\s+\|\s+1000\s+\|\s+1200/);
assert.match(formattedDatabaseInspect, /aaaaa-aa\s+\|\s+owner/);
assert.match(formattedDatabaseInspect, /table summary/);
assert.match(formattedDatabaseInspect, /notes\s+\|\s+table\s+\|\s+7\s+\|\s+2\s+\|\s+1\s+\|\s+2\s+\|\s+3\s+\|\s+id, body/);

const formattedDatabaseInspectCsv = formatCliOutput(
  {
    database_id: "alpha",
    table_summaries: [{
      table_name: "notes",
      object_type: "table",
      row_count: 7,
      column_count: 2,
      index_count: 1,
      trigger_count: 2,
      foreign_key_count: 3,
      columns: ["id", "body"]
    }],
    tables: []
  },
  { outputFormat: "csv" }
);
assert.match(formattedDatabaseInspectCsv, /table_name,object_type,row_count,column_count,index_count,trigger_count,foreign_key_count,columns/);
assert.match(formattedDatabaseInspectCsv, /notes,table,7,2,1,2,3,"\[""id"",""body""\]"/);

const formattedTokenList = formatCliOutput(
  [
    { token_id: "tok_active", name: "active-token", scope: "write", created_at_ms: 1000, last_used_at_ms: 1200, revoked_at_ms: null },
    { token_id: "tok_revoked", name: "old-token", scope: "read", created_at_ms: 900, last_used_at_ms: null, revoked_at_ms: 1300 }
  ],
  { endpoint: "/v1/tokens/list", outputFormat: "table" }
);
assert.match(formattedTokenList, /token_id\s+\|\s+name\s+\|\s+scope\s+\|\s+status\s+\|\s+created_at_ms\s+\|\s+last_used_at_ms\s+\|\s+revoked_at_ms/);
assert.match(formattedTokenList, /tok_active\s+\|\s+active-token\s+\|\s+write\s+\|\s+active\s+\|\s+1000\s+\|\s+1200/);
assert.match(formattedTokenList, /tok_revoked\s+\|\s+old-token\s+\|\s+read\s+\|\s+revoked\s+\|\s+900\s+\|\s+\|\s+1300/);

const formattedCreatedToken = formatCliOutput(
  {
    token: "icpdb_secret",
    info: { token_id: "tok_created", name: "web-write", scope: "write", created_at_ms: 1500, last_used_at_ms: null, revoked_at_ms: null }
  },
  { endpoint: "/v1/tokens/create", outputFormat: "table" }
);
assert.match(formattedCreatedToken, /token\s+\|\s+token_id\s+\|\s+name\s+\|\s+scope\s+\|\s+status\s+\|\s+created_at_ms/);
assert.match(formattedCreatedToken, /icpdb_secret\s+\|\s+tok_created\s+\|\s+web-write\s+\|\s+write\s+\|\s+active\s+\|\s+1500/);

const formattedMemberList = formatCliOutput(
  [{ principal: "aaaaa-aa", role: "owner", granted_at_ms: 1000 }],
  { endpoint: "/v1/members/list", outputFormat: "table" }
);
assert.match(formattedMemberList, /principal\s+\|\s+role\s+\|\s+granted_at_ms/);
assert.match(formattedMemberList, /aaaaa-aa\s+\|\s+owner\s+\|\s+1000/);

const formattedPaymentList = formatCliOutput(
  [{
    payment_id: "pay_1",
    database_id: "alpha",
    payer_principal: "aaaaa-aa",
    amount_e8s: 1000000,
    credited_units: 1000,
    block_index: 99,
    created_at_ms: 1100
  }],
  { endpoint: "/v1/payments/list", outputFormat: "table" }
);
assert.match(formattedPaymentList, /payment_id\s+\|\s+payer\s+\|\s+amount_e8s\s+\|\s+credited_units\s+\|\s+block_index\s+\|\s+created_at_ms/);
assert.match(formattedPaymentList, /pay_1\s+\|\s+aaaaa-aa\s+\|\s+1000000\s+\|\s+1000\s+\|\s+99\s+\|\s+1100/);

const formattedUsageEvents = formatCliOutput(
  [
    {
      method: "sql_batch",
      operation: "CREATE+INSERT",
      success: true,
      event_count: 1,
      total_cycles_delta: 40,
      total_rows_returned: 2,
      total_rows_affected: 2,
      last_created_at_ms: 2345
    }
  ],
  { outputFormat: "table" }
);
assert.match(formattedUsageEvents, /method\s+\|\s+operation\s+\|\s+success\s+\|\s+count\s+\|\s+cycles/);
assert.match(formattedUsageEvents, /sql_batch\s+\|\s+CREATE\+INSERT\s+\|\s+yes\s+\|\s+1\s+\|\s+40\s+\|\s+2\s+\|\s+2/);

const formattedOk = formatCliOutput(null, { outputFormat: "table" });
assert.equal(formattedOk, "OK");
assert.match(formatCliOutput(scalarResponse, { scalar: true, outputFormat: "table" }), /total\s+\|\s+3\s+\|\s+yes\s+\|\s+1\s+\|\s+no/);
assert.equal(formatCliOutput(scalarResponse, { scalar: true, outputFormat: "csv" }), "column,value,row_found,rows_returned,truncated\ntotal,3,yes,1,no");

const shellSqlOutput = captureWritable();
const shellSqlCalls = [];
await runShellSql(
  parseCliArgs(["shell", "alpha", "SELECT", "1"], env),
  shellSqlOutput,
  async (url, request) => {
    shellSqlCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify({
      columns: ["one"],
      rows: [[{ Integer: "1" }]],
      rows_affected: 0,
      truncated: false
    }), { status: 200 });
  }
);
assert.deepEqual(shellSqlCalls, [{
  url: "https://db.example/v1/sql/query",
  body: { database_id: "alpha", sql: "SELECT 1", params: [], max_rows: 100 }
}]);
assert.match(shellSqlOutput.text(), /one/);
assert.match(shellSqlOutput.text(), /1/);

const shellWriteOutput = captureWritable();
const shellWriteCalls = [];
await runShellSql(
  parseCliArgs(["shell", "alpha", "INSERT", "INTO", "notes", "VALUES", "(1)"], env),
  shellWriteOutput,
  async (url, request) => {
    shellWriteCalls.push({ url, body: JSON.parse(request.body), idempotencyKey: request.headers["idempotency-key"] });
    return new Response(JSON.stringify({
      rows: [],
      columns: [],
      rows_affected: 1,
      last_insert_rowid: 1,
      truncated: false
    }), { status: 200 });
  }
);
assert.equal(shellWriteCalls[0].url, "https://db.example/v1/sql/execute");
assert.deepEqual(shellWriteCalls[0].body, {
  database_id: "alpha",
  sql: "INSERT INTO notes VALUES (1)",
  params: [],
  max_rows: 100
});
assert.match(shellWriteCalls[0].idempotencyKey, /^shell-alpha-[0-9a-f-]{36}$/);
assert.match(shellWriteOutput.text(), /affected 1/);

const shellCsvOutput = captureWritable();
await runShellSql(
  parseCliArgs(["shell", "alpha", "SELECT body FROM notes", "--format", "csv"], env),
  shellCsvOutput,
  async (url, request) => {
    assert.equal(url, "https://db.example/v1/sql/query");
    assert.deepEqual(JSON.parse(request.body), {
      database_id: "alpha",
      sql: "SELECT body FROM notes",
      params: [],
      max_rows: 100
    });
    return new Response(JSON.stringify({
      columns: ["body"],
      rows: [[{ Text: "from shell,csv" }]],
      rows_affected: 0,
      truncated: false
    }), { status: 200 });
  }
);
assert.equal(shellCsvOutput.text(), "body\n\"from shell,csv\"\n");

const archiveCalls = [];
const archivePath = checkFile("archive.sqlite3");
const archiveResult = await archiveIcpdb(
  parseCliArgs(["archive", "alpha", archivePath], env),
  async (url, request) => {
    archiveCalls.push({ url, body: JSON.parse(request.body) });
    if (url.endsWith("/v1/archive/begin")) {
      return new Response(JSON.stringify({ database_id: "alpha", size_bytes: 3 }), { status: 200 });
    }
    if (url.endsWith("/v1/archive/read")) {
      return new Response(JSON.stringify({ bytes: [1, 2, 3] }), { status: 200 });
    }
    return new Response(JSON.stringify(null), { status: 200 });
  }
);
assert.equal(archiveResult.size_bytes, 3);
assert.equal(formatCliOutput(archiveResult, { archive: true, outputFormat: "env" }), [
  `ICPDB_SNAPSHOT_DATABASE_ID=${JSON.stringify("alpha")}`,
  `ICPDB_SNAPSHOT_FILE=${JSON.stringify(archivePath)}`,
  `ICPDB_SNAPSHOT_SIZE_BYTES=${JSON.stringify("3")}`,
  `ICPDB_SNAPSHOT_HASH=${JSON.stringify(archiveResult.snapshot_hash)}`
].join("\n"));
assert.deepEqual(archiveCalls.map((call) => call.url), [
  "https://db.example/v1/archive/begin",
  "https://db.example/v1/archive/read",
  "https://db.example/v1/archive/finalize"
]);
assert.deepEqual(archiveCalls[2].body.database_id, "alpha");
assert.equal(archiveCalls[2].body.snapshot_hash.length, 32);

const unsafeArchiveCalls = [];
await assert.rejects(
  () => archiveIcpdb(
    parseCliArgs(["archive", "alpha", archivePath], env),
    async (url, request) => {
      unsafeArchiveCalls.push({ url, body: JSON.parse(request.body) });
      return new Response(JSON.stringify({ database_id: "alpha", size_bytes: Number.MAX_SAFE_INTEGER + 1 }), { status: 200 });
    }
  ),
  /archive size_bytes exceeds JavaScript safe integer range/
);
assert.deepEqual(unsafeArchiveCalls.map((call) => call.url), [
  "https://db.example/v1/archive/begin",
  "https://db.example/v1/archive/cancel"
]);
assert.deepEqual(unsafeArchiveCalls[1].body, { database_id: "alpha" });

const interruptedArchiveCalls = [];
const interruptedArchivePath = checkFile("interrupted.sqlite3");
await assert.rejects(
  () => archiveIcpdb(
    parseCliArgs(["archive", "alpha", interruptedArchivePath], env),
    async (url, request) => {
      interruptedArchiveCalls.push({ url, body: JSON.parse(request.body) });
      if (url.endsWith("/v1/archive/begin")) {
        return new Response(JSON.stringify({ database_id: "alpha", size_bytes: 3 }), { status: 200 });
      }
      if (url.endsWith("/v1/archive/read")) {
        return new Response(JSON.stringify({ bytes: [] }), { status: 200 });
      }
      return new Response(JSON.stringify(null), { status: 200 });
    }
  ),
  /archive stream ended before expected size/
);
assert.deepEqual(interruptedArchiveCalls.map((call) => call.url), [
  "https://db.example/v1/archive/begin",
  "https://db.example/v1/archive/read",
  "https://db.example/v1/archive/cancel"
]);
assert.deepEqual(interruptedArchiveCalls[2].body, { database_id: "alpha" });

const restoreCalls = [];
const expectedArchiveHash = createHash("sha256").update(Buffer.from([1, 2, 3])).digest("hex");
const restoreResult = await restoreIcpdb(
  parseCliArgs(["restore", "alpha", archivePath, "--expect-snapshot-hash", expectedArchiveHash], env),
  async (url, request) => {
    restoreCalls.push({ url, body: JSON.parse(request.body) });
    return new Response(JSON.stringify(null), { status: 200 });
  }
);
assert.equal(restoreResult.size_bytes, 3);
assert.deepEqual(restoreCalls.map((call) => call.url), [
  "https://db.example/v1/restore/begin",
  "https://db.example/v1/restore/write",
  "https://db.example/v1/restore/finalize"
]);
assert.deepEqual(restoreCalls[1].body.bytes, [1, 2, 3]);

const largeSnapshot = Buffer.alloc(256 * 1024 + 5);
largeSnapshot[0] = 1;
largeSnapshot[256 * 1024] = 2;
largeSnapshot[largeSnapshot.length - 1] = 3;
await writeFile(archivePath, largeSnapshot);
const largeSnapshotHash = createHash("sha256").update(largeSnapshot).digest("hex");
const largeRestoreCalls = [];
const largeRestoreResult = await restoreIcpdb(
  parseCliArgs(["restore", "alpha", archivePath, "--expect-snapshot-hash", largeSnapshotHash], env),
  async (url, request) => {
    const body = JSON.parse(request.body);
    largeRestoreCalls.push({ url, body });
    return new Response(JSON.stringify(null), { status: 200 });
  }
);
assert.equal(largeRestoreResult.size_bytes, largeSnapshot.length);
assert.deepEqual(largeRestoreCalls.map((call) => call.url), [
  "https://db.example/v1/restore/begin",
  "https://db.example/v1/restore/write",
  "https://db.example/v1/restore/write",
  "https://db.example/v1/restore/finalize"
]);
assert.equal(largeRestoreCalls[0].body.size_bytes, largeSnapshot.length);
assert.equal(largeRestoreCalls[1].body.offset, 0);
assert.equal(largeRestoreCalls[1].body.bytes.length, 256 * 1024);
assert.equal(largeRestoreCalls[2].body.offset, 256 * 1024);
assert.deepEqual(largeRestoreCalls[2].body.bytes, [2, 0, 0, 0, 3]);

const restoreCallCount = restoreCalls.length;
await assert.rejects(
  () => restoreIcpdb(
    parseCliArgs(["restore", "alpha", archivePath, "--expect-snapshot-hash", "aa".repeat(32)], env),
    async (url, request) => {
      restoreCalls.push({ url, body: JSON.parse(request.body) });
      return new Response(JSON.stringify(null), { status: 200 });
    }
  ),
  /snapshot hash mismatch/
);
assert.equal(restoreCalls.length, restoreCallCount);

assert.deepEqual(await snapshotInfoIcpdb(parseCliArgs(["snapshot-info", archivePath], env)), {
  file: archivePath,
  size_bytes: largeSnapshot.length,
  snapshot_hash: largeSnapshotHash
});
assert.equal(formatCliOutput(await snapshotInfoIcpdb(parseCliArgs(["snapshot-info", archivePath], env)), { snapshotInfo: true, outputFormat: "env" }), [
  `ICPDB_SNAPSHOT_FILE=${JSON.stringify(archivePath)}`,
  `ICPDB_SNAPSHOT_SIZE_BYTES=${JSON.stringify(String(largeSnapshot.length))}`,
  `ICPDB_SNAPSHOT_HASH=${JSON.stringify(largeSnapshotHash)}`
].join("\n"));

assert.match(usage(), /Control-plane commands:/);
assert.match(usage(), /Optional bearer-token HTTP surface for curl, external HTTP clients, browser token sessions, and short-lived sharing/);
assert.match(usage(), /Normal Server\/CI jobs should use package icpdb, @icpdb\/client\/server, or @icpdb\/client\/service-identity with service\.env principal ACLs/);
assert.match(usage(), /Database bearer tokens are not the Server\/CI path when service\.env can hold a service identity/);
assert.match(usage(), /Database inspection commands:/);
assert.match(usage(), /Account and lifecycle commands:/);
assert.match(usage(), /SQL commands:/);
assert.match(usage(), /query \[database_id\] <sql> \[--params '\[\.\.\.\]\|\{\.\.\.\}'\]/);
assert.match(usage(), /scalar \[database_id\] <sql> \[--params '\[\.\.\.\]\|\{\.\.\.\}'\]/);
assert.match(usage(), /execute \[database_id\] <sql> \[--params '\[\.\.\.\]\|\{\.\.\.\}'\]/);
assert.match(usage(), /preview \[database_id\] <table_name>/);
assert.match(usage(), /stats \[database_id\]/);
assert.match(usage(), /columns \[database_id\] <table_name>/);
assert.match(usage(), /indexes \[database_id\] <table_name>/);
assert.match(usage(), /triggers \[database_id\] <table_name>/);
assert.match(usage(), /foreign-keys \[database_id\] <table_name>/);
assert.match(usage(), /views \[database_id\]/);
assert.match(usage(), /create-db \[token_name\]/);
assert.match(usage(), /create-db \[token_name\] --statement <sql>/);
assert.match(usage(), /create-db \[token_name\] --statements-file <file>/);
assert.match(usage(), /create-db \[token_name\] --setup-file <file\|->/);
assert.match(usage(), /create-db \[token_name\] --setup-migrations-file <file\|->/);
assert.match(usage(), /databases/);
assert.match(usage(), /shell \[database_id\]/);
assert.match(usage(), /batch \[database_id\]/);
assert.match(usage(), /inspect \[database_id\] \[table_name\]/);
assert.match(usage(), /--access/);
assert.match(usage(), /schema \[database_id\] \[table_name\]/);
assert.match(usage(), /dump \[database_id\] \[table_name\]/);
assert.match(usage(), /load \[database_id\] <file\|->/);
assert.match(usage(), /script \[database_id\] <file\|->/);
assert.match(usage(), /migrate \[database_id\] <file\|->/);
assert.match(usage(), /placements/);
assert.match(usage(), /shards/);
assert.match(usage(), /shard-status <database_canister_id>/);
assert.match(usage(), /shard-top-up <database_canister_id> <cycles>/);
assert.match(usage(), /shard-maintain <min_available_slots>/);
assert.match(usage(), /shard-migrate <database_id> <database_canister_id>/);
assert.match(usage(), /shard-ops/);
assert.match(usage(), /shard-reconcile <applied\|failed> <operation_id>/);
assert.match(usage(), /operation-reconcile <database_id> <operation_id>/);
assert.match(usage(), /usage \[database_id\]/);
assert.match(usage(), /usage-events \[database_id\]/);
assert.match(usage(), /operation \[database_id\] <operation_id>/);
assert.match(usage(), /billing \[database_id\]/);
assert.match(usage(), /placement \[database_id\]/);
assert.match(usage(), /quota \[database_id\] <max_logical_size_bytes>/);
assert.match(usage(), /create-token \[database_id\] <name> <read\|write\|owner>/);
assert.match(usage(), /tokens \[database_id\]/);
assert.match(usage(), /revoke-token \[database_id\] <token_id>/);
assert.match(usage(), /archive \[database_id\] <file> \[--format table\|json\|csv\|env\]/);
assert.match(usage(), /snapshot-info <file> \[--format table\|json\|csv\|env\]/);
assert.match(usage(), /restore \[database_id\] <file> \[--expect-snapshot-hash <sha256>\]/);
assert.match(usage(), /archive-cancel \[database_id\]/);
assert.match(usage(), /members \[database_id\]/);
assert.match(usage(), /grant-member \[database_id\] <principal> <reader\|writer\|owner>/);
assert.match(usage(), /revoke-member \[database_id\] <principal>/);
assert.match(usage(), /delete-db \[database_id\]/);
assert.match(usage(), /--format json\|table\|csv\|env/);
assert.match(usage(), /--params '\[\.\.\.\]\|\{\.\.\.\}'/);
assert.match(usage(), /--params-file <file>/);
assert.match(usage(), /--wait/);
assert.match(usage(), /--statements-file <file>/);
assert.match(usage(), /--setup-file <file\|->/);
assert.match(usage(), /--setup-migrations-file <file\|->/);
assert.match(usage(), /--expect-snapshot-hash <sha256>/);
assert.match(usage(), /ICPDB_HTTP_BASE_URL/);
assert.match(usage(), /ICPDB_CANISTER_ID/);
assert.match(commandUsage("archive"), /archive \[database_id\] <file>/);
assert.match(commandUsage("restore"), /restore \[database_id\] <file>/);
assert.match(commandUsage("inspect"), /inspect \[database_id\] \[table_name\]/);
assert.match(commandUsage("inspect"), /inspect \[database_id\] --access/);
assert.doesNotMatch(commandUsage("inspect"), /query \[database_id\] <sql>/);
assert.match(commandUsage("shell"), /shell \[database_id\] \[sql\|dot-command\]/);
assert.match(commandUsage("shell"), /\.inspect \[table_name\]/);
assert.match(commandUsage("shell"), /Database inspection commands:/);
assert.match(commandUsage("shell"), /\.help sql/);
assert.match(commandUsage("shell sql"), /Other SQL statements run as writes/);
assert.match(commandUsage("shell .sql"), /--idempotency-key before shell/);
assert.match(commandUsage(".operation"), /\.operation <operation_id>/);
assert.throws(() => commandUsage("unknown-command"), /unknown help command/);
assert.match(shellUsage(), /\.help/);
assert.match(shellUsage("inspect"), /\.inspect \[table_name\] \[limit\] \[offset\]/);
assert.match(shellUsage("inspect"), /\.inspect --access/);
assert.doesNotMatch(shellUsage("inspect"), /\.schema \[table_name\]/);
assert.match(shellUsage(".operation"), /\.operation <operation_id>/);
assert.match(shellUsage("sql"), /read-only PRAGMA/);
assert.match(shellUsage("sql"), /auto-generates an idempotency key/);
assert.match(shellUsage("sql"), /--idempotency-key before shell/);
assert.throws(() => shellUsage("unknown-command"), /unknown shell help command/);
assert.match(shellUsage(), /\.views/);
assert.match(shellUsage(), /Database inspection commands:/);
assert.match(shellUsage(), /SQL file commands:/);
assert.match(shellUsage(), /Account and lifecycle commands:/);
assert.match(shellUsage(), /Navigation commands:/);
assert.match(shellUsage(), /Table, operation, token, and file arguments accept single quotes, double quotes, and backslash escaping/);
assert.match(shellUsage(), /\.stats/);
assert.match(shellUsage(), /\.usage/);
assert.match(shellUsage(), /\.billing/);
assert.match(shellUsage(), /\.placement/);
assert.match(shellUsage(), /\.operation <operation_id>/);
assert.match(shellUsage(), /\.usage-events/);
assert.match(shellUsage(), /\.quota <max_logical_size_bytes>/);
assert.match(shellUsage(), /\.tokens/);
assert.match(shellUsage(), /\.create-token <name> <read\|write\|owner>/);
assert.match(shellUsage(), /\.revoke-token <token_id>/);
assert.match(shellUsage(), /\.members/);
assert.match(shellUsage(), /\.grant-member <principal> <reader\|writer\|owner>/);
assert.match(shellUsage(), /\.revoke-member <principal>/);
assert.match(shellUsage(), /\.delete-db/);
assert.match(shellUsage(), /\.columns <table_name>/);
assert.match(shellUsage(), /\.indexes <table_name>/);
assert.match(shellUsage(), /\.triggers <table_name>/);
assert.match(shellUsage(), /\.foreign-keys <table_name>/);
assert.match(shellUsage(), /\.preview <table_name> \[limit\] \[offset\]/);
assert.match(shellUsage(), /\.inspect \[table_name\] \[limit\] \[offset\]/);
assert.match(shellUsage(), /\.inspect --access/);
assert.match(shellUsage(), /\.dump \[table_name\]/);
assert.match(shellUsage(), /\.load <file\|->/);
assert.match(shellUsage(), /\.script <file\|->/);
assert.match(shellUsage(), /\.migrate <file\|->/);
assert.match(shellUsage(), /\.load, \.script, and \.migrate auto-generate idempotency keys/);
assert.match(shellUsage(), /Backup and restore commands:/);
assert.match(shellUsage(), /\.archive <file>/);
assert.match(shellUsage(), /\.snapshot-info <file>/);
assert.match(shellUsage(), /\.restore <file> \[expected_sha256\]/);
assert.match(shellUsage(), /\.archive-cancel/);

await unlink(statementsFilePath);
await unlink(paramsFilePath);
await unlink(namedParamsFilePath);
await unlink(invalidParamsFilePath);
await unlink(interruptedArchivePath);
await rm(checkTmpDir, { recursive: true, force: true });

console.log("ICPDB HTTP CLI checks OK");
