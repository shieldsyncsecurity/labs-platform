// Server-side PDF of an ISSUED document via Cloudflare Browser Rendering.
// Renders the archived snapshot through the same components as the screen,
// inlines the brand images as data URIs (the /sealed assets are auth-gated, so
// the headless browser can't fetch them itself), and prints to A4 with
// backgrounds. Production-only (needs the BROWSER binding); dev throws
// PdfUnavailableError and callers fall back to the manual print path.
import "server-only";
import { hrFetch } from "./hr-engine";
import { renderIssued } from "@/lib/render-issued";

export class PdfUnavailableError extends Error {
  constructor() {
    super("Server-side PDF needs the Cloudflare Browser Rendering binding (production only).");
    this.name = "PdfUnavailableError";
  }
}

type Gen = { docId: string; docType: string; title: string; ref: string; snapshot: unknown };

/** Fetch a same-origin asset (forwarding the caller's cookie for /sealed/*)
 * and return it as a data URI. */
async function assetDataUri(origin: string, path: string, cookie: string): Promise<string> {
  const r = await fetch(`${origin}${path}`, { headers: { cookie } });
  if (!r.ok) throw new Error(`asset ${path} -> ${r.status}`);
  // fetch FOLLOWS redirects, so an auth failure on /sealed/* arrives here as a
  // 200 HTML login page — which then got base64-wrapped as a PNG and produced a
  // PDF with a broken signature image and no error anywhere. Verify the content
  // type so that can only ever fail loudly.
  const type = r.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) {
    throw new Error(`asset ${path} returned ${type || "no content-type"} — expected an image (auth redirect?)`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** Build the self-contained HTML for an issued snapshot (no toolbar, inlined images). */
export async function buildIssuedHtml(req: Request, seq: string, genId: string): Promise<{ html: string; gen: Gen; employeeName?: string }> {
  const gen = (await hrFetch<{ gen: Gen }>(`/hr/employees/${encodeURIComponent(seq)}/generated/${encodeURIComponent(genId)}`)).gen;
  // Best-effort: an employee can be deleted after a document was issued —
  // the PDF must still render (from the archived snapshot), just without a
  // name-based filename in that edge case.
  let employeeName: string | undefined;
  try {
    employeeName = (await hrFetch<{ employee: { name: string } }>(`/hr/employees/${encodeURIComponent(seq)}`)).employee.name;
  } catch {
    /* fall through with undefined */
  }

  const el = renderIssued(gen.docType, gen.snapshot);
  if (!el) throw new Error(`unknown docType ${gen.docType}`);
  // Route-handler-safe SSR: the doc components are pure server-renderable views.
  const { renderToStaticMarkup } = await import("react-dom/server");
  let markup = renderToStaticMarkup(el);

  const origin = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";
  const assets: Array<[string, string]> = [
    ["/brand/cipher-s-mark.png", await assetDataUri(origin, "/brand/cipher-s-mark.png", cookie)],
    ["/sealed/company-seal.png", await assetDataUri(origin, "/sealed/company-seal.png", cookie)],
    ["/sealed/authorised-signature.png", await assetDataUri(origin, "/sealed/authorised-signature.png", cookie)],
  ];
  for (const [path, uri] of assets) markup = markup.split(`src="${path}"`).join(`src="${uri}"`);

  // buildIssuedPdf forces `screen` media (not `print`) so the internship
  // letter's watermark survives into the downloadable PDF — see the comment
  // there. But .ss-stage/.ss-sheet's gray "paper on a desk" backdrop is ALSO
  // only stripped by the @media print rule, so forcing screen media brought
  // the gray staging chrome along with it (a dark border around every PDF).
  // These two overrides are the staging-only half of that print rule, applied
  // unconditionally here — deliberately NOT touching .ss-watermark, which is
  // the one thing that print rule does that this PDF path still wants.
  // Margin is applied per-page via page.pdf({ margin }) below, NOT as CSS
  // padding here — a `.ss-sheet` padding value only shows up at the very top
  // and bottom of the whole flowed block, so a letter that spans more than
  // one physical page gets full margins on page 1 and the last page but
  // content flush to the paper edge on every page in between. Puppeteer's
  // own margin option is repeated on EVERY page, so this must be 0 for PDF.
  const style = `.ss-stage{background:#fff!important;padding:0!important}.ss-sheet{box-shadow:none!important;margin:0!important;max-width:none!important;border-radius:0!important;padding:0!important}.ss-noprint{display:none!important}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}${style}</style></head><body>${markup}</body></html>`;
  return { html, gen, employeeName };
}

/** Render an issued document to PDF bytes. Throws PdfUnavailableError without the binding. */
export async function buildIssuedPdf(req: Request, seq: string, genId: string): Promise<{ pdf: Uint8Array; gen: Gen; employeeName?: string }> {
  const { html, gen, employeeName } = await buildIssuedHtml(req, seq, genId);

  let browserBinding: unknown;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    browserBinding = (getCloudflareContext().env as Record<string, unknown>).BROWSER;
  } catch {
    browserBinding = undefined;
  }
  if (!browserBinding) throw new PdfUnavailableError();

  const puppeteer = (await import("@cloudflare/puppeteer")).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser = await puppeteer.launch(browserBinding as any);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Puppeteer's page.pdf() defaults to emulating 'print' media (same as a
    // real printer) — which would silently strip the offer letter's @media
    // print watermark rule, the OPPOSITE of intended: this "Download PDF" path
    // is the online/digital copy and must keep the watermark. Force 'screen'.
    await page.emulateMediaType("screen");
    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "22mm", bottom: "22mm", left: "18mm", right: "18mm" },
    });
    return { pdf: new Uint8Array(pdf), gen, employeeName };
  } finally {
    await browser.close();
  }
}

/** Doc titles are stored ALL CAPS (correct for a printed letterhead heading)
 * — this converts one to Title Case for contexts where shouting reads wrong,
 * like an email subject line. Small words stay lowercase unless they're
 * first, matching normal title-case convention. */
export function humanizeTitle(title: string): string {
  const small = new Set(["of", "and", "the", "for", "in", "on", "a", "an", "to"]);
  return title
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Filesystem-safe filename matching the company's own real naming convention
 * (e.g. "ShieldSync_Leave_Approval_Diya_Jain.pdf") rather than a lowercase-
 * hyphenated ref slug. */
export function pdfFileName(gen: Gen, employeeName?: string): string {
  const titleWords = (gen.title || gen.docType)
    .replace(/&/g, "and")
    .replace(/[^A-Za-z0-9\s]+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("_");
  const nameWords = (employeeName ?? "")
    .replace(/[^A-Za-z\s]+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("_");
  const parts = ["ShieldSync", titleWords, nameWords].filter(Boolean);
  return `${parts.join("_") || "ShieldSync_Document"}.pdf`;
}
