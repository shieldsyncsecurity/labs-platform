import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type OtpVerifyBody = {
  inviteToken?: string;
  code?: string;
};

// Candidate-facing: verify the OTP code the candidate entered. On success the
// engine is expected to return whatever session/continuation token the
// candidate flow needs next (assessment-room hookup is a later TODO).
export async function POST(req: Request) {
  let body: OtpVerifyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { inviteToken, code } = body;
  if (!inviteToken || !code) {
    return NextResponse.json({ error: "inviteToken and code are required" }, { status: 400 });
  }

  try {
    const result = await entFetch("/ent/otp/verify", {
      method: "POST",
      body: { inviteToken, code },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/otp/verify] engine error", err.status, err.body);
      // Whitelisted, non-sensitive reason codes only (bad lifecycle state /
      // expired link) so the candidate UI can react precisely. Wrong-code and
      // lockout come back as a 200 body the caller already handles.
      const b = (err.body ?? {}) as { error?: string };
      const ALLOWED = new Set(["NOT_VERIFIABLE", "LINK_EXPIRED"]);
      const code = typeof b.error === "string" && ALLOWED.has(b.error) ? b.error : undefined;
      return NextResponse.json({ error: "Could not verify the code.", code }, { status: err.status });
    }
    console.error("[api/otp/verify] unexpected error", err);
    return NextResponse.json({ error: "Could not verify the code." }, { status: 502 });
  }
}
