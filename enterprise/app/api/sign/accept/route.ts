import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type AcceptBody = {
  token?: string;
  code?: string;
  typedName?: string;
  agree?: boolean;
};

// Public signing page: OTP verify + accept in ONE engine call. The immutable
// acceptance record's IP + user agent are injected HERE from request headers
// (cf-connecting-ip is set by Cloudflare on the Worker) -- browser-supplied
// body values are never trusted for either.
export async function POST(req: Request) {
  let body: AcceptBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const typedName = typeof body.typedName === "string" ? body.typedName.trim() : "";
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "Enter the code from your email." }, { status: 400 });
  if (typedName.length < 2) {
    return NextResponse.json({ error: "Type your full name to accept." }, { status: 400 });
  }
  // The checkbox is a REQUIRED element of the click-accept evidence -- refuse
  // server-side if it somehow arrives unticked.
  if (body.agree !== true) {
    return NextResponse.json({ error: "Tick the acceptance checkbox to continue." }, { status: 400 });
  }

  const ip =
    req.headers.get("cf-connecting-ip") ??
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const userAgent = req.headers.get("user-agent") ?? "";

  try {
    const result = await entFetch("/ent/docs/accept", {
      method: "POST",
      body: { docToken: token, code, typedName, ip, userAgent },
    });
    // 200-shaped outcomes pass through: {ok:true,...} or the OTP flags
    // ({ok:false, attemptsLeft|locked|expired}) the UI renders directly.
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/sign/accept] engine error", err.status, err.body);
      const b = (err.body ?? {}) as { error?: string };
      const ALLOWED = new Set(["LINK_EXPIRED"]);
      const code2 = typeof b.error === "string" && ALLOWED.has(b.error) ? b.error : undefined;
      return NextResponse.json(
        { error: "Could not record the acceptance.", code: code2 },
        { status: err.status },
      );
    }
    console.error("[api/sign/accept] unexpected error", err);
    return NextResponse.json({ error: "Could not record the acceptance." }, { status: 502 });
  }
}
