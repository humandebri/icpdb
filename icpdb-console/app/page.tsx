// icpdb-console/app/page.tsx
// Root route: sends users directly to the live DBaaS console.

import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/icpdb");
}
