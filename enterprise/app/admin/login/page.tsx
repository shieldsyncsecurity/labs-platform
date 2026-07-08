import type { Metadata } from "next";
import AdminLoginForm from "./login-form";
import { cognitoEnabled } from "@/lib/server/cognito";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

// ShieldSync staff sign-in for the internal admin console. NOT the employer
// portal -- see lib/server/admin-session.ts for why the two are kept
// completely separate. Uses Cognito Hosted-UI SSO when configured (the callback
// routes an ADMIN_EMAILS address here); falls back to the shared-secret form
// only when Cognito env is absent.
//
// Copy is intentionally neutral: this page is publicly reachable, so it must
// NOT advertise that it is a staff/admin console or point unauthenticated
// visitors at the employer portal. Just a plain, unremarkable sign-in.
export default function AdminLoginPage() {
  const sso = cognitoEnabled();
  return (
    <div className="mx-auto flex min-h-[calc(100vh-1px)] max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-bold text-ink">ShieldSync</h1>
        <p className="mt-1 text-sm text-muted">Sign in to continue</p>

        {sso ? (
          <div className="mt-6">
            <a
              href="/api/auth/login"
              className="flex w-full items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong"
            >
              Sign in with ShieldSync
            </a>
          </div>
        ) : (
          <div className="mt-6">
            <AdminLoginForm />
          </div>
        )}
      </div>
    </div>
  );
}
