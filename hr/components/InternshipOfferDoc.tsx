import type React from "react";
import { COMPANY } from "@/lib/company";
import type { InternshipOffer } from "@/lib/documents/internship";
import { LETTERHEAD_CSS } from "./letterhead-css";
import { Masthead } from "./Masthead";
import { SignatureBlock } from "./SignatureBlock";

/** Internship offer letter — plain-language redesign (v4, owner-approved 26 Jul 2026):
 * an "at a glance" summary grid + a highlighted stipend band, followed by
 * numbered clauses with circular badges rather than a plain running list. */
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
        {!offer.noWatermark ? (
          <div className="ss-watermark"><span>DIGITAL COPY &mdash; COLLECT ORIGINAL IN PERSON</span></div>
        ) : null}
        <div className="ss-run">
          <span>{COMPANY.legalName}</span>
          <span className="r">Letter of Intent &mdash; Internship</span>
        </div>

        <Masthead variant="full" email={COMPANY.hrEmail} />

        <div className="ss-title">
          <h1 className="u">LETTER OF INTENT &mdash; INTERNSHIP</h1>
        </div>

        <div className="ss-ref">
          <span>Ref: {offer.ref}</span>
          <span>Date: {offer.date}</span>
        </div>

        <p className="ss-body" style={{ marginTop: 14 }}>
          Dear <b>{offer.addressee.name}</b>,
        </p>
        <p className="ss-body">{offer.intro}</p>

        <div className="ss-int-glance">
          <div className="hd">Internship at a Glance</div>
          <div className="grid">
            {offer.glanceRows.map((r, i) => (
              <div key={r.label} className={`cell${i % 2 === 0 ? " odd" : ""}`}>
                <div className="k">{r.label}</div>
                <div className="v">{r.value}</div>
              </div>
            ))}
          </div>
          {/* An unpaid internship gets no stipend band at all — the "Stipend
              and Leave" section already says plainly that none is payable.
              A highlighted glance-table row is for a figure worth
              summarising, not for announcing the absence of one. */}
          {offer.stipend.amount !== "Unpaid" ? (
            <div className="pay">
              <span className="plab">Stipend</span>
              <span className="amt">{offer.stipend.amount}</span>
              <span className="note">{offer.stipend.note}</span>
            </div>
          ) : null}
        </div>

        {offer.sections.map((s) => (
          <section key={s.n} className="ss-int-clause">
            <h2>
              <span className="num">{s.n}</span>
              {s.heading}
            </h2>
            {s.intro ? <p className="intro">{s.intro}</p> : null}
            {s.bullets ? (
              <ul>
                {s.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}
          </section>
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
