import type React from "react";
import { COMPANY } from "@/lib/company";
import type { SimpleLetter } from "@/lib/documents/letters";
import { LETTERHEAD_CSS } from "./letterhead-css";
import { Masthead } from "./Masthead";
import { SignatureBlock } from "./SignatureBlock";

/** Renders a short single-page HR letter (verification, experience, leave/NOC,
 * increment, confirmation, completion certificate). */
export function SimpleLetterDoc({ letter, toolbar }: { letter: SimpleLetter; toolbar?: React.ReactNode }) {
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
          <span className="r">{letter.runLabel}</span>
        </div>

        <Masthead variant="full" email={COMPANY.hrEmail} />

        {letter.title ? (
          <div className="ss-title">
            <h1 className="u">{letter.title}</h1>
          </div>
        ) : null}

        <div className="ss-ref">
          <span>Ref: {letter.ref}</span>
          <span>Date: {letter.date}</span>
        </div>

        {letter.to ? (
          <div className="ss-addr" style={{ marginBottom: 6 }}>
            {letter.to.name ? <div className="nm">{letter.to.name}</div> : null}
            {(letter.to.lines ?? []).map((l, i) => (
              <div key={i} className="ad">{l}</div>
            ))}
            {letter.toNote ? <div className="ad" style={{ fontStyle: "italic" }}>{letter.toNote}</div> : null}
          </div>
        ) : null}

        {letter.subject ? (
          <div className="ss-title" style={{ margin: "12px 0 8px" }}>
            <h1 className="u" style={{ fontSize: 14.5 }}>SUBJECT: {letter.subject}</h1>
          </div>
        ) : null}

        {letter.salutation ? <p className="ss-body">{letter.salutation}</p> : null}
        {letter.paragraphs.map((p, i) => (
          <p key={i} className="ss-body">{p}</p>
        ))}

        {letter.table?.kind === "kv" ? (
          <table className="ss-kv" style={{ margin: "10px 0" }}>
            <tbody>
              {letter.table.rows.map(([k, v], i) => (
                <tr key={i}>
                  <td className="k" style={{ width: "32%" }}>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {letter.table?.kind === "grid" ? (
          <table className="ss-ded" style={{ margin: "10px 0" }}>
            <thead>
              <tr>
                {letter.table.headers.map((h, i) => (
                  <th key={i} className={i > 0 ? "amt" : undefined}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {letter.table.rows.map((row, i) => (
                <tr key={i} className={i === letter.table!.rows.length - 1 ? "tot" : undefined}>
                  {row.map((c, j) => (
                    <td key={j} className={j > 0 ? "amt" : undefined}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {(letter.paragraphs2 ?? []).map((p, i) => (
          <p key={i} className="ss-body">{p}</p>
        ))}

        {letter.signoff === "hr-dept" ? (
          <div style={{ marginTop: 26 }}>
            <p className="ss-body" style={{ marginBottom: 2 }}>Yours faithfully,</p>
            <p className="ss-body" style={{ fontWeight: 700, margin: "2px 0" }}>For {COMPANY.legalName}</p>
            <p className="ss-body" style={{ color: "#5b6676", fontSize: 11.5, margin: "2px 0" }}>
              Human Resources Department&nbsp; |&nbsp; {COMPANY.hrEmail}&nbsp; |&nbsp; {COMPANY.phone}
            </p>
            <div className="ss-remark" style={{ marginTop: 14, fontStyle: "italic" }}>
              Note: This is a computer-generated document and is valid without a physical signature.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 40, display: "flex", justifyContent: "flex-start" }}>
            <SignatureBlock signatory={letter.signatory} />
          </div>
        )}

        <div className="ss-foot">
          <span>{letter.runLabel}</span>
          <span className="c">
            {COMPANY.legalName} | CIN: {COMPANY.cin}
          </span>
          <span />
        </div>
      </div>
    </div>
  );
}
