import { COMPANY } from "@/lib/company";

// The authorised-signatory block.
//
// LAYOUT: the seal overlaps upward onto the "For ShieldSync Security Pvt. Ltd."
// line and the signature sits beneath it — the way a real rubber stamp lands on
// a page, struck across the company name rather than parked politely beside it.
// The earlier version placed the seal in its own column to the right, which read
// as a logo rather than an impression.
//
// `preSigned={false}` leaves the seal and a blank line to sign by hand after
// printing — which is the right setting whenever the stored signature image does
// not belong to the person named below it (e.g. documents signed by someone
// other than the founder).
export function SignatureBlock({
  signatory,
  preSigned = true,
}: {
  signatory: { name: string; designation: string };
  preSigned?: boolean;
}) {
  return (
    <div style={{ minWidth: 240 }}>
      {/* The seal is absolutely positioned relative to THIS wrapper so it can
          sit across the company-name line without pushing anything down. */}
      <div style={{ position: "relative", width: 230 }}>
        <div className="ss-body" style={{ margin: 0 }}>
          For {COMPANY.legalName.replace("Private Limited", "Pvt. Ltd.")}
        </div>

        {/* Signature zone. Seal rides up over the line above; signature struck
            across and below it.

            GEOMETRY NOTE: the signature asset is the founder's real scanned
            signature, which is essentially SQUARE (287x283) — it climbs
            diagonally rather than running along a baseline. The earlier
            hand-drawn placeholder was wide (roughly 3:1), so the old
            `height: 46` produced a readable strip. The same 46px here would be
            46px WIDE — an illegible smudge. Size off the width instead. */}
        <div style={{ position: "relative", width: 230, height: 96 }}>
          <img
            src="/sealed/company-seal.png"
            alt=""
            aria-hidden="true"
            style={{ position: "absolute", left: 88, top: -22, width: 82, height: 82, opacity: 0.88 }}
          />
          {preSigned ? (
            <img
              src="/sealed/authorised-signature.png"
              alt="Authorised signature"
              // z-index above the seal: on a real document the pen goes on last.
              style={{ position: "absolute", left: 22, top: 12, width: 78, zIndex: 2 }}
            />
          ) : null}
        </div>
      </div>

      <div style={{ borderTop: "1px solid #33445f", width: 220, paddingTop: 4, fontSize: 11 }}>
        Authorised Signatory
      </div>
      <div style={{ fontSize: 11, color: "#5b6676" }}>Name: {signatory.name}</div>
      <div style={{ fontSize: 11, color: "#5b6676" }}>Designation: {signatory.designation}</div>
    </div>
  );
}
