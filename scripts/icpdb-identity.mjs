#!/usr/bin/env node
// Where: scripts/icpdb-identity.mjs
// What: Identity-signed ICPDB CLI for service identities in server, CLI, and CI environments.
// Why: ICPDB's normal automation path should use principal ACLs instead of bearer database tokens.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { chmod, open, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Actor, HttpAgent } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/agent/index.js";
import { Ed25519KeyIdentity } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/identity/index.js";
import { Secp256k1KeyIdentity } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/identity/secp256k1/index.js";
import { Principal } from "../icpdb-console/node_modules/@icp-sdk/core/lib/esm/principal/index.js";
import { formatCliOutput, schemaEntry, sqlScalarResult } from "./icpdb-http-output.mjs";

const DEFAULT_NETWORK_URL = "https://icp-api.io";
const DEFAULT_MAX_ROWS = 100;
const DEFAULT_LIMIT = 100;
const MAX_SQL_ROWS = 500;
const MAX_NAT32 = 4_294_967_295;
const DEFAULT_WAIT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_INTERVAL_MS = 500;
const ARCHIVE_CHUNK_BYTES = 256 * 1024;
const SQL_DUMP_BATCH_STATEMENTS = 32;
const SERVICE_ENV_FILE_MODE = 0o600;
const DEFAULT_SERVICE_ENV_FILE = "service.env";
const MIGRATIONS_TABLE = "icpdb_schema_migrations";
const ANONYMOUS_PRINCIPAL = "2vxsx-fae";

export function usage() {
  return usageLines().join("\n");
}

export function commandUsage(topic) {
  const command = topic.trim().replace(/^\./, "");
  if (!command) return usage();
  if (command === "quickstart") return ["Usage:", ...quickstartUsageLines()].join("\n");
  if (command === "ops") return ["Usage:", ...opsUsageLines()].join("\n");
  if (command === "shell") return identityShellUsage();
  if (command.startsWith("shell ")) return identityShellUsage(command.slice("shell ".length));
  const matches = usageLines().filter((line) => lineMatchesCommand(line, command));
  if (matches.length === 0) throw new Error(`unknown help command: ${topic}`);
  return ["Usage:", ...matches].join("\n");
}

function quickstartUsageLines() {
  return [
    "  # Server/CI shortest path: create DB, write service.env, run SQL, inspect DB",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --env-out service.env provision-service-db writer --setup-file ./schema.sql",
    "  # For a one-table smoke without a schema file, use inline setup SQL:",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --env-out service.env provision-service-db writer --statement \"CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)\"",
    "  # For production schema changes, use versioned migrations:",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --env-out service.env provision-service-db writer --setup-migrations-file ./migrations.json",
    "  # Later commands read cwd-local service.env by default; set ICPDB_ENV_FILE only when the file lives elsewhere",
    "  # First verify service.env locally: file mode, connection URL, and derived service principal",
    "  node scripts/icpdb-identity.mjs inspect-env --format table",
    "  # Generic .env is explicit: use --env-out .env, then ICPDB_ENV_FILE=.env or --env-file .env for later commands",
    "  node scripts/icpdb-identity.mjs sql \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]'",
    "  node scripts/icpdb-identity.mjs sql \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  node scripts/icpdb-identity.mjs scalar \"SELECT count(*) FROM notes\" --format table",
    "  # Equivalent explicit commands are available when CI wants read/write split in logs:",
    "  node scripts/icpdb-identity.mjs execute \"INSERT INTO notes(body) VALUES (?1)\" --params '[\"hello\"]'",
    "  node scripts/icpdb-identity.mjs query \"SELECT id, body FROM notes ORDER BY id DESC\" --format table",
    "  node scripts/icpdb-identity.mjs scalar \"SELECT count(*) FROM notes\" --format table",
    "  node scripts/icpdb-identity.mjs tables --format table",
    "  node scripts/icpdb-identity.mjs views --format table",
    "  node scripts/icpdb-identity.mjs schema notes --format table",
    "  node scripts/icpdb-identity.mjs columns notes --format table",
    "  node scripts/icpdb-identity.mjs indexes notes --format table",
    "  node scripts/icpdb-identity.mjs triggers notes --format table",
    "  node scripts/icpdb-identity.mjs foreign-keys notes --format table",
    "  node scripts/icpdb-identity.mjs inspect notes --format table",
    "  node scripts/icpdb-identity.mjs status --format table",
    "  node scripts/icpdb-service-env-check.mjs --require-role writer --smoke-sql --smoke-sdk --format table",
    "  node scripts/icpdb-identity.mjs url --format env",
    "  # Backup jobs need owner role; create service.env as owner or grant owner before archive/restore",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --env-out service.env provision-service-db owner --setup-file ./schema.sql",
    "  node scripts/icpdb-service-env-check.mjs --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Existing DB with owner private key: create and grant a Server/CI service identity",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --env-out service.env provision-service <database-id> writer",
    "  node scripts/icpdb-identity.mjs inspect-env --format table",
    "  node scripts/icpdb-identity.mjs status --format table",
    "  node scripts/icpdb-identity.mjs scalar \"SELECT count(*) FROM sqlite_schema\" --format table",
    "  node scripts/icpdb-identity.mjs tables --format table",
    "  node scripts/icpdb-identity.mjs views --format table",
    "  node scripts/icpdb-identity.mjs schema --format table",
    "  node scripts/icpdb-identity.mjs columns <table-name> --format table",
    "  node scripts/icpdb-identity.mjs indexes <table-name> --format table",
    "  node scripts/icpdb-identity.mjs triggers <table-name> --format table",
    "  node scripts/icpdb-identity.mjs foreign-keys <table-name> --format table",
    "  node scripts/icpdb-identity.mjs inspect --format table",
    "  node scripts/icpdb-service-env-check.mjs --require-role writer --smoke-sql --smoke-sdk --format table",
    "  node scripts/icpdb-identity.mjs url --format env",
    "  # For archive/restore or final goal proof on this existing DB, grant owner instead:",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --env-out service.env provision-service <database-id> owner",
    "  node scripts/icpdb-service-env-check.mjs --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "",
    "  # Existing browser/II DB: copy console Response sidebar Connection URL, generate a DB-bearing Server/CI identity, then grant it in console",
    "  # Use the database id from icpdb://<canister-id>/<database-id> in the generate-identity command below",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --database-id <database-id> --network-url https://icp-api.io --env-out service.env generate-identity",
    "  node scripts/icpdb-identity.mjs principal --format table",
    "  node scripts/icpdb-identity.mjs inspect-env --format table",
    "  # Grant the printed service principal as owner in console Permissions while logged in with browser/II",
    "  node scripts/icpdb-identity.mjs status --format table",
    "  node scripts/icpdb-identity.mjs scalar \"SELECT count(*) FROM sqlite_schema\" --format table",
    "  node scripts/icpdb-identity.mjs tables --format table",
    "  node scripts/icpdb-identity.mjs views --format table",
    "  node scripts/icpdb-identity.mjs schema --format table",
    "  node scripts/icpdb-identity.mjs columns <table-name> --format table",
    "  node scripts/icpdb-identity.mjs indexes <table-name> --format table",
    "  node scripts/icpdb-identity.mjs triggers <table-name> --format table",
    "  node scripts/icpdb-identity.mjs foreign-keys <table-name> --format table",
    "  node scripts/icpdb-identity.mjs inspect --format table",
    "  node scripts/icpdb-service-env-check.mjs --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "  node scripts/icpdb-identity.mjs url --format env"
  ];
}

function opsUsageLines() {
  return [
    "  # Archive/restore path: snapshot, pin hash, restore, verify status",
    "  # cwd-local service.env is read by default; set ICPDB_ENV_FILE only for non-default paths",
    "  # Archive/restore requires owner role; writer service.env is only for SQL write/query CI",
    "  # For backup jobs, create the service env with provision-service-db owner or grant owner before running ops",
    "  # Non-destructive CI verification restores into a scratch DB and leaves the configured DB intact",
    "  node scripts/icpdb-service-env-check.mjs --require-role owner --smoke-sql --smoke-sdk --smoke-archive-restore --smoke-sdk-archive-restore --format table",
    "  node scripts/icpdb-identity.mjs archive ./backup.sqlite --format env",
    "  node scripts/icpdb-identity.mjs snapshot-info ./backup.sqlite --format env",
    "  export ICPDB_SNAPSHOT_HASH=<value-from-snapshot-info>",
    "  # snapshot-info re-reads the same hash offline before restore promotion",
    "  # restore writes into the selected DB; pin the SHA-256 from snapshot-info before promotion",
    "  node scripts/icpdb-identity.mjs restore ./backup.sqlite --expect-snapshot-hash \"$ICPDB_SNAPSHOT_HASH\"",
    "  node scripts/icpdb-identity.mjs status --format table",
    "",
    "  # Shard operator path: use a controller service identity",
    "  export ICPDB_ENV_FILE=controller.env",
    "  node scripts/icpdb-service-env-check.mjs --env-file controller.env --smoke-shards --smoke-sdk-shards --format table",
    "  node scripts/icpdb-identity.mjs all-placements --format table",
    "  node scripts/icpdb-identity.mjs shards --format table",
    "  node scripts/icpdb-identity.mjs shard-status <database-canister-id> --format table",
    "  node scripts/icpdb-identity.mjs shard-top-up <database-canister-id> <cycles> --format table",
    "  node scripts/icpdb-identity.mjs shard-maintain 1 0 0 0 8 0 --format table",
    "  node scripts/icpdb-identity.mjs shard-migrate <database-id> <database-canister-id> --format table",
    "  node scripts/icpdb-identity.mjs shard-ops --format table",
    "  # Use applied for verified success; use failed with a reason only after operator verification",
    "  node scripts/icpdb-identity.mjs shard-reconcile applied <operation-id>",
    "  node scripts/icpdb-identity.mjs shard-reconcile failed <operation-id> \"operator verified failure\"",
    "  node scripts/icpdb-identity.mjs operation <database-id> <operation-id> --format table",
    "  node scripts/icpdb-identity.mjs operation-reconcile <database-id> <operation-id>"
  ];
}

function usageLines() {
  return [
    "Usage:",
    "  node scripts/icpdb-identity.mjs help [command]",
    "  node scripts/icpdb-identity.mjs help quickstart",
    "  node scripts/icpdb-identity.mjs help ops",
    "  node scripts/icpdb-identity.mjs help shell",
    "  node scripts/icpdb-identity.mjs help shell sql",
    "  # help sql shows focused SQL routing syntax",
    "  # help shell sql shows shell SQL read/write routing and idempotency behavior",
    "  # help provision-service-db shows one-command DB and service identity setup",
    "  # generate-identity creates a dedicated Server/CI private-key identity; browser/II principals do not match it",
    "  # generate-identity browser/II handoff: pass --database-id, then grant the printed service principal in console Permissions",
    "  # generate-identity controller handoff: add the printed principal as an icpdb canister controller before shard ops",
    "  # generate-identity with --canister-id and --env-out stores a controller-ready canister target in the env file",
    "  node scripts/icpdb-identity.mjs generate-identity [--identity-type ed25519|secp256k1]",
    "  node scripts/icpdb-identity.mjs --format env generate-identity",
    "  node scripts/icpdb-identity.mjs --env-out service.env generate-identity",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --network-url https://icp-api.io --env-out service.env generate-identity",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --database-id <database-id> --network-url https://icp-api.io --env-out service.env generate-identity",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> create-db [--statement <sql> ...]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> create-db --statements-file <file>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> create-db --setup-file <file|->",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> create-db --setup-migrations-file <file|->",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> create-db --statement <sql>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> --format env create-db",
    "  node scripts/icpdb-identity.mjs --env-out service.env create-db",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> health",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> databases",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> grant-member <database_id> <principal> <reader|writer|owner>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --service-identity-json-file <service> grant-service <database_id> <reader|writer|owner>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> provision-service <database_id> <reader|writer|owner>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> provision-service-db <reader|writer|owner> [--statement <sql> ...]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> provision-service-db <reader|writer|owner> --statements-file <file>",
    "  # provision-service-db --statements-file <file> runs parameterized setup statements before service identity handoff",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> provision-service-db <reader|writer|owner> --setup-file <file|->",
    "  # provision-service-db --setup-file <file|-> runs setup SQL before service identity handoff",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> provision-service-db <reader|writer|owner> --setup-migrations-file <file|->",
    "  # provision-service-db --setup-migrations-file <file|-> runs versioned migrations before service identity handoff",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> provision-service-db <reader|writer|owner> --statement <sql>",
    "  # provision-service-db --statement <sql> runs setup SQL before service identity handoff",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --format env provision-service-db <reader|writer|owner>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <owner> --env-out service.env provision-service-db <reader|writer|owner>",
    "  node scripts/icpdb-identity.mjs query <sql> [--params <json>] [--format table|json|csv]",
    "  node scripts/icpdb-identity.mjs scalar <sql> [--params <json>] [--format table|json|csv]",
    "  # sql auto-routes read SQL to query and write SQL to execute",
    "  # sql supports --params <json>, --params-file <file>, and --format table|json|csv",
    "  # sql write commands support --idempotency-key <key> and --wait for routed writes",
    "  node scripts/icpdb-identity.mjs sql <sql> [--params <json>] [--format table|json|csv]",
    "  node scripts/icpdb-identity.mjs sql <sql> [--params-file <file>]",
    "  node scripts/icpdb-identity.mjs query \"SELECT * FROM notes WHERE id = ?1\" --params '[1]' --format csv",
    "  node scripts/icpdb-identity.mjs scalar \"SELECT count(*) FROM notes\" --format table",
    "  # inspect-env is local-only: it checks env shape, owner-only file mode, connection URL, and derived principal before canister calls",
    "  # inspect-env controller.env: ICPDB_ENV_FILE=controller.env node scripts/icpdb-identity.mjs --canister-id <id> inspect-env --format table",
    "  node scripts/icpdb-identity.mjs inspect-env",
    "  node scripts/icpdb-identity.mjs --canister-id <id> inspect-env --format table",
    "  ICPDB_ENV_FILE=controller.env node scripts/icpdb-identity.mjs --canister-id <id> inspect-env --format table",
    "  # url writes or prints the reusable icpdb://<canister-id>/<database-id> connection block without a canister call",
    "  # url is a local connection block printer/merger for scripts that already know the database id",
    "  node scripts/icpdb-identity.mjs url [database_id]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --env-out service.env url <database-id>",
    "  node scripts/icpdb-identity.mjs status [database_id]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> query [database_id] <sql> [--params-file <file>]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> scalar [database_id] <sql> [--params-file <file>]",
    "  node scripts/icpdb-identity.mjs execute <sql> [--params <json>] [--idempotency-key <key>] [--wait]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> execute [database_id] <sql> [--idempotency-key <key>] [--wait]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> sql [database_id] <sql> [--params-file <file>] [--idempotency-key <key>] [--wait]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> batch [database_id] '<statements_json>' [--mode read|write] [--idempotency-key <key>] [--wait]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> batch [database_id] --statements-file <file> [--mode read|write]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> transaction [database_id] '<statements_json>' [--mode read|write] [--idempotency-key <key>] [--wait]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> transaction [database_id] --statements-file <file> [--mode read|write]",
    "  # transaction defaults to a named one-call sql_batch alias for atomic Server/CI writes; --mode read runs per-statement sql_query",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> shell [database_id] [sql|dot-command]",
    "  # shell is principal-signed and supports .principal, .health, .url, .status, .tables, .views, .schema, .inspect, .stats, .usage, .members, .placement, .operation, .dump, .load, .script, .migrate, .archive, .restore, and SQL",
    "  # tables lists table/view objects; use --format table|json|csv for CI output",
    "  node scripts/icpdb-identity.mjs tables [--format table|json|csv]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> tables [database_id]",
    "  # views lists view objects; use --format table|json|csv for CI output",
    "  node scripts/icpdb-identity.mjs views [--format table|json|csv]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> views [database_id]",
    "  # inspect shows DB shape: placement, usage, table summaries, schema metadata, and preview rows",
    "  # inspect accepts [table_name] for focused table debug output and --format table|json|csv for CI output",
    "  node scripts/icpdb-identity.mjs inspect [table_name] [--format table|json|csv]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> inspect [database_id] [table_name]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> describe [database_id] <table_name>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> columns [database_id] <table_name>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> indexes [database_id] <table_name>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> triggers [database_id] <table_name>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> foreign-keys [database_id] <table_name>",
    "  # schema prints schema SQL for all objects or one table; use --format table|json|csv for CI output",
    "  node scripts/icpdb-identity.mjs schema [table_name] [--format table|json|csv]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> schema [database_id] [table_name]",
    "  # stats summarizes table/view counts, row counts, and schema object counts",
    "  node scripts/icpdb-identity.mjs stats [--format table|json|csv]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> stats [database_id]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> preview [database_id] <table_name>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> dump [database_id] [table_name]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> load [database_id] <file|-> [--mode read|write] [--idempotency-key <key>] [--wait]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> script [database_id] <file|-> [--mode read|write] [--idempotency-key <key>] [--wait]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> migrate [database_id] <file|-> [--idempotency-key <key>] [--wait]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> usage [database_id]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> usage-events [database_id]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> placement [database_id]",
    "  node scripts/icpdb-identity.mjs --env-file controller.env all-placements --format table",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> placements",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> all-placements",
    "  node scripts/icpdb-identity.mjs --env-file controller.env shards --format table",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> shards",
    "  node scripts/icpdb-identity.mjs --env-file controller.env shard-status <database_canister_id> --format table",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> shard-status <database_canister_id>",
    "  node scripts/icpdb-identity.mjs --env-file controller.env shard-top-up <database_canister_id> <cycles> --format table",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> shard-top-up <database_canister_id> <cycles>",
    "  node scripts/icpdb-identity.mjs --env-file controller.env shard-maintain <min_available_slots> <min_cycles_balance> <top_up_cycles> <max_new_shards> <new_shard_max_databases> <new_shard_initial_cycles> --format table",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> shard-maintain <min_available_slots> <min_cycles_balance> <top_up_cycles> <max_new_shards> <new_shard_max_databases> <new_shard_initial_cycles>",
    "  node scripts/icpdb-identity.mjs --env-file controller.env shard-migrate <database_id> <database_canister_id> --format table",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> shard-migrate <database_id> <database_canister_id>",
    "  node scripts/icpdb-identity.mjs --env-file controller.env shard-ops --format table",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> shard-ops",
    "  node scripts/icpdb-identity.mjs --env-file controller.env shard-reconcile <applied|failed> <operation_id> [failure_reason]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> shard-reconcile <applied|failed> <operation_id> [failure_reason]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> operation [database_id] <operation_id>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> operation-reconcile [database_id] <operation_id>",
    "  node scripts/icpdb-identity.mjs archive <file>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> archive [database_id] <file>",
    "  # restore writes into the selected DB; use --expect-snapshot-hash <sha256> for CI artifact promotion",
    "  # restore non-destructive verification: icpdb-service-env-check.mjs --smoke-archive-restore --smoke-sdk-archive-restore restores into scratch DBs",
    "  node scripts/icpdb-identity.mjs restore <file> [--expect-snapshot-hash <sha256>]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> restore [database_id] <file> [--expect-snapshot-hash <sha256>]",
    "  node scripts/icpdb-identity.mjs snapshot-info <file>",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> archive-cancel [database_id]",
    "  node scripts/icpdb-identity.mjs --canister-id <id> --identity-pem-file <file> delete-db [database_id]",
    "  node scripts/icpdb-identity.mjs --identity-pem-file <file> principal",
    "",
    "Options:",
    "  --url <icpdb://canister-id/database-id>",
    "  --network-url <url>",
    "  --canister-id <principal>",
    "  --database-id <database_id>",
    "  --identity-pem <pem>",
    "  --identity-pem-file <file>",
    "  --identity-json <json>",
    "  --identity-json-file <file>",
    "  --identity-type auto|ed25519|secp256k1",
    "  --service-identity-pem <pem>",
    "  --service-identity-pem-file <file>",
    "  --service-identity-json <json>",
    "  --service-identity-json-file <file>",
    "  --service-identity-type auto|ed25519|secp256k1",
    "  --root-key <hex>",
    "  --env-file <file>",
    "  --env-out <file>",
    "  --params '[...]|{...}'",
    "  --params-file <file>",
    "  --statement <sql>",
    "  --statements-file <file>",
    "  --mode read|write",
    "  --setup-file <file|->",
    "  --setup-migrations-file <file|->",
    "  --idempotency-key <key>",
    "  --expect-snapshot-hash <sha256>",
    "  --wait",
    "  --max-rows <n>",
    "  --limit <n>",
    "  --offset <n>",
    "  --format json|table|csv|env",
    "",
    "Env:",
    "  ICPDB_URL",
    "  ICPDB_ENV_FILE",
    "  ICPDB_NETWORK_URL",
    "  ICPDB_CANISTER_ID",
    "  ICPDB_DATABASE_ID",
    "  ICPDB_IDENTITY_PEM",
    "  ICPDB_IDENTITY_PEM_FILE",
    "  ICPDB_IDENTITY_JSON",
    "  ICPDB_IDENTITY_JSON_FILE",
    "  ICPDB_IDENTITY_TYPE",
    "  ICPDB_IDENTITY_PRINCIPAL",
    "  ICPDB_SETUP_SQL",
    "  ICPDB_SETUP_SQL_FILE",
    "  ICPDB_SETUP_STATEMENTS",
    "  ICPDB_SETUP_STATEMENTS_FILE",
    "  ICPDB_SETUP_MIGRATIONS",
    "  ICPDB_SETUP_MIGRATIONS_FILE",
    "  ICPDB_SERVICE_IDENTITY_PEM",
    "  ICPDB_SERVICE_IDENTITY_PEM_FILE",
    "  ICPDB_SERVICE_IDENTITY_JSON",
    "  ICPDB_SERVICE_IDENTITY_JSON_FILE",
    "  ICPDB_SERVICE_IDENTITY_TYPE",
    "  ICPDB_SERVICE_IDENTITY_PRINCIPAL",
    "  ICPDB_ROOT_KEY"
  ];
}

