// Where: scripts/icpdb-http-shell.mjs
// What: Turso-like interactive shell parser and runner for the ICPDB HTTP CLI.
// Why: Shell dot-commands are a user-facing workflow distinct from top-level command parsing.

import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { parseNonNegativeInteger, requiredArg } from "./icpdb-http-command-utils.mjs";
import { executeShellCommand } from "./icpdb-http-dispatch.mjs";
import { formatCliOutput } from "./icpdb-http-output.mjs";

export function shellLineCommand(line, context) {
  const source = line.trim();
  if (!source) return null;
  if (source === ".help") return { help: true };
  if (source.startsWith(".help ")) return { help: true, helpTopic: source.slice(".help ".length).trim() };
  if (source === ".quit" || source === ".exit") return { quit: true };
  if (source === ".tables") return databaseRequest(context, "/v1/tables/list");
  if (source === ".usage") return databaseRequest(context, "/v1/usage");
  if (source === ".billing") return databaseRequest(context, "/v1/billing");
  if (source === ".payments") return databaseRequest(context, "/v1/payments/list");
  if (source === ".placement") return databaseRequest(context, "/v1/placements/get");
  if (source.startsWith(".operation ")) {
    return {
      ...databaseRequest(context, "/v1/operations/get"),
      body: {
        database_id: context.databaseId,
        operation_id: requiredArg(source.slice(".operation ".length).trim(), "operation_id")
      }
    };
  }
  if (source === ".usage-events") return databaseRequest(context, "/v1/usage/events");
  if (source === ".tokens") return databaseRequest(context, "/v1/tokens/list");
  if (source === ".members") return databaseRequest(context, "/v1/members/list");
  if (source === ".views") return databaseFlag(context, "databaseViews");
  if (source === ".stats") return databaseFlag(context, "stats");
  if (source.startsWith(".describe ")) {
    return {
      ...databaseRequest(context, "/v1/tables/describe"),
      body: {
        database_id: context.databaseId,
        table_name: source.slice(".describe ".length).trim()
      }
    };
  }
  if (source.startsWith(".preview ")) return previewCommand(source, context);
  if (source.startsWith(".columns ")) return tableFlag(source, context, ".columns ", "tableColumns");
  if (source.startsWith(".indexes ")) return tableFlag(source, context, ".indexes ", "tableIndexes");
  if (source.startsWith(".triggers ")) return tableFlag(source, context, ".triggers ", "tableTriggers");
  if (source.startsWith(".foreign-keys ")) return tableFlag(source, context, ".foreign-keys ", "tableForeignKeys");
  if (source === ".inspect") return inspectCommand(context, null, false, context.maxRows, 0);
  if (source === ".inspect --access") return inspectCommand(context, null, true, context.maxRows, 0);
  if (source.startsWith(".inspect ")) return inspectTableCommand(source, context);
  if (source === ".schema") return schemaCommand(context, null);
  if (source.startsWith(".schema ")) return schemaCommand(context, source.slice(".schema ".length).trim());
  if (source === ".dump") return dumpCommand(context, null);
  if (source.startsWith(".dump ")) return dumpCommand(context, source.slice(".dump ".length).trim());
  return sqlCommand(source, context);
}

export async function runShell(command, input, output, fetchImpl, shellHandlers) {
  if (command.shellSql) {
    await runShellSql(command, output, fetchImpl, shellHandlers);
    return;
  }
  const reader = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  try {
    if (!input.isTTY) {
      for await (const line of reader) {
        const shouldQuit = await runShellLine(line, command, output, fetchImpl, shellHandlers);
        if (shouldQuit) break;
      }
      return;
    }
    while (true) {
      const line = await reader.question("icpdb> ");
      const shouldQuit = await runShellLine(line, command, output, fetchImpl, shellHandlers);
      if (shouldQuit) break;
    }
  } finally {
    reader.close();
  }
}

export async function runShellSql(command, output, fetchImpl, shellHandlers) {
  await runShellLine(command.shellSql, command, output, fetchImpl, shellHandlers);
}

export function shellUsage(topic = "") {
  const command = topic.trim().replace(/^\./, "");
  if (!command) return shellUsageLines().join("\n");
  if (command === "sql") return ["SQL:", ...sqlUsageLines()].join("\n");
  const matches = shellUsageLines().filter((line) => shellUsageLineMatchesCommand(line, command));
  if (matches.length === 0) {
    throw new Error(`unknown shell help command: ${topic}`);
  }
  return ["Shell commands:", ...matches].join("\n");
}

