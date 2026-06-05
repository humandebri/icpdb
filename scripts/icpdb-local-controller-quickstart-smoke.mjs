#!/usr/bin/env node
// Where: scripts/icpdb-local-controller-quickstart-smoke.mjs
// What: Focused local-network smoke for controller.env shard preflight.
// Why: Shard/controller operations need a short Server-CI proof separate from the broad multi-canister matrix.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Ed25519KeyIdentity } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/identity/index.js";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";
const smokeProgress = process.env.ICPDB_SMOKE_PROGRESS === "1";
const packageCliPath = fileURLToPath(new URL("../icpdb-console/dist-sdk/icpdb-cli.js", import.meta.url));

async function main() {
  await assertPackageCliBuilt();
  const network = await localNetworkConfig(environment, canisterName);
  const controllerIdentity = Ed25519KeyIdentity.generate();
  const controllerPrincipal = controllerIdentity.getPrincipal().toText();
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-controller-quickstart-smoke-"));
  const controllerEnvPath = join(tempDir, "controller.env");
  progress(`network ${network.networkUrl} canister ${network.canisterId}`);

  const databaseId = parseOkText(await callCanister(network, "create_database", "()"), "create_database");
  progress(`created remote-placement probe database ${databaseId}`);
  await addLocalCanisterController(network, controllerPrincipal);
  await writeControllerEnvFile(controllerEnvPath, network, controllerIdentity);
  assert.equal((await stat(controllerEnvPath)).mode & 0o777, 0o600);
  const controllerEnvText = await readFile(controllerEnvPath, "utf8");
  assertIncludes(controllerEnvText, `ICPDB_CANISTER_ID="${network.canisterId}"`);
  assert.ok(!controllerEnvText.includes("ICPDB_DATABASE_ID="), "controller.env must stay canister-only");
  assert.ok(!controllerEnvText.includes(`icpdb://${network.canisterId}/`), "controller.env must not be database-bearing");

  const principalOutput = await runPackageCli(["principal", "--service-env-file", controllerEnvPath, "--format", "table"]);
  assertIncludes(principalOutput, controllerPrincipal);
  const inspectOutput = await runPackageCli(["inspect-env", "--service-env-file", controllerEnvPath, "--format", "table"]);
  assertIncludes(inspectOutput, network.canisterId);
  assertIncludes(inspectOutput, controllerPrincipal);
  const healthOutput = await runPackageCli(["health", "--service-env-file", controllerEnvPath, "--format", "table"]);
  assertIncludesAny(healthOutput, ["cycles_balance", "cyclesBalance"]);
  const placementsOutput = await runPackageCli(["all-placements", "--service-env-file", controllerEnvPath, "--format", "table"]);
  assertIncludes(placementsOutput, databaseId);
  const shardsOutput = await runPackageCli(["shards", "--service-env-file", controllerEnvPath, "--format", "table"]);
  assertIncludesAny(shardsOutput, ["canister_id", "canisterId"]);
  const shardOpsOutput = await runPackageCli(["shard-ops", "--service-env-file", controllerEnvPath, "--format", "table"]);
  assertIncludes(shardOpsOutput, "operation");
  const checkOutput = await runPackageCli([
    "check-env",
    "--service-env-file",
    controllerEnvPath,
    "--smoke-shards",
    "--smoke-sdk-shards",
    "--format",
    "table"
  ]);
  assertIncludes(checkOutput, "shardSmoke");
  assertIncludes(checkOutput, "sdkShardSmoke");
  assertIncludes(checkOutput, "checks");
  progress("controller.env shard CLI and SDK smoke verified");
  console.log(`ICPDB local controller quickstart smoke OK: ${controllerPrincipal}`);
}

async function callCanister(network, method, args) {
  const { stdout } = await execFileAsync("icp", [
    "canister",
    "call",
    "-n",
    network.canisterNetwork,
    network.canisterId,
    method,
    args,
    "-o",
    "candid"
  ]);
  return stdout.trim();
}

async function addLocalCanisterController(network, principal) {
  await execFileAsync("icp", [
    "canister",
    "settings",
    "update",
    network.canisterName,
    "-e",
    network.environment,
    "--add-controller",
    principal,
    "-f"
  ]);
}

async function writeControllerEnvFile(path, network, identity) {
  const env = {
    ICPDB_CANISTER_ID: network.canisterId,
    ICPDB_NETWORK_URL: network.networkUrl,
    ICPDB_ROOT_KEY: network.rootKey,
    ICPDB_IDENTITY_TYPE: "ed25519",
    ICPDB_IDENTITY_PRINCIPAL: identity.getPrincipal().toText(),
    ICPDB_IDENTITY_JSON: JSON.stringify(identity.toJSON())
  };
  await writeFile(path, `${envFileLines(env).join("\n")}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function envFileLines(env) {
  return Object.entries(env)
    .filter(([_key, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
}

async function runPackageCli(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [packageCliPath, ...args], {
      env: process.env,
      maxBuffer: 1024 * 1024 * 16
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`package CLI failed for ${args.join(" ")}: ${message}${stderr ? `\n${stderr}` : ""}`);
  }
}

async function assertPackageCliBuilt() {
  try {
    await stat(packageCliPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(`controller quickstart smoke requires built SDK bin: run pnpm --dir icpdb-console build:sdk before ${fileURLToPath(import.meta.url)}`);
    }
    throw error;
  }
}

function parseOkText(source, label) {
  const match = source.match(/variant\s*\{\s*Ok\s*=\s*"([^"]+)"/);
  assert.ok(match, `expected ${label} Ok text\n${source}`);
  return match[1];
}

function progress(message) {
  if (smokeProgress) console.error(`[icpdb-controller-quickstart-smoke] ${message}`);
}

function assertIncludes(source, expected) {
  assert.ok(source.includes(expected), `expected output to include ${expected}\n${source}`);
}

function assertIncludesAny(source, expectedValues) {
  assert.ok(expectedValues.some((expected) => source.includes(expected)), `expected output to include one of ${expectedValues.join(", ")}\n${source}`);
}

function isErrnoException(error) {
  return typeof error === "object" && error !== null && "code" in error;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
