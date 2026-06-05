"use client";

// icpdb-console/components/icpdb-sql-editor-panel.tsx
// SQL editor surface: mode switch, statement input, params input, and result grids.

import { BarChart3, Check, Code2, Columns3Cog, Copy, Eye, Hash, KeyRound, Play, Table, Zap } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { BatchResultList, ResultTable, SqlResultSummary } from "@/components/icpdb-display-panels";
import type { SqlMode } from "@/lib/use-icpdb-sql-actions";
import type { SqlExecuteResponse } from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

type SqlEditorPanelProps = {
  authReady: boolean;
  batchResponses: SqlExecuteResponse[];
  canRun: boolean;
  isAuthenticated: boolean;
  loadState: LoadState;
  mode: SqlMode;
  paramsJson: string;
  response: SqlExecuteResponse | null;
  sql: string;
  sqlMaxRows: string;
  onLogin: () => void;
  onModeChange: (mode: SqlMode) => void;
  onParamsJsonChange: (value: string) => void;
  onRunSql: () => void;
  onSqlChange: (value: string) => void;
  onSqlMaxRowsChange: (value: string) => void;
};

export function SqlEditorPanel(props: SqlEditorPanelProps) {
  const [copiedSql, setCopiedSql] = useState(false);

  function handleSqlKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    if (!props.isAuthenticated || !props.canRun) return;
    event.preventDefault();
    props.onRunSql();
  }

  async function copySql() {
    const nextSql = props.sql.trim();
    if (!nextSql) return;
    await navigator.clipboard.writeText(props.sql);
    setCopiedSql(true);
    window.setTimeout(() => setCopiedSql(false), 1200);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-[#c9ced8] text-sm">
        <ModeButton currentMode={props.mode} mode="query" onModeChange={props.onModeChange} />
        <ModeButton currentMode={props.mode} mode="update" onModeChange={props.onModeChange} />
        <ModeButton currentMode={props.mode} mode="batch" onModeChange={props.onModeChange} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sqlShortcuts.map((shortcut) => (
          <button
            aria-label={shortcut.title}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
            disabled={!props.isAuthenticated}
            key={shortcut.label}
            title={shortcut.title}
            type="button"
            onClick={() => {
              props.onModeChange("query");
              props.onParamsJsonChange("[]");
              props.onSqlChange(shortcut.sql);
            }}
          >
            <ShortcutIcon shortcut={shortcut.label} />
            <span>{shortcut.label}</span>
          </button>
        ))}
        <button
          aria-label="Copy SQL"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
          disabled={!props.sql.trim()}
          title={copiedSql ? "Copied" : "Copy SQL"}
          type="button"
          onClick={() => void copySql()}
        >
          {copiedSql ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
          <span>Copy SQL</span>
        </button>
      </div>
      <textarea
        aria-label="SQL editor"
        className="min-h-56 w-full resize-y rounded-md border border-[#c9ced8] bg-[#0d1117] p-4 font-mono text-sm leading-6 text-[#d6e2ff] outline-none"
        value={props.sql}
        onKeyDown={handleSqlKeyDown}
        onChange={(event) => props.onSqlChange(event.target.value)}
      />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
        {props.mode === "batch" ? (
          <p className="rounded-md border border-[#d5d9e2] bg-[#f7f8fb] px-3 py-2 text-sm text-[#5f6c7b]">
            Batch mode runs semicolon-separated statements without params.
          </p>
        ) : (
          <input
            className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-sm text-[#182230]"
            value={props.paramsJson}
            onChange={(event) => props.onParamsJsonChange(event.target.value)}
          />
        )}
        <label className="grid gap-1 text-xs text-[#5f6c7b]">
          <span>Max rows</span>
          <input
            className="h-10 rounded-md border border-[#c9ced8] bg-white px-3 font-mono text-sm text-[#182230]"
            inputMode="numeric"
            value={props.sqlMaxRows}
            onChange={(event) => props.onSqlMaxRowsChange(event.target.value)}
          />
        </label>
        {props.isAuthenticated ? (
          <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!props.canRun} type="button" onClick={props.onRunSql}>
            <Play aria-hidden size={16} />
            <span>{props.loadState === "loading" ? "Running" : runButtonLabel(props.mode)}</span>
          </button>
        ) : (
          <button className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!props.authReady} type="button" onClick={props.onLogin}>
            Login
          </button>
        )}
      </div>
      {props.batchResponses.length > 0 ? <BatchResultList responses={props.batchResponses} /> : null}
      {props.response ? <SqlResultSummary response={props.response} /> : null}
      {props.response && props.response.columns.length > 0 ? <ResultTable response={props.response} /> : null}
    </div>
  );
}

