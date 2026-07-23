"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, SelectOrCustom, gridStyle, labelStyle, inputStyle, primaryBtn } from "./fields";
import { DateField } from "./DateField";
import { ROLE_OPTIONS, SOURCE_OPTIONS, type Candidate } from "@/lib/candidate";
import { QUESTIONNAIRES, DEFAULT_ROLE_KEY } from "@/lib/questionnaire";

export function CandidateForm({ candidate }: { candidate?: Candidate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(candidate);

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
      router.push(`/candidates/${data.candidate?.seq ?? candidate!.seq}`);
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

      <div style={gridStyle}>
        <Field name="name" label="Full name" required defaultValue={candidate?.name} />
        <Field name="email" label="Email address (the questionnaire link goes here)" type="email" required defaultValue={candidate?.email} />
        <Field name="phone" label="Mobile number" defaultValue={candidate?.phone} />
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
