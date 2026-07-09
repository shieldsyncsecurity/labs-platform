import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";
import { engineErrorCode } from "../_lib/shared";

// Staff-only (W3-4): void a draft or issued agreement. The engine refuses to
// void an ACCEPTED agreement (permanent legal record -- supersede it with a
// new agreement instead). Fail-closed on getAdminActor(); actor forwarded to
// the engine's audit fields (voidedBy).
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
    const agreement = await entFetch("/ent/agreements/void", {
      method: "POST",
      body: { agreementId, actor },
    });
    return NextResponse.json(agreement);
  } catch (err) {
    if (err instanceof EntEngineError) {
      if (engineErrorCode(err.body) === "NOT_VOIDABLE") {
        return NextResponse.json(
          {
            error:
              "This agreement cannot be voided. Accepted agreements are permanent records -- issue a superseding agreement instead.",
          },
          { status: 409 },
        );
      }
      if (err.status === 404) {
        return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Could not void the agreement.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not void the agreement." }, { status: 502 });
  }
}
