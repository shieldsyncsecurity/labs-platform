// Dependency-free single-file text PDF writer (sprint W3-6).
//
// Produces a valid multi-page PDF 1.4 using ONLY the standard-14 fonts
// Helvetica / Helvetica-Bold (WinAnsiEncoding), so nothing is embedded and
// the output stays tiny. Layout rules:
// - A4 pages (595.28 x 841.89 pt), 56pt margins.
// - Body text 11pt Helvetica with word-wrap against real AFM glyph widths.
// - Lines starting with "# " render as bold 14pt section heads.
// - Footer on EVERY page: "SHA-256: <hash>" (left) + "Page N of M" (right).
// - Input is sanitized to ASCII first (curly quotes -> straight, em/en dash
//   -> "--", rupee -> "INR", anything else non-ASCII -> "?"), and ( ) \ are
//   escaped in content streams.
//
// Runs on the Workers runtime (OpenNext) and Node alike: no Buffer, no fs,
// no crypto -- the caller supplies the hash. Pure string/byte assembly.

export type TextPdfInput = {
  /** Document title -- rendered bold at the top of page 1 and set as /Title. */
  title: string;
  /** Plain-text body. "\n"-separated; "# " prefix marks a section head. */
  bodyText: string;
  /** Hex SHA-256 of the canonical body -- printed in every page footer. */
  hash: string;
};

// --- Page geometry ----------------------------------------------------------

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_TOP = PAGE_HEIGHT - MARGIN;
const CONTENT_BOTTOM = MARGIN;

const BODY_SIZE = 11;
const BODY_LEADING = 15;
const HEAD_SIZE = 14;
const HEAD_LEADING = 19;
const HEAD_SPACE_BEFORE = 8;
const HEAD_SPACE_AFTER = 3;
const TITLE_SIZE = 16;
const TITLE_LEADING = 21;
const BLANK_LINE_ADVANCE = 8;
const FOOTER_SIZE = 7.5;
const FOOTER_Y = 32;

// --- AFM glyph widths (thousandths of an em) for ASCII 32..126 --------------
// Source: Adobe Core 14 AFM files for Helvetica / Helvetica-Bold. Input is
// sanitized to this exact range, so the tables are complete for our purposes.

// prettier-ignore
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// prettier-ignore
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

type FontName = "F1" | "F2"; // F1 = Helvetica, F2 = Helvetica-Bold

function textWidth(text: string, font: FontName, size: number): number {
  const widths = font === "F2" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    total += code >= 32 && code <= 126 ? widths[code - 32] : widths[0];
  }
  return (total / 1000) * size;
}

// --- Sanitization / escaping -------------------------------------------------

/**
 * Force arbitrary text down to the printable-ASCII range the width tables and
 * WinAnsi text streams are built for. Exported so callers (e.g. the print
 * view) can show exactly what the PDF will contain.
 */
export function sanitizeToAscii(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019\u02BC]/g, "'") // curly/modifier apostrophes
    .replace(/[\u201C\u201D]/g, '"') // curly double quotes
    .replace(/[\u2013\u2014]/g, "--") // en/em dash
    .replace(/\u20B9/g, "INR ") // rupee sign
    .replace(/\u2026/g, "...") // ellipsis
    .replace(/[\u00A0\u2000-\u200B]/g, " ") // nbsp / unicode spaces / zwsp
    .replace(/\u2022/g, "-") // bullet
    .replace(/\t/g, "    ")
    .replace(/[^\n\x20-\x7E]/g, "?");
}

/** Escape the three characters with meaning inside PDF literal strings. */
function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// --- Word wrap ----------------------------------------------------------------

function wrapLine(line: string, font: FontName, size: number, maxWidth: number): string[] {
  if (line === "") return [""];
  const words = line.split(" ");
  const out: string[] = [];
  let current = "";

  const pushWord = (word: string) => {
    const candidate = current === "" ? word : current + " " + word;
    if (textWidth(candidate, font, size) <= maxWidth) {
      current = candidate;
      return;
    }
    if (current !== "") {
      out.push(current);
      current = "";
    }
    // Word alone still too wide (URLs, hashes): hard-split by characters.
    let chunk = "";
    for (const ch of word) {
      if (textWidth(chunk + ch, font, size) > maxWidth && chunk !== "") {
        out.push(chunk);
        chunk = "";
      }
      chunk += ch;
    }
    current = chunk;
  };

  for (const word of words) pushWord(word);
  if (current !== "") out.push(current);
  return out.length > 0 ? out : [""];
}

// --- Layout -------------------------------------------------------------------

type PlacedLine = {
  font: FontName;
  size: number;
  x: number;
  y: number;
  text: string;
};

type LayoutPage = { lines: PlacedLine[] };

