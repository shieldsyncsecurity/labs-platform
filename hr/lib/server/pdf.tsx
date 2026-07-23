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
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** Build the self-contained HTML for an issued snapshot (no toolbar, inlined images). */
export async function buildIssuedHtml(req: Request, seq: string, genId: string): Promise<{ html: string; gen: Gen }> {
  const gen = (await hrFetch<{ gen: Gen }>(`/hr/employees/${encodeURIComponent(seq)}/generated/${encodeURIComponent(genId)}`)).gen;

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

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
  return { html, gen };
}

/** Render an issued document to PDF bytes. Throws PdfUnavailableError without the binding. */
export async function buildIssuedPdf(req: Request, seq: string, genId: string): Promise<{ pdf: Uint8Array; gen: Gen }> {
  const { html, gen } = await buildIssuedHtml(req, seq, genId);

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
    const pdf = await page.pdf({ format: "a4", printBackground: true, preferCSSPageSize: true });
    return { pdf: new Uint8Array(pdf), gen };
  } finally {
    await browser.close();
  }
}

/** Filesystem-safe filename for an issued document. */
export function pdfFileName(gen: Gen): string {
  const base = (gen.ref || gen.title || gen.docId).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `shieldsync-${gen.docType}-${base || "document"}.pdf`;
}
