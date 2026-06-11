import { NextResponse } from "next/server";
import { engineFetchAsUser } from "@/lib/server/engine";

// Server-authoritative session status — the page polls this for the truth
// (provisioning / ready / ending / done / error) instead of trusting local state.
// The engine returns 404 if the caller (X-User-Id) doesn't own the session, so a
// random sessionId guess can't be used to enumerate someone else's progress.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^sess_[a-z0-9]{6,32}$/.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const r = await engineFetchAsUser(`/session/${id}`, undefined, { method: "GET", cache: "no-store" });
    if (!r.ok) return NextResponse.json({ error: "not found" }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ error: "engine unreachable" }, { status: 502 });
  }
}
