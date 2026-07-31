import { NextResponse } from "next/server";
import { clearSelfSession } from "@/lib/server/self-session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await clearSelfSession();
  return NextResponse.redirect(new URL("/my/login", req.url), 303);
}
