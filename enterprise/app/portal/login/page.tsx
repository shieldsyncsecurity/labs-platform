import type { Metadata } from "next";
import DevLoginForm from "./login-form";
import { cognitoEnabled } from "@/lib/server/cognito";
import { Logo, ShieldMark } from "@/components/brand";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

// User-facing text for the ?error= codes the Cognito callback can redirect with.
const ERRORS: Record<string, string> = {
  sso: "Sign-in was cancelled or didn't complete. Please try again.",
  missing_code: "Sign-in didn't complete. Please try again.",
  state: "Your sign-in session expired. Please try again.",
  token: "We couldn't complete your sign-in. Please try again.",
  verify: "We couldn't verify your sign-in. Please try again.",
  exchange: "We couldn't verify your sign-in. Please try again.",
  no_access:
    "That account isn't linked to an organization yet. Contact your ShieldSync administrator.",
};

const VALUE_POINTS = [
  "Candidates solve a real task in a live, isolated AWS account",
  "Auto-graded on what they actually did — not a multiple-choice quiz",
  "A private, verifiable report for every candidate",
];

// Employer portal sign-in. Split layout: a branded panel (desktop) alongside a
// clean sign-in column, so an employer's first impression reads as a mature
// product rather than a bare card. Uses Cognito Hosted-UI SSO when configured;
// falls back to the temporary dev form only when Cognito env is absent.
export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMsg = error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : null;
  const sso = cognitoEnabled();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — desktop only */}
      <div className="relative hidden overflow-hidden bg-[#0a1020] lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full"
          style={{ background: "radial-gradient(circle,rgba(217,119,6,0.30),transparent 70%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full"
          style={{ background: "radial-gradient(circle,rgba(217,119,6,0.12),transparent 70%)" }}
        />

        <div className="relative flex items-center gap-2.5">
          <ShieldMark size={30} />
          <span className="flex items-center gap-2 whitespace-nowrap text-[17px] font-extrabold leading-none tracking-tight text-white">
            <span>
              Shield<span className="text-[#fbbf24]">Sync</span>
            </span>
            <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
              Enterprise
            </span>
          </span>
        </div>

        <div className="relative">
          <h2 className="max-w-md text-2xl font-bold leading-snug text-white sm:text-3xl">
            Hire cloud security engineers on proof, not trivia.
          </h2>
          <ul className="mt-6 space-y-3">
            {VALUE_POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-white/70">
                <svg
                  className="mt-0.5 h-4 w-4 flex-none text-[#fbbf24]"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 111.4-1.4l2.3 2.29 6.3-6.29a1 1 0 011.4 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">© ShieldSync Security Private Limited</p>
      </div>

      {/* Sign-in column */}
      <div className="flex items-center justify-center bg-canvas px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo href={null} />
          </div>

          <h1 className="text-2xl font-bold text-ink">Employer portal</h1>
          <p className="mt-1 text-sm text-muted">
            Sign in to create assessments and invite candidates.
          </p>

          {errorMsg ? (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {errorMsg}
            </div>
          ) : null}

          {sso ? (
            <div className="mt-6">
              <a
                href="/api/auth/login"
                className="flex w-full items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong"
              >
                Sign in
              </a>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Sign in with the email your ShieldSync administrator invited. Need access? Ask your
                admin for an invite.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Dev sign-in (temporary — real SSO coming). Paste the org id ShieldSync provisioned
                for you.
              </div>
              <div className="mt-6">
                <DevLoginForm />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