function lineMatchesCommand(line, command) {
  const trimmed = line.trim();
  if (trimmed.startsWith(`# ${command}`)) return true;
  if (!trimmed.startsWith("node scripts/icpdb-identity.mjs ")) return false;
  const tokens = trimmed.split(/\s+/);
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("--")) {
      index += 1;
      continue;
    }
    return token === command;
  }
  return false;
}

export function parseIdentityCliArgs(args, env = process.env) {
  const mergedEnv = identityCliEnvFromArgs(args, env);
  const envConnection = identityConnectionFromEnv(mergedEnv);
  const identityPrincipal = optionalNonEmptyEnvValue(mergedEnv, "ICPDB_IDENTITY_PRINCIPAL") ?? "";
  const serviceIdentityPrincipal = optionalNonEmptyEnvValue(mergedEnv, "ICPDB_SERVICE_IDENTITY_PRINCIPAL") ?? "";
  const options = {
    canisterId: envConnection.canisterId,
    databaseId: envConnection.databaseId,
    networkUrl: mergedEnv.ICPDB_NETWORK_URL ?? DEFAULT_NETWORK_URL,
    identityPem: mergedEnv.ICPDB_IDENTITY_PEM ?? "",
    identityPemFile: mergedEnv.ICPDB_IDENTITY_PEM_FILE ?? "",
    identityJson: mergedEnv.ICPDB_IDENTITY_JSON ?? "",
    identityJsonFile: mergedEnv.ICPDB_IDENTITY_JSON_FILE ?? "",
    identityType: mergedEnv.ICPDB_IDENTITY_TYPE ?? "auto",
    serviceIdentityPem: mergedEnv.ICPDB_SERVICE_IDENTITY_PEM ?? "",
    serviceIdentityPemFile: mergedEnv.ICPDB_SERVICE_IDENTITY_PEM_FILE ?? "",
    serviceIdentityJson: mergedEnv.ICPDB_SERVICE_IDENTITY_JSON ?? "",
    serviceIdentityJsonFile: mergedEnv.ICPDB_SERVICE_IDENTITY_JSON_FILE ?? "",
    serviceIdentityType: mergedEnv.ICPDB_SERVICE_IDENTITY_TYPE ?? "auto",
    ...(identityPrincipal ? { identityPrincipal } : {}),
    ...(serviceIdentityPrincipal ? { serviceIdentityPrincipal } : {}),
    rootKey: mergedEnv.ICPDB_ROOT_KEY ?? "",
    params: [],
    paramsFilePath: "",
    statements: [],
    statementsFilePath: "",
    batchMode: "write",
    setupFilePath: "",
    setupMigrationsFilePath: "",
    maxRows: DEFAULT_MAX_ROWS,
    limit: DEFAULT_LIMIT,
    offset: 0,
    outputFormat: "json"
  };
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--url") {
      applyIdentityUrl(options, requireValue(args, index, value));
      index += 1;
    } else if (value === "--canister-id") {
      options.canisterId = requireValue(args, index, value);
      index += 1;
    } else if (value === "--database-id") {
      options.databaseId = databaseIdArg(requireValue(args, index, value));
      index += 1;
    } else if (value === "--network-url") {
      options.networkUrl = requireValue(args, index, value);
      index += 1;
    } else if (value === "--identity-pem") {
      options.identityPem = requireValue(args, index, value);
      index += 1;
    } else if (value === "--identity-pem-file") {
      options.identityPemFile = filePathArg(requireValue(args, index, value), "identity file");
      index += 1;
    } else if (value === "--identity-json") {
      options.identityJson = requireValue(args, index, value);
      index += 1;
    } else if (value === "--identity-json-file") {
      options.identityJsonFile = filePathArg(requireValue(args, index, value), "identity file");
      index += 1;
    } else if (value === "--identity-type") {
      options.identityType = parseIdentityType(requireValue(args, index, value));
      index += 1;
    } else if (value === "--service-identity-pem") {
      options.serviceIdentityPem = requireValue(args, index, value);
      index += 1;
    } else if (value === "--service-identity-pem-file") {
      options.serviceIdentityPemFile = filePathArg(requireValue(args, index, value), "service identity file");
      index += 1;
    } else if (value === "--service-identity-json") {
      options.serviceIdentityJson = requireValue(args, index, value);
      index += 1;
    } else if (value === "--service-identity-json-file") {
      options.serviceIdentityJsonFile = filePathArg(requireValue(args, index, value), "service identity file");
      index += 1;
    } else if (value === "--service-identity-type") {
      options.serviceIdentityType = parseIdentityType(requireValue(args, index, value));
      index += 1;
    } else if (value === "--root-key") {
      options.rootKey = requireValue(args, index, value);
      index += 1;
    } else if (value === "--env-file") {
      filePathArg(requireValue(args, index, value), "env file");
      index += 1;
    } else if (value === "--env-out") {
      options.envOutFile = filePathArg(requireValue(args, index, value), "env output file");
      index += 1;
    } else if (value === "--params") {
      options.params = parseJsonSqlArgs(requireValue(args, index, value), "params");
      index += 1;
    } else if (value === "--params-file") {
      options.paramsFilePath = filePathArg(requireValue(args, index, value), "params file");
      options.params = parseJsonSqlArgs(readFileSync(options.paramsFilePath, "utf8"), "params");
      index += 1;
    } else if (value === "--statement") {
      options.statements.push({ sql: requireValue(args, index, value), params: [] });
      index += 1;
    } else if (value === "--statements-file") {
      options.statementsFilePath = filePathArg(requireValue(args, index, value), "statements file");
      options.statements = parseSqlStatementsJson(readFileSync(options.statementsFilePath, "utf8"));
      index += 1;
    } else if (value === "--mode") {
      options.batchMode = parseSqlBatchMode(requireValue(args, index, value));
      index += 1;
    } else if (value === "--setup-file") {
      options.setupFilePath = filePathArg(requireValue(args, index, value), "setup file");
      index += 1;
    } else if (value === "--setup-migrations-file") {
      options.setupMigrationsFilePath = filePathArg(requireValue(args, index, value), "setup migrations file");
      index += 1;
    } else if (value === "--idempotency-key") {
      options.idempotencyKey = idempotencyKeyArg(requireValue(args, index, value));
      index += 1;
    } else if (value === "--expect-snapshot-hash") {
      options.expectedSnapshotHash = parseSnapshotHashHex(requireValue(args, index, value), "expect-snapshot-hash");
      index += 1;
    } else if (value === "--wait") {
      options.waitForRoutedOperation = true;
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
    } else if (value === "--") {
      positional.push(...args.slice(index + 1));
      break;
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
  const [command, databaseId, nextArg, ...rest] = positional;
  if (options.expectedSnapshotHash && command !== "restore") throw new Error("--expect-snapshot-hash is only valid for restore");
  if (command === "help") return { help: true, helpTopic: [databaseId, nextArg, ...rest].filter(Boolean).join(" ") };
  const builtCommand = buildIdentityCommand(command, databaseId, nextArg, rest, options, mergedEnv);
  assertSetupEnvNotIgnoredByDatabaseCommand(builtCommand, mergedEnv);
  assertEnvOutputCommand(builtCommand);
  return builtCommand;
}

export async function loadServiceIdentity(options, label = "identity") {
  assertSingleIdentitySecret(options, label);
  const fileLabel = `${label} file`;
  const json = options.identityJson || await readOptionalSecretText(options.identityJsonFile, fileLabel);
  if (json) return assertExpectedIdentityPrincipal(identityFromJson(json, options.identityType), options.identityPrincipal, label);
  const pem = options.identityPem ? options.identityPem.replaceAll("\\n", "\n") : await readOptionalSecretText(options.identityPemFile, fileLabel);
  if (pem) return assertExpectedIdentityPrincipal(Secp256k1KeyIdentity.fromPem(pem), options.identityPrincipal, label);
  const jsonFlag = label === "service identity" ? "service-identity-json-file" : "identity-json-file";
  const pemFlag = label === "service identity" ? "service-identity-pem-file" : "identity-pem-file";
  const envPrefix = label === "service identity" ? "ICPDB_SERVICE_IDENTITY" : "ICPDB_IDENTITY";
  throw new Error(`missing ${label}; pass --${pemFlag}, --${jsonFlag}, or set ${envPrefix}_*`);
}

function assertSingleIdentitySecret(options, label) {
  const sources = [
    ["identityJson", options.identityJson],
    ["identityJsonFile", options.identityJsonFile],
    ["identityPem", options.identityPem],
    ["identityPemFile", options.identityPemFile]
  ].filter(([_name, value]) => value !== undefined && value !== "");
  if (sources.length > 1) {
    throw new Error(`${label} must use exactly one secret source: ${sources.map(([name]) => name).join(", ")}`);
  }
}

export async function createIdentityActor(command, identity) {
  const canisterId = requiredConfig(command.canisterId, "canister ID", "ICPDB_CANISTER_ID");
  const principal = Principal.fromText(canisterId);
  const rootKey = command.rootKey ? hexToBytes(command.rootKey) : undefined;
  const agent = HttpAgent.createSync({ host: command.networkUrl, identity, rootKey, fetch: localReplicaFetchForHost(command.networkUrl) });
  if (isLocalHost(command.networkUrl) && !rootKey) await agent.fetchRootKey();
  return Actor.createActor(idlFactory, { agent, canisterId: principal });
}

function identityCliEnvFromArgs(args, env) {
  const defaultEnvFile = shouldReadDefaultIdentityEnvFile(args, env) ? DEFAULT_SERVICE_ENV_FILE : "";
  const inheritedEnvFile = env.ICPDB_ENV_FILE && !args.includes("--env-file")
    ? filePathArg(env.ICPDB_ENV_FILE, "env file")
    : "";
  const merged = inheritedEnvFile
    ? { ...readIdentityEnvFile(inheritedEnvFile), ...env }
    : defaultEnvFile
      ? { ...readIdentityEnvFile(defaultEnvFile), ...env }
      : { ...env };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--env-file") continue;
    const filePath = filePathArg(requireValue(args, index, "--env-file"), "env file");
    Object.assign(merged, readIdentityEnvFile(filePath));
    index += 1;
  }
  return merged;
}

function shouldReadDefaultIdentityEnvFile(args, env) {
  if (args.includes("--env-file") || env.ICPDB_ENV_FILE) return false;
  if (!existsSync(DEFAULT_SERVICE_ENV_FILE)) return false;
  const command = firstIdentityCommandArg(args);
  if (!command || command === "help" || command === "generate-identity" || command === "snapshot-info") return false;
  if (hasExplicitIdentitySecretArgs(args) || hasDirectIdentityEnv(env)) return false;
  return true;
}

function firstIdentityCommandArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") return args[index + 1] ?? "";
    if (value.startsWith("--")) {
      if (!isBooleanIdentityCliFlag(value)) index += 1;
      continue;
    }
    return value;
  }
  return "";
}

function isBooleanIdentityCliFlag(value) {
  return value === "--wait" || value === "--help" || value === "-h";
}

function hasExplicitIdentitySecretArgs(args) {
  const secretFlags = new Set([
    "--identity-pem",
    "--identity-pem-file",
    "--identity-json",
    "--identity-json-file",
    "--service-identity-pem",
    "--service-identity-pem-file",
    "--service-identity-json",
    "--service-identity-json-file"
  ]);
  return args.some((arg) => secretFlags.has(arg));
}

function hasDirectIdentityEnv(env) {
  return [
    "ICPDB_URL",
    "ICPDB_CANISTER_ID",
    "ICPDB_DATABASE_ID",
    "ICPDB_IDENTITY_PEM",
    "ICPDB_IDENTITY_PEM_FILE",
    "ICPDB_IDENTITY_JSON",
    "ICPDB_IDENTITY_JSON_FILE",
    "ICPDB_SERVICE_IDENTITY_PEM",
    "ICPDB_SERVICE_IDENTITY_PEM_FILE",
    "ICPDB_SERVICE_IDENTITY_JSON",
    "ICPDB_SERVICE_IDENTITY_JSON_FILE"
  ].some((name) => env[name] !== undefined && String(env[name]).trim().length > 0);
}

function readIdentityEnvFile(filePath) {
  assertIdentityEnvFileMode(filePath);
  return parseIdentityEnvFile(readFileSync(filePath, "utf8"), filePath);
}

function assertIdentityEnvFileMode(filePath) {
  assertOwnerOnlyFileMode(filePath, "service env file");
}

function assertOwnerOnlyFileMode(filePath, label) {
  const mode = statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`${label} must be owner-only (0600 or stricter): ${filePath} is ${modeToOctal(mode)}`);
  }
}

function modeToOctal(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function parseIdentityEnvFile(source, filePath) {
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
    parsed[key] = parseIdentityEnvValue(match[2].trim(), filePath, index + 1);
  }
  return parsed;
}

