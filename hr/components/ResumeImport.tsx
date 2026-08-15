"use client";

import { useRef, useState } from "react";
import { ghostBtn } from "./fields";

export type ParsedFields = { name?: string; email?: string; phone?: string };

/**
 * Resume import — a best-effort text-extraction guess at name/email/phone from a
 * PDF or Word (.docx) resume, always shown for the HR user to review and correct,
 * never auto-submitted. Shared by the Add Candidate and Add Employee forms; the
 * caller decides which fields to prefill (a candidate maps email->email, an
 * employee maps email->personalEmail). Reads the file in memory only — nothing is
 * stored by the parse endpoint.
 */
export function ResumeImport({ onParsed }: { onParsed: (fields: ParsedFields) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/candidates/parse-resume", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "Could not read that resume." });
      } else {
        const { name, email, phone } = data.fields ?? {};
        if (!name && !email && !phone) {
          setMsg({ kind: "err", text: "Read the file, but couldn't find a name, email or phone in it — please fill those in yourself." });
        } else {
          onParsed({ name, email, phone });
          const found = [name && "name", email && "email", phone && "phone"].filter(Boolean).join(", ");
          setMsg({ kind: "ok", text: `Filled in from the resume: ${found}. Please check they're correct.` });
        }
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server." });
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  return (
    <div style={{ border: "1px dashed #c3cee0", borderRadius: 10, padding: "12px 14px", marginBottom: 16, background: "#f8fafc" }}>
      <input ref={ref} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={pick} style={{ display: "none" }} id="resume-import-input" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label
          htmlFor="resume-import-input"
          style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
        >
          📄 {busy ? "Reading…" : "Import from resume (PDF or Word)"}
        </label>
        <span style={{ fontSize: 11.5, color: "#8a94a3" }}>Fills in name, email and mobile below — you can edit anything it gets wrong.</span>
      </div>
      {msg ? (
        <div style={{ marginTop: 8, fontSize: 12, color: msg.kind === "ok" ? "#146c3c" : "#9a2233", lineHeight: 1.5 }}>{msg.text}</div>
      ) : null}
    </div>
  );
}
