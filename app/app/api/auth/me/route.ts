import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";

// The client calls this on load to learn who's signed in (from the cookie).
export async function GET() {
  const user = await getServerUser();
  return NextResponse.json({ user });
}
