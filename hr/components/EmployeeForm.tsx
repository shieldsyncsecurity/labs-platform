"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Employee,
  DESIGNATION_OPTIONS,
  DEPARTMENT_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  BASE_LOCATION_OPTIONS,
  REPORTING_TO_OPTIONS,
  PAYMENT_MODE_OPTIONS,
  DEFAULT_EMPLOYMENT_TYPE,
  DEFAULT_BASE_LOCATION,
  DEFAULT_REPORTING_TO,
  DEFAULT_PAYMENT_MODE,
} from "@/lib/employee";
import { DateField } from "./DateField";

const labelStyle: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "#41506a", marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d4dbe8", borderRadius: 7, background: "#fff", boxSizing: "border-box" };
const group: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 14 };
const groupTitle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 10 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

function Field({ name, label, required, placeholder, defaultValue, full }: { name: string; label: string; required?: boolean; placeholder?: string; defaultValue?: string; full?: boolean }) {
  return (
    <div style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label style={labelStyle} htmlFor={name}>
        {label} {required ? <span style={{ color: "#c0344c" }}>*</span> : null}
      </label>
      {/* required is enforced at the browser level too — the marker alone lets empty submits through */}
      <input id={name} name={name} required={required} style={input} placeholder={placeholder} defaultValue={defaultValue} />
    </div>
  );
}

// Dropdown of predefined options + an "Other (specify)" text entry. Emits a
// single value under `name` (a hidden input), so it drops into the FormData flow
// unchanged. In edit mode, a value not in the list opens in custom mode.
function SelectOrCustom({ name, label, options, defaultValue = "", required, placeholder, full }: { name: string; label: string; options: string[]; defaultValue?: string; required?: boolean; placeholder?: string; full?: boolean }) {
  const isPreset = defaultValue !== "" && options.includes(defaultValue);
  const startCustom = defaultValue !== "" && !isPreset;
  const [mode, setMode] = useState<"preset" | "custom">(startCustom ? "custom" : "preset");
  const [sel, setSel] = useState(isPreset ? defaultValue : "");
  const [custom, setCustom] = useState(startCustom ? defaultValue : "");
  const value = mode === "custom" ? custom : sel;

  return (
    <div style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label style={labelStyle} htmlFor={name}>
        {label} {required ? <span style={{ color: "#c0344c" }}>*</span> : null}
      </label>
      <input type="hidden" name={name} value={value} />
      {mode === "preset" ? (
        <select
          id={name}
          value={sel}
          onChange={(e) => (e.target.value === "__custom__" ? setMode("custom") : setSel(e.target.value))}
          style={input}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
          <option value="__custom__">Other (specify)…</option>
        </select>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={placeholder ?? "Type a custom value"} style={input} autoFocus />
          <button type="button" title="Back to list" onClick={() => { setMode("preset"); setCustom(""); }} style={{ border: "1px solid #d4dbe8", background: "#fff", borderRadius: 7, padding: "0 11px", cursor: "pointer", fontSize: 13, color: "#41506a" }}>
            ↩
          </button>
        </div>
      )}
    </div>
  );
}

