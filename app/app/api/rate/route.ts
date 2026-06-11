import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";

// Record a 👍/👎 for a lab (product signal). Server-authoritative userId.
export async function POST(req: Request) {
  const body = (await req.json()) as { labSlug?: string; rating?: string };
  const labSlug = body.labSlug;
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  if (!labSlug || !rating) {
    return NextResponse.json({ error: "labSlug and rating required" }, { status: 400 });
  }
  const user = await getServerUser();
  const userId = user?.id;
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  try {
    await fetch(`${ENGINE_URL}/rate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, labSlug, rating }),
    });
  } catch {
    /* best-effort — never block the UI on a rating */
  }
  return NextResponse.json({ ok: true });
}
