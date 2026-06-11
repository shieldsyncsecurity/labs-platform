import { NextResponse } from "next/server";
import { engineFetchAsUser } from "@/lib/server/engine";

// Mint a FRESH federated console URL on demand (only when the lab is ready).
// Done per "Open console" click so the URL is always valid, never stale. The
// engine refuses if the X-User-Id header doesn't own this session — so one
// learner can't mint a console URL into another learner's sandbox account.
export async function POST(req: Request) {
  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!sessionId || !/^sess_[a-z0-9]{6,32}$/.test(sessionId)) {
    return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  }
  try {
    const r = await engineFetchAsUser("/console", { sessionId });
    const data = await r.json().catch(() => ({ error: "engine" }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
}
