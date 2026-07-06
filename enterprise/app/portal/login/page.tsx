import type { Metadata } from "next";
import DevLoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

// Employer portal sign-in. TEMPORARY: this is a dev-only login (paste an org
// id, no password) until Cognito enterprise-pool auth (email+password+TOTP)
// replaces it -- see lib/server/portal-session.ts and
// app/api/portal/dev-login/route.ts for the exact TODOs.
export default function PortalLoginPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-1px)] max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-bold text-ink">ShieldSync Enterprise</h1>
        <p className="mt-1 text-sm text-muted">Employer portal</p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Dev sign-in (temporary — real SSO coming). Paste the org id ShieldSync provisioned
          for you.
        </div>

        <div className="mt-6">
          <DevLoginForm />
        </div>
      </div>
    </div>
  );
}
