#!/usr/bin/env node
// Where: scripts/icpdb-local-ii-browser-smoke.mjs
// What: Live browser smoke for Internet Identity login and authenticated Table/SQL flows.
// Why: Bearer-token UI is not enough; the owner workflow must also work through II delegation.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const devPort = process.env.ICPDB_II_BROWSER_SMOKE_PORT ?? "3000";
const playwrightSession = process.env.ICPDB_II_BROWSER_SMOKE_SESSION ?? "icpdb-ii-smoke";
const tableName = `ii_notes_${Date.now()}`;

async function main() {
  const network = await localNetworkConfig(environment, canisterName);
  const server = process.env.ICPDB_II_BROWSER_SMOKE_CONSOLE_URL
    ? null
    : startConsoleServer(network);
  const consoleUrl = process.env.ICPDB_II_BROWSER_SMOKE_CONSOLE_URL ?? `http://127.0.0.1:${devPort}/icpdb`;
  try {
    if (server) await waitForConsole(consoleUrl);
    await runBrowserSmoke({
      canisterName,
      canisterId: network.canisterId,
      canisterNetwork: network.canisterNetwork,
      consoleUrl,
      environment,
      networkUrl: network.networkUrl,
      repoRoot: process.cwd(),
      rootKey: network.rootKey,
      tableName
    });
  } finally {
    if (server) server.kill("SIGTERM");
    await playwright(["close"]).catch(() => undefined);
  }
  console.log(`ICPDB local II browser smoke OK: ${tableName}`);
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
  await playwright(["close"]).catch(() => undefined);
  await playwright(["delete-data"]).catch(() => undefined);
  await playwright(["open", smoke.consoleUrl]);
  await playwright(["run-code", browserSmokeCode(smoke)]);
  const consoleOutput = await playwright(["console", "error"]).catch(commandOutput);
  const consoleLog = await consoleLogText(consoleOutput);
  if (!consoleLog.includes("Errors: 0")) throw new Error(consoleLog);
}

