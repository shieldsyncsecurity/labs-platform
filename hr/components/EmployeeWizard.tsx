"use client";

// Guided hiring wizard: Who → Role → Pay → Bank → Review, then a finish screen
// that offers the appointment/internship letter immediately. Each step is a
// small <form> — browser `required` validation gates Next, FormData accumulates
// into one payload, and Back never loses what's typed.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { suggestStructure, formatINR } from "@/lib/payslip";
import {
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
import { Field, SelectOrCustom, labelStyle, inputStyle, gridStyle, primaryBtn, ghostBtn } from "./fields";
import { DateField } from "./DateField";

type Data = Record<string, string>;

const STEPS = ["Who", "Role", "Pay", "Bank", "Review"] as const;

const num = (s?: string) => Number((s ?? "").replace(/[, ]/g, "")) || 0;

function StepChips({ current }: { current: number }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "14px 0 4px" }}>
      {STEPS.map((s, i) => (
        <div
          key={s}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            borderRadius: 999,
            padding: "5px 13px",
            background: i === current ? "#1f3a5f" : i < current ? "#e7f6ee" : "#eef2f8",
            color: i === current ? "#fff" : i < current ? "#1a7a45" : "#8a94a3",
          }}
        >
          {i < current ? "✓ " : `${i + 1}. `}
          {s}
        </div>
      ))}
    </div>
  );
}

