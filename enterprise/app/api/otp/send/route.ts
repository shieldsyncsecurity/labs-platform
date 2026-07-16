import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type OtpSendBody = {
  inviteToken?: string;
};

// Candidate-facing: trigger an OTP send (email/SMS -- engine's choice) for the
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
    const result = await entFetch<{ ok?: boolean; emailed?: boolean; devCode?: string }>("/ent/otp/send", {
      method: "POST",
      body: { inviteToken },
    });
    // Return ONLY the fields the candidate UI needs. `devCode` is a local-dev
    // convenience the engine emits outside Lambda; NEVER forward it in
    // production even if the engine were misconfigured to include it —
    // surfacing the OTP in the browser would bypass the identity check.
    // (Defense-in-depth: don't trust the upstream to withhold it.)
    const safe: { ok: boolean; emailed: boolean; devCode?: string } = {
      ok: result?.ok === true,
      emailed: result?.emailed === true,
    };
    if (process.env.NODE_ENV !== "production" && typeof result?.devCode === "string") {
      safe.devCode = result.devCode;
    }
    return NextResponse.json(safe);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/otp/send] engine error", err.status, err.body);
      // Forward ONLY a whitelisted, non-sensitive reason code (+ cooldown
      // seconds) so the candidate UI can show a precise message. Never echo the
      // raw engine body.
      const b = (err.body ?? {}) as { error?: string; retryAfter?: number };
      const ALLOWED = new Set(["OTP_COOLDOWN", "OTP_DAILY_CAP", "NOT_SENDABLE", "LINK_EXPIRED", "CONSENT_REQUIRED"]);
      const code = typeof b.error === "string" && ALLOWED.has(b.error) ? b.error : undefined;
      const retryAfter = typeof b.retryAfter === "number" ? b.retryAfter : undefined;
      return NextResponse.json(
        { error: "Could not send a code.", code, retryAfter },
        { status: err.status },
      );
    }
    console.error("[api/otp/send] unexpected error", err);
    return NextResponse.json({ error: "Could not send a code." }, { status: 502 });
  }
}
