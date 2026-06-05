// Where: scripts/icpdb-http-shell.mjs
// What: Turso-like interactive shell parser and runner for the ICPDB HTTP CLI.
// Why: Shell dot-commands are a user-facing workflow distinct from top-level command parsing.

import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import {
  grantablePrincipalArg,
  memberPrincipalArg,
  operationIdArg,
  optionalTableNameArg,
  parseDatabaseRole,
  parseNat32Integer,
  parseNonNegativeInteger,
  parseRowLimit,
  parseSnapshotHashHex,
  parseTokenScope,
  requiredArg,
  tableNameArg,
  tokenIdArg,
  tokenNameArg
} from "./icpdb-http-command-utils.mjs";
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
  if (source === ".operation" || source.startsWith(".operation ")) {
    return {
      ...databaseRequest(context, "/v1/operations/get"),
      body: {
        database_id: context.databaseId,
        operation_id: operationIdArg(requiredShellArg(source, ".operation"))
      }
    };
  }
  if (source === ".usage-events") return databaseRequest(context, "/v1/usage/events");
  if (source === ".quota" || source.startsWith(".quota ")) return quotaCommand(source, context);
  if (source === ".tokens") return databaseRequest(context, "/v1/tokens/list");
  if (source === ".create-token" || source.startsWith(".create-token ")) return createTokenCommand(source, context);
  if (source === ".revoke-token" || source.startsWith(".revoke-token ")) return revokeTokenCommand(source, context);
  if (source === ".members") return databaseRequest(context, "/v1/members/list");
  if (source === ".grant-member" || source.startsWith(".grant-member ")) return grantMemberCommand(source, context);
  if (source === ".revoke-member" || source.startsWith(".revoke-member ")) return revokeMemberCommand(source, context);
  if (source === ".views") return databaseFlag(context, "databaseViews");
  if (source === ".stats") return databaseFlag(context, "stats");
  if (source === ".describe" || source.startsWith(".describe ")) {
    return {
      ...databaseRequest(context, "/v1/tables/describe"),
      body: {
        database_id: context.databaseId,
        table_name: tableNameArg(requiredShellArg(source, ".describe"))
      }
    };
  }
  if (source === ".preview" || source.startsWith(".preview ")) return previewCommand(source, context);
  if (source === ".columns" || source.startsWith(".columns ")) return tableFlag(source, context, ".columns ", "tableColumns");
  if (source === ".indexes" || source.startsWith(".indexes ")) return tableFlag(source, context, ".indexes ", "tableIndexes");
  if (source === ".triggers" || source.startsWith(".triggers ")) return tableFlag(source, context, ".triggers ", "tableTriggers");
  if (source === ".foreign-keys" || source.startsWith(".foreign-keys ")) return tableFlag(source, context, ".foreign-keys ", "tableForeignKeys");
  if (source === ".inspect") return inspectCommand(context, null, false, context.maxRows, 0);
  if (source === ".inspect --access") return inspectCommand(context, null, true, context.maxRows, 0);
  if (source.startsWith(".inspect ")) return inspectTableCommand(source, context);
  if (source === ".schema") return schemaCommand(context, null);
  if (source.startsWith(".schema ")) return schemaCommand(context, optionalTableNameArg(optionalShellArg(source, ".schema")));
  if (source === ".dump") return dumpCommand(context, null);
  if (source.startsWith(".dump ")) return dumpCommand(context, optionalTableNameArg(optionalShellArg(source, ".dump")));
  if (source === ".load") return fileCommand(source, context, ".load", "load");
  if (source.startsWith(".load ")) return fileCommand(source, context, ".load", "load");
  if (source === ".script") return fileCommand(source, context, ".script", "script");
  if (source.startsWith(".script ")) return fileCommand(source, context, ".script", "script");
  if (source === ".migrate") return fileCommand(source, context, ".migrate", "migrate");
  if (source.startsWith(".migrate ")) return fileCommand(source, context, ".migrate", "migrate");
  if (source === ".archive") return archiveCommand(source, context);
  if (source.startsWith(".archive ")) return archiveCommand(source, context);
  if (source === ".snapshot-info") return snapshotInfoCommand(source);
  if (source.startsWith(".snapshot-info ")) return snapshotInfoCommand(source);
  if (source === ".restore") return restoreCommand(source, context);
  if (source.startsWith(".restore ")) return restoreCommand(source, context);
  if (source === ".archive-cancel") return archiveCancelCommand(source, context);
  if (source.startsWith(".archive-cancel ")) return archiveCancelCommand(source, context);
  if (source === ".delete-db") return deleteDatabaseCommand(source, context);
  if (source.startsWith(".delete-db ")) return deleteDatabaseCommand(source, context);
  if (source.startsWith(".")) throw new Error(`unknown shell command: ${source}`);
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
    "SQL file commands:",
    "  .load <file|->",
    "  .script <file|->",
    "  .migrate <file|->",
    "  # .load, .script, and .migrate auto-generate idempotency keys for remote writes.",
    "Backup and restore commands:",
    "  .archive <file>",
    "  .snapshot-info <file>",
    "  .restore <file> [expected_sha256]",
    "  .archive-cancel",
    "Account and lifecycle commands:",
    "  .usage",
    "  .billing (owner token)",
    "  .payments (owner token)",
    "  .placement",
    "  .operation <operation_id>",
    "  .usage-events",
    "  .quota <max_logical_size_bytes> (owner token)",
    "  .tokens (owner token)",
    "  .create-token <name> <read|write|owner> (owner token)",
    "  .revoke-token <token_id> (owner token)",
    "  .members (owner token)",
    "  .grant-member <principal> <reader|writer|owner> (owner token)",
    "  .revoke-member <principal> (owner token)",
    "  .delete-db (owner token)",
    "Navigation commands:",
    "  .quit",
    "Argument quoting:",
    "  Table, operation, token, and file arguments accept single quotes, double quotes, and backslash escaping.",
    "SQL:",
    ...sqlUsageLines()
  ];
}

