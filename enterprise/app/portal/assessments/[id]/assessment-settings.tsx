"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Inline assessment settings (W3B-4): rename + in-lab hints toggle. Saves to
// /api/portal/assessments/update (org-ownership re-checked server-side), then
// router.refresh() so the header re-renders from engine truth rather than
// optimistic state. Save is disabled until something actually changed.

export default function AssessmentSettings({
  assessmentId,
  initialName,
  initialHintsOn,
}: {
  assessmentId: string;
  initialName: string;
  initialHintsOn: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [hintsOn, setHintsOn] = useState(initialHintsOn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = name.trim() !== initialName.trim() || hintsOn !== initialHintsOn;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name for this assessment.");
      return;
    }
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const res = await fetch("/api/portal/assessments/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessmentId, name: trimmed, hintsOn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not update assessment.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink-soft">Settings</h2>

      <div className="mt-3 space-y-4">
        <div>
          <label
            htmlFor="assessment-name"
            className="mb-1 block text-xs font-medium text-ink-soft"
          >
            Assessment name
          </label>
          <input
            id="assessment-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
              setError(null);
            }}
            className="w-full max-w-lg rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="assessment-hints"
            type="checkbox"
            checked={hintsOn}
            onChange={(e) => {
              setHintsOn(e.target.checked);
              setSaved(false);
              setError(null);
            }}
            className="h-4 w-4 rounded border-line text-brand focus:ring-brand/40"
          />
          <label htmlFor="assessment-hints" className="text-sm text-ink-soft">
            Show in-lab hints to candidates
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save settings"}
          </button>
          {saved && !dirty ? (
            <span className="text-xs font-medium text-emerald-700">Saved</span>
          ) : null}
          {error ? <span className="text-sm text-rose-700">{error}</span> : null}
        </div>
      </div>
    </div>
  );
}
