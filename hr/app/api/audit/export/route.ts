import { NextResponse } from "next/server";
import { guardApi, getViewer } from "@/lib/server/hr-access";
import { restrictedSeqs } from "@/lib/server/employee-view";
import { hrFetch } from "@/lib/server/hr-engine";
import { fmtDetail } from "@/lib/audit-format";

export const dynamic = "force-dynamic";

type AuditEvent = { auditId?: string; actor?: string; action?: string; target?: string; detail?: Record<string, unknown>; createdAt?: string };

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// Export the audit trail as CSV — evidence-grade output for DPDP/compliance
// review. The export itself is an audited action.
export async function GET() {
  const denied = await guardApi("audit", "read");
  if (denied) return denied;
  const viewer = await getViewer();
  const actor = viewer.actor;
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // The CSV must honour the SAME two controls the audit page applies: mask pay
  // figures in the detail column for viewers without seeSalary, and drop rows
  // about administrator-only records. A raw export would step around both.
  const showSalary = viewer.isAdmin || viewer.access.seeSalary;

  let audit: AuditEvent[] = [];
  try {
    audit = (await hrFetch<{ audit: AuditEvent[] }>("/hr/audit", { query: { limit: 500 }, timeoutMs: 30000 })).audit ?? [];
  } catch {
    return NextResponse.json({ error: "Could not load the audit trail." }, { status: 502 });
  }

  // Record-level restriction, exactly as audit/page.tsx does it. Fails CLOSED:
  // if the restriction list can't be read we cannot tell which records are
  // protected, so every row is dropped rather than risk naming a hidden one.
  if (!viewer.isAdmin) {
    const { seqs, hideAll } = await restrictedSeqs(viewer);
    const hidden = hideAll ? null : seqs;
    if (hidden === null) {
      audit = [];
    } else if (hidden.size > 0) {
      audit = audit.filter((a) => {
        const target = String(a.target ?? "");
        const seqPrefix = Number(target.split("/")[0]);
        if (Number.isInteger(seqPrefix) && hidden.has(seqPrefix)) return false;
        // employeeId form (SSS/EMP/0008) — match on the padded seq.
        const idMatch = target.match(/SSS\/EMP\/(\d+)/);
        return !(idMatch && hidden.has(Number(idMatch[1])));
      });
    }
  }

  try {
    await hrFetch("/hr/audit", { method: "POST", body: { actor, action: "audit.export", target: "", detail: { rows: audit.length } } });
  } catch {
    /* best-effort */
  }

  const header = ["createdAt", "actor", "action", "target", "detail"].join(",");
  const rows = audit.map((a) => [csvCell(a.createdAt), csvCell(a.actor), csvCell(a.action), csvCell(a.target), csvCell(fmtDetail(a.detail, showSalary))].join(","));
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
