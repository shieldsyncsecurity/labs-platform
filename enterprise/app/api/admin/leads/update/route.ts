import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

type UpdateBody = {
  leadId?: string;
  status?: string;
};

const STATUSES = new Set(["new", "contacted", "closed"]);

// Staff-only: move a lead through the pipeline (new / contacted / closed).
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: UpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const leadId = (body.leadId ?? "").trim();
  const status = body.status ?? "";
  if (!leadId || !STATUSES.has(status)) {
    return NextResponse.json(
      { error: "leadId and a status of new/contacted/closed are required" },
      { status: 400 },
    );
  }

  try {
    const result = await entFetch<{ lead?: unknown }>("/ent/leads/update", {
      method: "POST",
      body: { leadId, status, actor },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/admin/leads/update] engine error", err.status, err.body);
      return NextResponse.json({ error: "Could not update the lead." }, { status: err.status });
    }
    console.error("[api/admin/leads/update] unexpected error", err);
    return NextResponse.json({ error: "Could not update the lead." }, { status: 502 });
  }
}
