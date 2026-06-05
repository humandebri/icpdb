"use client";

// icpdb-console/components/icpdb-workbench.tsx
// Workbench view: renders the ICPDB console panels from controller-built props.

import { DatabaseNavigator, WorkbenchToolbar } from "@/components/icpdb-navigation-panels";
import { ResponseSidebar } from "@/components/icpdb-response-sidebar";
import { SqlEditorPanel } from "@/components/icpdb-sql-editor-panel";
import { TableEditorPanel } from "@/components/icpdb-table-editor-panel";
import type { ConsoleConnection } from "@/lib/console-connection";
import { useIcpdbWorkbenchController } from "@/lib/use-icpdb-workbench-controller";

export function IcpdbWorkbench({ connection }: { connection: ConsoleConnection }) {
  const {
    error,
    navigatorProps,
    responseSidebarProps,
    sqlEditorProps,
    tableEditorProps,
    toolbarProps,
    view
  } = useIcpdbWorkbenchController(connection);

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
      <DatabaseNavigator {...navigatorProps} />
      <main className="space-y-3">
        <WorkbenchToolbar {...toolbarProps} />
        {view === "table" ? <TableEditorPanel {...tableEditorProps} /> : <SqlEditorPanel {...sqlEditorProps} />}
        {error ? <p className="rounded-md border border-[#fecdca] bg-[#fffbfa] px-3 py-2 text-sm text-[#b42318]">{error}</p> : null}
      </main>
      <ResponseSidebar {...responseSidebarProps} />
    </div>
  );
}
