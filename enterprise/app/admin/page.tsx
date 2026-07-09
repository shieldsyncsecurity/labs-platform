import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import { entFetch } from "@/lib/server/ent-engine";
import AdminNav from "./_components/admin-nav";
import { Bar, formatDate } from "../r/_components/report-bits";

export const metadata: Metadata = {
  title: "Organizations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Org = {
  orgId?: string;
  name?: string;
  adminEmails?: string[];
  creditsTotal?: number;
  creditsUsed?: number;
  gstin?: string;
  status?: string;
  createdAt?: string;
};

export default async function AdminDashboardPage() {
  // getAdminSession() is the ONLY source of truth for "is this staff signed
  // in" -- never infer it from anything else on this page.
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  let orgs: Org[] = [];
  let orgsError: string | null = null;
  try {
    const data = await entFetch<{ orgs?: Org[] } | Org[]>("/ent/admin/orgs");
    orgs = Array.isArray(data) ? data : (data?.orgs ?? []);
  } catch {
    orgsError = "Could not load organizations right now.";
  }

  return (
    <div>
      <AdminNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">Organizations</h1>
            <p className="mt-1 text-sm text-muted">All employer accounts on the enterprise engine.</p>
          </div>
          <Link
            href="/admin/orgs/new"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            Create organization
          </Link>
        </div>

        <div className="mt-8">
          {orgsError ? (
            <div className="rounded-xl border border-line bg-surface px-6 py-8 text-center text-sm text-rose-700">
              {orgsError}
            </div>
          ) : orgs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
              <p className="text-ink-soft">No organizations yet.</p>
              <Link
                href="/admin/orgs/new"
                className="mt-3 inline-block text-sm font-semibold text-brand-strong hover:underline"
              >
                Create the first organization →
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                      <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Credits</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                  {orgs.map((org, i) => {
                    const total = org.creditsTotal ?? 0;
                    const used = org.creditsUsed ?? 0;
                    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
                    return (
                      <tr
                        key={org.orgId ?? i}
                        className="border-b border-line last:border-b-0 hover:bg-canvas"
                      >
                        <td className="px-4 py-3">
                          {org.orgId ? (
                            <Link
                              href={`/admin/orgs/${encodeURIComponent(org.orgId)}`}
                              className="font-semibold text-ink hover:text-brand-strong hover:underline"
                            >
                              {org.name ?? "Untitled org"}
                            </Link>
                          ) : (
                            <span className="font-semibold text-ink">{org.name ?? "Untitled org"}</span>
                          )}
                          {org.orgId ? (
                            <div className="mt-0.5 font-mono text-xs text-muted">{org.orgId}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-40">
                            <div className="flex items-center justify-between text-xs text-ink-soft">
                              <span>{used}</span>
                              <span className="text-muted">/ {total}</span>
                            </div>
                            <div className="mt-1">
                              <Bar pct={pct} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink-soft">{org.status ?? "—"}</td>
                        <td className="px-4 py-3 text-ink-soft">{formatDate(org.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
