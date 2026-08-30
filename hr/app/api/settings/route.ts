import { NextResponse } from "next/server";
import { guardAdminApi } from "@/lib/server/hr-access";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

/** Update GST configuration. Admin only — it drives whether invoices charge GST
 * and what GSTIN appears on them, so it is a positioning/compliance setting. */
export async function PUT(req: Request) {
  const denied = await guardAdminApi();
  if (denied) return denied;

  let body: { gstRegistered?: boolean; gstin?: string; gstRate?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const gstRegistered = Boolean(body.gstRegistered);
  const gstin = String(body.gstin ?? "").trim().toUpperCase();
  const gstRate = Number(body.gstRate);

  // A GSTIN is 15 chars: 2 state code + 10 PAN + 1 entity + 'Z' + 1 checksum.
  // Enforce the format so a typo'd number can't reach a tax invoice — but only
  // when registration is being turned ON (an empty GSTIN is fine while off).
  if (gstRegistered && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return NextResponse.json({ error: "Enter a valid 15-character GSTIN (e.g. 09AAAAA0000A1Z5) to turn GST on." }, { status: 400 });
  }
  const rate = Number.isFinite(gstRate) && gstRate > 0 && gstRate <= 28 ? Math.round(gstRate) : 18;

  try {
    const actor = await getHrActor();
    await hrFetch("/hr/settings", {
      method: "PUT",
      body: { settings: { gstRegistered, gstin: gstin || undefined, gstRate: rate }, actor },
    });
  } catch {
    return NextResponse.json({ error: "Could not save GST settings." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, gstRegistered, gstin: gstin || null, gstRate: rate });
}
