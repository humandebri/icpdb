#!/usr/bin/env node
// Where: scripts/icpdb-local-browser-smoke.mjs
// What: Live browser smoke for the remote token-session Table Editor and SQL Editor path.
// Why: Browser CORS, token wiring, remote routed writes, and Supabase-style UI controls need one deployed-canister check.
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { callIcpdbHttp, createIcpdbDatabase, parseCliArgs } from "./icpdb-http.mjs";
import { recordLocalIcpdbPayment } from "./icpdb-local-deposit.mjs";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const devPort = process.env.ICPDB_BROWSER_SMOKE_PORT ?? "3000";
const tableName = `browser_notes_${Date.now()}`;
const smokeProgress = process.env.ICPDB_SMOKE_PROGRESS === "1";

async function main() {
  const network = await localNetworkConfig(environment, canisterName);
  progress(`network ${network.networkUrl} canister ${network.canisterId}`);
  const created = await createIcpdbDatabase({
    canisterId: network.canisterId,
    networkUrl: network.canisterNetwork,
    rootKey: "",
    tokenName: "browser-smoke"
  });
  const databaseId = created.database_id;
  const token = created.owner_token.token;
  await recordLocalIcpdbPayment(network, databaseId);
  const baseUrl = await workingBaseUrl(network, token, databaseId);
  const placement = await callIcpdbHttp(parseCliArgs(["--base-url", baseUrl, "--token", token, "placement", databaseId], {}));
  const databaseCanisterId = assertRemotePlacement(placement, network.canisterId);
  progress(`remote database ${databaseId} placed on ${databaseCanisterId}`);
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-browser-smoke-"));
  const dumpTableName = `${tableName}_dump_load`;
  const sqlDumpPath = join(tempDir, `${dumpTableName}.sql`);
  await writeFile(sqlDumpPath, [
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
    `CREATE TABLE ${dumpTableName} (id INTEGER PRIMARY KEY, body TEXT NOT NULL);`,
    `INSERT INTO ${dumpTableName} (body) VALUES ('from-sql-dump-load');`,
    "COMMIT;"
  ].join("\n"));
  const server = process.env.ICPDB_BROWSER_SMOKE_CONSOLE_URL
    ? null
    : startConsoleServer(network);
  const consoleUrl = process.env.ICPDB_BROWSER_SMOKE_CONSOLE_URL ?? `http://127.0.0.1:${devPort}/icpdb`;
  try {
    if (server) await waitForConsole(consoleUrl);
    progress(`console ready ${consoleUrl}`);
    await runBrowserSmoke({ baseUrl, canisterId: network.canisterId, consoleUrl, databaseCanisterId, databaseId, dumpTableName, sqlDumpPath, tableName, token });
    progress("browser assertions verified");
  } finally {
    await cleanupDatabase(baseUrl, databaseId, token);
    await rm(tempDir, { recursive: true, force: true });
    if (server) server.kill("SIGTERM");
    await playwright(["close"]).catch(() => undefined);
  }
  console.log(`ICPDB local browser smoke OK: ${databaseId}/${tableName} routed to ${databaseCanisterId} via ${baseUrl}`);
}

function progress(message) {
  if (smokeProgress) console.error(`[icpdb-browser-smoke] ${message}`);
}

async function workingBaseUrl(network, token, databaseId) {
  const candidates = [
    process.env.ICPDB_SMOKE_BASE_URL ?? "",
    `http://${canisterName}.${environment}.localhost:${network.gatewayPort}`,
    `http://${network.canisterId}.localhost:${network.gatewayPort}`,
    `http://${network.canisterId}.raw.localhost:${network.gatewayPort}`
  ].filter((value) => value.length > 0);
  const errors = [];
  for (const baseUrl of candidates) {
    try {
      await callIcpdbHttp(parseCliArgs(["--base-url", baseUrl, "--token", token, "tables", databaseId], {}));
      return baseUrl;
    } catch (error) {
      errors.push(`${baseUrl}: ${errorMessage(error)}`);
    }
  }
  throw new Error(`no local HTTP gateway host worked\n${errors.join("\n")}`);
}

