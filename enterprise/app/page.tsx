import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { HeroVisual } from "@/components/marketing/hero-visual";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
  title: "Cloud security hiring assessments in real AWS",
  description:
    "Evaluate candidates in live, isolated AWS accounts and auto-grade what they actually do to IAM, S3 and detection. Verified, side-by-side proof of skill.",
  alternates: { canonical: "/" },
};

const CONTACT_WALKTHROUGH =
  "mailto:info@shieldsyncsecurity.com?subject=" +
  encodeURIComponent("ShieldSync Enterprise - walkthrough");
const CONTACT_PRICING =
  "mailto:info@shieldsyncsecurity.com?subject=" +
  encodeURIComponent("ShieldSync Enterprise - pricing");

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      {/* overflow-x-clip contains the 3D hero scene's bleed without creating a
          scroll container (so the sticky header, a sibling, keeps working). */}
      <main className="flex-1 overflow-x-clip">
        <Hero />
        <Problem />
        <HowItWorks />
        <WhyReal />
        <TheReport />
        <Trust />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ HERO */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-5 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8 lg:py-24">
        <div className="max-w-xl">
          <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
            ShieldSync Enterprise &mdash; technical hiring, proven
          </p>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]">
            See candidates secure a real cloud &mdash; before you hire them.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-soft">
            ShieldSync drops each candidate into a live, isolated AWS account and
            auto-grades what they actually do to IAM, S3, and detection &mdash; not
            whiteboard trivia, not &ldquo;trust the resume.&rdquo; You get verified,
            side-by-side proof of skill.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={CONTACT_WALKTHROUGH}
              className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-transform transition-colors hover:-translate-y-0.5 hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Book a walkthrough
            </a>
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

/* --------------------------------------------------------------- PROBLEM */

const PAINS = [
  {
    title: "Resumes overstate skill",
    body: "A resume says “AWS expert” — then the candidate can't scope a least-privilege IAM policy under real conditions.",
  },
  {
    title: "Whiteboards test the wrong thing",
    body: "Puzzle interviews measure memory and nerves, not cloud judgment. Nobody secures production on a whiteboard.",
  },
  {
    title: "Take-homes are googleable",
    body: "Quizzes and take-home questions are searchable, shareable, and never touch a real console.",
  },
];

