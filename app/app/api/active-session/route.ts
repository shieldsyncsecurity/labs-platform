import { NextResponse } from "next/server";
import { engineFetchAsUser } from "@/lib/server/engine";

// Server-authoritative "do I have a live lab?" — lets ANY tab/device restore the
// running lab, not just the tab that launched it (sessionStorage is per-tab).
export async function GET(req: Request) {
  const labSlug = new URL(req.url).searchParams.get("labSlug") ?? "";
  if (labSlug && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(labSlug)) {
    return NextResponse.json({ session: null }, { status: 400 });
  }
  try {
    const r = await engineFetchAsUser(`/active?labSlug=${encodeURIComponent(labSlug)}`, undefined, {
      method: "GET",
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.json({ session: null });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ session: null });
  }
}