function sqlUsageLines() {
  return [
    "  SELECT, WITH read CTEs, read-only PRAGMA, and EXPLAIN run as read queries.",
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
    tableName: tableNameArg(requiredShellArg(source, prefix.trim()))
  };
}

function previewCommand(source, context) {
  const [tableName, limitSource, offsetSource] = shellWords(source.slice(".preview ".length));
  assertShellWordLimit(source, ".preview", 3);
  return {
    ...databaseRequest(context, "/v1/tables/preview"),
    body: {
      database_id: context.databaseId,
      table_name: tableNameArg(tableName),
      limit: limitSource ? parseRowLimit(limitSource, "preview limit") : context.maxRows,
      offset: offsetSource ? parseNat32Integer(offsetSource, "preview offset") : 0
    }
  };
}

function inspectTableCommand(source, context) {
  const [tableName, limitSource, offsetSource] = shellWords(source.slice(".inspect ".length));
  assertShellWordLimit(source, ".inspect", 3);
  return inspectCommand(
    context,
    tableNameArg(tableName),
    false,
    limitSource ? parseRowLimit(limitSource, "inspect limit") : context.maxRows,
    offsetSource ? parseNat32Integer(offsetSource, "inspect offset") : 0
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

function fileCommand(source, context, dotCommand, flag) {
  const [filePath] = shellWords(source.slice(dotCommand.length));
  assertShellWordLimit(source, dotCommand, 1);
  return {
    ...databaseFlag(context, flag),
    filePath: requiredShellFileValue(filePath, `${dotCommand} file`),
    maxRows: context.maxRows,
    idempotencyKey: shellWriteIdempotencyKey(context),
    ...(context.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
  };
}

function archiveCommand(source, context) {
  const [filePath] = shellWords(source.slice(".archive".length));
  assertShellWordLimit(source, ".archive", 1);
  return {
    ...databaseFlag(context, "archive"),
    filePath: requiredShellFileValue(filePath, ".archive file")
  };
}

function snapshotInfoCommand(source) {
  const [filePath] = shellWords(source.slice(".snapshot-info".length));
  assertShellWordLimit(source, ".snapshot-info", 1);
  return {
    snapshotInfo: true,
    command: "snapshot-info",
    filePath: requiredShellFileValue(filePath, ".snapshot-info file")
  };
}

function restoreCommand(source, context) {
  const [filePath, expectedSnapshotHash] = shellWords(source.slice(".restore".length));
  assertShellWordLimit(source, ".restore", 2);
  return {
    ...databaseFlag(context, "restore"),
    filePath: requiredShellFileValue(filePath, ".restore file"),
    expectedSnapshotHash: expectedSnapshotHash === undefined ? "" : parseSnapshotHashHex(expectedSnapshotHash, "expected_sha256")
  };
}

function quotaCommand(source, context) {
  const [quotaBytes] = shellWords(source.slice(".quota".length));
  assertShellWordLimit(source, ".quota", 1);
  return {
    ...databaseRequest(context, "/v1/quota/set"),
    body: {
      database_id: context.databaseId,
      max_logical_size_bytes: parseNonNegativeInteger(requiredArg(quotaBytes, "max_logical_size_bytes"), "max_logical_size_bytes")
    }
  };
}

function createTokenCommand(source, context) {
  const [name, scope] = shellWords(source.slice(".create-token".length));
  assertShellWordLimit(source, ".create-token", 2);
  return {
    ...databaseRequest(context, "/v1/tokens/create"),
    body: {
      database_id: context.databaseId,
      name: tokenNameArg(name),
      scope: parseTokenScope(requiredArg(scope, "scope"))
    }
  };
}

function revokeTokenCommand(source, context) {
  const [tokenId] = shellWords(source.slice(".revoke-token".length));
  assertShellWordLimit(source, ".revoke-token", 1);
  return {
    ...databaseRequest(context, "/v1/tokens/revoke"),
    body: {
      database_id: context.databaseId,
      token_id: tokenIdArg(tokenId)
    }
  };
}

function grantMemberCommand(source, context) {
  const [principal, role] = shellWords(source.slice(".grant-member".length));
  assertShellWordLimit(source, ".grant-member", 2);
  return {
    ...databaseRequest(context, "/v1/members/grant"),
    body: {
      database_id: context.databaseId,
      principal: grantablePrincipalArg(principal),
      role: parseDatabaseRole(requiredArg(role, "role"))
    }
  };
}

function revokeMemberCommand(source, context) {
  const [principal] = shellWords(source.slice(".revoke-member".length));
  assertShellWordLimit(source, ".revoke-member", 1);
  return {
    ...databaseRequest(context, "/v1/members/revoke"),
    body: {
      database_id: context.databaseId,
      principal: memberPrincipalArg(principal)
    }
  };
}

function archiveCancelCommand(source, context) {
  assertShellWordLimit(source, ".archive-cancel", 0);
  return databaseRequest(context, "/v1/archive/cancel");
}

function deleteDatabaseCommand(source, context) {
  assertShellWordLimit(source, ".delete-db", 0);
  return databaseRequest(context, "/v1/database/delete");
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
    ...writeShellOptions(readSql, context)
  };
}

function writeShellOptions(readSql, context) {
  if (readSql) return {};
  return {
    idempotencyKey: shellWriteIdempotencyKey(context),
    ...(context.waitForRoutedOperation ? { waitForRoutedOperation: true } : {})
  };
}

function shellWriteIdempotencyKey(context) {
  const prefix = context.idempotencyKeyPrefix || `shell-${context.databaseId}`;
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
  if (!/^[A-Za-z_]$/.test(character)) return start;
  let index = start + 1;
  while (index < sql.length && /^[A-Za-z0-9_]$/.test(sql[index] ?? "")) index += 1;
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

function skipLineComment(sql, start) {
  const end = sql.indexOf("\n", start + 2);
  return end === -1 ? sql.length : end + 1;
}

function skipBlockComment(sql, start) {
  const end = sql.indexOf("*/", start + 2);
  return end === -1 ? sql.length : end + 2;
}