function parseIdentityEnvValue(source, filePath, lineNumber) {
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

function identityConnectionFromEnv(env) {
  const envUrl = optionalNonEmptyEnvValue(env, "ICPDB_URL");
  const envCanisterId = optionalNonEmptyEnvValue(env, "ICPDB_CANISTER_ID");
  const envDatabaseId = optionalNonEmptyEnvValue(env, "ICPDB_DATABASE_ID");
  const parsed = envUrl ? parseIcpdbDatabaseUrl(envUrl) : null;
  if (envCanisterId && parsed?.canisterId && envCanisterId !== parsed.canisterId) {
    throw new Error("ICPDB_CANISTER_ID does not match ICPDB_URL");
  }
  if (envDatabaseId && parsed?.databaseId && envDatabaseId !== parsed.databaseId) {
    throw new Error("ICPDB_DATABASE_ID does not match ICPDB_URL");
  }
  return {
    canisterId: envCanisterId ?? parsed?.canisterId ?? "",
    databaseId: envDatabaseId ?? parsed?.databaseId ?? ""
  };
}

function optionalNonEmptyEnvValue(env, key) {
  if (!Object.hasOwn(env, key) || env[key] === undefined) return undefined;
  const value = String(env[key]).trim();
  if (value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function applyIdentityUrl(options, url) {
  const parsed = parseIcpdbDatabaseUrl(url);
  options.canisterId = parsed.canisterId;
  options.databaseId = parsed.databaseId ? databaseIdArg(parsed.databaseId) : "";
}

function parseIcpdbDatabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`invalid ICPDB url: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.protocol !== "icpdb:") throw new Error("ICPDB url must use icpdb://");
  if (parsed.username || parsed.password) throw new Error("ICPDB url must not include username or password");
  if (parsed.port) throw new Error("ICPDB url must not include a port");
  if (parsed.search || parsed.hash) throw new Error("ICPDB url must not include query or fragment");
  if (!parsed.hostname) throw new Error("ICPDB url must include a canister id");
  const hasDatabasePath = parsed.pathname !== "" && parsed.pathname !== "/";
  if (hasDatabasePath && !/^\/[^/]+$/.test(parsed.pathname)) throw new Error("ICPDB url path must be /<database-id>");
  let databaseId;
  try {
    databaseId = hasDatabasePath ? decodeURIComponent(parsed.pathname.slice(1)) : undefined;
  } catch (error) {
    throw new Error(`invalid ICPDB url database id encoding: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    canisterId: parsed.hostname,
    databaseId
  };
}

function formatIcpdbDatabaseUrl(canisterId, databaseId) {
  return `icpdb://${requiredNonEmptyString(canisterId, "canisterId")}/${encodeURIComponent(requiredNonEmptyString(databaseId, "databaseId"))}`;
}

function connectionUrlOutput(command) {
  const url = formatIcpdbDatabaseUrl(command.canisterId, command.databaseId);
  const env = {
    ICPDB_CANISTER_ID: command.canisterId,
    ICPDB_DATABASE_ID: command.databaseId,
    ICPDB_URL: url
  };
  return {
    canister_id: command.canisterId,
    database_id: command.databaseId,
    url,
    env,
    env_lines: Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  };
}

async function inspectIdentityEnv(command, identity) {
  const setup = await inspectSetupEnv(command.setupEnv);
  const databaseId = command.databaseId || "";
  return {
    canister_id: command.canisterId,
    ...(databaseId ? { database_id: databaseId, connection_url: formatIcpdbDatabaseUrl(command.canisterId, databaseId) } : {}),
    ...(command.envUrl ? { url: command.envUrl } : {}),
    network_url: command.networkUrl,
    principal: identity.getPrincipal().toText(),
    identity_type: command.identityType,
    has_root_key: Boolean(command.rootKey),
    has_setup_sql: setup.hasSetupSql,
    setup_statement_count: setup.setupStatementCount,
    setup_migration_count: setup.setupMigrationCount
  };
}

async function inspectSetupEnv(env) {
  const setupSql = await setupEnvText(env.ICPDB_SETUP_SQL, env.ICPDB_SETUP_SQL_FILE, "ICPDB_SETUP_SQL", "ICPDB_SETUP_SQL_FILE");
  const setupStatements = await setupEnvText(env.ICPDB_SETUP_STATEMENTS, env.ICPDB_SETUP_STATEMENTS_FILE, "ICPDB_SETUP_STATEMENTS", "ICPDB_SETUP_STATEMENTS_FILE");
  const setupMigrations = await setupEnvText(env.ICPDB_SETUP_MIGRATIONS, env.ICPDB_SETUP_MIGRATIONS_FILE, "ICPDB_SETUP_MIGRATIONS", "ICPDB_SETUP_MIGRATIONS_FILE");
  return {
    hasSetupSql: setupSql !== undefined,
    setupStatementCount: setupStatements === undefined ? 0 : parseSqlStatementsJson(setupStatements).length,
    setupMigrationCount: setupMigrations === undefined ? 0 : parseMigrationsJson(setupMigrations).length
  };
}

async function setupEnvText(value, filePath, valueName, fileName) {
  if (value && filePath) throw new Error(`${valueName} and ${fileName} cannot both be set`);
  if (filePath) return readFile(filePath, "utf8");
  if (value === undefined || value === "") return undefined;
  return value;
}

export async function executeIdentityCommand(command, actor, identity) {
  if (command.generateIdentity) return generateServiceIdentity(command);
  if (command.snapshotInfo) return snapshotInfoIcpdb(command);
  if (command.connectionUrl) return connectionUrlOutput(command);
  if (command.inspectEnv) return inspectIdentityEnv(command, identity);
  if (command.principal) return { principal: identity.getPrincipal().toText() };
  if (command.health) return normalizeCanisterHealth(await actor.canister_health());
  if (command.createDatabase) {
    const databaseId = unwrapResult(await actor.create_database(), "create_database");
    try {
      const setup = await setupCreatedDatabase(command, actor, databaseId);
      if (command.outputFormat === "env") {
        const env = createdDatabaseEnv(command, databaseId, identity);
        return {
          database_id: databaseId,
          ...setup,
          env,
          env_lines: Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        };
      }
      return { database_id: databaseId, ...setup };
    } catch (error) {
      try {
        unwrapResult(await actor.delete_database(databaseId), "delete_database");
      } catch (_deleteError) {
        // Preserve the setup error; the DB was just created for this command.
      }
      throw error;
    }
  }
  if (command.databases) return unwrapResult(await actor.list_databases(), "list_databases").map(normalizeDatabaseSummary);
  if (command.grantMember) {
    unwrapResult(await actor.grant_database_access(command.databaseId, command.principalText, databaseRoleVariant(command.role)), "grant_database_access");
    return null;
  }
  if (command.grantService) {
    const serviceIdentity = await loadServiceIdentity(serviceIdentityOptions(command), "service identity");
    const principalText = serviceIdentity.getPrincipal().toText();
    unwrapResult(await actor.grant_database_access(command.databaseId, principalText, databaseRoleVariant(command.role)), "grant_database_access");
    return { database_id: command.databaseId, principal: principalText, role: command.role };
  }
  if (command.provisionService) {
    const generated = generatedServiceIdentity(command.serviceIdentityType);
    const principalText = generated.identity.getPrincipal().toText();
    unwrapResult(await actor.grant_database_access(command.databaseId, principalText, databaseRoleVariant(command.role)), "grant_database_access");
    return provisionedServiceIdentityOutput(command, generated.output);
  }
  if (command.provisionServiceDatabase) {
    const databaseId = unwrapResult(await actor.create_database(), "create_database");
    try {
      const setup = await setupCreatedDatabase(command, actor, databaseId);
      const generated = generatedServiceIdentity(command.serviceIdentityType);
      const principalText = generated.identity.getPrincipal().toText();
      unwrapResult(await actor.grant_database_access(databaseId, principalText, databaseRoleVariant(command.role)), "grant_database_access");
      return { ...provisionedServiceIdentityOutput({ ...command, databaseId }, generated.output), ...setup };
    } catch (error) {
      try {
        unwrapResult(await actor.delete_database(databaseId), "delete_database");
      } catch (_deleteError) {
        // Preserve the setup/grant error; the DB was just created for this command.
      }
      throw error;
    }
  }
  if (command.revokeMember) {
    unwrapResult(await actor.revoke_database_access(command.databaseId, command.principalText), "revoke_database_access");
    return null;
  }
  if (command.members) return unwrapResult(await actor.list_database_members(command.databaseId), "list_database_members").map(normalizeDatabaseMember);
  if (command.archive) return archiveIcpdb(command, actor);
  if (command.restore) return restoreIcpdb(command, actor);
  if (command.archiveCancel) {
    unwrapResult(await actor.cancel_database_archive(command.databaseId), "cancel_database_archive");
    return null;
  }
  if (command.deleteDatabase) {
    unwrapResult(await actor.delete_database(command.databaseId), "delete_database");
    return null;
  }
  if (command.endpoint === "sql_query") {
    const response = normalizeSqlResponse(unwrapResult(await actor.sql_query(sqlRequest(command)), "sql_query"));
    return command.scalar ? sqlScalarResult(response) : response;
  }
  if (command.endpoint === "sql_execute") {
    return maybeWaitSqlResponse(command, actor, normalizeSqlResponse(unwrapResult(await actor.sql_execute(sqlRequest(command)), "sql_execute")));
  }
  if (command.endpoint === "sql_batch") {
    return maybeWaitSqlBatchResponse(command, actor, unwrapResult(await actor.sql_batch(sqlBatchRequest(command)), "sql_batch").map(normalizeSqlResponse));
  }
  if (command.endpoint === "sql_batch_read") return sqlBatchRead(command, actor);
  if (command.tables) {
    const tables = unwrapResult(await actor.list_tables(command.databaseId), "list_tables").map(normalizeDatabaseTable);
    return command.viewsOnly ? tables.filter((table) => table.object_type === "view") : tables;
  }
  if (command.inspect) return inspectIcpdb(command, actor);
  if (command.describe) return normalizeTableDescription(unwrapResult(await actor.describe_table(command.databaseId, command.tableName), "describe_table"));
  if (command.tableColumns) return tableColumnsIcpdb(command, actor);
  if (command.tableIndexes) return tableIndexesIcpdb(command, actor);
  if (command.tableTriggers) return tableTriggersIcpdb(command, actor);
  if (command.tableForeignKeys) return tableForeignKeysIcpdb(command, actor);
  if (command.schema) return schemaIcpdb(command, actor);
  if (command.databaseStatus) return statusIcpdb(command, actor, identity);
  if (command.stats) return statsIcpdb(command, actor);
  if (command.preview) return normalizeTablePreview(unwrapResult(await actor.preview_table(tablePreviewRequest(command)), "preview_table"));
  if (command.dump) return dumpSqlIcpdb(command, actor);
  if (command.load) return loadSqlDumpIcpdb(command, actor);
  if (command.script) return executeSqlScriptIcpdb(command, actor);
  if (command.migrate) return migrateIcpdb(command, actor);
  if (command.usage) return normalizeDatabaseUsage(unwrapResult(await actor.get_usage(command.databaseId), "get_usage"));
  if (command.usageEvents) return unwrapResult(await actor.get_usage_event_summaries(command.databaseId), "get_usage_event_summaries").map(normalizeDatabaseUsageEventSummary);
  if (command.placement) return placementIcpdb(command, actor);
  if (command.placements) return unwrapResult(await actor.list_database_placements(), "list_database_placements").map(normalizeDatabaseShardPlacement);
  if (command.allPlacements) return unwrapResult(await actor.list_all_database_placements(), "list_all_database_placements").map(normalizeDatabaseShardPlacement);
  if (command.shards) return unwrapResult(await actor.list_database_shards(), "list_database_shards").map(normalizeDatabaseShardInfo);
  if (command.shardStatus) return normalizeDatabaseShardStatus(unwrapResult(
    await actor.get_database_shard_status({ database_canister_id: command.databaseCanisterId }),
    "get_database_shard_status"
  ));
  if (command.shardTopUp) return normalizeDatabaseShardInfo(unwrapResult(
    await actor.top_up_database_shard({ database_canister_id: command.databaseCanisterId, cycles: command.cycles }),
    "top_up_database_shard"
  ));
  if (command.shardMaintain) return normalizeDatabaseShardMaintenanceReport(unwrapResult(
    await actor.maintain_database_shards({
      min_available_slots: command.minAvailableSlots,
      min_cycles_balance: command.minCyclesBalance,
      top_up_cycles: command.topUpCycles,
      max_new_shards: command.maxNewShards,
      new_shard_max_databases: command.newShardMaxDatabases,
      new_shard_initial_cycles: command.newShardInitialCycles
    }),
    "maintain_database_shards"
  ));
  if (command.shardMigrate) return normalizeDatabaseShardPlacement(unwrapResult(
    await actor.migrate_database_to_shard({
      database_id: command.databaseId,
      database_canister_id: command.databaseCanisterId
    }),
    "migrate_database_to_shard"
  ));
  if (command.shardOperations) return unwrapResult(await actor.list_shard_operations(), "list_shard_operations").map(normalizeShardOperationInfo);
  if (command.shardReconcile) return normalizeShardOperationInfo(unwrapResult(
    await actor.reconcile_shard_operation({
      operation_id: command.operationId,
      status: routedOperationStatusVariant(command.status),
      error: option(command.error)
    }),
    "reconcile_shard_operation"
  ));
  if (command.operation) return normalizeRoutedOperationInfo(unwrapResult(
    await actor.get_routed_operation({
      database_id: command.databaseId,
      operation_id: command.operationId
    }),
    "get_routed_operation"
  ));
  if (command.operationReconcile) return normalizeRoutedOperationInfo(unwrapResult(
    await actor.reconcile_routed_operation({
      database_id: command.databaseId,
      operation_id: command.operationId
    }),
    "reconcile_routed_operation"
  ));
  throw new Error(`unknown command: ${command.command}`);
}

function buildIdentityCommand(command, databaseId, nextArg, rest, options, mergedEnv) {
  if (!KNOWN_IDENTITY_COMMANDS.has(command)) throw new Error(`unknown command: ${command}`);
  if (command === "generate-identity") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return { generateIdentity: true, ...options };
  }
  if (command === "principal") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return { principal: true, ...options };
  }
  if (command === "snapshot-info") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 1);
    return {
      snapshotInfo: true,
      command,
      outputFormat: options.outputFormat,
      ...(options.envOutFile ? { envOutFile: options.envOutFile } : {}),
      filePath: filePathArg(databaseId)
    };
  }
  if (command === "inspect-env") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return {
      inspectEnv: true,
      command,
      canisterId: requiredConfig(options.canisterId, "canister ID", "ICPDB_CANISTER_ID"),
      databaseId: options.databaseId,
      networkUrl: requiredConfig(options.networkUrl, "network URL", "ICPDB_NETWORK_URL"),
      outputFormat: options.outputFormat,
      identityPem: options.identityPem,
      identityPemFile: options.identityPemFile,
      identityJson: options.identityJson,
      identityJsonFile: options.identityJsonFile,
      identityType: options.identityType,
      ...(options.identityPrincipal ? { identityPrincipal: options.identityPrincipal } : {}),
      rootKey: options.rootKey,
      envUrl: mergedEnv.ICPDB_URL ?? "",
      setupEnv: {
        ICPDB_SETUP_SQL: mergedEnv.ICPDB_SETUP_SQL,
        ICPDB_SETUP_SQL_FILE: mergedEnv.ICPDB_SETUP_SQL_FILE,
        ICPDB_SETUP_STATEMENTS: mergedEnv.ICPDB_SETUP_STATEMENTS,
        ICPDB_SETUP_STATEMENTS_FILE: mergedEnv.ICPDB_SETUP_STATEMENTS_FILE,
        ICPDB_SETUP_MIGRATIONS: mergedEnv.ICPDB_SETUP_MIGRATIONS,
        ICPDB_SETUP_MIGRATIONS_FILE: mergedEnv.ICPDB_SETUP_MIGRATIONS_FILE
      }
    };
  }
  const base = {
    command,
    canisterId: requiredConfig(options.canisterId, "canister ID", "ICPDB_CANISTER_ID"),
    networkUrl: requiredConfig(options.networkUrl, "network URL", "ICPDB_NETWORK_URL"),
    outputFormat: options.outputFormat,
    identityPem: options.identityPem,
    identityPemFile: options.identityPemFile,
    identityJson: options.identityJson,
    identityJsonFile: options.identityJsonFile,
    identityType: options.identityType,
    ...(options.identityPrincipal ? { identityPrincipal: options.identityPrincipal } : {}),
    rootKey: options.rootKey,
    ...(options.envOutFile ? { envOutFile: options.envOutFile } : {})
  };
  if (command === "create-db") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    assertCreateCommandHasNoDatabaseId(command, options);
    return {
      createDatabase: true,
      ...base,
      statements: options.statements,
      statementsFilePath: options.statementsFilePath,
      setupFilePath: options.setupFilePath,
      setupMigrationsFilePath: options.setupMigrationsFilePath,
      maxRows: options.maxRows
    };
  }
  if (command === "url") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 1);
    return { connectionUrl: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "health") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return { health: true, ...base };
  }
  if (command === "databases") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return { databases: true, ...base };
  }
  if (command === "grant-member") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 3, 2);
    const memberArgs = grantMemberArgs(databaseId, nextArg, rest, options);
    return {
      grantMember: true,
      ...base,
      databaseId: memberArgs.databaseId,
      principalText: memberArgs.principalText,
      role: memberArgs.role
    };
  }
  if (command === "grant-service") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const serviceGrantArgs = roleCommandArgs(databaseId, nextArg, options);
    return {
      grantService: true,
      ...base,
      databaseId: serviceGrantArgs.databaseId,
      role: serviceGrantArgs.role,
      serviceIdentityPem: options.serviceIdentityPem,
      serviceIdentityPemFile: options.serviceIdentityPemFile,
      serviceIdentityJson: options.serviceIdentityJson,
      serviceIdentityJsonFile: options.serviceIdentityJsonFile,
      serviceIdentityType: options.serviceIdentityType,
      ...(options.serviceIdentityPrincipal ? { serviceIdentityPrincipal: options.serviceIdentityPrincipal } : {})
    };
  }
  if (command === "provision-service") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const provisionArgs = roleCommandArgs(databaseId, nextArg, options);
    return {
      provisionService: true,
      ...base,
      databaseId: provisionArgs.databaseId,
      role: provisionArgs.role,
      serviceIdentityType: options.serviceIdentityType
    };
  }
  if (command === "provision-service-db") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 1);
    assertCreateCommandHasNoDatabaseId(command, options);
    return {
      provisionServiceDatabase: true,
      ...base,
      role: parseDatabaseRole(requiredArg(databaseId, "role")),
      serviceIdentityType: options.serviceIdentityType,
      statements: options.statements,
      statementsFilePath: options.statementsFilePath,
      setupFilePath: options.setupFilePath,
      setupMigrationsFilePath: options.setupMigrationsFilePath,
      maxRows: options.maxRows
    };
  }
  if (command === "revoke-member") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const memberArgs = memberPrincipalArgs(databaseId, nextArg, options);
    return {
      revokeMember: true,
      ...base,
      databaseId: memberArgs.databaseId,
      principalText: memberArgs.principalText
    };
  }
  if (command === "members") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { members: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "archive") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const fileArgs = fileCommandArgs(databaseId, nextArg, options);
    return { archive: true, ...base, databaseId: fileArgs.databaseId, filePath: fileArgs.filePath };
  }
  if (command === "restore") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const fileArgs = fileCommandArgs(databaseId, nextArg, options);
    return {
      restore: true,
      ...base,
      databaseId: fileArgs.databaseId,
      filePath: fileArgs.filePath,
      expectedSnapshotHash: options.expectedSnapshotHash ?? ""
    };
  }
  if (command === "archive-cancel") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { archiveCancel: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "delete-db") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { deleteDatabase: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "query" || command === "execute" || command === "sql" || command === "scalar") {
    const sqlArgs = sqlCommandArgs(databaseId, nextArg, rest, options);
    const endpoint = sqlCommandEndpoint(command, sqlArgs.sql);
    if (options.idempotencyKey && endpoint === "sql_query") {
      throw new Error("--idempotency-key is only valid for write SQL");
    }
    if (options.waitForRoutedOperation && endpoint === "sql_query") {
      throw new Error("--wait is only valid for write SQL");
    }
    return {
      ...base,
      endpoint,
      ...(command === "scalar" ? { scalar: true } : {}),
      databaseId: sqlArgs.databaseId,
      sql: sqlArgs.sql,
      params: options.params,
      paramsFilePath: options.paramsFilePath,
      maxRows: command === "scalar" ? 1 : options.maxRows,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
    };
  }
  if (command === "shell") {
    const shellArgs = shellCommandArgs(databaseId, nextArg, rest, options);
    return {
      shell: true,
      ...base,
      databaseId: shellArgs.databaseId,
      shellSql: shellArgs.shellSql,
      maxRows: options.maxRows,
      limit: options.limit,
      offset: options.offset,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
    };
  }
  if (command === "batch" || command === "transaction") {
    const batchArgs = batchCommandArgs(databaseId, nextArg, options);
    assertSqlBatchModeOptions(batchArgs.statements, options);
    return {
      ...base,
      endpoint: options.batchMode === "read" ? "sql_batch_read" : "sql_batch",
      transaction: command === "transaction",
      databaseId: batchArgs.databaseId,
      statements: batchArgs.statements,
      statementsFilePath: options.statementsFilePath,
      batchMode: options.batchMode,
      maxRows: options.maxRows,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
    };
  }
  if (command === "tables") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { tables: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "views") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { tables: true, viewsOnly: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "inspect") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const inspectArgs = optionalTableCommandArgs(databaseId, nextArg, options);
    return {
      inspect: true,
      ...base,
      databaseId: inspectArgs.databaseId,
      tableName: inspectArgs.tableName,
      limit: options.limit,
      offset: options.offset
    };
  }
  if (command === "describe") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const tableArgs = tableCommandArgs(databaseId, nextArg, options);
    return { describe: true, ...base, databaseId: tableArgs.databaseId, tableName: tableArgs.tableName };
  }
  if (command === "columns") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const tableArgs = tableCommandArgs(databaseId, nextArg, options);
    return { tableColumns: true, ...base, databaseId: tableArgs.databaseId, tableName: tableArgs.tableName };
  }
  if (command === "indexes") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const tableArgs = tableCommandArgs(databaseId, nextArg, options);
    return { tableIndexes: true, ...base, databaseId: tableArgs.databaseId, tableName: tableArgs.tableName };
  }
  if (command === "triggers") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const tableArgs = tableCommandArgs(databaseId, nextArg, options);
    return { tableTriggers: true, ...base, databaseId: tableArgs.databaseId, tableName: tableArgs.tableName };
  }
  if (command === "foreign-keys") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const tableArgs = tableCommandArgs(databaseId, nextArg, options);
    return { tableForeignKeys: true, ...base, databaseId: tableArgs.databaseId, tableName: tableArgs.tableName };
  }
  if (command === "schema") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const schemaArgs = optionalTableCommandArgs(databaseId, nextArg, options);
    return { schema: true, ...base, databaseId: schemaArgs.databaseId, tableName: schemaArgs.tableName };
  }
  if (command === "status") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { databaseStatus: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "stats") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { stats: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "preview") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const tableArgs = tableCommandArgs(databaseId, nextArg, options);
    return {
      preview: true,
      ...base,
      databaseId: tableArgs.databaseId,
      tableName: tableArgs.tableName,
      limit: options.limit,
      offset: options.offset
    };
  }
  if (command === "dump") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const dumpArgs = optionalTableCommandArgs(databaseId, nextArg, options);
    return { dump: true, ...base, databaseId: dumpArgs.databaseId, tableName: dumpArgs.tableName, limit: options.limit };
  }
  if (command === "load") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const fileArgs = fileCommandArgs(databaseId, nextArg, options);
    assertSqlFileModeOptions(options, "load");
    return {
      load: true,
      ...base,
      databaseId: fileArgs.databaseId,
      filePath: fileArgs.filePath,
      ...(options.batchMode === "read" ? { batchMode: "read" } : {}),
      maxRows: options.maxRows,
      ...(options.batchMode === "write" && options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.batchMode === "write" && options.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
    };
  }
  if (command === "script") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const fileArgs = fileCommandArgs(databaseId, nextArg, options);
    assertSqlFileModeOptions(options, "script");
    return {
      script: true,
      ...base,
      databaseId: fileArgs.databaseId,
      filePath: fileArgs.filePath,
      ...(options.batchMode === "read" ? { batchMode: "read" } : {}),
      maxRows: options.maxRows,
      ...(options.batchMode === "write" && options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.batchMode === "write" && options.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
    };
  }
  if (command === "migrate") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const fileArgs = fileCommandArgs(databaseId, nextArg, options);
    return {
      migrate: true,
      ...base,
      databaseId: fileArgs.databaseId,
      filePath: fileArgs.filePath,
      maxRows: options.maxRows,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
    };
  }
  if (command === "usage") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { usage: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "usage-events") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { usageEvents: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "placement") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 1, 0);
    return { placement: true, ...base, databaseId: databaseIdFromArgOrEnv(databaseId, options) };
  }
  if (command === "placements") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return { placements: true, ...base };
  }
  if (command === "all-placements") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return { allPlacements: true, ...base };
  }
  if (command === "shards") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return { shards: true, ...base };
  }
  if (command === "shard-status") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 1);
    return { shardStatus: true, ...base, databaseCanisterId: databaseCanisterIdArg(databaseId) };
  }
  if (command === "shard-top-up") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 2);
    return {
      shardTopUp: true,
      ...base,
      databaseCanisterId: databaseCanisterIdArg(databaseId),
      cycles: parseNatBigInt(requiredArg(nextArg, "cycles"), "cycles")
    };
  }
  if (command === "shard-maintain") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 6);
    return {
      shardMaintain: true,
      ...base,
      minAvailableSlots: parseNatBigInt(requiredArg(databaseId, "min_available_slots"), "min_available_slots"),
      minCyclesBalance: parseNatBigInt(requiredArg(nextArg, "min_cycles_balance"), "min_cycles_balance"),
      topUpCycles: parseNatBigInt(requiredArg(rest[0], "top_up_cycles"), "top_up_cycles"),
      maxNewShards: parseNat16(requiredArg(rest[1], "max_new_shards"), "max_new_shards"),
      newShardMaxDatabases: parseNat16(requiredArg(rest[2], "new_shard_max_databases"), "new_shard_max_databases"),
      newShardInitialCycles: parseNatBigInt(requiredArg(rest[3], "new_shard_initial_cycles"), "new_shard_initial_cycles")
    };
  }
  if (command === "shard-migrate") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 2);
    return {
      shardMigrate: true,
      ...base,
      databaseId: databaseIdArg(databaseId),
      databaseCanisterId: databaseCanisterIdArg(nextArg)
    };
  }
  if (command === "shard-ops") {
    assertPositionalCount(command, [databaseId, nextArg, ...rest], 0);
    return { shardOperations: true, ...base };
  }
  if (command === "shard-reconcile") {
    const reconcileArgs = shardReconcileArgs(databaseId, nextArg, rest);
    return {
      shardReconcile: true,
      ...base,
      status: reconcileArgs.status,
      operationId: reconcileArgs.operationId,
      error: reconcileArgs.error
    };
  }
  if (command === "operation") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const operationArgs = routedOperationCommandArgs(databaseId, nextArg, options);
    return {
      operation: true,
      ...base,
      databaseId: operationArgs.databaseId,
      operationId: operationArgs.operationId
    };
  }
  if (command === "operation-reconcile") {
    assertDatabasePositionalCount(command, [databaseId, nextArg, ...rest], options, 2, 1);
    const operationArgs = routedOperationCommandArgs(databaseId, nextArg, options);
    return {
      operationReconcile: true,
      ...base,
      databaseId: operationArgs.databaseId,
      operationId: operationArgs.operationId
    };
  }
  throw new Error(`unknown command: ${command}`);
}

