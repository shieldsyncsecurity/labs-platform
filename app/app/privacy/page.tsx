import type { Metadata } from "next";
import Link from "next/link";

// NOTE: the root layout (app/layout.tsx) already renders <SiteHeader/>, the
// <main> wrapper, and <SiteFooter/> globally, so this page returns ONLY its
// content column — unlike the enterprise app, whose legal pages render their
// own header/footer.

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How ShieldSync Labs collects, uses, and protects learner data when you run hands-on cloud-security labs in real, isolated AWS accounts.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "data-we-collect", label: "Data we collect" },
  { id: "how-we-use-it", label: "How we use it" },
  { id: "how-its-handled", label: "How data is handled" },
  { id: "payments", label: "Payments" },
  { id: "sub-processors", label: "Sub-processors" },
  { id: "hosting-transfer", label: "Hosting & data transfer" },
  { id: "retention", label: "Retention & deletion" },
  { id: "your-rights", label: "Your rights" },
  { id: "cookies", label: "Cookies" },
  { id: "security", label: "Security" },
  { id: "children", label: "Children's data" },
  { id: "changes", label: "Changes to this policy" },
  { id: "contact", label: "Contact" },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
      <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
        Legal
      </p>
      <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">
        Privacy Policy
      </h1>
      <p className="mt-3 text-sm text-muted">Last updated: 8 July 2026</p>

      <p className="mt-6 text-base leading-relaxed text-ink-soft">
        This policy is provided for transparency and may be updated from time to time as ShieldSync
        Labs evolves. It explains, in plain language, what personal data we collect when you use the
        labs platform, why, and how it is handled.
      </p>

      <div className="mt-6 rounded-2xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
        <span className="font-semibold text-ink">A note for labs learners.</span> This policy covers
        the ShieldSync Labs learning platform specifically. It sits alongside the broader ShieldSync
        Security privacy policy at{" "}
        <a
          href="https://shieldsyncsecurity.com/privacy"
          className="text-emerald-700 hover:underline"
        >
          shieldsyncsecurity.com/privacy
        </a>
        ; where something is specific to launching labs, this policy adds the detail.
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
            ShieldSync Labs (&ldquo;ShieldSync,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is operated
            by ShieldSync Security Private Limited, whose tagline is &ldquo;Empowering Cybersecurity
            Futures.&rdquo; The platform lets a learner launch a real, hands-on cloud-security lab in
            a throwaway AWS account that runs in the browser and is automatically destroyed when the
            lab ends. This policy covers the personal data we process to make that work.
          </p>
        </section>

        <section id="data-we-collect" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Data we collect</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-ink">Account &amp; identity.</span> Your name and
              email address. You sign in with Google, so we receive the basic profile (name, email)
              that Google returns through our sign-in provider &mdash; we never see your Google
              password.
            </li>
            <li>
              <span className="font-medium text-ink">Lab activity.</span> Which labs you launch, your
              progress and results when you run &ldquo;Check my work,&rdquo; launch counts, and the
              completion status used to issue your certificate.
            </li>
            <li>
              <span className="font-medium text-ink">Order records.</span> For paid labs, the record
              of a purchase &mdash; amount, status, and a payment reference &mdash; needed to grant
              access and for accounting. We do not receive or store your full card details (see{" "}
              <a href="#payments" className="text-emerald-700 hover:underline">
                Payments
              </a>
              ).
            </li>
            <li>
              <span className="font-medium text-ink">Usage data.</span> Basic, privacy-respecting
              information about how the platform is used (such as pages visited and device type), to
              keep it working and improve it.
            </li>
          </ul>
        </section>

        <section id="how-we-use-it" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">How we use it</h2>
          <p className="mt-3">We use this data only to operate the labs platform:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Authenticating your sign-in and maintaining your account.</li>
            <li>
              Provisioning your lab environment, tracking your progress, grading your work, and
              enforcing per-lab launch limits.
            </li>
            <li>
              Granting access to paid labs and the monthly pass, and keeping the order records needed
              for accounting.
            </li>
            <li>
              Issuing your digitally signed completion certificate and letting anyone you share its
              link with verify it.
            </li>
            <li>Keeping the platform secure, reliable, and improving over time.</li>
          </ul>
          <p className="mt-3">
            We do not sell your personal data, and we do not use it for advertising.
          </p>
        </section>

        <section id="how-its-handled" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">How data is handled</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Sign-in and account authentication are handled by Amazon Cognito.</li>
            <li>
              Each lab runs inside a dedicated, isolated AWS account that is automatically wiped
              &mdash; every resource in it destroyed &mdash; once the lab ends or its timer expires.
              You never connect your own AWS account, and your work is not retained in that live
              environment.
            </li>
            <li>
              Account, order, and entitlement records are stored in AWS (Amazon DynamoDB, us-east-1)
              with backups enabled.
            </li>
            <li>
              Completion certificates are verified through private, unguessable links that are not
              publicly listed or searchable.
            </li>
          </ul>
        </section>

        <section id="payments" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Payments</h2>
          <p className="mt-3">
            Paid labs are processed by Paytm (Paytm Payments Services Ltd.), an RBI-authorised payment
            aggregator. Your card, UPI, and bank details are entered on Paytm&apos;s secure checkout
            and handled by Paytm &mdash; ShieldSync never sees or stores your full card details. We
            keep only the order records (such as amount, status, and a payment reference) needed to
            grant access and for accounting. Payment data handled by Paytm is stored in India in line
            with RBI requirements.
          </p>
        </section>

        <section id="sub-processors" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Sub-processors</h2>
          <p className="mt-3">We rely on the following sub-processors to run the platform:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-ink">Amazon Web Services (AWS)</span> &mdash; compute
              and storage, the isolated lab accounts, and authentication (Amazon Cognito).
            </li>
            <li>
              <span className="font-medium text-ink">Cloudflare</span> &mdash; application hosting and
              content delivery.
            </li>
            <li>
              <span className="font-medium text-ink">Google</span> &mdash; sign-in, when you choose to
              authenticate with your Google account.
            </li>
            <li>
              <span className="font-medium text-ink">Paytm</span> &mdash; payment processing for paid
              labs.
            </li>
          </ul>
          <p className="mt-3">
            ShieldSync Labs is built on AWS and Cloudflare infrastructure and is designed with
            security best practices in mind.
          </p>
        </section>

        <section id="hosting-transfer" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Hosting &amp; data transfer</h2>
          <p className="mt-3">
            The application itself runs on Cloudflare&apos;s global network. Lab provisioning, account
            data, and order records are processed and stored on AWS infrastructure in the us-east-1
            (Northern Virginia, United States) region. If you are located outside the United States,
            this means personal data is transferred to, and processed in, the United States as part
            of using the platform. Payment data handled by Paytm is stored in India. Where personal
            data crosses borders, we rely on appropriate safeguards and process it in accordance with
            India&apos;s DPDP Act, 2023.
          </p>
        </section>

        <section id="retention" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Retention &amp; deletion</h2>
          <p className="mt-3">
            We keep personal information only as long as needed for the purposes above &mdash; such as
            maintaining your account, honouring paid access, and keeping order records for accounting
            &mdash; or as required by law, after which it is deleted or anonymised. You may request
            deletion of your account and data at any time by emailing{" "}
            <a href="mailto:privacy@shieldsyncsecurity.com" className="text-emerald-700 hover:underline">
              privacy@shieldsyncsecurity.com
            </a>
            .
          </p>
        </section>

        <section id="your-rights" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Your rights</h2>
          <p className="mt-3">
            Depending on your location (including under India&apos;s DPDP Act, 2023 and the GDPR), you
            may have rights to access, correct, delete, or restrict use of your information, and to
            withdraw consent. To make a request, email{" "}
            <a href="mailto:privacy@shieldsyncsecurity.com" className="text-emerald-700 hover:underline">
              privacy@shieldsyncsecurity.com
            </a>
            .
          </p>
        </section>

        <section id="cookies" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Cookies</h2>
          <p className="mt-3">
            We use minimal cookies necessary for the platform to function &mdash; primarily to keep
            you signed in &mdash; and for privacy-respecting analytics. You can control cookies
            through your browser settings, though signing in requires a session cookie.
          </p>
        </section>

        <section id="security" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Security</h2>
          <p className="mt-3">
            We rely on AWS and Cloudflare&apos;s infrastructure controls, per-lab account isolation
            with automatic teardown, and unguessable, non-indexed certificate links as core parts of
            how we protect data. The platform is designed with security best practices in mind. No
            method of transmission or storage is perfectly secure, but we work to keep your data safe.
            If you believe you&apos;ve found a security issue, see our{" "}
            <a href="/.well-known/security.txt" className="text-emerald-700 hover:underline">
              security.txt
            </a>{" "}
            or email{" "}
            <a href="mailto:security@shieldsyncsecurity.com" className="text-emerald-700 hover:underline">
              security@shieldsyncsecurity.com
            </a>
            .
          </p>
        </section>

        <section id="children" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Children&apos;s data</h2>
          <p className="mt-3">
            ShieldSync Labs is a professional learning tool intended for use by adults building
            cloud-security skills. It is not directed at, and should not be used by, children.
          </p>
        </section>

        <section id="changes" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Changes to this policy</h2>
          <p className="mt-3">
            We may update this policy as the platform evolves. We&apos;ll update the &ldquo;Last
            updated&rdquo; date above when we do.
          </p>
        </section>

        <section id="contact" className="scroll-mt-24">
          <h2 className="text-lg font-semibold text-ink">Contact</h2>
          <p className="mt-3">
            General questions:{" "}
            <a href="mailto:info@shieldsyncsecurity.com" className="text-emerald-700 hover:underline">
              info@shieldsyncsecurity.com
            </a>
            . Privacy and data requests:{" "}
            <a href="mailto:privacy@shieldsyncsecurity.com" className="text-emerald-700 hover:underline">
              privacy@shieldsyncsecurity.com
            </a>
            . Security reports:{" "}
            <a href="mailto:security@shieldsyncsecurity.com" className="text-emerald-700 hover:underline">
              security@shieldsyncsecurity.com
            </a>
            . ShieldSync Security Private Limited, Noida, Uttar Pradesh, India.
          </p>
          <p className="mt-3">
            See also our{" "}
            <Link href="/terms" className="text-emerald-700 hover:underline">
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </article>
    </div>
  );
}
