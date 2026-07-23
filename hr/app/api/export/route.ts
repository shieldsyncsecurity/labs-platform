import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";

type GenRow = { docId: string; docType: string; title: string; ref: string; generatedBy: string; generatedAt: string };

// One-click full data export (owner-side backup): the employee master, every
// issued-document snapshot, KYC metadata (never the bytes — those live only in
// the encrypted store), and the audit trail. The system has intentional
// hard-delete; this JSON is the recovery artifact. The export itself is audited.
export async function GET() {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let employees: Employee[] = [];
  try {
    employees = (await hrFetch<{ employees?: Employee[] }>("/hr/employees")).employees ?? [];
  } catch {
    return NextResponse.json({ error: "Could not reach the HR data service." }, { status: 502 });
  }

  const perEmployee = await Promise.all(
    employees.map(async (e) => {
      const [docs, generatedList] = await Promise.all([
        hrFetch<{ docs?: unknown[] }>(`/hr/employees/${e.seq}/docs`).then((d) => d.docs ?? []).catch(() => []),
        hrFetch<{ generated?: GenRow[] }>(`/hr/employees/${e.seq}/generated`).then((d) => d.generated ?? []).catch(() => [] as GenRow[]),
      ]);
      const issued = await Promise.all(
        generatedList.map((g) =>
          hrFetch<{ gen?: unknown }>(`/hr/employees/${e.seq}/generated/${g.docId}`)
            .then((r) => r.gen)
            .catch(() => ({ ...g, snapshot: null, error: "snapshot unavailable" })),
        ),
      );
      return { employee: e, kycMetadata: docs, issuedDocuments: issued };
    }),
  );

  const audit = await hrFetch<{ audit?: unknown[] }>("/hr/audit", { query: { limit: 500 }, timeoutMs: 30000 })
    .then((d) => d.audit ?? [])
    .catch(() => []);

  // Hiring records (candidates + their questionnaire responses) — same backup,
  // clearly separated from employment records.
  const candidates = await hrFetch<{ candidates?: unknown[] }>("/hr/candidates")
    .then((d) => d.candidates ?? [])
    .catch(() => []);

  try {
    await hrFetch("/hr/audit", {
      method: "POST",
      body: { actor, action: "data.export", target: "", detail: { employees: employees.length } },
    });
  } catch {
    /* best-effort */
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: actor,
    system: "ShieldSync HR portal",
    note: "KYC file BYTES are not included — they exist only in the encrypted store. This export covers records, issued-document snapshots (re-renderable), and the audit trail.",
    employees: perEmployee,
    candidates,
    audit,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="shieldsync-hr-backup-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
}
