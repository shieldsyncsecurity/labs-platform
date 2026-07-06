"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// MVP lab catalog. Hardcoded per the build brief -- when more labs are
// available for assessments, extend this list (and keep it in sync with
// whatever labSlugs the engine actually recognizes for /ent/assessments).
const LAB_OPTIONS = [
  { slug: "s3-misconfiguration-audit", label: "AWS S3 Security Remediation" },
];

export default function NewAssessmentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [labSlug, setLabSlug] = useState(LAB_OPTIONS[0].slug);
  const [hintsOn, setHintsOn] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name for this assessment.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/portal/assessments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, labSlug, hintsOn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not create assessment.");
        setPending(false);
        return;
      }
      const assessmentId = data?.assessmentId ?? data?.assessment?.assessmentId;
      if (assessmentId) {
        router.push(`/portal/assessments/${encodeURIComponent(assessmentId)}`);
      } else {
        // Engine returned success but no id we recognize -- fall back to the
        // dashboard rather than guessing a route.
        router.push("/portal");
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
          Assessment name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Senior Cloud Security Engineer — Round 2"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor="labSlug" className="mb-1 block text-sm font-medium text-ink-soft">
          Lab
        </label>
        <select
          id="labSlug"
          value={labSlug}
          onChange={(e) => setLabSlug(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        >
          {LAB_OPTIONS.map((opt) => (
            <option key={opt.slug} value={opt.slug}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="hintsOn"
          type="checkbox"
          checked={hintsOn}
          onChange={(e) => setHintsOn(e.target.checked)}
          className="h-4 w-4 rounded border-line text-brand focus:ring-brand/40"
        />
        <label htmlFor="hintsOn" className="text-sm text-ink-soft">
          Show in-lab hints to candidates
        </label>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create assessment"}
      </button>
    </form>
  );
}
