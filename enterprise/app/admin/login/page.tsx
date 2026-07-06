import type { Metadata } from "next";
import AdminLoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Admin sign-in",
  robots: { index: false, follow: false },
};

// ShieldSync staff sign-in for the internal admin console. NOT the employer
// portal -- see lib/server/admin-session.ts for why the two are kept
// completely separate. Gate is a single shared secret (ADMIN_PANEL_SECRET)
// until Cognito ADMIN-group auth replaces it.
export default function AdminLoginPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-1px)] max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-bold text-ink">ShieldSync Admin</h1>
        <p className="mt-1 text-sm text-muted">ShieldSync staff only</p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Internal console. Not for employers -- if you are looking for the employer portal, see
          /portal instead.
        </div>

        <div className="mt-6">
          <AdminLoginForm />
        </div>
      </div>
    </div>
  );
}
