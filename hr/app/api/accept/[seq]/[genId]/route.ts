import { NextResponse } from "next/server";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

/** These two params come from an UNAUTHENTICATED URL and are interpolated into
 * an engine path. hrFetch now refuses a re-targeted path outright, but validate
 * the shape here as well: this endpoint is the one place on the internet that
 * reaches the engine without a session, so it should never send it a request
 * that could not describe a real document in the first place. */
const SEQ_RE = /^[0-9]{1,9}$/;
const GENID_RE = /^g_[A-Za-z0-9_]{1,60}$/;

export async function POST(req: Request, { params }: { params: Promise<{ seq: string; genId: string }> }) {
  const { seq, genId } = await params;
  if (!SEQ_RE.test(seq) || !GENID_RE.test(genId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // cf-connecting-ip is set by Cloudflare and cannot be spoofed by the client;
  // x-forwarded-for CAN be, and is a comma-separated chain, so only take its
  // first hop and only as a fallback. This value is evidence — it must never
  // be a string the person accepting chose for themselves.
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ip = req.headers.get("cf-connecting-ip") || xff || "";

  // A typed name is the only thing distinguishing "the candidate accepted"
  // from "somebody who saw the link clicked a button".
  let acceptedName = "";
  try {
    acceptedName = String(((await req.json()) as { name?: unknown }).name ?? "").trim().slice(0, 120);
  } catch {
    /* no body — rejected below */
  }
  if (acceptedName.length < 2) {
    return NextResponse.json({ error: "Please type your full name to confirm." }, { status: 400 });
  }

  try {
    const data = await hrFetch(`/hr/employees/${seq}/generated/${genId}/accept`, {
      method: "POST",
      body: { ip, acceptedName },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ error: "FAILED" }, { status: 502 });
  }
}
