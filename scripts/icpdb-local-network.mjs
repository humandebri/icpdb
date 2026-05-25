// Where: scripts/icpdb-local-network.mjs
// What: Discover local icp-cli network URL, canister mapping, and optional root key for smoke tests.
// Why: icp-cli cache formats can differ; local smokes should use the live network state, not one descriptor file.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function localNetworkConfig(env, name) {
  const descriptor = await readOptionalJson(`.icp/cache/networks/${env}/descriptor.json`);
  const mappings = await readJson(`.icp/cache/mappings/${env}.ids.json`);
  const gatewayPort = process.env.ICPDB_SMOKE_GATEWAY_PORT
    ?? descriptorGatewayPort(descriptor)
    ?? await gatewayPortFromStatus(env)
    ?? await gatewayPortFromLog(env)
    ?? "";
  const rootKey = process.env.ICPDB_SMOKE_ROOT_KEY ?? descriptorRootKey(descriptor) ?? "";
  const canisterId = process.env.ICPDB_SMOKE_CANISTER_ID ?? String(mappings[name] ?? "");
  if (!gatewayPort) throw new Error(`gateway port not found for ${env}`);
  if (!canisterId) throw new Error(`canister id not found for ${name} in ${env}`);
  return {
    environment: env,
    canisterName: name,
    canisterId,
    canisterNetwork: env,
    gatewayPort,
    networkUrl: process.env.ICPDB_SMOKE_NETWORK_URL ?? `http://localhost:${gatewayPort}`,
    rootKey
  };
}

export function controllerCliArgs(network, args) {
  const result = ["--network-url", network.canisterNetwork];
  if (network.rootKey && isUrlNetwork(network.canisterNetwork)) result.push("--root-key", network.rootKey);
  return [...result, "--canister-id", network.canisterId, ...args];
}

export function shouldPassRootKey(network) {
  return Boolean(network.rootKey && isUrlNetwork(network.canisterNetwork));
}

async function gatewayPortFromStatus(env) {
  const output = await commandOutput("icp", ["network", "status", "-e", env]);
  return gatewayPortFromText(output);
}

async function gatewayPortFromLog(env) {
  const output = await readOptionalText(`.icp/cache/networks/${env}/network-launcher/stdout.log`);
  return gatewayPortFromText(output);
}

function gatewayPortFromText(source) {
  return [...source.matchAll(/gateway port\s+([0-9]+)/g)].at(-1)?.[1] ?? "";
}

async function commandOutput(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args);
    return `${stdout}${stderr}`;
  } catch (error) {
    return `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalJson(path) {
  const source = await readOptionalText(path);
  return source ? JSON.parse(source) : null;
}

async function readOptionalText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function descriptorGatewayPort(descriptor) {
  return String(descriptor?.gateway?.port ?? "");
}

function descriptorRootKey(descriptor) {
  return String(descriptor?.["root-key"] ?? "");
}

function isUrlNetwork(value) {
  return /^https?:\/\//.test(value);
}
