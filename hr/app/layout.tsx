import type { Metadata } from "next";
import { headers } from "next/headers";
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
  // Self-serve visitors (/my/*) get NO admin chrome at all — not the module
  // names, not "Sign out" tied to a session that isn't theirs. This is
  // unconditional on pathname, not on "is there an ss_hr session": an admin
  // testing /my in the same browser they're signed into the portal with must
  // see the same bare shell an ex-employee would, or the isolation this
  // route is supposed to have is cosmetic. Pathname comes from middleware
  // (x-pathname), which is the only place that reliably knows it pre-render.
  // Every UNAUTHENTICATED surface, not just /my: the offer-acceptance page and
  // the candidate questionnaire are opened by people with no portal account at
  // all, and were rendering the admin nav ("+ New", "Sign out") to them.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isSelfServe =
    pathname === "/my" ||
    pathname.startsWith("/my/") ||
    pathname.startsWith("/accept/") ||
    pathname.startsWith("/q/");

  // Server-side identity AND permissions for the nav; TopNav self-hides on
  // /login. Hiding unreachable links is courtesy, not security — the middleware
  // is what actually enforces this — but a menu full of doors that slam is a
  // worse tool than one that only shows the doors you can open.
  const { actor, isAdmin, access } = isSelfServe ? { actor: null, isAdmin: false, access: undefined } : await getViewer();
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        {!isSelfServe ? <TopNav actor={actor} isAdmin={isAdmin} access={access} /> : null}
        {children}
      </body>
    </html>
  );
}
