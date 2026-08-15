import { NextResponse } from "next/server";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { setSelfCookie } from "@/lib/server/self-session";

export const dynamic = "force-dynamic";

// PUBLIC — this IS the login, so it cannot itself require a session. Identity
// is proven by the Employee ID + PIN, verified server-side against the engine
// (which owns the salted hash and the failed-attempt lockout). This route
// never sees or stores the hash; it only relays a pass/fail and, on success,
// signs the ss_self cookie.
export async function POST(req: Request) {
  let body: { employeeId?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const employeeId = String(body.employeeId ?? "").trim();
  const pin = String(body.pin ?? "").trim();
  if (!employeeId || !pin) {
    return NextResponse.json({ error: "Employee ID and PIN are required." }, { status: 400 });
  }

  try {
    const data = await hrFetch<{ seq: number; name: string }>("/hr/self/login", {
      method: "POST",
      body: { employeeId, pin },
      timeoutMs: 10000,
    });
    await setSelfCookie(data.seq);
    return NextResponse.json({ ok: true, name: data.name });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 423) {
      return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 423 });
    }
    // Same generic message for "no such ID" and "wrong PIN" — distinguishing
    // them would tell an attacker which half of the guess was right.
    return NextResponse.json({ error: "Invalid Employee ID or PIN." }, { status: 401 });
  }
}