function Problem() {
  return (
    <Section>
      <SectionHeading
        eyebrow="THE PROBLEM"
        title="Resumes can't show skill. Interviews test the wrong thing."
      />
      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PAINS.map((p) => (
          <div
            key={p.title}
            className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/5 text-brand">
              <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
                <path
                  d="M10 6.5v4M10 13.5h.01M10 2.5l7.5 13H2.5L10 2.5z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">{p.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{p.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 text-lg font-semibold text-ink">
        You find out after they&rsquo;re hired &mdash; the expensive way.
      </p>
    </Section>
  );
}

/* ---------------------------------------------------------- HOW IT WORKS */

const STEPS = [
  {
    title: "Send a magic link",
    body: "One link, zero setup for the candidate. No account to create, nothing to install.",
    icon: (
      <path
        d="M8 12l-2 2a3 3 0 01-4.2-4.2l2.5-2.5M12 8l2-2a3 3 0 014.2 4.2l-2.5 2.5M8.5 11.5l3-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "They work in a real cloud",
    body: "A live, isolated AWS account spins up for them, time-boxed. Real console, real services.",
    icon: (
      <path
        d="M6 15a4 4 0 01-.5-7.97 5 5 0 019.6-1.2A3.5 3.5 0 0115 15H6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Auto-graded on live state",
    body: "The engine inspects the ACTUAL AWS configuration they produced — not multiple choice.",
    icon: (
      <path
        d="M4 10.5l3.5 3.5 8-9M4 15.5l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Scored, comparable report",
    body: "Side-by-side ranking, per-objective detail, and the candidate's written reflection.",
    icon: (
      <path
        d="M5 4.5h10v14H5v-14zM8 9h4M8 12h4M8 15h2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

function HowItWorks() {
  return (
    <Section id="how" muted>
      <SectionHeading
        eyebrow="HOW IT WORKS"
        title="From link to scored report in one session."
      />
      <ol className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="relative rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/5 text-brand">
                <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
                  {s.icon}
                </svg>
              </span>
              <span className="font-mono text-sm font-semibold text-brand/40">
                0{i + 1}
              </span>
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
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
      <div className="mt-12 overflow-x-auto rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="px-5 py-4 text-sm font-semibold text-ink">Capability</th>
              <th className="px-5 py-4 text-center text-sm font-semibold text-brand">
                ShieldSync
              </th>
              <th className="px-5 py-4 text-center text-sm font-medium text-muted">Resume</th>
              <th className="px-5 py-4 text-center text-sm font-medium text-muted">
                Whiteboard
              </th>
              <th className="px-5 py-4 text-center text-sm font-medium text-muted">
                Quiz platforms
              </th>
            </tr>
          </thead>
          <tbody>
            {CMP_ROWS.map((row, i) => (
              <tr key={row} className="border-b border-line last:border-b-0">
                <td className="px-5 py-4 text-[15px] text-ink-soft">{row}</td>
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
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 text-line-strong"
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

const REPORT_ROWS = [
  { name: "Candidate A", score: 92, bar: 92, tag: "Strong hire" },
  { name: "Candidate B", score: 78, bar: 78, tag: "Hire" },
  { name: "Candidate C", score: 54, bar: 54, tag: "No hire" },
];

function TheReport() {
  return (
    <Section id="report" muted>
      <SectionHeading
        eyebrow="THE REPORT"
        title="The deliverable your hiring team actually uses."
      />
      <div className="mt-12 grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="max-w-md">
          <p className="text-[15px] leading-relaxed text-ink-soft">
            Every session ends in one comparable artifact: candidates ranked
            side-by-side, each objective scored on what they actually built in the
            cloud, plus their written reasoning. No interpretation required &mdash; just
            a decision.
          </p>
          <Link
            href="/demo/report"
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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

        {/* Decorative mini comparison report card */}
        <div
          className="rounded-2xl border border-line bg-surface p-6 shadow-[0_20px_50px_-24px_rgba(79,70,229,0.35)]"
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
                      {r.score}
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

/* ------------------------------------------------------------------- TRUST */

const TRUST_CHIPS = [
  "SCP-fenced accounts",
  "Auto-wiped every session",
  "Same engine as our public AWS labs",
  "Data retained 24 months",
];

function Trust() {
  return (
    <Section>
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <SectionHeading
            eyebrow="TRUST"
            title="Built by cloud security practitioners."
            align="left"
          />
        </div>
        <div>
          <p className="text-[15px] leading-relaxed text-ink-soft">
            Each candidate runs in a real isolated account, SCP-fenced from anything
            else and auto-wiped at the end of every session &mdash; the same engine that
            powers ShieldSync&rsquo;s public AWS security labs. Candidate data is
            isolated, retained for 24 months, and deletion requests are honored.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {TRUST_CHIPS.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 font-mono text-[12px] font-medium text-ink-soft"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- PRICING */

function Pricing() {
  return (
    <Section id="pricing" muted>
      <div className="mx-auto max-w-2xl rounded-3xl border border-line bg-surface p-8 text-center shadow-[0_20px_50px_-30px_rgba(79,70,229,0.4)] sm:p-12">
        <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
          PRICING
        </p>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Simple, per-candidate.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
          One credit = one candidate. Invoiced with GST &mdash; no card, no
          procurement maze. Volume pricing on request.
        </p>
        <a
          href={CONTACT_PRICING}
          className="mt-8 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-transform transition-colors hover:-translate-y-0.5 hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Get pricing
        </a>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------------- FAQ */

const FAQS = [
  {
    q: "Is it really a real AWS account?",
    a: "Yes. Each candidate gets a genuine, live AWS account — the real console and real services — not a simulator or a screenshot walkthrough. The account is isolated per candidate, SCP-fenced, time-boxed, and auto-wiped at the end of the session.",
  },
  {
    q: "How is the work graded?",
    a: "Our engine inspects the actual AWS configuration the candidate produced — IAM policies, S3 settings, detection setup and more — against per-objective checks. Grading is on live cloud state, not multiple-choice answers, so the score reflects what they built.",
  },
  {
    q: "What does the candidate need?",
    a: "Just the magic link and a browser. There's nothing to install and no account for them to create — the isolated environment is provisioned for them and the session is time-boxed.",
  },
  {
    q: "Can candidates cheat?",
    a: "The assessment is graded on the real, isolated cloud state they produce — not on a shareable answer key. Every candidate gets their own fenced account, and the report captures how they solved it, not just whether, which makes copied answers easy to spot.",
  },
  {
    q: "How is candidate data handled?",
    a: "Candidate data is isolated and retained for 24 months, and deletion requests are honored. Assessment accounts are SCP-fenced from everything else and auto-wiped at the end of every session.",
  },
];

function Faq() {
  return (
    <Section>
      <SectionHeading eyebrow="FAQ" title="Questions, answered." />
      <div className="mx-auto mt-12 max-w-3xl divide-y divide-line rounded-2xl border border-line bg-surface">
        {FAQS.map((f) => (
          <details key={f.q} className="group px-6 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-line text-muted transition-transform group-open:rotate-45">
                <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path
                    d="M8 3.5v9M3.5 8h9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </summary>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- FINAL CTA */

function FinalCta() {
  return (
    <section className="px-5 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="hv-cta-band relative mx-auto max-w-6xl overflow-hidden rounded-[28px] px-6 py-16 text-center sm:px-12">
        <div className="relative z-10 mx-auto max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Stop hiring on faith.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-white/85">
            Watch your next candidate secure a real cloud. Book a 20-minute
            walkthrough.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:items-center">
            <a
              href={CONTACT_WALKTHROUGH}
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand-strong shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Book a walkthrough
            </a>
            <Link
              href="/demo/report"
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              View a sample report
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- PRIMITIVES */

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
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-6 lg:px-8 lg:py-24">
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
      <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}
