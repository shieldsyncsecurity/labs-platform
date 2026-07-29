import Link from "next/link";

/**
 * Shared "you need to sign in" empty state — was duplicated (and top-pinned,
 * leaving ~2/3 of the viewport empty) across /account and /dashboard. One
 * component so both stay visually consistent and any future fix lands once.
 */
export function SignedOutNotice({
  heading,
  sub,
  cta = "Sign in",
  href = "/sign-in",
}: {
  heading: string;
  sub: string;
  cta?: string;
  href?: string;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-66px)] items-center justify-center px-5 py-10 text-center">
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-ink">{heading}</h1>
        <p className="mt-2 text-base text-ink-soft">{sub}</p>
        <Link
          href={href}
          className="mt-6 inline-block rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong"
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
