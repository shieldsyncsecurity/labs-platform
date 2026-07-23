import type { Metadata } from "next";
import { getHrActor } from "@/lib/server/hr-session";
import { TopNav } from "@/components/TopNav";
import "./globals.css";

// Internal tool — never index, never follow, regardless of how the URL is reached.
export const metadata: Metadata = {
  title: "ShieldSync HR",
  description: "ShieldSync internal HR document portal.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server-side identity for the nav; TopNav self-hides on /login.
  const actor = await getHrActor();
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <TopNav actor={actor} />
        {children}
      </body>
    </html>
  );
}
