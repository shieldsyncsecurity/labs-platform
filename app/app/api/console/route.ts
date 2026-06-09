import { NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";

// Mint a FRESH federated console URL on demand (only when the lab is ready).
// Done per "Open console" click so the URL is always valid, never stale.
export async function POST(req: Request) {
  const { sessionId } = (await req.json()) as { sessionId?: string };
  if (!sessionId) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  try {
    const r = await fetch(`${ENGINE_URL}/console`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const data = await r.json().catch(() => ({ error: "engine" }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
}
