// Where: scripts/icpdb-http-command-utils.mjs
// What: Shared option parsing and argument validation for the ICPDB HTTP CLI.
// Why: CLI command builders should reuse strict validation without living in the executable entrypoint.

import { readFileSync, statSync } from "node:fs";
import { Principal } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/principal/index.js";

export const DEFAULT_LIMIT = 100;
const MAX_SQL_ROWS = 500;
const MAX_NAT32 = 4_294_967_295;

export function parseCliArgs(args, env = process.env) {
  const mergedEnv = httpCliEnvFromArgs(args, env);
  const databaseUrl = validateDatabaseUrlEnv(mergedEnv);
  const options = {
    baseUrl: mergedEnv.ICPDB_HTTP_BASE_URL ?? databaseUrl?.baseUrl ?? "",
    token: mergedEnv.ICPDB_TOKEN ?? "",
    databaseId: mergedEnv.ICPDB_DATABASE_ID ?? databaseUrl?.databaseId ?? "",
    params: [],
    paramsProvided: false,
    paramsFilePath: "",
    maxRows: DEFAULT_LIMIT,
    limit: DEFAULT_LIMIT,
    offset: 0,
    statements: [],
    statementsFilePath: "",
    batchMode: "write",
    outputFormat: null,
    canisterId: mergedEnv.ICPDB_CANISTER_ID ?? databaseUrl?.canisterId ?? "",
    networkUrl: mergedEnv.ICPDB_NETWORK_URL ?? "",
    rootKey: mergedEnv.ICPDB_ROOT_KEY ?? "",
    tokenName: mergedEnv.ICPDB_TOKEN_NAME ?? "owner",
    idempotencyKey: optionalNonEmptyEnvValue(mergedEnv, "ICPDB_IDEMPOTENCY_KEY") ?? "",
    envOutFile: "",
    setupFilePath: "",
    setupMigrationsFilePath: "",
    expectedSnapshotHash: "",
    includeAccess: false,
    waitForRoutedOperation: false
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
    } else if (value === "--database-id") {
      options.databaseId = databaseIdArg(requireValue(args, index, value));
      index += 1;
    } else if (value === "--env-file") {
      filePathArg(requireValue(args, index, value), "env file");
      index += 1;
    } else if (value === "--env-out") {
      options.envOutFile = filePathArg(requireValue(args, index, value), "env output file");
      index += 1;
    } else if (value === "--params") {
      if (options.paramsFilePath) throw new Error("use only one of --params or --params-file");
      options.params = parseJsonSqlArgs(requireValue(args, index, value), "params");
      options.paramsProvided = true;
      index += 1;
    } else if (value === "--params-file") {
      if (options.paramsProvided) throw new Error("use only one of --params or --params-file");
      options.paramsFilePath = filePathArg(requireValue(args, index, value), "params file");
      options.params = parseJsonSqlArgs(readFileSync(options.paramsFilePath, "utf8"), "params");
      index += 1;
    } else if (value === "--max-rows") {
      options.maxRows = parseRowLimit(requireValue(args, index, value), "max-rows");
      index += 1;
    } else if (value === "--limit") {
      options.limit = parseRowLimit(requireValue(args, index, value), "limit");
      index += 1;
    } else if (value === "--offset") {
      options.offset = parseNat32Integer(requireValue(args, index, value), "offset");
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
      options.idempotencyKey = idempotencyKeyArg(requireValue(args, index, value));
      index += 1;
    } else if (value === "--setup-file") {
      options.setupFilePath = filePathArg(requireValue(args, index, value), "setup file");
      index += 1;
    } else if (value === "--setup-migrations-file") {
      options.setupMigrationsFilePath = filePathArg(requireValue(args, index, value), "setup migrations file");
      index += 1;
    } else if (value === "--expect-snapshot-hash") {
      options.expectedSnapshotHash = parseSnapshotHashHex(requireValue(args, index, value), "expect-snapshot-hash");
      index += 1;
    } else if (value === "--wait") {
      options.waitForRoutedOperation = true;
    } else if (value === "--access") {
      options.includeAccess = true;
    } else if (value === "--statement") {
      if (options.statementsFilePath) throw new Error("use only one of --statement or --statements-file");
      options.statements.push({ sql: requireValue(args, index, value), params: [] });
      index += 1;
    } else if (value === "--statements-file") {
      if (options.statements.length > 0) throw new Error("use only one of --statement or --statements-file");
      options.statementsFilePath = filePathArg(requireValue(args, index, value), "statements file");
      options.statements = parseSqlStatementsJson(readFileSync(options.statementsFilePath, "utf8"));
      index += 1;
    } else if (value === "--mode") {
      options.batchMode = parseSqlBatchMode(requireValue(args, index, value));
      index += 1;
    } else if (value === "--help" || value === "-h") {
      return { help: true };
    } else if (value.startsWith("--")) {
      throw new Error(`unknown option: ${value}`);
    } else {
      positional.push(value);
    }
  }
  if (options.envOutFile) options.outputFormat = "env";
  if (positional.length === 0) return { help: true };
  if (options.expectedSnapshotHash && positional[0] !== "restore") {
    throw new Error("--expect-snapshot-hash is only valid for restore");
  }
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

