import { NextResponse } from "next/server";
import { engineFetchAsUser } from "@/lib/server/engine";
import { getServerUser } from "@/lib/auth/session";

// End a lab early -> engine tears it down (aws-nuke) and recycles the account.
// (The reaper also does this automatically on expiry.) The engine cross-checks
// session ownership against X-User-Id, so a learner can only end THEIR session.
export async function POST(req: Request) {
  if (process.env.ENGINE_SHARED_SECRET && !(await getServerUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
