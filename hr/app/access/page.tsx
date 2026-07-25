import Link from "next/link";
import { requireAdminPage, hrAdmins } from "@/lib/server/hr-access";
import { hrFetch } from "@/lib/server/hr-engine";
import { hrAllowlist } from "@/lib/server/hr-token";
import { normalizeAccess } from "@/lib/access";
import { AccessMatrix } from "@/components/AccessMatrix";

export const dynamic = "force-dynamic";

// Admin-only: who can do what. Reads straight from the engine rather than
// calling our own /api/access, so the page renders in one hop and can't show a
// different answer than the guards enforce.
export default async function AccessPage() {
  await requireAdminPage();

  let grants: Record<string, unknown> = {};
  let unreachable = false;
  try {
    grants = (await hrFetch<{ grants?: Record<string, unknown> }>("/hr/access")).grants ?? {};
  } catch {
    unreachable = true;
  }

  const admins = hrAdmins();
  const people = [...hrAllowlist()].map((email) => ({
    email,
    isAdmin: admins.has(email),
    access: admins.has(email) ? null : normalizeAccess(grants[email]),
    configured: admins.has(email) ? true : Object.prototype.hasOwnProperty.call(grants, email),
  }));

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "34px 24px 56px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ fontSize: 11.5, color: "#8a94a3", marginBottom: 6 }}>
        <Link href="/" style={{ color: "#2f4fb0", textDecoration: "none" }}>
          Home
        </Link>{" "}
        / Who can do what
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f" }}>Who can do what</h1>
      <p style={{ fontSize: 13, color: "#5b6676", lineHeight: 1.6, marginTop: 8, maxWidth: 640 }}>
        Set exactly what each person can open and change. Changes take effect immediately — permissions are checked on the
        server on every request, so removing something takes it away even if they already have the page open.
      </p>

      {unreachable ? (
        <div style={{ marginTop: 16, fontSize: 13, padding: "10px 13px", borderRadius: 8, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233" }}>
          Couldn&rsquo;t reach the permissions store, so this is showing everyone as having nothing. Don&rsquo;t save from this
          screen until it loads properly — you&rsquo;d overwrite real permissions with blanks.
        </div>
      ) : null}

      <div style={{ marginTop: 22 }}>
        <AccessMatrix people={people} />
      </div>

      <div style={{ fontSize: 11.5, color: "#8a94a3", marginTop: 24, borderTop: "1px solid #eef2f7", paddingTop: 14, lineHeight: 1.6 }}>
        Every change here is written to the{" "}
        <Link href="/audit" style={{ color: "#2f4fb0" }}>
          audit trail
        </Link>{" "}
        with the full resulting permission set, so &ldquo;who could see what, and when&rdquo; stays answerable after the fact.
      </div>
    </main>
  );
}
