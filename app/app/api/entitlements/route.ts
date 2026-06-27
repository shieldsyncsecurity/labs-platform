import { NextResponse } from "next/server";
import { listEntitlements } from "@/lib/server/store";
import { getServerUser } from "@/lib/auth/session";

// Returns the server-authoritative entitlements for a user. The id comes from
// the VERIFIED Cognito session cookie when present; the query param is only a
// fallback for mock/offline dev.
export async function GET(req: Request) {
  const sessionUser = await getServerUser();
  // Prod: ONLY the verified session drives the lookup. The ?userId query fallback
  // is dev/offline-only — otherwise anyone could read any user's purchase records.
  const userId =
    sessionUser?.id ?? (process.env.ENGINE_SHARED_SECRET ? null : new URL(req.url).searchParams.get("userId"));
  if (!userId) return NextResponse.json({ entitlements: [] });
  return NextResponse.json({ entitlements: await listEntitlements(userId) });
}
