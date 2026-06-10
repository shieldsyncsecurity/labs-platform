import type { Entitlement } from "@/lib/auth/types";

// Entitlements are stored in DynamoDB via the engine — persistent across
// all Cloudflare Worker invocations. The engine URL is always available in
// the runtime environment (set in Cloudflare Variables & Secrets).
const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";

export async function grantEntitlement(userId: string, e: Entitlement): Promise<void> {
  try {
    await fetch(`${ENGINE_URL}/entitlements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, labSlug: e.labSlug, kind: e.kind, accessUntil: e.accessUntil }),
    });
  } catch {
    // log but don't throw — best-effort; the client will still see the grant
    // optimistically, and a retry will re-grant next purchase
    console.error("grantEntitlement: engine unreachable");
  }
}

export async function listEntitlements(userId: string): Promise<Entitlement[]> {
  if (!userId) return [];
  try {
    const r = await fetch(`${ENGINE_URL}/entitlements?userId=${encodeURIComponent(userId)}`);
    if (!r.ok) return [];
    const data = (await r.json()) as { entitlements?: Entitlement[] };
    return data.entitlements ?? [];
  } catch {
    return [];
  }
}
