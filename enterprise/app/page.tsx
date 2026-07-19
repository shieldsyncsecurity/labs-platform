import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { ProductTour } from "@/components/marketing/product-tour";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
  title: "Cloud security hiring assessments in real AWS",
  description:
    "Evaluate candidates in live, isolated AWS accounts and auto-grade what they actually do to IAM, S3 and detection. Verified, side-by-side proof of skill.",
  alternates: { canonical: "/" },
};

// Lead-capture form (replaces the old mailto CTAs — a real funnel we can see
// and follow up on, backed by /api/leads + the /admin/leads pipeline).
const BOOK_WALKTHROUGH = "/book-demo";
const BOOK_PRICING = "/book-demo?topic=pricing";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      {/* overflow-x-clip contains the 3D hero scene's bleed without creating a
          scroll container (so the sticky header, a sibling, keeps working).
          A div, not <main> -- the root layout already wraps every page in <main>. */}
      <div className="flex-1 overflow-x-clip">
        <Hero />
        <HowItWorksTour />
        <WhyReal />
        <TheReport />
        <WhoItsFor />
        <Faq />
        <FinalCta />
      </div>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ HERO */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-5 py-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8 lg:py-16">
        <div className="max-w-xl">
          <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
            ShieldSync Enterprise &mdash; technical hiring, proven
          </p>
          <h1 className="mt-5 text-2xl font-bold leading-[1.15] tracking-tight text-ink sm:text-3xl">
            See candidates secure a real cloud &mdash; before you hire them.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-ink-soft">
            ShieldSync drops each candidate into a live, isolated AWS account and
            auto-grades what they actually do to IAM, S3, and detection &mdash; not
            whiteboard trivia, not &ldquo;trust the resume.&rdquo; You get verified,
            side-by-side proof of skill.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={BOOK_WALKTHROUGH}
              className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-transform transition-colors hover:-translate-y-0.5 hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Book a walkthrough
            </Link>
            <Link
              href="/demo/report"
              className="inline-flex items-center justify-center rounded-full border border-line-strong bg-surface px-6 py-3 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              View a sample report
            </Link>
          </div>
          <p className="mt-8 font-mono text-[12px] tracking-tight text-muted">
            Real AWS&nbsp;&nbsp;&middot;&nbsp;&nbsp;Isolated &amp; auto-wiped&nbsp;&nbsp;&middot;&nbsp;&nbsp;Graded on live cloud state
          </p>
        </div>

        <div className="relative flex justify-center lg:justify-end">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- HOW IT WORKS */

