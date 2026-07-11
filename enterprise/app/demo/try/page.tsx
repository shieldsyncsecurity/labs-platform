import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import TryDemo from "./try-demo";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
  title: "Try the assessment",
  description:
    "A 5-minute simulated preview of a ShieldSync hiring assessment: fix a misconfigured cloud environment without breaking the pipeline, then see the report a hiring team receives.",
  alternates: { canonical: "/demo/try" },
};

export default function TryAssessmentPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <div className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="mb-6 max-w-2xl">
            <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
              Experience it
            </p>
            <h1 className="mt-3 text-2xl font-bold leading-[1.15] tracking-tight text-ink sm:text-3xl">
              Try a hiring assessment — right here, right now.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-ink-soft">
              This is a <b>simulated</b> 5-minute preview of what your candidates experience.
              Real assessments run in a live, isolated AWS account with the actual console —
              graded exactly like this: on the final state, not on multiple choice.
            </p>
          </div>

          <TryDemo />

          <p className="mt-6 text-center text-sm text-muted">
            Prefer to look before you touch?{" "}
            <Link href="/demo/report" className="font-medium text-brand-strong hover:underline">
              See the full sample hiring report
            </Link>{" "}
            or{" "}
            <Link href="/book-demo" className="font-medium text-brand-strong hover:underline">
              book a walkthrough
            </Link>
            .
          </p>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}
