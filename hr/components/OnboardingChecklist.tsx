"use client";

import { useEffect, useState } from "react";
import type { KycDoc, KycKind } from "@/lib/kyc";

const REQUIRED: { kind: KycKind; label: string; hint: string }[] = [
  { kind: "aadhaar", label: "Aadhaar", hint: "Government-issued ID" },
  { kind: "pan", label: "PAN card", hint: "For payroll and TDS" },
  { kind: "bank_proof", label: "Bank proof", hint: "Cancelled cheque or passbook" },
  { kind: "photo", label: "Photograph", hint: "Recent passport-size" },
  { kind: "signed_offer", label: "Signed offer letter", hint: "Original, physical copy" },
];

function fmt(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function OnboardingChecklist({ seq, paymentMode }: { seq: string; paymentMode?: string }) {
  const [docs, setDocs] = useState<KycDoc[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/employees/${seq}/docs`)
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((d) => { if (live) setDocs(d.docs ?? []); })
      // Don't default to [] on failure — that renders "0/N pending" as if
      // nothing was uploaded, contradicting the KycSection below (which shows
      // a real error) when the engine merely hiccups.
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [seq]);

  if (failed) {
    return (
      <div style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 16, fontSize: 12.5, color: "#8a94a3" }}>
        Couldn&rsquo;t load onboarding documents right now — refresh in a moment.
      </div>
    );
  }
  if (docs === null) {
    return (
      <div style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 16, fontSize: 12.5, color: "#8a94a3" }}>
        Loading onboarding documents…
      </div>
    );
  }

  // A cash-paid employee has no bank account for HR to hold proof of — asking
  // for one would leave the checklist permanently stuck at "pending" for a
  // document that will never legitimately exist (the same bug class as the
  // payslip remark that assumed every payment was a bank credit).
  const required = paymentMode?.trim().toLowerCase() === "cash" ? REQUIRED.filter((r) => r.kind !== "bank_proof") : REQUIRED;

  const kycDocs = docs.filter((d) => d.category !== "sent");
  const have = new Map(kycDocs.map((d) => [d.kind as string, d]));
  const total = required.length;
  const done = required.filter((r) => have.has(r.kind)).length;
  const allDone = done === total;

  return (
    <div style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, color: "#1f3a5f", fontSize: 14 }}>Onboarding documents</div>
        {allDone ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#1a7a45", background: "#e7f6ee", border: "1px solid #b7e2c9", borderRadius: 999, padding: "2px 9px" }}>
            ✓ All {total} collected
          </span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8a5a00", background: "#fdf4e3", border: "1px solid #f0d9a8", borderRadius: 999, padding: "2px 9px" }}>
            {done}/{total} — {total - done} pending
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 10, height: 5, background: "#eef2f7", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(done / total) * 100}%`, background: allDone ? "#1a7a45" : "#f0a030", borderRadius: 99, transition: "width .3s" }} />
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
        {required.map((item) => {
          const doc = have.get(item.kind);
          return (
            <div
              key={item.kind}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", borderBottom: "1px solid #f4f7fb" }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 800,
                  background: doc ? "#e7f6ee" : "#f2f5fa",
                  color: doc ? "#1a7a45" : "#a9b2c1",
                  border: `1.5px solid ${doc ? "#b7e2c9" : "#d4dbe8"}`,
                  flex: "none",
                }}
              >
                {doc ? "✓" : "·"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, color: doc ? "#1b2331" : "#5b6676", fontWeight: doc ? 600 : 400 }}>{item.label}</span>
                {!doc ? <span style={{ fontSize: 11.5, color: "#a9b2c1", marginLeft: 6 }}>{item.hint}</span> : null}
              </div>
              {doc ? (
                <span style={{ fontSize: 11, color: "#8a94a3", whiteSpace: "nowrap" }}>
                  {fmt(doc.uploadedAt)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {!allDone ? (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#8a94a3" }}>
          Upload missing documents in the KYC vault below.
        </div>
      ) : null}
    </div>
  );
}
