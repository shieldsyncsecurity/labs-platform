import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminSession } from "@/lib/server/admin-session";

type CreateOrgBody = {
  name?: string;
  adminEmails?: string; // comma-separated, from the form
  creditsTotal?: number | string;
  gstin?: string;
  billingAddress?: string;
  agreementVersion?: string;
};

// Staff-only: create a new employer org on the enterprise engine. EVERY
// route under app/api/admin/* must call getAdminSession() first -- this is
// the ShieldSync-staff gate, completely separate from the employer portal
// session (see lib/server/admin-session.ts).
export async function POST(req: Request) {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: CreateOrgBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const adminEmails = (body.adminEmails ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  const creditsTotalNum =
    typeof body.creditsTotal === "string" ? Number(body.creditsTotal) : body.creditsTotal;
  const creditsTotal =
    typeof creditsTotalNum === "number" && Number.isFinite(creditsTotalNum) ? creditsTotalNum : 0;

  const gstin = body.gstin?.trim() || undefined;
  const billingAddress = body.billingAddress?.trim() || undefined;
  const agreementVersion = body.agreementVersion?.trim() || "v1";

  try {
    const result = await entFetch("/ent/orgs", {
      method: "POST",
      body: { name, adminEmails, creditsTotal, gstin, billingAddress, agreementVersion },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json(
        { error: "Could not create organization.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not create organization." }, { status: 502 });
  }
}
