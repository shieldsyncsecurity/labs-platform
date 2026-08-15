import { NextRequest, NextResponse } from "next/server";
import { guardAdminApi, getViewer } from "@/lib/server/hr-access";
import { hrFetch } from "@/lib/server/hr-engine";
import type { Invoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardAdminApi();
  if (denied) return denied;
  try {
    const data = await hrFetch<{ invoices: Invoice[] }>("/hr/invoices");
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Could not load invoices." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  const { actor } = await getViewer();
  const body = await req.json().catch(() => ({}));
  try {
    const data = await hrFetch<{ invoice: Invoice }>("/hr/invoices", { method: "POST", body: { ...body, actor } });
    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to create invoice.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
