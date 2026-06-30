import { NextResponse } from "next/server";
import { getLab } from "@/lib/labs";
import {
  listEntitlements,
  reserveLaunch,
  rollbackLaunch,
  entitlementTypeOf,
} from "@/lib/server/store";
import { getServerUser } from "@/lib/auth/session";
import { engineFetch } from "@/lib/server/engine";
import type { Entitlement } from "@/lib/auth/types";

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
  // The matched grant — needed below for the v2 type-aware policy. We keep the
  // legacy "any matching, non-expired grant" predicate identical for LIFETIME so
  // free/comped users are unaffected.
  const matched: Entitlement | undefined = grants.find(
    (e) => (e.labSlug === labSlug || e.labSlug === "*") && (!e.accessUntil || new Date(e.accessUntil).getTime() > now)
  );
  const entitled = !!matched;
  if (!lab.free && !entitled) {
    return NextResponse.json({ error: "not entitled" }, { status: 403 });
  }

  // ── v2 type-aware policy enforcement ───────────────────────────────────────
  // LIFETIME (or absent type) and free labs: behave exactly as today.
  // PAY_PER_LAB: window check + atomic CAS reservation + rollback on engine fail.
  // SUBSCRIPTION: status + expiry check, no launch counting.
  let reserved = false;
  let launchesRemaining: number | undefined;
  let windowExpiresAt: string | null | undefined;
  if (matched && !lab.free) {
    const etype = entitlementTypeOf(matched);
    if (etype === "PAY_PER_LAB") {
      // a) window expiry check (only meaningful once first launch stamped it)
      if (matched.windowExpiresAt && new Date(matched.windowExpiresAt).getTime() <= now) {
        return NextResponse.json(
          { error: "WINDOW_EXPIRED", windowExpiresAt: matched.windowExpiresAt },
          { status: 403 }
        );
      }
      // b) cap check (engine re-validates atomically, but a fast 403 here saves a hop)
      const used = matched.launchCount ?? 0;
      const cap = matched.maxLaunches ?? 0;
      if (cap > 0 && used >= cap) {
        return NextResponse.json(
          { error: "LAUNCH_CAP_REACHED", launchesRemaining: 0 },
          { status: 403 }
        );
      }
      // c+d) atomic CAS reserve. Engine performs the UpdateItem with
      //   COND: version = :expectedVersion
      //     AND launchCount < maxLaunches
      //     AND (attribute_not_exists(windowExpiresAt) OR :now < windowExpiresAt)
      // and on ConditionalCheckFailed returns 409 -> CONCURRENT_LAUNCH_OR_LIMIT.
      const expectedVersion = matched.version ?? 0;
      const res = await reserveLaunch(userId!, matched.labSlug, expectedVersion);
      if (!res.ok) {
        return NextResponse.json(
          { error: res.code },
          { status: res.code === "CONCURRENT_LAUNCH_OR_LIMIT" ? 409 : 502 }
        );
      }
      reserved = true;
      launchesRemaining = res.launchesRemaining;
      windowExpiresAt = res.windowExpiresAt;
    } else if (etype === "SUBSCRIPTION") {
      const status = matched.subscriptionStatus ?? null;
      const exp = matched.subscriptionExpiresAt
        ? new Date(matched.subscriptionExpiresAt).getTime()
        : 0;
      if (status !== "ACTIVE" || !(now < exp)) {
        return NextResponse.json(
          { error: "SUBSCRIPTION_INACTIVE", subscriptionStatus: status },
          { status: 403 }
        );
      }
      // No launch counting for subscriptions — proceed to provision.
    }
    // LIFETIME (or absent type) falls through unchanged.
  }

  // broker to the engine — passes the shared secret + verified user id via headers,
  // plus the Cloudflare client IP for the engine's per-network abuse guards.
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  // Helper: best-effort rollback of the PAY_PER_LAB reserve on any provision failure
  // below — so a 503/network blip doesn't burn a launch the user never got.
  const maybeRollback = async () => {
    if (reserved && userId && matched) {
      await rollbackLaunch(userId, matched.labSlug);
    }
  };
  let r: Response;
  try {
    r = await engineFetch("/launch", { body: { userId, labSlug }, userId: userId ?? null, ip });
  } catch {
    await maybeRollback();
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
  if (r.status === 503) {
    // Could be a general pool exhaustion OR the free-pool cap (FREE_AT_CAPACITY) —
    // relay the engine's reason so the UI can show the right message.
    await maybeRollback();
    const detail = await r.json().catch(() => ({}));
    return NextResponse.json({ error: detail.error ?? "NO_CAPACITY", ...detail }, { status: 503 });
  }
  if (r.status === 429) {
    // Per-level launch limit hit (e.g. Beginner = 3 runs / 72h) — relay the detail.
    await maybeRollback();
    const detail = await r.json().catch(() => ({}));
    return NextResponse.json({ error: "LIMIT_REACHED", ...detail }, { status: 429 });
  }
  if (r.status === 409) {
    // H3: user already has a live lab (one live session per user) — relay which.
    // NOTE: do NOT rollback here — the user already has an active session, which
    // means a prior successful reservation/launch is still in flight; rolling back
    // would corrupt their counter. The current reserve is a duplicate they paid
    // for in error; failing it without decrement is the correct conservative move
    // until product decides otherwise.
    const detail = await r.json().catch(() => ({}));
    return NextResponse.json({ error: detail.error ?? "ALREADY_ACTIVE", ...detail }, { status: 409 });
  }
  if (!r.ok) {
    await maybeRollback();
    return NextResponse.json({ error: "engine error" }, { status: 502 });
  }

  const engineJson = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  // Surface the v2 fields when we have them so the UI can display
  // "N launches left, window ends <date>".
  const extra: Record<string, unknown> = {};
  if (launchesRemaining !== undefined) extra.launchesRemaining = launchesRemaining;
  if (windowExpiresAt !== undefined) extra.windowExpiresAt = windowExpiresAt;
  return NextResponse.json({ ...engineJson, ...extra });
}
