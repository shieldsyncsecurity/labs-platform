import { NextRequest, NextResponse } from "next/server";
import { guardAdminApi, getViewer } from "@/lib/server/hr-access";
import { hrFetch } from "@/lib/server/hr-engine";
import type { Invoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ invId: string }> };

function safeInvId(id: string): boolean {
  return /^INV-\d{4}-\d{2}-\d{3}$/.test(id);
}

export async function GET(_req: NextRequest, { params }: Params) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  const { invId } = await params;
  if (!safeInvId(invId)) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  try {
    const data = await hrFetch<{ invoice: Invoice }>(`/hr/invoices/${encodeURIComponent(invId)}`);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  const { actor } = await getViewer();
  const { invId } = await params;
  if (!safeInvId(invId)) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  try {
    const data = await hrFetch<{ invoice: Invoice }>(`/hr/invoices/${encodeURIComponent(invId)}`, {
      method: "PUT",
      body: { ...body, actor },
    });
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to update invoice.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  const { invId } = await params;
  if (!safeInvId(invId)) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  try {
    await hrFetch(`/hr/invoices/${encodeURIComponent(invId)}`, { method: "DELETE" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete." }, { status: 502 });
  }
}
