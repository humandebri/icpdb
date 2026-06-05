// icpdb-console/lib/icpdb-sql-script.ts
// Shared SQL script splitting helpers for SDK, SQL editor, and dump import paths.

export function splitSqlStatements(source: string): string[] {
  return splitSqlScript(source).map(trimSqlSemicolon).map((statement) => statement.trim()).filter(Boolean);
}

export function splitSqlDumpStatements(source: string): string[] {
  return splitSqlStatements(source)
    .filter((statement) => statement.length > 0 && !isIgnoredSqlDumpWrapper(statement));
}

export function trimSqlSemicolon(sql: string): string {
  return sql.trim().replace(/;+$/, "");
}

export function isReadSql(sql: string): boolean {
  const token = mainSqlToken(sql);
  if (token === "select" || token === "explain") return true;
  if (token === "pragma") return isReadPragmaSql(sql);
  return false;
}

function splitSqlScript(source: string): string[] {
  type SplitMode = "normal" | "single" | "double" | "backtick" | "bracket" | "line_comment" | "block_comment";
  const statements: string[] = [];
  let current = "";
  let mode: SplitMode = "normal";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    current += char;
    if (mode === "line_comment") {
      if (char === "\n") mode = "normal";
      continue;
    }
    if (mode === "block_comment") {
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        mode = "normal";
      }
      continue;
    }
    if (mode === "single") {
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        mode = "normal";
      }
      continue;
    }
    if (mode === "double") {
      if (char === "\"" && next === "\"") {
        current += next;
        index += 1;
      } else if (char === "\"") {
        mode = "normal";
      }
      continue;
    }
    if (mode === "backtick") {
      if (char === "`" && next === "`") {
        current += next;
        index += 1;
      } else if (char === "`") {
        mode = "normal";
      }
      continue;
    }
    if (mode === "bracket") {
      if (char === "]") mode = "normal";
      continue;
    }
    if (char === "-" && next === "-") {
      current += next;
      index += 1;
      mode = "line_comment";
      continue;
    }
    if (char === "/" && next === "*") {
      current += next;
      index += 1;
      mode = "block_comment";
      continue;
    }
    if (char === "'") {
      mode = "single";
      continue;
    }
    if (char === "\"") {
      mode = "double";
      continue;
    }
    if (char === "`") {
      mode = "backtick";
      continue;
    }
    if (char === "[") {
      mode = "bracket";
      continue;
    }
    if (char === ";" && canSplitSqlStatement(current)) {
      if (current.trim()) statements.push(current);
      current = "";
    }
  }
  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function canSplitSqlStatement(statement: string): boolean {
  const executableSql = stripLeadingSqlComments(statement);
  if (!/^CREATE\s+(?:(?:TEMP|TEMPORARY)\s+)?TRIGGER\b/i.test(executableSql)) return true;
  return isCompleteCreateTriggerStatement(statement);
}

