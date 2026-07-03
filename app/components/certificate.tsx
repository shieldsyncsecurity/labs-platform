"use client";

// F3 — verifiable completion certificate.
//
// Renders the light/business A4-landscape cert (design source:
// BRAND-AND-LOGO-HANDOFF.md §3A, "PRIMARY" variant) filled with the four
// dynamic fields, using the FINAL indigo/mint "Cipher-S" mark
// (/logo/shieldsync-mark-light.svg) in place of the old placeholder gradient
// shield. Offers Download PDF, Download PNG, and a prefilled LinkedIn share.
//
// The SVG is rendered live in the DOM (so the browser paints fonts/gradients
// exactly like any other page content) rather than string-templated — this
// component owns ONE visual definition (renderCertSvg) that both the on-
// screen preview and the PDF/PNG export rasterize from, so they can never
// drift apart.

import { useMemo, useRef, useState } from "react";

const CERT_W = 1120;
const CERT_H = 792; // A4 landscape ratio (1.414)

export type CertificateData = {
  name: string;
  labTitle: string;
  /** ISO date string — formatted for display inside the component. */
  completedAt: string;
  credentialId: string;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function verifyUrl(credentialId: string): string {
  return `https://labs.shieldsyncsecurity.com/verify/${encodeURIComponent(credentialId)}`;
}

// Escape the few characters that matter inside SVG <text> content — the four
// fields are server-derived (name from the verified session, lab title from
// the catalog, credential id is HMAC hex) but this is cheap insurance since
// the string ends up in dangerouslySetInnerHTML-free JSX text nodes anyway
// (React escapes text children automatically — this helper exists only for
// the offscreen SERIALIZED svg string used by the PDF/PNG export path).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The certificate's SVG markup as a STRING (for export — canvas needs a
 * serialized <img> source) AND as the same content rendered inline (for the
 * on-screen preview) via dangerouslySetInnerHTML from this one function, so
 * preview and export are pixel-identical.
 */
function certSvgInner(data: CertificateData, markHref: string): string {
  const name = esc(data.name || "ShieldSync Learner");
  const labTitle = esc(data.labTitle);
  const date = esc(fmtDate(data.completedAt));
  const credId = esc(data.credentialId);
  const verify = esc(verifyUrl(data.credentialId));

  return `
  <defs>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#06b6d4"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="${CERT_W}" height="${CERT_H}" fill="#ffffff"/>
  <g opacity="0.05"><path transform="translate(441,232) scale(7)" d="M17 2 L32 8 L32 22 C32 33 25 39 17 42 C9 39 2 33 2 22 L2 8 Z" fill="#4f46e5"/></g>
  <rect x="26" y="26" width="1068" height="740" rx="6" fill="none" stroke="#d5dcec" stroke-width="1.5"/>
  <rect x="34" y="34" width="1052" height="724" rx="4" fill="none" stroke="#4f46e5" stroke-opacity="0.22" stroke-width="1"/>
  <g fill="none" stroke="#4f46e5" stroke-opacity="0.5" stroke-width="2"><path d="M58 80 L58 62 L76 62"/><path d="M1062 80 L1062 62 L1044 62"/><path d="M58 712 L58 730 L76 730"/><path d="M1062 712 L1062 730 L1044 730"/></g>
  <image href="${markHref}" x="527" y="48" width="66" height="66"/>
  <text x="560" y="140" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="27" font-weight="700" fill="#1e293b">Shield<tspan fill="#0891b2">Sync</tspan></text>
  <text x="560" y="161" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="11" font-weight="600" letter-spacing="4.5" fill="#64748b">SECURITY LABS</text>
  <text x="560" y="214" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="6.5" fill="#4338ca">CERTIFICATE OF COMPLETION</text>
  <rect x="512" y="228" width="96" height="3" rx="1.5" fill="url(#acc)"/>
  <text x="560" y="278" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="16" font-style="italic" fill="#64748b">This is to certify that</text>
  <text x="560" y="334" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="44" font-weight="700" fill="#0f172a">${name}</text>
  <line x1="400" y1="354" x2="720" y2="354" stroke="#cbd5e1" stroke-width="1.25"/>
  <rect x="524" y="352.5" width="72" height="3" rx="1.5" fill="#06b6d4"/>
  <text x="560" y="398" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="16" fill="#64748b">has successfully completed the hands-on security lab</text>
  <text x="560" y="452" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="32" font-weight="800" fill="#312e81">${labTitle}</text>
  <text x="560" y="479" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="13" font-weight="600" letter-spacing="3.5" fill="#64748b">AWS SECURITY LAB</text>
  <text x="560" y="524" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="15" fill="#475569">Investigated a live, intentionally-misconfigured AWS account and verified</text>
  <text x="560" y="547" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="15" fill="#475569">every fix against real, running AWS resources — not a checkbox quiz.</text>
  <g transform="translate(560,656)">
    <path d="M-16 6 L-28 52 L-12 42 L-4 52 Z" fill="#4338ca"/>
    <path d="M16 6 L28 52 L12 42 L4 52 Z" fill="#06b6d4"/>
    <circle r="44" fill="#ffffff" stroke="url(#acc)" stroke-width="2.5"/>
    <circle r="36" fill="none" stroke="#4f46e5" stroke-opacity="0.22" stroke-width="1"/>
    <image href="${markHref}" x="-27" y="-27" width="54" height="54"/>
    <text x="0" y="52" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="8" font-weight="700" letter-spacing="2" fill="#64748b">VERIFIED</text>
  </g>
  <g font-family="'Segoe UI',Helvetica,Arial,sans-serif">
    <text x="96" y="628" font-size="11" font-weight="700" letter-spacing="1.5" fill="#94a3b8">DATE ISSUED</text>
    <text x="96" y="651" font-size="16" fill="#1e293b">${date}</text>
    <text x="96" y="682" font-size="11" font-weight="700" letter-spacing="1.5" fill="#94a3b8">CREDENTIAL ID</text>
    <text x="96" y="705" font-size="15" font-family="'Consolas','Courier New',monospace" fill="#4338ca">${credId}</text>
  </g>
  <g font-family="'Segoe UI',Helvetica,Arial,sans-serif" text-anchor="end">
    <text x="1024" y="650" font-family="'Segoe Script','Brush Script MT',cursive" font-size="30" fill="#4338ca">ShieldSync</text>
    <line x1="834" y1="666" x2="1024" y2="666" stroke="#cbd5e1" stroke-width="1"/>
    <text x="1024" y="688" font-size="12" fill="#64748b">Issued by ShieldSync Security Labs</text>
  </g>
  <text x="560" y="748" text-anchor="middle" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="11.5" fill="#94a3b8">Verify this credential at ${verify}</text>
  `;
}

