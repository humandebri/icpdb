"use client";

// icpdb-console/components/icpdb-navigation-panels.tsx
// Navigation panels: database picker and top-level workbench commands.

import { Database, KeyRound, RefreshCw } from "lucide-react";
import { DatabaseList } from "@/components/icpdb-database-list-panel";
import { CanisterField } from "@/components/icpdb-display-panels";
import { TableList } from "@/components/icpdb-table-list-panel";
import { TokenSessionPanel, type TokenSessionPanelProps } from "@/components/icpdb-token-session-panel";
import type { ConsoleConnectionMode } from "@/lib/console-connection";
import type { WorkbenchView } from "@/lib/use-icpdb-sql-actions";
import type {
  DatabaseSummary,
  DatabaseTable
} from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

type DatabaseNavigatorProps = {
  canCreateTable: boolean;
  canOpenSetupSql: boolean;
  canisterId: string;
  connectionMode: ConsoleConnectionMode;
  createTableColumns: string;
  createTableName: string;
  databaseId: string;
  databases: DatabaseSummary[];
  loadState: LoadState;
  principal: string | null;
  tableName: string;
  tables: DatabaseTable[];
  tokenSession: TokenSessionPanelProps;
  onCreateTable: () => void;
  onCreateTableColumnsChange: (value: string) => void;
  onCreateTableNameChange: (value: string) => void;
  onOpenSetupSql: () => void;
  onOpenTableSql: (tableName: string) => void;
  onSelectDatabase: (databaseId: string) => void;
  onSelectTable: (tableName: string) => void;
};

type WorkbenchToolbarProps = {
  authReady: boolean;
  canCreateDatabase: boolean;
  canIssueReadToken: boolean;
  databaseId: string;
  loadState: LoadState;
  principal: string | null;
  view: WorkbenchView;
  onCreateDatabase: () => void;
  onCreateReadToken: () => void;
  onLogin: () => void;
  onSetView: (view: WorkbenchView) => void;
  onSync: () => void;
};

export function DatabaseNavigator(props: DatabaseNavigatorProps) {
  const {
    canCreateTable,
    canOpenSetupSql,
    canisterId,
    connectionMode,
    createTableColumns,
    createTableName,
    databaseId,
    databases,
    loadState,
    principal,
    tableName,
    tables,
    tokenSession,
    onCreateTable,
    onCreateTableColumnsChange,
    onCreateTableNameChange,
    onOpenSetupSql,
    onOpenTableSql,
    onSelectDatabase,
    onSelectTable
  } = props;

  return (
    <aside className="space-y-3">
      <CanisterField label="Canister" value={canisterId || "not configured"} />
      <CanisterField label="Mode" value={connectionMode} />
      {principal ? <CanisterField label="Principal" value={principal} /> : null}
      {connectionMode === "hosted" ? <TokenSessionPanel {...tokenSession} /> : null}
      <select
        className="w-full rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm text-[#182230]"
        disabled={!principal || databases.length === 0}
        value={databaseId}
        onChange={(event) => onSelectDatabase(event.target.value)}
      >
        {databases.length === 0 ? <option value="">No database loaded</option> : null}
        {databases.map((database) => (
          <option key={database.databaseId} value={database.databaseId}>
            {database.databaseId}
          </option>
        ))}
      </select>
      <DatabaseList databases={databases} databaseId={databaseId} loadState={loadState} onSelectDatabase={onSelectDatabase} />
      <TableList
        canCreateTable={canCreateTable}
        canOpenSetupSql={canOpenSetupSql}
        createTableColumns={createTableColumns}
        createTableName={createTableName}
        tableName={tableName}
        tables={tables}
        onCreateTable={onCreateTable}
        onCreateTableColumnsChange={onCreateTableColumnsChange}
        onCreateTableNameChange={onCreateTableNameChange}
        onOpenSetupSql={onOpenSetupSql}
        onOpenTableSql={onOpenTableSql}
        onSelectTable={onSelectTable}
      />
    </aside>
  );
}

export function WorkbenchToolbar(props: WorkbenchToolbarProps) {
  const {
    authReady,
    canCreateDatabase,
    canIssueReadToken,
    databaseId,
    loadState,
    principal,
    view,
    onCreateDatabase,
    onCreateReadToken,
    onLogin,
    onSetView,
    onSync
  } = props;

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
      <div className="grid w-full grid-cols-2 overflow-hidden rounded-md border border-[#c9ced8] text-sm">
        <button className={view === "table" ? activeModeClass : inactiveModeClass} type="button" onClick={() => onSetView("table")}>
          Table
        </button>
        <button className={view === "sql" ? activeModeClass : inactiveModeClass} type="button" onClick={() => onSetView("sql")}>
          SQL
        </button>
      </div>
      {!principal ? (
        <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!authReady || loadState === "loading"} type="button" onClick={onLogin}>
          <KeyRound aria-hidden size={16} />
          <span>Login</span>
        </button>
      ) : null}
      {principal ? (
        <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={loadState === "loading"} type="button" onClick={onSync}>
          <RefreshCw aria-hidden size={16} />
          <span>Sync</span>
        </button>
      ) : null}
      {principal && canCreateDatabase ? (
        <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={loadState === "loading"} type="button" onClick={onCreateDatabase}>
          <Database aria-hidden size={16} />
          <span>Create database</span>
        </button>
      ) : null}
      {principal && databaseId && canIssueReadToken ? (
        <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm font-medium text-[#182230] disabled:opacity-50" disabled={loadState === "loading"} type="button" onClick={onCreateReadToken}>
          <KeyRound aria-hidden size={16} />
          <span>Issue read token</span>
        </button>
      ) : null}
    </div>
  );
}

const activeModeClass = "bg-[#182230] px-3 py-1.5 text-white";
const inactiveModeClass = "bg-white px-3 py-1.5 text-[#5f6c7b]";
