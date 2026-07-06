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
      return NextResponse.json({ error: "otp verify failed", detail: err.body }, { status: err.status });
    }
    return NextResponse.json({ error: "otp verify failed" }, { status: 502 });
  }
}