function fullCertSvgString(data: CertificateData, markHref: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CERT_W} ${CERT_H}" width="${CERT_W}" height="${CERT_H}">${certSvgInner(
    data,
    markHref
  )}</svg>`;
}

// The mark file is small (an SVG on our own origin) — inline it as a data URI
// so the exported <svg>, when rasterized via an Image element, doesn't need a
// second same-origin fetch mid-canvas-draw (some browsers choke on <image
// href> pointing at a relative path inside a Blob-URL SVG).
async function markAsDataUri(): Promise<string> {
  const r = await fetch("/logo/shieldsync-mark-light.svg");
  const svgText = await r.text();
  const b64 = btoa(unescape(encodeURIComponent(svgText)));
  return `data:image/svg+xml;base64,${b64}`;
}

// Rasterize the full certificate SVG onto a high-DPI canvas. `scale` controls
// output resolution (3x ~= print-quality for an A4 page at this viewBox).
async function renderToCanvas(data: CertificateData, scale = 3): Promise<HTMLCanvasElement> {
  const markHref = await markAsDataUri();
  const svgString = fullCertSvgString(data, markHref);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = CERT_W * scale;
    canvas.height = CERT_H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function slugFile(labTitle: string, ext: string): string {
  const s = labTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `ShieldSync-Certificate-${s || "lab"}.${ext}`;
}

export function Certificate({ data, onClose }: { data: CertificateData; onClose?: () => void }) {
  const [busy, setBusy] = useState<"pdf" | "png" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const verify = useMemo(() => verifyUrl(data.credentialId), [data.credentialId]);

  // Inline preview uses the SAME markup as the export path (just against the
  // real, same-origin /logo/... href instead of a data URI — cheaper on
  // screen since the browser already has it cached from the header/favicon).
  const previewInnerHtml = useMemo(
    () => certSvgInner(data, "/logo/shieldsync-mark-light.svg"),
    [data]
  );

  async function downloadPdf() {
    setBusy("pdf");
    setError(null);
    try {
      const canvas = await renderToCanvas(data, 3);
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const imgData = canvas.toDataURL("image/png", 1.0);
      doc.addImage(imgData, "PNG", 0, 0, pageW, pageH, undefined, "FAST");
      doc.save(slugFile(data.labTitle, "pdf"));
    } catch {
      setError("Couldn't generate the PDF — please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPng() {
    setBusy("png");
    setError(null);
    try {
      const canvas = await renderToCanvas(data, 3);
      const url = canvas.toDataURL("image/png", 1.0);
      const a = document.createElement("a");
      a.href = url;
      a.download = slugFile(data.labTitle, "png");
      a.click();
    } catch {
      setError("Couldn't generate the image — please try again.");
    } finally {
      setBusy(null);
    }
  }

  const linkedInShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verify)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <p className="text-sm font-bold text-ink">Your certificate</p>
          {onClose && (
            <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-lg text-muted hover:bg-canvas hover:text-ink">
              ×
            </button>
          )}
        </div>

        <div className="overflow-auto bg-canvas p-4 sm:p-6">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CERT_W} ${CERT_H}`}
            className="mx-auto w-full max-w-3xl rounded-lg border border-line bg-white shadow-sm"
            role="img"
            aria-label={`ShieldSync certificate of completion for ${data.labTitle}`}
            dangerouslySetInnerHTML={{ __html: previewInnerHtml }}
          />
        </div>

        <div className="border-t border-line px-5 py-4">
          {error && <p className="mb-2 text-sm font-semibold text-[#b91c1c]">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={downloadPdf}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-cyan px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/20 transition hover:brightness-110 disabled:opacity-60"
            >
              {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
            </button>
            <button
              onClick={downloadPng}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-60"
            >
              {busy === "png" ? "Preparing image…" : "Download PNG"}
            </button>
            <a
              href={linkedInShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-[#0a66c2] transition hover:bg-canvas"
            >
              Share on LinkedIn
            </a>
          </div>
          <p className="mt-3 text-xs text-muted">
            Verifiable at <span className="font-mono text-ink-soft">{verify}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
