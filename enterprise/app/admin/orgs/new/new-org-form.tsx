"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [adminEmails, setAdminEmails] = useState("");
  const [creditsTotal, setCreditsTotal] = useState("0");
  const [gstin, setGstin] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [agreementVersion, setAgreementVersion] = useState("v1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter an organization name.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          adminEmails,
          creditsTotal,
          gstin,
          billingAddress,
          agreementVersion,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not create organization.");
        setPending(false);
        return;
      }
      const orgId = data?.orgId ?? data?.org?.orgId;
      if (orgId) {
        router.push(`/admin/orgs/${encodeURIComponent(orgId)}`);
      } else {
        router.push("/admin");
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium text-ink-soft">
          Organization name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Appstean Infotech"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor="adminEmails" className="mb-1 block text-sm font-medium text-ink-soft">
          Admin email(s)
        </label>
        <input
          id="adminEmails"
          type="text"
          value={adminEmails}
          onChange={(e) => setAdminEmails(e.target.value)}
          placeholder="comma-separated, e.g. hr@acme.com, cto@acme.com"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor="creditsTotal" className="mb-1 block text-sm font-medium text-ink-soft">
          Starting credits
        </label>
        <input
          id="creditsTotal"
          type="number"
          min={0}
          value={creditsTotal}
          onChange={(e) => setCreditsTotal(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor="gstin" className="mb-1 block text-sm font-medium text-ink-soft">
          GSTIN
        </label>
        <input
          id="gstin"
          type="text"
          value={gstin}
          onChange={(e) => setGstin(e.target.value)}
          placeholder="optional"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor="billingAddress" className="mb-1 block text-sm font-medium text-ink-soft">
          Billing address
        </label>
        <textarea
          id="billingAddress"
          rows={3}
          value={billingAddress}
          onChange={(e) => setBillingAddress(e.target.value)}
          placeholder="optional"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor="agreementVersion" className="mb-1 block text-sm font-medium text-ink-soft">
          Agreement version
        </label>
        <input
          id="agreementVersion"
          type="text"
          value={agreementVersion}
          onChange={(e) => setAgreementVersion(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
