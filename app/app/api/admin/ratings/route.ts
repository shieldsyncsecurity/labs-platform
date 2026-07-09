import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/admin";
import { engineFetch } from "@/lib/server/engine";

/* Admin API for the /admin/ratings panel. Auth + the live engine call happen
 * here (a lightweight JSON handler), NOT in the page render — moves the SSR
 * CPU cost off the page shell, same fix already applied to /admin/labs and
 * /admin/blog for the Cloudflare Free-plan 10ms cap (Error 1102). */

export const dynamic = "force-dynamic";

type Row = { labSlug: string; up: number; down: number; total: number; pct: number | null };

export async function GET() {
  const user = await getServerUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "not authorized" }, { status: 403 });

  try {
    const r = await engineFetch("/ratings/summary", { method: "GET", cache: "no-store" });
    if (!r.ok) return NextResponse.json({ reachable: false, labs: [] });
    const labs = ((await r.json()).labs ?? []) as Row[];
    return NextResponse.json({ reachable: true, labs });
  } catch {
    return NextResponse.json({ reachable: false, labs: [] });
  }
}
