import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/admin";

/* Admin API for the /admin/blog panel.
 *
 * Blog content lives as git-committed JSON in the MARKETING repo
 * (shieldsync-website, branch main):
 *   - content/blog/<slug>.json   the canonical post source
 *   - lib/blog-extra.json        a DATE-DESC-sorted array the site reads
 *   - public/blog/<slug>.svg     the on-brand cover image
 *
 * There is NO build step on Amplify, so this panel keeps lib/blog-extra.json in
 * sync itself: on create/update it inserts-or-replaces the post by slug then
 * re-sorts by date desc; on delete it removes the slug. Every write is a commit
 * with an author, a diff and a revert. Amplify rebuilds the static export on
 * push, so a save is live in a few minutes. Git stays the source of truth.
 *
 * Setup (one-time): a fine-grained GitHub PAT scoped to shieldsync-website with
 * Contents: Read & Write, then from labs-platform/app:
 *   npx wrangler secret put GITHUB_TOKEN
 * Optional env overrides: GITHUB_OWNER, GITHUB_REPO_MARKETING.
 */

export const dynamic = "force-dynamic";

const GH_API = "https://api.github.com";
const BRANCH = "main";

function cfg() {
  const owner = process.env.GITHUB_OWNER || "shieldsyncsecurity";
  return {
    token: process.env.GITHUB_TOKEN || "",
    owner,
    repo: process.env.GITHUB_REPO_MARKETING || "shieldsync-website",
  };
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "shieldsync-labs-admin",
  };
}

