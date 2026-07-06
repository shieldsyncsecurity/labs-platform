import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { setAdminCookie } from "@/lib/server/admin-session";

// ShieldSync-staff admin sign-in. This is intentionally separate from
// app/api/portal/dev-login/route.ts (employer auth) -- see the comment at
// the top of lib/server/admin-session.ts for why the two must never share a
// cookie or a code path.
//
// Fail-closed: if ADMIN_PANEL_SECRET is not configured, login is refused
// outright, even if the caller submits an empty/matching-empty secret. An
// unset secret must never mean "anyone gets in."
//
// TODO: replace this whole route with the Cognito ADMIN group /
// ADMIN_USER_IDS pattern (see lib/server/admin-session.ts TODO + labs
// app/lib/auth/admin.ts). Once that lands this route goes away entirely.
export async function POST(req: Request) {
  const expected = process.env.ADMIN_PANEL_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin sign-in is not configured." },
      { status: 503 },
    );
  }

  let body: { secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const submitted = body.secret ?? "";
  if (!submitted || !constantTimeEquals(submitted, expected)) {
    return NextResponse.json({ error: "Incorrect secret." }, { status: 401 });
  }

  await setAdminCookie();
  return NextResponse.json({ ok: true });
}

/**
 * Constant-time string comparison so a mistyped secret can't be brute-forced
 * via response-time differences. timingSafeEqual requires equal-length
 * buffers, so unequal lengths are compared against a same-length dummy
 * first -- this keeps the code path length-independent without ever
 * short-circuiting on length mismatch.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a timingSafeEqual of equal length so this branch takes
    // roughly the same time as the real comparison below.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
