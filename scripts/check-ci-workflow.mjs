#!/usr/bin/env node
// Where: scripts/check-ci-workflow.mjs
// What: Validate GitHub Actions CI wiring against repository scripts and package commands.
// Why: Release checks should catch stale CI command paths before GitHub Actions runs.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const workflow = read(".github/workflows/ci.yml");
const consolePackage = JSON.parse(read("icpdb-console/package.json"));
const consoleScripts = consolePackage.scripts ?? {};

function read(path) {
  assert.equal(existsSync(path), true, `${path} missing`);
  return readFileSync(path, "utf8");
}

function expectText(source, values, label) {
  for (const value of values) assert.equal(source.includes(value), true, `${label} missing ${value}`);
}

function rejectText(source, values, label) {
  for (const value of values) assert.equal(source.includes(value), false, `${label} unexpectedly contains ${value}`);
}

function expectScript(path) {
  assert.equal(existsSync(path), true, `CI references missing script: ${path}`);
}

function expectConsoleScript(name) {
  assert.equal(typeof consoleScripts[name], "string", `icpdb-console package script missing: ${name}`);
}

expectText(workflow, [
  "icpdb-console-check:",
  "icpdb-root-check:",
  "rust-check:",
  "canister-build:",
  "actions/checkout@v5",
  "actions/setup-node@v5",
  "node-version: 24",
  "corepack enable",
  "cache-dependency-path: icpdb-console/pnpm-lock.yaml",
  "pnpm --dir icpdb-console install --frozen-lockfile",
  "RUST_TEST_THREADS: 1",
  "rustup target add wasm32-unknown-unknown",
  "cargo install ic-wasm --locked",
  "ICP_WASM_OUTPUT_PATH: /tmp/icpdb_database_canister.wasm",
  "ICP_WASM_OUTPUT_PATH: /tmp/icpdb_canister.wasm"
], "CI workflow");

rejectText(workflow, [
  "wasm32-wasip1",
  "wasi-libc",
  "wasi2ic",
  "dfx"
], "CI retired commands");

for (const scriptPath of [
  "scripts/check-ci-workflow.mjs",
  "scripts/check-icpdb-http-cli.mjs",
  "scripts/check-icpdb-identity-cli.mjs",
  "scripts/check-icpdb-local-network.mjs",
  "scripts/check-icpdb-service-env-check.mjs",
  "scripts/check-icpdb-goal.mjs",
  "scripts/icpdb-release-check.mjs",
  "scripts/icpdb-mainnet-preflight.mjs",
  "scripts/icpdb-mainnet-postdeploy.mjs",
  "scripts/build-icpdb-database-canister.sh",
  "scripts/build-icpdb-canister.sh"
]) {
  expectText(workflow, [scriptPath], "CI workflow");
  expectScript(scriptPath);
}

for (const scriptName of ["test", "lint", "typecheck", "build", "build:worker"]) {
  expectText(workflow, [`pnpm ${scriptName}`], "CI console commands");
  expectConsoleScript(scriptName);
}

expectText(consoleScripts.test, [
  "pnpm run build:sdk",
  "node scripts/check-sdk-package-artifact.mjs",
  "node scripts/check-sdk-client.mjs",
  "node scripts/check-icpdb.mjs"
], "icpdb-console test script");

expectText(workflow, [
  "cargo test -p icpdb-runtime -p icpdb-canister -p icpdb-database-canister --locked",
  "cargo clippy -p icpdb-runtime -p icpdb-canister -p icpdb-database-canister --all-targets --locked -- -D warnings",
  "node scripts/check-icpdb-local-network.mjs",
  "node scripts/check-icpdb-service-env-check.mjs",
  "node scripts/icpdb-release-check.mjs --self-test",
  "node scripts/icpdb-release-check.mjs --skip-build --skip-console",
  "node scripts/icpdb-mainnet-preflight.mjs --self-test",
  "node scripts/icpdb-mainnet-postdeploy.mjs --self-test",
  "node scripts/icpdb-mainnet-preflight.mjs --skip-build",
  "node scripts/icpdb-mainnet-postdeploy.mjs --skip-call",
  "node scripts/icpdb-mainnet-preflight.mjs"
], "CI command coverage");

process.stdout.write("ICPDB CI workflow checks OK\n");
