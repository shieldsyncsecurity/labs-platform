"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Answers, Field, Questionnaire } from "@/lib/questionnaire";
import { displayAnswer, isRequired } from "@/lib/questionnaire";

const OTHER = "__other__";

const label: React.CSSProperties = { display: "block", fontSize: 13.5, fontWeight: 700, color: "#1b2331", marginBottom: 4, lineHeight: 1.45 };
const hintStyle: React.CSSProperties = { fontSize: 12, color: "#6b7686", marginBottom: 7, lineHeight: 1.5 };
const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14.5,
  border: "1px solid #ccd5e4",
  borderRadius: 8,
  background: "#fff",
  boxSizing: "border-box",
  fontFamily: "inherit",
  color: "#1b2331",
};
const sectionCard: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 12, padding: "20px 22px", background: "#fff", marginBottom: 16 };

function Stars({ value, onChange, name }: { value: string; onChange: (v: string) => void; name: string }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label={name}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = String(n) === value;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? "" : String(n))}
            style={{
              width: 44,
              height: 38,
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              border: active ? "2px solid #1f3a5f" : "1px solid #ccd5e4",
              background: active ? "#1f3a5f" : "#fff",
              color: active ? "#fff" : "#41506a",
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** Uploads immediately on pick (instant feedback, and keeps the submit payload
 * small) against the same token that authenticates the form. */
function FileUpload({ token, value, onChange }: { token: string; value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    if (file.size > 4 * 1024 * 1024) {
      setErr(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 4 MB. Try a smaller scan or photo.`);
      if (ref.current) ref.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/q/${encodeURIComponent(token)}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) setErr(data.error ?? "Upload failed.");
      else onChange(data.fileName);
    } catch {
      setErr("Upload failed — check your connection and try again.");
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/q/${encodeURIComponent(token)}/upload`, { method: "DELETE" });
      onChange("");
    } catch {
      setErr("Could not remove the file.");
    }
    setBusy(false);
  }

  if (value) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#e7f6ee", border: "1px solid #b7e2c9", borderRadius: 8, padding: "10px 12px" }}>
        <span style={{ fontSize: 13.5, color: "#146c3c", fontWeight: 700 }}>✓ Uploaded — {value}</span>
        <button type="button" onClick={remove} disabled={busy} style={{ background: "none", border: "none", color: "#9a2233", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          {busy ? "Removing…" : "Remove / replace"}
        </button>
      </div>
    );
  }

  // The native file input is hidden — it renders as unstyled "Choose File / No
  // file chosen" text that looks broken next to the rest of the form.
  return (
    <div>
      <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={pick} style={{ display: "none" }} />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
          width: "100%",
          padding: "16px 18px",
          fontSize: 14.5,
          fontWeight: 700,
          fontFamily: "inherit",
          color: busy ? "#8a94a3" : "#1f3a5f",
          background: "#f8fafc",
          border: "2px dashed #b9c6dc",
          borderRadius: 10,
          cursor: busy ? "default" : "pointer",
        }}
      >
        <span style={{ fontSize: 17 }} aria-hidden="true">📎</span>
        {busy ? "Uploading…" : "Choose a file to upload"}
      </button>
      {err ? <div style={{ fontSize: 12.5, color: "#9a2233", marginTop: 7, lineHeight: 1.5 }}>{err}</div> : null}
    </div>
  );
}

