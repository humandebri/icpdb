"use client";

// icpdb-console/components/icpdb-usage-events-panel.tsx
// Searchable usage-event summary table for quota, billing, and activity inspection.

import { HardDrive, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { DatabaseUsageEventSummary } from "@/lib/types";

export function UsageEventSummaryPanel({ events }: { events: DatabaseUsageEventSummary[] }) {
  const [usageEventSearch, setUsageEventSearch] = useState("");
  const visibleEvents = useMemo(() => filterUsageEvents(events, usageEventSearch), [events, usageEventSearch]);
  const eventCountLabel = usageEventSearch.trim() ? `${visibleEvents.length}/${events.length}` : String(events.length);
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Usage events</h3>
        {events.length > 0 ? (
          <label className="flex h-8 min-w-40 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#5f6c7b]">
            <Search aria-hidden size={14} />
            <input
              aria-label="Search usage events"
              className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
              placeholder="Search usage events"
              value={usageEventSearch}
              onChange={(event) => setUsageEventSearch(event.target.value)}
            />
            <span className="font-mono text-[#667085]">{eventCountLabel}</span>
          </label>
        ) : <HardDrive aria-hidden size={16} />}
      </div>
      {events.length === 0 ? <p className="mt-3 text-xs text-[#667085]">None</p> : null}
      {events.length > 0 ? (
        <div className="mt-3 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="text-[#667085]">
              <tr>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Method</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Op</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">OK</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Count</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Rows</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Affected</th>
                <th className="border-b border-[#eef1f5] py-2 pr-3 font-medium">Cycles</th>
                <th className="border-b border-[#eef1f5] py-2 font-medium">Last</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.length === 0 ? (
                <tr>
                  <td className="border-b border-[#f2f4f7] py-3 text-center text-[#667085]" colSpan={8}>
                    No matching usage events
                  </td>
                </tr>
              ) : null}
              {visibleEvents.map((event) => (
                <tr key={`${event.method}-${event.operation ?? "none"}-${String(event.success)}`}>
                  <td className="max-w-32 border-b border-[#f2f4f7] py-2 pr-3 font-mono" title={event.method}>
                    <span className="block truncate">{event.method}</span>
                  </td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{event.operation ?? "-"}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3">{event.success ? "yes" : "no"}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{event.eventCount}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{event.totalRowsReturned}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{event.totalRowsAffected}</td>
                  <td className="border-b border-[#f2f4f7] py-2 pr-3 font-mono">{event.totalCyclesDelta}</td>
                  <td className="border-b border-[#f2f4f7] py-2 font-mono">{formatEventTimestamp(event.lastCreatedAtMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function formatEventTimestamp(timestampMs: string): string {
  const numericTimestamp = Number(timestampMs);
  if (!Number.isFinite(numericTimestamp)) return timestampMs;
  return new Date(numericTimestamp).toISOString();
}

function filterUsageEvents(events: DatabaseUsageEventSummary[], usageEventSearch: string): DatabaseUsageEventSummary[] {
  const query = usageEventSearch.trim().toLowerCase();
  if (!query) return events;
  return events.filter((event) => {
    const fields = [
      event.method,
      event.operation ?? "",
      event.success ? "success" : "failed",
      event.success ? "ok" : "error",
      event.eventCount,
      event.totalCyclesDelta,
      event.totalRowsReturned,
      event.totalRowsAffected,
      formatEventTimestamp(event.lastCreatedAtMs)
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}
