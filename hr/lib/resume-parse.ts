// Best-effort resume import: pull raw text out of a PDF or DOCX, then guess at
// name/email/phone with regex heuristics. This is NOT a resume parser in the
// "AI extraction" sense — no LLM is involved, nothing here understands resume
// structure. It is deliberately narrow: three fields, always shown to the HR
// user for review before they save anything, never auto-submitted.
//
// Edge-runtime safe on purpose (this route runs on Cloudflare Workers, not a
// Node server): `unpdf` for PDF text (built for edge/serverless), `jszip` +
// a plain regex over word/document.xml for DOCX (avoids heavier parsers like
// mammoth that assume a Node filesystem).

import JSZip from "jszip";

export type ParsedResumeFields = {
  name?: string;
  email?: string;
  phone?: string;
};

const MAX_RESUME_BYTES = 8 * 1024 * 1024; // resumes run larger than KYC scans (photos, formatting)
export const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

export { MAX_RESUME_BYTES };

/** Magic-byte sniff — mirrors lib/kyc.ts's rule: never trust the declared type. */
export function sniffResumeType(bytes: Uint8Array): "application/pdf" | "docx" | null {
  if (bytes.length >= 5 && new TextDecoder("latin1").decode(bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  // .docx is a ZIP; ZIP local-file headers start with "PK\x03\x04" (or the
  // empty-archive variant "PK\x05\x06"). Good enough to distinguish from junk —
  // full docx validity is proven by JSZip successfully unzipping it below.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) return "docx";
  return null;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractTextItems } = await import("unpdf");
  // extractText({mergePages:true}) flattens everything to ONE space-joined
  // line with no line breaks at all — useless for "first line is the name"
  // heuristics below. extractTextItems gives positioned items instead, so
  // reconstruct real lines by grouping items whose Y coordinate is close
  // (same visual line), the standard approach for pdf.js-based extraction.
  const { items } = await extractTextItems(bytes);
  const lines: string[] = [];
  for (const page of items) {
    let curY: number | null = null;
    let curLine: string[] = [];
    // pdf.js Y origin is bottom-left and items typically arrive in reading
    // order already; a same-line item's Y differs from the previous one by
    // less than roughly a text-height's worth of jitter.
    for (const it of page) {
      if (!it.str) continue;
      if (curY === null || Math.abs(it.y - curY) > Math.max(2, it.height * 0.5)) {
        if (curLine.length) lines.push(curLine.join(""));
        curLine = [];
        curY = it.y;
      }
      curLine.push(it.str);
    }
    if (curLine.length) lines.push(curLine.join(""));
  }
  return lines.join("\n");
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  // Split on paragraph boundaries FIRST, then join each paragraph's text runs
  // with "" and paragraphs with "\n". Doing the newline insertion as a find/
  // replace over the raw XML (the original approach) silently failed — the
  // inserted "\n" lands between tags, never inside a <w:t> run, so the later
  // "pull only <w:t> content" pass discarded it and every paragraph ran
  // together on one line (corrupting the name and email heuristics below).
  const paragraphs = xml.split(/<w:p[ >]/).slice(1); // [0] is pre-first-paragraph document header
  const lines = paragraphs.map((chunk) => [...chunk.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
  return lines.filter(Boolean).join("\n");
}

export async function extractResumeText(bytes: Uint8Array): Promise<string> {
  const kind = sniffResumeType(bytes);
  if (kind === "application/pdf") return extractPdfText(bytes);
  if (kind === "docx") return extractDocxText(bytes);
  throw new Error("UNSUPPORTED_TYPE");
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Indian mobile: optional +91/91/0 prefix, then a 10-digit number starting
// 6-9. Resumes commonly format the number as two 5-digit groups with a space
// or hyphen in the middle ("98765 43210") — the digit group tolerates that.
const PHONE_RE = /(?:\+?91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})\b/;

const NOISE_LINE = /^(resume|curriculum vitae|cv|bio[- ]?data)$/i;

/**
 * Name heuristic: resumes overwhelmingly put the candidate's name as the very
 * first non-empty line (often larger/bold text, which strips to plain text
 * here). Skip lines that are clearly not a name — the doc title, an email, a
 * phone number, or a line that's mostly non-letters. Wrong often enough on
 * unusual layouts that this is always shown to the HR user for correction,
 * never trusted blindly.
 */
function guessName(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (NOISE_LINE.test(line)) continue;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) continue;
    if (line.length < 2 || line.length > 60) continue;
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters < line.length * 0.6) continue; // mostly symbols/numbers — not a name
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 5) continue;
    return line.replace(/\s+/g, " ").trim();
  }
  return undefined;
}

export function guessFieldsFromResumeText(text: string): ParsedResumeFields {
  const email = text.match(EMAIL_RE)?.[0];
  const phoneMatch = text.match(PHONE_RE);
  const phone = phoneMatch ? phoneMatch[1].replace(/[\s-]/g, "") : undefined;
  const name = guessName(text);
  return {
    name,
    email: email?.toLowerCase(),
    phone: phone ? `+91 ${phone}` : undefined,
  };
}