function FieldInput({ f, value, onChange, token }: { f: Field; value: string | string[] | undefined; onChange: (v: string | string[]) => void; token: string }) {
  const [otherOn, setOtherOn] = useState(false);
  const v = value ?? (f.type === "multiselect" ? [] : "");

  switch (f.type) {
    case "file":
      return <FileUpload token={token} value={String(v)} onChange={onChange} />;
    case "textarea":
      return <textarea value={String(v)} onChange={(e) => onChange(e.target.value)} rows={f.rows ?? 4} placeholder={f.placeholder} style={{ ...input, resize: "vertical", lineHeight: 1.6 }} />;
    case "rating":
      return <Stars value={String(v)} onChange={onChange} name={f.label} />;
    case "consent":
      return (
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "#1b2331", lineHeight: 1.6, cursor: "pointer" }}>
          <input type="checkbox" checked={v === "yes"} onChange={(e) => onChange(e.target.checked ? "yes" : "")} style={{ marginTop: 3, width: 17, height: 17, flex: "none" }} />
          <span>{f.label}</span>
        </label>
      );
    case "select":
      return (
        <>
          <select
            value={f.options?.includes(String(v)) || v === "" ? String(v) : OTHER}
            onChange={(e) => (e.target.value === OTHER ? (setOtherOn(true), onChange("")) : (setOtherOn(false), onChange(e.target.value)))}
            style={input}
          >
            <option value="">Select…</option>
            {f.options?.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
            {f.allowOther ? <option value={OTHER}>Other…</option> : null}
          </select>
          {otherOn ? <input value={String(v)} onChange={(e) => onChange(e.target.value)} placeholder="Please specify" style={{ ...input, marginTop: 8 }} autoFocus /> : null}
        </>
      );
    case "multiselect": {
      const arr = Array.isArray(v) ? v : [];
      const known = f.options ?? [];
      const custom = arr.filter((x) => !known.includes(x));
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {known.map((o) => {
            const on = arr.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
                style={{
                  padding: "8px 13px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 999,
                  cursor: "pointer",
                  border: on ? "2px solid #1f3a5f" : "1px solid #ccd5e4",
                  background: on ? "#1f3a5f" : "#fff",
                  color: on ? "#fff" : "#41506a",
                }}
              >
                {o}
              </button>
            );
          })}
          {f.allowOther ? (
            <input
              value={custom.join(", ")}
              onChange={(e) => {
                const typed = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                onChange([...arr.filter((x) => known.includes(x)), ...typed]);
              }}
              placeholder="Other (comma separated)"
              style={{ ...input, flex: 1, minWidth: 200, width: "auto" }}
            />
          ) : null}
        </div>
      );
    }
    default:
      return <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type} value={String(v)} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} style={input} />;
  }
}

/** Read-only render of what was submitted — shown to the candidate after
 * submitting (they asked to see it) and reused by HR. */
