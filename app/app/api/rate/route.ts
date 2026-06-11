import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";
import { engineFetch } from "@/lib/server/engine";

// Record a 👍/👎 for a lab (product signal). Server-authoritative userId.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { labSlug?: string; rating?: string };
  const labSlug = body.labSlug;
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  if (!labSlug || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(labSlug) || !rating) {
    return NextResponse.json({ error: "labSlug and rating required" }, { status: 400 });
  }
  const user = await getServerUser();
  const userId = user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  try {
    await engineFetch("/rate", { body: { userId, labSlug, rating }, userId });
  } catch {
    /* best-effort — never block the UI on a rating */
  }
  return NextResponse.json({ ok: true });
}
