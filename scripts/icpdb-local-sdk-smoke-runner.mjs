// Where: scripts/icpdb-local-sdk-smoke-runner.mjs
// What: Runner body for the package-built ICPDB SQL SDK live smoke.
// Why: Keep the smoke command small while the live SDK assertions stay readable.

const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const smokeProgress = process.env.ICPDB_SMOKE_PROGRESS === "1";
const smokeOptions = parseSmokeArgs(process.argv.slice(2));
let activeNetwork = null;

if (smokeOptions.listSteps) {
  console.log("shortest\toptional\tone DB create through execute/query/url handoff");
  console.log("browser-shortest\toptional\tone browser subpath DB create through execute/query/url handoff");
  console.log("sqlite-shortest\toptional\tone hosted SQLite subpath DB create through execute/query/url handoff");
  console.log("libsql-shortest\toptional\tone libSQL-shaped DB create through execute/query/url handoff");
  console.log("full\tdefault\tcomplete SDK live smoke");
  process.exit(0);
}

async function main() {
  const assert = await import("node:assert/strict");
  const { execFile } = await import("node:child_process");
  const { chmod, mkdtemp, readFile, rm, stat, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { promisify } = await import("node:util");
  const { localNetworkConfig } = await import("./icpdb-local-network.mjs");
  const { Ed25519KeyIdentity } = await import("../icpdb-console/node_modules/@icp-sdk/core/lib/esm/identity/index.js");
  const { connectClient, connectIcpdbDatabase, createClient, createIcpdbClient, createIcpdbDatabase, createLibsqlClient, createTursoLikeClient, formatIcpdbCanisterUrl, formatIcpdbDatabaseUrl, parseIcpdbDatabaseUrl } = await import("../icpdb-console/dist-sdk/icpdb-sdk.js");
  const { connectSqliteClient, createSqliteClient, parseSqliteDatabaseUrl, sql: sqliteSubpathSql } = await import("../icpdb-console/dist-sdk/icpdb-sqlite.js");
  const { createLibsqlClient: createLibsqlSubpathClient, sql: libsqlSubpathSql } = await import("../icpdb-console/dist-sdk/icpdb-libsql.js");
  const {
    archiveDatabaseToFileFromEnv,
    archiveDatabaseToFileFromEnvFile,
    connectDatabaseFromEnv,
    connectDatabaseFromEnvFile,
    connectIcpdbServiceDatabaseFromEnv,
    connectClientFromEnv,
    connectClientFromEnvFile,
    createClientFromEnv,
    createClientFromEnvFile,
    createDatabaseFromEnvFile,
    createIcpdbPersistedServiceSqlClientFromEnvFile,
    createIcpdbServiceSqlClientFromEnvFile,
    generateIcpdbServiceIdentity,
    loadIcpdbServicePrincipalFromEnvFile,
    loadIcpdbServiceSetupFromEnvFile,
    persistIcpdbServiceDatabaseId,
    restoreDatabaseFromFileFromEnv,
    restoreDatabaseFromFileFromEnvFile,
    snapshotInfoFile,
    provisionIcpdbServiceDatabaseEnvFile,
    provisionIcpdbServiceEnvFile
  } = await import("../icpdb-console/dist-sdk/icpdb-service-identity.js");
  const network = await localNetworkConfig(environment, canisterName);
  activeNetwork = network;
  const execFileAsync = promisify(execFile);
  const packageCliPath = fileURLToPath(new URL("../icpdb-console/dist-sdk/icpdb-cli.js", import.meta.url));
  const packageDistDir = fileURLToPath(new URL("../icpdb-console/dist-sdk/", import.meta.url));
  progress(`network ${network.networkUrl} canister ${network.canisterId}`);
  const identity = Ed25519KeyIdentity.generate();
  const serviceIdentity = generateIcpdbServiceIdentity("ed25519");
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-sdk-smoke-"));
  async function writeServiceEnvFile(path, env) {
    await writeFile(path, `${envFileLines(env).join("\n")}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  }
  async function verifyLibsqlShortest() {
    const libsqlShortestClient = createLibsqlSubpathClient({
      canisterId: network.canisterId,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    try {
      await libsqlShortestClient.execute("CREATE TABLE sdk_libsql_shortest(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
      await libsqlShortestClient.execute({ sql: "INSERT INTO sdk_libsql_shortest(body) VALUES (?1)", args: ["from-libsql-shortest"] });
      const result = await libsqlShortestClient.execute({ sql: "SELECT body FROM sdk_libsql_shortest ORDER BY id DESC LIMIT 1" });
      assert.equal(result.rows[0]?.body, "from-libsql-shortest");
      assert.equal(await libsqlShortestClient.scalar("SELECT count(*) FROM sdk_libsql_shortest"), "1");
      assert.equal(parseIcpdbDatabaseUrl(await libsqlShortestClient.connectionUrl()).canisterId, network.canisterId);
      assert.equal(await libsqlShortestClient.url(), await libsqlShortestClient.connectionUrl());
      progress("libSQL-shaped shortest SDK smoke verified");
      await deleteShortestCleanup(libsqlShortestClient, "libsql shortest");
    } finally {
      libsqlShortestClient.close();
    }
  }
  async function verifySqliteShortest() {
    const sqliteShortestClient = createSqliteClient({
      canisterId: network.canisterId,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    let sqliteConnectedClient = null;
    try {
      await sqliteShortestClient.execute("CREATE TABLE sdk_sqlite_shortest(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
      await sqliteShortestClient.execute(sqliteSubpathSql`INSERT INTO sdk_sqlite_shortest(body) VALUES (${"from-sqlite-shortest"})`);
      const result = await sqliteShortestClient.query("SELECT body FROM sdk_sqlite_shortest ORDER BY id DESC LIMIT 1");
      assert.equal(result.rows[0]?.body, "from-sqlite-shortest");
      assert.equal(await sqliteShortestClient.scalar("SELECT count(*) FROM sdk_sqlite_shortest"), "1");
      const sqliteConnectionUrl = await sqliteShortestClient.connectionUrl();
      assert.equal(parseSqliteDatabaseUrl(sqliteConnectionUrl).canisterId, network.canisterId);
      sqliteConnectedClient = connectSqliteClient({
        connectionUrl: sqliteConnectionUrl,
        host: network.networkUrl,
        identity,
        rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
      });
      assert.equal(await sqliteConnectedClient.scalar("SELECT count(*) FROM sdk_sqlite_shortest"), "1");
      assert.equal(await sqliteShortestClient.url(), sqliteConnectionUrl);
      progress("hosted SQLite shortest SDK smoke verified");
      await deleteShortestCleanup(sqliteShortestClient, "sqlite shortest");
    } finally {
      if (sqliteConnectedClient) sqliteConnectedClient.close();
      sqliteShortestClient.close();
    }
  }
  async function verifyBrowserShortest() {
    const browserShortest = await execFileAsync(process.execPath, [
      "--input-type=module",
      "-e",
      `
        import assert from "node:assert/strict";
        import { Ed25519KeyIdentity } from "../node_modules/@icp-sdk/core/lib/esm/identity/index.js";
        import { createClient, parseIcpdbDatabaseUrl } from "@icpdb/client/browser";

        const identity = Ed25519KeyIdentity.generate();
        const canisterId = process.env.ICPDB_BROWSER_SMOKE_CANISTER_ID;
        const host = process.env.ICPDB_BROWSER_SMOKE_NETWORK_URL;
        const rootKey = process.env.ICPDB_BROWSER_SMOKE_ROOT_KEY ? hexToBytes(process.env.ICPDB_BROWSER_SMOKE_ROOT_KEY) : undefined;
        const client = createClient({ canisterId, host, identity, rootKey });
        let verified = false;
        try {
          await client.execute("CREATE TABLE sdk_browser_shortest(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
          await client.execute({ sql: "INSERT INTO sdk_browser_shortest(body) VALUES (?1)", args: ["from-browser-shortest"] });
          const result = await client.query("SELECT body FROM sdk_browser_shortest ORDER BY id DESC LIMIT 1");
          assert.equal(result.rows[0]?.body, "from-browser-shortest");
          assert.equal(await client.scalar("SELECT count(*) FROM sdk_browser_shortest"), "1");
          assert.equal(parseIcpdbDatabaseUrl(await client.connectionUrl()).canisterId, canisterId);
          assert.equal(await client.url(), await client.connectionUrl());
          verified = true;
          await client.delete();
        } catch (error) {
          if (verified && isLocalHostUnreachableError(error)) {
            console.error("[icpdb-sdk-smoke] browser shortest cleanup skipped after verified path because local host became unreachable");
          } else {
            throw error;
          }
        } finally {
          client.close();
        }
        console.log("browser shortest SDK smoke verified");

        function hexToBytes(hex) {
          const normalized = String(hex).trim();
          const bytes = new Uint8Array(normalized.length / 2);
          for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
          }
          return bytes;
        }

        function isLocalHostUnreachableError(error) {
          const message = error instanceof Error ? error.message : String(error);
          return /fetch failed|ECONNREFUSED|UND_ERR_SOCKET|terminated/i.test(message);
        }
      `
    ], {
      cwd: packageDistDir,
      env: {
        ...process.env,
        ICPDB_BROWSER_SMOKE_CANISTER_ID: network.canisterId,
        ICPDB_BROWSER_SMOKE_NETWORK_URL: network.networkUrl,
        ICPDB_BROWSER_SMOKE_ROOT_KEY: network.rootKey ?? ""
      }
    });
    assert.match(browserShortest.stdout, /browser shortest SDK smoke verified/);
    progress("browser shortest SDK smoke verified");
  }
  if (smokeOptions.only === "shortest") {
    const shortestClient = createClient({
      canisterId: network.canisterId,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    try {
      await shortestClient.execute("CREATE TABLE sdk_shortest(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
      await shortestClient.execute("INSERT INTO sdk_shortest(body) VALUES (?1)", ["from-sdk-shortest"]);
      const result = await shortestClient.query("SELECT body FROM sdk_shortest ORDER BY id DESC LIMIT 1");
      assert.equal(result.rows[0]?.body, "from-sdk-shortest");
      assert.equal(await shortestClient.scalar("SELECT count(*) FROM sdk_shortest"), "1");
      assert.equal(parseIcpdbDatabaseUrl(await shortestClient.connectionUrl()).canisterId, network.canisterId);
      assert.equal(await shortestClient.url(), await shortestClient.connectionUrl());
      progress("shortest SDK smoke verified");
      await deleteShortestCleanup(shortestClient, "shortest");
    } finally {
      shortestClient.close();
    }
    return;
  }
  if (smokeOptions.only === "libsql-shortest") {
    await verifyLibsqlShortest();
    return;
  }
  if (smokeOptions.only === "sqlite-shortest") {
    await verifySqliteShortest();
    return;
  }
  if (smokeOptions.only === "browser-shortest") {
    await verifyBrowserShortest();
    return;
  }
  await verifyBrowserShortest();
  await verifySqliteShortest();
  await verifyLibsqlShortest();
  await assert.rejects(() => connectIcpdbDatabase({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
  }), /databaseId is required/);
  await assert.rejects(() => createIcpdbClient({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
  }).connectDatabase(), /databaseId is required/);
  await assert.rejects(() => connectIcpdbServiceDatabaseFromEnv({
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_NETWORK_URL: network.networkUrl,
    ICPDB_ROOT_KEY: network.rootKey,
    ICPDB_IDENTITY_TYPE: serviceIdentity.identityType,
    ICPDB_IDENTITY_JSON: serviceIdentity.identityJson
  }), /databaseId is required/);
  await assert.rejects(() => connectDatabaseFromEnv({
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_NETWORK_URL: network.networkUrl,
    ICPDB_ROOT_KEY: network.rootKey,
    ICPDB_IDENTITY_TYPE: serviceIdentity.identityType,
    ICPDB_IDENTITY_JSON: serviceIdentity.identityJson
  }), /databaseId is required/);
  const setupFailureAdmin = createIcpdbClient({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
  });
  const setupFailureBefore = await setupFailureAdmin.listDatabases();
  const setupFailureClient = createClient({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
    setupSql: "CREATE TABLE sdk_setup_failure(id INTEGER PRIMARY KEY, body TEXT NOT NULL);",
    setupStatements: [
      { sql: "INSERT INTO missing_setup_target(body) VALUES (?1)", args: ["fail-before-handoff"] }
    ]
  });
  try {
    await assert.rejects(() => setupFailureClient.databaseId(), /missing_setup_target|no such table/i);
    const setupFailureAfter = await setupFailureAdmin.listDatabases();
    const previousIds = new Set(setupFailureBefore.map((database) => database.databaseId));
    const newDatabases = setupFailureAfter.filter((database) => !previousIds.has(database.databaseId));
    assert.equal(newDatabases.length, 1);
    assert.equal(newDatabases[0].status, "deleted");
    assert.notEqual(newDatabases[0].deletedAtMs, null);
  } finally {
    setupFailureClient.close();
  }
  progress("setup failure cleanup verified");
  const lowLevelSetupDb = await setupFailureAdmin.createDatabase({
    setupSql: "CREATE TABLE sdk_low_level_setup(id INTEGER PRIMARY KEY, body TEXT NOT NULL);",
    setupStatements: [
      { sql: "INSERT INTO sdk_low_level_setup(body) VALUES (:body)", args: { body: "from-low-level-create-setup" } }
    ]
  });
  try {
    assert.equal((await lowLevelSetupDb.get("SELECT body FROM sdk_low_level_setup"))?.body, "from-low-level-create-setup");
  } finally {
    await deleteShortestCleanup(lowLevelSetupDb, "low-level create setup");
  }
  progress("low-level create setup verified");
  const urlSetupClient = createClient({
    url: formatIcpdbCanisterUrl(network.canisterId),
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
    setupSql: "CREATE TABLE sdk_url_setup(id INTEGER PRIMARY KEY, body TEXT NOT NULL);"
  });
  try {
    await urlSetupClient.run("INSERT INTO sdk_url_setup(body) VALUES (?1)", ["from-canister-url-setup"]);
    assert.equal((await urlSetupClient.get("SELECT body FROM sdk_url_setup"))?.body, "from-canister-url-setup");
    assert.equal(parseIcpdbDatabaseUrl(await urlSetupClient.connectionUrl()).canisterId, network.canisterId);
    assert.equal(await urlSetupClient.url(), await urlSetupClient.connectionUrl());
    await deleteShortestCleanup(urlSetupClient, "canister-only URL setup");
  } finally {
    urlSetupClient.close();
  }
  progress("canister-only URL setup client verified");
  const firstExecuteClient = createClient({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
  });
  try {
    await firstExecuteClient.execute("CREATE TABLE sdk_first_execute(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    await firstExecuteClient.execute({ sql: "INSERT INTO sdk_first_execute(body) VALUES (?1)", args: ["from-first-execute"] });
    assert.equal((await firstExecuteClient.get("SELECT body FROM sdk_first_execute"))?.body, "from-first-execute");
    assert.equal(parseIcpdbDatabaseUrl(await firstExecuteClient.connectionUrl()).canisterId, network.canisterId);
    assert.equal(await firstExecuteClient.url(), await firstExecuteClient.connectionUrl());
    await deleteShortestCleanup(firstExecuteClient, "first execute");
  } finally {
    firstExecuteClient.close();
  }
  progress("first execute DB creation verified");
  const queryOnlyClient = createClient({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
  });
  try {
    assert.equal(await queryOnlyClient.scalar("SELECT 1 AS value"), "1");
    assert.equal(parseIcpdbDatabaseUrl(await queryOnlyClient.connectionUrl()).canisterId, network.canisterId);
    assert.equal(await queryOnlyClient.url(), await queryOnlyClient.connectionUrl());
    await deleteShortestCleanup(queryOnlyClient, "query-only");
  } finally {
    queryOnlyClient.close();
  }
  progress("query-only first DB creation verified");
  const firstQueryClient = createClient({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
    setupSql: `
      CREATE TABLE sdk_first_query(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_first_query(body) VALUES ('from-first-query-setup');
    `
  });
  try {
    assert.equal((await firstQueryClient.get("SELECT body FROM sdk_first_query"))?.body, "from-first-query-setup");
    assert.equal(await firstQueryClient.scalar("SELECT count(*) FROM sdk_first_query"), "1");
    assert.equal(parseIcpdbDatabaseUrl(await firstQueryClient.connectionUrl()).canisterId, network.canisterId);
    assert.equal(await firstQueryClient.url(), await firstQueryClient.connectionUrl());
    await deleteShortestCleanup(firstQueryClient, "first query");
  } finally {
    firstQueryClient.close();
  }
  progress("first query DB creation with setup verified");
  const firstUrlClient = createClient({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
    setupSql: `
      CREATE TABLE sdk_first_url(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_first_url(body) VALUES ('from-first-url-setup');
    `
  });
  try {
    const firstUrl = await firstUrlClient.connectionUrl();
    const firstUrlDatabaseId = await firstUrlClient.databaseId();
    assert.deepEqual(parseIcpdbDatabaseUrl(firstUrl), {
      canisterId: network.canisterId,
      databaseId: firstUrlDatabaseId
    });
    assert.equal(await firstUrlClient.url(), firstUrl);
    assert.equal((await firstUrlClient.get("SELECT body FROM sdk_first_url"))?.body, "from-first-url-setup");
    assert.equal(await firstUrlClient.scalar("SELECT count(*) FROM sdk_first_url"), "1");
    await deleteShortestCleanup(firstUrlClient, "first connection URL");
  } finally {
    firstUrlClient.close();
  }
  progress("first connection URL DB creation with setup verified");
  const client = createClient({
    canisterId: network.canisterId,
    host: network.networkUrl,
    identity,
    rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
    setupSql: `
      CREATE TABLE sdk_setup(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_setup(body) VALUES ('from-setup-sql');
    `,
    setupStatements: [
      { sql: "INSERT INTO sdk_setup(body) VALUES (:body)", args: { body: "from-setup-statements" } }
    ],
    setupMigrations: [
      {
        version: "setup-001",
        name: "create_sdk_setup_migrated",
        sql: "CREATE TABLE sdk_setup_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_setup_migrated(body) VALUES ('from-setup-migration');"
      }
    ]
  });
  assert.equal(client.protocol, "icpdb");
  assert.equal(client.closed, false);
  let databaseId = "";
  try {
    const clientHealth = await client.health();
    assert.ok(clientHealth.cyclesBalance >= 0n);
    progress("creating direct database");
    const directDb = await createIcpdbDatabase({
      canisterId: network.canisterId,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
      setupSql: "CREATE TABLE sdk_direct_setup(id INTEGER PRIMARY KEY, body TEXT NOT NULL);",
      setupStatements: [["INSERT INTO sdk_direct_setup(body) VALUES (?1)", ["from-direct-setup-statements"]]],
      setupMigrations: [
        {
          version: "direct-setup-001",
          name: "create_direct_setup_migrated",
          sql: "CREATE TABLE sdk_direct_setup_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_direct_setup_migrated(body) VALUES ('from-direct-setup-migration');"
        }
      ]
    });
    progress("direct database created");
    assert.equal((await directDb.get("SELECT body FROM sdk_direct_setup_migrated"))?.body, "from-direct-setup-migration");
    assert.equal((await directDb.get("SELECT body FROM sdk_direct_setup"))?.body, "from-direct-setup-statements");
    await directDb.execute("CREATE TABLE sdk_direct(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    assert.equal(directDb.connectionUrl(), formatIcpdbDatabaseUrl(network.canisterId, directDb.databaseId));
    assert.equal(directDb.url(), directDb.connectionUrl());
    await directDb.execute("INSERT INTO sdk_direct(body) VALUES (?1)", ["from-direct-create"]);
    assert.equal((await directDb.queryOne("SELECT body FROM sdk_direct"))?.body, "from-direct-create");
    assert.deepEqual(await directDb.values("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-create"]), [["from-direct-create"]]);
    assert.equal((await directDb.first("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-create"]))?.body, "from-direct-create");
    assert.equal(await directDb.firstValue("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-create"]), "from-direct-create");
    assert.equal(await directDb.scalar("SELECT body FROM sdk_direct"), "from-direct-create");
    assert.equal((await directDb.get("SELECT body FROM sdk_direct"))?.body, "from-direct-create");
    assert.equal((await directDb.all("SELECT body FROM sdk_direct"))[0]?.body, "from-direct-create");
    assert.equal((await directDb.prepare("SELECT body FROM sdk_direct WHERE body = ?1").get(["from-direct-create"]))?.body, "from-direct-create");
    assert.equal((await directDb.run("INSERT INTO sdk_direct(body) VALUES (?1)", ["from-direct-run"])).rowsAffected, "1");
    await directDb.execute({ sql: "INSERT INTO sdk_direct(body) VALUES (:body)", args: { body: "from-direct-named-args" } });
    await directDb.execute({ sql: "INSERT INTO sdk_direct(body) VALUES (:body)", params: { body: "from-direct-named-params" } });
    await directDb.batch([{ sql: "INSERT INTO sdk_direct(body) VALUES (:body)", args: { body: "from-direct-batch-args" } }]);
    await directDb.transaction([["INSERT INTO sdk_direct(body) VALUES (?1)", ["from-direct-transaction"]]], "write");
    await directDb.transaction([["SELECT count(*) AS total FROM sdk_direct"]], "read");
    assert.equal((await directDb.get("SELECT body FROM sdk_direct WHERE body = :body", { body: "from-direct-named-args" }))?.body, "from-direct-named-args");
    assert.equal((await directDb.get("SELECT body FROM sdk_direct WHERE body = :body", { body: "from-direct-named-params" }))?.body, "from-direct-named-params");
    assert.equal((await directDb.get("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-transaction"]))?.body, "from-direct-transaction");
    await directDb.execute("CREATE VIEW sdk_direct_view AS SELECT id, body FROM sdk_direct");
    await directDb.executeMultiple(`
      CREATE TABLE sdk_direct_multiple(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_direct_multiple(body) VALUES ('from-direct-multiple');
    `, { idempotencyKey: `sdk_direct_multiple_${directDb.databaseId}` });
    assert.equal((await directDb.get("SELECT body FROM sdk_direct_multiple"))?.body, "from-direct-multiple");
    assert.deepEqual(await directDb.migrate([
      {
        version: "direct-001",
        name: "create_direct_migrated",
        sql: "CREATE TABLE sdk_direct_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_direct_migrated(body) VALUES ('from-direct-migration');"
      }
    ]), { applied: ["direct-001"], skipped: [] });
    assert.equal((await directDb.get("SELECT body FROM sdk_direct_migrated"))?.body, "from-direct-migration");
    const directLibsqlMigrationResults = await directDb.migrate([
      "CREATE TABLE sdk_direct_libsql_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
      { sql: "INSERT INTO sdk_direct_libsql_migrated(body) VALUES (:body)", args: { body: "from-direct-libsql-migration" } }
    ]);
    assert.equal(directLibsqlMigrationResults.length, 2);
    assert.equal((await directDb.get("SELECT body FROM sdk_direct_libsql_migrated"))?.body, "from-direct-libsql-migration");
    assert.ok((await directDb.tables()).some((table) => table.name === "sdk_direct"));
    assert.ok((await directDb.views()).some((table) => table.name === "sdk_direct_view"));
    assert.equal((await directDb.describe("sdk_direct")).tableName, "sdk_direct");
    assert.ok((await directDb.columns("sdk_direct")).some((column) => column.name === "body"));
    assert.deepEqual(await directDb.indexes("sdk_direct"), []);
    assert.deepEqual(await directDb.triggers("sdk_direct"), []);
    assert.deepEqual(await directDb.foreignKeys("sdk_direct"), []);
    assert.equal((await directDb.preview("sdk_direct", { limit: 2 })).tableName, "sdk_direct");
    progress("direct client verified");
    const lowLevelClient = createIcpdbClient({
      canisterId: network.canisterId,
      databaseId: directDb.databaseId,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    assert.equal(lowLevelClient.connectionUrl(), directDb.connectionUrl());
    assert.equal(lowLevelClient.url(), lowLevelClient.connectionUrl());
    assert.equal((await lowLevelClient.get("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-run"]))?.body, "from-direct-run");
    assert.equal((await lowLevelClient.all("SELECT body FROM sdk_direct ORDER BY id")).length, 6);
    assert.deepEqual(await lowLevelClient.values("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-run"]), [["from-direct-run"]]);
    assert.equal((await lowLevelClient.first("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-run"]))?.body, "from-direct-run");
    assert.equal(await lowLevelClient.firstValue("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-run"]), "from-direct-run");
    assert.equal(await lowLevelClient.scalar("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-run"]), "from-direct-run");
    assert.equal((await lowLevelClient.prepare("SELECT body FROM sdk_direct WHERE body = ?1").get(["from-direct-run"]))?.body, "from-direct-run");
    assert.equal((await lowLevelClient.run("INSERT INTO sdk_direct(body) VALUES (?1)", ["from-low-level-run"])).rowsAffected, "1");
    await lowLevelClient.execute({ sql: "INSERT INTO sdk_direct(body) VALUES (:body)", args: { body: "from-low-level-named-args" } });
    await lowLevelClient.execute({ sql: "INSERT INTO sdk_direct(body) VALUES (:body)", params: { body: "from-low-level-named-params" } });
    await lowLevelClient.batch([{ sql: "INSERT INTO sdk_direct(body) VALUES (:body)", args: { body: "from-low-level-batch-args" } }]);
    await lowLevelClient.transaction([{ sql: "INSERT INTO sdk_direct(body) VALUES (:body)", args: { body: "from-low-level-transaction" } }], "write");
    await lowLevelClient.transaction([{ sql: "SELECT count(*) AS total FROM sdk_direct" }], { mode: "read" });
    assert.equal((await lowLevelClient.get("SELECT body FROM sdk_direct WHERE body = :body", { body: "from-low-level-named-args" }))?.body, "from-low-level-named-args");
    assert.equal((await lowLevelClient.get("SELECT body FROM sdk_direct WHERE body = :body", { body: "from-low-level-named-params" }))?.body, "from-low-level-named-params");
    assert.equal((await lowLevelClient.get("SELECT body FROM sdk_direct WHERE body = :body", { body: "from-low-level-transaction" }))?.body, "from-low-level-transaction");
    await lowLevelClient.executeMultiple(`
      CREATE TABLE sdk_low_level_multiple(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_low_level_multiple(body) VALUES ('from-low-level-multiple');
    `, { databaseId: directDb.databaseId, idempotencyKey: `sdk_low_level_multiple_${directDb.databaseId}` });
    assert.equal((await lowLevelClient.get("SELECT body FROM sdk_low_level_multiple"))?.body, "from-low-level-multiple");
    assert.deepEqual(await lowLevelClient.migrate([
      {
        version: "low-001",
        name: "create_low_level_migrated",
        sql: "CREATE TABLE sdk_low_level_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_low_level_migrated(body) VALUES ('from-low-level-migration');"
      }
    ]), { applied: ["low-001"], skipped: [] });
    assert.equal((await lowLevelClient.get("SELECT body FROM sdk_low_level_migrated"))?.body, "from-low-level-migration");
    assert.ok((await lowLevelClient.tables()).some((table) => table.name === "sdk_direct"));
    assert.ok((await lowLevelClient.views()).some((table) => table.name === "sdk_direct_view"));
    assert.equal((await lowLevelClient.describe("sdk_direct")).tableName, "sdk_direct");
    assert.ok((await lowLevelClient.columns("sdk_direct")).some((column) => column.name === "body"));
    assert.deepEqual(await lowLevelClient.indexes("sdk_direct"), []);
    assert.deepEqual(await lowLevelClient.triggers("sdk_direct"), []);
    assert.deepEqual(await lowLevelClient.foreignKeys("sdk_direct"), []);
    assert.equal((await lowLevelClient.preview("sdk_direct", { limit: 2 })).tableName, "sdk_direct");
    assert.equal((await directDb.getUsage()).databaseId, directDb.databaseId);
    assert.ok(Array.isArray(await directDb.listUsageEvents()));
    assert.equal((await directDb.placement())?.databaseId, directDb.databaseId);
    assert.equal((await directDb.status()).callerPrincipal, identity.getPrincipal().toText());
    assert.equal((await directDb.listMembers()).some((member) => member.principal === identity.getPrincipal().toText() && member.role === "owner"), true);
    const directSnapshot = await directDb.archive();
    const directSnapshotMetadata = await directDb.snapshotInfo(directSnapshot);
    await assert.rejects(() => directDb.run("INSERT INTO sdk_direct(body) VALUES (?1)", ["from-direct-archived-write"]), /database is archived/);
    await directDb.restore(directSnapshot, { expectedSha256: directSnapshotMetadata.sha256 });
    assert.equal((await directDb.get("SELECT body FROM sdk_direct WHERE body = ?1", ["from-direct-run"]))?.body, "from-direct-run");
    await directDb.delete();
    progress("direct and low-level clients verified");
    progress("creating main client database");
    await client.execute("INSERT INTO sdk_setup(body) VALUES (?1)", ["from-fast-start-execute"]);
    const fastStartResult = await client.query("SELECT body FROM sdk_setup WHERE body = ?1", ["from-fast-start-execute"]);
    assert.equal(fastStartResult.rows[0]?.body, "from-fast-start-execute");
    progress("fast-start execute/query verified");
    assert.equal((await client.get("SELECT body FROM sdk_setup"))?.body, "from-setup-sql");
    assert.equal((await client.get("SELECT body FROM sdk_setup WHERE body = 'from-setup-statements'"))?.body, "from-setup-statements");
    assert.equal((await client.get("SELECT body FROM sdk_setup_migrated"))?.body, "from-setup-migration");
    await client.executeScript(`
      CREATE TABLE sdk_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_notes(body) VALUES ('from-script');
      CREATE VIEW sdk_notes_view AS SELECT id, body FROM sdk_notes;
    `);
    databaseId = await client.databaseId();
    progress(`main database ${databaseId} created`);
    if (environment !== "ic") {
      const placement = await client.placement();
      if (placement?.canisterId) {
        await topUpLocalControlCanister(execFileAsync);
        progress("control canister topped up");
        await topUpLocalDatabaseShard(execFileAsync, placement.canisterId);
        progress("main database shard topped up");
      }
      await topUpLocalDatabaseBalance(execFileAsync, databaseId);
      progress("main database balance topped up");
    }
    assert.equal(await client.connectionUrl(), formatIcpdbDatabaseUrl(network.canisterId, databaseId));
    assert.equal(await client.url(), await client.connectionUrl());
    client.close();
    assert.equal(client.closed, true);
    assert.equal(await client.databaseId(), databaseId);
    await client.run("INSERT INTO sdk_setup(body) VALUES (?1)", ["after-create-client-reconnect"]);
    assert.equal((await client.get("SELECT body FROM sdk_setup WHERE body = ?1", ["after-create-client-reconnect"]))?.body, "after-create-client-reconnect");
    progress("createClient reconnect reused created database");
    const appConnectionUrl = await client.connectionUrl();
    const appReconnectClient = connectClient({
      connectionUrl: appConnectionUrl,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    try {
      assert.equal(await appReconnectClient.databaseId(), databaseId);
      await appReconnectClient.run("INSERT INTO sdk_setup(body) VALUES (?1)", ["from-connect-client-reconnect"]);
      assert.equal((await appReconnectClient.get("SELECT body FROM sdk_setup WHERE body = ?1", ["from-connect-client-reconnect"]))?.body, "from-connect-client-reconnect");
    } finally {
      appReconnectClient.close();
    }
    progress("connectClient connectionUrl reconnect verified");
    assert.deepEqual(parseIcpdbDatabaseUrl(`icpdb://${network.canisterId}/${databaseId}`), {
      canisterId: network.canisterId,
      databaseId
    });
    const urlClient = createClient({
      url: `icpdb://${network.canisterId}/${databaseId}`,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    const tursoLikeClient = createTursoLikeClient({
      url: `icpdb://${network.canisterId}/${databaseId}`,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    const libsqlClient = createLibsqlClient({
      url: `icpdb://${network.canisterId}/${databaseId}`,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    const libsqlSubpathClient = createLibsqlSubpathClient({
      url: `icpdb://${network.canisterId}/${databaseId}`,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
    });
    try {
      assert.equal(await urlClient.databaseId(), databaseId);
      assert.equal((await urlClient.get("SELECT body FROM sdk_setup"))?.body, "from-setup-sql");
      assert.equal((await tursoLikeClient.execute({ sql: "SELECT body FROM sdk_setup WHERE body = ?", args: ["from-setup-sql"] })).rows[0]?.body, "from-setup-sql");
      await tursoLikeClient.batch([{ sql: "INSERT INTO sdk_setup(body) VALUES (:body)", args: { body: "from-turso-like-batch" } }], "write");
      assert.equal((await tursoLikeClient.get("SELECT body FROM sdk_setup WHERE body = :body", { body: "from-turso-like-batch" }))?.body, "from-turso-like-batch");
      await libsqlClient.batch([{ sql: "INSERT INTO sdk_setup(body) VALUES (:body)", args: { body: "from-libsql-client-batch" } }], "write");
      assert.equal((await libsqlClient.get("SELECT body FROM sdk_setup WHERE body = :body", { body: "from-libsql-client-batch" }))?.body, "from-libsql-client-batch");
      await libsqlSubpathClient.batch([libsqlSubpathSql`INSERT INTO sdk_setup(body) VALUES (${"from-libsql-subpath-batch"})`], "write");
      assert.equal((await libsqlSubpathClient.get("SELECT body FROM sdk_setup WHERE body = :body", { body: "from-libsql-subpath-batch" }))?.body, "from-libsql-subpath-batch");
    } finally {
      urlClient.close();
      libsqlClient.close();
      libsqlSubpathClient.close();
      tursoLikeClient.close();
    }
    progress("url, libsql root/subpath, and turso-like clients verified");
    const database = await client.database();
    assert.equal(database.databaseId, databaseId);
    await database.run("INSERT INTO sdk_notes(body) VALUES (?1)", ["from-database-handle-run"]);
    assert.equal((await database.queryOne("SELECT body FROM sdk_notes WHERE body = ?1", ["from-database-handle-run"]))?.body, "from-database-handle-run");
    assert.equal((await database.all("SELECT body FROM sdk_notes WHERE body = ?1", ["from-database-handle-run"]))[0]?.body, "from-database-handle-run");
    assert.deepEqual(await database.values("SELECT body FROM sdk_notes WHERE body = ?1", ["from-database-handle-run"]), [["from-database-handle-run"]]);
    assert.equal((await database.first("SELECT body FROM sdk_notes WHERE body = ?1", ["from-database-handle-run"]))?.body, "from-database-handle-run");
    assert.equal(await database.firstValue("SELECT body FROM sdk_notes WHERE body = ?1", ["from-database-handle-run"]), "from-database-handle-run");
    assert.equal(await database.scalar("SELECT body FROM sdk_notes WHERE body = ?1", ["from-database-handle-run"]), "from-database-handle-run");
    assert.equal((await database.prepare("SELECT body FROM sdk_notes WHERE body = ?1").get(["from-database-handle-run"]))?.body, "from-database-handle-run");
    const handleWaitWrite = await database.run({
      sql: "INSERT INTO sdk_notes(body) VALUES (?1)",
      args: ["from-database-handle-wait"],
      idempotencyKey: `sdk_handle_wait_${databaseId}`
    });
    if (handleWaitWrite.routedOperationId) {
      assert.equal((await database.waitForRoutedOperation(handleWaitWrite.routedOperationId, { intervalMs: 0, timeoutMs: 5000 })).status, "applied");
    }
    assert.equal((await database.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-database-handle-wait"]))?.body, "from-database-handle-wait");
    await database.exec(`
      CREATE TABLE sdk_handle_exec(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_handle_exec(body) VALUES ('from-database-handle-exec');
    `, { idempotencyKey: `sdk_handle_exec_${databaseId}` });
    assert.equal((await database.get("SELECT body FROM sdk_handle_exec"))?.body, "from-database-handle-exec");
    await database.executeMultiple(`
      CREATE TABLE sdk_handle_multiple(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_handle_multiple(body) VALUES ('from-database-handle-multiple');
    `);
    assert.equal((await database.get("SELECT body FROM sdk_handle_multiple"))?.body, "from-database-handle-multiple");
    await database.executeMultiple("INSERT INTO sdk_handle_multiple(body) VALUES ('from-database-handle-multiple-retry');", {
      idempotencyKey: `sdk_retry_db_handle_multiple_${databaseId}`
    });
    assert.equal((await database.get("SELECT body FROM sdk_handle_multiple WHERE body = ?1", ["from-database-handle-multiple-retry"]))?.body, "from-database-handle-multiple-retry");
    await database.executeScript(`
      CREATE TABLE sdk_handle_script(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_handle_script(body) VALUES ('from-database-handle-script');
    `, { idempotencyKey: `sdk_handle_script_${databaseId}` });
    assert.equal((await database.get("SELECT body FROM sdk_handle_script"))?.body, "from-database-handle-script");
    progress("database handle write helpers verified");
    assert.deepEqual(await database.migrate([
      {
        version: "handle-001",
        name: "create_handle_migrated",
        sql: "CREATE TABLE sdk_handle_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_handle_migrated(body) VALUES ('from-database-handle-migration');"
      }
    ]), { applied: ["handle-001"], skipped: [] });
    assert.equal((await database.get("SELECT body FROM sdk_handle_migrated"))?.body, "from-database-handle-migration");
    assert.match(await database.dumpSql({ pageSize: 10 }), /sdk_handle_exec/);
    await database.loadSqlDump("CREATE TABLE sdk_handle_loaded(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_handle_loaded(body) VALUES ('from-database-handle-load');", {
      idempotencyKey: `sdk_handle_load_${databaseId}`
    });
    assert.equal((await database.get("SELECT body FROM sdk_handle_loaded"))?.body, "from-database-handle-load");
    assert.equal((await database.inspect({ tableName: "sdk_handle_exec", previewLimit: 1 })).tables[0]?.table.name, "sdk_handle_exec");
    progress("database handle migration and load helpers verified");
    assert.ok((await database.tables()).some((table) => table.name === "sdk_notes"));
    assert.ok((await database.views()).some((table) => table.name === "sdk_notes_view"));
    assert.equal((await database.describe("sdk_notes")).tableName, "sdk_notes");
    assert.ok((await database.columns("sdk_notes")).some((column) => column.name === "body"));
    assert.deepEqual(await database.indexes("sdk_notes"), []);
    assert.deepEqual(await database.triggers("sdk_notes"), []);
    assert.deepEqual(await database.foreignKeys("sdk_notes"), []);
    assert.equal((await database.preview("sdk_notes", { limit: 1 })).tableName, "sdk_notes");
    assert.equal((await database.snapshotInfo(new Uint8Array([4, 5, 6]))).sha256, "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472");
    assert.equal(database.connectionUrl(), `icpdb://${network.canisterId}/${databaseId}`);
    assert.equal(database.url(), database.connectionUrl());
    assert.equal((await database.getUsage()).databaseId, databaseId);
    assert.ok(Array.isArray(await database.listUsageEvents()));
    assert.equal((await database.placement())?.databaseId, databaseId);
    assert.equal((await database.status()).callerPrincipal, identity.getPrincipal().toText());
    assert.equal((await database.listMembers()).some((member) => member.principal === identity.getPrincipal().toText() && member.role === "owner"), true);
    progress("database handle metadata helpers verified");
    const handleSnapshot = await database.archive();
    const handleSnapshotMetadata = await database.snapshotInfo(handleSnapshot);
    progress("database handle archived");
    await assert.rejects(() => database.run("INSERT INTO sdk_notes(body) VALUES (?1)", ["from-database-handle-archived-write"]), /database is archived/);
    progress("database handle archived write rejection verified");
    await database.restore(handleSnapshot, { expectedSha256: handleSnapshotMetadata.sha256 });
    assert.equal((await database.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-database-handle-run"]))?.body, "from-database-handle-run");
    database.close();
    progress("enriched database handle verified");
    assert.equal((await client.getUsage()).databaseId, databaseId);
    assert.equal((await client.placement())?.databaseId, databaseId);
    const earlyStatus = await client.status();
    assert.equal(earlyStatus.databaseId, databaseId);
    assert.equal(earlyStatus.connectionUrl, `icpdb://${network.canisterId}/${databaseId}`);
    assert.equal(earlyStatus.callerPrincipal, identity.getPrincipal().toText());
    assert.equal(earlyStatus.callerRole, "owner", "caller role should match the SDK identity database ACL");
    assert.equal(earlyStatus.usage.databaseId, databaseId);
    assert.equal(earlyStatus.placement?.databaseId, databaseId);
    const serviceEnvPath = join(tempDir, "service.env");
    await writeServiceEnvFile(serviceEnvPath, identityFileEnv(network, serviceIdentity, ""));
    const persistedServiceEnv = await persistIcpdbServiceDatabaseId(serviceEnvPath, databaseId);
    assert.equal(persistedServiceEnv.ICPDB_DATABASE_ID, databaseId);
    assert.equal((await stat(serviceEnvPath)).mode & 0o777, 0o600);
    const servicePrincipal = await loadIcpdbServicePrincipalFromEnvFile(serviceEnvPath);
    assert.equal(servicePrincipal, serviceIdentity.principal);
    const provisionedServiceEnvPath = join(tempDir, "service-provisioned.env");
    const provisionedService = await provisionIcpdbServiceEnvFile(database, provisionedServiceEnvPath, "writer", "ed25519", {
      ICPDB_NETWORK_URL: network.networkUrl,
      ICPDB_ROOT_KEY: network.rootKey
    });
    assert.equal(provisionedService.databaseId, databaseId);
    assert.equal(provisionedService.connectionUrl, formatIcpdbDatabaseUrl(network.canisterId, databaseId));
    assert.equal(provisionedService.env.ICPDB_NETWORK_URL, network.networkUrl);
    assert.equal(provisionedService.env.ICPDB_ROOT_KEY, network.rootKey);
    assert.equal((await stat(provisionedServiceEnvPath)).mode & 0o777, 0o600);
    assert.equal((await client.listMembers()).some((member) => member.principal === provisionedService.principal && member.role === "writer"), true);
    const provisionedServiceClient = await createIcpdbServiceSqlClientFromEnvFile(provisionedServiceEnvPath);
    try {
      assert.equal(await provisionedServiceClient.databaseId(), databaseId);
      assert.equal(await provisionedServiceClient.principal(), provisionedService.principal);
      await provisionedServiceClient.run("INSERT INTO sdk_notes(body) VALUES (?1)", ["from-provisioned-service-env-file"]);
      assert.equal((await provisionedServiceClient.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-provisioned-service-env-file"]))?.body, "from-provisioned-service-env-file");
    } finally {
      provisionedServiceClient.close();
    }
	    await client.revokeMember(provisionedService.principal);
	    progress("provisioned service env client verified");
	    const packageCliOwnerEnvPath = join(tempDir, "package-cli-owner.env");
	    const packageCliProvisionedEnvPath = join(tempDir, "package-cli-provisioned.env");
	    await writeServiceEnvFile(packageCliOwnerEnvPath, {
	      ICPDB_CANISTER_ID: network.canisterId,
	      ICPDB_NETWORK_URL: network.networkUrl,
	      ICPDB_DATABASE_ID: databaseId,
	      ICPDB_IDENTITY_TYPE: "ed25519",
	      ICPDB_IDENTITY_JSON: JSON.stringify(identity.toJSON()),
	      ...(network.rootKey ? { ICPDB_ROOT_KEY: network.rootKey } : {})
	    });
	    const packageCliProvisioned = JSON.parse((await execFileAsync(process.execPath, [
	      packageCliPath,
	      "provision-service",
	      databaseId,
	      "writer",
	      "--service-env-file",
	      packageCliOwnerEnvPath,
	      "--env-out",
	      packageCliProvisionedEnvPath
	    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
	    assert.equal(packageCliProvisioned.databaseId, databaseId);
	    assert.equal(packageCliProvisioned.url, formatIcpdbDatabaseUrl(network.canisterId, databaseId));
	    assert.equal(packageCliProvisioned.role, "writer");
	    assert.match(packageCliProvisioned.principal, /-/);
	    assert.equal((await stat(packageCliProvisionedEnvPath)).mode & 0o777, 0o600);
	    assert.equal((await client.listMembers()).some((member) => member.principal === packageCliProvisioned.principal && member.role === "writer"), true);
	    const packageCliProvisionedStatus = JSON.parse((await execFileAsync(process.execPath, [
	      packageCliPath,
	      "status",
	      "--service-env-file",
	      packageCliProvisionedEnvPath
	    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
	    assert.equal(packageCliProvisionedStatus.databaseId, databaseId);
	    assert.equal(packageCliProvisionedStatus.callerPrincipal, packageCliProvisioned.principal);
	    assert.equal(packageCliProvisionedStatus.callerRole, "writer");
	    await execFileAsync(process.execPath, [
	      packageCliPath,
	      "execute",
	      "INSERT INTO sdk_notes(body) VALUES (?1)",
	      "--params",
	      JSON.stringify(["from-package-cli-provision-service"]),
	      "--idempotency-key",
	      `package-cli-provision-service-${databaseId}`,
	      "--wait",
	      "--service-env-file",
	      packageCliProvisionedEnvPath
	    ], { maxBuffer: 4 * 1024 * 1024 });
	    const packageCliProvisionedRows = JSON.parse((await execFileAsync(process.execPath, [
	      packageCliPath,
	      "query",
	      "SELECT body FROM sdk_notes WHERE body = ?1",
	      "--params",
	      JSON.stringify(["from-package-cli-provision-service"]),
	      "--service-env-file",
	      packageCliProvisionedEnvPath
	    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
	    assert.equal(packageCliProvisionedRows.rows[0]?.body, "from-package-cli-provision-service");
	    await client.revokeMember(packageCliProvisioned.principal);
	    progress("package bin provision-service existing DB verified");
	    const provisionedDatabaseEnvPath = join(tempDir, "service-provisioned-database.env");
    const provisionedDatabase = await provisionIcpdbServiceDatabaseEnvFile({
      canisterId: network.canisterId,
      host: network.networkUrl,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
      identityType: "ed25519",
      identityJson: JSON.stringify(identity.toJSON()),
      setupSql: "CREATE TABLE sdk_provisioned_database(id INTEGER PRIMARY KEY, body TEXT NOT NULL);"
    }, provisionedDatabaseEnvPath, "writer", "ed25519", {
      ICPDB_NETWORK_URL: network.networkUrl,
      ICPDB_ROOT_KEY: network.rootKey
    });
    const provisionedDatabaseClient = await createIcpdbServiceSqlClientFromEnvFile(provisionedDatabaseEnvPath);
    try {
      assert.equal(provisionedDatabase.connectionUrl, formatIcpdbDatabaseUrl(network.canisterId, provisionedDatabase.databaseId));
      assert.equal(await provisionedDatabaseClient.databaseId(), provisionedDatabase.databaseId);
      assert.equal(await provisionedDatabaseClient.principal(), provisionedDatabase.principal);
      await provisionedDatabaseClient.run("INSERT INTO sdk_provisioned_database(body) VALUES (?1)", ["from-provisioned-service-database-env-file"]);
      assert.equal((await provisionedDatabaseClient.get("SELECT body FROM sdk_provisioned_database"))?.body, "from-provisioned-service-database-env-file");
    } finally {
      provisionedDatabaseClient.close();
      await createIcpdbClient({
        canisterId: network.canisterId,
        databaseId: provisionedDatabase.databaseId,
        host: network.networkUrl,
        identity,
        rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined
      }).deleteDatabase(provisionedDatabase.databaseId);
    }
    progress("provisioned service database env client verified");
    const serviceSetupEnvPath = join(tempDir, "service-setup.env");
    await writeServiceEnvFile(serviceSetupEnvPath, {
      ...identityFileEnv(network, serviceIdentity, ""),
      ICPDB_SETUP_SQL: "CREATE TABLE sdk_service_setup(id INTEGER PRIMARY KEY, body TEXT NOT NULL);",
      ICPDB_SETUP_STATEMENTS: JSON.stringify([
        { sql: "INSERT INTO sdk_service_setup(body) VALUES (:body)", args: { body: "from-service-setup-statements" } }
      ]),
      ICPDB_SETUP_MIGRATIONS: JSON.stringify([
        {
          version: "service-setup-001",
          name: "create_service_setup_migrated",
          sql: "CREATE TABLE sdk_service_setup_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_service_setup_migrated(body) VALUES ('from-service-setup-migration');"
        }
      ])
    });
    const serviceSetupClient = await createIcpdbServiceSqlClientFromEnvFile(serviceSetupEnvPath);
    try {
      assert.equal((await serviceSetupClient.get("SELECT body FROM sdk_service_setup_migrated"))?.body, "from-service-setup-migration");
      assert.equal((await serviceSetupClient.get("SELECT body FROM sdk_service_setup"))?.body, "from-service-setup-statements");
      await serviceSetupClient.delete();
    } finally {
      serviceSetupClient.close();
    }
    progress("inline service setup verified");
    const serviceSetupSqlPath = join(tempDir, "service-schema.sql");
    const serviceSetupStatementsPath = join(tempDir, "service-statements.json");
    const serviceSetupMigrationsPath = join(tempDir, "service-migrations.json");
    await writeFile(serviceSetupSqlPath, "CREATE TABLE sdk_service_file_setup(id INTEGER PRIMARY KEY, body TEXT NOT NULL);");
    await writeFile(serviceSetupStatementsPath, JSON.stringify([
      { sql: "INSERT INTO sdk_service_file_setup(body) VALUES (:body)", args: { body: "from-service-file-setup-statements" } }
    ]));
    await writeFile(serviceSetupMigrationsPath, JSON.stringify([
      {
        version: "service-file-setup-001",
        name: "create_service_file_setup_migrated",
        sql: "CREATE TABLE sdk_service_file_setup_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_service_file_setup_migrated(body) VALUES ('from-service-file-setup-migration');"
      }
    ]));
    const serviceFileSetupEnvPath = join(tempDir, "service-file-setup.env");
    await writeServiceEnvFile(serviceFileSetupEnvPath, {
      ...identityFileEnv(network, serviceIdentity, ""),
      ICPDB_SETUP_SQL_FILE: serviceSetupSqlPath,
      ICPDB_SETUP_STATEMENTS_FILE: serviceSetupStatementsPath,
      ICPDB_SETUP_MIGRATIONS_FILE: serviceSetupMigrationsPath
    });
    const serviceFileSetup = await loadIcpdbServiceSetupFromEnvFile(serviceFileSetupEnvPath);
    assert.match(serviceFileSetup.setupSql ?? "", /sdk_service_file_setup/);
    const serviceFileSetupClient = await createIcpdbServiceSqlClientFromEnvFile(serviceFileSetupEnvPath);
    try {
      assert.equal((await serviceFileSetupClient.get("SELECT body FROM sdk_service_file_setup_migrated"))?.body, "from-service-file-setup-migration");
      assert.equal((await serviceFileSetupClient.get("SELECT body FROM sdk_service_file_setup"))?.body, "from-service-file-setup-statements");
      await serviceFileSetupClient.delete();
    } finally {
      serviceFileSetupClient.close();
    }
    progress("file-backed service setup verified");
    const packageCliGeneratedEnvPath = join(tempDir, "package-cli-generated.env");
    await execFileAsync(process.execPath, [
      packageCliPath,
      "generate-identity",
      "--canister-id",
      network.canisterId,
      "--network-url",
      network.networkUrl,
      ...(network.rootKey ? ["--root-key", network.rootKey] : []),
      "--env-out",
      packageCliGeneratedEnvPath,
      "--format",
      "table"
    ], { maxBuffer: 4 * 1024 * 1024 });
    assert.equal((await stat(packageCliGeneratedEnvPath)).mode & 0o777, 0o600);
    const packageCliGeneratedInspection = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "inspect-env",
      "--service-env-file",
      packageCliGeneratedEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliGeneratedInspection.canisterId, network.canisterId);
    assert.equal(packageCliGeneratedInspection.databaseId, undefined);
    assert.equal(packageCliGeneratedInspection.networkUrl, network.networkUrl);
    assert.match(packageCliGeneratedInspection.principal, /-/);
    const packageCliScalarEnvPath = join(tempDir, "package-cli-scalar-first.env");
    await execFileAsync(process.execPath, [
      packageCliPath,
      "generate-identity",
      "--canister-id",
      network.canisterId,
      "--network-url",
      network.networkUrl,
      ...(network.rootKey ? ["--root-key", network.rootKey] : []),
      "--env-out",
      packageCliScalarEnvPath,
      "--format",
      "table"
    ], { maxBuffer: 4 * 1024 * 1024 });
    assert.equal((await stat(packageCliScalarEnvPath)).mode & 0o777, 0o600);
    const packageCliScalar = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "scalar",
      "SELECT 1 AS value",
      "--service-env-file",
      packageCliScalarEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliScalar.value, "1");
    const packageCliScalarInspection = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "inspect-env",
      "--service-env-file",
      packageCliScalarEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliScalarInspection.canisterId, network.canisterId);
    assert.equal(packageCliScalarInspection.networkUrl, network.networkUrl);
    assert.equal(typeof packageCliScalarInspection.databaseId, "string");
    assert.equal(packageCliScalarInspection.connectionUrl, formatIcpdbDatabaseUrl(network.canisterId, packageCliScalarInspection.databaseId));
    const packageCliScalarCreate = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "execute",
      "CREATE TABLE package_cli_scalar_first(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
      "--service-env-file",
      packageCliScalarEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliScalarCreate.rowsAffected, 0);
    const packageCliScalarWrite = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "execute",
      "INSERT INTO package_cli_scalar_first(body) VALUES (?1)",
      "--params",
      "[\"from-package-cli-scalar-first\"]",
      "--idempotency-key",
      `package-cli-scalar-first-write-${packageCliScalarInspection.databaseId}`,
      "--wait",
      "--service-env-file",
      packageCliScalarEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliScalarWrite.result.rowsAffected, 1);
    const packageCliScalarRows = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "query",
      "SELECT body FROM package_cli_scalar_first ORDER BY id DESC LIMIT 1",
      "--service-env-file",
      packageCliScalarEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliScalarRows.rows[0]?.body, "from-package-cli-scalar-first");
    const packageCliScalarUrlEnv = (await execFileAsync(process.execPath, [
      packageCliPath,
      "url",
      "--format",
      "env",
      "--service-env-file",
      packageCliScalarEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    assert.match(packageCliScalarUrlEnv, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(packageCliScalarInspection.databaseId)}`));
    assert.match(packageCliScalarUrlEnv, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, packageCliScalarInspection.databaseId))}`));
    const packageCliScalarInfoEnv = (await execFileAsync(process.execPath, [
      packageCliPath,
      "info",
      "--format",
      "env",
      "--service-env-file",
      packageCliScalarEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    assert.match(packageCliScalarInfoEnv, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(packageCliScalarInspection.databaseId)}`));
    assert.match(packageCliScalarInfoEnv, new RegExp(`ICPDB_CONNECTION_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, packageCliScalarInspection.databaseId))}`));
    const packageCliScalarEnvText = await readFile(packageCliScalarEnvPath, "utf8");
    assert.match(packageCliScalarEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(packageCliScalarInspection.databaseId)}`));
    assert.match(packageCliScalarEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, packageCliScalarInspection.databaseId))}`));
    await execFileAsync(process.execPath, [
      packageCliPath,
      "delete-db",
      "--confirm",
      packageCliScalarInspection.databaseId,
      "--service-env-file",
      packageCliScalarEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 });
    progress("package bin canister-only scalar first execute/query handoff verified");
    const packageCliGeneratedCreated = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "create-db",
      "--setup-sql",
      "CREATE TABLE package_cli_generated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO package_cli_generated(body) VALUES ('from-package-cli-generated')",
      "--service-env-file",
      packageCliGeneratedEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    const packageCliGeneratedDatabaseId = packageCliGeneratedCreated.databaseId;
    assert.equal(typeof packageCliGeneratedDatabaseId, "string");
    const packageCliGeneratedRows = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "query",
      "SELECT body FROM package_cli_generated",
      "--service-env-file",
      packageCliGeneratedEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliGeneratedRows.rows[0]?.body, "from-package-cli-generated");
    const packageCliGeneratedCheck = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "check-env",
      "--require-role",
      "owner",
      "--smoke-sql",
      "--smoke-archive-restore",
      "--service-env-file",
      packageCliGeneratedEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliGeneratedCheck.callerRole, "owner");
    assert.equal(packageCliGeneratedCheck.sqlSmoke?.selectedBody.startsWith("package-check-"), true);
    assert.ok(packageCliGeneratedCheck.checks.includes("sql_cleanup"));
    assert.equal(packageCliGeneratedCheck.archiveRestoreSmoke?.selectedBody.startsWith("package-archive-"), true);
    assert.match(packageCliGeneratedCheck.archiveRestoreSmoke?.snapshotHash, /^[0-9a-f]{64}$/);
    assert.ok(packageCliGeneratedCheck.checks.includes("archive_restore_cleanup"));
    await execFileAsync(process.execPath, [
      packageCliPath,
      "delete-db",
      "--confirm",
      packageCliGeneratedDatabaseId,
      "--service-env-file",
      packageCliGeneratedEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 });
    progress("package bin generate-identity quickstart and check-env verified");
    const packageCliInitEnvPath = join(tempDir, "package-cli-init.env");
    const packageCliInitCreated = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "init",
      "--canister-id",
      network.canisterId,
      "--network-url",
      network.networkUrl,
      ...(network.rootKey ? ["--root-key", network.rootKey] : []),
      "--env-out",
      packageCliInitEnvPath,
      "--setup-sql",
      "CREATE TABLE package_cli_init(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO package_cli_init(body) VALUES ('from-package-cli-init')"
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal((await stat(packageCliInitEnvPath)).mode & 0o777, 0o600);
    assert.equal(packageCliInitCreated.canisterId, network.canisterId);
    assert.equal(typeof packageCliInitCreated.databaseId, "string");
    assert.match(packageCliInitCreated.principal, /-/);
    const packageCliInitEnvText = await readFile(packageCliInitEnvPath, "utf8");
    assert.match(packageCliInitEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(packageCliInitCreated.databaseId)}`));
    assert.match(packageCliInitEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(packageCliInitCreated.databaseId)}`));
    const packageCliInitRows = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "query",
      "SELECT body FROM package_cli_init",
      "--service-env-file",
      packageCliInitEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliInitRows.rows[0]?.body, "from-package-cli-init");
    const packageCliInitInspection = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "inspect",
      "package_cli_init",
      "--service-env-file",
      packageCliInitEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliInitInspection.tables[0]?.table.name, "package_cli_init");
    await execFileAsync(process.execPath, [
      packageCliPath,
      "delete-db",
      "--confirm",
      packageCliInitCreated.databaseId,
      "--service-env-file",
      packageCliInitEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 });
    progress("package bin init quickstart verified");
    const packageCliInlineEnvPath = join(tempDir, "package-cli-inline.env");
    await writeServiceEnvFile(packageCliInlineEnvPath, identityFileEnv(network, serviceIdentity, ""));
    const packageCliInlineCreated = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "create-db",
      "--setup-sql",
      "CREATE TABLE package_cli_inline(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
      "--service-env-file",
      packageCliInlineEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    const packageCliInlineDatabaseId = packageCliInlineCreated.databaseId;
    assert.equal(typeof packageCliInlineDatabaseId, "string");
    const packageCliInlineEnvText = await readFile(packageCliInlineEnvPath, "utf8");
    assert.match(packageCliInlineEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(packageCliInlineDatabaseId)}`));
    await execFileAsync(process.execPath, [
      packageCliPath,
      "execute",
      "INSERT INTO package_cli_inline(body) VALUES (?1)",
      "--params",
      JSON.stringify(["from-package-cli-inline"]),
      "--idempotency-key",
      `package-cli-inline-${packageCliInlineDatabaseId}`,
      "--wait",
      "--service-env-file",
      packageCliInlineEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 });
    const packageCliInlineRows = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "query",
      "SELECT body FROM package_cli_inline",
      "--service-env-file",
      packageCliInlineEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliInlineRows.rows[0]?.body, "from-package-cli-inline");
    await execFileAsync(process.execPath, [
      packageCliPath,
      "delete-db",
      "--confirm",
      packageCliInlineDatabaseId,
      "--service-env-file",
      packageCliInlineEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 });
    progress("package bin inline create-db setup verified");
    const packageCliStatementsEnvPath = join(tempDir, "package-cli-statements.env");
    const packageCliStatementsPath = join(tempDir, "package-cli-statements.json");
    await writeServiceEnvFile(packageCliStatementsEnvPath, identityFileEnv(network, serviceIdentity, ""));
    await writeFile(packageCliStatementsPath, JSON.stringify([
      { sql: "CREATE TABLE package_cli_statements(id INTEGER PRIMARY KEY, body TEXT NOT NULL)" },
      { sql: "INSERT INTO package_cli_statements(body) VALUES (:body)", args: { body: "from-package-cli-setup-statements" } },
      { sql: "CREATE VIEW package_cli_statements_view AS SELECT id, body FROM package_cli_statements" }
    ]));
    const packageCliStatementsCreated = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "create-db",
      "--setup-statements-file",
      packageCliStatementsPath,
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    const packageCliStatementsDatabaseId = packageCliStatementsCreated.databaseId;
    assert.equal(typeof packageCliStatementsDatabaseId, "string");
    const packageCliStatementsEnvText = await readFile(packageCliStatementsEnvPath, "utf8");
    assert.match(packageCliStatementsEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(packageCliStatementsDatabaseId)}`));
    assert.match(packageCliStatementsEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, packageCliStatementsDatabaseId))}`));
    const packageCliStatementsRows = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "query",
      "SELECT body FROM package_cli_statements",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliStatementsRows.rows[0]?.body, "from-package-cli-setup-statements");
    const packageCliArchivePath = join(tempDir, "package-cli-backup.sqlite");
    const packageCliArchive = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "archive",
      packageCliArchivePath,
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliArchive.databaseId, packageCliStatementsDatabaseId);
    assert.equal(packageCliArchive.filePath, packageCliArchivePath);
    assert.equal(typeof packageCliArchive.sha256, "string");
    assert.match(packageCliArchive.sha256, /^[0-9a-f]{64}$/);
    const packageCliSnapshotInfo = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "snapshot-info",
      packageCliArchivePath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliSnapshotInfo.sha256, packageCliArchive.sha256);
    assert.equal(packageCliSnapshotInfo.sizeBytes, packageCliArchive.sizeBytes);
    const packageCliRestore = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "restore",
      packageCliArchivePath,
      "--expect-snapshot-hash",
      packageCliSnapshotInfo.sha256,
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliRestore.sha256, packageCliArchive.sha256);
    const packageCliRestoredRows = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "query",
      "SELECT body FROM package_cli_statements",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliRestoredRows.rows[0]?.body, "from-package-cli-setup-statements");
    const packageCliPostRestoreTables = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "tables",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.ok(packageCliPostRestoreTables.some((table) => table.name === "package_cli_statements"));
    const packageCliPostRestoreViews = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "views",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.ok(packageCliPostRestoreViews.some((view) => view.name === "package_cli_statements_view"));
    const packageCliPostRestoreSchema = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "schema",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.match(packageCliPostRestoreSchema.schema, /CREATE TABLE package_cli_statements/);
    assert.match(packageCliPostRestoreSchema.schema, /CREATE VIEW package_cli_statements_view/);
    const packageCliPostRestoreInspect = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "inspect",
      "package_cli_statements",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliPostRestoreInspect.tables[0]?.table.name, "package_cli_statements");
    assert.match(packageCliPostRestoreInspect.schema, /CREATE TABLE package_cli_statements/);
    const packageCliPostRestoreStats = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "stats",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliPostRestoreStats.databaseId, packageCliStatementsDatabaseId);
    assert.match(JSON.stringify(packageCliPostRestoreStats.tableStatuses), /package_cli_statements/);
    const packageCliPostRestoreStatus = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "status",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliPostRestoreStatus.databaseId, packageCliStatementsDatabaseId);
    const packageCliPostRestoreMembers = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "members",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.ok(packageCliPostRestoreMembers.some((member) => member.principal === serviceIdentity.principal && member.role === "owner"));
    const packageCliPostRestoreUrlEnv = (await execFileAsync(process.execPath, [
      packageCliPath,
      "url",
      "--format",
      "env",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    assert.match(packageCliPostRestoreUrlEnv, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, packageCliStatementsDatabaseId))}`));
    const packageCliPostRestoreInfoEnv = (await execFileAsync(process.execPath, [
      packageCliPath,
      "info",
      "--format",
      "env",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    assert.match(packageCliPostRestoreInfoEnv, new RegExp(`ICPDB_CONNECTION_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, packageCliStatementsDatabaseId))}`));
    const packageCliShellTables = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "shell",
      ".tables",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.ok(packageCliShellTables.some((table) => table.name === "package_cli_statements"));
    const packageCliShellSchema = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "shell",
      ".schema package_cli_statements",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.match(packageCliShellSchema.schema, /CREATE TABLE package_cli_statements/);
    const packageCliShellStatus = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "shell",
      ".status",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliShellStatus.databaseId, packageCliStatementsDatabaseId);
    const packageCliShellInfo = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "shell",
      ".info",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliShellInfo.databaseId, packageCliStatementsDatabaseId);
    assert.equal(packageCliShellInfo.connectionUrl, formatIcpdbDatabaseUrl(network.canisterId, packageCliStatementsDatabaseId));
    assert.equal(packageCliShellInfo.url, packageCliShellInfo.connectionUrl);
    const packageCliShellSelect = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "shell",
      "SELECT body FROM package_cli_statements",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliShellSelect.rows[0]?.body, "from-package-cli-setup-statements");
    const packageCliShellInsert = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "shell",
      "INSERT INTO package_cli_statements(body) VALUES ('from-package-cli-shell')",
      "--wait",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliShellInsert.result.rowsAffected, 1);
    assert.ok(packageCliShellInsert.routedOperations.length >= 1, "package shell --wait should return routed operation status");
    for (const operation of packageCliShellInsert.routedOperations) {
      assert.equal(operation.databaseId, packageCliStatementsDatabaseId);
      assert.equal(operation.status, "applied");
      assert.match(operation.operationId, /^icpdb-shell-/);
    }
    const packageCliShellInserted = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "query",
      "SELECT body FROM package_cli_statements WHERE body = 'from-package-cli-shell'",
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliShellInserted.rows[0]?.body, "from-package-cli-shell");
    await execFileAsync(process.execPath, [
      packageCliPath,
      "delete-db",
      "--confirm",
      packageCliStatementsDatabaseId,
      "--service-env-file",
      packageCliStatementsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 });
    const packageCliMigrationsEnvPath = join(tempDir, "package-cli-migrations.env");
    const packageCliMigrationsPath = join(tempDir, "package-cli-migrations.json");
    await writeServiceEnvFile(packageCliMigrationsEnvPath, identityFileEnv(network, serviceIdentity, ""));
    await writeFile(packageCliMigrationsPath, JSON.stringify([{
      version: "package-cli-setup-001",
      name: "create_package_cli_migrated",
      sql: "CREATE TABLE package_cli_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO package_cli_migrated(body) VALUES ('from-package-cli-setup-migration');"
    }]));
    const packageCliMigrationsCreated = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "create-db",
      "--setup-migrations-file",
      packageCliMigrationsPath,
      "--service-env-file",
      packageCliMigrationsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    const packageCliMigrationsDatabaseId = packageCliMigrationsCreated.databaseId;
    assert.equal(typeof packageCliMigrationsDatabaseId, "string");
    const packageCliMigrationsRows = JSON.parse((await execFileAsync(process.execPath, [
      packageCliPath,
      "query",
      "SELECT body FROM package_cli_migrated",
      "--service-env-file",
      packageCliMigrationsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 })).stdout);
    assert.equal(packageCliMigrationsRows.rows[0]?.body, "from-package-cli-setup-migration");
    await execFileAsync(process.execPath, [
      packageCliPath,
      "delete-db",
      "--confirm",
      packageCliMigrationsDatabaseId,
      "--service-env-file",
      packageCliMigrationsEnvPath
    ], { maxBuffer: 4 * 1024 * 1024 });
    progress("package bin create-db setup, shell, and archive/restore verified");
    const persistedServiceEnvPath = join(tempDir, "service-persisted.env");
    await writeServiceEnvFile(persistedServiceEnvPath, {
      ...identityFileEnv(network, serviceIdentity, ""),
      ICPDB_SETUP_SQL: "CREATE TABLE sdk_persisted_service_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL);"
    });
    const persistedServiceClient = await createIcpdbPersistedServiceSqlClientFromEnvFile(persistedServiceEnvPath);
    try {
      await persistedServiceClient.run("INSERT INTO sdk_persisted_service_notes(body) VALUES (?1)", ["from-persisted-service-client"]);
      assert.equal((await persistedServiceClient.get("SELECT body FROM sdk_persisted_service_notes"))?.body, "from-persisted-service-client");
      const persistedDatabaseId = await persistedServiceClient.databaseId();
      const persistedServiceEnvText = await readFile(persistedServiceEnvPath, "utf8");
      assert.match(persistedServiceEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(persistedDatabaseId)}`));
      assert.match(persistedServiceEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, persistedDatabaseId))}`));
      persistedServiceClient.close();
      assert.equal(await persistedServiceClient.databaseId(), persistedDatabaseId);
      await persistedServiceClient.run("INSERT INTO sdk_persisted_service_notes(body) VALUES (?1)", ["after-persisted-service-reconnect"]);
      assert.equal((await persistedServiceClient.get("SELECT body FROM sdk_persisted_service_notes WHERE body = ?1", ["after-persisted-service-reconnect"]))?.body, "after-persisted-service-reconnect");
      await persistedServiceClient.delete();
    } finally {
      persistedServiceClient.close();
    }
    progress("persisted service setup verified");
    const shortPersistedServiceEnvPath = join(tempDir, "service-short-persisted.env");
    await writeServiceEnvFile(shortPersistedServiceEnvPath, {
      ...identityFileEnv(network, serviceIdentity, ""),
      ICPDB_SETUP_SQL: `
        CREATE TABLE sdk_short_persisted_service_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
        INSERT INTO sdk_short_persisted_service_notes(body) VALUES ('from-short-persisted-service-first-read');
      `
    });
    const shortPersistedServiceClient = await createClientFromEnvFile(shortPersistedServiceEnvPath);
    try {
      assert.equal((await shortPersistedServiceClient.get("SELECT body FROM sdk_short_persisted_service_notes"))?.body, "from-short-persisted-service-first-read");
      assert.equal(await shortPersistedServiceClient.scalar("SELECT count(*) FROM sdk_short_persisted_service_notes"), "1");
      const shortPersistedDatabaseId = await shortPersistedServiceClient.databaseId();
      const shortPersistedServiceEnvText = await readFile(shortPersistedServiceEnvPath, "utf8");
      assert.match(shortPersistedServiceEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(shortPersistedDatabaseId)}`));
      assert.match(shortPersistedServiceEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, shortPersistedDatabaseId))}`));
      await shortPersistedServiceClient.delete();
    } finally {
      shortPersistedServiceClient.close();
    }
    progress("short persisted service first-read setup verified");
    const shortPersistedQueryOnlyEnvPath = join(tempDir, "service-short-persisted-query-only.env");
    await writeServiceEnvFile(shortPersistedQueryOnlyEnvPath, identityFileEnv(network, serviceIdentity, ""));
    const shortPersistedQueryOnlyClient = await createClientFromEnvFile(shortPersistedQueryOnlyEnvPath);
    try {
      assert.equal(await shortPersistedQueryOnlyClient.scalar("SELECT 1 AS value"), "1");
      const shortPersistedQueryOnlyDatabaseId = await shortPersistedQueryOnlyClient.databaseId();
      assert.equal(parseIcpdbDatabaseUrl(await shortPersistedQueryOnlyClient.connectionUrl()).databaseId, shortPersistedQueryOnlyDatabaseId);
      const shortPersistedQueryOnlyEnvText = await readFile(shortPersistedQueryOnlyEnvPath, "utf8");
      assert.match(shortPersistedQueryOnlyEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(shortPersistedQueryOnlyDatabaseId)}`));
      assert.match(shortPersistedQueryOnlyEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, shortPersistedQueryOnlyDatabaseId))}`));
      await shortPersistedQueryOnlyClient.delete();
    } finally {
      shortPersistedQueryOnlyClient.close();
    }
    progress("short persisted service query-only first DB creation verified");
    const shortPersistedInfoEnvPath = join(tempDir, "service-short-persisted-info.env");
    await writeServiceEnvFile(shortPersistedInfoEnvPath, {
      ...identityFileEnv(network, serviceIdentity, ""),
      ICPDB_SETUP_SQL: "CREATE TABLE sdk_short_persisted_info_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL);"
    });
    const shortPersistedInfoClient = await createClientFromEnvFile(shortPersistedInfoEnvPath);
    try {
      const info = await shortPersistedInfoClient.info();
      assert.equal(parseIcpdbDatabaseUrl(info.connectionUrl).canisterId, network.canisterId);
      assert.equal(info.url, info.connectionUrl);
      assert.equal(info.principal, serviceIdentity.principal);
      assert.equal(await shortPersistedInfoClient.databaseId(), info.databaseId);
      assert.equal(await shortPersistedInfoClient.scalar("SELECT count(*) FROM sdk_short_persisted_info_notes"), "0");
      const shortPersistedInfoEnvText = await readFile(shortPersistedInfoEnvPath, "utf8");
      assert.match(shortPersistedInfoEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(info.databaseId)}`));
      assert.match(shortPersistedInfoEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(info.connectionUrl)}`));
      assert.doesNotMatch(shortPersistedInfoEnvText, /ICPDB_SETUP_SQL/);
      await shortPersistedInfoClient.delete();
    } finally {
      shortPersistedInfoClient.close();
    }
    progress("short persisted service info-first handoff verified");
    const defaultPersistedServiceDir = await mkdtemp(join(tempDir, "default-service-env-"));
    const defaultPersistedServiceEnvPath = join(defaultPersistedServiceDir, "service.env");
    await writeServiceEnvFile(defaultPersistedServiceEnvPath, identityFileEnv(network, serviceIdentity, ""));
    const previousCwdForDefaultService = process.cwd();
    process.chdir(defaultPersistedServiceDir);
    const defaultPersistedServiceClient = await createClientFromEnvFile();
    try {
      await defaultPersistedServiceClient.execute("CREATE TABLE sdk_default_service_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
      await defaultPersistedServiceClient.run("INSERT INTO sdk_default_service_notes(body) VALUES (?1)", ["from-default-service-first-sql"]);
      const defaultPersistedDatabaseId = await defaultPersistedServiceClient.databaseId();
      const defaultPersistedServiceEnvText = await readFile(defaultPersistedServiceEnvPath, "utf8");
      assert.match(defaultPersistedServiceEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(defaultPersistedDatabaseId)}`));
      assert.match(defaultPersistedServiceEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, defaultPersistedDatabaseId))}`));
      defaultPersistedServiceClient.close();
      const defaultReopenedServiceClient = await createClientFromEnvFile();
      try {
        assert.equal(await defaultReopenedServiceClient.databaseId(), defaultPersistedDatabaseId);
        assert.equal((await defaultReopenedServiceClient.get("SELECT body FROM sdk_default_service_notes"))?.body, "from-default-service-first-sql");
        await defaultReopenedServiceClient.delete();
      } finally {
        defaultReopenedServiceClient.close();
      }
    } finally {
      defaultPersistedServiceClient.close();
      process.chdir(previousCwdForDefaultService);
    }
    progress("default cwd service env first SQL creation verified");
    await client.grantMember(servicePrincipal, "writer");
    assert.equal((await client.listMembers()).some((member) => member.principal === servicePrincipal && member.role === "writer"), true);
    const serviceClient = await createIcpdbServiceSqlClientFromEnvFile(serviceEnvPath);
    try {
      assert.equal(await serviceClient.databaseId(), databaseId);
      await serviceClient.execute({ sql: "INSERT INTO sdk_notes(body) VALUES (?1)", args: ["from-service-env-file"] });
      const serviceResult = await serviceClient.query({
        sql: "SELECT body FROM sdk_notes WHERE body = ?1",
        args: ["from-service-env-file"]
      });
      assert.equal(serviceResult.rows[0]?.body, "from-service-env-file");
    } finally {
      serviceClient.close();
    }
    const originalCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const defaultServiceFileClient = await createClientFromEnvFile();
      try {
        assert.equal(await defaultServiceFileClient.databaseId(), databaseId);
        await defaultServiceFileClient.run("INSERT INTO sdk_notes(body) VALUES (?1)", ["from-default-service-env-file"]);
        assert.equal((await defaultServiceFileClient.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-default-service-env-file"]))?.body, "from-default-service-env-file");
      } finally {
        defaultServiceFileClient.close();
      }
      const defaultServiceFileDb = await connectDatabaseFromEnvFile();
      try {
        assert.equal(defaultServiceFileDb.databaseId, databaseId);
        await defaultServiceFileDb.run("INSERT INTO sdk_notes(body) VALUES (?1)", ["from-default-service-db-env-file"]);
        assert.equal((await defaultServiceFileDb.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-default-service-db-env-file"]))?.body, "from-default-service-db-env-file");
      } finally {
        defaultServiceFileDb.close();
      }
      const defaultConnectedServiceFileClient = await connectClientFromEnvFile();
      try {
        assert.equal(await defaultConnectedServiceFileClient.databaseId(), databaseId);
        assert.equal((await defaultConnectedServiceFileClient.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-default-service-env-file"]))?.body, "from-default-service-env-file");
      } finally {
        defaultConnectedServiceFileClient.close();
      }
    } finally {
      process.chdir(originalCwd);
    }
    progress("default service env client verified; database aliases verified");
    const shortServiceClient = await createClientFromEnv(identityFileEnv(network, serviceIdentity, databaseId));
    try {
      assert.equal(await shortServiceClient.databaseId(), databaseId);
      assert.equal((await shortServiceClient.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-service-env-file"]))?.body, "from-service-env-file");
    } finally {
      shortServiceClient.close();
    }
    const connectedShortServiceClient = await connectClientFromEnv(identityFileEnv(network, serviceIdentity, databaseId));
    try {
      assert.equal(await connectedShortServiceClient.databaseId(), databaseId);
      assert.equal((await connectedShortServiceClient.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-service-env-file"]))?.body, "from-service-env-file");
    } finally {
      connectedShortServiceClient.close();
    }
    progress("granted service env client verified; connect alias verified");
    const shortServiceEnvPath = join(tempDir, "service-short.env");
    await writeServiceEnvFile(shortServiceEnvPath, {
      ...identityFileEnv(network, serviceIdentity, ""),
      ICPDB_SETUP_SQL: "CREATE TABLE sdk_short_service_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL);"
    });
    const shortServiceFileClient = await createClientFromEnvFile(shortServiceEnvPath);
    try {
      await shortServiceFileClient.run("INSERT INTO sdk_short_service_notes(body) VALUES (?1)", ["from-short-service-env-file"]);
      assert.equal((await shortServiceFileClient.get("SELECT body FROM sdk_short_service_notes"))?.body, "from-short-service-env-file");
      const shortServiceDatabaseId = await shortServiceFileClient.databaseId();
      const shortServiceEnvText = await readFile(shortServiceEnvPath, "utf8");
      assert.match(shortServiceEnvText, new RegExp(`ICPDB_DATABASE_ID=.*${escapeRegExp(shortServiceDatabaseId)}`));
      assert.match(shortServiceEnvText, new RegExp(`ICPDB_URL=.*${escapeRegExp(formatIcpdbDatabaseUrl(network.canisterId, shortServiceDatabaseId))}`));
      const shortConnectedServiceFileClient = await connectClientFromEnvFile(shortServiceEnvPath);
      try {
        assert.equal(await shortConnectedServiceFileClient.databaseId(), shortServiceDatabaseId);
        assert.equal((await shortConnectedServiceFileClient.get("SELECT body FROM sdk_short_service_notes"))?.body, "from-short-service-env-file");
      } finally {
        shortConnectedServiceFileClient.close();
      }
      await shortServiceFileClient.delete();
    } finally {
      shortServiceFileClient.close();
    }
    progress("short service env client verified; connect file alias verified");
    const shortServiceCreateEnvPath = join(tempDir, "service-short-create.env");
    await writeServiceEnvFile(shortServiceCreateEnvPath, {
      ...identityFileEnv(network, serviceIdentity, ""),
      ICPDB_SETUP_SQL: "CREATE TABLE sdk_short_service_db_notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL);"
    });
    const shortServiceDb = await createDatabaseFromEnvFile(shortServiceCreateEnvPath);
    try {
      await shortServiceDb.run("INSERT INTO sdk_short_service_db_notes(body) VALUES (?1)", ["from-short-service-db-env-file"]);
      assert.equal((await shortServiceDb.get("SELECT body FROM sdk_short_service_db_notes"))?.body, "from-short-service-db-env-file");
      await persistIcpdbServiceDatabaseId(shortServiceCreateEnvPath, shortServiceDb.databaseId);
      const shortServiceBackupPath = join(tempDir, "service-short-backup.sqlite");
      const shortServiceArchive = await archiveDatabaseToFileFromEnvFile(shortServiceBackupPath, { envPath: shortServiceCreateEnvPath });
      const shortServiceSnapshot = await snapshotInfoFile(shortServiceBackupPath);
      assert.equal(shortServiceSnapshot.sha256, shortServiceArchive.sha256);
      await restoreDatabaseFromFileFromEnvFile(shortServiceBackupPath, {
        envPath: shortServiceCreateEnvPath,
        expectedSha256: shortServiceSnapshot.sha256
      });
      const shortServiceEnv = {
        ...identityFileEnv(network, serviceIdentity, shortServiceDb.databaseId)
      };
      const shortProcessEnvBackupPath = join(tempDir, "service-short-process-env-backup.sqlite");
      const shortProcessEnvArchive = await archiveDatabaseToFileFromEnv(shortProcessEnvBackupPath, { env: shortServiceEnv });
      const shortProcessEnvSnapshot = await snapshotInfoFile(shortProcessEnvBackupPath);
      assert.equal(shortProcessEnvArchive.sha256, shortProcessEnvSnapshot.sha256);
      await restoreDatabaseFromFileFromEnv(shortProcessEnvBackupPath, {
        env: shortServiceEnv,
        expectedSha256: shortProcessEnvArchive.sha256
      });
      assert.equal((await shortServiceDb.get("SELECT body FROM sdk_short_service_db_notes"))?.body, "from-short-service-db-env-file");
      await shortServiceDb.delete();
    } finally {
      shortServiceDb.close();
    }
    progress("short service env database and backup aliases verified");
    await client.revokeMember(servicePrincipal);
    assert.equal((await client.listMembers()).some((member) => member.principal === servicePrincipal), false);
    progress("SQL facade verification started");
    await client.execute({ sql: "INSERT INTO sdk_notes(body) VALUES (?1)", args: ["from-sdk"] });
    await client.execute({ sql: "INSERT INTO sdk_notes(body) VALUES (:body)", args: { body: "from-named-args" } });
    await client.execute({ sql: "INSERT INTO sdk_notes(body) VALUES (:body)", params: { body: "from-named-params" } });
    const idempotentWriteKey = `sdk_retry_insert_${databaseId}`;
    const idempotentWrite = await client.execute({
      sql: "INSERT INTO sdk_notes(body) VALUES (?1)",
      args: ["from-idempotent-write"],
      idempotencyKey: idempotentWriteKey
    });
    assert.equal(idempotentWrite.routedOperationId, idempotentWriteKey);
    assert.equal((await client.waitForRoutedOperation(idempotentWriteKey, { intervalMs: 0, timeoutMs: 5000 })).status, "applied");
    const result = await client.execute({ sql: "SELECT body FROM sdk_notes WHERE body = ?1", args: ["from-sdk"] });
    assert.equal(result.rows[0]?.body, "from-sdk");
    assert.deepEqual(result.columnTypes, ["text"]);
    const namedResult = await client.query("SELECT body FROM sdk_notes WHERE body = :body", { body: "from-named-args" });
    assert.equal(namedResult.rows[0]?.body, "from-named-args");
    const namedParamsResult = await client.query({ sql: "SELECT body FROM sdk_notes WHERE body = :body", params: { body: "from-named-params" } });
    assert.equal(namedParamsResult.rows[0]?.body, "from-named-params");
    const booleanRead = await client.queryOne({ sql: "SELECT ?1 AS enabled, ?2 AS disabled", args: [true, false] });
    assert.equal(booleanRead?.enabled, "1");
    assert.equal(booleanRead?.disabled, "0");
    progress("SQL facade basic execute/query verified");
    const numberIntClient = createLibsqlClient({
      url: `icpdb://${network.canisterId}/${databaseId}`,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
      intMode: "number"
    });
    const bigintIntClient = createTursoLikeClient({
      url: `icpdb://${network.canisterId}/${databaseId}`,
      host: network.networkUrl,
      identity,
      rootKey: network.rootKey ? hexToBytes(network.rootKey) : undefined,
      intMode: "bigint"
    });
    try {
      assert.equal((await numberIntClient.get("SELECT 7 AS value"))?.value, 7);
      const bigintIntResult = await bigintIntClient.execute("SELECT 7 AS value");
      assert.equal(bigintIntResult.rows[0]?.value, 7n);
      assert.equal(bigintIntResult.toJSON().rows[0]?.value, "7");
      await assert.rejects(() => numberIntClient.get("SELECT 9007199254740992 AS value"), /integer result exceeds JavaScript safe integer range/);
    } finally {
      numberIntClient.close();
      bigintIntClient.close();
    }
    const createdAt = "2026-05-29T00:00:00.000Z";
    const dateRead = await client.queryOne({ sql: "SELECT ?1 AS created_at", args: [new Date(createdAt)] });
    assert.equal(dateRead?.created_at, createdAt);
    await assert.rejects(() => client.queryOne("SELECT ?1 AS value", [Number.NaN]), /SQL number bind value must be finite/);
    await assert.rejects(() => client.queryOne("SELECT ?1 AS value", [Number.POSITIVE_INFINITY]), /SQL number bind value must be finite/);
    await assert.rejects(() => client.queryOne("SELECT ?1 AS value", [9007199254740992]), /integer SQL bind number exceeds JavaScript safe integer range/);
    const structuredIntegerRead = await client.queryOne({
      sql: "SELECT typeof(:large) AS value_type, :large AS value",
      args: { large: { kind: "integer", value: "9007199254740993" } }
    });
    assert.equal(structuredIntegerRead?.value_type, "integer");
    assert.equal(structuredIntegerRead?.value, "9007199254740993");
    await assert.rejects(() => client.queryOne("SELECT ?1 AS value", [{ kind: "integer", value: "1.5" }]), /SQL integer bind value must be a base-10 integer string/);
    await assert.rejects(() => client.queryOne("SELECT ?1 AS value", [{ kind: "real", value: Number.NaN }]), /SQL real bind value must be a finite number/);
    await assert.rejects(() => client.queryOne("SELECT ?1 AS value", [{ kind: "blob", value: [256] }]), /blob bytes must be integers from 0 to 255/);
    await assert.rejects(() => client.queryOne("SELECT ?1 AS created_at", [new Date(Number.NaN)]), /invalid Date SQL bind value/);
    const bufferRead = await client.queryOne({
      sql: "SELECT typeof(:payload) AS value_type, length(:payload) AS byte_count",
      args: { payload: new Uint8Array([1, 2, 3]).buffer }
    });
    assert.equal(bufferRead?.value_type, "blob");
    assert.equal(bufferRead?.byte_count, "3");
    const uint8ArrayBlobResult = await client.execute({
      sql: "SELECT :payload AS payload",
      args: { payload: new Uint8Array([1, 2, 3]) }
    });
    const blobPayload = uint8ArrayBlobResult.rows[0]?.payload;
    assert.equal(blobPayload instanceof ArrayBuffer, true);
    assert.deepEqual(Array.from(new Uint8Array(blobPayload)), [1, 2, 3]);
    assert.deepEqual(uint8ArrayBlobResult.toJSON().rows[0]?.payload, [1, 2, 3]);
    const viewRead = await client.queryOne({
      sql: "SELECT typeof(:payload) AS value_type, length(:payload) AS byte_count",
      args: { payload: new DataView(new Uint8Array([4, 5]).buffer) }
    });
    assert.equal(viewRead?.value_type, "blob");
    assert.equal(viewRead?.byte_count, "2");
    progress("SQL facade bind value handling verified");
    const positionalParamsResult = await client.queryOne({ sql: "SELECT body FROM sdk_notes WHERE body = ?1", params: ["from-sdk"] });
    assert.equal(positionalParamsResult?.body, "from-sdk");
    const commentedRead = await client.execute("-- leading comment\n/* block comment */\nSELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]);
    assert.equal(commentedRead.rows[0]?.body, "from-sdk");
    const cteRead = await client.execute("WITH payload(body) AS (SELECT ?1) SELECT body FROM payload", ["from-sdk"]);
    assert.equal(cteRead.rows[0]?.body, "from-sdk");
    await client.execute("WITH payload(body) AS (SELECT ?1) INSERT INTO sdk_notes(body) SELECT body FROM payload", ["from-cte-write"]);
    assert.equal((await client.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-cte-write"]))?.body, "from-cte-write");
    await client.exec(`
      CREATE TABLE sdk_exec(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_exec(body) VALUES ('from-exec');
    `);
    assert.equal((await client.queryOne("SELECT body FROM sdk_exec"))?.body, "from-exec");
    await client.executeMultiple(`
      CREATE TABLE sdk_multiple(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO sdk_multiple(body) VALUES ('from-multiple');
    `);
    assert.equal((await client.queryOne("SELECT body FROM sdk_multiple"))?.body, "from-multiple");
    await client.executeMultiple("INSERT INTO sdk_multiple(body) VALUES ('from-multiple-retry');", {
      idempotencyKey: `sdk_retry_multiple_${databaseId}`
    });
    assert.equal((await client.queryOne("SELECT body FROM sdk_multiple WHERE body = ?1", ["from-multiple-retry"]))?.body, "from-multiple-retry");
    const queryRows = await client.queryRows("SELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]);
    assert.equal(queryRows[0]?.body, "from-sdk");
    const queryOne = await client.queryOne({ sql: "SELECT body FROM sdk_notes WHERE body = ?1", args: ["from-sdk"] });
    assert.equal(queryOne?.body, "from-sdk");
    assert.equal((await client.all("SELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]))[0]?.body, "from-sdk");
    assert.equal((await client.get("SELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]))?.body, "from-sdk");
    assert.deepEqual(await client.values("SELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]), [["from-sdk"]]);
    assert.equal((await client.first("SELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]))?.body, "from-sdk");
    assert.equal(await client.firstValue("SELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]), "from-sdk");
    assert.equal(await client.scalar("SELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]), "from-sdk");
    assert.equal((await client.get(["SELECT body FROM sdk_notes WHERE body = ?1", ["from-sdk"]]))?.body, "from-sdk");
    await client.run("INSERT INTO sdk_notes(body) VALUES (?1)", ["from-run"]);
    await client.run(["INSERT INTO sdk_notes(body) VALUES (?1)", ["from-tuple-run"]]);
    await client.execute("CREATE TABLE sdk_prepared(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    await client.prepare("INSERT INTO sdk_prepared(body) VALUES (?1)").run(["from-prepare"]);
    const preparedSelect = client.prepare("SELECT body FROM sdk_prepared WHERE body = ?1");
    assert.equal((await preparedSelect.bind(["from-prepare"]).get())?.body, "from-prepare");
    assert.equal((await preparedSelect.get(["from-prepare"]))?.body, "from-prepare");
    assert.equal((await preparedSelect.queryOne(["from-prepare"]))?.body, "from-prepare");
    assert.equal((await preparedSelect.all(["from-prepare"]))[0]?.body, "from-prepare");
    assert.deepEqual(await preparedSelect.values(["from-prepare"]), [["from-prepare"]]);
    assert.equal((await preparedSelect.first(["from-prepare"]))?.body, "from-prepare");
    assert.equal(await preparedSelect.firstValue(["from-prepare"]), "from-prepare");
    assert.equal(await preparedSelect.scalar(["from-prepare"]), "from-prepare");
    progress("SQL facade statement helpers verified");
    const beforeBatchTotal = Number((await client.get("SELECT count(*) AS total FROM sdk_notes"))?.total);
    const batch = await client.batch([
      { sql: "INSERT INTO sdk_notes(body) VALUES (?1)", args: ["from-batch"] },
      { sql: "SELECT count(*) AS total FROM sdk_notes" }
    ], "write");
    assert.equal(batch.at(-1)?.rows[0]?.total, String(beforeBatchTotal + 1));
    const paramsBatch = await client.batch([
      { sql: "INSERT INTO sdk_notes(body) VALUES (?1)", params: ["from-batch-params"] },
      { sql: "SELECT count(*) AS total FROM sdk_notes" }
    ], "write");
    assert.equal(paramsBatch.at(-1)?.rows[0]?.total, String(beforeBatchTotal + 2));
    const idempotentBatchKey = `sdk_retry_batch_${databaseId}`;
    const idempotentBatch = await client.batch([
      { sql: "INSERT INTO sdk_notes(body) VALUES (?1)", args: ["from-idempotent-batch"] },
      { sql: "SELECT count(*) AS total FROM sdk_notes" }
    ], { idempotencyKey: idempotentBatchKey });
    assert.equal(idempotentBatch.at(0)?.routedOperationId, idempotentBatchKey);
    assert.equal(idempotentBatch.at(-1)?.routedOperationId, idempotentBatchKey);
    assert.equal(idempotentBatch.at(-1)?.rows[0]?.total, String(beforeBatchTotal + 3));
    assert.equal((await client.waitForRoutedOperation(idempotentBatchKey, { intervalMs: 0, timeoutMs: 5000 })).status, "applied");
    const idempotentModeBatchKey = `sdk_retry_batch_mode_${databaseId}`;
    const idempotentModeBatch = await client.batch([
      { sql: "INSERT INTO sdk_notes(body) VALUES (?1)", args: ["from-idempotent-mode-batch"] },
      { sql: "SELECT count(*) AS total FROM sdk_notes" }
    ], { mode: "write", idempotencyKey: idempotentModeBatchKey });
    assert.equal(idempotentModeBatch.at(0)?.routedOperationId, idempotentModeBatchKey);
    assert.equal(idempotentModeBatch.at(-1)?.routedOperationId, idempotentModeBatchKey);
    assert.equal(idempotentModeBatch.at(-1)?.rows[0]?.total, String(beforeBatchTotal + 4));
    assert.equal((await client.waitForRoutedOperation(idempotentModeBatchKey, { intervalMs: 0, timeoutMs: 5000 })).status, "applied");
    const tupleBatch = await client.batch([
      ["INSERT INTO sdk_notes(body) VALUES (?1)", ["from-tuple-batch"]],
      ["SELECT count(*) AS total FROM sdk_notes"]
    ], "write");
    assert.equal(tupleBatch.at(-1)?.rows[0]?.total, String(beforeBatchTotal + 5));
    const transaction = await client.transaction([
      ["INSERT INTO sdk_notes(body) VALUES (?1)", ["from-transaction"]],
      ["SELECT count(*) AS total FROM sdk_notes"]
    ], "write");
    assert.equal(transaction.at(-1)?.rows[0]?.total, String(beforeBatchTotal + 6));
    await client.executeScript("CREATE TABLE `sdk;quoted`(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO `sdk;quoted`(body) VALUES ('from-backtick-script');");
    assert.equal((await client.queryOne("SELECT body FROM `sdk;quoted`"))?.body, "from-backtick-script");
    await client.executeScript("CREATE TABLE [sdk;bracketed](id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO [sdk;bracketed](body) VALUES ('from-bracket-script');");
    assert.equal((await client.queryOne("SELECT body FROM [sdk;bracketed]"))?.body, "from-bracket-script");
    const readTransaction = await client.transaction([
      ["SELECT count(*) AS total FROM sdk_notes"]
    ], "read");
    assert.equal(readTransaction.at(-1)?.rows[0]?.total, String(beforeBatchTotal + 6));
    const idempotentTransactionKey = `sdk_retry_transaction_${databaseId}`;
    const idempotentTransaction = await client.transaction([
      ["INSERT INTO sdk_notes(body) VALUES (?1)", ["from-idempotent-transaction"]],
      ["SELECT count(*) AS total FROM sdk_notes"]
    ], { idempotencyKey: idempotentTransactionKey });
    assert.equal(idempotentTransaction.at(0)?.routedOperationId, idempotentTransactionKey);
    assert.equal(idempotentTransaction.at(-1)?.routedOperationId, idempotentTransactionKey);
    assert.equal(idempotentTransaction.at(-1)?.rows[0]?.total, String(beforeBatchTotal + 7));
    assert.equal((await client.waitForRoutedOperation(idempotentTransactionKey, { intervalMs: 0, timeoutMs: 5000 })).status, "applied");
    progress("SQL facade batch and transaction helpers verified");
    const migrateResult = await client.migrate([
      {
        version: "001",
        name: "create_sdk_migrated",
        sql: "CREATE TABLE sdk_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO sdk_migrated(body) VALUES ('from-migration');"
      }
    ]);
    assert.deepEqual(migrateResult, { applied: ["001"], skipped: [] });
    assert.deepEqual(await client.migrate([{ version: "001", sql: "CREATE TABLE skipped_migration(id INTEGER)" }]), { applied: [], skipped: ["001"] });
    assert.equal((await client.queryOne("SELECT body FROM sdk_migrated"))?.body, "from-migration");
    const libsqlMigrateResult = await client.migrate([
      "CREATE TABLE sdk_libsql_migrated(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
      { sql: "INSERT INTO sdk_libsql_migrated(body) VALUES (:body)", args: { body: "from-libsql-migrate" } }
    ]);
    assert.equal(libsqlMigrateResult.length, 2);
    assert.equal((await client.queryOne("SELECT body FROM sdk_libsql_migrated"))?.body, "from-libsql-migrate");
    await client.execute("CREATE TABLE sdk_atomic(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    await assert.rejects(() => client.batch([
      { sql: "INSERT INTO sdk_atomic(id, body) VALUES (?1, ?2)", args: [1, "before-rollback"] },
      { sql: "INSERT INTO sdk_atomic(id, body) VALUES (?1, ?2)", args: [1, "duplicate-id"] }
    ], "write"), /UNIQUE constraint failed|constraint failed/i);
    assert.equal((await client.queryOne("SELECT count(*) AS total FROM sdk_atomic"))?.total, "0");
    progress("SQL facade migrations and atomic rollback verified");
    assert.match(await client.schema(), /CREATE TABLE sdk_notes/);
    assert.ok((await client.listTables()).some((table) => table.name === "sdk_notes"));
    assert.ok((await client.tables()).some((table) => table.name === "sdk_notes"));
    assert.ok((await client.views()).some((table) => table.name === "sdk_notes_view"));
    assert.equal((await client.describeTable("sdk_notes")).tableName, "sdk_notes");
    assert.equal((await client.describe("sdk_notes")).tableName, "sdk_notes");
    assert.ok((await client.listColumns("sdk_notes")).some((column) => column.name === "body"));
    assert.ok((await client.columns("sdk_notes")).some((column) => column.name === "body"));
    assert.deepEqual(await client.listIndexes("sdk_notes"), []);
    assert.deepEqual(await client.indexes("sdk_notes"), []);
    assert.deepEqual(await client.listTriggers("sdk_notes"), []);
    assert.deepEqual(await client.triggers("sdk_notes"), []);
    assert.deepEqual(await client.listForeignKeys("sdk_notes"), []);
    assert.deepEqual(await client.foreignKeys("sdk_notes"), []);
    const preview = await client.previewTable("sdk_notes", { limit: 11 });
    assert.equal((await client.preview("sdk_notes", { limit: 11 })).tableName, "sdk_notes");
    assert.ok(preview.rows.length >= 11);
    const inspection = await client.inspect({ tableName: "sdk_notes", previewLimit: 3 });
    assert.equal(inspection.databaseId, databaseId);
    assert.match(inspection.schema, /CREATE TABLE sdk_notes/);
    assert.equal(inspection.tables[0]?.table.name, "sdk_notes");
    assert.equal(inspection.tables[0]?.description.tableName, "sdk_notes");
    assert.ok(inspection.tables[0]?.preview.rows.length >= 3);
    const sdkStatus = await client.status();
    assert.equal(sdkStatus.callerPrincipal, identity.getPrincipal().toText(), "caller principal should match the SDK identity used for app requests");
    assert.equal(sdkStatus.callerRole, "owner", "caller role should match the SDK identity database ACL");
    assert.ok(sdkStatus.stats.tableCount >= 1);
    assert.ok(BigInt(sdkStatus.stats.rowCount) >= 14n);
    assert.ok(sdkStatus.tableStatuses.some((table) => table.tableName === "sdk_notes" && BigInt(table.rowCount) >= 14n));
    assert.ok((await client.listUsageEvents()).length > 0);
    const dump = await client.dumpSql();
    assert.match(dump, /from-script/);
    await client.execute("CREATE TABLE sdk_loaded(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    await client.loadSqlDump("INSERT INTO sdk_loaded(body) VALUES ('from-dump');", { idempotencyKey: `sdk_load_dump_${databaseId}` });
    const loaded = await client.execute("SELECT body FROM sdk_loaded");
    assert.equal(loaded.rows[0]?.body, "from-dump");
    progress("SQL facade schema inspection and dump helpers verified");
    progress("SQL facade verified");
    await client.execute("CREATE TABLE sdk_archive(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    await client.execute("INSERT INTO sdk_archive(body) VALUES ('before-archive')");
    progress("archive table prepared");
    const snapshot = await client.archive();
    assert.ok(snapshot.byteLength > 0, "SDK archive snapshot should contain bytes");
    const snapshotMetadata = await client.snapshotInfo(snapshot);
    assert.equal(snapshotMetadata.sizeBytes, snapshot.byteLength);
    assert.equal(snapshotMetadata.snapshotHash.length, 32);
    assert.match(snapshotMetadata.sha256, /^[0-9a-f]{64}$/);
    progress("client archive snapshot metadata verified");
    await client.restore(snapshot, { expectedSha256: snapshotMetadata.sha256 });
    const restored = await client.execute("SELECT body FROM sdk_archive ORDER BY id");
    assert.deepEqual(restored.rows.map((row) => row.body), ["before-archive"]);
    await client.execute("INSERT INTO sdk_archive(body) VALUES ('after-restore')");
    const restoredWritable = await client.execute("SELECT body FROM sdk_archive ORDER BY id");
    assert.deepEqual(restoredWritable.rows.map((row) => row.body), ["before-archive", "after-restore"]);
    progress("archive and restore verified");
    await client.delete();
  } finally {
    client.close();
    await rm(tempDir, { recursive: true, force: true });
  }
  console.log(`ICPDB local SDK smoke OK: ${databaseId}`);
}

function identityFileEnv(network, identity, databaseId) {
  const env = {
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_NETWORK_URL: network.networkUrl,
    ICPDB_DATABASE_ID: databaseId,
    ...identity.env
  };
  if (network.rootKey) env.ICPDB_ROOT_KEY = network.rootKey;
  return env;
}

async function topUpLocalDatabaseBalance(execFileAsync, databaseId) {
  const units = process.env.ICPDB_SMOKE_DATABASE_TOP_UP_UNITS ?? "400000000000";
  const { stdout, stderr } = await execFileAsync("icp", [
    "canister",
    "call",
    "-e",
    environment,
    canisterName,
    "top_up_database_balance",
    `(record { database_id = "${escapeCandidText(databaseId)}"; units = ${units} : nat64 })`,
    "-o",
    "candid"
  ], { maxBuffer: 4 * 1024 * 1024 });
  const output = `${stdout}${stderr}`;
  if (!/variant\s*\{\s*Ok/.test(output)) {
    throw new Error(`failed to top up local SDK smoke database ${databaseId}: ${output}`);
  }
}

async function topUpLocalControlCanister(execFileAsync) {
  const amount = process.env.ICPDB_SMOKE_TOP_UP_AMOUNT ?? "20t";
  await execFileAsync("icp", [
    "canister",
    "top-up",
    "-e",
    environment,
    "--amount",
    amount,
    canisterName
  ], { maxBuffer: 4 * 1024 * 1024 });
}

async function topUpLocalDatabaseShard(execFileAsync, databaseCanisterId) {
  const cycles = process.env.ICPDB_SMOKE_SHARD_TOP_UP_CYCLES ?? "1000000000000";
  const { stdout, stderr } = await execFileAsync("icp", [
    "canister",
    "call",
    "-e",
    environment,
    canisterName,
    "top_up_database_shard",
    `(record { database_canister_id = "${escapeCandidText(databaseCanisterId)}"; cycles = ${cycles} : nat })`,
    "-o",
    "candid"
  ], { maxBuffer: 4 * 1024 * 1024 });
  const output = `${stdout}${stderr}`;
  if (!/variant\s*\{\s*Ok/.test(output)) {
    throw new Error(`failed to top up local SDK smoke database shard ${databaseCanisterId}: ${output}`);
  }
}

function escapeCandidText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function envFileLines(env) {
  return Object.entries(env)
    .filter(([_key, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
}

function hexToBytes(value) {
  const hex = value.trim();
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("root key must be hex bytes");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function progress(message) {
  if (smokeProgress) console.error(`[icpdb-sdk-smoke] ${message}`);
}

async function deleteShortestCleanup(database, label) {
  try {
    await database.delete();
  } catch (error) {
    if ((smokeOptions.only === "shortest" || smokeOptions.only === "sqlite-shortest" || smokeOptions.only === "libsql-shortest" || smokeOptions.only === "browser-shortest") && isLocalHostUnreachableError(error)) {
      progress(`${label} cleanup skipped after verified path because local host became unreachable`);
      return;
    }
    throw error;
  }
}

function parseSmokeArgs(args) {
  const parsed = { only: "full", listSteps: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--list-steps") {
      parsed.listSteps = true;
    } else if (arg === "--only") {
      index += 1;
      if (index >= args.length) failSmokeArg("--only requires shortest, browser-shortest, sqlite-shortest, libsql-shortest, or full");
      parsed.only = smokeStep(args[index]);
    } else if (arg.startsWith("--only=")) {
      parsed.only = smokeStep(arg.slice("--only=".length));
    } else {
      failSmokeArg(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function smokeStep(value) {
  const step = String(value).trim();
  if (step === "shortest" || step === "browser-shortest" || step === "sqlite-shortest" || step === "libsql-shortest" || step === "full") return step;
  failSmokeArg(`unknown --only step: ${step}; expected shortest, browser-shortest, sqlite-shortest, libsql-shortest, or full`);
}

function failSmokeArg(message) {
  console.error(message);
  process.exit(1);
}

main().then(() => {
  process.exit(0);
}).catch(async (error) => {
  console.error(await formatSmokeError(error));
  process.exit(1);
});

async function formatSmokeError(error) {
  const output = error instanceof Error ? error.stack ?? error.message : String(error);
  if (!isLocalHostUnreachableError(error)) return output;
  const diagnostics = await localHostUnreachableDiagnostics();
  return `${output}\n\nLocal SDK smoke diagnostics:\n${diagnostics.map((line) => `- ${line}`).join("\n")}`;
}

function isLocalHostUnreachableError(error) {
  const output = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  return /Cannot reach IC host|ic_host_unreachable|fetch failed|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/i.test(output);
}

async function localHostUnreachableDiagnostics() {
  const diagnostics = [
    `target environment: ${environment}`,
    `expected deploy command: icp deploy -e ${environment} -y ${canisterName}`,
    `status command: icp network status -e ${environment}`
  ];
  if (activeNetwork) {
    diagnostics.push(`resolved gateway: ${activeNetwork.networkUrl}`);
    diagnostics.push(`resolved canister: ${activeNetwork.canisterId}`);
  }
  const status = await commandOutput("icp", ["network", "status", "-e", environment]);
  if (status) diagnostics.push(`network status: ${oneLine(status)}`);
  diagnostics.push("if network status is healthy but Node still cannot reach the gateway, rerun the smoke outside a restricted sandbox with localhost access");
  return diagnostics;
}

async function commandOutput(command, args) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout, stderr } = await promisify(execFile)(command, args, { maxBuffer: 1024 * 1024 });
    return `${stdout}${stderr}`;
  } catch (error) {
    return `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  }
}

function oneLine(value) {
  return String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" | ");
}
