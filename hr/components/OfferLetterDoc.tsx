import type React from "react";
import { COMPANY } from "@/lib/company";
import type { OfferLetter } from "@/lib/documents/offer-letter";
import { LETTERHEAD_CSS } from "./letterhead-css";
import { Masthead } from "./Masthead";
import { SignatureBlock } from "./SignatureBlock";

const fmtInt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

/** One offer / appointment letter, rendered in the owner-approved (Diya) format. */
export function OfferLetterDoc({ letter, toolbar }: { letter: OfferLetter; toolbar?: React.ReactNode }) {
  const a = letter.annexure;

  return (
    <div className="ss-stage">
      <style dangerouslySetInnerHTML={{ __html: LETTERHEAD_CSS }} />
      {toolbar ? (
        <div className="ss-noprint" style={{ maxWidth: 840, margin: "0 auto 12px" }}>
          {toolbar}
        </div>
      ) : null}

      <div className="ss-sheet">
        <div className="ss-run">
          <span>{COMPANY.legalName}</span>
          <span className="r">Letter of Appointment</span>
        </div>

        <Masthead variant="full" email={COMPANY.hrEmail} />

        <div className="ss-title">
          <h1 className="u">{letter.title}</h1>
          <div className="sub">{letter.confidential}</div>
        </div>

        <div className="ss-ref">
          <span>Ref: {letter.ref}</span>
          <span>Date: {letter.date}</span>
        </div>

        <div className="ss-addr">
          <div className="nm">{letter.addressee.name}</div>
          <div className="ad">Address: {letter.addressee.address}</div>
        </div>

        {/* Greeting uses the first name only — the full name already appears in
            the addressee block above, so repeating it in the salutation reads
            redundant. */}
        <p className="ss-body">
          Dear <b>{letter.addressee.name.trim().split(/\s+/)[0]}</b>,
        </p>
        <p className="ss-body">{letter.intro}</p>

        {/* Section 1 — Position, Reporting & Commencement */}
        <h2 className="ss-sec">1. Position, Reporting &amp; Commencement</h2>
        <table className="ss-kv">
          <tbody>
            {letter.positionRows.map((r) => (
              <tr key={r.label}>
                <td className="k">{r.label}</td>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ss-fine">Detailed compensation is set out in Annexure A to this letter.</p>

        {/* Sections 2 - 15 */}
        {letter.sections.map((s) => (
          <div key={s.n}>
            <h2 className="ss-sec">
              {s.n}. {s.heading}
            </h2>
            {s.blocks.map((b, i) =>
              b.type === "p" ? (
                <p key={i} className="ss-body">
                  {b.text}
                </p>
              ) : (
                <ul key={i} className="ss-ul">
                  {b.items.map((it, j) => (
                    <li key={j}>{it}</li>
                  ))}
                </ul>
              ),
            )}
          </div>
        ))}

        {/* Section 16 — Acceptance */}
        <h2 className="ss-sec">16. Acceptance</h2>
        <p className="ss-body">
          Please confirm your acceptance of the above terms by signing and returning a copy of this
          letter along with the Annexure. We are delighted to have you as part of ShieldSync and look
          forward to your continued contribution.
        </p>
        {letter.acceptBy ? (
          <p className="ss-body">
            This offer is valid for your acceptance up to and including <b>{letter.acceptBy}</b>.
          </p>
        ) : null}

        {/* Annexure A — Compensation Structure. Placed BEFORE the signatures so
            the employee signs having seen the full compensation schedule (the
            signatures are the final act, covering everything above them). */}
        <div style={{ marginTop: 24 }}>
          <div className="ss-title">
            <h1 className="u" style={{ fontSize: 15 }}>
              {a.heading}
            </h1>
          </div>
          <p className="ss-body" style={{ textAlign: "center", marginTop: 4 }}>
            {a.subheading}
          </p>
          <table className="ss-ded" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th style={{ width: "50%" }}>Component</th>
                <th className="amt">Monthly (INR)</th>
                <th className="amt">Annual (INR)</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((r) => (
                <tr key={r.component}>
                  <td>{r.component}</td>
                  <td className="amt">{fmtInt(r.monthly)}</td>
                  <td className="amt">{fmtInt(r.annual)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Gross Salary (Cost to Company)</td>
                <td className="amt">{fmtInt(a.grossRow.monthly)}</td>
                <td className="amt">{fmtInt(a.grossRow.annual)}</td>
              </tr>
            </tbody>
          </table>
          <ul className="ss-ul" style={{ marginTop: 8 }}>
            {a.notes.map((n, i) => (
              <li key={i} style={{ fontSize: 11, color: "#5b6676" }}>
                {n}
              </li>
            ))}
          </ul>
        </div>

        {/* Signatures — the final act, after all terms and the Annexure. */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 30 }}>
          <SignatureBlock signatory={letter.signatory} preSigned={letter.seal !== false} />


          <div>
            <div className="ss-body" style={{ margin: 0, fontWeight: 700 }}>
              Accepted by Employee
            </div>
            <div style={{ borderTop: "1px solid #33445f", width: 220, marginTop: 74, paddingTop: 4, fontSize: 11 }}>
              {letter.addressee.name}
            </div>
            <div style={{ fontSize: 11, color: "#5b6676" }}>Signature &amp; Date</div>
            <div style={{ fontSize: 11, color: "#5b6676", marginTop: 6 }}>Place: ____________________</div>
          </div>
        </div>

        <div className="ss-foot">
          <span>Private &amp; Confidential</span>
          <span className="c">
            CIN: {COMPANY.cin} · {COMPANY.hrEmail}
          </span>
          <span />
        </div>
      </div>
    </div>
  );
}
