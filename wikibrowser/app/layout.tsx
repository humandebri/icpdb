import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ICPDB",
  description: "Serverless SQLite hosting on the Internet Computer"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