export function EmployeeForm({ seq, initial }: { seq?: string; initial?: Partial<Employee> }) {
  const router = useRouter();
  const isEdit = Boolean(seq);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = initial ?? {};
  const dv = {
    name: d.name ?? "",
    address: d.address ?? "",
    pan: d.pan ?? "",
    personalEmail: d.personalEmail ?? "",
    phone: d.phone ?? "",
    designation: d.designation ?? "",
    department: d.department ?? "",
    dateOfJoining: d.dateOfJoining ?? "",
    employmentType: d.employmentType ?? "",
    baseLocation: d.baseLocation ?? "",
    reportingTo: d.reportingTo ?? "",
    duties: (d.duties ?? []).join("\n"),
    grossMonthly: d.grossMonthly ? String(d.grossMonthly) : "",
    annualCTC: d.annualCTC ? String(d.annualCTC) : "",
    bankAccount: d.bankAccount ?? "",
    ifsc: d.ifsc ?? "",
    bankBranch: d.bankBranch ?? "",
    paymentMode: d.paymentMode ?? "",
    uanPf: d.uanPf ?? "",
    esic: d.esic ?? "",
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const num = (k: string) => Number(get(k).replace(/[, ]/g, "")) || 0;
    const duties = get("duties").split("\n").map((s) => s.trim()).filter(Boolean);

    const payload = {
      name: get("name"), address: get("address"), pan: get("pan"), personalEmail: get("personalEmail"), phone: get("phone"),
      designation: get("designation"), department: get("department"), dateOfJoining: get("dateOfJoining"),
      employmentType: get("employmentType"), baseLocation: get("baseLocation"), reportingTo: get("reportingTo"), duties,
      grossMonthly: num("grossMonthly"), annualCTC: num("annualCTC"),
      // Pass the stored structure through: normalizeEmployee keeps it while gross
      // is unchanged (a custom split must survive unrelated edits) and re-splits
      // only when gross actually changes.
      structure: initial?.structure,
      probationMonths: num("probationMonths") || undefined,
      internshipMonths: num("internshipMonths") || undefined,
      revisions: initial?.revisions,
      bankAccount: get("bankAccount"), bankBranch: get("bankBranch"), ifsc: get("ifsc"), paymentMode: get("paymentMode") || "Bank Transfer",
      uanPf: get("uanPf"), esic: get("esic"),
      // Optimistic lock — the engine 409s if someone saved since this form loaded.
      expectedUpdatedAt: initial?.updatedAt,
    };

    try {
      const res = await fetch(isEdit ? `/api/employees/${seq}` : "/api/employees", {
        method: isEdit ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          res.status === 409
            ? "This record was changed by the other user while you were editing. Reload the page and re-apply your changes."
            : (data.error ?? "Could not save."),
        );
        setBusy(false);
        return;
      }
      const target = isEdit ? seq : data?.employee?.seq;
      router.push(target ? `/employees/${target}` : "/employees");
      router.refresh();
    } catch {
      setError("Could not reach the server — check the connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? (
        <div style={{ background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>{error}</div>
      ) : null}

      <div style={group}>
        <div style={groupTitle}>Personal</div>
        <div style={grid}>
          <Field name="name" label="Full name" required placeholder="Diya Jain" defaultValue={dv.name} />
          <Field name="pan" label="PAN" placeholder="CSRPJ6260N" defaultValue={dv.pan} />
          <Field name="address" label="Address" full placeholder="Flat, street, city, state, PIN" defaultValue={dv.address} />
          <Field name="personalEmail" label="Personal email" placeholder="name@example.com" defaultValue={dv.personalEmail} />
          <Field name="phone" label="Phone" placeholder="+91 …" defaultValue={dv.phone} />
        </div>
      </div>

      <div style={group}>
        <div style={groupTitle}>Role</div>
        <div style={grid}>
          <SelectOrCustom name="designation" label="Designation" required options={DESIGNATION_OPTIONS} defaultValue={dv.designation} placeholder="e.g. Threat Intelligence Analyst" />
          <SelectOrCustom name="department" label="Department" options={DEPARTMENT_OPTIONS} defaultValue={dv.department} placeholder="e.g. Research" />
          <DateField name="dateOfJoining" label="Date of joining" required defaultValue={dv.dateOfJoining} />
          <SelectOrCustom name="employmentType" label="Employment type" options={EMPLOYMENT_TYPE_OPTIONS} defaultValue={dv.employmentType || DEFAULT_EMPLOYMENT_TYPE} />
          <Field name="probationMonths" label="Probation (months) — full-time roles" placeholder="3" defaultValue={d.probationMonths ? String(d.probationMonths) : ""} />
          <Field name="internshipMonths" label="Internship duration (months) — interns only" placeholder="2" defaultValue={d.internshipMonths ? String(d.internshipMonths) : ""} />
          <SelectOrCustom name="baseLocation" label="Base work location" options={BASE_LOCATION_OPTIONS} defaultValue={dv.baseLocation || DEFAULT_BASE_LOCATION} placeholder="City, State, Country" />
          <SelectOrCustom name="reportingTo" label="Reporting to" options={REPORTING_TO_OPTIONS} defaultValue={dv.reportingTo || DEFAULT_REPORTING_TO} placeholder="Name / title" />
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle} htmlFor="duties">Duties &amp; responsibilities (one per line)</label>
            <textarea id="duties" name="duties" rows={4} style={{ ...input, resize: "vertical" }} placeholder={"Supporting client GRC engagements…\nConducting risk assessments…"} defaultValue={dv.duties} />
          </div>
        </div>
      </div>

      <div style={group}>
        <div style={groupTitle}>Compensation</div>
        <div style={grid}>
          <Field name="grossMonthly" label="Gross monthly (INR)" required placeholder="30000" defaultValue={dv.grossMonthly} />
          <Field name="annualCTC" label="Annual CTC (INR) — blank = gross × 12" placeholder="360000" defaultValue={dv.annualCTC} />
        </div>
        <p style={{ fontSize: 11, color: "#8a94a3", marginTop: 8 }}>
          Basic / HRA / Conveyance / Special are auto-split from gross (Basic 50%, HRA 40% of Basic, Conveyance ₹1,600, Special = balance).
        </p>
      </div>

      <div style={group}>
        <div style={groupTitle}>Bank</div>
        <div style={grid}>
          <Field name="bankAccount" label="Account no." placeholder="10254647001" defaultValue={dv.bankAccount} />
          <Field name="ifsc" label="IFSC" placeholder="IDFB0021416" defaultValue={dv.ifsc} />
          <Field name="bankBranch" label="Bank & branch" placeholder="IDFC First Bank, Indirapuram" defaultValue={dv.bankBranch} />
          <SelectOrCustom name="paymentMode" label="Payment mode" options={PAYMENT_MODE_OPTIONS} defaultValue={dv.paymentMode || DEFAULT_PAYMENT_MODE} />
        </div>
      </div>

      <div style={group}>
        <div style={groupTitle}>Statutory IDs</div>
        <div style={grid}>
          <Field name="uanPf" label="UAN / PF no." placeholder="Not Applicable" defaultValue={dv.uanPf} />
          <Field name="esic" label="ESIC no." placeholder="—" defaultValue={dv.esic} />
        </div>
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <button type="submit" disabled={busy} style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Save employee"}
        </button>
      </div>
    </form>
  );
}
