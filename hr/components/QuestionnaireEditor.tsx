"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getQuestionnaire, type Questionnaire, type Section, type Field, type FieldType } from "@/lib/questionnaire";
import type { Candidate } from "@/lib/candidate";

// Full per-candidate questionnaire editor. NO validation of "sensible"
// structure — the owner asked for full control, so this trusts them: they can
// add/remove sections and questions, change types, edit options, rewrite
// anything. The public page renders whatever this saves.

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginBottom: 14 };
const label: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "#41506a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d4dbe8", borderRadius: 7, background: "#fff", boxSizing: "border-box", fontFamily: "inherit" };
const ghost: React.CSSProperties = { background: "none", border: "1px dashed #c3cee0", color: "#41506a", fontSize: 12, fontWeight: 600, borderRadius: 7, padding: "7px 12px", cursor: "pointer" };
const danger: React.CSSProperties = { background: "none", border: "none", color: "#c0344c", fontSize: 12, fontWeight: 600, cursor: "pointer" };

const TYPES: FieldType[] = ["text", "textarea", "email", "tel", "number", "select", "multiselect", "rating", "date", "file", "consent"];
// Plain-English labels for the type dropdown — the raw FieldType codes
// ("textarea", "tel", "multiselect", "consent") don't say what the candidate
// will see. Stored value is unchanged; only the option label is friendlier.
const TYPE_LABEL: Record<FieldType, string> = {
  text: "Short text",
  textarea: "Paragraph",
  email: "Email",
  tel: "Phone",
  number: "Number",
  select: "Choose one",
  multiselect: "Choose several",
  rating: "Star rating (1–5)",
  date: "Date",
  file: "File upload",
  consent: "Agreement checkbox",
};

