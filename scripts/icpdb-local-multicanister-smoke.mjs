#!/usr/bin/env node
// Where: scripts/icpdb-local-multicanister-smoke.mjs
// What: Live local-network smoke for control -> database canister routed SQL/table flows.
// Why: Sharding needs proof that routed writes, operation guards, and archive flows work through real inter-canister calls.
import { execFile, spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { callIcpdbHttp, parseCliArgs } from "./icpdb-http.mjs";
import { controllerCliArgs, localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const controlCanisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";

async function main() {
  const network = await localNetworkConfig(environment, controlCanisterName);

  // create_database_shard is the manual controller path; normal create_database auto-provisions, chunk-installs, and calls create_database_slot.
  const databaseId = parseOkText(
    await callCanister(network, network.canisterId, "create_database", "()"),
    "create_database"
  );
  const tokenOutput = await callCanister(
    network,
    network.canisterId,
    "create_database_token",
    `(record { database_id = ${candidText(databaseId)}; name = "remote-smoke-owner"; scope = variant { Owner } })`
  );
  const ownerToken = parseOwnerToken(tokenOutput);
  const baseUrl = await workingBaseUrl(network, ownerToken.token, databaseId);
  const placement = await runCliCommand(baseUrl, ownerToken.token, ["placement", databaseId]);
  const databaseCanisterId = parsePlacementCanisterId(placement);

  const shardTopUp = await callCanister(
    network,
    network.canisterId,
    "top_up_database_shard",
    `(record { database_canister_id = ${candidText(databaseCanisterId)}; cycles = 1_000_000 : nat })`
  );
  assertIncludes(shardTopUp, databaseCanisterId);
  const shardStatus = await callCanister(
    network,
    network.canisterId,
    "get_database_shard_status",
    `(record { database_canister_id = ${candidText(databaseCanisterId)} })`
  );
  assertIncludes(shardStatus, "cycles_balance");
  assertIncludes(shardStatus, "running");
  const shardMaintenance = await callCanister(
    network,
    network.canisterId,
    "maintain_database_shards",
    "(record { min_available_slots = 1 : nat64; min_cycles_balance = 0 : nat; top_up_cycles = 0 : nat; max_new_shards = 1 : nat16; new_shard_max_databases = 8 : nat16; new_shard_initial_cycles = 1 : nat })"
  );
  assertIncludes(shardMaintenance, "available_slots");
  assertIncludes(shardMaintenance, "inspected_shards");
  const placementsCli = await runControllerCliCommand(network, ["placements"]);
  assertIncludes(placementsCli, databaseId);
  assertIncludes(placementsCli, databaseCanisterId);
  const shardsCli = await runControllerCliCommand(network, ["shards"]);
  assertIncludes(shardsCli, databaseCanisterId);
  const shardStatusCli = await runControllerCliCommand(network, ["shard-status", databaseCanisterId]);
  assertIncludes(shardStatusCli, "cycles_balance");
  const shardMaintainCli = await runControllerCliCommand(network, ["shard-maintain", "0", "0", "0", "0", "0", "0"]);
  assertIncludes(shardMaintainCli, "available_slots");
  const shardOperations = await callCanister(
    network,
    network.canisterId,
    "list_shard_operations",
    "()"
  );
  assertIncludes(shardOperations, "maintain_shards");
  assertIncludes(shardOperations, "top_up_shard");
  const shardOpsCli = await runControllerCliCommand(network, ["shard-ops"]);
  assertIncludes(shardOpsCli, "maintain_shards");
  assertIncludes(shardOpsCli, "top_up_shard");
  const unknownTarget = "not-a-principal";
  const unknownTopUp = await callCanister(
    network,
    network.canisterId,
    "top_up_database_shard",
    `(record { database_canister_id = ${candidText(unknownTarget)}; cycles = 1 : nat })`
  );
  assertIncludes(unknownTopUp, "Err");
  const unknownOps = await runControllerCliCommand(network, ["shard-ops"]);
  const unknownOperationId = parseUnknownShardOperationId(unknownOps, unknownTarget);
  const reconciledUnknown = await runControllerCliCommand(network, [
    "shard-reconcile",
    "failed",
    unknownOperationId,
    "operator verified by smoke"
  ]);
  assertIncludes(reconciledUnknown, "Failed");
  await assertDirectDatabaseCanisterCallRejected(network, databaseCanisterId, databaseId);
  assertIncludes(placement, databaseCanisterId);
  assertIncludes(placement, "database:");

  const batchOperationId = `remote-batch-${databaseId}`;
  const batch = await runCliCommand(baseUrl, ownerToken.token, [
    "--idempotency-key",
    batchOperationId,
    "batch",
    databaseId,
    "--statement",
    "CREATE TABLE remote_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
    "--statement",
    "INSERT INTO remote_notes (body) VALUES ('from-remote-shard')",
    "--statement",
    "SELECT body FROM remote_notes"
  ]);
  assertIncludes(batch, "from-remote-shard");
  const operation = await runCliCommand(baseUrl, ownerToken.token, [
    "operation",
    databaseId,
    batchOperationId
  ]);
  assertIncludes(operation, batchOperationId);
  assertIncludes(operation, "applied");
  assertIncludes(operation, "sql_batch_internal");
  const appliedReconcile = await runControllerCliCommandExpectFailure(network, [
    "operation-reconcile",
    databaseId,
    batchOperationId
  ]);
  assertIncludes(appliedReconcile, "routed operation is not unknown");

  const query = await runCliCommand(baseUrl, ownerToken.token, [
    "query",
    databaseId,
    "SELECT body FROM remote_notes"
  ]);
  assertIncludes(query, "from-remote-shard");

  const preview = await runCliCommand(baseUrl, ownerToken.token, [
    "preview",
    databaseId,
    "remote_notes"
  ]);
  assertIncludes(preview, "from-remote-shard");

  const describe = await runCliCommand(baseUrl, ownerToken.token, [
    "describe",
    databaseId,
    "remote_notes"
  ]);
  assertIncludes(describe, "remote_notes");

  const usage = await runCliCommand(baseUrl, ownerToken.token, ["usage", databaseId]);
  assertIncludes(usage, "logical_size_bytes");
  assertNotIncludes(usage, "\"logical_size_bytes\":0");

  const billing = await runCliCommand(baseUrl, ownerToken.token, ["billing", databaseId]);
  assertIncludes(billing, "spent_units");
  assertNotIncludes(billing, "\"spent_units\":0");

  const archivePath = `${tmpdir()}/icpdb-${databaseId}.sqlite3`;
  const archive = await runCliCommand(baseUrl, ownerToken.token, [
    "archive",
    databaseId,
    archivePath
  ]);
  assertIncludes(archive, "snapshot_hash");
  const archivedPlacement = await runCliCommand(baseUrl, ownerToken.token, [
    "placement",
    databaseId
  ]);
  assertIncludes(archivedPlacement, "archived");

  const restore = await runCliCommand(baseUrl, ownerToken.token, [
    "restore",
    databaseId,
    archivePath
  ]);
  assertIncludes(restore, "snapshot_hash");
  const restoredQuery = await runCliCommand(baseUrl, ownerToken.token, [
    "query",
    databaseId,
    "SELECT body FROM remote_notes"
  ]);
  assertIncludes(restoredQuery, "from-remote-shard");
  await unlink(archivePath).catch(() => {});

  const deleteOutput = await runCliCommand(baseUrl, ownerToken.token, ["delete-db", databaseId]);
  assertIncludes(deleteOutput, "null");
  const deletedUsage = await runCliCommand(baseUrl, ownerToken.token, ["usage", databaseId]);
  assertIncludes(deletedUsage, "deleted");
  const deletedPlacement = await runCliCommand(baseUrl, ownerToken.token, ["placement", databaseId]);
  assertIncludes(deletedPlacement, "deleted");
  const deletedShardOps = await runControllerCliCommand(network, ["shard-ops"]);
  assertIncludes(deletedShardOps, "delete_remote_database");
  assertIncludes(deletedShardOps, "Applied");

  console.log(
    `ICPDB local multi-canister smoke OK: ${databaseId} routed to ${databaseCanisterId}`
  );
}

async function callCanister(network, canisterId, method, args) {
  const { stdout } = await execFileAsync("icp", [
    "canister",
    "call",
    "-n",
    network.canisterNetwork,
    canisterId,
    method,
    args,
    "-o",
    "candid"
  ]);
  return stdout.trim();
}

async function assertDirectDatabaseCanisterCallRejected(network, canisterId, databaseId) {
  const output = await callCanister(
    network,
    canisterId,
    "list_tables_internal",
    `(${candidText(databaseId)})`
  );
  assertIncludes(output, "caller is not the configured control canister");
}

async function workingBaseUrl(network, token, databaseId) {
  const candidates = [
    process.env.ICPDB_SMOKE_BASE_URL ?? "",
    `http://${network.canisterName}.${network.environment}.localhost:${network.gatewayPort}`,
    `http://${network.canisterId}.localhost:${network.gatewayPort}`,
    `http://${network.canisterId}.raw.localhost:${network.gatewayPort}`
  ].filter((value) => value.length > 0);
  const errors = [];
  for (const baseUrl of candidates) {
    try {
      await callIcpdbHttp(
        parseCliArgs(["--base-url", baseUrl, "--token", token, "tables", databaseId], {})
      );
      return baseUrl;
    } catch (error) {
      errors.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`no local HTTP gateway host worked\n${errors.join("\n")}`);
}

async function runCliCommand(baseUrl, token, args) {
  const child = spawn(process.execPath, ["scripts/icpdb-http.mjs", "--base-url", baseUrl, "--token", token, ...args], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`CLI command failed with ${code}: ${stderr || stdout}`);
  return stdout;
}

async function runControllerCliCommand(network, args) {
  const child = spawn(process.execPath, [
    "scripts/icpdb-http.mjs",
    ...controllerCliArgs(network, args)
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`controller CLI command failed with ${code}: ${stderr || stdout}`);
  return stdout;
}

async function runControllerCliCommandExpectFailure(network, args) {
  const child = spawn(process.execPath, [
    "scripts/icpdb-http.mjs",
    ...controllerCliArgs(network, args)
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  const output = `${stderr}${stdout}`;
  if (code === 0) throw new Error(`controller CLI command should have failed: ${output}`);
  return output;
}

function parseOwnerToken(output) {
  const token = output.match(/token\s*=\s*"([^"]+)"/)?.[1];
  const tokenId = output.match(/token_id\s*=\s*"([^"]+)"/)?.[1];
  if (!token || !tokenId) {
    throw new Error(`create_database_token did not return token info: ${output}`);
  }
  return { token, token_id: tokenId };
}

function parseOkText(output, label) {
  const value = output.match(/Ok\s*=\s*"([^"]+)"/)?.[1];
  if (!value) {
    throw new Error(`${label} did not return Ok text: ${output}`);
  }
  return value;
}

function parsePlacementCanisterId(output) {
  const canisterId = output.match(/"canister_id"\s*:\s*"([^"]+)"/)?.[1];
  if (!canisterId) {
    throw new Error(`placement did not include canister_id: ${output}`);
  }
  return canisterId;
}

function parseUnknownShardOperationId(output, target) {
  const normalized = output.replace(/\\"/g, "\"");
  const targetIndex = normalized.indexOf(`target = opt "${target}"`);
  if (targetIndex < 0) {
    throw new Error(`unknown shard operation target not found: ${output}`);
  }
  const recordPrefix = normalized.slice(Math.max(0, targetIndex - 900), targetIndex);
  if (!recordPrefix.includes("Unknown")) {
    throw new Error(`shard operation for ${target} is not unknown: ${recordPrefix}`);
  }
  const matches = [...recordPrefix.matchAll(/operation_id\s*=\s*"([^"]+)"/g)];
  const match = matches.at(-1);
  if (!match) {
    throw new Error(`operation_id not found for ${target}: ${recordPrefix}`);
  }
  return match[1];
}

function candidText(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function assertIncludes(source, expected) {
  if (!source.includes(expected)) {
    throw new Error(`expected output to include ${expected}: ${source}`);
  }
}

function assertNotIncludes(source, forbidden) {
  if (source.includes(forbidden)) {
    throw new Error(`expected output not to include ${forbidden}: ${source}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
