#!/usr/bin/env node
// Where: scripts/icpdb-local-console-shortest-smoke.mjs
// What: Focused local browser smoke for console schema/table/SQL inspection.
// Why: The goal needs a quick proof that the console can inspect a normal hosted SQLite DB without running the full browser matrix.
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { callIcpdbHttp, createIcpdbDatabase, parseCliArgs } from "./icpdb-http.mjs";
import { recordLocalIcpdbPayment } from "./icpdb-local-deposit.mjs";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const devPort = process.env.ICPDB_CONSOLE_SHORTEST_SMOKE_PORT ?? "3001";
const smokeProgress = process.env.ICPDB_SMOKE_PROGRESS === "1";

async function main() {
  const network = await localNetworkConfig(environment, canisterName);
  progress(`network ${network.networkUrl} canister ${network.canisterId}`);
  const created = await createIcpdbDatabase({
    canisterId: network.canisterId,
    networkUrl: network.canisterNetwork,
    rootKey: "",
    tokenName: "console-shortest-smoke"
  });
  const databaseId = created.database_id;
  const token = created.owner_token.token;
  await recordLocalIcpdbPayment(network, databaseId);
  const baseUrl = await workingBaseUrl(network, token, databaseId);
  const server = process.env.ICPDB_CONSOLE_SHORTEST_SMOKE_URL
    ? null
    : startConsoleServer(network);
  const consoleUrl = process.env.ICPDB_CONSOLE_SHORTEST_SMOKE_URL ?? `http://127.0.0.1:${devPort}/icpdb`;
  try {
    if (server) await waitForConsole(consoleUrl);
    progress(`console ready ${consoleUrl}`);
    await runBrowserSmoke({ baseUrl, canisterId: network.canisterId, consoleUrl, databaseId, token });
    progress("console shortest assertions verified");
  } finally {
    await cleanupDatabase(baseUrl, databaseId, token);
    if (server) server.kill("SIGTERM");
    await playwright(["close"]).catch(() => undefined);
  }
  console.log(`ICPDB local console shortest smoke OK: ${databaseId} via ${baseUrl}`);
}