const KNOWN_IDENTITY_COMMANDS = new Set([
  "all-placements",
  "archive",
  "archive-cancel",
  "batch",
  "columns",
  "create-db",
  "databases",
  "delete-db",
  "describe",
  "dump",
  "execute",
  "foreign-keys",
  "generate-identity",
  "grant-member",
  "grant-service",
  "health",
  "indexes",
  "inspect",
  "inspect-env",
  "load",
  "members",
  "migrate",
  "operation",
  "operation-reconcile",
  "placement",
  "placements",
  "preview",
  "principal",
  "provision-service",
  "provision-service-db",
  "query",
  "restore",
  "revoke-member",
  "scalar",
  "schema",
  "script",
  "shard-maintain",
  "shard-migrate",
  "shard-ops",
  "shard-reconcile",
  "shard-status",
  "shard-top-up",
  "shards",
  "shell",
  "snapshot-info",
  "sql",
  "stats",
  "status",
  "tables",
  "transaction",
  "triggers",
  "url",
  "usage",
  "usage-events",
  "views"
]);

function assertPositionalCount(command, args, max) {
  const count = args.filter((value) => value !== undefined).length;
  if (count <= max) return;
  if (max === 0) throw new Error(`${command} accepts no positional arguments`);
  throw new Error(`${command} accepts at most ${max} positional argument${max === 1 ? "" : "s"}`);
}

function assertDatabasePositionalCount(command, args, options, explicitMax, omittedMax) {
  assertPositionalCount(command, args, options.databaseId ? omittedMax : explicitMax);
}

function assertEnvOutputCommand(command) {
  if (command.outputFormat !== "env" && !command.envOutFile) return;
  if ((command.archive || command.snapshotInfo) && command.outputFormat === "env" && !command.envOutFile) return;
  if (
    command.generateIdentity ||
    command.createDatabase ||
    command.connectionUrl ||
    command.provisionService ||
    command.provisionServiceDatabase
  ) {
    return;
  }
  throw new Error("--format env and --env-out are only valid for generate-identity, create-db, url, provision-service, provision-service-db, archive, or snapshot-info");
}

function assertSetupEnvNotIgnoredByDatabaseCommand(command, env) {
  if (command.inspectEnv || !command.databaseId || !hasIdentitySetupEnv(env)) return;
  throw new Error("ICPDB_SETUP_* is only used when creating a database; DB-bearing CLI commands must use script, batch, or migrate for existing database setup");
}

function hasIdentitySetupEnv(env) {
  return [
    "ICPDB_SETUP_SQL",
    "ICPDB_SETUP_SQL_FILE",
    "ICPDB_SETUP_STATEMENTS",
    "ICPDB_SETUP_STATEMENTS_FILE",
    "ICPDB_SETUP_MIGRATIONS",
    "ICPDB_SETUP_MIGRATIONS_FILE"
  ].some((name) => env[name] !== undefined && String(env[name]).trim().length > 0);
}

function assertCreateCommandHasNoDatabaseId(command, options) {
  if (!options.databaseId) return;
  throw new Error(`${command} creates a new database; omit database id from --url, ICPDB_URL, --database-id, and ICPDB_DATABASE_ID`);
}

function databaseIdFromArgOrEnv(databaseId, options) {
  if (databaseId !== undefined) return databaseIdArg(databaseId);
  return requiredConfig(options.databaseId, "database ID", "ICPDB_DATABASE_ID");
}

function databaseIdFromEnv(options) {
  return requiredConfig(options.databaseId, "database ID", "ICPDB_DATABASE_ID");
}

