"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Orders / invoices panel for one org: the billing history table, a "Record
// order" inline form (offline GST invoice -> engine POST /ent/orders, starts
// "created", grants nothing yet), and a two-step "Mark paid" per created order
// (engine flips created->paid and grants the credits atomically, exactly once).
// The org detail page fetched the orders server-side and passes them in; after
// any action we router.refresh() so the server re-reads engine state (same
// pattern as adjust-credits-form / delete-org-button).

export type OrderRow = {
  orderId?: string;
  invoiceNo?: string;
  credits?: number;
  status?: string;
  createdAt?: string;
  paidAt?: string;
};

function formatDateTime(value?: string): string {
  if (!value) return "\u2014";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusPill({ status }: { status?: string }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Paid
      </span>
    );
  }
  if (status === "created") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Awaiting payment
      </span>
    );
  }
  return <span className="text-xs text-muted">{status ?? "\u2014"}</span>;
}

function MarkPaidButton({
  orderId,
  credits,
  onDone,
}: {
  orderId: string;
  credits: number;
  onDone: (message: string | null, error: string | null) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleMarkPaid() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/orders/paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onDone(null, data?.error ?? "Could not mark the order paid.");
        setBusy(false);
        setConfirming(false);
        return;
      }
      onDone(
        data?.alreadyPaid
          ? "Order was already marked paid; no credits were granted twice."
          : `Order marked paid. ${data?.creditsGranted ?? credits} credits granted.`,
        null,
      );
      router.refresh();
    } catch {
      onDone(null, "Could not reach the server. Try again.");
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong"
      >
        Mark paid
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-soft">Grant {credits} credits?</span>
      <button
        type="button"
        onClick={handleMarkPaid}
        disabled={busy}
        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Marking..." : "Yes, paid"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-canvas disabled:opacity-60"
      >
        Cancel
      </button>
    </span>
  );
}

export default function OrdersSection({ orgId, orders }: { orgId: string; orders: OrderRow[] }) {
  const router = useRouter();
  const [credits, setCredits] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleRecordOrder(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setActionMessage(null);
    setActionError(null);
    const parsed = Number(credits);
    if (!credits.trim() || !Number.isInteger(parsed) || parsed <= 0 || parsed > 10000) {
      setFormError("Enter a whole number of credits between 1 and 10000.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          credits: parsed,
          invoiceNo: invoiceNo.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data?.error ?? "Could not record the order.");
        setPending(false);
        return;
      }
      setCredits("");
      setInvoiceNo("");
      setNote("");
      setActionMessage("Order recorded. Mark it paid once the invoice is settled to grant the credits.");
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink-soft">Orders / invoices</h2>
      <p className="mt-1 text-xs text-muted">
        Offline billing: record the invoice when it is raised, then mark it paid when the money
        lands &mdash; marking paid grants the credits to the org exactly once.
      </p>

      {orders.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-canvas px-4 py-6 text-center text-sm text-ink-soft">
          No orders recorded for this org yet.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Invoice</th>
                <th className="px-4 py-2.5 font-semibold">Credits</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Created</th>
                <th className="px-4 py-2.5 font-semibold">Paid</th>
                <th className="px-4 py-2.5 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.orderId ?? i} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-3">
                    {o.invoiceNo ? (
                      <span className="font-mono text-xs text-ink">{o.invoiceNo}</span>
                    ) : (
                      <span className="text-xs text-muted">&mdash;</span>
                    )}
                    {o.orderId ? (
                      <div className="mt-0.5 font-mono text-[10px] text-muted">{o.orderId}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-ink">{o.credits ?? 0}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{formatDateTime(o.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{formatDateTime(o.paidAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {o.status === "created" && o.orderId ? (
                      <MarkPaidButton
                        orderId={o.orderId}
                        credits={o.credits ?? 0}
                        onDone={(msg, err) => {
                          setActionMessage(msg);
                          setActionError(err);
                        }}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {actionMessage ? <p className="mt-3 text-sm text-emerald-700">{actionMessage}</p> : null}
      {actionError ? <p className="mt-3 text-sm text-rose-700">{actionError}</p> : null}

      <div className="mt-5 border-t border-line pt-5">
        <h3 className="text-sm font-semibold text-ink-soft">Record order</h3>
        <form onSubmit={handleRecordOrder} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="orderCredits" className="mb-1 block text-xs font-medium text-ink-soft">
              Credits
            </label>
            <input
              id="orderCredits"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              placeholder="e.g. 50"
              className="w-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label htmlFor="orderInvoiceNo" className="mb-1 block text-xs font-medium text-ink-soft">
              Invoice no <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="orderInvoiceNo"
              type="text"
              maxLength={64}
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder="e.g. SS-ENT-2026-014"
              className="w-48 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div className="min-w-56 flex-1">
            <label htmlFor="orderNote" className="mb-1 block text-xs font-medium text-ink-soft">
              Note <span className="font-normal text-muted">(optional, internal)</span>
            </label>
            <input
              id="orderNote"
              type="text"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. PO ref / payment terms"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Recording..." : "Record order"}
          </button>
        </form>
        {formError ? <p className="mt-2 text-xs text-rose-700">{formError}</p> : null}
      </div>
    </div>
  );
}
