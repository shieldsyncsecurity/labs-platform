import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import BookDemoForm from "./book-demo-form";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
  title: "Book a walkthrough",
  description:
    "See a full ShieldSync hiring assessment end to end — a 20-minute walkthrough of the live AWS environment, the candidate flow, and the comparison report.",
  alternates: { canonical: "/book-demo" },
};

const EXPECT = [
  "A live look at what a candidate sees: the isolated AWS account, the time-boxed scenario, the submit flow.",
  "The comparison report your hiring team gets back, on real (sample) data.",
  "Pricing for your volume — per-candidate credits, invoiced with GST. No card, no procurement maze.",
];

export default async function BookDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const defaultTopic = topic === "pricing" ? "pricing" : "walkthrough";

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <div className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-12 px-5 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-8 lg:py-16">
          <div className="max-w-md">
            <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
              Book a walkthrough
            </p>
            <h1 className="mt-4 text-2xl font-bold leading-[1.15] tracking-tight text-ink sm:text-3xl">
              See a hiring assessment run end to end.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-ink-soft">
              20 minutes, your calendar. Tell us a little about who you&apos;re
              hiring and we&apos;ll get back to you within one business day.
            </p>
            <ul className="mt-8 space-y-4">
              {EXPECT.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand"
                    aria-hidden="true"
                  >
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-8 text-sm text-muted">
              Just exploring?{" "}
              <Link href="/demo/report" className="font-medium text-brand-strong hover:underline">
                View the sample report
              </Link>{" "}
              — no form needed.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
            <BookDemoForm defaultTopic={defaultTopic} />
          </div>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}
