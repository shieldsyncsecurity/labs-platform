import { NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/server/admin-session";

// Signs the staff admin out of the console (clears the admin cookie). No
// getAdminSession() gate needed here -- clearing a cookie that may not even
// exist is always safe to allow.
export async function POST() {
  await clearAdminSession();
  return NextResponse.json({ ok: true });
}
