import type { Entitlement, EntitlementType } from "@/lib/auth/types";
import { engineFetch } from "./engine";

// Entitlements are stored in DynamoDB via the engine — persistent across all
// Cloudflare Worker invocations. We MUST go through engineFetch() so the
// x-engine-token shared secret is attached: the engine rejects token-less calls
// in prod (401), which would silently break grant/read (paid labs unusable).

// Returns true only if the entitlement was actually persisted. The payment webhook
// MUST check this — a swallowed failure here is "customer charged, no access".
export async function grantEntitlement(userId: string, e: Entitlement): Promise<boolean> {
  try {
    // v2: forward the optional new fields when present. Legacy callers that pass
    // only {labSlug, kind, accessUntil} get the LIFETIME default applied engine-side.
    const body: Record<string, unknown> = {
      userId,
      labSlug: e.labSlug,
      kind: e.kind,
      accessUntil: e.accessUntil,
    };
    // Default any non-tagged grant to LIFETIME so the engine writer never sees a
    // missing `type` for new rows (legacy rows are handled by the migration).
    body.type = e.type ?? "LIFETIME";
    if (e.maxLaunches !== undefined) body.maxLaunches = e.maxLaunches;
    if (e.launchCount !== undefined) body.launchCount = e.launchCount;
    if (e.version !== undefined) body.version = e.version;
    if (e.windowStartedAt !== undefined) body.windowStartedAt = e.windowStartedAt;
    if (e.windowExpiresAt !== undefined) body.windowExpiresAt = e.windowExpiresAt;
    if (e.subscriptionId !== undefined) body.subscriptionId = e.subscriptionId;
    if (e.subscriptionStartedAt !== undefined) body.subscriptionStartedAt = e.subscriptionStartedAt;
    if (e.subscriptionExpiresAt !== undefined) body.subscriptionExpiresAt = e.subscriptionExpiresAt;
    if (e.subscriptionStatus !== undefined) body.subscriptionStatus = e.subscriptionStatus;
    if (e.orderId !== undefined) body.orderId = e.orderId;

    const r = await engineFetch("/entitlements", {
      method: "POST",
      userId,
      body,
    });
    if (!r.ok) {
      console.error(`grantEntitlement: engine returned ${r.status}`);
      return false;
    }
    return true;
  } catch {
    console.error("grantEntitlement: engine unreachable");
    return false;
  }
}

/**
 * Convenience for the PAY_PER_LAB grant path (one-time purchase webhook).
 * Writes the v2 shape with a zeroed launch counter; the window fields stay null
 * and are stamped atomically on the user's FIRST launch (reserveLaunch below).
 */
export async function grantPayPerLab(
  userId: string,
  labSlug: string,
  opts: { maxLaunches?: number; orderId?: string | null } = {}
): Promise<boolean> {
  const maxLaunches = opts.maxLaunches ?? 3;
  return grantEntitlement(userId, {
    labSlug,
    kind: "per-lab",
    accessUntil: null,
    type: "PAY_PER_LAB",
    maxLaunches,
    launchCount: 0,
    version: 0,
    windowStartedAt: null,
    windowExpiresAt: null,
    orderId: opts.orderId ?? null,
  });
}

/**
 * PAY_PER_LAB atomic reservation. Tells the engine to do the CAS UpdateItem:
 *   SET launchCount = launchCount + 1,
 *       windowStartedAt = if_not_exists(windowStartedAt, :now),
 *       windowExpiresAt = if_not_exists(windowExpiresAt, :now+7d),
 *       version = version + 1,
 *       updatedAt = :now
 *   COND: version = :expectedVersion
 *     AND launchCount < maxLaunches
 *     AND (attribute_not_exists(windowExpiresAt) OR :now < windowExpiresAt)
 *
 * Returns { ok, launchesRemaining?, windowExpiresAt? } on success, or
 * { ok:false, code:"CONCURRENT_LAUNCH_OR_LIMIT" } on ConditionalCheckFailed.
 *
 * Engine side is BUILT and deployed (commit b6209fc): POST /entitlements/reserve-launch
 * and POST /entitlements/rollback-launch in engine/handler.mjs.
 */