function sqlCommandArgs(databaseId, nextArg, rest, options) {
  if (options.databaseId && databaseId && nextArg === undefined) {
    return {
      databaseId: databaseIdFromEnv(options),
      sql: databaseId
    };
  }
  if (options.databaseId && databaseId && isSqlStart(databaseId)) {
    return {
      databaseId: databaseIdFromEnv(options),
      sql: [databaseId, ...(nextArg === undefined ? [] : [nextArg]), ...rest].join(" ")
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    sql: [requiredArg(nextArg, "sql"), ...rest].join(" ")
  };
}

function shellCommandArgs(databaseId, nextArg, rest, options) {
  if (options.databaseId && databaseId && nextArg === undefined) {
    return {
      databaseId: databaseIdFromEnv(options),
      shellSql: databaseId
    };
  }
  if (options.databaseId && databaseId && (databaseId.trim().startsWith(".") || isSqlStart(databaseId))) {
    return {
      databaseId: databaseIdFromEnv(options),
      shellSql: [databaseId, ...(nextArg === undefined ? [] : [nextArg]), ...rest].join(" ")
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    shellSql: nextArg === undefined ? "" : [nextArg, ...rest].join(" ")
  };
}

function batchCommandArgs(databaseId, nextArg, options) {
  if (options.statements.length > 0) {
    return {
      databaseId: databaseIdFromArgOrEnv(databaseId, options),
      statements: options.statements
    };
  }
  if (options.databaseId && databaseId && databaseId.trim().startsWith("[")) {
    return {
      databaseId: databaseIdFromEnv(options),
      statements: parseSqlStatementsJson(databaseId)
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    statements: parseSqlStatementsJson(requiredArg(nextArg, "statements_json"))
  };
}

function assertSqlBatchModeOptions(statements, options) {
  if (options.batchMode !== "read") return;
  if (options.idempotencyKey) throw new Error("--idempotency-key is only valid for write batch");
  if (options.waitForRoutedOperation) throw new Error("--wait is only valid for write batch");
  statements.forEach((statement, index) => {
    if (!isReadSql(statement.sql)) {
      throw new Error(`read batch statement ${index + 1} is not read-only`);
    }
  });
}

function assertSqlFileModeOptions(options, label) {
  if (options.batchMode !== "read") return;
  if (options.idempotencyKey) throw new Error(`--idempotency-key is only valid for write ${label}`);
  if (options.waitForRoutedOperation) throw new Error(`--wait is only valid for write ${label}`);
}

function tableCommandArgs(databaseId, nextArg, options) {
  if (options.databaseId && nextArg === undefined) {
    return {
      databaseId: databaseIdFromEnv(options),
      tableName: tableNameArg(databaseId)
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    tableName: tableNameArg(nextArg)
  };
}

function optionalTableCommandArgs(databaseId, nextArg, options) {
  if (options.databaseId) {
    if (databaseId === undefined) return { databaseId: databaseIdFromEnv(options), tableName: null };
    if (nextArg === undefined) return { databaseId: databaseIdFromEnv(options), tableName: tableNameArg(databaseId) };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    tableName: optionalTableNameArg(nextArg)
  };
}

function fileCommandArgs(databaseId, nextArg, options) {
  if (options.databaseId && nextArg === undefined) {
    return {
      databaseId: databaseIdFromEnv(options),
      filePath: filePathArg(databaseId)
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    filePath: filePathArg(nextArg)
  };
}

function roleCommandArgs(databaseId, nextArg, options) {
  if (options.databaseId && nextArg === undefined) {
    return {
      databaseId: databaseIdFromEnv(options),
      role: parseDatabaseRole(requiredArg(databaseId, "role"))
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    role: parseDatabaseRole(requiredArg(nextArg, "role"))
  };
}

function grantMemberArgs(databaseId, nextArg, rest, options) {
  if (options.databaseId && rest.length === 0) {
    return {
      databaseId: databaseIdFromEnv(options),
      principalText: grantablePrincipal(requiredArg(databaseId, "principal")),
      role: parseDatabaseRole(requiredArg(nextArg, "role"))
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    principalText: grantablePrincipal(requiredArg(nextArg, "principal")),
    role: parseDatabaseRole(requiredArg(rest[0], "role"))
  };
}

function memberPrincipalArgs(databaseId, nextArg, options) {
  if (options.databaseId && nextArg === undefined) {
    return {
      databaseId: databaseIdFromEnv(options),
      principalText: memberPrincipal(requiredArg(databaseId, "principal"))
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    principalText: memberPrincipal(requiredArg(nextArg, "principal"))
  };
}

function routedOperationCommandArgs(databaseId, nextArg, options) {
  if (options.databaseId && nextArg === undefined) {
    return {
      databaseId: databaseIdFromEnv(options),
      operationId: operationIdArg(databaseId)
    };
  }
  return {
    databaseId: databaseIdFromArgOrEnv(databaseId, options),
    operationId: operationIdArg(nextArg)
  };
}

function shardReconcileArgs(statusArg, operationArg, rest) {
  const status = parseReconcileStatus(requiredArg(statusArg, "status"));
  const failureReason = rest.join(" ");
  if (status === "applied" && failureReason) {
    throw new Error("failure_reason is only valid when shard-reconcile status is failed");
  }
  return {
    status,
    operationId: operationIdArg(operationArg),
    error: status === "failed" ? requiredArg(failureReason || undefined, "failure_reason") : null
  };
}

function isSqlStart(value) {
  return /^(?:with|select|insert|update|delete|replace|create|alter|drop|pragma|begin|commit|rollback|explain|vacuum|attach|detach|analyze|reindex)\b/i.test(value.trim());
}

function sqlCommandEndpoint(command, sql) {
  if (command === "query") return "sql_query";
  if (command === "scalar") return "sql_query";
  if (command === "execute") return "sql_execute";
  return isReadSql(sql) ? "sql_query" : "sql_execute";
}

function identityShellSqlUsageLines() {
  return [
    "  SELECT, WITH read CTEs, read-only PRAGMA, and EXPLAIN run as read queries.",
    "  Other SQL statements run as writes.",
    "  Shell write SQL auto-generates an idempotency key for remote writes.",
    "  Pass --idempotency-key before shell to set the generated key prefix."
  ];
}

export function identityShellUsage(topic = "") {
  const command = topic.trim().replace(/^\./, "");
  const lines = [
    "Shell commands:",
    "  .help",
    "  .help <command>",
    "  .help sql",
    "Preflight commands:",
    "  .principal",
    "  .health",
    "Database inspection commands:",
    "  .url",
    "  .tables",
    "  .views",
    "  .stats",
    "  .describe <table_name>",
    "  .columns <table_name>",
    "  .indexes <table_name>",
    "  .triggers <table_name>",
    "  .foreign-keys <table_name>",
    "  .schema [table_name]",
    "  .preview <table_name> [limit] [offset]",
    "  .inspect [table_name] [limit] [offset]",
    "  .dump [table_name]",
    "  .load <file|->",
    "  .script <file|->",
    "  .migrate <file|->",
    "  # .load, .script, and .migrate auto-generate idempotency keys for remote writes.",
    "Account and lifecycle commands:",
    "  .status",
    "  .usage",
    "  .placement",
    "  .operation <operation_id>",
    "  .usage-events",
    "  .members",
    "  .grant-member <principal> <reader|writer|owner>",
    "  .revoke-member <principal>",
    "  .delete-db",
    "  .archive <file>",
    "  .snapshot-info <file>",
    "  .restore <file> [expected_sha256]",
    "  .archive-cancel",
    "Navigation commands:",
    "  .quit",
    "Argument quoting:",
    "  Table, operation, member, and file arguments accept single quotes, double quotes, and backslash escaping.",
    "SQL:",
    ...identityShellSqlUsageLines()
  ];
  if (!command) return lines.join("\n");
  if (command === "sql") return ["SQL:", ...identityShellSqlUsageLines()].join("\n");
  const matches = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed === `.${command}` || trimmed.startsWith(`.${command} `);
  });
  if (matches.length === 0) throw new Error(`unknown shell help command: ${topic}`);
  return ["Shell commands:", ...matches].join("\n");
}

export function identityShellLineCommand(line, context) {
  const source = line.trim();
  if (!source) return null;
  if (source === ".quit" || source === ".exit") return { quit: true };
  if (source === ".help") return { help: true, helpTopic: "" };
  if (source.startsWith(".help ")) return { help: true, helpTopic: source.slice(".help ".length).trim() };
  if (source === ".principal") return { principal: true, ...context };
  if (source === ".health") return { health: true, ...context };
  if (source === ".url") return { connectionUrl: true, ...context };
  if (source === ".tables") return { tables: true, ...context };
  if (source === ".views") return { tables: true, viewsOnly: true, ...context };
  if (source === ".stats") return { stats: true, ...context };
  if (source === ".status") return { databaseStatus: true, ...context };
  if (source === ".usage") return { usage: true, ...context };
  if (source === ".usage-events") return { usageEvents: true, ...context };
  if (source === ".placement") return { placement: true, ...context };
  if (source === ".members") return { members: true, ...context };
  if (source === ".grant-member" || source.startsWith(".grant-member ")) return grantMemberShellCommand(source, context);
  if (source === ".revoke-member" || source.startsWith(".revoke-member ")) return revokeMemberShellCommand(source, context);
  if (source === ".schema") return { schema: true, tableName: null, ...context };
  if (source.startsWith(".schema ")) return { schema: true, tableName: optionalTableNameArg(optionalShellArg(source, ".schema")), ...context };
  if (source === ".describe" || source.startsWith(".describe ")) return { describe: true, tableName: tableNameArg(requiredShellArg(source, ".describe")), ...context };
  if (source === ".columns" || source.startsWith(".columns ")) return { tableColumns: true, tableName: tableNameArg(requiredShellArg(source, ".columns")), ...context };
  if (source === ".indexes" || source.startsWith(".indexes ")) return { tableIndexes: true, tableName: tableNameArg(requiredShellArg(source, ".indexes")), ...context };
  if (source === ".triggers" || source.startsWith(".triggers ")) return { tableTriggers: true, tableName: tableNameArg(requiredShellArg(source, ".triggers")), ...context };
  if (source === ".foreign-keys" || source.startsWith(".foreign-keys ")) return { tableForeignKeys: true, tableName: tableNameArg(requiredShellArg(source, ".foreign-keys")), ...context };
  if (source === ".preview" || source.startsWith(".preview ")) return previewShellCommand(source, context);
  if (source === ".inspect") return { inspect: true, tableName: null, ...context };
  if (source.startsWith(".inspect ")) return inspectShellCommand(source, context);
  if (source === ".dump") return { dump: true, tableName: null, ...context };
  if (source.startsWith(".dump ")) return { dump: true, tableName: optionalTableNameArg(optionalShellArg(source, ".dump")), ...context };
  if (source === ".load" || source.startsWith(".load ")) return fileShellCommand(source, context, ".load", "load");
  if (source === ".script" || source.startsWith(".script ")) return fileShellCommand(source, context, ".script", "script");
  if (source === ".migrate" || source.startsWith(".migrate ")) return fileShellCommand(source, context, ".migrate", "migrate");
  if (source === ".operation" || source.startsWith(".operation ")) return { operation: true, operationId: operationIdArg(requiredShellArg(source, ".operation")), ...context };
  if (source === ".archive" || source.startsWith(".archive ")) return archiveShellCommand(source, context);
  if (source === ".snapshot-info" || source.startsWith(".snapshot-info ")) return snapshotInfoShellCommand(source, context);
  if (source === ".restore" || source.startsWith(".restore ")) return restoreShellCommand(source, context);
  if (source === ".archive-cancel") return archiveCancelShellCommand(source, context);
  if (source.startsWith(".archive-cancel ")) return archiveCancelShellCommand(source, context);
  if (source === ".delete-db") return deleteDatabaseShellCommand(source, context);
  if (source.startsWith(".delete-db ")) return deleteDatabaseShellCommand(source, context);
  if (source.startsWith(".")) throw new Error(`unknown shell command: ${source}`);
  const endpoint = sqlCommandEndpoint("sql", source);
  return {
    endpoint,
    sql: source,
    params: [],
    maxRows: context.maxRows,
    databaseId: context.databaseId,
    outputFormat: context.outputFormat,
    ...(endpoint === "sql_execute" ? { idempotencyKey: identityShellIdempotencyKey(context), waitForRoutedOperation: context.waitForRoutedOperation } : {})
  };
}

function requiredShellArg(source, command) {
  const words = shellWords(source.slice(command.length));
  if (words.length === 0) throw new Error(`${command} requires an argument`);
  if (words.length > 1) throw new Error(`${command} requires exactly one argument`);
  if (words[0] === "") throw new Error(`${command} requires an argument`);
  return words[0];
}

function optionalShellArg(source, command) {
  const words = shellWords(source.slice(command.length));
  if (words.length > 1) throw new Error(`${command} accepts at most one argument`);
  if (words[0] === "") throw new Error(`${command} argument is required`);
  return words[0] ?? null;
}

function previewShellCommand(source, context) {
  const [tableName, limit, offset] = shellWords(source.slice(".preview ".length));
  assertShellWordLimit(source, ".preview", 3);
  return {
    ...context,
    preview: true,
    tableName: tableNameArg(requiredShellValue(tableName, ".preview table_name")),
    limit: limit === undefined ? context.limit : parseRowLimit(limit, "limit"),
    offset: offset === undefined ? context.offset : parseNat32Integer(offset, "offset")
  };
}

function inspectShellCommand(source, context) {
  const [tableName, limit, offset] = shellWords(source.slice(".inspect ".length));
  assertShellWordLimit(source, ".inspect", 3);
  return {
    ...context,
    inspect: true,
    tableName: optionalTableNameArg(tableName),
    limit: limit === undefined ? context.limit : parseRowLimit(limit, "limit"),
    offset: offset === undefined ? context.offset : parseNat32Integer(offset, "offset")
  };
}

function archiveShellCommand(source, context) {
  const [filePath] = shellWords(source.slice(".archive ".length));
  assertShellWordLimit(source, ".archive", 1);
  return {
    ...context,
    archive: true,
    filePath: requiredShellFileValue(filePath, ".archive file")
  };
}

function snapshotInfoShellCommand(source, context) {
  const [filePath] = shellWords(source.slice(".snapshot-info ".length));
  assertShellWordLimit(source, ".snapshot-info", 1);
  return {
    ...context,
    snapshotInfo: true,
    command: "snapshot-info",
    filePath: requiredShellFileValue(filePath, ".snapshot-info file")
  };
}

function restoreShellCommand(source, context) {
  const [filePath, expectedSnapshotHash] = shellWords(source.slice(".restore ".length));
  assertShellWordLimit(source, ".restore", 2);
  return {
    ...context,
    restore: true,
    filePath: requiredShellFileValue(filePath, ".restore file"),
    expectedSnapshotHash: expectedSnapshotHash === undefined ? "" : parseSnapshotHashHex(expectedSnapshotHash, "expected_sha256")
  };
}

function grantMemberShellCommand(source, context) {
  const [principal, role] = shellWords(source.slice(".grant-member".length));
  assertShellWordLimit(source, ".grant-member", 2);
  return {
    ...context,
    grantMember: true,
    principalText: grantablePrincipal(requiredShellValue(principal, "principal")),
    role: parseDatabaseRole(requiredShellValue(role, "role"))
  };
}

function revokeMemberShellCommand(source, context) {
  const [principal] = shellWords(source.slice(".revoke-member".length));
  assertShellWordLimit(source, ".revoke-member", 1);
  return {
    ...context,
    revokeMember: true,
    principalText: memberPrincipal(requiredShellValue(principal, "principal"))
  };
}

function archiveCancelShellCommand(source, context) {
  assertShellWordLimit(source, ".archive-cancel", 0);
  return {
    ...context,
    archiveCancel: true
  };
}

function deleteDatabaseShellCommand(source, context) {
  assertShellWordLimit(source, ".delete-db", 0);
  return {
    ...context,
    deleteDatabase: true
  };
}

function fileShellCommand(source, context, dotCommand, kind) {
  const [filePath] = shellWords(source.slice(dotCommand.length));
  assertShellWordLimit(source, dotCommand, 1);
  return {
    ...context,
    [kind]: true,
    filePath: requiredShellFileValue(filePath, `${dotCommand} file`),
    idempotencyKey: identityShellIdempotencyKey(context),
    ...(context.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
  };
}

function requiredShellValue(value, label) {
  if (value === undefined || value === "") throw new Error(`${label} is required`);
  return value;
}

function requiredShellFileValue(value, label) {
  if (value === undefined || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function assertShellWordLimit(source, command, limit) {
  const words = shellWords(source.slice(command.length));
  if (words.length > limit) throw new Error(`${command} accepts at most ${limit} argument${limit === 1 ? "" : "s"}`);
}

function shellWords(source) {
  const words = [];
  let word = "";
  let quote = "";
  let hasWord = false;
  const text = source.trim();
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = "";
      } else if (char === "\\" && quote === "\"" && index + 1 < text.length) {
        index += 1;
        word += text[index];
        hasWord = true;
      } else {
        word += char;
        hasWord = true;
      }
    } else if (char === "'" || char === "\"") {
      quote = char;
      hasWord = true;
    } else if (/\s/.test(char)) {
      if (hasWord) {
        words.push(word);
        word = "";
        hasWord = false;
      }
    } else if (char === "\\" && index + 1 < text.length) {
      index += 1;
      word += text[index];
      hasWord = true;
    } else {
      word += char;
      hasWord = true;
    }
  }
  if (quote) throw new Error("unterminated shell quote");
  if (hasWord) words.push(word);
  return words;
}

function identityShellIdempotencyKey(context) {
  const prefix = context.idempotencyKey || `identity-shell-${context.databaseId}`;
  return `${prefix}-${randomUUID()}`;
}

function isReadSql(sql) {
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
  if (!isNameStart(sql[index] ?? "")) return { value: "", end: index };
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
  const value = sql.slice(index).match(/^[A-Za-z]+/)?.[0] ?? "";
  return { value: value.toLowerCase(), end: index + value.length };
}

function firstSqlTokenIndex(sql, start = 0) {
  let index = start;
  while (index < sql.length) {
    const character = sql[index] ?? "";
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "-" && sql[index + 1] === "-") {
      index = skipLineComment(sql, index);
    } else if (character === "/" && sql[index + 1] === "*") {
      index = skipBlockComment(sql, index);
    } else {
      return index;
    }
  }
  return sql.length;
}

function skipWithClauseList(sql, start) {
  let index = start;
  const recursiveToken = sqlTokenAt(sql, index);
  if (recursiveToken.value === "recursive") index = recursiveToken.end;
  while (index < sql.length) {
    index = skipSqlIdentifier(sql, firstSqlTokenIndex(sql, index));
    index = firstSqlTokenIndex(sql, index);
    if (sql[index] === "(") index = skipBalancedSql(sql, index);
    const linkToken = sqlTokenAt(sql, index);
    if (linkToken.value !== "AS".toLowerCase()) return index;
    index = firstSqlTokenIndex(sql, linkToken.end);
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
    index += 1;
  }
  return sql.length;
}

function skipSqlIdentifier(sql, start) {
  const character = sql[start] ?? "";
  if (character === "\"") return skipQuotedSql(sql, start, "\"");
  if (character === "`") return skipQuotedSql(sql, start, "`");
  if (character === "[") return skipBracketQuotedSql(sql, start);
  if (!isNameStart(character)) return start;
  let index = start + 1;
  while (index < sql.length && isNamePart(sql[index] ?? "")) index += 1;
  return index;
}

function skipBalancedSql(sql, start) {
  let depth = 1;
  let index = start + 1;
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
      index = skipLineComment(sql, index);
    } else if (character === "/" && sql[index + 1] === "*") {
      index = skipBlockComment(sql, index);
    } else if (character === "(") {
      depth += 1;
      index += 1;
    } else if (character === ")") {
      depth -= 1;
      index += 1;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  return sql.length;
}

function skipLineComment(sql, start) {
  const end = sql.indexOf("\n", start + 2);
  return end === -1 ? sql.length : end + 1;
}

function skipBlockComment(sql, start) {
  const end = sql.indexOf("*/", start + 2);
  return end === -1 ? sql.length : end + 2;
}

function idlFactory({ IDL: idl }) {
  const CanisterHealth = idl.Record({ cycles_balance: idl.Nat });
  const DatabaseRole = idl.Variant({ Reader: idl.Null, Writer: idl.Null, Owner: idl.Null });
  const DatabaseStatus = idl.Variant({ Hot: idl.Null, Restoring: idl.Null, Archiving: idl.Null, Archived: idl.Null, Deleted: idl.Null });
  const DatabaseSummary = idl.Record({
    status: DatabaseStatus,
    role: DatabaseRole,
    logical_size_bytes: idl.Nat64,
    database_id: idl.Text,
    archived_at_ms: idl.Opt(idl.Int64),
    deleted_at_ms: idl.Opt(idl.Int64)
  });
  const DatabaseMember = idl.Record({
    principal: idl.Text,
    role: DatabaseRole,
    created_at_ms: idl.Int64,
    database_id: idl.Text
  });
  const DatabaseShardPlacement = idl.Record({
    status: DatabaseStatus,
    database_id: idl.Text,
    shard_id: idl.Text,
    mount_id: idl.Opt(idl.Nat32),
    schema_version: idl.Text,
    canister_id: idl.Opt(idl.Text),
    created_at_ms: idl.Int64,
    updated_at_ms: idl.Int64
  });
  const DatabaseShardInfo = idl.Record({
    status: idl.Text,
    shard_id: idl.Text,
    canister_id: idl.Text,
    updated_at_ms: idl.Int64,
    created_at_ms: idl.Int64,
    assigned_databases: idl.Nat64,
    max_databases: idl.Nat16
  });
  const DatabaseShardStatus = idl.Record({
    cycles_balance: idl.Nat,
    memory_size_bytes: idl.Nat,
    shard: DatabaseShardInfo,
    canister_status: idl.Text,
    idle_cycles_burned_per_day: idl.Nat,
    module_hash: idl.Opt(idl.Vec(idl.Nat8))
  });
  const DatabaseShardMaintenanceAction = idl.Record({
    action: idl.Text,
    database_canister_id: idl.Opt(idl.Text),
    shard_id: idl.Opt(idl.Text),
    cycles: idl.Nat,
    reason: idl.Text
  });
  const DatabaseShardMaintenanceReport = idl.Record({
    actions: idl.Vec(DatabaseShardMaintenanceAction),
    available_slots: idl.Nat64,
    inspected_shards: idl.Vec(DatabaseShardStatus)
  });
  const RoutedOperationStatus = idl.Variant({ Pending: idl.Null, Applied: idl.Null, Failed: idl.Null, Unknown: idl.Null });
  const ShardOperationInfo = idl.Record({
    request_hash: idl.Vec(idl.Nat8),
    status: RoutedOperationStatus,
    operation_kind: idl.Text,
    updated_at_ms: idl.Int64,
    operation_id: idl.Text,
    error: idl.Opt(idl.Text),
    created_at_ms: idl.Int64,
    target: idl.Opt(idl.Text)
  });
  const RoutedOperationInfo = idl.Record({
    request_hash: idl.Vec(idl.Nat8),
    status: RoutedOperationStatus,
    method: idl.Text,
    database_canister_id: idl.Text,
    updated_at_ms: idl.Int64,
    operation_id: idl.Text,
    error: idl.Opt(idl.Text),
    created_at_ms: idl.Int64,
    database_id: idl.Text
  });
  const DatabaseShardStatusRequest = idl.Record({ database_canister_id: idl.Text });
  const TopUpDatabaseShardRequest = idl.Record({ database_canister_id: idl.Text, cycles: idl.Nat });
  const MaintainDatabaseShardsRequest = idl.Record({
    top_up_cycles: idl.Nat,
    new_shard_initial_cycles: idl.Nat,
    new_shard_max_databases: idl.Nat16,
    min_cycles_balance: idl.Nat,
    min_available_slots: idl.Nat64,
    max_new_shards: idl.Nat16
  });
  const CreateRemoteDatabaseRequest = idl.Record({ database_canister_id: idl.Text, database_id: idl.Text });
  const ShardOperationReconcileRequest = idl.Record({
    status: RoutedOperationStatus,
    operation_id: idl.Text,
    error: idl.Opt(idl.Text)
  });
  const RoutedOperationRequest = idl.Record({
    operation_id: idl.Text,
    database_id: idl.Text
  });
  const DatabaseUsage = idl.Record({
    status: DatabaseStatus,
    logical_size_bytes: idl.Nat64,
    usage_event_count: idl.Nat64,
    database_id: idl.Text,
    max_logical_size_bytes: idl.Nat64
  });
  const DatabaseUsageEventSummary = idl.Record({
    method: idl.Text,
    success: idl.Bool,
    operation: idl.Opt(idl.Text),
    total_cycles_delta: idl.Nat64,
    event_count: idl.Nat64,
    total_rows_returned: idl.Nat64,
    total_rows_affected: idl.Nat64,
    last_created_at_ms: idl.Int64
  });
  const SqlValue = idl.Variant({
    Blob: idl.Vec(idl.Nat8),
    Null: idl.Null,
    Real: idl.Float64,
    Text: idl.Text,
    Integer: idl.Int64
  });
  const SqlStatement = idl.Record({ sql: idl.Text, params: idl.Vec(SqlValue) });
  const SqlBatchRequest = idl.Record({
    idempotency_key: idl.Opt(idl.Text),
    max_rows: idl.Opt(idl.Nat32),
    database_id: idl.Text,
    statements: idl.Vec(SqlStatement)
  });
  const SqlExecuteRequest = idl.Record({
    idempotency_key: idl.Opt(idl.Text),
    sql: idl.Text,
    max_rows: idl.Opt(idl.Nat32),
    database_id: idl.Text,
    params: idl.Vec(SqlValue)
  });
  const SqlExecuteResponse = idl.Record({
    truncated: idl.Bool,
    routed_operation_id: idl.Opt(idl.Text),
    rows: idl.Vec(idl.Vec(SqlValue)),
    rows_affected: idl.Nat64,
    last_insert_rowid: idl.Int64,
    columns: idl.Vec(idl.Text)
  });
  const DatabaseObjectType = idl.Variant({ View: idl.Null, Table: idl.Null });
  const DatabaseTable = idl.Record({
    schema_sql: idl.Opt(idl.Text),
    name: idl.Text,
    object_type: DatabaseObjectType
  });
  const DatabaseColumn = idl.Record({
    cid: idl.Nat32,
    name: idl.Text,
    primary_key_position: idl.Nat32,
    declared_type: idl.Text,
    default_value: idl.Opt(idl.Text),
    not_null: idl.Bool,
    hidden: idl.Nat32
  });
  const DatabaseIndexColumn = idl.Record({
    cid: idl.Int64,
    key: idl.Bool,
    descending: idl.Bool,
    collation: idl.Text,
    name: idl.Opt(idl.Text),
    seqno: idl.Nat32
  });
  const DatabaseIndex = idl.Record({
    schema_sql: idl.Opt(idl.Text),
    name: idl.Text,
    origin: idl.Text,
    unique: idl.Bool,
    table_name: idl.Text,
    partial: idl.Bool,
    columns: idl.Vec(DatabaseIndexColumn)
  });
  const DatabaseTrigger = idl.Record({
    schema_sql: idl.Opt(idl.Text),
    name: idl.Text,
    table_name: idl.Text
  });
  const DatabaseForeignKey = idl.Record({
    id: idl.Nat32,
    seq: idl.Nat32,
    match_clause: idl.Text,
    to_column: idl.Opt(idl.Text),
    table_name: idl.Text,
    on_delete: idl.Text,
    on_update: idl.Text,
    from_column: idl.Text
  });
  const TableDescription = idl.Record({
    foreign_keys: idl.Vec(DatabaseForeignKey),
    schema_sql: idl.Opt(idl.Text),
    database_id: idl.Text,
    object_type: DatabaseObjectType,
    table_name: idl.Text,
    indexes: idl.Vec(DatabaseIndex),
    columns: idl.Vec(DatabaseColumn),
    triggers: idl.Vec(DatabaseTrigger)
  });
  const TablePreviewRequest = idl.Record({
    offset: idl.Opt(idl.Nat32),
    limit: idl.Opt(idl.Nat32),
    database_id: idl.Text,
    table_name: idl.Text
  });
  const TablePreviewResponse = idl.Record({
    truncated: idl.Bool,
    rows: idl.Vec(idl.Vec(SqlValue)),
    offset: idl.Nat32,
    limit: idl.Nat32,
    database_id: idl.Text,
    total_count: idl.Nat64,
    table_name: idl.Text,
    columns: idl.Vec(idl.Text)
  });
  const DatabaseArchiveInfo = idl.Record({
    size_bytes: idl.Nat64,
    database_id: idl.Text
  });
  const DatabaseArchiveChunk = idl.Record({
    bytes: idl.Vec(idl.Nat8)
  });
  const DatabaseRestoreChunkRequest = idl.Record({
    database_id: idl.Text,
    offset: idl.Nat64,
    bytes: idl.Vec(idl.Nat8)
  });
  return idl.Service({
    begin_database_archive: idl.Func([idl.Text], [idl.Variant({ Ok: DatabaseArchiveInfo, Err: idl.Text })], []),
    begin_database_restore: idl.Func([idl.Text, idl.Vec(idl.Nat8), idl.Nat64], [idl.Variant({ Ok: idl.Null, Err: idl.Text })], []),
    cancel_database_archive: idl.Func([idl.Text], [idl.Variant({ Ok: idl.Null, Err: idl.Text })], []),
    canister_health: idl.Func([], [CanisterHealth], ["query"]),
    create_database: idl.Func([], [idl.Variant({ Ok: idl.Text, Err: idl.Text })], []),
    delete_database: idl.Func([idl.Text], [idl.Variant({ Ok: idl.Null, Err: idl.Text })], []),
    describe_table: idl.Func([idl.Text, idl.Text], [idl.Variant({ Ok: TableDescription, Err: idl.Text })], []),
    get_usage: idl.Func([idl.Text], [idl.Variant({ Ok: DatabaseUsage, Err: idl.Text })], ["query"]),
    get_usage_event_summaries: idl.Func([idl.Text], [idl.Variant({ Ok: idl.Vec(DatabaseUsageEventSummary), Err: idl.Text })], ["query"]),
    grant_database_access: idl.Func([idl.Text, idl.Text, DatabaseRole], [idl.Variant({ Ok: idl.Null, Err: idl.Text })], []),
    get_database_shard_status: idl.Func([DatabaseShardStatusRequest], [idl.Variant({ Ok: DatabaseShardStatus, Err: idl.Text })], []),
    list_database_placements: idl.Func([], [idl.Variant({ Ok: idl.Vec(DatabaseShardPlacement), Err: idl.Text })], ["query"]),
    list_all_database_placements: idl.Func([], [idl.Variant({ Ok: idl.Vec(DatabaseShardPlacement), Err: idl.Text })], ["query"]),
    list_database_members: idl.Func([idl.Text], [idl.Variant({ Ok: idl.Vec(DatabaseMember), Err: idl.Text })], ["query"]),
    list_database_shards: idl.Func([], [idl.Variant({ Ok: idl.Vec(DatabaseShardInfo), Err: idl.Text })], ["query"]),
    list_databases: idl.Func([], [idl.Variant({ Ok: idl.Vec(DatabaseSummary), Err: idl.Text })], ["query"]),
    list_shard_operations: idl.Func([], [idl.Variant({ Ok: idl.Vec(ShardOperationInfo), Err: idl.Text })], ["query"]),
    list_tables: idl.Func([idl.Text], [idl.Variant({ Ok: idl.Vec(DatabaseTable), Err: idl.Text })], []),
    finalize_database_archive: idl.Func([idl.Text, idl.Vec(idl.Nat8)], [idl.Variant({ Ok: idl.Null, Err: idl.Text })], []),
    finalize_database_restore: idl.Func([idl.Text], [idl.Variant({ Ok: idl.Null, Err: idl.Text })], []),
    get_routed_operation: idl.Func([RoutedOperationRequest], [idl.Variant({ Ok: RoutedOperationInfo, Err: idl.Text })], ["query"]),
    maintain_database_shards: idl.Func([MaintainDatabaseShardsRequest], [idl.Variant({ Ok: DatabaseShardMaintenanceReport, Err: idl.Text })], []),
    migrate_database_to_shard: idl.Func([CreateRemoteDatabaseRequest], [idl.Variant({ Ok: DatabaseShardPlacement, Err: idl.Text })], []),
    preview_table: idl.Func([TablePreviewRequest], [idl.Variant({ Ok: TablePreviewResponse, Err: idl.Text })], []),
    read_database_archive_chunk: idl.Func([idl.Text, idl.Nat64, idl.Nat32], [idl.Variant({ Ok: DatabaseArchiveChunk, Err: idl.Text })], []),
    reconcile_routed_operation: idl.Func([RoutedOperationRequest], [idl.Variant({ Ok: RoutedOperationInfo, Err: idl.Text })], []),
    reconcile_shard_operation: idl.Func([ShardOperationReconcileRequest], [idl.Variant({ Ok: ShardOperationInfo, Err: idl.Text })], []),
    revoke_database_access: idl.Func([idl.Text, idl.Text], [idl.Variant({ Ok: idl.Null, Err: idl.Text })], []),
    sql_batch: idl.Func([SqlBatchRequest], [idl.Variant({ Ok: idl.Vec(SqlExecuteResponse), Err: idl.Text })], []),
    sql_execute: idl.Func([SqlExecuteRequest], [idl.Variant({ Ok: SqlExecuteResponse, Err: idl.Text })], []),
    sql_query: idl.Func([SqlExecuteRequest], [idl.Variant({ Ok: SqlExecuteResponse, Err: idl.Text })], []),
    top_up_database_shard: idl.Func([TopUpDatabaseShardRequest], [idl.Variant({ Ok: DatabaseShardInfo, Err: idl.Text })], []),
    write_database_restore_chunk: idl.Func([DatabaseRestoreChunkRequest], [idl.Variant({ Ok: idl.Null, Err: idl.Text })], [])
  });
}

async function archiveIcpdb(command, actor) {
  const rawInfo = unwrapResult(await actor.begin_database_archive(command.databaseId), "begin_database_archive");
  try {
    const info = normalizeDatabaseArchiveInfo(rawInfo);
    const output = await open(command.filePath, "w");
    const hash = createHash("sha256");
    let offset = 0;
    try {
      while (offset < info.size_bytes) {
        const maxBytes = Math.min(ARCHIVE_CHUNK_BYTES, info.size_bytes - offset);
        const chunk = unwrapResult(
          await actor.read_database_archive_chunk(command.databaseId, BigInt(offset), maxBytes),
          "read_database_archive_chunk"
        );
        const bytes = Buffer.from(chunk.bytes.map(byteValue));
        if (bytes.length === 0) throw new Error("archive stream ended before expected size");
        await output.write(bytes, 0, bytes.length, offset);
        hash.update(bytes);
        offset += bytes.length;
      }
    } finally {
      await output.close();
    }
    const snapshotHash = [...hash.digest()];
    unwrapResult(await actor.finalize_database_archive(command.databaseId, snapshotHash), "finalize_database_archive");
    return {
      database_id: command.databaseId,
      file: command.filePath,
      size_bytes: String(info.size_bytes),
      snapshot_hash: bytesToHex(snapshotHash)
    };
  } catch (error) {
    try {
      unwrapResult(await actor.cancel_database_archive(command.databaseId), "cancel_database_archive");
    } catch (_cancelError) {
      // Preserve the original transfer failure; cancel is best-effort cleanup.
    }
    throw error;
  }
}

async function restoreIcpdb(command, actor) {
  const snapshot = await snapshotFileInfo(command.filePath);
  const snapshotHash = snapshot.snapshotHash;
  const snapshotHashHex = bytesToHex(snapshotHash);
  if (command.expectedSnapshotHash && command.expectedSnapshotHash !== snapshotHashHex) {
    throw new Error(`snapshot hash mismatch: expected ${command.expectedSnapshotHash}, got ${snapshotHashHex}`);
  }
  unwrapResult(await actor.begin_database_restore(command.databaseId, snapshotHash, BigInt(snapshot.sizeBytes)), "begin_database_restore");
  const input = await open(command.filePath, "r");
  try {
    let offset = 0;
    while (offset < snapshot.sizeBytes) {
      const length = Math.min(ARCHIVE_CHUNK_BYTES, snapshot.sizeBytes - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (bytesRead === 0) throw new Error("restore file ended before expected size");
      const chunk = buffer.subarray(0, bytesRead);
      unwrapResult(
        await actor.write_database_restore_chunk({
          database_id: command.databaseId,
          offset: BigInt(offset),
          bytes: [...chunk]
        }),
        "write_database_restore_chunk"
      );
      offset += bytesRead;
    }
  } finally {
    await input.close();
  }
  unwrapResult(await actor.finalize_database_restore(command.databaseId), "finalize_database_restore");
  return {
    database_id: command.databaseId,
    file: command.filePath,
    size_bytes: String(snapshot.sizeBytes),
    snapshot_hash: snapshotHashHex
  };
}

async function snapshotInfoIcpdb(command) {
  const snapshot = await snapshotFileInfo(command.filePath);
  return {
    file: command.filePath,
    size_bytes: String(snapshot.sizeBytes),
    snapshot_hash: bytesToHex(snapshot.snapshotHash)
  };
}

async function snapshotFileInfo(filePath) {
  const file = await stat(filePath);
  if (!Number.isSafeInteger(file.size)) {
    throw new Error("snapshot file size exceeds JavaScript safe integer range");
  }
  const input = await open(filePath, "r");
  const hash = createHash("sha256");
  let offset = 0;
  try {
    while (offset < file.size) {
      const length = Math.min(ARCHIVE_CHUNK_BYTES, file.size - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (bytesRead === 0) throw new Error("snapshot file ended before expected size");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    await input.close();
  }
  return {
    sizeBytes: file.size,
    snapshotHash: [...hash.digest()]
  };
}

async function schemaIcpdb(command, actor) {
  const descriptions = [];
  if (command.tableName) {
    descriptions.push(normalizeTableDescription(unwrapResult(
      await actor.describe_table(command.databaseId, command.tableName),
      "describe_table"
    )));
  } else {
    const tables = unwrapResult(await actor.list_tables(command.databaseId), "list_tables");
    for (const table of tables) {
      descriptions.push(normalizeTableDescription(unwrapResult(
        await actor.describe_table(command.databaseId, table.name),
        "describe_table"
      )));
    }
  }
  return {
    database_id: command.databaseId,
    schemas: descriptions.map(schemaEntry)
  };
}

async function tableColumnsIcpdb(command, actor) {
  const description = normalizeTableDescription(unwrapResult(
    await actor.describe_table(command.databaseId, command.tableName),
    "describe_table"
  ));
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    column_count: description.columns.length,
    columns: description.columns
  };
}

async function tableIndexesIcpdb(command, actor) {
  const description = normalizeTableDescription(unwrapResult(
    await actor.describe_table(command.databaseId, command.tableName),
    "describe_table"
  ));
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    indexes: description.indexes
  };
}

async function tableTriggersIcpdb(command, actor) {
  const description = normalizeTableDescription(unwrapResult(
    await actor.describe_table(command.databaseId, command.tableName),
    "describe_table"
  ));
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    triggers: description.triggers
  };
}

async function tableForeignKeysIcpdb(command, actor) {
  const description = normalizeTableDescription(unwrapResult(
    await actor.describe_table(command.databaseId, command.tableName),
    "describe_table"
  ));
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    foreign_keys: description.foreign_keys
  };
}

async function statsIcpdb(command, actor) {
  const tables = unwrapResult(await actor.list_tables(command.databaseId), "list_tables").map(normalizeDatabaseTable);
  const summaries = [];
  for (const table of tables) {
    const [description, preview] = await Promise.all([
      actor.describe_table(command.databaseId, table.name),
      actor.preview_table({
        database_id: command.databaseId,
        table_name: table.name,
        limit: option(1),
        offset: option(0)
      })
    ]);
    summaries.push(tableSummaryEntry(
      normalizeTableDescription(unwrapResult(description, "describe_table")),
      normalizeTablePreview(unwrapResult(preview, "preview_table"))
    ));
  }
  return {
    database_id: command.databaseId,
    stats: databaseStats(summaries),
    table_summaries: summaries
  };
}

async function inspectIcpdb(command, actor) {
  if (command.tableName) {
    const [description, preview] = await Promise.all([
      actor.describe_table(command.databaseId, command.tableName),
      actor.preview_table({
        database_id: command.databaseId,
        table_name: command.tableName,
        limit: option(command.limit),
        offset: option(command.offset)
      })
    ]);
    return {
      database_id: command.databaseId,
      table: normalizeTableDescription(unwrapResult(description, "describe_table")),
      preview: normalizeTablePreview(unwrapResult(preview, "preview_table"))
    };
  }
  const tables = unwrapResult(await actor.list_tables(command.databaseId), "list_tables").map(normalizeDatabaseTable);
  const entries = [];
  for (const table of tables) {
    const [description, preview] = await Promise.all([
      actor.describe_table(command.databaseId, table.name),
      actor.preview_table({
        database_id: command.databaseId,
        table_name: table.name,
        limit: option(1),
        offset: option(0)
      })
    ]);
    const normalizedDescription = normalizeTableDescription(unwrapResult(description, "describe_table"));
    const normalizedPreview = normalizeTablePreview(unwrapResult(preview, "preview_table"));
    entries.push({
      description: normalizedDescription,
      preview: normalizedPreview
    });
  }
  const [placement, usage] = await Promise.all([
    placementIcpdb(command, actor),
    actor.get_usage(command.databaseId).then((result) => normalizeDatabaseUsage(unwrapResult(result, "get_usage")))
  ]);
  const tableSummaries = entries.map((entry) => tableSummaryEntry(entry.description, entry.preview));
  return {
    database_id: command.databaseId,
    placement,
    usage,
    table_summaries: tableSummaries,
    tables: entries.map((entry) => entry.description)
  };
}

async function statusIcpdb(command, actor, identity) {
  const [placement, usage, stats, callerRole] = await Promise.all([
    placementIcpdb(command, actor),
    actor.get_usage(command.databaseId).then((result) => normalizeDatabaseUsage(unwrapResult(result, "get_usage"))),
    statsIcpdb(command, actor),
    callerDatabaseRole(command, actor)
  ]);
  return {
    database_id: command.databaseId,
    connection_url: formatIcpdbDatabaseUrl(command.canisterId, command.databaseId),
    caller_principal: identity.getPrincipal().toText(),
    caller_role: callerRole,
    placement,
    usage,
    stats: stats.stats,
    table_summaries: stats.table_summaries
  };
}

async function callerDatabaseRole(command, actor) {
  const databases = unwrapResult(await actor.list_databases(), "list_databases").map(normalizeDatabaseSummary);
  const database = databases.find((candidate) => candidate.database_id === command.databaseId);
  if (!database) throw new Error(`caller has no visible role for database: ${command.databaseId}`);
  return database.role;
}

async function maybeWaitSqlResponse(command, actor, response) {
  if (!command.waitForRoutedOperation) return response;
  return {
    ...response,
    routed_operation: await waitForRoutedOperation(command, actor, response.routed_operation_id)
  };
}

async function maybeWaitSqlBatchResponse(command, actor, responses) {
  if (!command.waitForRoutedOperation) return responses;
  const operationId = responses.find((response) => response.routed_operation_id)?.routed_operation_id ?? null;
  return {
    results: responses,
    routed_operation: await waitForRoutedOperation(command, actor, operationId)
  };
}

async function sqlBatchRead(command, actor) {
  const responses = [];
  for (const statement of command.statements) {
    const request = sqlRequest({
      ...command,
      sql: statement.sql,
      params: statement.params ?? [],
      idempotencyKey: undefined
    });
    responses.push(normalizeSqlResponse(unwrapResult(await actor.sql_query(request), "sql_query")));
  }
  return responses;
}

async function waitForRoutedOperation(command, actor, operationId) {
  if (!operationId) throw new Error("--wait requires a remote routed write result");
  const startedAtMs = Date.now();
  let lastStatus = "pending";
  while (true) {
    const info = normalizeRoutedOperationInfo(unwrapResult(
      await actor.get_routed_operation({
        database_id: command.databaseId,
        operation_id: operationId
      }),
      "get_routed_operation"
    ));
    lastStatus = info.status;
    if (info.status !== "pending") return info;
    const elapsedMs = Date.now() - startedAtMs;
    if (elapsedMs >= DEFAULT_WAIT_TIMEOUT_MS) {
      throw new Error(`routed operation ${operationId} did not finish within ${DEFAULT_WAIT_TIMEOUT_MS}ms; last status: ${lastStatus}`);
    }
    await delay(Math.min(DEFAULT_WAIT_INTERVAL_MS, DEFAULT_WAIT_TIMEOUT_MS - elapsedMs));
  }
}

async function delay(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function dumpSqlIcpdb(command, actor) {
  const tableNames = command.tableName
    ? [{ name: command.tableName }]
    : unwrapResult(await actor.list_tables(command.databaseId), "list_tables");
  const descriptions = [];
  for (const table of tableNames) {
    descriptions.push(normalizeTableDescription(unwrapResult(
      await actor.describe_table(command.databaseId, table.name),
      "describe_table"
    )));
  }
  const lines = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const description of descriptions) {
    if (description.schema_sql) lines.push(`${trimSqlSemicolon(description.schema_sql)};`);
  }
  for (const description of sortDescriptionsForInsert(descriptions)) {
    if (description.object_type !== "table") continue;
    let offset = 0;
    while (true) {
      const preview = normalizeTablePreview(unwrapResult(
        await actor.preview_table({
          database_id: command.databaseId,
          table_name: description.table_name,
          limit: option(command.limit),
          offset: option(offset)
        }),
        "preview_table"
      ));
      for (const row of preview.rows) {
        lines.push(formatDumpInsertStatement(description, preview.columns, row));
      }
      offset += preview.rows.length;
      if (preview.rows.length === 0 || BigInt(offset) >= BigInt(preview.total_count)) break;
    }
  }
  lines.push(...await sqliteSequenceDumpStatements(command, actor, descriptions.map((description) => description.table_name)));
  for (const description of descriptions) {
    for (const index of description.indexes) {
      if (index.schema_sql) lines.push(`${trimSqlSemicolon(index.schema_sql)};`);
    }
    for (const trigger of description.triggers) {
      if (trigger.schema_sql) lines.push(`${trimSqlSemicolon(trigger.schema_sql)};`);
    }
  }
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

async function sqliteSequenceDumpStatements(command, actor, tableNames) {
  const sqliteSequence = normalizeSqlResponse(unwrapResult(
    await actor.sql_query(sqlRequest({
      databaseId: command.databaseId,
      sql: "SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2",
      params: ["table", "sqlite_sequence"],
      maxRows: 1
    })),
    "sql_query"
  ));
  if (sqliteSequence.rows.length === 0) return [];
  const includedTables = new Set(tableNames);
  const statements = [];
  const pageSize = command.maxRows ?? DEFAULT_MAX_ROWS;
  let lastName = "";
  while (true) {
    const response = normalizeSqlResponse(unwrapResult(
      await actor.sql_query(sqlRequest({
        databaseId: command.databaseId,
        sql: "SELECT name, seq FROM sqlite_sequence WHERE name > ?1 ORDER BY name",
        params: [lastName],
        maxRows: pageSize
      })),
      "sql_query"
    ));
    if (response.rows.length === 0) break;
    for (const row of response.rows) {
      const name = sqlCellText(row[0]);
      lastName = name;
      if (!includedTables.has(name)) continue;
      statements.push(`DELETE FROM sqlite_sequence WHERE name = ${quoteSqlText(name)};`);
      statements.push(`INSERT INTO sqlite_sequence(name, seq) VALUES (${quoteSqlText(name)}, ${sqliteSequenceValue(sqlCellText(row[1]))});`);
    }
    if (response.rows.length < pageSize && !response.truncated) break;
  }
  return statements;
}

async function loadSqlDumpIcpdb(command, actor) {
  const source = await readSqlInput(command.filePath, command.stdinText);
  const statements = sqlScriptStatements(source, true);
  if (statements.length === 0) throw new Error("SQL dump has no executable statements");
  return executeSqlStatementBatches(command, actor, statements);
}

async function executeSqlScriptIcpdb(command, actor) {
  const source = await readSqlInput(command.filePath, command.stdinText);
  const statements = sqlScriptStatements(source, false);
  if (statements.length === 0) throw new Error("SQL script has no executable statements");
  return executeSqlStatementBatches(command, actor, statements);
}

async function migrateIcpdb(command, actor) {
  const source = await readSqlInput(command.filePath, command.stdinText);
  const migrations = parseMigrationsJson(source);
  return applyMigrationsIcpdb(command, actor, migrations, {
    database_id: command.databaseId,
    file: command.filePath,
    migration_count: migrations.length
  });
}

async function applyMigrationsIcpdb(command, actor, migrations, outputBase) {
  const ensured = await ensureMigrationTable(command, actor);
  const appliedVersions = await listAppliedMigrationVersions(command, actor);
  const applied = [];
  const skipped = [];
  let statementCount = 0;
  let batchCount = ensured.created ? 1 : 0;
  let rowsAffected = 0n;
  const results = ensured.results;
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }
    const statements = sqlScriptStatements(migration.sql, false);
    if (statements.length === 0) throw new Error(`migration ${migration.version} has no SQL statements`);
    if (statements.length >= SQL_DUMP_BATCH_STATEMENTS) {
      throw new Error(`migration ${migration.version} has too many SQL statements; split it so version recording stays atomic`);
    }
    const batch = [
      ...statements,
      {
        sql: `INSERT INTO ${MIGRATIONS_TABLE}(version, name, applied_at_ms) VALUES (?1, ?2, ?3)`,
        params: [migration.version, migration.name, String(Date.now())]
      }
    ];
    const responses = unwrapResult(
      await actor.sql_batch(sqlBatchRequest({
        databaseId: command.databaseId,
        statements: batch,
        maxRows: command.maxRows,
        idempotencyKey: migrationBatchIdempotencyKey(command, applied.length)
      })),
      "sql_batch"
    ).map(normalizeSqlResponse);
    for (const response of responses) {
      rowsAffected += BigInt(response.rows_affected);
      results.push(response);
    }
    appliedVersions.add(migration.version);
    applied.push(migration.version);
    statementCount += statements.length;
    batchCount += 1;
  }
  return {
    ...outputBase,
    applied,
    skipped,
    statement_count: statementCount,
    batch_count: batchCount,
    rows_affected: rowsAffected.toString(),
    ...(command.waitForRoutedOperation ? {
      results,
      routed_operations: await waitForSqlFileBatchOperations(command, actor, results)
    } : {})
  };
}

async function ensureMigrationTable(command, actor) {
  const table = unwrapResult(
    await actor.sql_query(sqlRequest({
      databaseId: command.databaseId,
      sql: "SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2",
      params: ["table", MIGRATIONS_TABLE],
      maxRows: 1
    })),
    "sql_query"
  );
  if (table.rows.length > 0) return { created: false, results: [] };
  const responses = unwrapResult(
    await actor.sql_batch(sqlBatchRequest({
      databaseId: command.databaseId,
      statements: [{
        sql: `CREATE TABLE ${MIGRATIONS_TABLE}(version TEXT PRIMARY KEY, name TEXT, applied_at_ms TEXT NOT NULL)`,
        params: []
      }],
      maxRows: command.maxRows,
      idempotencyKey: migrationEnsureIdempotencyKey(command)
    })),
    "sql_batch"
  ).map(normalizeSqlResponse);
  return { created: true, results: responses };
}

async function listAppliedMigrationVersions(command, actor) {
  const response = unwrapResult(
    await actor.sql_query(sqlRequest({
      databaseId: command.databaseId,
      sql: `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`,
      params: [],
      maxRows: command.maxRows
    })),
    "sql_query"
  );
  return new Set(response.rows.map((row) => sqlCellText(row[0])));
}

function parseMigrationsJson(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid migrations JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("migrations JSON must be an array");
  const seen = new Set();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`migration ${index + 1} must be an object`);
    const version = migrationVersion(entry.version, index);
    if (seen.has(version)) throw new Error(`duplicate migration version: ${version}`);
    seen.add(version);
    const name = migrationName(entry.name, index);
    if (typeof entry.sql !== "string" || entry.sql.trim().length === 0) throw new Error(`migration ${version} sql must be a non-empty string`);
    return { version, name, sql: entry.sql };
  });
}

