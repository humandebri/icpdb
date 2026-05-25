// Where: scripts/icpdb-http-command-builder.mjs
// What: Top-level command builder for the ICPDB HTTP CLI.
// Why: Command parsing is a product surface for Turso-like workflows and should be isolated.

import { buildAccountCommand } from "./icpdb-http-account-command.mjs";
import { buildCanisterCommand, CANISTER_COMMANDS } from "./icpdb-http-canister-command.mjs";
import { buildDataCommand } from "./icpdb-http-data-command.mjs";
import { parseCliArgs as parseOptions, requiredConfig } from "./icpdb-http-command-utils.mjs";

export function parseCliArgs(args, env = process.env) {
  const parsed = parseOptions(args, env);
  if (parsed.help) return parsed;
  if (parsed.positional[0] === "help") {
    return { help: true, helpTopic: parsed.positional[1] ?? "" };
  }
  return buildCommand(parsed.positional, parsed.options);
}

export function buildCommand(positional, options) {
  const [command, databaseId, tableNameOrSql, ...rest] = positional;
  if (CANISTER_COMMANDS.has(command)) {
    return buildCanisterCommand(command, databaseId, tableNameOrSql, rest, options);
  }
  const auth = {
    baseUrl: requiredConfig(options.baseUrl, "base URL", "ICPDB_HTTP_BASE_URL"),
    token: requiredConfig(options.token, "token", "ICPDB_TOKEN")
  };
  const dataCommand = buildDataCommand(command, databaseId, tableNameOrSql, rest, options, auth);
  if (dataCommand) return dataCommand;
  const accountCommand = buildAccountCommand(command, databaseId, tableNameOrSql, rest, options, auth);
  if (accountCommand) return accountCommand;
  throw new Error(`unknown command: ${command}`);
}
