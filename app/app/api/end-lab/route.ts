import { NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";

// End a lab early -> engine tears it down (aws-nuke) and recycles the account.
// (The reaper also does this automatically on expiry.)
export async function POST(req: Request) {
  const { sessionId } = (await req.json()) as { sessionId?: string };
  if (!sessionId) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  try {
    const r = await fetch(`${ENGINE_URL}/teardown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!r.ok) return NextResponse.json({ error: "engine error" }, { status: 502 });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
}
