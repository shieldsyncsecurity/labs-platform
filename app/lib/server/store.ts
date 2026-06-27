import type { Entitlement } from "@/lib/auth/types";
import { engineFetch } from "./engine";

// Entitlements are stored in DynamoDB via the engine — persistent across all
// Cloudflare Worker invocations. We MUST go through engineFetch() so the
// x-engine-token shared secret is attached: the engine rejects token-less calls
// in prod (401), which would silently break grant/read (paid labs unusable).

// Returns true only if the entitlement was actually persisted. The payment webhook
// MUST check this — a swallowed failure here is "customer charged, no access".
export async function grantEntitlement(userId: string, e: Entitlement): Promise<boolean> {
  try {
    const r = await engineFetch("/entitlements", {
      method: "POST",
      userId,
      body: { userId, labSlug: e.labSlug, kind: e.kind, accessUntil: e.accessUntil },
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
