// Rendered whenever an assessment id doesn't exist OR belongs to a
// different org (see page.tsx -- both cases call notFound() so a guessed id
// from another org is indistinguishable from a typo).
export default function AssessmentNotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-bold text-ink">Assessment not found</h1>
      <p className="mt-3 text-ink-soft">
        This assessment doesn&apos;t exist, or isn&apos;t part of your organization.
      </p>
      <a
        href="/portal"
        className="mt-6 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
      >
        Back to dashboard
      </a>
    </div>
  );
}
