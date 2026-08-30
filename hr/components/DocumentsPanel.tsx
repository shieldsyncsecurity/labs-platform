"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDisplayDate } from "./DateField";
import { AcceptedBadge } from "./AcceptedBadge";

export type IssuedDoc = {
  docId: string;
  docType: string;
  title: string;
  ref: string;
  generatedAt: string;
  acceptedAt?: string | null;
};

export type DocRow = {
  key: string;
  label: string;
  /** Generate page for this doc type (no query string). */
  href: string;
  /** docTypes in the issued history that count as "this document". */
  docTypes: string[];
  /** Greyed out with lockHint instead of a Generate link. */
  locked?: boolean;
  lockHint?: string;
  /** The letter date field applies (payslip has its own month/date screen). */
  dateable: boolean;
};

const DOCTYPE_LABEL: Record<string, string> = {
  offer: "Appointment letter",
  payslip: "Salary slip",
  verification: "Verification letter",
  experience: "Experience / relieving letter",
  leave: "Leave approval letter",
  increment: "Salary revision letter",
  confirmation: "Confirmation letter",
  "internship-offer": "Letter of Intent — Internship",
  completion: "Certificate of completion",
  "employment-history": "Employment history certificate",
  "resignation-acceptance": "Resignation acceptance letter",
  fnf: "Full & Final settlement",
};

const linkBtn: React.CSSProperties = { color: "#2f4fb0", fontSize: 12.5, fontWeight: 600, textDecoration: "none" };
const genBtn: React.CSSProperties = {
  background: "#1f3a5f", color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 700,
  borderRadius: 7, padding: "6px 12px", display: "inline-block", whiteSpace: "nowrap",
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * One unified Documents view: a lifecycle-ordered row per letter type with its
 * issued status and a Generate action, a single "Letter date" override that
 * back/fore-dates every dateable letter (blank = today), and the full issued
 * history below. Replaces the separate Letters / Salary slip / Issued documents
 * cards. The server page decides WHICH rows exist (permissions, intern vs
 * full-time, exited) — this component only renders them.
 */
export function DocumentsPanel({
  seq,
  rows,
  generated,
  isAdmin,
  footerLinks,
}: {
  seq: string;
  rows: DocRow[];
  generated: IssuedDoc[];
  isAdmin: boolean;
  footerLinks: Array<{ href: string; label: string }>;
}) {
  const [iso, setIso] = useState("");
  const display = iso ? formatDisplayDate(iso) : "";

  const genHref = (r: DocRow) =>
    r.dateable && display ? `${r.href}?date=${encodeURIComponent(display)}` : r.href;

  const issuedFor = (r: DocRow) =>
    generated.filter((g) => r.docTypes.includes(g.docType));

  return (
    <div style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, color: "#1f3a5f", fontSize: 14 }}>Documents</div>
        {rows.some((r) => r.dateable && !r.locked) ? (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 700, color: "#41506a" }}>
            Letter date
            <input
              type="date"
              value={iso}
              onChange={(e) => setIso(e.target.value)}
              style={{ padding: "5px 8px", fontSize: 12, border: "1px solid #d4dbe8", borderRadius: 7, background: "#fff" }}
            />
            <span style={{ fontWeight: 400, color: "#8a94a3" }}>{display ? `→ stamped ${display}` : "blank = today"}</span>
          </label>
        ) : null}
      </div>

      <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 10 }}>
        <tbody>
          {rows.map((r) => {
            const issued = issuedFor(r);
            const latest = issued[0];
            return (
              <tr key={r.key} style={{ borderTop: "1px solid #eef2f7" }}>
                <td style={{ padding: "9px 6px", color: r.locked ? "#8a94a3" : "#1f3a5f", fontWeight: 600, width: 200 }}>{r.label}</td>
                <td style={{ padding: "9px 6px" }}>
                  {issued.length === 0 ? (
                    <span style={{ color: "#8a94a3" }}>Not issued</span>
                  ) : issued.length === 1 ? (
                    <span style={{ color: "#146c3c" }}>
                      ✓ Issued {fmtDay(latest.generatedAt)} · <span style={{ fontFamily: "monospace", fontSize: 11.5 }}>{latest.ref}</span>
                    </span>
                  ) : (
                    <span style={{ color: "#146c3c" }}>✓ {issued.length} issued · latest {fmtDay(latest.generatedAt)}</span>
                  )}
                </td>
                <td style={{ padding: "9px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {latest ? (
                    <Link href={`/employees/${seq}/issued/${latest.docId}`} style={{ ...linkBtn, marginRight: 12 }}>Re-open</Link>
                  ) : null}
                  {r.locked ? (
                    <span style={{ fontSize: 11.5, color: "#8a94a3" }} title={r.lockHint}>🔒 {r.lockHint}</span>
                  ) : (
                    <Link href={genHref(r)} style={genBtn}>Generate</Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {footerLinks.length > 0 ? (
        <div style={{ marginTop: 10, borderTop: "1px solid #eef2f7", paddingTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {footerLinks.map((l) => (
            <Link key={l.href} href={l.href} style={linkBtn}>{l.label} &rarr;</Link>
          ))}
        </div>
      ) : null}

      {/* Full issued history — every save, not just the latest per type. */}
      {generated.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800 }}>Issued history</div>
            <div style={{ fontSize: 10.5, color: "#8a94a3" }}>Re-open re-renders exactly as issued</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 6 }}>
              <tbody>
                {generated.map((g) => (
                  <tr key={g.docId} style={{ borderTop: "1px solid #eef2f7" }}>
                    <td style={{ padding: "8px 6px", color: "#1f3a5f", fontWeight: 600, width: 190 }}>{DOCTYPE_LABEL[g.docType] ?? g.docType}</td>
                    <td style={{ padding: "8px 6px", color: "#5b6676", fontFamily: "monospace", fontSize: 11.5 }}>{g.ref}</td>
                    <td style={{ padding: "8px 6px", color: "#8a94a3", whiteSpace: "nowrap" }}>
                      {fmtWhen(g.generatedAt)}
                      {g.acceptedAt ? (
                        <div style={{ marginTop: 4 }}>
                          <AcceptedBadge seq={seq} genId={g.docId} acceptedAt={g.acceptedAt} isAdmin={isAdmin} />
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right" }}>
                      <Link href={`/employees/${seq}/issued/${g.docId}`} style={linkBtn}>Re-open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: "#8a94a3", marginTop: 10 }}>
          Nothing issued yet. Generate a document above and click &ldquo;Save to history&rdquo;.
        </p>
      )}
    </div>
  );
}
