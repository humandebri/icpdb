#!/usr/bin/env node
// Where: scripts/icpdb-local-postdeploy-smoke.mjs
// What: Replay the postdeploy SQL/archive smoke against the project-local ICPDB canister.
// Why: Mainnet postdeploy is the final external gate; the same SQL/archive path should be locally reproducible first.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { localNetworkConfig } from "./icpdb-local-network.mjs";

const execFileAsync = promisify(execFile);
const environment = process.env.ICPDB_SMOKE_ENVIRONMENT ?? "local-icpdb";
const canisterName = process.env.ICPDB_SMOKE_CANISTER ?? "icpdb";

const network = await localNetworkConfig(environment, canisterName);
const output = await postdeployEnvOutput(network);
const env = parseEnvOutput(output);

assert.equal(env.ICPDB_MAINNET_POSTDEPLOY_OK, "true");
assert.equal(env.ICPDB_MAINNET_NETWORK, environment);
assert.equal(env.ICPDB_MAINNET_CANISTER_ID, network.canisterId);
assert.equal(env.ICPDB_MAINNET_VERIFICATION_MODE, "sql_smoke");
assert.equal(env.ICPDB_MAINNET_SMOKE_SQL, "true");
assert.equal(env.ICPDB_MAINNET_SMOKE_ARCHIVE_RESTORE, "true");
assert.equal(env.ICPDB_MAINNET_SQL_SMOKE_DELETED, "true");
assert.equal(env.ICPDB_MAINNET_SQL_SMOKE_SCALAR, "postdeploy-mainnet-smoke");
assert.match(env.ICPDB_MAINNET_SQL_SMOKE_DATABASE_ID ?? "", /^db_/);
assert.match(env.ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_HASH ?? "", /^[a-f0-9]{64}$/);
assert.equal(nonNegativeInteger(env.ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_SIZE_BYTES), true);

process.stdout.write("[icpdb-local-postdeploy-smoke] postdeploy SQL archive/restore verified\n");
process.stdout.write("ICPDB local postdeploy smoke OK\n");

async function postdeployEnvOutput(localNetwork) {
  const args = [
    "scripts/icpdb-mainnet-postdeploy.mjs",
    "--network",
    localNetwork.environment,
    "--require-canister-id",
    "--canister-id",
    localNetwork.canisterId,
    "--smoke-sql",
    "--smoke-archive-restore",
    "--format",
    "env"
  ];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      env: { ...process.env, ICPDB_SMOKE_PROGRESS: process.env.ICPDB_SMOKE_PROGRESS ?? "1" },
      maxBuffer: 16 * 1024 * 1024
    });
    return `${stdout}${stderr}`;
  } catch (error) {
    const details = `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim();
    throw new Error(`local postdeploy smoke failed for ${localNetwork.environment}/${localNetwork.canisterId}${details ? `: ${details}` : ""}`);
  }
}

function parseEnvOutput(output) {
  const result = {};
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex);
    const rawValue = line.slice(separatorIndex + 1);
    result[key] = JSON.parse(rawValue);
  }
  return result;
}

function nonNegativeInteger(value) {
  if (value === undefined) return false;
  return /^[0-9]+$/.test(value);
}
