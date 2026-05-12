// wikibrowser/app/icpdb/page.tsx
// ICPDB console shell: exposes only the live MVP surface backed by the canister.

import type { Metadata } from "next";
import { IcpdbWorkbench } from "@/components/icpdb-workbench";

export const metadata: Metadata = {
  title: "ICPDB Console",
  description: "Canister-owned SQLite console prototype"
};

export default function IcpdbConsolePage() {
  return (
    <main className="min-h-screen bg-[#f7f8fb] text-[#182230]">
      <section className="border-b border-[#d5d9e2] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#5f6c7b]">ICPDB</p>
            <h1 className="mt-1 text-2xl font-semibold">Canister SQLite Console</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#5f6c7b]">Candid API backed SQLite hosting for canister-owned databases.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-5">
        <Panel title="SQL Workbench">
          <IcpdbWorkbench />
        </Panel>
      </section>
    </main>
  );
}

function Panel({ actions, children, title }: { actions?: React.ReactNode; children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-md border border-[#d5d9e2] bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