export function filePathArg(value, label = "file") {
  const filePath = requiredArg(value, label);
  if (filePath.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return filePath;
}

export function databaseIdArg(value) {
  const databaseId = requiredArg(value, "database_id").trim();
  if (!databaseId) throw new Error("database_id must be a non-empty string");
  return databaseId;
}

export function databaseCanisterIdArg(value) {
  const databaseCanisterId = requiredArg(value, "database_canister_id").trim();
  if (!databaseCanisterId) throw new Error("database_canister_id must be a non-empty string");
  return databaseCanisterId;
}

export function tokenNameArg(value) {
  const tokenName = requiredArg(value, "token_name").trim();
  if (!tokenName) throw new Error("token_name must be a non-empty string");
  return tokenName;
}

export function tokenIdArg(value) {
  const tokenId = requiredArg(value, "token_id").trim();
  if (!tokenId) throw new Error("token_id must be a non-empty string");
  return tokenId;
}

export function memberPrincipalArg(value) {
  const principal = requiredArg(value, "principal").trim();
  if (!principal) throw new Error("database member principal must be a non-empty string");
  try {
    Principal.fromText(principal);
  } catch {
    throw new Error("database member principal must be a valid principal");
  }
  return principal;
}

export function grantablePrincipalArg(value) {
  const principal = memberPrincipalArg(value);
  if (principal === "2vxsx-fae") throw new Error("anonymous principal cannot be granted database access");
  return principal;
}

export function tableNameArg(value) {
  const tableName = requiredArg(value, "table_name");
  if (tableName.trim().length === 0) throw new Error("table_name must be a non-empty string");
  return tableName;
}

export function optionalTableNameArg(value) {
  if (value === undefined || value === null) return null;
  return tableNameArg(value);
}

export function operationIdArg(value) {
  const operationId = requiredArg(value, "operation_id");
  if (operationId.trim().length === 0) throw new Error("operation_id must be a non-empty string");
  return operationId;
}

export function idempotencyKeyArg(value) {
  const idempotencyKey = requiredArg(value, "idempotency_key").trim();
  if (!idempotencyKey) throw new Error("idempotency_key must be a non-empty string");
  return idempotencyKey;
}

export function parseJsonArray(source, label) {
  const value = parseJson(source, label);
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array`);
  return value;
}

export function parseJsonSqlArgs(source, label) {
  const value = parseJson(source, label);
  if (Array.isArray(value) || isPlainObject(value)) return value;
  throw new Error(`${label} must be a JSON array or object`);
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

export function parseRowLimit(source, label) {
  const value = parseNonNegativeInteger(source, label);
  if (value < 1 || value > MAX_SQL_ROWS) throw new Error(`${label} must be an integer from 1 to ${MAX_SQL_ROWS}`);
  return value;
}

export function parseNat32Integer(source, label) {
  const value = parseNonNegativeInteger(source, label);
  if (value > MAX_NAT32) throw new Error(`${label} must be an integer from 0 to ${MAX_NAT32}`);
  return value;
}

export function parseNonNegativeNatText(source, label) {
  if (!/^\d+$/.test(source)) throw new Error(`${label} must be a non-negative integer`);
  return source;
}

export function parseNat16Text(source, label) {
  const value = parseNonNegativeInteger(source, label);
  if (value > 65535) throw new Error(`${label} exceeds nat16 range`);
  return source;
}

export function parseSnapshotHashHex(source, label) {
  const value = source.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a 64-character SHA-256 hex string`);
  return value;
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
  if (value === "json" || value === "table" || value === "csv" || value === "env") return value;
  throw new Error("format must be json, table, csv, or env");
}

