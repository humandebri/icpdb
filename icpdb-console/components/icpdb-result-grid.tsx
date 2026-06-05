"use client";

// icpdb-console/components/icpdb-result-grid.tsx
// SQL result grids and spreadsheet-style table grid rendering.

import { Check, Copy, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SqlExecuteResponse, SqlValue } from "@/lib/types";
import { DataGrid } from "@/components/icpdb-data-grid";
import {
  downloadSqlRowsCsv,
  filterResultRows,
  nextColumnSort,
  sqlRowsCsv,
  sortResultRows,
  type GridColumnSort,
} from "@/lib/result-grid-helpers";
export { DataGrid } from "@/components/icpdb-data-grid";
export { downloadSqlRowsCsv, downloadTextFile, formatSqlValue, sqlRowsCsv, type GridColumnSort, type GridColumnSortDirection } from "@/lib/result-grid-helpers";

export function ResultTable({
  emptyLabel = "(no rows)",
  fileName = "icpdb-result.csv",
  noMatchLabel = "No matching result rows",
  response,
  searchLabel = "Search result rows",
  searchPlaceholder = searchLabel
}: {
  emptyLabel?: string;
  fileName?: string;
  noMatchLabel?: string;
  response: SqlExecuteResponse;
  searchLabel?: string;
  searchPlaceholder?: string;
}) {
  const [resultSearch, setResultSearch] = useState("");
  const [resultColumnSort, setResultColumnSort] = useState<GridColumnSort | null>(null);
  const [copiedResultCsv, setCopiedResultCsv] = useState(false);
  const visibleRowEntries = useMemo(
    () => sortResultRows(filterResultRows(response.columns, response.rows, resultSearch), response.columns, resultColumnSort),
    [response.columns, response.rows, resultColumnSort, resultSearch]
  );
  const visibleRows = useMemo(() => visibleRowEntries.map((entry) => entry.row), [visibleRowEntries]);
  const visibleRowNumbers = useMemo(() => visibleRowEntries.map((entry) => entry.rowNumber), [visibleRowEntries]);
  const resultCountLabel = resultSearch.trim() ? `${visibleRows.length}/${response.rows.length}` : String(response.rows.length);
  async function copyResultCsv() {
    await navigator.clipboard.writeText(sqlRowsCsv(response.columns, visibleRows));
    setCopiedResultCsv(true);
    window.setTimeout(() => setCopiedResultCsv(false), 1200);
  }

  return (
    <div>
      {response.rows.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-48 max-w-sm flex-1 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
            <Search aria-hidden size={14} />
            <input
              aria-label={searchLabel}
              className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
              placeholder={searchPlaceholder}
              value={resultSearch}
              onChange={(event) => setResultSearch(event.target.value)}
            />
            <span className="font-mono text-[#667085]">{resultCountLabel}</span>
          </label>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-3 text-xs font-medium text-[#344054]"
            type="button"
            onClick={copyResultCsv}
          >
            {copiedResultCsv ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
            <span>{copiedResultCsv ? "Copied result CSV" : "Copy result CSV"}</span>
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-3 text-xs font-medium text-[#344054]"
            type="button"
            onClick={() => downloadResultCsv(response, visibleRows, fileName)}
          >
            <Download aria-hidden size={14} />
            <span>Download result CSV</span>
          </button>
        </div>
      ) : null}
      <DataGrid
        columns={response.columns}
        columnSort={resultColumnSort}
        emptyLabel={resultSearch.trim() ? noMatchLabel : emptyLabel}
        rowNumbers={visibleRowNumbers}
        rows={visibleRows}
        onToggleColumnSort={(columnName) => setResultColumnSort((current) => nextColumnSort(current, columnName))}
      />
    </div>
  );
}

export function SqlResultSummary({ response }: { response: SqlExecuteResponse }) {
  return (
    <div className="rounded-md border border-[#d5d9e2] bg-white p-3">
      <h3 className="text-sm font-semibold">SQL result</h3>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-6">
        <ResultMetric label="Rows" value={String(response.rows.length)} />
        <ResultMetric label="Columns" value={String(response.columns.length)} />
        <ResultMetric label="Affected" value={response.rowsAffected} />
        <ResultMetric label="Rowid" value={response.lastInsertRowId} />
        <ResultMetric label="Truncated" value={response.truncated ? "yes" : "no"} />
        <ResultMetric label="Operation" value={response.routedOperationId ?? "none"} />
      </dl>
    </div>
  );
}

export function BatchResultList({ responses }: { responses: SqlExecuteResponse[] }) {
  const rowResponses = responses
    .map((response, index) => ({ index, response }))
    .filter(({ response }) => response.columns.length > 0);
  return (
    <div className="rounded-md border border-[#d5d9e2] bg-white p-3">
      <h3 className="text-sm font-semibold">Batch results</h3>
      <div className="mt-3 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="text-[#667085]">
            <tr>
              <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">#</th>
              <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Rows</th>
              <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Columns</th>
              <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Affected</th>
              <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Rowid</th>
              <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Grid</th>
              <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Truncated</th>
              <th className="border-b border-[#eef1f5] py-2 font-medium">Operation</th>
            </tr>
          </thead>
          <tbody>
            {responses.map((nextResponse, index) => (
              <tr key={index}>
                <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{index + 1}</td>
                <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{nextResponse.rows.length}</td>
                <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{nextResponse.columns.length}</td>
                <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{nextResponse.rowsAffected}</td>
                <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{nextResponse.lastInsertRowId}</td>
                <td className="border-b border-[#f2f4f7] py-2 pr-3">{nextResponse.columns.length > 0 ? "yes" : "no"}</td>
                <td className="border-b border-[#f2f4f7] py-2 pr-3">{nextResponse.truncated ? "yes" : "no"}</td>
                <td className="border-b border-[#f2f4f7] py-2 font-mono">{nextResponse.routedOperationId ?? "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rowResponses.length > 0 ? (
        <div className="mt-4 space-y-4 border-t border-[#eef1f5] pt-4">
          <h4 className="text-xs font-semibold text-[#344054]">Batch result grids</h4>
          {rowResponses.map(({ index, response }) => (
            <section className="rounded-md border border-[#eef1f5] p-3" key={index}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-mono text-[#344054]">Statement {index + 1}</span>
                <span className="font-mono text-[#667085]">{response.rows.length} rows / {response.columns.length} columns</span>
              </div>
              <ResultTable
                emptyLabel="No batch rows"
                fileName={`icpdb-batch-statement-${index + 1}.csv`}
                noMatchLabel="No matching batch rows"
                response={response}
                searchLabel={`Search statement ${index + 1} rows`}
                searchPlaceholder="Search batch rows"
              />
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyPanel({ label }: { label: string }) {
  return <div className="p-6 text-sm text-[#667085]">{label}</div>;
}

function downloadResultCsv(response: SqlExecuteResponse, rows: SqlValue[][], fileName: string) {
  downloadSqlRowsCsv(response.columns, rows, fileName);
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#eef1f5] px-3 py-2">
      <dt className="text-[#667085]">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-[#182230]">{value}</dd>
    </div>
  );
}
