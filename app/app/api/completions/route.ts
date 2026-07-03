import { NextResponse } from "next/server";
import { listCompletions } from "@/lib/server/store";
import { getServerUser } from "@/lib/auth/session";

// F2: server-side lab completion tracking. Only the verified session drives
// the lookup — no client-supplied userId fallback (unlike /api/entitlements'
// dev-only fallback), since this route has no offline/mock consumer yet.
export async function GET() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const completions = await listCompletions(user.id);
  return NextResponse.json({ completions });
}
