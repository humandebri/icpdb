// Where: scripts/check-icpdb-identity-cli.mjs
// What: Unit checks for identity-signed ICPDB CLI command shaping and response normalization.
// Why: Server and CI workflows need principal-based SQL access without a live canister in tests.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Secp256k1KeyIdentity } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/identity/secp256k1/index.js";
import {
  commandUsage,
  executeIdentityCommand,
  formatIdentityCommandOutput,
  identityShellLineCommand,
  identityShellUsage,
  loadServiceIdentity,
  parseIdentityCliArgs,
  sqlValue,
  usage,
  writeIdentityEnvOutputFile,
  writeIdentityEnvOutputFileOrDelete
} from "./icpdb-identity.mjs";

const env = {
  ICPDB_CANISTER_ID: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ICPDB_NETWORK_URL: "http://localhost:8001",
  ICPDB_IDENTITY_JSON: JSON.stringify(Secp256k1KeyIdentity.generate().toJSON()),
  ICPDB_ROOT_KEY: "aabbcc"
};
const envWithDatabase = { ...env, ICPDB_DATABASE_ID: "db_env" };
const envWithUrl = {
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_url",
  ICPDB_NETWORK_URL: env.ICPDB_NETWORK_URL,
  ICPDB_IDENTITY_JSON: env.ICPDB_IDENTITY_JSON,
  ICPDB_ROOT_KEY: env.ICPDB_ROOT_KEY
};
const serviceIdentityJson = JSON.stringify(Secp256k1KeyIdentity.generate().toJSON());
const serviceEnv = { ...env, ICPDB_SERVICE_IDENTITY_JSON: serviceIdentityJson };
const execFileAsync = promisify(execFile);
const paramsTempDir = await mkdtemp(join(tmpdir(), "icpdb-identity-cli-"));
const paramsFilePath = join(paramsTempDir, "params.json");
const statementsFilePath = join(paramsTempDir, "statements.json");
const snapshotInfoPath = join(paramsTempDir, "snapshot.sqlite");
const fileIdentity = Secp256k1KeyIdentity.generate();
const identityJsonFilePath = join(paramsTempDir, "identity.json");
const openIdentityJsonFilePath = join(paramsTempDir, "open-identity.json");
const emptyIdentityJsonFilePath = join(paramsTempDir, "empty-identity.json");
const identitySource = await readFile("scripts/icpdb-identity.mjs", "utf8");
await writeFile(paramsFilePath, JSON.stringify({ body: "from-file", enabled: true }));
await writeFile(statementsFilePath, JSON.stringify([{ sql: "SELECT :body", params: { body: "from-statements-file" } }]));
await writeFile(snapshotInfoPath, Buffer.from([1, 2, 3]));
await writeFile(identityJsonFilePath, JSON.stringify(fileIdentity.toJSON()), { mode: 0o600 });
await chmod(identityJsonFilePath, 0o600);
await writeFile(openIdentityJsonFilePath, JSON.stringify(fileIdentity.toJSON()), { mode: 0o644 });
await chmod(openIdentityJsonFilePath, 0o644);
await writeFile(emptyIdentityJsonFilePath, "   \n", { mode: 0o600 });
await chmod(emptyIdentityJsonFilePath, 0o600);

