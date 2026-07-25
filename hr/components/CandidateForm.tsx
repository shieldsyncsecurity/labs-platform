"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, SelectOrCustom, gridStyle, labelStyle, inputStyle, ghostBtn, primaryBtn } from "./fields";
import { DateField } from "./DateField";
import { ROLE_OPTIONS, SOURCE_OPTIONS, type Candidate } from "@/lib/candidate";
import { QUESTIONNAIRES, DEFAULT_ROLE_KEY } from "@/lib/questionnaire";

type ParsedFields = { name?: string; email?: string; phone?: string };

/**
 * Resume import — a best-effort text-extraction guess at name/email/phone,
 * always shown for the HR user to review and correct, never auto-submitted.
 * Prefills the three uncontrolled `Field` inputs below by remounting them
 * (via `key`) with new `defaultValue`s once a parse succeeds.
 */
function ResumeImport({ onParsed }: { onParsed: (fields: ParsedFields) => void }) {
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

export function CandidateForm({ candidate }: { candidate?: Candidate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ParsedFields>({});
  const [importKey, setImportKey] = useState(0);
  const editing = Boolean(candidate);

  function handleParsed(fields: ParsedFields) {
    setImported(fields);
    setImportKey((k) => k + 1); // remount the Field inputs below with new defaultValues
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const payload = {
      ...(candidate ?? {}),
      name: get("name"),
      email: get("email"),
      phone: get("phone"),
      roleAppliedFor: get("roleAppliedFor"),
      questionnaireRole: get("questionnaireRole") || DEFAULT_ROLE_KEY,
      source: get("source"),
      interviewedOn: get("interviewedOn"),
      interviewedBy: get("interviewedBy"),
      notes: get("notes"),
    };

    try {
      const res = await fetch(editing ? `/api/candidates/${candidate!.seq}` : "/api/candidates", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        setBusy(false);
        return;
      }
      router.push(`/manage-candidates/${data.candidate?.seq ?? candidate!.seq}`);
      router.refresh();
    } catch {
      setError("Could not reach the server — check the connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? (
        <div style={{ background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>{error}</div>
      ) : null}

      {!editing ? <ResumeImport onParsed={handleParsed} /> : null}

      <div style={gridStyle} key={importKey}>
        <Field name="name" label="Full name" required defaultValue={imported.name ?? candidate?.name} />
        <Field name="email" label="Email address (the questionnaire link goes here)" type="email" required defaultValue={imported.email ?? candidate?.email} />
        <Field name="phone" label="Mobile number" defaultValue={imported.phone ?? candidate?.phone} />
        <SelectOrCustom name="roleAppliedFor" label="Role applied for" required options={ROLE_OPTIONS} defaultValue={candidate?.roleAppliedFor} />
        <div>
          <label style={labelStyle} htmlFor="questionnaireRole">Questionnaire to send</label>
          <select id="questionnaireRole" name="questionnaireRole" defaultValue={candidate?.questionnaireRole ?? DEFAULT_ROLE_KEY} style={inputStyle}>
            {Object.values(QUESTIONNAIRES).map((q) => (
              <option key={q.roleKey} value={q.roleKey}>{q.roleTitle}</option>
            ))}
          </select>
        </div>
        <SelectOrCustom name="source" label="Where did they come from?" options={SOURCE_OPTIONS} defaultValue={candidate?.source} />
        <DateField name="interviewedOn" label="Interviewed on" defaultValue={candidate?.interviewedOn} />
        <Field name="interviewedBy" label="Interviewed by" defaultValue={candidate?.interviewedBy} placeholder="e.g. Founder" />
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={labelStyle} htmlFor="notes">Your notes from the interview</label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={candidate?.notes}
          placeholder="Your own impressions — the candidate never sees these."
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      <button type="submit" disabled={busy} style={{ ...primaryBtn, marginTop: 16, opacity: busy ? 0.6 : 1 }}>
        {busy ? "Saving…" : editing ? "Save changes" : "Add candidate"}
      </button>
    </form>
  );
}
