import { NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";

// "Check my work" — the engine inspects the live account and scores it against the
// lab's successCriteria. Read-only; safe to call repeatedly.
export async function POST(req: Request) {
  const { sessionId } = (await req.json()) as { sessionId?: string };
  if (!sessionId) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  try {
    const r = await fetch(`${ENGINE_URL}/grade`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!r.ok) return NextResponse.json({ error: "grade failed" }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
}