function assertRemotePlacement(placement, controlCanisterId) {
  if (!isRecord(placement)) throw new Error(`placement response is not an object: ${JSON.stringify(placement)}`);
  const canisterId = stringValue(placement.canister_id);
  if (!canisterId) throw new Error(`browser smoke database is not remotely placed: ${JSON.stringify(placement)}`);
  if (canisterId === controlCanisterId) throw new Error(`browser smoke placement points at control canister: ${JSON.stringify(placement)}`);
  if (stringValue(placement.status) !== "hot") throw new Error(`browser smoke placement is not hot: ${JSON.stringify(placement)}`);
  return canisterId;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function startConsoleServer(network) {
  const env = {
    ...process.env,
    NEXT_PUBLIC_ICPDB_CANISTER_ID: network.canisterId,
    NEXT_PUBLIC_ICPDB_IC_HOST: network.networkUrl,
    NEXT_PUBLIC_II_PROVIDER_URL: `http://id.ai.localhost:${network.gatewayPort}`
  };
  const server = spawn("pnpm", ["--dir", "icpdb-console", "dev", "--hostname", "127.0.0.1", "--port", devPort], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return server;
}

async function waitForConsole(consoleUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(consoleUrl);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`console did not become ready: ${consoleUrl}`);
}

async function runBrowserSmoke(smoke) {
  await playwright(["open", smoke.consoleUrl]);
  await playwright(["run-code", browserSmokeCode(smoke)]);
  const consoleOutput = await playwright(["console", "error"]);
  const consoleLog = await consoleLogText(consoleOutput);
  if (!consoleLog.includes("Errors: 0")) throw new Error(consoleLog);
}

function browserSmokeCode(smoke) {
  return `
const smoke = ${JSON.stringify(smoke)};
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(smoke.consoleUrl).origin });
async function clickCopyButton(label) {
  const button = page.getByLabel(label);
  await button.click();
  await page.locator('button[aria-label="' + label + '"][title="Copied"]').waitFor({ timeout: 20000 });
}
async function assertSearchNoMatch(scope, label, emptyLabel, query) {
  await scope.getByLabel(label).fill(query);
  await scope.getByText(emptyLabel).waitFor({ timeout: 20000 });
  await scope.getByLabel(label).fill("");
}
async function assertCatalogShortcut(label, buttonName, needles) {
  await page.locator("main").getByRole("button", { name: buttonName }).click();
  const openedSql = await page.locator("main textarea").first().inputValue();
  for (const needle of needles) {
    if (!openedSql.includes(needle)) throw new Error(label + " catalog shortcut missing " + needle);
  }
  const paramsJson = await page.locator("main input").first().inputValue();
  if (paramsJson !== "[]") throw new Error(label + " catalog shortcut did not clear params");
}
async function assertDisabledButtonTitle(scope, buttonName, expectedTitle) {
  const button = scope.getByRole("button", { name: buttonName });
  await button.waitFor({ timeout: 20000 });
  if (!(await button.isDisabled())) throw new Error(buttonName + " should be disabled");
  const title = await button.getAttribute("title");
  if (title !== expectedTitle) throw new Error(buttonName + " disabled title mismatch: " + title);
}
async function verifyLastWriteOperation(responseSidebar) {
  const operationPanel = responseSidebar.locator("section").filter({ has: page.getByRole("heading", { name: "Operation status" }) }).first();
  await operationPanel.getByText("Last write operation").waitFor({ timeout: 20000 });
  const operationId = await operationPanel.getByPlaceholder("idempotency key").inputValue();
  if (!operationId.startsWith("icpdb-web-")) throw new Error("browser write operation id missing: " + operationId);
  await operationPanel.getByRole("button", { name: "Lookup routed operation" }).click();
  await operationPanel.getByText("Operation applied").waitFor({ timeout: 20000 });
  await operationPanel.getByText("sql_").waitFor({ timeout: 20000 });
}
await page.getByPlaceholder("https://<canister-id>.icp0.io").fill(smoke.baseUrl);
await page.getByPlaceholder("database_id").fill(smoke.databaseId);
await page.getByPlaceholder("api token").fill(smoke.token);
await page.getByRole("button", { name: "Connect" }).click();
await page.getByRole("button", { name: "Sync" }).waitFor({ timeout: 20000 });
await page.getByLabel("Copy Canister").waitFor({ timeout: 20000 });
await page.getByLabel("Copy Principal").waitFor({ timeout: 20000 });
await clickCopyButton("Copy Canister");
await clickCopyButton("Copy Principal");
const databasePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Databases" }) }).first();
const tablePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Tables" }) }).first();
const responseSidebar = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Response" }) }).first();
await databasePanel.getByText(smoke.databaseId).waitFor({ timeout: 20000 });
await page.getByLabel("Copy Database").waitFor({ timeout: 20000 });
await clickCopyButton("Copy Database");
await page.getByLabel("Copy Connection URL").waitFor({ timeout: 20000 });
await clickCopyButton("Copy Connection URL");
await responseSidebar.getByText("icpdb://" + smoke.canisterId + "/" + smoke.databaseId).waitFor({ timeout: 20000 });
await responseSidebar.getByText("Caller role").waitFor({ timeout: 20000 });
await responseSidebar.getByText("owner").first().waitFor({ timeout: 20000 });
await databasePanel.getByText("current").waitFor({ timeout: 20000 });
await databasePanel.getByText("selected").waitFor({ timeout: 20000 });
await databasePanel.getByLabel("Search databases").fill("selected");
await databasePanel.getByText("1/1").waitFor({ timeout: 20000 });
await databasePanel.getByText(smoke.databaseId).waitFor({ timeout: 20000 });
await databasePanel.getByLabel("Search databases").fill("");
await databasePanel.getByLabel("Search databases").fill("current");
await databasePanel.getByText("1/1").waitFor({ timeout: 20000 });
await databasePanel.getByLabel("Search databases").fill("");
await databasePanel.getByRole("button", { name: /Current/ }).click();
await databasePanel.getByText(smoke.databaseId).waitFor({ timeout: 20000 });
await databasePanel.getByText("1/1").waitFor({ timeout: 20000 });
await databasePanel.getByRole("button", { name: /All/ }).click();
await tablePanel.getByText("No tables").waitFor({ timeout: 20000 });
await tablePanel.getByRole("button", { name: "Open setup SQL" }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedSetupSql = await page.locator("main textarea").first().inputValue();
if (!openedSetupSql.includes("CREATE TABLE \"notes\"")) throw new Error("setup SQL shortcut missing CREATE TABLE notes");
if (!openedSetupSql.includes("INSERT INTO \"notes\" (body) VALUES ('hello from ICPDB')")) throw new Error("setup SQL shortcut missing seed INSERT");
if (!openedSetupSql.includes("sqlite_schema")) throw new Error("setup SQL shortcut missing schema inspection");
if (!openedSetupSql.includes("SELECT * FROM \"notes\" LIMIT 25")) throw new Error("setup SQL shortcut missing preview SELECT");
await page.getByRole("button", { name: "Table" }).click();
const depositPanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Deposit" }) }).first();
await depositPanel.getByText("1 payments").waitFor({ timeout: 20000 });
await depositPanel.getByText("0.01 ICP").waitFor({ timeout: 20000 });
await depositPanel.getByText("1000 units").waitFor({ timeout: 20000 });
await assertSearchNoMatch(depositPanel, "Search payments", "No matching payments", "missing-payment-filter");
const storagePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Storage / quota" }) }).first();
await storagePanel.locator("input").fill("134217728");
await storagePanel.getByRole("button", { name: "Set quota" }).click();
await page.getByText("128 MB").waitFor({ timeout: 20000 });
const tokenPanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Tokens" }) }).first();
await tokenPanel.locator("input").fill("browser-write");
await tokenPanel.locator("select").selectOption("write");
await tokenPanel.getByRole("button", { name: "Create" }).click();
await tokenPanel.getByText("browser-write").waitFor({ timeout: 20000 });
await page.getByLabel("Copy issued token").waitFor({ timeout: 20000 });
await clickCopyButton("Copy issued token");
await tokenPanel.getByRole("button", { name: /Write/ }).click();
await tokenPanel.getByText("browser-write").waitFor({ timeout: 20000 });
await page.waitForFunction(() => {
  const panels = Array.from(document.querySelectorAll("div"));
  const panel = panels.find((item) => item.textContent?.includes("Tokens") && item.textContent?.includes("browser-write"));
  return panel instanceof HTMLElement && !panel.textContent?.includes("browser-smoke");
}, null, { timeout: 20000 });
await tokenPanel.getByRole("button", { name: /All/ }).click();
await assertSearchNoMatch(tokenPanel, "Search tokens", "No matching tokens", "missing-token-filter");
const tokenRow = tokenPanel.locator("div").filter({ hasText: "browser-write" }).filter({ has: tokenPanel.getByRole("button", { name: "Revoke" }) }).last();
await tokenRow.getByRole("button", { name: "Revoke" }).click();
await page.waitForFunction(() => {
  const panels = Array.from(document.querySelectorAll("div"));
  const panel = panels.find((item) => item.textContent?.includes("Tokens") && item.textContent?.includes("browser-write"));
  const row = Array.from(panel?.querySelectorAll("div") ?? []).find((item) => item.textContent?.includes("browser-write"));
  const button = Array.from(row?.querySelectorAll("button") ?? []).find((item) => item.textContent?.includes("Revoke"));
  return button instanceof HTMLButtonElement && button.disabled;
}, null, { timeout: 20000 });
const permissionPanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Permissions" }) }).first();
await permissionPanel.getByText("Current caller").waitFor({ timeout: 20000 });
await permissionPanel.getByText("token:" + smoke.databaseId).waitFor({ timeout: 20000 });
await clickCopyButton("Copy current caller principal");
const currentCallerRow = permissionPanel
  .locator("div")
  .filter({ hasText: "token:" + smoke.databaseId })
  .filter({ has: permissionPanel.getByRole("button", { name: "Revoke access for token:" + smoke.databaseId }) })
  .last();
await assertDisabledButtonTitle(currentCallerRow, "Revoke access for token:" + smoke.databaseId, "Current caller cannot revoke itself");
await permissionPanel.getByLabel("Member principal").fill("2vxsx-fae");
await assertDisabledButtonTitle(permissionPanel, "Grant member access", "Anonymous principal cannot be granted database access");
await permissionPanel.getByText("Anonymous principal cannot be granted database access").waitFor({ timeout: 20000 });
await permissionPanel.getByLabel("Member principal").fill("token:" + smoke.databaseId);
await permissionPanel.getByLabel("Member role").selectOption("owner");
await assertDisabledButtonTitle(permissionPanel, "Grant member access", "Member already has this role");
await permissionPanel.getByText("Member already has this role").waitFor({ timeout: 20000 });
await permissionPanel.getByLabel("Member role").selectOption("reader");
await assertDisabledButtonTitle(permissionPanel, "Grant member access", "Current caller cannot downgrade itself");
await permissionPanel.getByText("Current caller cannot downgrade itself").waitFor({ timeout: 20000 });
const memberPrincipal = "aaaaa-aa";
await permissionPanel.getByLabel("Member principal").fill(memberPrincipal);
await permissionPanel.getByRole("button", { name: "Grant" }).click();
await permissionPanel.getByText(memberPrincipal).waitFor({ timeout: 20000 });
await permissionPanel.getByRole("button", { name: /Reader/ }).click();
await permissionPanel.getByText(memberPrincipal).waitFor({ timeout: 20000 });
await permissionPanel.getByRole("button", { name: "Copy member principal " + memberPrincipal }).click();
const copiedMemberPrincipal = await page.evaluate(() => navigator.clipboard.readText());
if (copiedMemberPrincipal !== memberPrincipal) throw new Error("copied member principal mismatch");
await page.waitForFunction(() => {
  const principal = "aaaaa-aa";
  const panels = Array.from(document.querySelectorAll("div"));
  const panel = panels.find((item) => item.textContent?.includes("Permissions") && item.textContent?.includes(principal));
  return panel instanceof HTMLElement && !panel.textContent?.includes("owner");
}, null, { timeout: 20000 });
await permissionPanel.getByRole("button", { name: /All/ }).click();
await assertSearchNoMatch(permissionPanel, "Search members", "No matching members", "missing-member-filter");
const memberRow = permissionPanel.locator("div").filter({ hasText: memberPrincipal }).filter({ has: permissionPanel.getByRole("button", { name: "Revoke access" }) }).last();
await memberRow.getByRole("button", { name: "Revoke access" }).click();
await page.waitForFunction(() => {
  const principal = "aaaaa-aa";
  const panels = Array.from(document.querySelectorAll("div"));
  const panel = panels.find((item) => item.textContent?.includes("Permissions"));
  return panel instanceof HTMLElement && !panel.textContent?.includes(principal);
}, null, { timeout: 20000 });
await page.getByRole("button", { name: "SQL" }).click();
await assertCatalogShortcut("Schema", "Open sqlite_schema SQL", ["SELECT type, name, tbl_name, sql", "FROM sqlite_schema", "WHERE name NOT LIKE 'sqlite_%'"]);
await assertCatalogShortcut("Tables", "Open table list SQL", ["SELECT name, type, sql", "FROM sqlite_schema", "WHERE type IN ('table', 'view')"]);
await assertCatalogShortcut("Stats", "Open schema object count SQL", ["SELECT type, count(*) AS total", "GROUP BY type", "ORDER BY type"]);
await assertCatalogShortcut("Columns", "Open column catalog SQL", ["pragma_table_xinfo", "column_name", "primary_key_position"]);
await assertCatalogShortcut("Views", "Open view list SQL", ["SELECT name, sql", "FROM sqlite_schema", "WHERE type = 'view'"]);
await assertCatalogShortcut("Indexes", "Open index list SQL", ["SELECT name, tbl_name, sql", "FROM sqlite_schema", "WHERE type = 'index'"]);
await assertCatalogShortcut("Foreign Keys", "Open foreign key catalog SQL", ["pragma_foreign_key_list", "referenced_table", "from_column"]);
await assertCatalogShortcut("Triggers", "Open trigger list SQL", ["SELECT name, tbl_name, sql", "FROM sqlite_schema", "WHERE type = 'trigger'"]);
await page.getByRole("button", { name: "Copy SQL" }).click();
const copiedEditorSqlText = await page.evaluate(() => navigator.clipboard.readText());
for (const needle of ["SELECT name, tbl_name, sql", "FROM sqlite_schema", "WHERE type = 'trigger'"]) {
  if (!copiedEditorSqlText.includes(needle)) throw new Error("copied editor SQL missing " + needle);
}
await page.getByLabel("Max rows").fill("250");
await page.locator("main").getByRole("button", { name: "Update" }).click();
await page.locator("main textarea").first().fill("CREATE TABLE browser_parents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
await page.locator("main input").first().fill("[]");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByRole("heading", { name: "SQL result" }).waitFor({ timeout: 20000 });
await verifyLastWriteOperation(responseSidebar);
await page.getByText("Affected").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "browser_parents" }).waitFor({ timeout: 20000 });
await page.locator("main textarea").first().fill("INSERT INTO browser_parents (name) VALUES (:name || '-' || :enabled || '-' || length(:payload) || '-' || typeof(:large))");
await page.locator("main input").first().fill("{\"name\":\"root\",\"enabled\":true,\"payload\":[1,2,3],\"large\":{\"kind\":\"integer\",\"value\":\"9223372036854775807\"}}");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByRole("button", { name: "browser_parents" }).waitFor({ timeout: 20000 });
await page.locator('input[placeholder="table_name"]').fill(smoke.tableName);
await page.locator("aside textarea").fill("id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES browser_parents(id) ON UPDATE CASCADE ON DELETE RESTRICT, body TEXT NOT NULL");
await page.getByRole("button", { name: "Create table" }).click();
await page.getByRole("button", { name: smoke.tableName }).waitFor({ timeout: 20000 });
await tablePanel.getByText(smoke.tableName).waitFor({ timeout: 20000 });
await tablePanel.getByText("selected").waitFor({ timeout: 20000 });
await tablePanel.getByLabel("Search tables").fill("selected");
await tablePanel.getByText("1/2").waitFor({ timeout: 20000 });
await tablePanel.getByText(smoke.tableName).waitFor({ timeout: 20000 });
await tablePanel.getByLabel("Search tables").fill("");
await tablePanel.getByRole("button", { name: "Open SELECT SQL for " + smoke.tableName }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedTableSql = await page.locator("main textarea").first().inputValue();
if (!openedTableSql.includes("SELECT * FROM") || !openedTableSql.includes(smoke.tableName)) throw new Error("table SQL shortcut did not target selected table");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.waitForFunction(() => {
  const table = Array.from(document.querySelectorAll("main table")).at(-1);
  const headers = Array.from(table?.querySelectorAll("th") ?? []).map((cell) => cell.textContent?.trim() ?? "");
  return ["id", "parent_id", "body"].every((column) => headers.includes(column));
}, null, { timeout: 20000 });
await page.getByRole("button", { name: "Table" }).click();
await assertSearchNoMatch(tablePanel, "Search tables", "No matching tables", "missing-table-filter");
const indexName = smoke.tableName + "_body_idx";
const triggerName = smoke.tableName + "_guard";
const viewName = "browser_view_filter";
await page.getByRole("button", { name: "SQL" }).click();
await page.locator("main").getByRole("button", { name: "Update" }).click();
await page.locator("main textarea").first().fill("CREATE UNIQUE INDEX " + indexName + " ON " + smoke.tableName + "(body)");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByRole("button", { name: smoke.tableName }).click();
await page.getByText(indexName).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "SQL" }).click();
await page.locator("main textarea").first().fill("CREATE TRIGGER " + triggerName + " BEFORE INSERT ON " + smoke.tableName + " BEGIN SELECT 1; END");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByRole("button", { name: smoke.tableName }).click();
await page.getByText(triggerName).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "SQL" }).click();
await page.locator("main textarea").first().fill("CREATE VIEW " + viewName + " AS SELECT id, body FROM " + smoke.tableName);
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await tablePanel.getByRole("button", { name: /Views/ }).click();
await tablePanel.getByRole("button", { name: viewName }).waitFor({ timeout: 20000 });
await tablePanel.getByRole("button", { name: viewName }).click();
await page.getByText("Views are read-only.").waitFor({ timeout: 20000 });
await tablePanel.getByRole("button", { name: /Tables/ }).click();
await page.waitForFunction((name) => {
  const panel = Array.from(document.querySelectorAll("div")).find((item) => item.textContent?.includes("Tables"));
  return panel instanceof HTMLElement && panel.textContent?.includes(name) && !panel.textContent?.includes("browser_view_filter");
}, smoke.tableName, { timeout: 20000 });
await tablePanel.getByRole("button", { name: smoke.tableName }).click();
await page.getByRole("heading", { name: "Columns" }).waitFor({ timeout: 20000 });
await page.getByLabel("Search columns").fill("parent");
await page.getByText("1/3").waitFor({ timeout: 20000 });
await page.getByText("parent_id").waitFor({ timeout: 20000 });
await page.getByLabel("Search columns").fill("");
await assertSearchNoMatch(page, "Search columns", "No matching columns", "missing-column-filter");
await page.getByRole("heading", { name: "Table overview" }).waitFor({ timeout: 20000 });
await page.getByText("Row editing enabled.").waitFor({ timeout: 20000 });
await page.getByText("Selected row").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Open schema lookup SQL for " + smoke.tableName }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedOverviewSchemaLookupSqlText = await page.locator("main textarea").first().inputValue();
for (const needle of ["SELECT type, name, tbl_name, sql", "FROM sqlite_schema", "WHERE tbl_name = ?1 OR name = ?1"]) {
  if (!openedOverviewSchemaLookupSqlText.includes(needle)) throw new Error("overview schema lookup SQL missing " + needle);
}
const overviewSchemaLookupParams = await page.locator("main input").first().inputValue();
if (overviewSchemaLookupParams !== JSON.stringify([smoke.tableName], null, 2)) {
  throw new Error("overview schema lookup params missing " + smoke.tableName);
}
await page.getByRole("button", { name: "Table" }).click();
const { readFile } = await import("node:fs/promises");
await page.waitForFunction(() => {
  const section = Array.from(document.querySelectorAll("section")).find((item) => item.textContent?.includes("Columns"));
  const rows = Array.from(section?.querySelectorAll("tbody tr") ?? []);
  return rows.some((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "");
    return cells[0] === "id" && cells[1] === "INTEGER" && cells[2] === "primary" && cells[3] === "yes";
  });
}, null, { timeout: 20000 });
await page.waitForFunction(() => {
  const section = Array.from(document.querySelectorAll("section")).find((item) => item.textContent?.includes("Columns"));
  const rows = Array.from(section?.querySelectorAll("tbody tr") ?? []);
  return rows.some((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "");
    return cells[0] === "parent_id" && cells[1] === "INTEGER" && cells[2] === "regular" && cells[3] === "no";
  });
}, null, { timeout: 20000 });
await page.waitForFunction(() => {
  const section = Array.from(document.querySelectorAll("section")).find((item) => item.textContent?.includes("Columns"));
  const rows = Array.from(section?.querySelectorAll("tbody tr") ?? []);
  return rows.some((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "");
    return cells[0] === "body" && cells[1] === "TEXT" && cells[2] === "regular" && cells[3] === "no";
  });
}, null, { timeout: 20000 });
await page.getByText("browser_parents.id").waitFor({ timeout: 20000 });
await page.getByText("CASCADE").waitFor({ timeout: 20000 });
await page.getByText("RESTRICT").waitFor({ timeout: 20000 });
await assertSearchNoMatch(page, "Search indexes", "No matching indexes", "missing-index-filter");
await assertSearchNoMatch(page, "Search triggers", "No matching triggers", "missing-trigger-filter");
await assertSearchNoMatch(page, "Search foreign keys", "No matching foreign keys", "missing-foreign-key-filter");
await page.getByRole("button", { name: "Copy schema SQL" }).click();
const copiedSchemaSqlText = await page.evaluate(() => navigator.clipboard.readText());
for (const needle of ["CREATE TABLE", smoke.tableName, indexName, triggerName]) {
  if (!copiedSchemaSqlText.includes(needle)) throw new Error("copied schema SQL missing " + needle);
}
const [schemaDownload] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Download schema SQL" }).click()
]);
const schemaDownloadPath = await schemaDownload.path();
if (!schemaDownloadPath) throw new Error("schema SQL download path missing");
const schemaSqlText = await readFile(schemaDownloadPath, "utf8");
for (const needle of ["CREATE TABLE", smoke.tableName, indexName, triggerName]) {
  if (!schemaSqlText.includes(needle)) throw new Error("schema SQL missing " + needle);
}
await page.getByRole("button", { name: /^Open schema lookup SQL$/ }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedSchemaLookupSqlText = await page.locator("main textarea").first().inputValue();
for (const needle of ["SELECT type, name, tbl_name, sql", "FROM sqlite_schema", "WHERE tbl_name = ?1 OR name = ?1"]) {
  if (!openedSchemaLookupSqlText.includes(needle)) throw new Error("opened schema lookup SQL missing " + needle);
}
const schemaLookupParams = await page.locator("main input").first().inputValue();
if (schemaLookupParams !== JSON.stringify([smoke.tableName], null, 2)) {
  throw new Error("opened schema lookup params missing " + smoke.tableName);
}
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByText(indexName).waitFor({ timeout: 20000 });
await page.getByText(triggerName).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Table" }).click();
await page.getByRole("button", { name: "Open column SQL" }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedColumnSqlText = await page.locator("main textarea").first().inputValue();
for (const needle of ["PRAGMA table_xinfo", smoke.tableName]) {
  if (!openedColumnSqlText.includes(needle)) throw new Error("opened column SQL missing " + needle);
}
const columnSqlParams = await page.locator("main input").first().inputValue();
if (columnSqlParams !== "[]") throw new Error("opened column SQL params should be empty");
await page.getByRole("button", { name: "Table" }).click();
await page.getByRole("button", { name: "Open foreign key SQL" }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedForeignKeySqlText = await page.locator("main textarea").first().inputValue();
for (const needle of ["PRAGMA foreign_key_list", smoke.tableName]) {
  if (!openedForeignKeySqlText.includes(needle)) throw new Error("opened foreign key SQL missing " + needle);
}
const foreignKeySqlParams = await page.locator("main input").first().inputValue();
if (foreignKeySqlParams !== "[]") throw new Error("opened foreign key SQL params should be empty");
await page.getByRole("button", { name: "Table" }).click();
await page.getByRole("button", { name: "Open schema SQL" }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedSchemaSqlText = await page.locator("main textarea").first().inputValue();
for (const needle of ["CREATE TABLE", smoke.tableName, indexName, triggerName]) {
  if (!openedSchemaSqlText.includes(needle)) throw new Error("opened schema SQL missing " + needle);
}
await page.getByRole("button", { name: "Table" }).click();
await page.getByRole("button", { name: "Open index SQL for " + indexName }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedIndexSqlText = await page.locator("main textarea").first().inputValue();
for (const needle of ["CREATE UNIQUE INDEX", indexName, smoke.tableName]) {
  if (!openedIndexSqlText.includes(needle)) throw new Error("opened index SQL missing " + needle);
}
if (!openedIndexSqlText.trim().endsWith(";")) throw new Error("opened index SQL missing semicolon");
await page.getByRole("button", { name: "Table" }).click();
await page.getByRole("button", { name: "Open trigger SQL for " + triggerName }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedTriggerSqlText = await page.locator("main textarea").first().inputValue();
for (const needle of ["CREATE TRIGGER", triggerName, smoke.tableName]) {
  if (!openedTriggerSqlText.includes(needle)) throw new Error("opened trigger SQL missing " + needle);
}
if (!openedTriggerSqlText.trim().endsWith(";")) throw new Error("opened trigger SQL missing semicolon");
await page.getByRole("button", { name: "SQL" }).click();
await page.getByRole("button", { name: "Batch" }).click();
await page.locator("main textarea").first().fill(Array.from({ length: 26 }, (_, index) => {
  const suffix = String(index + 1).padStart(2, "0");
  return "INSERT INTO " + smoke.tableName + " (parent_id, body) VALUES (1, 'page-row-" + suffix + "')";
}).join("; "));
await page.getByRole("button", { name: "Run batch" }).click();
await page.getByText("Batch results").waitFor({ timeout: 20000 });
await verifyLastWriteOperation(responseSidebar);
await page.getByRole("button", { name: smoke.tableName }).click();
const tableDataPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: smoke.tableName }) }).first();
await tableDataPanel.locator("select").selectOption("25");
await tableDataPanel.getByText("Rows 1-25 of 26").waitFor({ timeout: 20000 });
await tableDataPanel.getByText("page-row-01").waitFor({ timeout: 20000 });
await tableDataPanel.getByLabel("Search table rows").fill("page-row-01");
await tableDataPanel.getByText("1/25").waitFor({ timeout: 20000 });
await tableDataPanel.getByLabel("Search table rows").fill("body");
await tableDataPanel.getByText("25/25").waitFor({ timeout: 20000 });
await tableDataPanel.getByLabel("Search table rows").fill("missing-current-page-row");
await tableDataPanel.getByText("No matching table rows").waitFor({ timeout: 20000 });
await tableDataPanel.getByLabel("Search table rows").fill("");
await tableDataPanel.getByText("page-row-01").waitFor({ timeout: 20000 });
await tableDataPanel.getByLabel("Refresh table rows").click();
await tableDataPanel.getByText("Rows 1-25 of 26").waitFor({ timeout: 20000 });
await tableDataPanel.getByRole("button", { name: "Next table page" }).click();
await tableDataPanel.getByText("Rows 26-26 of 26").waitFor({ timeout: 20000 });
await tableDataPanel.getByText("page-row-26").waitFor({ timeout: 20000 });
await tableDataPanel.getByRole("button", { name: "Open page SQL" }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedPageSql = await page.locator("main textarea").first().inputValue();
if (!openedPageSql.includes("SELECT * FROM") || !openedPageSql.includes(smoke.tableName) || !openedPageSql.includes("LIMIT 25 OFFSET 25")) throw new Error("page SQL shortcut did not target current table page");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.waitForFunction(() => {
  const table = Array.from(document.querySelectorAll("main table")).at(-1);
  const cells = Array.from(table?.querySelectorAll("td") ?? []).map((cell) => cell.textContent?.trim() ?? "");
  return cells.includes("page-row-26");
}, null, { timeout: 20000 });
await page.getByRole("button", { name: "Table" }).click();
await tableDataPanel.getByRole("button", { name: "Previous table page" }).click();
await tableDataPanel.getByText("Rows 1-25 of 26").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Open count SQL" }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedCountSql = await page.locator("main textarea").first().inputValue();
if (!openedCountSql.includes("SELECT count(*) AS total FROM") || !openedCountSql.includes(smoke.tableName)) throw new Error("count SQL shortcut did not target selected table");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByText("total").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Table" }).click();
await page.locator("main").getByRole("button", { name: "Open SELECT SQL for " + smoke.tableName }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedOverviewTableSql = await page.locator("main textarea").first().inputValue();
if (!openedOverviewTableSql.includes("SELECT * FROM") || !openedOverviewTableSql.includes(smoke.tableName)) throw new Error("overview table SQL shortcut did not target selected table");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.waitForFunction(() => {
  const table = Array.from(document.querySelectorAll("main table")).at(-1);
  const cells = Array.from(table?.querySelectorAll("td") ?? []).map((cell) => cell.textContent?.trim() ?? "");
  return cells.includes("page-row-01");
}, null, { timeout: 20000 });
await page.getByRole("button", { name: "Table" }).click();
await page.locator("main").getByRole("button", { name: "Open INSERT SQL for " + smoke.tableName }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedInsertSql = await page.locator("main textarea").first().inputValue();
if (!openedInsertSql.includes("INSERT INTO") || !openedInsertSql.includes(smoke.tableName) || !openedInsertSql.includes("VALUES (?1")) throw new Error("overview insert SQL shortcut did not target selected table");
await page.locator("main input").first().fill("[1,\"from-insert-sql-shortcut\"]");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await verifyLastWriteOperation(responseSidebar);
await page.getByRole("button", { name: "Table" }).click();
await tableDataPanel.locator("select").selectOption("100");
await tableDataPanel.getByText("Rows 1-27 of 27").waitFor({ timeout: 20000 });
await tableDataPanel.getByText("from-insert-sql-shortcut").waitFor({ timeout: 20000 });
await tableDataPanel.getByRole("button", { name: "Sort body ascending" }).click();
await tableDataPanel.getByRole("button", { name: "Sort body descending" }).click();
await page.waitForFunction(() => {
  const section = Array.from(document.querySelectorAll("section")).find((item) => item.textContent?.includes("Rows 1-26 of 26"));
  const firstRow = section?.querySelector("tbody tr");
  const cells = Array.from(firstRow?.querySelectorAll("td") ?? []).map((cell) => cell.textContent?.trim() ?? "");
  return cells.includes("page-row-26");
}, null, { timeout: 20000 });
await tableDataPanel.getByRole("button", { name: "Copy table CSV" }).click();
const copiedTableCsvText = await page.evaluate(() => navigator.clipboard.readText());
for (const needle of ["body", "page-row-26"]) {
  if (!copiedTableCsvText.includes(needle)) throw new Error("copied table CSV missing " + needle);
}
const [tableDownload] = await Promise.all([
  page.waitForEvent("download"),
  tableDataPanel.getByRole("button", { name: "Download table CSV" }).click()
]);
const tableDownloadPath = await tableDownload.path();
if (!tableDownloadPath) throw new Error("table CSV download path missing");
const tableCsvText = await readFile(tableDownloadPath, "utf8");
for (const needle of ["body", "page-row-26"]) {
  if (!tableCsvText.includes(needle)) throw new Error("table CSV missing " + needle);
}
await page.getByRole("button", { name: "New" }).click();
await page.locator("main textarea").first().fill(JSON.stringify({ parent_id: 1, body: "from-row-editor" }));
await page.getByRole("button", { name: "Insert" }).click();
await page.getByText("from-row-editor").waitFor({ timeout: 20000 });
const rowEditor = page.locator("section").filter({ has: page.getByRole("heading", { name: "Row editor" }) }).first();
await page.getByText("from-row-editor").click();
await rowEditor.locator("input").fill("from-cell-editor");
await rowEditor.getByRole("button", { name: "Save cell" }).click();
await page.getByText("from-cell-editor").waitFor({ timeout: 20000 });
await page.getByText("from-cell-editor").click();
await rowEditor.locator("textarea").fill(JSON.stringify({ parent_id: 1, body: "from-row-update" }));
await rowEditor.getByRole("button", { name: "Update" }).click();
await page.getByText("from-row-update").waitFor({ timeout: 20000 });
await rowEditor.getByRole("button", { name: "New" }).click();
await rowEditor.locator("textarea").fill(JSON.stringify({ parent_id: 1, body: "delete-me" }));
await rowEditor.getByRole("button", { name: "Insert" }).click();
await page.getByText("delete-me").waitFor({ timeout: 20000 });
await page.getByText("delete-me").click();
await rowEditor.getByRole("button", { name: "Delete" }).click();
await page.waitForFunction(() => !document.body.textContent?.includes("delete-me"), null, { timeout: 20000 });
await page.getByRole("button", { name: "SQL" }).click();
await page.getByRole("button", { name: "Query" }).click();
await page.locator("main textarea").first().fill("SELECT body FROM " + smoke.tableName + " ORDER BY id");
await page.locator("main input").first().fill("[]");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByText("from-row-update").waitFor({ timeout: 20000 });
const sqlResultGrid = page.locator("main").locator("table").last();
await page.locator("main").getByRole("button", { name: "Sort body ascending" }).click();
await page.waitForFunction(() => {
  const table = Array.from(document.querySelectorAll("main table")).at(-1);
  const firstRow = table?.querySelector("tbody tr");
  const cells = Array.from(firstRow?.querySelectorAll("td") ?? []).map((cell) => cell.textContent?.trim() ?? "");
  return cells.includes("from-row-update");
}, null, { timeout: 20000 });
await page.locator("main").getByRole("button", { name: "Sort body descending" }).click();
await page.waitForFunction(() => {
  const table = Array.from(document.querySelectorAll("main table")).at(-1);
  const firstRow = table?.querySelector("tbody tr");
  const cells = Array.from(firstRow?.querySelectorAll("td") ?? []).map((cell) => cell.textContent?.trim() ?? "");
  return cells.includes("page-row-26");
}, null, { timeout: 20000 });
await page.getByLabel("Search result rows").fill("from-row-update");
await page.getByText(/1\/[0-9]+/).waitFor({ timeout: 20000 });
await sqlResultGrid.locator("td").first().waitFor({ timeout: 20000 });
await page.getByLabel("Search result rows").fill("missing-sql-result-row");
await page.getByText("No matching result rows").waitFor({ timeout: 20000 });
await page.getByLabel("Search result rows").fill("");
await page.getByText("from-row-update").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Copy result CSV" }).click();
const copiedResultCsvText = await page.evaluate(() => navigator.clipboard.readText());
for (const needle of ["body", "from-row-update"]) {
  if (!copiedResultCsvText.includes(needle)) throw new Error("copied result CSV missing " + needle);
}
const [resultDownload] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Download result CSV" }).click()
]);
const resultDownloadPath = await resultDownload.path();
if (!resultDownloadPath) throw new Error("result CSV download path missing");
const resultCsvText = await readFile(resultDownloadPath, "utf8");
for (const needle of ["body", "from-row-update"]) {
  if (!resultCsvText.includes(needle)) throw new Error("result CSV missing " + needle);
}
await page.locator("main textarea").first().fill("SELECT count(*) AS deleted_total FROM " + smoke.tableName + " WHERE body = 'delete-me'");
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByText("deleted_total").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Batch" }).click();
await page.locator("main textarea").first().fill([
  "CREATE TABLE browser_batch (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
  "INSERT INTO browser_batch (body) VALUES ('from-batch-editor')",
  "SELECT body AS batch_body FROM browser_batch"
].join("; "));
await page.getByRole("button", { name: "Run batch" }).click();
await page.getByText("Batch results").waitFor({ timeout: 20000 });
await page.getByText("batch_body").waitFor({ timeout: 20000 });
await page.getByText("from-batch-editor").waitFor({ timeout: 20000 });
await page.getByText("Load SQL dump").waitFor({ timeout: 20000 });
await page.locator('input[type="file"][accept=".sql,text/sql,text/plain"]').setInputFiles(smoke.sqlDumpPath);
await page.getByText("Loaded 2 statements").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Query" }).click();
await page.locator("main textarea").first().fill("SELECT body AS dump_body FROM " + smoke.dumpTableName);
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByText("dump_body").waitFor({ timeout: 20000 });
await page.getByText("from-sql-dump-load").waitFor({ timeout: 20000 });
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Download SQL dump" }).click()
]);
const downloadPath = await download.path();
if (!downloadPath) throw new Error("SQL dump download path missing");
const dumpText = await readFile(downloadPath, "utf8");
for (const needle of [smoke.tableName, smoke.dumpTableName, "from-row-update", "from-sql-dump-load"]) {
  if (!dumpText.includes(needle)) throw new Error("SQL dump missing " + needle);
}
await page.getByText(/Dumped /).waitFor({ timeout: 20000 });
const usagePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Usage events" }) }).first();
await usagePanel.getByLabel("Search usage events").waitFor({ timeout: 20000 });
await usagePanel.getByText("sql_batch").waitFor({ timeout: 20000 });
await usagePanel.getByText("CREATE+INSERT+SELECT").waitFor({ timeout: 20000 });
await usagePanel.getByText("sql_execute").waitFor({ timeout: 20000 });
await assertSearchNoMatch(usagePanel, "Search usage events", "No matching usage events", "missing-usage-event-filter");
await responseSidebar.getByText("Balance units").waitFor({ timeout: 20000 });
await responseSidebar.getByText("Spent units").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Query" }).click();
await page.getByRole("button", { name: "Archive current DB" }).click();
await page.getByText("Snapshot DB").waitFor({ timeout: 20000 });
await page.getByText(/Archived /).waitFor({ timeout: 30000 });
const [snapshotDownload] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Download snapshot" }).click()
]);
const snapshotDownloadPath = await snapshotDownload.path();
if (!snapshotDownloadPath) throw new Error("snapshot download path missing");
const snapshotBytes = await readFile(snapshotDownloadPath);
if (snapshotBytes.byteLength === 0) throw new Error("snapshot download is empty");
await page.locator('input[type="file"][accept=".db,.sqlite,.sqlite3,application/octet-stream"]').setInputFiles(snapshotDownloadPath);
await page.getByText(/Loaded /).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Restore snapshot" }).click();
await page.getByText(/Restored /).waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "SQL" }).click();
await page.locator("main textarea").first().fill("SELECT count(*) AS restored_total FROM " + smoke.tableName);
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByText("restored_total").waitFor({ timeout: 20000 });
await storagePanel.getByRole("button", { name: "Delete database" }).click();
await page.getByRole("button", { name: "Connect" }).waitFor({ timeout: 20000 });
await databasePanel.getByText("No databases").waitFor({ timeout: 20000 });
`;
}

async function playwright(args) {
  const { stdout, stderr } = await execFileAsync("playwright-cli", args, { maxBuffer: 4 * 1024 * 1024 });
  return `${stdout}${stderr}`;
}

async function consoleLogText(output) {
  const match = output.match(/\[Console\]\(([^)]+)\)/);
  return match ? await readFile(match[1], "utf8") : output;
}

async function cleanupDatabase(baseUrl, databaseId, token) {
  await callIcpdbHttp(parseCliArgs(["--base-url", baseUrl, "--token", token, "delete-db", databaseId], {})).catch(() => null);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

main().catch(async (error) => {
  await playwright(["close"]).catch(() => undefined);
  console.error(errorMessage(error));
  process.exit(1);
});
