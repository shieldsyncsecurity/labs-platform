import { NextResponse } from "next/server";
import { engineFetchAsUser } from "@/lib/server/engine";

// End a lab early -> engine tears it down (aws-nuke) and recycles the account.
// (The reaper also does this automatically on expiry.) The engine cross-checks
// session ownership against X-User-Id, so a learner can only end THEIR session.
export async function POST(req: Request) {
  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!sessionId || !/^sess_[a-z0-9]{6,32}$/.test(sessionId)) {
    return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  }
  try {
    const r = await engineFetchAsUser("/teardown", { sessionId });
    if (!r.ok) return NextResponse.json({ error: "engine error" }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
}
