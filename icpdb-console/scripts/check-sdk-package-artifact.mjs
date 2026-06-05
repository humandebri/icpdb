// Where: icpdb-console/scripts/check-sdk-package-artifact.mjs
// What: Verify the generated standalone SDK package manifest and entry files.
// Why: The SDK should be installable without dragging the Next.js console package surface.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const consoleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (resolve(process.cwd()) !== consoleRoot) {
  process.chdir(consoleRoot);
}
const tscBin = join(process.cwd(), "node_modules/.bin/tsc");

function npmArtifactEnv(cacheDir) {
  return { ...process.env, npm_config_cache: cacheDir, npm_config_ignore_scripts: "true" };
}

const manifest = JSON.parse(readFileSync("dist-sdk/package.json", "utf8"));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function helpTopicsFromUsage(helpOutput) {
  const match = helpOutput.match(/icpdb help \[([^\]]+)\]/);
  assert.notEqual(match, null, "CLI help usage topic list missing");
  return match[1].split("|").map((topic) => topic.trim()).filter((topic) => topic.length > 0);
}

function assertReadmeListsHelpTopics(readmeSource, topics, label) {
  for (const topic of topics) {
    assert.match(readmeSource, new RegExp(`^icpdb help ${escapeRegExp(topic)}$`, "m"), `${label} missing help topic ${topic}`);
  }
}

function assertReadmeShowsFastStartSqlPath(readmeSource, label) {
  assert.match(
    readmeSource,
    /Shortest app path:[\s\S]*const db = createClient\(\{ canisterId, identity, setupSql: "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT\)" \}\);[\s\S]*await db\.execute\(sql`INSERT INTO notes\(body\) VALUES \(\$\{"hello"\}\)`\);[\s\S]*const result = await db\.query\("SELECT id, body FROM notes ORDER BY id DESC"\);[\s\S]*const rows = result\.rows;[\s\S]*const connectionUrl = await db\.connectionUrl\(\);[\s\S]*const info = await db\.info\(\);/,
    `${label} Fast Start app path must show createClient to execute/query/handoff order`
  );
  assert.match(
    readmeSource,
    /Hosted SQLite apps can use the same client through the explicit SQL DB subpath:[\s\S]*import \{ createSqliteClient, sql as sqliteSql, type SqliteRow \} from "@icpdb\/client\/sqlite";[\s\S]*const sqliteDb = createSqliteClient\(\{ canisterId, identity, setupSql: "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT\)" \}\);[\s\S]*await sqliteDb\.execute\(sqliteSql`INSERT INTO notes\(body\) VALUES \(\$\{"from-sqlite"\}\)`\);[\s\S]*const sqliteRows: SqliteRow\[\] = \(await sqliteDb\.query\("SELECT id, body FROM notes ORDER BY id DESC"\)\)\.rows;[\s\S]*const sqliteUrl = await sqliteDb\.connectionUrl\(\);/,
    `${label} Fast Start should show hosted SQLite subpath create/execute/query/handoff`
  );
  assert.match(
    readmeSource,
    /Shortest Server\/CI path after `service\.env` exists:[\s\S]*import \{ createClientFromEnvFile \} from "@icpdb\/client\/server";[\s\S]*const db = await createClientFromEnvFile\(\);[\s\S]*await db\.execute\("INSERT INTO notes\(body\) VALUES \(\?1\)", \["from-ci"\]\);[\s\S]*const result = await db\.query\("SELECT id, body FROM notes ORDER BY id DESC"\);[\s\S]*const rows = result\.rows;[\s\S]*const connectionUrl = await db\.connectionUrl\(\);[\s\S]*const info = await db\.info\(\);[\s\S]*const ciDb = await createClientFromEnvFile\("\.\/ci\/service\.env"\);/,
    `${label} Fast Start Server/CI path must show env client to execute/query/handoff order and explicit env-file path`
  );
  assert.match(readmeSource, /libSQL-shaped app code[\s\S]*keep (?:the )?SQL calls and replace only connection\/auth/, `${label} Fast Start should explain libSQL connection/auth replacement`);
  assert.match(readmeSource, /import \{ createLibsqlClient \} from "@icpdb\/client\/libsql";/, `${label} Fast Start should import libSQL subpath`);
  assert.match(readmeSource, /const libsqlDb = createLibsqlClient\(\{[\s\S]*url: connectionUrl,[\s\S]*identity[\s\S]*\}\);/, `${label} Fast Start should create libSQL-shaped client from connectionUrl and identity`);
  assert.match(readmeSource, /await libsqlDb\.execute\(\{ sql: "INSERT INTO notes\(body\) VALUES \(:body\)", args: \{ body: "from-libsql" \} \}\);/, `${label} Fast Start should show libSQL-shaped execute args`);
  assert.match(readmeSource, /const libsqlRows = \(await libsqlDb\.execute\("SELECT id, body FROM notes ORDER BY id DESC"\)\)\.rows;/, `${label} Fast Start should show libSQL-shaped read execute rows`);
  assert.match(readmeSource, /libsqlDb\.close\(\);/, `${label} Fast Start should show libSQL-shaped close`);
  assert.match(
    readmeSource,
    /If `service\.env` only has a canister URL and no setup SQL[\s\S]*const smokeDb = await createClientFromEnvFile\(\);[\s\S]*const firstValue = await smokeDb\.scalar\("SELECT 1 AS value"\);[\s\S]*const createResult = await smokeDb\.execute\(\{[\s\S]*sql: "CREATE TABLE readiness_query_only\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)"[\s\S]*idempotencyKey: "readiness-query-only-create-table-001"[\s\S]*wait: true[\s\S]*const writeResult = await smokeDb\.execute\(\{[\s\S]*sql: "INSERT INTO readiness_query_only\(body\) VALUES \(\?1\)"[\s\S]*args: \["readiness-query-only"\][\s\S]*idempotencyKey: "readiness-query-only-write-001"[\s\S]*wait: \{ reconcileUnknown: true \}[\s\S]*const smokeRows = await smokeDb\.queryRows\("SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1"\);[\s\S]*const persistedUrl = await smokeDb\.connectionUrl\(\);[\s\S]*const smokeInfo = await smokeDb\.info\(\);/,
    `${label} Fast Start Server/CI path must show canister-only create/execute/query handoff`
  );
}

assert.equal(manifest.name, "@icpdb/client");
assert.equal(manifest.description, "Identity-first TypeScript client for ICPDB hosted SQLite databases on the Internet Computer.");
assert.deepEqual(manifest.keywords, ["icp", "internet-computer", "sqlite", "database", "libsql", "turso"]);
assert.deepEqual(manifest.repository, {
  type: "git",
  url: "git+https://github.com/humandebri/icpdb.git",
  directory: "icpdb-console/dist-sdk"
});
assert.deepEqual(manifest.bugs, { url: "https://github.com/humandebri/icpdb/issues" });
assert.equal(manifest.homepage, "https://github.com/humandebri/icpdb#readme");
assert.equal(manifest.type, "module");
assert.equal(manifest.main, "./icpdb-sdk.js");
assert.equal(manifest.module, "./icpdb-sdk.js");
assert.equal(manifest.types, "./icpdb-sdk.d.ts");
assert.deepEqual(manifest.typesVersions, {
  "*": {
    web: ["icpdb-sdk.d.ts"],
    browser: ["icpdb-sdk.d.ts"],
    node: ["icpdb-node.d.ts"],
    libsql: ["icpdb-libsql.d.ts"],
    sqlite: ["icpdb-sqlite.d.ts"],
    server: ["icpdb-server.d.ts"],
    "service-identity": ["icpdb-service-identity.d.ts"]
  }
});
assert.equal(manifest.sideEffects, false);
assert.deepEqual(manifest.engines, { node: ">=18" });
assert.deepEqual(manifest.publishConfig, { access: "public" });
assert.deepEqual(manifest.files, ["*.js", "*.d.ts", "README.md", "package.json"]);
assert.deepEqual(manifest.bin, { icpdb: "./icpdb-cli.js" });
assert.deepEqual(Object.keys(manifest.dependencies), ["@icp-sdk/core"]);
assert.deepEqual(Object.keys(manifest.exports), [".", "./web", "./browser", "./node", "./libsql", "./sqlite", "./server", "./service-identity", "./package.json"]);
assert.deepEqual(manifest.exports["./web"], manifest.exports["."]);
assert.deepEqual(manifest.exports["./browser"], manifest.exports["."]);
assert.deepEqual(manifest.exports["./node"], {
  types: "./icpdb-node.d.ts",
  import: "./icpdb-node.js"
});
assert.deepEqual(manifest.exports["./libsql"], {
  types: "./icpdb-libsql.d.ts",
  import: "./icpdb-libsql.js"
});
assert.deepEqual(manifest.exports["./sqlite"], {
  types: "./icpdb-sqlite.d.ts",
  import: "./icpdb-sqlite.js"
});
assert.deepEqual(manifest.exports["./server"], {
  types: "./icpdb-server.d.ts",
  import: "./icpdb-server.js"
});
assert.equal(manifest.exports["./package.json"], "./package.json");

for (const entry of Object.values(manifest.exports).filter((value) => typeof value === "object")) {
  assert.equal(typeof entry.import, "string");
  assert.equal(typeof entry.types, "string");
  assert.equal(existsSync(`dist-sdk/${entry.import.replace("./", "")}`), true, `${entry.import} missing`);
  assert.equal(existsSync(`dist-sdk/${entry.types.replace("./", "")}`), true, `${entry.types} missing`);
}

const sdkSource = readFileSync("dist-sdk/icpdb-sdk.js", "utf8");
const sdkTypes = readFileSync("dist-sdk/icpdb-sdk.d.ts", "utf8");
const cliSource = readFileSync("dist-sdk/icpdb-cli.js", "utf8");
const cliTypes = readFileSync("dist-sdk/icpdb-cli.d.ts", "utf8");
const libsqlSource = readFileSync("dist-sdk/icpdb-libsql.js", "utf8");
const libsqlTypes = readFileSync("dist-sdk/icpdb-libsql.d.ts", "utf8");
const sqliteSource = readFileSync("dist-sdk/icpdb-sqlite.js", "utf8");
const sqliteTypes = readFileSync("dist-sdk/icpdb-sqlite.d.ts", "utf8");
const nodeSource = readFileSync("dist-sdk/icpdb-node.js", "utf8");
const nodeTypes = readFileSync("dist-sdk/icpdb-node.d.ts", "utf8");
const serverSource = readFileSync("dist-sdk/icpdb-server.js", "utf8");
const serverTypes = readFileSync("dist-sdk/icpdb-server.d.ts", "utf8");
const databaseCodecSource = readFileSync("dist-sdk/icpdb-database-codec.js", "utf8");
const serviceSource = readFileSync("dist-sdk/icpdb-service-identity.js", "utf8");
const serviceTypes = readFileSync("dist-sdk/icpdb-service-identity.d.ts", "utf8");
const readme = readFileSync("dist-sdk/README.md", "utf8");
const rootReadme = readFileSync("../README.md", "utf8");

assertReadmeShowsFastStartSqlPath(readme, "SDK README");
assertReadmeShowsFastStartSqlPath(rootReadme, "root README");

assert.equal(sdkSource.includes("next/"), false, "SDK artifact must not import Next.js");
assert.equal(sdkSource.includes("react"), false, "SDK artifact must not import React");
assert.equal(sdkSource.includes("node:"), false, "root SDK artifact must not import Node builtins; keep Node-only helpers in node/service-identity entries");
assert.match(cliSource, /^#!\/usr\/bin\/env node/, "SDK package should install an executable icpdb bin");
assert.equal((await stat("dist-sdk/icpdb-cli.js")).mode & 0o111, 0o111, "SDK package bin should be executable after build:sdk");
assert.match(cliSource, /createClientFromEnvFile/, "SDK package bin should use the server env-file SQL client");
assert.match(cliSource, /initPackageServiceDatabase/, "SDK package bin should expose one-command service.env and DB bootstrap");
assert.match(cliSource, /initPackageServiceDatabase[\s\S]*databaseId: created\.databaseId[\s\S]*url: created\.url[\s\S]*connectionUrl: created\.url[\s\S]*postCreateNextCommands\(parsed\.envOut\)/, "SDK package bin init should print the URL handoff and next verification commands");
assert.match(cliSource, /provisionIcpdbServiceEnvFile/, "SDK package bin should expose existing-DB service env provisioning");
assert.match(cliSource, /connectIcpdbServiceDatabaseFromEnv/, "SDK package bin should provision existing DB service envs from an owner env");
assert.match(cliSource, /assertKnownCommand/, "SDK package bin should reject unknown commands before env loading");
assert.match(cliSource, /inspectIcpdbServiceEnvFile/, "SDK package bin should expose service.env inspection");
assert.match(cliSource, /checkPackageServiceEnv/, "SDK package bin should expose package-local service.env verification");
assert.match(cliSource, /smokePackageServiceSql/, "SDK package bin should expose package-local SQL smoke");
assert.match(cliSource, /smokePackageServiceSdk/, "SDK package bin should expose package-local SDK smoke");
assert.match(cliSource, /smokePackageServiceArchiveRestore/, "SDK package bin should expose package-local archive/restore smoke");
assert.match(cliSource, /smokePackageServiceSdkArchiveRestore/, "SDK package bin should expose package-local SDK archive/restore smoke");
assert.match(cliSource, /smokePackageServiceShards/, "SDK package bin should expose package-local shard smoke");
assert.match(cliSource, /smokePackageServiceSdkShards/, "SDK package bin should expose package-local SDK shard smoke");
assert.match(cliSource, /sdk_status/, "SDK package bin check-env should report SDK status proof");
assert.match(cliSource, /sdk_archive_restore_query/, "SDK package bin check-env should report SDK archive/restore proof");
assert.match(cliSource, /sdk_shard_inventory_consistency/, "SDK package bin check-env should report SDK shard proof");
assert.match(cliSource, /caller_role_at_least_/, "SDK package bin check-env should expose role proof checks");
assert.match(cliSource, /statusViewCount/, "SDK package bin check-env should expose view count status proof");
assert.match(cliSource, /ICPDB_SERVICE_CHECK_STATUS_ROW_COUNT/, "SDK package bin check-env should expose row count env proof");
assert.match(cliSource, /ICPDB_SERVICE_PRINCIPAL/, "SDK package bin should expose service principal output");
assert.match(cliSource, /client\.url|urlClient\.url/, "SDK package bin should expose connection URL output");
assert.match(cliSource, /ICPDB_CONNECTION_URL/, "SDK package bin should expose connection URL env aliases");
assert.match(cliSource, /serviceClient\.listDatabases/, "SDK package bin should expose database listing");
assert.match(cliSource, /--params-file/, "SDK package bin should expose file-backed SQL params");
assert.match(cliSource, /idempotencyKey/, "SDK package bin should expose retry-safe write idempotency keys");
assert.match(cliSource, /withOptionalWriteWait/, "SDK package bin should expose write wait handling");
assert.match(cliSource, /rejectReadSqlWriteOptionsForCommand/, "SDK package bin should reject read SQL write-only options before env loading");
assert.match(cliSource, /isReadSql/, "SDK package bin should classify auto-routed SQL before write-only option checks");
assert.match(cliSource, /migrateVersioned/, "SDK package bin should expose retry-safe versioned migrations");
assert.match(cliSource, /icpdb_schema_migrations/, "SDK package bin should record versioned migrations");
assert.match(cliSource, /parseBatchStatements/, "SDK package bin should parse JSON statement batches");
assert.match(cliSource, /client\.transaction/, "SDK package bin should expose transaction statement files");
assert.match(cliSource, /executeScript/, "SDK package bin should expose SQL file execution");
assert.match(cliSource, /loadSqlDump/, "SDK package bin should expose SQL dump loading");
assert.match(cliSource, /dumpSql/, "SDK package bin should expose SQL dump export");
assert.match(cliSource, /dumped: \{ file \}[\s\S]*databaseHandoffFromClient\(client, parsed\.envFile\)/, "SDK package bin dump file output should identify the source DB");
assert.match(cliSource, /dumped: \{ file: dumpFile \}[\s\S]*databaseHandoffFromClient\(client, parsed\.envFile\)/, "SDK package shell dump file output should identify the source DB");
assert.match(cliSource, /parseMigrations/, "SDK package bin should expose JSON versioned migrations");
assert.match(cliSource, /create-db requires canister-only service env/, "SDK package bin should expose explicit database creation");
assert.match(cliSource, /ICPDB_SETUP_SQL: parsed\.setupSql/, "SDK package bin create-db should accept inline setup SQL");
assert.match(cliSource, /ICPDB_SETUP_SQL: await readInputText\(parsed\.setupFile\)/, "SDK package bin create-db should accept setup SQL from stdin");
assert.match(cliSource, /ICPDB_SETUP_STATEMENTS: await readInputText\(parsed\.setupStatementsFile\)/, "SDK package bin create-db should accept setup statements from stdin");
assert.match(cliSource, /ICPDB_SETUP_MIGRATIONS: await readInputText\(parsed\.setupMigrationsFile\)/, "SDK package bin create-db should accept setup migrations from stdin");
assert.match(cliSource, /persistIcpdbServiceDatabaseId/, "SDK package bin create-db should persist created database ids after setup");
assert.match(cliSource, /const createdOutput = \{[\s\S]*canisterId: inspection\.canisterId[\s\S]*databaseId: created\.databaseId[\s\S]*url: created\.url[\s\S]*connectionUrl: created\.url[\s\S]*principal: inspection\.principal[\s\S]*networkUrl: inspection\.networkUrl[\s\S]*postCreateNextCommands\(parsed\.envFile\)[\s\S]*printOutput\(parsed\.format,[\s\S]*ICPDB_CONNECTION_URL: created\.url[\s\S]*createdOutput\)/, "SDK package bin create-db should print flat key/value URL output plus next verification commands for table/json/CSV");
assert.match(cliSource, /nextExecuteCommand[\s\S]*CREATE TABLE icpdb_next_command[\s\S]*nextInsertCommand[\s\S]*INSERT INTO icpdb_next_command\(body\) VALUES \(\?1\)[\s\S]*next-command-insert-001[\s\S]*nextQueryCommand[\s\S]*SELECT count\(\*\) FROM sqlite_schema[\s\S]*nextReadCommand[\s\S]*SELECT id, body FROM icpdb_next_command ORDER BY id DESC LIMIT 5[\s\S]*nextSqlSmokeCommand[\s\S]*check-env[\s\S]*--require-role[\s\S]*writer[\s\S]*--smoke-sql[\s\S]*nextSchemaCountCommand[\s\S]*SELECT count\(\*\) FROM sqlite_schema[\s\S]*nextTablesCommand[\s\S]*tables[\s\S]*nextViewsCommand[\s\S]*views[\s\S]*nextStatsCommand[\s\S]*stats[\s\S]*nextSchemaCommand[\s\S]*schema[\s\S]*icpdb_next_command[\s\S]*nextDescribeCommand[\s\S]*describe[\s\S]*icpdb_next_command[\s\S]*nextPreviewCommand[\s\S]*preview[\s\S]*icpdb_next_command[\s\S]*nextStatusCommand[\s\S]*status[\s\S]*nextMembersCommand[\s\S]*members[\s\S]*nextUrlCommand[\s\S]*url[\s\S]*nextInfoCommand[\s\S]*info/, "SDK package bin create-db next commands should cover direct execute/insert/query/read, SQL smoke, schema count, schema/table inspection, status, members, URL, and info handoff");
assert.match(cliSource, /packageInspectEnvOutput[\s\S]*!inspection\.hasDatabase[\s\S]*nextCreateDbCommand[\s\S]*create-db[\s\S]*nextScalarCommand[\s\S]*SELECT 1 AS value[\s\S]*nextExecuteCommand[\s\S]*CREATE TABLE icpdb_first_sql[\s\S]*nextQueryCommand[\s\S]*SELECT count\(\*\) FROM sqlite_schema[\s\S]*nextInfoCommand[\s\S]*info[\s\S]*nextCheckEnvCommand[\s\S]*check-env[\s\S]*nextQueryCommand[\s\S]*SELECT name FROM sqlite_schema ORDER BY name[\s\S]*nextSchemaCountCommand[\s\S]*SELECT count\(\*\) FROM sqlite_schema[\s\S]*nextTablesCommand[\s\S]*tables[\s\S]*nextViewsCommand[\s\S]*views[\s\S]*nextStatsCommand[\s\S]*stats[\s\S]*nextStatusCommand[\s\S]*status[\s\S]*nextMembersCommand[\s\S]*members[\s\S]*nextUrlCommand[\s\S]*url/, "SDK package bin inspect-env output should point canister-only and database-bearing envs to next commands");
assert.match(cliSource, /printOutput\(parsed\.format, packageServiceEnvCheckEnv\(check\), packageServiceEnvCheckOutput\(check\)\)/, "SDK package bin check-env should keep env output separate from table/json/CSV next commands");
assert.match(cliSource, /function packageServiceEnvCheckOutput[\s\S]*!check\.hasDatabase[\s\S]*nextInspectEnvCommand[\s\S]*inspect-env[\s\S]*nextCreateDbCommand[\s\S]*create-db[\s\S]*nextCheckEnvCommand[\s\S]*--skip-call[\s\S]*nextInfoCommand[\s\S]*info[\s\S]*shardOperatorNextCommands[\s\S]*nextStatusCommand[\s\S]*status[\s\S]*nextMembersCommand[\s\S]*members[\s\S]*nextQueryCommand[\s\S]*SELECT name FROM sqlite_schema ORDER BY name[\s\S]*nextSchemaCountCommand[\s\S]*SELECT count\(\*\) FROM sqlite_schema[\s\S]*nextTablesCommand[\s\S]*tables[\s\S]*nextViewsCommand[\s\S]*views[\s\S]*nextStatsCommand[\s\S]*stats[\s\S]*nextSchemaCommand[\s\S]*schema[\s\S]*nextUrlCommand[\s\S]*url[\s\S]*nextExecuteCommand[\s\S]*CREATE TABLE icpdb_check_env_next[\s\S]*nextInsertCommand[\s\S]*INSERT INTO icpdb_check_env_next\(body\) VALUES \(\?1\)[\s\S]*nextReadCommand[\s\S]*SELECT id, body FROM icpdb_check_env_next ORDER BY id DESC LIMIT 5[\s\S]*nextDescribeCommand[\s\S]*describe[\s\S]*icpdb_check_env_next[\s\S]*nextPreviewCommand[\s\S]*preview[\s\S]*icpdb_check_env_next[\s\S]*nextSqlSmokeCommand[\s\S]*--smoke-sql[\s\S]*nextArchiveCommand[\s\S]*archive[\s\S]*--format", "env"[\s\S]*nextSnapshotInfoCommand[\s\S]*snapshot-info[\s\S]*nextHashPinnedRestoreCommand[\s\S]*ICPDB_SNAPSHOT_HASH[\s\S]*nextOwnerArchiveRestoreSmokeCommand[\s\S]*--smoke-sdk-archive-restore/, "SDK package bin check-env output should point local, SQL, archive, restore, and shard checks to next commands");
assert.match(cliSource, /client\.status/, "SDK package bin should expose DB status inspection");
assert.match(cliSource, /client\.getUsage/, "SDK package bin should expose usage inspection");
assert.match(cliSource, /client\.listUsageEvents/, "SDK package bin should expose usage event inspection");
assert.match(cliSource, /client\.placement/, "SDK package bin should expose placement inspection");
assert.match(cliSource, /deleteClient\.delete/, "SDK package bin should expose guarded database deletion");
assert.match(cliSource, /delete-db requires --confirm <database-id>/, "SDK package bin should require delete confirmation");
assert.match(cliSource, /parsed\.command === "delete-db"[\s\S]*databaseHandoffFromEnvFile\(parsed\.envFile, "delete-db"\)[\s\S]*deleteClient\.delete\(\)[\s\S]*deleted: \{ databaseId: targetDatabaseId \}[\s\S]*\.\.\.handoff/, "SDK package bin delete-db output should identify the deleted DB");
assert.match(cliSource, /client\.views/, "SDK package bin should expose view listing");
assert.match(cliSource, /parsed\.command === "describe"[\s\S]*client\.describe\(tableName\)/, "SDK package bin should expose table description");
assert.match(cliSource, /client\.columns/, "SDK package bin should expose column inspection");
assert.match(cliSource, /client\.indexes/, "SDK package bin should expose index inspection");
assert.match(cliSource, /client\.triggers/, "SDK package bin should expose trigger inspection");
assert.match(cliSource, /client\.foreignKeys/, "SDK package bin should expose foreign key inspection");
assert.match(cliSource, /client\.preview/, "SDK package bin should expose table previews");
assert.match(cliSource, /client\.inspect/, "SDK package bin should expose one-call DB inspection");
assert.match(cliSource, /client\.listMembers/, "SDK package bin should expose member listing");
assert.match(cliSource, /client\.grantMember/, "SDK package bin should expose member grants");
assert.match(cliSource, /client\.revokeMember/, "SDK package bin should expose member revokes");
assert.match(cliSource, /databaseHandoffFromClient/, "SDK package bin member mutations should include DB handoff fields");
assert.match(cliSource, /granted: \{ principal, role \}[\s\S]*databaseHandoffFromClient\(client, parsed\.envFile\)/, "SDK package bin grant-member output should identify the target DB");
assert.match(cliSource, /revoked: \{ principal \}[\s\S]*databaseHandoffFromClient\(client, parsed\.envFile\)/, "SDK package bin revoke-member output should identify the target DB");
assert.match(cliSource, /source === "\.grant-member"[\s\S]*granted: \{ principal, role \}[\s\S]*databaseHandoffFromClient\(client, parsed\.envFile\)/, "SDK package shell grant-member output should identify the target DB");
assert.match(cliSource, /source === "\.revoke-member"[\s\S]*revoked: \{ principal \}[\s\S]*databaseHandoffFromClient\(client, parsed\.envFile\)/, "SDK package shell revoke-member output should identify the target DB");
assert.match(cliSource, /source === "\.delete-db"[\s\S]*databaseHandoffFromEnvFile\(parsed\.envFile, "\.delete-db"\)[\s\S]*delete confirmation[\s\S]*client\.delete\(\)[\s\S]*deleted: \{ databaseId: handoff\.databaseId \}[\s\S]*\.\.\.handoff/, "SDK package shell delete-db output should identify the deleted DB");
assert.match(cliSource, /client\.getRoutedOperation/, "SDK package bin should expose routed operation lookup");
assert.match(cliSource, /client\.reconcileRoutedOperation/, "SDK package bin should expose routed operation reconcile");
assert.match(cliSource, /client\.waitForRoutedOperation/, "SDK package bin should expose routed operation wait");
assert.match(cliSource, /createIcpdbServiceClientFromEnvFile/, "SDK package bin should expose service client operations");
assert.match(cliSource, /serviceClient\.listAllPlacements/, "SDK package bin should expose controller placement inventory");
assert.match(cliSource, /serviceClient\.listShards/, "SDK package bin should expose shard inventory");
assert.match(cliSource, /serviceClient\.createDatabaseShard/, "SDK package bin should expose shard creation");
assert.match(cliSource, /serviceClient\.registerDatabaseShard/, "SDK package bin should expose shard registration");
assert.match(cliSource, /serviceClient\.getShardStatus/, "SDK package bin should expose shard status");
assert.match(cliSource, /serviceClient\.topUpShard/, "SDK package bin should expose shard top-up");
assert.match(cliSource, /serviceClient\.maintainShards/, "SDK package bin should expose shard maintenance");
assert.match(cliSource, /serviceClient\.migrateDatabaseToShard/, "SDK package bin should expose shard migration");
assert.match(cliSource, /serviceClient\.createRemoteDatabase/, "SDK package bin should expose remote DB creation");
assert.match(cliSource, /serviceClient\.listShardOperations/, "SDK package bin should expose shard operation journal");
assert.match(cliSource, /serviceClient\.reconcileShardOperation/, "SDK package bin should expose shard operation reconcile");
assert.match(cliSource, /parsed\.command === "shard-create"[\s\S]*const shard = await serviceClient\.createDatabaseShard[\s\S]*shardInfoNextCommands\(shard, parsed\.envFile\)/, "SDK package bin shard-create output should include next shard commands");
assert.match(cliSource, /parsed\.command === "shard-register"[\s\S]*const shard = await serviceClient\.registerDatabaseShard[\s\S]*shardInfoNextCommands\(shard, parsed\.envFile\)/, "SDK package bin shard-register output should include next shard commands");
assert.match(cliSource, /parsed\.command === "shard-status"[\s\S]*const shardStatus = await serviceClient\.getShardStatus[\s\S]*shardStatusNextCommands\(shardStatus, parsed\.envFile\)/, "SDK package bin shard-status output should include next shard commands");
assert.match(cliSource, /parsed\.command === "shard-top-up"[\s\S]*const shard = await serviceClient\.topUpShard[\s\S]*shardInfoNextCommands\(shard, parsed\.envFile\)/, "SDK package bin shard-top-up output should include next shard commands");
assert.match(cliSource, /parsed\.command === "shard-maintain"[\s\S]*const report = await serviceClient\.maintainShards[\s\S]*shardMaintenanceNextCommands\(report, parsed\.envFile\)/, "SDK package bin shard-maintain output should include next shard commands");
assert.match(cliSource, /parsed\.command === "shard-migrate"[\s\S]*const placement = await serviceClient\.migrateDatabaseToShard[\s\S]*shardPlacementNextCommands\(placement, parsed\.envFile\)/, "SDK package bin shard-migrate output should include next shard commands");
assert.match(cliSource, /parsed\.command === "remote-create-db"[\s\S]*const database = await serviceClient\.createRemoteDatabase[\s\S]*shardRemoteDatabaseNextCommands\(databaseCanisterId, parsed\.envFile\)/, "SDK package bin remote-create-db output should include next shard commands");
assert.match(cliSource, /parsed\.command === "shard-reconcile"[\s\S]*const operation = await serviceClient\.reconcileShardOperation[\s\S]*shardOperationNextCommands\(operation, parsed\.envFile\)/, "SDK package bin shard-reconcile output should include next shard commands");
assert.match(cliSource, /function shardOperatorNextCommands[\s\S]*nextShardInventoryCommand[\s\S]*shards[\s\S]*nextAllPlacementsCommand[\s\S]*all-placements[\s\S]*nextShardOpsCommand[\s\S]*shard-ops[\s\S]*nextShardMaintainDryRunCommand[\s\S]*shard-maintain/, "SDK package bin shard next commands should cover inventory, placements, journal, and zero-action maintenance");
assert.match(cliSource, /function shardCanisterNextCommands[\s\S]*nextShardStatusCommand[\s\S]*shard-status[\s\S]*nextShardTopUpCommand[\s\S]*shard-top-up/, "SDK package bin shard canister next commands should cover status and top-up");
assert.match(cliSource, /--limit/, "SDK package bin should expose preview limit controls");
assert.match(cliSource, /--offset/, "SDK package bin should expose preview offset controls");
assert.match(cliSource, /previewLimit/, "SDK package bin should map inspect limit to SDK previewLimit");
assert.match(cliSource, /--reconcile-unknown/, "SDK package bin should expose routed operation unknown reconciliation");
assert.match(cliSource, /--interval-ms/, "SDK package bin should expose routed operation wait interval controls");
assert.match(cliSource, /--timeout-ms/, "SDK package bin should expose routed operation wait timeout controls");
assert.match(cliSource, /archiveDatabaseToFileFromEnvFile/, "SDK package bin should expose archive file export");
assert.match(cliSource, /restoreDatabaseFromFileFromEnvFile/, "SDK package bin should expose restore file import");
assert.match(cliSource, /snapshotInfoFile/, "SDK package bin should expose offline snapshot hashing");
assert.match(cliSource, /databaseHandoffFromEnvFile/, "SDK package bin archive/restore should include database handoff fields");
assert.match(cliSource, /ICPDB_SNAPSHOT_HASH: archive\.sha256[\s\S]*\.\.\.archive,[\s\S]*\.\.\.handoff,[\s\S]*archiveNextCommands\(archive\.filePath, parsed\.envFile, archive\.sha256\)/, "SDK package bin archive output should include snapshot, DB handoff, and next restore commands");
assert.match(cliSource, /ICPDB_SNAPSHOT_HASH: restore\.sha256[\s\S]*\.\.\.restore,[\s\S]*\.\.\.handoff,[\s\S]*postRestoreNextCommands\(parsed\.envFile\)/, "SDK package bin restore output should include snapshot, DB handoff, and post-restore check commands");
assert.match(cliSource, /function archiveNextCommands[\s\S]*--expect-snapshot-hash[\s\S]*ICPDB_SNAPSHOT_HASH[\s\S]*nextSnapshotInfoCommand[\s\S]*snapshot-info[\s\S]*nextRestoreCommand[\s\S]*nextHashPinnedRestoreCommand[\s\S]*postRestoreNextCommands\(envFile\)/, "SDK package bin archive next commands should cover snapshot info, hash-pinned restore, and reuse post-restore checks");
assert.match(cliSource, /function postRestoreNextCommands[\s\S]*nextPostRestoreSchemaCountCommand[\s\S]*sqlite_schema[\s\S]*nextPostRestoreTablesCommand[\s\S]*tables[\s\S]*nextPostRestoreViewsCommand[\s\S]*views[\s\S]*nextPostRestoreSchemaCommand[\s\S]*schema[\s\S]*nextPostRestoreInspectCommand[\s\S]*inspect[\s\S]*nextPostRestoreStatsCommand[\s\S]*stats[\s\S]*nextPostRestoreStatusCommand[\s\S]*status[\s\S]*nextPostRestoreMembersCommand[\s\S]*members[\s\S]*nextPostRestoreUrlCommand[\s\S]*url[\s\S]*nextPostRestoreInfoCommand[\s\S]*info/, "SDK package bin post-restore next commands should cover schema count, table and view lists, schema, inspect, stats, status, members, URL, and info checks");
assert.match(cliSource, /source === "\.archive"[\s\S]*databaseHandoffFromEnvFile\(parsed\.envFile, "\.archive"\)[\s\S]*\.\.\.archive,[\s\S]*\.\.\.handoff,[\s\S]*archiveNextCommands\(archive\.filePath, parsed\.envFile, archive\.sha256\)/, "SDK package shell archive output should include snapshot, DB handoff, and next restore commands");
assert.match(cliSource, /source === "\.restore"[\s\S]*databaseHandoffFromEnvFile\(parsed\.envFile, "\.restore"\)[\s\S]*\.\.\.restore,[\s\S]*\.\.\.handoff,[\s\S]*postRestoreNextCommands\(parsed\.envFile\)/, "SDK package shell restore output should include snapshot, DB handoff, and post-restore commands");
assert.match(cliSource, /Server\/CI defaults to cwd-local service\.env/, "SDK package bin help should document the default env file");
assert.match(cliSource, /commandUsage/, "SDK package bin should expose focused help before env loading");
assert.match(cliSource, /quickstartUsageLines/, "SDK package bin should expose quickstart help");
assert.match(cliSource, /sqlUsageLines/, "SDK package bin should expose SQL help");
assert.match(cliSource, /inspectUsageLines/, "SDK package bin should expose inspection help");
assert.match(cliSource, /statusUsageLines/, "SDK package bin should expose status help");
assert.match(cliSource, /operationUsageLines/, "SDK package bin should expose routed operation help");
assert.match(cliSource, /tokenUsageLines/, "SDK package bin should expose token boundary help");
assert.match(cliSource, /packageShellUsage/, "SDK package bin should expose service-env shell help");
assert.match(cliSource, /runPackageShell/, "SDK package bin should expose a service-env shell");
assert.match(cliSource, /source === "\.health"[\s\S]*client\.health\(\)/, "SDK package shell should expose canister health");
assert.match(cliSource, /source === "\.url"[\s\S]*databaseHandoffFromClient\(client, parsed\.envFile\)/, "SDK package shell url output should expose DB handoff fields");
assert.match(cliSource, /source === "\.info"[\s\S]*?client\.info\(\)/, "SDK package shell should expose the one-object info handoff");
assert.match(cliSource, /source === "\.stats"[\s\S]*const status = await client\.status\(\)[\s\S]*tableStatuses: status\.tableStatuses/, "SDK package shell should expose database stats");
assert.match(cliSource, /source === "\.describe"[\s\S]*client\.describe\(requiredTableShellArg\(source, "\.describe"\)\)/, "SDK package shell should expose table description");
assert.match(cliSource, /packageShellIdempotencyKey/, "SDK package shell should generate write idempotency keys");
assert.match(cliSource, /assertPackageShellDotCommandArgs/, "SDK package shell should reject invalid dot-command args before env loading");
assert.match(cliSource, /expectedSnapshotHashArg/, "SDK package CLI should reject malformed restore hash pins before env loading");
assert.match(cliSource, /isNonEnvReadingCommand/, "SDK package CLI should classify commands that must not read service env files");
assert.match(cliSource, /rejectPackageCommandPositionalsBeforeEnv/, "SDK package bin should reject malformed command args before env loading");
assert.match(cliSource, /opsUsageLines/, "SDK package bin should expose operation help");
assert.match(cliSource, /createDbUsageLines/, "SDK package bin should expose create-db help");
assert.match(cliSource, /renderTable/, "SDK package bin should expose table output for human CI logs");
assert.match(cliSource, /tableRows/, "SDK package bin should normalize table output rows");
assert.match(cliSource, /tableData/, "SDK package bin should separate table columns from table rows");
assert.match(cliSource, /sqlResultColumns/, "SDK package bin should render empty SQL row results with their column headers");
assert.match(cliSource, /Array\.isArray\(value\.rows\) && value\.rows\.length === 0/, "SDK package bin should detect empty SQL result rows");
assert.match(cliSource, /renderCsv/, "SDK package bin should expose CSV output for row export");
assert.match(cliSource, /csvField/, "SDK package bin should escape CSV fields");
assert.match(cliSource, /--format must be json, table, csv, or env/, "SDK package bin should accept CSV output format");
assert.match(cliSource, /ENV_FORMAT_COMMANDS/, "SDK package bin should explicitly list commands that can emit env output");
assert.match(cliSource, /rejectEnvFormatForCommand/, "SDK package bin should reject env output on SQL and table commands");
assert.equal(cliTypes.replace(/^#!\/usr\/bin\/env node\n/, "").trim(), "export {};", "SDK package bin types should not expose a public library surface");
assert.match(sdkSource, /ICPDB_LIBSQL_ERROR_CODES/, "SDK artifact should expose known libSQL-shaped error codes");
assert.match(sdkSource, /class LibsqlError extends Error/, "SDK artifact should expose libSQL-shaped errors");
assert.match(sdkSource, /class LibsqlBatchError extends LibsqlError/, "SDK artifact should expose libSQL-shaped batch errors");
assert.match(sdkSource, /statementIndex/, "SDK artifact batch errors should expose statement index");
assert.match(sdkSource, /classifyLibsqlErrorMessage/, "SDK artifact should expose error-code classification");
assert.match(sdkSource, /function isIcpdbLibsqlErrorCode/, "SDK artifact should expose error-code type guard");
assert.match(sdkSource, /function isLibsqlError/, "SDK artifact should expose libSQL error type guard");
assert.match(sdkSource, /function isLibsqlBatchError/, "SDK artifact should expose libSQL batch error type guard");
assert.match(nodeSource, /export \* from "\.\/icpdb-sdk\.js"/, "node entry should re-export the SQL client");
assert.match(nodeSource, /export \* from "\.\/icpdb-service-identity\.js"/, "node entry should re-export service.env helpers");
assert.match(nodeTypes, /export \* from "\.\/icpdb-sdk\.js"/, "node types should re-export the SQL client");
assert.match(nodeTypes, /export \* from "\.\/icpdb-service-identity\.js"/, "node types should re-export service.env helpers");
assert.match(libsqlSource, /export \* from "\.\/icpdb-sdk\.js"/, "libsql entry should re-export the SQL client");
assert.match(libsqlTypes, /export \* from "\.\/icpdb-sdk\.js"/, "libsql types should re-export the SQL client");
assert.match(libsqlSource, /connectClient as connectLibsqlClient/, "libsql entry should expose named connect client alias");
assert.match(libsqlTypes, /connectClient as connectLibsqlClient/, "libsql types should expose named connect client alias");
assert.match(libsqlSource, /connectIcpdbDatabase as connectLibsqlDatabase/, "libsql entry should expose named connect database alias");
assert.match(libsqlTypes, /connectIcpdbDatabase as connectLibsqlDatabase/, "libsql types should expose named connect database alias");
assert.match(libsqlSource, /createDatabase as createLibsqlDatabase/, "libsql entry should expose named create database alias");
assert.match(libsqlTypes, /createDatabase as createLibsqlDatabase/, "libsql types should expose named create database alias");
assert.match(libsqlSource, /parseIcpdbDatabaseUrl as parseLibsqlDatabaseUrl/, "libsql entry should expose named URL parser alias");
assert.match(libsqlTypes, /parseIcpdbDatabaseUrl as parseLibsqlDatabaseUrl/, "libsql types should expose named URL parser alias");
assert.match(libsqlTypes, /Client as LibsqlClient/, "libsql types should expose named client type alias");
assert.match(libsqlTypes, /IcpdbConnectSqlClientOptions as ConnectLibsqlClientOptions/, "libsql types should expose named connect options type alias");
assert.match(libsqlTypes, /IcpdbConnectDatabaseOptions as ConnectLibsqlDatabaseOptions/, "libsql types should expose named existing-database connect options type alias");
assert.match(libsqlTypes, /IcpdbCreateDatabaseOptions as CreateLibsqlDatabaseOptions/, "libsql types should expose named create database options type alias");
assert.match(libsqlTypes, /IcpdbDatabaseClient as LibsqlDatabaseClient/, "libsql types should expose named database client type alias");
assert.match(libsqlTypes, /Config as LibsqlConfig/, "libsql types should expose named config type alias");
assert.match(libsqlTypes, /ResultSet as LibsqlResultSet/, "libsql types should expose named result type alias");
assert.match(sqliteSource, /export \* from "\.\/icpdb-sdk\.js"/, "sqlite entry should re-export the SQL client");
assert.match(sqliteTypes, /export \* from "\.\/icpdb-sdk\.js"/, "sqlite types should re-export the SQL client");
assert.match(sqliteSource, /createClient as createSqliteClient/, "sqlite entry should expose named hosted SQLite client alias");
assert.match(sqliteTypes, /createClient as createSqliteClient/, "sqlite types should expose named hosted SQLite client alias");
assert.match(sqliteSource, /connectDatabase as connectSqliteDatabase/, "sqlite entry should expose named hosted SQLite direct database connect alias");
assert.match(sqliteSource, /createDatabase as createSqliteDatabase/, "sqlite entry should expose named hosted SQLite direct database create alias");
assert.match(sqliteSource, /parseIcpdbDatabaseUrl as parseSqliteDatabaseUrl/, "sqlite entry should expose named hosted SQLite URL parser alias");
assert.match(sqliteTypes, /parseIcpdbDatabaseUrl as parseSqliteDatabaseUrl/, "sqlite types should expose named hosted SQLite URL parser alias");
assert.match(sqliteTypes, /IcpdbSqlClient as SqliteClient/, "sqlite types should expose named hosted SQLite client type alias");
assert.match(sqliteTypes, /IcpdbDatabaseClient as SqliteDatabaseClient/, "sqlite types should expose named hosted SQLite direct database type alias");
assert.match(sqliteTypes, /IcpdbCreateDatabaseOptions as CreateSqliteDatabaseOptions/, "sqlite types should expose named hosted SQLite create database options alias");
assert.match(sqliteTypes, /IcpdbConnectDatabaseOptions as ConnectSqliteDatabaseOptions/, "sqlite types should expose named hosted SQLite existing-database connect options alias");
assert.match(sqliteTypes, /IcpdbParsedDatabaseUrl as SqliteParsedDatabaseUrl/, "sqlite types should expose named hosted SQLite parsed URL type alias");
assert.match(sqliteTypes, /IcpdbRow as SqliteRow/, "sqlite types should expose named hosted SQLite row type alias");
assert.match(sqliteTypes, /IcpdbCellValue as SqliteValue/, "sqlite types should expose named hosted SQLite value type alias");
assert.match(sqliteTypes, /IcpdbPreparedStatement as SqlitePreparedStatement/, "sqlite types should expose named hosted SQLite prepared statement type alias");
assert.match(sqliteTypes, /IcpdbSqlClientBatchStatement as SqliteBatchStatement/, "sqlite types should expose named hosted SQLite batch statement type alias");
assert.match(sqliteTypes, /BatchResult as SqliteBatchResult/, "sqlite types should expose named hosted SQLite batch result type alias");
assert.match(serverSource, /export \* from "\.\/icpdb-node\.js"/, "server entry should re-export the Node entry");
assert.match(serverTypes, /export \* from "\.\/icpdb-node\.js"/, "server types should re-export the Node entry");
assert.match(sdkSource, /function sql\(strings, \.\.\.values\)/, "SDK artifact should expose SQL tagged template helper");
assert.match(sdkSource, /sql template must use tagged template syntax/, "SDK artifact should reject non-tag SQL template calls");
assert.match(sdkTypes, /IcpdbSqlTemplateStatement/, "SDK artifact should expose SQL template statement type");
assert.match(sdkTypes, /type Statement = IcpdbSqlClientStatementInput/, "SDK artifact should expose Statement alias");
assert.match(sdkTypes, /type BatchStatement = IcpdbSqlClientBatchStatement/, "SDK artifact should expose BatchStatement alias");
assert.match(sdkTypes, /type BatchResult = IcpdbSqlClientResult\[\]/, "SDK artifact should expose BatchResult alias");
assert.match(sdkTypes, /type PreparedStatement = IcpdbPreparedStatement/, "SDK artifact should expose PreparedStatement alias");
assert.match(sdkTypes, /type Sql = \(strings: TemplateStringsArray/, "SDK artifact should expose Sql tag alias");
assert.match(sdkTypes, /IcpdbCreateDatabaseOptions[\s\S]*databaseId\?: never/, "SDK create database options should reject existing database ids");
assert.match(sdkTypes, /IcpdbExistingDatabaseSqlClientOptions[\s\S]*setupSql\?: never[\s\S]*setupStatements\?: never[\s\S]*setupMigrations\?: never/, "SDK existing database SQL client options should reject create-time setup");
assert.match(sdkTypes, /IcpdbCreateSqlClientOptions[\s\S]*databaseId\?: never/, "SDK create SQL client options should reject existing database ids");
assert.match(sdkTypes, /IcpdbSqlClientStatement[\s\S]*databaseId\?: never/, "SDK SQL client statement type should reject per-statement databaseId");
assert.match(sdkTypes, /IcpdbDatabaseStatementInput[\s\S]*databaseId\?: never/, "SDK database handle statement type should reject per-statement databaseId");
assert.match(sdkTypes, /IcpdbDatabaseBatchOptionsObject[\s\S]*databaseId\?: never/, "SDK database handle batch option type should reject databaseId");
assert.match(sdkTypes, /IcpdbDatabasePreviewOptionsObject[\s\S]*databaseId\?: never/, "SDK database preview option type should reject databaseId");
assert.match(sdkTypes, /IcpdbInspectOptions[\s\S]*databaseId\?: never/, "SDK database inspect option type should reject databaseId");
assert.match(sdkTypes, /IcpdbSqlDumpOptions[\s\S]*databaseId\?: never/, "SDK database dump option type should reject databaseId");
assert.match(sdkTypes, /IcpdbRestoreOptions[\s\S]*databaseId\?: never/, "SDK database restore option type should reject databaseId");
assert.match(sdkTypes, /IcpdbWaitForRoutedOperationOptions[\s\S]*databaseId\?: never/, "SDK database wait option type should reject databaseId");
assert.match(sdkTypes, /IcpdbSqlClientScriptOptionsObject[\s\S]*databaseId\?: never/, "SDK SQL client script option type should reject databaseId");
assert.match(sdkTypes, /IcpdbSqlClientBatchOptionsObject[\s\S]*databaseId\?: never/, "SDK SQL client batch option type should reject databaseId");
assert.match(sdkSource, /Object\.create\(null\)/, "SDK artifact rows should preserve reserved SQL aliases as own properties");
assert.match(sdkSource, /connectedDatabaseId/, "SDK artifact should pin a lazily created database id across close/reconnect");
assert.match(sdkSource, /connectedDatabaseId = db\.databaseId/, "SDK artifact should remember the database id created by createClient");
assert.match(sdkSource, /closeCachedDatabase/, "SDK artifact should centralize cached database close handling");
assert.match(sdkSource, /currentDatabase\.then\(\(db\) => db\.close\(\)\)/, "SDK artifact should delegate close to the current database handle");
assert.match(sdkSource, /Promise\.resolve\(enriched\.close\(\)\)\.catch\(noop\)/, "SDK artifact should close the current database handle after delete");
assert.match(sdkSource, /database client has been deleted; create a new client/, "SDK artifact should make high-level delete terminal");
assert.match(sdkSource, /missing client options/, "SDK artifact should reject missing client options before actor creation");
assert.match(sdkSource, /missing identity; pass an IC identity/, "SDK artifact should reject missing identities before actor creation");
assert.match(sdkSource, /optionalNonEmptyString/, "SDK artifact should validate optional connection strings before lazy create");
assert.match(sdkSource, /optionalNonEmptyString\(options\.host, "host"\)/, "SDK artifact should reject empty SDK host before actor creation");
assert.match(sdkSource, /optionalNonEmptyBytes\(options\.rootKey, "rootKey"\)/, "SDK artifact should reject empty SDK rootKey before actor creation");
assert.match(sdkSource, /requiredNonEmptyString/, "SDK artifact should reject empty connection URL formatter inputs");
assert.match(sdkSource, /must be a non-empty string/, "SDK artifact should reject empty connection strings before lazy create");
assert.match(sdkSource, /requiredTableName/, "SDK artifact should reject empty table names before table inspection requests");
assert.match(sdkSource, /tableName must be a non-empty string/, "SDK artifact should surface SDK table-name validation errors");
assert.match(sdkSource, /requiredOperationId/, "SDK artifact should reject empty routed operation ids before polling");
assert.match(sdkSource, /operationId must be a non-empty string/, "SDK artifact should surface SDK operation-id validation errors");
assert.match(sdkSource, /requiredNonEmptyString\(source\.connectionUrl\(\), "connectionUrl"\)/, "SDK artifact should reject empty custom source connection URLs");
assert.match(sdkSource, /requiredNonEmptyString\(source\.url\(\), "url"\)/, "SDK artifact should reject empty custom source short URLs");
assert.match(sdkSource, /requiredDatabaseCanisterId/, "SDK artifact should reject empty database canister ids before shard requests");
assert.match(sdkSource, /databaseCanisterId must be a non-empty string/, "SDK artifact should surface SDK database-canister-id validation errors");
assert.match(sdkSource, /nat64TextInput/, "SDK artifact should validate archive chunk offsets and restore sizes before Candid requests");
assert.match(sdkSource, /positiveNat32/, "SDK artifact should validate archive max byte counts before Candid requests");
assert.match(sdkSource, /snapshotHashBytes/, "SDK artifact should validate archive/restore hashes before Candid requests");
assert.match(sdkSource, /archive offset/, "SDK artifact should label archive offset validation");
assert.match(sdkSource, /archive maxBytes/, "SDK artifact should label archive max byte validation");
assert.match(sdkSource, /restore sizeBytes/, "SDK artifact should label restore size validation");
assert.match(sdkSource, /snapshotHash/, "SDK artifact should label snapshot hash validation");
assert.match(sdkSource, /options\.expectedSha256\.trim\(\)\.toLowerCase\(\)/, "SDK artifact should trim and lowercase expected snapshot hashes");
assert.match(databaseCodecSource, /must be a non-negative integer/, "SDK artifact should reject invalid shard nat inputs before Candid requests");
assert.match(databaseCodecSource, /must be an integer from 0 to 65535/, "SDK artifact should reject invalid nat16 shard count inputs before Candid requests");
assert.match(sdkSource, /tables: listTables/, "SDK artifact should expose short table-list alias");
assert.match(sdkTypes, /IcpdbClientOptions[\s\S]*connectionUrl\?: string/, "SDK client options should accept named connectionUrl handoff values");
assert.match(sdkSource, /use either url or connectionUrl, not both/, "SDK artifact should reject ambiguous URL option aliases");
assert.match(sdkTypes, /IcpdbSqlClientBatchStatementObject[\s\S]*idempotencyKey\?: never[\s\S]*maxRows\?: never[\s\S]*databaseId\?: never/, "SDK batch statement object type should reject per-statement batch-only options");
assert.match(sdkTypes, /IcpdbSqlClientDatabaseSource[\s\S]*"databaseId" \| "query" \| "execute"[\s\S]*Partial<Pick<IcpdbDatabaseClient, "batch"/, "SDK database source type should require only the minimal SQL contract and keep batch optional");
assert.match(sdkTypes, /Partial<Pick<IcpdbDatabaseClient[\s\S]*"schema" \| "listTables"/, "SDK database source type should make inspection helpers optional");
assert.match(sdkTypes, /IcpdbSqlClientDatabase[\s\S]*"queryRows" \| "queryOne" \| "all" \| "get" \| "values" \| "first" \| "firstValue" \| "scalar" \| "prepare" \| "run" \| "transaction" \| "exec" \| "executeMultiple" \| "executeScript" \| "migrate" \| "dumpSql" \| "loadSqlDump" \| "schema" \| "listTables" \| "tables" \| "views" \| "describeTable" \| "describe" \| "listColumns" \| "columns" \| "listIndexes" \| "indexes" \| "listTriggers" \| "triggers" \| "listForeignKeys" \| "foreignKeys" \| "previewTable" \| "preview" \| "inspect" \| "connectionUrl" \| "url" \| "info" \| "delete" \| "getUsage" \| "status" \| "listUsageEvents" \| "getRoutedOperation" \| "reconcileRoutedOperation" \| "waitForRoutedOperation" \| "grantMember" \| "revokeMember" \| "listMembers" \| "placement" \| "archive" \| "snapshotInfo" \| "restore" \| "close"/, "SDK database() type should expose derived DB convenience helpers");
assert.match(sdkSource, /delete: deleteOnSource/, "SDK database() handle should expose lifecycle delete");
assert.match(sdkSource, /enrichSqlClientDatabase/, "SDK database() handle should enrich minimal database sources at runtime");
assert.match(sdkSource, /describe: describeTable/, "SDK artifact should expose short table-description alias");
assert.match(sdkSource, /preview: previewTable/, "SDK artifact should expose short table-preview alias");
assert.match(sdkSource, /tables: \(databaseId\) => listTablesWithDatabase/, "low-level SDK artifact should expose short table-list alias");
assert.match(sdkSource, /describe: \(tableName, databaseId\) => describeTableWithDatabase/, "low-level SDK artifact should expose short table-description alias");
assert.match(sdkSource, /preview: previewTableWithDatabase/, "low-level SDK artifact should expose short table-preview alias");
assert.match(sdkSource, /values: async \(statement, params\) => responseValues\(await queryWithDatabase\(statementDatabaseId/, "low-level SDK artifact should expose array-row value helpers");
assert.match(sdkSource, /firstValue: async \(statement, params\) => firstResponseValue\(await queryWithDatabase\(statementDatabaseId/, "low-level SDK artifact should expose first-value helpers");
assert.match(sdkSource, /scalar: async \(statement, params\) => firstResponseValue\(await queryWithDatabase\(statementDatabaseId/, "low-level SDK artifact should expose scalar helpers");
assert.match(sdkSource, /createDatabase\(setup = \{\}\)/, "low-level SDK artifact should accept create-time setup options");
assert.match(sdkSource, /applyCreateSetup/, "low-level SDK artifact should share create-time setup cleanup");
assert.match(sdkTypes, /IcpdbCreateSetupOptions[\s\S]*databaseId\?: never/, "SDK types should expose low-level create setup options that reject databaseId");
assert.match(sdkSource, /bind: \(args\) => prepare\(normalizedSql, statementArgs\(args\)\)/, "SDK artifact prepared statements should expose bound-argument helpers");
assert.match(sdkSource, /prepare: \(sql, args\) => createClientFromDatabase\(database\(resolvedDatabaseId\)\)\.prepare\(sql, args\)/, "direct database SDK artifact should expose prepared statements");
assert.match(sdkSource, /prepare: prepareLowLevel/, "low-level SDK artifact should expose prepared statements");
assert.match(serviceSource, /node:fs\/promises/, "service identity artifact should keep Node-only identity file loading explicit");
assert.match(serviceSource, /node:crypto/, "service identity artifact should keep snapshot file hashing in the Node-only entries");
assert.match(serviceSource, /loadIcpdbServiceEnvFile/, "service identity artifact should expose env-file loading");
assert.match(serviceSource, /checkIcpdbServiceEnvFileMode/, "service identity artifact should expose env-file mode checking");
assert.match(serviceSource, /loadIcpdbServiceEnvFile\(path = DEFAULT_SERVICE_ENV_FILE\)/, "service identity artifact should let env loading default to service.env");
assert.match(serviceSource, /checkIcpdbServiceEnvFileMode\(path = DEFAULT_SERVICE_ENV_FILE\)/, "service identity artifact should let env mode checks default to service.env");
assert.match(serviceSource, /requiredFilePath\(path, "service env file"\)/, "service identity artifact should reject empty env-file paths");
assert.match(serviceSource, /checkOwnerOnlyFileMode\(requiredFilePath\(path, "service env file"\), "service env file"\)/, "service identity artifact should reject unsafe env-file permissions");
assert.match(serviceSource, /path must be a non-empty string/, "service identity artifact should surface empty file path validation errors");
assert.match(serviceSource, /optionalNonEmptyEnvValue/, "service identity artifact should reject empty env connection values");
assert.match(serviceSource, /optionalTrimmedEnvValue/, "service identity artifact should trim non-secret env connection values");
assert.match(serviceSource, /serviceIdentityType/, "service identity artifact should validate direct service identity types");
assert.match(serviceSource, /optionalInlineSecretText/, "service identity artifact should reject empty direct identity secrets");
assert.match(serviceSource, /requiredNonEmptyEnvValue/, "service identity artifact should reject empty env output values");
assert.match(serviceSource, /optionalNonEmptySetupEnvValue/, "service identity artifact should reject empty setup env values");
assert.match(serviceSource, /optionalTrimmedEnvValue\(env\.ICPDB_NETWORK_URL, "ICPDB_NETWORK_URL"\)/, "service identity artifact should reject empty env network urls");
assert.match(serviceSource, /optionalTrimmedEnvValue\(env\.ICPDB_ROOT_KEY, "ICPDB_ROOT_KEY"\)/, "service identity artifact should reject empty root key env values");
assert.match(serviceSource, /optionalNonEmptyEnvValue\(env\.ICPDB_IDENTITY_JSON, "ICPDB_IDENTITY_JSON"\)/, "service identity artifact should reject empty service identity secrets");
assert.match(serviceSource, /optionalTrimmedEnvValue\(env\.ICPDB_IDENTITY_PRINCIPAL, "ICPDB_IDENTITY_PRINCIPAL"\)/, "service identity artifact should read expected service principals");
assert.match(serviceSource, /service identity principal mismatch/, "service identity artifact should reject expected-principal drift");
assert.match(serviceSource, /ICPDB_IDENTITY_TYPE must be auto, ed25519, or secp256k1/, "service identity artifact should reject invalid identity types");
assert.match(serviceSource, /assertSingleServiceIdentitySecret/, "service identity artifact should reject ambiguous identity secret sources");
assert.match(serviceSource, /service identity must use exactly one secret source/, "service identity artifact should reject multiple identity secret sources");
assert.match(serviceSource, /must be a non-empty string/, "service identity artifact should reject empty env database ids before auto-create");
assert.match(serviceSource, /readOptionalSecretText\(options\.identityJsonFile, "service identity file"\)/, "service identity artifact should reject unsafe referenced identity-file permissions");
assert.match(serviceSource, /inspectIcpdbServiceEnv/, "service identity artifact should expose env inspection");
assert.match(serviceSource, /inspectIcpdbServiceEnvFile/, "service identity artifact should expose env-file inspection");
assert.match(serviceSource, /generateIcpdbServiceIdentity/, "service identity artifact should expose service identity generation");
assert.match(serviceSource, /writeGeneratedIcpdbServiceEnvFile/, "service identity artifact should expose generated service env writing");
assert.match(serviceTypes, /IcpdbServiceCreateDatabaseOptions[\s\S]*databaseId\?: never/, "service create database options should reject existing database ids");
assert.match(serviceTypes, /IcpdbServiceExistingDatabaseSqlClientOptions[\s\S]*setupSql\?: never[\s\S]*setupStatements\?: never[\s\S]*setupMigrations\?: never/, "service existing database SQL client options should reject create-time setup");
assert.match(serviceTypes, /IcpdbServiceCreateSqlClientOptions[\s\S]*databaseId\?: never/, "service create SQL client options should reject existing database ids");
assert.match(serviceTypes, /IcpdbGeneratedServiceIdentityTargetOptions/, "service identity artifact should expose service identity target options");
assert.match(serviceSource, /generatedServiceIdentityTargetEnv/, "service identity artifact should write canister-targeted generated env values");
assert.match(serviceSource, /ICPDB_CANISTER_ID is required when ICPDB_DATABASE_ID is set/, "service identity artifact should reject database-targeted env without canister id");
assert.match(serviceSource, /formatIcpdbDatabaseUrl\(canisterId, databaseId\)/, "service identity artifact should write ICPDB_URL for database-targeted generated env");
assert.match(serviceSource, /provisionIcpdbServiceIdentity/, "service identity artifact should expose generated service identity grants");
assert.match(serviceSource, /provisionIcpdbServiceEnvFile/, "service identity artifact should expose one-call service env provisioning");
assert.match(serviceSource, /provisionIcpdbServiceDatabaseEnvFile/, "service identity artifact should expose one-call service database env provisioning");
assert.match(serviceSource, /serviceEnvTargetDatabaseId/, "service identity artifact should normalize provisioned service env database ids");
assert.match(serviceSource, /serviceEnvTargetConnectionUrl/, "service identity artifact should normalize provisioned service env connection URLs");
assert.match(serviceSource, /const extraServiceEnv = normalizeServiceEnv\(extraEnv\)/, "service identity artifact should validate extra service env before grants");
assert.match(serviceSource, /\.\.\.extraServiceEnv/, "service identity artifact should write normalized extra service env values");
assert.match(serviceSource, /assertServiceCreateDatabaseOptions/, "service identity artifact should reject existing DB inputs for service DB creation");
assert.match(serviceSource, /ICPDB_SETUP_SQL/, "service identity artifact should expose setup SQL env support");
assert.match(serviceSource, /ICPDB_SETUP_SQL_FILE/, "service identity artifact should expose setup SQL file env support");
assert.match(serviceSource, /ICPDB_SETUP_STATEMENTS/, "service identity artifact should expose setup statement env support");
assert.match(serviceSource, /ICPDB_SETUP_STATEMENTS_FILE/, "service identity artifact should expose setup statement file env support");
assert.match(serviceSource, /setupStructuredValueFromJson/, "service identity artifact should parse structured setup statement binds");
assert.match(serviceSource, /kind must be null, integer, real, text, or blob/, "service identity artifact should reject invalid setup bind kinds");
assert.match(serviceSource, /base-10 integer string/, "service identity artifact should reject invalid setup integer binds");
assert.match(serviceSource, /ICPDB_SETUP_MIGRATIONS/, "service identity artifact should expose setup migrations env support");
assert.match(serviceSource, /ICPDB_SETUP_MIGRATIONS_FILE/, "service identity artifact should expose setup migrations file env support");
assert.match(serviceSource, /loadIcpdbServiceSetupFromEnv/, "service identity artifact should expose service setup env loading");
assert.match(serviceSource, /createIcpdbPersistedServiceSqlClientFromEnvFile/, "service identity artifact should expose persisted env-file SQL client creation");
assert.match(serviceSource, /persistedServiceDatabaseFromEnvFile/, "persisted env-file SQL client should reload the env file after close/reconnect");
assert.match(serviceSource, /serviceConnectionHasDatabase\(env\)/, "persisted env-file SQL client should reconnect after database id persistence");
assert.match(serviceSource, /assertServiceSqlClientSetupOptions\(await loadIcpdbServiceSetupFromEnv\(env\), serviceConnectionOptionsFromEnv\(env\)\.databaseId\)/, "persisted env-file SQL client should reject stale setup after database id persistence");
assert.match(serviceSource, /serviceEnvWithoutSetup/, "persisted env-file SQL client should remove create-time setup after database id persistence");
assert.match(serviceSource, /writeIcpdbServiceEnvFile/, "service identity artifact should expose env-file writing");
assert.match(serviceSource, /persistIcpdbServiceDatabaseId/, "service identity artifact should expose database id persistence");
assert.match(serviceSource, /0o600/, "service identity artifact should write service env files with owner-only permissions");
assert.match(serviceSource, /chmod/, "service identity artifact should correct existing service env file permissions");
assert.match(serviceSource, /createIcpdbServiceClientFromEnvFile/, "service identity artifact should expose env-file low-level client creation");
assert.match(serviceSource, /createIcpdbServiceSqlClientFromEnvFile/, "service identity artifact should expose env-file SQL client creation");
assert.match(serviceSource, /connectionUrl: options\.connectionUrl/, "service identity artifact should forward direct connectionUrl options");
assert.match(serviceSource, /use either url or connectionUrl, not both/, "service identity artifact should reject ambiguous direct URL options before DB creation");
assert.match(serviceSource, /connectDatabaseFromEnvFile/, "service identity artifact should expose short env-file database connection");
assert.match(serviceSource, /createDatabaseFromEnvFile/, "service identity artifact should expose short env-file database creation");
assert.match(serviceSource, /createClientFromEnv/, "service identity artifact should expose short env SQL client creation");
assert.match(serviceSource, /connectClientFromEnv/, "service identity artifact should expose short env SQL client connection");
assert.match(serviceSource, /connectClientFromEnvFile/, "service identity artifact should expose short env-file SQL client connection");
assert.match(serviceSource, /requires a database-bearing ICPDB_URL or ICPDB_DATABASE_ID/, "short env SQL alias should reject non-persistent canister-only process.env connections");
assert.match(serviceSource, /createClientFromEnvFile/, "service identity artifact should expose short env-file SQL client creation");
assert.match(serviceSource, /snapshotInfoFile/, "service identity artifact should expose short snapshot file info");
assert.match(serviceSource, /archiveDatabaseToFile/, "service identity artifact should expose short archive file export");
assert.match(serviceSource, /restoreDatabaseFromFile/, "service identity artifact should expose short restore file import");
assert.match(serviceSource, /archiveDatabaseToFileFromEnv/, "service identity artifact should expose short process env archive export");
assert.match(serviceSource, /restoreDatabaseFromFileFromEnv/, "service identity artifact should expose short process env restore import");
assert.match(serviceSource, /archiveDatabaseToFileFromEnvFile/, "service identity artifact should expose short env-file archive export");
assert.match(serviceSource, /restoreDatabaseFromFileFromEnvFile/, "service identity artifact should expose short env-file restore import");
assert.match(serviceSource, /FromEnvFile\(path = DEFAULT_SERVICE_ENV_FILE\)/, "service identity artifact should default env-file helpers to service.env");
assert.match(serviceSource, /snapshotInfoIcpdbServiceFile/, "service identity artifact should expose bounded snapshot file hashing");
assert.match(serviceSource, /archiveIcpdbServiceDatabaseToFile/, "service identity artifact should expose bounded archive file export");
assert.match(serviceSource, /restoreIcpdbServiceDatabaseFromFile/, "service identity artifact should expose bounded restore file import");
assert.match(serviceSource, /options\.expectedSha256\.trim\(\)\.toLowerCase\(\)/, "service identity artifact should trim and lowercase expected snapshot hashes");
assert.match(serviceSource, /serviceArchiveSourceDatabaseId/, "service identity artifact should normalize archive source database ids");
assert.match(serviceSource, /serviceRestoreTargetDatabaseId/, "service identity artifact should normalize restore target database ids");
assert.match(serviceSource, /normalizedResultDatabaseId/, "service identity artifact should normalize archive begin result database ids");
assert.match(serviceSource, /const normalized = value\.trim\(\)/, "service identity artifact should normalize archive size strings");
assert.match(serviceSource, /chunk instanceof Uint8Array/, "service identity artifact should accept Uint8Array archive chunks");
assert.match(serviceSource, /archiveIcpdbServiceDatabaseToFileFromEnv/, "service identity artifact should expose process env archive export");
assert.match(serviceSource, /restoreIcpdbServiceDatabaseFromFileFromEnv/, "service identity artifact should expose process env restore import");
assert.match(serviceSource, /archiveIcpdbServiceDatabaseToFileFromEnvFile/, "service identity artifact should expose env-file archive export");
assert.match(serviceSource, /restoreIcpdbServiceDatabaseFromFileFromEnvFile/, "service identity artifact should expose env-file restore import");
assert.match(serviceSource, /Preserve the open\/transfer failure; archive cancellation is best-effort cleanup/, "service identity archive export should cancel when target open or transfer fails");
assert.match(serviceSource, /Preserve the finalize failure; archive cancellation is best-effort cleanup/, "service identity archive export should cancel when finalize fails");
assert.match(serviceSource, /envPath \?\? DEFAULT_SERVICE_ENV_FILE/, "service identity artifact should let backup helpers default to service.env");
assert.match(serviceSource, /ICPDB_URL/, "service identity artifact should read ICPDB_URL");
assert.match(serviceSource, /ICPDB_CANISTER_ID does not match ICPDB_URL/, "service identity artifact should reject mismatched canister env");
assert.match(serviceSource, /ICPDB_DATABASE_ID does not match ICPDB_URL/, "service identity artifact should reject mismatched database env");
assert.match(readme, /# @icpdb\/client/);
assert.match(readme, /## Install/);
assert.match(readme, /npm install @icpdb\/client/);
assert.match(readme, /pnpm add @icpdb\/client/);
assert.match(readme, /yarn add @icpdb\/client/);
assert.match(readme, /bun add @icpdb\/client/);
assert.match(readme, /The package also installs a thin Server\/CI bin/);
assert.match(readme, /icpdb help init/);
assert.match(readme, /icpdb init --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --setup-sql "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" --format table/);
assert.match(readme, /icpdb inspect-env --format env/);
assert.match(readme, /icpdb principal --format env/);
assert.match(readme, /icpdb check-env --require-role writer --smoke-sql --format table/);
assert.match(readme, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(readme, /icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb url --format env/);
assert.match(readme, /icpdb info --format env/);
assert.match(readme, /icpdb databases/);
assert.match(readme, /icpdb execute "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["from-ci"\]' --idempotency-key ci-notes-insert-001 --wait/);
assert.match(readme, /icpdb query "SELECT id, body FROM notes WHERE body = :body" --params-file \.\/params\.json --format table/);
assert.match(readme, /icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format csv/);
assert.match(readme, /icpdb batch \.\/statements\.json --mode write --idempotency-key ci-notes-batch-001 --wait/);
assert.match(readme, /icpdb transaction \.\/transaction\.json --mode write --idempotency-key ci-notes-transaction-001 --wait/);
assert.match(readme, /icpdb script \.\/schema\.sql --mode write --idempotency-key ci-schema-001 --wait/);
assert.match(readme, /icpdb dump \.\/dump\.sql/);
assert.match(readme, /icpdb migrate \.\/migrations\.json --idempotency-key ci-migrate-001 --wait/);
assert.match(readme, /icpdb create-db --setup-sql "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" --format table/);
assert.match(readme, /icpdb create-db --setup-statements-file \.\/setup-statements\.json --format env/);
assert.match(readme, /icpdb create-db --setup-migrations-file \.\/migrations\.json --format env/);
assert.match(readme, /icpdb provision-service <database-id> owner --service-env-file owner\.env --env-out service\.env --format table/);
assert.match(readme, /icpdb status --format table/);
assert.match(readme, /icpdb stats --format table/);
assert.match(readme, /icpdb usage --format table/);
assert.match(readme, /icpdb usage-events --format table/);
assert.match(readme, /icpdb placement --format table/);
assert.match(readme, /icpdb tables --format table/);
assert.match(readme, /icpdb views --format table/);
assert.match(readme, /icpdb schema notes --format table/);
assert.match(readme, /icpdb columns notes --format table/);
assert.match(readme, /icpdb indexes notes --format table/);
assert.match(readme, /icpdb triggers notes --format table/);
assert.match(readme, /icpdb foreign-keys notes --format table/);
assert.match(readme, /icpdb preview notes --limit 25 --offset 0 --format table/);
assert.match(readme, /icpdb inspect notes --limit 25 --format table/);
assert.match(readme, /icpdb members --format table/);
assert.match(readme, /icpdb grant-member <service-principal> writer/);
assert.match(readme, /icpdb revoke-member <service-principal>/);
assert.match(readme, /icpdb operation <operation-id> --format table/);
assert.match(readme, /icpdb operation-wait <operation-id> --reconcile-unknown --format table/);
assert.match(readme, /icpdb shell "\.tables" --format table/);
assert.match(readme, /icpdb shell "\.schema notes" --format table/);
assert.match(readme, /icpdb shell "\.members" --format table/);
assert.match(readme, /icpdb shell "\.grant-member <service-principal> writer" --format table/);
assert.match(readme, /icpdb shell "\.script \.\/schema\.sql" --idempotency-key ci-shell-script-001 --wait --format table/);
assert.match(readme, /icpdb shell "\.load \.\/dump\.sql" --idempotency-key ci-shell-load-001 --wait --format table/);
assert.match(readme, /icpdb shell "\.migrate \.\/migrations\.json" --idempotency-key ci-shell-migrate-001 --wait --format table/);
assert.match(readme, /icpdb shell "SELECT count\(\*\) AS total FROM notes" --format table/);
assert.match(readme, /icpdb shell "INSERT INTO notes\(body\) VALUES \('from-shell'\)" --wait --format table/);
assert.match(readme, /icpdb shell "\.delete-db <database-id>" --format table/);
assert.match(readme, /icpdb sql "INSERT INTO notes\(body\) VALUES \('from-sql'\)" --idempotency-key ci-sql-insert-001 --wait --format table/);
assert.match(readme, /icpdb sql "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(readme, /icpdb inspect-env --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb principal --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb health --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller\.env --format table/);
assert.match(readme, /shard table\/json\/csv output includes nextShardInventoryCommand, nextAllPlacementsCommand, nextShardOpsCommand, and nextShardMaintainDryRunCommand/);
assert.match(readme, /shard canister output includes nextShardStatusCommand and nextShardTopUpCommand/);
assert.match(readme, /icpdb all-placements --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shards --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shard-maintain 0 0 0 0 0 0 --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shard-create 100000000000 8 --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shard-register <database-canister-id> 8 --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shard-status <database-canister-id> --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shard-top-up <database-canister-id> 1000000 --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shard-maintain 1 0 0 0 8 0 --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shard-migrate <database-id> <database-canister-id> --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb remote-create-db <database-id> <database-canister-id> --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb shard-ops --service-env-file controller\.env --format table/);
assert.match(readme, /icpdb delete-db --confirm <database-id> --format table/);
assert.match(readme, /icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(readme, /icpdb archive \.\/backup\.sqlite --format env/);
assert.match(readme, /icpdb snapshot-info \.\/backup\.sqlite --format table/);
assert.match(readme, /icpdb snapshot-info \.\/backup\.sqlite --format env/);
assert.match(readme, /icpdb restore \.\/backup\.sqlite --expect-snapshot-hash <sha256> --format table/);
assert.match(readme, /eval "\$\(icpdb snapshot-info \.\/backup\.sqlite --format env\)" && icpdb restore \.\/backup\.sqlite --expect-snapshot-hash "\$ICPDB_SNAPSHOT_HASH" --format table/);
assert.match(readme, /icpdb restore \.\/backup\.sqlite --expect-snapshot-hash <sha256> --service-env-file \.\/ci\/service\.env --format table/);
assert.match(readme, /icpdb help quickstart/);
assert.match(readme, /icpdb help sdk/);
assert.match(readme, /icpdb help server/);
assert.match(readme, /icpdb help lifecycle/);
assert.match(readme, /icpdb help provision-service/);
assert.match(readme, /icpdb help database/);
assert.match(readme, /icpdb help db/);
assert.match(readme, /icpdb help databases/);
assert.match(readme, /icpdb help sql/);
assert.match(readme, /icpdb help query/);
assert.match(readme, /icpdb help execute/);
assert.match(readme, /icpdb help scalar/);
assert.match(readme, /icpdb help exec/);
assert.match(readme, /icpdb help batch/);
assert.match(readme, /icpdb help transaction/);
assert.match(readme, /icpdb help script/);
assert.match(readme, /icpdb help load/);
assert.match(readme, /icpdb help dump/);
assert.match(readme, /icpdb help migrate/);
assert.match(readme, /icpdb help inspect/);
assert.match(readme, /icpdb help schema/);
assert.match(readme, /icpdb help tables/);
assert.match(readme, /icpdb help views/);
assert.match(readme, /icpdb help describe/);
assert.match(readme, /icpdb help columns/);
assert.match(readme, /icpdb help indexes/);
assert.match(readme, /icpdb help triggers/);
assert.match(readme, /icpdb help foreign-keys/);
assert.match(readme, /icpdb help preview/);
assert.match(readme, /icpdb help status/);
assert.match(readme, /icpdb help stats/);
assert.match(readme, /icpdb help health/);
assert.match(readme, /icpdb help usage/);
assert.match(readme, /icpdb help usage-events/);
assert.match(readme, /icpdb help placement/);
assert.match(readme, /icpdb help inspect-env/);
assert.match(readme, /icpdb help principal/);
assert.match(readme, /icpdb help url/);
assert.match(readme, /icpdb help info/);
assert.match(readme, /icpdb help service-env/);
assert.match(readme, /icpdb help env/);
assert.match(readme, /icpdb help check-env/);
assert.match(readme, /icpdb help generate-identity/);
assert.match(readme, /icpdb help identity/);
assert.match(readme, /icpdb help permissions/);
assert.match(readme, /icpdb help auth/);
assert.match(readme, /icpdb help token/);
assert.match(readme, /icpdb help http/);
assert.match(readme, /icpdb help members/);
assert.match(readme, /icpdb help grant-member/);
assert.match(readme, /icpdb help revoke-member/);
assert.match(readme, /icpdb help backup/);
assert.match(readme, /icpdb help archive/);
assert.match(readme, /icpdb help snapshot-info/);
assert.match(readme, /icpdb help restore/);
assert.match(readme, /icpdb help operation/);
assert.match(readme, /icpdb help operation-wait/);
assert.match(readme, /icpdb help operation-reconcile/);
assert.match(readme, /icpdb help operations/);
assert.match(readme, /icpdb help shell/);
assert.match(readme, /icpdb help shell sql/);
assert.match(readme, /icpdb help shell delete-db/);
assert.match(readme, /icpdb help ops/);
assert.match(readme, /icpdb help placements/);
assert.match(readme, /icpdb help all-placements/);
assert.match(readme, /icpdb help shard-create/);
assert.match(readme, /icpdb help shard-register/);
assert.match(readme, /icpdb help controller/);
assert.match(readme, /icpdb help shard-status/);
assert.match(readme, /icpdb help shard-top-up/);
assert.match(readme, /icpdb help shard-maintain/);
assert.match(readme, /icpdb help shard-migrate/);
assert.match(readme, /icpdb help remote-create-db/);
assert.match(readme, /icpdb help shard-reconcile/);
assert.match(readme, /icpdb help shard-ops/);
assert.match(readme, /icpdb help create-db/);
assert.match(readme, /icpdb help delete-db/);
assert.match(readme, /icpdb generate-identity --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(readme, /reads cwd-local `service\.env` by default and supports `--service-env-file <path>`/);
assert.match(readme, /`--service-env-file` and `--env-file` are for commands that read an existing service env/);
assert.match(readme, /`init`, `generate-identity`, and `snapshot-info` reject them because they use `--env-out`, direct identity target options, or a local snapshot file instead/);
assert.match(readme, /`icpdb help sql` shows auto-routed `sql` for SELECTs/);
assert.match(readme, /read SQL uses query while writes use execute/);
assert.match(readme, /read-routed `sql` \/ `execute` reject `--idempotency-key` and `--wait` before `service\.env` or params files are loaded/);
assert.match(readme, /`icpdb help lifecycle`, `icpdb help database`, and `icpdb help db` print the normal canister-only create, database list, post-create write, read, count, table\/view, schema\/describe, stats, preview, and inspect health checks, status, URL\/info handoff, and guarded `delete-db --confirm <database-id>` cleanup flow without reading `service\.env`/);
assert.match(readme, /`icpdb help service-env` and `icpdb help env` print service identity generation, local service-env diagnosis, principal, URL\/info handoff, explicit canister-only DB creation, post-create env verification, canister-only controller\.env generation and controller-grant steps, and non-default env-file examples without reading secrets beyond the selected owner-only env file/);
assert.match(readme, /`icpdb help check-env` prints the installed-SDK service env verification path/);
assert.match(readme, /scratch archive\/restore smoke for owner envs/);
assert.match(readme, /canister-only `controller\.env` generation, controller-grant, shard smoke/);
assert.match(readme, /The `check-env` table\/json\/csv output itself includes next commands: canister-only checks show `nextInspectEnvCommand`, `nextCreateDbCommand`, `nextCheckEnvCommand`, and `nextInfoCommand`; DB-bearing checks show `nextStatusCommand`, `nextMembersCommand`, `nextQueryCommand`, `nextSchemaCountCommand`, `nextTablesCommand`, `nextViewsCommand`, `nextStatsCommand`, `nextSchemaCommand`, `nextUrlCommand`, and `nextInfoCommand`; writer\/owner checks also show `nextExecuteCommand`, `nextInsertCommand`, `nextReadCommand`, `nextDescribeCommand`, `nextPreviewCommand`, and `nextSqlSmokeCommand`; owner checks also show `nextArchiveCommand`, `nextSnapshotInfoCommand`, `nextHashPinnedRestoreCommand`, and `nextOwnerArchiveRestoreSmokeCommand`/);
assert.match(readme, /`icpdb help generate-identity` and `icpdb help identity` print the installed-SDK service identity bootstrap path/);
assert.match(readme, /`generate-identity --env-out service\.env` writes a new owner-only `service\.env` and refuses to overwrite an existing file/);
assert.match(readme, /`init --env-out service\.env` uses the same guard before generating the Server\/CI private key or creating a DB/);
assert.match(readme, /`generate-identity --format env` prints the secret-bearing env block for secret-manager setup/);
assert.match(readme, /The same focused help states that Browser\/II and generated Server\/CI service principals are different/);
assert.match(readme, /joined through the DB ACL rather than shared browser private keys/);
assert.match(readme, /names the console `Member principal` paste target and `Grant member access` button/);
assert.match(readme, /shows `members` plus scalar verification after the console grant/);
assert.match(readme, /`icpdb help migrate` prints the versioned migration JSON shape, retry-safe migrate command, applied-version inspection query, first-DB setup-migration path, and read-only script check alternative without reading `service\.env`/);
assert.match(readme, /`icpdb help query` and `icpdb help scalar` print focused read-SQL examples with table\/csv output, inline and file-backed params, auto-routed read SQL, and a non-default `--service-env-file \.\/ci\/service\.env` example/);
assert.match(readme, /`icpdb help execute` prints focused write-SQL examples with inline and named params, retry-safe idempotency keys, `--wait`, auto-routed write SQL, script-style writes, and a non-default `--service-env-file \.\/ci\/service\.env` example/);
assert.match(readme, /`icpdb help batch`, `icpdb help script`, and `icpdb help dump` print the focused statement-file and SQL dump flow with JSON statement batches, transactions, read-mode checks, SQL files\/stdin, dump export\/import, retry-safe write waits, and non-default `--service-env-file \.\/ci\/service\.env` examples/);
assert.match(readme, /Use `--format table` for human CI logs and quick schema\/table checks/);
assert.match(readme, /use `--format csv` for row export and spreadsheet-friendly checks/);
assert.match(readme, /use `--format env` for URL\/info\/snapshot handoff fields or explicit secret-bearing `generate-identity` output/);
assert.match(readme, /`create-db --format table` and `create-db --format csv` print flat key\/value rows/);
assert.match(readme, /`icpdb help create-db` prints canister-only env inspection, explicit DB creation variants, the table\/json\/csv next-command fields[\s\S]*the persisted-DB SQL health path with write, read, count, table\/view list, stats, schema\/describe, preview, table inspect, status, members, and reusable URL\/info handoff/);
assert.match(readme, /For `init` and `create-db`, table\/json\/csv output also includes[\s\S]*`nextViewsCommand`, `nextStatsCommand`, `nextSchemaCommand`,[\s\S]*`nextDescribeCommand`, `nextPreviewCommand`, `nextStatusCommand`,[\s\S]*`nextMembersCommand`, `nextUrlCommand`, and `nextInfoCommand`/);
assert.match(readme, /`icpdb help init` prints the one-command Server\/CI DB bootstrap[\s\S]*table\/json\/csv next-command fields[\s\S]*owner SQL plus archive\/restore smoke, write, read, count, table\/view list, stats, schema\/describe, preview, table inspect, status, members, and reusable URL\/info handoff/);
assert.match(readme, /`icpdb help databases` prints the focused DB inventory and selected-DB operations flow with database list, status, usage, usage events, placement, URL\/info handoff, guarded `delete-db --confirm <database-id>` cleanup, and non-default `--service-env-file \.\/ci\/service\.env` examples/);
assert.match(readme, /`icpdb help schema`, `icpdb help tables`, and `icpdb help describe` print the focused schema\/table catalog flow with table and view lists, full and per-table schema SQL, table description, column\/index\/trigger\/foreign-key checks, preview\/inspect window checks, CSV export, and a non-default `--service-env-file \.\/ci\/service\.env` example/);
assert.match(readme, /`icpdb help status` prints the focused DB health and handoff check with caller role, connection URL, placement, usage, table stats, nearby members\/schema\/stats checks, writer\/owner smoke checks, and a non-default `--service-env-file \.\/ci\/service\.env` example instead of falling back to a single command usage line/);
assert.match(readme, /`icpdb help quickstart`, `icpdb help sdk`, and `icpdb help server` print the app SDK shortest path/);
assert.match(readme, /print the app SDK shortest path with `createClient\(\{ canisterId, identity, setupSql \}\)`, `execute`, `query`, `result\.rows`, `connectionUrl\(\)`, and `info`, name `@icpdb\/client\/browser` for Browser\/II apps, print a hosted SQLite subpath block with `createSqliteClient` and `SqliteRow` from `@icpdb\/client\/sqlite`, `sqliteDb\.execute`, typed `sqliteDb\.query` rows, and `sqliteDb\.connectionUrl\(\)`, then one-command `init` service identity and DB bootstrap with inline SQL, `--setup-file \.\/schema\.sql`, or `--setup-migrations-file \.\/migrations\.json`, the table\/json\/csv next-command fields/);
assert.match(readme, /the Browser\/II quickstart grant line says Browser\/II and Server\/CI principals stay different, are joined through the DB ACL, and names the console `Member principal` paste target plus `Grant member access` button/);
assert.match(readme, /without implying principal equality/);
assert.match(readme, /`icpdb help provision-service` prints the existing-DB owner-env handoff: package `provision-service`, writer\/owner role verification, owner-only archive\/restore proof, and the Browser\/II alternative that generates a service identity and joins it through console Permissions instead of sharing a browser private key/);
assert.match(readme, /the focused Browser\/II grant line also says Browser\/II and Server\/CI principals stay different, are joined through the DB ACL, and points to `Member principal` plus `Grant member access` in console Permissions/);
assert.match(readme, /`icpdb help stats` prints the focused DB aggregate and per-table stats check with table\/json\/csv formats, nearby status\/table\/view\/inspect commands, and a non-default `--service-env-file \.\/ci\/service\.env` example/);
assert.match(readme, /`icpdb help health` prints the control canister health check without selecting or creating a DB, table\/json\/csv formats, canister-only controller\.env preflight before shard operations, and a non-default `--service-env-file \.\/ci\/service\.env` example/);
assert.match(readme, /`icpdb help inspect-env` prints the local-only service env diagnosis path before canister calls, including owner-only file mode, connection URL, setup field, derived principal, database-bearing URL\/check-env follow-up, canister-only first-call info\/url\/sql creation plus explicit create-db for setup SQL, controller\.env diagnosis, shard smoke, and non-default env-file examples/);
assert.match(readme, /The `inspect-env` table\/json\/csv output itself includes next commands: canister-only envs show `nextCreateDbCommand`, `nextScalarCommand`, `nextExecuteCommand`, `nextQueryCommand`, and `nextInfoCommand`; database-bearing envs show `nextCheckEnvCommand`, `nextQueryCommand`, `nextSchemaCountCommand`, `nextTablesCommand`, `nextViewsCommand`, `nextStatsCommand`, `nextStatusCommand`, `nextMembersCommand`, `nextUrlCommand`, and `nextInfoCommand`/);
assert.match(readme, /`icpdb help principal` prints the exact service principal loaded from `service\.env` without a canister call, Browser\/II console Permissions handoff steps, owner-env grant\/revoke commands, controller\.env principal use for canister controller grants, and non-default env-file examples/);
assert.match(readme, /`icpdb help url` prints the reusable `icpdb:\/\/<canister-id>\/<database-id>` handoff path with local `inspect-env`, `url --format env`, matching `ICPDB_URL` \/ `ICPDB_CONNECTION_URL` output, app SDK `connectClient` reconnect, Server\/CI `connectClientFromEnvFile\(\)` reconnect, canister-only first-call URL\/info creation plus explicit `create-db` for setup SQL, and non-default env-file examples/);
assert.match(readme, /`icpdb help info` prints the Server\/CI handoff object path with local `inspect-env`, `info --format table`, `info --format env`, `check-env`, SQL scalar\/table verification, the matching app SDK `client\.info\(\)` call, and non-default env-file examples/);
assert.match(readme, /`icpdb help permissions` and `icpdb help auth` print the Browser\/II-owned DB service-principal grant check, database-bearing `generate-identity --env-out service\.env`, the warning that Browser\/II and Server\/CI service principals are intentionally different and joined by the DB ACL, concrete console Permissions paste\/role\/grant steps, writer-role SQL smoke verification, and owner-role `check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table` verification/);
assert.match(readme, /ACL member list, owner-only grant\/revoke commands, and owner-role backup reminder without reading `service\.env`/);
assert.match(readme, /`icpdb help token`, `icpdb help tokens`, `icpdb help http`, and `icpdb help curl` state that normal Server\/CI jobs use `service\.env` service identities instead of database bearer tokens/);
assert.match(readme, /keep bearer tokens optional for curl-compatible external HTTP clients, browser token sessions, or short-lived sharing/);
assert.match(readme, /The package `icpdb` CLI intentionally has no `create-token` command, so token help does not imply tokens are required for CI/);
assert.match(readme, /`icpdb help members` prints the focused ACL member flow with member listing, loaded service principal, status, owner-env grant\/revoke commands, writer versus owner role verification, and a non-default `--service-env-file owner\.env` example/);
assert.match(readme, /`icpdb help backup`, `icpdb help archive`, `icpdb help snapshot-info`, and `icpdb help restore` print the owner-role archive preflight, SQL plus scratch archive\/restore smoke, offline snapshot hash check, env hash handoff, hash-pinned restore, archive table\/json\/csv next-command fields, non-default restore env-file usage, and post-restore scalar\/table\/views\/schema\/inspect\/stats\/status\/members\/url\/info verification flow without reading `service\.env`/);
assert.match(readme, /`icpdb help operation`, `icpdb help operation-wait`, `icpdb help operation-reconcile`, and `icpdb help operations` print the remote-shard routed write recovery path, including idempotent write examples, operation lookup, wait with unknown reconciliation, manual reconcile, and non-default env-file operation lookup without reading `service\.env`/);
assert.match(readme, /Actual recovery command-name topics render the same flow instead of falling back to single command usage lines/);
assert.match(readme, /`icpdb help ops` \/ `icpdb help shards` \/ `icpdb help shard-status` \/ `icpdb help shard-ops` \/ `icpdb help controller` print controller identity generation, the explicit `icp canister settings update` controller-grant step, controller\.env inspection, controller `health`, shard smoke, inventory, zero-action maintenance, shard create\/register\/status\/top-up, migration, remote create, shard journal, and reconcile commands without reading the default `service\.env`/);
assert.match(readme, /`icpdb help shard`, `icpdb help shards`, `icpdb help placements`, `icpdb help all-placements`, `icpdb help shard-create`, `icpdb help shard-register`, `icpdb help shard-status`, `icpdb help shard-top-up`, `icpdb help shard-maintain`, `icpdb help shard-migrate`, `icpdb help remote-create-db`, `icpdb help shard-reconcile`, `icpdb help shard-ops`, and `icpdb help controller` are aliases for `icpdb help ops`, so shard operators can discover controller\/shard operations from the actual command terminology instead of falling back to single command usage lines/);
assert.match(readme, /`icpdb help shell` and `icpdb help shell sql` print the service-env Turso-like shell commands for health, URL\/info\/status handoff, stats, schema\/table checks, table description, member grants, file-backed load\/script\/migrate, backup, guarded cleanup, and one-shot SQL; shell write SQL and file write dot-commands auto-generate idempotency keys and honor `--wait` for routed remote writes/);
assert.match(readme, /Browser Internet Identity login examples also need the auth helper package/);
assert.match(readme, /npm install @icpdb\/client @icp-sdk\/auth/);
assert.match(readme, /pnpm add @icpdb\/client @icp-sdk\/auth/);
assert.match(readme, /yarn add @icpdb\/client @icp-sdk\/auth/);
assert.match(readme, /bun add @icpdb\/client @icp-sdk\/auth/);
assert.match(readme, /pnpm --dir icpdb-console build:sdk/);
assert.match(readme, /npm install \.\/icpdb-console\/dist-sdk/);
assert.match(readme, /icpdb shell "\.health" --format table/);
assert.match(readme, /icpdb shell "\.url" --format table/);
assert.match(readme, /icpdb shell "\.info" --format table/);
assert.match(readme, /icpdb shell "\.status" --format table/);
assert.match(readme, /icpdb shell "\.stats" --format table/);
assert.match(readme, /icpdb shell "\.describe notes" --format table/);
assert.match(readme, /icpdb describe notes --format table/);
assert.match(readme, /## Fast Start/);
assert.match(readme, /## Product Target/);
assert.match(readme, /ordinary hosted SQL DB usage on IC, not full Turso compatibility/);
assert.match(readme, /Priority order: app SDK ergonomics, shortest DB creation to `query` \/ `execute`, console schema\/table\/SQL inspection, Server\/CI `service\.env` operation, archive\/restore and shard operation, then auth and permission polish/);
assert.match(readme, /Turso\/libSQL compatibility is limited to the SQL-client edge/);
assert.match(readme, /ICPDB keeps IC identities, `icpdb:\/\/` URLs, principal ACLs, and canister execution boundaries explicit/);
assert.match(readme, /`authToken`, `libsql:\/\/`, embedded replica sync, and multi-call interactive transactions are not product goals/);
assert.match(readme, /Create a hosted DB, set up schema, execute, query, and persist one handoff object with one client/);
assert.match(readme, /Shortest app path/);
assert.match(readme, /Shortest app path:\n\n```ts\nimport \{ AuthClient \} from "@icp-sdk\/auth\/client";\nimport \{ createClient, sql \} from "@icpdb\/client";\n\nconst DELEGATION_TTL_NS = BigInt\(8\) \* BigInt\(3_600_000_000_000\);\nconst host = window\.location\.hostname;\nconst identityProvider = host === "localhost" \|\| host === "127\.0\.0\.1" \|\| host\.endsWith\("\.localhost"\)\n  \? "http:\/\/id\.ai\.localhost:8000"\n  : "https:\/\/id\.ai";\nconst authClient = await AuthClient\.create\(\);\nif \(!\(await authClient\.isAuthenticated\(\)\)\) \{\n  await new Promise<void>\(\(resolve, reject\) => \{\n    authClient\.login\(\{\n      identityProvider,\n      maxTimeToLive: DELEGATION_TTL_NS,\n      onSuccess: \(\) => resolve\(\),\n      onError: \(error\) => reject\(new Error\(error \?\? "Internet Identity login failed"\)\)\n    \}\);\n  \}\);\n\}\nconst identity = authClient\.getIdentity\(\);\nconst db = createClient/);
assert.match(readme, /authClient\.login\(\{/);
assert.match(readme, /identityProvider,\n\s+maxTimeToLive: DELEGATION_TTL_NS/);
assert.match(readme, /const identity = authClient\.getIdentity\(\)/);
assert.match(readme, /const db = createClient\(\{ canisterId, identity, setupSql: "CREATE TABLE notes/);
assert.match(readme, /const result = await db\.query\("SELECT id, body FROM notes ORDER BY id DESC"\)/);
assert.match(readme, /const rows = result\.rows/);
assert.match(readme, /const connectionUrl = await db\.connectionUrl\(\)/);
assert.match(readme, /const info = await db\.info\(\)/);
assert.match(readme, /libSQL-shaped app code can keep SQL calls and replace only connection\/auth/);
assert.match(readme, /import \{ createLibsqlClient \} from "@icpdb\/client\/libsql"/);
assert.match(readme, /url: connectionUrl/);
assert.match(readme, /const libsqlRows = \(await libsqlDb\.execute\("SELECT id, body FROM notes ORDER BY id DESC"\)\)\.rows/);
assert.match(readme, /The SDK rejects the anonymous principal `2vxsx-fae` at client creation time/);
assert.match(readme, /Shortest Server\/CI path after `service\.env` exists/);
assert.match(readme, /import \{ createClientFromEnvFile \} from "@icpdb\/client\/server"/);
assert.match(readme, /const db = await createClientFromEnvFile\(\)/);
assert.match(readme, /await db\.execute\("INSERT INTO notes\(body\) VALUES \(\?1\)", \["from-ci"\]\)/);
assert.match(readme, /const result = await db\.query\("SELECT id, body FROM notes ORDER BY id DESC"\)/);
assert.match(readme, /const connectionUrl = await db\.connectionUrl\(\)/);
assert.match(readme, /const smokeDb = await createClientFromEnvFile\(\)/);
assert.match(readme, /const firstValue = await smokeDb\.scalar\("SELECT 1 AS value"\)/);
assert.match(readme, /const createResult = await smokeDb\.execute\(\{/);
assert.match(readme, /sql: "CREATE TABLE readiness_query_only\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)"/);
assert.match(readme, /idempotencyKey: "readiness-query-only-create-table-001"/);
assert.match(readme, /wait: true/);
assert.match(readme, /const writeResult = await smokeDb\.execute\(\{/);
assert.match(readme, /sql: "INSERT INTO readiness_query_only\(body\) VALUES \(\?1\)"/);
assert.match(readme, /args: \["readiness-query-only"\]/);
assert.match(readme, /idempotencyKey: "readiness-query-only-write-001"/);
assert.match(readme, /wait: \{ reconcileUnknown: true \}/);
assert.match(readme, /const smokeRows = await smokeDb\.queryRows\("SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1"\)/);
assert.match(readme, /const persistedUrl = await smokeDb\.connectionUrl\(\)/);
assert.match(readme, /const smokeInfo = await smokeDb\.info\(\)/);
assert.match(readme, /Owner-role jobs can back up and hash-pin restore from the same `service\.env`/);
assert.match(readme, /archiveDatabaseToFileFromEnvFile,\n  restoreDatabaseFromFileFromEnvFile,\n  snapshotInfoFile\n\} from "@icpdb\/client\/server"/);
assert.match(readme, /const archived = await archiveDatabaseToFileFromEnvFile\("\.\/backup\.sqlite"\)/);
assert.match(readme, /const snapshot = await snapshotInfoFile\("\.\/backup\.sqlite"\)/);
assert.match(readme, /if \(snapshot\.sha256 !== archived\.sha256\) throw new Error\("snapshot hash mismatch"\)/);
assert.match(readme, /await restoreDatabaseFromFileFromEnvFile\("\.\/backup\.sqlite", \{ expectedSha256: snapshot\.sha256 \}\)/);
assert.match(readme, /const client = createClient\(\{\n  canisterId,\n  identity,\n  setupSql: "CREATE TABLE notes/);
assert.match(readme, /await client\.execute\(\{ sql: "INSERT INTO notes/);
assert.match(readme, /await client\.execute\(sql`INSERT INTO notes/);
assert.match(readme, /args: \["hello"\]/);
assert.match(readme, /const result = await client\.query\("SELECT id, body FROM notes ORDER BY id DESC"\)/);
assert.match(readme, /const note = await client\.get/);
assert.match(readme, /const total = await client\.scalar\("SELECT count\(\*\) FROM notes"\)/);
assert.match(readme, /const rows = result\.rows/);
assert.match(readme, /const connectionUrl = await client\.connectionUrl\(\)/);
assert.match(readme, /const info = await client\.info\(\)/);
assert.match(readme, /`connectionUrl` and `url` inside `client\.info\(\)` are reusable `icpdb:\/\/<canister-id>\/<database-id>` values for later app, Server, CLI, or CI runs/);
assert.match(readme, /`client\.info\(\)` returns `\{ canisterId\?, databaseId, connectionUrl, url, principal\? \}` after the DB exists/);
assert.match(readme, /Because `databaseId` is omitted, the first SQL call creates the hosted DB, runs `setupSql`, and then executes the insert/);
assert.match(readme, /exported `sql` tagged template for bound values/);
assert.match(readme, /libSQL-shaped `client\.execute\(\{ sql, args \}\)` form/);
assert.match(readme, /the first call can be `query`, `get`, or `scalar`; creation is not tied to writes/);
assert.match(readme, /Read-first setup can seed data before the first app read/);
assert.match(readme, /setupStatements: \[\{ sql: "INSERT INTO notes\(body\) VALUES \(:body\)", args: \{ body: "seed" \} \}\]/);
assert.match(readme, /const seeded = await readFirstClient\.get\("SELECT body FROM notes LIMIT 1"\)/);
assert.match(readme, /Calling `connectionUrl\(\)` or `url\(\)` first also creates the hosted DB, runs `setupSql`, and returns the reusable URL before application SQL runs/);
assert.match(readme, /If no setup block is needed, the first `execute\("CREATE TABLE \.\.\."\)` call still creates the hosted DB/);
assert.match(readme, /Start from a canister-only ICPDB URL when setup code wants one connection field/);
assert.match(readme, /import \{ createClient, formatIcpdbCanisterUrl, sql \} from "@icpdb\/client"/);
assert.match(readme, /connectionUrl: formatIcpdbCanisterUrl\(canisterId\)/);
assert.match(readme, /Reconnect later with the explicit DB connection URL/);
assert.match(readme, /import \{ connectClient \} from "@icpdb\/client"/);
assert.match(readme, /const client = connectClient\(\{/);
assert.match(readme, /connectionUrl,/);
assert.match(readme, /const count = await client\.scalar\("SELECT count\(\*\) FROM notes"\)/);
assert.match(readme, /Using `connectClient` requires a DB-bearing URL or `canisterId` plus `databaseId`/);
assert.match(readme, /`databaseId` without a canister id or DB URL fails with `missing canisterId`/);
assert.match(readme, /canister-only URLs fail with `databaseId is required`/);
assert.match(readme, /Choose either `connectionUrl` or `url` in SDK options; passing both is rejected/);
assert.match(readme, /Browser Internet Identity apps pass the delegation identity directly/);
assert.match(readme, /Use `@icpdb\/client\/browser` when app code wants an explicit browser-safe import path/);
assert.match(readme, /resolves to the same client as the root entry/);
assert.match(readme, /import \{ AuthClient \} from "@icp-sdk\/auth\/client"/);
assert.match(readme, /const authClient = await AuthClient\.create\(\)/);
assert.match(readme, /authClient\.login\(\{/);
assert.match(readme, /identityProvider: identityProviderUrl\(\)/);
assert.match(readme, /maxTimeToLive: DELEGATION_TTL_NS/);
assert.match(readme, /onSuccess: \(\) => resolve\(\)/);
assert.match(readme, /onError: \(error\) => reject\(new Error\(error \?\? "Internet Identity login failed"\)\)/);
assert.match(readme, /const identity = authClient\.getIdentity\(\)/);
assert.match(readme, /Do not pass the browser principal as a string/);
assert.match(readme, /do not configure `derivationOrigin`/);
assert.match(readme, /Add parameterized setup statements or versioned migrations/);
assert.match(readme, /import \{ createClient, sql \} from "@icpdb\/client"/);
assert.match(readme, /sql`INSERT INTO notes\(body\) VALUES/);
assert.match(readme, /The same `sql` tagged template works for single statements, `batch`, `transaction`, `setupStatements`, and libSQL-shaped `migrate` statement arrays/);
assert.match(readme, /const databaseId = await client\.databaseId\(\)/);
assert.match(readme, /createClient/);
assert.match(readme, /createLibsqlClient/);
assert.match(readme, /createTursoLikeClient/);
assert.match(readme, /Turso \/ libSQL-shaped API/);
assert.match(readme, /`Client`, `Config`, `ResultSet`, `Row`, `InArgs`, `InStatement`, `Statement`, `BatchStatement`, `BatchResult`, `PreparedStatement`, `Sql`, `InValue`, `Value`, `TransactionMode`, and `IntMode`/);
assert.match(readme, /`@icpdb\/client\/web` and `@icpdb\/client\/browser` resolve to the browser-safe identity-first SQL client/);
assert.match(readme, /`@icpdb\/client\/sqlite` re-exports the same root SQL client under an explicit hosted SQLite subpath[\s\S]*`createSqliteClient`, `connectSqliteClient`, `createSqliteDatabase`, `connectSqliteDatabase`, `parseSqliteDatabaseUrl`, `SqliteClient`, and `SqliteDatabaseClient`/);
assert.match(readme, /SQLite-named row\/value\/prepared\/batch type aliases such as `SqliteRow`, `SqliteValue`, `SqlitePreparedStatement`, `SqliteBatchStatement`, and `SqliteBatchResult`/);
assert.match(readme, /`@icpdb\/client\/libsql` re-exports the root SQL client under a libSQL-shaped subpath/);
assert.match(readme, /both subpaths still require IC identity options, use `icpdb:\/\/` URLs, and reject `authToken` \/ `libsql:\/\/` semantics/);
assert.match(readme, /`@icpdb\/client\/server` is the Server\/CI subpath/);
assert.match(readme, /server jobs can import one package subpath for `createClient`, `connectClientFromEnvFile`, `createClientFromEnvFile`, archive\/restore file helpers, and principal inspection/);
assert.match(readme, /`@icpdb\/client\/node` remains an equivalent Node alias for existing imports/);
assert.match(readme, /root, web, and browser SQL client entries stay free of Next\.js, React, and Node builtin imports/);
assert.match(readme, /Node-only helpers also remain available under `@icpdb\/client\/service-identity`/);
assert.match(readme, /Database bearer tokens are not the SDK's Server\/CI path/);
assert.match(readme, /Use `@icpdb\/client\/server` or `@icpdb\/client\/service-identity`/);
assert.match(readme, /curl-compatible external HTTP clients, browser token sessions, or short-lived sharing/);
assert.match(readme, /When porting common `@libsql\/client` app code, keep the SQL calls and replace only the connection\/auth boundary/);
assert.match(readme, /import \{ connectClient, formatIcpdbDatabaseUrl, sql \} from "@icpdb\/client"/);
assert.match(readme, /const db = connectClient\(\{/);
assert.match(readme, /url: formatIcpdbDatabaseUrl\(canisterId, databaseId\)/);
assert.match(readme, /`execute\("SELECT \.\.\."\)` stays reader-role safe/);
assert.match(readme, /classifies read SQL locally and sends it through the query path/);
assert.match(readme, /Do not carry over `authToken`; database access is granted to the IC principal behind `identity`/);
assert.match(readme, /not a drop-in `@libsql\/client` replacement/);
assert.match(readme, /IC identities instead of `authToken`/);
assert.match(readme, /Full Turso compatibility is not the goal/);
assert.match(readme, /Turso-like SQL ergonomics with explicit IC boundaries/);
assert.match(readme, /Passing `authToken`, `syncUrl`, `syncInterval`, `tls`, `fetch`, `concurrency`, `offline`, `readYourWrites`, or `encryptionKey` is rejected/);
assert.match(readme, /does not implement embedded replicas/);
assert.match(readme, /SDK canister errors throw `LibsqlError`/);
assert.match(readme, /read-mode batch validation throws `LibsqlBatchError` with `statementIndex`/);
assert.match(readme, /`classifyLibsqlErrorMessage` maps common SQLite and ICPDB errors to machine-readable codes/);
assert.match(readme, /`isLibsqlError`, `isLibsqlBatchError`, and `isIcpdbLibsqlErrorCode` narrow unknown caught errors/);
assert.match(readme, /batch\(statements, \{ mode: "write", idempotencyKey \}\)/);
assert.match(readme, /`protocol`, `closed`, `close\(\)`, and `reconnect\(\)`/);
assert.match(readme, /later calls reuse that created DB id instead of creating another database/);
assert.match(readme, /`delete\(\)` is terminal for that client/);
assert.match(readme, /`intMode: "number" \| "bigint" \| "string"` controls SQLite integer result cells/);
assert.match(readme, /transaction\(statements, "write"\)/);
assert.match(readme, /`sync\(\)` and interactive `transaction\("write"\)` fail/);
assert.match(readme, /url: "icpdb:\/\/<canister-id>\/<database-id>"/);
assert.match(readme, /url: "icpdb:\/\/<canister-id>"/);
assert.match(readme, /formatIcpdbCanisterUrl/);
assert.match(readme, /formatIcpdbDatabaseUrl/);
assert.match(readme, /parseIcpdbDatabaseUrl/);
assert.match(readme, /Browser Internet Identity principals and Server\/CI service identity principals are intentionally different/);
assert.match(readme, /Do not share a private key to force principal equality/);
assert.match(readme, /grant the service principal to the same database ACL/);
assert.match(readme, /loadIcpdbServicePrincipalFromEnvFile\("\.\/service\.env"\)/);
assert.match(readme, /Generated service env includes `ICPDB_IDENTITY_PRINCIPAL`/);
assert.match(readme, /reject principal drift before DB calls/);
assert.match(readme, /from "@icpdb\/client\/server"/);
assert.match(readme, /`createDatabase` and `connectDatabase` are short aliases/);
assert.match(readme, /import \{ connectDatabase, createClient, createDatabase \} from "@icpdb\/client"/);
assert.match(readme, /const db = await createDatabase\(\{ canisterId, identity \}\)/);
assert.match(readme, /const connectedDb = await connectDatabase/);
assert.match(readme, /createIcpdbDatabase/);
assert.match(readme, /createIcpdbDatabase.*rejects `databaseId`/);
assert.match(readme, /connectIcpdbDatabase.*require an existing database locator/);
assert.match(readme, /`canisterId` plus `databaseId`, a DB-bearing `connectionUrl`, or a DB-bearing `url`/);
assert.match(readme, /setupSql/);
assert.match(readme, /setupStatements/);
assert.match(readme, /setupMigrations/);
assert.match(readme, /delete the created DB if setup fails/);
assert.match(readme, /Base service env/);
assert.match(readme, /For existing DB helpers, choose one connection form/);
assert.match(readme, /For DB creation helpers, omit `ICPDB_DATABASE_ID`/);
assert.match(readme, /ICPDB_URL=icpdb:\/\/<canister-id>/);
assert.match(readme, /ICPDB_SETUP_SQL/);
assert.match(readme, /ICPDB_SETUP_SQL_FILE/);
assert.match(readme, /ICPDB_SETUP_STATEMENTS/);
assert.match(readme, /ICPDB_SETUP_STATEMENTS_FILE/);
assert.match(readme, /ICPDB_SETUP_MIGRATIONS/);
assert.match(readme, /ICPDB_SETUP_MIGRATIONS_FILE/);
assert.match(readme, /Optional setup env when creating a new database\. Use inline values/);
assert.match(readme, /structured `\{ "kind", "value" \}` bind objects/);
assert.match(readme, /9007199254740993/);
assert.match(readme, /blob byte arrays/);
assert.match(readme, /Or use file-backed setup values, not both forms for the same setup kind/);
assert.match(readme, /target file cannot be opened, transfer fails, or finalize fails/);
assert.match(readme, /SDK `host`/);
assert.match(readme, /Setting both, such as `ICPDB_SETUP_SQL` and `ICPDB_SETUP_SQL_FILE`, is rejected before creating the client/);
assert.match(readme, /Direct database clients accept/);
assert.match(readme, /expose `all`, `get`, `values`, `first`, `firstValue`, `scalar`, `prepare`/);
assert.match(readme, /`delete\(\)`, and `close\(\)` shortcuts/);
assert.match(readme, /named `args` \/ `params` objects/);
assert.match(readme, /Their `migrate` helper accepts both ICPDB versioned migrations and libSQL-shaped statement arrays/);
assert.match(readme, /Schema inspection also has short aliases/);
assert.match(readme, /`columns\(table\)`, `indexes\(table\)`, `triggers\(table\)`, `foreignKeys\(table\)`/);
assert.match(readme, /direct_multiple/);
assert.match(readme, /from-direct-named/);
assert.match(readme, /create_direct_settings/);
assert.match(readme, /low-level `createIcpdbClient` surface also exposes/);
assert.match(readme, /low-level `createIcpdbClient` surface also exposes `all`, `get`, `values`, `first`, `firstValue`, `scalar`, `prepare`/);
assert.match(readme, /migrate\(migrationsOrStatements, databaseId\?\)/);
assert.match(readme, /versioned migrations or libSQL-shaped statement arrays against an explicit `databaseId`/);
assert.match(readme, /client\.createDatabase\(\{ setupSql, setupStatements, setupMigrations \}\)/);
assert.match(readme, /`prepare\(sql, args\?\)`/);
assert.match(readme, /same two migrate forms work on SQL clients and direct database clients/);
assert.match(readme, /`createClientFromDatabase\(source\)` only requires the SQL source contract `databaseId`, `query`, and `execute`/);
assert.match(readme, /Minimal custom adapter:/);
assert.match(readme, /query: \(statement\) => adapter\.query\(statement\)/);
assert.match(readme, /execute: \(statement\) => adapter\.execute\(statement\)/);
assert.match(readme, /Add a source `batch\(statements, options\)` method only when you need atomic write batches/);
assert.match(readme, /\.\.\. is not available on this database source/);
assert.match(readme, /Custom source `connectionUrl\(\)`, `url\(\)`, and `info\(\)` results must be non-empty/);
assert.match(readme, /Explicit custom-source `canisterId` is kept, and mismatches with standard `icpdb:\/\/` URLs are rejected/);
assert.match(readme, /`info\(\)` returns the same URL plus the canister id, DB id, and available principal in one object/);
assert.match(readme, /health\(\)/);
assert.match(readme, /topUpDatabaseBalance/);
assert.match(readme, /listShards/);
assert.match(readme, /createDatabaseShard/);
assert.match(readme, /createRemoteDatabase/);
assert.match(readme, /registerDatabaseShard/);
assert.match(readme, /getShardStatus/);
assert.match(readme, /topUpShard/);
assert.match(readme, /maintainShards/);
assert.match(readme, /migrateDatabaseToShard/);
assert.match(readme, /getRoutedOperation/);
assert.match(readme, /reconcileRoutedOperation/);
assert.match(readme, /waitForRoutedOperation/);
assert.match(readme, /routed write recovery/);
assert.match(readme, /createIcpdbServiceClientFromEnvFile/);
assert.match(readme, /service identity low-level client/);
assert.match(readme, /shard inventory\/status\/creation\/registration\/remote DB creation\/maintenance/);
assert.match(readme, /Direct service identity helpers also accept `connectionUrl` in options/);
assert.match(readme, /`createIcpdbServiceClient`, `connectIcpdbServiceDatabase`, `createIcpdbServiceSqlClient`, and `createIcpdbServiceDatabase`/);
assert.match(readme, /Choose either `connectionUrl` or `url`, not both/);
assert.match(readme, /`service\.env`, `controller\.env`, explicit `\.env`, and token-backed `database\.env` files can contain private keys or bearer tokens/);
assert.match(readme, /repository ignores those handoff files by default/);
assert.match(readme, /For shard operator scripts, `controller\.env` can use a canister-only connection/);
assert.match(readme, /ICPDB_URL=icpdb:\/\/<canister-id>/);
assert.match(readme, /ICPDB_IDENTITY_PEM_FILE=\.\/controller\.pem/);
assert.match(readme, /icpdb-service-env-check\.mjs --env-file controller\.env --smoke-shards --smoke-sdk-shards --format table/);
assert.match(readme, /ICPDB_SERVICE_CHECK_SDK_SHARD_COUNT/);
assert.match(readme, /ICPDB_SERVICE_CHECK_SDK_SHARD_PLACEMENT_COUNT/);
assert.match(readme, /ICPDB_SERVICE_CHECK_SDK_SHARD_OPERATION_COUNT/);
assert.match(readme, /ICPDB_SERVICE_CHECK_SDK_SHARD_MAINTENANCE_ACTIONS/);
assert.match(readme, /ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_HASH/);
assert.match(readme, /ICPDB_SERVICE_CHECK_SDK_ARCHIVE_RESTORE_SCALAR_ROW/);
assert.match(readme, /createIcpdbServiceSqlClientFromEnv/);
assert.match(readme, /createIcpdbServiceSqlClientFromEnvFile/);
assert.match(readme, /connectClientFromEnv/);
assert.match(readme, /connectClientFromEnvFile/);
assert.match(readme, /connectDatabaseFromEnvFile/);
assert.match(readme, /createDatabaseFromEnvFile/);
assert.match(readme, /createClientFromEnv/);
assert.match(readme, /createClientFromEnvFile/);
assert.match(readme, /same owner-only `service\.env` emitted by the package `icpdb` bin/);
assert.match(readme, /Choose one service identity secret form/);
assert.match(readme, /Multiple secret sources are rejected/);
assert.match(readme, /referenced identity file must also be owner-only/);
assert.match(readme, /reject group\/world-readable referenced identity files/);
assert.match(readme, /CLI and Node jobs read cwd-local `service\.env` by default/);
assert.match(readme, /do not need to shell-source private keys or repeat explicit env-file flags/);
assert.match(readme, /Use `--service-env-file <path>` for package CLI commands when the file lives elsewhere/);
assert.match(readme, /For a new Server\/CI-owned DB/);
assert.match(readme, /icpdb init --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --setup-file \.\/schema\.sql --format table/);
assert.match(readme, /--setup-sql "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)"/);
assert.match(readme, /verify the generated env with `icpdb inspect-env --format table`/);
assert.match(readme, /icpdb execute "INSERT INTO notes\(body\) VALUES \(\?1\)"/);
assert.match(readme, /query "SELECT \* FROM notes" --format table/);
assert.match(readme, /scalar "SELECT count\(\*\) FROM notes" --format table/);
assert.match(readme, /handoff env output includes matching `ICPDB_URL` and `ICPDB_CONNECTION_URL`/);
assert.match(readme, /createClientFromEnvFile\(\)` is the Node SDK version of the same canister-only setup path/);
assert.match(readme, /For backup jobs, create the DB with owner role or grant owner before running archive\/restore/);
assert.match(readme, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(readme, /Writer `service\.env` is for SQL write\/query CI, not archive\/restore/);
assert.match(readme, /The SDK smoke connects to the DB-bearing `service\.env` with `connectClientFromEnvFile`/);
assert.match(readme, /Scratch DB creation is limited to the archive\/restore checks/);
assert.match(readme, /For an existing DB where an owner service env is available/);
assert.match(readme, /icpdb provision-service <database-id> writer --service-env-file owner\.env --env-out service\.env --format table/);
assert.match(readme, /icpdb provision-service <database-id> owner --service-env-file owner\.env --env-out service\.env --format table/);
assert.match(readme, /For archive\/restore or final goal proof on that same existing DB/);
assert.match(readme, /The `--smoke-sdk` part connects to the existing DB through `connectClientFromEnvFile`/);
assert.match(readme, /only the archive\/restore smoke creates scratch DBs/);
assert.match(readme, /generate a database-bearing `service\.env`/);
assert.match(readme, /copy the console Response sidebar `Connection URL`, use its database id/);
assert.match(readme, /icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(readme, /principal --format table/);
assert.match(readme, /inspect-env --format table/);
assert.match(readme, /paste the printed service principal into `Member principal`, choose owner, and click `Grant member access`/);
assert.match(readme, /status --format table/);
assert.match(readme, /tables --format table/);
assert.match(readme, /views --format table/);
assert.match(readme, /schema --format table/);
assert.match(readme, /columns <table> --format table/);
assert.match(readme, /indexes <table> --format table/);
assert.match(readme, /triggers <table> --format table/);
assert.match(readme, /foreign-keys <table> --format table/);
assert.match(readme, /inspect --format table/);
assert.match(readme, /verify the canister-visible role and DB shape/);
assert.match(readme, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(readme, /Reads cwd-local service\.env by default/);
assert.match(readme, /archiveDatabaseToFileFromEnvFile/);
assert.match(readme, /restoreDatabaseFromFileFromEnvFile/);
assert.match(readme, /snapshotInfoFile/);
assert.match(readme, /checkIcpdbServiceEnvFileMode/);
assert.match(readme, /checkIcpdbServiceEnvFileMode\(\)/);
assert.match(readme, /loadIcpdbServiceEnvFile\(\)/);
assert.match(readme, /reads `service\.env` by default/);
assert.match(readme, /`connectClientFromEnv` is the short Server\/CI SQL client alias for DB-bearing `process\.env` connections and never creates a DB/);
assert.match(readme, /`connectClientFromEnvFile\(\)` reads `service\.env` by default, requires a DB-bearing `ICPDB_URL` \/ `ICPDB_DATABASE_ID`, and never writes the env file/);
assert.match(readme, /`createClientFromEnv\(\)` reads `process\.env` directly and cannot write a newly created database id back to an env file, so it rejects canister-only env/);
assert.match(readme, /Use it with a DB-bearing `ICPDB_URL` \/ `ICPDB_DATABASE_ID`/);
assert.match(readme, /use `createClientFromEnvFile\(\)` when canister-only setup should auto-create once and persist the database id/);
assert.match(readme, /`createIcpdbServiceSqlClientFromEnv` remains available for explicit lower-level `process\.env` construction/);
assert.match(readme, /createClientFromEnvFile\(\)` is the shortest create-or-connect env-file path/);
assert.match(readme, /createClientFromEnvFile\("\.\/\.env"\)/);
assert.match(readme, /For package CLI commands that should read `\.env` directly, pass `--service-env-file \.env`/);
assert.match(readme, /Repository-local legacy scripts use `ICPDB_ENV_FILE=\.env` or `--env-file \.env`/);
assert.match(readme, /createClientFromEnvFile\(\) creates a DB on the first SQL call and writes ICPDB_DATABASE_ID back/);
assert.match(readme, /Without setup SQL, a first `scalar\("SELECT 1 AS value"\)` also creates an empty hosted DB/);
assert.match(readme, /writes `ICPDB_DATABASE_ID` plus the DB-bearing `ICPDB_URL` back to `service\.env`, and returns `1`/);
assert.match(readme, /first `createClientFromEnvFile\(\)` call can be `info\(\)`/);
assert.match(readme, /returns `\{ canisterId\?, databaseId, connectionUrl, url, principal \}`/);
assert.match(readme, /the first service-env call can also be get\(\), scalar\(\), or info\(\)/);
assert.match(readme, /shortClient\.query\("SELECT id, body FROM notes ORDER BY id DESC"\)/);
assert.match(readme, /client\.query\(\{ sql: "SELECT count\(\*\) AS total FROM notes" \}\)/);
assert.match(readme, /client\.scalar\("SELECT count\(\*\) FROM notes"\)/);
assert.match(readme, /connectDatabaseFromEnvFile\(\) is for DB-bearing service\.env files and never creates a DB/);
assert.match(readme, /It requires a DB-bearing `service\.env` and never creates a database/);
assert.match(readme, /reads `service\.env` by default/);
assert.match(readme, /reject group\/world-readable service env files/);
assert.match(readme, /createIcpdbPersistedServiceSqlClientFromEnvFile/);
assert.match(readme, /inspectIcpdbServiceEnv/);
assert.match(readme, /inspectIcpdbServiceEnvFile/);
assert.match(readme, /without making a canister call/);
assert.match(readme, /reject empty or whitespace-only `canisterId`, `databaseId`, SDK `host`, empty SDK `rootKey`, and `ICPDB_\*` connection values/);
assert.match(readme, /client\.principal\(\)/);
assert.match(readme, /persistedClient\.principal\(\)/);
assert.match(readme, /deletes the newly created DB if env persistence fails/);
assert.match(readme, /generateIcpdbServiceIdentity/);
assert.match(readme, /writeGeneratedIcpdbServiceEnvFile/);
assert.match(readme, /DB-bearing canister-targeted payload directly to `service\.env`/);
assert.match(readme, /browser\/II or controller handoff should generate a canister-targeted or database-bearing env/);
assert.match(readme, /databaseId.*also writes `ICPDB_URL`/);
assert.match(readme, /provisionIcpdbServiceIdentity/);
assert.match(readme, /provisionIcpdbServiceEnvFile/);
assert.match(readme, /provisionIcpdbServiceDatabaseEnvFile/);
assert.match(readme, /reject roles other than `reader`, `writer`, or `owner`/);
assert.match(readme, /The service identity is not the browser Internet Identity principal/);
assert.match(readme, /the database ACL is the boundary that authorizes both principals/);
assert.match(readme, /database ACL is the boundary that authorizes both principals/);
assert.match(readme, /persistIcpdbServiceDatabaseId/);
assert.match(readme, /Whitespace-only database ids are rejected before the env file is rewritten/);
assert.match(readme, /mode 0600/);
assert.match(readme, /service\.env/);
assert.match(readme, /keep the referenced identity file owner-only too/);
assert.match(readme, /must not be group\/world-readable/);
assert.match(readme, /ICPDB_DATABASE_ID/);
assert.match(readme, /ICPDB_URL=icpdb:\/\/<canister-id>\/<database-id>/);
assert.match(readme, /ICPDB_URL=icpdb:\/\/<canister-id>/);
assert.match(readme, /mismatches are rejected before a client is created or a database id is persisted/);
assert.match(readme, /dumpSql/);
assert.match(readme, /loadSqlDump/);
assert.match(readme, /sqlite_sequence/);
assert.match(readme, /generated\/hidden columns/);
assert.match(readme, /client\.grantMember\(principal, role\)/);
assert.match(readme, /client\.listMembers\(\)/);
assert.match(readme, /client\.revokeMember\(principal\)/);
assert.match(readme, /reject empty principal strings/);
assert.match(readme, /client\.getRoutedOperation\(operationId\)/);
assert.match(readme, /client\.reconcileRoutedOperation\(operationId\)/);
assert.match(readme, /client\.waitForRoutedOperation\(operationId, options\)/);
assert.match(readme, /client\.placement\(\)/);
assert.match(readme, /client\.topUpDatabaseBalance\(units\)/);
assert.match(readme, /client\.migrateDatabaseToShard\(databaseCanisterId\)/);
assert.match(readme, /views\(\)/);
assert.match(readme, /`database\(\)` returns an enriched handle with row helpers, SQL script helpers, dump\/load helpers, short table aliases, and DB operation helpers/);
assert.match(readme, /`connectionUrl`, `url`, `info`, `delete`, `getUsage`/);
assert.match(readme, /`database\(\)\.waitForRoutedOperation\(\.\.\.\)` lets handle-oriented app code wait/);
assert.match(readme, /`database\(\)\.status\(\)`, `database\(\)\.archive\(\)`, and `database\(\)\.restore\(\.\.\.\)`/);
assert.match(readme, /`inspect\(\)` returns schema SQL plus table descriptions and preview rows/);
assert.match(readme, /`health\(\)` returns canister health without creating or connecting a database/);
assert.match(readme, /getUsage/);
assert.match(readme, /`status\(\)` returns the connection URL, caller principal, caller role, usage, placement, aggregate stats, and per-table stats/);
assert.match(readme, /caller principal/);
assert.match(readme, /caller role/);
assert.match(readme, /grantMember/);
assert.match(readme, /listMembers/);
assert.match(readme, /revokeMember/);
assert.match(readme, /placement/);
assert.match(readme, /delete/);
assert.match(readme, /close\(\)/);
assert.match(readme, /delegates to the current database handle's `close\(\)`/);
assert.match(readme, /cached database handle/);
assert.match(readme, /Failed initial connect\/create attempts are not cached/);
assert.match(readme, /batch\(statements, "write"\)/);
assert.match(readme, /\{ sql, params \}/);
assert.match(readme, /transaction\(statements\)/);
assert.match(readme, /leading SQL whitespace\/comments/);
assert.match(readme, /CTE-leading statements/);
assert.match(readme, /\[sql, args\?\]/, "README should document [sql, args?] batch tuples");
assert.match(readme, /migrate\(\["CREATE TABLE \.\.\.", \{ sql, args \}, sql tagged template statement objects\]\)/, "README should document libSQL-shaped migrate statements");
assert.match(readme, /Single statement calls also accept/);
assert.match(readme, /`sql` is a tagged template helper for value binds/);
assert.match(readme, /same statement shape as `\{ sql: "SELECT \?1 AS id", args: \[id\] \}`/);
assert.match(readme, /Statement strings and object\/tuple `sql` values must be non-empty strings/);
assert.match(readme, /Batch execution is atomic/);
assert.match(readme, /read.*write.*deferred/);
assert.match(readme, /CTE-leading write statements/);
assert.match(readme, /`createClient` exposes[\s\S]*`executeMultiple`/);
assert.match(readme, /rowsAffected/);
assert.match(readme, /affectedRows/);
assert.match(readme, /changes/);
assert.match(readme, /lastInsertRowid/);
assert.match(readme, /lastInsertRowId/);
assert.match(readme, /toJSON/);
assert.match(readme, /columnTypes/);
assert.match(readme, /positional access such as `row\[0\]`/);
assert.match(readme, /`row.length` when the result does not include a `length` column/);
assert.match(readme, /null-prototype column-name objects/);
assert.match(readme, /aliases such as `__proto__` remain normal column data/);
assert.match(readme, /blob cells return `ArrayBuffer`/);
assert.match(readme, /converts blob cells to byte arrays/);
assert.match(readme, /routedOperationId/);
assert.match(readme, /SQL client statement objects, SQL client script\/dump options, database preview\/inspect\/dump\/restore\/wait options, database handle statement objects, database handle batch\/script options, and SQL client batch options reject `databaseId`/);
assert.match(readme, /low-level DB-first inspect\/dump\/restore\/wait overloads also reject a conflicting option `databaseId`/);
assert.match(readme, /idempotencyKey/);
assert.match(readme, /single-statement write objects/);
assert.match(readme, /Per-statement batch\/transaction `idempotencyKey`, `maxRows`, and `databaseId`/);
assert.match(readme, /Routed operation helpers reject empty or whitespace-only operation ids/);
assert.match(readme, /Shard helpers reject empty or whitespace-only database canister ids/);
assert.match(readme, /Shard cycle\/count helpers reject empty, whitespace-only, negative, or unsafe numeric inputs/);
assert.match(readme, /out-of-range `nat16` shard counts/);
assert.match(readme, /exec.*executeScript.*executeMultiple.*loadSqlDump.*idempotencyKey/);
assert.match(readme, /reader-role script\/dump checks/);
assert.match(readme, /read mode routes each statement through query and rejects writes/);
assert.match(readme, /executeMultiple\(sql\).*libSQL one-argument shape/);
assert.match(readme, /executeMultiple\(sql, \{ idempotencyKey \}\)/);
assert.match(readme, /runs semicolon-separated statements sequentially/);
assert.match(readme, /tables\(\)/);
assert.match(readme, /describe\(tableName\)/);
assert.match(readme, /columns\(tableName\)/);
assert.match(readme, /indexes\(tableName\)/);
assert.match(readme, /triggers\(tableName\)/);
assert.match(readme, /foreignKeys\(tableName\)/);
assert.match(readme, /preview\(tableName\)/);
assert.match(readme, /`database\(\)` returns an enriched handle[\s\S]*`columns`, `indexes`, `triggers`, `foreignKeys`/);
assert.match(readme, /`maxRows`, table preview `limit`, inspect `previewLimit`, and dump `pageSize` values are validated as integers from 1 to 500/);
assert.match(readme, /preview offsets are validated as unsigned 32-bit integers/);
assert.match(readme, /SDK table inspection helpers reject empty or whitespace-only table names/);
assert.match(readme, /client\.snapshotInfo\(snapshot\)/);
assert.match(readme, /local snapshot size and SHA-256 metadata/);
assert.match(readme, /restore\(snapshot, \{ expectedSha256 \}\)/);
assert.match(readme, /rejects empty or malformed hash pins before Candid restore calls/);
assert.match(readme, /reject empty or malformed `expectedSha256` pins before loading env files or reading snapshots/);
assert.match(readme, /expected artifact hash/);
assert.match(readme, /Low-level archive\/restore chunk helpers reject invalid `nat64` offsets/);
assert.match(readme, /named objects/);
assert.match(readme, /from-named-params/);
assert.match(readme, /params.*named objects/);
assert.match(readme, /Repeated named placeholders/);
assert.match(readme, /Boolean bind values map to SQLite integer `1` \/ `0`/);
assert.match(readme, /Number bind values must be finite/);
assert.match(readme, /Integer number binds must be JavaScript safe integers/);
assert.match(readme, /Explicit `\{ kind, value \}` bind objects are validated before SQL calls/);
assert.match(readme, /`integer\.value` must be a base-10 string/);
assert.match(readme, /Date bind values map to SQLite ISO-8601 text/);
assert.match(readme, /ArrayBuffer and Uint8Array bind values map to SQLite blobs/);
assert.match(readme, /DataView and typed-array bind values map to SQLite blobs/);
assert.match(readme, /:name/);
assert.match(readme, /top-level shortcuts/);
assert.match(readme, /prepare\(sql, args\?\)/);
assert.match(readme, /bind\(args\)/);
assert.match(readme, /boundFirst/);
assert.match(readme, /from-prepare/);
assert.match(readme, /exec\(sql\)/);
assert.match(readme, /from-exec/);
assert.match(readme, /executeMultiple/);
assert.match(readme, /migrate/);
assert.match(readme, /icpdb_schema_migrations/);

const packCacheDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-pack-cache-"));
try {
  const packOutput = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
    cwd: "dist-sdk",
    env: npmArtifactEnv(packCacheDir)
  });
  const packEntries = JSON.parse(packOutput.stdout);
  assert.equal(Array.isArray(packEntries), true, "npm pack --dry-run should return a package list");
  const packFiles = new Set(packEntries[0].files.map((file) => file.path));
  for (const filePath of [
    "package.json",
    "README.md",
    "icpdb-sdk.js",
    "icpdb-sdk.d.ts",
    "icpdb-libsql.js",
    "icpdb-libsql.d.ts",
    "icpdb-sqlite.js",
    "icpdb-sqlite.d.ts",
    "icpdb-cli.js",
    "icpdb-cli.d.ts",
    "icpdb-node.js",
    "icpdb-node.d.ts",
    "icpdb-server.js",
    "icpdb-server.d.ts",
    "icpdb-service-identity.js",
    "icpdb-service-identity.d.ts",
    "icpdb-actor.js",
    "icpdb-table-codec.js",
    "types.d.ts"
  ]) {
    assert.equal(packFiles.has(filePath), true, `packed SDK artifact missing ${filePath}`);
  }
  for (const filePath of packFiles) {
    assert.equal(filePath.endsWith(".tsx"), false, `packed SDK artifact should not include React source: ${filePath}`);
    assert.equal(filePath.startsWith("app/"), false, `packed SDK artifact should not include Next app files: ${filePath}`);
    assert.equal(filePath.startsWith("components/"), false, `packed SDK artifact should not include console components: ${filePath}`);
  }
} finally {
  await rm(packCacheDir, { recursive: true, force: true });
}

const publishDryRunCacheDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-publish-dry-run-cache-"));
try {
  const publishOutput = await execFileAsync("npm", ["publish", "--dry-run", "--json"], {
    cwd: "dist-sdk",
    env: npmArtifactEnv(publishDryRunCacheDir)
  });
  const published = JSON.parse(publishOutput.stdout);
  assert.equal(published.id, `@icpdb/client@${manifest.version}`, "npm publish --dry-run should target the SDK package");
  assert.equal(published.name, "@icpdb/client", "npm publish --dry-run should keep the SDK package name");
  assert.equal(published.version, manifest.version, "npm publish --dry-run should keep the generated package version");
  assert.equal(published.filename, `icpdb-client-${manifest.version}.tgz`, "npm publish --dry-run should report the SDK tarball");
  assert.equal(Array.isArray(published.files), true, "npm publish --dry-run should report packed files");
  const publishedFiles = new Set(published.files.map((file) => file.path));
  assert.equal(publishedFiles.has("package.json"), true, "npm publish --dry-run should include package.json");
  assert.equal(publishedFiles.has("icpdb-sdk.js"), true, "npm publish --dry-run should include SDK entry");
  assert.equal(publishedFiles.has("icpdb-libsql.js"), true, "npm publish --dry-run should include libSQL-shaped SDK entry");
  assert.equal(publishedFiles.has("icpdb-sqlite.js"), true, "npm publish --dry-run should include SQLite-shaped SDK entry");
  assert.equal(publishedFiles.has("icpdb-cli.js"), true, "npm publish --dry-run should include CLI bin");
  assert.equal(publishedFiles.has("icpdb-node.js"), true, "npm publish --dry-run should include Node SDK entry");
  assert.equal(publishedFiles.has("icpdb-server.js"), true, "npm publish --dry-run should include Server SDK entry");
  assert.equal(publishedFiles.has("icpdb-service-identity.js"), true, "npm publish --dry-run should include service identity entry");
} finally {
  await rm(publishDryRunCacheDir, { recursive: true, force: true });
}

const sdkImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
  "const sdk = await import('@icpdb/client'); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.createLibsqlClient, typeof sdk.createTursoLikeClient, typeof sdk.formatIcpdbCanisterUrl, typeof sdk.sql);"
], { cwd: "dist-sdk" });
assert.equal(sdkImport.stdout.trim(), "function function function function function function");
const sdkWebImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
  "const sdk = await import('@icpdb/client/web'); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.createLibsqlClient, typeof sdk.createTursoLikeClient, typeof sdk.formatIcpdbCanisterUrl);"
], { cwd: "dist-sdk" });
assert.equal(sdkWebImport.stdout.trim(), "function function function function function");
const sdkBrowserImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
  "const sdk = await import('@icpdb/client/browser'); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.createLibsqlClient, typeof sdk.createTursoLikeClient, typeof sdk.formatIcpdbCanisterUrl);"
], { cwd: "dist-sdk" });
assert.equal(sdkBrowserImport.stdout.trim(), "function function function function function");
const sdkLibsqlImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
  "const sdk = await import('@icpdb/client/libsql'); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.createLibsqlClient, typeof sdk.connectLibsqlDatabase, typeof sdk.createLibsqlDatabase, typeof sdk.createTursoLikeClient, typeof sdk.sql, typeof sdk.LibsqlError);"
], { cwd: "dist-sdk" });
assert.equal(sdkLibsqlImport.stdout.trim(), "function function function function function function function function");
const sdkSqliteImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
    "const sdk = await import('@icpdb/client/sqlite'); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.connectSqliteClient, typeof sdk.createSqliteClient, typeof sdk.connectSqliteDatabase, typeof sdk.createSqliteDatabase, typeof sdk.parseSqliteDatabaseUrl, typeof sdk.createLibsqlClient, typeof sdk.createTursoLikeClient, typeof sdk.sql, typeof sdk.LibsqlError);"
], { cwd: "dist-sdk" });
assert.equal(sdkSqliteImport.stdout.trim(), "function function function function function function function function function function function");
const sdkNodeImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
  "const sdk = await import('@icpdb/client/node'); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.createLibsqlClient, typeof sdk.createTursoLikeClient, typeof sdk.formatIcpdbCanisterUrl, typeof sdk.createClientFromEnvFile, typeof sdk.connectClientFromEnvFile, typeof sdk.inspectIcpdbServiceEnvFile, typeof sdk.createIcpdbServiceSqlClient, typeof sdk.connectIcpdbServiceDatabase);"
], { cwd: "dist-sdk" });
assert.equal(sdkNodeImport.stdout.trim(), "function function function function function function function function function function");
const sdkServerImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
  "const sdk = await import('@icpdb/client/server'); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.createLibsqlClient, typeof sdk.createTursoLikeClient, typeof sdk.formatIcpdbCanisterUrl, typeof sdk.createClientFromEnvFile, typeof sdk.connectClientFromEnvFile, typeof sdk.inspectIcpdbServiceEnvFile, typeof sdk.createIcpdbServiceSqlClient, typeof sdk.connectIcpdbServiceDatabase);"
], { cwd: "dist-sdk" });
assert.equal(sdkServerImport.stdout.trim(), "function function function function function function function function function function");

const serviceImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
  "const service = await import('@icpdb/client/service-identity'); console.log(typeof service.createIcpdbServiceClientFromEnv, typeof service.createIcpdbServiceClientFromEnvFile, typeof service.createIcpdbServiceSqlClientFromEnv, typeof service.createIcpdbServiceSqlClientFromEnvFile, typeof service.createClientFromEnv, typeof service.createClientFromEnvFile, typeof service.connectClientFromEnv, typeof service.connectClientFromEnvFile, typeof service.connectDatabaseFromEnvFile, typeof service.createDatabaseFromEnvFile, typeof service.archiveDatabaseToFileFromEnv, typeof service.restoreDatabaseFromFileFromEnv, typeof service.archiveDatabaseToFileFromEnvFile, typeof service.restoreDatabaseFromFileFromEnvFile, typeof service.snapshotInfoFile, typeof service.createIcpdbPersistedServiceSqlClientFromEnvFile, typeof service.persistIcpdbServiceDatabaseId, typeof service.generateIcpdbServiceIdentity, typeof service.loadIcpdbServiceSetupFromEnv, typeof service.inspectIcpdbServiceEnv, typeof service.inspectIcpdbServiceEnvFile);"
], { cwd: "dist-sdk" });
assert.equal(serviceImport.stdout.trim(), "function function function function function function function function function function function function function function function function function function function function function");
const packageJsonImport = await execFileAsync(process.execPath, [
  "--input-type=module",
  "-e",
  "const pkg = await import('@icpdb/client/package.json', { with: { type: 'json' } }); console.log(pkg.default.name, pkg.default.version);"
], { cwd: "dist-sdk" });
assert.equal(packageJsonImport.stdout.trim(), `@icpdb/client ${manifest.version}`);
const sdkCliHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help"], { cwd: "dist-sdk" });
const sdkCliHelpLines = [
  "icpdb help [quickstart|sdk|server|init|provision-service|lifecycle|database|db|databases|sql|query|execute|scalar|exec|batch|transaction|script|load|dump|migrate|inspect|schema|tables|views|describe|columns|indexes|triggers|foreign-keys|preview|status|stats|health|usage|usage-events|placement|inspect-env|principal|url|info|service-env|env|check-env|generate-identity|identity|permissions|auth|token|http|members|grant-member|revoke-member|backup|archive|snapshot-info|restore|operation|operation-wait|operation-reconcile|operations|shell|ops|placements|all-placements|shards|shard-create|shard-register|shard-status|shard-top-up|shard-ops|shard-maintain|shard-migrate|remote-create-db|shard-reconcile|controller|create-db|delete-db]",
  "icpdb init --canister-id <id> --env-out service.env [--identity-type ed25519|secp256k1] [--network-url <url>] [--root-key <base64>] [--setup-sql <sql>|--setup-file <file|->|--setup-statements-file <file|->|--setup-migrations-file <file|->] [--format json|table|csv|env]",
  "icpdb provision-service <database-id> <reader|writer|owner> --env-out service.env [--identity-type ed25519|secp256k1] [--service-env-file owner.env] [--format json|table|csv|env]",
  "icpdb generate-identity [--identity-type ed25519|secp256k1] [--canister-id <id>] [--database-id <database-id>] [--network-url <url>] [--root-key <base64>] [--env-out service.env] [--format json|table|csv|env]",
  "icpdb check-env [--skip-call] [--require-role reader|writer|owner] [--smoke-sql] [--smoke-sdk] [--smoke-archive-restore] [--smoke-sdk-archive-restore] [--smoke-shards] [--smoke-sdk-shards] [--service-env-file service.env] [--format json|table|csv|env]",
  "icpdb inspect-env [--service-env-file service.env] [--format json|table|csv|env]",
  "icpdb principal [--service-env-file service.env] [--format json|table|csv|env]",
  "icpdb url [--service-env-file service.env] [--format json|table|csv|env]",
  "icpdb info [--service-env-file service.env] [--format json|table|csv|env]",
  "icpdb query <sql> [--params <json>|--params-file <file|->] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb execute <sql> [--params <json>|--params-file <file|->] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb exec <sql> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb sql <sql> [--params <json>|--params-file <file|->] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb scalar <sql> [--params <json>|--params-file <file|->] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb batch <statements-file|-> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb transaction <statements-file|-> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb script <file|-> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb load <file|-> [--mode read|write|deferred] [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb dump <file|-> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb migrate <file|-> [--idempotency-key <key>] [--wait] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb create-db [--setup-sql <sql>|--setup-file <file|->|--setup-statements-file <file|->|--setup-migrations-file <file|->] [--service-env-file service.env] [--format json|table|csv|env]",
  "icpdb health [--service-env-file service.env] [--format json|table|csv]",
  "icpdb databases [--service-env-file service.env] [--format json|table|csv]",
  "icpdb status [--service-env-file service.env] [--format json|table|csv]",
  "icpdb stats [--service-env-file service.env] [--format json|table|csv]",
  "icpdb usage [--service-env-file service.env] [--format json|table|csv]",
  "icpdb usage-events [--service-env-file service.env] [--format json|table|csv]",
  "icpdb placement [--service-env-file service.env] [--format json|table|csv]",
  "icpdb delete-db --confirm <database-id> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb tables [--service-env-file service.env] [--format json|table|csv]",
  "icpdb views [--service-env-file service.env] [--format json|table|csv]",
  "icpdb schema [table-name] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb describe <table-name> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb columns <table-name> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb indexes <table-name> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb triggers <table-name> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb foreign-keys <table-name> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb preview <table-name> [--limit rows] [--offset rows] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb inspect [table-name] [--limit rows] [--offset rows] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb members [--service-env-file service.env] [--format json|table|csv]",
  "icpdb grant-member <principal> <reader|writer|owner> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb revoke-member <principal> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb operation <operation-id> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb operation-reconcile <operation-id> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb operation-wait <operation-id> [--reconcile-unknown] [--interval-ms ms] [--timeout-ms ms] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb placements [--service-env-file service.env] [--format json|table|csv]",
  "icpdb all-placements [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shards [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shard-create <initial-cycles> <max-databases> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shard-register <database-canister-id> <max-databases> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shard-status <database-canister-id> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shard-top-up <database-canister-id> <cycles> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shard-ops [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shard-maintain <min-available-slots> <min-cycles-balance> <top-up-cycles> <max-new-shards> <new-shard-max-databases> <new-shard-initial-cycles> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shard-migrate <database-id> <database-canister-id> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb remote-create-db <database-id> <database-canister-id> [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shard-reconcile <operation-id> <applied|failed> [reason...] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb archive <file> [--service-env-file service.env] [--format json|table|csv|env]",
  "icpdb snapshot-info <file> [--format json|table|csv|env]",
  "icpdb restore <file> [--expect-snapshot-hash <sha256>] [--service-env-file service.env] [--format json|table|csv]",
  "icpdb shell [sql|dot-command] [--mode read|write|deferred] [--wait] [--service-env-file service.env] [--format json|table|csv]"
];
for (const line of sdkCliHelpLines) {
  assert.ok(sdkCliHelp.stdout.includes(line), `missing CLI help line: ${line}`);
}
assert.match(sdkCliHelp.stdout, /--format table for human CI logs or --format csv for row export and spreadsheet-friendly checks/);
assert.match(sdkCliHelp.stdout, /Server\/CI defaults to cwd-local service\.env/);
assert.match(sdkCliHelp.stdout, /Use `icpdb help <topic-or-command>` for focused Server\/CI flows; the first help line lists discoverable topics and actual command names/);
const sdkCliHelpTopics = helpTopicsFromUsage(sdkCliHelp.stdout);
assertReadmeListsHelpTopics(readme, sdkCliHelpTopics, "SDK README");
assertReadmeListsHelpTopics(rootReadme, sdkCliHelpTopics, "root README");
const sdkCliExecutableQuickstartHelp = await execFileAsync("./icpdb-cli.js", ["help", "quickstart"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableQuickstartHelp.stdout, /App SDK shortest path/);
assert.match(sdkCliExecutableQuickstartHelp.stdout, /Browser\/II apps can import the same browser-safe client from "@icpdb\/client\/browser"/);
assert.match(sdkCliExecutableQuickstartHelp.stdout, /Server\/CI SDK shortest path/);
assert.match(sdkCliExecutableQuickstartHelp.stdout, /Server\/CI CLI shortest path/);
const sdkCliSdkHelp = await execFileAsync("./icpdb-cli.js", ["help", "sdk"], { cwd: "dist-sdk" });
assert.equal(sdkCliSdkHelp.stdout, sdkCliExecutableQuickstartHelp.stdout);
const sdkCliServerHelp = await execFileAsync("./icpdb-cli.js", ["help", "server"], { cwd: "dist-sdk" });
assert.equal(sdkCliServerHelp.stdout, sdkCliExecutableQuickstartHelp.stdout);
const sdkCliExecutableSqlHelp = await execFileAsync("./icpdb-cli.js", ["help", "sql"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableSqlHelp.stdout, /Auto-routed SQL uses query for reads and execute for writes/);
assert.match(sdkCliExecutableSqlHelp.stdout, /Read-routed sql rejects --idempotency-key and --wait before service\.env or params files load/);
assert.match(sdkCliExecutableSqlHelp.stdout, /icpdb exec "CREATE TABLE notes/);
assert.match(sdkCliExecutableSqlHelp.stdout, /icpdb script \.\/read-check\.sql --mode read --format csv/);
const sdkCliExecutableExecHelp = await execFileAsync("./icpdb-cli.js", ["help", "exec"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableExecHelp.stdout, /Inline SQL script/);
assert.match(sdkCliExecutableExecHelp.stdout, /icpdb exec "CREATE TABLE notes/);
assert.match(sdkCliExecutableExecHelp.stdout, /icpdb exec "SELECT id, body FROM notes ORDER BY id DESC; SELECT count\(\*\) FROM notes" --mode read --format table/);
const sdkCliExecutableScriptSqlHelp = await execFileAsync("./icpdb-cli.js", ["help", "script-sql"], { cwd: "dist-sdk" });
assert.equal(sdkCliExecutableScriptSqlHelp.stdout, sdkCliExecutableExecHelp.stdout);
const sdkCliExecutableBatchHelp = await execFileAsync("./icpdb-cli.js", ["help", "batch"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableBatchHelp.stdout, /JSON statement files for parameterized batches/);
assert.match(sdkCliExecutableBatchHelp.stdout, /icpdb batch \.\/statements\.json --mode write --idempotency-key ci-batch-001 --wait --format table/);
assert.match(sdkCliExecutableBatchHelp.stdout, /icpdb transaction \.\/transaction\.json --mode write --idempotency-key ci-transaction-001 --wait --format table/);
assert.match(sdkCliExecutableBatchHelp.stdout, /icpdb batch \.\/read-statements\.json --mode read --format table/);
assert.match(sdkCliExecutableBatchHelp.stdout, /SQL files and stdin/);
assert.match(sdkCliExecutableBatchHelp.stdout, /icpdb script \.\/schema\.sql --mode write --idempotency-key ci-schema-001 --wait --format table/);
assert.match(sdkCliExecutableBatchHelp.stdout, /icpdb script \.\/read-check\.sql --mode read --format csv/);
assert.match(sdkCliExecutableBatchHelp.stdout, /icpdb dump \.\/dump\.sql --format table/);
assert.match(sdkCliExecutableBatchHelp.stdout, /icpdb load \.\/dump\.sql --mode write --idempotency-key ci-load-001 --wait --format table/);
assert.match(sdkCliExecutableBatchHelp.stdout, /icpdb batch \.\/statements\.json --mode write --service-env-file \.\/ci\/service\.env --idempotency-key ci-batch-002 --wait --format table/);
const sdkCliExecutableTransactionHelp = await execFileAsync("./icpdb-cli.js", ["help", "transaction"], { cwd: "dist-sdk" });
assert.equal(sdkCliExecutableTransactionHelp.stdout, sdkCliExecutableBatchHelp.stdout);
const sdkCliExecutableScriptHelp = await execFileAsync("./icpdb-cli.js", ["help", "script"], { cwd: "dist-sdk" });
assert.equal(sdkCliExecutableScriptHelp.stdout, sdkCliExecutableBatchHelp.stdout);
const sdkCliExecutableDumpHelp = await execFileAsync("./icpdb-cli.js", ["help", "dump"], { cwd: "dist-sdk" });
assert.equal(sdkCliExecutableDumpHelp.stdout, sdkCliExecutableBatchHelp.stdout);
const sdkCliExecutableShellHelp = await execFileAsync("./icpdb-cli.js", ["help", "shell"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableShellHelp.stdout, /\.schema \[table_name\]/);
assert.match(sdkCliExecutableShellHelp.stdout, /\.foreign-keys <table_name>/);
assert.match(sdkCliExecutableShellHelp.stdout, /Shell write SQL auto-generates an idempotency key for routed remote writes/);
assert.match(sdkCliExecutableShellHelp.stdout, /Pass --wait before shell to wait for returned routed operations/);
const sdkCliExecutableBackupHelp = await execFileAsync("./icpdb-cli.js", ["help", "backup"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableBackupHelp.stdout, /Archive\/restore requires owner role/);
assert.match(sdkCliExecutableBackupHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliExecutableBackupHelp.stdout, /icpdb snapshot-info \.\/backup\.sqlite --format env/);
assert.match(sdkCliExecutableBackupHelp.stdout, /icpdb restore \.\/backup\.sqlite --expect-snapshot-hash <sha256> --format table/);
const sdkCliExecutableOpsHelp = await execFileAsync("./icpdb-cli.js", ["help", "ops"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableOpsHelp.stdout, /Controller\/shard operations use canister-only controller\.env/);
assert.match(sdkCliExecutableOpsHelp.stdout, /icpdb health --service-env-file controller\.env --format table/);
assert.match(sdkCliExecutableOpsHelp.stdout, /icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller\.env --format table/);
assert.match(sdkCliExecutableOpsHelp.stdout, /icpdb shard-maintain 0 0 0 0 0 0 --service-env-file controller\.env --format table/);
assert.match(sdkCliExecutableOpsHelp.stdout, /icpdb remote-create-db <database-id> <database-canister-id> --service-env-file controller\.env --format table/);
assert.match(sdkCliExecutableOpsHelp.stdout, /icpdb shard-reconcile <operation-id> failed "operator verified failure" --service-env-file controller\.env --format table/);
const sdkCliExecutableGenerateIdentityHelp = await execFileAsync("./icpdb-cli.js", ["help", "generate-identity"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableGenerateIdentityHelp.stdout, /Create a dedicated Server\/CI service identity without reading service\.env/);
assert.match(sdkCliExecutableGenerateIdentityHelp.stdout, /Browser\/II principal and generated Server\/CI service principal are different/);
assert.match(sdkCliExecutableGenerateIdentityHelp.stdout, /Join them through the DB ACL; do not share browser private keys/);
assert.match(sdkCliExecutableGenerateIdentityHelp.stdout, /Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access/);
const sdkCliExecutablePermissionsHelp = await execFileAsync("./icpdb-cli.js", ["help", "permissions"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutablePermissionsHelp.stdout, /Browser\/II-owned DB handoff after generating service\.env/);
assert.match(sdkCliExecutablePermissionsHelp.stdout, /Browser\/II principal and Server\/CI service principal are intentionally different/);
assert.match(sdkCliExecutablePermissionsHelp.stdout, /Do not share private keys; grant the service principal through the DB ACL/);
assert.match(sdkCliExecutablePermissionsHelp.stdout, /Console: Permissions -> Member principal -> paste principal -> choose writer\/owner -> Grant member access/);
const sdkCliExecutableAuthHelp = await execFileAsync("./icpdb-cli.js", ["help", "auth"], { cwd: "dist-sdk" });
assert.equal(sdkCliExecutableAuthHelp.stdout, sdkCliExecutablePermissionsHelp.stdout);
const sdkCliExecutableTokenHelp = await execFileAsync("./icpdb-cli.js", ["help", "token"], { cwd: "dist-sdk" });
assert.match(sdkCliExecutableTokenHelp.stdout, /Normal Server\/CI path: service identity, not a database bearer token/);
assert.match(sdkCliExecutableTokenHelp.stdout, /icpdb init --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env/);
assert.match(sdkCliExecutableTokenHelp.stdout, /Browser\/II-owned DB handoff: grant the generated service principal through the DB ACL/);
assert.match(sdkCliExecutableTokenHelp.stdout, /Optional bearer-token HTTP surface, outside the package icpdb Server\/CI path/);
assert.match(sdkCliExecutableTokenHelp.stdout, /node scripts\/icpdb-http\.mjs help shell sql/);
assert.match(sdkCliExecutableTokenHelp.stdout, /Keep database bearer tokens for curl-compatible external HTTP clients, browser token sessions, or short-lived sharing/);
assert.match(sdkCliExecutableTokenHelp.stdout, /The package icpdb CLI intentionally has no create-token command/);
const sdkCliExecutableTokensHelp = await execFileAsync("./icpdb-cli.js", ["help", "tokens"], { cwd: "dist-sdk" });
assert.equal(sdkCliExecutableTokensHelp.stdout, sdkCliExecutableTokenHelp.stdout);
const sdkCliExecutableHttpHelp = await execFileAsync("./icpdb-cli.js", ["help", "http"], { cwd: "dist-sdk" });
assert.equal(sdkCliExecutableHttpHelp.stdout, sdkCliExecutableTokenHelp.stdout);
const sdkCliExecutableCurlHelp = await execFileAsync("./icpdb-cli.js", ["help", "curl"], { cwd: "dist-sdk" });
assert.equal(sdkCliExecutableCurlHelp.stdout, sdkCliExecutableTokenHelp.stdout);
const sdkCliQuickstartHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "quickstart", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" });
assert.match(sdkCliQuickstartHelp.stdout, /App SDK shortest path/);
assert.match(sdkCliQuickstartHelp.stdout, /import \{ AuthClient \} from "@icp-sdk\/auth\/client"/);
assert.match(sdkCliQuickstartHelp.stdout, /import \{ createClient, sql \} from "@icpdb\/client"/);
assert.match(sdkCliQuickstartHelp.stdout, /Hosted SQLite apps can use the explicit SQL DB import path: import \{ createSqliteClient, sql as sqliteSql, type SqliteRow \} from "@icpdb\/client\/sqlite"/);
assert.match(sdkCliQuickstartHelp.stdout, /const DELEGATION_TTL_NS = BigInt\(8\) \* BigInt\(3_600_000_000_000\)/);
assert.match(sdkCliQuickstartHelp.stdout, /const identityProvider = host === "localhost" \|\| host === "127\.0\.0\.1" \|\| host\.endsWith\("\.localhost"\)/);
assert.match(sdkCliQuickstartHelp.stdout, /const authClient = await AuthClient\.create\(\)/);
assert.match(sdkCliQuickstartHelp.stdout, /authClient\.isAuthenticated\(\)/);
assert.match(sdkCliQuickstartHelp.stdout, /authClient\.login\(\{/);
assert.match(sdkCliQuickstartHelp.stdout, /maxTimeToLive: DELEGATION_TTL_NS/);
assert.match(sdkCliQuickstartHelp.stdout, /Internet Identity login failed/);
assert.match(sdkCliQuickstartHelp.stdout, /const identity = authClient\.getIdentity\(\)/);
assert.match(sdkCliQuickstartHelp.stdout, /const db = createClient\(\{ canisterId: "<id>", identity, setupSql: "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" \}\)/);
assert.match(sdkCliQuickstartHelp.stdout, /await db\.execute\(sql`INSERT INTO notes\(body\) VALUES \(\$\{"hello"\}\)`\)/);
assert.match(sdkCliQuickstartHelp.stdout, /const result = await db\.query\("SELECT id, body FROM notes ORDER BY id DESC"\)/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(result\.rows\)/);
assert.doesNotMatch(sdkCliQuickstartHelp.stdout, /console\.log\(await db\.all\("SELECT id, body FROM notes ORDER BY id DESC"\)\)/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(await db\.connectionUrl\(\)\)/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(await db\.info\(\)\)/);
assert.match(sdkCliQuickstartHelp.stdout, /Hosted SQLite subpath; same client shape with explicit SQL DB import/);
assert.match(sdkCliQuickstartHelp.stdout, /import \{ createSqliteClient, sql as sqliteSql, type SqliteRow \} from "@icpdb\/client\/sqlite"/);
assert.match(sdkCliQuickstartHelp.stdout, /const sqliteDb = createSqliteClient\(\{ canisterId: "<id>", identity, setupSql: "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" \}\)/);
assert.match(sdkCliQuickstartHelp.stdout, /await sqliteDb\.execute\(sqliteSql`INSERT INTO notes\(body\) VALUES \(\$\{"from-sqlite"\}\)`\)/);
assert.match(sdkCliQuickstartHelp.stdout, /const sqliteRows: SqliteRow\[\] = \(await sqliteDb\.query\("SELECT id, body FROM notes ORDER BY id DESC"\)\)\.rows/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(sqliteRows\)/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(await sqliteDb\.connectionUrl\(\)\)/);
assert.match(sdkCliQuickstartHelp.stdout, /libSQL-shaped migration edge; keep SQL calls, replace connection\/auth with IC identity/);
assert.match(sdkCliQuickstartHelp.stdout, /import \{ createLibsqlClient \} from "@icpdb\/client\/libsql"/);
assert.match(sdkCliQuickstartHelp.stdout, /const libsqlDb = createLibsqlClient\(\{ url: "icpdb:\/\/<id>\/<database-id>", identity \}\)/);
assert.match(sdkCliQuickstartHelp.stdout, /await libsqlDb\.execute\(\{ sql: "INSERT INTO notes\(body\) VALUES \(:body\)", args: \{ body: "from-libsql" \} \}\)/);
assert.match(sdkCliQuickstartHelp.stdout, /const libsqlResult = await libsqlDb\.execute\("SELECT id, body FROM notes ORDER BY id DESC"\)/);
assert.match(sdkCliQuickstartHelp.stdout, /libsqlDb\.close\(\)/);
assert.match(sdkCliQuickstartHelp.stdout, /One-command service\.env and DB bootstrap when starting from an installed SDK/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb init --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --setup-sql "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb init --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --setup-file \.\/schema\.sql --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb init --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --setup-migrations-file \.\/migrations\.json --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /The table\/json\/csv output includes nextInspectEnvCommand, nextExecuteCommand, nextInsertCommand, nextQueryCommand, nextReadCommand, nextSqlSmokeCommand, nextSchemaCountCommand, nextTablesCommand, nextViewsCommand, nextStatsCommand, nextSchemaCommand, nextDescribeCommand, nextPreviewCommand, nextStatusCommand, nextMembersCommand, nextUrlCommand, and nextInfoCommand/);
assert.match(sdkCliQuickstartHelp.stdout, /Canister-only service\.env without setup SQL can still create and persist an empty DB on first scalar/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb generate-identity --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb scalar "SELECT 1 AS value" --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb execute "CREATE TABLE readiness_query_only\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" --idempotency-key readiness-query-only-create-table-001 --wait --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb execute "INSERT INTO readiness_query_only\(body\) VALUES \(\?1\)" --params '\["readiness-query-only"\]' --idempotency-key readiness-query-only-write-001 --wait --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb query "SELECT body FROM readiness_query_only ORDER BY id DESC LIMIT 1" --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb info --format env/);
assert.match(sdkCliQuickstartHelp.stdout, /Server\/CI SDK shortest path after init/);
assert.match(sdkCliQuickstartHelp.stdout, /import \{ createClientFromEnvFile \} from "@icpdb\/client\/server"/);
assert.match(sdkCliQuickstartHelp.stdout, /const ciDb = await createClientFromEnvFile\(\)/);
assert.match(sdkCliQuickstartHelp.stdout, /await ciDb\.execute\("INSERT INTO notes\(body\) VALUES \(\?1\)", \["from-ci"\]\)/);
assert.match(sdkCliQuickstartHelp.stdout, /const ciResult = await ciDb\.query\("SELECT id, body FROM notes ORDER BY id DESC"\)/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(ciResult\.rows\)/);
assert.doesNotMatch(sdkCliQuickstartHelp.stdout, /console\.log\(await ciDb\.all\("SELECT id, body FROM notes ORDER BY id DESC"\)\)/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(await ciDb\.connectionUrl\(\)\)/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(await ciDb\.info\(\)\)/);
assert.match(sdkCliQuickstartHelp.stdout, /const ciDbFromPath = await createClientFromEnvFile\("\.\/ci\/service\.env"\)/);
assert.match(sdkCliQuickstartHelp.stdout, /console\.log\(await ciDbFromPath\.info\(\)\)/);
assert.match(sdkCliQuickstartHelp.stdout, /Server\/CI CLI shortest path after init/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb inspect-env --format table[\s\S]*icpdb sql "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["hello"\]' --idempotency-key ci-sql-insert-001 --wait --format table[\s\S]*icpdb sql "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb sql "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["hello"\]' --idempotency-key ci-sql-insert-001 --wait --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb sql "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /Explicit query\/execute are useful when CI logs should separate reads and writes/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM notes" --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb stats --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb tables --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb views --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb schema notes --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb describe notes --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb columns notes --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb indexes notes --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb triggers notes --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb foreign-keys notes --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb preview notes --limit 25 --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb inspect notes --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb status --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb members --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /Optional owner backup check/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb archive \.\/backup\.sqlite --format env/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb snapshot-info \.\/backup\.sqlite --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb restore \.\/backup\.sqlite --expect-snapshot-hash <sha256> --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /Optional owner backup check[\s\S]*icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /Existing DB with an owner service env/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb provision-service <database-id> writer --service-env-file owner\.env --env-out service\.env --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb check-env --require-role writer --smoke-sql --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM sqlite_schema" --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /For archive\/restore or final proof on the same existing DB, provision owner instead/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb provision-service <database-id> owner --service-env-file owner\.env --env-out service\.env --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /Existing browser\/II DB handoff/);
assert.match(sdkCliQuickstartHelp.stdout, /Copy the console Response sidebar Connection URL first; use its database id in <database-id>/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb principal --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /Grant the printed service principal in console Permissions while logged in with browser\/II/);
assert.match(sdkCliQuickstartHelp.stdout, /Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access/);
assert.match(sdkCliQuickstartHelp.stdout, /Browser\/II and Server\/CI principals stay different and are joined through the DB ACL/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM sqlite_schema" --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb stats --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb tables --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb views --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb schema --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb describe <table> --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb columns <table> --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb indexes <table> --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb triggers <table> --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb foreign-keys <table> --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb preview <table> --limit 25 --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb inspect --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb members --format table/);
assert.match(sdkCliQuickstartHelp.stdout, /icpdb url --format env/);
assert.match(sdkCliQuickstartHelp.stdout, /Existing browser\/II DB handoff[\s\S]*icpdb url --format env[\s\S]*icpdb info --format env/);
const sdkCliInitHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "init"], { cwd: "dist-sdk" });
assert.match(sdkCliInitHelp.stdout, /Create service\.env, create the first DB, run setup, and persist the DB id/);
assert.match(sdkCliInitHelp.stdout, /--env-out writes a new owner-only file and refuses to overwrite existing files/);
assert.match(sdkCliInitHelp.stdout, /icpdb init --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --setup-sql "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb init --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --setup-statements-file \.\/setup-statements\.json --format env/);
assert.match(sdkCliInitHelp.stdout, /Use --format table\/json\/csv when CI logs should include nextInspectEnvCommand, nextExecuteCommand, nextInsertCommand, nextQueryCommand, nextReadCommand, nextSqlSmokeCommand, nextSchemaCountCommand, nextTablesCommand, nextViewsCommand, nextStatsCommand, nextSchemaCommand, nextDescribeCommand, nextPreviewCommand, nextStatusCommand, nextMembersCommand, nextUrlCommand, and nextInfoCommand/);
assert.match(sdkCliInitHelp.stdout, /Verify and reuse the generated cwd-local service\.env immediately/);
assert.match(sdkCliInitHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb execute "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["hello"\]' --idempotency-key ci-notes-insert-001 --wait --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM notes" --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb tables --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb views --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb stats --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb schema notes --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb describe notes --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb columns notes --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb indexes notes --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb triggers notes --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb foreign-keys notes --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb preview notes --limit 25 --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb inspect notes --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb status --format table/);
assert.match(sdkCliInitHelp.stdout, /icpdb url --format env/);
assert.match(sdkCliInitHelp.stdout, /icpdb info --format env/);
const sdkCliProvisionServiceHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "provision-service", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" });
assert.match(sdkCliProvisionServiceHelp.stdout, /Existing DB with an owner service env/);
assert.match(sdkCliProvisionServiceHelp.stdout, /Creates a new dedicated database-bearing service\.env and grants it on that DB/);
assert.match(sdkCliProvisionServiceHelp.stdout, /icpdb provision-service <database-id> writer --service-env-file owner\.env --env-out service\.env --format table/);
assert.match(sdkCliProvisionServiceHelp.stdout, /icpdb check-env --require-role writer --smoke-sql --format table/);
assert.match(sdkCliProvisionServiceHelp.stdout, /Owner role is required for archive\/restore and final release proof/);
assert.match(sdkCliProvisionServiceHelp.stdout, /icpdb provision-service <database-id> owner --service-env-file owner\.env --env-out service\.env --format table/);
assert.match(sdkCliProvisionServiceHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliProvisionServiceHelp.stdout, /Browser\/II-owned DBs cannot share a private key; generate then grant in console/);
assert.match(sdkCliProvisionServiceHelp.stdout, /Copy the console Response sidebar Connection URL first; use its database id in <database-id>/);
assert.match(sdkCliProvisionServiceHelp.stdout, /icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(sdkCliProvisionServiceHelp.stdout, /icpdb principal --format table/);
assert.match(sdkCliProvisionServiceHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliProvisionServiceHelp.stdout, /Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access/);
assert.match(sdkCliProvisionServiceHelp.stdout, /Browser\/II and Server\/CI principals stay different and are joined through the DB ACL/);
const sdkCliLifecycleHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "lifecycle"], { cwd: "dist-sdk" });
assert.match(sdkCliLifecycleHelp.stdout, /Database lifecycle from canister-only service\.env/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb create-db --setup-file \.\/schema\.sql --format env/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb databases --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /Verify the created DB with the same persisted service\.env/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb execute "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["hello"\]' --idempotency-key ci-notes-insert-001 --wait/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM notes" --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb tables --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb views --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb stats --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb schema notes --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb describe notes --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb columns notes --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb indexes notes --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb triggers notes --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb foreign-keys notes --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb preview notes --limit 25 --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb inspect notes --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb url --format env/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb info --format env/);
assert.match(sdkCliLifecycleHelp.stdout, /Guarded cleanup requires a database-bearing service\.env and matching confirmation/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb delete-db --confirm <database-id> --format table/);
assert.match(sdkCliLifecycleHelp.stdout, /icpdb delete-db --confirm <database-id> --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliDatabaseHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "database"], { cwd: "dist-sdk" });
assert.equal(sdkCliDatabaseHelp.stdout, sdkCliLifecycleHelp.stdout);
const sdkCliDbHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "db"], { cwd: "dist-sdk" });
assert.equal(sdkCliDbHelp.stdout, sdkCliLifecycleHelp.stdout);
const sdkCliDatabasesHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "databases"], { cwd: "dist-sdk" });
assert.match(sdkCliDatabasesHelp.stdout, /Database inventory and selected-DB health/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb databases --format table/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb status --format table/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb usage --format table/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb usage-events --format table/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb placement --format table/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb url --format env/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb info --format env/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb delete-db --confirm <database-id> --format table/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb databases --service-env-file \.\/ci\/service\.env --format table/);
assert.match(sdkCliDatabasesHelp.stdout, /icpdb delete-db --confirm <database-id> --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliDeleteDbHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "delete-db"], { cwd: "dist-sdk" });
assert.equal(sdkCliDeleteDbHelp.stdout, sdkCliDatabasesHelp.stdout);
const sdkCliUsageHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "usage"], { cwd: "dist-sdk" });
assert.equal(sdkCliUsageHelp.stdout, sdkCliDatabasesHelp.stdout);
const sdkCliPlacementHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "placement"], { cwd: "dist-sdk" });
assert.equal(sdkCliPlacementHelp.stdout, sdkCliDatabasesHelp.stdout);
const sdkCliSqlHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "sql"], { cwd: "dist-sdk" });
assert.match(sdkCliSqlHelp.stdout, /Read SQL/);
assert.match(sdkCliSqlHelp.stdout, /Auto-routed SQL uses query for reads and execute for writes/);
assert.match(sdkCliSqlHelp.stdout, /icpdb sql "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(sdkCliSqlHelp.stdout, /Read-routed sql rejects --idempotency-key and --wait before service\.env or params files load/);
assert.match(sdkCliSqlHelp.stdout, /Write SQL; use idempotency keys and --wait for remote shard retries/);
assert.match(sdkCliSqlHelp.stdout, /icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format csv/);
assert.match(sdkCliSqlHelp.stdout, /icpdb exec "CREATE TABLE notes/);
assert.match(sdkCliSqlHelp.stdout, /icpdb script \.\/read-check\.sql --mode read --format csv/);
const sdkCliQueryHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "query"], { cwd: "dist-sdk" });
assert.match(sdkCliQueryHelp.stdout, /Read SQL through query calls/);
assert.match(sdkCliQueryHelp.stdout, /icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(sdkCliQueryHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM notes" --format table/);
assert.match(sdkCliQueryHelp.stdout, /icpdb query "SELECT body FROM notes WHERE body = :body" --params-file \.\/params\.json --format table/);
assert.match(sdkCliQueryHelp.stdout, /icpdb query "SELECT id, body FROM notes ORDER BY id DESC" --format csv/);
assert.match(sdkCliQueryHelp.stdout, /icpdb sql "SELECT id, body FROM notes ORDER BY id DESC" --format table/);
assert.match(sdkCliQueryHelp.stdout, /icpdb query "SELECT count\(\*\) AS total FROM sqlite_schema" --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliScalarHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "scalar"], { cwd: "dist-sdk" });
assert.equal(sdkCliScalarHelp.stdout, sdkCliQueryHelp.stdout);
const sdkCliExecuteHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "execute"], { cwd: "dist-sdk" });
assert.match(sdkCliExecuteHelp.stdout, /Write SQL through execute calls/);
assert.match(sdkCliExecuteHelp.stdout, /icpdb execute "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["hello"\]' --idempotency-key ci-notes-insert-001 --wait --format table/);
assert.match(sdkCliExecuteHelp.stdout, /icpdb execute "UPDATE notes SET body = :body WHERE id = :id" --params '\{"id":1,"body":"updated"\}' --idempotency-key ci-notes-update-001 --wait --format table/);
assert.match(sdkCliExecuteHelp.stdout, /icpdb batch \.\/statements\.json --mode write --idempotency-key ci-batch-001 --wait --format table/);
assert.match(sdkCliExecuteHelp.stdout, /icpdb execute "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["from-ci"\]' --service-env-file \.\/ci\/service\.env --idempotency-key ci-notes-insert-002 --wait --format table/);
const sdkCliMigrateHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "migrate"], { cwd: "dist-sdk" });
assert.match(sdkCliMigrateHelp.stdout, /migrations\.json is a JSON array of \{ version, name\?, sql \} entries/);
assert.match(sdkCliMigrateHelp.stdout, /icpdb migrate \.\/migrations\.json --idempotency-key ci-migrate-001 --wait --format table/);
assert.match(sdkCliMigrateHelp.stdout, /icpdb query "SELECT version, name FROM icpdb_schema_migrations ORDER BY version" --format table/);
assert.match(sdkCliMigrateHelp.stdout, /icpdb create-db --setup-migrations-file \.\/migrations\.json --format env/);
assert.match(sdkCliMigrateHelp.stdout, /icpdb script \.\/read-check\.sql --mode read --format table/);
const sdkCliMigrationsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "migrations"], { cwd: "dist-sdk" });
assert.equal(sdkCliMigrationsHelp.stdout, sdkCliMigrateHelp.stdout);
const sdkCliInspectHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "inspect"], { cwd: "dist-sdk" });
assert.match(sdkCliInspectHelp.stdout, /Schema and table shape/);
assert.match(sdkCliInspectHelp.stdout, /icpdb info --format env/);
assert.match(sdkCliInspectHelp.stdout, /icpdb stats --format table/);
assert.match(sdkCliInspectHelp.stdout, /icpdb preview notes --limit 25 --offset 0 --format table/);
const sdkCliSchemaHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "schema"], { cwd: "dist-sdk" });
assert.match(sdkCliSchemaHelp.stdout, /Schema and table catalog/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb tables --format table/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb views --format table/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb schema --format table/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb describe notes --format table/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb columns notes --format table/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb foreign-keys notes --format table/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb preview notes --limit 25 --offset 0 --format table/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb tables --format csv/);
assert.match(sdkCliSchemaHelp.stdout, /icpdb schema notes --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliTablesHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "tables"], { cwd: "dist-sdk" });
assert.equal(sdkCliTablesHelp.stdout, sdkCliSchemaHelp.stdout);
const sdkCliDescribeHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "describe"], { cwd: "dist-sdk" });
assert.equal(sdkCliDescribeHelp.stdout, sdkCliSchemaHelp.stdout);
const sdkCliColumnsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "columns"], { cwd: "dist-sdk" });
assert.equal(sdkCliColumnsHelp.stdout, sdkCliSchemaHelp.stdout);
const sdkCliStatusHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "status"], { cwd: "dist-sdk" });
assert.match(sdkCliStatusHelp.stdout, /DB health, caller role, connection URL, placement, usage, and table stats/);
assert.match(sdkCliStatusHelp.stdout, /icpdb status --format table/);
assert.match(sdkCliStatusHelp.stdout, /icpdb status --format json/);
assert.match(sdkCliStatusHelp.stdout, /icpdb status --format csv/);
assert.match(sdkCliStatusHelp.stdout, /Nearby DB-shape checks for Server\/CI readiness/);
assert.match(sdkCliStatusHelp.stdout, /icpdb members --format table/);
assert.match(sdkCliStatusHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM sqlite_schema" --format table/);
assert.match(sdkCliStatusHelp.stdout, /icpdb url --format env/);
assert.match(sdkCliStatusHelp.stdout, /icpdb check-env --require-role writer --smoke-sql --format table/);
assert.match(sdkCliStatusHelp.stdout, /icpdb status --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliStatsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "stats"], { cwd: "dist-sdk" });
assert.match(sdkCliStatsHelp.stdout, /DB aggregate and table stats/);
assert.match(sdkCliStatsHelp.stdout, /icpdb stats --format table/);
assert.match(sdkCliStatsHelp.stdout, /icpdb stats --format json/);
assert.match(sdkCliStatsHelp.stdout, /icpdb stats --format csv/);
assert.match(sdkCliStatsHelp.stdout, /Nearby shape checks/);
assert.match(sdkCliStatsHelp.stdout, /icpdb inspect --format table/);
assert.match(sdkCliStatsHelp.stdout, /icpdb stats --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliHealthHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "health"], { cwd: "dist-sdk" });
assert.match(sdkCliHealthHelp.stdout, /Control canister health without selecting or creating a DB/);
assert.match(sdkCliHealthHelp.stdout, /icpdb health --format table/);
assert.match(sdkCliHealthHelp.stdout, /icpdb health --format json/);
assert.match(sdkCliHealthHelp.stdout, /icpdb health --format csv/);
assert.match(sdkCliHealthHelp.stdout, /Canister-only controller\.env before shard operations/);
assert.match(sdkCliHealthHelp.stdout, /icpdb inspect-env --service-env-file controller\.env --format table/);
assert.match(sdkCliHealthHelp.stdout, /icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller\.env --format table/);
assert.match(sdkCliHealthHelp.stdout, /icpdb health --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliCanisterHealthHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "canister-health"], { cwd: "dist-sdk" });
assert.equal(sdkCliCanisterHealthHelp.stdout, sdkCliHealthHelp.stdout);
const sdkCliInspectEnvHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "inspect-env"], { cwd: "dist-sdk" });
assert.match(sdkCliInspectEnvHelp.stdout, /Local-only service\.env diagnosis before any canister call/);
assert.match(sdkCliInspectEnvHelp.stdout, /Checks owner-only file mode, connection URL, setup fields, and derived service principal/);
assert.match(sdkCliInspectEnvHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliInspectEnvHelp.stdout, /icpdb inspect-env --format env/);
assert.match(sdkCliInspectEnvHelp.stdout, /Database-bearing service\.env should print database_id and connection_url/);
assert.match(sdkCliInspectEnvHelp.stdout, /icpdb check-env --require-role writer --format table/);
assert.match(sdkCliInspectEnvHelp.stdout, /Canister-only service\.env can create\/persist on first url\/info\/sql call/);
assert.match(sdkCliInspectEnvHelp.stdout, /Use create-db when the first DB needs setup SQL/);
assert.match(sdkCliInspectEnvHelp.stdout, /icpdb create-db --setup-sql "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" --format env/);
assert.match(sdkCliInspectEnvHelp.stdout, /Canister-only controller\.env is diagnosed locally before shard controller checks/);
assert.match(sdkCliInspectEnvHelp.stdout, /icpdb inspect-env --service-env-file controller\.env --format table/);
assert.match(sdkCliInspectEnvHelp.stdout, /icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller\.env --format table/);
assert.match(sdkCliInspectEnvHelp.stdout, /icpdb inspect-env --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliDiagnoseEnvHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "diagnose-env"], { cwd: "dist-sdk" });
assert.equal(sdkCliDiagnoseEnvHelp.stdout, sdkCliInspectEnvHelp.stdout);
const sdkCliPrincipalHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "principal"], { cwd: "dist-sdk" });
assert.match(sdkCliPrincipalHelp.stdout, /Print the exact service principal loaded from service\.env without a canister call/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb principal --format table/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb principal --format env/);
assert.match(sdkCliPrincipalHelp.stdout, /Browser\/II-owned DB handoff: grant this service principal in console Permissions/);
assert.match(sdkCliPrincipalHelp.stdout, /Browser\/II and Server\/CI principals stay different; join them through the DB ACL/);
assert.match(sdkCliPrincipalHelp.stdout, /Console: Permissions -> Member principal -> paste principal -> choose writer\/owner -> Grant member access/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb grant-member <service-principal> writer --format table/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb grant-member <service-principal> owner --format table/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb revoke-member <service-principal> --format table/);
assert.match(sdkCliPrincipalHelp.stdout, /Canister-only controller\.env principal is for canister controller grants, not DB ACLs/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb principal --service-env-file controller\.env --format table/);
assert.match(sdkCliPrincipalHelp.stdout, /eval "\$\(icpdb principal --service-env-file controller\.env --format env\)" && icp canister settings update -n ic <id> --add-controller "\$ICPDB_SERVICE_PRINCIPAL" -f/);
assert.match(sdkCliPrincipalHelp.stdout, /icpdb principal --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliWhoamiHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "whoami"], { cwd: "dist-sdk" });
assert.equal(sdkCliWhoamiHelp.stdout, sdkCliPrincipalHelp.stdout);
const sdkCliUrlHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "url"], { cwd: "dist-sdk" });
assert.match(sdkCliUrlHelp.stdout, /Print the reusable icpdb:\/\/<canister-id>\/<database-id> connection URL/);
assert.match(sdkCliUrlHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliUrlHelp.stdout, /icpdb url --format env/);
assert.match(sdkCliUrlHelp.stdout, /icpdb status --format table/);
assert.match(sdkCliUrlHelp.stdout, /const connectionUrl = "icpdb:\/\/<canister-id>\/<database-id>"/);
assert.match(sdkCliUrlHelp.stdout, /import \{ connectClient \} from "@icpdb\/client"/);
assert.match(sdkCliUrlHelp.stdout, /connectClient\(\{ connectionUrl, identity \}\)/);
assert.match(sdkCliUrlHelp.stdout, /Reconnect from a DB-bearing cwd-local service\.env in Server\/CI/);
assert.match(sdkCliUrlHelp.stdout, /import \{ connectClientFromEnvFile \} from "@icpdb\/client\/server"/);
assert.match(sdkCliUrlHelp.stdout, /connectClientFromEnvFile\(\)/);
assert.match(sdkCliUrlHelp.stdout, /Canister-only service\.env creates and persists a DB id on first URL handoff/);
assert.match(sdkCliUrlHelp.stdout, /Use create-db when the first DB needs setup SQL/);
assert.match(sdkCliUrlHelp.stdout, /icpdb create-db --setup-sql "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" --format env/);
assert.match(sdkCliUrlHelp.stdout, /icpdb url --service-env-file \.\/ci\/service\.env --format env/);
const sdkCliConnectionHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "connection-url"], { cwd: "dist-sdk" });
assert.equal(sdkCliConnectionHelp.stdout, sdkCliUrlHelp.stdout);
const sdkCliInfoHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "info"], { cwd: "dist-sdk" });
assert.match(sdkCliInfoHelp.stdout, /Print one Server\/CI handoff object; can create\/persist DB id from canister-only service\.env/);
assert.match(sdkCliInfoHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliInfoHelp.stdout, /icpdb info --format table/);
assert.match(sdkCliInfoHelp.stdout, /icpdb info --format env/);
assert.match(sdkCliInfoHelp.stdout, /CI can persist ICPDB_DATABASE_ID, ICPDB_URL, ICPDB_CONNECTION_URL, and ICPDB_SERVICE_PRINCIPAL from env output/);
assert.match(sdkCliInfoHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM sqlite_schema" --format table/);
assert.match(sdkCliInfoHelp.stdout, /console\.log\(await db\.info\(\)\)/);
assert.match(sdkCliInfoHelp.stdout, /icpdb info --service-env-file \.\/ci\/service\.env --format env/);
const sdkCliHandoffHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "handoff"], { cwd: "dist-sdk" });
assert.equal(sdkCliHandoffHelp.stdout, sdkCliInfoHelp.stdout);
const sdkCliServiceEnvHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "service-env"], { cwd: "dist-sdk" });
assert.match(sdkCliServiceEnvHelp.stdout, /Generate an owner-only service\.env before Server\/CI commands/);
assert.match(sdkCliServiceEnvHelp.stdout, /--env-out writes a new owner-only file and refuses to overwrite existing files/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb generate-identity --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb check-env --skip-call --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /Local service\.env diagnosis and handoff fields/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb check-env --require-role writer --smoke-sql --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb principal --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb url --format env/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb info --format env/);
assert.match(sdkCliServiceEnvHelp.stdout, /Canister-only controller\.env checks shard controller calls/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb generate-identity --canister-id <id> --network-url https:\/\/icp-api\.io --env-out controller\.env --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb principal --service-env-file controller\.env --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /eval "\$\(icpdb principal --service-env-file controller\.env --format env\)" && icp canister settings update -n ic <id> --add-controller "\$ICPDB_SERVICE_PRINCIPAL" -f/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb inspect-env --service-env-file controller\.env --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller\.env --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /Canister-only service\.env can create\/persist on first info\/url\/sql call/);
assert.match(sdkCliServiceEnvHelp.stdout, /Use create-db when the first DB needs setup SQL/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb create-db --setup-file \.\/schema\.sql --format env/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb inspect-env --service-env-file \.\/ci\/service\.env --format table/);
assert.match(sdkCliServiceEnvHelp.stdout, /icpdb url --service-env-file \.\/ci\/service\.env --format env/);
const sdkCliEnvHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "env"], { cwd: "dist-sdk" });
assert.equal(sdkCliEnvHelp.stdout, sdkCliServiceEnvHelp.stdout);
const sdkCliCheckEnvHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "check-env"], { cwd: "dist-sdk" });
assert.match(sdkCliCheckEnvHelp.stdout, /Local-only service\.env shape and principal check/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb check-env --skip-call --format table/);
assert.match(sdkCliCheckEnvHelp.stdout, /Database-bearing service\.env canister-visible role check/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb check-env --require-role writer --smoke-sql --format table/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb check-env --require-role writer --smoke-sdk --format table/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliCheckEnvHelp.stdout, /Canister-only controller\.env shard operation check/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb generate-identity --canister-id <id> --network-url https:\/\/icp-api\.io --env-out controller\.env --format table/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb principal --service-env-file controller\.env --format table/);
assert.match(sdkCliCheckEnvHelp.stdout, /eval "\$\(icpdb principal --service-env-file controller\.env --format env\)" && icp canister settings update -n ic <id> --add-controller "\$ICPDB_SERVICE_PRINCIPAL" -f/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb inspect-env --service-env-file controller\.env --format table/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller\.env --format table/);
assert.match(sdkCliCheckEnvHelp.stdout, /Browser\/II DB handoff after console grants the generated service principal/);
assert.match(sdkCliCheckEnvHelp.stdout, /Copy the console Response sidebar Connection URL first; use its database id in <database-id>/);
assert.match(sdkCliCheckEnvHelp.stdout, /Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access/);
assert.match(sdkCliCheckEnvHelp.stdout, /icpdb check-env --service-env-file \.\/ci\/service\.env --require-role writer --format table/);
const sdkCliCheckHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "check"], { cwd: "dist-sdk" });
assert.equal(sdkCliCheckHelp.stdout, sdkCliCheckEnvHelp.stdout);
const sdkCliGenerateIdentityHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "generate-identity"], { cwd: "dist-sdk" });
assert.match(sdkCliGenerateIdentityHelp.stdout, /Create a dedicated Server\/CI service identity without reading service\.env/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /--env-out writes a new owner-only file and refuses to overwrite existing files/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /icpdb generate-identity --canister-id <id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /icpdb generate-identity --identity-type secp256k1 --format env/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /Browser\/II principal and generated Server\/CI service principal are different/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /Copy the console Response sidebar Connection URL first; use its database id in <database-id>/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /Join them through the DB ACL; do not share browser private keys/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /Console: Permissions -> Member principal -> paste principal -> choose owner -> Grant member access/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /icpdb members --format table/);
assert.match(sdkCliGenerateIdentityHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM sqlite_schema" --format table/);
const sdkCliIdentityHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "identity"], { cwd: "dist-sdk" });
assert.equal(sdkCliIdentityHelp.stdout, sdkCliGenerateIdentityHelp.stdout);
const sdkCliGenerateIdentityEnv = await execFileAsync(process.execPath, ["icpdb-cli.js", "generate-identity", "--canister-id", "aaaaa-aa", "--database-id", "db_alpha", "--network-url", "https://icp-api.io", "--format", "env"], { cwd: "dist-sdk" });
assert.match(sdkCliGenerateIdentityEnv.stdout, /ICPDB_CANISTER_ID="aaaaa-aa"/);
assert.match(sdkCliGenerateIdentityEnv.stdout, /ICPDB_DATABASE_ID="db_alpha"/);
assert.match(sdkCliGenerateIdentityEnv.stdout, /ICPDB_URL="icpdb:\/\/aaaaa-aa\/db_alpha"/);
assert.match(sdkCliGenerateIdentityEnv.stdout, /ICPDB_CONNECTION_URL="icpdb:\/\/aaaaa-aa\/db_alpha"/);
assert.match(sdkCliGenerateIdentityEnv.stdout, /ICPDB_NETWORK_URL="https:\/\/icp-api.io"/);
assert.match(sdkCliGenerateIdentityEnv.stdout, /ICPDB_IDENTITY_TYPE="ed25519"/);
assert.match(sdkCliGenerateIdentityEnv.stdout, /ICPDB_IDENTITY_PRINCIPAL="/);
assert.match(sdkCliGenerateIdentityEnv.stdout, /ICPDB_IDENTITY_JSON="/);
const sdkCliGenerateIdentityTable = await execFileAsync(process.execPath, ["icpdb-cli.js", "generate-identity", "--identity-type", "secp256k1", "--canister-id", "aaaaa-aa", "--format", "table"], { cwd: "dist-sdk" });
assert.match(sdkCliGenerateIdentityTable.stdout, /identityType\s+\| secp256k1/);
assert.match(sdkCliGenerateIdentityTable.stdout, /principal\s+\|/);
const sdkCliGenerateTemp = await mkdtemp(join(tmpdir(), "icpdb-sdk-generate-"));
try {
  const generatedEnvPath = join(sdkCliGenerateTemp, "service.env");
  await execFileAsync(process.execPath, ["icpdb-cli.js", "generate-identity", "--canister-id", "aaaaa-aa", "--network-url", "https://icp-api.io", "--env-out", generatedEnvPath, "--format", "table"], { cwd: "dist-sdk" });
  const generatedEnv = readFileSync(generatedEnvPath, "utf8");
  assert.match(generatedEnv, /ICPDB_CANISTER_ID="aaaaa-aa"/);
  assert.match(generatedEnv, /ICPDB_NETWORK_URL="https:\/\/icp-api.io"/);
  assert.match(generatedEnv, /ICPDB_IDENTITY_JSON="/);
  assert.equal((await stat(generatedEnvPath)).mode & 0o777, 0o600);
  const existingEnvPath = join(sdkCliGenerateTemp, "existing.env");
  await writeFile(existingEnvPath, "KEEP=\"existing\"\n", { mode: 0o600 });
  const sdkCliGenerateIdentityExistingEnvOut = await execFileAsync(process.execPath, ["icpdb-cli.js", "generate-identity", "--canister-id", "aaaaa-aa", "--env-out", existingEnvPath], { cwd: "dist-sdk" }).catch((error) => error);
  assert.match(sdkCliGenerateIdentityExistingEnvOut.stderr, /--env-out refuses to overwrite existing file/);
  assert.equal(readFileSync(existingEnvPath, "utf8"), "KEEP=\"existing\"\n");
  const sdkCliInitExistingEnvOut = await execFileAsync(process.execPath, ["icpdb-cli.js", "init", "--canister-id", "aaaaa-aa", "--env-out", existingEnvPath], { cwd: "dist-sdk" }).catch((error) => error);
  assert.match(sdkCliInitExistingEnvOut.stderr, /--env-out refuses to overwrite existing file/);
  assert.equal(readFileSync(existingEnvPath, "utf8"), "KEEP=\"existing\"\n");
  const failedInitEnvPath = join(sdkCliGenerateTemp, "init-missing-setup.env");
  const sdkCliInitMissingSetupFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "init", "--canister-id", "aaaaa-aa", "--setup-file", "./missing-init-schema.sql", "--env-out", failedInitEnvPath], { cwd: "dist-sdk" }).catch((error) => error);
  assert.match(sdkCliInitMissingSetupFile.stderr, /missing-init-schema\.sql/);
  assert.equal(existsSync(failedInitEnvPath), false);
  const sdkCliProvisionServiceExistingEnvOut = await execFileAsync(process.execPath, ["icpdb-cli.js", "provision-service", "db_alpha", "writer", "--service-env-file", "./missing-owner.env", "--env-out", existingEnvPath], { cwd: "dist-sdk" }).catch((error) => error);
  assert.match(sdkCliProvisionServiceExistingEnvOut.stderr, /--env-out refuses to overwrite existing file/);
  assert.equal(readFileSync(existingEnvPath, "utf8"), "KEEP=\"existing\"\n");
  const generatedCheck = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--service-env-file", generatedEnvPath, "--format", "env"], { cwd: "dist-sdk" });
  assert.match(generatedCheck.stdout, /ICPDB_SERVICE_CHECK_OK="true"/);
  assert.match(generatedCheck.stdout, /ICPDB_SERVICE_CHECK_CANISTER_ID="aaaaa-aa"/);
  assert.match(generatedCheck.stdout, /ICPDB_SERVICE_CHECK_HAS_DATABASE="false"/);
  assert.match(generatedCheck.stdout, /ICPDB_SERVICE_CHECK_PRINCIPAL="/);
  assert.match(generatedCheck.stdout, /ICPDB_SERVICE_CHECKS="inspect-env"/);
  assert.doesNotMatch(generatedCheck.stdout, /nextCreateDbCommand/);
  const generatedCheckTable = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--service-env-file", generatedEnvPath, "--format", "table"], { cwd: "dist-sdk" });
  assert.match(generatedCheckTable.stdout, /nextInspectEnvCommand/);
  assert.match(generatedCheckTable.stdout, /inspect-env/);
  assert.match(generatedCheckTable.stdout, /nextCreateDbCommand/);
  assert.match(generatedCheckTable.stdout, /create-db/);
  assert.match(generatedCheckTable.stdout, /--setup-sql/);
  assert.match(generatedCheckTable.stdout, /nextCheckEnvCommand/);
  assert.match(generatedCheckTable.stdout, /--skip-call/);
  assert.match(generatedCheckTable.stdout, /nextInfoCommand/);
  const generatedInspectTable = await execFileAsync(process.execPath, ["icpdb-cli.js", "inspect-env", "--service-env-file", generatedEnvPath, "--format", "table"], { cwd: "dist-sdk" });
  assert.match(generatedInspectTable.stdout, /nextCreateDbCommand/);
  assert.match(generatedInspectTable.stdout, /create-db/);
  assert.match(generatedInspectTable.stdout, /--setup-sql/);
  assert.match(generatedInspectTable.stdout, /nextScalarCommand/);
  assert.match(generatedInspectTable.stdout, /SELECT 1 AS value/);
  assert.match(generatedInspectTable.stdout, /nextExecuteCommand/);
  assert.match(generatedInspectTable.stdout, /CREATE TABLE icpdb_first_sql/);
  assert.match(generatedInspectTable.stdout, /nextQueryCommand/);
  assert.match(generatedInspectTable.stdout, /SELECT count\(\*\) FROM sqlite_schema/);
  assert.match(generatedInspectTable.stdout, /nextInfoCommand/);
  const generatedDatabaseEnvPath = join(sdkCliGenerateTemp, "database-service.env");
  await execFileAsync(process.execPath, [
    "icpdb-cli.js",
    "generate-identity",
    "--canister-id",
    "aaaaa-aa",
    "--database-id",
    "db_alpha",
    "--network-url",
    "https://icp-api.io",
    "--env-out",
    generatedDatabaseEnvPath,
    "--format",
    "table"
  ], { cwd: "dist-sdk" });
  const generatedDatabaseCheck = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--service-env-file", generatedDatabaseEnvPath, "--format", "env"], { cwd: "dist-sdk" });
  assert.doesNotMatch(readFileSync(generatedDatabaseEnvPath, "utf8"), /ICPDB_CONNECTION_URL/, "service env file should not duplicate the connection URL alias");
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECK_OK="true"/);
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECK_CANISTER_ID="aaaaa-aa"/);
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECK_HAS_DATABASE="true"/);
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECK_DATABASE_ID="db_alpha"/);
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECK_URL="icpdb:\/\/aaaaa-aa\/db_alpha"/);
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECK_CONNECTION_URL="icpdb:\/\/aaaaa-aa\/db_alpha"/);
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECK_NETWORK_URL="https:\/\/icp-api.io"/);
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECK_PRINCIPAL="/);
  assert.match(generatedDatabaseCheck.stdout, /ICPDB_SERVICE_CHECKS="inspect-env"/);
  assert.doesNotMatch(generatedDatabaseCheck.stdout, /nextCheckEnvCommand/);
  const generatedDatabaseCheckTable = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--service-env-file", generatedDatabaseEnvPath, "--format", "table"], { cwd: "dist-sdk" });
  assert.match(generatedDatabaseCheckTable.stdout, /nextInspectEnvCommand/);
  assert.match(generatedDatabaseCheckTable.stdout, /nextCheckEnvCommand/);
  assert.match(generatedDatabaseCheckTable.stdout, /check-env/);
  assert.match(generatedDatabaseCheckTable.stdout, /--require-role writer/);
  assert.match(generatedDatabaseCheckTable.stdout, /nextStatusCommand/);
  assert.match(generatedDatabaseCheckTable.stdout, /status/);
  assert.match(generatedDatabaseCheckTable.stdout, /nextQueryCommand/);
  assert.match(generatedDatabaseCheckTable.stdout, /SELECT name FROM sqlite_schema ORDER BY name/);
  assert.match(generatedDatabaseCheckTable.stdout, /nextSchemaCountCommand/);
  assert.match(generatedDatabaseCheckTable.stdout, /SELECT count\(\*\) FROM sqlite_schema/);
  assert.match(generatedDatabaseCheckTable.stdout, /nextTablesCommand/);
  assert.match(generatedDatabaseCheckTable.stdout, /nextUrlCommand/);
  assert.match(generatedDatabaseCheckTable.stdout, /nextInfoCommand/);
  assert.doesNotMatch(generatedDatabaseCheckTable.stdout, /nextExecuteCommand/);
  const generatedDatabaseInspect = await execFileAsync(process.execPath, ["icpdb-cli.js", "inspect-env", "--service-env-file", generatedDatabaseEnvPath, "--format", "env"], { cwd: "dist-sdk" });
  assert.match(generatedDatabaseInspect.stdout, /ICPDB_CANISTER_ID="aaaaa-aa"/);
  assert.match(generatedDatabaseInspect.stdout, /ICPDB_HAS_DATABASE="true"/);
  assert.match(generatedDatabaseInspect.stdout, /ICPDB_DATABASE_ID="db_alpha"/);
  assert.match(generatedDatabaseInspect.stdout, /ICPDB_URL="icpdb:\/\/aaaaa-aa\/db_alpha"/);
  assert.match(generatedDatabaseInspect.stdout, /ICPDB_CONNECTION_URL="icpdb:\/\/aaaaa-aa\/db_alpha"/);
  assert.match(generatedDatabaseInspect.stdout, /ICPDB_NETWORK_URL="https:\/\/icp-api.io"/);
  assert.match(generatedDatabaseInspect.stdout, /ICPDB_SERVICE_PRINCIPAL="/);
  assert.doesNotMatch(generatedDatabaseInspect.stdout, /nextCheckEnvCommand/);
  const generatedDatabaseInspectTable = await execFileAsync(process.execPath, ["icpdb-cli.js", "inspect-env", "--service-env-file", generatedDatabaseEnvPath, "--format", "table"], { cwd: "dist-sdk" });
  assert.match(generatedDatabaseInspectTable.stdout, /nextCheckEnvCommand/);
  assert.match(generatedDatabaseInspectTable.stdout, /check-env/);
  assert.match(generatedDatabaseInspectTable.stdout, /--require-role writer/);
  assert.match(generatedDatabaseInspectTable.stdout, /nextUrlCommand/);
  assert.match(generatedDatabaseInspectTable.stdout, /url/);
  assert.match(generatedDatabaseInspectTable.stdout, /nextInfoCommand/);
  assert.match(generatedDatabaseInspectTable.stdout, /info/);
  const generatedDatabaseUrl = await execFileAsync(process.execPath, ["icpdb-cli.js", "url", "--service-env-file", generatedDatabaseEnvPath, "--format", "env"], { cwd: "dist-sdk" });
  assert.match(generatedDatabaseUrl.stdout, /ICPDB_CANISTER_ID="aaaaa-aa"/);
  assert.match(generatedDatabaseUrl.stdout, /ICPDB_DATABASE_ID="db_alpha"/);
  assert.match(generatedDatabaseUrl.stdout, /ICPDB_URL="icpdb:\/\/aaaaa-aa\/db_alpha"/);
  assert.match(generatedDatabaseUrl.stdout, /ICPDB_CONNECTION_URL="icpdb:\/\/aaaaa-aa\/db_alpha"/);
  assert.match(generatedDatabaseUrl.stdout, /ICPDB_NETWORK_URL="https:\/\/icp-api.io"/);
  assert.match(generatedDatabaseUrl.stdout, /ICPDB_SERVICE_PRINCIPAL="/);
} finally {
  await rm(sdkCliGenerateTemp, { recursive: true, force: true });
}
const sdkCliPermissionsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "permissions"], { cwd: "dist-sdk" });
assert.match(sdkCliPermissionsHelp.stdout, /Browser\/II-owned DB handoff after generating service\.env/);
assert.match(sdkCliPermissionsHelp.stdout, /Copy the console Response sidebar Connection URL first; use its database id in <database-id>/);
assert.match(sdkCliPermissionsHelp.stdout, /icpdb generate-identity --canister-id <id> --database-id <database-id> --network-url https:\/\/icp-api\.io --env-out service\.env --format table/);
assert.match(sdkCliPermissionsHelp.stdout, /icpdb principal --format table/);
assert.match(sdkCliPermissionsHelp.stdout, /Browser\/II principal and Server\/CI service principal are intentionally different/);
assert.match(sdkCliPermissionsHelp.stdout, /Do not share private keys; grant the service principal through the DB ACL/);
assert.match(sdkCliPermissionsHelp.stdout, /Grant that service principal in console Permissions as writer or owner/);
assert.match(sdkCliPermissionsHelp.stdout, /Console: Permissions -> Member principal -> paste principal -> choose writer\/owner -> Grant member access/);
assert.match(sdkCliPermissionsHelp.stdout, /Verify writer or owner grant for normal Server\/CI SQL/);
assert.match(sdkCliPermissionsHelp.stdout, /icpdb check-env --require-role writer --smoke-sql --format table/);
assert.match(sdkCliPermissionsHelp.stdout, /icpdb stats --format table/);
assert.match(sdkCliPermissionsHelp.stdout, /Owner grant can also prove archive\/restore/);
assert.match(sdkCliPermissionsHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliPermissionsHelp.stdout, /icpdb grant-member <service-principal> writer --format table/);
assert.match(sdkCliPermissionsHelp.stdout, /icpdb grant-member <service-principal> owner --format table/);
assert.match(sdkCliPermissionsHelp.stdout, /Backup and restore require owner role, not writer/);
const sdkCliAuthHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "auth"], { cwd: "dist-sdk" });
assert.equal(sdkCliAuthHelp.stdout, sdkCliPermissionsHelp.stdout);
const sdkCliMembersHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "members"], { cwd: "dist-sdk" });
assert.match(sdkCliMembersHelp.stdout, /Inspect DB ACL membership/);
assert.match(sdkCliMembersHelp.stdout, /icpdb members --format table/);
assert.match(sdkCliMembersHelp.stdout, /icpdb principal --format table/);
assert.match(sdkCliMembersHelp.stdout, /Owner service\.env can manage Server\/CI principals/);
assert.match(sdkCliMembersHelp.stdout, /icpdb grant-member <service-principal> writer --format table/);
assert.match(sdkCliMembersHelp.stdout, /icpdb grant-member <service-principal> owner --format table/);
assert.match(sdkCliMembersHelp.stdout, /icpdb revoke-member <service-principal> --format table/);
assert.match(sdkCliMembersHelp.stdout, /Writer grants are for SQL; owner grants are required for backup\/ACL management/);
assert.match(sdkCliMembersHelp.stdout, /icpdb check-env --require-role writer --smoke-sql --format table/);
assert.match(sdkCliMembersHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliMembersHelp.stdout, /icpdb grant-member <service-principal> writer --service-env-file owner\.env --format table/);
const sdkCliGrantMemberHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "grant-member"], { cwd: "dist-sdk" });
assert.equal(sdkCliGrantMemberHelp.stdout, sdkCliMembersHelp.stdout);
const sdkCliRevokeMemberHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "revoke-member"], { cwd: "dist-sdk" });
assert.equal(sdkCliRevokeMemberHelp.stdout, sdkCliMembersHelp.stdout);
const sdkCliBackupHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "backup"], { cwd: "dist-sdk" });
assert.match(sdkCliBackupHelp.stdout, /Archive\/restore requires owner role/);
assert.match(sdkCliBackupHelp.stdout, /icpdb status --format table/);
assert.match(sdkCliBackupHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliBackupHelp.stdout, /archive --format env emits ICPDB_SNAPSHOT_HASH plus ICPDB_URL\/ICPDB_CONNECTION_URL for CI handoff/);
assert.match(sdkCliBackupHelp.stdout, /icpdb archive \.\/backup\.sqlite --format env/);
assert.match(sdkCliBackupHelp.stdout, /archive table\/json\/csv output includes nextSnapshotInfoCommand, nextRestoreCommand, nextHashPinnedRestoreCommand, and post-restore schema\/tables\/views\/stats\/status\/members\/url\/info checks/);
assert.match(sdkCliBackupHelp.stdout, /icpdb archive \.\/backup\.sqlite --format table/);
assert.match(sdkCliBackupHelp.stdout, /icpdb snapshot-info \.\/backup\.sqlite --format table/);
assert.match(sdkCliBackupHelp.stdout, /snapshot-info --format env can be eval-loaded before hash-pinned restore/);
assert.match(sdkCliBackupHelp.stdout, /icpdb snapshot-info \.\/backup\.sqlite --format env/);
assert.match(sdkCliBackupHelp.stdout, /icpdb restore \.\/backup\.sqlite --expect-snapshot-hash <sha256> --format table/);
assert.match(sdkCliBackupHelp.stdout, /eval "\$\(icpdb snapshot-info \.\/backup\.sqlite --format env\)" && icpdb restore \.\/backup\.sqlite --expect-snapshot-hash "\$ICPDB_SNAPSHOT_HASH" --format table/);
assert.match(sdkCliBackupHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM sqlite_schema" --format table/);
assert.match(sdkCliBackupHelp.stdout, /icpdb restore \.\/backup\.sqlite --expect-snapshot-hash <sha256> --format table[\s\S]*icpdb scalar "SELECT count\(\*\) FROM sqlite_schema" --format table[\s\S]*icpdb tables --format table[\s\S]*icpdb views --format table[\s\S]*icpdb schema --format table[\s\S]*icpdb inspect --format table[\s\S]*icpdb stats --format table[\s\S]*icpdb status --format table[\s\S]*icpdb members --format table[\s\S]*icpdb url --format env[\s\S]*icpdb info --format env/);
assert.match(sdkCliBackupHelp.stdout, /icpdb restore \.\/backup\.sqlite --expect-snapshot-hash <sha256> --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliArchiveHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "archive"], { cwd: "dist-sdk" });
assert.equal(sdkCliArchiveHelp.stdout, sdkCliBackupHelp.stdout);
const sdkCliSnapshotInfoHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "snapshot-info"], { cwd: "dist-sdk" });
assert.equal(sdkCliSnapshotInfoHelp.stdout, sdkCliBackupHelp.stdout);
const sdkCliSnapshotHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "snapshot"], { cwd: "dist-sdk" });
assert.equal(sdkCliSnapshotHelp.stdout, sdkCliBackupHelp.stdout);
const sdkCliRestoreHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "restore"], { cwd: "dist-sdk" });
assert.equal(sdkCliRestoreHelp.stdout, sdkCliBackupHelp.stdout);
const sdkCliOperationHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "operation"], { cwd: "dist-sdk" });
assert.match(sdkCliOperationHelp.stdout, /Routed write recovery for remote shard writes/);
assert.match(sdkCliOperationHelp.stdout, /icpdb execute "INSERT INTO notes\(body\) VALUES \(\?1\)" --params '\["hello"\]' --idempotency-key ci-notes-insert-001 --wait --format table/);
assert.match(sdkCliOperationHelp.stdout, /icpdb operation <operation-id> --format table/);
assert.match(sdkCliOperationHelp.stdout, /icpdb operation-wait <operation-id> --reconcile-unknown --format table/);
assert.match(sdkCliOperationHelp.stdout, /icpdb operation-reconcile <operation-id> --format table/);
assert.match(sdkCliOperationHelp.stdout, /icpdb batch \.\/statements\.json --mode write --idempotency-key ci-batch-001 --wait --format table/);
assert.match(sdkCliOperationHelp.stdout, /icpdb operation <operation-id> --service-env-file \.\/ci\/service\.env --format table/);
const sdkCliOperationsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "operations"], { cwd: "dist-sdk" });
assert.equal(sdkCliOperationsHelp.stdout, sdkCliOperationHelp.stdout);
const sdkCliOperationWaitHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "operation-wait"], { cwd: "dist-sdk" });
assert.equal(sdkCliOperationWaitHelp.stdout, sdkCliOperationHelp.stdout);
const sdkCliOperationReconcileHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "operation-reconcile"], { cwd: "dist-sdk" });
assert.equal(sdkCliOperationReconcileHelp.stdout, sdkCliOperationHelp.stdout);
const sdkCliShellHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shell"], { cwd: "dist-sdk" });
assert.match(sdkCliShellHelp.stdout, /Shell commands:/);
assert.match(sdkCliShellHelp.stdout, /\.principal/);
assert.match(sdkCliShellHelp.stdout, /\.health/);
assert.match(sdkCliShellHelp.stdout, /\.url/);
assert.match(sdkCliShellHelp.stdout, /\.info/);
assert.match(sdkCliShellHelp.stdout, /\.status/);
assert.match(sdkCliShellHelp.stdout, /\.tables/);
assert.match(sdkCliShellHelp.stdout, /\.stats/);
assert.match(sdkCliShellHelp.stdout, /\.describe <table_name>/);
assert.match(sdkCliShellHelp.stdout, /\.schema \[table_name\]/);
assert.match(sdkCliShellHelp.stdout, /\.dump \[file\|->\]/);
assert.match(sdkCliShellHelp.stdout, /\.load <file\|->/);
assert.match(sdkCliShellHelp.stdout, /\.script <file\|->/);
assert.match(sdkCliShellHelp.stdout, /\.migrate <file\|->/);
assert.match(sdkCliShellHelp.stdout, /\.grant-member <principal> <reader\|writer\|owner>/);
assert.match(sdkCliShellHelp.stdout, /\.revoke-member <principal>/);
assert.match(sdkCliShellHelp.stdout, /\.delete-db <database_id>/);
assert.match(sdkCliShellHelp.stdout, /\.operation <operation_id>/);
assert.match(sdkCliShellHelp.stdout, /\.archive <file>/);
assert.match(sdkCliShellHelp.stdout, /\.restore <file> \[expected_sha256\]/);
assert.match(sdkCliShellHelp.stdout, /Shell write SQL auto-generates an idempotency key/);
const sdkCliShellSqlHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shell", "sql"], { cwd: "dist-sdk" });
assert.match(sdkCliShellSqlHelp.stdout, /SQL:/);
assert.match(sdkCliShellSqlHelp.stdout, /Other SQL statements run through execute/);
const sdkCliShellTablesHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shell", "tables"], { cwd: "dist-sdk" });
assert.match(sdkCliShellTablesHelp.stdout, /\.tables/);
const sdkCliShellDescribeHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shell", "describe"], { cwd: "dist-sdk" });
assert.match(sdkCliShellDescribeHelp.stdout, /\.describe <table_name>/);
const sdkCliShellLoadHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shell", "load"], { cwd: "dist-sdk" });
assert.match(sdkCliShellLoadHelp.stdout, /\.load <file\|->/);
const sdkCliShellDeleteDbHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shell", "delete-db"], { cwd: "dist-sdk" });
assert.match(sdkCliShellDeleteDbHelp.stdout, /\.delete-db <database_id>/);
const sdkCliShellOneShotHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".help"], { cwd: "dist-sdk" });
assert.equal(sdkCliShellOneShotHelp.stdout, sdkCliShellHelp.stdout);
const sdkCliShellHelpMode = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".help", "--mode", "read"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellHelpMode.stderr, /--mode is only valid for shell SQL, \.load, and \.script/);
const sdkCliShellHelpWait = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".help", "--wait"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellHelpWait.stderr, /--wait is only valid for shell write SQL, \.load, \.script, and \.migrate/);
const sdkCliShellQuitIdempotency = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".quit", "--idempotency-key", "retry_1"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellQuitIdempotency.stderr, /--idempotency-key is only valid for shell write SQL, \.load, \.script, and \.migrate/);
const sdkCliShellUnknown = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".wat", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellUnknown.stderr, /unknown shell command: \.wat/);
const sdkCliShellIncomplete = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".grant-member", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellIncomplete.stderr, /\.grant-member requires 2 arguments/);
const sdkCliShellBadFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".load '   '", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellBadFile.stderr, /\.load file must be a non-empty string/);
const sdkCliShellTablesMode = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".tables", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellTablesMode.stderr, /--mode is only valid for shell SQL, \.load, and \.script/);
const sdkCliShellMigrateMode = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".migrate ./migrations.json", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellMigrateMode.stderr, /--mode is only valid for shell SQL, \.load, and \.script/);
const sdkCliShellSnapshotInfoMode = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".snapshot-info ./missing.sqlite", "--mode", "read"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellSnapshotInfoMode.stderr, /--mode is only valid for shell SQL, \.load, and \.script/);
await writeFile("dist-sdk/shell-write.sql", "INSERT INTO notes(id) VALUES (1);");
const sdkCliShellScriptReadModeWriteSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".script ./shell-write.sql", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellScriptReadModeWriteSql.stderr, /read batch mode only accepts read SQL/);
const sdkCliShellLoadReadModeWriteSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".load ./shell-write.sql", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellLoadReadModeWriteSql.stderr, /read batch mode only accepts read SQL/);
const sdkCliShellBadArchiveFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".archive '   '", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellBadArchiveFile.stderr, /\.archive file must be a non-empty string/);
const sdkCliShellBadRestoreHash = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".restore ./backup.sqlite '   '", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellBadRestoreHash.stderr, /expected snapshot hash must be a non-empty string/);
const sdkCliShellMalformedRestoreHash = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".restore ./backup.sqlite not-a-sha256", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellMalformedRestoreHash.stderr, /expectedSha256 must be a 64-character hex SHA-256 hash/);
const sdkCliShellBadRole = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".grant-member rrkah-fqaaa-aaaaa-aaaaq-cai admin", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellBadRole.stderr, /role must be reader, writer, or owner/);
const sdkCliShellAnonymousGrant = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".grant-member 2vxsx-fae reader", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellAnonymousGrant.stderr, /anonymous principal cannot be granted database access/);
const sdkCliShellMissingDeleteDb = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".delete-db", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellMissingDeleteDb.stderr, /\.delete-db requires 1 argument/);
const sdkCliShellBlankDeleteDb = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".delete-db '   '", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellBlankDeleteDb.stderr, /delete confirmation database id must be a non-empty string/);
const sdkCliShellSnapshotTemp = await mkdtemp(join(tmpdir(), "icpdb-sdk-cli-shell-snapshot-"));
try {
  const snapshotPath = join(sdkCliShellSnapshotTemp, "snapshot.sqlite");
  await writeFile(snapshotPath, new Uint8Array([1, 2, 3]));
  const sdkCliShellSnapshotInfo = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", `.snapshot-info ${snapshotPath}`, "--format", "table"], { cwd: "dist-sdk" });
  assert.match(sdkCliShellSnapshotInfo.stdout, /sha256\s+\|/);
  assert.match(sdkCliShellSnapshotInfo.stdout, /snapshot\.sqlite/);
} finally {
  await rm(sdkCliShellSnapshotTemp, { recursive: true, force: true });
}
const sdkCliOpsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "ops"], { cwd: "dist-sdk" });
assert.match(sdkCliOpsHelp.stdout, /Archive\/restore requires owner role/);
assert.match(sdkCliOpsHelp.stdout, /icpdb check-env --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb snapshot-info \.\/backup\.sqlite --format table/);
assert.match(sdkCliOpsHelp.stdout, /Controller\/shard operations use canister-only controller\.env/);
assert.match(sdkCliOpsHelp.stdout, /Do not put ICPDB_DATABASE_ID or icpdb:\/\/<canister-id>\/<database-id> in controller\.env/);
assert.match(sdkCliOpsHelp.stdout, /Shard smoke is canister-level: do not combine it with --require-role or DB SQL smoke/);
assert.match(sdkCliOpsHelp.stdout, /icpdb generate-identity --canister-id <id> --network-url https:\/\/icp-api\.io --env-out controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb principal --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /eval "\$\(icpdb principal --service-env-file controller\.env --format env\)" && icp canister settings update -n ic <id> --add-controller "\$ICPDB_SERVICE_PRINCIPAL" -f/);
assert.match(sdkCliOpsHelp.stdout, /icpdb inspect-env --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb health --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb check-env --smoke-shards --smoke-sdk-shards --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /shard table\/json\/csv output includes nextShardInventoryCommand, nextAllPlacementsCommand, nextShardOpsCommand, and nextShardMaintainDryRunCommand/);
assert.match(sdkCliOpsHelp.stdout, /shard canister output includes nextShardStatusCommand and nextShardTopUpCommand/);
assert.match(sdkCliOpsHelp.stdout, /icpdb all-placements --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb shards --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb shard-maintain 0 0 0 0 0 0 --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb shard-create <initial-cycles> <max-databases> --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb shard-register <database-canister-id> <max-databases> --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb remote-create-db <database-id> <database-canister-id> --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb shard-ops --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb shard-reconcile <operation-id> applied --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb shard-reconcile <operation-id> failed "operator verified failure" --service-env-file controller\.env --format table/);
assert.match(sdkCliOpsHelp.stdout, /Routed DB writes use the database-bearing service\.env, not controller\.env/);
assert.match(sdkCliOpsHelp.stdout, /icpdb operation <operation-id> --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb operation-wait <operation-id> --reconcile-unknown --format table/);
assert.match(sdkCliOpsHelp.stdout, /icpdb operation-reconcile <operation-id> --format table/);
const sdkCliShardsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shards"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardsHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliControllerHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "controller"], { cwd: "dist-sdk" });
assert.equal(sdkCliControllerHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliPlacementsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "placements"], { cwd: "dist-sdk" });
assert.equal(sdkCliPlacementsHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliAllPlacementsHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "all-placements"], { cwd: "dist-sdk" });
assert.equal(sdkCliAllPlacementsHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardCreateHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard-create"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardCreateHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardRegisterHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard-register"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardRegisterHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardStatusHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard-status"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardStatusHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardTopUpHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard-top-up"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardTopUpHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardOpsTopicHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard-ops"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardOpsTopicHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardMaintainHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard-maintain"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardMaintainHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardMigrateHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard-migrate"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardMigrateHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliRemoteCreateDbHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "remote-create-db"], { cwd: "dist-sdk" });
assert.equal(sdkCliRemoteCreateDbHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliShardReconcileHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "shard-reconcile"], { cwd: "dist-sdk" });
assert.equal(sdkCliShardReconcileHelp.stdout, sdkCliOpsHelp.stdout);
const sdkCliCreateDbHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "create-db"], { cwd: "dist-sdk" });
assert.match(sdkCliCreateDbHelp.stdout, /create-db requires canister-only service\.env/);
assert.match(sdkCliCreateDbHelp.stdout, /Without setup flags, create-db creates an empty DB, persists ICPDB_DATABASE_ID, then prints ICPDB_URL \/ ICPDB_CONNECTION_URL/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb inspect-env --format table/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb create-db --setup-sql "CREATE TABLE notes\(id INTEGER PRIMARY KEY, body TEXT NOT NULL\)" --format table/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb create-db --setup-statements-file \.\/setup-statements\.json --format env/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb create-db --setup-file \.\/schema\.sql --format table/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb create-db --setup-file \.\/schema\.sql --format csv/);
assert.match(sdkCliCreateDbHelp.stdout, /table\/json\/csv output includes nextInspectEnvCommand, nextExecuteCommand, nextInsertCommand, nextQueryCommand, nextReadCommand, nextSqlSmokeCommand, nextSchemaCountCommand, nextTablesCommand, nextViewsCommand, nextStatsCommand, nextSchemaCommand, nextDescribeCommand, nextPreviewCommand, nextStatusCommand, nextMembersCommand, nextUrlCommand, and nextInfoCommand/);
assert.match(sdkCliCreateDbHelp.stdout, /Reuse the persisted DB id from the same service\.env/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb scalar "SELECT count\(\*\) FROM notes" --format table/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb tables --format table/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb stats --format table/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb inspect notes --format table/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb status --format table/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb url --format env/);
assert.match(sdkCliCreateDbHelp.stdout, /icpdb info --format env/);
const sdkCliUnknownHelp = await execFileAsync(process.execPath, ["icpdb-cli.js", "help", "wat"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliUnknownHelp.stderr, /unknown help command: wat/);
const sdkCliTableTemp = await mkdtemp(join(tmpdir(), "icpdb-sdk-cli-table-"));
try {
  const snapshotPath = join(sdkCliTableTemp, "snapshot.sqlite");
  await writeFile(snapshotPath, "table output fixture");
  const sdkCliSnapshotTable = await execFileAsync(process.execPath, ["icpdb-cli.js", "snapshot-info", snapshotPath, "--format", "table"], { cwd: "dist-sdk" });
  assert.match(sdkCliSnapshotTable.stdout, /key\s+\|\s+value/);
  assert.match(sdkCliSnapshotTable.stdout, /filePath\s+\|/);
  assert.match(sdkCliSnapshotTable.stdout, /sha256\s+\|/);
  assert.match(sdkCliSnapshotTable.stdout, /snapshot\.sqlite/);
  const sdkCliSnapshotCsv = await execFileAsync(process.execPath, ["icpdb-cli.js", "snapshot-info", snapshotPath, "--format", "csv"], { cwd: "dist-sdk" });
  assert.match(sdkCliSnapshotCsv.stdout, /key,value/);
  assert.match(sdkCliSnapshotCsv.stdout, /filePath,.*snapshot\.sqlite/);
} finally {
  await rm(sdkCliTableTemp, { recursive: true, force: true });
}
const sdkCliInvalidLimit = await execFileAsync(process.execPath, ["icpdb-cli.js", "preview", "notes", "--limit", "0"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliInvalidLimit.stderr, /--limit must be an integer from 1 to 500/);
const sdkCliInvalidFormat = await execFileAsync(process.execPath, ["icpdb-cli.js", "snapshot-info", "./missing.sqlite", "--format", "yaml"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliInvalidFormat.stderr, /--format must be json, table, csv, or env/);
const sdkCliEnvFormatWrongCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "SELECT 1", "--format", "env", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliEnvFormatWrongCommand.stderr, /--format env is only valid for init, generate-identity, provision-service, check-env, inspect-env, principal, url, info, create-db, archive, and snapshot-info/);
const sdkCliRestoreEnvFormat = await execFileAsync(process.execPath, ["icpdb-cli.js", "restore", "./missing.sqlite", "--format", "env", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliRestoreEnvFormat.stderr, /--format env is only valid for init, generate-identity, provision-service, check-env, inspect-env, principal, url, info, create-db, archive, and snapshot-info/);
const sdkCliMalformedRestoreHash = await execFileAsync(process.execPath, ["icpdb-cli.js", "restore", "./missing.sqlite", "--expect-snapshot-hash", "not-a-sha256", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliMalformedRestoreHash.stderr, /expectedSha256 must be a 64-character hex SHA-256 hash/);
const sdkCliWrongLimitCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "SELECT 1", "--limit", "10"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliWrongLimitCommand.stderr, /--limit and --offset are only valid for preview and inspect/);
const sdkCliUnknownCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "qurey", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliUnknownCommand.stderr, /unknown command: qurey/);
const sdkCliMissingSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliMissingSql.stderr, /missing SQL/);
const sdkCliInspectEnvExtraArg = await execFileAsync(process.execPath, ["icpdb-cli.js", "inspect-env", "extra", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliInspectEnvExtraArg.stderr, /inspect-env accepts at most 0 positional arguments/);
const sdkCliOperationReconcileMissingId = await execFileAsync(process.execPath, ["icpdb-cli.js", "operation-reconcile", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliOperationReconcileMissingId.stderr, /missing operation id/);
const sdkCliArchiveMissingFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "archive", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliArchiveMissingFile.stderr, /missing archive file/);
const sdkCliSnapshotInfoExpectedHash = await execFileAsync(process.execPath, ["icpdb-cli.js", "snapshot-info", "./backup.sqlite", "--expect-snapshot-hash", "a".repeat(64)], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliSnapshotInfoExpectedHash.stderr, /--expect-snapshot-hash is only valid for restore/);
const sdkCliShellExpectedHash = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".restore ./backup.sqlite", "--expect-snapshot-hash", "a".repeat(64), "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellExpectedHash.stderr, /--expect-snapshot-hash is only valid for restore/);
const sdkCliInitServiceEnvFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "init", "--canister-id", "aaaaa-aa", "--env-out", "service.env", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliInitServiceEnvFile.stderr, /--service-env-file and --env-file are not valid for init, generate-identity, or snapshot-info/);
const sdkCliGenerateIdentityServiceEnvFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "generate-identity", "--canister-id", "aaaaa-aa", "--env-out", "service.env", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliGenerateIdentityServiceEnvFile.stderr, /--service-env-file and --env-file are not valid for init, generate-identity, or snapshot-info/);
const sdkCliSnapshotInfoServiceEnvFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "snapshot-info", "./backup.sqlite", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliSnapshotInfoServiceEnvFile.stderr, /--service-env-file and --env-file are not valid for init, generate-identity, or snapshot-info/);
const sdkCliQueryMode = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "SELECT 1", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliQueryMode.stderr, /--mode is only valid for exec, batch, transaction, script, load, and shell/);
const sdkCliMigrateMode = await execFileAsync(process.execPath, ["icpdb-cli.js", "migrate", "./missing.json", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliMigrateMode.stderr, /--mode is only valid for exec, batch, transaction, script, load, and shell/);
const sdkCliShellReadModeWriteSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", "INSERT INTO notes(id) VALUES (1)", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellReadModeWriteSql.stderr, /read batch mode only accepts read SQL/);
await writeFile("dist-sdk/read-mode-write-statements.json", JSON.stringify(["INSERT INTO notes(id) VALUES (1)"]));
const sdkCliBatchReadModeWriteSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "batch", "./read-mode-write-statements.json", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliBatchReadModeWriteSql.stderr, /read batch mode only accepts read SQL/);
const sdkCliTransactionReadModeWriteSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "transaction", "./read-mode-write-statements.json", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliTransactionReadModeWriteSql.stderr, /read batch mode only accepts read SQL/);
const sdkCliScriptReadModeWriteSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "script", "./shell-write.sql", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliScriptReadModeWriteSql.stderr, /read batch mode only accepts read SQL/);
const sdkCliLoadReadModeWriteSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "load", "./shell-write.sql", "--mode", "read", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliLoadReadModeWriteSql.stderr, /read batch mode only accepts read SQL/);
const sdkCliIdempotencyWrongCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "SELECT 1", "--idempotency-key", "retry_1", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliIdempotencyWrongCommand.stderr, /--idempotency-key is only valid for execute, exec, sql, batch, transaction, script, load, migrate, and shell/);
const sdkCliIdempotencyEmpty = await execFileAsync(process.execPath, ["icpdb-cli.js", "execute", "INSERT", "--idempotency-key", "   ", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliIdempotencyEmpty.stderr, /idempotency key must be a non-empty string/);
const sdkCliIdempotencyReadMode = await execFileAsync(process.execPath, ["icpdb-cli.js", "batch", "./missing.json", "--mode", "read", "--idempotency-key", "retry_1", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliIdempotencyReadMode.stderr, /--idempotency-key is only valid for write SQL/);
const sdkCliReadSqlIdempotency = await execFileAsync(process.execPath, ["icpdb-cli.js", "sql", "WITH notes AS (SELECT 1 AS id) SELECT id FROM notes", "--idempotency-key", "retry_1", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliReadSqlIdempotency.stderr, /--idempotency-key is only valid for write SQL/);
const sdkCliWaitWrongCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "SELECT 1", "--wait", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliWaitWrongCommand.stderr, /--wait is only valid for execute, exec, sql, batch, transaction, script, load, migrate, and shell/);
const sdkCliWaitReadMode = await execFileAsync(process.execPath, ["icpdb-cli.js", "batch", "./missing.json", "--mode", "read", "--wait", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliWaitReadMode.stderr, /--wait is only valid for write SQL/);
const sdkCliReadSqlWait = await execFileAsync(process.execPath, ["icpdb-cli.js", "sql", "/* comment */ SELECT 1", "--wait", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliReadSqlWait.stderr, /--wait is only valid for write SQL/);
const sdkCliShellReadSqlIdempotency = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", "SELECT 1", "--idempotency-key", "retry_1", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellReadSqlIdempotency.stderr, /--idempotency-key is only valid for write SQL/);
const sdkCliShellReadSqlWait = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", "SELECT 1", "--wait", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellReadSqlWait.stderr, /--wait is only valid for write SQL/);
const sdkCliShellTablesIdempotency = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".tables", "--idempotency-key", "retry_1", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellTablesIdempotency.stderr, /--idempotency-key is only valid for shell write SQL, \.load, \.script, and \.migrate/);
const sdkCliShellTablesWait = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".tables", "--wait", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellTablesWait.stderr, /--wait is only valid for shell write SQL, \.load, \.script, and \.migrate/);
const sdkCliShellSnapshotInfoIdempotency = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".snapshot-info ./missing.sqlite", "--idempotency-key", "retry_1"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellSnapshotInfoIdempotency.stderr, /--idempotency-key is only valid for shell write SQL, \.load, \.script, and \.migrate/);
const sdkCliShellSnapshotInfoWait = await execFileAsync(process.execPath, ["icpdb-cli.js", "shell", ".snapshot-info ./missing.sqlite", "--wait"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShellSnapshotInfoWait.stderr, /--wait is only valid for shell write SQL, \.load, \.script, and \.migrate/);
const sdkCliExecParams = await execFileAsync(process.execPath, ["icpdb-cli.js", "exec", "SELECT ?1", "--params", "[1]", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliExecParams.stderr, /--params and --params-file are only valid for query, execute, sql, and scalar/);
const sdkCliTablesParamsFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "tables", "--params-file", "./missing-params.json", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliTablesParamsFile.stderr, /--params and --params-file are only valid for query, execute, sql, and scalar/);
const sdkCliSetupWrongCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "SELECT 1", "--setup-file", "./schema.sql", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliSetupWrongCommand.stderr, /--setup-sql, --setup-file, --setup-statements-file, and --setup-migrations-file are only valid for init and create-db/);
const sdkCliSetupDuplicate = await execFileAsync(process.execPath, ["icpdb-cli.js", "create-db", "--setup-file", "./schema.sql", "--setup-migrations-file", "./migrations.json", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliSetupDuplicate.stderr, /use only one of --setup-sql, --setup-file, --setup-statements-file, or --setup-migrations-file/);
const sdkCliSetupSqlEmpty = await execFileAsync(process.execPath, ["icpdb-cli.js", "create-db", "--setup-sql", "   ", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliSetupSqlEmpty.stderr, /setup SQL must be a non-empty string/);
const sdkCliGenerateIdentityWrongCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "SELECT 1", "--env-out", "service.env", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliGenerateIdentityWrongCommand.stderr, /--env-out, --identity-type, --canister-id, --database-id, --network-url, and --root-key are only valid for init, generate-identity, and provision-service/);
const sdkCliProvisionServiceMissingEnvOut = await execFileAsync(process.execPath, ["icpdb-cli.js", "provision-service", "db_alpha", "owner", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliProvisionServiceMissingEnvOut.stderr, /env output file must be a non-empty string/);
const sdkCliInitMissingEnvOut = await execFileAsync(process.execPath, ["icpdb-cli.js", "init", "--canister-id", "aaaaa-aa"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliInitMissingEnvOut.stderr, /init requires --env-out service\.env/);
const sdkCliInitWithDatabaseId = await execFileAsync(process.execPath, ["icpdb-cli.js", "init", "--canister-id", "aaaaa-aa", "--database-id", "db_alpha", "--env-out", "service.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliInitWithDatabaseId.stderr, /init creates a new database; omit --database-id/);
const sdkCliCheckEnvWrongCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "query", "SELECT 1", "--skip-call", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvWrongCommand.stderr, /--skip-call, --smoke-sql, --smoke-sdk, --smoke-archive-restore, --smoke-sdk-archive-restore, --smoke-shards, --smoke-sdk-shards, and --require-role are only valid for check-env/);
const sdkCliCheckEnvSkipSmoke = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--smoke-sql", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSkipSmoke.stderr, /--smoke-sql cannot be combined with --skip-call/);
const sdkCliCheckEnvSkipSdkSmoke = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--smoke-sdk", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSkipSdkSmoke.stderr, /--smoke-sdk cannot be combined with --skip-call/);
const sdkCliCheckEnvSkipArchive = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--smoke-archive-restore", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSkipArchive.stderr, /--smoke-archive-restore cannot be combined with --skip-call/);
const sdkCliCheckEnvSkipSdkArchive = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--smoke-sdk-archive-restore", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSkipSdkArchive.stderr, /--smoke-sdk-archive-restore cannot be combined with --skip-call/);
const sdkCliCheckEnvSkipShard = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--smoke-shards", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSkipShard.stderr, /--smoke-shards cannot be combined with --skip-call/);
const sdkCliCheckEnvSkipSdkShard = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--smoke-sdk-shards", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSkipSdkShard.stderr, /--smoke-sdk-shards cannot be combined with --skip-call/);
const sdkCliCheckEnvSkipRole = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--skip-call", "--require-role", "writer", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSkipRole.stderr, /--require-role cannot be combined with --skip-call/);
const sdkCliCheckEnvShardSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-shards", "--smoke-sql", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvShardSql.stderr, /--smoke-shards cannot be combined with --smoke-sql/);
const sdkCliCheckEnvShardSdk = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-shards", "--smoke-sdk", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvShardSdk.stderr, /--smoke-shards cannot be combined with --smoke-sdk/);
const sdkCliCheckEnvShardArchive = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-shards", "--smoke-archive-restore", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvShardArchive.stderr, /--smoke-shards cannot be combined with --smoke-archive-restore/);
const sdkCliCheckEnvShardSdkArchive = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-shards", "--smoke-sdk-archive-restore", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvShardSdkArchive.stderr, /--smoke-shards cannot be combined with --smoke-sdk-archive-restore/);
const sdkCliCheckEnvShardRole = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-shards", "--require-role", "writer", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvShardRole.stderr, /--smoke-shards cannot be combined with --require-role/);
const sdkCliCheckEnvSdkShardSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-sdk-shards", "--smoke-sql", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSdkShardSql.stderr, /--smoke-sdk-shards cannot be combined with --smoke-sql/);
const sdkCliCheckEnvSdkShardSdk = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-sdk-shards", "--smoke-sdk", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSdkShardSdk.stderr, /--smoke-sdk-shards cannot be combined with --smoke-sdk/);
const sdkCliCheckEnvSdkShardArchive = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-sdk-shards", "--smoke-archive-restore", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSdkShardArchive.stderr, /--smoke-sdk-shards cannot be combined with --smoke-archive-restore/);
const sdkCliCheckEnvSdkShardSdkArchive = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-sdk-shards", "--smoke-sdk-archive-restore", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSdkShardSdkArchive.stderr, /--smoke-sdk-shards cannot be combined with --smoke-sdk-archive-restore/);
const sdkCliCheckEnvSdkShardRole = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-sdk-shards", "--require-role", "writer", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvSdkShardRole.stderr, /--smoke-sdk-shards cannot be combined with --require-role/);
const sdkCliCheckEnvArchiveWithoutSql = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--smoke-archive-restore", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvArchiveWithoutSql.stderr, /--smoke-archive-restore requires --smoke-sql/);
const sdkCliCheckEnvBadRole = await execFileAsync(process.execPath, ["icpdb-cli.js", "check-env", "--require-role", "admin", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCheckEnvBadRole.stderr, /role must be reader, writer, or owner/);
const sdkCliGenerateIdentityBadType = await execFileAsync(process.execPath, ["icpdb-cli.js", "generate-identity", "--identity-type", "rsa"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliGenerateIdentityBadType.stderr, /--identity-type must be ed25519 or secp256k1/);
const sdkCliGenerateIdentityMissingCanister = await execFileAsync(process.execPath, ["icpdb-cli.js", "generate-identity", "--database-id", "db_alpha", "--format", "env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliGenerateIdentityMissingCanister.stderr, /ICPDB_CANISTER_ID is required when ICPDB_DATABASE_ID is set/);
const sdkCliSetupEmpty = await execFileAsync(process.execPath, ["icpdb-cli.js", "create-db", "--setup-file", "   ", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliSetupEmpty.stderr, /setup file must be a non-empty string/);
const sdkCliSetupStatementsEmpty = await execFileAsync(process.execPath, ["icpdb-cli.js", "create-db", "--setup-statements-file", "   ", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliSetupStatementsEmpty.stderr, /setup statements file must be a non-empty string/);
const sdkCliWriteWaitOptionsWithoutWait = await execFileAsync(process.execPath, ["icpdb-cli.js", "execute", "INSERT", "--interval-ms", "10", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliWriteWaitOptionsWithoutWait.stderr, /--reconcile-unknown, --interval-ms, and --timeout-ms are only valid for operation-wait or write commands with --wait/);
const sdkCliExecReadWait = await execFileAsync(process.execPath, ["icpdb-cli.js", "exec", "SELECT 1; SELECT 2", "--wait", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliExecReadWait.stderr, /--wait is only valid for write SQL/);
const sdkCliInvalidRole = await execFileAsync(process.execPath, ["icpdb-cli.js", "grant-member", "rrkah-fqaaa-aaaaa-aaaaq-cai", "admin", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliInvalidRole.stderr, /role must be reader, writer, or owner/);
const sdkCliAnonymousGrant = await execFileAsync(process.execPath, ["icpdb-cli.js", "grant-member", "2vxsx-fae", "reader", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliAnonymousGrant.stderr, /anonymous principal cannot be granted database access/);
const sdkCliWrongWaitCommand = await execFileAsync(process.execPath, ["icpdb-cli.js", "operation", "op_1", "--timeout-ms", "10"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliWrongWaitCommand.stderr, /--reconcile-unknown, --interval-ms, and --timeout-ms are only valid for operation-wait or write commands with --wait/);
const sdkCliDeleteWithoutConfirm = await execFileAsync(process.execPath, ["icpdb-cli.js", "delete-db", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliDeleteWithoutConfirm.stderr, /delete-db requires --confirm <database-id>/);
const sdkCliDumpMissingFile = await execFileAsync(process.execPath, ["icpdb-cli.js", "dump", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliDumpMissingFile.stderr, /missing SQL dump file/);
const sdkCliCreateWithExtraArg = await execFileAsync(process.execPath, ["icpdb-cli.js", "create-db", "extra", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliCreateWithExtraArg.stderr, /create-db accepts at most 0 positional arguments/);
const sdkCliPrincipalExtraArg = await execFileAsync(process.execPath, ["icpdb-cli.js", "principal", "extra", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliPrincipalExtraArg.stderr, /principal accepts at most 0 positional arguments/);
const sdkCliUrlExtraArg = await execFileAsync(process.execPath, ["icpdb-cli.js", "url", "extra", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliUrlExtraArg.stderr, /url accepts at most 0 positional arguments/);
const sdkCliDatabasesExtraArg = await execFileAsync(process.execPath, ["icpdb-cli.js", "databases", "extra", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliDatabasesExtraArg.stderr, /databases accepts at most 0 positional arguments/);
const sdkCliStatsExtraArg = await execFileAsync(process.execPath, ["icpdb-cli.js", "stats", "extra", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliStatsExtraArg.stderr, /stats accepts at most 0 positional arguments/);
const sdkCliShardMaintainBadNat = await execFileAsync(process.execPath, ["icpdb-cli.js", "shard-maintain", "1", "-1", "0", "0", "8", "0", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShardMaintainBadNat.stderr, /min cycles balance must be a non-negative integer/);
const sdkCliShardCreateBadMax = await execFileAsync(process.execPath, ["icpdb-cli.js", "shard-create", "1000", "65536", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShardCreateBadMax.stderr, /max databases must be an integer from 0 to 65535/);
const sdkCliShardTopUpEmptyCanister = await execFileAsync(process.execPath, ["icpdb-cli.js", "shard-top-up", "   ", "1000", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShardTopUpEmptyCanister.stderr, /missing database canister id/);
const sdkCliRemoteCreateEmptyDatabase = await execFileAsync(process.execPath, ["icpdb-cli.js", "remote-create-db", "   ", "aaaaa-aa", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliRemoteCreateEmptyDatabase.stderr, /missing database id/);
const sdkCliShardReconcileMissingReason = await execFileAsync(process.execPath, ["icpdb-cli.js", "shard-reconcile", "op_1", "failed", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShardReconcileMissingReason.stderr, /shard-reconcile failed requires a failure reason/);
const sdkCliShardReconcileAppliedReason = await execFileAsync(process.execPath, ["icpdb-cli.js", "shard-reconcile", "op_1", "applied", "not", "needed", "--service-env-file", "./missing.env"], { cwd: "dist-sdk" }).catch((error) => error);
assert.match(sdkCliShardReconcileAppliedReason.stderr, /shard-reconcile applied does not accept a failure reason/);

const typecheckDir = "dist-sdk/.artifact-typecheck";
await rm(typecheckDir, { recursive: true, force: true });
await mkdir(typecheckDir, { recursive: true });
await writeFile(`${typecheckDir}/check.ts`, `
import type { Identity } from "@icp-sdk/core/agent";
import {
  ICPDB_LIBSQL_ERROR_CODES,
  connectClient,
  connectDatabase,
  connectIcpdbDatabase,
  classifyLibsqlErrorMessage,
  createClient,
  createClientFromDatabase,
  createLibsqlClient,
  createTursoLikeClient,
  createDatabase,
  createIcpdbClient,
  createIcpdbDatabase,
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
  type CreateRemoteDatabaseRequest,
  type DatabaseArchiveInfo,
  type DatabaseBilling,
  type DatabaseColumn,
  type DatabaseForeignKey,
  type DatabaseInfo,
  type DatabaseIndex,
  type DatabaseMember,
  type DatabaseRole,
  type DatabaseSummary,
  type DatabaseTable,
  type DatabaseTrigger,
  type DatabaseUsage,
  type DatabaseUsageEventSummary,
  type BatchResult,
  type BatchStatement,
  type InArgs,
  type InStatement,
  type InValue,
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
  type IcpdbSqlClientInfo,
  type IcpdbSqlClientBatchOptionsObject,
  type IcpdbSqlClientBatchStatementObject,
  type IcpdbSqlClientResult,
  type IcpdbSqlClientStatement,
  type IcpdbSqlClientScriptOptionsObject,
  type IcpdbSqlDumpOptions,
  type IcpdbSqlTemplateStatement,
  type IcpdbWaitForRoutedOperationOptions,
  type ResultSet,
  type Row,
  type PreparedStatement,
  type Sql,
  type SqlExecuteResponse,
  type SqlStatement,
  type SqlValue,
  type Statement,
  type TableDescription,
  type TablePreviewResponse,
  type TransactionMode,
  type Value
} from "@icpdb/client";
import { createClient as createWebClient, createLibsqlClient as createWebLibsqlClient, createTursoLikeClient as createWebTursoLikeClient, type Client as WebClient } from "@icpdb/client/web";
import { createClient as createBrowserClient, createLibsqlClient as createBrowserLibsqlClient, createTursoLikeClient as createBrowserTursoLikeClient, type Client as BrowserClient } from "@icpdb/client/browser";
import { connectLibsqlClient, connectLibsqlDatabase, createClient as createLibsqlSubpathClient, createLibsqlClient as createLibsqlSubpathNamedClient, createLibsqlDatabase, createTursoLikeClient as createLibsqlTursoLikeClient, parseLibsqlDatabaseUrl, sql as libsqlSql, type Client as LibsqlClient, type Config as LibsqlConfig, type ConnectLibsqlClientOptions, type ConnectLibsqlDatabaseOptions, type CreateLibsqlDatabaseOptions, type LibsqlBatchResult, type LibsqlBatchStatement, type LibsqlClient as NamedLibsqlClient, type LibsqlConfig as NamedLibsqlConfig, type LibsqlDatabaseClient, type LibsqlResultSet as NamedLibsqlResultSet, type LibsqlRow, type LibsqlSql, type LibsqlValue, type ResultSet as LibsqlResultSet } from "@icpdb/client/libsql";
import { connectSqliteClient, connectSqliteDatabase, createSqliteClient as createSqliteSubpathClient, createSqliteDatabase, parseSqliteDatabaseUrl, sql as sqliteSql, type ConnectSqliteClientOptions, type ConnectSqliteDatabaseOptions, type CreateSqliteDatabaseOptions, type SqliteArgs, type SqliteBatchResult, type SqliteBatchStatement, type SqliteClient, type SqliteClientOptions as SqliteConfig, type SqliteDatabaseClient, type SqliteParsedDatabaseUrl, type SqlitePreparedStatement, type SqliteResultSet, type SqliteRow, type SqliteSql, type SqliteValue } from "@icpdb/client/sqlite";
import { connectClientFromEnvFile as connectNodeClientFromEnvFile, createClient as createNodeClient, createTursoLikeClient as createNodeTursoLikeClient, createClientFromEnvFile as createNodeClientFromEnvFile, inspectIcpdbServiceEnvFile as inspectNodeServiceEnvFile, type Client as NodeClient } from "@icpdb/client/node";
import { archiveDatabaseToFileFromEnvFile as archiveServerDatabaseToFileFromEnvFile, connectClientFromEnvFile as connectServerClientFromEnvFile, createClient as createServerClient, createTursoLikeClient as createServerTursoLikeClient, createClientFromEnvFile as createServerClientFromEnvFile, inspectIcpdbServiceEnvFile as inspectServerServiceEnvFile, restoreDatabaseFromFileFromEnvFile as restoreServerDatabaseFromFileFromEnvFile, snapshotInfoFile as serverSnapshotInfoFile, type Client as ServerClient } from "@icpdb/client/server";
import { archiveDatabaseToFile, archiveDatabaseToFileFromEnv, archiveDatabaseToFileFromEnvFile, connectClientFromEnv, connectClientFromEnvFile, connectDatabaseFromEnv, connectDatabaseFromEnvFile, connectIcpdbServiceDatabase, createClientFromEnv, createClientFromEnvFile, createDatabaseFromEnv, createDatabaseFromEnvFile, createIcpdbServiceClient, createIcpdbServiceClientFromEnv, createIcpdbServiceDatabase, createIcpdbServiceDatabaseFromEnv, createIcpdbServiceSqlClient, createIcpdbServiceSqlClientFromEnv, restoreDatabaseFromFile, restoreDatabaseFromFileFromEnv, restoreDatabaseFromFileFromEnvFile, snapshotInfoFile } from "@icpdb/client/service-identity";
import { checkIcpdbServiceEnvFileMode, createIcpdbPersistedServiceSqlClientFromEnvFile, createIcpdbServiceClientFromEnvFile, createIcpdbServiceSqlClientFromEnvFile, formatIcpdbServiceEnv, generateIcpdbServiceIdentity, inspectIcpdbServiceEnv, inspectIcpdbServiceEnvFile, loadIcpdbServiceEnvFile, loadIcpdbServiceSetupFromEnv, loadIcpdbServiceSetupFromEnvFile, persistIcpdbServiceDatabaseId, provisionIcpdbServiceDatabaseEnvFile, provisionIcpdbServiceEnvFile, provisionIcpdbServiceIdentity, writeGeneratedIcpdbServiceEnvFile, writeIcpdbServiceEnvFile, type IcpdbGeneratedServiceIdentityTargetOptions, type IcpdbServiceArchiveFileResult, type IcpdbServiceCreateDatabaseOptions, type IcpdbServiceEnvFileMode, type IcpdbServiceEnvInspection, type IcpdbServiceEnvSourceOptions, type IcpdbServiceRestoreFileFromEnvSourceOptions, type IcpdbServiceSnapshotFileInfo, type IcpdbServiceSqlClientOptions } from "@icpdb/client/service-identity";

export async function checkIcpdbClientTypes(identity: Identity): Promise<IcpdbRow | null> {
  const shortDb = await createDatabase({ canisterId: "aaaaa-aa", identity });
  // @ts-expect-error createDatabase creates a new database; connectDatabase handles existing database ids
  const invalidCreateOptions: IcpdbCreateDatabaseOptions = { canisterId: "aaaaa-aa", databaseId: "db_existing", identity };
  invalidCreateOptions.canisterId?.toString();
  // @ts-expect-error connectDatabase connects existing DBs; pass databaseId, connectionUrl, or a DB URL
  const invalidConnectDatabaseOptions: IcpdbConnectSqlClientOptions = { canisterId: "aaaaa-aa", identity };
  invalidConnectDatabaseOptions.canisterId?.toString();
  // @ts-expect-error databaseId alone is not enough; connectDatabase also needs canisterId, connectionUrl, or a DB URL
  const invalidConnectDatabaseIdOnlyOptions: IcpdbConnectSqlClientOptions = { databaseId: "db_alpha", identity };
  invalidConnectDatabaseIdOnlyOptions.databaseId?.toString();
  const shortConnectedDb = await connectDatabase({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const db = await connectIcpdbDatabase({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const lowLevelClient: IcpdbClient = createIcpdbClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const lowLevelConnectionUrlClient: IcpdbClient = createIcpdbClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity });
  const explicitCreatedDb = await createIcpdbDatabase({
    canisterId: "aaaaa-aa",
    identity,
    setupSql: "CREATE TABLE package_setup(id INTEGER);",
    setupStatements: [{ sql: "INSERT INTO package_setup(id) VALUES (:id)", args: { id: 1 } }],
    setupMigrations: [{ version: "setup-001", name: "create_package_setup_migrated", sql: "CREATE TABLE package_setup_migrated(id INTEGER);" }]
  });
  await shortDb.queryRows("SELECT 1");
  await shortConnectedDb.queryOne("SELECT 1");
  const directDbInfo: IcpdbSqlClientInfo = shortConnectedDb.info();
  directDbInfo.canisterId?.toString();
  directDbInfo.connectionUrl.toString();
  const setupSqlClient: IcpdbSqlClient = createClient({
    canisterId: "aaaaa-aa",
    identity,
    setupSql: "CREATE TABLE package_client_setup(id INTEGER);",
    setupStatements: [["INSERT INTO package_client_setup(id) VALUES (?1)", [1]], sql\`INSERT INTO package_client_setup(id) VALUES (\${2})\`],
    setupMigrations: [{ version: "client-setup-001", sql: "CREATE TABLE package_client_setup_migrated(id INTEGER);" }]
  });
  const setupUrlClient: IcpdbSqlClient = createClient({
    url: formatIcpdbCanisterUrl("aaaaa-aa"),
    identity,
    setupSql: "CREATE TABLE package_url_setup(id INTEGER);"
  });
  const libsqlShapedConfig: Config = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const libsqlSubpathConfig: LibsqlConfig = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const namedLibsqlSubpathConfig: NamedLibsqlConfig = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const connectLibsqlSubpathConfig: ConnectLibsqlClientOptions = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  // @ts-expect-error connectLibsqlDatabase connects existing DBs; pass databaseId, connectionUrl, or a DB URL
  const invalidConnectLibsqlDatabaseSubpathConfig: ConnectLibsqlDatabaseOptions = { canisterId: "aaaaa-aa", identity };
  invalidConnectLibsqlDatabaseSubpathConfig.canisterId?.toString();
  // @ts-expect-error databaseId alone is not enough; libSQL-shaped connect also needs canisterId, connectionUrl, or a DB URL
  const invalidConnectLibsqlDatabaseIdOnlySubpathConfig: ConnectLibsqlDatabaseOptions = { databaseId: "db_alpha", identity };
  invalidConnectLibsqlDatabaseIdOnlySubpathConfig.databaseId?.toString();
  const connectLibsqlDatabaseSubpathConfig: ConnectLibsqlDatabaseOptions = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const createLibsqlDatabaseSubpathConfig: CreateLibsqlDatabaseOptions = { canisterId: "aaaaa-aa", identity };
  const sqliteSubpathConfig: SqliteConfig = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const sqliteConnectSubpathConfig: ConnectSqliteClientOptions = { url: "icpdb://aaaaa-aa/db_alpha", identity };
  const sqliteDirectCreateConfig: CreateSqliteDatabaseOptions = { canisterId: "aaaaa-aa", identity };
  // @ts-expect-error connectSqliteDatabase connects existing DBs; pass databaseId, connectionUrl, or a DB URL
  const invalidSqliteDirectConnectConfig: ConnectSqliteDatabaseOptions = { canisterId: "aaaaa-aa", identity };
  invalidSqliteDirectConnectConfig.canisterId?.toString();
  // @ts-expect-error databaseId alone is not enough; SQLite connect also needs canisterId, connectionUrl, or a DB URL
  const invalidSqliteDirectConnectIdOnlyConfig: ConnectSqliteDatabaseOptions = { databaseId: "db_alpha", identity };
  invalidSqliteDirectConnectIdOnlyConfig.databaseId?.toString();
  const sqliteDirectConnectConfig: ConnectSqliteDatabaseOptions = { canisterId: "aaaaa-aa", databaseId: "db_alpha", identity };
  const connectionUrlConfig: Config = { connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity };
  const sdkSqlError = new LibsqlError("UNIQUE constraint failed", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT");
  const sdkBatchError = new LibsqlBatchError("read batch mode only accepts read SQL", 1, "SQLITE_READONLY");
  const sdkSqlErrorCode: IcpdbLibsqlErrorCode = sdkSqlError.code;
  const sdkBatchStatementIndex: number = sdkBatchError.statementIndex;
  const sdkSqlErrorClassification: IcpdbLibsqlErrorClassification = classifyLibsqlErrorMessage("UNIQUE constraint failed");
  const sdkSqlClassifiedCode: IcpdbLibsqlErrorCode = sdkSqlErrorClassification.code;
  const sdkSqlKnownCode: IcpdbLibsqlErrorCode | undefined = ICPDB_LIBSQL_ERROR_CODES[0];
  const sdkSqlErrorIsLibsql: boolean = isLibsqlError(sdkSqlError);
  const sdkBatchErrorIsLibsqlBatch: boolean = isLibsqlBatchError(sdkBatchError);
  const sdkSqlCodeIsKnown: boolean = isIcpdbLibsqlErrorCode(sdkSqlError.code);
  const typedRole: DatabaseRole = "owner";
  const typedSqlValue: SqlValue = { kind: "text", value: "typed" };
  const typedSqlStatement: SqlStatement = { sql: "SELECT ?1 AS value", params: [typedSqlValue] };
  typedRole.toString();
  typedSqlStatement.sql.toString();
  sdkSqlErrorCode.toString();
  sdkBatchStatementIndex.toString();
  sdkSqlErrorClassification.code.toString();
  sdkSqlClassifiedCode.toString();
  sdkSqlKnownCode?.toString();
  sdkSqlErrorIsLibsql.toString();
  sdkBatchErrorIsLibsqlBatch.toString();
  sdkSqlCodeIsKnown.toString();
  namedLibsqlSubpathConfig.url?.toString();
  const urlClient: IcpdbSqlClient = createClient({ url: "icpdb://aaaaa-aa/db_alpha", identity });
  const connectionUrlClient: IcpdbSqlClient = createClient(connectionUrlConfig);
  const tursoLikeClient: IcpdbSqlClient = createTursoLikeClient({ url: "icpdb://aaaaa-aa/db_alpha", identity });
  const rootLibsqlClient: IcpdbSqlClient = createLibsqlClient({ url: "icpdb://aaaaa-aa/db_alpha", identity });
  const libsqlShapedClient: Client = createTursoLikeClient(libsqlShapedConfig);
  const webClient: WebClient = createWebClient(libsqlShapedConfig);
  const webLibsqlClient: WebClient = createWebLibsqlClient(libsqlShapedConfig);
  const webTursoLikeClient: WebClient = createWebTursoLikeClient(libsqlShapedConfig);
  const browserClient: BrowserClient = createBrowserClient(libsqlShapedConfig);
  const browserLibsqlClient: BrowserClient = createBrowserLibsqlClient(libsqlShapedConfig);
  const browserTursoLikeClient: BrowserClient = createBrowserTursoLikeClient(libsqlShapedConfig);
  const libsqlClient: LibsqlClient = createLibsqlSubpathClient(libsqlSubpathConfig);
  const libsqlNamedClient: LibsqlClient = createLibsqlSubpathNamedClient(libsqlSubpathConfig);
  const libsqlTursoLikeClient: LibsqlClient = createLibsqlTursoLikeClient(libsqlSubpathConfig);
  const namedLibsqlClient: NamedLibsqlClient = connectLibsqlClient(connectLibsqlSubpathConfig);
  const libsqlConnectedDb: LibsqlDatabaseClient = await connectLibsqlDatabase(connectLibsqlDatabaseSubpathConfig);
  const libsqlCreatedDb: LibsqlDatabaseClient = await createLibsqlDatabase(createLibsqlDatabaseSubpathConfig);
  const sqliteClient: SqliteClient = createSqliteSubpathClient(sqliteSubpathConfig);
  const connectedSqliteClient: SqliteClient = connectSqliteClient(sqliteConnectSubpathConfig);
  const sqliteCreatedDb: SqliteDatabaseClient = await createSqliteDatabase(sqliteDirectCreateConfig);
  const sqliteConnectedDb: SqliteDatabaseClient = await connectSqliteDatabase(sqliteDirectConnectConfig);
  const sqliteParsedUrl: SqliteParsedDatabaseUrl = parseSqliteDatabaseUrl("icpdb://aaaaa-aa/db_alpha");
  const sqliteArgs: SqliteArgs = { value: "typed-sqlite-args" };
  const sqliteBatchStatement: SqliteBatchStatement = { sql: "SELECT :value AS value", args: sqliteArgs };
  const sqliteSqlTag: SqliteSql = sqliteSql;
  const libsqlResult: LibsqlResultSet = await libsqlClient.execute(libsqlSql\`SELECT \${"typed-libsql-subpath"} AS value\`);
  const libsqlNamedResult: LibsqlResultSet = await libsqlNamedClient.execute({ sql: "SELECT :value AS value", args: { value: "typed-libsql-named-subpath" } });
  const namedLibsqlStatement: LibsqlBatchStatement = { sql: "SELECT :value AS value", args: { value: "typed-named-libsql-subpath" } };
  const namedLibsqlResult: NamedLibsqlResultSet = await namedLibsqlClient.execute(namedLibsqlStatement);
  const namedLibsqlBatchResult: LibsqlBatchResult = await namedLibsqlClient.batch([namedLibsqlStatement], "read");
  const namedLibsqlSql: LibsqlSql = libsqlSql;
  await libsqlConnectedDb.query("SELECT 1 AS value");
  await libsqlCreatedDb.query("SELECT 1 AS value");
  const sqliteResult: SqliteResultSet = await sqliteClient.execute(sqliteSql\`SELECT \${"typed-sqlite-subpath"} AS value\`);
  const sqliteBatchResult: SqliteBatchResult = await sqliteClient.batch([sqliteBatchStatement], "read");
  const sqliteRows: SqliteRow[] = sqliteResult.rows;
  const sqliteValue: SqliteValue | undefined = sqliteRows[0]?.value;
  const sqlitePrepared: SqlitePreparedStatement = sqliteClient.prepare(sqliteSqlTag\`SELECT \${"typed-sqlite-prepared"} AS value\`);
  await sqliteCreatedDb.queryRows("SELECT 1");
  await sqliteConnectedDb.queryOne("SELECT 1");
  await sqlitePrepared.get();
  await connectedSqliteClient.query("SELECT 1");
  sqliteParsedUrl.databaseId?.toString();
  sqliteBatchResult[0]?.columns[0]?.toString();
  sqliteValue?.valueOf();
  const nodeClient: NodeClient = createNodeClient(libsqlShapedConfig);
  const nodeTursoLikeClient: NodeClient = createNodeTursoLikeClient(libsqlShapedConfig);
  const nodeFileSqlClient: IcpdbSqlClient = await createNodeClientFromEnvFile("./service.env");
  const nodeConnectedFileSqlClient: IcpdbSqlClient = await connectNodeClientFromEnvFile("./service.env");
  const nodeServiceInspection: IcpdbServiceEnvInspection = await inspectNodeServiceEnvFile("./service.env");
  const serverClient: ServerClient = createServerClient(libsqlShapedConfig);
  const serverTursoLikeClient: ServerClient = createServerTursoLikeClient(libsqlShapedConfig);
  const serverFileSqlClient: IcpdbSqlClient = await createServerClientFromEnvFile("./service.env");
  const serverConnectedFileSqlClient: IcpdbSqlClient = await connectServerClientFromEnvFile("./service.env");
  const serverServiceInspection: IcpdbServiceEnvInspection = await inspectServerServiceEnvFile("./service.env");
  const serverArchiveInfo: IcpdbServiceArchiveFileResult = await archiveServerDatabaseToFileFromEnvFile("./server-backup.sqlite");
  const serverSnapshotInfo: IcpdbServiceSnapshotFileInfo = await serverSnapshotInfoFile("./server-backup.sqlite");
  await restoreServerDatabaseFromFileFromEnvFile("./server-backup.sqlite", { expectedSha256: serverSnapshotInfo.sha256 });
  serverArchiveInfo.sha256.toString();
  webClient.close();
  webLibsqlClient.close();
  webTursoLikeClient.close();
  browserClient.close();
  browserLibsqlClient.close();
  browserTursoLikeClient.close();
  libsqlClient.close();
  libsqlTursoLikeClient.close();
  libsqlResult.columns[0]?.toString();
  namedLibsqlBatchResult[0]?.columns[0]?.toString();
  await namedLibsqlClient.execute(namedLibsqlSql\`SELECT \${"typed-libsql-template"} AS value\`);
  namedLibsqlClient.close();
  sqliteClient.close();
  sqliteResult.columns[0]?.toString();
  nodeClient.close();
  nodeTursoLikeClient.close();
  nodeFileSqlClient.close();
  nodeServiceInspection.principal.toString();
  serverClient.close();
  serverTursoLikeClient.close();
  serverFileSqlClient.close();
  serverServiceInspection.principal.toString();
  const libsqlShapedMode: TransactionMode = "write";
  const libsqlShapedArgs: InArgs = { id: 1 };
  const libsqlShapedInput: InValue = true;
  const libsqlShapedDateInput: InValue = new Date("2026-05-29T00:00:00.000Z");
  const libsqlShapedStatement: InStatement = { sql: "SELECT :id AS id", args: libsqlShapedArgs };
  const libsqlAliasSql: Sql = sql;
  const libsqlAliasStatement: Statement = { sql: "SELECT ?1 AS id", args: [1] };
  const libsqlAliasBatchStatement: BatchStatement = ["SELECT ?1 AS id", [1]];
  const client: IcpdbSqlClient = createClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  // @ts-expect-error createClient setup creates a new database; existing database setup uses exec, batch, or migrate
  const invalidCreateClientSetupOptions: Config = { canisterId: "aaaaa-aa", databaseId: "db_existing", identity, setupSql: "CREATE TABLE invalid_existing_setup(id INTEGER);" };
  invalidCreateClientSetupOptions.canisterId?.toString();
  // @ts-expect-error connectClient connects an existing DB and cannot run setup.
  const invalidConnectClientSetupOptions: IcpdbConnectSqlClientOptions = { connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity, setupSql: "CREATE TABLE invalid_connect_setup(id INTEGER);" };
  invalidConnectClientSetupOptions.connectionUrl?.toString();
  const formattedCreateUrl: string = formatIcpdbCanisterUrl("aaaaa-aa");
  const setupConnectionUrlClient: IcpdbSqlClient = createClient({ connectionUrl: formattedCreateUrl, identity, setupSql: "CREATE TABLE package_connection_url_setup(id INTEGER);" });
  const formattedConnectionUrl: string = formatIcpdbDatabaseUrl("aaaaa-aa", "db_alpha");
  const connectedSqlClient: IcpdbSqlClient = connectClient({ connectionUrl: formattedConnectionUrl, identity });
  const lowLevelConnectionUrl: string = lowLevelClient.connectionUrl();
  const lowLevelConnectionUrlOption: string = lowLevelConnectionUrlClient.connectionUrl();
  const lowLevelUrl: string = lowLevelClient.url();
  const optionConnectionUrl: string = await connectionUrlClient.connectionUrl();
  const connectedSqlClientUrl: string = await connectedSqlClient.connectionUrl();
  const sqlClientPrincipal: string = await client.principal();
  const sqlClientInfo: IcpdbSqlClientInfo = await client.info();
  sqlClientInfo.canisterId?.toString();
  sqlClientInfo.connectionUrl.toString();
  sqlClientInfo.url.toString();
  connectedSqlClientUrl.toString();
  sqlClientInfo.principal?.toString();
  await setupUrlClient.databaseId();
  await setupConnectionUrlClient.databaseId();
  lowLevelConnectionUrlOption.toString();
  optionConnectionUrl.toString();
  const packageSnapshotInfo: IcpdbSnapshotInfo = await snapshotInfo(new Uint8Array([1, 2, 3]));
  packageSnapshotInfo.sha256.toString();
  packageSnapshotInfo.snapshotHash.join(",");
  const lowLevelSnapshotInfo: IcpdbSnapshotInfo = await lowLevelClient.snapshotInfo(new Uint8Array([1, 2, 3]));
  lowLevelSnapshotInfo.sha256.toString();
  const lowLevelCreateSetup: IcpdbCreateSetupOptions = {
    setupSql: "CREATE TABLE low_level_created(id INTEGER PRIMARY KEY, body TEXT)",
    setupStatements: [{ sql: "INSERT INTO low_level_created(body) VALUES (:body)", args: { body: "from-low-level-create" } }]
  };
  // @ts-expect-error low-level create setup always creates a new database
  const invalidLowLevelCreateSetup: IcpdbCreateSetupOptions = { databaseId: "db_existing" };
  invalidLowLevelCreateSetup.setupSql?.toString();
  const lowLevelCreatedDb: IcpdbDatabaseClient = await lowLevelClient.createDatabase(lowLevelCreateSetup);
  await lowLevelCreatedDb.queryRows("SELECT body FROM low_level_created ORDER BY id DESC");
  const dbConnectionUrl: string = db.connectionUrl();
  const dbUrl: string = db.url();
  const dbSnapshotInfo: IcpdbSnapshotInfo = await db.snapshotInfo(new Uint8Array([1, 2, 3]));
  dbSnapshotInfo.snapshotHash.join(",");
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
  await minimalSqlClient.query("SELECT 1");
  await minimalSqlClient.values("SELECT 1");
  await minimalSqlClient.run("INSERT INTO notes(id) VALUES (1)");
  await minimalSqlClient.prepare("SELECT 1").get();
  await minimalSqlClient.prepare("INSERT INTO notes(id) VALUES (1)").run();
  await minimalSqlClient.batch(["SELECT count(*) AS total FROM notes"], { mode: "read", maxRows: 1 });
  await minimalSqlClient.transaction(["SELECT count(*) AS total FROM notes"], { mode: "read", maxRows: 1 });
  // @ts-expect-error SQL client batch options choose the DB at the client or database handle
  const invalidSqlClientBatchOptions: IcpdbSqlClientBatchOptionsObject = { mode: "write", databaseId: "db_other" };
  invalidSqlClientBatchOptions.mode?.toString();
  // @ts-expect-error SQL client script options choose the DB at the client or database handle
  const invalidSqlClientScriptOptions: IcpdbSqlClientScriptOptionsObject = { databaseId: "db_other" };
  invalidSqlClientScriptOptions.maxRows?.toFixed();
  const typedBatchStatement: IcpdbSqlClientBatchStatementObject = { sql: "INSERT INTO notes(id) VALUES (?1)", args: [7] };
  await batchedSqlClient.batch([typedBatchStatement], "write");
  // @ts-expect-error per-statement idempotencyKey belongs on batch options
  const invalidBatchRetryStatement: IcpdbSqlClientBatchStatementObject = { sql: "INSERT INTO notes(id) VALUES (8)", idempotencyKey: "retry" };
  // @ts-expect-error per-statement maxRows belongs on batch options
  const invalidBatchMaxRowsStatement: IcpdbSqlClientBatchStatementObject = { sql: "SELECT 1", maxRows: 1 };
  // @ts-expect-error per-statement databaseId belongs on the client/database or low-level batch options
  const invalidBatchDatabaseStatement: IcpdbSqlClientBatchStatementObject = { sql: "INSERT INTO notes(id) VALUES (9)", databaseId: "db_other" };
  invalidBatchRetryStatement.sql.toString();
  invalidBatchMaxRowsStatement.sql.toString();
  invalidBatchDatabaseStatement.sql.toString();
  await minimalSqlClient.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await minimalSqlClient.exec("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await minimalSqlClient.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await batchedSqlClient.batch(["INSERT INTO notes(id) VALUES (1)"], "write");
  await batchedSqlClient.transaction(["INSERT INTO notes(id) VALUES (1)"], "write");
  await batchedSqlClient.executeScript("INSERT INTO notes(id) VALUES (1);");
  await batchedSqlClient.exec("INSERT INTO notes(id) VALUES (1);");
  const lowLevelHealth: CanisterHealth = await lowLevelClient.health();
  const waitOptions: IcpdbWaitForRoutedOperationOptions = { intervalMs: 250, timeoutMs: 5000, reconcileUnknown: true };
  // @ts-expect-error routed wait options choose the DB at the client, low-level wait argument, or database handle
  const invalidWaitOptions: IcpdbWaitForRoutedOperationOptions = { databaseId: "db_other" };
  invalidWaitOptions.intervalMs?.toFixed();
  parseIcpdbDatabaseUrl(formattedCreateUrl).canisterId.toString();
  parseIcpdbDatabaseUrl("icpdb://aaaaa-aa/db_alpha").databaseId?.toString();
  const serviceClient: IcpdbSqlClient = await createIcpdbServiceSqlClientFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  const shortServiceClient: IcpdbSqlClient = await createClientFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  const shortConnectedServiceClient: IcpdbSqlClient = await connectClientFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  await shortConnectedServiceClient.databaseId();
  const serviceLowLevelClient: IcpdbClient = await createIcpdbServiceClientFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  const serviceCreatedDb = await createIcpdbServiceDatabaseFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_PEM: "unused",
    ICPDB_SETUP_SQL: "CREATE TABLE service_created_setup(id INTEGER);",
    ICPDB_SETUP_STATEMENTS: "[[\\\"INSERT INTO service_created_setup(id) VALUES (?1)\\\",[1]]]",
    ICPDB_SETUP_MIGRATIONS: "[{\\"version\\":\\"service-created-001\\",\\"name\\":\\"create_service_created_migrated\\",\\"sql\\":\\"CREATE TABLE service_created_migrated(id INTEGER);\\"}]"
  });
  const shortServiceCreatedDb: IcpdbDatabaseClient = await createDatabaseFromEnv({
    ICPDB_CANISTER_ID: "aaaaa-aa",
    ICPDB_IDENTITY_PEM: "unused"
  });
  const shortServiceConnectedDb: IcpdbDatabaseClient = await connectDatabaseFromEnv({
    ICPDB_URL: "icpdb://aaaaa-aa/db_alpha",
    ICPDB_IDENTITY_PEM: "unused"
  });
  const serviceFileClient: IcpdbSqlClient = await createIcpdbServiceSqlClientFromEnvFile("./service.env");
  const shortServiceFileClient: IcpdbSqlClient = await createClientFromEnvFile("./service.env");
  const shortConnectedServiceFileClient: IcpdbSqlClient = await connectClientFromEnvFile("./service.env");
  await shortConnectedServiceFileClient.databaseId();
  const defaultShortConnectedServiceFileClient: Promise<IcpdbSqlClient> = connectClientFromEnvFile();
  defaultShortConnectedServiceFileClient.catch(() => undefined);
  const shortServiceFileDb: IcpdbDatabaseClient = await connectDatabaseFromEnvFile("./service.env");
  const shortServiceCreatedFileDb: IcpdbDatabaseClient = await createDatabaseFromEnvFile("./service-create.env");
  const shortServiceArchiveFile: IcpdbServiceArchiveFileResult = await archiveDatabaseToFile(shortServiceFileDb, "./backup-short.sqlite");
  const shortServiceSnapshotFile: IcpdbServiceSnapshotFileInfo = await snapshotInfoFile("./backup-short.sqlite");
  await restoreDatabaseFromFile(shortServiceFileDb, "./backup-short.sqlite", { expectedSha256: shortServiceSnapshotFile.sha256 });
  const envObjectArchiveOptions: IcpdbServiceEnvSourceOptions = { env: process.env };
  const envObjectRestoreOptions: IcpdbServiceRestoreFileFromEnvSourceOptions = { env: process.env, expectedSha256: shortServiceArchiveFile.sha256 };
  await archiveDatabaseToFileFromEnv("./backup-from-process-env.sqlite", envObjectArchiveOptions);
  await restoreDatabaseFromFileFromEnv("./backup-from-process-env.sqlite", envObjectRestoreOptions);
  await archiveDatabaseToFileFromEnvFile("./backup-from-short-env.sqlite");
  await restoreDatabaseFromFileFromEnvFile("./backup-from-short-env.sqlite", { expectedSha256: shortServiceArchiveFile.sha256 });
  const persistedServiceFileClient: IcpdbSqlClient = await createIcpdbPersistedServiceSqlClientFromEnvFile("./service.env");
  const serviceFileLowLevelClient: IcpdbClient = await createIcpdbServiceClientFromEnvFile("./service.env");
  const serviceEnvFileMode: IcpdbServiceEnvFileMode = await checkIcpdbServiceEnvFileMode("./service.env");
  const defaultServiceEnvFileMode: Promise<IcpdbServiceEnvFileMode> = checkIcpdbServiceEnvFileMode();
  defaultServiceEnvFileMode.catch(() => undefined);
  serviceEnvFileMode.modeOctal.toString();
  const serviceEnv = await loadIcpdbServiceEnvFile("./service.env");
  const defaultServiceEnv: Promise<Record<string, string>> = loadIcpdbServiceEnvFile();
  defaultServiceEnv.catch(() => undefined);
  await loadIcpdbServiceSetupFromEnvFile("./service.env");
  const inspectedServiceEnv: IcpdbServiceEnvInspection = await inspectIcpdbServiceEnvFile("./service.env");
  inspectedServiceEnv.principal.toString();
  inspectedServiceEnv.hasDatabase.valueOf();
  inspectedServiceEnv.connectionUrl?.toString();
  const inspectedInlineEnv: IcpdbServiceEnvInspection = await inspectIcpdbServiceEnv({ ICPDB_URL: "icpdb://aaaaa-aa/db_alpha", ICPDB_IDENTITY_PEM: "unused", ICPDB_SETUP_SQL: "CREATE TABLE inspect_package(id INTEGER);" });
  inspectedInlineEnv.hasDatabase.valueOf();
  inspectedInlineEnv.setupStatementCount.toString();
  await loadIcpdbServiceSetupFromEnv({ ICPDB_SETUP_SQL_FILE: "./schema.sql", ICPDB_SETUP_STATEMENTS_FILE: "./statements.json", ICPDB_SETUP_MIGRATIONS_FILE: "./migrations.json" });
  const targetOptions: IcpdbGeneratedServiceIdentityTargetOptions = { canisterId: "aaaaa-aa", databaseId: "db_alpha", networkUrl: "https://icp-api.io" };
  const generated = generateIcpdbServiceIdentity("ed25519", targetOptions);
  generated.principal.toString();
  await writeGeneratedIcpdbServiceEnvFile("./generated-service.env", "secp256k1", targetOptions);
  await provisionIcpdbServiceIdentity({ grantMember: async (_principal, _role) => {} }, "writer", "ed25519");
  await provisionIcpdbServiceEnvFile({ databaseId: "db_alpha", connectionUrl: () => "icpdb://aaaaa-aa/db_alpha", grantMember: async (_principal, _role) => {} }, "./generated-service.env", "writer", "ed25519");
  const directServiceCreateOptions: IcpdbServiceCreateDatabaseOptions = { canisterId: "aaaaa-aa", identityJson: "[]", setupSql: "CREATE TABLE service_direct_create(id INTEGER);" };
  const directServiceConnectionUrlCreateOptions: IcpdbServiceCreateDatabaseOptions = { connectionUrl: "icpdb://aaaaa-aa", identityJson: "[]", setupSql: "CREATE TABLE service_direct_connection_url_create(id INTEGER);" };
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
  await shortServiceCreatedDb.schema();
  await shortServiceConnectedDb.schema();
  await shortServiceFileDb.schema();
  await shortServiceCreatedFileDb.schema();
  await provisionIcpdbServiceDatabaseEnvFile({ canisterId: "aaaaa-aa", identityJson: "[]", setupSql: "CREATE TABLE service_bootstrap(id INTEGER);" }, "./generated-service-db.env", "writer", "ed25519");
  await writeIcpdbServiceEnvFile("./service.env", serviceEnv);
  await persistIcpdbServiceDatabaseId("./service.env", "db_alpha");
  formatIcpdbServiceEnv({ ICPDB_DATABASE_ID: "db_alpha" }).toString();
  const result = await client.execute({ sql: "SELECT ?1 AS value", args: [1] });
  const tursoLikeResult: IcpdbResultSet = await tursoLikeClient.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [1] });
  const rootLibsqlResult: IcpdbResultSet = await rootLibsqlClient.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [1] });
  const libsqlShapedResult: ResultSet = await libsqlShapedClient.execute(libsqlShapedStatement);
  const webLibsqlResult: ResultSet = await webLibsqlClient.execute(libsqlShapedStatement);
  const libsqlAliasResult: ResultSet = await libsqlShapedClient.execute(libsqlAliasStatement);
  const libsqlAliasBatchResult: BatchResult = await libsqlShapedClient.batch([libsqlAliasBatchStatement], "read");
  const libsqlAliasPrepared: PreparedStatement = libsqlShapedClient.prepare(libsqlAliasBatchStatement);
  const libsqlShapedRow: Row | undefined = libsqlShapedResult.rows[0];
  const rootLibsqlRow: Row | undefined = rootLibsqlResult.rows[0];
  const webLibsqlRow: Row | undefined = webLibsqlResult.rows[0];
  const libsqlNamedRow: Row | undefined = libsqlNamedResult.rows[0];
  const namedLibsqlRow: LibsqlRow | undefined = namedLibsqlResult.rows[0];
  const libsqlShapedValue: Value = libsqlShapedRow?.id ?? null;
  const rootLibsqlValue: Value = rootLibsqlRow?.id ?? null;
  const webLibsqlValue: Value = webLibsqlRow?.id ?? null;
  const libsqlNamedValue: Value = libsqlNamedRow?.value ?? null;
  const namedLibsqlValue: LibsqlValue | undefined = namedLibsqlRow?.value ?? namedLibsqlRow?.[0];
  const parsedLibsqlUrl = parseLibsqlDatabaseUrl("icpdb://aaaaa-aa/db_alpha");
  const libsqlShapedIndexedValue: Value | undefined = libsqlShapedRow?.[0];
  const libsqlShapedLength: number | undefined = libsqlShapedRow?.length;
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
  tursoLikeResult.rows.join(",");
  libsqlAliasResult.rows.join(",");
  libsqlAliasBatchResult.length.toString();
  namedLibsqlValue?.valueOf();
  parsedLibsqlUrl.databaseId?.toString();
  libsqlAliasPrepared.sql.toString();
  String(libsqlShapedInput);
  libsqlShapedDateInput.toISOString();
  libsqlShapedValue?.toString();
  rootLibsqlValue?.toString();
  webLibsqlValue?.toString();
  libsqlNamedValue?.toString();
  await db.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  await db.execute({ sql: "INSERT INTO notes(id) VALUES (?1)", args: [5], idempotencyKey: "sdk_retry_insert_1" });
  await db.execute({ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 3 } });
  await db.execute({ sql: "SELECT :enabled AS enabled", args: { enabled: true } });
  await db.execute({ sql: "SELECT :created_at AS created_at", args: { created_at: new Date("2026-05-29T00:00:00.000Z") } });
  await db.execute({ sql: "SELECT :payload AS payload", args: { payload: new ArrayBuffer(2) } });
  await db.execute({ sql: "SELECT :payload AS payload", args: { payload: new DataView(new ArrayBuffer(2)) } });
  await db.execute({ sql: "INSERT INTO notes(id) VALUES (:id)", params: { id: 2 } });
  await db.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 4 } }]);
  await db.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 5 } }], { idempotencyKey: "sdk_retry_batch_1" });
  await db.transaction([{ sql: "INSERT INTO notes(body) VALUES (:body)", args: { body: "from-direct-transaction" } }], { mode: "write", idempotencyKey: "sdk_retry_transaction_1" });
  await db.transaction([{ sql: "SELECT count(*) AS total FROM notes" }], "read");
  await db.get("SELECT id FROM notes WHERE id = :id", { id: 2 });
  const directPrepared: IcpdbPreparedStatement = db.prepare("SELECT ?1 AS value");
  await directPrepared.get([1]);
  await db.prepare(sql\`SELECT \${1} AS value\`).get();
  await db.prepare({ sql: "SELECT :value AS value", params: { value: 1 } }).get();
  await db.prepare(["SELECT ?1 AS value", [1]]).get();
  await db.prepare("INSERT INTO notes(id) VALUES (?1)", [6]).run();
  await db.executeMultiple("CREATE TABLE direct_multiple(id INTEGER); INSERT INTO direct_multiple(id) VALUES (1);");
  await db.executeMultiple("INSERT INTO direct_multiple(id) VALUES (2);", { idempotencyKey: "sdk_retry_direct_multiple_1" });
  await db.executeScript("CREATE TABLE direct_script(id INTEGER);", { idempotencyKey: "sdk_retry_direct_script_1" });
  await db.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await db.loadSqlDump("CREATE TABLE direct_dump(id INTEGER);", { idempotencyKey: "sdk_retry_direct_load_1" });
  await db.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await db.migrate([{ version: "direct-001", sql: "CREATE TABLE direct_migrated(id INTEGER);" }]);
  await db.get("SELECT id FROM notes WHERE id = ?1", [1]);
  await db.all("SELECT id FROM notes");
  await db.listTables();
  await db.tables();
  await db.views();
  await db.describeTable("notes");
  await db.describe("notes");
  await db.previewTable("notes", { limit: 10 });
  await db.preview("notes", { limit: 10 });
  await lowLevelClient.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  await lowLevelClient.execute({ sql: "INSERT INTO notes(id) VALUES (?1)", args: [5], idempotencyKey: "sdk_retry_insert_2" });
  await lowLevelClient.execute({ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 3 } });
  await lowLevelClient.execute({ sql: "SELECT :enabled AS enabled", args: { enabled: true } });
  await lowLevelClient.execute({ sql: "SELECT :created_at AS created_at", args: { created_at: new Date("2026-05-29T00:00:00.000Z") } });
  await lowLevelClient.execute({ sql: "SELECT :payload AS payload", args: { payload: new ArrayBuffer(2) } });
  await lowLevelClient.execute({ sql: "SELECT :payload AS payload", args: { payload: new DataView(new ArrayBuffer(2)) } });
  await lowLevelClient.execute({ sql: "INSERT INTO notes(id) VALUES (:id)", params: { id: 2 } });
  await lowLevelClient.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 4 } }]);
  await lowLevelClient.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 5 } }], { idempotencyKey: "sdk_retry_batch_2" });
  await lowLevelClient.transaction([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: { id: 6 } }], { databaseId: "db_alpha", mode: "write", idempotencyKey: "sdk_retry_transaction_2" });
  await lowLevelClient.transaction([{ sql: "SELECT count(*) AS total FROM notes" }], { databaseId: "db_alpha", mode: "read" });
  const lowLevelPrepared: IcpdbPreparedStatement = lowLevelClient.prepare("SELECT ?1 AS value");
  await lowLevelPrepared.get([1]);
  await lowLevelClient.prepare("SELECT ?1 AS value", [1], "db_alpha").get();
  await lowLevelClient.prepare(sql\`SELECT \${1} AS value\`, undefined, "db_alpha").get();
  await lowLevelClient.get("SELECT id FROM notes WHERE id = :id", { id: 2 });
  await lowLevelClient.values("SELECT id FROM notes WHERE id = ?1", [1]);
  await lowLevelClient.first("SELECT id FROM notes WHERE id = ?1", [1]);
  await lowLevelClient.firstValue("SELECT id FROM notes WHERE id = ?1", [1]);
  await lowLevelClient.database("db_alpha").executeMultiple("CREATE TABLE low_level_multiple(id INTEGER); INSERT INTO low_level_multiple(id) VALUES (1);");
  await lowLevelClient.database("db_alpha").executeMultiple("INSERT INTO low_level_multiple(id) VALUES (2);", { idempotencyKey: "sdk_retry_low_level_multiple_1" });
  await lowLevelClient.executeScript("CREATE TABLE low_level_script(id INTEGER);", { databaseId: "db_alpha", idempotencyKey: "sdk_retry_low_level_script_1" });
  await lowLevelClient.executeScript("SELECT count(*) AS total FROM notes;", { databaseId: "db_alpha", mode: "read", maxRows: 1 });
  await lowLevelClient.loadSqlDump("CREATE TABLE low_level_dump(id INTEGER);", { databaseId: "db_alpha", idempotencyKey: "sdk_retry_low_level_load_1" });
  await lowLevelClient.loadSqlDump("SELECT count(*) AS total FROM notes;", { databaseId: "db_alpha", mode: "read", maxRows: 1 });
  const lowLevelDump: string = await lowLevelClient.dumpSql({ pageSize: 10 });
  const lowLevelSnapshot = await lowLevelClient.archive();
  await lowLevelClient.restore(lowLevelSnapshot, { expectedSha256: (await lowLevelClient.snapshotInfo(lowLevelSnapshot)).sha256 });
  await lowLevelClient.migrate([{ version: "low-001", sql: "CREATE TABLE low_level_migrated(id INTEGER);" }]);
  await lowLevelClient.migrate([
    "CREATE TABLE low_level_libsql_migrated(id INTEGER)",
    sql\`INSERT INTO low_level_libsql_migrated(id) VALUES (\${2})\`
  ]);
  const lowLevelInspection: IcpdbDatabaseInspection = await lowLevelClient.inspect();
  const lowLevelTableInspection: IcpdbDatabaseInspection = await lowLevelClient.inspect({ tableName: "notes", previewLimit: 1 });
  const lowLevelStatus: IcpdbDatabaseStatus = await lowLevelClient.status();
  lowLevelStatus.callerPrincipal?.toString();
  lowLevelStatus.callerRole?.toString();
  const lowLevelShardInfo: DatabaseShardInfo[] = await lowLevelClient.listShards();
  const createdShard: DatabaseShardInfo = await lowLevelClient.createDatabaseShard({ initialCycles: 1000n, maxDatabases: 8 });
  const remoteDatabaseRequest: CreateRemoteDatabaseRequest = { databaseId: "db_remote", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" };
  const remoteDatabase: DatabaseInfo = await lowLevelClient.createRemoteDatabase(remoteDatabaseRequest);
  const registeredShard: DatabaseShardInfo = await lowLevelClient.registerDatabaseShard({ databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai", maxDatabases: 8 });
  const lowLevelShardStatus: DatabaseShardStatus = await lowLevelClient.getShardStatus("rrkah-fqaaa-aaaaa-aaaaq-cai");
  const toppedUpShard: DatabaseShardInfo = await lowLevelClient.topUpShard("rrkah-fqaaa-aaaaa-aaaaq-cai", "1000");
  const toppedUpDatabaseBalance: DatabaseBilling = await lowLevelClient.topUpDatabaseBalance("db_alpha", 1000n);
  const toppedUpDefaultDatabaseBalance: DatabaseBilling = await lowLevelClient.topUpDatabaseBalance(1000n);
  const maintainedShards: DatabaseShardMaintenanceReport = await lowLevelClient.maintainShards({
    minAvailableSlots: 1,
    minCyclesBalance: 0n,
    topUpCycles: "0",
    maxNewShards: 1,
    newShardMaxDatabases: 8,
    newShardInitialCycles: 0
  });
  const migratedPlacement: DatabaseShardPlacement = await lowLevelClient.migrateDatabaseToShard("db_alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai");
  const defaultMigratedPlacement: DatabaseShardPlacement = await lowLevelClient.migrateDatabaseToShard("rrkah-fqaaa-aaaaa-aaaaq-cai");
  const defaultPlacement: DatabaseShardPlacement | null = await lowLevelClient.placement();
  remoteDatabase.schemaVersion.toString();
  await lowLevelClient.listAllPlacements();
  await lowLevelClient.listShardOperations();
  await lowLevelClient.reconcileShardOperation({ operationId: "op_1", status: "applied", error: null });
  await lowLevelClient.getRoutedOperation("db_alpha", "op_1");
  await lowLevelClient.getRoutedOperation("op_1");
  await lowLevelClient.reconcileRoutedOperation("db_alpha", "op_1");
  await lowLevelClient.reconcileRoutedOperation("op_1");
  await lowLevelClient.waitForRoutedOperation("db_alpha", "op_1", waitOptions);
  await lowLevelClient.waitForRoutedOperation("op_1", waitOptions);
  await lowLevelClient.get("SELECT id FROM notes WHERE id = ?1", [1]);
  await lowLevelClient.all("SELECT id FROM notes");
  await lowLevelClient.values("SELECT id FROM notes");
  await lowLevelClient.first("SELECT id FROM notes");
  await lowLevelClient.firstValue("SELECT id FROM notes");
  const lowLevelSummary: DatabaseSummary | undefined = (await lowLevelClient.listDatabases())[0];
  const lowLevelArchiveInfo: DatabaseArchiveInfo = await lowLevelClient.beginArchive();
  const lowLevelUsage: DatabaseUsage = await lowLevelClient.getUsage();
  const lowLevelUsageEvent: DatabaseUsageEventSummary | undefined = (await lowLevelClient.listUsageEvents())[0];
  const lowLevelMember: DatabaseMember | undefined = (await lowLevelClient.listMembers("db_alpha"))[0];
  await lowLevelClient.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "writer");
  const lowLevelDefaultMember: DatabaseMember | undefined = (await lowLevelClient.listMembers())[0];
  await lowLevelClient.revokeMember("rrkah-fqaaa-aaaaa-aaaaq-cai");
  const lowLevelTable: DatabaseTable | undefined = (await lowLevelClient.listTables())[0];
  const lowLevelShortTable: DatabaseTable | undefined = (await lowLevelClient.tables())[0];
  const lowLevelView: DatabaseTable | undefined = (await lowLevelClient.views())[0];
  const lowLevelDescription: TableDescription = await lowLevelClient.describeTable("notes");
  const lowLevelShortDescription: TableDescription = await lowLevelClient.describe("notes");
  const lowLevelColumn: DatabaseColumn | undefined = (await lowLevelClient.listColumns("notes"))[0];
  const lowLevelShortColumn: DatabaseColumn | undefined = (await lowLevelClient.columns("notes"))[0];
  const lowLevelIndex: DatabaseIndex | undefined = (await lowLevelClient.listIndexes("notes"))[0];
  const lowLevelShortIndex: DatabaseIndex | undefined = (await lowLevelClient.indexes("notes"))[0];
  const lowLevelTrigger: DatabaseTrigger | undefined = (await lowLevelClient.listTriggers("notes"))[0];
  const lowLevelShortTrigger: DatabaseTrigger | undefined = (await lowLevelClient.triggers("notes"))[0];
  const lowLevelForeignKey: DatabaseForeignKey | undefined = (await lowLevelClient.listForeignKeys("notes"))[0];
  const lowLevelShortForeignKey: DatabaseForeignKey | undefined = (await lowLevelClient.foreignKeys("notes"))[0];
  const lowLevelPreview: TablePreviewResponse = await lowLevelClient.previewTable("notes");
  const lowLevelShortPreview: TablePreviewResponse = await lowLevelClient.preview("notes");
  const lowLevelResponse: SqlExecuteResponse = await lowLevelClient.execute("SELECT 1 AS value");
  const lowLevelOperation: RoutedOperationInfo = await lowLevelClient.getRoutedOperation("db_alpha", "op_1");
  const lowLevelShardOperation: ShardOperationInfo | undefined = (await lowLevelClient.listShardOperations())[0];
  const lowLevelShardReconcileRequest: ShardOperationReconcileRequest = { operationId: "op_1", status: "failed", error: "typed check" };
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
  lowLevelDump.toString();
  lowLevelOperation.operationId.toString();
  lowLevelShardOperation?.operationId.toString();
  lowLevelShardReconcileRequest.error?.toString();
  await client.execute({ sql: "SELECT :value AS value", args: { value: 1 } });
  await client.execute({ sql: "SELECT :enabled AS enabled", args: { enabled: true } });
  await client.execute({ sql: "SELECT :created_at AS created_at", args: { created_at: libsqlShapedDateInput } });
  await client.execute({ sql: "SELECT :payload AS payload", args: { payload: new ArrayBuffer(2) } });
  await client.execute({ sql: "SELECT :payload AS payload", args: { payload: new DataView(new ArrayBuffer(2)) } });
  await client.execute({ sql: "SELECT :value AS value", params: { value: 1 } });
  await setupSqlClient.execute("INSERT INTO package_client_setup(id) VALUES (?1)", [3]);
  const setupSqlClientQuery: IcpdbSqlClientResult = await setupSqlClient.query("SELECT id FROM package_client_setup ORDER BY id DESC");
  await setupSqlClient.execute(sql\`INSERT INTO package_client_setup(id) VALUES (\${4})\`);
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
  urlClient.close();
  await client.query("SELECT :value AS value", { value: 1 });
  await client.query({ sql: "SELECT ?1 AS value", params: [1] });
  await client.queryRows({ sql: "SELECT ?1 AS value", args: [1] });
  await client.queryOne("SELECT ?1 AS value", [1]);
  await client.all("SELECT ?1 AS value", [1]);
  await client.get("SELECT ?1 AS value", [1]);
  await client.get(["SELECT ?1 AS value", [1]]);
  await client.values("SELECT ?1 AS value", [1]);
  await client.first("SELECT ?1 AS value", [1]);
  await client.firstValue("SELECT ?1 AS value", [1]);
  await client.scalar("SELECT ?1 AS value", [1]);
  await client.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  const taggedStatement: IcpdbSqlTemplateStatement = sql\`SELECT \${1} AS value\`;
  // @ts-expect-error SQL client statements choose the DB at the client or database handle
  const invalidSqlClientDatabaseStatement: IcpdbSqlClientStatement = { sql: "SELECT 1", databaseId: "db_other" };
  invalidSqlClientDatabaseStatement.sql.toString();
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
  await client.execute(taggedStatement);
  await client.query(sql\`SELECT \${"typed"} AS value\`);
  await client.execute({ sql: "INSERT INTO notes(id) VALUES (?1)", args: [5], idempotencyKey: "sdk_retry_insert_3" });
  await client.run(["INSERT INTO notes(id) VALUES (?1)", [1]]);
  const prepared: IcpdbPreparedStatement = client.prepare("SELECT ?1 AS value");
  const preparedWithInitialBind: IcpdbPreparedStatement = client.prepare("SELECT ?1 AS value", [1]);
  await prepared.query([1]);
  await preparedWithInitialBind.get();
  await prepared.execute([1]);
  await prepared.all([1]);
  await prepared.get([1]);
  await prepared.values([1]);
  await prepared.first([1]);
  await prepared.firstValue([1]);
  await prepared.scalar([1]);
  await prepared.run([1]);
  await prepared.bind([1]).all();
  await client.prepare(sql\`SELECT \${1} AS value\`).all();
  await client.prepare({ sql: "SELECT :value AS value", params: { value: 1 } }).all();
  await client.prepare(["SELECT ?1 AS value", [1]]).all();
  await client.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [1] }], "write");
  await client.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", params: [1] }], "write");
  await client.batch([sql\`INSERT INTO notes(id) VALUES (\${2})\`], "write");
  await client.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [5] }], { idempotencyKey: "sdk_retry_batch_3" });
  await client.batch([["INSERT INTO notes(id) VALUES (?1)", [2]], ["SELECT count(*) AS total FROM notes"]], "write");
  await libsqlShapedClient.batch([{ sql: "INSERT INTO notes(id) VALUES (:id)", args: libsqlShapedArgs }], libsqlShapedMode);
  const libsqlShapedMigrationResults: ResultSet[] = await libsqlShapedClient.migrate([
    "CREATE TABLE libsql_shaped_migrated(id INTEGER)",
    { sql: "INSERT INTO libsql_shaped_migrated(id) VALUES (:id)", args: libsqlShapedArgs },
    sql\`INSERT INTO libsql_shaped_migrated(id) VALUES (\${2})\`
  ]);
  await client.transaction([["INSERT INTO notes(id) VALUES (?1)", [3]], ["SELECT count(*) AS total FROM notes"]], { mode: "write", maxRows: 10 });
  await client.transaction([sql\`INSERT INTO notes(id) VALUES (\${4})\`], "write");
  await client.transaction([["SELECT count(*) AS total FROM notes"]], "read");
  const clientClosed: boolean = client.closed;
  const clientProtocol: string = client.protocol;
  clientClosed.toString();
  clientProtocol.toString();
  client.reconnect();
  await client.sync().catch((error: unknown) => error instanceof Error ? error.message : String(error));
  const databaseHandle = await client.database();
  await databaseHandle.prepare(sql\`SELECT \${1} AS value\`).all();
  await databaseHandle.prepare({ sql: "SELECT :value AS value", params: { value: 1 } }).all();
  await databaseHandle.prepare(["SELECT ?1 AS value", [1]]).all();
  await databaseHandle.waitForRoutedOperation("op_1", waitOptions);
  databaseHandle.connectionUrl().toString();
  databaseHandle.url().toString();
  await databaseHandle.getUsage();
  await databaseHandle.status();
  await databaseHandle.listUsageEvents();
  await databaseHandle.getRoutedOperation("op_1");
  await databaseHandle.reconcileRoutedOperation("op_1");
  await databaseHandle.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await databaseHandle.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await databaseHandle.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "writer");
  await databaseHandle.listMembers();
  await databaseHandle.revokeMember("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await databaseHandle.placement();
  const databaseHandleSnapshot = await databaseHandle.archive();
  await databaseHandle.restore(databaseHandleSnapshot, { expectedSha256: (await databaseHandle.snapshotInfo(databaseHandleSnapshot)).sha256 });
  const clientConnectionUrl: string = await client.connectionUrl();
  const clientUrl: string = await client.url();
  const clientInfo: IcpdbSqlClientInfo = await client.info();
  clientInfo.canisterId?.toString();
  clientInfo.databaseId.toString();
  const clientHealth: CanisterHealth = await client.health();
  await client.migrate([{ version: "001", name: "package_migration", sql: "CREATE TABLE package_migrated(id INTEGER);" }]);
  await client.exec("CREATE TABLE package_exec(id INTEGER); INSERT INTO package_exec(id) VALUES (1);");
  await client.exec("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await client.executeScript("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await client.loadSqlDump("SELECT count(*) AS total FROM notes;", { mode: "read", maxRows: 1 });
  await client.executeMultiple("CREATE TABLE package_multiple(id INTEGER); INSERT INTO package_multiple(id) VALUES (1);");
  await client.executeMultiple("INSERT INTO package_multiple(id) VALUES (2);", { idempotencyKey: "sdk_retry_multiple_1" });
  await client.listTables();
  await client.tables();
  await client.views();
  await client.describeTable("notes");
  await client.describe("notes");
  await client.listColumns("notes");
  await client.columns("notes");
  await client.listIndexes("notes");
  await client.indexes("notes");
  await client.listTriggers("notes");
  await client.triggers("notes");
  await client.listForeignKeys("notes");
  await client.foreignKeys("notes");
  await client.previewTable("notes", { limit: 10 });
  await client.preview("notes", { limit: 10 });
  const clientInspection: IcpdbDatabaseInspection = await client.inspect({ tableName: "notes", previewLimit: 10 });
  await client.getUsage();
  const clientStatus: IcpdbDatabaseStatus = await client.status();
  clientStatus.callerPrincipal?.toString();
  clientStatus.callerRole?.toString();
  clientHealth.cyclesBalance.toString();
  await client.listUsageEvents();
  await client.getRoutedOperation("op_1");
  await client.reconcileRoutedOperation("op_1");
  await client.waitForRoutedOperation("op_1", waitOptions);
  await client.grantMember("rrkah-fqaaa-aaaaa-aaaaq-cai", "writer");
  await client.listMembers();
  await client.revokeMember("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await client.placement();
  connectedSqlClient.close();
  client.close();
  const clientSnapshot = await client.archive();
  await client.restore(clientSnapshot, { expectedSha256: (await client.snapshotInfo(clientSnapshot)).sha256 });
  await databaseHandle.delete();
  await serviceLowLevelClient.health();
  await serviceLowLevelClient.listAllPlacements();
  await serviceLowLevelClient.listShards();
  await serviceLowLevelClient.createDatabaseShard({ initialCycles: "1000", maxDatabases: 8 });
  await serviceLowLevelClient.createRemoteDatabase({ databaseId: "db_remote_service", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" });
  await serviceLowLevelClient.registerDatabaseShard({ databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai", maxDatabases: 8 });
  await serviceLowLevelClient.getShardStatus("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await serviceLowLevelClient.topUpShard("rrkah-fqaaa-aaaaa-aaaaq-cai", 1000n);
  await serviceLowLevelClient.maintainShards({
    minAvailableSlots: 1,
    minCyclesBalance: 0,
    topUpCycles: 0,
    maxNewShards: 1,
    newShardMaxDatabases: 8,
    newShardInitialCycles: 0
  });
  await serviceLowLevelClient.migrateDatabaseToShard("db_alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai");
  await serviceLowLevelClient.listShardOperations();
  await serviceLowLevelClient.reconcileShardOperation({ operationId: "op_2", status: "applied", error: null });
  await serviceLowLevelClient.getRoutedOperation("db_alpha", "op_2");
  await serviceLowLevelClient.reconcileRoutedOperation("db_alpha", "op_2");
  await serviceLowLevelClient.waitForRoutedOperation("db_alpha", "op_2", waitOptions);
  await serviceFileLowLevelClient.health();
  await serviceFileLowLevelClient.listAllPlacements();
  await serviceFileLowLevelClient.listShards();
  await serviceFileLowLevelClient.createDatabaseShard({ initialCycles: 1000, maxDatabases: 8 });
  await serviceFileLowLevelClient.createRemoteDatabase({ databaseId: "db_remote_file", databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai" });
  await serviceFileLowLevelClient.registerDatabaseShard({ databaseCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai", maxDatabases: 8 });
  await serviceFileLowLevelClient.getShardStatus("rrkah-fqaaa-aaaaa-aaaaq-cai");
  await serviceFileLowLevelClient.topUpShard("rrkah-fqaaa-aaaaa-aaaaq-cai", 1000);
  await serviceFileLowLevelClient.maintainShards({
    minAvailableSlots: 1,
    minCyclesBalance: 0,
    topUpCycles: 0,
    maxNewShards: 1,
    newShardMaxDatabases: 8,
    newShardInitialCycles: 0
  });
  await serviceFileLowLevelClient.migrateDatabaseToShard("db_alpha", "rrkah-fqaaa-aaaaa-aaaaq-cai");
  await serviceFileLowLevelClient.listShardOperations();
  await serviceFileLowLevelClient.reconcileShardOperation({ operationId: "op_3", status: "failed", error: "operator verified failure" });
  await serviceFileLowLevelClient.getRoutedOperation("db_alpha", "op_3");
  await serviceFileLowLevelClient.reconcileRoutedOperation("db_alpha", "op_3");
  await serviceFileLowLevelClient.waitForRoutedOperation("db_alpha", "op_3", waitOptions);
  await nodeConnectedFileSqlClient.databaseId();
  nodeConnectedFileSqlClient.close();
  await serverConnectedFileSqlClient.databaseId();
  serverConnectedFileSqlClient.close();
  await serviceClient.databaseId();
  await shortServiceClient.databaseId();
  await shortConnectedServiceClient.databaseId();
  shortConnectedServiceClient.close();
  shortServiceClient.close();
  await serviceClient.principal();
  serviceClient.close();
  await serviceFileClient.principal();
  await serviceFileClient.schema();
  serviceFileClient.close();
  await shortServiceFileClient.principal();
  await shortConnectedServiceFileClient.principal();
  await shortServiceFileClient.execute("INSERT INTO notes(body) VALUES (?1)", ["from-ci"]);
  const serviceFastStartResult: IcpdbSqlClientResult = await shortServiceFileClient.query("SELECT id, body FROM notes ORDER BY id DESC");
  const serviceFastStartRows: IcpdbRow[] = serviceFastStartResult.rows;
  const serviceFastStartConnectionUrl: string = await shortServiceFileClient.connectionUrl();
  const serviceFastStartInfo: IcpdbSqlClientInfo = await shortServiceFileClient.info();
  await shortServiceFileClient.query("SELECT 1 AS value");
  await shortServiceFileClient.scalar("SELECT count(*) FROM notes");
  serviceFastStartRows.length.toString();
  serviceFastStartConnectionUrl.toString();
  serviceFastStartInfo.databaseId.toString();
  shortConnectedServiceFileClient.close();
  shortServiceFileClient.close();
  await persistedServiceFileClient.principal();
  await persistedServiceFileClient.databaseId();
  persistedServiceFileClient.close();
  await explicitCreatedDb.execute("CREATE TABLE explicit_notes(id INTEGER)");
  await serviceCreatedDb.queryOne("SELECT 1");
  serviceEnv.ICPDB_CANISTER_ID?.toString();
  formattedConnectionUrl.toString();
  lowLevelConnectionUrl.toString();
  sqlClientPrincipal.toString();
  dbConnectionUrl.toString();
  lowLevelHealth.cyclesBalance.toString();
  clientConnectionUrl.toString();
  lowLevelInspection.schema.toString();
  lowLevelTableInspection.tables.map((table) => table.table.name).join(",");
  clientInspection.tables.map((table) => table.description.tableName).join(",");
  lowLevelStatus.databaseId.toString();
  clientStatus.stats.rowCount.toString();
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
  libsqlShapedValue?.toString();
  libsqlShapedIndexedValue?.toString();
  libsqlShapedLength?.toString();
  columnTypes.join(",");
  routedOperationId?.toString();
  libsqlShapedMigrationResults.length.toString();
  lowLevelShardInfo.map((shard) => shard.shardId).join(",");
  createdShard.canisterId.toString();
  registeredShard.canisterId.toString();
  lowLevelShardStatus.cyclesBalance.toString();
  toppedUpShard.assignedDatabases.toString();
  toppedUpDefaultDatabaseBalance.databaseId.toString();
  maintainedShards.availableSlots.toString();
  migratedPlacement.databaseId.toString();
  defaultMigratedPlacement.databaseId.toString();
  defaultPlacement?.databaseId.toString();
  return await explicitCreatedDb.queryOne("SELECT 1") ?? await db.queryOne("SELECT 1");
}
`);
await execFileAsync("../node_modules/.bin/tsc", [
  "--noEmit",
  "--strict",
  "--target",
  "ES2022",
  "--module",
  "NodeNext",
  "--moduleResolution",
  "NodeNext",
  "--skipLibCheck",
  "--lib",
  "dom,es2022",
  ".artifact-typecheck/check.ts"
], { cwd: "dist-sdk" });
const packageTypeCheckSource = readFileSync(`${typecheckDir}/check.ts`, "utf8");
assert.match(packageTypeCheckSource, /const fastStartRows: IcpdbRow\[\] = fastStartResult\.rows/);
assert.match(packageTypeCheckSource, /const fastStartConnectionUrl: string = await setupSqlClient\.connectionUrl\(\)/);
assert.match(packageTypeCheckSource, /const fastStartInfo: IcpdbSqlClientInfo = await setupSqlClient\.info\(\)/);
assert.match(packageTypeCheckSource, /const serviceFastStartRows: IcpdbRow\[\] = serviceFastStartResult\.rows/);
assert.match(packageTypeCheckSource, /const serviceFastStartConnectionUrl: string = await shortServiceFileClient\.connectionUrl\(\)/);
assert.match(packageTypeCheckSource, /const serviceFastStartInfo: IcpdbSqlClientInfo = await shortServiceFileClient\.info\(\)/);
assert.match(packageTypeCheckSource, /connectClientFromEnv/);
assert.match(packageTypeCheckSource, /connectClientFromEnvFile/);
assert.match(packageTypeCheckSource, /const batchedSqlClient: IcpdbSqlClient = createClientFromDatabase/);
assert.match(packageTypeCheckSource, /minimalSqlClient\.batch\(\["SELECT count\(\*\) AS total FROM notes"\], \{ mode: "read", maxRows: 1 \}\)/);
assert.match(packageTypeCheckSource, /batchedSqlClient\.batch\(\["INSERT INTO notes\(id\) VALUES \(1\)"\], "write"\)/);
await rm(typecheckDir, { recursive: true, force: true });

const consumerDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-consumer-"));
try {
  await mkdir(join(consumerDir, "node_modules", "@icpdb"), { recursive: true });
  await mkdir(join(consumerDir, "node_modules", "@icp-sdk"), { recursive: true });
  await symlink(join(process.cwd(), "dist-sdk"), join(consumerDir, "node_modules", "@icpdb", "client"), "dir");
  await symlink(join(process.cwd(), "node_modules", "@icp-sdk", "core"), join(consumerDir, "node_modules", "@icp-sdk", "core"), "dir");
  await symlink(join(process.cwd(), "node_modules", "@icp-sdk", "auth"), join(consumerDir, "node_modules", "@icp-sdk", "auth"), "dir");
  await writeFile(join(consumerDir, "package.json"), JSON.stringify({ type: "module" }));
  const consumerImport = await execFileAsync(process.execPath, [
    "--input-type=module",
    "-e",
  "const sdk = await import('@icpdb/client'); const sqlite = await import('@icpdb/client/sqlite'); const libsql = await import('@icpdb/client/libsql'); const service = await import('@icpdb/client/service-identity'); const pkg = await import('@icpdb/client/package.json', { with: { type: 'json' } }); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sqlite.createClient, typeof sqlite.createSqliteClient, typeof sqlite.connectSqliteClient, typeof sqlite.createSqliteDatabase, typeof sqlite.connectSqliteDatabase, typeof sqlite.parseSqliteDatabaseUrl, typeof sqlite.sql, typeof libsql.createClient, typeof libsql.sql, typeof service.createClientFromEnv, typeof service.connectClientFromEnv, typeof service.createIcpdbServiceSqlClientFromEnv, pkg.default.name);"
  ], { cwd: consumerDir });
  assert.equal(consumerImport.stdout.trim(), "function function function function function function function function function function function function function function @icpdb/client");
  await writeFile(join(consumerDir, "check.ts"), `
import type { Identity } from "@icp-sdk/core/agent";
import { AuthClient } from "@icp-sdk/auth/client";
import {
  connectClient,
  connectDatabase,
  createClient,
  createDatabase,
  createIcpdbClient,
  formatIcpdbCanisterUrl,
  type DatabaseArchiveInfo,
  type DatabaseMember,
  type DatabaseTable,
  type DatabaseUsage,
  type DatabaseUsageEventSummary,
  type IcpdbClient,
  type IcpdbSqlClient,
  type RoutedOperationInfo,
  type TableDescription,
  type TablePreviewResponse
} from "@icpdb/client";
import { connectSqliteClient, createSqliteClient, sql as sqliteSql, type SqliteClient } from "@icpdb/client/sqlite";
import { connectClientFromEnv, createClientFromEnv, createIcpdbServiceSqlClientFromEnv } from "@icpdb/client/service-identity";

const DELEGATION_TTL_NS = BigInt(8) * BigInt(3_600_000_000_000);

export async function checkBrowserIiConsumer(canisterId: string): Promise<IcpdbSqlClient> {
  const authClient = await AuthClient.create();
  if (!(await authClient.isAuthenticated())) {
    await new Promise<void>((resolve, reject) => {
      authClient.login({
        identityProvider: "https://id.ai",
        maxTimeToLive: DELEGATION_TTL_NS,
        onSuccess: () => resolve(),
        onError: (error) => reject(new Error(error ?? "Internet Identity login failed"))
      });
    });
  }
  const identity = authClient.getIdentity();
  return createClient({ canisterId, identity, setupSql: "CREATE TABLE notes(id INTEGER)" });
}

export async function checkConsumer(identity: Identity): Promise<void> {
  const client: IcpdbSqlClient = createClient({ connectionUrl: formatIcpdbCanisterUrl("aaaaa-aa"), identity, setupSql: "CREATE TABLE notes(id INTEGER)" });
  const connectedClient: IcpdbSqlClient = connectClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity });
  const sqliteClient: SqliteClient = createSqliteClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity });
  const connectedSqliteClient: SqliteClient = connectSqliteClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity });
  const shortDb = await createDatabase({ canisterId: "aaaaa-aa", identity });
  const shortConnectedDb = await connectDatabase({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const lowLevelClient: IcpdbClient = createIcpdbClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  await shortDb.queryRows("SELECT 1");
  await shortConnectedDb.queryOne("SELECT 1");
  await client.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  await client.get("SELECT id FROM notes WHERE id = ?1", [1]);
  await connectedClient.query("SELECT id FROM notes WHERE id = ?1", [1]);
  await sqliteClient.execute(sqliteSql\`SELECT \${"sqlite-consumer"} AS value\`);
  await connectedSqliteClient.query("SELECT 1");
  const consumerTable: DatabaseTable | undefined = (await client.listTables())[0];
  const consumerShortTable: DatabaseTable | undefined = (await client.tables())[0];
  const consumerView: DatabaseTable | undefined = (await client.views())[0];
  const consumerDescription: TableDescription = await client.describeTable("notes");
  const consumerShortDescription: TableDescription = await client.describe("notes");
  const consumerPreview: TablePreviewResponse = await client.previewTable("notes");
  const consumerShortPreview: TablePreviewResponse = await client.preview("notes");
  const consumerUsage: DatabaseUsage = await client.getUsage();
  const consumerUsageEvent: DatabaseUsageEventSummary | undefined = (await client.listUsageEvents())[0];
  const consumerMember: DatabaseMember | undefined = (await client.listMembers())[0];
  const consumerOperation: RoutedOperationInfo = await client.getRoutedOperation("op_1");
  const consumerArchiveInfo: DatabaseArchiveInfo = await lowLevelClient.beginArchive();
  consumerTable?.name.toString();
  consumerShortTable?.name.toString();
  consumerDescription.tableName.toString();
  consumerShortDescription.tableName.toString();
  consumerPreview.tableName.toString();
  consumerShortPreview.tableName.toString();
  consumerUsage.databaseId.toString();
  consumerUsageEvent?.method.toString();
  consumerMember?.role.toString();
  consumerOperation.operationId.toString();
  consumerArchiveInfo.databaseId.toString();
  const env: Record<string, string> = { ICPDB_CANISTER_ID: "aaaaa-aa", ICPDB_IDENTITY_PEM: "unused" };
  const serviceClient: IcpdbSqlClient = await createIcpdbServiceSqlClientFromEnv(env);
  const shortServiceClient: IcpdbSqlClient = await createClientFromEnv(env);
  const shortConnectedServiceClient: IcpdbSqlClient = await connectClientFromEnv({ ICPDB_URL: "icpdb://aaaaa-aa/db_alpha", ICPDB_IDENTITY_PEM: "unused" });
  await shortConnectedServiceClient.databaseId();
  shortConnectedServiceClient.close();
  shortServiceClient.close();
  serviceClient.close();
  connectedClient.close();
  sqliteClient.close();
  client.close();
}
`);
  await execFileAsync(tscBin, [
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--skipLibCheck",
    "--lib",
    "dom,es2022",
    "check.ts"
  ], { cwd: consumerDir });
} finally {
  await rm(consumerDir, { recursive: true, force: true });
}

const installedConsumerDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-installed-consumer-"));
const installCacheDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-install-cache-"));
try {
  await writeFile(join(installedConsumerDir, "package.json"), JSON.stringify({ type: "module" }));
  await execFileAsync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--package-lock=false",
    join(process.cwd(), "dist-sdk"),
    join(process.cwd(), "node_modules", "@icp-sdk", "core"),
    join(process.cwd(), "node_modules", "@icp-sdk", "auth")
  ], {
    cwd: installedConsumerDir,
    env: { ...process.env, npm_config_cache: installCacheDir }
  });
  const installedImport = await execFileAsync(process.execPath, [
    "--input-type=module",
    "-e",
    "const sdk = await import('@icpdb/client'); const sqlite = await import('@icpdb/client/sqlite'); const libsql = await import('@icpdb/client/libsql'); const service = await import('@icpdb/client/service-identity'); const pkg = await import('@icpdb/client/package.json', { with: { type: 'json' } }); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.createLibsqlClient, typeof sqlite.createClient, typeof sqlite.createSqliteClient, typeof sqlite.connectSqliteClient, typeof sqlite.createSqliteDatabase, typeof sqlite.connectSqliteDatabase, typeof sqlite.parseSqliteDatabaseUrl, typeof sqlite.sql, typeof libsql.createClient, typeof libsql.createLibsqlClient, typeof service.createClientFromEnv, typeof service.connectClientFromEnvFile, pkg.default.name);"
  ], { cwd: installedConsumerDir });
  assert.equal(installedImport.stdout.trim(), "function function function function function function function function function function function function function function @icpdb/client");
  await writeFile(join(installedConsumerDir, "check.ts"), `
import type { Identity } from "@icp-sdk/core/agent";
import { AuthClient } from "@icp-sdk/auth/client";
import {
  connectClient,
  connectDatabase,
  createClient,
  createDatabase,
  createIcpdbClient,
  createLibsqlClient,
  createTursoLikeClient,
  formatIcpdbCanisterUrl,
  type DatabaseArchiveInfo,
  type DatabaseMember,
  type DatabaseTable,
  type DatabaseUsage,
  type DatabaseUsageEventSummary,
  type IcpdbClient,
  type IcpdbSqlClient,
  type RoutedOperationInfo,
  type TableDescription,
  type TablePreviewResponse
} from "@icpdb/client";
import { connectSqliteClient, createSqliteClient, sql as sqliteSql, type SqliteClient } from "@icpdb/client/sqlite";
import { connectClientFromEnvFile, createClientFromEnvFile, createIcpdbServiceSqlClientFromEnvFile } from "@icpdb/client/service-identity";

const DELEGATION_TTL_NS = BigInt(8) * BigInt(3_600_000_000_000);

export async function checkInstalledBrowserIiConsumer(canisterId: string): Promise<IcpdbSqlClient> {
  const authClient = await AuthClient.create();
  if (!(await authClient.isAuthenticated())) {
    await new Promise<void>((resolve, reject) => {
      authClient.login({
        identityProvider: "https://id.ai",
        maxTimeToLive: DELEGATION_TTL_NS,
        onSuccess: () => resolve(),
        onError: (error) => reject(new Error(error ?? "Internet Identity login failed"))
      });
    });
  }
  const identity = authClient.getIdentity();
  return createClient({ canisterId, identity, setupSql: "CREATE TABLE notes(id INTEGER)" });
}

export async function checkInstalledConsumer(identity: Identity): Promise<void> {
  const client: IcpdbSqlClient = createClient({ connectionUrl: formatIcpdbCanisterUrl("aaaaa-aa"), identity, setupSql: "CREATE TABLE notes(id INTEGER)" });
  const connectedClient: IcpdbSqlClient = connectClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity });
  const shortDb = await createDatabase({ canisterId: "aaaaa-aa", identity });
  const shortConnectedDb = await connectDatabase({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const lowLevelClient: IcpdbClient = createIcpdbClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const sqliteClient: SqliteClient = createSqliteClient({ url: "icpdb://aaaaa-aa/db_alpha", identity });
  const connectedSqliteClient: SqliteClient = connectSqliteClient({ url: "icpdb://aaaaa-aa/db_alpha", identity });
  const libsqlClient: IcpdbSqlClient = createLibsqlClient({ url: "icpdb://aaaaa-aa/db_alpha", identity });
  const tursoLikeClient: IcpdbSqlClient = createTursoLikeClient({ url: "icpdb://aaaaa-aa/db_alpha", identity });
  await shortDb.queryRows("SELECT 1");
  await shortConnectedDb.queryOne("SELECT 1");
  await client.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  await client.get("SELECT id FROM notes WHERE id = ?1", [1]);
  await connectedClient.query("SELECT id FROM notes WHERE id = ?1", [1]);
  await sqliteClient.execute(sqliteSql\`SELECT \${"sqlite-installed-consumer"} AS value\`);
  await connectedSqliteClient.query("SELECT 1");
  await libsqlClient.execute({ sql: "SELECT id FROM notes WHERE id = ?", args: [1] });
  await tursoLikeClient.execute({ sql: "SELECT id FROM notes WHERE id = ?", args: [1] });
  const installedTable: DatabaseTable | undefined = (await client.listTables())[0];
  const installedShortTable: DatabaseTable | undefined = (await client.tables())[0];
  const installedView: DatabaseTable | undefined = (await client.views())[0];
  const installedDescription: TableDescription = await client.describeTable("notes");
  const installedShortDescription: TableDescription = await client.describe("notes");
  const installedPreview: TablePreviewResponse = await client.previewTable("notes");
  const installedShortPreview: TablePreviewResponse = await client.preview("notes");
  const installedUsage: DatabaseUsage = await client.getUsage();
  const installedUsageEvent: DatabaseUsageEventSummary | undefined = (await client.listUsageEvents())[0];
  const installedMember: DatabaseMember | undefined = (await client.listMembers())[0];
  const installedOperation: RoutedOperationInfo = await client.getRoutedOperation("op_1");
  const installedArchiveInfo: DatabaseArchiveInfo = await lowLevelClient.beginArchive();
  installedTable?.name.toString();
  installedShortTable?.name.toString();
  installedDescription.tableName.toString();
  installedShortDescription.tableName.toString();
  installedPreview.tableName.toString();
  installedShortPreview.tableName.toString();
  installedUsage.databaseId.toString();
  installedUsageEvent?.method.toString();
  installedMember?.role.toString();
  installedOperation.operationId.toString();
  installedArchiveInfo.databaseId.toString();
  const serviceClient: IcpdbSqlClient = await createIcpdbServiceSqlClientFromEnvFile("./service.env");
  const shortServiceClient: IcpdbSqlClient = await createClientFromEnvFile("./service.env");
  const shortConnectedServiceClient: IcpdbSqlClient = await connectClientFromEnvFile("./service.env");
  await shortConnectedServiceClient.databaseId();
  shortConnectedServiceClient.close();
  await shortServiceClient.query("SELECT 1 AS value");
  await shortServiceClient.scalar("SELECT count(*) FROM notes");
  shortServiceClient.close();
  serviceClient.close();
  sqliteClient.close();
  libsqlClient.close();
  tursoLikeClient.close();
  connectedClient.close();
  client.close();
}
`);
  await execFileAsync(tscBin, [
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--skipLibCheck",
    "--lib",
    "dom,es2022",
    "check.ts"
  ], { cwd: installedConsumerDir });
} finally {
  await rm(installedConsumerDir, { recursive: true, force: true });
  await rm(installCacheDir, { recursive: true, force: true });
}

const tarballPackDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-tarball-pack-"));
const tarballConsumerDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-tarball-consumer-"));
const tarballCacheDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-tarball-cache-"));
try {
  const packOutput = await execFileAsync("npm", [
    "pack",
    "--json",
    "--pack-destination",
    tarballPackDir
  ], {
    cwd: "dist-sdk",
    env: { ...process.env, npm_config_cache: tarballCacheDir }
  });
  const packEntries = JSON.parse(packOutput.stdout);
  assert.equal(Array.isArray(packEntries), true, "npm pack should return a package list");
  assert.equal(packEntries.length, 1, "npm pack should emit one SDK tarball");
  assert.equal(typeof packEntries[0].filename, "string", "npm pack should report a tarball filename");
  const tarballPath = join(tarballPackDir, packEntries[0].filename);
  assert.equal(existsSync(tarballPath), true, "npm pack should write the SDK tarball");
  await writeFile(join(tarballConsumerDir, "package.json"), JSON.stringify({ type: "module" }));
  await execFileAsync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--package-lock=false",
    tarballPath,
    join(process.cwd(), "node_modules", "@icp-sdk", "core"),
    join(process.cwd(), "node_modules", "@icp-sdk", "auth")
  ], {
    cwd: tarballConsumerDir,
    env: { ...process.env, npm_config_cache: tarballCacheDir }
  });
  const tarballImport = await execFileAsync(process.execPath, [
    "--input-type=module",
    "-e",
    "const sdk = await import('@icpdb/client'); const sqlite = await import('@icpdb/client/sqlite'); const libsql = await import('@icpdb/client/libsql'); const service = await import('@icpdb/client/service-identity'); const pkg = await import('@icpdb/client/package.json', { with: { type: 'json' } }); console.log(typeof sdk.connectClient, typeof sdk.createClient, typeof sdk.createLibsqlClient, typeof sqlite.createClient, typeof sqlite.createSqliteClient, typeof sqlite.connectSqliteClient, typeof sqlite.createSqliteDatabase, typeof sqlite.connectSqliteDatabase, typeof sqlite.parseSqliteDatabaseUrl, typeof sqlite.sql, typeof libsql.createClient, typeof libsql.createLibsqlClient, typeof service.createClientFromEnvFile, typeof service.connectClientFromEnvFile, pkg.default.name);"
  ], { cwd: tarballConsumerDir });
  assert.equal(tarballImport.stdout.trim(), "function function function function function function function function function function function function function function @icpdb/client");
  await writeFile(join(tarballConsumerDir, "check.ts"), `
import type { Identity } from "@icp-sdk/core/agent";
import { AuthClient } from "@icp-sdk/auth/client";
import {
  connectClient,
  connectDatabase,
  createClient,
  createDatabase,
  createIcpdbClient,
  createLibsqlClient,
  createTursoLikeClient,
  formatIcpdbCanisterUrl,
  type DatabaseArchiveInfo,
  type DatabaseMember,
  type DatabaseTable,
  type DatabaseUsage,
  type DatabaseUsageEventSummary,
  type IcpdbClient,
  type IcpdbSqlClient,
  type RoutedOperationInfo,
  type TableDescription,
  type TablePreviewResponse
} from "@icpdb/client";
import { connectSqliteClient, createSqliteClient, sql as sqliteSql, type SqliteClient } from "@icpdb/client/sqlite";
import { connectClientFromEnv, connectClientFromEnvFile, createClientFromEnv, createClientFromEnvFile, createIcpdbServiceSqlClientFromEnv, createIcpdbServiceSqlClientFromEnvFile } from "@icpdb/client/service-identity";

const DELEGATION_TTL_NS = BigInt(8) * BigInt(3_600_000_000_000);

export async function checkTarballBrowserIiConsumer(canisterId: string): Promise<IcpdbSqlClient> {
  const authClient = await AuthClient.create();
  if (!(await authClient.isAuthenticated())) {
    await new Promise<void>((resolve, reject) => {
      authClient.login({
        identityProvider: "https://id.ai",
        maxTimeToLive: DELEGATION_TTL_NS,
        onSuccess: () => resolve(),
        onError: (error) => reject(new Error(error ?? "Internet Identity login failed"))
      });
    });
  }
  const identity = authClient.getIdentity();
  return createClient({ canisterId, identity, setupSql: "CREATE TABLE notes(id INTEGER)" });
}

export async function checkTarballConsumer(identity: Identity): Promise<void> {
  const client: IcpdbSqlClient = createClient({ connectionUrl: formatIcpdbCanisterUrl("aaaaa-aa"), identity, setupSql: "CREATE TABLE notes(id INTEGER)" });
  const connectedClient: IcpdbSqlClient = connectClient({ connectionUrl: "icpdb://aaaaa-aa/db_alpha", identity });
  const shortDb = await createDatabase({ canisterId: "aaaaa-aa", identity });
  const shortConnectedDb = await connectDatabase({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const lowLevelClient: IcpdbClient = createIcpdbClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const sqliteClient: SqliteClient = createSqliteClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const connectedSqliteClient: SqliteClient = connectSqliteClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const libsqlClient: IcpdbSqlClient = createLibsqlClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  const tursoLikeClient: IcpdbSqlClient = createTursoLikeClient({ canisterId: "aaaaa-aa", databaseId: "db_alpha", identity });
  await shortDb.queryRows("SELECT 1");
  await shortConnectedDb.queryOne("SELECT 1");
  await client.run("INSERT INTO notes(id) VALUES (?1)", [1]);
  await client.get("SELECT id FROM notes WHERE id = ?1", [1]);
  await connectedClient.query("SELECT id FROM notes WHERE id = ?1", [1]);
  await sqliteClient.execute(sqliteSql\`SELECT \${"sqlite-tarball-consumer"} AS value\`);
  await connectedSqliteClient.query("SELECT 1");
  await libsqlClient.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [2] }], "write");
  await tursoLikeClient.batch([{ sql: "INSERT INTO notes(id) VALUES (?1)", args: [2] }], "write");
  const tarballTable: DatabaseTable | undefined = (await client.listTables())[0];
  const tarballShortTable: DatabaseTable | undefined = (await client.tables())[0];
  const tarballView: DatabaseTable | undefined = (await client.views())[0];
  const tarballDescription: TableDescription = await client.describeTable("notes");
  const tarballShortDescription: TableDescription = await client.describe("notes");
  const tarballPreview: TablePreviewResponse = await client.previewTable("notes");
  const tarballShortPreview: TablePreviewResponse = await client.preview("notes");
  const tarballUsage: DatabaseUsage = await client.getUsage();
  const tarballUsageEvent: DatabaseUsageEventSummary | undefined = (await client.listUsageEvents())[0];
  const tarballMember: DatabaseMember | undefined = (await client.listMembers())[0];
  const tarballOperation: RoutedOperationInfo = await client.getRoutedOperation("op_1");
  const tarballArchiveInfo: DatabaseArchiveInfo = await lowLevelClient.beginArchive();
  tarballTable?.name.toString();
  tarballShortTable?.name.toString();
  tarballDescription.tableName.toString();
  tarballShortDescription.tableName.toString();
  tarballPreview.tableName.toString();
  tarballShortPreview.tableName.toString();
  tarballUsage.databaseId.toString();
  tarballUsageEvent?.method.toString();
  tarballMember?.role.toString();
  tarballOperation.operationId.toString();
  tarballArchiveInfo.databaseId.toString();
  const env: Record<string, string> = { ICPDB_CANISTER_ID: "aaaaa-aa", ICPDB_IDENTITY_PEM: "unused" };
  const serviceEnvClient: IcpdbSqlClient = await createIcpdbServiceSqlClientFromEnv(env);
  const serviceFileClient: IcpdbSqlClient = await createIcpdbServiceSqlClientFromEnvFile("./service.env");
  const shortServiceEnvClient: IcpdbSqlClient = await createClientFromEnv(env);
  const shortServiceFileClient: IcpdbSqlClient = await createClientFromEnvFile("./service.env");
  const shortConnectedServiceEnvClient: IcpdbSqlClient = await connectClientFromEnv({ ICPDB_URL: "icpdb://aaaaa-aa/db_alpha", ICPDB_IDENTITY_PEM: "unused" });
  const shortConnectedServiceFileClient: IcpdbSqlClient = await connectClientFromEnvFile("./service.env");
  await shortServiceEnvClient.query("SELECT 1 AS value");
  await shortServiceFileClient.scalar("SELECT count(*) FROM notes");
  await shortConnectedServiceEnvClient.databaseId();
  await shortConnectedServiceFileClient.databaseId();
  shortConnectedServiceFileClient.close();
  shortConnectedServiceEnvClient.close();
  shortServiceFileClient.close();
  shortServiceEnvClient.close();
  serviceFileClient.close();
  serviceEnvClient.close();
  sqliteClient.close();
  libsqlClient.close();
  tursoLikeClient.close();
  connectedClient.close();
  client.close();
}
`);
  await execFileAsync(tscBin, [
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--skipLibCheck",
    "--lib",
    "dom,es2022",
    "check.ts"
  ], { cwd: tarballConsumerDir });
} finally {
  await rm(tarballPackDir, { recursive: true, force: true });
  await rm(tarballConsumerDir, { recursive: true, force: true });
  await rm(tarballCacheDir, { recursive: true, force: true });
}

console.log("ICPDB SDK package artifact checks OK");