assert.deepEqual(parseIdentityCliArgs(["help"], {}), { help: true, helpTopic: "" });
assert.deepEqual(parseIdentityCliArgs(["help", "sql"], {}), { help: true, helpTopic: "sql" });
assert.deepEqual(parseIdentityCliArgs(["help", "quickstart"], {}), { help: true, helpTopic: "quickstart" });
assert.deepEqual(parseIdentityCliArgs(["help", "ops"], {}), { help: true, helpTopic: "ops" });
assert.deepEqual(parseIdentityCliArgs(["help", "shell"], {}), { help: true, helpTopic: "shell" });
assert.deepEqual(parseIdentityCliArgs(["help", "shell", "sql"], {}), { help: true, helpTopic: "shell sql" });
assert.throws(() => parseIdentityCliArgs(["not-a-command"], {}), /unknown command: not-a-command/);
assert.throws(() => parseIdentityCliArgs(["not-a-command"], env), /unknown command: not-a-command/);
assert.match(usage(), /--env-out service\.env create-db/);
assert.doesNotMatch(usage(), /--env-file service\.env --env-out service\.env create-db/);
assert.doesNotMatch(usage(), /> service\.env|>> service\.env/);
const quickstartHelp = commandUsage("quickstart");
assert.match(quickstartHelp, /Server\/CI shortest path/);
assert.match(quickstartHelp, /--env-out service.env provision-service-db writer --setup-file \.\/schema.sql/);
assert.match(quickstartHelp, /one-table smoke without a schema file/);
assert.match(quickstartHelp, /--env-out service.env provision-service-db writer --statement "CREATE TABLE notes/);
assert.match(quickstartHelp, /production schema changes/);
assert.match(quickstartHelp, /--env-out service.env provision-service-db writer --setup-migrations-file \.\/migrations.json/);
assert.match(quickstartHelp, /read cwd-local service.env by default/);
assert.match(quickstartHelp, /First verify service.env locally: file mode, connection URL, and derived service principal/);
assert.match(quickstartHelp, /Server\/CI shortest path[\s\S]*node scripts\/icpdb-identity\.mjs inspect-env --format table[\s\S]*node scripts\/icpdb-identity\.mjs sql "INSERT INTO notes/);
assert.match(quickstartHelp, /Generic \.env is explicit/);
assert.match(quickstartHelp, /--env-out \.env/);
assert.match(quickstartHelp, /ICPDB_ENV_FILE=\.env/);
assert.match(quickstartHelp, /--env-file \.env/);
assert.match(quickstartHelp, /icpdb-identity\.mjs sql "INSERT INTO notes/);
assert.match(quickstartHelp, /icpdb-identity\.mjs sql "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs scalar "SELECT count\(\*\) FROM notes" --format table/);
assert.match(quickstartHelp, /Equivalent explicit commands are available when CI wants read\/write split in logs/);
assert.match(quickstartHelp, /icpdb-identity\.mjs execute "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["hello"\]'/);
assert.match(quickstartHelp, /icpdb-identity\.mjs query "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs tables --format table/);
assert.match(quickstartHelp, /Server\/CI shortest path[\s\S]*icpdb-identity\.mjs views --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs schema notes --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs columns notes --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs indexes notes --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs triggers notes --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs foreign-keys notes --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs inspect notes --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs status --format table/);
assert.match(quickstartHelp, /icpdb-service-env-check\.mjs --require-role writer --smoke-sql --smoke-sdk --format table/);
assert.match(quickstartHelp, /icpdb-identity\.mjs url --format env/);
assert.match(quickstartHelp, /Backup jobs need owner role/);
assert.match(quickstartHelp, /--env-out service.env provision-service-db owner --setup-file \.\/schema.sql/);
assert.match(quickstartHelp, /icpdb-service-env-check\.mjs --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(quickstartHelp, /Existing DB with owner private key/);
assert.match(quickstartHelp, /provision-service <database-id> writer/);
assert.match(quickstartHelp, /inspect-env --format table/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs status --format table/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*node scripts\/icpdb-identity\.mjs scalar "SELECT count\(\*\) FROM sqlite_schema" --format table/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs tables --format table/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs schema --format table/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*node scripts\/icpdb-identity\.mjs columns <table-name> --format table/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*node scripts\/icpdb-identity\.mjs indexes <table-name> --format table/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*node scripts\/icpdb-identity\.mjs triggers <table-name> --format table/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*node scripts\/icpdb-identity\.mjs foreign-keys <table-name> --format table/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs inspect --format table/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*icpdb-service-env-check\.mjs --require-role writer --smoke-sql --smoke-sdk --format table/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*node scripts\/icpdb-identity\.mjs url --format env/);
assert.match(quickstartHelp, /For archive\/restore or final goal proof on this existing DB, grant owner instead/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*provision-service <database-id> owner/);
assert.match(quickstartHelp, /Existing DB with owner private key[\s\S]*icpdb-service-env-check\.mjs --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(quickstartHelp, /Existing browser\/II DB/);
assert.match(quickstartHelp, /copy console Response sidebar Connection URL/);
assert.match(quickstartHelp, /Use the database id from icpdb:\/\/<canister-id>\/<database-id>/);
assert.match(quickstartHelp, /--canister-id <id> --database-id <database-id> --network-url https:\/\/icp-api\.io --env-out service.env generate-identity/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs principal --format table/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs inspect-env --format table/);
assert.match(quickstartHelp, /Grant the printed service principal as owner in console Permissions/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs status --format table/);
assert.match(quickstartHelp, /Existing browser\/II DB[\s\S]*node scripts\/icpdb-identity\.mjs scalar "SELECT count\(\*\) FROM sqlite_schema" --format table/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs tables --format table/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs schema --format table/);
assert.match(quickstartHelp, /Existing browser\/II DB[\s\S]*node scripts\/icpdb-identity\.mjs columns <table-name> --format table/);
assert.match(quickstartHelp, /Existing browser\/II DB[\s\S]*node scripts\/icpdb-identity\.mjs indexes <table-name> --format table/);
assert.match(quickstartHelp, /Existing browser\/II DB[\s\S]*node scripts\/icpdb-identity\.mjs triggers <table-name> --format table/);
assert.match(quickstartHelp, /Existing browser\/II DB[\s\S]*node scripts\/icpdb-identity\.mjs foreign-keys <table-name> --format table/);
assert.match(quickstartHelp, /node scripts\/icpdb-identity\.mjs inspect --format table/);
assert.match(quickstartHelp, /icpdb-service-env-check\.mjs --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(quickstartHelp, /Existing browser\/II DB[\s\S]*node scripts\/icpdb-identity\.mjs url --format env/);
const opsHelp = commandUsage("ops");
assert.match(opsHelp, /Archive\/restore path/);
assert.match(opsHelp, /cwd-local service.env is read by default/);
assert.match(opsHelp, /Archive\/restore requires owner role/);
assert.match(opsHelp, /writer service\.env is only for SQL write\/query CI/);
assert.match(opsHelp, /provision-service-db owner or grant owner/);
assert.match(opsHelp, /Non-destructive CI verification restores into a scratch DB/);
assert.match(opsHelp, /icpdb-service-env-check\.mjs --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(opsHelp, /icpdb-identity\.mjs archive \.\/backup.sqlite --format env/);
assert.match(opsHelp, /icpdb-identity\.mjs snapshot-info \.\/backup.sqlite --format env/);
assert.match(opsHelp, /export ICPDB_SNAPSHOT_HASH=<value-from-snapshot-info>/);
assert.match(opsHelp, /snapshot-info re-reads the same hash offline before restore promotion/);
assert.match(opsHelp, /restore writes into the selected DB; pin the SHA-256/);
assert.match(opsHelp, /restore \.\/backup.sqlite --expect-snapshot-hash "\$ICPDB_SNAPSHOT_HASH"/);
assert.match(opsHelp, /icpdb-identity\.mjs status --format table/);
assert.match(opsHelp, /Shard operator path/);
assert.match(opsHelp, /export ICPDB_ENV_FILE=controller.env/);
assert.match(opsHelp, /icpdb-service-env-check\.mjs --env-file controller\.env --smoke-shards --smoke-sdk-shards --format table/);
assert.match(opsHelp, /icpdb-identity\.mjs all-placements --format table/);
assert.match(opsHelp, /icpdb-identity\.mjs shards --format table/);
assert.match(opsHelp, /icpdb-identity\.mjs shard-status <database-canister-id> --format table/);
assert.match(opsHelp, /icpdb-identity\.mjs shard-top-up <database-canister-id> <cycles> --format table/);
assert.match(opsHelp, /icpdb-identity\.mjs operation <database-id> <operation-id> --format table/);
const shellHelp = commandUsage("shell");
assert.match(shellHelp, /Shell commands/);
assert.match(shellHelp, /\.principal/);
assert.match(shellHelp, /\.health/);
assert.match(shellHelp, /\.url/);
assert.match(shellHelp, /\.tables/);
assert.match(shellHelp, /\.views/);
assert.match(shellHelp, /\.schema \[table_name\]/);
assert.match(shellHelp, /\.columns <table_name>/);
assert.match(shellHelp, /\.indexes <table_name>/);
assert.match(shellHelp, /\.triggers <table_name>/);
assert.match(shellHelp, /\.foreign-keys <table_name>/);
assert.match(shellHelp, /\.status/);
assert.match(shellHelp, /\.load <file\|->/);
assert.match(shellHelp, /\.script <file\|->/);
assert.match(shellHelp, /\.migrate <file\|->/);
assert.match(shellHelp, /\.archive <file>/);
assert.match(shellHelp, /\.snapshot-info <file>/);
assert.match(shellHelp, /\.restore <file> \[expected_sha256\]/);
assert.match(shellHelp, /\.archive-cancel/);
assert.match(shellHelp, /\.grant-member <principal> <reader\|writer\|owner>/);
assert.match(shellHelp, /\.revoke-member <principal>/);
assert.match(shellHelp, /\.delete-db/);
assert.match(shellHelp, /single quotes, double quotes, and backslash escaping/);
assert.match(shellHelp, /Shell write SQL auto-generates an idempotency key/);
assert.match(identityShellUsage("sql"), /read-only PRAGMA/);
assert.match(identityShellUsage("sql"), /auto-generates an idempotency key/);
assert.match(identityShellUsage("sql"), /--idempotency-key before shell/);
assert.match(identityShellUsage(".sql"), /Other SQL statements run as writes/);
assert.match(commandUsage("shell sql"), /Other SQL statements run as writes/);
assert.match(commandUsage("shell .sql"), /--idempotency-key before shell/);
assert.match(identitySource, /function sqlFileBatchIdempotencyKey[\s\S]*if \(!command\.idempotencyKey\) return undefined;/);
assert.match(identitySource, /function migrationEnsureIdempotencyKey[\s\S]*: undefined;/);
assert.match(identitySource, /function migrationBatchIdempotencyKey[\s\S]*: undefined;/);
assert.ok((identitySource.match(/idempotencyKey: undefined/g) ?? []).length >= 2);
const shellCommandContext = { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 };
assert.deepEqual(identityShellLineCommand(".principal", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  principal: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".health", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  health: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".url", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  connectionUrl: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".tables", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  tables: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".views", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  tables: true,
  viewsOnly: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".status", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  databaseStatus: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".schema notes", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  schema: true,
  tableName: "notes",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".columns notes", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  tableColumns: true,
  tableName: "notes",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".indexes notes", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  tableIndexes: true,
  tableName: "notes",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".triggers notes", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  tableTriggers: true,
  tableName: "notes",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".foreign-keys notes", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  tableForeignKeys: true,
  tableName: "notes",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".preview notes 10 5", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 10,
  offset: 5,
  preview: true,
  tableName: "notes"
});
assert.throws(() => identityShellLineCommand(".preview notes 0", shellCommandContext), /limit must be an integer from 1 to 500/);
assert.throws(() => identityShellLineCommand(".preview notes 10 4294967296", shellCommandContext), /offset must be an integer from 0 to 4294967295/);
assert.deepEqual(identityShellLineCommand(".inspect notes 11 6", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 11,
  offset: 6,
  inspect: true,
  tableName: "notes"
});
assert.throws(() => identityShellLineCommand(".inspect notes 0", shellCommandContext), /limit must be an integer from 1 to 500/);
assert.throws(() => identityShellLineCommand(".inspect notes 10 4294967296", shellCommandContext), /offset must be an integer from 0 to 4294967295/);
const shellLoadCommand = identityShellLineCommand(".load /tmp/dump.sql", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 });
assert.equal(shellLoadCommand.load, true);
assert.equal(shellLoadCommand.filePath, "/tmp/dump.sql");
assert.match(shellLoadCommand.idempotencyKey, /^identity-shell-db_alpha-/);
assert.deepEqual({ ...shellLoadCommand, idempotencyKey: "generated" }, {
  load: true,
  filePath: "/tmp/dump.sql",
  idempotencyKey: "generated",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
const shellScriptCommand = identityShellLineCommand(".script /tmp/schema.sql", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0, idempotencyKey: "file-shell", waitForRoutedOperation: true });
assert.match(shellScriptCommand.idempotencyKey, /^file-shell-/);
assert.equal(shellScriptCommand.waitForRoutedOperation, true);
assert.deepEqual({ ...shellScriptCommand, idempotencyKey: "generated" }, {
  script: true,
  filePath: "/tmp/schema.sql",
  idempotencyKey: "generated",
  waitForRoutedOperation: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
const shellMigrateCommand = identityShellLineCommand(".migrate /tmp/migrations.json", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 });
assert.match(shellMigrateCommand.idempotencyKey, /^identity-shell-db_alpha-/);
assert.deepEqual({ ...shellMigrateCommand, idempotencyKey: "generated" }, {
  migrate: true,
  filePath: "/tmp/migrations.json",
  idempotencyKey: "generated",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".archive /tmp/db.sqlite", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  archive: true,
  filePath: "/tmp/db.sqlite",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".snapshot-info /tmp/db.sqlite", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  snapshotInfo: true,
  command: "snapshot-info",
  filePath: "/tmp/db.sqlite",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(`.restore /tmp/db.sqlite ${"AA".repeat(32)}`, { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  restore: true,
  filePath: "/tmp/db.sqlite",
  expectedSnapshotHash: "aa".repeat(32),
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".archive-cancel", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  archiveCancel: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".delete-db", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  deleteDatabase: true,
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".grant-member aaaaa-aa writer", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  grantMember: true,
  principalText: "aaaaa-aa",
  role: "writer",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.deepEqual(identityShellLineCommand(".revoke-member aaaaa-aa", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, limit: 25, offset: 0 }), {
  revokeMember: true,
  principalText: "aaaaa-aa",
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 25,
  offset: 0
});
assert.equal(identityShellLineCommand(`.restore /tmp/db.sqlite " ${"AA".repeat(32)} "`, shellCommandContext).expectedSnapshotHash, "aa".repeat(32));
assert.equal(identityShellLineCommand(".schema \"space table\"", shellCommandContext).tableName, "space table");
assert.equal(identityShellLineCommand(".dump 'space table'", shellCommandContext).tableName, "space table");
assert.equal(identityShellLineCommand(".columns 'space table'", shellCommandContext).tableName, "space table");
assert.deepEqual(identityShellLineCommand(".preview \"space table\" 10 5", shellCommandContext), {
  databaseId: "db_alpha",
  outputFormat: "table",
  maxRows: 100,
  limit: 10,
  offset: 5,
  preview: true,
  tableName: "space table"
});
assert.equal(identityShellLineCommand(".load \"/tmp/dump file.sql\"", shellCommandContext).filePath, "/tmp/dump file.sql");
assert.equal(identityShellLineCommand(`.restore "/tmp/db file.sqlite" ${"AA".repeat(32)}`, shellCommandContext).filePath, "/tmp/db file.sqlite");
assert.throws(() => identityShellLineCommand(".load", shellCommandContext), /.load file is required/);
assert.throws(() => identityShellLineCommand(".load '   '", shellCommandContext), /.load file is required/);
assert.throws(() => identityShellLineCommand(".script", shellCommandContext), /.script file is required/);
assert.throws(() => identityShellLineCommand(".script '   '", shellCommandContext), /.script file is required/);
assert.throws(() => identityShellLineCommand(".migrate", shellCommandContext), /.migrate file is required/);
assert.throws(() => identityShellLineCommand(".migrate '   '", shellCommandContext), /.migrate file is required/);
assert.throws(() => identityShellLineCommand(".archive", shellCommandContext), /.archive file is required/);
assert.throws(() => identityShellLineCommand(".archive '   '", shellCommandContext), /.archive file is required/);
assert.throws(() => identityShellLineCommand(".snapshot-info", shellCommandContext), /.snapshot-info file is required/);
assert.throws(() => identityShellLineCommand(".snapshot-info '   '", shellCommandContext), /.snapshot-info file is required/);
assert.throws(() => identityShellLineCommand(".restore", shellCommandContext), /.restore file is required/);
assert.throws(() => identityShellLineCommand(".restore '   '", shellCommandContext), /.restore file is required/);
assert.throws(() => identityShellLineCommand(".restore /tmp/db.sqlite '   '", shellCommandContext), /64-character SHA-256/);
assert.throws(() => identityShellLineCommand(".archive-cancel extra", shellCommandContext), /\.archive-cancel accepts at most 0 arguments/);
assert.throws(() => identityShellLineCommand(".delete-db extra", shellCommandContext), /\.delete-db accepts at most 0 arguments/);
assert.throws(() => identityShellLineCommand(".grant-member 2vxsx-fae reader", shellCommandContext), /anonymous principal cannot be granted database access/);
assert.throws(() => identityShellLineCommand(".grant-member", shellCommandContext), /principal is required/);
assert.throws(() => identityShellLineCommand(".grant-member not-principal reader", shellCommandContext), /database member principal must be a valid principal/);
assert.throws(() => identityShellLineCommand(".grant-member aaaaa-aa admin", shellCommandContext), /role must be reader, writer, or owner/);
assert.throws(() => identityShellLineCommand(".grant-member aaaaa-aa", shellCommandContext), /role is required/);
assert.throws(() => identityShellLineCommand(".grant-member aaaaa-aa writer extra", shellCommandContext), /\.grant-member accepts at most 2 arguments/);
assert.throws(() => identityShellLineCommand(".revoke-member '   '", shellCommandContext), /database member principal must be a non-empty string/);
assert.throws(() => identityShellLineCommand(".revoke-member not-principal", shellCommandContext), /database member principal must be a valid principal/);
assert.throws(() => identityShellLineCommand(".revoke-member", shellCommandContext), /principal is required/);
assert.throws(() => identityShellLineCommand(".revoke-member aaaaa-aa extra", shellCommandContext), /\.revoke-member accepts at most 1 argument/);
assert.equal(identityShellLineCommand(".operation \"op id\"", shellCommandContext).operationId, "op id");
assert.throws(() => identityShellLineCommand(".operation", shellCommandContext), /\.operation requires an argument/);
assert.throws(() => identityShellLineCommand(".operation '   '", shellCommandContext), /operation_id must be a non-empty string/);
assert.equal(identityShellLineCommand(".schema escaped\\ table", shellCommandContext).tableName, "escaped table");
assert.throws(() => identityShellLineCommand(".schema \"unterminated", shellCommandContext), /unterminated shell quote/);
assert.throws(() => identityShellLineCommand(".columns notes extra", shellCommandContext), /\.columns requires exactly one argument/);
assert.throws(() => identityShellLineCommand(".columns", shellCommandContext), /\.columns requires an argument/);
assert.throws(() => identityShellLineCommand(".describe", shellCommandContext), /\.describe requires an argument/);
assert.throws(() => identityShellLineCommand(".describe '   '", shellCommandContext), /table_name must be a non-empty string/);
assert.throws(() => identityShellLineCommand(".schema '   '", shellCommandContext), /table_name must be a non-empty string/);
assert.throws(() => identityShellLineCommand(".dump '   '", shellCommandContext), /table_name must be a non-empty string/);
assert.throws(() => identityShellLineCommand(".preview '   '", shellCommandContext), /table_name must be a non-empty string/);
assert.throws(() => identityShellLineCommand(".preview", shellCommandContext), /.preview table_name is required/);
assert.throws(() => identityShellLineCommand(".inspect '   '", shellCommandContext), /table_name must be a non-empty string/);
assert.throws(() => identityShellLineCommand(".restore /tmp/db.sqlite aa bb", shellCommandContext), /\.restore accepts at most 2 arguments/);
assert.equal(identityShellLineCommand("SELECT 1", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100 }).endpoint, "sql_query");
const shellWriteCommand = identityShellLineCommand("INSERT INTO notes(body) VALUES ('x')", { databaseId: "db_alpha", outputFormat: "table", maxRows: 100, idempotencyKey: "shell-key" });
assert.equal(shellWriteCommand.endpoint, "sql_execute");
assert.match(shellWriteCommand.idempotencyKey, /^shell-key-/);
assert.match(opsHelp, /icpdb-identity\.mjs shard-maintain 1 0 0 0 8 0 --format table/);
assert.match(opsHelp, /icpdb-identity\.mjs shard-migrate <database-id> <database-canister-id> --format table/);
assert.match(opsHelp, /icpdb-identity\.mjs shard-ops --format table/);
assert.match(opsHelp, /Use applied for verified success; use failed with a reason only after operator verification/);
assert.match(opsHelp, /icpdb-identity\.mjs shard-reconcile applied <operation-id>/);
assert.match(opsHelp, /icpdb-identity\.mjs shard-reconcile failed <operation-id> "operator verified failure"/);
assert.match(opsHelp, /icpdb-identity\.mjs operation <database-id> <operation-id> --format table/);
const sqlHelp = commandUsage("sql");
assert.match(sqlHelp, /sql \[database_id\] <sql>/);
assert.match(sqlHelp, /sql auto-routes read SQL to query and write SQL to execute/);
assert.match(sqlHelp, /sql supports --params <json>, --params-file <file>, and --format table\|json\|csv/);
assert.match(sqlHelp, /sql write commands support --idempotency-key <key> and --wait for routed writes/);
assert.match(sqlHelp, /icpdb-identity\.mjs sql <sql> \[--params <json>\] \[--format table\|json\|csv\]/);
assert.match(sqlHelp, /sql \[database_id\] <sql> \[--params-file <file>\] \[--idempotency-key <key>\] \[--wait\]/);
assert.doesNotMatch(sqlHelp, /provision-service-db/);
const queryHelp = commandUsage("query");
assert.match(queryHelp, /icpdb-identity\.mjs query <sql> \[--params <json>\] \[--format table\|json\|csv\]/);
assert.match(queryHelp, /query "SELECT \* FROM notes WHERE id = \?1" --params '\[1\]' --format csv/);
assert.match(queryHelp, /--identity-pem-file <file> query \[database_id\] <sql> \[--params-file <file>\]/);
const scalarHelp = commandUsage("scalar");
assert.match(scalarHelp, /icpdb-identity\.mjs scalar <sql> \[--params <json>\] \[--format table\|json\|csv\]/);
assert.match(scalarHelp, /scalar "SELECT count\(\*\) FROM notes" --format table/);
assert.match(scalarHelp, /--identity-pem-file <file> scalar \[database_id\] <sql> \[--params-file <file>\]/);
const executeHelp = commandUsage("execute");
assert.match(executeHelp, /icpdb-identity\.mjs execute <sql> \[--params <json>\] \[--idempotency-key <key>\] \[--wait\]/);
assert.match(executeHelp, /--identity-pem-file <file> execute \[database_id\] <sql> \[--idempotency-key <key>\] \[--wait\]/);
const provisionHelp = commandUsage("provision-service-db");
assert.match(provisionHelp, /provision-service-db <reader\|writer\|owner>/);
assert.match(provisionHelp, /--setup-file <file\|->/);
assert.match(provisionHelp, /--setup-migrations-file <file\|->/);
assert.doesNotMatch(provisionHelp, /query \[database_id\] <sql>/);
assert.match(commandUsage("snapshot-info"), /snapshot-info <file>/);
const archiveHelp = commandUsage("archive");
assert.match(archiveHelp, /icpdb-identity\.mjs archive <file>/);
assert.match(archiveHelp, /--identity-pem-file <file> archive \[database_id\] <file>/);
const restoreHelp = commandUsage("restore");
assert.match(restoreHelp, /restore writes into the selected DB/);
assert.match(restoreHelp, /restore non-destructive verification/);
assert.match(restoreHelp, /icpdb-identity\.mjs restore <file> \[--expect-snapshot-hash <sha256>\]/);
assert.match(restoreHelp, /--identity-pem-file <file> restore \[database_id\] <file> \[--expect-snapshot-hash <sha256>\]/);
const shardMaintainHelp = commandUsage("shard-maintain");
assert.match(shardMaintainHelp, /--env-file controller\.env shard-maintain <min_available_slots>/);
assert.match(shardMaintainHelp, /--identity-pem-file <file> shard-maintain <min_available_slots>/);
assert.match(commandUsage("shards"), /--env-file controller\.env shards --format table/);
const generateIdentityHelp = commandUsage("generate-identity");
assert.match(generateIdentityHelp, /dedicated Server\/CI private-key identity/);
assert.match(generateIdentityHelp, /browser\/II principals do not match it/);
assert.match(generateIdentityHelp, /grant the printed service principal in console Permissions/);
assert.match(generateIdentityHelp, /add the printed principal as an icpdb canister controller/);
assert.match(generateIdentityHelp, /stores a controller-ready canister target in the env file/);
assert.match(generateIdentityHelp, /--canister-id <id> --network-url https:\/\/icp-api\.io --env-out service.env generate-identity/);
assert.match(generateIdentityHelp, /--canister-id <id> --database-id <database-id> --network-url https:\/\/icp-api\.io --env-out service.env generate-identity/);
const inspectEnvHelp = commandUsage("inspect-env");
assert.match(inspectEnvHelp, /inspect-env is local-only/);
assert.match(inspectEnvHelp, /owner-only file mode/);
assert.match(inspectEnvHelp, /icpdb-identity\.mjs --canister-id <id> inspect-env --format table/);
assert.match(inspectEnvHelp, /ICPDB_ENV_FILE=controller\.env.*--canister-id <id> inspect-env --format table/);
const urlHelp = commandUsage("url");
assert.match(urlHelp, /reusable icpdb:\/\/<canister-id>\/<database-id> connection block without a canister call/);
assert.match(urlHelp, /local connection block printer\/merger for scripts that already know the database id/);
assert.match(urlHelp, /--canister-id <id> --env-out service\.env url <database-id>/);
const inspectHelp = commandUsage("inspect");
assert.match(inspectHelp, /inspect shows DB shape: placement, usage, table summaries, schema metadata, and preview rows/);
assert.match(inspectHelp, /inspect accepts \[table_name\] for focused table debug output and --format table\|json\|csv/);
assert.match(inspectHelp, /icpdb-identity\.mjs inspect \[table_name\] \[--format table\|json\|csv\]/);
const schemaHelp = commandUsage("schema");
assert.match(schemaHelp, /schema prints schema SQL for all objects or one table/);
assert.match(schemaHelp, /icpdb-identity\.mjs schema \[table_name\] \[--format table\|json\|csv\]/);
const tablesHelp = commandUsage("tables");
assert.match(tablesHelp, /tables lists table\/view objects/);
assert.match(tablesHelp, /icpdb-identity\.mjs tables \[--format table\|json\|csv\]/);
const viewsHelp = commandUsage("views");
assert.match(viewsHelp, /views lists view objects/);
assert.match(viewsHelp, /icpdb-identity\.mjs views \[--format table\|json\|csv\]/);
const statsHelp = commandUsage("stats");
assert.match(statsHelp, /stats summarizes table\/view counts, row counts, and schema object counts/);
assert.match(statsHelp, /icpdb-identity\.mjs stats \[--format table\|json\|csv\]/);
assert.throws(() => commandUsage("unknown-command"), /unknown help command/);
assert.equal((await loadServiceIdentity({
  identityJson: "",
  identityJsonFile: identityJsonFilePath,
  identityType: "auto"
})).getPrincipal().toText(), fileIdentity.getPrincipal().toText());
await assert.rejects(() => loadServiceIdentity({
  identityJson: "",
  identityJsonFile: openIdentityJsonFilePath,
  identityType: "auto"
}), /identity file must be owner-only/);
await assert.rejects(() => loadServiceIdentity({
  identityJson: "",
  identityJsonFile: emptyIdentityJsonFilePath,
  identityType: "auto"
}), /identity file must be a non-empty string/);
await assert.rejects(() => loadServiceIdentity({
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: identityJsonFilePath,
  identityType: "auto"
}), /identity must use exactly one secret source: identityJson, identityJsonFile/);

assert.deepEqual(parseIdentityCliArgs(["principal"], env), {
  principal: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  databaseId: "",
  networkUrl: "http://localhost:8001",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  serviceIdentityPem: "",
  serviceIdentityPemFile: "",
  serviceIdentityJson: "",
  serviceIdentityJsonFile: "",
  serviceIdentityType: "auto",
  rootKey: "aabbcc",
  params: [],
  paramsFilePath: "",
  statements: [],
  statementsFilePath: "",
  batchMode: "write",
  setupFilePath: "",
  setupMigrationsFilePath: "",
  maxRows: 100,
  limit: 100,
  offset: 0,
  outputFormat: "json"
});
assert.equal(parseIdentityCliArgs(["generate-identity"], env).generateIdentity, true);
assert.throws(() => parseIdentityCliArgs(["generate-identity", "extra"], env), /generate-identity accepts no positional arguments/);
assert.throws(() => parseIdentityCliArgs(["principal", "extra"], env), /principal accepts no positional arguments/);
assert.equal(parseIdentityCliArgs(["query", "SELECT 1"], envWithUrl).canisterId, "ryjl3-tyaaa-aaaaa-aaaba-cai");
assert.equal(parseIdentityCliArgs(["query", "SELECT 1"], envWithUrl).databaseId, "db_url");
assert.match(usage(), /ICPDB_ENV_FILE/);
assert.match(usage(), /columns \[database_id\] <table_name>/);
assert.match(usage(), /indexes \[database_id\] <table_name>/);
assert.match(usage(), /triggers \[database_id\] <table_name>/);
assert.match(usage(), /foreign-keys \[database_id\] <table_name>/);
assert.deepEqual(parseIdentityCliArgs(["url"], envWithUrl), {
  command: "url",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  outputFormat: "json",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  rootKey: "aabbcc",
  connectionUrl: true,
  databaseId: "db_url"
});
assert.equal(parseIdentityCliArgs(["--format", "env", "url", "db_arg"], env).outputFormat, "env");
assert.equal(parseIdentityCliArgs(["--url", "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_flag", "query", "SELECT 1"], env).databaseId, "db_flag");
assert.equal(parseIdentityCliArgs(["--url", "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai", "create-db"], env).canisterId, "ryjl3-tyaaa-aaaaa-aaaba-cai");
assert.equal(parseIdentityCliArgs(["shell", "db_alpha"], env).shell, true);
assert.equal(parseIdentityCliArgs(["shell", "db_alpha"], env).databaseId, "db_alpha");
assert.equal(parseIdentityCliArgs(["shell", "db_alpha", ".tables"], env).shellSql, ".tables");
assert.equal(parseIdentityCliArgs(["shell", "SELECT 1"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["shell", "SELECT 1"], envWithDatabase).shellSql, "SELECT 1");
assert.equal(parseIdentityCliArgs(["shell", ".schema notes"], envWithDatabase).shellSql, ".schema notes");
assert.throws(() => parseIdentityCliArgs(["--url", "https://example.com/db", "query", "SELECT 1"], env), /ICPDB url must use icpdb:\/\//);
assert.throws(() => parseIdentityCliArgs(["--url", "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai:123/db_flag", "query", "SELECT 1"], env), /must not include a port/);
assert.throws(() => parseIdentityCliArgs(["--url", "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db%ZZ", "query", "SELECT 1"], env), /database id encoding/);
assert.throws(() => parseIdentityCliArgs(["--url", "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai//db_flag", "query", "SELECT 1"], env), /path must be/);
assert.equal(parseIdentityCliArgs(["--identity-type", "secp256k1", "generate-identity"], env).identityType, "secp256k1");
assert.equal(parseIdentityCliArgs(["--format", "env", "generate-identity"], env).outputFormat, "env");
assert.equal(parseIdentityCliArgs(["--format", "csv", "query", "SELECT 1"], envWithDatabase).outputFormat, "csv");
assert.throws(() => parseIdentityCliArgs(["--format", "dotenv", "generate-identity"], env), /format must be json, table, csv, or env/);
assert.equal(parseIdentityCliArgs(["--format", "env", "create-db"], env).outputFormat, "env");
assert.throws(() => parseIdentityCliArgs(["create-db", "extra"], env), /create-db accepts no positional arguments/);
assert.throws(() => parseIdentityCliArgs(["--env-out", "service.env", "query", "db_alpha", "SELECT 1"], env), /--format env and --env-out are only valid/);
assert.throws(() => parseIdentityCliArgs(["--format", "env", "members", "db_alpha"], env), /--format env and --env-out are only valid/);
assert.throws(() => parseIdentityCliArgs(["--env-out", "   ", "generate-identity"], env), /env output file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["--env-file", "   ", "principal"], {}), /env file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["principal"], { ICPDB_ENV_FILE: "   " }), /env file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["--identity-json-file", "   ", "principal"], env), /identity file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["--service-identity-json-file", "   ", "provision-service", "db_alpha", "writer"], env), /service identity file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["--database-id", "db_existing", "create-db"], env), /create-db creates a new database/);
assert.throws(() => parseIdentityCliArgs(["--url", "icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_existing", "create-db"], env), /omit database id/);
assert.throws(() => parseIdentityCliArgs(["create-db"], envWithDatabase), /ICPDB_DATABASE_ID/);
assert.throws(() => parseIdentityCliArgs(["create-db"], envWithUrl), /ICPDB_URL/);
assert.deepEqual(parseIdentityCliArgs(["create-db", "--statement", "CREATE TABLE setup(id INTEGER)"], env).statements, [
  { sql: "CREATE TABLE setup(id INTEGER)", params: [] }
]);
assert.equal(parseIdentityCliArgs(["create-db", "--statements-file", statementsFilePath], env).statementsFilePath, statementsFilePath);
assert.throws(() => parseIdentityCliArgs(["create-db", "--statements-file", "   "], env), /statements file must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["create-db", "--setup-file", "/tmp/schema.sql"], env).setupFilePath, "/tmp/schema.sql");
assert.throws(() => parseIdentityCliArgs(["create-db", "--setup-file", "   "], env), /setup file must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["create-db", "--setup-migrations-file", "/tmp/migrations.json"], env).setupMigrationsFilePath, "/tmp/migrations.json");
assert.throws(() => parseIdentityCliArgs(["create-db", "--setup-migrations-file", "   "], env), /setup migrations file must be a non-empty string/);
assert.deepEqual(parseIdentityCliArgs(["--env-out", "service.env", "generate-identity"], env), {
  generateIdentity: true,
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  databaseId: "",
  networkUrl: "http://localhost:8001",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  serviceIdentityPem: "",
  serviceIdentityPemFile: "",
  serviceIdentityJson: "",
  serviceIdentityJsonFile: "",
  serviceIdentityType: "auto",
  rootKey: "aabbcc",
  params: [],
  paramsFilePath: "",
  statements: [],
  statementsFilePath: "",
  batchMode: "write",
  setupFilePath: "",
  setupMigrationsFilePath: "",
  maxRows: 100,
  limit: 100,
  offset: 0,
  outputFormat: "env",
  envOutFile: "service.env"
});

assert.deepEqual(parseIdentityCliArgs(["query", "db_alpha", "SELECT", "1", "--params", "[1,\"x\"]", "--max-rows", "3"], env), {
  command: "query",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  outputFormat: "json",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  rootKey: "aabbcc",
  endpoint: "sql_query",
  databaseId: "db_alpha",
  sql: "SELECT 1",
  params: [1, "x"],
  paramsFilePath: "",
  maxRows: 3
});
assert.deepEqual(parseIdentityCliArgs(["query", "SELECT", "1", "--params", "[1,\"x\"]", "--max-rows", "3"], envWithDatabase), {
  command: "query",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  outputFormat: "json",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  rootKey: "aabbcc",
  endpoint: "sql_query",
  databaseId: "db_env",
  sql: "SELECT 1",
  params: [1, "x"],
  paramsFilePath: "",
  maxRows: 3
});
assert.deepEqual(parseIdentityCliArgs(["query", "SELECT", ":body", "--params", "{\"body\":\"hello\",\"enabled\":true}"], envWithDatabase).params, {
  body: "hello",
  enabled: true
});
assert.deepEqual(parseIdentityCliArgs(["query", "SELECT", ":body", "--params-file", paramsFilePath], envWithDatabase).params, {
  body: "from-file",
  enabled: true
});
assert.equal(parseIdentityCliArgs(["query", "SELECT", ":body", "--params-file", paramsFilePath], envWithDatabase).paramsFilePath, paramsFilePath);
assert.deepEqual(parseIdentityCliArgs(["scalar", "SELECT", "count(*)", "--params", "[1]", "--max-rows", "7"], envWithDatabase), {
  command: "scalar",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  outputFormat: "json",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  rootKey: "aabbcc",
  endpoint: "sql_query",
  scalar: true,
  databaseId: "db_env",
  sql: "SELECT count(*)",
  params: [1],
  paramsFilePath: "",
  maxRows: 1
});
assert.throws(() => parseIdentityCliArgs(["query", "SELECT 1", "--params-file", "   "], envWithDatabase), /params file must be a non-empty string/);
assert.deepEqual(parseIdentityCliArgs(["--params", "[1]", "sql", "--", "-- leading comment\nSELECT 1"], envWithDatabase), {
  command: "sql",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  outputFormat: "json",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  rootKey: "aabbcc",
  endpoint: "sql_query",
  databaseId: "db_env",
  sql: "-- leading comment\nSELECT 1",
  params: [1],
  paramsFilePath: "",
  maxRows: 100
});
assert.equal(parseIdentityCliArgs(["sql", "/* setup */ INSERT INTO notes(body) VALUES ('x')"], envWithDatabase).endpoint, "sql_execute");
assert.equal(parseIdentityCliArgs(["sql", "--", "-- comment\nSELECT 1"], envWithDatabase).endpoint, "sql_query");
assert.equal(parseIdentityCliArgs(["sql", "db_alpha", "WITH payload(value) AS (SELECT 1) SELECT value FROM payload"], env).endpoint, "sql_query");
assert.equal(parseIdentityCliArgs(["sql", "db_alpha", "WITH payload(value) AS (SELECT 1) INSERT INTO notes(id) SELECT value FROM payload"], env).endpoint, "sql_execute");
assert.equal(parseIdentityCliArgs(["sql", "db_alpha", "PRAGMA table_info(notes)"], env).endpoint, "sql_query");
assert.equal(parseIdentityCliArgs(["sql", "db_alpha", "PRAGMA foreign_keys=off"], env).endpoint, "sql_execute");
assert.equal(parseIdentityCliArgs(["sql", "db_alpha", "PRAGMA main.user_version = 7"], env).endpoint, "sql_execute");
assert.equal(parseIdentityCliArgs(["--database-id", "db_flag", "execute", "INSERT"], env).databaseId, "db_flag");
assert.equal(parseIdentityCliArgs(["execute", "db_alpha", "INSERT", "--idempotency-key", "cli_retry_1"], env).idempotencyKey, "cli_retry_1");
assert.equal(parseIdentityCliArgs(["sql", "db_alpha", "INSERT", "--idempotency-key", "cli_retry_2"], env).idempotencyKey, "cli_retry_2");
assert.equal(parseIdentityCliArgs(["batch", "db_alpha", "--statement", "INSERT", "--idempotency-key", "cli_retry_batch"], env).idempotencyKey, "cli_retry_batch");
assert.throws(() => parseIdentityCliArgs(["execute", "db_alpha", "INSERT", "--idempotency-key", "   "], env), /idempotency_key must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["scalar", "db_alpha", "SELECT 1", "--idempotency-key", "cli_retry_read"], env), /idempotency-key is only valid for write SQL/);
assert.throws(() => parseIdentityCliArgs(["scalar", "db_alpha", "SELECT 1", "--wait"], env), /--wait is only valid for write SQL/);
assert.equal(parseIdentityCliArgs(["batch", "db_alpha", "--mode", "read", "--statement", "SELECT 1"], env).endpoint, "sql_batch_read");
assert.equal(parseIdentityCliArgs(["transaction", "db_alpha", "--mode", "read", "--statement", "WITH payload(value) AS (SELECT 1) SELECT value FROM payload"], env).endpoint, "sql_batch_read");
assert.equal(parseIdentityCliArgs(["load", "db_alpha", "/tmp/read.sql", "--mode", "read"], env).batchMode, "read");
assert.equal(parseIdentityCliArgs(["script", "db_alpha", "/tmp/read.sql", "--mode", "read"], env).batchMode, "read");
assert.throws(() => parseIdentityCliArgs(["batch", "db_alpha", "--mode", "read", "--statement", "INSERT"], env), /read batch statement 1 is not read-only/);
assert.throws(() => parseIdentityCliArgs(["batch", "db_alpha", "--mode", "read", "--statement", "PRAGMA foreign_keys=off"], env), /read batch statement 1 is not read-only/);
assert.throws(() => parseIdentityCliArgs(["batch", "db_alpha", "--mode", "readonly", "--statement", "SELECT 1"], env), /mode must be read or write/);
assert.throws(() => parseIdentityCliArgs(["batch", "db_alpha", "--mode", "read", "--statement", "SELECT 1", "--idempotency-key", "cli_retry_read_batch"], env), /idempotency-key is only valid for write batch/);
assert.throws(() => parseIdentityCliArgs(["batch", "db_alpha", "--mode", "read", "--statement", "SELECT 1", "--wait"], env), /wait is only valid for write batch/);
assert.throws(() => parseIdentityCliArgs(["load", "db_alpha", "/tmp/read.sql", "--mode", "read", "--idempotency-key", "load_read"], env), /idempotency-key is only valid for write load/);
assert.throws(() => parseIdentityCliArgs(["load", "db_alpha", "/tmp/read.sql", "--mode", "read", "--wait"], env), /wait is only valid for write load/);
assert.throws(() => parseIdentityCliArgs(["script", "db_alpha", "/tmp/read.sql", "--mode", "read", "--idempotency-key", "script_read"], env), /idempotency-key is only valid for write script/);
assert.throws(() => parseIdentityCliArgs(["script", "db_alpha", "/tmp/read.sql", "--mode", "read", "--wait"], env), /wait is only valid for write script/);
assert.equal(parseIdentityCliArgs(["execute", "db_alpha", "INSERT", "--wait"], env).waitForRoutedOperation, true);
assert.equal(parseIdentityCliArgs(["batch", "db_alpha", "--statement", "INSERT", "--wait"], env).waitForRoutedOperation, true);
assert.deepEqual(parseIdentityCliArgs(["transaction", "db_alpha", "--statement", "INSERT", "--idempotency-key", "cli_retry_transaction", "--wait"], env), {
  command: "transaction",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  outputFormat: "json",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  rootKey: "aabbcc",
  endpoint: "sql_batch",
  transaction: true,
  databaseId: "db_alpha",
  statements: [{ sql: "INSERT", params: [] }],
  statementsFilePath: "",
  batchMode: "write",
  maxRows: 100,
  idempotencyKey: "cli_retry_transaction",
  waitForRoutedOperation: true
});
assert.throws(() => parseIdentityCliArgs(["query", "db_alpha", "SELECT 1", "--idempotency-key", "cli_retry_read"], env), /idempotency-key is only valid for write SQL/);
assert.throws(() => parseIdentityCliArgs(["sql", "db_alpha", "SELECT 1", "--idempotency-key", "cli_retry_read"], env), /idempotency-key is only valid for write SQL/);
assert.throws(() => parseIdentityCliArgs(["sql", "db_alpha", "PRAGMA table_info(notes)", "--idempotency-key", "cli_retry_read"], env), /idempotency-key is only valid for write SQL/);
assert.equal(parseIdentityCliArgs(["sql", "db_alpha", "PRAGMA foreign_keys=off", "--idempotency-key", "cli_retry_pragma"], env).idempotencyKey, "cli_retry_pragma");
assert.throws(() => parseIdentityCliArgs(["query", "db_alpha", "SELECT 1", "--wait"], env), /wait is only valid for write SQL/);
assert.throws(() => parseIdentityCliArgs(["sql", "db_alpha", "SELECT 1", "--wait"], env), /wait is only valid for write SQL/);
assert.equal(parseIdentityCliArgs(["inspect", "db_alpha"], env).inspect, true);
assert.equal(parseIdentityCliArgs(["inspect", "db_alpha", "notes"], env).tableName, "notes");
assert.equal(parseIdentityCliArgs(["inspect", "notes"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["inspect", "notes", "--limit", "2", "--offset", "1"], envWithDatabase).limit, 2);
assert.throws(() => parseIdentityCliArgs(["inspect", "notes", "--limit", "0"], envWithDatabase), /limit must be an integer from 1 to 500/);
assert.throws(() => parseIdentityCliArgs(["inspect", "notes", "--limit", "501"], envWithDatabase), /limit must be an integer from 1 to 500/);
assert.throws(() => parseIdentityCliArgs(["inspect", "notes", "--offset", "4294967296"], envWithDatabase), /offset must be an integer from 0 to 4294967295/);
assert.throws(() => parseIdentityCliArgs(["query", "db_alpha", "SELECT 1", "--max-rows", "0"], env), /max-rows must be an integer from 1 to 500/);
assert.throws(() => parseIdentityCliArgs(["query", "db_alpha", "SELECT 1", "--max-rows", "501"], env), /max-rows must be an integer from 1 to 500/);

assert.deepEqual(parseIdentityCliArgs(["grant-member", "db_alpha", "aaaaa-aa", "writer"], env).role, "writer");
assert.equal(parseIdentityCliArgs(["grant-member", "aaaaa-aa", "writer"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["grant-member", "aaaaa-aa", "writer", "extra"], envWithDatabase), /grant-member accepts at most 2 positional arguments/);
assert.throws(() => parseIdentityCliArgs(["grant-member", "db_alpha", "2vxsx-fae", "reader"], env), /anonymous principal cannot be granted database access/);
assert.throws(() => parseIdentityCliArgs(["grant-member", "2vxsx-fae", "reader"], envWithDatabase), /anonymous principal cannot be granted database access/);
assert.throws(() => parseIdentityCliArgs(["grant-member", "db_alpha", "   ", "reader"], env), /database member principal must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["grant-member", "   ", "reader"], envWithDatabase), /database member principal must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["grant-member", "db_alpha", "not-principal", "reader"], env), /database member principal must be a valid principal/);
assert.throws(() => parseIdentityCliArgs(["grant-member", "not-principal", "reader"], envWithDatabase), /database member principal must be a valid principal/);
assert.throws(() => parseIdentityCliArgs(["revoke-member", "db_alpha", "   "], env), /database member principal must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["revoke-member", "   "], envWithDatabase), /database member principal must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["revoke-member", "db_alpha", "not-principal"], env), /database member principal must be a valid principal/);
assert.throws(() => parseIdentityCliArgs(["revoke-member", "not-principal"], envWithDatabase), /database member principal must be a valid principal/);
assert.deepEqual(parseIdentityCliArgs(["grant-service", "db_alpha", "writer"], serviceEnv).role, "writer");
assert.equal(parseIdentityCliArgs(["grant-service", "writer"], { ...serviceEnv, ICPDB_DATABASE_ID: "db_env" }).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["grant-service", "writer", "extra"], { ...serviceEnv, ICPDB_DATABASE_ID: "db_env" }), /grant-service accepts at most 1 positional argument/);
assert.equal(parseIdentityCliArgs(["grant-service", "db_alpha", "writer"], serviceEnv).grantService, true);
assert.equal(parseIdentityCliArgs(["--service-identity-type", "secp256k1", "provision-service", "db_alpha", "writer"], env).serviceIdentityType, "secp256k1");
assert.equal(parseIdentityCliArgs(["--service-identity-type", "secp256k1", "provision-service", "writer"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["provision-service", "db_alpha", "writer"], env).provisionService, true);
assert.equal(parseIdentityCliArgs(["--service-identity-type", "secp256k1", "provision-service-db", "writer"], env).serviceIdentityType, "secp256k1");
assert.equal(parseIdentityCliArgs(["provision-service-db", "writer"], env).provisionServiceDatabase, true);
assert.throws(() => parseIdentityCliArgs(["--database-id", "db_existing", "provision-service-db", "writer"], env), /provision-service-db creates a new database/);
assert.throws(() => parseIdentityCliArgs(["--url", "icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_existing", "provision-service-db", "writer"], env), /omit database id/);
assert.throws(() => parseIdentityCliArgs(["provision-service-db", "writer"], envWithDatabase), /ICPDB_DATABASE_ID/);
assert.throws(() => parseIdentityCliArgs(["provision-service-db", "writer"], envWithUrl), /ICPDB_URL/);
assert.deepEqual(parseIdentityCliArgs(["provision-service-db", "writer", "--statement", "CREATE TABLE setup(id INTEGER)"], env).statements, [
  { sql: "CREATE TABLE setup(id INTEGER)", params: [] }
]);
assert.equal(parseIdentityCliArgs(["provision-service-db", "writer", "--statements-file", statementsFilePath], env).statementsFilePath, statementsFilePath);
assert.equal(parseIdentityCliArgs(["provision-service-db", "writer", "--setup-file", "/tmp/schema.sql"], env).setupFilePath, "/tmp/schema.sql");
assert.equal(parseIdentityCliArgs(["provision-service-db", "writer", "--setup-migrations-file", "/tmp/migrations.json"], env).setupMigrationsFilePath, "/tmp/migrations.json");
assert.equal(parseIdentityCliArgs(["--root-key", "0011", "principal"], env).rootKey, "0011");
assert.deepEqual(parseIdentityCliArgs(["batch", "db_alpha", "--statement", "CREATE TABLE notes(id INTEGER)"], env).statements, [
  { sql: "CREATE TABLE notes(id INTEGER)", params: [] }
]);
assert.equal(parseIdentityCliArgs(["batch", "--statement", "CREATE TABLE notes(id INTEGER)"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["batch", "[{\"sql\":\"SELECT 1\",\"params\":[]}]"], envWithDatabase).databaseId, "db_env");
assert.deepEqual(parseIdentityCliArgs(["batch", "[{\"sql\":\"SELECT :body\",\"params\":{\"body\":\"hello\"}}]"], envWithDatabase).statements[0].params, { body: "hello" });
assert.deepEqual(parseIdentityCliArgs(["batch", "--statements-file", statementsFilePath], envWithDatabase).statements[0].params, { body: "from-statements-file" });
assert.equal(parseIdentityCliArgs(["batch", "--statements-file", statementsFilePath], envWithDatabase).statementsFilePath, statementsFilePath);
assert.equal(parseIdentityCliArgs(["transaction", "--statements-file", statementsFilePath], envWithDatabase).transaction, true);
assert.deepEqual(parseIdentityCliArgs(["transaction", "--statements-file", statementsFilePath], envWithDatabase).statements[0].params, { body: "from-statements-file" });
assert.deepEqual(parseIdentityCliArgs(["archive", "db_alpha", "/tmp/db.sqlite"], env).filePath, "/tmp/db.sqlite");
assert.equal(parseIdentityCliArgs(["archive", "/tmp/db.sqlite"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["archive", "/tmp/db.sqlite", "extra"], envWithDatabase), /archive accepts at most 1 positional argument/);
assert.throws(() => parseIdentityCliArgs(["archive", "db_alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["archive", "   "], envWithDatabase), /file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["archive", "db_alpha", "/tmp/db.sqlite", "extra"], env), /archive accepts at most 2 positional arguments/);
assert.equal(parseIdentityCliArgs(["restore", "db_alpha", "/tmp/db.sqlite"], env).restore, true);
assert.equal(parseIdentityCliArgs(["restore", "/tmp/db.sqlite"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["restore", "/tmp/db.sqlite", "extra"], envWithDatabase), /restore accepts at most 1 positional argument/);
assert.equal(parseIdentityCliArgs(["restore", "db_alpha", "/tmp/db.sqlite", "--expect-snapshot-hash", "AA".repeat(32)], env).expectedSnapshotHash, "aa".repeat(32));
assert.equal(parseIdentityCliArgs(["restore", "db_alpha", "/tmp/db.sqlite", "--expect-snapshot-hash", ` ${"AA".repeat(32)} `], env).expectedSnapshotHash, "aa".repeat(32));
assert.throws(() => parseIdentityCliArgs(["restore", "db_alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["restore", "   "], envWithDatabase), /file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["restore", "db_alpha", "/tmp/db.sqlite", "extra"], env), /restore accepts at most 2 positional arguments/);
assert.throws(() => parseIdentityCliArgs(["restore", "db_alpha", "/tmp/db.sqlite", "--expect-snapshot-hash", "abc"], env), /64-character SHA-256/);
assert.throws(() => parseIdentityCliArgs(["restore", "db_alpha", "/tmp/db.sqlite", "--expect-snapshot-hash", "   "], env), /64-character SHA-256/);
assert.throws(() => parseIdentityCliArgs(["archive", "db_alpha", "/tmp/db.sqlite", "--expect-snapshot-hash", "aa".repeat(32)], env), /only valid for restore/);
assert.throws(() => parseIdentityCliArgs(["snapshot-info", "   "], {}), /file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["snapshot-info", snapshotInfoPath, "extra"], {}), /snapshot-info accepts at most 1 positional argument/);
assert.deepEqual(parseIdentityCliArgs(["snapshot-info", snapshotInfoPath], {}), {
  snapshotInfo: true,
  command: "snapshot-info",
  outputFormat: "json",
  filePath: snapshotInfoPath
});
assert.deepEqual(parseIdentityCliArgs(["--format", "env", "snapshot-info", snapshotInfoPath], {}), {
  snapshotInfo: true,
  command: "snapshot-info",
  outputFormat: "env",
  filePath: snapshotInfoPath
});
assert.throws(() => parseIdentityCliArgs(["--env-out", "/tmp/snapshot.env", "snapshot-info", snapshotInfoPath], {}), /--format env and --env-out are only valid/);
assert.equal(parseIdentityCliArgs(["--format", "table", "snapshot-info", snapshotInfoPath], {}).outputFormat, "table");
assert.equal(parseIdentityCliArgs(["archive-cancel", "db_alpha"], env).archiveCancel, true);
assert.equal(parseIdentityCliArgs(["archive-cancel"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["archive-cancel", "extra"], envWithDatabase), /archive-cancel accepts no positional arguments/);
assert.throws(() => parseIdentityCliArgs(["archive-cancel", "db_alpha", "extra"], env), /archive-cancel accepts at most 1 positional argument/);
assert.deepEqual(parseIdentityCliArgs(["schema", "db_alpha", "notes"], env).tableName, "notes");
assert.deepEqual(parseIdentityCliArgs(["schema"], envWithDatabase).tableName, null);
assert.deepEqual(parseIdentityCliArgs(["schema", "notes"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["schema", "notes", "extra"], envWithDatabase), /schema accepts at most 1 positional argument/);
assert.throws(() => parseIdentityCliArgs(["schema", "   ", "notes"], env), /database_id must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["schema", "db_alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["schema", "   "], envWithDatabase), /table_name must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["schema", "db_alpha", "notes", "extra"], env), /schema accepts at most 2 positional arguments/);
assert.equal(parseIdentityCliArgs(["status", "db_alpha"], env).databaseStatus, true);
assert.equal(parseIdentityCliArgs(["status"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["status", "extra"], envWithDatabase), /status accepts no positional arguments/);
assert.throws(() => parseIdentityCliArgs(["status", "   "], env), /database_id must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["stats", "db_alpha"], env).stats, true);
assert.equal(parseIdentityCliArgs(["stats"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["views", "db_alpha"], env).viewsOnly, true);
assert.equal(parseIdentityCliArgs(["views"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["dump", "db_alpha"], env).dump, true);
assert.deepEqual(parseIdentityCliArgs(["dump", "db_alpha", "notes"], env).tableName, "notes");
assert.deepEqual(parseIdentityCliArgs(["dump"], envWithDatabase).databaseId, "db_env");
assert.deepEqual(parseIdentityCliArgs(["dump", "notes"], envWithDatabase).tableName, "notes");
assert.throws(() => parseIdentityCliArgs(["dump", "db_alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["dump", "   "], envWithDatabase), /table_name must be a non-empty string/);
assert.deepEqual(parseIdentityCliArgs(["load", "db_alpha", "/tmp/dump.sql"], env).filePath, "/tmp/dump.sql");
assert.deepEqual(parseIdentityCliArgs(["load", "db_alpha", "-"], env).filePath, "-");
assert.deepEqual(parseIdentityCliArgs(["load", "/tmp/dump.sql"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["load", "db_alpha", "/tmp/dump.sql", "--idempotency-key", "load_retry", "--wait"], env).idempotencyKey, "load_retry");
assert.equal(parseIdentityCliArgs(["load", "db_alpha", "/tmp/dump.sql", "--idempotency-key", "load_retry", "--wait"], env).waitForRoutedOperation, true);
assert.throws(() => parseIdentityCliArgs(["load", "db_alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["load", "   "], envWithDatabase), /file must be a non-empty string/);
assert.deepEqual(parseIdentityCliArgs(["script", "db_alpha", "/tmp/setup.sql"], env).filePath, "/tmp/setup.sql");
assert.deepEqual(parseIdentityCliArgs(["script", "/tmp/setup.sql"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["script", "db_alpha", "/tmp/setup.sql", "--idempotency-key", "script_retry", "--wait"], env).idempotencyKey, "script_retry");
assert.equal(parseIdentityCliArgs(["script", "db_alpha", "/tmp/setup.sql", "--idempotency-key", "script_retry", "--wait"], env).waitForRoutedOperation, true);
assert.throws(() => parseIdentityCliArgs(["script", "db_alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["script", "   "], envWithDatabase), /file must be a non-empty string/);
assert.deepEqual(parseIdentityCliArgs(["migrate", "db_alpha", "/tmp/migrations.json"], env).filePath, "/tmp/migrations.json");
assert.deepEqual(parseIdentityCliArgs(["migrate", "/tmp/migrations.json"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["migrate", "db_alpha", "/tmp/migrations.json", "--idempotency-key", "migrate_retry", "--wait"], env).idempotencyKey, "migrate_retry");
assert.equal(parseIdentityCliArgs(["migrate", "db_alpha", "/tmp/migrations.json", "--idempotency-key", "migrate_retry", "--wait"], env).waitForRoutedOperation, true);
assert.throws(() => parseIdentityCliArgs(["migrate", "db_alpha", "   "], env), /file must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["migrate", "   "], envWithDatabase), /file must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["delete-db", "db_alpha"], env).deleteDatabase, true);
assert.equal(parseIdentityCliArgs(["delete-db"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["delete-db", "db_alpha", "extra"], env), /delete-db accepts at most 1 positional argument/);
assert.equal(parseIdentityCliArgs(["usage", "db_alpha"], env).usage, true);
assert.equal(parseIdentityCliArgs(["usage"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["usage-events", "db_alpha"], env).usageEvents, true);
assert.equal(parseIdentityCliArgs(["usage-events"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["placement", "db_alpha"], env).placement, true);
assert.equal(parseIdentityCliArgs(["placement"], envWithDatabase).databaseId, "db_env");
assert.equal(parseIdentityCliArgs(["placements"], env).placements, true);
assert.equal(parseIdentityCliArgs(["all-placements"], env).allPlacements, true);
assert.equal(parseIdentityCliArgs(["health"], env).health, true);
assert.equal(parseIdentityCliArgs(["shards"], env).shards, true);
assert.equal(parseIdentityCliArgs(["shard-status", "rrkah-fqaaa-aaaaa-aaaaq-cai"], env).databaseCanisterId, "rrkah-fqaaa-aaaaa-aaaaq-cai");
assert.throws(() => parseIdentityCliArgs(["shard-status", "   "], env), /database_canister_id must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["shard-top-up", "rrkah-fqaaa-aaaaa-aaaaq-cai", "10000000000000000"], env).cycles, 10000000000000000n);
assert.throws(() => parseIdentityCliArgs(["shard-top-up", "   ", "10000000000000000"], env), /database_canister_id must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["shard-maintain", "2", "1000", "2000", "1", "64", "3000"], env).minAvailableSlots, 2n);
assert.equal(parseIdentityCliArgs(["shard-maintain", "2", "1000", "2000", "1", "64", "3000"], env).maxNewShards, 1);
assert.equal(parseIdentityCliArgs(["shard-migrate", "db_alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai"], env).shardMigrate, true);
assert.throws(() => parseIdentityCliArgs(["shard-migrate", "   ", "rrkah-fqaaa-aaaaa-aaaaq-cai"], env), /database_id must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["shard-migrate", "db_alpha", "   "], env), /database_canister_id must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["shard-ops"], env).shardOperations, true);
assert.equal(parseIdentityCliArgs(["shard-reconcile", "applied", "op_1"], env).status, "applied");
assert.equal(parseIdentityCliArgs(["shard-reconcile", "failed", "op_1", "remote failed"], env).error, "remote failed");
assert.equal(parseIdentityCliArgs(["shard-reconcile", "failed", "op_1", "remote", "failed"], env).error, "remote failed");
assert.throws(() => parseIdentityCliArgs(["shard-reconcile", "applied", "   "], env), /operation_id must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["shard-reconcile", "failed", "op_1"], env), /missing failure_reason/);
assert.throws(() => parseIdentityCliArgs(["shard-reconcile", "applied", "op_1", "remote", "failed"], env), /failure_reason is only valid/);
assert.equal(parseIdentityCliArgs(["operation", "db_alpha", "op_1"], env).operation, true);
assert.equal(parseIdentityCliArgs(["operation-reconcile", "db_alpha", "op_1"], env).operationReconcile, true);
assert.throws(() => parseIdentityCliArgs(["operation", "db_alpha", "   "], env), /operation_id must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["operation-reconcile", "db_alpha", "   "], env), /operation_id must be a non-empty string/);
assert.deepEqual(parseIdentityCliArgs(["operation", "op_env"], envWithDatabase), {
  command: "operation",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  outputFormat: "json",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  rootKey: "aabbcc",
  operation: true,
  databaseId: "db_env",
  operationId: "op_env"
});
assert.throws(() => parseIdentityCliArgs(["operation", "op_env", "extra"], envWithDatabase), /operation accepts at most 1 positional argument/);
assert.deepEqual(parseIdentityCliArgs(["operation-reconcile", "op_env"], envWithDatabase), {
  command: "operation-reconcile",
  canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  networkUrl: "http://localhost:8001",
  outputFormat: "json",
  identityPem: "",
  identityPemFile: "",
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityJsonFile: "",
  identityType: "auto",
  rootKey: "aabbcc",
  operationReconcile: true,
  databaseId: "db_env",
  operationId: "op_env"
});
assert.throws(() => parseIdentityCliArgs(["operation", "   "], envWithDatabase), /operation_id must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["operation-reconcile", "   "], envWithDatabase), /operation_id must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["shard-reconcile", "pending", "op_1"], env), /status must be applied or failed/);
assert.throws(() => parseIdentityCliArgs(["shard-maintain", "2", "1000", "2000", "65536", "64", "3000"], env), /nat16 range/);
assert.throws(() => parseIdentityCliArgs(["inspect-env"], {
  ...env,
  ICPDB_URL: "icpdb://aaaaa-aa/db_env"
}), /ICPDB_CANISTER_ID does not match ICPDB_URL/);
assert.throws(() => parseIdentityCliArgs(["inspect-env"], {
  ...envWithDatabase,
  ICPDB_URL: "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_other"
}), /ICPDB_DATABASE_ID does not match ICPDB_URL/);
assert.throws(() => parseIdentityCliArgs(["inspect-env"], {
  ...env,
  ICPDB_URL: ""
}), /ICPDB_URL must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["inspect-env"], {
  ...env,
  ICPDB_CANISTER_ID: ""
}), /ICPDB_CANISTER_ID must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["tables"], {
  ...envWithDatabase,
  ICPDB_DATABASE_ID: ""
}), /ICPDB_DATABASE_ID must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["tables"], {
  ...envWithDatabase,
  ICPDB_DATABASE_ID: "   "
}), /ICPDB_DATABASE_ID must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["--database-id", "   ", "tables"], env), /database_id must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["--url", "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/%20%20", "tables"], env), /database_id must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["tables"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["tables", "extra"], envWithDatabase), /tables accepts no positional arguments/);
assert.equal(parseIdentityCliArgs(["views"], envWithDatabase).viewsOnly, true);
assert.equal(parseIdentityCliArgs(["describe", "notes"], envWithDatabase).tableName, "notes");
assert.equal(parseIdentityCliArgs(["preview", "notes"], envWithDatabase).databaseId, "db_env");
assert.throws(() => parseIdentityCliArgs(["describe", "db_alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["preview", "db_alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["columns", "db_alpha", "   "], env), /table_name must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["describe", "   "], envWithDatabase), /table_name must be a non-empty string/);
assert.throws(() => parseIdentityCliArgs(["preview", "   "], envWithDatabase), /table_name must be a non-empty string/);
assert.equal(parseIdentityCliArgs(["revoke-member", "aaaaa-aa"], envWithDatabase).databaseId, "db_env");
assert.deepEqual(sqlValue(null), { Null: null });
assert.deepEqual(sqlValue(7), { Integer: 7n });
assert.deepEqual(sqlValue(1.5), { Real: 1.5 });
assert.deepEqual(sqlValue("hello"), { Text: "hello" });
assert.deepEqual(sqlValue([1, 2, 3]), { Blob: [1, 2, 3] });
assert.throws(() => sqlValue([256]), /blob bytes/);

const identity = await loadServiceIdentity(parseIdentityCliArgs(["principal"], env));
assert.equal(typeof identity.getPrincipal().toText(), "string");
const envPrincipal = identity.getPrincipal().toText();
assert.equal((await loadServiceIdentity({ identityJson: env.ICPDB_IDENTITY_JSON, identityPrincipal: envPrincipal, identityType: "auto" })).getPrincipal().toText(), envPrincipal);
await assert.rejects(() => loadServiceIdentity({
  identityJson: env.ICPDB_IDENTITY_JSON,
  identityPrincipal: "aaaaa-aa",
  identityType: "auto"
}), /identity principal mismatch/);
assert.equal(parseIdentityCliArgs(["principal"], { ...env, ICPDB_IDENTITY_PRINCIPAL: envPrincipal }).identityPrincipal, envPrincipal);
assert.throws(() => parseIdentityCliArgs(["principal"], { ...env, ICPDB_IDENTITY_PRINCIPAL: "   " }), /ICPDB_IDENTITY_PRINCIPAL must be a non-empty string/);
const inspectEnvCommand = parseIdentityCliArgs(["inspect-env"], {
  ...envWithUrl,
  ICPDB_SETUP_SQL: "CREATE TABLE inspect_env(id INTEGER);",
  ICPDB_SETUP_STATEMENTS: "[{\"sql\":\"INSERT INTO inspect_env(id) VALUES (:id)\",\"params\":{\"id\":1}}]",
  ICPDB_SETUP_MIGRATIONS: "[{\"version\":\"inspect-001\",\"sql\":\"CREATE TABLE inspect_migrated(id INTEGER);\"}]"
});
assert.equal(inspectEnvCommand.inspectEnv, true);
assert.equal(inspectEnvCommand.canisterId, "ryjl3-tyaaa-aaaaa-aaaba-cai");
assert.equal(inspectEnvCommand.databaseId, "db_url");
const inspectEnvResult = await executeIdentityCommand(inspectEnvCommand, null, identity);
assert.equal(inspectEnvResult.connection_url, "icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_url");
assert.equal(inspectEnvResult.principal, identity.getPrincipal().toText());
assert.equal(inspectEnvResult.has_root_key, true);
assert.equal(inspectEnvResult.has_setup_sql, true);
assert.equal(inspectEnvResult.setup_statement_count, 1);
assert.equal(inspectEnvResult.setup_migration_count, 1);
const inspectEnvTableOutput = formatIdentityCommandOutput(inspectEnvResult, { ...inspectEnvCommand, outputFormat: "table" });
assert.match(inspectEnvTableOutput, /connection_url/);
assert.throws(() => parseIdentityCliArgs(["query", "SELECT 1"], {
  ...envWithUrl,
  ICPDB_SETUP_SQL: "CREATE TABLE ignored_setup(id INTEGER);"
}), /ICPDB_SETUP_\* is only used when creating a database/);
assert.throws(() => parseIdentityCliArgs(["execute", "INSERT INTO notes(body) VALUES ('x')"], {
  ...envWithDatabase,
  ICPDB_SETUP_MIGRATIONS_FILE: "/tmp/migrations.json"
}), /DB-bearing CLI commands must use script, batch, or migrate/);
const generatedIdentity = await executeIdentityCommand(parseIdentityCliArgs(["--identity-type", "ed25519", "generate-identity"], env), null, null);
assert.equal(generatedIdentity.identity_type, "ed25519");
assert.equal(typeof generatedIdentity.principal, "string");
assert.equal(generatedIdentity.env.ICPDB_CANISTER_ID, env.ICPDB_CANISTER_ID);
assert.equal(generatedIdentity.env.ICPDB_NETWORK_URL, env.ICPDB_NETWORK_URL);
assert.equal(generatedIdentity.env.ICPDB_ROOT_KEY, env.ICPDB_ROOT_KEY);
assert.equal(generatedIdentity.env.ICPDB_IDENTITY_PRINCIPAL, generatedIdentity.principal);
assert.match(generatedIdentity.env_lines.join("\n"), /ICPDB_CANISTER_ID=ryjl3-tyaaa-aaaaa-aaaba-cai/);
assert.match(generatedIdentity.env_lines.join("\n"), /ICPDB_NETWORK_URL=http:\/\/localhost:8001/);
assert.match(generatedIdentity.env_lines.join("\n"), /ICPDB_IDENTITY_PRINCIPAL=/);
assert.match(generatedIdentity.env_lines.join("\n"), /ICPDB_IDENTITY_JSON=/);
assert.deepEqual(JSON.parse(generatedIdentity.identity_json).length, 2);
const generatedEnvOutput = await execFileAsync(process.execPath, ["scripts/icpdb-identity.mjs", "--identity-type", "ed25519", "--format", "env", "generate-identity"]);
assert.match(generatedEnvOutput.stdout, /^ICPDB_IDENTITY_TYPE=ed25519\nICPDB_IDENTITY_PRINCIPAL=/);
assert.match(generatedEnvOutput.stdout, /\nICPDB_IDENTITY_JSON=/);
assert.equal(generatedEnvOutput.stderr, "");

const calls = [];
const fakeActor = {
  canister_health: async () => ({ cycles_balance: 123456n }),
  create_database: async () => ({ Ok: "db_new" }),
  grant_database_access: async (databaseId, principal, role) => {
    calls.push({ method: "grant", databaseId, principal, role });
    return { Ok: null };
  },
  delete_database: async (databaseId) => {
    calls.push({ method: "delete", databaseId });
    return { Ok: null };
  },
  list_database_members: async () => ({ Ok: [{ database_id: "db_alpha", principal: "aaaaa-aa", role: { Writer: null }, created_at_ms: 11n }] }),
  list_databases: async () => ({ Ok: [{ database_id: "db_alpha", role: { Owner: null }, status: { Hot: null }, logical_size_bytes: 12n, archived_at_ms: [], deleted_at_ms: [] }] }),
  list_database_placements: async () => ({ Ok: [{
    database_id: "db_alpha",
    shard_id: "local",
    canister_id: [],
    mount_id: [3],
    status: { Hot: null },
    schema_version: "1",
    created_at_ms: 12n,
    updated_at_ms: 13n
  }] }),
  list_all_database_placements: async () => ({ Ok: [{
    database_id: "db_beta",
    shard_id: "shard_1",
    canister_id: ["rrkah-fqaaa-aaaaa-aaaaq-cai"],
    mount_id: [],
    status: { Hot: null },
    schema_version: "2",
    created_at_ms: 21n,
    updated_at_ms: 22n
  }] }),
  list_database_shards: async () => ({ Ok: [{
    shard_id: "shard_1",
    canister_id: "rrkah-fqaaa-aaaaa-aaaaq-cai",
    status: "active",
    max_databases: 64,
    assigned_databases: 2n,
    created_at_ms: 23n,
    updated_at_ms: 24n
  }] }),
  get_database_shard_status: async (request) => {
    calls.push({ method: "shard-status", request });
    return { Ok: {
      shard: {
        shard_id: "shard_1",
        canister_id: request.database_canister_id,
        status: "active",
        max_databases: 64,
        assigned_databases: 2n,
        created_at_ms: 23n,
        updated_at_ms: 24n
      },
      canister_status: "running",
      cycles_balance: 1000n,
      memory_size_bytes: 2000n,
      idle_cycles_burned_per_day: 30n,
      module_hash: [[10, 11]]
    } };
  },
  top_up_database_shard: async (request) => {
    calls.push({ method: "shard-top-up", request });
    return { Ok: {
      shard_id: "shard_1",
      canister_id: request.database_canister_id,
      status: "active",
      max_databases: 64,
      assigned_databases: 2n,
      created_at_ms: 23n,
      updated_at_ms: 25n
    } };
  },
  maintain_database_shards: async (request) => {
    calls.push({ method: "shard-maintain", request });
    return { Ok: {
      available_slots: 62n,
      inspected_shards: [{
        shard: {
          shard_id: "shard_1",
          canister_id: "rrkah-fqaaa-aaaaa-aaaaq-cai",
          status: "active",
          max_databases: 64,
          assigned_databases: 2n,
          created_at_ms: 23n,
          updated_at_ms: 24n
        },
        canister_status: "running",
        cycles_balance: 1000n,
        memory_size_bytes: 2000n,
        idle_cycles_burned_per_day: 30n,
        module_hash: []
      }],
      actions: [{
        action: "top_up",
        database_canister_id: ["rrkah-fqaaa-aaaaa-aaaaq-cai"],
        shard_id: ["shard_1"],
        cycles: request.top_up_cycles,
        reason: "low cycles"
      }]
    } };
  },
  migrate_database_to_shard: async (request) => {
    calls.push({ method: "shard-migrate", request });
    return { Ok: {
      database_id: request.database_id,
      shard_id: "shard_1",
      canister_id: [request.database_canister_id],
      mount_id: [],
      status: { Hot: null },
      schema_version: "2",
      created_at_ms: 26n,
      updated_at_ms: 27n
    } };
  },
  list_shard_operations: async () => ({ Ok: [{
    operation_id: "op_1",
    operation_kind: "create_shard",
    target: ["rrkah-fqaaa-aaaaa-aaaaq-cai"],
    request_hash: [12, 13],
    status: { Pending: null },
    error: [],
    created_at_ms: 28n,
    updated_at_ms: 29n
  }] }),
  reconcile_shard_operation: async (request) => {
    calls.push({ method: "shard-reconcile", request });
    return { Ok: {
      operation_id: request.operation_id,
      operation_kind: "create_shard",
      target: [],
      request_hash: [12, 13],
      status: request.status,
      error: request.error,
      created_at_ms: 28n,
      updated_at_ms: 30n
    } };
  },
  get_routed_operation: async (request) => {
    calls.push({ method: "operation", request });
    return { Ok: {
      operation_id: request.operation_id,
      database_id: request.database_id,
      database_canister_id: "rrkah-fqaaa-aaaaa-aaaaq-cai",
      method: "sql_execute",
      request_hash: [14, 15],
      status: { Applied: null },
      error: [],
      created_at_ms: 31n,
      updated_at_ms: 32n
    } };
  },
  reconcile_routed_operation: async (request) => {
    calls.push({ method: "operation-reconcile", request });
    return { Ok: {
      operation_id: request.operation_id,
      database_id: request.database_id,
      database_canister_id: "rrkah-fqaaa-aaaaa-aaaaq-cai",
      method: "sql_execute",
      request_hash: [14, 15],
      status: { Applied: null },
      error: [],
      created_at_ms: 31n,
      updated_at_ms: 32n
    } };
  },
  get_usage: async () => ({ Ok: {
    database_id: "db_alpha",
    status: { Hot: null },
    logical_size_bytes: 42n,
    max_logical_size_bytes: 1024n,
    usage_event_count: 2n
  } }),
  get_usage_event_summaries: async () => ({ Ok: [{
    method: "sql_execute",
    operation: ["write"],
    success: true,
    event_count: 2n,
    total_cycles_delta: 10n,
    total_rows_returned: 0n,
    total_rows_affected: 2n,
    last_created_at_ms: 14n
  }] }),
  begin_database_archive: async () => ({ Ok: { database_id: "db_alpha", size_bytes: 3n } }),
  read_database_archive_chunk: async () => ({ Ok: { bytes: [1, 2, 3] } }),
  finalize_database_archive: async (databaseId, snapshotHash) => {
    calls.push({ method: "archive-finalize", databaseId, snapshotHash: snapshotHash.length });
    return { Ok: null };
  },
  cancel_database_archive: async (databaseId) => {
    calls.push({ method: "archive-cancel", databaseId });
    return { Ok: null };
  },
  begin_database_restore: async (databaseId, snapshotHash, sizeBytes) => {
    calls.push({ method: "restore-begin", databaseId, snapshotHash: snapshotHash.length, sizeBytes });
    return { Ok: null };
  },
  write_database_restore_chunk: async (request) => {
    calls.push({ method: "restore-write", request });
    return { Ok: null };
  },
  finalize_database_restore: async (databaseId) => {
    calls.push({ method: "restore-finalize", databaseId });
    return { Ok: null };
  },
  list_tables: async () => ({ Ok: [{ name: "notes", object_type: { Table: null }, schema_sql: ["CREATE TABLE notes(id INTEGER)"] }] }),
  describe_table: async () => ({ Ok: {
    database_id: "db_alpha",
    table_name: "notes",
    object_type: { Table: null },
    schema_sql: ["CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL)"],
    columns: [
      { cid: 0, name: "id", primary_key_position: 1, declared_type: "INTEGER", default_value: [], not_null: true, hidden: 0 },
      { cid: 1, name: "body", primary_key_position: 0, declared_type: "TEXT", default_value: [], not_null: false, hidden: 0 },
      { cid: 2, name: "body_len", primary_key_position: 0, declared_type: "INTEGER", default_value: [], not_null: false, hidden: 2 }
    ],
    indexes: [{ name: "idx_notes_body", table_name: "notes", unique: false, origin: "c", partial: false, columns: [], schema_sql: ["CREATE INDEX idx_notes_body ON notes(body)"] }],
    triggers: [{ name: "trg_notes", table_name: "notes", schema_sql: ["CREATE TRIGGER trg_notes AFTER INSERT ON notes BEGIN SELECT 1; END"] }],
    foreign_keys: [{ id: 0, seq: 0, table_name: "parent_notes", from_column: "id", to_column: ["id"], on_update: "NO ACTION", on_delete: "CASCADE", match_clause: "NONE" }]
  } }),
  preview_table: async (request) => {
    calls.push({ method: "preview", request });
    return { Ok: {
      database_id: "db_alpha",
      table_name: "notes",
      columns: ["id", "body", "body_len"],
      rows: [[{ Integer: 7n }, { Text: "quote ' semi;" }, { Integer: 13n }]],
      offset: Number(request.offset[0] ?? 0),
      limit: Number(request.limit[0] ?? 100),
      total_count: 1n,
      truncated: false
    } };
  },
  sql_query: async (request) => {
    calls.push({ method: "query", request });
    if (request.sql.includes("sqlite_master") && request.params.some((param) => param.Text === "sqlite_sequence")) {
      return { Ok: { columns: ["name"], rows: [[{ Text: "sqlite_sequence" }]], rows_affected: 0n, last_insert_rowid: 0n, truncated: false } };
    }
    if (request.sql.includes("FROM sqlite_sequence")) {
      return { Ok: { columns: ["name", "seq"], rows: [[{ Text: "notes" }, { Integer: 44n }]], rows_affected: 0n, last_insert_rowid: 0n, truncated: false } };
    }
    if (request.sql.includes("sqlite_master") && request.params.some((param) => param.Text === "icpdb_schema_migrations")) {
      return { Ok: { columns: ["name"], rows: [], rows_affected: 0n, last_insert_rowid: 0n, truncated: false } };
    }
    if (request.sql.includes("SELECT version FROM icpdb_schema_migrations")) {
      return { Ok: { columns: ["version"], rows: [[{ Text: "existing-001" }]], rows_affected: 0n, last_insert_rowid: 0n, truncated: false } };
    }
    return { Ok: { columns: ["body"], rows: [[{ Text: "hello" }]], rows_affected: 0n, last_insert_rowid: 0n, truncated: false } };
  },
  sql_execute: async (request) => {
    calls.push({ method: "execute", request });
    return { Ok: { columns: [], rows: [], rows_affected: 1n, last_insert_rowid: 9n, truncated: false, routed_operation_id: request.idempotency_key.length > 0 ? request.idempotency_key : ["op_execute"] } };
  },
  sql_batch: async (request) => {
    calls.push({ method: "batch", request });
    return { Ok: request.statements.map(() => ({ columns: [], rows: [], rows_affected: 1n, last_insert_rowid: 10n, truncated: false, routed_operation_id: request.idempotency_key })) };
  }
};

assert.deepEqual(await executeIdentityCommand(parseIdentityCliArgs(["create-db"], env), fakeActor, identity), { database_id: "db_new" });
const createDatabaseSetupResult = await executeIdentityCommand(
  parseIdentityCliArgs(["create-db", "--statement", "CREATE TABLE setup(id INTEGER)", "--statement", "INSERT INTO setup(id) VALUES (1)"], env),
  fakeActor,
  identity
);
assert.equal(createDatabaseSetupResult.database_id, "db_new");
assert.equal(createDatabaseSetupResult.setup_statement_count, 2);
assert.equal(createDatabaseSetupResult.setup_rows_affected, "2");
assert.equal(createDatabaseSetupResult.setup_results[0].rows_affected, "1");
assert.equal(calls.at(-1).method, "batch");
assert.equal(calls.at(-1).request.database_id, "db_new");
const createDatabaseSetupStatementsFileResult = await executeIdentityCommand(
  parseIdentityCliArgs(["create-db", "--statements-file", statementsFilePath], env),
  fakeActor,
  identity
);
assert.equal(createDatabaseSetupStatementsFileResult.database_id, "db_new");
assert.equal(createDatabaseSetupStatementsFileResult.setup_statement_count, 1);
assert.deepEqual(calls.at(-1).request.statements[0].params, [{ Text: "from-statements-file" }]);
const createDatabaseSetupFileResult = await executeIdentityCommand({
  ...parseIdentityCliArgs(["create-db", "--setup-file", "-"], env),
  stdinText: "CREATE TABLE setup_file(id INTEGER); INSERT INTO setup_file(id) VALUES (1);"
}, fakeActor, identity);
assert.equal(createDatabaseSetupFileResult.database_id, "db_new");
assert.equal(createDatabaseSetupFileResult.setup_statement_count, 2);
assert.equal(calls.at(-1).request.statements[0].sql, "CREATE TABLE setup_file(id INTEGER)");
const createDatabaseSetupMigrationsResult = await executeIdentityCommand({
  ...parseIdentityCliArgs(["create-db", "--setup-migrations-file", "-"], env),
  stdinText: JSON.stringify([{
    version: "create-setup-001",
    name: "create_setup_migrated",
    sql: "CREATE TABLE setup_migrated(id INTEGER); INSERT INTO setup_migrated(id) VALUES (1);"
  }])
}, fakeActor, identity);
assert.equal(createDatabaseSetupMigrationsResult.database_id, "db_new");
assert.equal(createDatabaseSetupMigrationsResult.setup_migration_count, 1);
assert.deepEqual(createDatabaseSetupMigrationsResult.setup_migration_applied, ["create-setup-001"]);
assert.deepEqual(createDatabaseSetupMigrationsResult.setup_migration_skipped, []);
assert.equal(createDatabaseSetupMigrationsResult.setup_statement_count, 2);
assert.equal(createDatabaseSetupMigrationsResult.setup_batch_count, 2);
assert.equal(createDatabaseSetupMigrationsResult.setup_rows_affected, "3");
assert.equal(calls.at(-3).request.statements[0].sql, "CREATE TABLE icpdb_schema_migrations(version TEXT PRIMARY KEY, name TEXT, applied_at_ms TEXT NOT NULL)");
assert.equal(calls.at(-1).request.statements[0].sql, "CREATE TABLE setup_migrated(id INTEGER)");
const createSetupSqlFailureDeletes = [];
await assert.rejects(
  () => executeIdentityCommand(parseIdentityCliArgs(["create-db", "--statement", "CREATE TABLE failing_setup(id INTEGER)"], env), {
    ...fakeActor,
    sql_batch: async () => ({ Err: "setup failed" }),
    delete_database: async (databaseId) => {
      createSetupSqlFailureDeletes.push(databaseId);
      return { Ok: null };
    }
  }, identity),
  /setup failed/
);
assert.deepEqual(createSetupSqlFailureDeletes, ["db_new"]);
await assert.rejects(() => executeIdentityCommand({
  ...parseIdentityCliArgs(["create-db", "--setup-file", "-", "--statement", "CREATE TABLE mixed(id INTEGER)"], env),
  stdinText: "CREATE TABLE setup_file(id INTEGER);"
}, fakeActor, identity), /use only one of --statement, --statements-file, --setup-file, or --setup-migrations-file/);
await assert.rejects(() => executeIdentityCommand({
  ...parseIdentityCliArgs(["create-db", "--setup-migrations-file", "-", "--statement", "CREATE TABLE mixed(id INTEGER)"], env),
  stdinText: JSON.stringify([{ version: "mixed-001", sql: "CREATE TABLE mixed(id INTEGER);" }])
}, fakeActor, identity), /use only one of --statement, --statements-file, --setup-file, or --setup-migrations-file/);
assert.equal(calls.at(-1).method, "delete");
const connectionUrlResult = await executeIdentityCommand(parseIdentityCliArgs(["url", "db/slash"], env), null, null);
assert.deepEqual(connectionUrlResult, {
  canister_id: env.ICPDB_CANISTER_ID,
  database_id: "db/slash",
  url: `icpdb://${env.ICPDB_CANISTER_ID}/db%2Fslash`,
  env: {
    ICPDB_CANISTER_ID: env.ICPDB_CANISTER_ID,
    ICPDB_DATABASE_ID: "db/slash",
    ICPDB_URL: `icpdb://${env.ICPDB_CANISTER_ID}/db%2Fslash`
  },
  env_lines: [
    `ICPDB_CANISTER_ID=${JSON.stringify(env.ICPDB_CANISTER_ID)}`,
    "ICPDB_DATABASE_ID=\"db/slash\"",
    `ICPDB_URL=${JSON.stringify(`icpdb://${env.ICPDB_CANISTER_ID}/db%2Fslash`)}`
  ]
});
await assert.rejects(
  () => executeIdentityCommand({ ...parseIdentityCliArgs(["url", "db_valid"], env), databaseId: "" }, null, null),
  /databaseId must be a non-empty string/
);
await assert.rejects(
  () => executeIdentityCommand({ ...parseIdentityCliArgs(["url", "db_valid"], env), canisterId: "" }, null, null),
  /canisterId must be a non-empty string/
);
const createDatabaseEnvResult = await executeIdentityCommand(parseIdentityCliArgs(["--format", "env", "create-db"], env), fakeActor, identity);
assert.deepEqual(createDatabaseEnvResult.env, {
  ICPDB_CANISTER_ID: env.ICPDB_CANISTER_ID,
  ICPDB_DATABASE_ID: "db_new",
  ICPDB_URL: `icpdb://${env.ICPDB_CANISTER_ID}/db_new`,
  ICPDB_NETWORK_URL: env.ICPDB_NETWORK_URL,
  ICPDB_IDENTITY_JSON: env.ICPDB_IDENTITY_JSON,
  ICPDB_IDENTITY_PRINCIPAL: envPrincipal,
  ICPDB_ROOT_KEY: env.ICPDB_ROOT_KEY
});
const createDatabasePinnedEnvResult = await executeIdentityCommand(parseIdentityCliArgs(["--format", "env", "create-db"], {
  ...env,
  ICPDB_IDENTITY_PRINCIPAL: envPrincipal
}), fakeActor, identity);
assert.equal(createDatabasePinnedEnvResult.env.ICPDB_IDENTITY_PRINCIPAL, envPrincipal);
assert.deepEqual(createDatabaseEnvResult.env_lines, [
  `ICPDB_CANISTER_ID=${JSON.stringify(env.ICPDB_CANISTER_ID)}`,
  "ICPDB_DATABASE_ID=\"db_new\"",
  `ICPDB_URL=${JSON.stringify(`icpdb://${env.ICPDB_CANISTER_ID}/db_new`)}`,
  `ICPDB_NETWORK_URL=${JSON.stringify(env.ICPDB_NETWORK_URL)}`,
  `ICPDB_IDENTITY_JSON=${JSON.stringify(env.ICPDB_IDENTITY_JSON)}`,
  `ICPDB_IDENTITY_PRINCIPAL=${JSON.stringify(envPrincipal)}`,
  `ICPDB_ROOT_KEY=${JSON.stringify(env.ICPDB_ROOT_KEY)}`
]);
await assert.rejects(
  () => executeIdentityCommand({ ...parseIdentityCliArgs(["--format", "env", "create-db"], env), networkUrl: "" }, fakeActor, identity),
  /networkUrl must be a non-empty string/
);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["databases"], env), fakeActor, identity))[0].role, "owner");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["health"], env), fakeActor, identity)).cycles_balance, "123456");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["members", "db_alpha"], env), fakeActor, identity))[0].role, "writer");
await assert.rejects(() => executeIdentityCommand(parseIdentityCliArgs(["databases"], env), {
  ...fakeActor,
  list_databases: async () => ({ Ok: [{ database_id: "db_bad", role: { Auditor: null }, status: { Hot: null }, logical_size_bytes: 0n, archived_at_ms: [], deleted_at_ms: [] }] })
}, identity), /unknown database role variant: Auditor/);
await assert.rejects(() => executeIdentityCommand(parseIdentityCliArgs(["databases"], env), {
  ...fakeActor,
  list_databases: async () => ({ Ok: [{ database_id: "db_bad", role: { Owner: null }, status: { Frozen: null }, logical_size_bytes: 0n, archived_at_ms: [], deleted_at_ms: [] }] })
}, identity), /unknown database status variant: Frozen/);
await assert.rejects(() => executeIdentityCommand(parseIdentityCliArgs(["members", "db_alpha"], env), {
  ...fakeActor,
  list_database_members: async () => ({ Ok: [{ database_id: "db_alpha", principal: "aaaaa-aa", role: { Admin: null }, created_at_ms: 11n }] })
}, identity), /unknown database role variant: Admin/);
await assert.rejects(() => executeIdentityCommand(parseIdentityCliArgs(["tables", "db_alpha"], env), {
  ...fakeActor,
  list_tables: async () => ({ Ok: [{ name: "notes", object_type: { MaterializedView: null }, schema_sql: [] }] })
}, identity), /unknown database object type variant: MaterializedView/);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["tables", "db_alpha"], env), fakeActor, identity))[0].object_type, "table");
assert.deepEqual(await executeIdentityCommand(parseIdentityCliArgs(["views", "db_alpha"], env), {
  ...fakeActor,
  list_tables: async () => ({ Ok: [
    { name: "notes", object_type: { Table: null }, schema_sql: ["CREATE TABLE notes(id INTEGER)"] },
    { name: "notes_view", object_type: { View: null }, schema_sql: ["CREATE VIEW notes_view AS SELECT id FROM notes"] }
  ] })
}, identity), [{
  name: "notes_view",
  object_type: "view",
  schema_sql: "CREATE VIEW notes_view AS SELECT id FROM notes"
}]);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["describe", "db_alpha", "notes"], env), fakeActor, identity)).table_name, "notes");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["columns", "db_alpha", "notes"], env), fakeActor, identity)).column_count, 3);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["indexes", "db_alpha", "notes"], env), fakeActor, identity)).indexes[0].name, "idx_notes_body");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["triggers", "db_alpha", "notes"], env), fakeActor, identity)).triggers[0].name, "trg_notes");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["foreign-keys", "db_alpha", "notes"], env), fakeActor, identity)).foreign_keys[0].to_column, "id");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["schema", "db_alpha"], env), fakeActor, identity)).schemas[0].schema_sql, "CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL)");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["schema", "db_alpha", "notes"], env), fakeActor, identity)).schemas[0].table_name, "notes");
const schemaCsvCommand = parseIdentityCliArgs(["--format", "csv", "schema", "db_alpha"], env);
const schemaCsvOutput = formatIdentityCommandOutput(await executeIdentityCommand(schemaCsvCommand, fakeActor, identity), schemaCsvCommand);
assert.match(schemaCsvOutput, /table_name,object_type,schema_sql_kind,schema_sql/);
assert.match(schemaCsvOutput, /notes,table,table,"CREATE TABLE notes/);
assert.match(schemaCsvOutput, /notes,table,index,CREATE INDEX idx_notes_body/);
assert.match(schemaCsvOutput, /notes,table,trigger,CREATE TRIGGER trg_notes/);
const statusResult = await executeIdentityCommand(parseIdentityCliArgs(["status", "db_alpha"], env), fakeActor, identity);
assert.equal(statusResult.connection_url, `icpdb://${env.ICPDB_CANISTER_ID}/db_alpha`);
assert.equal(statusResult.caller_principal, identity.getPrincipal().toText());
assert.equal(statusResult.caller_role, "owner");
assert.equal(statusResult.placement.shard_id, "local");
assert.equal(statusResult.usage.logical_size_bytes, "42");
assert.equal(statusResult.stats.table_count, 1);
assert.equal(statusResult.table_summaries[0].table_name, "notes");
const statusTableCommand = parseIdentityCliArgs(["--format", "table", "status", "db_alpha"], env);
const statusTableOutput = formatIdentityCommandOutput(await executeIdentityCommand(statusTableCommand, fakeActor, identity), statusTableCommand);
assert.match(statusTableOutput, /connection/);
assert.match(statusTableOutput, /icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_alpha/);
assert.match(statusTableOutput, /caller_principal/);
assert.match(statusTableOutput, /caller_role/);
assert.match(statusTableOutput, /table summary/);
const statsResult = await executeIdentityCommand(parseIdentityCliArgs(["stats", "db_alpha"], env), fakeActor, identity);
assert.deepEqual(statsResult.stats, {
  table_count: 1,
  view_count: 0,
  row_count: "1",
  column_count: 3,
  index_count: 1,
  trigger_count: 1,
  foreign_key_count: 1
});
assert.equal(statsResult.table_summaries[0].table_name, "notes");
assert.equal(statsResult.table_summaries[0].row_count, "1");
const inspectResult = await executeIdentityCommand(parseIdentityCliArgs(["inspect", "db_alpha"], env), fakeActor, identity);
assert.equal(inspectResult.placement.shard_id, "local");
assert.equal(inspectResult.usage.logical_size_bytes, "42");
assert.equal(inspectResult.table_summaries[0].table_name, "notes");
assert.equal(inspectResult.tables[0].table_name, "notes");
const inspectTableResult = await executeIdentityCommand(parseIdentityCliArgs(["inspect", "db_alpha", "notes", "--limit", "2", "--offset", "1"], env), fakeActor, identity);
assert.equal(inspectTableResult.table.table_name, "notes");
assert.equal(inspectTableResult.preview.table_name, "notes");
assert.equal(calls.at(-1).request.limit[0], 2);
assert.equal(calls.at(-1).request.offset[0], 1);
const inspectTableOutput = formatIdentityCommandOutput(await executeIdentityCommand(parseIdentityCliArgs(["--format", "table", "inspect", "db_alpha", "notes"], env), fakeActor, identity), parseIdentityCliArgs(["--format", "table", "inspect", "db_alpha", "notes"], env));
assert.match(inspectTableOutput, /preview/);
assert.match(inspectTableOutput, /notes/);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["preview", "db_alpha", "notes"], env), fakeActor, identity)).rows[0][0].integer, "7");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["usage", "db_alpha"], env), fakeActor, identity)).logical_size_bytes, "42");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["usage-events", "db_alpha"], env), fakeActor, identity))[0].operation, "write");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["placement", "db_alpha"], env), fakeActor, identity)).shard_id, "local");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["placements"], env), fakeActor, identity))[0].mount_id, 3);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["all-placements"], env), fakeActor, identity))[0].canister_id, "rrkah-fqaaa-aaaaa-aaaaq-cai");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["shards"], env), fakeActor, identity))[0].assigned_databases, "2");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["shard-status", "rrkah-fqaaa-aaaaa-aaaaq-cai"], env), fakeActor, identity)).module_hash, "0a0b");
assert.equal(calls.at(-1).method, "shard-status");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["shard-top-up", "rrkah-fqaaa-aaaaa-aaaaq-cai", "1000"], env), fakeActor, identity)).updated_at_ms, "25");
assert.equal(calls.at(-1).request.cycles, 1000n);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["shard-maintain", "2", "1000", "2000", "1", "64", "3000"], env), fakeActor, identity)).actions[0].cycles, "2000");
assert.equal(calls.at(-1).request.new_shard_initial_cycles, 3000n);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["shard-migrate", "db_alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai"], env), fakeActor, identity)).database_id, "db_alpha");
assert.equal(calls.at(-1).request.database_canister_id, "rrkah-fqaaa-aaaaa-aaaaq-cai");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["shard-ops"], env), fakeActor, identity))[0].request_hash, "0c0d");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["shard-reconcile", "failed", "op_1", "remote failed"], env), fakeActor, identity)).error, "remote failed");
assert.deepEqual(calls.at(-1).request.status, { Failed: null });
assert.deepEqual(calls.at(-1).request.error, ["remote failed"]);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["operation", "db_alpha", "op_1"], env), fakeActor, identity)).status, "applied");
assert.equal(calls.at(-1).method, "operation");
assert.equal(calls.at(-1).request.operation_id, "op_1");
await assert.rejects(() => executeIdentityCommand(parseIdentityCliArgs(["operation", "db_alpha", "op_1"], env), {
  ...fakeActor,
  get_routed_operation: async () => ({ Ok: {
    operation_id: "op_1",
    database_id: "db_alpha",
    database_canister_id: "rrkah-fqaaa-aaaaa-aaaaq-cai",
    method: "sql_execute",
    request_hash: [],
    status: { Stalled: null },
    error: [],
    created_at_ms: 1n,
    updated_at_ms: 1n
  } })
}, identity), /unknown routed operation status variant: Stalled/);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["operation", "op_env"], envWithDatabase), fakeActor, identity)).database_id, "db_env");
assert.equal(calls.at(-1).request.database_id, "db_env");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["operation-reconcile", "db_alpha", "op_1"], env), fakeActor, identity)).status, "applied");
assert.equal(calls.at(-1).request.operation_id, "op_1");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["operation-reconcile", "op_env"], envWithDatabase), fakeActor, identity)).database_id, "db_env");
assert.equal(calls.at(-1).request.database_id, "db_env");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["query", "db_alpha", "SELECT", "body"], env), fakeActor, identity)).rows[0][0].text, "hello");
const csvQueryCommand = parseIdentityCliArgs(["--format", "csv", "query", "db_alpha", "SELECT body FROM notes"], env);
assert.equal(formatIdentityCommandOutput(await executeIdentityCommand(csvQueryCommand, fakeActor, identity), csvQueryCommand), "body\nhello");
const scalarCommand = parseIdentityCliArgs(["--format", "table", "scalar", "db_alpha", "SELECT body FROM notes"], env);
const scalarResult = await executeIdentityCommand(scalarCommand, fakeActor, identity);
assert.deepEqual(scalarResult, {
  scalar: true,
  column: "body",
  value: { text: "hello" },
  row_found: true,
  rows_returned: 1,
  truncated: false
});
assert.equal(calls.at(-1).request.max_rows[0], 1);
assert.match(formatIdentityCommandOutput(scalarResult, scalarCommand), /body\s+\|\s+hello\s+\|\s+yes\s+\|\s+1\s+\|\s+no/);
const csvScalarCommand = parseIdentityCliArgs(["--format", "csv", "scalar", "db_alpha", "SELECT body FROM notes"], env);
assert.equal(formatIdentityCommandOutput(await executeIdentityCommand(csvScalarCommand, fakeActor, identity), csvScalarCommand), "column,value,row_found,rows_returned,truncated\nbody,hello,yes,1,no");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["query", "db_alpha", "SELECT", ":body", "--params", "{\"body\":\"hello\",\"enabled\":true}"], env), fakeActor, identity)).rows[0][0].text, "hello");
assert.deepEqual(calls.at(-1).request.params, [{ Text: "hello" }]);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["query", "db_alpha", "SELECT :body AS body, length(:body) AS size", "--params", "{\"body\":\"hello\"}"], env), fakeActor, identity)).rows[0][0].text, "hello");
assert.deepEqual(calls.at(-1).request.params, [{ Text: "hello" }]);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["query", "db_alpha", "SELECT", ":enabled", "--params", "{\"enabled\":true}"], env), fakeActor, identity)).rows[0][0].text, "hello");
assert.deepEqual(calls.at(-1).request.params, [{ Integer: 1n }]);
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["execute", "db_alpha", "INSERT"], env), fakeActor, identity)).rows_affected, "1");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["execute", "db_alpha", "INSERT"], env), fakeActor, identity)).routed_operation_id, "op_execute");
const idempotentExecuteResult = await executeIdentityCommand(parseIdentityCliArgs(["execute", "db_alpha", "INSERT", "--idempotency-key", "cli_retry_1"], env), fakeActor, identity);
assert.equal(idempotentExecuteResult.routed_operation_id, "cli_retry_1");
assert.deepEqual(calls.at(-1).request.idempotency_key, ["cli_retry_1"]);
const waitedExecuteResult = await executeIdentityCommand(parseIdentityCliArgs(["execute", "db_alpha", "INSERT", "--idempotency-key", "cli_wait_1", "--wait"], env), fakeActor, identity);
assert.equal(waitedExecuteResult.routed_operation_id, "cli_wait_1");
assert.equal(waitedExecuteResult.routed_operation.status, "applied");
assert.equal(waitedExecuteResult.routed_operation.operation_id, "cli_wait_1");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["sql", "db_alpha", "--", "-- comment\nSELECT", "body"], env), fakeActor, identity)).rows[0][0].text, "hello");
assert.equal(calls.at(-1).method, "query");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["sql", "db_alpha", "WITH payload(value) AS (SELECT 1) SELECT value FROM payload"], env), fakeActor, identity)).rows[0][0].text, "hello");
assert.equal(calls.at(-1).method, "query");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["sql", "db_alpha", "WITH payload(value) AS (SELECT 1) INSERT INTO notes(id) SELECT value FROM payload"], env), fakeActor, identity)).rows_affected, "1");
assert.equal(calls.at(-1).method, "execute");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["sql", "db_alpha", "INSERT"], env), fakeActor, identity)).rows_affected, "1");
assert.equal(calls.at(-1).method, "execute");
assert.equal((await executeIdentityCommand(parseIdentityCliArgs(["batch", "db_alpha", "--statement", "INSERT"], env), fakeActor, identity))[0].last_insert_rowid, "10");
const readBatchResult = await executeIdentityCommand(parseIdentityCliArgs(["batch", "db_alpha", "--mode", "read", "--statement", "SELECT body FROM notes", "--max-rows", "3"], env), fakeActor, identity);
assert.equal(readBatchResult[0].rows[0][0].text, "hello");
assert.equal(calls.at(-1).method, "query");
assert.equal(calls.at(-1).request.max_rows[0], 3);
const readLoadPath = "/tmp/icpdb-identity-read-load-check.sql";
await writeFile(readLoadPath, "BEGIN TRANSACTION;\nSELECT body FROM notes;\nCOMMIT;\n");
const readLoadResult = await executeIdentityCommand(parseIdentityCliArgs(["load", "db_alpha", readLoadPath, "--mode", "read", "--max-rows", "3"], env), fakeActor, identity);
await unlink(readLoadPath);
assert.equal(readLoadResult.results[0].rows[0][0].text, "hello");
assert.equal(readLoadResult.query_count, 1);
assert.equal(readLoadResult.batch_count, 0);
assert.equal(calls.at(-1).method, "query");
assert.equal(calls.at(-1).request.sql, "SELECT body FROM notes");
assert.equal(calls.at(-1).request.max_rows[0], 3);
const writeLoadPath = "/tmp/icpdb-identity-read-load-reject-check.sql";
await writeFile(writeLoadPath, "INSERT INTO notes(body) VALUES ('x');\n");
await assert.rejects(() => executeIdentityCommand(parseIdentityCliArgs(["load", "db_alpha", writeLoadPath, "--mode", "read"], env), fakeActor, identity), /read load statement 1 is not read-only/);
await unlink(writeLoadPath);
const readScriptPath = "/tmp/icpdb-identity-read-script-check.sql";
await writeFile(readScriptPath, [
  "SELECT body FROM notes;",
  "WITH payload(value) AS MATERIALIZED (SELECT 1) SELECT value FROM payload;",
  "WITH payload(value) AS NOT MATERIALIZED (SELECT 2) SELECT value FROM payload;"
].join("\n"));
const readScriptResult = await executeIdentityCommand(parseIdentityCliArgs(["script", "db_alpha", readScriptPath, "--mode", "read"], env), fakeActor, identity);
await unlink(readScriptPath);
assert.equal(readScriptResult.results[0].rows[0][0].text, "hello");
assert.equal(readScriptResult.query_count, 3);
assert.deepEqual(calls.slice(-3).map((call) => call.method), ["query", "query", "query"]);
assert.deepEqual(calls.slice(-3).map((call) => call.request.sql), [
  "SELECT body FROM notes",
  "WITH payload(value) AS MATERIALIZED (SELECT 1) SELECT value FROM payload",
  "WITH payload(value) AS NOT MATERIALIZED (SELECT 2) SELECT value FROM payload"
]);
const writeScriptPath = "/tmp/icpdb-identity-read-script-reject-check.sql";
await writeFile(writeScriptPath, "INSERT INTO notes(body) VALUES ('x');\n");
await assert.rejects(() => executeIdentityCommand(parseIdentityCliArgs(["script", "db_alpha", writeScriptPath, "--mode", "read"], env), fakeActor, identity), /read script statement 1 is not read-only/);
await unlink(writeScriptPath);
const idempotentBatchResult = await executeIdentityCommand(parseIdentityCliArgs(["batch", "db_alpha", "--statement", "INSERT", "--idempotency-key", "cli_retry_batch"], env), fakeActor, identity);
assert.equal(idempotentBatchResult[0].routed_operation_id, "cli_retry_batch");
assert.deepEqual(calls.at(-1).request.idempotency_key, ["cli_retry_batch"]);
const waitedBatchResult = await executeIdentityCommand(parseIdentityCliArgs(["batch", "db_alpha", "--statement", "INSERT", "--idempotency-key", "cli_wait_batch", "--wait"], env), fakeActor, identity);
assert.equal(waitedBatchResult.results[0].routed_operation_id, "cli_wait_batch");
assert.equal(waitedBatchResult.routed_operation.status, "applied");
assert.equal(waitedBatchResult.routed_operation.operation_id, "cli_wait_batch");
const waitedTransactionResult = await executeIdentityCommand(parseIdentityCliArgs(["transaction", "db_alpha", "--statement", "INSERT", "--idempotency-key", "cli_wait_transaction", "--wait"], env), fakeActor, identity);
assert.equal(waitedTransactionResult.results[0].routed_operation_id, "cli_wait_transaction");
assert.equal(waitedTransactionResult.routed_operation.operation_id, "cli_wait_transaction");
assert.deepEqual(calls.at(-2).request.idempotency_key, ["cli_wait_transaction"]);
await executeIdentityCommand(parseIdentityCliArgs(["batch", "db_alpha", "[{\"sql\":\"INSERT INTO notes(body) VALUES (:body)\",\"params\":{\"body\":\"from-batch\"}}]"], env), fakeActor, identity);
assert.deepEqual(calls.at(-1).request.statements[0].params, [{ Text: "from-batch" }]);
await executeIdentityCommand(parseIdentityCliArgs(["batch", "db_alpha", "--statements-file", statementsFilePath], env), fakeActor, identity);
assert.deepEqual(calls.at(-1).request.statements[0].params, [{ Text: "from-statements-file" }]);
await executeIdentityCommand(parseIdentityCliArgs(["transaction", "db_alpha", "--statements-file", statementsFilePath], env), fakeActor, identity);
assert.deepEqual(calls.at(-1).request.statements[0].params, [{ Text: "from-statements-file" }]);
const dumpResult = await executeIdentityCommand(parseIdentityCliArgs(["dump", "db_alpha"], env), fakeActor, identity);
assert.match(dumpResult, /CREATE TABLE notes\(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, body_len INTEGER GENERATED ALWAYS AS \(length\(body\)\) VIRTUAL\)/);
assert.match(dumpResult, /INSERT INTO "notes" \("id", "body"\) VALUES \(7, 'quote '' semi;'\);/);
assert.doesNotMatch(dumpResult, /"body_len"/);
assert.match(dumpResult, /DELETE FROM sqlite_sequence WHERE name = 'notes';/);
assert.match(dumpResult, /INSERT INTO sqlite_sequence\(name, seq\) VALUES \('notes', 44\);/);
assert.match(dumpResult, /CREATE INDEX idx_notes_body/);
assert.match(dumpResult, /CREATE TRIGGER trg_notes/);
const sequenceNames = Array.from({ length: 120 }, (_, index) => `seq_${String(index).padStart(3, "0")}`);
const pagedSequenceDump = await executeIdentityCommand(parseIdentityCliArgs(["dump", "db_alpha", "seq_119", "--max-rows", "50"], env), {
  ...fakeActor,
  describe_table: async () => ({ Ok: {
    database_id: "db_alpha",
    table_name: "seq_119",
    object_type: { Table: null },
    schema_sql: ["CREATE TABLE seq_119(id INTEGER PRIMARY KEY AUTOINCREMENT)"],
    columns: [{ cid: 0, name: "id", declared_type: ["INTEGER"], not_null: false, default_value: [], primary_key_position: 1, hidden: 0 }],
    indexes: [],
    triggers: [],
    foreign_keys: []
  } }),
  preview_table: async () => ({ Ok: {
    database_id: "db_alpha",
    table_name: "seq_119",
    columns: ["id"],
    rows: [],
    offset: 0,
    limit: 50,
    total_count: 0n,
    truncated: false
  } }),
  sql_query: async (request) => {
    if (request.sql.includes("sqlite_master")) {
      return { Ok: { columns: ["name"], rows: [[{ Text: "sqlite_sequence" }]], rows_affected: 0n, last_insert_rowid: 0n, truncated: false } };
    }
    const lastName = request.params[0]?.Text ?? "";
    const rows = sequenceNames
      .filter((name) => name > lastName)
      .slice(0, 50)
      .map((name, index) => [{ Text: name }, { Integer: BigInt(index + 1) }]);
    return { Ok: { columns: ["name", "seq"], rows, rows_affected: 0n, last_insert_rowid: 0n, truncated: rows.length === 50 } };
  }
}, identity);
assert.match(pagedSequenceDump, /INSERT INTO sqlite_sequence\(name, seq\) VALUES \('seq_119'/);
await executeIdentityCommand(parseIdentityCliArgs(["grant-member", "db_alpha", "aaaaa-aa", "writer"], env), fakeActor, identity);
assert.deepEqual(calls.at(-1), { method: "grant", databaseId: "db_alpha", principal: "aaaaa-aa", role: { Writer: null } });
const grantServiceResult = await executeIdentityCommand(parseIdentityCliArgs(["grant-service", "db_alpha", "writer"], serviceEnv), fakeActor, identity);
assert.deepEqual(grantServiceResult, {
  database_id: "db_alpha",
  principal: Secp256k1KeyIdentity.fromJSON(serviceIdentityJson).getPrincipal().toText(),
  role: "writer"
});
assert.deepEqual(calls.at(-1), {
  method: "grant",
  databaseId: "db_alpha",
  principal: grantServiceResult.principal,
  role: { Writer: null }
});
await assert.rejects(
  () => executeIdentityCommand(parseIdentityCliArgs(["grant-service", "db_alpha", "writer"], { ...serviceEnv, ICPDB_SERVICE_IDENTITY_PRINCIPAL: "aaaaa-aa" }), fakeActor, identity),
  /service identity principal mismatch/
);
const provisionServiceResult = await executeIdentityCommand(parseIdentityCliArgs(["--service-identity-type", "ed25519", "provision-service", "db_alpha", "writer"], env), fakeActor, identity);
assert.equal(provisionServiceResult.database_id, "db_alpha");
assert.equal(provisionServiceResult.role, "writer");
assert.equal(provisionServiceResult.identity_type, "ed25519");
assert.equal(typeof provisionServiceResult.principal, "string");
assert.equal(provisionServiceResult.env.ICPDB_IDENTITY_PRINCIPAL, provisionServiceResult.principal);
assert.equal(provisionServiceResult.env.ICPDB_DATABASE_ID, "db_alpha");
assert.equal(provisionServiceResult.env.ICPDB_CANISTER_ID, env.ICPDB_CANISTER_ID);
assert.equal(provisionServiceResult.env.ICPDB_URL, `icpdb://${env.ICPDB_CANISTER_ID}/db_alpha`);
assert.equal(provisionServiceResult.env.ICPDB_NETWORK_URL, env.ICPDB_NETWORK_URL);
assert.match(provisionServiceResult.env_lines.join("\n"), /ICPDB_IDENTITY_JSON=/);
assert.deepEqual(calls.at(-1), {
  method: "grant",
  databaseId: "db_alpha",
  principal: provisionServiceResult.principal,
  role: { Writer: null }
});
await assert.rejects(
  () => executeIdentityCommand({ ...parseIdentityCliArgs(["provision-service", "db_alpha", "writer"], env), networkUrl: "" }, fakeActor, identity),
  /networkUrl must be a non-empty string/
);
const provisionServiceDatabaseResult = await executeIdentityCommand(parseIdentityCliArgs(["--service-identity-type", "ed25519", "provision-service-db", "writer"], env), fakeActor, identity);
assert.equal(provisionServiceDatabaseResult.database_id, "db_new");
assert.equal(provisionServiceDatabaseResult.env.ICPDB_DATABASE_ID, "db_new");
assert.equal(provisionServiceDatabaseResult.env.ICPDB_URL, `icpdb://${env.ICPDB_CANISTER_ID}/db_new`);
assert.equal(provisionServiceDatabaseResult.role, "writer");
assert.equal(provisionServiceDatabaseResult.identity_type, "ed25519");
assert.deepEqual(calls.at(-1), {
  method: "grant",
  databaseId: "db_new",
  principal: provisionServiceDatabaseResult.principal,
  role: { Writer: null }
});
const provisionGrantFailureDeletes = [];
await assert.rejects(
  () => executeIdentityCommand(parseIdentityCliArgs(["--service-identity-type", "ed25519", "provision-service-db", "writer"], env), {
    ...fakeActor,
    grant_database_access: async () => ({ Err: "grant failed" }),
    delete_database: async (databaseId) => {
      provisionGrantFailureDeletes.push(databaseId);
      return { Ok: null };
    }
  }, identity),
  /grant failed/
);
assert.deepEqual(provisionGrantFailureDeletes, ["db_new"]);
const provisionServiceDatabaseSetupResult = await executeIdentityCommand(
  parseIdentityCliArgs(["--service-identity-type", "ed25519", "provision-service-db", "writer", "--statement", "CREATE TABLE setup(id INTEGER)"], env),
  fakeActor,
  identity
);
assert.equal(provisionServiceDatabaseSetupResult.database_id, "db_new");
assert.equal(provisionServiceDatabaseSetupResult.setup_statement_count, 1);
assert.equal(provisionServiceDatabaseSetupResult.setup_rows_affected, "1");
assert.equal(calls.at(-2).method, "batch");
assert.equal(calls.at(-2).request.database_id, "db_new");
assert.equal(calls.at(-1).method, "grant");
const provisionSetupSqlFailureDeletes = [];
await assert.rejects(
  () => executeIdentityCommand(parseIdentityCliArgs(["--service-identity-type", "ed25519", "provision-service-db", "writer", "--statement", "CREATE TABLE failing_setup(id INTEGER)"], env), {
    ...fakeActor,
    sql_batch: async () => ({ Err: "setup failed" }),
    delete_database: async (databaseId) => {
      provisionSetupSqlFailureDeletes.push(databaseId);
      return { Ok: null };
    }
  }, identity),
  /setup failed/
);
assert.deepEqual(provisionSetupSqlFailureDeletes, ["db_new"]);
const provisionServiceDatabaseSetupStatementsFileResult = await executeIdentityCommand(
  parseIdentityCliArgs(["--service-identity-type", "ed25519", "provision-service-db", "writer", "--statements-file", statementsFilePath], env),
  fakeActor,
  identity
);
assert.equal(provisionServiceDatabaseSetupStatementsFileResult.database_id, "db_new");
assert.equal(provisionServiceDatabaseSetupStatementsFileResult.setup_statement_count, 1);
assert.deepEqual(calls.at(-2).request.statements[0].params, [{ Text: "from-statements-file" }]);
assert.equal(calls.at(-1).method, "grant");
const provisionServiceDatabaseSetupFileResult = await executeIdentityCommand({
  ...parseIdentityCliArgs(["--service-identity-type", "ed25519", "provision-service-db", "writer", "--setup-file", "-"], env),
  stdinText: "CREATE TABLE provision_setup_file(id INTEGER);"
}, fakeActor, identity);
assert.equal(provisionServiceDatabaseSetupFileResult.database_id, "db_new");
assert.equal(provisionServiceDatabaseSetupFileResult.setup_statement_count, 1);
assert.equal(calls.at(-2).method, "batch");
assert.equal(calls.at(-2).request.statements[0].sql, "CREATE TABLE provision_setup_file(id INTEGER)");
assert.equal(calls.at(-1).method, "grant");
const provisionServiceDatabaseSetupMigrationsResult = await executeIdentityCommand({
  ...parseIdentityCliArgs(["--service-identity-type", "ed25519", "provision-service-db", "writer", "--setup-migrations-file", "-"], env),
  stdinText: JSON.stringify([{
    version: "provision-setup-001",
    name: "create_provision_setup_migrated",
    sql: "CREATE TABLE provision_setup_migrated(id INTEGER);"
  }])
}, fakeActor, identity);
assert.equal(provisionServiceDatabaseSetupMigrationsResult.database_id, "db_new");
assert.equal(provisionServiceDatabaseSetupMigrationsResult.setup_migration_count, 1);
assert.deepEqual(provisionServiceDatabaseSetupMigrationsResult.setup_migration_applied, ["provision-setup-001"]);
assert.equal(provisionServiceDatabaseSetupMigrationsResult.setup_statement_count, 1);
assert.equal(provisionServiceDatabaseSetupMigrationsResult.setup_rows_affected, "2");
assert.equal(calls.at(-2).request.statements[0].sql, "CREATE TABLE provision_setup_migrated(id INTEGER)");
assert.equal(calls.at(-1).method, "grant");
await executeIdentityCommand(parseIdentityCliArgs(["delete-db", "db_alpha"], env), fakeActor, identity);
assert.deepEqual(calls.at(-1), { method: "delete", databaseId: "db_alpha" });

const tempDir = await mkdtemp(join(tmpdir(), "icpdb-identity-cli-check-"));
const envFilePath = join(tempDir, "service.env");
const dotEnvFilePath = join(tempDir, ".env");
const invalidEnvFilePath = join(tempDir, "invalid.env");
const openEnvFilePath = join(tempDir, "open-service.env");
const archivePath = join(tempDir, "archive.sqlite");
const dumpPath = join(tempDir, "dump.sql");
const scriptPath = join(tempDir, "setup.sql");
const migrationsPath = join(tempDir, "migrations.json");
await writeFile(envFilePath, [
  "# service identity env",
  "ICPDB_CANISTER_ID=\"ryjl3-tyaaa-aaaaa-aaaba-cai\"",
  "ICPDB_DATABASE_ID=\"db_from_file\"",
  "ICPDB_URL=\"icpdb://ryjl3-tyaaa-aaaaa-aaaba-cai/db_from_file\"",
  "ICPDB_NETWORK_URL=\"http://localhost:8001\"",
  "ICPDB_IDENTITY_TYPE=secp256k1",
  `ICPDB_IDENTITY_JSON=${JSON.stringify(env.ICPDB_IDENTITY_JSON)}`,
  "ICPDB_ROOT_KEY=aabbcc"
].join("\n"));
await writeIdentityEnvOutputFile(envFilePath, createDatabaseEnvResult);
assert.equal((await stat(envFilePath)).mode & 0o777, 0o600);
assert.match(await readFile(envFilePath, "utf8"), /ICPDB_DATABASE_ID="db_new"/);
await writeIdentityEnvOutputFile(envFilePath, connectionUrlResult);
assert.match(await readFile(envFilePath, "utf8"), /ICPDB_URL="icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db%2Fslash"/);
await writeIdentityEnvOutputFile(envFilePath, createDatabaseEnvResult);
const failingEnvOutDeletes = [];
await assert.rejects(() => writeIdentityEnvOutputFileOrDelete(
  join(tempDir, "missing-dir", "service.env"),
  createDatabaseEnvResult,
  parseIdentityCliArgs(["--env-out", "service.env", "create-db"], env),
  {
    delete_database: async (databaseId) => {
      failingEnvOutDeletes.push(databaseId);
      return { Ok: null };
    }
  }
), /ENOENT/);
assert.deepEqual(failingEnvOutDeletes, ["db_new"]);
const failingProvisionEnvOutDeletes = [];
await assert.rejects(() => writeIdentityEnvOutputFileOrDelete(
  join(tempDir, "missing-dir", "provision-service.env"),
  provisionServiceDatabaseResult,
  parseIdentityCliArgs(["--env-out", "service.env", "provision-service-db", "writer"], env),
  {
    delete_database: async (databaseId) => {
      failingProvisionEnvOutDeletes.push(databaseId);
      return { Ok: null };
    }
  }
), /ENOENT/);
assert.deepEqual(failingProvisionEnvOutDeletes, ["db_new"]);
const envFileCommand = parseIdentityCliArgs(["--env-file", envFilePath, "execute", "SELECT", "1"], {});
assert.equal(envFileCommand.canisterId, "ryjl3-tyaaa-aaaaa-aaaba-cai");
assert.equal(envFileCommand.databaseId, "db_new");
assert.equal(envFileCommand.identityType, "secp256k1");
assert.equal(envFileCommand.identityJson, env.ICPDB_IDENTITY_JSON);
assert.equal(envFileCommand.sql, "SELECT 1");
const envFileEnvCommand = parseIdentityCliArgs(["query", "SELECT", "1"], { ICPDB_ENV_FILE: envFilePath });
assert.equal(envFileEnvCommand.canisterId, "ryjl3-tyaaa-aaaaa-aaaba-cai");
assert.equal(envFileEnvCommand.databaseId, "db_new");
assert.equal(envFileEnvCommand.identityJson, env.ICPDB_IDENTITY_JSON);
assert.equal(envFileEnvCommand.sql, "SELECT 1");
await writeIdentityEnvOutputFile(dotEnvFilePath, createDatabaseEnvResult);
assert.equal((await stat(dotEnvFilePath)).mode & 0o777, 0o600);
const explicitDotEnvCommand = parseIdentityCliArgs(["--env-file", dotEnvFilePath, "query", "SELECT", "1"], {});
assert.equal(explicitDotEnvCommand.databaseId, "db_new");
assert.equal(explicitDotEnvCommand.identityJson, env.ICPDB_IDENTITY_JSON);
const inheritedDotEnvCommand = parseIdentityCliArgs(["tables"], { ICPDB_ENV_FILE: dotEnvFilePath });
assert.equal(inheritedDotEnvCommand.databaseId, "db_new");
assert.equal(inheritedDotEnvCommand.tables, true);
{
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    const defaultEnvFileCommand = parseIdentityCliArgs(["query", "SELECT", "1"], {});
    assert.equal(defaultEnvFileCommand.canisterId, "ryjl3-tyaaa-aaaaa-aaaba-cai");
    assert.equal(defaultEnvFileCommand.databaseId, "db_new");
    assert.equal(defaultEnvFileCommand.identityJson, env.ICPDB_IDENTITY_JSON);
    assert.equal(defaultEnvFileCommand.sql, "SELECT 1");
    assert.equal(parseIdentityCliArgs(["snapshot-info", snapshotInfoPath], {}).filePath, snapshotInfoPath);
    assert.equal(parseIdentityCliArgs(["generate-identity"], {}).canisterId, "");
    assert.equal(parseIdentityCliArgs(["--identity-json", env.ICPDB_IDENTITY_JSON, "principal"], {}).databaseId, "");
  } finally {
    process.chdir(previousCwd);
  }
}
const envFileArchiveCommand = parseIdentityCliArgs(["archive", "/tmp/from-env.sqlite"], { ICPDB_ENV_FILE: envFilePath });
assert.equal(envFileArchiveCommand.databaseId, "db_new");
assert.equal(envFileArchiveCommand.filePath, "/tmp/from-env.sqlite");
assert.equal(parseIdentityCliArgs(["--format", "env", "archive", "db_new", "/tmp/from-env.sqlite"], env).outputFormat, "env");
assert.throws(() => parseIdentityCliArgs(["--env-out", "/tmp/archive.env", "archive", "db_new", "/tmp/from-env.sqlite"], env), /--format env and --env-out are only valid/);
const envFileRestoreCommand = parseIdentityCliArgs([
  "restore",
  "/tmp/from-env.sqlite",
  "--expect-snapshot-hash",
  "AA".repeat(32)
], { ICPDB_ENV_FILE: envFilePath });
assert.equal(envFileRestoreCommand.databaseId, "db_new");
assert.equal(envFileRestoreCommand.expectedSnapshotHash, "aa".repeat(32));
assert.equal(parseIdentityCliArgs(["--env-file", envFilePath, "query", "SELECT", "1"], { ICPDB_ENV_FILE: invalidEnvFilePath }).databaseId, "db_new");
assert.match(await readFile(envFilePath, "utf8"), /ICPDB_URL="icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_new"/);
assert.equal(parseIdentityCliArgs(["--env-file", envFilePath, "--database-id", "db_arg", "execute", "SELECT", "1"], {}).databaseId, "db_arg");
await writeFile(invalidEnvFilePath, "not-an-env-line");
await chmod(invalidEnvFilePath, 0o600);
assert.throws(() => parseIdentityCliArgs(["--env-file", invalidEnvFilePath, "execute", "SELECT", "1"], {}), /invalid env file line 1/);
const duplicateEnvFilePath = join(tempDir, "duplicate-service.env");
await writeFile(duplicateEnvFilePath, "ICPDB_CANISTER_ID=\"aaaaa-aa\"\nICPDB_CANISTER_ID=\"bbbbb-bb\"\n");
await chmod(duplicateEnvFilePath, 0o600);
assert.throws(() => parseIdentityCliArgs(["--env-file", duplicateEnvFilePath, "principal"], {}), /duplicate env key ICPDB_CANISTER_ID/);
assert.throws(() => parseIdentityCliArgs(["principal"], { ICPDB_ENV_FILE: duplicateEnvFilePath }), /duplicate env key ICPDB_CANISTER_ID/);
await writeFile(openEnvFilePath, "ICPDB_CANISTER_ID=ryjl3-tyaaa-aaaaa-aaaba-cai\nICPDB_IDENTITY_JSON=[]\n");
await chmod(openEnvFilePath, 0o644);
assert.throws(() => parseIdentityCliArgs(["--env-file", openEnvFilePath, "principal"], {}), /owner-only/);
assert.throws(() => parseIdentityCliArgs(["principal"], { ICPDB_ENV_FILE: openEnvFilePath }), /owner-only/);
const generatedEnvPath = join(tempDir, "generated.env");
const envOutResult = await execFileAsync(process.execPath, ["scripts/icpdb-identity.mjs", "--identity-type", "ed25519", "--env-out", generatedEnvPath, "generate-identity"]);
assert.equal(envOutResult.stdout, "");
assert.equal((await stat(generatedEnvPath)).mode & 0o777, 0o600);
assert.match(await readFile(generatedEnvPath, "utf8"), /^ICPDB_IDENTITY_TYPE="ed25519"\nICPDB_IDENTITY_PRINCIPAL=/);
const controllerEnvPath = join(tempDir, "controller.env");
await execFileAsync(process.execPath, [
  "scripts/icpdb-identity.mjs",
  "--canister-id",
  env.ICPDB_CANISTER_ID,
  "--network-url",
  env.ICPDB_NETWORK_URL,
  "--env-out",
  controllerEnvPath,
  "generate-identity"
]);
const controllerEnvText = await readFile(controllerEnvPath, "utf8");
assert.match(controllerEnvText, /ICPDB_CANISTER_ID="ryjl3-tyaaa-aaaaa-aaaba-cai"/);
assert.match(controllerEnvText, /ICPDB_NETWORK_URL="http:\/\/localhost:8001"/);
const controllerInspectOutput = await execFileAsync(process.execPath, [
  "scripts/icpdb-identity.mjs",
  "--env-file",
  controllerEnvPath,
  "inspect-env",
  "--format",
  "table"
]);
assert.match(controllerInspectOutput.stdout, /ryjl3-tyaaa-aaaaa-aaaba-cai/);
assert.match(controllerInspectOutput.stdout, /http:\/\/localhost:8001/);
const browserIiServiceEnvPath = join(tempDir, "browser-ii-service.env");
await execFileAsync(process.execPath, [
  "scripts/icpdb-identity.mjs",
  "--canister-id",
  env.ICPDB_CANISTER_ID,
  "--database-id",
  "db_browser_ii",
  "--network-url",
  env.ICPDB_NETWORK_URL,
  "--env-out",
  browserIiServiceEnvPath,
  "generate-identity"
]);
const browserIiServiceEnvText = await readFile(browserIiServiceEnvPath, "utf8");
assert.match(browserIiServiceEnvText, /ICPDB_CANISTER_ID="ryjl3-tyaaa-aaaaa-aaaba-cai"/);
assert.match(browserIiServiceEnvText, /ICPDB_DATABASE_ID="db_browser_ii"/);
assert.match(browserIiServiceEnvText, /ICPDB_URL="icpdb:\/\/ryjl3-tyaaa-aaaaa-aaaba-cai\/db_browser_ii"/);
assert.match(browserIiServiceEnvText, /ICPDB_NETWORK_URL="http:\/\/localhost:8001"/);
const browserIiInspectOutput = await execFileAsync(process.execPath, [
  "scripts/icpdb-identity.mjs",
  "--env-file",
  browserIiServiceEnvPath,
  "inspect-env",
  "--format",
  "table"
]);
assert.match(browserIiInspectOutput.stdout, /principal/);
assert.match(browserIiInspectOutput.stdout, new RegExp(env.ICPDB_CANISTER_ID));
const browserIiServiceCheckOutput = await execFileAsync(process.execPath, [
  "scripts/icpdb-service-env-check.mjs",
  "--env-file",
  browserIiServiceEnvPath,
  "--skip-call",
  "--format",
  "table"
]);
assert.match(browserIiServiceCheckOutput.stdout, /file_mode\t0600/);
assert.match(browserIiServiceCheckOutput.stdout, /database_id\tdb_browser_ii/);
assert.match(browserIiServiceCheckOutput.stdout, /checks\tinspect-env/);
const helpSqlResult = await execFileAsync(process.execPath, ["scripts/icpdb-identity.mjs", "help", "sql"], { env: {} });
assert.match(helpSqlResult.stdout, /sql auto-routes read SQL to query and write SQL to execute/);
assert.doesNotMatch(helpSqlResult.stdout, /provision-service-db/);
const connectionUrlCliOutput = await execFileAsync(process.execPath, [
  "scripts/icpdb-identity.mjs",
  "--canister-id",
  env.ICPDB_CANISTER_ID,
  "--database-id",
  "db_cli",
  "--format",
  "env",
  "url"
]);
assert.equal(connectionUrlCliOutput.stdout.trim(), [
  `ICPDB_CANISTER_ID=${JSON.stringify(env.ICPDB_CANISTER_ID)}`,
  "ICPDB_DATABASE_ID=\"db_cli\"",
  `ICPDB_URL=${JSON.stringify(`icpdb://${env.ICPDB_CANISTER_ID}/db_cli`)}`
].join("\n"));
const snapshotInfoCliOutput = await execFileAsync(process.execPath, ["scripts/icpdb-identity.mjs", "snapshot-info", snapshotInfoPath]);
assert.match(snapshotInfoCliOutput.stdout, /snapshot_hash/);
assert.match(snapshotInfoCliOutput.stdout, /039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81/);
await writeFile(dumpPath, "-- dump pragma\nPRAGMA foreign_keys=OFF; /* dump begin */ BEGIN; CREATE TABLE loaded(id INTEGER); INSERT INTO loaded(id) VALUES (1); CREATE TABLE [identity_loaded;bracketed](id INTEGER); INSERT INTO [identity_loaded;bracketed](id) VALUES (1); -- trigger load\nCREATE TRIGGER identity_loaded_guard AFTER INSERT ON loaded BEGIN UPDATE loaded SET id = CASE WHEN NEW.id IS NULL THEN 0 ELSE NEW.id END; END; -- dump commit\nCOMMIT;");
const loadResult = await executeIdentityCommand(parseIdentityCliArgs(["load", "db_alpha", dumpPath], env), fakeActor, identity);
assert.deepEqual(loadResult, { database_id: "db_alpha", file: dumpPath, statement_count: 5, batch_count: 1, rows_affected: "5" });
assert.equal(calls.at(-1).method, "batch");
assert.equal(calls.at(-1).request.statements.length, 5);
assert.equal(calls.at(-1).request.statements[2].sql, "CREATE TABLE [identity_loaded;bracketed](id INTEGER)");
assert.equal(calls.at(-1).request.statements[4].sql, "-- trigger load\nCREATE TRIGGER identity_loaded_guard AFTER INSERT ON loaded BEGIN UPDATE loaded SET id = CASE WHEN NEW.id IS NULL THEN 0 ELSE NEW.id END; END");
const waitedLoadResult = await executeIdentityCommand(parseIdentityCliArgs(["load", "db_alpha", dumpPath, "--idempotency-key", "cli_wait_load", "--wait"], env), fakeActor, identity);
assert.equal(waitedLoadResult.results[0].routed_operation_id, "cli_wait_load-0");
assert.equal(waitedLoadResult.routed_operations[0].operation_id, "cli_wait_load-0");
assert.deepEqual(calls.at(-2).request.idempotency_key, ["cli_wait_load-0"]);
const stdinLoadCommand = {
  ...parseIdentityCliArgs(["load", "db_alpha", "-"], env),
  stdinText: "PRAGMA foreign_keys=OFF; BEGIN; CREATE TABLE stdin_loaded(id INTEGER); INSERT INTO stdin_loaded(id) VALUES (1); COMMIT;"
};
const stdinLoadResult = await executeIdentityCommand(stdinLoadCommand, fakeActor, identity);
assert.deepEqual(stdinLoadResult, { database_id: "db_alpha", file: "-", statement_count: 2, batch_count: 1, rows_affected: "2" });
assert.equal(calls.at(-1).method, "batch");
assert.equal(calls.at(-1).request.statements[0].sql, "CREATE TABLE stdin_loaded(id INTEGER)");
await writeFile(scriptPath, "CREATE TABLE scripted(id INTEGER); INSERT INTO scripted(id) VALUES (1); CREATE TABLE [identity;bracketed](id INTEGER); INSERT INTO [identity;bracketed](id) VALUES (1); /* trigger script */ CREATE TRIGGER identity_script_guard AFTER INSERT ON scripted BEGIN UPDATE scripted SET id = CASE WHEN NEW.id IS NULL THEN 0 ELSE NEW.id END; END; CREATE TEMPORARY TRIGGER identity_temp_script_guard BEFORE INSERT ON scripted BEGIN SELECT 1; END;");
const scriptResult = await executeIdentityCommand(parseIdentityCliArgs(["script", "db_alpha", scriptPath], env), fakeActor, identity);
assert.deepEqual(scriptResult, { database_id: "db_alpha", file: scriptPath, statement_count: 6, batch_count: 1, rows_affected: "6" });
assert.equal(calls.at(-1).method, "batch");
assert.equal(calls.at(-1).request.statements[0].sql, "CREATE TABLE scripted(id INTEGER)");
assert.equal(calls.at(-1).request.statements[2].sql, "CREATE TABLE [identity;bracketed](id INTEGER)");
assert.equal(calls.at(-1).request.statements[4].sql, "/* trigger script */ CREATE TRIGGER identity_script_guard AFTER INSERT ON scripted BEGIN UPDATE scripted SET id = CASE WHEN NEW.id IS NULL THEN 0 ELSE NEW.id END; END");
assert.equal(calls.at(-1).request.statements[5].sql, "CREATE TEMPORARY TRIGGER identity_temp_script_guard BEFORE INSERT ON scripted BEGIN SELECT 1; END");
const waitedScriptResult = await executeIdentityCommand(parseIdentityCliArgs(["script", "db_alpha", scriptPath, "--idempotency-key", "cli_wait_script", "--wait"], env), fakeActor, identity);
assert.equal(waitedScriptResult.results[0].routed_operation_id, "cli_wait_script-0");
assert.equal(waitedScriptResult.routed_operations[0].operation_id, "cli_wait_script-0");
assert.deepEqual(calls.at(-2).request.idempotency_key, ["cli_wait_script-0"]);
const stdinScriptCommand = {
  ...parseIdentityCliArgs(["script", "db_alpha", "-"], env),
  stdinText: "CREATE TABLE stdin_scripted(id INTEGER); INSERT INTO stdin_scripted(id) VALUES (1);"
};
const stdinScriptResult = await executeIdentityCommand(stdinScriptCommand, fakeActor, identity);
assert.deepEqual(stdinScriptResult, { database_id: "db_alpha", file: "-", statement_count: 2, batch_count: 1, rows_affected: "2" });
assert.equal(calls.at(-1).request.statements[0].sql, "CREATE TABLE stdin_scripted(id INTEGER)");
await writeFile(migrationsPath, JSON.stringify([
  { version: "existing-001", sql: "CREATE TABLE skipped_migration(id INTEGER);" },
  {
    version: "identity-001",
    name: "create_identity_migrated",
    sql: "CREATE TABLE identity_migrated(id INTEGER); INSERT INTO identity_migrated(id) VALUES (1);"
  }
]));
const migrateResult = await executeIdentityCommand(parseIdentityCliArgs(["migrate", "db_alpha", migrationsPath], env), fakeActor, identity);
assert.deepEqual(migrateResult, {
  database_id: "db_alpha",
  file: migrationsPath,
  migration_count: 2,
  applied: ["identity-001"],
  skipped: ["existing-001"],
  statement_count: 2,
  batch_count: 2,
  rows_affected: "3"
});
assert.equal(calls.at(-4).method, "query");
assert.equal(calls.at(-3).request.statements[0].sql, "CREATE TABLE icpdb_schema_migrations(version TEXT PRIMARY KEY, name TEXT, applied_at_ms TEXT NOT NULL)");
assert.equal(calls.at(-1).request.statements[0].sql, "CREATE TABLE identity_migrated(id INTEGER)");
assert.equal(calls.at(-1).request.statements[2].sql, "INSERT INTO icpdb_schema_migrations(version, name, applied_at_ms) VALUES (?1, ?2, ?3)");
assert.deepEqual(calls.at(-1).request.statements[2].params.slice(0, 2), [{ Text: "identity-001" }, { Text: "create_identity_migrated" }]);
const waitedMigrateResult = await executeIdentityCommand(parseIdentityCliArgs(["migrate", "db_alpha", migrationsPath, "--idempotency-key", "cli_wait_migrate", "--wait"], env), fakeActor, identity);
assert.equal(waitedMigrateResult.results[0].routed_operation_id, "cli_wait_migrate-ensure");
assert.equal(waitedMigrateResult.results.at(-1).routed_operation_id, "cli_wait_migrate-0");
assert.deepEqual(waitedMigrateResult.routed_operations.map((operation) => operation.operation_id), ["cli_wait_migrate-ensure", "cli_wait_migrate-0"]);
assert.deepEqual(calls.slice(-6).filter((call) => call.method === "batch").map((call) => call.request.idempotency_key), [
  ["cli_wait_migrate-ensure"],
  ["cli_wait_migrate-0"]
]);
await assert.rejects(() => executeIdentityCommand({
  ...parseIdentityCliArgs(["migrate", "db_alpha", "-"], env),
  stdinText: JSON.stringify([{ version: "dup", sql: "SELECT 1;" }, { version: "dup", sql: "SELECT 2;" }])
}, fakeActor, identity), /duplicate migration version: dup/);
const archiveResult = await executeIdentityCommand(parseIdentityCliArgs(["archive", "db_alpha", archivePath], env), fakeActor, identity);
assert.deepEqual([...await readFile(archivePath)], [1, 2, 3]);
assert.equal(archiveResult.size_bytes, "3");
assert.equal(calls.at(-1).method, "archive-finalize");
assert.equal(formatIdentityCommandOutput(archiveResult, { archive: true, outputFormat: "env" }), [
  `ICPDB_SNAPSHOT_DATABASE_ID=${JSON.stringify("db_alpha")}`,
  `ICPDB_SNAPSHOT_FILE=${JSON.stringify(archivePath)}`,
  `ICPDB_SNAPSHOT_SIZE_BYTES=${JSON.stringify("3")}`,
  `ICPDB_SNAPSHOT_HASH=${JSON.stringify(archiveResult.snapshot_hash)}`
].join("\n"));
await assert.rejects(
  () => executeIdentityCommand(parseIdentityCliArgs(["archive", "db_alpha", archivePath], env), {
    ...fakeActor,
    begin_database_archive: async () => ({ Ok: { database_id: "db_alpha", size_bytes: BigInt(Number.MAX_SAFE_INTEGER) + 1n } })
  }, identity),
  /archive size_bytes exceeds JavaScript safe integer range/
);
assert.equal(calls.at(-1).method, "archive-cancel");
await writeFile(archivePath, Buffer.from([4, 5, 6]));
const archiveHash = createHash("sha256").update(Buffer.from([4, 5, 6])).digest("hex");
const restoreResult = await executeIdentityCommand(parseIdentityCliArgs(["restore", "db_alpha", archivePath, "--expect-snapshot-hash", archiveHash], env), fakeActor, identity);
assert.equal(restoreResult.size_bytes, "3");
assert.equal(calls.at(-1).method, "restore-finalize");
const largeSnapshot = Buffer.alloc(256 * 1024 + 5);
largeSnapshot[0] = 1;
largeSnapshot[256 * 1024] = 2;
largeSnapshot[largeSnapshot.length - 1] = 3;
await writeFile(archivePath, largeSnapshot);
const largeSnapshotHash = createHash("sha256").update(largeSnapshot).digest("hex");
const largeRestoreStart = calls.length;
const largeRestoreResult = await executeIdentityCommand(parseIdentityCliArgs(["restore", "db_alpha", archivePath, "--expect-snapshot-hash", largeSnapshotHash], env), fakeActor, identity);
const largeRestoreCalls = calls.slice(largeRestoreStart);
assert.equal(largeRestoreResult.size_bytes, String(largeSnapshot.length));
assert.deepEqual(largeRestoreCalls.map((call) => call.method), ["restore-begin", "restore-write", "restore-write", "restore-finalize"]);
assert.equal(largeRestoreCalls[0].sizeBytes, BigInt(largeSnapshot.length));
assert.equal(largeRestoreCalls[1].request.offset, 0n);
assert.equal(largeRestoreCalls[1].request.bytes.length, 256 * 1024);
assert.equal(largeRestoreCalls[2].request.offset, BigInt(256 * 1024));
assert.deepEqual(largeRestoreCalls[2].request.bytes, [2, 0, 0, 0, 3]);
const restoreCallCount = calls.length;
await assert.rejects(
  () => executeIdentityCommand(parseIdentityCliArgs(["restore", "db_alpha", archivePath, "--expect-snapshot-hash", "aa".repeat(32)], env), fakeActor, identity),
  /snapshot hash mismatch/
);
assert.equal(calls.length, restoreCallCount);
const snapshotInfoResult = await executeIdentityCommand(parseIdentityCliArgs(["snapshot-info", archivePath], {}), null, null);
assert.deepEqual(snapshotInfoResult, {
  file: archivePath,
  size_bytes: String(largeSnapshot.length),
  snapshot_hash: largeSnapshotHash
});
assert.match(formatIdentityCommandOutput(snapshotInfoResult, { outputFormat: "table" }), /snapshot_hash/);
assert.equal(formatIdentityCommandOutput(snapshotInfoResult, { snapshotInfo: true, outputFormat: "env" }), [
  `ICPDB_SNAPSHOT_FILE=${JSON.stringify(archivePath)}`,
  `ICPDB_SNAPSHOT_SIZE_BYTES=${JSON.stringify(String(largeSnapshot.length))}`,
  `ICPDB_SNAPSHOT_HASH=${JSON.stringify(largeSnapshotHash)}`
].join("\n"));

console.log("ICPDB identity CLI checks OK");
