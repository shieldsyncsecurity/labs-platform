import type React from "react";
import { COMPANY } from "@/lib/company";
import { INTERNSHIP_TAGLINE, type InternshipOffer } from "@/lib/documents/internship";
import { LETTERHEAD_CSS } from "./letterhead-css";
import { Masthead } from "./Masthead";
import { SignatureBlock } from "./SignatureBlock";

// Bullet items may carry a "Label: text" prefix — bold the label, matching the
// issued internship offer's Confidentiality/IP/Conduct section style.
function Bullet({ text }: { text: string }) {
  const idx = text.indexOf(": ");
  if (idx > 0 && idx < 40) {
    return (
      <li>
        <b>{text.slice(0, idx + 1)}</b> {text.slice(idx + 2)}
      </li>
    );
  }
  return <li>{text}</li>;
}

/** Internship offer letter in the company's issued format (Princy reference). */
export function InternshipOfferDoc({ offer, toolbar }: { offer: InternshipOffer; toolbar?: React.ReactNode }) {
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
          <span className="r">Internship Offer Letter</span>
        </div>

        <Masthead variant="full" email={COMPANY.hrEmail} tagline={INTERNSHIP_TAGLINE} />

        <div className="ss-ref">
          <span>Ref: {offer.ref}</span>
          <span>Date: {offer.date}</span>
        </div>

        <div className="ss-title">
          <h1 className="u">INTERNSHIP OFFER LETTER</h1>
        </div>

        <p className="ss-body" style={{ marginTop: 14 }}>
          Dear <b>{offer.addressee.name}</b>,
        </p>
        <p className="ss-body">{offer.intro}</p>

        <h2 className="ss-sec">1. Internship Details</h2>
        <table className="ss-kv">
          <tbody>
            {offer.detailRows.map((r) => (
              <tr key={r.label}>
                <td className="k">{r.label}</td>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {offer.sections.map((s) => (
          <div key={s.n}>
            <h2 className="ss-sec">
              {s.n}. {s.heading}
            </h2>
            {s.intro ? <p className="ss-body">{s.intro}</p> : null}
            {s.bullets ? (
              <ul className="ss-ul">
                {s.bullets.map((b, i) => (
                  <Bullet key={i} text={b} />
                ))}
              </ul>
            ) : null}
          </div>
        ))}

        <p className="ss-body" style={{ marginTop: 14 }}>{offer.closing}</p>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 30 }}>
          <SignatureBlock signatory={offer.signatory} />
          <div>
            <div className="ss-body" style={{ margin: 0, fontWeight: 700 }}>
              Accepted by Intern
            </div>
            <div style={{ borderTop: "1px solid #33445f", width: 220, marginTop: 74, paddingTop: 4, fontSize: 11 }}>
              {offer.addressee.name}
            </div>
            <div style={{ fontSize: 11, color: "#5b6676" }}>Signature &amp; Date</div>
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
