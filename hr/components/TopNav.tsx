"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Persistent top menu — the things HR does, one click from anywhere:
// Employees · Candidates · Payslips · FY Summary · Audit, plus a quick-add
// menu and the signed-in identity. Hidden on /login (unauthenticated) and
// carries ss-noprint so it never appears on a printed letterhead.
const LINKS: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/employees", label: "Employees", match: (p) => p.startsWith("/employees") },
  { href: "/candidates", label: "Candidates", match: (p) => p.startsWith("/candidates") },
  { href: "/payslips", label: "Payslips", match: (p) => p.startsWith("/payslips") && !p.startsWith("/payslips/summary") },
  { href: "/payslips/summary", label: "FY Summary", match: (p) => p.startsWith("/payslips/summary") },
  { href: "/audit", label: "Audit log", match: (p) => p.startsWith("/audit") },
];

export function TopNav({ actor }: { actor?: string | null }) {
  const pathname = usePathname() ?? "/";
  // Never on unauthenticated surfaces: /login, and the candidate questionnaire
  // (/q/*) which is a public token page with no portal access.
  if (pathname === "/login" || pathname.startsWith("/q/")) return null;

  const initial = (actor ?? "?").trim().charAt(0).toUpperCase();

  return (
    <header
      className="ss-noprint"
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #dfe5ef",
        position: "sticky",
        top: 0,
        zIndex: 50,
        fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          gap: 22,
          height: 56,
        }}
      >
        {/* Brand — home */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", flex: "none" }}>
          <img src="/brand/cipher-s-mark.png" alt="" width={26} height={26} style={{ borderRadius: 6, display: "block" }} />
          <span style={{ fontSize: 14.5, fontWeight: 800, color: "#1f3a5f", whiteSpace: "nowrap" }}>ShieldSync HR</span>
        </Link>

        <div style={{ width: 1, alignSelf: "stretch", background: "#eef1f6", flex: "none" }} />

        {/* Task links — single row; on a narrow window it scrolls horizontally
            rather than wrapping onto an orphan second line. */}
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flex: "1 1 auto",
            minWidth: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {LINKS.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: "none",
                  padding: "7px 12px",
                  borderRadius: 7,
                  whiteSpace: "nowrap",
                  flex: "none",
                  color: active ? "#1f3a5f" : "#5b6676",
                  background: active ? "#eef2f8" : "transparent",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        {/* Quick-add menu — Employees and Candidates are equally common
            starting points now, so this is a menu rather than one hardcoded
            action. <details>/<summary> needs no click-outside JS. */}
        <details style={{ position: "relative", flex: "none" }}>
          <summary
            style={{
              listStyle: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "#1f3a5f",
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 700,
              borderRadius: 8,
              padding: "7px 12px",
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            + New
          </summary>
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              background: "#fff",
              border: "1px solid #e2e8f2",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(31,58,95,0.14)",
              padding: 6,
              minWidth: 170,
              zIndex: 60,
            }}
          >
            <Link
              href="/employees/new"
              style={{ display: "block", padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "#1b2331", textDecoration: "none", borderRadius: 6 }}
            >
              Employee
            </Link>
            <Link
              href="/candidates/new"
              style={{ display: "block", padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "#1b2331", textDecoration: "none", borderRadius: 6 }}
            >
              Candidate
            </Link>
          </div>
        </details>

        <div style={{ width: 1, alignSelf: "stretch", background: "#eef1f6", flex: "none" }} />

        {/* Identity — a compact chip instead of a stacked email+link that
            wraps onto its own line at ordinary widths. */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
          <div
            title={actor ?? undefined}
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "#eef2f8",
              color: "#1f3a5f",
              fontSize: 11.5,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            {initial}
          </div>
          <a href="/api/auth/logout" style={{ fontSize: 12, color: "#5b6676", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
            Sign out
          </a>
        </div>
      </div>
    </header>
  );
}
