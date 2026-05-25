// Where: scripts/icpdb-http-command-utils.mjs
// What: Shared option parsing and argument validation for the ICPDB HTTP CLI.
// Why: CLI command builders should reuse strict validation without living in the executable entrypoint.

export const DEFAULT_LIMIT = 100;

export function parseCliArgs(args, env = process.env) {
  const options = {
    baseUrl: env.ICPDB_HTTP_BASE_URL ?? "",
    token: env.ICPDB_TOKEN ?? "",
    params: [],
    maxRows: DEFAULT_LIMIT,
    limit: DEFAULT_LIMIT,
    offset: 0,
    statements: [],
    outputFormat: null,
    canisterId: env.ICPDB_CANISTER_ID ?? "",
    networkUrl: env.ICPDB_NETWORK_URL ?? "",
    rootKey: env.ICPDB_ROOT_KEY ?? "",
    tokenName: env.ICPDB_TOKEN_NAME ?? "owner",
    idempotencyKey: env.ICPDB_IDEMPOTENCY_KEY ?? "",
    includeAccess: false
  };
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--base-url") {
      options.baseUrl = requireValue(args, index, value);
      index += 1;
    } else if (value === "--token") {
      options.token = requireValue(args, index, value);
      index += 1;
    } else if (value === "--params") {
      options.params = parseJsonArray(requireValue(args, index, value), "params");
      index += 1;
    } else if (value === "--max-rows") {
      options.maxRows = parseNonNegativeInteger(requireValue(args, index, value), "max-rows");
      index += 1;
    } else if (value === "--limit") {
      options.limit = parseNonNegativeInteger(requireValue(args, index, value), "limit");
      index += 1;
    } else if (value === "--offset") {
      options.offset = parseNonNegativeInteger(requireValue(args, index, value), "offset");
      index += 1;
    } else if (value === "--format") {
      options.outputFormat = parseOutputFormat(requireValue(args, index, value));
      index += 1;
    } else if (value === "--canister-id") {
      options.canisterId = requireValue(args, index, value);
      index += 1;
    } else if (value === "--network-url") {
      options.networkUrl = requireValue(args, index, value);
      index += 1;
    } else if (value === "--root-key") {
      options.rootKey = requireValue(args, index, value);
      index += 1;
    } else if (value === "--token-name") {
      options.tokenName = requireValue(args, index, value);
      index += 1;
    } else if (value === "--idempotency-key") {
      options.idempotencyKey = requireValue(args, index, value);
      index += 1;
    } else if (value === "--access") {
      options.includeAccess = true;
    } else if (value === "--statement") {
      options.statements.push({ sql: requireValue(args, index, value), params: [] });
      index += 1;
    } else if (value === "--help" || value === "-h") {
      return { help: true };
    } else if (value.startsWith("--")) {
      throw new Error(`unknown option: ${value}`);
    } else {
      positional.push(value);
    }
  }
  if (positional.length === 0) return { help: true };
  return { positional, options };
}

export function requireValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function requiredConfig(value, label, envName) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`missing ${label}; pass --${label.toLowerCase().replace(/\s+/g, "-")} or set ${envName}`);
  }
  return trimmed;
}

export function requiredArg(value, label) {
  if (!value) throw new Error(`missing ${label}`);
  return value;
}

export function parseJsonArray(source, label) {
  const value = parseJson(source, label);
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array`);
  return value;
}

export function parseSqlStatementsJson(source) {
  const value = parseJson(source, "statements");
  if (!Array.isArray(value)) throw new Error("statements must be a JSON array");
  return value.map(normalizeStatement);
}

export function parseNonNegativeInteger(source, label) {
  if (!/^\d+$/.test(source)) throw new Error(`${label} must be a non-negative integer`);
  const value = Number(source);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds JS safe integer range`);
  return value;
}

export function parseNonNegativeNatText(source, label) {
  if (!/^\d+$/.test(source)) throw new Error(`${label} must be a non-negative integer`);
  return source;
}

export function parseTokenScope(source) {
  const value = source.toLowerCase();
  if (value === "read" || value === "write" || value === "owner") return value;
  throw new Error("scope must be read, write, or owner");
}

export function parseShardReconcileStatus(source) {
  const value = source.toLowerCase();
  if (value === "applied" || value === "failed") return value;
  throw new Error("status must be applied or failed");
}

export function parseDatabaseRole(source) {
  const value = source.toLowerCase();
  if (value === "owner" || value === "writer" || value === "reader") return value;
  throw new Error("role must be reader, writer, or owner");
}

export function outputFormatOption(options) {
  return options.outputFormat ? { outputFormat: options.outputFormat } : {};
}

export function idempotencyKeyOption(options) {
  return options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {};
}

function parseOutputFormat(source) {
  const value = source.toLowerCase();
  if (value === "json" || value === "table" || value === "csv") return value;
  throw new Error("format must be json, table, or csv");
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`invalid JSON ${label}: ${message}`);
  }
}

function normalizeStatement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.sql !== "string") {
    throw new Error("each statement must be an object with sql");
  }
  const params = Array.isArray(value.params) ? value.params : [];
  return { sql: value.sql, params };
}
