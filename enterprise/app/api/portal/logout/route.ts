import { NextResponse } from "next/server";
import { clearOrgId } from "@/lib/server/portal-session";

// Signs the employer out of the portal (clears the session cookie). Will
// keep working unchanged once real auth (Cognito) replaces the dev cookie.
export async function POST() {
  await clearOrgId();
  return NextResponse.json({ ok: true });
}