function layout(title: string, bodyText: string): LayoutPage[] {
  const pages: LayoutPage[] = [];
  let page: LayoutPage = { lines: [] };
  let y = CONTENT_TOP;

  const newPage = () => {
    pages.push(page);
    page = { lines: [] };
    y = CONTENT_TOP;
  };

  const place = (text: string, font: FontName, size: number, leading: number) => {
    // Baseline sits `size` below the running cursor; break first if the line
    // would land under the bottom margin.
    if (y - leading < CONTENT_BOTTOM) newPage();
    y -= leading;
    if (text !== "") {
      page.lines.push({ font, size, x: MARGIN, y, text });
    }
  };

  // Title block (page 1).
  for (const seg of wrapLine(title, "F2", TITLE_SIZE, CONTENT_WIDTH)) {
    place(seg, "F2", TITLE_SIZE, TITLE_LEADING);
  }
  y -= 10;

  for (const rawLine of bodyText.split("\n")) {
    if (rawLine.trim() === "") {
      y -= BLANK_LINE_ADVANCE;
      continue;
    }
    if (rawLine.startsWith("# ")) {
      y -= HEAD_SPACE_BEFORE;
      const headText = rawLine.slice(2).trim();
      for (const seg of wrapLine(headText, "F2", HEAD_SIZE, CONTENT_WIDTH)) {
        place(seg, "F2", HEAD_SIZE, HEAD_LEADING);
      }
      y -= HEAD_SPACE_AFTER;
      continue;
    }
    for (const seg of wrapLine(rawLine, "F1", BODY_SIZE, CONTENT_WIDTH)) {
      place(seg, "F1", BODY_SIZE, BODY_LEADING);
    }
  }

  pages.push(page);
  return pages;
}

// --- PDF assembly ---------------------------------------------------------------

function buildContentStream(page: LayoutPage, pageNo: number, pageCount: number, hash: string): string {
  const parts: string[] = [];
  for (const line of page.lines) {
    parts.push(
      `BT /${line.font} ${line.size} Tf ${line.x.toFixed(2)} ${line.y.toFixed(2)} Td (${escapePdfText(line.text)}) Tj ET`,
    );
  }

  // Footer: hash left, page number right, muted gray.
  const footerLeft = `SHA-256: ${hash}`;
  const footerRight = `Page ${pageNo} of ${pageCount}`;
  const rightX = PAGE_WIDTH - MARGIN - textWidth(footerRight, "F1", FOOTER_SIZE);
  parts.push(
    `0.45 g BT /F1 ${FOOTER_SIZE} Tf ${MARGIN} ${FOOTER_Y} Td (${escapePdfText(footerLeft)}) Tj ET`,
    `BT /F1 ${FOOTER_SIZE} Tf ${rightX.toFixed(2)} ${FOOTER_Y} Td (${escapePdfText(footerRight)}) Tj ET 0 g`,
  );

  return parts.join("\n");
}

/**
 * Build a complete PDF file for `title` + `bodyText`, with `hash` printed in
 * every footer. All input is sanitized to ASCII internally; the returned
 * bytes are a standalone application/pdf payload.
 */
export function buildTextPdf(input: TextPdfInput): Uint8Array {
  const title = sanitizeToAscii(input.title).replace(/\n/g, " ").trim() || "Document";
  const bodyText = sanitizeToAscii(input.bodyText);
  const hash = sanitizeToAscii(input.hash).replace(/\n/g, " ").trim() || "unavailable";

  const pages = layout(title, bodyText);
  const pageCount = pages.length;

  // Object numbering:
  //   1 Catalog, 2 Pages, 3 /F1 Helvetica, 4 /F2 Helvetica-Bold,
  //   then per page i (0-based): 5+2i = Page, 6+2i = Contents.
  const objects: string[] = [];
  const pageObjNums: number[] = [];
  for (let i = 0; i < pageCount; i++) pageObjNums.push(5 + 2 * i);

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects[2] =
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] ` +
    `/Count ${pageCount} >>\nendobj\n`;
  objects[3] =
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ` +
    `/Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[4] =
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold ` +
    `/Encoding /WinAnsiEncoding >>\nendobj\n`;

  pages.forEach((page, i) => {
    const pageNum = 5 + 2 * i;
    const contentNum = pageNum + 1;
    objects[pageNum] =
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
      `/Contents ${contentNum} 0 R >>\nendobj\n`;
    const stream = buildContentStream(page, i + 1, pageCount, hash);
    objects[contentNum] =
      `${contentNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  });

  const infoNum = 5 + 2 * pageCount;
  objects[infoNum] =
    `${infoNum} 0 obj\n<< /Title (${escapePdfText(title)}) ` +
    `/Producer (ShieldSync text-pdf) >>\nendobj\n`;

  // Assemble with byte-accurate xref offsets. Everything is ASCII, so string
  // length === byte length; offsets are still accumulated defensively.
  const header = `%PDF-1.4\n`;
  let body = "";
  const offsets: number[] = [];
  for (let n = 1; n <= infoNum; n++) {
    offsets[n] = header.length + body.length;
    body += objects[n];
  }

  const xrefOffset = header.length + body.length;
  const objCount = infoNum + 1;
  let xref = `xref\n0 ${objCount}\n0000000000 65535 f \n`;
  for (let n = 1; n <= infoNum; n++) {
    xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objCount} /Root 1 0 R /Info ${infoNum} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  const full = header + body + xref + trailer;
  const bytes = new Uint8Array(full.length);
  for (let i = 0; i < full.length; i++) {
    bytes[i] = full.charCodeAt(i) & 0xff;
  }
  return bytes;
}