async function ghGetFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
): Promise<{ sha: string | null; content: string | null }> {
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}?ref=${BRANCH}`, {
    headers: ghHeaders(token),
    cache: "no-store",
  });
  if (r.status === 404) return { sha: null, content: null };
  if (!r.ok) throw new Error(`GitHub read ${repo}/${path} failed (${r.status})`);
  const d = (await r.json()) as { sha: string; content: string };
  return { sha: d.sha, content: Buffer.from(d.content, "base64").toString("utf8") };
}

async function ghPutFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
): Promise<string> {
  const { sha } = await ghGetFile(token, owner, repo, path);
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({
      message,
      branch: BRANCH,
      content: Buffer.from(content, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`GitHub write ${repo}/${path} failed (${r.status}): ${body.slice(0, 200)}`);
  }
  const d = (await r.json()) as { commit?: { html_url?: string } };
  return d.commit?.html_url ?? "";
}

async function ghDeleteFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  message: string,
): Promise<string | null> {
  const { sha } = await ghGetFile(token, owner, repo, path);
  if (!sha) return null; // nothing to delete
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ message, branch: BRANCH, sha }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`GitHub delete ${repo}/${path} failed (${r.status}): ${body.slice(0, 200)}`);
  }
  const d = (await r.json()) as { commit?: { html_url?: string } };
  return d.commit?.html_url ?? "";
}

// -- types + validation --------------------------------------------------------
const VALID_T = new Set(["p", "h2", "ul", "code", "callout"]);

type Block =
  | { t: "p"; text: string }
  | { t: "h2"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "code"; code: string }
  | { t: "callout"; text: string };

type Post = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
  read: string;
  image: string;
  body: Block[];
};

function nonEmptyStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validatePost(body: unknown): { ok: true; post: Post } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "post object required" };
  const b = body as Record<string, unknown>;

  const slug = typeof b.slug === "string" ? b.slug.trim() : "";
  if (!/^[a-z0-9-]{1,80}$/.test(slug))
    return { ok: false, error: "slug must be lowercase letters, digits and hyphens (1-80 chars)" };

  if (!nonEmptyStr(b.title)) return { ok: false, error: "title is required" };
  if (!nonEmptyStr(b.excerpt)) return { ok: false, error: "excerpt is required" };
  if (!nonEmptyStr(b.category)) return { ok: false, error: "category is required" };
  if (!nonEmptyStr(b.date)) return { ok: false, error: "date is required" };
  if (!nonEmptyStr(b.read)) return { ok: false, error: "read is required" };

  const dateStr = (b.date as string).trim();
  if (Number.isNaN(new Date(dateStr).getTime()))
    return { ok: false, error: `date "${dateStr}" is not a parseable date (e.g. "Apr 22, 2026")` };

  const title = (b.title as string).trim().slice(0, 160);
  const excerpt = (b.excerpt as string).trim().slice(0, 400);
  const category = (b.category as string).trim();
  const read = (b.read as string).trim();

  const image = nonEmptyStr(b.image) ? (b.image as string).trim() : "";

  if (!Array.isArray(b.body) || b.body.length === 0)
    return { ok: false, error: "body must be a non-empty array" };

  const cleanBody: Block[] = [];
  for (let i = 0; i < b.body.length; i++) {
    const blk = b.body[i];
    if (!blk || typeof blk !== "object")
      return { ok: false, error: `body[${i}] must be an object` };
    const t = (blk as Record<string, unknown>).t;
    if (typeof t !== "string" || !VALID_T.has(t))
      return { ok: false, error: `body[${i}] has invalid t "${String(t)}" (valid: p|h2|ul|code|callout)` };
    if (t === "ul") {
      const items = (blk as Record<string, unknown>).items;
      if (!Array.isArray(items) || items.length === 0)
        return { ok: false, error: `body[${i}] (ul) needs a non-empty items array` };
      const strItems: string[] = [];
      for (const it of items) {
        if (typeof it !== "string") return { ok: false, error: `body[${i}] (ul) items must be strings` };
        strItems.push(it);
      }
      cleanBody.push({ t: "ul", items: strItems });
    } else if (t === "code") {
      const code = (blk as Record<string, unknown>).code;
      if (typeof code !== "string" || !code.trim())
        return { ok: false, error: `body[${i}] (code) needs a non-empty code string` };
      cleanBody.push({ t: "code", code });
    } else {
      // p | h2 | callout
      const text = (blk as Record<string, unknown>).text;
      if (typeof text !== "string" || text.trim().length === 0)
        return { ok: false, error: `body[${i}] (${t}) needs a non-empty text string` };
      cleanBody.push({ t: t as "p" | "h2" | "callout", text });
    }
  }

  return {
    ok: true,
    post: { slug, title, excerpt, category, date: dateStr, read, image, body: cleanBody },
  };
}

// -- cover SVG generator -------------------------------------------------------
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Simple greedy word-wrap to at most `maxLines` lines of ~`maxChars` each.
function wrapTitle(title: string, maxChars: number, maxLines: number): string[] {
  const words = title.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // If words remain (title too long), ellipsize the last line.
  const used = lines.join(" ").split(" ").length;
  if (used < words.length && lines.length > 0) {
    let last = lines[lines.length - 1];
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1);
    lines[lines.length - 1] = last + "...";
  }
  return lines;
}

function coverSvg({ title, category }: { title: string; category: string }): string {
  const W = 1200;
  const H = 675;
  const lines = wrapTitle(title, 26, 3);
  const fontSize = lines.length >= 3 ? 66 : lines.length === 2 ? 76 : 86;
  const lineHeight = fontSize * 1.18;
  const blockH = lines.length * lineHeight;
  const startY = H / 2 - blockH / 2 + fontSize * 0.8;

  const grid: string[] = [];
  for (let x = 60; x < W; x += 60) {
    grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" />`);
  }
  for (let y = 60; y < H; y += 60) {
    grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" />`);
  }

  const titleTspans = lines
    .map((ln, i) => `<tspan x="80" y="${Math.round(startY + i * lineHeight)}">${xmlEscape(ln)}</tspan>`)
    .join("");

  const cat = xmlEscape(category.toUpperCase());

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#4f46e5"/>` +
    `<stop offset="1" stop-color="#312e81"/>` +
    `</linearGradient>` +
    `<radialGradient id="glow" cx="0.28" cy="0.22" r="0.9">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
    `<g stroke="#ffffff" stroke-width="1" opacity="0.07">${grid.join("")}</g>` +
    `<rect width="${W}" height="${H}" fill="url(#glow)"/>` +
    `<text x="80" y="96" fill="#c7d2fe" font-family="Arial, Helvetica, sans-serif" ` +
    `font-size="30" font-weight="700" letter-spacing="4">${cat}</text>` +
    `<text fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" ` +
    `font-weight="800">${titleTspans}</text>` +
    `<text x="80" y="${H - 60}" fill="#e0e7ff" font-family="Arial, Helvetica, sans-serif" ` +
    `font-size="28" font-weight="700">ShieldSync Security</text>` +
    `</svg>` +
    `\n`
  );
}

