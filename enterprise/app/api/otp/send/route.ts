import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type OtpSendBody = {
  inviteToken?: string;
};

// Candidate-facing: trigger an OTP send (email/SMS — engine's choice) for the
// invite's registered contact, as an identity check before the assessment starts.
export async function POST(req: Request) {
  let body: OtpSendBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { inviteToken } = body;
  if (!inviteToken) {
    return NextResponse.json({ error: "inviteToken is required" }, { status: 400 });
  }

  try {
    const result = await entFetch("/ent/otp/send", {
      method: "POST",
      body: { inviteToken },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json({ error: "otp send failed", detail: err.body }, { status: err.status });
    }
    return NextResponse.json({ error: "otp send failed" }, { status: 502 });
  }
}
