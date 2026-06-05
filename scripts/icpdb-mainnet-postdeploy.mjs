#!/usr/bin/env node
// Where: scripts/icpdb-mainnet-postdeploy.mjs
// What: Verify a deployed ICPDB canister responds on the target IC network.
// Why: Preflight proves artifacts before deploy; postdeploy proves the mapped canister is callable.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ARCHIVE_CHUNK_BYTES = 256 * 1024;
const options = parseArgs(process.argv.slice(2));

async function main() {
  if (options.selfTest) {
    runSelfTest();
    process.stdout.write("ICPDB mainnet postdeploy self-test OK\n");
    return;
  }
  const mapping = await readMainnetMapping();
  const mappedCanisterId = mappedCanisterIdFromMapping(mapping);
  const canisterId = options.canisterId || mappedCanisterId;
  if (canisterId && !/^[a-z0-9-]+-cai$/.test(canisterId)) {
    throw new Error(`invalid icpdb canister id: ${canisterId}`);
  }
  if (!canisterId && !options.skipCall) {
    throw new Error("icpdb mainnet canister id missing; deploy first or pass --canister-id <id>");
  }
  if (!canisterId && options.requireCanisterId) {
    throw new Error("icpdb mainnet canister id missing; deploy first, commit the mapping, or pass --canister-id <id>");
  }
  if (options.skipCall && options.smokeSql) {
    throw new Error("--smoke-sql cannot be used with --skip-call");
  }
  if (options.skipCall && options.smokeArchiveRestore) {
    throw new Error("--smoke-archive-restore cannot be used with --skip-call");
  }
  if (options.smokeArchiveRestore && !options.smokeSql) {
    throw new Error("--smoke-archive-restore requires --smoke-sql");
  }

  const health = canisterId && !options.skipCall ? await canisterHealth(canisterId, options.network) : null;
  const sqlSmoke = canisterId && options.smokeSql
    ? await smokeSqlDatabase(canisterId, options.network, { archiveRestore: options.smokeArchiveRestore })
    : null;
  const result = {
    ok: true,
    canister: "icpdb",
    network: options.network,
    mainnet_mapping: mappedCanisterId
      ? { status: "configured", canister_id: mappedCanisterId }
      : { status: "missing", canister_id: null },
    canister_id: canisterId || null,
    http_base_url: canisterId ? `https://${canisterId}.icp0.io` : null,
    health,
    sql_smoke: sqlSmoke,
    verified_call: health ? "canister_health" : null,
    skipped_call: options.skipCall,
    smoke_sql: options.smokeSql,
    smoke_archive_restore: Boolean(sqlSmoke?.archive_restore),
    require_canister_id: options.requireCanisterId,
    verification_mode: verificationMode({ canisterId, health, smokeSql: sqlSmoke, skipCall: options.skipCall }),
    check_command: "node scripts/icpdb-mainnet-postdeploy.mjs"
  };
  const output = options.outputFormat === "env" ? formatPostdeployEnv(result) : JSON.stringify(result, null, 2);
  process.stdout.write(`${output}\n`);
}

