// Where: scripts/icpdb-http-command-builder.mjs
// What: Top-level command builder for the ICPDB HTTP CLI.
// Why: Command parsing is a product surface for Turso-like workflows and should be isolated.

import { buildAccountCommand } from "./icpdb-http-account-command.mjs";
import { buildCanisterCommand, CANISTER_COMMANDS } from "./icpdb-http-canister-command.mjs";
import { buildDataCommand } from "./icpdb-http-data-command.mjs";
import { filePathArg, parseCliArgs as parseOptions, requiredConfig } from "./icpdb-http-command-utils.mjs";

export function parseCliArgs(args, env = process.env) {
  const parsed = parseOptions(args, env);
  if (parsed.help) return parsed;
  if (parsed.positional[0] === "help") {
    return { help: true, helpTopic: parsed.positional.slice(1).join(" ") };
  }
  return buildCommand(parsed.positional, parsed.options);
}

export function buildCommand(positional, options) {
  const normalized = normalizeHttpDatabasePositional(positional, options);
  assertHttpPositionalCount(normalized, options);
  const [command, databaseId, tableNameOrSql, ...rest] = normalized;
  if (!isKnownHttpCommand(command, options)) throw new Error(`unknown command: ${command}`);
  if (CANISTER_COMMANDS.has(command)) {
    return buildCanisterCommand(command, databaseId, tableNameOrSql, rest, options);
  }
  if (command === "snapshot-info") {
    if (options.envOutFile) throw new Error("--env-out is only valid for create-db");
    return {
      snapshotInfo: true,
      command,
      outputFormat: options.outputFormat,
      filePath: filePathArg(databaseId)
    };
  }
  const auth = {
    baseUrl: requiredConfig(options.baseUrl, "base URL", "ICPDB_HTTP_BASE_URL"),
    token: requiredConfig(options.token, "token", "ICPDB_TOKEN")
  };
  const dataCommand = buildDataCommand(command, databaseId, tableNameOrSql, rest, options, auth);
  if (options.outputFormat === "env" && dataCommand) throw new Error("--format env is only valid for create-db, archive, or snapshot-info");
  if (dataCommand) return withWaitOption(dataCommand, options);
  const accountCommand = buildAccountCommand(command, databaseId, tableNameOrSql, rest, options, auth);
  if (options.envOutFile && accountCommand?.archive) throw new Error("--env-out is only valid for create-db");
  if (options.outputFormat === "env" && !accountCommand?.archive) {
    throw new Error("--format env is only valid for create-db, archive, or snapshot-info");
  }
  if (accountCommand) return withWaitOption(accountCommand, options);
  throw new Error(`unknown command: ${command}`);
}

function normalizeHttpDatabasePositional(positional, options) {
  const [command, ...args] = positional;
  if (CANISTER_COMMANDS.has(command)) return positional;
  const databaseId = (options.databaseId ?? "").trim();
  if (!databaseId) return positional;
  if (command === "query" || command === "execute" || command === "scalar") {
    if (args.length === 0 || looksLikeSqlStart(args[0])) return [command, databaseId, ...args];
    return positional;
  }
  if (command === "shell") return [command, databaseId, ...args];
  const maxOmittedArgs = maxOmittedDatabaseArgs(command, options);
  if (maxOmittedArgs === null) return positional;
  assertConfiguredDatabaseOmittedArgs(command, args, maxOmittedArgs);
  return [command, databaseId, ...args];
}

function maxOmittedDatabaseArgs(command, options) {
  if (NO_EXTRA_DATABASE_COMMANDS.has(command)) return 0;
  if (ONE_EXTRA_DATABASE_COMMANDS.has(command)) return 1;
  if (TWO_EXTRA_DATABASE_COMMANDS.has(command)) return 2;
  if (OPTIONAL_ONE_EXTRA_DATABASE_COMMANDS.has(command)) return 1;
  if (command === "batch") return options.statements.length > 0 || options.statementsFilePath ? 0 : 1;
  return null;
}

function assertConfiguredDatabaseOmittedArgs(command, args, maxArgs) {
  if (args.length <= maxArgs) return;
  const selector = "ICPDB_DATABASE_ID or ICPDB_URL";
  const suffix = `when ${selector} selects a database; use --database-id <id> to select another database`;
  if (maxArgs === 0) {
    throw new Error(`${command} accepts no positional arguments ${suffix}`);
  }
  const label = maxArgs === 1 ? "positional argument" : "positional arguments";
  throw new Error(`${command} accepts at most ${maxArgs} ${label} ${suffix}`);
}

