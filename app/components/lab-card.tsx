import Link from "next/link";
import type { Lab } from "@/lib/labs";
import { priceFor, formatMoney } from "@/lib/payments/pricing";

const levelClass: Record<Lab["level"], string> = {
  Beginner: "badge-beginner",
  Intermediate: "badge-intermediate",
  Advanced: "badge-advanced",
};

/**
 * Catalog card. The WHOLE card is the link (a 44px "Open lab" button was the only
 * click target before — everything else was dead space); the inner "Open lab"
 * pill is presentational. Paid labs show their price on the card, so a buyer
 * isn't clicking through just to discover the number the plan picker above
 * already promised. Labs from a non-AWS track carry a track chip — the page is
 * titled "AWS Security Labs", so an unlabeled Azure lab reads as a mistake.
 */
export function LabCard({ lab }: { lab: Lab }) {
  const body = (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${levelClass[lab.level]}`}>
          {lab.level}
        </span>
        {lab.track === "azure" && (
          <span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">Azure</span>
        )}
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
        <span className="text-sm text-muted">
          ~{lab.estimatedActiveMinutes} min
          {lab.ready && !lab.free && (
            <> · <span className="font-semibold text-ink">{formatMoney(priceFor(lab.slug, "per-lab", "INR"), "INR")}</span></>
          )}
        </span>
        {lab.ready ? (
          <span className="rounded-lg bg-brand px-4 py-2 text-[15px] font-semibold text-white transition group-hover:bg-brand-strong">
            Open lab
          </span>
        ) : (
          <span className="rounded-lg border border-line px-4 py-2 text-[15px] font-semibold text-muted">
            Soon
          </span>
        )}
      </div>
    </>
  );

  const shell = "flex h-full flex-col rounded-2xl border border-line bg-surface p-5";

  return lab.ready ? (
    <Link
      href={`/labs/${lab.slug}`}
      className={`${shell} group transition duration-200 hover:-translate-y-0.5 hover:border-brand/60 hover:shadow-md motion-reduce:hover:translate-y-0`}
    >
      {body}
    </Link>
  ) : (
    <div className={`${shell} opacity-75`}>{body}</div>
  );
}