export type ReserveLaunchResult =
  | { ok: true; launchesRemaining: number; windowExpiresAt: string | null }
  | { ok: false; code: "CONCURRENT_LAUNCH_OR_LIMIT" | "ENGINE_ERROR" };

export async function reserveLaunch(
  userId: string,
  labSlug: string,
  expectedVersion: number
): Promise<ReserveLaunchResult> {
  try {
    const r = await engineFetch("/entitlements/reserve-launch", {
      method: "POST",
      userId,
      body: { userId, labSlug, expectedVersion },
    });
    if (r.status === 409) return { ok: false, code: "CONCURRENT_LAUNCH_OR_LIMIT" };
    if (!r.ok) return { ok: false, code: "ENGINE_ERROR" };
    const data = (await r.json()) as { launchesRemaining?: number; windowExpiresAt?: string | null };
    return {
      ok: true,
      launchesRemaining: typeof data.launchesRemaining === "number" ? data.launchesRemaining : 0,
      windowExpiresAt: data.windowExpiresAt ?? null,
    };
  } catch {
    return { ok: false, code: "ENGINE_ERROR" };
  }
}

/**
 * Compensating decrement after a successful reserve when engine provision fails.
 * Engine writer must apply ConditionExpression `launchCount > 0`.
 */
export async function rollbackLaunch(userId: string, labSlug: string): Promise<void> {
  try {
    await engineFetch("/entitlements/rollback-launch", {
      method: "POST",
      userId,
      body: { userId, labSlug },
    });
  } catch {
    // Best-effort — if the rollback fails the user just loses one launch out of
    // their cap. Log it; do NOT throw out of the launch route on this path.
    console.error("rollbackLaunch: engine unreachable");
  }
}

/** Type guard: a row counts as the legacy/free shape when no v2 tag is set. */
export function entitlementTypeOf(e: Entitlement): EntitlementType {
  return e.type ?? "LIFETIME";
}

export async function listEntitlements(userId: string): Promise<Entitlement[]> {
  if (!userId) return [];
  try {
    const r = await engineFetch(`/entitlements?userId=${encodeURIComponent(userId)}`, {
      method: "GET",
      userId,
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { entitlements?: Entitlement[] };
    return data.entitlements ?? [];
  } catch {
    return [];
  }
}

// F2: server-side lab completion tracking. Row shape mirrors entitlements'
// composite key ({userId, labSlug}) — see engine/labinfra.mjs recordCompletion.
// F3: `credentialId` is present once the learner has passed at least once
// (stamped by recordCompletion the first time a /grade call passes) — absent
// on rows written before the certificate feature shipped.
export type Completion = {
  labSlug: string;
  firstCompletedAt: string;
  lastCompletedAt: string;
  completions: number;
  credentialId?: string;
};

export async function listCompletions(userId: string): Promise<Completion[]> {
  if (!userId) return [];
  try {
    const r = await engineFetch(`/completions?userId=${encodeURIComponent(userId)}`, {
      method: "GET",
      userId,
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { completions?: Completion[] };
    return data.completions ?? [];
  } catch {
    return [];
  }
}

// F3: public credential lookup for the /verify/[id] page. No userId is sent —
// this is a public, unauthenticated fact ("does this credential exist and
// what does it say"), so engineFetch is called WITHOUT withUser/userId. The
// engine still requires the shared secret (x-engine-token), which engineFetch
// always attaches when configured.
export type Credential = {
  credentialId: string;
  name: string;
  labSlug: string;
  firstCompletedAt: string;
};

export async function getCredential(id: string): Promise<Credential | null> {
  if (!id) return null;
  try {
    const r = await engineFetch(`/completions/by-credential?id=${encodeURIComponent(id)}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { credential?: Credential };
    return data.credential ?? null;
  } catch {
    return null;
  }
}
