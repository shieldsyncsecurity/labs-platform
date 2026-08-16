import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { can } from "@/lib/access";
import type { Employee } from "@/lib/employee";
import { LifecycleWizard, type WizardStep } from "@/components/LifecycleWizard";
import { OffboardControl } from "@/components/OffboardControl";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offboarding — ShieldSync HR", robots: { index: false, follow: false } };

type Gen = { docId: string; docType: string; ref: string };

// Resumable by design, same as the onboard wizard — and this one GENUINELY
// spans real time (a notice period is typically weeks), so resumability is
// not a nicety here, it's the point: the relieving letter shouldn't be
// generated until the actual last working day, which is often days after
// resignation is accepted. Coming back to this page on that later date picks
// up exactly where it was left, because every step reads live employee state.
export default async function OffboardEmployee({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }
  let generated: Gen[] = [];
  try {
    generated = (await hrFetch<{ generated: Gen[] }>(`/hr/employees/${seq}/generated`)).generated ?? [];
  } catch {
    /* best-effort */
  }

  const { isAdmin, access } = await getViewer();
  const canWriteDocs = isAdmin || can(access, "documents", "write");
  const canWriteEmp = isAdmin || can(access, "employees", "write");
  const isIntern = /internship/i.test(e.employmentType);
  const exited = e.status === "exited";

  const resignation = generated.find((g) => g.docType === "resignation-acceptance");
  const finalDocType = isIntern ? "completion" : "experience";
  const finalDoc = generated.find((g) => g.docType === finalDocType);
  const finalLabel = isIntern ? "Certificate of completion" : "Experience / relieving letter";
  const finalHref = exited && e.lastWorkingDay
    ? `/employees/${seq}/${finalDocType === "completion" ? "completion" : "experience"}?date=${encodeURIComponent(e.lastWorkingDay)}`
    : `/employees/${seq}/${finalDocType === "completion" ? "completion" : "experience"}`;

  const steps: WizardStep[] = [
    {
      key: "resignation",
      title: "Resignation accepted",
      description: canWriteDocs
        ? "Issue the acceptance letter — states when notice was tendered and the last working day."
        : "You don't have Letters (documents) write access.",
      status: resignation ? "done" : canWriteDocs ? "current" : "locked",
      lockedHint: canWriteDocs ? undefined : "Ask an administrator to issue this letter.",
      doneNote: resignation ? `Issued · ${resignation.ref}` : undefined,
      action: { href: `/employees/${seq}/resignation-acceptance`, label: "Generate resignation acceptance" },
    },
    {
      key: "exit",
      title: "Mark exited",
      description: canWriteEmp
        ? "Set the last working day once it arrives — this unlocks the relieving letter below."
        : "You don't have Employees write access.",
      status: exited ? "done" : canWriteEmp ? "current" : "locked",
      lockedHint: canWriteEmp ? undefined : "Ask an administrator to do this.",
      doneNote: exited ? `Last working day: ${e.lastWorkingDay ?? "not set"}` : undefined,
      inline: canWriteEmp && !exited ? <OffboardControl seq={seq} status={e.status} lastWorkingDay={e.lastWorkingDay} /> : undefined,
    },
    {
      key: "relieving",
      title: `Issue the ${finalLabel.toLowerCase()}`,
      description: `Certifies ${e.name.split(" ")[0]}'s tenure and last working day — the document they'll need for their next employer.`,
      status: finalDoc ? "done" : exited && e.lastWorkingDay ? (canWriteDocs ? "current" : "locked") : "locked",
      lockedHint: !exited || !e.lastWorkingDay
        ? "Mark exited with a last working day first (step 2)."
        : canWriteDocs
          ? undefined
          : "Ask an administrator to issue this letter.",
      doneNote: finalDoc ? `Issued · ${finalDoc.ref}` : undefined,
      action: { href: finalHref, label: `Generate ${finalLabel.toLowerCase()}` },
    },
  ];

  return (
    <LifecycleWizard
      title={`Offboard ${e.name}`}
      subtitle="The full exit sequence — resignation, exit date, and the relieving letter, in order. Safe to leave and come back once the last working day arrives."
      backHref={`/employees/${seq}`}
      backLabel={e.name}
      steps={steps}
    />
  );
}
