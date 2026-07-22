import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

type AuditEvent = { auditId?: string; actor?: string; action?: string; target?: string; detail?: Record<string, unknown>; createdAt?: string };

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// Export the audit trail as CSV — evidence-grade output for DPDP/compliance
// review. The export itself is an audited action.
export async function GET() {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let audit: AuditEvent[] = [];
  try {
    audit = (await hrFetch<{ audit: AuditEvent[] }>("/hr/audit", { query: { limit: 500 }, timeoutMs: 30000 })).audit ?? [];
  } catch {
    return NextResponse.json({ error: "Could not load the audit trail." }, { status: 502 });
  }

  try {
    await hrFetch("/hr/audit", { method: "POST", body: { actor, action: "audit.export", target: "", detail: { rows: audit.length } } });
  } catch {
    /* best-effort */
  }

  const header = ["createdAt", "actor", "action", "target", "detail"].join(",");
  const rows = audit.map((a) => [csvCell(a.createdAt), csvCell(a.actor), csvCell(a.action), csvCell(a.target), csvCell(a.detail)].join(","));
  const csv = [header, ...rows].join("\r\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="shieldsync-hr-audit.csv"`,
      "cache-control": "no-store",
    },
  });
}