function parseSqlBatchMode(source) {
  const value = source.toLowerCase();
  if (value === "read" || value === "write") return value;
  throw new Error("mode must be read or write");
}

function parseDatabaseUrl(source) {
  const trimmed = source.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid URL";
    throw new Error(`invalid ICPDB_URL: ${message}`);
  }
  if (url.protocol !== "icpdb:") {
    throw new Error("invalid ICPDB_URL: scheme must be icpdb://");
  }
  if (url.username || url.password) {
    throw new Error("invalid ICPDB_URL: must not include username or password");
  }
  if (url.port) {
    throw new Error("invalid ICPDB_URL: must not include a port");
  }
  if (url.search || url.hash) {
    throw new Error("invalid ICPDB_URL: must not include query or fragment");
  }
  const canisterId = url.hostname.trim();
  if (!canisterId || !/^\/[^/]+$/.test(url.pathname)) {
    throw new Error("invalid ICPDB_URL: expected icpdb://<canister-id>/<database-id>");
  }
  let databaseId;
  try {
    databaseId = decodeURIComponent(url.pathname.slice(1)).trim();
  } catch (error) {
    throw new Error(`invalid ICPDB_URL database id encoding: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!databaseId) throw new Error("invalid ICPDB_URL: expected icpdb://<canister-id>/<database-id>");
  return { baseUrl: `https://${canisterId}.icp0.io`, canisterId, databaseId };
}

function validateDatabaseUrlEnv(env) {
  const envUrl = optionalNonEmptyEnvValue(env, "ICPDB_URL");
  const envCanisterId = optionalNonEmptyEnvValue(env, "ICPDB_CANISTER_ID");
  const envDatabaseId = optionalNonEmptyEnvValue(env, "ICPDB_DATABASE_ID");
  const parsed = parseDatabaseUrl(envUrl ?? "");
  if (envCanisterId && parsed?.canisterId && envCanisterId !== parsed.canisterId) {
    throw new Error("ICPDB_CANISTER_ID does not match ICPDB_URL");
  }
  if (envDatabaseId && parsed?.databaseId && envDatabaseId !== parsed.databaseId) {
    throw new Error("ICPDB_DATABASE_ID does not match ICPDB_URL");
  }
  return parsed;
}

function optionalNonEmptyEnvValue(env, key) {
  if (!Object.hasOwn(env, key) || env[key] === undefined) return undefined;
  const value = String(env[key]);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${key} must be a non-empty string`);
  return trimmed;
}

function httpCliEnvFromArgs(args, env) {
  const merged = { ...env };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--env-file") continue;
    const filePath = filePathArg(requireValue(args, index, "--env-file"), "env file");
    assertHttpEnvFileMode(filePath);
    Object.assign(merged, parseHttpCliEnvFile(readFileSync(filePath, "utf8"), filePath));
    index += 1;
  }
  return merged;
}

function assertHttpEnvFileMode(filePath) {
  const mode = statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`HTTP env file must be owner-only (0600 or stricter): ${filePath} is ${modeToOctal(mode)}`);
  }
}

function modeToOctal(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function parseHttpCliEnvFile(source, filePath) {
  const parsed = {};
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`invalid env file line ${index + 1} in ${filePath}`);
    const key = match[1];
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate env key ${key} at ${filePath}:${index + 1}`);
    parsed[key] = parseHttpCliEnvValue(match[2].trim(), filePath, index + 1);
  }
  return parsed;
}

