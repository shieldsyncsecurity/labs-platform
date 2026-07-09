import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminSession } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

// One durable audit event as returned by the engine (W3B-1). detail is an
// arbitrary JSON object (e.g. { credits, invoiceNo }).
type AuditEvent = {
  auditId?: string;
  orgId?: string;
  actor?: string;
  action?: string;
  target?: string;
  detail?: Record<string, unknown>;
  createdAt?: string;
};

// Staff-only (W3B-1): the app-gated read in front of the engine's admin-only
// GET /ent/audit?orgId=. Read-only, so the boolean getAdminSession() gate is
// the right shape; fail-closed like every app/api/admin/* route. Returns the
// most recent events (default 30, clamped 1..100) newest-first as the engine
// already orders them.
export async function GET(req: Request) {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") ?? "").trim();
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 30;

  try {
    const data = await entFetch<{ audit?: AuditEvent[] }>("/ent/audit", {
      query: { orgId, limit },
    });
    const audit = Array.isArray(data?.audit) ? data.audit : [];
    return NextResponse.json({ audit });
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json(
        { error: "Could not load the activity log." },
        { status: err.status === 400 ? 400 : 502 },
      );
    }
    return NextResponse.json({ error: "Could not load the activity log." }, { status: 502 });
  }
}