function formatPostdeployEnv(result) {
  const entries = {
    ICPDB_MAINNET_POSTDEPLOY_OK: result.ok ? "true" : "false",
    ICPDB_MAINNET_CANISTER_ID: result.canister_id ?? undefined,
    ICPDB_MAINNET_HTTP_BASE_URL: result.http_base_url ?? undefined,
    ICPDB_MAINNET_NETWORK: result.network,
    ICPDB_MAINNET_MAPPING_STATUS: result.mainnet_mapping.status,
    ICPDB_MAINNET_VERIFICATION_MODE: result.verification_mode,
    ICPDB_MAINNET_VERIFIED_CALL: result.verified_call ?? undefined,
    ICPDB_MAINNET_SKIPPED_CALL: result.skipped_call ? "true" : "false",
    ICPDB_MAINNET_SMOKE_SQL: result.smoke_sql ? "true" : "false",
    ICPDB_MAINNET_SMOKE_ARCHIVE_RESTORE: result.smoke_archive_restore ? "true" : "false",
    ICPDB_MAINNET_SQL_SMOKE_DATABASE_ID: result.sql_smoke?.database_id,
    ICPDB_MAINNET_SQL_SMOKE_DELETED: result.sql_smoke?.deleted === undefined ? undefined : result.sql_smoke.deleted ? "true" : "false",
    ICPDB_MAINNET_SQL_SMOKE_SCALAR: result.sql_smoke?.scalar,
    ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_HASH: result.sql_smoke?.archive_restore?.snapshot_hash,
    ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_SIZE_BYTES: result.sql_smoke?.archive_restore?.size_bytes
  };
  return Object.entries(entries)
    .filter(([_key, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join("\n");
}

function verificationMode({ canisterId, health, smokeSql, skipCall }) {
  if (smokeSql) return "sql_smoke";
  if (health) return "health_call";
  if (canisterId && skipCall) return "mapped_wiring_only";
  return "predeploy_wiring_only";
}

async function canisterHealth(canisterId, network) {
  const candid = await callCanister(network, canisterId, "canister_health", "()");
  const match = candid.match(/cycles_balance\s*=\s*([0-9_]+)\s*:\s*nat/);
  return {
    candid: candid.trim(),
    cycles_balance: match ? match[1].replaceAll("_", "") : null
  };
}

async function smokeSqlDatabase(canisterId, network, smokeOptions = { archiveRestore: false }) {
  const createOutput = await callCanister(network, canisterId, "create_database", "()");
  const databaseId = parseCreatedDatabaseId(createOutput);
  const tableName = "postdeploy_smoke";
  const body = "postdeploy-mainnet-smoke";
  try {
    await callCanister(network, canisterId, "sql_execute", sqlRequest(databaseId, `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`, []));
    await callCanister(network, canisterId, "sql_execute", sqlRequest(databaseId, `INSERT INTO ${tableName} (body) VALUES (?1)`, [`variant { Text = "${body}" }`]));
    const queryOutput = await callCanister(network, canisterId, "sql_query", sqlRequest(databaseId, `SELECT body FROM ${tableName} WHERE body = ?1`, [`variant { Text = "${body}" }`]));
    if (!queryOutput.includes(body)) {
      throw new Error(`postdeploy SQL smoke query did not return inserted row for ${databaseId}`);
    }
    const scalarOutput = await callCanister(network, canisterId, "sql_query", sqlRequest(databaseId, `SELECT body FROM ${tableName} WHERE body = ?1`, [`variant { Text = "${body}" }`], 1));
    if (!scalarOutput.includes(body)) {
      throw new Error(`postdeploy SQL smoke scalar did not return inserted row for ${databaseId}`);
    }
    const archiveRestore = smokeOptions.archiveRestore ? await smokeArchiveRestore(network, canisterId, databaseId, tableName, body) : null;
    return { database_id: databaseId, table: tableName, inserted: body, scalar: body, archive_restore: archiveRestore, deleted: await deleteSmokeDatabase(network, canisterId, databaseId) };
  } catch (error) {
    await deleteSmokeDatabase(network, canisterId, databaseId).catch(() => false);
    throw error;
  }
}

async function smokeArchiveRestore(network, canisterId, databaseId, tableName, body) {
  const archiveInfoOutput = await callCanister(network, canisterId, "begin_database_archive", `("${databaseId}")`);
  const sizeBytes = parseNatField(archiveInfoOutput, "size_bytes");
  const chunks = [];
  const hash = createHash("sha256");
  let offset = 0;
  while (offset < sizeBytes) {
    const maxBytes = Math.min(ARCHIVE_CHUNK_BYTES, sizeBytes - offset);
    const chunkOutput = await callCanister(network, canisterId, "read_database_archive_chunk", `("${databaseId}", ${offset} : nat64, ${maxBytes} : nat32)`);
    const bytes = parseCandidBlob(chunkOutput);
    if (bytes.length === 0) throw new Error(`archive stream ended before expected size for ${databaseId}`);
    chunks.push({ offset, bytes });
    hash.update(bytes);
    offset += bytes.length;
  }
  const snapshot = Buffer.concat(chunks.map((chunk) => chunk.bytes));
  const snapshotHash = hash.digest();
  await callCanister(network, canisterId, "finalize_database_archive", `("${databaseId}", ${candidBlob(snapshotHash)})`);
  await callCanister(network, canisterId, "begin_database_restore", `("${databaseId}", ${candidBlob(snapshotHash)}, ${snapshot.length} : nat64)`);
  for (const chunk of chunks) {
    await callCanister(
      network,
      canisterId,
      "write_database_restore_chunk",
      `(record { database_id = "${databaseId}"; offset = ${chunk.offset} : nat64; bytes = ${candidBlob(chunk.bytes)} })`
    );
  }
  await callCanister(network, canisterId, "finalize_database_restore", `("${databaseId}")`);
  const restoredQuery = await callCanister(network, canisterId, "sql_query", sqlRequest(databaseId, `SELECT body FROM ${tableName} WHERE body = ?1`, [`variant { Text = "${body}" }`]));
  if (!restoredQuery.includes(body)) {
    throw new Error(`postdeploy archive/restore smoke did not return restored row for ${databaseId}`);
  }
  return {
    size_bytes: snapshot.length,
    snapshot_hash: snapshotHash.toString("hex"),
    restored: true
  };
}

async function deleteSmokeDatabase(network, canisterId, databaseId) {
  const output = await callCanister(network, canisterId, "delete_database", `("${databaseId}")`);
  if (!/variant\s*\{\s*Ok/.test(output)) throw new Error(`failed to delete postdeploy smoke database ${databaseId}: ${output}`);
  return true;
}

function sqlRequest(databaseId, sql, params, maxRows = null) {
  const maxRowsValue = maxRows === null ? "null" : `opt (${maxRows} : nat32)`;
  return `(record { database_id = "${databaseId}"; sql = "${escapeCandidText(sql)}"; params = vec { ${params.join("; ")} }; max_rows = ${maxRowsValue}; idempotency_key = null })`;
}

function parseCreatedDatabaseId(output) {
  const match = output.match(/Ok\s*=\s*"([^"]+)"/);
  if (!match) throw new Error(`create_database did not return a database id: ${output}`);
  return match[1];
}

function parseNatField(output, fieldName) {
  const pattern = new RegExp(`${fieldName}\\s*=\\s*([0-9_]+)\\s*:\\s*nat(?:64)?`);
  const match = output.match(pattern);
  if (!match) throw new Error(`missing ${fieldName} in candid output: ${output}`);
  const value = Number(match[1].replaceAll("_", ""));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${fieldName}: ${match[1]}`);
  return value;
}

function parseCandidBlob(output) {
  const blobMatch = output.match(/blob\s+"((?:\\.|[^"])*)"/s);
  if (blobMatch) return Buffer.from(parseCandidBlobText(blobMatch[1]));
  const vecMatch = output.match(/vec\s*\{([^}]*)\}/s);
  if (vecMatch) {
    const bytes = [...vecMatch[1].matchAll(/([0-9_]+)\s*(?::\s*nat8)?/g)].map((match) => Number(match[1].replaceAll("_", "")));
    if (bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Buffer.from(bytes);
  }
  throw new Error(`missing blob in candid output: ${output}`);
}

function parseCandidBlobText(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0));
      continue;
    }
    const next = value.slice(index + 1, index + 3);
    if (/^[0-9a-fA-F]{2}$/.test(next)) {
      bytes.push(Number.parseInt(next, 16));
      index += 2;
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === "n") bytes.push(10);
    else if (escaped === "r") bytes.push(13);
    else if (escaped === "t") bytes.push(9);
    else if (escaped === "\\" || escaped === "\"") bytes.push(escaped.charCodeAt(0));
    else throw new Error(`unsupported candid blob escape: \\${escaped ?? ""}`);
    index += 1;
  }
  return bytes;
}

function candidBlob(bytes) {
  return `blob "${[...bytes].map((byte) => `\\${byte.toString(16).padStart(2, "0")}`).join("")}"`;
}

function escapeCandidText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

async function callCanister(network, canisterId, method, args) {
  const { stdout, stderr } = await execFileAsync("icp", [
    "canister",
    "call",
    "-n",
    network,
    canisterId,
    method,
    args,
    "-o",
    "candid"
  ], { maxBuffer: 4 * 1024 * 1024 });
  return `${stdout}${stderr}`;
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

async function readOptionalMappingFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

function parseArgs(args) {
  const parsed = { canisterId: "", network: "ic", outputFormat: "json", requireCanisterId: false, skipCall: false, smokeSql: false, smokeArchiveRestore: false, selfTest: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--skip-call") {
      parsed.skipCall = true;
    } else if (arg === "--smoke-sql") {
      parsed.smokeSql = true;
    } else if (arg === "--smoke-archive-restore") {
      parsed.smokeArchiveRestore = true;
    } else if (arg === "--self-test") {
      parsed.selfTest = true;
    } else if (arg === "--require-canister-id") {
      parsed.requireCanisterId = true;
    } else if (arg === "--canister-id") {
      parsed.canisterId = canisterIdArg(requiredValue(args, index, arg), "canister id");
      index += 1;
    } else if (arg === "--network") {
      parsed.network = requiredValue(args, index, arg);
      index += 1;
    } else if (arg === "--format") {
      parsed.outputFormat = parseOutputFormat(requiredValue(args, index, arg));
      index += 1;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (parsed.skipCall && parsed.smokeSql) {
    throw new Error("--smoke-sql cannot be used with --skip-call");
  }
  if (parsed.skipCall && parsed.smokeArchiveRestore) {
    throw new Error("--smoke-archive-restore cannot be used with --skip-call");
  }
  if (parsed.smokeArchiveRestore && !parsed.smokeSql) {
    throw new Error("--smoke-archive-restore requires --smoke-sql");
  }
  return parsed;
}

function runSelfTest() {
  const sizeOutput = '(variant { Ok = record { database_id = "db_self"; size_bytes = 1_024 : nat64 } })';
  if (parseNatField(sizeOutput, "size_bytes") !== 1024) throw new Error("size_bytes self-test failed");
  const blobOutput = '(variant { Ok = record { bytes = blob "\\00\\41\\\\\\"" } })';
  const parsedBlob = parseCandidBlob(blobOutput);
  if (parsedBlob.toString("hex") !== "00415c22") throw new Error("blob self-test failed");
  const encoded = candidBlob(Buffer.from([0, 65, 92, 34]));
  if (encoded !== 'blob "\\00\\41\\5c\\22"') throw new Error("candid blob self-test failed");
  const required = parseArgs(["--skip-call", "--require-canister-id", "--canister-id", "ryjl3-tyaaa-aaaaa-aaaba-cai"]);
  if (!required.skipCall || !required.requireCanisterId || required.canisterId !== "ryjl3-tyaaa-aaaaa-aaaba-cai") {
    throw new Error("require-canister-id arg self-test failed");
  }
  const archiveRestore = parseArgs(["--smoke-sql", "--smoke-archive-restore"]);
  if (!archiveRestore.smokeSql || !archiveRestore.smokeArchiveRestore) {
    throw new Error("archive restore smoke arg self-test failed");
  }
  const envFormat = parseArgs(["--format", "env", "--skip-call"]);
  if (envFormat.outputFormat !== "env") throw new Error("format env arg self-test failed");
  const envOutput = formatPostdeployEnv({
    ok: true,
    network: "ic",
    mainnet_mapping: { status: "configured", canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai" },
    canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai",
    http_base_url: "https://ryjl3-tyaaa-aaaaa-aaaba-cai.icp0.io",
    health: null,
    sql_smoke: { database_id: "db_self", scalar: "postdeploy-mainnet-smoke", deleted: true, archive_restore: { snapshot_hash: "a".repeat(64), size_bytes: 1024 } },
    verified_call: null,
    skipped_call: true,
    smoke_sql: true,
    smoke_archive_restore: true,
    require_canister_id: false,
    verification_mode: "sql_smoke",
    check_command: "node scripts/icpdb-mainnet-postdeploy.mjs"
  });
  if (!envOutput.includes("ICPDB_MAINNET_CANISTER_ID=") || !envOutput.includes("ICPDB_MAINNET_SMOKE_ARCHIVE_RESTORE=") || !envOutput.includes("ICPDB_MAINNET_SQL_SMOKE_DELETED=") || !envOutput.includes("ICPDB_MAINNET_SQL_SMOKE_SCALAR=") || !envOutput.includes("ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_HASH=") || !envOutput.includes("ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_SIZE_BYTES=")) {
    throw new Error("postdeploy env output self-test failed");
  }
  const sqlOnlyEnvOutput = formatPostdeployEnv({
    ok: true,
    network: "ic",
    mainnet_mapping: { status: "configured", canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai" },
    canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai",
    http_base_url: "https://ryjl3-tyaaa-aaaaa-aaaba-cai.icp0.io",
    health: null,
    sql_smoke: { database_id: "db_self", scalar: "postdeploy-mainnet-smoke", deleted: true, archive_restore: null },
    verified_call: null,
    skipped_call: true,
    smoke_sql: true,
    smoke_archive_restore: false,
    require_canister_id: false,
    verification_mode: "sql_smoke",
    check_command: "node scripts/icpdb-mainnet-postdeploy.mjs"
  });
  if (!sqlOnlyEnvOutput.includes("ICPDB_MAINNET_SQL_SMOKE_DELETED=") || sqlOnlyEnvOutput.includes("ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_HASH=") || sqlOnlyEnvOutput.includes("ICPDB_MAINNET_SQL_SMOKE_ARCHIVE_RESTORE_SIZE_BYTES=")) {
    throw new Error("postdeploy sql-only env output self-test failed");
  }
  if (!sqlRequest("db_self", "SELECT 1", [], 1).includes("max_rows = opt (1 : nat32)")) {
    throw new Error("sqlRequest max_rows self-test failed");
  }
  assertThrows(() => parseArgs(["--smoke-archive-restore"]), /--smoke-archive-restore requires --smoke-sql/);
  assertThrows(() => parseArgs(["--canister-id", "   "]), /canister id must be a non-empty string/);
  assertThrows(() => parseArgs(["--format", "table"]), /format must be json or env/);
  assertThrows(() => mappedCanisterIdFromMapping({ icpdb: "   " }), /icpdb must be a non-empty string/);
  assertThrows(() => mappedCanisterIdFromMapping({ icpdb: "not-a-canister" }), /icpdb must be a canister id ending in -cai/);
  if (verificationMode({ canisterId: "", health: null, smokeSql: null, skipCall: true }) !== "predeploy_wiring_only") {
    throw new Error("predeploy verification mode self-test failed");
  }
  if (verificationMode({ canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai", health: null, smokeSql: null, skipCall: true }) !== "mapped_wiring_only") {
    throw new Error("mapped verification mode self-test failed");
  }
}

function requiredValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function canisterIdArg(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseOutputFormat(value) {
  if (value === "json" || value === "env") return value;
  throw new Error("format must be json or env");
}

function mappedCanisterIdFromMapping(mapping) {
  if (!Object.hasOwn(mapping, "icpdb")) return "";
  const value = mapping.icpdb;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(".icp/data/mappings/ic.ids.json icpdb must be a non-empty string");
  }
  if (!/^[a-z0-9-]+-cai$/.test(value)) {
    throw new Error(".icp/data/mappings/ic.ids.json icpdb must be a canister id ending in -cai");
  }
  return value;
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
