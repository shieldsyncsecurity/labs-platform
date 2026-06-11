import { NextResponse } from "next/server";
import { sign } from "@/lib/payments/signature";
import { priceFor } from "@/lib/payments/pricing";
import { getServerUser } from "@/lib/auth/session";
import { getLab } from "@/lib/labs";
import { rulesForLab, MONTHLY_ACCESS_DAYS } from "@/lib/access-rules";
import type { CheckoutRequest } from "@/lib/payments/types";

// Creates a server-side signed order. The order details are embedded in a
// signed payload returned to the client — no in-memory store needed, so the
// mock-pay route can verify + fulfill on any Worker instance.
export async function POST(req: Request) {
  const body = (await req.json()) as CheckoutRequest;
  const sessionUser = await getServerUser();
  // Always use the verified server-side user id, never trust the client-supplied one.
  const userId = sessionUser?.id ?? body.userId;

  if (!userId || !body.plan) {
    return NextResponse.json({ error: "missing userId or plan" }, { status: 400 });
  }
  const currency = body.currency ?? "INR";
  const amountMinor = priceFor(body.labSlug ?? null, body.plan, currency);

  // Access window: monthly = all-access for 30 days; per-lab = the lab's window
  // (free 48h / Beginner 72h / Intermediate·Advanced 48h). Must match the engine's
  // per-lab launch window (engine/labinfra.mjs LEVEL_RULES/FREE_RULE).
  const lab = body.labSlug ? getLab(body.labSlug) : undefined;
  const accessUntil =
    body.plan === "monthly"
      ? new Date(Date.now() + MONTHLY_ACCESS_DAYS * 24 * 3600 * 1000).toISOString()
      : new Date(
          Date.now() +
            rulesForLab(lab?.level ?? "Beginner", lab?.free ?? false).windowHours * 3600 * 1000
        ).toISOString();

  // Embed all the grant-relevant data in the signed payload.
  const orderId = "order_" + Math.random().toString(36).slice(2, 12);
  const payload = JSON.stringify({
    orderId,
    userId,
    labSlug: body.labSlug ?? null,
    plan: body.plan,
    amountMinor,
    currency,
    accessUntil,
  });
  const signature = sign(payload);

  return NextResponse.json({ orderId, signedPayload: payload, signature, amountMinor, currency });
}
