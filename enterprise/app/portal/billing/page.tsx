import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrgId } from "@/lib/server/portal-session";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getBlockingAgreement } from "@/lib/server/agreement-gate";
import PortalNav from "../_components/portal-nav";
import { formatDate } from "../../r/_components/report-bits";

export const metadata: Metadata = {
  title: "Billing",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Org = {
  orgId?: string;
  name?: string;
  creditsTotal?: number;
  creditsUsed?: number;
};

type Order = {
  orderId?: string;
  orgId?: string;
  credits?: number;
  amount?: number;
  currency?: string;
  status?: string;
  createdAt?: string;
};

const CONTACT_EMAIL = "hello@shieldsyncsecurity.com";

// Format an order amount as real currency (major units, e.g. 249 -> ₹249.00).
function formatMoney(amount?: number, currency?: string): string {
  if (typeof amount !== "number") return "—";
  const cur = (currency ?? "INR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: cur }).format(amount);
  } catch {
    return `${cur} ${amount.toLocaleString()}`;
  }
}

// Employer-facing order status -> a coloured pill (Paid/Pending/Failed).
function OrderStatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  const style =
    s === "paid"
      ? "bg-emerald-100 text-emerald-800"
      : s === "pending"
        ? "bg-amber-100 text-amber-800"
        : s === "failed" || s === "cancelled"
          ? "bg-rose-100 text-rose-700"
          : "bg-line text-ink-soft";
  const label = s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}

export default async function BillingPage() {
  const orgId = await getOrgId();
  if (!orgId) {
    redirect("/portal/login");
  }

  // Agreement gate (W3-5): an issued-unaccepted agreement blocks the portal.
  const blocking = await getBlockingAgreement(orgId);
  if (blocking?.agreementId) {
    redirect(`/portal/agreements/${encodeURIComponent(blocking.agreementId)}/accept`);
  }

  let org: Org | null = null;
  let orgError: string | null = null;
  try {
    org = await entFetch<Org>("/ent/orgs", { query: { orgId } });
  } catch (err) {
    orgError =
      err instanceof EntEngineError && err.status === 404
        ? "Org not found."
        : "Could not load your account right now.";
  }

  let orders: Order[] = [];
  let ordersError: string | null = null;
  try {
    const data = await entFetch<Order[] | { orders?: Order[] }>("/ent/orders", {
      query: { orgId },
    });
    orders = Array.isArray(data) ? data : (data?.orders ?? []);
  } catch {
    ordersError = "Could not load order history right now.";
  }

  const creditsTotal = org?.creditsTotal ?? 0;
  const creditsUsed = org?.creditsUsed ?? 0;
  const creditsRemaining = Math.max(0, creditsTotal - creditsUsed);

  const subject = encodeURIComponent("Request more assessment credits");
  // Do NOT embed the raw orgId here -- orgId is effectively a bearer secret for
  // this org, and a mailto body ends up in mail clients / forwarded support
  // threads. The authenticated requester's email + org name is enough for
  // ShieldSync to identify the account.
  const body = encodeURIComponent(
    `Hi ShieldSync team,\n\nWe'd like to add more assessment credits to our account${
      org?.name ? ` (${org.name})` : ""
    }.\n\nThanks!`,
  );
  const mailtoHref = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;

  return (
    <div>
      <PortalNav orgId={orgId} />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Billing</h1>
        <p className="mt-1 text-sm text-muted">Credits and order history for your account.</p>

        {/* Credits summary */}
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          {orgError ? (
            <p className="text-sm text-rose-700">{orgError}</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-ink-soft">Credits remaining</h2>
                <p className="mt-1 text-3xl font-bold text-ink">
                  {creditsRemaining}
                  <span className="ml-1 text-base font-normal text-muted">/ {creditsTotal}</span>
                </p>
                <p className="mt-1 text-xs text-muted">
                  {creditsUsed} used · each candidate invite uses 1 credit
                </p>
              </div>
              <div className="shrink-0 text-right">
                <a
                  href={mailtoHref}
                  className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Request more credits
                </a>
                <p className="mt-1.5 text-xs text-muted">
                  or email{" "}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-brand-strong">
                    {CONTACT_EMAIL}
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Order history */}
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Order history</h2>
          {ordersError ? (
            <p className="text-sm text-rose-700">{ordersError}</p>
          ) : orders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-soft">
              No orders yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                    <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Credits</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Amount</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o, i) => (
                    <tr key={o.orderId ?? i} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-3 text-ink-soft">{formatDate(o.createdAt)}</td>
                      <td className="px-4 py-3 text-ink">{o.credits ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-soft">{formatMoney(o.amount, o.currency)}</td>
                      <td className="px-4 py-3">
                        <OrderStatusBadge status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