function migrationVersion(value, index) {
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`migration ${index + 1} version must be a string or number`);
  const version = String(value).trim();
  if (!version) throw new Error(`migration ${index + 1} version must not be empty`);
  return version;
}

function migrationName(value, index) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`migration ${index + 1} name must be a string`);
  return value;
}

function sqlCellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Object.hasOwn(value, "Text")) return String(value.Text);
  if (Object.hasOwn(value, "text")) return String(value.text);
  if (Object.hasOwn(value, "Integer")) return value.Integer.toString();
  if (Object.hasOwn(value, "integer")) return String(value.integer);
  if (Object.hasOwn(value, "Real")) return String(value.Real);
  if (Object.hasOwn(value, "real")) return String(value.real);
  return JSON.stringify(value);
}

function sqliteSequenceValue(value) {
  return /^[+-]?\d+$/.test(value) ? value : quoteSqlText(value);
}

async function executeSqlStatementBatches(command, actor, statements) {
  if (command.batchMode === "read") return executeSqlStatementQueries(command, actor, statements);
  let rowsAffected = 0n;
  const results = [];
  for (let offset = 0; offset < statements.length; offset += SQL_DUMP_BATCH_STATEMENTS) {
    const batch = statements.slice(offset, offset + SQL_DUMP_BATCH_STATEMENTS);
    const responses = unwrapResult(
      await actor.sql_batch(sqlBatchRequest({
        databaseId: command.databaseId,
        statements: batch,
        maxRows: command.maxRows,
        idempotencyKey: sqlFileBatchIdempotencyKey(command, offset)
      })),
      "sql_batch"
    ).map(normalizeSqlResponse);
    for (const response of responses) {
      rowsAffected += BigInt(response.rows_affected);
      results.push(response);
    }
  }
  if (command.waitForRoutedOperation) {
    return {
      database_id: command.databaseId,
      file: command.filePath,
      statement_count: statements.length,
      batch_count: Math.ceil(statements.length / SQL_DUMP_BATCH_STATEMENTS),
      rows_affected: rowsAffected.toString(),
      results,
      routed_operations: await waitForSqlFileBatchOperations(command, actor, results)
    };
  }
  return {
    database_id: command.databaseId,
    file: command.filePath,
    statement_count: statements.length,
    batch_count: Math.ceil(statements.length / SQL_DUMP_BATCH_STATEMENTS),
    rows_affected: rowsAffected.toString()
  };
}

function sqlFileBatchIdempotencyKey(command, offset) {
  if (!command.idempotencyKey) return undefined;
  return `${command.idempotencyKey}-${offset / SQL_DUMP_BATCH_STATEMENTS}`;
}

function migrationEnsureIdempotencyKey(command) {
  return command.idempotencyKey ? `${command.idempotencyKey}-ensure` : undefined;
}

function migrationBatchIdempotencyKey(command, index) {
  return command.idempotencyKey ? `${command.idempotencyKey}-${index}` : undefined;
}

async function waitForSqlFileBatchOperations(command, actor, results) {
  const operationIds = [...new Set(results.map((response) => response.routed_operation_id).filter(Boolean))];
  if (operationIds.length === 0) throw new Error("--wait requires a remote routed write result");
  const routedOperations = [];
  for (const operationId of operationIds) {
    routedOperations.push(await waitForRoutedOperation(command, actor, operationId));
  }
  return routedOperations;
}