function isCompleteCreateTriggerStatement(statement: string): boolean {
  let bodyDepth = 0;
  let caseDepth = 0;
  let sawTriggerBody = false;
  let lastToken = "";
  let index = 0;
  while (index < statement.length) {
    const char = statement[index] ?? "";
    if (char === "'") {
      index = skipQuotedSql(statement, index, "'");
    } else if (char === "\"") {
      index = skipQuotedSql(statement, index, "\"");
    } else if (char === "`") {
      index = skipQuotedSql(statement, index, "`");
    } else if (char === "[") {
      index = skipBracketQuotedSql(statement, index);
    } else if (char === "-" && statement[index + 1] === "-") {
      index = skipLineComment(statement, index);
    } else if (char === "/" && statement[index + 1] === "*") {
      index = skipBlockComment(statement, index);
    } else if (isNameStart(char)) {
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

function isIgnoredSqlDumpWrapper(statement: string): boolean {
  return /^(PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i.test(stripLeadingSqlComments(statement));
}

function stripLeadingSqlComments(statement: string): string {
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

function isReadPragmaSql(sql: string): boolean {
  const pragma = sqlTokenAt(sql, 0);
  const parsed = parsePragmaName(sql, pragma.end);
  if (parsed === null) return false;
  const tailIndex = firstSqlTokenIndex(sql, parsed.end);
  if (sql[tailIndex] === "=") return false;
  if (READ_PRAGMAS_WITH_OPTIONAL_ARGS.has(parsed.name)) return true;
  return READ_PRAGMAS_WITHOUT_ARGS.has(parsed.name) && sql[tailIndex] !== "(";
}

function parsePragmaName(sql: string, start: number): { name: string; end: number } | null {
  const first = sqlIdentifierTokenAt(sql, start);
  if (!first.value) return null;
  const dotIndex = firstSqlTokenIndex(sql, first.end);
  if (sql[dotIndex] !== ".") return { name: first.value, end: first.end };
  const second = sqlIdentifierTokenAt(sql, dotIndex + 1);
  if (!second.value) return { name: first.value, end: first.end };
  return { name: second.value, end: second.end };
}

function sqlIdentifierTokenAt(sql: string, start: number): { value: string; end: number } {
  const index = firstSqlTokenIndex(sql, start);
  if (!isNameStart(sql[index] ?? "")) return { value: "", end: index };
  const end = skipSqlIdentifier(sql, index);
  return { value: sql.slice(index, end).toLowerCase(), end };
}

function mainSqlToken(sql: string): string {
  const firstToken = sqlTokenAt(sql, 0);
  if (firstToken.value !== "with") return firstToken.value;
  return sqlTokenAt(sql, skipWithClauseList(sql, firstToken.end)).value;
}

function sqlTokenAt(sql: string, start: number): { value: string; end: number } {
  const index = firstSqlTokenIndex(sql, start);
  const value = sql.slice(index).match(/^[A-Za-z]+/)?.[0] ?? "";
  return { value: value.toLowerCase(), end: index + value.length };
}

function firstSqlTokenIndex(sql: string, start = 0): number {
  let index = start;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === "-" && sql[index + 1] === "-") {
      index = skipLineComment(sql, index);
    } else if (char === "/" && sql[index + 1] === "*") {
      index = skipBlockComment(sql, index);
    } else {
      return index;
    }
  }
  return sql.length;
}

function skipWithClauseList(sql: string, start: number): number {
  let index = start;
  const recursiveToken = sqlTokenAt(sql, index);
  if (recursiveToken.value === "recursive") index = recursiveToken.end;
  while (index < sql.length) {
    index = skipSqlIdentifier(sql, firstSqlTokenIndex(sql, index));
    index = firstSqlTokenIndex(sql, index);
    if (sql[index] === "(") index = skipBalancedSql(sql, index);
    const linkToken = sqlTokenAt(sql, index);
    if (linkToken.value !== "as") return index;
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

function skipSqlIdentifier(sql: string, start: number): number {
  const char = sql[start] ?? "";
  if (char === "\"") return skipQuotedSql(sql, start, "\"");
  if (char === "`") return skipQuotedSql(sql, start, "`");
  if (char === "[") return skipBracketQuotedSql(sql, start);
  if (!isNameStart(char)) return start;
  let index = start + 1;
  while (index < sql.length && isNamePart(sql[index] ?? "")) index += 1;
  return index;
}

function skipBalancedSql(sql: string, start: number): number {
  let depth = 1;
  let index = start + 1;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    if (char === "'") {
      index = skipQuotedSql(sql, index, "'");
    } else if (char === "\"") {
      index = skipQuotedSql(sql, index, "\"");
    } else if (char === "`") {
      index = skipQuotedSql(sql, index, "`");
    } else if (char === "[") {
      index = skipBracketQuotedSql(sql, index);
    } else if (char === "-" && sql[index + 1] === "-") {
      index = skipLineComment(sql, index);
    } else if (char === "/" && sql[index + 1] === "*") {
      index = skipBlockComment(sql, index);
    } else if (char === "(") {
      depth += 1;
      index += 1;
    } else if (char === ")") {
      depth -= 1;
      index += 1;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  return sql.length;
}

function skipQuotedSql(sql: string, start: number, quote: string): number {
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

function skipBracketQuotedSql(sql: string, start: number): number {
  const end = sql.indexOf("]", start + 1);
  return end === -1 ? sql.length : end + 1;
}

function skipLineComment(sql: string, start: number): number {
  const end = sql.indexOf("\n", start + 2);
  return end === -1 ? sql.length : end + 1;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf("*/", start + 2);
  return end === -1 ? sql.length : end + 2;
}

function isNameStart(value: string): boolean {
  return /^[A-Za-z_]$/.test(value);
}

function isNamePart(value: string): boolean {
  return /^[A-Za-z0-9_]$/.test(value);
}
