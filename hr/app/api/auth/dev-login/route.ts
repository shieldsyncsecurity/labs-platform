import { NextResponse } from "next/server";
import { setHrCookie } from "@/lib/server/hr-session";
import { isAllowed } from "@/lib/server/hr-token";

export const dynamic = "force-dynamic";

// LOCAL-ONLY sign-in escape hatch for development (no Cognito needed). Gated by
// HR_DEV_LOGIN=1 AND non-production — it 404s otherwise, so it can never be
// reached in the deployed Worker. Still enforces the allowlist.
export async function POST(req: Request) {
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  if (process.env.HR_DEV_LOGIN !== "1" || process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!isAllowed(email)) {
    return NextResponse.redirect(`${base}/login?error=not_allowed`, 303);
  }
  await setHrCookie({ email });
  return NextResponse.redirect(`${base}/`, 303);
}
