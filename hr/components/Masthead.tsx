import type React from "react";
import { COMPANY } from "@/lib/company";

// The branded masthead.
//  - `full` (formal letters): location | email | phone | website.
//  - `lean` (payslips): the SAME line minus the email (the HR email is presented
//    via the QR + the footnote), so the masthead still reads as full letterhead.
//  - `rightSlot`: optional element pinned to the RIGHT of the masthead (the
//    payslip passes its scan-to-email-HR QR here); the text block flexes to fill
//    the space between the logo and the slot.
export function Masthead({
  variant = "full",
  email = COMPANY.email,
  tagline = COMPANY.tagline,
  rightSlot,
}: {
  variant?: "full" | "lean";
  email?: string;
  /** Override for programme-specific letterheads (e.g. the internship offer). */
  tagline?: string;
  rightSlot?: React.ReactNode;
}) {
  const contact =
    variant === "lean"
      ? `${COMPANY.locationLine}  |  ${COMPANY.phone}  |  ${COMPANY.website}`
      : `${COMPANY.locationLine}  |  ${email}  |  ${COMPANY.phone}  |  ${COMPANY.website}`;

  return (
    <div className="ss-mast">
      {/* Real Cipher-S mark, served same-origin from /public/brand. */}
      <img className="ss-logo" src="/brand/cipher-s-mark.png" alt="ShieldSync" width={54} height={54} />
      <div style={{ flex: 1 }}>
        <div className="ss-name">{COMPANY.legalName}</div>
        <div className="ss-tag">{tagline}</div>
        <div className="ss-contact">{contact}</div>
      </div>
      {rightSlot ? <div style={{ flex: "none" }}>{rightSlot}</div> : null}
    </div>
  );
}