async function executeSqlStatementQueries(command, actor, statements) {
  assertReadSqlStatements(statements, command.load ? "load" : "script");
  const results = [];
  for (const statement of statements) {
    const response = unwrapResult(
      await actor.sql_query(sqlRequest({
        ...command,
        sql: statement.sql,
        params: statement.params ?? [],
        idempotencyKey: undefined
      })),
      "sql_query"
    );
    results.push(normalizeSqlResponse(response));
  }
  return {
    database_id: command.databaseId,
    file: command.filePath,
    statement_count: statements.length,
    query_count: statements.length,
    batch_count: 0,
    rows_affected: "0",
    results
  };
}

function assertReadSqlStatements(statements, label) {
  statements.forEach((statement, index) => {
    if (!isReadSql(statement.sql)) {
      throw new Error(`read ${label} statement ${index + 1} is not read-only`);
    }
  });
}

async function setupCreatedDatabase(command, actor, databaseId) {
  if (command.setupMigrationsFilePath) return setupCreatedDatabaseMigrations(command, actor, databaseId);
  const statements = await createdDatabaseSetupStatements(command);
  if (statements.length === 0) return {};
  let rowsAffected = 0n;
  const responses = [];
  for (let offset = 0; offset < statements.length; offset += SQL_DUMP_BATCH_STATEMENTS) {
    const batch = statements.slice(offset, offset + SQL_DUMP_BATCH_STATEMENTS);
    const batchResponses = unwrapResult(
      await actor.sql_batch(sqlBatchRequest({ databaseId, statements: batch, maxRows: command.maxRows })),
      "sql_batch"
    );
    for (const response of batchResponses) {
      rowsAffected += BigInt(response.rows_affected);
      responses.push(normalizeSqlResponse(response));
    }
  }
  return {
    setup_statement_count: statements.length,
    setup_rows_affected: rowsAffected.toString(),
    setup_results: responses
  };
}

async function setupCreatedDatabaseMigrations(command, actor, databaseId) {
  if (setupStatementSourceCount(command) > 0) throw new Error("use only one of --statement, --statements-file, --setup-file, or --setup-migrations-file");
  const source = await readSqlInput(command.setupMigrationsFilePath, command.stdinText);
  const migrations = parseMigrationsJson(source);
  const result = await applyMigrationsIcpdb({ ...command, databaseId }, actor, migrations, {});
  return {
    setup_migration_count: migrations.length,
    setup_migration_applied: result.applied,
    setup_migration_skipped: result.skipped,
    setup_statement_count: result.statement_count,
    setup_batch_count: result.batch_count,
    setup_rows_affected: result.rows_affected
  };
}

async function createdDatabaseSetupStatements(command) {
  const statements = Array.isArray(command.statements) ? command.statements : [];
  if (!command.setupFilePath) return statements;
  if (statements.length > 0) throw new Error("use only one of --statement, --statements-file, --setup-file, or --setup-migrations-file");
  const source = await readSqlInput(command.setupFilePath, command.stdinText);
  const setupStatements = sqlScriptStatements(source, false);
  if (setupStatements.length === 0) throw new Error("setup file has no executable statements");
  return setupStatements;
}

function setupStatementSourceCount(command) {
  return (Array.isArray(command.statements) && command.statements.length > 0 ? 1 : 0) + (command.setupFilePath ? 1 : 0);
}

function sqlScriptStatements(source, skipDumpWrappers) {
  return splitSqlScript(source)
    .map(trimSqlSemicolon)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && (!skipDumpWrappers || !isIgnoredLoadStatement(statement)))
    .map((sql) => ({ sql, params: [] }));
}

async function readSqlInput(filePath, stdinText) {
  if (filePath !== "-") return readFile(filePath, "utf8");
  if (stdinText !== undefined) return stdinText;
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function placementIcpdb(command, actor) {
  const placements = unwrapResult(await actor.list_database_placements(), "list_database_placements")
    .map(normalizeDatabaseShardPlacement);
  return placements.find((placement) => placement.database_id === command.databaseId) ?? null;
}

function normalizeDatabaseArchiveInfo(info) {
  return {
    database_id: info.database_id,
    size_bytes: archiveSizeBytes(info.size_bytes)
  };
}

function archiveSizeBytes(value) {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("archive size_bytes exceeds JavaScript safe integer range");
    if (value < 0n) throw new Error("archive size_bytes must be a non-negative integer");
    return Number(value);
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new Error("archive size_bytes must be a non-negative integer");
    if (!Number.isSafeInteger(value)) throw new Error("archive size_bytes exceeds JavaScript safe integer range");
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return archiveSizeBytes(BigInt(value));
  }
  throw new Error("archive size_bytes must be a non-negative integer");
}

function generateServiceIdentity(command) {
  return generatedServiceIdentity(command.identityType, command).output;
}

function generatedServiceIdentity(identityType, command = {}) {
  const resolvedType = identityType === "secp256k1" ? "secp256k1" : "ed25519";
  const identity = resolvedType === "secp256k1" ? Secp256k1KeyIdentity.generate() : Ed25519KeyIdentity.generate();
  const identityJson = JSON.stringify(identity.toJSON());
  const targetEnv = serviceIdentityTargetEnv(command);
  const env = {
    ...targetEnv,
    ICPDB_IDENTITY_TYPE: resolvedType,
    ICPDB_IDENTITY_PRINCIPAL: identity.getPrincipal().toText(),
    ICPDB_IDENTITY_JSON: identityJson
  };
  return {
    identity,
    output: {
      identity_type: resolvedType,
      principal: identity.getPrincipal().toText(),
      identity_json: identityJson,
      env,
      env_lines: generatedServiceIdentityEnvLines(env),
      warning: "Store ICPDB_IDENTITY_JSON in a secret manager. It contains the service identity private key."
    }
  };
}

function generatedServiceIdentityEnvLines(env) {
  return Object.entries(env).map(([key, value]) => {
    if (key === "ICPDB_IDENTITY_JSON") return `${key}=${JSON.stringify(value)}`;
    return `${key}=${value}`;
  });
}

function serviceIdentityTargetEnv(command) {
  if (!command?.canisterId) {
    if (command?.databaseId) throw new Error("canisterId must be set when databaseId is set");
    return {};
  }
  const env = {
    ICPDB_CANISTER_ID: command.canisterId,
    ICPDB_NETWORK_URL: requiredNonEmptyString(command.networkUrl, "networkUrl")
  };
  if (command.databaseId) {
    env.ICPDB_DATABASE_ID = command.databaseId;
    env.ICPDB_URL = formatIcpdbDatabaseUrl(command.canisterId, command.databaseId);
  }
  if (command.rootKey) env.ICPDB_ROOT_KEY = command.rootKey;
  return env;
}

function provisionedServiceIdentityOutput(command, generated) {
  const networkUrl = requiredNonEmptyString(command.networkUrl, "networkUrl");
  const env = {
    ICPDB_CANISTER_ID: command.canisterId,
    ICPDB_DATABASE_ID: command.databaseId,
    ICPDB_URL: formatIcpdbDatabaseUrl(command.canisterId, command.databaseId),
    ICPDB_NETWORK_URL: networkUrl,
    ...generated.env
  };
  if (command.rootKey) env.ICPDB_ROOT_KEY = command.rootKey;
  return {
    database_id: command.databaseId,
    role: command.role,
    identity_type: generated.identity_type,
    principal: generated.principal,
    identity_json: generated.identity_json,
    env,
    env_lines: Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`),
    warning: generated.warning
  };
}

function createdDatabaseEnv(command, databaseId, identity) {
  const networkUrl = requiredNonEmptyString(command.networkUrl, "networkUrl");
  const env = {
    ICPDB_CANISTER_ID: command.canisterId,
    ICPDB_DATABASE_ID: databaseId,
    ICPDB_URL: formatIcpdbDatabaseUrl(command.canisterId, databaseId),
    ICPDB_NETWORK_URL: networkUrl
  };
  if (command.identityType && command.identityType !== "auto") env.ICPDB_IDENTITY_TYPE = command.identityType;
  if (command.identityPem) env.ICPDB_IDENTITY_PEM = command.identityPem;
  if (command.identityPemFile) env.ICPDB_IDENTITY_PEM_FILE = command.identityPemFile;
  if (command.identityJson) env.ICPDB_IDENTITY_JSON = command.identityJson;
  if (command.identityJsonFile) env.ICPDB_IDENTITY_JSON_FILE = command.identityJsonFile;
  if (command.identityPrincipal) env.ICPDB_IDENTITY_PRINCIPAL = command.identityPrincipal;
  else if (identity) env.ICPDB_IDENTITY_PRINCIPAL = identity.getPrincipal().toText();
  if (command.rootKey) env.ICPDB_ROOT_KEY = command.rootKey;
  return env;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sqlRequest(command) {
  return {
    database_id: command.databaseId,
    sql: command.sql,
    params: sqlParams(command.sql, command.params).map(sqlValue),
    max_rows: option(command.maxRows),
    idempotency_key: option(command.idempotencyKey)
  };
}

function sqlBatchRequest(command) {
  return {
    database_id: command.databaseId,
    statements: command.statements.map((statement) => ({
      sql: statement.sql,
      params: sqlParams(statement.sql, statement.params ?? []).map(sqlValue)
    })),
    max_rows: option(command.maxRows),
    idempotency_key: option(command.idempotencyKey)
  };
}

function tablePreviewRequest(command) {
  return {
    database_id: command.databaseId,
    table_name: command.tableName,
    limit: option(command.limit),
    offset: option(command.offset)
  };
}

export function sqlValue(value) {
  if (value === null) return { Null: null };
  if (typeof value === "boolean") return { Integer: value ? 1n : 0n };
  if (typeof value === "number") return Number.isInteger(value) ? { Integer: BigInt(value) } : { Real: value };
  if (typeof value === "bigint") return { Integer: value };
  if (typeof value === "string") return { Text: value };
  if (Array.isArray(value)) return { Blob: value.map(byteValue) };
  if (value && typeof value === "object") return sqlValueObject(value);
  throw new Error(`unsupported SQL param type: ${typeof value}`);
}

function sqlValueObject(value) {
  if (Object.hasOwn(value, "null") || Object.hasOwn(value, "Null")) return { Null: null };
  if (Object.hasOwn(value, "integer")) return { Integer: BigInt(value.integer) };
  if (Object.hasOwn(value, "Integer")) return { Integer: BigInt(value.Integer) };
  if (Object.hasOwn(value, "real")) return { Real: Number(value.real) };
  if (Object.hasOwn(value, "Real")) return { Real: Number(value.Real) };
  if (Object.hasOwn(value, "text")) return { Text: String(value.text) };
  if (Object.hasOwn(value, "Text")) return { Text: String(value.Text) };
  if (Object.hasOwn(value, "blob")) return { Blob: arrayValue(value.blob, "blob").map(byteValue) };
  if (Object.hasOwn(value, "Blob")) return { Blob: arrayValue(value.Blob, "Blob").map(byteValue) };
  throw new Error("SQL param object must be a SqlValue variant");
}

function sqlParams(sql, params) {
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
      index = skipLineComment(sql, index);
    } else if (character === "/" && sql[index + 1] === "*") {
      index = skipBlockComment(sql, index);
    } else if (isNamedParameterPrefix(character) && isNameStart(sql[index + 1] ?? "")) {
      const start = index;
      index += 2;
      while (index < sql.length && isNamePart(sql[index] ?? "")) index += 1;
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

function skipQuotedSql(sql, start, quote) {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
      } else {
        return index + 1;
      }
    } else {
      index += 1;
    }
  }
  return sql.length;
}

function skipBracketQuotedSql(sql, start) {
  const end = sql.indexOf("]", start + 1);
  return end === -1 ? sql.length : end + 1;
}

function isNamedParameterPrefix(value) {
  return value === ":" || value === "@" || value === "$";
}

function isNameStart(value) {
  return /^[A-Za-z_]$/.test(value);
}

function isNamePart(value) {
  return /^[A-Za-z0-9_]$/.test(value);
}

function normalizeSqlValue(value) {
  if ("Null" in value) return { null: null };
  if ("Integer" in value) return { integer: value.Integer.toString() };
  if ("Real" in value) return { real: value.Real };
  if ("Text" in value) return { text: value.Text };
  return { blob: value.Blob };
}

function trimSqlSemicolon(sql) {
  return sql.trim().replace(/;+$/, "");
}

function sortDescriptionsForInsert(descriptions) {
  const byName = new Map(descriptions.map((description) => [description.table_name, description]));
  const sorted = [];
  const temporary = new Set();
  const permanent = new Set();
  function visit(description) {
    if (permanent.has(description.table_name)) return;
    if (temporary.has(description.table_name)) return;
    temporary.add(description.table_name);
    for (const key of description.foreign_keys) {
      const parent = byName.get(key.table_name);
      if (parent) visit(parent);
    }
    temporary.delete(description.table_name);
    permanent.add(description.table_name);
    sorted.push(description);
  }
  for (const description of descriptions) visit(description);
  return sorted;
}

function formatDumpInsertStatement(description, previewColumns, row) {
  const insertableColumns = new Set((description.columns ?? []).filter((column) => Number(column.hidden ?? 0) === 0).map((column) => column.name));
  const columns = [];
  const values = [];
  for (let index = 0; index < previewColumns.length; index += 1) {
    const column = previewColumns[index] ?? "";
    if (!insertableColumns.has(column)) continue;
    columns.push(column);
    values.push(row[index] ?? null);
  }
  return formatInsertStatement(description.table_name, columns, values);
}

function formatInsertStatement(tableName, columns, row) {
  if (columns.length === 0) return `INSERT INTO ${quoteIdentifier(tableName)} DEFAULT VALUES;`;
  const columnList = columns.map(quoteIdentifier).join(", ");
  const valueList = row.map(sqlValueToLiteral).join(", ");
  return `INSERT INTO ${quoteIdentifier(tableName)} (${columnList}) VALUES (${valueList});`;
}

function sqlValueToLiteral(value) {
  if (value === null || value === "null") return "NULL";
  if (typeof value !== "object") return quoteSqlText(String(value));
  if (Object.hasOwn(value, "null") || Object.hasOwn(value, "Null")) return "NULL";
  if (Object.hasOwn(value, "integer")) return String(value.integer);
  if (Object.hasOwn(value, "Integer")) return String(value.Integer);
  if (Object.hasOwn(value, "real")) return String(value.real);
  if (Object.hasOwn(value, "Real")) return String(value.Real);
  if (Object.hasOwn(value, "text")) return quoteSqlText(String(value.text));
  if (Object.hasOwn(value, "Text")) return quoteSqlText(String(value.Text));
  if (Object.hasOwn(value, "blob")) return quoteSqlBlob(value.blob);
  if (Object.hasOwn(value, "Blob")) return quoteSqlBlob(value.Blob);
  return quoteSqlText(JSON.stringify(value));
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteSqlText(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteSqlBlob(bytes) {
  return `X'${bytes.map((byte) => Number(byte).toString(16).padStart(2, "0")).join("")}'`;
}

function splitSqlScript(source) {
  const statements = [];
  let current = "";
  let quote = null;
  let bracketIdentifier = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] ?? "";
    current += character;
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (bracketIdentifier) {
      if (character === "]") bracketIdentifier = false;
      continue;
    }
    if (character === "-" && next === "-") {
      current += next;
      index += 1;
      lineComment = true;
      continue;
    }
    if (character === "/" && next === "*") {
      current += next;
      index += 1;
      blockComment = true;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[") {
      bracketIdentifier = true;
      continue;
    }
    if (character === ";" && canSplitSqlStatement(current)) {
      statements.push(current);
      current = "";
    }
  }
  if (current.trim()) statements.push(current);
  return statements;
}

function canSplitSqlStatement(statement) {
  const executableSql = stripLeadingSqlComments(statement);
  if (!/^CREATE\s+(?:(?:TEMP|TEMPORARY)\s+)?TRIGGER\b/i.test(executableSql)) return true;
  return isCompleteCreateTriggerStatement(statement);
}

function isCompleteCreateTriggerStatement(statement) {
  let bodyDepth = 0;
  let caseDepth = 0;
  let sawTriggerBody = false;
  let lastToken = "";
  let index = 0;
  while (index < statement.length) {
    const character = statement[index] ?? "";
    if (character === "'" || character === "\"" || character === "`") {
      index = skipQuotedSql(statement, index, character);
    } else if (character === "[") {
      index = skipBracketQuotedSql(statement, index);
    } else if (character === "-" && statement[index + 1] === "-") {
      const nextLine = statement.indexOf("\n", index + 2);
      index = nextLine === -1 ? statement.length : nextLine + 1;
    } else if (character === "/" && statement[index + 1] === "*") {
      const close = statement.indexOf("*/", index + 2);
      index = close === -1 ? statement.length : close + 2;
    } else if (/^[A-Za-z_]$/.test(character)) {
      const end = skipSqlIdentifier(statement, index);
      const token = statement.slice(index, end).toLowerCase();
      if (token === "begin") {
        bodyDepth += 1;
        sawTriggerBody = true;
      } else if (sawTriggerBody && token === "case") {
        caseDepth += 1;
      } else if (token === "end") {
        if (caseDepth > 0) {
          caseDepth -= 1;
        } else if (bodyDepth > 0) {
          bodyDepth -= 1;
        }
      }
      lastToken = token;
      index = end;
    } else {
      index += 1;
    }
  }
  return sawTriggerBody && bodyDepth === 0 && caseDepth === 0 && lastToken === "end";
}

function stripLeadingSqlComments(statement) {
  let index = 0;
  while (index < statement.length) {
    while (/\s/.test(statement[index] ?? "")) index += 1;
    if (statement[index] === "-" && statement[index + 1] === "-") {
      const lineEnd = statement.indexOf("\n", index + 2);
      if (lineEnd < 0) return "";
      index = lineEnd + 1;
      continue;
    }
    if (statement[index] === "/" && statement[index + 1] === "*") {
      const commentEnd = statement.indexOf("*/", index + 2);
      if (commentEnd < 0) return statement.slice(index);
      index = commentEnd + 2;
      continue;
    }
    break;
  }
  return statement.slice(index);
}

