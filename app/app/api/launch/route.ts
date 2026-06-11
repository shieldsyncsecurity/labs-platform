import { NextResponse } from "next/server";
import { getLab } from "@/lib/labs";
import { listEntitlements } from "@/lib/server/store";
import { getServerUser } from "@/lib/auth/session";

// The browser hits THIS (the app server), which enforces entitlement and then
// brokers to the internal engine. The engine URL/creds never reach the client.
const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";

export async function POST(req: Request) {
  const body = (await req.json()) as { userId?: string; labSlug?: string };
  const labSlug = body.labSlug;
  // Prefer the VERIFIED session id; never trust a client-supplied userId when a
  // real session exists. Falls back to the body id only in mock/offline mode.
  const sessionUser = await getServerUser();
  const userId = sessionUser?.id ?? body.userId;
  const lab = labSlug ? getLab(labSlug) : undefined;
  if (!lab) return NextResponse.json({ error: "unknown lab" }, { status: 404 });
  if (!lab.ready) return NextResponse.json({ error: "lab not available" }, { status: 409 });

  // entitlement check (server-authoritative): free lab, or a non-expired grant.
  const now = Date.now();
  const grants = await listEntitlements(userId ?? "");
  const entitled = grants.some(
    (e) => (e.labSlug === labSlug || e.labSlug === "*") && (!e.accessUntil || new Date(e.accessUntil).getTime() > now)
  );
  if (!lab.free && !entitled) {
    return NextResponse.json({ error: "not entitled" }, { status: 403 });
  }

  // broker to the engine (lease -> deploy -> mint console URL). This takes ~1-2
  // min (real deploy). Production refinement: make this async + poll for the URL.
  let r: Response;
  try {
    r = await fetch(`${ENGINE_URL}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, labSlug }),
    });
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
  if (r.status === 503) return NextResponse.json({ error: "NO_CAPACITY" }, { status: 503 });
  if (r.status === 429) {
    // Per-level launch limit hit (e.g. Beginner = 3 runs / 72h) — relay the detail.
    const detail = await r.json().catch(() => ({}));
    return NextResponse.json({ error: "LIMIT_REACHED", ...detail }, { status: 429 });
  }
  if (!r.ok) return NextResponse.json({ error: "engine error" }, { status: 502 });

  return NextResponse.json(await r.json());
}
