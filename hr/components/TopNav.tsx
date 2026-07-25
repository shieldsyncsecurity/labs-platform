"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Persistent top menu, grouped to match the dashboard's lifecycle sections
// (Recruiting -> Employee records -> Payroll -> Governance) so the nav and
// the "What do you want to do?" home screen use the same mental model
// instead of two different vocabularies for the same app. A group with one
// destination renders as a plain link; a group with several renders as a
// dropdown. All dropdowns share name="topnav-menu" so opening one closes
// any other that's open — native <details> behaviour, no JS needed.
type NavItem = { href: string; label: string; match: (p: string) => boolean };
type NavGroup = { label: string; items: NavItem[]; match: (p: string) => boolean };

const GROUPS: NavGroup[] = [
  {
    label: "Recruiting",
    match: (p) => p.startsWith("/manage-candidates") || p === "/employees/new",
    items: [
      { href: "/manage-candidates", label: "Candidates", match: (p) => p.startsWith("/manage-candidates") },
      { href: "/employees/new", label: "New hire", match: (p) => p === "/employees/new" },
    ],
  },
  {
    label: "Employee records",
    match: (p) => p.startsWith("/employees") && p !== "/employees/new",
    items: [{ href: "/employees", label: "Employee records", match: (p) => p.startsWith("/employees") && p !== "/employees/new" }],
  },
  {
    label: "Payroll",
    match: (p) => p.startsWith("/payslips") || p.startsWith("/banking"),
    items: [
      { href: "/payslips", label: "Run payroll", match: (p) => p.startsWith("/payslips") && !p.startsWith("/payslips/summary") },
      { href: "/payslips/summary", label: "FY Summary", match: (p) => p.startsWith("/payslips/summary") },
      { href: "/banking", label: "Banking", match: (p) => p.startsWith("/banking") },
    ],
  },
  {
    label: "Governance",
    match: (p) => p.startsWith("/audit"),
    items: [{ href: "/audit", label: "Governance", match: (p) => p.startsWith("/audit") }],
  },
];

const pillBase: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  textDecoration: "none",
  padding: "7px 12px",
  borderRadius: 7,
  whiteSpace: "nowrap",
  flex: "none",
};

function NavGroupItem({ group, pathname }: { group: NavGroup; pathname: string }) {
  const active = group.match(pathname);
  const style: React.CSSProperties = { ...pillBase, color: active ? "#1f3a5f" : "#5b6676", background: active ? "#eef2f8" : "transparent" };

  // Single destination: a plain link, no dropdown chrome — nothing to choose between.
  if (group.items.length === 1) {
    return (
      <Link href={group.items[0].href} style={style}>
        {group.items[0].label}
      </Link>
    );
  }

  return (
    <details name="topnav-menu" style={{ position: "relative" }}>
      <summary style={{ ...style, listStyle: "none", cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4 }}>
        {group.label}
        <span style={{ fontSize: 9, color: active ? "#1f3a5f" : "#8a94a3" }}>&#9662;</span>
      </summary>
      <div
        style={{
          position: "absolute",
          left: 0,
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
        {group.items.map((item) => {
          const itemActive = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "block",
                padding: "8px 10px",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                borderRadius: 6,
                color: itemActive ? "#1f3a5f" : "#1b2331",
                background: itemActive ? "#eef2f8" : "transparent",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

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

        {/* Group links — same 4 sections as the dashboard, same order.
            Single row; on a narrow window it scrolls horizontally rather
            than wrapping onto an orphan second line. */}
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
          {GROUPS.map((g) => (
            <NavGroupItem key={g.label} group={g} pathname={pathname} />
          ))}
        </nav>

        {/* Quick-add menu — Employees and Candidates are equally common
            starting points now, so this is a menu rather than one hardcoded
            action. <details>/<summary> needs no click-outside JS, and
            shares name="topnav-menu" so it closes if a group dropdown opens. */}
        <details name="topnav-menu" style={{ position: "relative", flex: "none" }}>
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
              href="/manage-candidates/new"
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
