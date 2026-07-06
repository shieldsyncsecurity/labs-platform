import Link from "next/link";

const CONTACT_EMAIL = "hello@shieldsyncsecurity.com";
const CONTACT_SUBJECT = encodeURIComponent("ShieldSync Enterprise — book a walkthrough");
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${CONTACT_SUBJECT}`;

export default function Home() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-6 py-24 text-center">
      <h1 className="text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
        Real-world cloud security assessments for hiring
      </h1>
      <p className="max-w-xl text-lg text-ink-soft">
        Evaluate candidates in live, isolated AWS environments — not whiteboard trivia. See how
        they actually secure IAM, S3, and detection pipelines under real conditions.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <a
          href={CONTACT_MAILTO}
          className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong"
        >
          Book a walkthrough
        </a>
        <Link
          href="/demo/report"
          className="rounded-full border border-line-strong px-6 py-3 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong"
        >
          View a sample report
        </Link>
      </div>
      <p className="text-sm text-muted">Pricing: contact us.</p>
    </div>
  );
}
