"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const printBtn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#1f3a5f", border: "1px solid #c3cee0", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const input: React.CSSProperties = { padding: "7px 9px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6, background: "#fff" };

/** Toolbar for a self-serve document view: back link, Download, Email, Print.
 * No Save/Issue here — everything reachable through /my is already issued. */
export function SelfDocActions({ genId, defaultTo, defaultSubject }: { genId: string; defaultTo?: string; defaultSubject: string }) {
  const [downloading, setDownloading] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailState, setEmailState] = useState<string | null>(null);

  // The browser names a printed/saved PDF after document.title — use the doc's
  // own name (the email subject already carries "Title — Ref") instead of the
  // page's generic one. Slashes are illegal in filenames.
  useEffect(() => {
    const prev = document.title;
    document.title = defaultSubject.replace(/\//g, "-");
    return () => {
      document.title = prev;
    };
  }, [defaultSubject]);

  async function onDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/self/pdf/${genId}`);
      if (!res.ok) {
        alert((await res.json().catch(() => ({}))).error ?? "Could not download the PDF.");
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
    setDownloading(false);
  }

  async function onEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEmailState("Sending…");
    try {
      const res = await fetch("/api/self/email", { method: "POST", body: new FormData(e.currentTarget) });
      const data = await res.json();
      setEmailState(res.ok ? "Sent ✓" : (data.error ?? "Send failed."));
    } catch {
      setEmailState("Send failed.");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/my" style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>&larr; Your documents</Link>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onDownload} disabled={downloading} style={{ ...ghostBtn, opacity: downloading ? 0.6 : 1 }}>
            {downloading ? "Preparing…" : "Download PDF"}
          </button>
          <button type="button" onClick={() => setEmailOpen((v) => !v)} style={ghostBtn}>
            Email…
          </button>
          <button type="button" onClick={() => window.print()} style={printBtn}>
            Print
          </button>
        </div>
      </div>

      {emailOpen ? (
        <form
          onSubmit={onEmail}
          style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}
        >
          <input type="hidden" name="genId" value={genId} />
          <label>
            To <input name="to" type="email" required defaultValue={defaultTo ?? ""} style={{ ...input, minWidth: 220 }} />
          </label>
          <label>
            Subject <input name="subject" required defaultValue={defaultSubject} style={{ ...input, minWidth: 260 }} />
          </label>
          <button type="submit" style={{ ...printBtn, padding: "7px 12px" }}>Send</button>
          {emailState ? <span style={{ color: "#5b6676" }}>{emailState}</span> : null}
        </form>
      ) : null}
    </div>
  );
}
