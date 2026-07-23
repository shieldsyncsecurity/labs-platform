"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Persistent top menu — the things HR does, one click from anywhere:
// Employees · Payslips · FY Summary · Audit, plus the Add-employee quick
// action and the signed-in identity. Hidden on /login (unauthenticated) and
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
          maxWidth: 960,
          margin: "0 auto",
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        {/* Brand — home */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", marginRight: 6 }}>
          <img src="/brand/cipher-s-mark.png" alt="" width={28} height={28} style={{ borderRadius: 7, display: "block" }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: "#1f3a5f", whiteSpace: "nowrap" }}>ShieldSync HR</span>
        </Link>

        {/* Task links */}
        <nav style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", flex: 1 }}>
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
                  padding: "6px 11px",
                  borderRadius: 8,
                  color: active ? "#1f3a5f" : "#5b6676",
                  background: active ? "#eef2f8" : "transparent",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        {/* Quick action + identity */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/employees/new"
            style={{ background: "#1f3a5f", color: "#fff", textDecoration: "none", fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: "7px 12px", whiteSpace: "nowrap" }}
          >
            + Add employee
          </Link>
          <div style={{ textAlign: "right", lineHeight: 1.3 }}>
            {actor ? <div style={{ fontSize: 10.5, color: "#8a94a3", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{actor}</div> : null}
            <a href="/api/auth/logout" style={{ fontSize: 11.5, color: "#2f4fb0", fontWeight: 600 }}>Sign out</a>
          </div>
        </div>
      </div>
    </header>
  );
}
