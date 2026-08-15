"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SelfServeRow = {
  seq: number;
  name: string;
  employeeId: string;
  status?: string;
  hasSelfPin?: boolean;
};

/**
 * Every employee's self-serve login in one place.
 *
 * The PIN itself is stored ONLY as a salted SHA-256 hash, so an existing PIN
 * cannot be displayed here — not by the portal, not by anyone. That is the
 * point of hashing it: a copy of the database is not a set of working logins.
 * What this screen gives instead is the operational equivalent — see at a glance
 * who has access, and mint a fresh PIN for anyone in one click, shown once.
 */
export function SelfServePanel({ rows }: { rows: SelfServeRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [pins, setPins] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function issue(row: SelfServeRow) {
    if (row.hasSelfPin && !confirm(`${row.name} already has a working PIN. Issuing a new one stops the old one immediately — they'll need the new PIN to sign in. Continue?`)) {
      return;
    }
    setBusy(row.seq);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${row.seq}/self-pin`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Could not issue the PIN.");
      else {
        setPins((p) => ({ ...p, [row.seq]: data.pin }));
        router.refresh();
      }
    } catch {
      setError("Could not reach the server — check the connection and try again.");
    }
    setBusy(null);
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f2", borderRadius: 12, padding: "18px 20px" }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#1f3a5f" }}>Employee self-serve logins</div>
      <p style={{ fontSize: 12.5, color: "#5b6676", lineHeight: 1.6, margin: "6px 0 4px", maxWidth: 660 }}>
        Lets an employee sign in at <b>/my/login</b> with their Employee ID and PIN to view and download only their own
        issued documents. It gives them nothing else in the portal.
      </p>
      <p style={{ fontSize: 12, color: "#8a5a00", background: "#fdf4e3", border: "1px solid #f0d9a8", borderRadius: 8, padding: "8px 11px", lineHeight: 1.55, maxWidth: 660 }}>
        <b>An existing PIN can&rsquo;t be looked up</b> — only a one-way hash of it is stored, so nobody (including this
        screen, and including anyone who obtained a copy of the database) can read it back. If someone forgets theirs,
        issue a new one below and pass it on; it appears once, here.
      </p>

      {error ? (
        <div style={{ marginTop: 10, fontSize: 12.5, padding: "8px 11px", borderRadius: 8, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233" }}>
          {error}
        </div>
      ) : null}

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em" }}>
            <th style={{ padding: "8px 8px" }}>Employee</th>
            <th style={{ padding: "8px 8px" }}>Employee ID</th>
            <th style={{ padding: "8px 8px" }}>Self-serve login</th>
            <th style={{ padding: "8px 8px", textAlign: "right" }}>PIN</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pin = pins[r.seq];
            const exited = r.status === "exited";
            return (
              <tr key={r.seq} style={{ borderTop: "1px solid #eef2f7" }}>
                <td style={{ padding: "10px 8px", fontWeight: 600, color: "#1b2331" }}>
                  {r.name}
                  {exited ? <span style={{ fontSize: 10.5, color: "#8a94a3", fontWeight: 400 }}> · former</span> : null}
                </td>
                <td style={{ padding: "10px 8px", fontFamily: "monospace", color: "#1f3a5f" }}>{r.employeeId}</td>
                <td style={{ padding: "10px 8px" }}>
                  {r.hasSelfPin ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#146c3c", background: "#e7f6ee", border: "1px solid #b7e2c9", borderRadius: 999, padding: "2px 9px" }}>
                      Active
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#8a94a3", background: "#f4f6fa", border: "1px solid #e2e8f2", borderRadius: 999, padding: "2px 9px" }}>
                      Not set up
                    </span>
                  )}
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {pin ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <b style={{ fontSize: 15, letterSpacing: 3, color: "#1f3a5f", fontFamily: "monospace" }}>{pin}</b>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(pin)}
                        style={{ background: "none", border: "1px solid #c3cee0", borderRadius: 6, fontSize: 11, fontWeight: 600, color: "#41506a", padding: "3px 8px", cursor: "pointer" }}
                      >
                        Copy
                      </button>
                      <span style={{ fontSize: 10.5, color: "#8a5a00" }}>shown once</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => issue(r)}
                      disabled={busy === r.seq}
                      style={{
                        background: r.hasSelfPin ? "none" : "#1f3a5f",
                        color: r.hasSelfPin ? "#41506a" : "#fff",
                        border: r.hasSelfPin ? "1px solid #c3cee0" : "none",
                        borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700,
                        cursor: busy === r.seq ? "default" : "pointer", opacity: busy === r.seq ? 0.6 : 1,
                      }}
                    >
                      {busy === r.seq ? "Issuing…" : r.hasSelfPin ? "Issue new PIN" : "Set up login"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#8a94a3", marginTop: 10 }}>No employee records yet.</p>
      ) : null}
    </div>
  );
}
