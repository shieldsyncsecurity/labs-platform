import type { Order } from "@/lib/payments/types";
import type { Entitlement } from "@/lib/auth/types";

// Server-authoritative store. IN-MEMORY for offline dev — resets on server
// restart. In production this is DynamoDB (orders table + entitlements table);
// the function signatures below are the seam to swap.
// Stored on globalThis so Next dev's module reloading doesn't wipe it each edit.

type DB = { orders: Map<string, Order>; entitlements: Map<string, Entitlement[]> };

const g = globalThis as unknown as { __ssLabsDB?: DB };
const db: DB = g.__ssLabsDB ?? { orders: new Map(), entitlements: new Map() };
g.__ssLabsDB = db;

export function saveOrder(o: Order): void {
  db.orders.set(o.id, o);
}

export function getOrder(id: string): Order | undefined {
  return db.orders.get(id);
}

export function grantEntitlement(userId: string, e: Entitlement): void {
  const list = db.entitlements.get(userId) ?? [];
  if (!list.some((x) => x.labSlug === e.labSlug)) list.push(e);
  db.entitlements.set(userId, list);
}

export function listEntitlements(userId: string): Entitlement[] {
  return db.entitlements.get(userId) ?? [];
}
