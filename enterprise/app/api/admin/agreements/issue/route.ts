import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";
import { engineErrorCode } from "../_lib/shared";

// Staff-only (W3-4): issue a draft agreement. The engine's draft->issued CAS
// makes the text immutable (sha256 re-stored at issue) and the org can then
// accept it from the portal. The 2-step confirm lives in the UI; this route
// just gates (fail-closed getAdminActor) and forwards the actor.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { agreementId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const agreementId = body.agreementId?.trim();
  if (!agreementId) {
    return NextResponse.json({ error: "agreementId is required" }, { status: 400 });
  }

  try {
    const agreement = await entFetch("/ent/agreements/issue", {
      method: "POST",
      body: { agreementId, actor },
    });
    return NextResponse.json(agreement);
  } catch (err) {
    if (err instanceof EntEngineError) {
      if (engineErrorCode(err.body) === "NOT_ISSUABLE") {
        return NextResponse.json(
          { error: "Only draft agreements can be issued." },
          { status: 409 },
        );
      }
      if (err.status === 404) {
        return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Could not issue the agreement.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not issue the agreement." }, { status: 502 });
  }
}
