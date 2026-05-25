"use client";

// icpdb-console/components/icpdb-sql-editor-panel.tsx
// SQL editor surface: mode switch, statement input, params input, and result grids.

import { Play } from "lucide-react";
import type { KeyboardEvent } from "react";
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
  function handleSqlKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    if (!props.isAuthenticated || !props.canRun) return;
    event.preventDefault();
    props.onRunSql();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-[#c9ced8] text-sm">
        <ModeButton currentMode={props.mode} mode="query" onModeChange={props.onModeChange} />
        <ModeButton currentMode={props.mode} mode="update" onModeChange={props.onModeChange} />
        <ModeButton currentMode={props.mode} mode="batch" onModeChange={props.onModeChange} />
      </div>
      <textarea
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
            <span>{props.loadState === "loading" ? "Running" : props.mode === "batch" ? "Run batch" : "Run statement"}</span>
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
