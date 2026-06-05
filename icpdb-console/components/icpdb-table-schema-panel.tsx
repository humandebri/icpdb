"use client";

// icpdb-console/components/icpdb-table-schema-panel.tsx
// Column, index, trigger, foreign key, and schema SQL viewer for the ICPDB Table Editor.

import { Check, Code2, Copy, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ForeignKeyViewer, IndexViewer, TriggerViewer, downloadTextFile } from "@/components/icpdb-display-panels";
import { columnKindLabel } from "@/lib/row-mutations";
import type { DatabaseColumn, TableDescription } from "@/lib/types";

export function TableSchemaPanel({
  tableDescription,
  onOpenColumnSql,
  onOpenForeignKeySql,
  onOpenSchemaLookupSql,
  onOpenSchemaSql
}: {
  tableDescription: TableDescription | null;
  onOpenColumnSql: (tableName: string) => void;
  onOpenForeignKeySql: (tableName: string) => void;
  onOpenSchemaLookupSql: (tableName: string) => void;
  onOpenSchemaSql: (sql: string) => void;
}) {
  const [columnSearch, setColumnSearch] = useState("");
  const [copiedSchemaSql, setCopiedSchemaSql] = useState(false);
  const columns = useMemo(() => tableDescription?.columns ?? [], [tableDescription]);
  const visibleColumns = useMemo(() => filterColumns(columns, columnSearch), [columnSearch, columns]);
  const columnCountLabel = columnSearch.trim() ? `${visibleColumns.length}/${columns.length}` : String(columns.length);
  const schemaSql = useMemo(() => buildTableSchemaSql(tableDescription), [tableDescription]);
  async function copySchemaSql() {
    if (!schemaSql) return;
    await navigator.clipboard.writeText(schemaSql);
    setCopiedSchemaSql(true);
    window.setTimeout(() => setCopiedSchemaSql(false), 1200);
  }

  return (
    <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="rounded-md border border-[#d5d9e2] bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Columns</h3>
          <label className="flex h-8 min-w-48 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
            <Search aria-hidden size={14} />
            <input
              aria-label="Search columns"
              className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
              placeholder="Search columns"
              value={columnSearch}
              onChange={(event) => setColumnSearch(event.target.value)}
            />
            <span className="font-mono text-[#667085]">{columnCountLabel}</span>
          </label>
          <button
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
            disabled={!tableDescription}
            title="Open column SQL"
            type="button"
            onClick={() => {
              if (tableDescription) onOpenColumnSql(tableDescription.tableName);
            }}
          >
            <Code2 aria-hidden size={14} />
            <span>Open column SQL</span>
          </button>
        </div>
        <div className="mt-3 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="text-[#667085]">
              <tr>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Name</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Type</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Kind</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Null</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Default</th>
              </tr>
            </thead>
            <tbody>
              {columns.length > 0 && visibleColumns.length === 0 ? (
                <tr>
                  <td className="border-b border-[#f2f4f7] py-3 text-center text-[#667085]" colSpan={5}>
                    No matching columns
                  </td>
                </tr>
              ) : null}
              {visibleColumns.map((column) => (
                <tr key={column.cid}>
                  <td className="border-b border-[#f2f4f7] py-2 font-mono">{column.name}</td>
                  <td className="border-b border-[#f2f4f7] py-2 font-mono">{column.declaredType || "dynamic"}</td>
                  <td className="border-b border-[#f2f4f7] py-2">{columnKindLabel(column)}</td>
                  <td className="border-b border-[#f2f4f7] py-2">{column.notNull ? "no" : "yes"}</td>
                  <td className="border-b border-[#f2f4f7] py-2 font-mono">{column.defaultValue ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 border-t border-[#eef1f5] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-[#344054]">Schema SQL</h4>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
                disabled={!schemaSql}
                title={copiedSchemaSql ? "Copied" : "Copy schema SQL"}
                type="button"
                onClick={() => void copySchemaSql()}
              >
                {copiedSchemaSql ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
                <span>Copy schema SQL</span>
              </button>
              <button
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
                disabled={!schemaSql}
                title="Open schema SQL"
                type="button"
                onClick={() => onOpenSchemaSql(schemaSql)}
              >
                <Code2 aria-hidden size={14} />
                <span>Open schema SQL</span>
              </button>
              <button
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
                disabled={!tableDescription}
                title="Open schema lookup SQL"
                type="button"
                onClick={() => {
                  if (tableDescription) onOpenSchemaLookupSql(tableDescription.tableName);
                }}
              >
                <Search aria-hidden size={14} />
                <span>Open schema lookup SQL</span>
              </button>
              <button
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[#c9ced8] bg-white px-2 text-xs font-medium text-[#344054] disabled:opacity-50"
                disabled={!schemaSql}
                type="button"
                onClick={() => downloadTextFile(schemaSql, tableSchemaFileName(tableDescription?.tableName ?? "schema"), "application/sql;charset=utf-8")}
              >
                <Download aria-hidden size={14} />
                <span>Download schema SQL</span>
              </button>
            </div>
          </div>
          <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-[#0d1117] p-3 font-mono text-xs leading-5 text-[#d6e2ff]">
            {schemaSql || "No schema SQL"}
          </pre>
        </div>
      </div>
      <div className="space-y-3">
        <IndexViewer indexes={tableDescription?.indexes ?? []} onOpenSchemaSql={onOpenSchemaSql} />
        <TriggerViewer triggers={tableDescription?.triggers ?? []} onOpenSchemaSql={onOpenSchemaSql} />
        <ForeignKeyViewer
          foreignKeys={tableDescription?.foreignKeys ?? []}
          tableName={tableDescription?.tableName ?? null}
          onOpenForeignKeySql={onOpenForeignKeySql}
        />
      </div>
    </section>
  );
}

function filterColumns(columns: DatabaseColumn[], columnSearch: string): DatabaseColumn[] {
  const query = columnSearch.trim().toLowerCase();
  if (!query) return columns;
  return columns.filter((column) => {
    const fields = [
      column.name,
      column.declaredType || "dynamic",
      columnKindLabel(column),
      column.notNull ? "not null" : "nullable",
      column.defaultValue ?? ""
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}

function buildTableSchemaSql(tableDescription: TableDescription | null): string {
  if (!tableDescription) return "";
  const statements: string[] = [];
  pushSchemaStatement(statements, tableDescription.schemaSql);
  for (const index of tableDescription.indexes) pushSchemaStatement(statements, index.schemaSql);
  for (const trigger of tableDescription.triggers) pushSchemaStatement(statements, trigger.schemaSql);
  return statements.join("\n");
}

function pushSchemaStatement(statements: string[], statement: string | null) {
  const trimmed = statement?.trim() ?? "";
  if (!trimmed) return;
  statements.push(trimmed.endsWith(";") ? trimmed : `${trimmed};`);
}

function tableSchemaFileName(tableName: string): string {
  const trimmed = tableName.trim();
  const filePart = sanitizeSchemaFilePart(trimmed.length > 0 ? trimmed : "schema");
  return `icpdb-schema-${filePart}.sql`;
}

function sanitizeSchemaFilePart(value: string): string {
  const normalized = value.toLowerCase();
  let output = "";
  for (const char of normalized) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isLetter = code >= 97 && code <= 122;
    const isAllowedPunctuation = char === "-" || char === "_" || char === ".";
    output += isDigit || isLetter || isAllowedPunctuation ? char : "-";
  }
  return output || "schema";
}