let uid = 0;
const newId = (kind: string) => `${kind}_${Date.now()}_${uid++}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const optionsToText = (opts?: string[]): string => (opts ?? []).join("\n");
// Do NOT trim or filter during editing — that eats trailing spaces mid-word
// and swallows Enter (the empty line disappears the moment it's created).
// Cleanup happens once, at save time, in `save()`.
const textToOptionsRaw = (text: string): string[] => text.split("\n");
const cleanOptions = (opts?: string[]): string[] =>
  (opts ?? []).map((s) => s.trim()).filter(Boolean);

export function QuestionnaireEditor({ candidate, initial }: { candidate: Candidate; initial: Questionnaire }) {
  const router = useRouter();
  const [q, setQ] = useState<Questionnaire>(clone(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Snapshot of what is actually PERSISTED. Editing here is pure local state
  // with no autosave, so without this the page looks identical whether or not
  // Save was ever pressed — an edited questionnaire that was never stored is
  // indistinguishable from a stored one, and the candidate silently receives
  // the old questions. (That happened for real: a full round of edits was lost
  // because the tab was closed before saving, and the only evidence was the
  // ABSENCE of a candidate.update entry in the audit log.)
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(clone(initial)));
  const dirty = JSON.stringify(q) !== savedJson;

  const totalQuestions = q.sections.reduce((n, s) => n + s.fields.length, 0);

  // Browser-level guard: closing the tab or hitting back with unsaved edits
  // now prompts instead of discarding silently.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const setSection = (idx: number, patch: Partial<Section>) =>
    setQ((cur) => ({ ...cur, sections: cur.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }));
  const deleteSection = (idx: number) =>
    setQ((cur) => ({ ...cur, sections: cur.sections.filter((_, i) => i !== idx) }));
  const moveSection = (idx: number, dir: -1 | 1) =>
    setQ((cur) => {
      const j = idx + dir;
      if (j < 0 || j >= cur.sections.length) return cur;
      const next = [...cur.sections];
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...cur, sections: next };
    });
  const addSection = () =>
    setQ((cur) => ({
      ...cur,
      sections: [...cur.sections, { id: newId("section"), title: "New section", blurb: "", fields: [] }],
    }));

  const setField = (si: number, fi: number, patch: Partial<Field>) =>
    setQ((cur) => ({
      ...cur,
      sections: cur.sections.map((s, i) =>
        i === si ? { ...s, fields: s.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) } : s,
      ),
    }));
  const deleteField = (si: number, fi: number) =>
    setQ((cur) => ({
      ...cur,
      sections: cur.sections.map((s, i) => (i === si ? { ...s, fields: s.fields.filter((_, j) => j !== fi) } : s)),
    }));
  const moveField = (si: number, fi: number, dir: -1 | 1) =>
    setQ((cur) => ({
      ...cur,
      sections: cur.sections.map((s, i) => {
        if (i !== si) return s;
        const j = fi + dir;
        if (j < 0 || j >= s.fields.length) return s;
        const next = [...s.fields];
        [next[fi], next[j]] = [next[j], next[fi]];
        return { ...s, fields: next };
      }),
    }));
  const addField = (si: number) =>
    setQ((cur) => ({
      ...cur,
      sections: cur.sections.map((s, i) =>
        i === si ? { ...s, fields: [...s.fields, { id: newId("q"), label: "New question", type: "textarea", rows: 3 }] } : s,
      ),
    }));

  async function save() {
    setBusy(true);
    setMsg(null);
    // Clean up options ONLY at save time — during editing we preserve exactly
    // what the user typed so space and Enter work naturally.
    const cleaned: Questionnaire = {
      ...q,
      sections: q.sections.map((s) => ({
        ...s,
        fields: s.fields.map((f) =>
          f.type === "select" || f.type === "multiselect" ? { ...f, options: cleanOptions(f.options) } : f,
        ),
      })),
    };
    try {
      const res = await fetch(`/api/candidates/${candidate.seq}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...candidate, customQuestionnaire: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "Could not save." });
        setBusy(false);
        return;
      }
      // Only now is the on-screen version the stored version.
      setSavedJson(JSON.stringify(cleaned));
      setQ(cleaned);
      setMsg({ kind: "ok", text: "Saved — this is what the candidate will see." });
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server." });
    }
    setBusy(false);
  }

  async function reset() {
    if (!confirm("Discard your edits and go back to the standard questionnaire?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.seq}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...candidate, customQuestionnaire: null }),
      });
      if (!res.ok) {
        setMsg({ kind: "err", text: "Could not reset." });
        setBusy(false);
        return;
      }
      // router.refresh() re-renders the server page but does NOT remount this
      // client editor, so its local q/savedJson would keep showing the
      // just-removed custom questions (dirty=false → misleading 'Saved ✓', and
      // a later edit+Save would silently re-create the custom copy from the
      // stale content). Re-seed local state to the standard questionnaire so the
      // screen matches what is now actually stored.
      const standard = getQuestionnaire(candidate.questionnaireRole);
      setQ(clone(standard));
      setSavedJson(JSON.stringify(clone(standard)));
      setMsg({ kind: "ok", text: "Reset — the candidate will see the standard questionnaire." });
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server." });
    }
    setBusy(false);
  }

  return (
    <div>
      {/* Sticky save bar so the user never has to scroll to save. */}
      <div style={{ position: "sticky", top: 60, zIndex: 10, background: "#f6f8fc", padding: "10px 0", marginBottom: 12, borderBottom: "1px solid #e2e8f2", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#5b6676" }}>
          {q.sections.length} sections · <b style={{ color: "#1f3a5f" }}>{totalQuestions}</b> questions
        </div>
        {dirty ? (
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: "#8a5a00",
              background: "#fdf4e3",
              border: "1px solid #f0d9a8",
              borderRadius: 999,
              padding: "3px 10px",
              whiteSpace: "nowrap",
            }}
          >
            Unsaved changes — the candidate still sees the old questions
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        {candidate.customQuestionnaire ? (
          <button type="button" onClick={reset} disabled={busy} style={{ ...danger, opacity: busy ? 0.5 : 1 }}>
            Reset to standard questionnaire
          </button>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          style={{
            // Muted once everything on screen is stored, so "is my work saved?"
            // is answerable at a glance rather than by memory.
            background: dirty ? "#1f3a5f" : "#eef2f8",
            color: dirty ? "#fff" : "#5b6676",
            border: dirty ? "none" : "1px solid #d4dbe8",
            borderRadius: 8,
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Saving…" : dirty ? "Save" : "Saved ✓"}
        </button>
      </div>

      {msg ? (
        <div
          style={{
            marginBottom: 12,
            fontSize: 12.5,
            padding: "9px 12px",
            borderRadius: 8,
            background: msg.kind === "ok" ? "#e7f6ee" : "#fdecef",
            border: `1px solid ${msg.kind === "ok" ? "#b7e2c9" : "#f6c6ce"}`,
            color: msg.kind === "ok" ? "#146c3c" : "#9a2233",
          }}
        >
          {msg.text}
        </div>
      ) : null}

      {/* Intro + outro shown as editable too. */}
      <div style={card}>
        <label style={label}>Intro (shown above the first question)</label>
        <textarea
          rows={6}
          value={q.intro}
          onChange={(e) => setQ({ ...q, intro: e.target.value })}
          style={{ ...input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
        />
        <div style={{ marginTop: 12 }}>
          <label style={label}>Outro (shown after the submit button)</label>
          <textarea
            rows={3}
            value={q.outro ?? ""}
            onChange={(e) => setQ({ ...q, outro: e.target.value })}
            style={{ ...input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
          />
        </div>
      </div>

      {q.sections.map((s, si) => (
        <SectionCard
          key={s.id + si}
          section={s}
          totalSections={q.sections.length}
          index={si}
          onChange={(patch) => setSection(si, patch)}
          onDelete={() => deleteSection(si)}
          onMove={(dir) => moveSection(si, dir)}
          onFieldChange={(fi, patch) => setField(si, fi, patch)}
          onFieldDelete={(fi) => deleteField(si, fi)}
          onFieldMove={(fi, dir) => moveField(si, fi, dir)}
          onFieldAdd={() => addField(si)}
        />
      ))}

      <button type="button" onClick={addSection} style={{ ...ghost, marginTop: 4 }}>
        + Add a new section
      </button>
    </div>
  );
}

function SectionCard({
  section,
  totalSections,
  index,
  onChange,
  onDelete,
  onMove,
  onFieldChange,
  onFieldDelete,
  onFieldMove,
  onFieldAdd,
}: {
  section: Section;
  totalSections: number;
  index: number;
  onChange: (patch: Partial<Section>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onFieldChange: (fi: number, patch: Partial<Field>) => void;
  onFieldDelete: (fi: number) => void;
  onFieldMove: (fi: number, dir: -1 | 1) => void;
  onFieldAdd: () => void;
}) {
  return (
    <div style={{ ...card, borderLeft: "3px solid #1f3a5f" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 10.5, background: "#eef2f8", color: "#41506a", fontWeight: 700, padding: "3px 8px", borderRadius: 999 }}>
          Section {index + 1}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} title="Move up" style={{ background: "none", border: "1px solid #d4dbe8", borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: index === 0 ? "default" : "pointer", opacity: index === 0 ? 0.4 : 1 }}>
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={index === totalSections - 1} title="Move down" style={{ background: "none", border: "1px solid #d4dbe8", borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: index === totalSections - 1 ? "default" : "pointer", opacity: index === totalSections - 1 ? 0.4 : 1 }}>
          ↓
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete the "${section.title}" section and its ${section.fields.length} question${section.fields.length === 1 ? "" : "s"}?`)) onDelete();
          }}
          style={danger}
        >
          Delete section
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={label}>Section title</label>
          <input value={section.title} onChange={(e) => onChange({ title: e.target.value })} style={input} />
        </div>
        <div>
          <label style={label}>Section blurb (optional — small helper text)</label>
          <textarea
            value={section.blurb ?? ""}
            onChange={(e) => onChange({ blurb: e.target.value })}
            rows={2}
            style={{ ...input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
          />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {section.fields.map((f, fi) => (
          <FieldCard
            key={f.id + fi}
            field={f}
            totalFields={section.fields.length}
            index={fi}
            onChange={(patch) => onFieldChange(fi, patch)}
            onDelete={() => onFieldDelete(fi)}
            onMove={(dir) => onFieldMove(fi, dir)}
          />
        ))}
        <button type="button" onClick={onFieldAdd} style={{ ...ghost, marginTop: 6 }}>
          + Add a question to this section
        </button>
      </div>
    </div>
  );
}

function FieldCard({
  field,
  totalFields,
  index,
  onChange,
  onDelete,
  onMove,
}: {
  field: Field;
  totalFields: number;
  index: number;
  onChange: (patch: Partial<Field>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const needsOptions = field.type === "select" || field.type === "multiselect";
  const isTextArea = field.type === "textarea";

  return (
    <div style={{ border: "1px solid #eef2f7", borderRadius: 8, padding: 12, marginBottom: 10, background: "#fafcff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#8a94a3", fontFamily: "monospace" }}>#{field.id}</div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} title="Move up" style={{ background: "none", border: "1px solid #d4dbe8", borderRadius: 6, padding: "2px 7px", fontSize: 11, cursor: index === 0 ? "default" : "pointer", opacity: index === 0 ? 0.4 : 1 }}>
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={index === totalFields - 1} title="Move down" style={{ background: "none", border: "1px solid #d4dbe8", borderRadius: 6, padding: "2px 7px", fontSize: 11, cursor: index === totalFields - 1 ? "default" : "pointer", opacity: index === totalFields - 1 ? 0.4 : 1 }}>
          ↓
        </button>
        <button type="button" onClick={onDelete} style={danger}>
          Delete
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={label}>Question</label>
            <textarea
              value={field.label}
              onChange={(e) => onChange({ label: e.target.value })}
              rows={2}
              style={{ ...input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            />
          </div>
          <div style={{ width: 160 }}>
            <label style={label}>Type</label>
            <select
              value={field.type}
              onChange={(e) => onChange({ type: e.target.value as FieldType })}
              style={input}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#41506a", whiteSpace: "nowrap", paddingBottom: 6 }}>
            <input type="checkbox" checked={Boolean(field.optional)} onChange={(e) => onChange({ optional: e.target.checked || undefined })} />
            Optional
          </label>
        </div>

        <div>
          <label style={label}>Hint (optional helper text under the question)</label>
          <input value={field.hint ?? ""} onChange={(e) => onChange({ hint: e.target.value || undefined })} style={input} />
        </div>

        {isTextArea ? (
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10, alignItems: "end" }}>
            <div>
              <label style={label}>Box height (rows)</label>
              <input
                type="number"
                min={1}
                max={20}
                value={field.rows ?? 3}
                onChange={(e) => onChange({ rows: Number(e.target.value) || 3 })}
                style={input}
              />
            </div>
            <div />
          </div>
        ) : null}

        {field.type === "text" || field.type === "email" || field.type === "tel" || field.type === "number" ? (
          <div>
            <label style={label}>Placeholder (grey text inside the empty box)</label>
            <input value={field.placeholder ?? ""} onChange={(e) => onChange({ placeholder: e.target.value || undefined })} style={input} />
          </div>
        ) : null}

        {needsOptions ? (
          <div>
            <label style={label}>Options (one per line)</label>
            <textarea
              value={optionsToText(field.options)}
              onChange={(e) => onChange({ options: textToOptionsRaw(e.target.value) })}
              rows={Math.max(4, (field.options ?? []).length + 1)}
              style={{ ...input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#41506a", marginTop: 6 }}>
              <input type="checkbox" checked={Boolean(field.allowOther)} onChange={(e) => onChange({ allowOther: e.target.checked || undefined })} />
              Also allow a free-text &ldquo;Other&rdquo; answer
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
