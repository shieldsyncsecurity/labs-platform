import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/admin";
import { LABS } from "@/lib/labs";
import bundled from "../../../../lab-settings.json";

/* Admin API for the /admin/labs settings panel.
 *
 * The settings live as a git-committed JSON file in BOTH repos (canonical:
 * labs-platform app/lab-settings.json; mirror: shieldsync-website
 * lib/lab-settings.json). Saving here commits the new version to both repos
 * via the GitHub Contents API — CI (deploy-labs.yml + Amplify) then rebuilds
 * both sites, so a save is live in ~5–10 minutes. Git stays the source of
 * truth: every change has an author, a diff, and a revert.
 *
 * Setup (one-time): create a fine-grained GitHub PAT scoped to the two repos
 * with Contents: Read & Write, then from labs-platform/app:
 *   npx wrangler secret put GITHUB_TOKEN
 * Optional env overrides: GITHUB_OWNER, GITHUB_REPO_LABS, GITHUB_REPO_MARKETING.
 */

export const dynamic = "force-dynamic";

const GH_API = "https://api.github.com";

type Target = { repo: string; branch: string; path: string };

function cfg() {
  const owner = process.env.GITHUB_OWNER || "shieldsyncsecurity";
  return {
    token: process.env.GITHUB_TOKEN || "",
    owner,
    canonical: {
      repo: process.env.GITHUB_REPO_LABS || "labs-platform",
      branch: "master",
      path: "app/lab-settings.json",
    } as Target,
    mirror: {
      repo: process.env.GITHUB_REPO_MARKETING || "shieldsync-website",
      branch: "main",
      path: "lib/lab-settings.json",
    } as Target,
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

async function ghGetFile(token: string, owner: string, t: Target): Promise<{ sha: string | null; content: string | null }> {
  const r = await fetch(`${GH_API}/repos/${owner}/${t.repo}/contents/${t.path}?ref=${t.branch}`, {
    headers: ghHeaders(token),
    cache: "no-store",
  });
  if (r.status === 404) return { sha: null, content: null };
  if (!r.ok) throw new Error(`GitHub read ${t.repo}/${t.path} failed (${r.status})`);
  const d = (await r.json()) as { sha: string; content: string };
  return { sha: d.sha, content: Buffer.from(d.content, "base64").toString("utf8") };
}

async function ghPutFile(
  token: string,
  owner: string,
  t: Target,
  content: string,
  message: string,
): Promise<string> {
  const { sha } = await ghGetFile(token, owner, t);
  const r = await fetch(`${GH_API}/repos/${owner}/${t.repo}/contents/${t.path}`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({
      message,
      branch: t.branch,
      content: Buffer.from(content, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`GitHub write ${t.repo}/${t.path} failed (${r.status}): ${body.slice(0, 200)}`);
  }
  const d = (await r.json()) as { commit?: { html_url?: string } };
  return d.commit?.html_url ?? "";
}

// ── validation ────────────────────────────────────────────────────────────────
type Setting = { priceINR: number | null; priceUSD: number | null; keywords: string[]; live: boolean | null; free: boolean | null };

function validate(body: unknown): { ok: true; labs: Record<string, Setting> } | { ok: false; error: string } {
  const catalogSlugs = new Set(LABS.map((l) => l.slug));
  const labsIn = (body as { labs?: unknown })?.labs;
  if (!labsIn || typeof labsIn !== "object") return { ok: false, error: "labs object required" };
  const out: Record<string, Setting> = {};
  for (const [slug, v] of Object.entries(labsIn as Record<string, Partial<Setting>>)) {
    if (!catalogSlugs.has(slug)) return { ok: false, error: `unknown lab slug: ${slug}` };
    const inr = v.priceINR;
    const usd = v.priceUSD;
    if (inr != null && (typeof inr !== "number" || !Number.isFinite(inr) || inr < 0 || inr > 100000))
      return { ok: false, error: `${slug}: priceINR must be 0–100000 rupees or empty` };
    if (usd != null && (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0 || usd > 2000))
      return { ok: false, error: `${slug}: priceUSD must be 0–2000 dollars or empty` };
    const kw = Array.isArray(v.keywords) ? v.keywords : [];
    if (kw.length > 12) return { ok: false, error: `${slug}: max 12 keywords` };
    const cleaned: string[] = [];
    for (const k of kw) {
      if (typeof k !== "string") return { ok: false, error: `${slug}: keywords must be strings` };
      const t = k.trim();
      if (!t) continue;
      if (t.length > 40) return { ok: false, error: `${slug}: keyword too long (max 40 chars)` };
      if (!/^[\w &/+.'()-]+$/.test(t)) return { ok: false, error: `${slug}: keyword "${t}" has unsupported characters` };
      cleaned.push(t);
    }
    out[slug] = {
      priceINR: inr == null ? null : Math.round(inr),
      priceUSD: usd == null ? null : Math.round(usd * 100) / 100,
      keywords: cleaned,
      live: typeof v.live === "boolean" ? v.live : null,
      free: typeof v.free === "boolean" ? v.free : null,
    };
  }
  return { ok: true, labs: out };
}

const README =
  (bundled as { _readme?: string })._readme ??
  "Per-lab settings overrides — see /admin/labs. Canonical: labs-platform/app/lab-settings.json; mirror: shieldsync-website/lib/lab-settings.json.";

// ── handlers ──────────────────────────────────────────────────────────────────
export async function GET() {
  const user = await getServerUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });

  const { token, owner, canonical } = cfg();
  if (!token) {
    // Not configured yet — serve the build-time bundled copy so the panel still renders.
    return NextResponse.json({ configured: false, settings: (bundled as { labs?: object }).labs ?? {} });
  }
  try {
    const { content } = await ghGetFile(token, owner, canonical);
    const parsed = content ? (JSON.parse(content) as { labs?: object }) : null;
    return NextResponse.json({ configured: true, settings: parsed?.labs ?? (bundled as { labs?: object }).labs ?? {} });
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: e instanceof Error ? e.message : "GitHub read failed", settings: (bundled as { labs?: object }).labs ?? {} },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const user = await getServerUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });

  const { token, owner, canonical, mirror } = cfg();
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN not configured on the Worker" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const v = validate(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const file = JSON.stringify({ _readme: README, labs: v.labs }, null, 2) + "\n";
  const message = `settings: lab prices/keywords via /admin/labs (by ${user!.id.slice(0, 8)})`;

  try {
    const canonicalUrl = await ghPutFile(token, owner, canonical, file, message);
    const mirrorUrl = await ghPutFile(token, owner, mirror, file, message);
    return NextResponse.json({
      ok: true,
      commits: [canonicalUrl, mirrorUrl].filter(Boolean),
      note: "Committed to both repos — CI is rebuilding; changes go live in ~5–10 minutes.",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "GitHub write failed" }, { status: 502 });
  }
}
