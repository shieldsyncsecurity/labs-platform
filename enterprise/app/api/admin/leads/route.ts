import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

// Staff-only: the demo-request pipeline (POST /api/leads is the public writer;
// this is the reader behind /admin/leads). EVERY route under app/api/admin/*
// must verify the admin session FIRST; getAdminActor() is that fail-closed gate.
export async function GET() {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const data = await entFetch<{ leads?: unknown[] }>("/ent/leads");
    return NextResponse.json({ leads: data?.leads ?? [] });
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/admin/leads] engine error", err.status, err.body);
      return NextResponse.json({ error: "Could not load leads." }, { status: err.status });
    }
    console.error("[api/admin/leads] unexpected error", err);
    return NextResponse.json({ error: "Could not load leads." }, { status: 502 });
  }
}
