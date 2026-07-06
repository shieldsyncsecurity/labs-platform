import Link from "next/link";

/**
 * ShieldSync ENTERPRISE wordmark. Uses the REAL ShieldSync brand mark (the
 * navy tile + "S" reticle), tinted INDIGO for the enterprise property — the
 * same way the labs property tints it emerald ("LABS"). Wordmark = "Shield" +
 * "Sync" (Sync in the brand indigo, matching the marketing site) + an
 * "ENTERPRISE" tag pill. Renders as a link to `href` (default /).
 */
export function Logo({
  href = "/",
  className = "",
  tag = true,
  size = 28,
}: {
  href?: string | null;
  className?: string;
  tag?: boolean;
  size?: number;
}) {
  const inner = (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <ShieldMark size={size} />
      <span className="flex items-center gap-2 whitespace-nowrap text-[17px] font-extrabold leading-none tracking-tight text-ink">
        <span>
          Shield<span className="text-brand">Sync</span>
        </span>
        {tag ? (
          <span className="rounded-full border border-brand/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
            Enterprise
          </span>
        ) : null}
      </span>
    </span>
  );

  if (href === null) return inner;
  return (
    <Link href={href} className="inline-flex shrink-0 items-center" aria-label="ShieldSync Enterprise home">
      {inner}
    </Link>
  );
}

/** The base ShieldSync mark (indigo tile). Decorative. */
export function ShieldMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo/shieldsync-enterprise-mark.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ height: size, width: size }}
      className={`flex-none select-none rounded-[22%] ${className}`}
      draggable={false}
    />
  );
}