// -- handlers ------------------------------------------------------------------
export async function GET(req: Request) {
  const user = await getServerUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  const admin = user!.id.slice(0, 8);

  const { token, owner, repo } = cfg();
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");

  if (!token) {
    return NextResponse.json({
      configured: false,
      admin,
      posts: [],
      note: "GITHUB_TOKEN not configured on the Worker - cannot read the marketing repo.",
    });
  }

  // Single-post source fetch.
  if (slug) {
    if (!/^[a-z0-9-]{1,80}$/.test(slug))
      return NextResponse.json({ error: "invalid slug" }, { status: 400 });
    try {
      const { content } = await ghGetFile(token, owner, repo, `content/blog/${slug}.json`);
      if (content == null) return NextResponse.json({ error: "not found", admin }, { status: 404 });
      return NextResponse.json({ configured: true, admin, post: JSON.parse(content) });
    } catch (e) {
      return NextResponse.json(
        { admin, error: e instanceof Error ? e.message : "GitHub read failed" },
        { status: 502 },
      );
    }
  }

  // List: the merged array the site reads.
  try {
    const { content } = await ghGetFile(token, owner, repo, "lib/blog-extra.json");
    const posts = content ? (JSON.parse(content) as unknown[]) : [];
    return NextResponse.json({ configured: true, admin, posts });
  } catch (e) {
    return NextResponse.json(
      { configured: true, admin, error: e instanceof Error ? e.message : "GitHub read failed", posts: [] },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const user = await getServerUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  const admin = user!.id.slice(0, 8);

  const { token, owner, repo } = cfg();
  if (!token)
    return NextResponse.json({ error: "GITHUB_TOKEN not configured on the Worker" }, { status: 503 });

  const raw = await req.json().catch(() => null);
  const v = validatePost(raw);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const post = v.post;

  const commits: string[] = [];
  const message = `blog: save "${post.slug}" via /admin/blog (by ${admin})`;

  try {
    // (3-pre) Decide whether we need to generate a cover. Do this before writing
    // the source JSON so post.image reflects the final path.
    const existing = await ghGetFile(token, owner, repo, `content/blog/${post.slug}.json`);
    let existingImage = "";
    if (existing.content) {
      try {
        const parsed = JSON.parse(existing.content) as { image?: unknown };
        if (typeof parsed.image === "string") existingImage = parsed.image;
      } catch {
        /* ignore malformed existing source */
      }
    }

    const svgPath = `public/blog/${post.slug}.svg`;

    // When the post uses OUR generated cover (no image supplied, or the image is
    // already our /blog/<slug>.svg), (re)generate the SVG on every save so the
    // title baked into the cover always matches the current title — this also
    // fixes a stale cover after a rename. Legacy .webp covers are left untouched.
    const usesSvgCover = !post.image || post.image === `/blog/${post.slug}.svg`;
    if (usesSvgCover) post.image = `/blog/${post.slug}.svg`;
    const needCover = usesSvgCover;
    void existingImage;

    // (1) Commit the canonical source JSON (pretty).
    const sourceUrl = await ghPutFile(
      token,
      owner,
      repo,
      `content/blog/${post.slug}.json`,
      JSON.stringify(post, null, 2) + "\n",
      message,
    );
    if (sourceUrl) commits.push(sourceUrl);

    // (2) Read + parse the merged array, insert-or-replace by slug, sort desc.
    // CRITICAL: only start from an empty array when the file genuinely does not
    // exist (first-ever post). If it EXISTS but is unparseable/not-an-array,
    // ABORT — starting fresh here would overwrite the entire blog index with a
    // single post. A corrupt index is a fix-it-in-git situation, not a rewrite.
    const extra = await ghGetFile(token, owner, repo, "lib/blog-extra.json");
    let arr: Post[] = [];
    if (extra.content !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extra.content);
      } catch {
        throw new Error(
          "lib/blog-extra.json is not valid JSON — aborting so the blog index is not overwritten. Fix the file in Git first.",
        );
      }
      if (!Array.isArray(parsed)) {
        throw new Error("lib/blog-extra.json is not an array — aborting to avoid data loss.");
      }
      arr = parsed as Post[];
    }
    arr = arr.filter((p) => p && p.slug !== post.slug);
    arr.push(post);
    arr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const extraUrl = await ghPutFile(
      token,
      owner,
      repo,
      "lib/blog-extra.json",
      JSON.stringify(arr, null, 2) + "\n",
      message,
    );
    if (extraUrl) commits.push(extraUrl);

    // (3) Generate + commit the cover if needed.
    let coverNote = "";
    if (needCover) {
      const svg = coverSvg({ title: post.title, category: post.category });
      const coverUrl = await ghPutFile(token, owner, repo, svgPath, svg, message);
      if (coverUrl) commits.push(coverUrl);
      coverNote = " Generated an on-brand cover SVG.";
    }

    return NextResponse.json({
      ok: true,
      commits,
      note: `Saved "${post.slug}" to the marketing repo.${coverNote} Amplify is rebuilding; live in a few minutes.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "GitHub write failed", commits },
      { status: 502 },
    );
  }
}

export async function DELETE(req: Request) {
  const user = await getServerUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });
  const admin = user!.id.slice(0, 8);

  const { token, owner, repo } = cfg();
  if (!token)
    return NextResponse.json({ error: "GITHUB_TOKEN not configured on the Worker" }, { status: 503 });

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") || "";
  if (!/^[a-z0-9-]{1,80}$/.test(slug))
    return NextResponse.json({ error: "invalid or missing slug" }, { status: 400 });

  const commits: string[] = [];
  const message = `blog: delete "${slug}" via /admin/blog (by ${admin})`;

  try {
    // (1) Delete the canonical source (if present).
    const srcUrl = await ghDeleteFile(token, owner, repo, `content/blog/${slug}.json`, message);
    if (srcUrl) commits.push(srcUrl);

    // (2) Remove the slug from the merged array.
    const extra = await ghGetFile(token, owner, repo, "lib/blog-extra.json");
    if (extra.content !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extra.content);
      } catch {
        throw new Error(
          "lib/blog-extra.json is not valid JSON — aborting the delete so the index is not corrupted. Fix it in Git first.",
        );
      }
      if (!Array.isArray(parsed)) throw new Error("lib/blog-extra.json is not an array — aborting.");
      const arr = parsed as Post[];
      const next = arr.filter((p) => p && p.slug !== slug);
      if (next.length !== arr.length) {
        const extraUrl = await ghPutFile(
          token,
          owner,
          repo,
          "lib/blog-extra.json",
          JSON.stringify(next, null, 2) + "\n",
          message,
        );
        if (extraUrl) commits.push(extraUrl);
      }
    }

    // (3) Best-effort delete the generated cover.
    try {
      const coverUrl = await ghDeleteFile(token, owner, repo, `public/blog/${slug}.svg`, message);
      if (coverUrl) commits.push(coverUrl);
    } catch {
      /* best-effort: an absent or .webp-only cover is fine */
    }

    return NextResponse.json({
      ok: true,
      commits,
      note: `Deleted "${slug}" from the marketing repo. Amplify is rebuilding.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "GitHub delete failed", commits },
      { status: 502 },
    );
  }
}
