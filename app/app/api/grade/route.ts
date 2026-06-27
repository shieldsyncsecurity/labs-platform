import { NextResponse } from "next/server";
import { engineFetchAsUser } from "@/lib/server/engine";
import { getServerUser } from "@/lib/auth/session";

// "Check my work" — the engine inspects the live account and scores it against
// the lab's successCriteria. Engine cross-checks session ownership via X-User-Id.
export async function POST(req: Request) {
  if (process.env.ENGINE_SHARED_SECRET && !(await getServerUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!sessionId || !/^sess_[a-z0-9]{6,32}$/.test(sessionId)) {
    return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  }
  try {
    const r = await engineFetchAsUser("/grade", { sessionId });
    if (!r.ok) return NextResponse.json({ error: "grade failed" }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
}