const sqlShortcuts = [
  {
    label: "Schema",
    title: "Open sqlite_schema SQL",
    sql: [
      "SELECT type, name, tbl_name, sql",
      "FROM sqlite_schema",
      "WHERE name NOT LIKE 'sqlite_%'",
      "ORDER BY type, name;"
    ].join("\n")
  },
  {
    label: "Tables",
    title: "Open table list SQL",
    sql: [
      "SELECT name, type, sql",
      "FROM sqlite_schema",
      "WHERE type IN ('table', 'view')",
      "ORDER BY type, name;"
    ].join("\n")
  },
  {
    label: "Stats",
    title: "Open schema object count SQL",
    sql: [
      "SELECT type, count(*) AS total",
      "FROM sqlite_schema",
      "WHERE name NOT LIKE 'sqlite_%'",
      "GROUP BY type",
      "ORDER BY type;"
    ].join("\n")
  },
  {
    label: "Columns",
    title: "Open column catalog SQL",
    sql: [
      "SELECT m.name AS table_name, c.cid, c.name AS column_name, c.type, c.\"notnull\" AS not_null, c.dflt_value AS default_value, c.pk AS primary_key_position, c.hidden",
      "FROM sqlite_schema AS m,",
      "     pragma_table_xinfo(m.name) AS c",
      "WHERE m.type IN ('table', 'view')",
      "  AND m.name NOT LIKE 'sqlite_%'",
      "ORDER BY m.name, c.cid;"
    ].join("\n")
  },
  {
    label: "Views",
    title: "Open view list SQL",
    sql: [
      "SELECT name, sql",
      "FROM sqlite_schema",
      "WHERE type = 'view'",
      "ORDER BY name;"
    ].join("\n")
  },
  {
    label: "Indexes",
    title: "Open index list SQL",
    sql: [
      "SELECT name, tbl_name, sql",
      "FROM sqlite_schema",
      "WHERE type = 'index'",
      "ORDER BY tbl_name, name;"
    ].join("\n")
  },
  {
    label: "Foreign Keys",
    title: "Open foreign key catalog SQL",
    sql: [
      "SELECT m.name AS table_name, fk.id, fk.seq, fk.\"table\" AS referenced_table, fk.\"from\" AS from_column, fk.\"to\" AS to_column, fk.on_update, fk.on_delete, fk.match",
      "FROM sqlite_schema AS m,",
      "     pragma_foreign_key_list(m.name) AS fk",
      "WHERE m.type = 'table'",
      "  AND m.name NOT LIKE 'sqlite_%'",
      "ORDER BY m.name, fk.id, fk.seq;"
    ].join("\n")
  },
  {
    label: "Triggers",
    title: "Open trigger list SQL",
    sql: [
      "SELECT name, tbl_name, sql",
      "FROM sqlite_schema",
      "WHERE type = 'trigger'",
      "ORDER BY tbl_name, name;"
    ].join("\n")
  }
];

function ShortcutIcon({ shortcut }: { shortcut: string }) {
  if (shortcut === "Schema") return <Code2 aria-hidden size={14} />;
  if (shortcut === "Tables") return <Table aria-hidden size={14} />;
  if (shortcut === "Stats") return <BarChart3 aria-hidden size={14} />;
  if (shortcut === "Columns") return <Columns3Cog aria-hidden size={14} />;
  if (shortcut === "Views") return <Eye aria-hidden size={14} />;
  if (shortcut === "Indexes") return <Hash aria-hidden size={14} />;
  if (shortcut === "Foreign Keys") return <KeyRound aria-hidden size={14} />;
  return <Zap aria-hidden size={14} />;
}

function ModeButton({
  currentMode,
  mode,
  onModeChange
}: {
  currentMode: SqlMode;
  mode: SqlMode;
  onModeChange: (mode: SqlMode) => void;
}) {
  return (
    <button className={currentMode === mode ? activeModeClass : inactiveModeClass} type="button" onClick={() => onModeChange(mode)}>
      {modeLabel(mode)}
    </button>
  );
}

const activeModeClass = "bg-[#182230] px-3 py-1.5 text-white";
const inactiveModeClass = "bg-white px-3 py-1.5 text-[#5f6c7b]";

function modeLabel(mode: SqlMode): string {
  if (mode === "query") return "Query";
  return mode === "update" ? "Update" : "Batch";
}

function runButtonLabel(mode: SqlMode): string {
  if (mode === "query") return "Run query";
  return mode === "update" ? "Run update" : "Run batch";
}