function shellUsageLines() {
  return [
    "Shell commands:",
    "  .help",
    "  .help <command>",
    "  .help sql",
    "Database inspection commands:",
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
    "  .inspect --access (owner token)",
    "  .dump [table_name]",
    "Account and lifecycle commands:",
    "  .usage",
    "  .billing (owner token)",
    "  .payments (owner token)",
    "  .placement",
    "  .operation <operation_id>",
    "  .usage-events",
    "  .tokens (owner token)",
    "  .members (owner token)",
    "Navigation commands:",
    "  .quit",
    "SQL:",
    ...sqlUsageLines()
  ];
}

function sqlUsageLines() {
  return [
    "  SELECT, WITH, PRAGMA, and EXPLAIN statements run as read queries.",
    "  Other SQL statements run as writes.",
    "  Shell write SQL auto-generates an idempotency key for remote writes.",
    "  Pass --idempotency-key before shell to set the generated key prefix."
  ];
}

function shellUsageLineMatchesCommand(line, command) {
  const trimmed = line.trim();
  return trimmed === `.${command}` || trimmed.startsWith(`.${command} `);
}

async function runShellLine(line, command, output, fetchImpl, shellHandlers) {
  const nextCommand = shellLineCommand(line, command);
  if (!nextCommand) return false;
  if (nextCommand.help) {
    output.write(`${shellUsage(nextCommand.helpTopic ?? "")}\n`);
    return false;
  }
  if (nextCommand.quit) return true;
  const result = await executeShellCommand(nextCommand, shellHandlers(fetchImpl));
  output.write(nextCommand.dump ? result : `${formatCliOutput(result, nextCommand, command.outputFormat ?? "table")}\n`);
  return false;
}

function databaseRequest(context, endpoint) {
  return {
    baseUrl: context.baseUrl,
    token: context.token,
    endpoint,
    body: { database_id: context.databaseId }
  };
}

function databaseFlag(context, flag) {
  return {
    [flag]: true,
    baseUrl: context.baseUrl,
    token: context.token,
    databaseId: context.databaseId
  };
}

function tableFlag(source, context, prefix, flag) {
  return {
    ...databaseFlag(context, flag),
    tableName: source.slice(prefix.length).trim()
  };
}

function previewCommand(source, context) {
  const parts = source.slice(".preview ".length).trim().split(/\s+/);
  const [tableName, limitSource, offsetSource] = parts;
  return {
    ...databaseRequest(context, "/v1/tables/preview"),
    body: {
      database_id: context.databaseId,
      table_name: requiredArg(tableName, "table_name"),
      limit: limitSource ? parseNonNegativeInteger(limitSource, "preview limit") : context.maxRows,
      offset: offsetSource ? parseNonNegativeInteger(offsetSource, "preview offset") : 0
    }
  };
}

function inspectTableCommand(source, context) {
  const parts = source.slice(".inspect ".length).trim().split(/\s+/);
  const [tableName, limitSource, offsetSource] = parts;
  return inspectCommand(
    context,
    requiredArg(tableName, "table_name"),
    false,
    limitSource ? parseNonNegativeInteger(limitSource, "inspect limit") : context.maxRows,
    offsetSource ? parseNonNegativeInteger(offsetSource, "inspect offset") : 0
  );
}

function inspectCommand(context, tableName, includeAccess, limit, offset) {
  return {
    ...databaseFlag(context, "inspect"),
    tableName,
    includeAccess,
    limit,
    offset
  };
}

function schemaCommand(context, tableName) {
  return {
    ...databaseFlag(context, "schema"),
    tableName
  };
}

function dumpCommand(context, tableName) {
  return {
    ...databaseFlag(context, "dump"),
    tableName,
    limit: context.maxRows
  };
}

function sqlCommand(source, context) {
  const readSql = isReadSql(source);
  return {
    baseUrl: context.baseUrl,
    token: context.token,
    endpoint: readSql ? "/v1/sql/query" : "/v1/sql/execute",
    body: {
      database_id: context.databaseId,
      sql: source,
      params: [],
      max_rows: context.maxRows
    },
    ...writeIdempotencyKey(readSql, context)
  };
}

function writeIdempotencyKey(readSql, context) {
  if (readSql) return {};
  const prefix = context.idempotencyKeyPrefix || `shell-${context.databaseId}`;
  return { idempotencyKey: `${prefix}-${randomUUID()}` };
}

function isReadSql(sql) {
  const normalized = sql.replace(/^\/\*[^]*?\*\//, "").trim().toLowerCase();
  return (
    normalized.startsWith("select") ||
    normalized.startsWith("with") ||
    normalized.startsWith("pragma") ||
    normalized.startsWith("explain")
  );
}
