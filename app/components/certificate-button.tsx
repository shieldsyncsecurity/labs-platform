"use client";

// F3 — shared "Download your certificate" CTA. Used from lab-panel.tsx's
// all-green passed state AND the dashboard (durable re-download after the lab
// account is wiped) — both just need a labSlug + a button label; this owns
// the fetch-then-open-modal flow so neither caller duplicates it.
//
// Fetches /api/certificate?labSlug=... on click (not eagerly — most learners
// never click it, and it's a real DynamoDB round-trip via the engine), which
// itself re-derives everything server-side from the verified session +
// listCompletions — so this component never has access to (and can't spoof)
// a credentialId for a lab that wasn't actually passed.

import { useState } from "react";
import { Certificate, type CertificateData } from "@/components/certificate";

type FetchState = "idle" | "loading" | "error";

export function CertificateButton({
  labSlug,
  className,
  label = "Download your certificate 🎓",
}: {
  labSlug: string;
  className?: string;
  label?: string;
}) {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<CertificateData | null>(null);

  async function open() {
    if (state === "loading") return;
    setState("loading");
    try {
      const r = await fetch(`/api/certificate?labSlug=${encodeURIComponent(labSlug)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("not available");
      const d = (await r.json()) as { credentialId: string; name: string; labTitle: string; completedAt: string };
      setData({ name: d.name, labTitle: d.labTitle, completedAt: d.completedAt, credentialId: d.credentialId });
      setState("idle");
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={state === "loading"}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-xl border border-line-strong bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-60"
        }
      >
        {state === "loading" ? "Loading your certificate…" : state === "error" ? "Couldn't load — try again" : label}
      </button>
      {data && <Certificate data={data} onClose={() => setData(null)} />}
    </>
  );
}