function progress(message) {
  if (smokeProgress) console.error(`[icpdb-console-shortest-smoke] ${message}`);
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
async function assertCatalogShortcut(label, buttonName, needles) {
  await page.locator("main").getByRole("button", { name: buttonName }).click();
  const openedSql = await page.locator("main textarea").first().inputValue();
  for (const needle of needles) {
    if (!openedSql.includes(needle)) throw new Error(label + " catalog shortcut missing " + needle);
  }
  const paramsJson = await page.locator("main input").first().inputValue();
  if (paramsJson !== "[]") throw new Error(label + " catalog shortcut did not clear params");
}
await page.getByPlaceholder("https://<canister-id>.icp0.io").fill(smoke.baseUrl);
await page.getByPlaceholder("database_id").fill(smoke.databaseId);
await page.getByPlaceholder("api token").fill(smoke.token);
await page.getByRole("button", { name: "Connect" }).click();
await page.getByRole("button", { name: "Sync" }).waitFor({ timeout: 20000 });
const databasePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Databases" }) }).first();
const tablePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Tables" }) }).first();
const responseSidebar = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Response" }) }).first();
await databasePanel.getByText(smoke.databaseId).waitFor({ timeout: 20000 });
await responseSidebar.getByText("icpdb://" + smoke.canisterId + "/" + smoke.databaseId).waitFor({ timeout: 20000 });
await clickCopyButton("Copy Connection URL");
const copiedConnectionUrl = await page.evaluate(() => navigator.clipboard.readText());
if (copiedConnectionUrl !== "icpdb://" + smoke.canisterId + "/" + smoke.databaseId) {
  throw new Error("copied connection URL mismatch: " + copiedConnectionUrl);
}
await tablePanel.getByText("No tables").waitFor({ timeout: 20000 });
await tablePanel.getByRole("button", { name: "Open setup SQL" }).click();
await page.locator("main textarea").first().waitFor({ timeout: 20000 });
const openedSetupSql = await page.locator("main textarea").first().inputValue();
for (const needle of ["CREATE TABLE \\"notes\\"", "hello from ICPDB", "sqlite_schema", "SELECT * FROM \\"notes\\" LIMIT 25"]) {
  if (!openedSetupSql.includes(needle)) throw new Error("setup SQL shortcut missing " + needle);
}
await page.getByRole("button", { name: "Run batch" }).click();
await page.getByText("hello from ICPDB").waitFor({ timeout: 20000 });
await tablePanel.getByRole("button", { name: "notes" }).waitFor({ timeout: 20000 });
await tablePanel.getByRole("button", { name: "Open SELECT SQL for notes" }).click();
const openedTableSql = await page.locator("main textarea").first().inputValue();
if (!openedTableSql.includes("SELECT * FROM") || !openedTableSql.includes("notes")) {
  throw new Error("table SELECT SQL shortcut did not target notes");
}
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByText("hello from ICPDB").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "SQL" }).click();
await assertCatalogShortcut("Schema", "Open sqlite_schema SQL", ["SELECT type, name, tbl_name, sql", "FROM sqlite_schema"]);
await assertCatalogShortcut("Tables", "Open table list SQL", ["SELECT name, type, sql", "WHERE type IN ('table', 'view')"]);
await assertCatalogShortcut("Columns", "Open column catalog SQL", ["pragma_table_xinfo", "column_name"]);
await page.getByRole("button", { name: "Table" }).click();
await tablePanel.getByRole("button", { name: "notes" }).click();
await page.getByRole("heading", { name: "Columns" }).waitFor({ timeout: 20000 });
await page.getByText("body").waitFor({ timeout: 20000 });
await clickCopyButton("Copy page SQL for notes limit 100 offset 0");
const copiedPageSqlText = await page.evaluate(() => navigator.clipboard.readText());
if (copiedPageSqlText !== 'SELECT * FROM "notes" LIMIT 100 OFFSET 0;') {
  throw new Error("copied page SQL mismatch: " + copiedPageSqlText);
}
await page.getByRole("button", { name: "Open INSERT SQL for notes" }).click();
const openedInsertSql = await page.locator("main textarea").first().inputValue();
if (openedInsertSql !== 'INSERT INTO "notes" ("body") VALUES (?1);') {
  throw new Error("opened INSERT SQL mismatch: " + openedInsertSql);
}
const openedInsertParams = await page.locator("main input").first().inputValue();
if (openedInsertParams !== JSON.stringify([null], null, 2)) {
  throw new Error("opened INSERT params mismatch: " + openedInsertParams);
}
await page.getByRole("button", { name: "Table" }).click();
await tablePanel.getByRole("button", { name: "notes" }).click();
await page.getByRole("button", { name: "Open count SQL for notes" }).click();
const openedCountSql = await page.locator("main textarea").first().inputValue();
if (openedCountSql !== 'SELECT count(*) AS total FROM "notes";') {
  throw new Error("opened count SQL mismatch: " + openedCountSql);
}
await page.getByRole("button", { name: "Table" }).click();
await tablePanel.getByRole("button", { name: "notes" }).click();
await page.getByRole("button", { name: "Open column SQL" }).click();
const openedColumnSql = await page.locator("main textarea").first().inputValue();
if (openedColumnSql !== 'PRAGMA table_xinfo("notes");') {
  throw new Error("opened column SQL mismatch: " + openedColumnSql);
}
await page.getByRole("button", { name: "Table" }).click();
await tablePanel.getByRole("button", { name: "notes" }).click();
await page.getByRole("button", { name: "Copy schema SQL" }).click();
const copiedSchemaSqlText = await page.evaluate(() => navigator.clipboard.readText());
for (const needle of ["CREATE TABLE", "notes", "body"]) {
  if (!copiedSchemaSqlText.includes(needle)) throw new Error("copied schema SQL missing " + needle);
}
await page.getByRole("button", { name: "Open schema SQL" }).click();
const openedSchemaSql = await page.locator("main textarea").first().inputValue();
if (openedSchemaSql !== copiedSchemaSqlText) {
  throw new Error("opened schema SQL did not match copied schema SQL");
}
await page.getByRole("button", { name: "Table" }).click();
await tablePanel.getByRole("button", { name: "notes" }).click();
await page.getByRole("button", { name: /^Open schema lookup SQL$/ }).click();
const openedSchemaLookupSql = await page.locator("main textarea").first().inputValue();
for (const needle of ["SELECT type, name, tbl_name, sql", "FROM sqlite_schema", "WHERE tbl_name = ?1 OR name = ?1"]) {
  if (!openedSchemaLookupSql.includes(needle)) throw new Error("opened schema lookup SQL missing " + needle);
}
const schemaLookupParams = await page.locator("main input").first().inputValue();
if (schemaLookupParams !== JSON.stringify(["notes"], null, 2)) {
  throw new Error("opened schema lookup params missing notes");
}
await page.getByRole("button", { name: /Run (query|update)/ }).click();
await page.getByText("CREATE TABLE").waitFor({ timeout: 20000 });
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
