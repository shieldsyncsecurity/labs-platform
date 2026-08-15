"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, SelectOrCustom, gridStyle, labelStyle, inputStyle, primaryBtn } from "./fields";
import { DateField } from "./DateField";
import { suggestStructure, formatINR } from "@/lib/payslip";
import { DESIGNATION_OPTIONS, DEPARTMENT_OPTIONS, EMPLOYMENT_TYPE_OPTIONS, BASE_LOCATION_OPTIONS, REPORTING_TO_OPTIONS } from "@/lib/employee";

/** Prefill hints pulled from the candidate's own questionnaire answers. */
export type HirePrefill = {
  name: string;
  email: string;
  phone?: string;
  roleAppliedFor: string;
  expectedCtc?: string;
  earliestStart?: string;
  noticePeriod?: string;
  currentCity?: string;
};

export function HireCandidateForm({ seq, prefill }: { seq: string; prefill: HirePrefill }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gross, setGross] = useState(() => String(Number(String(prefill.expectedCtc ?? "").replace(/[^\d]/g, "")) || ""));

  const grossNum = Number(gross.replace(/[^\d]/g, "")) || 0;
  const split = grossNum > 0 ? suggestStructure(grossNum) : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const payload = {
      name: get("name"),
      personalEmail: get("personalEmail"),
      phone: get("phone"),
      address: get("address"),
      designation: get("designation"),
      department: get("department"),
      employmentType: get("employmentType"),
      baseLocation: get("baseLocation"),
      reportingTo: get("reportingTo"),
      dateOfJoining: get("dateOfJoining"),
      grossMonthly: grossNum,
      annualCTC: Number(get("annualCTC").replace(/[^\d]/g, "")) || grossNum * 12,
      probationMonths: Number(get("probationMonths")) || undefined,
      internshipMonths: Number(get("internshipMonths")) || undefined,
    };

    try {
      const res = await fetch(`/api/candidates/${seq}/hire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not hire this candidate.");
        setBusy(false);
        return;
      }
      if (data.warning) alert(data.warning);
      // Land on the new employee's record, not straight into the offer letter:
      // the offer route needs documents:write, so jumping there dead-ends anyone
      // without it at /no-access. The record page surfaces a (gated) "Generate
      // offer" control, so writers reach the letter in one more click and
      // everyone else still lands somewhere useful.
      router.push(`/employees/${data.seq}`);
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
        <Field name="name" label="Full name" required defaultValue={prefill.name} />
        <Field name="personalEmail" label="Personal email" type="email" defaultValue={prefill.email} />
        <Field name="phone" label="Mobile" defaultValue={prefill.phone} />
        <Field name="address" label="Address (appears on the offer letter)" defaultValue={prefill.currentCity} />
        <SelectOrCustom name="designation" label="Designation" required options={DESIGNATION_OPTIONS} defaultValue={prefill.roleAppliedFor} />
        <SelectOrCustom name="department" label="Department" options={DEPARTMENT_OPTIONS} />
        <SelectOrCustom name="employmentType" label="Employment type" options={EMPLOYMENT_TYPE_OPTIONS} />
        <SelectOrCustom name="baseLocation" label="Base location" options={BASE_LOCATION_OPTIONS} />
        <SelectOrCustom name="reportingTo" label="Reporting to" options={REPORTING_TO_OPTIONS} />
        <DateField name="dateOfJoining" label="Date of joining" required />
        <div>
          <label style={labelStyle} htmlFor="gross">Gross monthly (INR) <span style={{ color: "#c0344c" }}>*</span></label>
          <input id="gross" value={gross} onChange={(e) => setGross(e.target.value)} style={inputStyle} placeholder="e.g. 30000" />
          {prefill.expectedCtc ? (
            <div style={{ fontSize: 10.5, color: "#8a94a3", marginTop: 3 }}>They asked for: {prefill.expectedCtc}</div>
          ) : null}
        </div>
        <Field name="annualCTC" label="Annual CTC — blank = gross × 12" />
        <Field name="probationMonths" label="Probation months (blank = 3)" type="number" />
        <Field name="internshipMonths" label="Internship months (interns only)" type="number" />
      </div>

      {split ? (
        <div style={{ marginTop: 14, border: "1px solid #e2e8f2", borderRadius: 10, padding: "12px 14px", background: "#f8fafc" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "#8a94a3", fontWeight: 800, marginBottom: 6 }}>Annexure A preview</div>
          <div style={{ fontSize: 12.5, color: "#41506a", display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span>Basic {formatINR(split.basic)}</span>
            <span>HRA {formatINR(split.hra)}</span>
            <span>Conveyance {formatINR(split.conveyance)}</span>
            <span>Special {formatINR(split.special)}</span>
            <span style={{ fontWeight: 700, color: "#1f3a5f" }}>Gross {formatINR(split.gross)}</span>
          </div>
        </div>
      ) : null}

      {prefill.noticePeriod || prefill.earliestStart ? (
        <p style={{ fontSize: 11.5, color: "#8a94a3", marginTop: 10 }}>
          From their questionnaire: {prefill.noticePeriod ? `notice — ${prefill.noticePeriod}. ` : ""}
          {prefill.earliestStart ? `earliest start — ${prefill.earliestStart}.` : ""}
        </p>
      ) : null}

      <button type="submit" disabled={busy} style={{ ...primaryBtn, marginTop: 16, opacity: busy ? 0.6 : 1 }}>
        {busy ? "Creating…" : "Create employee & open their record →"}
      </button>
    </form>
  );
}
