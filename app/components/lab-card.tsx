import Link from "next/link";
import type { Lab } from "@/lib/labs";

const levelClass: Record<Lab["level"], string> = {
  Beginner: "badge-beginner",
  Intermediate: "badge-intermediate",
  Advanced: "badge-advanced",
};

export function LabCard({ lab }: { lab: Lab }) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-5 transition hover:border-line-strong hover:shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${levelClass[lab.level]}`}>
          {lab.level}
        </span>
        {lab.free && (
          <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">FREE</span>
        )}
        {!lab.ready && (
          <span className="rounded-md bg-canvas px-2 py-0.5 text-xs font-bold text-muted">Coming soon</span>
        )}
      </div>

      <h3 className="text-lg font-extrabold text-ink">{lab.title}</h3>
      <p className="mt-1.5 flex-1 text-base text-ink-soft">{lab.summary}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {lab.tags.map((t) => (
          <span key={t} className="rounded-md border border-line px-2 py-0.5 font-mono text-xs text-muted">
            {t}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">~{lab.estimatedActiveMinutes} min</span>
        {lab.ready ? (
          <Link
            href={`/labs/${lab.slug}`}
            className="rounded-lg bg-brand px-4 py-2 text-[15px] font-semibold text-white hover:bg-brand-strong"
          >
            Open lab
          </Link>
        ) : (
          <span className="rounded-lg border border-line px-4 py-2 text-[15px] font-semibold text-muted">
            Soon
          </span>
        )}
      </div>
    </div>
  );
}
