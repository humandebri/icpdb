"use client";

// icpdb-console/components/icpdb-schema-viewers.tsx
// Table schema viewers for indexes, triggers, and foreign keys in the ICPDB table editor.

import { Code2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { DatabaseForeignKey, DatabaseIndex, DatabaseTrigger } from "@/lib/types";

export function IndexViewer({
  indexes,
  onOpenSchemaSql
}: {
  indexes: DatabaseIndex[];
  onOpenSchemaSql?: (sql: string) => void;
}) {
  const [indexSearch, setIndexSearch] = useState("");
  const visibleIndexes = useMemo(() => filterIndexes(indexes, indexSearch), [indexSearch, indexes]);
  const indexCountLabel = indexSearch.trim() ? `${visibleIndexes.length}/${indexes.length}` : String(indexes.length);
  return (
    <div className="rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Indexes</h3>
        {indexes.length > 0 ? (
          <label className="flex h-8 min-w-40 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
            <Search aria-hidden size={14} />
            <input
              aria-label="Search indexes"
              className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
              placeholder="Search indexes"
              value={indexSearch}
              onChange={(event) => setIndexSearch(event.target.value)}
            />
            <span className="font-mono text-[#667085]">{indexCountLabel}</span>
          </label>
        ) : null}
      </div>
      {indexes.length === 0 ? <p className="mt-3 text-xs text-[#667085]">None</p> : null}
      {indexes.length > 0 ? (
        <div className="mt-3 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="text-[#667085]">
              <tr>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Name</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Columns</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Unique</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Origin</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Partial</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">SQL</th>
              </tr>
            </thead>
            <tbody>
              {visibleIndexes.length === 0 ? (
                <tr>
                  <td className="border-b border-[#f2f4f7] py-3 text-center text-[#667085]" colSpan={6}>
                    No matching indexes
                  </td>
                </tr>
              ) : null}
              {visibleIndexes.map((index) => (
                <tr key={index.name}>
                  <td className="max-w-32 border-b border-[#f2f4f7] py-2 pr-3 font-mono" title={index.schemaSql ?? index.name}>
                    <span className="block truncate">{index.name}</span>
                  </td>
                  <td className="max-w-40 border-b border-[#f2f4f7] py-2 pr-3 font-mono" title={indexColumnsLabel(index)}>
                    <span className="block truncate">{indexColumnsLabel(index)}</span>
                  </td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3">{index.unique ? "yes" : "no"}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{index.origin}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3">{index.partial ? "yes" : "no"}</td>
                  <td className="border-b border-[#f2f4f7] py-2">
                    <button
                      aria-label={`Open index SQL for ${index.name}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#c9ced8] bg-white text-[#344054] hover:bg-[#f7f8fb] disabled:opacity-50"
                      disabled={!index.schemaSql || !onOpenSchemaSql}
                      title="Open index SQL"
                      type="button"
                      onClick={() => {
                        if (index.schemaSql) onOpenSchemaSql?.(ensureSqlSemicolon(index.schemaSql));
                      }}
                    >
                      <Code2 aria-hidden size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function TriggerViewer({
  triggers,
  onOpenSchemaSql
}: {
  triggers: DatabaseTrigger[];
  onOpenSchemaSql?: (sql: string) => void;
}) {
  const [triggerSearch, setTriggerSearch] = useState("");
  const visibleTriggers = useMemo(() => filterTriggers(triggers, triggerSearch), [triggerSearch, triggers]);
  const triggerCountLabel = triggerSearch.trim() ? `${visibleTriggers.length}/${triggers.length}` : String(triggers.length);
  return (
    <div className="rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Triggers</h3>
        {triggers.length > 0 ? (
          <label className="flex h-8 min-w-40 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
            <Search aria-hidden size={14} />
            <input
              aria-label="Search triggers"
              className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
              placeholder="Search triggers"
              value={triggerSearch}
              onChange={(event) => setTriggerSearch(event.target.value)}
            />
            <span className="font-mono text-[#667085]">{triggerCountLabel}</span>
          </label>
        ) : null}
      </div>
      {triggers.length === 0 ? <p className="mt-3 text-xs text-[#667085]">None</p> : null}
      {triggers.length > 0 ? (
        <div className="mt-3 space-y-3">
          {visibleTriggers.length === 0 ? (
            <p className="text-center text-xs text-[#667085]">No matching triggers</p>
          ) : null}
          {visibleTriggers.map((trigger) => (
            <div key={trigger.name}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-mono" title={trigger.name}>{trigger.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[#667085]">{trigger.tableName}</span>
                  <button
                    aria-label={`Open trigger SQL for ${trigger.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#c9ced8] bg-white text-[#344054] hover:bg-[#f7f8fb] disabled:opacity-50"
                    disabled={!trigger.schemaSql || !onOpenSchemaSql}
                    title="Open trigger SQL"
                    type="button"
                    onClick={() => {
                      if (trigger.schemaSql) onOpenSchemaSql?.(ensureSqlSemicolon(trigger.schemaSql));
                    }}
                  >
                    <Code2 aria-hidden size={14} />
                  </button>
                </span>
              </div>
              <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-[#0d1117] p-3 font-mono text-xs leading-5 text-[#d6e2ff]">
                {trigger.schemaSql ?? "No trigger SQL"}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ForeignKeyViewer({
  foreignKeys,
  tableName,
  onOpenForeignKeySql
}: {
  foreignKeys: DatabaseForeignKey[];
  tableName: string | null;
  onOpenForeignKeySql?: (tableName: string) => void;
}) {
  const [foreignKeySearch, setForeignKeySearch] = useState("");
  const visibleForeignKeys = useMemo(() => filterForeignKeys(foreignKeys, foreignKeySearch), [foreignKeySearch, foreignKeys]);
  const foreignKeyCountLabel = foreignKeySearch.trim() ? `${visibleForeignKeys.length}/${foreignKeys.length}` : String(foreignKeys.length);
  return (
    <div className="rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Foreign keys</h3>
        <div className="flex flex-wrap items-center gap-2">
          {foreignKeys.length > 0 ? (
            <label className="flex h-8 min-w-40 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
              <Search aria-hidden size={14} />
              <input
                aria-label="Search foreign keys"
                className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
                placeholder="Search foreign keys"
                value={foreignKeySearch}
                onChange={(event) => setForeignKeySearch(event.target.value)}
              />
              <span className="font-mono text-[#667085]">{foreignKeyCountLabel}</span>
            </label>
          ) : null}
          <button
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
            disabled={!tableName || !onOpenForeignKeySql}
            title="Open foreign key SQL"
            type="button"
            onClick={() => {
              if (tableName) onOpenForeignKeySql?.(tableName);
            }}
          >
            <Code2 aria-hidden size={14} />
            <span>Open foreign key SQL</span>
          </button>
        </div>
      </div>
      {foreignKeys.length === 0 ? <p className="mt-3 text-xs text-[#667085]">None</p> : null}
      {foreignKeys.length > 0 ? (
        <div className="mt-3 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="text-[#667085]">
              <tr>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Group</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Seq</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">From</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">To</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Update</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Delete</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Match</th>
              </tr>
            </thead>
            <tbody>
              {visibleForeignKeys.length === 0 ? (
                <tr>
                  <td className="border-b border-[#f2f4f7] py-3 text-center text-[#667085]" colSpan={7}>
                    No matching foreign keys
                  </td>
                </tr>
              ) : null}
              {visibleForeignKeys.map((key) => (
                <tr key={`${key.id}-${key.seq}-${key.fromColumn}`}>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{key.id}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{key.seq}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{key.fromColumn}</td>
                  <td className="max-w-36 border-b border-[#f2f4f7] py-2 pr-3 font-mono" title={`${key.tableName}.${key.toColumn ?? ""}`}>
                    <span className="block truncate">{key.tableName}.{key.toColumn ?? ""}</span>
                  </td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{key.onUpdate}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{key.onDelete}</td>
                  <td className="border-b border-[#f2f4f7] py-2 font-mono">{key.matchClause}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function filterIndexes(indexes: DatabaseIndex[], indexSearch: string): DatabaseIndex[] {
  const query = indexSearch.trim().toLowerCase();
  if (!query) return indexes;
  return indexes.filter((index) => [
    index.name,
    indexColumnsLabel(index),
    index.origin,
    index.unique ? "unique" : "not unique",
    index.partial ? "partial" : "not partial",
    index.schemaSql ?? ""
  ].some((value) => value.toLowerCase().includes(query)));
}

function indexColumnsLabel(index: DatabaseIndex): string {
  const columns = index.columns.filter((column) => column.key);
  if (columns.length === 0) return "-";
  return columns.map((column) => column.name ?? expressionIndexColumnLabel(column.cid)).join(", ");
}

function expressionIndexColumnLabel(cid: string): string {
  if (cid === "-1") return "rowid";
  if (cid === "-2") return "expression";
  return `cid ${cid}`;
}

function filterTriggers(triggers: DatabaseTrigger[], triggerSearch: string): DatabaseTrigger[] {
  const query = triggerSearch.trim().toLowerCase();
  if (!query) return triggers;
  return triggers.filter((trigger) => [
    trigger.name,
    trigger.tableName,
    trigger.schemaSql ?? ""
  ].some((value) => value.toLowerCase().includes(query)));
}

function filterForeignKeys(foreignKeys: DatabaseForeignKey[], foreignKeySearch: string): DatabaseForeignKey[] {
  const query = foreignKeySearch.trim().toLowerCase();
  if (!query) return foreignKeys;
  return foreignKeys.filter((key) => [
    String(key.id),
    String(key.seq),
    key.fromColumn,
    key.tableName,
    key.toColumn ?? "",
    key.onUpdate,
    key.onDelete,
    key.matchClause
  ].some((value) => value.toLowerCase().includes(query)));
}

function ensureSqlSemicolon(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}