export function AnswersView({ q, answers }: { q: Questionnaire; answers: Answers }) {
  return (
    <div>
      {q.sections.map((s) => (
        <div key={s.id} style={sectionCard}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: "#1f3a5f", marginBottom: 12 }}>{s.title}</h2>
          {s.fields.map((f) => (
            <div key={f.id} style={{ padding: "9px 0", borderTop: "1px solid #f0f4f9" }}>
              <div style={{ fontSize: 12, color: "#6b7686", fontWeight: 600, marginBottom: 3 }}>{f.label}</div>
              <div style={{ fontSize: 13.5, color: "#1b2331", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{displayAnswer(f, answers[f.id])}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function QuestionnaireForm({
  token,
  q,
  candidateName,
  roleTitle,
  salaryProofName,
}: {
  token: string;
  q: Questionnaire;
  candidateName: string;
  roleTitle: string;
  /** Server truth for an already-uploaded file (they may have come back). */
  salaryProofName?: string;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Answers | null>(null);

  const set = (id: string, v: string | string[]) => setAnswers((a) => ({ ...a, [id]: v }));

  // Long form + candidate on a phone = do not lose their typing.
  useEffect(() => {
    if (submitted || Object.keys(answers).length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [answers, submitted]);

  // Draft autosave, so a dropped connection or accidental close doesn't cost
  // 20 minutes of typing. Local only — never leaves their device until submit.
  const draftKey = `ss-q-${token.slice(0, 12)}`;
  useEffect(() => {
    let draft: Answers = {};
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) draft = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    // Upload state comes from the server prop at render time, never the draft.
    const fileField = q.sections.flatMap((s) => s.fields).find((f) => f.type === "file");
    if (fileField) delete draft[fileField.id];
    if (Object.keys(draft).length) setAnswers(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (submitted) return;
    try {
      if (Object.keys(answers).length) localStorage.setItem(draftKey, JSON.stringify(answers));
    } catch {
      /* quota/private mode — autosave is best-effort */
    }
  }, [answers, draftKey, submitted]);

  const required = useMemo(() => q.sections.flatMap((s) => s.fields).filter(isRequired), [q]);
  const remaining = required.filter((f) => {
    const v = answers[f.id];
    return v === undefined || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (remaining.length) {
      setError(`Please complete ${remaining.length} required question${remaining.length === 1 ? "" : "s"}: ${remaining.slice(0, 3).map((f) => f.label).join(" · ")}${remaining.length > 3 ? "…" : ""}`);
      document.getElementById(`f-${remaining[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/q/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      setSubmitted(data.candidate?.answers ?? answers);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("We couldn't reach our server. Please check your connection and try again.");
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div>
        <div style={{ background: "#e7f6ee", border: "1px solid #b7e2c9", borderRadius: 12, padding: "18px 20px", marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#146c3c" }}>Thank you, {candidateName.split(" ")[0]} — we've received your responses.</div>
          <p style={{ fontSize: 13.5, color: "#2f6a4c", marginTop: 6, lineHeight: 1.6 }}>
            Our HR team will review this and get back to you about the {roleTitle} role. Your answers are shown below for your
            records — you can print this page or save it as a PDF.
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            style={{ marginTop: 12, background: "#146c3c", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            Print / save a copy
          </button>
        </div>
        <AnswersView q={q} answers={submitted} />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      {q.sections.map((s) => (
        <div key={s.id} style={sectionCard}>
          <h2 style={{ fontSize: 16.5, fontWeight: 800, color: "#1f3a5f" }}>{s.title}</h2>
          {s.blurb ? <p style={{ fontSize: 12.5, color: "#6b7686", marginTop: 5, marginBottom: 4, lineHeight: 1.6 }}>{s.blurb}</p> : null}
          <div style={{ marginTop: 14, display: "grid", gap: 18 }}>
            {s.fields.map((f) => (
              <div key={f.id} id={`f-${f.id}`}>
                {f.type !== "consent" ? (
                  <label style={label} htmlFor={f.id}>
                    {f.label}
                    {isRequired(f) ? <span style={{ color: "#c0344c" }}> *</span> : null}
                  </label>
                ) : null}
                {f.hint ? <div style={hintStyle}>{f.hint}</div> : null}
                <FieldInput f={f} value={f.type === "file" ? (answers[f.id] ?? salaryProofName ?? "") : answers[f.id]} onChange={(v) => set(f.id, v)} token={token} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {error ? (
        <div style={{ background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 13, borderRadius: 10, padding: "12px 14px", marginBottom: 14, lineHeight: 1.55 }}>{error}</div>
      ) : null}

      {/* Flows at the end of the form — not sticky, not full-width, not bold-navy.
          A sticky submit reads as pressure the whole way down; a modest button at
          the end reads as a natural close. */}
      <div style={{ marginTop: 22, display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <span style={{ fontSize: 11.5, color: "#8a94a3", lineHeight: 1.5, textAlign: "right" }}>
          {remaining.length > 0
            ? `${remaining.length} question${remaining.length === 1 ? "" : "s"} still to answer.`
            : "Everything is answered."}
        </span>
        <button
          type="submit"
          disabled={busy}
          style={{
            background: "#1f3a5f",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "9px 20px",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Submitting…" : "Submit my responses"}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "#8a94a3", textAlign: "right", marginTop: 8, lineHeight: 1.5 }}>
        This form can only be submitted once, so please have a last read first. Your typing is saved on this device as you go.
      </p>
      {q.outro ? (
        <p style={{ fontSize: 12, color: "#5b6676", textAlign: "center", marginTop: 14, lineHeight: 1.6, whiteSpace: "pre-line" }}>{q.outro}</p>
      ) : null}
    </form>
  );
}