function assertHttpPositionalCount(positional, options) {
  const [command, ...args] = positional;
  const maxArgs = maxHttpPositionalArgs(command, options);
  if (maxArgs === null || args.length <= maxArgs) return;
  if (maxArgs === 0) {
    throw new Error(`${command} accepts no positional arguments`);
  }
  const label = maxArgs === 1 ? "positional argument" : "positional arguments";
  throw new Error(`${command} accepts at most ${maxArgs} ${label}`);
}

function maxHttpPositionalArgs(command, options) {
  if (VARIABLE_POSITIONAL_COMMANDS.has(command)) return null;
  if (NO_POSITIONAL_COMMANDS.has(command)) return 0;
  if (ONE_POSITIONAL_COMMANDS.has(command)) return 1;
  if (TWO_POSITIONAL_COMMANDS.has(command)) return 2;
  if (THREE_POSITIONAL_COMMANDS.has(command)) return 3;
  if (command === "batch") return options.statements.length > 0 || options.statementsFilePath ? 1 : 2;
  if (command === "shard-maintain") return 6;
  return null;
}

function isKnownHttpCommand(command, options) {
  return (
    CANISTER_COMMANDS.has(command) ||
    command === "snapshot-info" ||
    VARIABLE_POSITIONAL_COMMANDS.has(command) ||
    maxHttpPositionalArgs(command, options) !== null
  );
}

const NO_EXTRA_DATABASE_COMMANDS = new Set([
  "archive-cancel",
  "billing",
  "delete-db",
  "members",
  "payments",
  "placement",
  "stats",
  "tables",
  "tokens",
  "usage",
  "usage-events",
  "views"
]);

const ONE_EXTRA_DATABASE_COMMANDS = new Set([
  "archive",
  "columns",
  "describe",
  "foreign-keys",
  "indexes",
  "load",
  "migrate",
  "operation",
  "preview",
  "quota",
  "restore",
  "revoke-member",
  "revoke-token",
  "script",
  "triggers"
]);

const TWO_EXTRA_DATABASE_COMMANDS = new Set([
  "create-token",
  "grant-member"
]);

const OPTIONAL_ONE_EXTRA_DATABASE_COMMANDS = new Set([
  "dump",
  "inspect",
  "schema"
]);

const VARIABLE_POSITIONAL_COMMANDS = new Set([
  "execute",
  "query",
  "scalar",
  "shard-reconcile",
  "shell"
]);

const NO_POSITIONAL_COMMANDS = new Set([
  "databases",
  "placements",
  "shard-ops",
  "shards"
]);

const ONE_POSITIONAL_COMMANDS = new Set([
  "archive-cancel",
  "billing",
  "create-db",
  "delete-db",
  "members",
  "payments",
  "placement",
  "shard-status",
  "snapshot-info",
  "stats",
  "tables",
  "tokens",
  "usage",
  "usage-events",
  "views"
]);

const TWO_POSITIONAL_COMMANDS = new Set([
  "archive",
  "columns",
  "describe",
  "dump",
  "foreign-keys",
  "indexes",
  "inspect",
  "load",
  "migrate",
  "operation",
  "operation-reconcile",
  "preview",
  "quota",
  "restore",
  "revoke-member",
  "revoke-token",
  "schema",
  "script",
  "shard-migrate",
  "shard-top-up",
  "triggers"
]);

const THREE_POSITIONAL_COMMANDS = new Set([
  "create-token",
  "grant-member"
]);

function looksLikeSqlStart(value) {
  const sql = stripLeadingSqlComments(value).trimStart().toLowerCase();
  if (!sql) return false;
  return /^(select|with|pragma|explain|insert|update|delete|replace|create|alter|drop|begin|commit|rollback)\b/.test(sql);
}

function stripLeadingSqlComments(source) {
  let value = source;
  while (true) {
    const trimmed = value.trimStart();
    if (trimmed.startsWith("--")) {
      const nextLine = trimmed.indexOf("\n");
      value = nextLine === -1 ? "" : trimmed.slice(nextLine + 1);
    } else if (trimmed.startsWith("/*")) {
      const close = trimmed.indexOf("*/");
      value = close === -1 ? "" : trimmed.slice(close + 2);
    } else {
      return trimmed;
    }
  }
}

function withWaitOption(command, options) {
  if (!options.waitForRoutedOperation) return command;
  if (command.shell || command.load || command.script || command.migrate || command.endpoint === "/v1/sql/execute" || command.endpoint === "/v1/sql/batch") {
    return { ...command, waitForRoutedOperation: true };
  }
  throw new Error("--wait is only valid for execute, batch, script, load, and migrate");
}