function HowItWorksTour() {
  return (
    <section id="how" className="scroll-mt-24 bg-surface">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <SectionHeading
          eyebrow="SEE IT WORK"
          title="A full hiring assessment, end to end."
        />
        <div className="mt-6">
          <ProductTour />
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- WHY IT'S REAL */

const CMP_ROWS = [
  "Runs in a real AWS account",
  "Graded on live cloud state",
  "Isolated per candidate, auto-wiped",
  "Objective & side-by-side comparable",
  "Shows HOW they solved it, not just whether",
];

// per row: [ShieldSync, Resume, Whiteboard, Quiz]
const CMP_CELLS: ("yes" | "no" | "partial")[][] = [
  ["yes", "no", "no", "no"],
  ["yes", "no", "no", "partial"],
  ["yes", "no", "no", "no"],
  ["yes", "no", "no", "partial"],
  ["yes", "no", "partial", "no"],
];

function WhyReal() {
  return (
    <Section id="why-real">
      <SectionHeading
        eyebrow="WHY IT'S REAL"
        title="Not a simulator. Not a quiz in disguise."
      />
      <div className="mt-8 overflow-x-auto rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-5 py-4 text-sm font-semibold text-ink">Capability</th>
              <th scope="col" className="px-5 py-4 text-center text-sm font-semibold text-brand">
                ShieldSync
              </th>
              <th scope="col" className="px-5 py-4 text-center text-sm font-medium text-muted">Resume</th>
              <th scope="col" className="px-5 py-4 text-center text-sm font-medium text-muted">
                Whiteboard
              </th>
              <th scope="col" className="px-5 py-4 text-center text-sm font-medium text-muted">
                Quiz platforms
              </th>
            </tr>
          </thead>
          <tbody>
            {CMP_ROWS.map((row, i) => (
              <tr key={row} className="border-b border-line last:border-b-0">
                <th scope="row" className="px-5 py-4 text-left text-[15px] font-normal text-ink-soft">
                  {row}
                </th>
                {CMP_CELLS[i].map((cell, j) => (
                  <td key={j} className="px-5 py-4 text-center">
                    <CmpMark value={cell} strong={j === 0} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
        Not a simulator or a quiz in disguise &mdash; the same isolated-account engine
        behind our public AWS security labs, pointed at hiring.
      </p>
    </Section>
  );
}

function CmpMark({ value, strong }: { value: "yes" | "no" | "partial"; strong?: boolean }) {
  if (value === "yes") {
    return (
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
          strong ? "bg-brand text-white" : "bg-brand/10 text-brand"
        }`}
        aria-label="Yes"
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-muted"
        aria-label="Partial"
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M4 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 text-muted"
      aria-label="No"
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/* -------------------------------------------------------------- THE REPORT */

// Honest with the real report: it ranks by verified checks passed (grouped into
// competencies) and never emits a hire/no-hire VERDICT (that decision is the
// employer's). So the preview mirrors that: a checks-passed % + count, no
// "Strong hire"/"No hire" labels the product doesn't actually produce.
const REPORT_ROWS = [
  { name: "Candidate A", score: 83, bar: 83, tag: "5 / 6 checks" },
  { name: "Candidate B", score: 67, bar: 67, tag: "4 / 6 checks" },
  { name: "Candidate C", score: 50, bar: 50, tag: "3 / 6 checks" },
];

function TheReport() {
  return (
    <Section id="report" muted>
      <SectionHeading
        eyebrow="THE REPORT"
        title="The deliverable your hiring team actually uses."
      />
      <div className="mt-8 grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="max-w-md">
          <p className="text-[15px] leading-relaxed text-ink-soft">
            Every session ends in one comparable artifact: candidates ranked
            side-by-side, each one&rsquo;s work scored across four competencies &mdash;
            correctness, security rigor, no new exposure and operational safety &mdash;
            verified on what they actually built in the cloud, plus their written
            reasoning. No interpretation required &mdash; just a decision.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/demo/try"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Try the assessment yourself
            </Link>
            <Link
              href="/demo/report"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              View the full sample report
              <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path
                  d="M3 8h9M8.5 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </div>
        </div>

        {/* Decorative mini comparison report card */}
        <div
          className="rounded-2xl border border-line bg-surface p-6 shadow-[0_20px_50px_-24px_rgba(217,119,6,0.35)]"
          aria-hidden="true"
        >
          <div className="flex items-center justify-between border-b border-line pb-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              Comparison report
            </span>
            <span className="font-mono text-[11px] text-brand">AWS security</span>
          </div>
          <div className="mt-4 flex flex-col gap-4">
            {REPORT_ROWS.map((r) => (
              <div key={r.name} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{r.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-ink">
                      {r.score}%
                    </span>
                    <span className="rounded-full bg-brand/5 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-brand">
                      {r.tag}
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-cyan"
                    style={{ width: `${r.bar}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- FINAL CTA */

function FinalCta() {
  return (
    <section className="px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
      <div className="hv-cta-band relative mx-auto max-w-6xl overflow-hidden rounded-[28px] px-6 py-16 text-center sm:px-12">
        <div className="relative z-10 mx-auto max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
            Stop hiring on faith.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/85">
            Watch your next candidate secure a real cloud. Book a 20-minute
            walkthrough.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:items-center">
            <Link
              href={BOOK_WALKTHROUGH}
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand-strong shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Book a walkthrough
            </Link>
            <Link
              href="/demo/report"
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              View a sample report
            </Link>
          </div>
          <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-white/70">
            Per-candidate credits, invoiced with GST &mdash; no card, no procurement
            maze.{" "}
            <Link href={BOOK_PRICING} className="font-semibold text-white underline underline-offset-2">
              Talk to us for volume.
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- PRIMITIVES */

/* ------------------------------------------------------------- WHO IT'S FOR */

const AUDIENCES = [
  {
    title: "Hiring managers & team leads",
    body: "Screen the shortlist on proof before you spend panel hours. One link per candidate, one comparable report back.",
  },
  {
    title: "Recruiters & staffing panels",
    body: "Filter a pile of lookalike resumes down to the few who can actually do the work — no cloud expert needed on your side.",
  },
  {
    title: "GCCs & security-services firms",
    body: "Benchmark candidates across batches with a standardized, auditable assessment — same scenario, same grading, every time.",
  },
];

function WhoItsFor() {
  return (
    <Section id="who-for">
      <SectionHeading eyebrow="WHO IT'S FOR" title="Anyone who hires cloud security hands." />
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {AUDIENCES.map((a) => (
          <div key={a.title} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <h3 className="text-base font-semibold text-ink">{a.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">{a.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------------- FAQ */

const FAQS = [
  {
    q: "How long does a candidate session take?",
    a: "One sitting — typically a 60-minute time-box. The candidate books a slot, works in the live AWS account, submits, and your report updates.",
  },
  {
    q: "Is any of our data or our cloud involved?",
    a: "Never. Each candidate works in a ShieldSync-owned AWS account created for that session, isolated per candidate, and destroyed afterwards. Your environment is never touched.",
  },
  {
    q: "What exactly is graded?",
    a: "The engine inspects the live AWS configuration the candidate produced — real cloud state, not multiple choice — and scores it across four objective competencies: reaching the secure end-state (correctness), hardening it with least privilege and defence in depth (security rigor), not opening a new hole while fixing (no new exposure), and not deleting or breaking the workload to clear the finding (operational safety). Every check is verified against the account and shown with the candidate's short written reflection. No self-reporting.",
  },
  {
    q: "How do we buy it?",
    a: "Per-candidate credits, invoiced with GST — no card, no procurement maze. Book a walkthrough and we'll set your team up the same week.",
  },
];

function Faq() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <Section id="faq" muted>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, "\\u003c") }} />
      <SectionHeading eyebrow="FAQ" title="The questions every hiring team asks." />
      <div className="mx-auto mt-8 max-w-3xl divide-y divide-line rounded-2xl border border-line bg-surface shadow-sm">
        {FAQS.map((f) => (
          <details key={f.q} className="group px-6 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-ink">
              {f.q}
              <span aria-hidden="true" className="text-xl leading-none text-brand transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Section({
  id,
  children,
  muted,
}: {
  id?: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <section
      id={id}
      className={`${id ? "scroll-mt-24" : ""} ${muted ? "bg-surface" : ""}`}
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        {children}
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
        {title}
      </h2>
    </div>
  );
}
