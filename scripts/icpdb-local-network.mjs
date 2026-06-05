// Where: scripts/icpdb-local-network.mjs
// What: Discover local icp-cli network URL, canister mapping, and optional root key for smoke tests.
// Why: icp-cli cache formats can differ; local smokes should use the live network state, not one descriptor file.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function localNetworkConfig(env, name) {
  const descriptor = await readOptionalJson(`.icp/cache/networks/${env}/descriptor.json`);
  const mappings = await readOptionalJson(`.icp/cache/mappings/${env}.ids.json`);
  const statusOutput = await commandOutput("icp", ["network", "status", "-e", env]);
  const launcherError = await launcherErrorFromLog(env);
  const portListener = await listenerSummaryForPort(portFromLauncherError(launcherError));
  const gatewayPort = optionalString(process.env.ICPDB_SMOKE_GATEWAY_PORT)
    ?? descriptorGatewayPort(descriptor)
    ?? gatewayPortFromText(statusOutput)
    ?? gatewayPortFromText(launcherError)
    ?? await gatewayPortFromLog(env)
    ?? "";
  const gatewayHost = optionalString(process.env.ICPDB_SMOKE_GATEWAY_HOST) ?? descriptorGatewayHost(descriptor) ?? "127.0.0.1";
  const rootKey = optionalString(process.env.ICPDB_SMOKE_ROOT_KEY) ?? descriptorRootKey(descriptor) ?? "";
  const canisterId = optionalString(process.env.ICPDB_SMOKE_CANISTER_ID) ?? optionalString(mappings?.[name]) ?? "";
  if (!gatewayPort) throw new Error(formatLocalNetworkSetupError(env, "gateway port", statusOutput, launcherError, portListener));
  if (!canisterId) throw new Error(formatLocalNetworkSetupError(env, `canister id for ${name}`, statusOutput, launcherError, portListener));
  return {
    environment: env,
    canisterName: name,
    canisterId,
    canisterNetwork: env,
    gatewayPort,
    networkUrl: process.env.ICPDB_SMOKE_NETWORK_URL ?? `http://${gatewayHost}:${gatewayPort}`,
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

async function gatewayPortFromLog(env) {
  const output = await readOptionalText(`.icp/cache/networks/${env}/network-launcher/stdout.log`);
  return gatewayPortFromText(output);
}

function gatewayPortFromText(source) {
  return [...source.matchAll(/gateway port\s+([0-9]+)/g)].at(-1)?.[1];
}

async function commandOutput(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args);
    return `${stdout}${stderr}`;
  } catch (error) {
    return `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  }
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

async function launcherErrorFromLog(env) {
  const output = await readOptionalText(`.icp/cache/networks/${env}/network-launcher/stderr.log`);
  return normalizedImportantLine(output);
}

export function formatLocalNetworkSetupError(env, missing, statusOutput, launcherError, portListener = "") {
  const parts = [
    `${missing} not found for ${env}`,
    `run: icp network start -d -e ${env}`,
    `then run: icp deploy -e ${env} -y`
  ];
  const status = normalizedLastLine(statusOutput);
  if (status) parts.push(`icp network status: ${status}`);
  if (launcherError) parts.push(`network launcher stderr: ${launcherError}`);
  if (portListener) parts.push(`port listener: ${portListener}`);
  return parts.join("; ");
}

export function portFromLauncherError(source) {
  return /gateway port\s+([0-9]{2,5})/i.exec(source)?.[1]
    ?? /(?:address|addr)[^0-9]*(?:[0-9.:]+:)?([0-9]{2,5})/i.exec(source)?.[1]
    ?? "";
}

export async function listenerSummaryForPort(port, execImpl = execFileAsync) {
  const value = optionalString(port);
  if (!value) return "";
  try {
    const { stdout } = await execImpl("lsof", ["-nP", `-iTCP:${value}`, "-sTCP:LISTEN"]);
    return summarizeLsofOutput(stdout);
  } catch {
    return "";
  }
}

export function summarizeLsofOutput(source) {
  const line = source
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith("COMMAND "))
    .at(0);
  if (!line) return "";
  const parts = line.split(/\s+/);
  const command = parts[0] ?? "";
  const pid = parts[1] ?? "";
  const name = parts.slice(7).join(" ");
  return [command, pid ? `pid ${pid}` : "", name].filter(Boolean).join(" ");
}

function normalizedLastLine(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

function normalizedImportantLine(source) {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /Address already in use|Failed to bind/i.test(line)) ?? lines.at(-1) ?? "";
}

function descriptorGatewayPort(descriptor) {
  return optionalString(descriptor?.gateway?.port);
}

function descriptorGatewayHost(descriptor) {
  return optionalString(descriptor?.gateway?.ip) ?? optionalString(descriptor?.gateway?.host);
}

function descriptorRootKey(descriptor) {
  return optionalString(descriptor?.["root-key"]);
}

function isUrlNetwork(value) {
  return /^https?:\/\//.test(value);
}

function optionalString(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}
