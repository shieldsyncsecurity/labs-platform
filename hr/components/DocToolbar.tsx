"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

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
   * number atomically at save time. */
  refSeries?: "hr" | "int";
  refYear?: number;
  snapshot: unknown;
};

export type EmailSpec = { seq: string; defaultTo?: string; defaultSubject: string; genId?: string };

// "Download PDF" (issued pages): server-rendered A4 of the archived snapshot.
// Dev returns 501 (no Browser Rendering binding) — explain and point at Print.
function DownloadPdfButton({ href }: { href: string }) {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch(href);
      if (res.status === 501) {
        alert((await res.json()).error ?? "Server-side PDF is available after deployment — use Print → Save as PDF.");
      } else if (!res.ok) {
        alert((await res.json().catch(() => ({}))).error ?? "Could not render the PDF.");
      } else {
        const blob = await res.blob();
        const cd = res.headers.get("content-disposition") ?? "";
        const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? "document.pdf";
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      alert("Could not download the PDF.");
    }
    setBusy(false);
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>
      {busy ? "Rendering…" : "Download PDF"}
    </button>
  );
}

/** Print only after every image (signature, seal, logo, QR) has decoded — a
 * fixed timer can print an unsigned letter on a cold cache. */
async function printWhenReady() {
  try {
    await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {})));
  } catch {}
  window.print();
}

// Toolbar above a generated document. ISSUE-THEN-PRINT is structural for
// series letters: saving allocates the real ref and stores the snapshot, then
// we navigate to the ISSUED page (/employees/:seq/issued/:genId) and print
// THAT — the archived snapshot, never a live re-render that could drift from
// what history holds. Payslips (fixed ref) print in place after saving.
// Email on unissued series letters is blocked — a PDF with a placeholder ref
// must never leave the building.
export function DocToolbar({
  backHref,
  backLabel,
  save,
  email,
  pdfHref,
}: {
  backHref: string;
  backLabel: string;
  save?: SaveSpec;
  email?: EmailSpec;
  /** Issued pages: server-rendered PDF download of the archived snapshot. */
  pdfHref?: string;
}) {
  const sp = useSearchParams();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailState, setEmailState] = useState<string | null>(null);
  const printedOnce = useRef(false);

  // On the issued page after an issue+print flow: print the archived render once.
  useEffect(() => {
    if (sp.get("autoprint") === "1" && !printedOnce.current) {
      printedOnce.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("autoprint");
      window.history.replaceState(null, "", url.toString());
      printWhenReady();
    }
  }, [sp]);

  const needsIssue = Boolean(save?.refSeries) && !saved;

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
      const genId: string | undefined = data?.gen?.docId;
      if (save.refSeries && genId) {
        // Print/inspect the ARCHIVED snapshot under its allocated ref.
        window.location.href = `/employees/${save.seq}/issued/${genId}${thenPrint ? "?autoprint=1" : ""}`;
        return; // navigation takes over
      }
      if (thenPrint) printWhenReady();
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
      else if (data.archived === false) setEmailState("Sent ✓ — but archiving failed; do NOT resend. Save the PDF to the employee's documents manually.");
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
          {pdfHref ? <DownloadPdfButton href={pdfHref} /> : null}
          {email ? (
            <button
              type="button"
              onClick={() => setEmailOpen((v) => !v)}
              disabled={needsIssue}
              title={needsIssue ? "Issue the letter first (Save/Print) — emails must carry the real reference number" : undefined}
              style={{ ...ghostBtn, opacity: needsIssue ? 0.5 : 1, cursor: needsIssue ? "not-allowed" : "pointer" }}
            >
              Email…
            </button>
          ) : null}
          {save ? (
            <button type="button" onClick={() => doSave(false)} disabled={busy || saved} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>
              {saved ? "Saved to history ✓" : busy ? "Saving…" : save.refSeries ? "Issue (save to history)" : "Save to history"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (save && !saved ? doSave(true) : printWhenReady())}
            disabled={busy}
            style={printBtn}
            title={save && !saved ? "Issues (saves to history), then prints the archived copy" : undefined}
          >
            {save?.refSeries && !saved ? "Issue + Print" : "Print / Save as PDF"}
          </button>
        </div>
      </div>

      {email && emailOpen && !needsIssue ? (
        <form
          onSubmit={onEmail}
          style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}
        >
          {email.genId ? <input type="hidden" name="genId" value={email.genId} /> : null}
          <input name="to" type="email" required defaultValue={email.defaultTo} placeholder="employee@email.com" style={{ ...input, minWidth: 200 }} />
          <input name="subject" required defaultValue={email.defaultSubject} style={{ ...input, flex: 1, minWidth: 220 }} />
          <label style={{ color: "#41506a", fontSize: 12 }}>
            PDF{email.genId ? " (optional — server generates when omitted)" : ""}{" "}
            <input name="file" type="file" required={!email.genId} accept="application/pdf" style={{ fontSize: 12 }} />
          </label>
          <button type="submit" style={{ ...printBtn, padding: "7px 12px" }}>Send</button>
          <span style={{ flexBasis: "100%", color: "#8a94a3", fontSize: 11 }}>
            {email.genId
              ? "The server renders this issued document to PDF and attaches it (attach a file only to override). Sent copies are archived + audited."
              : "Attach the printed PDF of this document (Print → Save as PDF). The exact sent file is archived + audited."}
            {emailState ? <b style={{ color: "#1f3a5f" }}> {emailState}</b> : null}
          </span>
        </form>
      ) : null}
    </div>
  );
}
