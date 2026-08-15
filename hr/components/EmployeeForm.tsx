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
import { ResumeImport, type ParsedFields } from "./ResumeImport";

import {
  Field,
  SelectOrCustom,
  labelStyle,
  inputStyle as input,
  groupStyle as group,
  groupTitleStyle as groupTitle,
  gridStyle as grid,
} from "./fields";

export function EmployeeForm({ seq, initial }: { seq?: string; initial?: Partial<Employee> }) {
  const router = useRouter();
  const isEdit = Boolean(seq);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resume import (Add only): prefills name / personal email / phone. Each of the
  // three inputs remounts (via `key`) with the parsed value; PAN, address and
  // everything else the user may have already typed are left untouched.
  const [imported, setImported] = useState<{ name?: string; personalEmail?: string; phone?: string }>({});
  const [importKey, setImportKey] = useState(0);
  function handleParsed(f: ParsedFields) {
    setImported({ name: f.name, personalEmail: f.email, phone: f.phone });
    setImportKey((k) => k + 1);
  }

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

      {!isEdit ? <ResumeImport onParsed={handleParsed} /> : null}

      <div style={group}>
        <div style={groupTitle}>Personal</div>
        <div style={grid}>
          <Field key={`name-${importKey}`} name="name" label="Full name" required placeholder="e.g. Aarav Sample" defaultValue={imported.name ?? dv.name} />
          <Field name="pan" label="PAN" placeholder="e.g. ABCDE1234F" defaultValue={dv.pan} />
          <Field name="address" label="Address" full placeholder="e.g. 12, Sample Residency, Sector 62, Noida, Uttar Pradesh 201309" defaultValue={dv.address} />
          <Field key={`email-${importKey}`} name="personalEmail" label="Personal email" placeholder="e.g. aarav.sample@gmail.com" defaultValue={imported.personalEmail ?? dv.personalEmail} />
          <Field key={`phone-${importKey}`} name="phone" label="Phone" placeholder="e.g. +91 98765 43210" defaultValue={imported.phone ?? dv.phone} />
        </div>
      </div>

      <div style={group}>
        <div style={groupTitle}>Role</div>
        <div style={grid}>
          <SelectOrCustom name="designation" label="Designation" required options={DESIGNATION_OPTIONS} defaultValue={dv.designation} placeholder="e.g. Security Analyst" />
          <SelectOrCustom name="department" label="Department" options={DEPARTMENT_OPTIONS} defaultValue={dv.department} placeholder="e.g. Security Operations" />
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
          <Field name="bankAccount" label="Account no." placeholder="e.g. 00001234567" defaultValue={dv.bankAccount} />
          <Field name="ifsc" label="IFSC" placeholder="e.g. SMPL0000123" defaultValue={dv.ifsc} />
          <Field name="bankBranch" label="Bank & branch" placeholder="e.g. Sample Bank, Sector 62 Noida" defaultValue={dv.bankBranch} />
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