// Live pay preview: controlled gross input + the auto-split, so HR sees the
// exact Annexure A numbers before creating the record.
function PayStep({ data }: { data: Data }) {
  const [gross, setGross] = useState(data.grossMonthly ?? "");
  const s = suggestStructure(num(gross));
  return (
    <div>
      <div style={gridStyle}>
        <div>
          <label style={labelStyle} htmlFor="grossMonthly">Gross monthly (INR) <span style={{ color: "#c0344c" }}>*</span></label>
          <input id="grossMonthly" name="grossMonthly" required value={gross} onChange={(e) => setGross(e.target.value)} style={inputStyle} placeholder="30000" inputMode="numeric" />
        </div>
        <Field name="annualCTC" label="Annual CTC (INR) — blank = gross × 12" placeholder={num(gross) ? String(num(gross) * 12) : "360000"} defaultValue={data.annualCTC} />
      </div>
      <div style={{ marginTop: 14, border: "1px solid #e2e8f2", borderRadius: 10, padding: "12px 14px", background: "#f8fafc" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "#8a94a3", fontWeight: 800, marginBottom: 6 }}>
          Salary structure preview (Annexure A)
        </div>
        {num(gross) > 0 ? (
          <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              {[
                ["Basic Pay (50%)", s.basic],
                ["House Rent Allowance (40% of Basic)", s.hra],
                ["Conveyance Allowance", s.conveyance],
                ["Special Allowance (balance)", s.special],
              ].map(([k, v]) => (
                <tr key={k as string}>
                  <td style={{ padding: "3px 18px 3px 0", color: "#5b6676" }}>{k}</td>
                  <td style={{ padding: "3px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatINR(v as number)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 800, color: "#1f3a5f" }}>
                <td style={{ padding: "5px 18px 0 0", borderTop: "1px solid #e2e8f2" }}>Gross / month</td>
                <td style={{ padding: "5px 0 0", borderTop: "1px solid #e2e8f2", textAlign: "right" }}>{formatINR(s.gross)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12.5, color: "#8a94a3" }}>Enter the gross to see the split.</div>
        )}
      </div>
    </div>
  );
}

export function EmployeeWizard() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Data>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ seq: number; name: string; isIntern: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isIntern = /internship/i.test(data.employmentType ?? "");

  // Guard against the browser Back button / accidental refresh wiping four
  // steps of typing — the wizard's own ← Back is an in-page button.
  useEffect(() => {
    const dirty = Object.keys(data).length > 0 && !created;
    if (!dirty) return;
    const warn = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [data, created]);

  function mergeCurrent(): Data {
    if (!formRef.current) return data;
    const merged = { ...data, ...Object.fromEntries(new FormData(formRef.current).entries()) } as Data;
    setData(merged);
    return merged;
  }
  function onNext(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    mergeCurrent();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function onBack() {
    mergeCurrent(); // keep partial input without validating
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onCreate() {
    setBusy(true);
    setError(null);
    const d = data;
    const payload = {
      name: d.name?.trim(), address: d.address?.trim(), pan: d.pan?.trim(), personalEmail: d.personalEmail?.trim(), phone: d.phone?.trim(),
      designation: d.designation?.trim(), department: d.department?.trim(), dateOfJoining: d.dateOfJoining?.trim(),
      employmentType: d.employmentType?.trim() || DEFAULT_EMPLOYMENT_TYPE,
      baseLocation: d.baseLocation?.trim() || DEFAULT_BASE_LOCATION,
      reportingTo: d.reportingTo?.trim() || DEFAULT_REPORTING_TO,
      duties: (d.duties ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
      grossMonthly: num(d.grossMonthly), annualCTC: num(d.annualCTC),
      probationMonths: num(d.probationMonths) || undefined,
      internshipMonths: num(d.internshipMonths) || undefined,
      bankAccount: d.bankAccount?.trim(), bankBranch: d.bankBranch?.trim(), ifsc: d.ifsc?.trim(),
      paymentMode: d.paymentMode?.trim() || DEFAULT_PAYMENT_MODE,
      uanPf: d.uanPf?.trim(), esic: d.esic?.trim(),
    };
    try {
      const res = await fetch("/api/employees", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const out = await res.json();
      if (!res.ok) {
        setError(out.error ?? "Could not create the employee.");
        setBusy(false);
        return;
      }
      setCreated({ seq: out.employee.seq, name: out.employee.name, isIntern: /internship/i.test(out.employee.employmentType ?? "") });
    } catch {
      setError("Could not reach the server — check the connection and try again.");
      setBusy(false);
    }
  }

  // ---- finish screen ----------------------------------------------------------
  if (created) {
    return (
      <div style={{ border: "1px solid #cde8d8", background: "#f2fbf6", borderRadius: 12, padding: 22, marginTop: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1a7a45" }}>✓ {created.name} added</div>
        <p style={{ fontSize: 12.5, color: "#41506a", margin: "8px 0 14px" }}>What next?</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/employees/${created.seq}/${created.isIntern ? "internship-offer" : "offer"}`} style={{ ...primaryBtn, textDecoration: "none" }}>
            Issue {created.isIntern ? "internship offer" : "appointment letter"} →
          </Link>
          <Link href={`/employees/${created.seq}`} style={{ ...ghostBtn, textDecoration: "none" }}>Open the record</Link>
          <button type="button" onClick={() => { setCreated(null); setData({}); setStep(0); setBusy(false); }} style={ghostBtn}>
            Add another
          </button>
        </div>
      </div>
    );
  }

  // ---- review step ------------------------------------------------------------
  const reviewRows: Array<[string, string]> = [
    ["Name", data.name ?? ""],
    ["Designation", data.designation ?? ""],
    ["Department", data.department || "—"], // optional — a neutral dash, not red "missing"
    ["Employment type", data.employmentType || DEFAULT_EMPLOYMENT_TYPE],
    ["Date of joining", data.dateOfJoining ?? ""],
    isIntern ? ["Internship duration", data.internshipMonths ? `${data.internshipMonths} months` : "2 months (default)"] : ["Probation", `${data.probationMonths || 3} months`],
    ["Gross / month", num(data.grossMonthly) ? formatINR(num(data.grossMonthly)) : ""],
    ["Annual CTC", formatINR(num(data.annualCTC) || num(data.grossMonthly) * 12)],
    ["Location", data.baseLocation || DEFAULT_BASE_LOCATION],
    ["Reporting to", data.reportingTo || DEFAULT_REPORTING_TO],
    ["PAN", data.pan ?? "—"],
    ["Bank", [data.bankAccount, data.ifsc].filter(Boolean).join(" · ") || "—"],
    ["Payment mode", data.paymentMode || DEFAULT_PAYMENT_MODE],
  ];

  return (
    <div>
      <StepChips current={step} />
      {error ? (
        <div style={{ background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", marginTop: 10 }}>{error}</div>
      ) : null}

      {step < 4 ? (
        <form key={step} ref={formRef} onSubmit={onNext} style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 10 }}>
          {step === 0 ? (
            <div style={gridStyle}>
              <Field name="name" label="Full name" required placeholder="e.g. Aarav Sample" defaultValue={data.name} />
              <Field name="personalEmail" label="Personal email (for sending documents)" type="email" placeholder="e.g. aarav.sample@gmail.com" defaultValue={data.personalEmail} />
              <Field name="phone" label="Phone" placeholder="e.g. +91 98765 43210" defaultValue={data.phone} />
              <Field name="pan" label="PAN" placeholder="e.g. ABCDE1234F" defaultValue={data.pan} />
              <Field name="address" label="Address (appears on the offer letter)" full placeholder="e.g. 12, Sample Residency, Sector 62, Noida, Uttar Pradesh 201309" defaultValue={data.address} />
            </div>
          ) : null}

          {step === 1 ? (
            <div style={gridStyle}>
              <SelectOrCustom name="designation" label="Designation" required options={DESIGNATION_OPTIONS} defaultValue={data.designation ?? ""} placeholder="e.g. Security Analyst" />
              <SelectOrCustom name="department" label="Department" options={DEPARTMENT_OPTIONS} defaultValue={data.department ?? ""} placeholder="e.g. Security Operations" />
              <SelectOrCustom name="employmentType" label="Employment type" options={EMPLOYMENT_TYPE_OPTIONS} defaultValue={data.employmentType || DEFAULT_EMPLOYMENT_TYPE} />
              <DateField name="dateOfJoining" label="Date of joining" required defaultValue={data.dateOfJoining} />
              <Field name="probationMonths" label="Probation months (full-time; blank = 3)" placeholder="3" defaultValue={data.probationMonths} />
              <Field name="internshipMonths" label="Internship months (interns; blank = 2)" placeholder="2" defaultValue={data.internshipMonths} />
              <SelectOrCustom name="baseLocation" label="Base work location" options={BASE_LOCATION_OPTIONS} defaultValue={data.baseLocation || DEFAULT_BASE_LOCATION} />
              <SelectOrCustom name="reportingTo" label="Reporting to" options={REPORTING_TO_OPTIONS} defaultValue={data.reportingTo || DEFAULT_REPORTING_TO} />
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle} htmlFor="duties">Duties &amp; responsibilities (one per line; blank = sensible defaults)</label>
                <textarea id="duties" name="duties" rows={4} style={{ ...inputStyle, resize: "vertical" }} placeholder={"Supporting client GRC engagements…\nConducting risk assessments…"} defaultValue={data.duties} />
              </div>
            </div>
          ) : null}

          {step === 2 ? <PayStep data={data} /> : null}

          {step === 3 ? (
            <div style={gridStyle}>
              <Field name="bankAccount" label="Bank account no." placeholder="e.g. 00001234567" defaultValue={data.bankAccount} />
              <Field name="ifsc" label="IFSC" placeholder="e.g. SMPL0000123" defaultValue={data.ifsc} />
              <Field name="bankBranch" label="Bank & branch" placeholder="e.g. Sample Bank, Sector 62 Noida" defaultValue={data.bankBranch} />
              <SelectOrCustom name="paymentMode" label="Payment mode" options={PAYMENT_MODE_OPTIONS} defaultValue={data.paymentMode || DEFAULT_PAYMENT_MODE} />
              <Field name="uanPf" label="UAN / PF no. (blank = Not Applicable)" placeholder="e.g. 100123456789" defaultValue={data.uanPf} />
              <Field name="esic" label="ESIC no. (if registered)" placeholder="e.g. 1234567890 (blank if not registered)" defaultValue={data.esic} />
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <button type="button" onClick={onBack} disabled={step === 0} style={{ ...ghostBtn, visibility: step === 0 ? "hidden" : "visible" }}>
              ← Back
            </button>
            <button type="submit" style={primaryBtn}>Next →</button>
          </div>
        </form>
      ) : (
        <div style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#1f3a5f", marginBottom: 8 }}>Review — everything correct?</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              {reviewRows.map(([k, v]) => (
                <tr key={k} style={{ borderTop: "1px solid #eef2f7" }}>
                  <td style={{ padding: "6px 10px 6px 0", color: "#8a94a3", width: 170 }}>{k}</td>
                  <td style={{ padding: "6px 0", color: "#1b2331" }}>{v || <i style={{ color: "#c0344c" }}>missing</i>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: "#8a94a3", marginTop: 10 }}>
            The Employee ID is assigned automatically ({isIntern ? "internship offer uses the SSS/INT letter series" : "letters use the unified SSS/HR series"}).
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button type="button" onClick={() => setStep(3)} style={ghostBtn}>← Back</button>
            <button type="button" onClick={onCreate} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Creating…" : "Create employee ✓"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
