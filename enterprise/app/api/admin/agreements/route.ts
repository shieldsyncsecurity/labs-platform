import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";
import { renderTemplate, TEMPLATE_VERSION } from "@/lib/legal/templates";
import {
  MAX_BODY_TEXT_CHARS,
  engineErrorCode,
  isAgreementDocType,
  parseAgreementParams,
} from "./_lib/shared";

type CreateAgreementBody = {
  orgId?: string;
  docType?: string;
  params?: unknown;
  bodyText?: string;
  supersedes?: string;
};

// Staff-only (W3-4): create a DRAFT agreement for an org. The client sends the
// full body text (template render, possibly hand-edited for negotiated terms);
// the engine snapshots it verbatim and computes sha256. `customized` is
// RE-DERIVED here (bodyText vs a fresh template render) rather than trusted
// from the client -- the amber "negotiated terms" trail must be tamper-proof.
// getAdminActor() is the fail-closed gate (null = no valid admin session) AND
// the audit identity forwarded to the engine (E9 pattern).
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: CreateAgreementBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const orgId = body.orgId?.trim();
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }
  if (!isAgreementDocType(body.docType)) {
    return NextResponse.json(
      { error: "docType must be 'msa' or 'dpa'" },
      { status: 400 },
    );
  }
  const { params, error: paramsError } = parseAgreementParams(body.params);
  if (!params || paramsError) {
    return NextResponse.json({ error: paramsError ?? "invalid params" }, { status: 400 });
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

  // Derive `customized` server-side: does the stored text differ from a pure
  // render of the current template with these params? If the render itself
  // throws (it should not after parseAgreementParams), fail SAFE by marking
  // customized -- an over-flagged draft only draws more legal review.
  let customized = true;
  try {
    customized = bodyText !== renderTemplate(body.docType, params).replace(/\r\n?/g, "\n");
  } catch {
    customized = true;
  }

  const supersedes = (body.supersedes ?? "").trim().slice(0, 100) || undefined;

  try {
    const agreement = await entFetch<{ agreementId?: string }>("/ent/agreements", {
      method: "POST",
      body: {
        orgId,
        docType: body.docType,
        templateVersion: TEMPLATE_VERSION,
        params,
        bodyText,
        customized,
        supersedes,
        actor,
      },
    });
    return NextResponse.json(agreement);
  } catch (err) {
    if (err instanceof EntEngineError) {
      if (engineErrorCode(err.body) === "ORG_NOT_FOUND") {
        return NextResponse.json({ error: "Organization not found." }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Could not create the agreement.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not create the agreement." }, { status: 502 });
  }
}
