import { NextResponse } from "next/server";
import { engineFetchAsUser } from "@/lib/server/engine";

// Wait-room poll: refresh this user's place in line for a busy free lab and learn
// whether a seat has opened. Informational only (allocation stays first-to-retry).
export async function GET(req: Request) {
  const labSlug = new URL(req.url).searchParams.get("labSlug") ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(labSlug)) {
    return NextResponse.json({ reached: true, position: 0, waiting: 0 }, { status: 400 });
  }
  try {
    const r = await engineFetchAsUser(`/queue?labSlug=${encodeURIComponent(labSlug)}`, undefined, {
      method: "GET",
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.json({ reached: true, position: 0, waiting: 0 });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ reached: true, position: 0, waiting: 0 });
  }
}
