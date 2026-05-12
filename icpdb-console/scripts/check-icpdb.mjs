import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pageUrl = new URL("../app/icpdb/page.tsx", import.meta.url);
const workbenchUrl = new URL("../components/icpdb-workbench.tsx", import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(existsSync(pageUrl), true);
assert.equal(existsSync(workbenchUrl), true);

const page = readFileSync(pageUrl, "utf8");
const workbench = readFileSync(workbenchUrl, "utf8");

assert.match(page, /Canister SQLite Console/);
assert.match(page, /SQL Workbench/);
assert.doesNotMatch(page, /\bany\b/);
assert.doesNotMatch(page, /\bas\b/);

assert.match(workbench, /createDatabaseAuthenticated/);
assert.match(workbench, /sqlQueryAuthenticated/);
assert.match(workbench, /sqlExecuteAuthenticated/);
assert.match(workbench, /getUsageAuthenticated/);
assert.match(workbench, /fee更新済み。再quoteしてapprove額を更新/);
assert.match(workbench, /再実行前にledger履歴確認/);
assert.match(workbench, /depositQuoteMatchesAmount/);
assert.match(workbench, /fresh quote required before deposit/);
assert.match(workbench, /NEXT_PUBLIC_ICPDB_WALLET_SIGNER_URL/);
assert.match(workbench, /NEXT_PUBLIC_ICPDB_WALLET_HOST/);
assert.match(workbench, /NEXT_PUBLIC_ICPDB_CANISTER_ID/);
assert.match(workbench, /IcpWallet\.connect/);
assert.match(workbench, /icrc2Approve/);
assert.match(workbench, /wallet principal must match login principal/);
assert.match(workbench, /wallet approve required before deposit/);
assert.match(workbench, /walletStatus === "approving"/);
assert.match(workbench, /disabled=\{!canDeposit\}/);
assert.match(workbench, /disabled=\{!canApproveDeposit\}/);
assert.match(workbench, /Number\.isSafeInteger/);
assert.match(workbench, /integer params must be safe JS integers/);
assert.doesNotMatch(workbench, /\bany\b/);
assert.doesNotMatch(workbench, /\bas\b/);

assert.match(packageJson.scripts.test, /check-icpdb\.mjs/);
const removedScriptChecks = [
  ["check-", "dash", "board"].join(""),
  "check-paths",
  "check-smoke-url",
  "check-ui-helpers"
];
for (const removedScriptCheck of removedScriptChecks) {
  assert.equal(packageJson.scripts.test.includes(removedScriptCheck), false);
}
assert.equal(packageJson.dependencies["@dfinity/oisy-wallet-signer"], "^4.1.3");

console.log("ICPDB console checks OK");