function parseHttpCliEnvValue(source, filePath, lineNumber) {
  if (source.startsWith('"')) {
    try {
      return JSON.parse(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid JSON string";
      throw new Error(`invalid quoted env value at ${filePath}:${lineNumber}: ${message}`);
    }
  }
  if (source.startsWith("'")) {
    if (!source.endsWith("'")) throw new Error(`invalid quoted env value at ${filePath}:${lineNumber}`);
    return source.slice(1, -1);
  }
  return source;
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
  const params = value.params === undefined ? [] : sqlArgsValue(value.params, "statement params");
  return { sql: value.sql, params };
}

function sqlArgsValue(value, label) {
  if (Array.isArray(value) || isPlainObject(value)) return value;
  throw new Error(`${label} must be a JSON array or object`);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function sqlParams(sql, params) {
  if (Array.isArray(params)) return params;
  const parameters = namedSqlParameters(sql);
  if (parameters.length === 0) throw new Error("named SQL params require named placeholders");
  return parameters.map((parameter) => namedSqlParamValue(params, parameter));
}

function namedSqlParamValue(params, parameter) {
  const nameValue = params[parameter.name];
  if (nameValue !== undefined || Object.hasOwn(params, parameter.name)) {
    if (nameValue === undefined) throw new Error(`SQL named param ${parameter.name} is undefined`);
    return nameValue;
  }
  const tokenValue = params[parameter.token];
  if (tokenValue !== undefined || Object.hasOwn(params, parameter.token)) {
    if (tokenValue === undefined) throw new Error(`SQL named param ${parameter.token} is undefined`);
    return tokenValue;
  }
  throw new Error(`missing SQL named param: ${parameter.name}`);
}

function namedSqlParameters(sql) {
  const parameters = [];
  const seenTokens = new Set();
  let index = 0;
  while (index < sql.length) {
    const character = sql[index] ?? "";
    if (character === "'") {
      index = skipQuotedSql(sql, index, "'");
    } else if (character === "\"") {
      index = skipQuotedSql(sql, index, "\"");
    } else if (character === "`") {
      index = skipQuotedSql(sql, index, "`");
    } else if (character === "[") {
      index = skipBracketQuotedSql(sql, index);
    } else if (character === "-" && sql[index + 1] === "-") {
      const nextLine = sql.indexOf("\n", index + 2);
      index = nextLine === -1 ? sql.length : nextLine + 1;
    } else if (character === "/" && sql[index + 1] === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close === -1 ? sql.length : close + 2;
    } else if (isNamedParameterPrefix(character) && /^[A-Za-z_]$/.test(sql[index + 1] ?? "")) {
      const start = index;
      index += 2;
      while (/^[A-Za-z0-9_]$/.test(sql[index] ?? "")) index += 1;
      const token = sql.slice(start, index);
      if (!seenTokens.has(token)) {
        seenTokens.add(token);
        parameters.push({ token, name: token.slice(1) });
      }
    } else {
      index += 1;
    }
  }
  return parameters;
}

function isNamedParameterPrefix(value) {
  return value === ":" || value === "@" || value === "$";
}

export function isReadSql(sql) {
  const token = mainSqlToken(sql);
  if (token === "select" || token === "explain") return true;
  if (token === "pragma") return isReadPragmaSql(sql);
  return false;
}

const READ_PRAGMAS_WITH_OPTIONAL_ARGS = new Set([
  "foreign_key_check",
  "foreign_key_list",
  "index_info",
  "index_list",
  "index_xinfo",
  "integrity_check",
  "quick_check",
  "table_info",
  "table_list",
  "table_xinfo"
]);

const READ_PRAGMAS_WITHOUT_ARGS = new Set([
  "application_id",
  "cache_size",
  "collation_list",
  "compile_options",
  "database_list",
  "defer_foreign_keys",
  "encoding",
  "foreign_keys",
  "freelist_count",
  "function_list",
  "journal_mode",
  "locking_mode",
  "module_list",
  "page_count",
  "page_size",
  "pragma_list",
  "recursive_triggers",
  "schema_version",
  "synchronous",
  "temp_store",
  "user_version"
]);

function isReadPragmaSql(sql) {
  const pragma = sqlTokenAt(sql, 0);
  const parsed = parsePragmaName(sql, pragma.end);
  if (parsed === null) return false;
  const tailIndex = firstSqlTokenIndex(sql, parsed.end);
  if (sql[tailIndex] === "=") return false;
  if (READ_PRAGMAS_WITH_OPTIONAL_ARGS.has(parsed.name)) return true;
  return READ_PRAGMAS_WITHOUT_ARGS.has(parsed.name) && sql[tailIndex] !== "(";
}

function parsePragmaName(sql, start) {
  const first = sqlIdentifierTokenAt(sql, start);
  if (!first.value) return null;
  const dotIndex = firstSqlTokenIndex(sql, first.end);
  if (sql[dotIndex] !== ".") return { name: first.value, end: first.end };
  const second = sqlIdentifierTokenAt(sql, dotIndex + 1);
  if (!second.value) return { name: first.value, end: first.end };
  return { name: second.value, end: second.end };
}

function sqlIdentifierTokenAt(sql, start) {
  const index = firstSqlTokenIndex(sql, start);
  if (!/^[A-Za-z_]$/.test(sql[index] ?? "")) return { value: "", end: index };
  const end = skipSqlIdentifier(sql, index);
  return { value: sql.slice(index, end).toLowerCase(), end };
}

function mainSqlToken(sql) {
  const firstToken = sqlTokenAt(sql, 0);
  if (firstToken.value !== "with") return firstToken.value;
  return sqlTokenAt(sql, skipWithClauseList(sql, firstToken.end)).value;
}

function sqlTokenAt(sql, start) {
  const index = firstSqlTokenIndex(sql, start);
  if (!/^[A-Za-z_]$/.test(sql[index] ?? "")) return { value: "", end: index };
  const end = skipSqlIdentifier(sql, index);
  return { value: sql.slice(index, end).toLowerCase(), end };
}

function firstSqlTokenIndex(sql, start) {
  let index = start;
  while (index < sql.length) {
    const character = sql[index] ?? "";
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "-" && sql[index + 1] === "-") {
      const nextLine = sql.indexOf("\n", index + 2);
      index = nextLine === -1 ? sql.length : nextLine + 1;
    } else if (character === "/" && sql[index + 1] === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close === -1 ? sql.length : close + 2;
    } else {
      return index;
    }
  }
  return index;
}

function skipWithClauseList(sql, start) {
  let index = firstSqlTokenIndex(sql, start);
  if (sqlTokenAt(sql, index).value === "recursive") index = sqlTokenAt(sql, index).end;
  while (index < sql.length) {
    const name = sqlIdentifierTokenAt(sql, index);
    if (!name.value) return index;
    index = firstSqlTokenIndex(sql, name.end);
    if (sql[index] === "(") index = skipBalancedSql(sql, index);
    const asToken = sqlTokenAt(sql, index);
    if (asToken.value !== "as") return index;
    index = firstSqlTokenIndex(sql, asToken.end);
    const firstHint = sqlTokenAt(sql, index);
    if (firstHint.value === "not") {
      const secondHint = sqlTokenAt(sql, firstHint.end);
      if (secondHint.value === "materialized") index = firstSqlTokenIndex(sql, secondHint.end);
    } else if (firstHint.value === "materialized") {
      index = firstSqlTokenIndex(sql, firstHint.end);
    }
    if (sql[index] !== "(") return index;
    index = firstSqlTokenIndex(sql, skipBalancedSql(sql, index));
    if (sql[index] !== ",") return index;
    index = firstSqlTokenIndex(sql, index + 1);
  }
  return index;
}

function skipSqlIdentifier(sql, start) {
  const character = sql[start] ?? "";
  if (character === "\"") return skipQuotedSql(sql, start, "\"");
  if (character === "`") return skipQuotedSql(sql, start, "`");
  if (character === "[") return skipBracketQuotedSql(sql, start);
  if (!/^[A-Za-z_]$/.test(character)) return start;
  let index = start + 1;
  while (/^[A-Za-z0-9_$]$/.test(sql[index] ?? "")) index += 1;
  return index;
}

function skipBalancedSql(sql, start) {
  let depth = 0;
  for (let index = start; index < sql.length; index += 1) {
    const character = sql[index] ?? "";
    if (character === "'") {
      index = skipQuotedSql(sql, index, "'");
    } else if (character === "\"") {
      index = skipQuotedSql(sql, index, "\"");
    } else if (character === "`") {
      index = skipQuotedSql(sql, index, "`");
    } else if (character === "[") {
      index = skipBracketQuotedSql(sql, index);
    } else if (character === "-" && sql[index + 1] === "-") {
      const nextLine = sql.indexOf("\n", index + 2);
      index = nextLine === -1 ? sql.length : nextLine;
    } else if (character === "/" && sql[index + 1] === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close === -1 ? sql.length : close + 1;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return sql.length;
}

function skipQuotedSql(sql, start, quote) {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) index += 2;
      else return index + 1;
    } else {
      index += 1;
    }
  }
  return sql.length;
}

function skipBracketQuotedSql(sql, start) {
  const close = sql.indexOf("]", start + 1);
  return close === -1 ? sql.length : close + 1;
}
