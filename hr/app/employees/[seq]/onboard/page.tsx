import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { can } from "@/lib/access";
import type { Employee } from "@/lib/employee";
import type { KycDoc, KycKind } from "@/lib/kyc";
import { LifecycleWizard, type WizardStep } from "@/components/LifecycleWizard";
import { SelfPinControl } from "@/components/SelfPinControl";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboarding — ShieldSync HR", robots: { index: false, follow: false } };

type Gen = { docId: string; docType: string; ref: string };

// Resumable by design — every step's status is derived from the employee's
// real data (issued documents, hasSelfPin), never a separate "wizard
// progress" flag. Landing here again after leaving mid-flow (or after Edit
// Employee corrected a typo'd DOJ) always reflects what's actually true.
export default async function OnboardEmployee({ params }: { params: Promise<{ seq: string }> }) {
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
  let kycDocs: KycDoc[] = [];
  try {
    kycDocs = (await hrFetch<{ docs?: KycDoc[] }>(`/hr/employees/${seq}/docs`)).docs ?? [];
  } catch {
    /* best-effort */
  }

  const { isAdmin, access } = await getViewer();
  const canWriteDocs = isAdmin || can(access, "documents", "write");
  const canKyc = isAdmin || can(access, "kyc", "read");
  const isIntern = /internship/i.test(e.employmentType);

  // Required KYC set mirrors OnboardingChecklist (bank proof isn't required for
  // a cash-paid employee, who has no bank account).
  const requiredKyc: KycKind[] = (e.paymentMode || "").trim().toLowerCase() === "cash"
    ? ["aadhaar", "pan", "photo", "signed_offer"]
    : ["aadhaar", "pan", "bank_proof", "photo", "signed_offer"];
  const haveKyc = new Set(kycDocs.filter((d) => d.category !== "sent").map((d) => d.kind));
  const kycDone = requiredKyc.filter((k) => haveKyc.has(k)).length;

  const letterDocType = isIntern ? "internship-offer" : "offer";
  const letterIssued = generated.find((g) => g.docType === letterDocType);
  const letterHref = `/employees/${seq}/${isIntern ? "internship-offer" : "offer"}`;
  const letterLabel = isIntern ? "Internship offer" : "Appointment letter";

  const steps: WizardStep[] = [
    {
      key: "record",
      title: "Employee record created",
      description: `${e.name} — ${e.designation}, ${e.employmentType.toLowerCase()}, joining ${e.dateOfJoining}.`,
      status: "done",
    },
    {
      key: "letter",
      title: `Issue the ${letterLabel.toLowerCase()}`,
      description: canWriteDocs
        ? `Generate and save the ${letterLabel.toLowerCase()} — ${e.name.split(" ")[0]} signs the printed/emailed copy.`
        : "You don't have Letters (documents) write access.",
      status: letterIssued ? "done" : canWriteDocs ? "current" : "locked",
      lockedHint: canWriteDocs ? undefined : "Ask an administrator to issue this letter.",
      doneNote: letterIssued ? `Issued · ${letterIssued.ref}` : undefined,
      action: { href: letterHref, label: `Generate ${letterLabel.toLowerCase()}` },
    },
    {
      key: "pin",
      title: "Set up self-serve login",
      description: isAdmin
        ? `Lets ${e.name.split(" ")[0]} sign in at /my/login to view documents issued to them.`
        : "Only the administrator can issue a self-serve PIN.",
      status: e.hasSelfPin ? "done" : isAdmin ? "current" : "locked",
      lockedHint: isAdmin ? undefined : "Ask an administrator to set this up.",
      doneNote: e.hasSelfPin ? "Set up" : undefined,
      inline: isAdmin ? <SelfPinControl seq={seq} employeeId={e.employeeId} hasPin={Boolean(e.hasSelfPin)} /> : undefined,
    },
    // KYC belongs in the wizard so "✓ Complete" can't show with documents
    // outstanding (the record page frames these as "Onboarding documents").
    {
      key: "kyc",
      title: "Collect onboarding documents",
      description: canKyc
        ? `Aadhaar, PAN, ${requiredKyc.includes("bank_proof") ? "bank proof, " : ""}photo, and the signed offer — upload them in the ID vault on the record.`
        : "You don't have KYC access.",
      status: kycDone >= requiredKyc.length ? "done" : canKyc ? "current" : "locked",
      lockedHint: canKyc ? undefined : "Ask someone with KYC access to collect these.",
      doneNote: `${kycDone} of ${requiredKyc.length} collected`,
      action: { href: `/employees/${seq}#kyc`, label: "Open the ID vault" },
    },
  ];

  return (
    <LifecycleWizard
      title={`Onboard ${e.name}`}
      subtitle="Everything needed to bring a new hire fully online, in order."
      backHref={`/employees/${seq}`}
      backLabel={e.name}
      steps={steps}
    />
  );
}
