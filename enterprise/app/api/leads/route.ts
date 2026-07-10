import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type LeadBody = {
  name?: string;
  email?: string;
  company?: string;
  topic?: string;
  message?: string;
  source?: string;
  /** Honeypot — humans never see this field; any value means a bot. */
  website?: string;
};

const TOPICS = new Set(["walkthrough", "pricing", "other"]);

// Public (pre-auth): capture a demo/pricing request from the landing form.
// Validation mirrors the engine's POST /ent/leads exactly so a rejected body
// fails fast here with a friendly message instead of a 400 round-trip. The
// engine adds the real abuse gate (per-email cooldown row) on top.
export async function POST(req: Request) {
  let body: LeadBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Honeypot tripped: report success and drop it — a bot that sees an error
  // retries; one that sees success moves on.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  const name = (body.name ?? "").trim().slice(0, 120);
  const email = (body.email ?? "").trim().slice(0, 254);
  const company = (body.company ?? "").trim().slice(0, 160);
  const topic = TOPICS.has(body.topic ?? "") ? (body.topic as string) : "other";
  const message = (body.message ?? "").trim().slice(0, 2000);

  if (!name) {
    return NextResponse.json({ error: "Please add your name." }, { status: 400 });
  }
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }

  // source = the page the form sat on; accept only a local path, never a URL a
  // caller invents (it's echoed into the ops email).
  const rawSource = (body.source ?? "").trim().slice(0, 200);
  const source = rawSource.startsWith("/") && !rawSource.startsWith("//") ? rawSource : "";

  try {
    const result = await entFetch<{ ok?: boolean }>("/ent/leads", {
      method: "POST",
      body: { name, email, company, topic, message, source },
    });
    return NextResponse.json({ ok: result?.ok === true });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 429) {
      // Same email re-submitted within the cooldown window — the first request
      // is already recorded, so tell the prospect they're covered.
      return NextResponse.json({ error: "ALREADY_RECEIVED" }, { status: 429 });
    }
    if (err instanceof EntEngineError) {
      console.error("[api/leads] engine error", err.status, err.body);
    } else {
      console.error("[api/leads] unexpected error", err);
    }
    return NextResponse.json({ error: "Could not send your request." }, { status: 502 });
  }
}
