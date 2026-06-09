import { NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";

// Server-authoritative session status — the page polls this for the truth
// (provisioning / ready / ending / done / error) instead of trusting local state.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const r = await fetch(`${ENGINE_URL}/session/${id}`, { cache: "no-store" });
    if (!r.ok) return NextResponse.json({ error: "not found" }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
}
