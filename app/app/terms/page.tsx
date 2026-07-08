import type { Metadata } from "next";
import Link from "next/link";

// NOTE: the root layout (app/layout.tsx) already renders <SiteHeader/>, the
// <main> wrapper, and <SiteFooter/> globally, so this page returns ONLY its
// content column — unlike the enterprise app, whose legal pages render their
// own header/footer.

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing use of ShieldSync Labs — hands-on cloud-security labs that run in real, isolated AWS accounts.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "services", label: "Our services" },
  { id: "accounts", label: "Your account" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "payments", label: "Payments & access" },
  { id: "ip", label: "Intellectual property" },
  { id: "warranty", label: "No warranty" },
  { id: "liability", label: "Limitation of liability" },
  { id: "governing-law", label: "Governing law" },
  { id: "changes", label: "Changes to these terms" },
  { id: "contact", label: "Contact" },
];

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
      <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
        Legal
      </p>
      <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">
        Terms of Service
      </h1>
      <p className="mt-3 text-sm text-muted">Last updated: 8 July 2026</p>

      <p className="mt-6 text-base leading-relaxed text-ink-soft">
        These terms are provided for transparency and may be updated from time to time. They describe
        the general rules for using ShieldSync Labs, whether you&apos;re running a free lab or a paid
        one.
      </p>

      <div className="mt-6 rounded-2xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
        <span className="font-semibold text-ink">A note for labs learners.</span> These are the
        general terms for the ShieldSync Labs platform. The specific purchase terms for a paid lab
        &mdash; price, access window, and launch limits &mdash; are shown at the point of purchase.
        Together with the broader ShieldSync Security terms at{" "}
        <a href="https://shieldsyncsecurity.com/terms" className="text-emerald-700 hover:underline">
          shieldsyncsecurity.com/terms
        </a>
        , they govern your use of the platform.
      </div>

      {/* Contents rail */}
      <nav
        aria-label="Table of contents"
        className="mt-8 rounded-2xl border border-line bg-surface px-5 py-4"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          On this page
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-sm text-ink-soft hover:text-emerald-700">
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
            ShieldSync Labs is a hands-on cloud-security learning platform operated by ShieldSync
            Security Private Limited (&ldquo;ShieldSync,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;).
            You launch real, time-boxed labs that run in isolated AWS accounts to practise cloud
            security. By using the platform, you agree to these terms.
          </p>
        </section>

        <section id="services" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Our services</h2>
          <p className="mt-3">
            We provide hands-on cloud-security labs. When you launch a lab, we provision a real,
            throwaway AWS account in your browser with genuine console access &mdash; not a simulator
            &mdash; so you can complete the scenario. When you finish, or the timer expires, that
            account is automatically wiped. Lab availability, content, and scenarios may change over
            time.
          </p>
        </section>

        <section id="accounts" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Your account</h2>
          <p className="mt-3">
            You sign in with your Google account. You are responsible for keeping access to that
            account secure and for activity that happens under your ShieldSync Labs account. Provide
            accurate information, and do not share your account or impersonate anyone else.
          </p>
        </section>

        <section id="acceptable-use" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Acceptable use</h2>
          <p className="mt-3">
            Each lab gives you hands-on access to a real, isolated cloud environment. That access is
            provided solely to complete the assigned learning scenario. You must not:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Use a lab environment for any purpose other than the assigned scenario.</li>
            <li>
              Attack, probe, or attempt to gain unauthorized access to ShieldSync&apos;s own
              infrastructure, another learner&apos;s environment, or any third-party system.
            </li>
            <li>
              Use techniques learned in a lab against systems you do not own or have explicit written
              permission to test.
            </li>
            <li>
              Attempt to exfiltrate, retain copies of, or repurpose lab infrastructure or the
              throwaway AWS account beyond the scenario.
            </li>
            <li>
              Attempt to circumvent sign-in, per-lab launch limits, payment, or certificate
              verification controls.
            </li>
            <li>Use the platform for any unlawful purpose, or to harass, defraud, or misrepresent identity.</li>
          </ul>
          <p className="mt-3">
            We may suspend or terminate access for conduct that violates this section, and may report
            unlawful activity to relevant authorities.
          </p>
        </section>

        <section id="payments" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Payments &amp; access</h2>
          <p className="mt-3">
            The first lab is free. Paid labs and the monthly pass are billed as described at the point
            of purchase, and payments are processed securely through Paytm. Access is granted for the
            stated scope and duration &mdash; a per-lab purchase includes a defined access window and
            a set number of launches so you can retry from a clean state. Pricing may be shown in your
            local currency at checkout. You are responsible for the accuracy of any details you submit
            at checkout.
          </p>
        </section>

        <section id="ip" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Intellectual property</h2>
          <p className="mt-3">
            All content, lab scenarios, lab environments, guides, and branding are owned by ShieldSync
            or its licensors. You may use them for your own learning, but you may not redistribute,
            resell, or publish them without permission. Completion certificates we issue are yours to
            share as proof of the work you completed.
          </p>
        </section>

        <section id="warranty" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">No warranty</h2>
          <p className="mt-3">
            The platform is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
            warranties of any kind, whether express or implied, including any warranty of
            merchantability, fitness for a particular purpose, or non-infringement. We do not warrant
            that the platform will be uninterrupted, error-free, or that automated grading will be
            free from mistakes. The labs are educational; we do not guarantee any specific employment,
            certification, or security outcome.
          </p>
        </section>

        <section id="liability" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Limitation of liability</h2>
          <p className="mt-3">
            To the fullest extent permitted by law, ShieldSync Security Private Limited will not be
            liable for any indirect, incidental, special, or consequential damages, or for any loss of
            profits, data, or business opportunity, arising out of or relating to your use of the
            platform. Our total liability for any claim relating to the platform will not exceed the
            amount you paid for access in the preceding twelve months. Nothing in these terms limits
            liability that cannot be limited under applicable law.
          </p>
        </section>

        <section id="governing-law" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Governing law</h2>
          <p className="mt-3">
            These terms are governed by the laws of India, without regard to its conflict of law
            principles, with exclusive jurisdiction of the courts at Noida, Uttar Pradesh.
          </p>
        </section>

        <section id="changes" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Changes to these terms</h2>
          <p className="mt-3">
            We may update these terms as the platform evolves. We&apos;ll update the &ldquo;Last
            updated&rdquo; date above when we do. Continued use of the platform after a change means
            you accept the updated terms.
          </p>
        </section>

        <section id="contact" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Contact</h2>
          <p className="mt-3">
            Questions about these terms:{" "}
            <a href="mailto:info@shieldsyncsecurity.com" className="text-emerald-700 hover:underline">
              info@shieldsyncsecurity.com
            </a>
            . ShieldSync Security Private Limited, Noida, Uttar Pradesh, India.
          </p>
          <p className="mt-3">
            See also our{" "}
            <Link href="/privacy" className="text-emerald-700 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </article>
    </div>
  );
}