function isIgnoredLoadStatement(statement) {
  return /^(PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i.test(stripLeadingSqlComments(statement));
}

function normalizeSqlResponse(response) {
  return {
    columns: response.columns,
    rows: response.rows.map((row) => row.map(normalizeSqlValue)),
    rows_affected: response.rows_affected.toString(),
    last_insert_rowid: response.last_insert_rowid.toString(),
    truncated: response.truncated,
    routed_operation_id: optionalText(response.routed_operation_id)
  };
}

function normalizeTablePreview(preview) {
  return {
    database_id: preview.database_id,
    table_name: preview.table_name,
    columns: preview.columns,
    rows: preview.rows.map((row) => row.map(normalizeSqlValue)),
    offset: preview.offset,
    limit: preview.limit,
    total_count: preview.total_count.toString(),
    truncated: preview.truncated
  };
}

function normalizeTableDescription(description) {
  return {
    database_id: description.database_id,
    table_name: description.table_name,
    object_type: normalizeObjectType(description.object_type),
    schema_sql: optionalText(description.schema_sql),
    columns: description.columns,
    indexes: description.indexes.map((index) => ({
      ...index,
      schema_sql: optionalText(index.schema_sql),
      columns: index.columns.map((column) => ({ ...column, cid: column.cid.toString(), name: optionalText(column.name) }))
    })),
    triggers: description.triggers.map((trigger) => ({ ...trigger, schema_sql: optionalText(trigger.schema_sql) })),
    foreign_keys: description.foreign_keys.map((key) => ({ ...key, to_column: optionalText(key.to_column) }))
  };
}

function normalizeDatabaseTable(table) {
  return {
    name: table.name,
    object_type: normalizeObjectType(table.object_type),
    schema_sql: optionalText(table.schema_sql)
  };
}

function tableSummaryEntry(description, preview) {
  return {
    table_name: preview.table_name,
    object_type: description.object_type,
    row_count: preview.total_count,
    column_count: description.columns.length,
    columns: preview.columns,
    index_count: description.indexes.length,
    trigger_count: description.triggers.length,
    foreign_key_count: description.foreign_keys.length
  };
}

function databaseStats(tableSummaries) {
  const totals = tableSummaries.reduce((next, table) => ({
    table_count: next.table_count + (table.object_type === "view" ? 0 : 1),
    view_count: next.view_count + (table.object_type === "view" ? 1 : 0),
    row_count: next.row_count + BigInt(table.row_count),
    column_count: next.column_count + table.column_count,
    index_count: next.index_count + table.index_count,
    trigger_count: next.trigger_count + table.trigger_count,
    foreign_key_count: next.foreign_key_count + table.foreign_key_count
  }), {
    table_count: 0,
    view_count: 0,
    row_count: 0n,
    column_count: 0,
    index_count: 0,
    trigger_count: 0,
    foreign_key_count: 0
  });
  return {
    table_count: totals.table_count,
    view_count: totals.view_count,
    row_count: totals.row_count.toString(),
    column_count: totals.column_count,
    index_count: totals.index_count,
    trigger_count: totals.trigger_count,
    foreign_key_count: totals.foreign_key_count
  };
}

function normalizeDatabaseSummary(summary) {
  return {
    database_id: summary.database_id,
    role: normalizeRole(summary.role),
    status: normalizeStatus(summary.status),
    logical_size_bytes: summary.logical_size_bytes.toString(),
    archived_at_ms: optionalBigIntText(summary.archived_at_ms),
    deleted_at_ms: optionalBigIntText(summary.deleted_at_ms)
  };
}

function normalizeCanisterHealth(health) {
  return {
    cycles_balance: health.cycles_balance.toString()
  };
}

function normalizeDatabaseMember(member) {
  return {
    database_id: member.database_id,
    principal: member.principal,
    role: normalizeRole(member.role),
    created_at_ms: member.created_at_ms.toString()
  };
}

function normalizeDatabaseShardPlacement(placement) {
  return {
    database_id: placement.database_id,
    shard_id: placement.shard_id,
    canister_id: optionalText(placement.canister_id),
    mount_id: optionalNumber(placement.mount_id),
    status: normalizeStatus(placement.status),
    schema_version: placement.schema_version,
    created_at_ms: placement.created_at_ms.toString(),
    updated_at_ms: placement.updated_at_ms.toString()
  };
}

function normalizeDatabaseShardInfo(shard) {
  return {
    shard_id: shard.shard_id,
    canister_id: shard.canister_id,
    status: shard.status,
    max_databases: Number(shard.max_databases),
    assigned_databases: shard.assigned_databases.toString(),
    created_at_ms: shard.created_at_ms.toString(),
    updated_at_ms: shard.updated_at_ms.toString()
  };
}

function normalizeDatabaseShardStatus(status) {
  return {
    shard: normalizeDatabaseShardInfo(status.shard),
    canister_status: status.canister_status,
    cycles_balance: status.cycles_balance.toString(),
    memory_size_bytes: status.memory_size_bytes.toString(),
    idle_cycles_burned_per_day: status.idle_cycles_burned_per_day.toString(),
    module_hash: optionalBytesHex(status.module_hash)
  };
}

function normalizeDatabaseShardMaintenanceReport(report) {
  return {
    available_slots: report.available_slots.toString(),
    inspected_shards: report.inspected_shards.map(normalizeDatabaseShardStatus),
    actions: report.actions.map((action) => ({
      action: action.action,
      database_canister_id: optionalText(action.database_canister_id),
      shard_id: optionalText(action.shard_id),
      cycles: action.cycles.toString(),
      reason: action.reason
    }))
  };
}

function normalizeShardOperationInfo(operation) {
  return {
    operation_id: operation.operation_id,
    operation_kind: operation.operation_kind,
    target: optionalText(operation.target),
    request_hash: bytesToHex(operation.request_hash),
    status: normalizeRoutedOperationStatus(operation.status),
    error: optionalText(operation.error),
    created_at_ms: operation.created_at_ms.toString(),
    updated_at_ms: operation.updated_at_ms.toString()
  };
}

function normalizeRoutedOperationInfo(operation) {
  return {
    operation_id: operation.operation_id,
    database_id: operation.database_id,
    database_canister_id: operation.database_canister_id,
    method: operation.method,
    request_hash: bytesToHex(operation.request_hash),
    status: normalizeRoutedOperationStatus(operation.status),
    error: optionalText(operation.error),
    created_at_ms: operation.created_at_ms.toString(),
    updated_at_ms: operation.updated_at_ms.toString()
  };
}

function normalizeDatabaseUsage(usage) {
  return {
    database_id: usage.database_id,
    status: normalizeStatus(usage.status),
    logical_size_bytes: usage.logical_size_bytes.toString(),
    max_logical_size_bytes: usage.max_logical_size_bytes.toString(),
    usage_event_count: usage.usage_event_count.toString()
  };
}

function normalizeDatabaseUsageEventSummary(summary) {
  return {
    method: summary.method,
    operation: optionalText(summary.operation),
    success: summary.success,
    event_count: summary.event_count.toString(),
    total_cycles_delta: summary.total_cycles_delta.toString(),
    total_rows_returned: summary.total_rows_returned.toString(),
    total_rows_affected: summary.total_rows_affected.toString(),
    last_created_at_ms: summary.last_created_at_ms.toString()
  };
}

function databaseRoleVariant(role) {
  if (role === "owner") return { Owner: null };
  if (role === "writer") return { Writer: null };
  if (role === "reader") return { Reader: null };
  throw new Error("database role must be reader, writer, or owner");
}

function routedOperationStatusVariant(status) {
  if (status === "applied") return { Applied: null };
  return { Failed: null };
}

function serviceIdentityOptions(command) {
  return {
    identityPem: command.serviceIdentityPem,
    identityPemFile: command.serviceIdentityPemFile,
    identityJson: command.serviceIdentityJson,
    identityJsonFile: command.serviceIdentityJsonFile,
    identityType: command.serviceIdentityType,
    identityPrincipal: command.serviceIdentityPrincipal
  };
}

function assertExpectedIdentityPrincipal(identity, expectedPrincipal, label) {
  if (!expectedPrincipal) return identity;
  const expected = requiredNonEmptyString(expectedPrincipal, `${label} principal`);
  const actual = identity.getPrincipal().toText();
  if (actual !== expected) {
    throw new Error(`${label} principal mismatch: expected ${expected}, got ${actual}`);
  }
  return identity;
}

function normalizeRole(role) {
  if ("Owner" in role) return "owner";
  if ("Writer" in role) return "writer";
  if ("Reader" in role) return "reader";
  throw new Error(`unknown database role variant: ${variantKeys(role)}`);
}

function normalizeStatus(status) {
  if ("Deleted" in status) return "deleted";
  if ("Archived" in status) return "archived";
  if ("Archiving" in status) return "archiving";
  if ("Restoring" in status) return "restoring";
  if ("Hot" in status) return "hot";
  throw new Error(`unknown database status variant: ${variantKeys(status)}`);
}

function normalizeRoutedOperationStatus(status) {
  if ("Applied" in status) return "applied";
  if ("Failed" in status) return "failed";
  if ("Unknown" in status) return "unknown";
  if ("Pending" in status) return "pending";
  throw new Error(`unknown routed operation status variant: ${variantKeys(status)}`);
}

function normalizeObjectType(objectType) {
  if ("View" in objectType) return "view";
  if ("Table" in objectType) return "table";
  throw new Error(`unknown database object type variant: ${variantKeys(objectType)}`);
}

function variantKeys(variant) {
  return Object.keys(variant).join("|") || "empty";
}

function unwrapResult(result, method) {
  if ("Err" in result) throw new Error(result.Err);
  if ("Ok" in result) return result.Ok;
  throw new Error(`${method} returned an invalid result`);
}

function option(value) {
  return value === null || value === undefined ? [] : [value];
}

function optionalText(value) {
  return Array.isArray(value) && value.length > 0 ? value[0] : null;
}

function optionalNumber(value) {
  return Array.isArray(value) && value.length > 0 ? Number(value[0]) : null;
}

function optionalBigIntText(value) {
  return Array.isArray(value) && value.length > 0 ? value[0].toString() : null;
}

function optionalBytesHex(value) {
  return Array.isArray(value) && value.length > 0 ? bytesToHex(value[0]) : null;
}

function identityFromJson(json, identityType) {
  if (identityType === "ed25519") return Ed25519KeyIdentity.fromJSON(json);
  if (identityType === "secp256k1") return Secp256k1KeyIdentity.fromJSON(json);
  try {
    return Secp256k1KeyIdentity.fromJSON(json);
  } catch (_secpError) {
    return Ed25519KeyIdentity.fromJSON(json);
  }
}

async function readOptionalText(path) {
  return path ? (await readFile(path, "utf8")).trim() : "";
}

async function readOptionalSecretText(path, label) {
  if (!path) return "";
  assertOwnerOnlyFileMode(path, label);
  const text = await readOptionalText(path);
  if (text.length === 0) throw new Error(`${label} must be a non-empty string`);
  return text;
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${optionName} requires a value`);
  return value;
}

function requiredConfig(value, label, envName) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`missing ${label}; pass --${label.toLowerCase().replace(/\s+/g, "-")} or set ${envName}`);
  return trimmed;
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requiredArg(value, label) {
  if (!value) throw new Error(`missing ${label}`);
  return value;
}

function filePathArg(value, label = "file") {
  const filePath = requiredArg(value, label);
  if (filePath.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return filePath;
}

function databaseIdArg(value) {
  const databaseId = requiredArg(value, "database_id").trim();
  if (!databaseId) throw new Error("database_id must be a non-empty string");
  return databaseId;
}

function tableNameArg(value) {
  const tableName = requiredArg(value, "table_name");
  if (tableName.trim().length === 0) throw new Error("table_name must be a non-empty string");
  return tableName;
}

function optionalTableNameArg(value) {
  if (value === undefined || value === null) return null;
  return tableNameArg(value);
}

function operationIdArg(value) {
  const operationId = requiredArg(value, "operation_id");
  if (operationId.trim().length === 0) throw new Error("operation_id must be a non-empty string");
  return operationId;
}

function idempotencyKeyArg(value) {
  const idempotencyKey = requiredArg(value, "idempotency_key").trim();
  if (!idempotencyKey) throw new Error("idempotency_key must be a non-empty string");
  return idempotencyKey;
}

function databaseCanisterIdArg(value) {
  const databaseCanisterId = requiredArg(value, "database_canister_id").trim();
  if (!databaseCanisterId) throw new Error("database_canister_id must be a non-empty string");
  return databaseCanisterId;
}

function parseIdentityType(source) {
  const value = source.toLowerCase();
  if (value === "auto" || value === "ed25519" || value === "secp256k1") return value;
  throw new Error("identity-type must be auto, ed25519, or secp256k1");
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

function parseDatabaseRole(source) {
  const value = source.toLowerCase();
  if (value === "owner" || value === "writer" || value === "reader") return value;
  throw new Error("role must be reader, writer, or owner");
}

function grantablePrincipal(source) {
  const principal = memberPrincipal(source);
  if (principal === ANONYMOUS_PRINCIPAL) throw new Error("anonymous principal cannot be granted database access");
  return principal;
}

function memberPrincipal(source) {
  const principal = source.trim();
  if (!principal) throw new Error("database member principal must be a non-empty string");
  try {
    Principal.fromText(principal);
  } catch {
    throw new Error("database member principal must be a valid principal");
  }
  return principal;
}

function parseNonNegativeInteger(source, label) {
  if (!/^\d+$/.test(source)) throw new Error(`${label} must be a non-negative integer`);
  const value = Number(source);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds JS safe integer range`);
  return value;
}

function parseRowLimit(source, label) {
  const value = parseNonNegativeInteger(source, label);
  if (value < 1 || value > MAX_SQL_ROWS) throw new Error(`${label} must be an integer from 1 to ${MAX_SQL_ROWS}`);
  return value;
}

function parseNat32Integer(source, label) {
  const value = parseNonNegativeInteger(source, label);
  if (value > MAX_NAT32) throw new Error(`${label} must be an integer from 0 to ${MAX_NAT32}`);
  return value;
}

function parseNatBigInt(source, label) {
  if (!/^\d+$/.test(source)) throw new Error(`${label} must be a non-negative integer`);
  return BigInt(source);
}

function parseNat16(source, label) {
  const value = parseNonNegativeInteger(source, label);
  if (value > 65535) throw new Error(`${label} exceeds nat16 range`);
  return value;
}

function parseSnapshotHashHex(source, label) {
  const value = source.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a 64-character SHA-256 hex string`);
  return value;
}

function parseReconcileStatus(source) {
  const value = source.toLowerCase();
  if (value === "applied" || value === "failed") return value;
  throw new Error("status must be applied or failed");
}

function parseJsonArray(source, label) {
  const value = parseJson(source, label);
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array`);
  return value;
}

function parseJsonSqlArgs(source, label) {
  const value = parseJson(source, label);
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  throw new Error(`${label} must be a JSON array or object`);
}

function parseSqlStatementsJson(source) {
  const value = parseJsonArray(source, "statements");
  return value.map(normalizeStatement);
}

function normalizeStatement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.sql !== "string") {
    throw new Error("each statement must be an object with sql");
  }
  if (value.params === undefined) return { sql: value.sql, params: [] };
  if (Array.isArray(value.params)) return { sql: value.sql, params: value.params };
  if (value.params && typeof value.params === "object") return { sql: value.sql, params: value.params };
  throw new Error("statement params must be a JSON array or object");
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`invalid JSON ${label}: ${message}`);
  }
}

function arrayValue(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function byteValue(value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error("blob bytes must be integers from 0 to 255");
  return value;
}

function hexToBytes(value) {
  const hex = value.trim();
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("root-key must be hex bytes");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function isLocalHost(host) {
  return host.includes("127.0.0.1") || host.includes("localhost");
}

function localReplicaFetchForHost(host) {
  if (!isLocalHost(host)) return undefined;
  return async (input, init) => {
    const retryDelaysMs = [0, 100, 250, 500, 1_000, 2_000];
    let lastError = null;
    for (const retryDelayMs of retryDelaysMs) {
      if (retryDelayMs > 0) await delay(retryDelayMs);
      try {
        return await fetchLocalReplica(input, init);
      } catch (error) {
        lastError = error;
        if (process.env.ICPDB_DEBUG_FETCH) console.error(`local replica fetch error: ${errorMessage(error)}`);
      }
    }
    throw lastError;
  };
}

async function fetchLocalReplica(input, init) {
  if (input instanceof Request) {
    const url = rewriteLocalReplicaApiUrl(new URL(input.url));
    const headers = new Headers(input.headers);
    headers.delete("host");
    const body = input.method === "GET" || input.method === "HEAD" ? undefined : await input.clone().arrayBuffer();
    if (process.env.ICPDB_DEBUG_FETCH) console.error(`local replica fetch: ${url.href}`);
    return await fetch(url.href, { ...init, method: input.method, headers, body, signal: input.signal });
  }
  return await fetch(localReplicaUrl(input), init);
}

function localReplicaUrl(input) {
  const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url);
  const nextUrl = rewriteLocalReplicaApiUrl(url);
  if (process.env.ICPDB_DEBUG_FETCH) console.error(`local replica fetch: ${nextUrl.href}`);
  return nextUrl.href;
}

function rewriteLocalReplicaApiUrl(url) {
  if (/^\/+api\/v[34]\//.test(url.pathname)) {
    url.pathname = url.pathname.replace(/^\/+api\/v[34]\//, "/api/v2/");
  }
  return url;
}

function stableJson(value) {
  return JSON.stringify(value, (_key, nextValue) => typeof nextValue === "bigint" ? nextValue.toString() : nextValue, 2);
}

function envOutput(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.env_lines)) {
    throw new Error("format env is only available for service identity or database id output");
  }
  return value.env_lines.join("\n");
}

export function formatIdentityCommandOutput(result, command) {
  if (command.outputFormat === "env" && command.archive) return formatSnapshotInfoEnv(result);
  if (command.outputFormat === "env" && command.snapshotInfo) return formatSnapshotInfoEnv(result);
  if (command.outputFormat === "env") return envOutput(result);
  if (command.outputFormat === "json") return stableJson(result);
  return formatCliOutput(result, command, command.outputFormat);
}

function formatSnapshotInfoEnv(value) {
  return formatIdentityEnv({
    ICPDB_SNAPSHOT_DATABASE_ID: value.database_id,
    ICPDB_SNAPSHOT_FILE: value.file,
    ICPDB_SNAPSHOT_SIZE_BYTES: value.size_bytes,
    ICPDB_SNAPSHOT_HASH: value.snapshot_hash
  }).trimEnd();
}

async function runIdentityShell(command, actor, identity, input, output) {
  if (command.shellSql) {
    await runIdentityShellLine(command.shellSql, command, actor, identity, output);
    return;
  }
  const reader = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  try {
    for (;;) {
      const line = await reader.question("icpdb> ");
      const shouldQuit = await runIdentityShellLine(line, command, actor, identity, output);
      if (shouldQuit) break;
    }
  } catch (error) {
    if (error?.code !== "ERR_USE_AFTER_CLOSE") throw error;
  } finally {
    reader.close();
  }
}

async function runIdentityShellLine(line, command, actor, identity, output) {
  const nextCommand = identityShellLineCommand(line, command);
  if (!nextCommand) return false;
  if (nextCommand.help) {
    output.write(`${identityShellUsage(nextCommand.helpTopic ?? "")}\n`);
    return false;
  }
  if (nextCommand.quit) return true;
  const result = await executeIdentityCommand(nextCommand, actor, identity);
  output.write(nextCommand.dump ? String(result) : `${formatIdentityCommandOutput(result, nextCommand)}\n`);
  return false;
}

export async function writeIdentityEnvOutputFile(path, value) {
  if (!value || typeof value !== "object" || !value.env || typeof value.env !== "object" || Array.isArray(value.env)) {
    throw new Error("env output file requires structured env output");
  }
  const existing = await readExistingIdentityEnvFile(path);
  const merged = { ...existing, ...value.env };
  await writeFile(path, formatIdentityEnv(merged), { encoding: "utf8", mode: SERVICE_ENV_FILE_MODE });
  await chmod(path, SERVICE_ENV_FILE_MODE);
}

export async function writeIdentityEnvOutputFileOrDelete(path, value, command, actor) {
  try {
    await writeIdentityEnvOutputFile(path, value);
  } catch (error) {
    await deleteCreatedIdentityDatabaseAfterOutputFailure(value, command, actor);
    throw error;
  }
}

async function deleteCreatedIdentityDatabaseAfterOutputFailure(value, command, actor) {
  if (!actor || !command || (!command.createDatabase && !command.provisionServiceDatabase)) return;
  if (!value || typeof value !== "object" || typeof value.database_id !== "string" || !value.database_id) return;
  try {
    unwrapResult(await actor.delete_database(value.database_id), "delete_database");
  } catch (_deleteError) {
    // Preserve the env output failure; delete is best-effort cleanup.
  }
}

async function readExistingIdentityEnvFile(path) {
  try {
    return parseIdentityEnvFile(await readFile(path, "utf8"), path);
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw error;
  }
}

function formatIdentityEnv(env) {
  return `${Object.entries(env)
    .filter(([_key, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join("\n")}\n`;
}

async function main() {
  const command = parseIdentityCliArgs(process.argv.slice(2));
  if (command.help) {
    console.log(command.helpTopic === undefined ? usage() : commandUsage(command.helpTopic));
    return;
  }
  if (command.generateIdentity) {
    const result = await executeIdentityCommand(command, null, null);
    if (command.envOutFile) {
      await writeIdentityEnvOutputFile(command.envOutFile, result);
      return;
    }
    console.log(formatIdentityCommandOutput(result, command));
    return;
  }
  if (command.connectionUrl) {
    const result = await executeIdentityCommand(command, null, null);
    if (command.envOutFile) {
      await writeIdentityEnvOutputFile(command.envOutFile, result);
      return;
    }
    console.log(formatIdentityCommandOutput(result, command));
    return;
  }
  if (command.snapshotInfo) {
    const result = await executeIdentityCommand(command, null, null);
    console.log(formatIdentityCommandOutput(result, command));
    return;
  }
  const identity = await loadServiceIdentity(command);
  const actor = command.principal || command.inspectEnv ? null : await createIdentityActor(command, identity);
  if (command.shell) {
    await runIdentityShell(command, actor, identity, process.stdin, process.stdout);
    return;
  }
  const result = await executeIdentityCommand(command, actor, identity);
  if (command.dump) {
    process.stdout.write(String(result));
    return;
  }
  if (command.envOutFile) {
    await writeIdentityEnvOutputFileOrDelete(command.envOutFile, result, command, actor);
    return;
  }
  console.log(formatIdentityCommandOutput(result, command));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `\nCaused by: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}
