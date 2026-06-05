#!/usr/bin/env node
// Where: scripts/icpdb-local-goal-smoke.mjs
// What: Run the live local smoke suite that proves ICPDB hosted SQLite DB behavior.
// Why: The goal spans SDK, HTTP CLI, identity CLI, shard routing, and both console auth paths.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);

const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const topUpAmount = process.env.ICPDB_SMOKE_TOP_UP_AMOUNT ?? "20t";
const options = parseArgs(process.argv.slice(2));
const shouldTopUp = !options.skipTopUp && process.env.ICPDB_SMOKE_SKIP_TOP_UP !== "1" && environment !== "ic";

const allCommands = [
  { id: "http-cli", command: "node", args: ["scripts/icpdb-local-cli-smoke.mjs"] },
  { id: "sdk-build", command: "pnpm", args: ["--dir", "icpdb-console", "build:sdk"] },
  { id: "sdk", command: "node", args: ["scripts/icpdb-local-sdk-smoke.mjs"] },
  { id: "sdk-shortest", command: "node", args: ["scripts/icpdb-local-sdk-smoke.mjs", "--only", "shortest"], default: false },
  { id: "sdk-browser-shortest", command: "node", args: ["scripts/icpdb-local-sdk-smoke.mjs", "--only", "browser-shortest"], default: false },
  { id: "sdk-sqlite-shortest", command: "node", args: ["scripts/icpdb-local-sdk-smoke.mjs", "--only", "sqlite-shortest"], default: false },
  { id: "sdk-libsql-shortest", command: "node", args: ["scripts/icpdb-local-sdk-smoke.mjs", "--only", "libsql-shortest"], default: false },
  { id: "identity-quickstart", command: "node", args: ["scripts/icpdb-local-identity-quickstart-smoke.mjs"], default: true },
  { id: "service-query-only", command: "node", args: ["scripts/icpdb-local-identity-quickstart-smoke.mjs", "--only", "query-only"], default: false },
  { id: "service-owner", command: "node", args: ["scripts/icpdb-local-service-env-owner-smoke.mjs"], default: true },
  { id: "service-owner-backup", command: "node", args: ["scripts/icpdb-local-service-env-owner-smoke.mjs", "--archive-restore"], default: false },
  { id: "postdeploy-sql-archive", command: "node", args: ["scripts/icpdb-local-postdeploy-smoke.mjs"], default: false },
  { id: "identity-cli-full", command: "node", args: ["scripts/icpdb-local-identity-cli-smoke.mjs"], default: false },
  { id: "controller-quickstart", command: "node", args: ["scripts/icpdb-local-controller-quickstart-smoke.mjs"], default: true },
  { id: "console-shortest", command: "node", args: ["scripts/icpdb-local-console-shortest-smoke.mjs"], default: false },
  { id: "shards", command: "node", args: ["scripts/icpdb-local-multicanister-smoke.mjs"] },
  { id: "browser", command: "node", args: ["scripts/icpdb-local-browser-smoke.mjs"] },
  { id: "ii-browser", command: "node", args: ["scripts/icpdb-local-ii-browser-smoke.mjs"] }
];

if (options.listSteps) {
  process.stdout.write(`${allCommands.map((step) => `${step.id}\t${step.default === false ? "optional" : "default"}\t${[step.command, ...step.args].join(" ")}`).join("\n")}\n`);
  process.exit(0);
}

const commands = selectedCommands(options.only);
if (shouldTopUp) await topUpLocalCanisters();
if (options.topUpOnly) {
  process.stdout.write("ICPDB local goal smoke top-up OK\n");
  process.exit(0);
}

for (const step of commands) {
  const label = [step.command, ...step.args].join(" ");
  process.stderr.write(`\n$ ${label}\n`);
  await runStep(step.command, step.args, {
    env: { ...process.env, ICPDB_SMOKE_PROGRESS: process.env.ICPDB_SMOKE_PROGRESS ?? "1" },
    stdio: "inherit"
  });
}

process.stdout.write("ICPDB local goal smoke OK\n");

function parseArgs(args) {
  const parsed = { listSteps: false, only: [], skipTopUp: false, topUpOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--top-up-only") {
      parsed.topUpOnly = true;
    } else if (arg === "--skip-top-up") {
      parsed.skipTopUp = true;
    } else if (arg === "--list-steps") {
      parsed.listSteps = true;
    } else if (arg === "--only") {
      index += 1;
      if (index >= args.length) fail("--only requires a comma-separated step list");
      parsed.only.push(...stepIds(args[index]));
    } else if (arg.startsWith("--only=")) {
      parsed.only.push(...stepIds(arg.slice("--only=".length)));
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (parsed.topUpOnly && parsed.only.length > 0) {
    fail("--top-up-only cannot be combined with --only");
  }
  if (parsed.topUpOnly && parsed.skipTopUp) {
    fail("--top-up-only cannot be combined with --skip-top-up");
  }
  return parsed;
}

function stepIds(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function selectedCommands(only) {
  if (only.length === 0) return allCommands.filter((step) => step.default !== false);
  const knownIds = new Set(allCommands.map((step) => step.id));
  const unknownIds = only.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    fail(`unknown --only step: ${unknownIds.join(", ")}; run --list-steps`);
  }
  const selected = new Set(only);
  return allCommands.filter((step) => selected.has(step.id));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function topUpLocalCanisters() {
  await runStep("icp", ["canister", "top-up", "-e", environment, "--amount", topUpAmount, canisterName], {
    env: process.env,
    stdio: "inherit"
  });
  const network = await localNetworkConfig(environment, canisterName);
  const shardsOutput = await commandOutput("node", [
    "scripts/icpdb-http.mjs",
    "--network-url",
    environment,
    "--canister-id",
    network.canisterId,
    "shards"
  ]);
  const shardCanisterIds = shardCanisterIdsFromOutput(shardsOutput);
  for (const canisterId of shardCanisterIds) {
    await runStep("icp", ["canister", "top-up", "-n", environment, "--amount", topUpAmount, canisterId], {
      env: process.env,
      stdio: "inherit"
    });
  }
}

function shardCanisterIdsFromOutput(output) {
  const candid = candidTextFromOutput(output);
  return [...new Set([...candid.matchAll(/canister_id = "([^"]+)"/g)].map((match) => match[1]))];
}

function candidTextFromOutput(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed.candid === "string") return parsed.candid;
  } catch {
    return output;
  }
  return output;
}

async function commandOutput(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    env: { ...process.env, ICPDB_SMOKE_PROGRESS: process.env.ICPDB_SMOKE_PROGRESS ?? "1" },
    maxBuffer: 4 * 1024 * 1024
  });
  return `${stdout}${stderr}`;
}

function runStep(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}
