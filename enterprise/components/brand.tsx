import Link from "next/link";

/**
 * ShieldSync ENTERPRISE wordmark. Mirrors the labs app's "Shield Sync + LABS pill"
 * lockup, but on this app's light/indigo theme and with an "ENTERPRISE" tag. Pure
 * inline SVG + text (no image asset needed). Renders as a link to `href` (default /).
 */
export function Logo({
  href = "/",
  className = "",
  tag = true,
}: {
  href?: string | null;
  className?: string;
  tag?: boolean;
}) {
  const inner = (
    <span className={`inline-flex items-center gap-2.5 font-extrabold text-ink ${className}`}>
      <ShieldMark className="h-7 w-7 flex-none" />
      <span className="flex items-center gap-2 whitespace-nowrap text-[17px] leading-none">
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

/** The shield mark: rounded shield, indigo->blue gradient, a crisp white check
 *  (verification = the heart of the assessment product). Decorative. */
export function ShieldMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="ShieldSync" fill="none">
      <defs>
        <linearGradient id="ss-ent-shield" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5l10.5 3.6v8.2c0 6.7-4.4 12-10.5 14.2C9.9 26.3 5.5 21 5.5 14.3V6.1L16 2.5z"
        fill="url(#ss-ent-shield)"
      />
      <path
        d="M11 16.2l3.3 3.3 6.7-7"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
