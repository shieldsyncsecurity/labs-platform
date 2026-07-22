import qrcode from "qrcode-generator";

/**
 * Render `text` as a scalable QR-code SVG string (dark modules on transparent),
 * for embedding via dangerouslySetInnerHTML. Pure JS — no canvas, no node APIs —
 * so it runs on the Cloudflare Worker runtime. Error-correction "M" balances
 * density and scan robustness for a printed slip; size is controlled by CSS.
 */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

/** A mailto: URL pre-addressed to HR with a contextual subject line. */
export function hrMailto(email: string, subject: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