function browserSmokeCode(smoke) {
  return `
const smoke = ${JSON.stringify(smoke)};
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const execFileAsync = promisify(execFile);
const identityName = "icpdb smoke " + Date.now();
page.on("dialog", (dialog) => dialog.accept("0"));
const popupPromise = page.context().waitForEvent("page");
await page.getByRole("button", { name: "Login" }).click();
const iiPage = await popupPromise;
iiPage.on("dialog", (dialog) => dialog.accept("0"));
await iiPage.getByRole("button", { name: "Continue with passkey" }).click();
await iiPage.getByRole("button", { name: "Create new identity" }).click();
await iiPage.getByPlaceholder("Identity name").fill(identityName);
await iiPage.getByRole("button", { name: "Create identity" }).click();
await iiPage.waitForURL(/authorize\\/continue/, { timeout: 20000 });
await iiPage.waitForLoadState("domcontentloaded");
await iiPage.waitForTimeout(500);
if ((await iiPage.locator("body").innerText()).trim().length === 0) {
  await iiPage.reload();
}
await iiPage.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Create database" }).waitFor({ timeout: 20000 });
const principalPanel = page.locator("aside div").filter({ has: page.getByText("Principal") }).first();
const controllerPrincipal = (await principalPanel.locator("p").nth(1).innerText()).trim();
await execFileAsync("icp", [
  "canister",
  "settings",
  "update",
  smoke.canisterName,
  "-e",
  smoke.environment,
  "--add-controller",
  controllerPrincipal,
  "-f"
], { cwd: smoke.repoRoot, maxBuffer: 4 * 1024 * 1024 });
await page.getByRole("button", { name: "Create database" }).click();
await page.waitForFunction(() => {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("Create table"));
  return button instanceof HTMLButtonElement && !button.disabled;
}, null, { timeout: 30000 });
const databasePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Databases" }) }).first();
const tablePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Tables" }) }).first();
await databasePanel.getByText(/db_/).waitFor({ timeout: 20000 });
const createdDatabaseId = (await databasePanel.locator("button").filter({ hasText: /db_/ }).first().locator("span").first().innerText()).trim();
await databasePanel.getByLabel("Search databases").fill(createdDatabaseId.slice(0, 8));
await databasePanel.getByText("1/1").waitFor({ timeout: 20000 });
await databasePanel.getByText(createdDatabaseId).waitFor({ timeout: 20000 });
await databasePanel.getByLabel("Search databases").fill("missing_database");
await databasePanel.getByText("No matching databases").waitFor({ timeout: 20000 });
await databasePanel.getByLabel("Search databases").fill("");
await tablePanel.getByText("No tables").waitFor({ timeout: 20000 });
const placementPanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Shard placement" }) }).first();
await placementPanel.getByRole("table").waitFor({ timeout: 20000 });
await placementPanel.getByLabel("Search shard placements").fill(createdDatabaseId.slice(0, 8));
await placementPanel.getByText("1/1").waitFor({ timeout: 20000 });
await placementPanel.getByLabel("Search shard placements").fill("");
await placementPanel.getByText(/database:|local/).waitFor({ timeout: 20000 });
await placementPanel.getByRole("button", { name: "All" }).click();
await placementPanel.getByText(/All placements:/).waitFor({ timeout: 20000 });
const unknownTarget = "browser-unknown-" + Date.now();
async function createUnknownShardOperation(target) {
  const args = [
    "canister",
    "call",
    "-n",
    smoke.canisterNetwork,
    smoke.canisterId,
    "top_up_database_shard",
    '(record { database_canister_id = "' + target + '"; cycles = 1 : nat })',
    "-o",
    "candid"
  ];
  if (smoke.rootKey && /^https?:\\/\\//.test(smoke.canisterNetwork)) args.splice(4, 0, "-k", smoke.rootKey);
  await execFileAsync("icp", args, { cwd: smoke.repoRoot, maxBuffer: 4 * 1024 * 1024 });
}
await createUnknownShardOperation(unknownTarget);
const journalPanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Shard journal" }) }).first();
await journalPanel.getByRole("button", { name: "Refresh" }).click();
await journalPanel.getByLabel("Search shard operations").fill(unknownTarget);
const failedRow = journalPanel.getByRole("row").filter({ hasText: unknownTarget });
await failedRow.getByText("unknown").waitFor({ timeout: 20000 });
await journalPanel.getByPlaceholder("required for failed").fill("operator verified by browser smoke");
await failedRow.getByRole("button", { name: "Mark failed" }).click();
await journalPanel.getByText(/Reconciled/).waitFor({ timeout: 20000 });
await failedRow.getByText("failed").waitFor({ timeout: 20000 });
await journalPanel.getByLabel("Search shard operations").fill("");
const appliedTarget = "browser-applied-" + Date.now();
await createUnknownShardOperation(appliedTarget);
await journalPanel.getByRole("button", { name: "Refresh" }).click();
await journalPanel.getByLabel("Search shard operations").fill(appliedTarget);
const appliedRow = journalPanel.getByRole("row").filter({ hasText: appliedTarget });
await appliedRow.getByText("unknown").waitFor({ timeout: 20000 });
await appliedRow.getByRole("button", { name: "Mark applied" }).click();
await journalPanel.getByText(/Reconciled/).waitFor({ timeout: 20000 });
await appliedRow.getByText("applied").waitFor({ timeout: 20000 });
await journalPanel.getByLabel("Search shard operations").fill("");
await page.locator('input[placeholder="table_name"]').fill(smoke.tableName);
await page.locator("aside textarea").fill("id INTEGER PRIMARY KEY, body TEXT NOT NULL");
await page.getByRole("button", { name: "Create table" }).click();
await page.getByRole("button", { name: smoke.tableName }).waitFor({ timeout: 20000 });
await tablePanel.getByText(smoke.tableName).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "New" }).click();
await page.locator("main textarea").first().fill(JSON.stringify({ body: "from-ii-login" }));
await page.getByRole("button", { name: "Insert" }).click();
await page.getByText("from-ii-login").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "SQL" }).click();
await page.getByRole("button", { name: "Query" }).click();
await page.locator("main textarea").first().fill("SELECT body AS ii_body FROM " + smoke.tableName + " ORDER BY id");
await page.locator("main input").first().fill("[]");
await page.getByRole("button", { name: "Run statement" }).click();
await page.getByText("ii_body").waitFor({ timeout: 20000 });
await page.getByText("from-ii-login").waitFor({ timeout: 20000 });
const storagePanel = page.locator("div").filter({ has: page.getByRole("heading", { name: "Storage / quota" }) }).first();
await storagePanel.getByRole("button", { name: "Delete database" }).click();
await page.getByText("No databases").waitFor({ timeout: 20000 });
`;
}

async function playwright(args) {
  const { stdout, stderr } = await execFileAsync("playwright-cli", [`-s=${playwrightSession}`, ...args], {
    maxBuffer: 4 * 1024 * 1024
  });
  return `${stdout}${stderr}`;
}

async function consoleLogText(output) {
  const match = output.match(/\[Console\]\(([^)]+)\)/);
  return match ? await readFile(match[1], "utf8") : output;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function commandOutput(error) {
  if (typeof error === "object" && error !== null) {
    const stdout = Reflect.get(error, "stdout");
    const stderr = Reflect.get(error, "stderr");
    if (typeof stdout === "string" || typeof stderr === "string") {
      return `${typeof stdout === "string" ? stdout : ""}${typeof stderr === "string" ? stderr : ""}`;
    }
  }
  return errorMessage(error);
}

main().catch(async (error) => {
  await playwright(["close"]).catch(() => undefined);
  console.error(errorMessage(error));
  process.exit(1);
});
