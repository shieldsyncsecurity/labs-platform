// Letterhead CSS — a REDUCED SUBSET of hr/components/letterhead-css.ts,
// carrying only the masthead/stage/sheet classes billing actually uses (the
// full hr version is larger). Intentionally duplicated rather than
// cross-imported so billing/ can build independently without pulling in the
// hr/ dependency tree. The shared .ss-stage / .ss-sheet / .ss-mast rules must
// be kept in sync with hr by hand when either side changes.
export const LETTERHEAD_CSS = `
.ss-stage { background:#6b7280; padding:28px 16px 48px; }
.ss-sheet { background:#fff; margin:0 auto 26px; padding:46px 52px 40px;
  box-shadow:0 10px 30px rgba(0,0,0,.35); border-radius:3px; max-width:840px; position:relative;
  font-family:Arial,Helvetica,"Segoe UI",sans-serif; color:#1b2331;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.ss-sheet *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.ss-mast{ display:flex; gap:16px; align-items:center; padding-bottom:14px;
  border-bottom:2.5px solid #1f3a5f; margin-bottom:20px; }
.ss-mast .ss-name{ font-size:24px; font-weight:800; color:#1f3a5f; letter-spacing:.2px; line-height:1.1; }
.ss-mast .ss-tag{ font-size:12.5px; font-style:italic; color:#2f4fb0; margin-top:3px; }
.ss-mast .ss-contact{ font-size:10.5px; color:#5b6676; margin-top:4px; }
@media print {
  .ss-stage{ background:#fff !important; padding:0 !important; }
  .ss-sheet{ box-shadow:none !important; margin:0 !important; max-width:none !important;
    border-radius:0 !important; padding:0 !important; }
  .ss-noprint{ display:none !important; }
  @page{ size:A4; margin:22mm 18mm; }
}
`;
