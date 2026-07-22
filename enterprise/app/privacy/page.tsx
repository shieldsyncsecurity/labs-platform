import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How ShieldSync Enterprise collects, uses, and protects candidate and employer data during cloud-security hiring assessments.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "data-we-collect", label: "Data we collect" },
  { id: "how-we-use-it", label: "How we use it" },
  { id: "how-its-handled", label: "How data is handled" },
  { id: "sub-processors", label: "Sub-processors" },
  { id: "hosting-transfer", label: "Hosting & data transfer" },
  { id: "retention", label: "Retention & deletion" },
  { id: "your-rights", label: "Your rights" },
  { id: "security", label: "Security" },
  { id: "children", label: "Children's data" },
  { id: "changes", label: "Changes to this policy" },
  { id: "contact", label: "Contact" },
];

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
          <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
            Legal
          </p>
          <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-muted">Last updated: 8 July 2026</p>

          <p className="mt-6 text-base leading-relaxed text-ink-soft">
            This policy is provided for transparency and may be updated from time to time as
            ShieldSync Enterprise evolves. It explains, in plain language, what personal data we
            collect through the platform, why, and how it is handled.
          </p>

          <div className="mt-6 rounded-2xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">Note for enterprise buyers.</span> This is our
            general policy. A specific customer engagement may be governed by a separate signed
            agreement (a Data Processing Addendum or Master Services Agreement) between ShieldSync
            Security Private Limited and the employer organization. Where such an agreement exists
            and conflicts with this policy, the signed agreement controls.
          </div>

          {/* Contents rail */}
          <nav aria-label="Table of contents" className="mt-8 rounded-2xl border border-line bg-surface px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">On this page</p>
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-sm text-ink-soft hover:text-brand-strong">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <article className="mt-10 space-y-10 text-base leading-relaxed text-ink-soft">
            <section id="overview" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Overview</h2>
              <p className="mt-3">
                ShieldSync Enterprise (&ldquo;ShieldSync,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is
                operated by ShieldSync Security Private Limited, whose tagline is &ldquo;Empowering
                Cybersecurity Futures.&rdquo; The platform lets an employer invite a candidate to
                complete a real, time-boxed cloud-security task, which the platform then auto-grades
                into a report for that employer. This policy covers the personal data we process to
                make that work, for both employer users and the candidates they invite.
              </p>
            </section>

            <section id="data-we-collect" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Data we collect</h2>
              <p className="mt-3">For candidates invited to an assessment, we collect:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>
                  <span className="font-medium text-ink">Identity.</span> Name and email address,
                  provided to us by the employer who sends the invitation.
                </li>
                <li>
                  <span className="font-medium text-ink">A one-time passcode (OTP).</span> Sent to
                  the candidate&apos;s email to verify their identity before they can start the
                  assessment, delivered via Amazon SES.
                </li>
                <li>
                  <span className="font-medium text-ink">Assessment activity.</span> The
                  candidate&apos;s actions and results during the task, a correctness score per
                  objective, the time taken, and a short written &ldquo;reflection&rdquo; the
                  candidate submits describing what they found and how they addressed it.
                </li>
                <li>
                  <span className="font-medium text-ink">Session recording.</span> With the
                  candidate&apos;s explicit consent given before the assessment starts, we capture
                  periodic webcam snapshots (roughly every 15 seconds) and microphone audio while
                  the assessment is in progress, to verify the work was performed by the invited
                  candidate alone. The recording is stored encrypted in AWS S3, is visible only to
                  the inviting employer alongside the candidate&apos;s results, follows the same
                  24-month retention as assessment records, and is deleted immediately as part of
                  any erasure request.
                </li>
              </ul>
              <p className="mt-3">
                For employer users, we collect the information needed to create and manage an
                account &mdash; such as name, work email, and organization &mdash; and authenticate
                sign-in.
              </p>
            </section>

            <section id="how-we-use-it" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">How we use it</h2>
              <p className="mt-3">We use this data only to operate the assessment workflow:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Verifying a candidate&apos;s identity via OTP before granting access to the task.</li>
                <li>Provisioning and scoring the assessment, and compiling the results into a report for the inviting employer.</li>
                <li>
                  Evaluating the candidate&apos;s written reflection. This may be processed by
                  Google&apos;s Gemini API, on a tier where inputs are not used to train
                  Google&apos;s models, to help assess the reflection&apos;s quality.
                </li>
                <li>Employer account authentication and platform administration.</li>
              </ul>
              <p className="mt-3">
                We do not sell candidate or employer personal data, and we do not use candidate data
                for advertising.
              </p>
            </section>

            <section id="how-its-handled" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">How data is handled</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Employer and staff authentication is handled by Amazon Cognito.</li>
                <li>
                  Each assessment runs inside a dedicated, isolated AWS account that is
                  automatically wiped &mdash; every resource in it destroyed &mdash; once the
                  assessment ends. Candidate work is not retained in that live environment.
                </li>
                <li>
                  Assessment reports and results are stored in AWS (Amazon DynamoDB, us-east-1) with
                  point-in-time backup enabled.
                </li>
                <li>
                  Reports are accessed through private, unguessable secret links. They are not
                  publicly listed or searchable, and are excluded from search-engine indexing.
                </li>
              </ul>
            </section>

            <section id="sub-processors" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Sub-processors</h2>
              <p className="mt-3">We rely on the following sub-processors to run the platform:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>
                  <span className="font-medium text-ink">Amazon Web Services (AWS)</span> &mdash;
                  compute and storage, transactional email (Amazon SES), and authentication (Amazon
                  Cognito).
                </li>
                <li>
                  <span className="font-medium text-ink">Cloudflare</span> &mdash; application
                  hosting and content delivery.
                </li>
                <li>
                  <span className="font-medium text-ink">Google</span> &mdash; the Gemini API, used
                  to evaluate candidate reflections, on a no-training tier.
                </li>
              </ul>
              <p className="mt-3">
                ShieldSync Enterprise is built on AWS and Cloudflare infrastructure and is designed
                with security best practices in mind.
              </p>
            </section>

            <section id="hosting-transfer" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Hosting &amp; data transfer</h2>
              <p className="mt-3">
                The application itself runs on Cloudflare&apos;s global network. Assessment data
                processing and storage take place on AWS infrastructure in the us-east-1 (Northern
                Virginia, United States) region. If you or your candidates are located outside the
                United States, this means personal data is transferred to, and processed in, the
                United States as part of using the platform.
              </p>
            </section>

            <section id="retention" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Retention &amp; deletion</h2>
              <p className="mt-3">
                Assessment records are retained for up to 24 months from creation, after which they
                are deleted. A candidate or employer may request earlier deletion at any time by
                emailing{" "}
                <a href="mailto:privacy@shieldsyncsecurity.com" className="text-brand-strong hover:underline">
                  privacy@shieldsyncsecurity.com
                </a>
                .
              </p>
            </section>

            <section id="your-rights" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Your rights</h2>
              <p className="mt-3">
                You may ask us to confirm what personal data we hold about you, correct inaccurate
                data, or delete your data (subject to the retention needs described above, such as
                an employer&apos;s legitimate need to keep a completed assessment report). To make a
                request, email{" "}
                <a href="mailto:privacy@shieldsyncsecurity.com" className="text-brand-strong hover:underline">
                  privacy@shieldsyncsecurity.com
                </a>
                . Because a candidate&apos;s assessment is requested by a prospective employer,
                candidates should also expect their employer contact to be involved in resolving
                data requests tied to a specific hiring process.
              </p>
            </section>

            <section id="security" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Security</h2>
              <p className="mt-3">
                We rely on AWS and Cloudflare&apos;s infrastructure controls, per-assessment account
                isolation, and unguessable, non-indexed report links as core parts of how we protect
                data. The platform is designed with security best practices in mind. If you believe
                you&apos;ve found a security issue, see our{" "}
                <a
                  href="/.well-known/security.txt"
                  className="text-brand-strong hover:underline"
                >
                  security.txt
                </a>{" "}
                or email{" "}
                <a href="mailto:security@shieldsyncsecurity.com" className="text-brand-strong hover:underline">
                  security@shieldsyncsecurity.com
                </a>
                .
              </p>
            </section>

            <section id="children" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Children&apos;s data</h2>
              <p className="mt-3">
                ShieldSync Enterprise is a hiring-assessment tool intended for use by employers and
                prospective job candidates. It is not directed at, and should not be used by,
                children.
              </p>
            </section>

            <section id="changes" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Changes to this policy</h2>
              <p className="mt-3">
                We may update this policy as the platform evolves. We&apos;ll update the &ldquo;Last
                updated&rdquo; date above when we do. Material changes affecting active customer
                engagements will be communicated to the relevant employer contact.
              </p>
            </section>

            <section id="contact" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Contact</h2>
              <p className="mt-3">
                General questions:{" "}
                <a href="mailto:info@shieldsyncsecurity.com" className="text-brand-strong hover:underline">
                  info@shieldsyncsecurity.com
                </a>
                . Privacy and data requests:{" "}
                <a href="mailto:privacy@shieldsyncsecurity.com" className="text-brand-strong hover:underline">
                  privacy@shieldsyncsecurity.com
                </a>
                . Security reports:{" "}
                <a href="mailto:security@shieldsyncsecurity.com" className="text-brand-strong hover:underline">
                  security@shieldsyncsecurity.com
                </a>
                . ShieldSync Security Private Limited.
              </p>
              <p className="mt-3">
                See also our{" "}
                <Link href="/terms" className="text-brand-strong hover:underline">
                  Terms of Service
                </Link>
                .
              </p>
            </section>
          </article>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
