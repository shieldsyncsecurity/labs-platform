import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

// Staff-only document actions, addressed by 8-char DISPLAY id (never a raw
// token -- the admin UI does not hold tokens after registration). The display
// id resolves back to the full docToken HERE, server-side, against the engine
// list; an ambiguous or unknown prefix is refused.

type ActionBody = {
  id?: string;
  action?: string;
};

async function resolveToken(displayId: string): Promise<string | null> {
  const data = await entFetch<{ docs?: Array<{ docToken?: string }> }>("/ent/docs");
  const matches = (data.docs ?? [])
    .map((d) => d.docToken ?? "")
    .filter((t) => t.startsWith(displayId));
  return matches.length === 1 ? matches[0] : null;
}

export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: ActionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}$/.test(id)) {
    return NextResponse.json({ error: "id must be the 8-char display id" }, { status: 400 });
  }
  const action = body.action;
  if (action !== "resend" && action !== "revoke") {
    return NextResponse.json({ error: "action must be resend or revoke" }, { status: 400 });
  }

  let docToken: string | null;
  try {
    docToken = await resolveToken(id);
  } catch (err) {
    console.error("[api/admin/documents/action] resolve failed", err);
    return NextResponse.json({ error: "Could not look up the document." }, { status: 502 });
  }
  if (!docToken) {
    return NextResponse.json({ error: "No unique document matches that id." }, { status: 404 });
  }

  try {
    const result = await entFetch(`/ent/docs/${action}`, {
      method: "POST",
      body: { docToken, actor },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error(`[api/admin/documents/action] ${action} failed`, err.status, err.body);
      const b = (err.body ?? {}) as { error?: string; retryAfter?: number; status?: string };
      const ALLOWED = new Set(["ALREADY_SIGNED", "NOT_REVOCABLE", "RESEND_COOLDOWN", "LINK_EXPIRED"]);
      const code = typeof b.error === "string" && ALLOWED.has(b.error) ? b.error : undefined;
      return NextResponse.json(
        { error: "Action failed.", code, retryAfter: b.retryAfter },
        { status: err.status },
      );
    }
    console.error(`[api/admin/documents/action] ${action} error`, err);
    return NextResponse.json({ error: "Action failed." }, { status: 502 });
  }
}
