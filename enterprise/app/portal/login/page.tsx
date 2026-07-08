import type { Metadata } from "next";
import DevLoginForm from "./login-form";
import { cognitoEnabled } from "@/lib/server/cognito";

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

// Employer portal sign-in. Uses Cognito Hosted-UI SSO when configured
// (cognitoEnabled); falls back to the temporary paste-an-orgId dev form only
// when Cognito env is absent -- see lib/server/portal-session.ts.
export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMsg = error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : null;
  const sso = cognitoEnabled();

  return (
    <div className="mx-auto flex min-h-[calc(100vh-1px)] max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-bold text-ink">ShieldSync Enterprise</h1>
        <p className="mt-1 text-sm text-muted">Employer portal</p>

        {errorMsg ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
            <p className="mt-3 text-center text-xs text-muted">
              Sign in with the email your ShieldSync administrator invited. Need access? Ask your
              admin for an invite.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
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
  );
}
