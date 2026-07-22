import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type PresignBody = {
  inviteToken?: string;
  epoch?: number;
  items?: Array<{ kind?: string; seq?: number; contentType?: string; size?: number }>;
};

// Candidate-facing: mint presigned S3 PUT URLs for a batch of session-recording
// captures (webcam snapshot / audio chunk / identity shot). The engine enforces
// the real guards — invite must be "started", server-generated keys, per-invite
// mint cap — this route just proxies with the shared secret.
export async function POST(req: Request) {
  let body: PresignBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { inviteToken, epoch, items } = body;
  if (
    !inviteToken ||
    typeof epoch !== "number" ||
    !Array.isArray(items) || items.length === 0 || items.length > 8
  ) {
    return NextResponse.json({ error: "inviteToken, epoch and 1-8 items are required" }, { status: 400 });
  }
  try {
    const result = await entFetch("/ent/rec/presign", {
      method: "POST",
      body: { inviteToken, epoch, items },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      // Pass the status through — the recorder treats 409/429 as terminal
      // (session over / cap reached) and anything else as retryable.
      return NextResponse.json({ error: "presign failed" }, { status: err.status });
    }
    return NextResponse.json({ error: "presign failed" }, { status: 502 });
  }
}
