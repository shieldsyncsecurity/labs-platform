import type { Metadata } from "next";
import { getViewer } from "@/lib/server/hr-access";
import { TopNav } from "@/components/TopNav";
import "./globals.css";

// Internal tool — never index, never follow, regardless of how the URL is reached.
export const metadata: Metadata = {
  title: "ShieldSync HR",
  description: "ShieldSync internal HR document portal.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server-side identity AND permissions for the nav; TopNav self-hides on
  // /login. Hiding unreachable links is courtesy, not security — the middleware
  // is what actually enforces this — but a menu full of doors that slam is a
  // worse tool than one that only shows the doors you can open.
  const { actor, isAdmin, access } = await getViewer();
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <TopNav actor={actor} isAdmin={isAdmin} access={access} />
        {children}
      </body>
    </html>
  );
}
