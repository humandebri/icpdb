import { ArrowRight, Coins, Database, ShieldCheck } from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: Database,
    title: "Canister SQLite hosting",
    body: "Create multiple isolated SQLite databases inside one canister and execute SQL through Candid."
  },
  {
    icon: Coins,
    title: "Prepaid ICP billing",
    body: "Top up a database with ICP approval, track billing units, and suspend depleted databases."
  },
  {
    icon: ShieldCheck,
    title: "Principal-owned access",
    body: "Database ownership, tokens, usage, dump, restore, and payment history stay tied to IC principals."
  }
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-between gap-10">
        <header className="flex items-center justify-between border-b border-line pb-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">ICPDB</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">SQLite databases as canister-owned objects.</h1>
          </div>
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2 text-sm font-medium text-white no-underline"
            href="/icpdb"
          >
            Open console
            <ArrowRight size={16} />
          </Link>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <section className="max-w-3xl">
            <p className="text-lg leading-8 text-muted">
              ICPDB is a focused MVP for serverless SQLite hosting on the Internet Computer. It keeps SQL execution,
              quota, billing, deposit, and the canister console in this repository while leaving legacy wiki tooling out
              of the product surface.
            </p>
          </section>
          <section className="grid gap-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.title} className="rounded-lg border border-line bg-paper p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Icon className="text-accent" size={20} />
                    <h2 className="text-base font-semibold text-ink">{feature.title}</h2>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted">{feature.body}</p>
                </article>
              );
            })}
          </section>
        </div>
      </section>
    </main>
  );
}
