"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const printBtn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#1f3a5f", border: "1px solid #c3cee0", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const input: React.CSSProperties = { padding: "7px 9px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6, background: "#fff" };
const dangerBtn: React.CSSProperties = { background: "#fff", color: "#9a2233", border: "1px solid #e6b8bf", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };

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

/** "ACCEPTANCE OF RESIGNATION" -> "Acceptance of Resignation" (filename style). */
function titleCase(s: string): string {
  const small = new Set(["of", "and", "the", "for", "in", "on", "a", "an", "to"]);
  return s
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
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
  canIssue = true,
  withdraw,
  canWithdraw = false,
}: {
  backHref: string;
  backLabel: string;
  save?: SaveSpec;
  email?: EmailSpec;
  /** Issued pages: server-rendered PDF download of the archived snapshot. */
  pdfHref?: string;
  /** May the viewer issue/email/print this document? Defaults to true for every
   * existing caller; the payslip generator passes false when the viewer has
   * payroll but not Letters (documents) write access, turning a wall of 403s
   * into an honest "view-only" note instead of dead buttons. */
  canIssue?: boolean;
  /** Issued pages only: lets an admin/documents-writer withdraw a document
   * issued in error (e.g. a payslip for the wrong month). The DELETE is audited
   * server-side, so the resulting gap is always traceable to a decision. */
  withdraw?: { seq: string; genId: string; label?: string; ref?: string };
  canWithdraw?: boolean;
}) {
  const sp = useSearchParams();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailState, setEmailState] = useState<string | null>(null);
  // After a payslip (fixed-ref) save, the engine returns the archived docId.
  // Capturing it lets Email auto-render the PDF server-side IN PLACE — no more
  // "attach a file" on a slip that's already in history.
  const [savedGenId, setSavedGenId] = useState<string | undefined>(undefined);
  const [withdrawing, setWithdrawing] = useState(false);
  const printedOnce = useRef(false);

  // genId to drive the one-click (server-rendered) email: an explicit issued-page
  // genId, or the one just saved on this generate page.
  const effectiveGenId = email?.genId ?? savedGenId;

  // The browser names a printed/saved PDF after document.title, so make it say
  // what the document IS: "Acceptance of Resignation — Anurag Sharma —
  // SSS-HR-2026-014" instead of the page's generic title. Slashes are swapped
  // out because they are illegal in filenames.
  const docTitle = save?.title ?? withdraw?.label;
  const docRef = withdraw?.ref;
  useEffect(() => {
    if (!docTitle) return;
    const person = backLabel && !/^back to/i.test(backLabel) ? ` — ${backLabel}` : "";
    const ref = docRef && !docRef.includes("•") ? ` — ${docRef}` : "";
    const prev = document.title;
    document.title = `${titleCase(docTitle)}${person}${ref}`.replace(/\//g, "-");
    return () => {
      document.title = prev;
    };
  }, [docTitle, docRef, backLabel]);

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

  // A payslip (a fixed-ref `save` spec) must be archived BEFORE it can be
  // emailed. Emailing first files the PDF only as a loose 'sent' attachment and
  // never registers it as an issued slip — the employee still shows unpaid and
  // the slip is missing from /payslips + the FY summary. So require an
  // effectiveGenId (set by email.genId on the issued page, or by savedGenId
  // after Save to history) before Email is allowed. Mirrors the series-letter
  // issue-then-email gate; the issued-page path (email.genId set) is unaffected.
  const needsSaveBeforeEmail = Boolean(save) && !effectiveGenId;
  const emailBlocked = needsIssue || needsSaveBeforeEmail;
  const emailBlockedReason = needsIssue
    ? "Issue the letter first (Save/Print) — emails must carry the real reference number"
    : needsSaveBeforeEmail
      ? "Save to history first"
      : undefined;

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
      if (genId) setSavedGenId(genId); // enables one-click server-rendered email in place
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

  // Withdraw a document issued in error (e.g. a payslip for the wrong month).
  // Confirmed, then removed via the audited DELETE; on success we return to the
  // employee record where the row is now gone.
  async function onWithdraw(): Promise<void> {
    if (!withdraw) return;
    const what = withdraw.label || "document";
    const refPart = withdraw.ref ? ` (${withdraw.ref})` : "";
    if (!confirm(`Withdraw this ${what}${refPart}?\n\nIt is permanently removed from the employee's history. The withdrawal is recorded in the audit trail.`)) return;
    setWithdrawing(true);
    try {
      const res = await fetch(`/api/employees/${withdraw.seq}/generated/${encodeURIComponent(withdraw.genId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Could not withdraw the document.");
        setWithdrawing(false);
        return;
      }
      window.location.href = `/employees/${withdraw.seq}`;
    } catch {
      alert("Could not withdraw — check the connection and try again.");
      setWithdrawing(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Link href={backHref} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {backLabel}</Link>
          {withdraw && canWithdraw ? (
            <button
              type="button"
              onClick={onWithdraw}
              disabled={withdrawing}
              title="Withdraw a document issued in error — permanently removes it from history (audited)"
              style={{ ...dangerBtn, opacity: withdrawing ? 0.6 : 1 }}
            >
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </button>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {canIssue ? (
            <>
              {pdfHref ? <DownloadPdfButton href={pdfHref} /> : null}
              {email ? (
                <button
                  type="button"
                  onClick={() => setEmailOpen((v) => !v)}
                  disabled={emailBlocked}
                  title={emailBlockedReason}
                  style={{ ...ghostBtn, opacity: emailBlocked ? 0.5 : 1, cursor: emailBlocked ? "not-allowed" : "pointer" }}
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
            </>
          ) : (
            <span style={{ fontSize: 12, color: "#7a5714", background: "#fdf4e3", border: "1px solid #f0dfb8", borderRadius: 6, padding: "6px 10px", maxWidth: 360, lineHeight: 1.4 }}>
              You can view this slip but need Letters (documents) write access to save, email or print it.
            </span>
          )}
        </div>
      </div>

      {email && emailOpen && canIssue && !emailBlocked ? (
        <form
          onSubmit={onEmail}
          style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}
        >
          {effectiveGenId ? <input type="hidden" name="genId" value={effectiveGenId} /> : null}
          <input name="to" type="email" required defaultValue={email.defaultTo} placeholder="employee@email.com" style={{ ...input, minWidth: 200 }} />
          <input name="subject" required defaultValue={email.defaultSubject} style={{ ...input, flex: 1, minWidth: 220 }} />
          <label style={{ color: "#41506a", fontSize: 12 }}>
            PDF{effectiveGenId ? " (optional — server generates when omitted)" : ""}{" "}
            <input name="file" type="file" required={!effectiveGenId} accept="application/pdf" style={{ fontSize: 12 }} />
          </label>
          <button type="submit" style={{ ...printBtn, padding: "7px 12px" }}>Send</button>
          <span style={{ flexBasis: "100%", color: "#8a94a3", fontSize: 11 }}>
            {effectiveGenId
              ? "The server renders this issued document to PDF and attaches it (attach a file only to override). Sent copies are archived + audited."
              : "Save to history first (or attach the printed PDF) — then Send. The exact sent file is archived + audited."}
            {emailState ? <b style={{ color: "#1f3a5f" }}> {emailState}</b> : null}
          </span>
        </form>
      ) : null}
    </div>
  );
}
