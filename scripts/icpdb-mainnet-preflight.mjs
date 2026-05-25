#!/usr/bin/env node
// Where: scripts/icpdb-mainnet-preflight.mjs
// What: Non-destructive mainnet readiness check for the ICPDB canister deploy flow.
// Why: Mainnet deploys should prove build artifacts and mapping state before spending cycles.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const skipBuild = process.argv.includes("--skip-build");

async function main() {
  const icpYaml = await readFile("icp.yaml", "utf8");
  assertIncludes(icpYaml, "name: icpdb", "icp.yaml must define the icpdb canister");
  assertIncludes(
    icpYaml,
    "bash scripts/build-icpdb-canister.sh",
    "icp.yaml must build icpdb through scripts/build-icpdb-canister.sh"
  );

  const mapping = await readMainnetMapping();
  const canisterId = typeof mapping.icpdb === "string" ? mapping.icpdb : null;
  if (canisterId && !/^[a-z0-9-]+-cai$/.test(canisterId)) {
    throw new Error(`invalid icpdb mainnet canister id: ${canisterId}`);
  }

  const artifacts = skipBuild ? [] : await buildArtifacts();
  const result = {
    ok: true,
    canister: "icpdb",
    mainnet_mapping: canisterId
      ? { status: "configured", canister_id: canisterId }
      : { status: "missing", canister_id: null },
    artifacts,
    deploy_command: "icp deploy -e ic -y icpdb",
    http_base_url: canisterId ? `https://${canisterId}.icp0.io` : null
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function readMainnetMapping() {
  const text = await readFile(".icp/data/mappings/ic.ids.json", "utf8");
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(".icp/data/mappings/ic.ids.json must be a JSON object");
  }
  return parsed;
}

async function buildArtifacts() {
  const tempDir = await mkdtemp(join(tmpdir(), "icpdb-mainnet-preflight-"));
  try {
    const databaseWasm = join(tempDir, "icpdb_database_canister.wasm");
    const canisterWasm = join(tempDir, "icpdb_canister.wasm");
    await runBuild("scripts/build-icpdb-database-canister.sh", databaseWasm);
    await runBuild("scripts/build-icpdb-canister.sh", canisterWasm);
    return [
      await artifactInfo("icpdb_database_canister", databaseWasm),
      await artifactInfo("icpdb", canisterWasm)
    ];
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runBuild(script, outputPath) {
  await execFileAsync("bash", [script], {
    env: { ...process.env, ICP_WASM_OUTPUT_PATH: outputPath },
    maxBuffer: 8 * 1024 * 1024
  });
}

async function artifactInfo(name, path) {
  const file = await stat(path);
  if (!file.isFile() || file.size <= 0) {
    throw new Error(`${name} wasm artifact is empty`);
  }
  return { name, size_bytes: file.size };
}

function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) throw new Error(message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
