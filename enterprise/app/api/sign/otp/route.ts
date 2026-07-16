import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type OtpBody = {
  token?: string;
};

// Public signing page: email a one-time acceptance code to the document's
// REGISTERED signer address (the engine never accepts a caller-supplied
// recipient -- that binding is the identity check).
export async function POST(req: Request) {
  let body: OtpBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  try {
    const result = await entFetch<{ ok?: boolean; emailed?: boolean; signerEmailMasked?: string; devCode?: string }>(
      "/ent/docs/otp/send",
      { method: "POST", body: { docToken: token } },
    );
    // Forward only what the signing UI needs; `devCode` is a local-dev-only
    // field the engine emits outside Lambda — never surface it in production
    // even if the engine were misconfigured to send it (it would bypass the
    // acceptance identity check). Defense-in-depth against upstream leakage.
    const safe: { ok: boolean; emailed: boolean; signerEmailMasked?: string; devCode?: string } = {
      ok: result?.ok === true,
      emailed: result?.emailed === true,
      signerEmailMasked: result?.signerEmailMasked,
    };
    if (process.env.NODE_ENV !== "production" && typeof result?.devCode === "string") {
      safe.devCode = result.devCode;
    }
    return NextResponse.json(safe);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/sign/otp] engine error", err.status, err.body);
      // Whitelisted reason codes only -- never echo the raw engine body.
      const b = (err.body ?? {}) as { error?: string; retryAfter?: number };
      const ALLOWED = new Set(["OTP_COOLDOWN", "OTP_DAILY_CAP", "ALREADY_SIGNED", "LINK_EXPIRED"]);
      const code = typeof b.error === "string" && ALLOWED.has(b.error) ? b.error : undefined;
      const retryAfter = typeof b.retryAfter === "number" ? b.retryAfter : undefined;
      return NextResponse.json(
        { error: "Could not send a code.", code, retryAfter },
        { status: err.status },
      );
    }
    console.error("[api/sign/otp] unexpected error", err);
    return NextResponse.json({ error: "Could not send a code." }, { status: 502 });
  }
}
