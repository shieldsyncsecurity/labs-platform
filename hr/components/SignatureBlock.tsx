import { COMPANY } from "@/lib/company";

// The authorised-signatory block. Pre-signed by default: Ms. Rachna's signature
// (extracted from the signed appointment letter) over the company seal, above
// the signature line — matching the signed originals. `preSigned={false}` leaves
// a blank line + seal to sign after printing.
export function SignatureBlock({
  signatory,
  preSigned = true,
}: {
  signatory: { name: string; designation: string };
  preSigned?: boolean;
}) {
  return (
    <div style={{ minWidth: 240 }}>
      <div className="ss-body" style={{ margin: 0 }}>
        For {COMPANY.legalName.replace("Private Limited", "Pvt. Ltd.")}
      </div>

      {/* Signature + seal zone (sits just above the line). */}
      <div style={{ position: "relative", width: 230, height: 70 }}>
        <img
          src="/sealed/company-seal.png"
          alt=""
          aria-hidden="true"
          style={{ position: "absolute", right: 4, top: 0, width: 70, height: 70, opacity: 0.9 }}
        />
        {preSigned ? (
          <img
            src="/sealed/authorised-signature.png"
            alt="Authorised signature"
            style={{ position: "absolute", left: 6, top: 22, height: 44 }}
          />
        ) : null}
      </div>

      <div style={{ borderTop: "1px solid #33445f", width: 220, paddingTop: 4, fontSize: 11 }}>
        Authorised Signatory
      </div>
      <div style={{ fontSize: 11, color: "#5b6676" }}>Name: {signatory.name}</div>
      <div style={{ fontSize: 11, color: "#5b6676" }}>Designation: {signatory.designation}</div>
    </div>
  );
}
