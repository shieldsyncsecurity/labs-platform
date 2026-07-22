"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

const printBtn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#1f3a5f", border: "1px solid #c3cee0", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const input: React.CSSProperties = { padding: "7px 9px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6, background: "#fff" };

export type SaveSpec = {
  seq: string;
  docType: string;
  title: string;
  /** Fixed ref (payslips). Mutually exclusive with refSeries. */
  ref?: string;
  /** Unified letter series — the engine allocates the REAL SSS/HR|INT/<year>/NNN
   * number atomically at save time; the page shows a provisional ref until then. */
  refSeries?: "hr" | "int";
  refYear?: number;
  snapshot: unknown;
};

export type EmailSpec = { seq: string; defaultTo?: string; defaultSubject: string };

// Toolbar above a generated document: back link, Email (Resend, PDF attach),
// Save to history, and Print. PRINT AUTO-SAVES first when a save spec is
// present — a sealed letter must never be issued without a history record.
// When a series ref is allocated, the page reloads with ?ref=<allocated> (and
// autoprint=1 if printing) so the printed sheet carries the REAL reference.
export function DocToolbar({
  backHref,
  backLabel,
  save,
  email,
}: {
  backHref: string;
  backLabel: string;
  save?: SaveSpec;
  email?: EmailSpec;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [saved, setSaved] = useState(sp.get("issued") === "1");
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailState, setEmailState] = useState<string | null>(null);
  const printedOnce = useRef(false);

  // After a ref-allocating save reload, fire the queued print exactly once.
  useEffect(() => {
    if (sp.get("autoprint") === "1" && !printedOnce.current) {
      printedOnce.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("autoprint");
      window.history.replaceState(null, "", url.toString());
      setTimeout(() => window.print(), 250);
    }
  }, [sp]);

  async function doSave(thenPrint: boolean): Promise<void> {
    if (!save) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/employees/${save.seq}/generated`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType: save.docType,
          title: save.title,
          ref: save.ref,
          refSeries: save.refSeries,
          refYear: save.refYear,
          snapshot: save.snapshot,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Could not save.");
        setBusy(false);
        return;
      }
      setSaved(true);
      const allocated: string | undefined = data?.gen?.ref;
      if (save.refSeries && allocated) {
        // Reload with the real reference so the sheet shows what was issued.
        const url = new URL(window.location.href);
        url.searchParams.set("ref", allocated);
        url.searchParams.set("issued", "1");
        if (thenPrint) url.searchParams.set("autoprint", "1");
        window.location.href = url.toString();
        return; // navigation takes over
      }
      if (thenPrint) setTimeout(() => window.print(), 150);
    } catch {
      alert("Could not save — check the connection and try again.");
    }
    setBusy(false);
  }

  async function onEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) return;
    setEmailState("Sending…");
    try {
      const res = await fetch(`/api/employees/${email.seq}/email`, { method: "POST", body: new FormData(e.currentTarget) });
      const data = await res.json();
      if (!res.ok) setEmailState(data.error ?? "Send failed.");
      else setEmailState(data.simulated ? "Recorded (email simulated — no RESEND_API_KEY in dev)." : "Sent ✓ — archived to the employee's documents.");
    } catch {
      setEmailState("Send failed.");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Link href={backHref} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {backLabel}</Link>
        <div style={{ display: "flex", gap: 8 }}>
          {email ? (
            <button type="button" onClick={() => setEmailOpen((v) => !v)} style={ghostBtn}>
              Email…
            </button>
          ) : null}
          {save ? (
            <button type="button" onClick={() => doSave(false)} disabled={busy || saved} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>
              {saved ? "Saved to history ✓" : busy ? "Saving…" : "Save to history"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (save && !saved ? doSave(true) : window.print())}
            disabled={busy}
            style={printBtn}
            title={save && !saved ? "Saves to history, then prints" : undefined}
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {email && emailOpen ? (
        <form
          onSubmit={onEmail}
          style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}
        >
          <input name="to" type="email" required defaultValue={email.defaultTo} placeholder="employee@email.com" style={{ ...input, minWidth: 200 }} />
          <input name="subject" required defaultValue={email.defaultSubject} style={{ ...input, flex: 1, minWidth: 220 }} />
          <label style={{ color: "#41506a", fontSize: 12 }}>
            PDF <input name="file" type="file" required accept="application/pdf" style={{ fontSize: 12 }} />
          </label>
          <button type="submit" style={{ ...printBtn, padding: "7px 12px" }}>Send</button>
          <span style={{ flexBasis: "100%", color: "#8a94a3", fontSize: 11 }}>
            Attach the printed PDF of this document (Print → Save as PDF). The exact sent file is archived + audited.
            {emailState ? <b style={{ color: "#1f3a5f" }}> {emailState}</b> : null}
          </span>
        </form>
      ) : null}
    </div>
  );
}
