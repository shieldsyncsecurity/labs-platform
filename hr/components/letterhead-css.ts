// The letterhead print styles, ported VERBATIM from the owner-approved preview
// (Diya format). Scoped under `.ss-stage` / `.ss-sheet` so nothing here leaks
// into the admin UI (and Tailwind never touches these documents). Injected once
// per document view via a <style> tag — this is the single source of the
// document look, so offer letters and payslips can never drift from what was
// signed off.
//
// Screen: gray stage + white A4-ish sheet with a shadow. Print: strip the stage
// and chrome, real A4 page, hide anything marked .ss-noprint.

export const LETTERHEAD_CSS = `
.ss-stage { background:#6b7280; padding:28px 16px 48px; }
.ss-sheet { background:#fff; margin:0 auto 26px; padding:46px 52px 40px;
  box-shadow:0 10px 30px rgba(0,0,0,.35); border-radius:3px; max-width:840px; position:relative;
  font-family:Arial,Helvetica,"Segoe UI",sans-serif; color:#1b2331;
  /* Force background colors onto paper: without this, Chrome/Edge default
     "Background graphics: off" prints the navy NET PAY band and table headers
     blank -- white text on white paper. */
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.ss-sheet *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

.ss-run{ display:flex; justify-content:space-between; align-items:flex-end; font-size:10px;
  color:#1f3a5f; font-weight:700; border-bottom:2px solid #1f3a5f; padding-bottom:6px; margin-bottom:22px; }
.ss-run .r{ font-weight:400; color:#5b6676; }

.ss-mast{ display:flex; gap:16px; align-items:center; padding-bottom:14px;
  border-bottom:2.5px solid #1f3a5f; margin-bottom:20px; }
.ss-mast .ss-logo{ width:54px; height:54px; border-radius:12px; display:block; }
.ss-mast .ss-name{ font-size:24px; font-weight:800; color:#1f3a5f; letter-spacing:.2px; line-height:1.1; }
.ss-mast .ss-tag{ font-size:12.5px; font-style:italic; color:#2f4fb0; margin-top:3px; }
.ss-mast .ss-contact{ font-size:10.5px; color:#5b6676; margin-top:4px; }

.ss-title{ text-align:center; margin:6px 0 2px; }
.ss-title h1{ font-size:19px; font-weight:800; color:#1f3a5f; letter-spacing:.5px; margin:0; }
.ss-title h1.u{ text-decoration:underline; text-underline-offset:4px; }
.ss-title .sub{ font-size:12.5px; font-style:italic; color:#2f4fb0; margin-top:4px; }

.ss-ref{ display:flex; justify-content:space-between; font-size:12px; margin:16px 0 10px; }
.ss-addr .nm{ font-weight:700; font-size:12px; } .ss-addr .ad{ font-size:11.5px; color:#5b6676; margin-top:2px; }
.ss-body{ font-size:12px; line-height:1.6; margin:10px 0; }
.ss-sec{ font-size:13px; color:#1f3a5f; font-weight:800; margin:20px 0 8px; }
.ss-ul{ margin:6px 0; padding-left:18px; } .ss-ul li{ font-size:12px; line-height:1.55; margin:4px 0; }

.ss-sheet table{ width:100%; border-collapse:collapse; }
.ss-kv td{ border:1px solid #d7deea; padding:7px 10px; font-size:12px; vertical-align:top; }
.ss-kv td.k{ background:#eef2f8; font-weight:700; width:26%; color:#1f3a5f; }

.ss-ded th{ background:#21314e; color:#fff; font-size:12px; text-align:left; padding:8px 10px; font-weight:700; }
.ss-ded th.amt, .ss-ded td.amt{ text-align:right; }
.ss-ded td{ border:1px solid #d7deea; padding:7px 10px; font-size:12px; }
.ss-ded tr.tot td{ font-weight:800; color:#1f3a5f; background:#f7f9fc; }

.ss-netpay{ background:#21314e; color:#fff; border-radius:3px; padding:11px 14px; margin-top:10px;
  display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
.ss-netpay .lab{ font-size:15px; font-weight:800; letter-spacing:.3px; }
.ss-netpay .words{ font-size:11.5px; font-style:italic; opacity:.92; }

.ss-remark{ background:#eef2f8; border-radius:3px; padding:8px 12px; font-size:11px; margin-top:12px; }
.ss-fine{ font-size:10.5px; color:#5b6676; font-style:italic; line-height:1.5; margin:8px 0 0; }

.ss-sig{ display:flex; justify-content:flex-end; margin-top:30px; margin-right:-18px; }
/* Stamp centered over its caption -> sits above the "ShieldSync" in
   "Company Stamp - For ShieldSync Security Pvt. Ltd." (was right-aligned). */
.ss-sig .wrap{ text-align:center; }
.ss-stamp{ width:118px; height:118px; display:inline-block; }
.ss-stampcap{ font-size:11px; color:#5b6676; margin-top:2px; }

/* Scannable HR-contact QR (payslip masthead, top-right): opens a pre-addressed
   email to HR. */
.ss-qr{ display:flex; flex-direction:column; align-items:center; gap:3px; }
.ss-qr .code{ width:70px; height:70px; border:1px solid #e3e8f0; border-radius:6px; padding:4px; background:#fff; }
.ss-qr .code svg{ width:100%; height:100%; display:block; }
.ss-qr .cap{ font-size:8.5px; color:#5b6676; text-align:center; line-height:1.2; }

.ss-foot{ display:flex; justify-content:space-between; font-size:9.5px; color:#5b6676;
  border-top:1px solid #d7deea; padding-top:8px; margin-top:26px; font-style:italic; gap:10px; }
.ss-foot .c{ font-style:normal; text-align:center; }

@media print {
  .ss-stage{ background:#fff !important; padding:0 !important; }
  .ss-sheet{ box-shadow:none !important; margin:0 !important; max-width:none !important;
    border-radius:0 !important; padding:22mm 18mm !important; }
  .ss-noprint{ display:none !important; }
  @page{ size:A4; margin:0; }
}
`;
