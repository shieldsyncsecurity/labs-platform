import { NextResponse } from "next/server";
import { getLab } from "@/lib/labs";
import { listEntitlements } from "@/lib/server/store";
import { getServerUser } from "@/lib/auth/session";
import { engineFetch } from "@/lib/server/engine";

// The browser hits THIS (the app server), which enforces entitlement and then
// brokers to the internal engine. The engine URL/creds never reach the client.

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { userId?: string; labSlug?: string };
  const labSlug = body.labSlug;
  // Whitelist labSlug at the edge — the engine also validates, but reject any
  // path-traversal-shaped input here before we look it up or hit the engine.
  if (labSlug && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(labSlug)) {
    return NextResponse.json({ error: "invalid lab" }, { status: 400 });
  }
  // Prefer the VERIFIED session id; never trust a client-supplied userId when a
  // real session exists. Falls back to the body id only in mock/offline mode.
  const sessionUser = await getServerUser();
  // Prod: only a verified session may launch. A client-supplied userId would let
  // an unauthenticated caller burn a pool seat + pin rate-limit/lock counters on
  // a victim id. The dev/offline path keeps the body fallback.
  const userId = sessionUser?.id ?? (process.env.ENGINE_SHARED_SECRET ? null : body.userId);
  if (process.env.ENGINE_SHARED_SECRET && !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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

  // broker to the engine — passes the shared secret + verified user id via headers,
  // plus the Cloudflare client IP for the engine's per-network abuse guards.
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  let r: Response;
  try {
    r = await engineFetch("/launch", { body: { userId, labSlug }, userId: userId ?? null, ip });
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
  if (r.status === 503) {
    // Could be a general pool exhaustion OR the free-pool cap (FREE_AT_CAPACITY) —
    // relay the engine's reason so the UI can show the right message.
    const detail = await r.json().catch(() => ({}));
    return NextResponse.json({ error: detail.error ?? "NO_CAPACITY", ...detail }, { status: 503 });
  }
  if (r.status === 429) {
    // Per-level launch limit hit (e.g. Beginner = 3 runs / 72h) — relay the detail.
    const detail = await r.json().catch(() => ({}));
    return NextResponse.json({ error: "LIMIT_REACHED", ...detail }, { status: 429 });
  }
  if (r.status === 409) {
    // H3: user already has a live lab (one live session per user) — relay which.
    const detail = await r.json().catch(() => ({}));
    return NextResponse.json({ error: detail.error ?? "ALREADY_ACTIVE", ...detail }, { status: 409 });
  }
  if (!r.ok) return NextResponse.json({ error: "engine error" }, { status: 502 });

  return NextResponse.json(await r.json());
}
