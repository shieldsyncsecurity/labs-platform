import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";
import { renderTemplate } from "@/lib/legal/templates";
import {
  MAX_BODY_TEXT_CHARS,
  engineErrorCode,
  isAgreementDocType,
  type AgreementParams,
} from "../_lib/shared";

type UpdateAgreementBody = {
  agreementId?: string;
  bodyText?: string;
};

type AgreementRow = {
  agreementId?: string;
  docType?: string;
  params?: AgreementParams;
  status?: string;
};

// Staff-only (W3-4): replace a DRAFT agreement's body text (negotiated-terms
// editing). The engine enforces draft-only with a ConditionExpression and
// recomputes sha256 atomically; this route re-derives `customized` by
// comparing the new text against a fresh render of the stored params, so the
// amber trail can't be toggled off by a crafted client. Fail-closed on
// getAdminActor() like every app/api/admin/* route.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: UpdateAgreementBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const agreementId = body.agreementId?.trim();
  if (!agreementId) {
    return NextResponse.json({ error: "agreementId is required" }, { status: 400 });
  }

  const bodyText = typeof body.bodyText === "string" ? body.bodyText.replace(/\r\n?/g, "\n") : "";
  if (!bodyText.trim()) {
    return NextResponse.json({ error: "Agreement body text is required" }, { status: 400 });
  }
  if (bodyText.length > MAX_BODY_TEXT_CHARS) {
    return NextResponse.json(
      { error: `Agreement body text exceeds ${MAX_BODY_TEXT_CHARS} characters` },
      { status: 400 },
    );
  }

  // Read the stored row first: `customized` must be derived against the
  // agreement's OWN docType + params, not anything client-supplied.
  let existing: AgreementRow;
  try {
    existing = await entFetch<AgreementRow>("/ent/agreement", { query: { agreementId } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load the agreement." }, { status: 502 });
  }

  let customized = true;
  try {
    if (isAgreementDocType(existing.docType) && existing.params) {
      customized =
        bodyText !== renderTemplate(existing.docType, existing.params).replace(/\r\n?/g, "\n");
    }
  } catch {
    customized = true; // fail SAFE: over-flagging only draws more legal review
  }

  try {
    const agreement = await entFetch("/ent/agreements/update", {
      method: "POST",
      body: { agreementId, bodyText, customized, actor },
    });
    return NextResponse.json(agreement);
  } catch (err) {
    if (err instanceof EntEngineError) {
      if (engineErrorCode(err.body) === "NOT_DRAFT") {
        return NextResponse.json(
          { error: "Only draft agreements can be edited. This one has already been issued." },
          { status: 409 },
        );
      }
      if (err.status === 404) {
        return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Could not update the agreement.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not update the agreement." }, { status: 502 });
  }
}
