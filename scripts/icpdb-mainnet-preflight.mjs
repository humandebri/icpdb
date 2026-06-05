#!/usr/bin/env node
// Where: scripts/icpdb-mainnet-preflight.mjs
// What: Non-destructive mainnet readiness check for the ICPDB canister deploy flow.
// Why: Mainnet deploys should prove build artifacts and mapping state before spending cycles.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const options = parseArgs(process.argv.slice(2));

async function main() {
  if (options.selfTest) {
    runSelfTest();
    process.stdout.write("ICPDB mainnet preflight self-test OK\n");
    return;
  }
  const icpYaml = await readFile("icp.yaml", "utf8");
  assertIncludes(icpYaml, "name: icpdb", "icp.yaml must define the icpdb canister");
  assertIncludes(
    icpYaml,
    "bash scripts/build-icpdb-canister.sh",
    "icp.yaml must build icpdb through scripts/build-icpdb-canister.sh"
  );

  const mapping = await readMainnetMapping();
  const mappedCanisterId = mappedCanisterIdFromMapping(mapping);
  const canisterId = options.canisterId || mappedCanisterId;
  const candid = await checkCandidDrift();

  const artifacts = options.skipBuild ? [] : await buildArtifacts();
  const result = {
    ok: true,
    canister: "icpdb",
    mainnet_mapping: mappedCanisterId
      ? { status: "configured", canister_id: mappedCanisterId }
      : { status: "missing", canister_id: null },
    canister_id: canisterId || null,
    canister_id_source: options.canisterId ? "argument" : mappedCanisterId ? "mapping" : "missing",
    candid,
    artifacts,
    deploy_command: "icp deploy -e ic -y icpdb",
    http_base_url: canisterId ? `https://${canisterId}.icp0.io` : null
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function readMainnetMapping() {
  const text = await readOptionalMappingFile(".icp/data/mappings/ic.ids.json");
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(".icp/data/mappings/ic.ids.json must be a JSON object");
  }
  return parsed;
}

function mappedCanisterIdFromMapping(mapping) {
  if (!Object.hasOwn(mapping, "icpdb")) return null;
  const value = mapping.icpdb;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(".icp/data/mappings/ic.ids.json icpdb must be a non-empty string");
  }
  if (!/^[a-z0-9-]+-cai$/.test(value)) {
    throw new Error(".icp/data/mappings/ic.ids.json icpdb must be a canister id ending in -cai");
  }
  return value;
}

async function readOptionalMappingFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
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

async function checkCandidDrift() {
  const command = candidDriftCheckCommand();
  const { stdout } = await execFileAsync(command.command, command.args, {
    maxBuffer: 8 * 1024 * 1024
  });
  return {
    status: "checked",
    command: [command.command, ...command.args].join(" "),
    output: stdout.trim()
  };
}

function candidDriftCheckCommand() {
  return { command: process.execPath, args: ["icpdb-console/scripts/check-candid-drift.mjs"] };
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
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { name, size_bytes: file.size, sha256 };
}

function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) throw new Error(message);
}

function parseArgs(args) {
  const parsed = { skipBuild: false, selfTest: false, canisterId: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--skip-build") {
      parsed.skipBuild = true;
    } else if (arg === "--self-test") {
      parsed.selfTest = true;
    } else if (arg === "--canister-id") {
      parsed.canisterId = canisterIdArg(requireValue(args, index, arg), "canister id");
      index += 1;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function canisterIdArg(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (!/^[a-z0-9-]+-cai$/.test(value)) {
    throw new Error(`${label} must be a canister id ending in -cai`);
  }
  return value;
}

function runSelfTest() {
  const skip = parseArgs(["--skip-build"]);
  if (!skip.skipBuild) throw new Error("skip-build arg self-test failed");
  const explicit = parseArgs(["--canister-id", "ryjl3-tyaaa-aaaaa-aaaba-cai"]);
  if (explicit.canisterId !== "ryjl3-tyaaa-aaaaa-aaaba-cai") throw new Error("canister-id arg self-test failed");
  const candidCommand = candidDriftCheckCommand();
  if (!candidCommand.args.includes("icpdb-console/scripts/check-candid-drift.mjs")) {
    throw new Error("candid drift command self-test failed");
  }
  if (mappedCanisterIdFromMapping({}) !== null) throw new Error("missing mapping self-test failed");
  if (mappedCanisterIdFromMapping({ icpdb: "ryjl3-tyaaa-aaaaa-aaaba-cai" }) !== "ryjl3-tyaaa-aaaaa-aaaba-cai") {
    throw new Error("valid mapping self-test failed");
  }
  assertThrows(() => mappedCanisterIdFromMapping({ icpdb: "   " }), /icpdb must be a non-empty string/);
  assertThrows(() => mappedCanisterIdFromMapping({ icpdb: "not-a-canister" }), /icpdb must be a canister id ending in -cai/);
  assertThrows(() => parseArgs(["--canister-id", "   "]), /canister id must be a non-empty string/);
  assertThrows(() => parseArgs(["--canister-id", "not-a-canister"]), /canister id must be a canister id ending in -cai/);
  assertThrows(() => parseArgs(["--canister-id"]), /--canister-id requires a value/);
  assertThrows(() => parseArgs(["--unknown"]), /unknown option/);
}

function assertThrows(fn, pattern) {
  try {
    fn();
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  throw new Error(`self-test expected failure matching ${pattern}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
