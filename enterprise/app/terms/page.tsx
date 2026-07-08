import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing use of ShieldSync Enterprise by employer organizations and the candidates they invite to a cloud-security hiring assessment.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "employer-accounts", label: "Employer accounts & credits" },
  { id: "candidates", label: "Candidates" },
  { id: "warranty", label: "No warranty" },
  { id: "liability", label: "Limitation of liability" },
  { id: "governing-law", label: "Governing law" },
  { id: "changes", label: "Changes to these terms" },
  { id: "contact", label: "Contact" },
];

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
          <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
            Legal
          </p>
          <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-muted">Last updated: 8 July 2026</p>

          <p className="mt-6 text-base leading-relaxed text-ink-soft">
            These terms are provided for transparency and may be updated from time to time. They
            describe the general rules for using ShieldSync Enterprise, whether you&apos;re an
            employer running assessments or a candidate invited to complete one.
          </p>

          <div className="mt-6 rounded-2xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">Note for enterprise buyers.</span> This is our
            general policy. A specific customer engagement &mdash; including pricing, credit
            volumes, service levels, and billing &mdash; is governed by a separate signed agreement
            (a Master Services Agreement and/or order form) between ShieldSync Security Private
            Limited and the employer organization. Where such an agreement exists and conflicts
            with these terms, the signed agreement controls.
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
                ShieldSync Enterprise is a hiring-assessment platform operated by ShieldSync
                Security Private Limited (&ldquo;ShieldSync,&rdquo; &ldquo;we,&rdquo;
                &ldquo;us&rdquo;). An employer invites a candidate to complete a real, time-boxed
                cloud-security task; the platform auto-grades the outcome into a report for that
                employer. By using the platform &mdash; as an employer user or as an invited
                candidate &mdash; you agree to these terms.
              </p>
            </section>

            <section id="acceptable-use" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Acceptable use</h2>
              <p className="mt-3">
                Each assessment gives a candidate hands-on access to a real, isolated cloud
                environment. That access is provided solely to complete the assigned task. You must
                not:
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Use the assessment environment for any purpose other than the assigned task.</li>
                <li>
                  Attack, probe, or attempt to gain unauthorized access to ShieldSync&apos;s own
                  infrastructure, another candidate&apos;s or tenant&apos;s environment, or any
                  third-party system.
                </li>
                <li>Attempt to exfiltrate, retain copies of, or repurpose assessment infrastructure or content beyond the task.</li>
                <li>Use the platform for any unlawful purpose, or to harass, defraud, or misrepresent identity.</li>
                <li>Attempt to circumvent the OTP verification, credit system, or report access controls.</li>
              </ul>
              <p className="mt-3">
                We may suspend or terminate access for conduct that violates this section, and may
                report unlawful activity to relevant authorities.
              </p>
            </section>

            <section id="employer-accounts" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Employer accounts &amp; credits</h2>
              <p className="mt-3">
                Employer organizations access the platform through an account and purchase
                assessment credits. At a high level, one credit is consumed when an assessment
                invitation is generated for a candidate. Pricing, credit volumes, and billing terms
                are set out in the order or agreement between ShieldSync and the employer, not in
                this general policy. Employers are responsible for the accuracy of candidate contact
                details they submit and for the lawful use of any results in their own hiring
                process.
              </p>
            </section>

            <section id="candidates" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Candidates</h2>
              <p className="mt-3">
                If you&apos;ve been invited to complete an assessment, it is because a prospective
                employer requested it as part of evaluating you for a role. Your activity, results,
                and written reflection from the assessment are compiled into a report and shared
                with that employer. Participation is voluntary; if you do not wish to complete an
                assessment, you may decline the invitation.
              </p>
            </section>

            <section id="warranty" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">No warranty</h2>
              <p className="mt-3">
                The platform is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
                warranties of any kind, whether express or implied, including any warranty of
                merchantability, fitness for a particular purpose, or non-infringement. We do not
                warrant that the platform will be uninterrupted, error-free, or that automated
                grading will be free from mistakes. Assessment results are one input into a hiring
                decision, not a guarantee of a candidate&apos;s ability.
              </p>
            </section>

            <section id="liability" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Limitation of liability</h2>
              <p className="mt-3">
                To the fullest extent permitted by law, ShieldSync Security Private Limited will not
                be liable for any indirect, incidental, special, or consequential damages, or for
                any loss of profits, data, or business opportunity, arising out of or relating to
                your use of the platform. Our total liability for any claim relating to the platform
                will not exceed the amount paid by the relevant employer for the assessment credits
                giving rise to the claim in the preceding twelve months. Nothing in these terms
                limits liability that cannot be limited under applicable law.
              </p>
            </section>

            <section id="governing-law" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Governing law</h2>
              <p className="mt-3">
                These terms are governed by the laws of India, without regard to its conflict of law
                principles. Any dispute arising out of or relating to these terms or the platform is
                subject to the exclusive jurisdiction of the courts of India.
              </p>
            </section>

            <section id="changes" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Changes to these terms</h2>
              <p className="mt-3">
                We may update these terms as the platform evolves. We&apos;ll update the &ldquo;Last
                updated&rdquo; date above when we do. Material changes affecting active customer
                engagements will be communicated to the relevant employer contact.
              </p>
            </section>

            <section id="contact" className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-ink">Contact</h2>
              <p className="mt-3">
                Questions about these terms:{" "}
                <a href="mailto:info@shieldsyncsecurity.com" className="text-brand-strong hover:underline">
                  info@shieldsyncsecurity.com
                </a>
                . ShieldSync Security Private Limited.
              </p>
              <p className="mt-3">
                See also our{" "}
                <Link href="/privacy" className="text-brand-strong hover:underline">
                  Privacy Policy
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
