// Portal agreement gate (sprint W3-5): an ISSUED-but-unaccepted agreement
// blocks the portal until an authorized person accepts it.
//
// Server-only (imports ent-engine). Portal pages call getBlockingAgreement()
// right after the getOrgId() auth check and redirect to
// /portal/agreements/<id>/accept when it returns a row.
//
// FAIL-OPEN by design: if the engine errors or times out we return null and
// log -- a paying org must never be locked out of its own portal because the
// engine blipped. The gate re-runs on every page load, so a transient miss
// just delays the block until the next navigation. (Authorization itself is
// unaffected -- getOrgId() stays fail-closed.)

import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

export type AgreementSummary = {
  agreementId?: string;
  orgId?: string;
  docType?: "msa" | "dpa";
  templateVersion?: string;
  status?: "draft" | "issued" | "accepted" | "superseded" | "void";
  customized?: boolean;
  createdAt?: string;
  issuedAt?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  params?: { companyLegalName?: string };
};

/**
 * Returns the first issued-unaccepted agreement for `orgId`, or null when
 * there is nothing blocking (including on engine errors -- see fail-open
 * note above). Deterministic "first": oldest issuedAt wins, so multi-doc
 * orgs (MSA + DPA) accept them in issue order.
 */
export async function getBlockingAgreement(orgId: string): Promise<AgreementSummary | null> {
  try {
    const data = await entFetch<{ agreements?: AgreementSummary[] }>("/ent/agreements", {
      query: { orgId },
    });
    const issued = (data?.agreements ?? []).filter(
      (a) => a.status === "issued" && typeof a.agreementId === "string" && a.agreementId,
    );
    if (issued.length === 0) return null;
    issued.sort((a, b) => (a.issuedAt ?? "").localeCompare(b.issuedAt ?? ""));
    return issued[0];
  } catch (err) {
    // Fail-open: log loudly, never block the portal on an engine error.
    console.error("[agreement-gate] engine error -- gate skipped (fail-open)", err);
    return null;
  }
}

export type AgreementFull = AgreementSummary & {
  bodyText?: string;
  sha256?: string;
  params?: {
    companyLegalName?: string;
    registeredAddress?: string;
    gstin?: string;
    signatoryName?: string;
    signatoryTitle?: string;
    effectiveDate?: string;
    governingLaw?: string;
  };
};

/**
 * Fetches the FULL agreement row (incl. bodyText) and proves it belongs to
 * `orgId`. Portal view/accept/PDF surfaces MUST use this -- the engine's
 * GET /ent/agreement is not org-scoped, so the app carries the ownership
 * proof (sprint W3-2 note). Unlike the gate, this one is FAIL-CLOSED:
 * a foreign, draft, or missing agreement all return null and the caller
 * responds 404 -- never confirm a guessed id exists. Engine transport
 * errors throw (callers show a retry state, not a 404).
 */
export async function getOrgAgreement(
  orgId: string,
  agreementId: string,
): Promise<AgreementFull | null> {
  if (!agreementId) return null;
  let agreement: AgreementFull | undefined;
  try {
    agreement = await entFetch<AgreementFull>("/ent/agreement", { query: { agreementId } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) return null;
    throw err;
  }
  if (!agreement || agreement.orgId !== orgId) return null;
  // Drafts are internal negotiation working copies -- invisible to the org
  // until issued (same rule as the list page).
  if (agreement.status === "draft") return null;
  return agreement;
}
