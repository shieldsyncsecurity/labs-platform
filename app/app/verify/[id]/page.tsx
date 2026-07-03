import type { Metadata } from "next";
import Link from "next/link";
import { getCredential } from "@/lib/server/store";
import { getLab } from "@/lib/labs";

// F3 — public credential verification page. No auth required: the whole point
// is that anyone (a recruiter, a hiring manager) holding a shared certificate
// link can confirm it's real. Server component — calls the engine directly
// (via getCredential -> engineFetch) rather than round-tripping through an
// API route, same pattern as labs/[slug]/page.tsx's listEntitlements call.

const APP_URL = "https://labs.shieldsyncsecurity.com";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const credential = await getCredential(id).catch(() => null);
  const url = `${APP_URL}/verify/${encodeURIComponent(id)}`;

  if (!credential) {
    return {
      title: "Credential not found",
      robots: { index: false, follow: false },
      alternates: { canonical: url },
    };
  }

  const lab = getLab(credential.labSlug);
  const labTitle = lab?.title ?? credential.labSlug;
  const title = `${credential.name} — ${labTitle} · Verified ShieldSync Credential`;
  const description = `${credential.name} completed the "${labTitle}" hands-on AWS security lab on ${fmtDate(
    credential.firstCompletedAt
  )}. Credential ${credential.credentialId}, verified by ShieldSync Security Labs.`;

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "profile",
      title,
      description,
      url,
      siteName: "ShieldSync Labs",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const credential = await getCredential(id).catch(() => null);

  if (!credential) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fef2f2] text-2xl" aria-hidden>
          ✕
        </div>
        <h1 className="mt-4 text-2xl font-extrabold text-ink">Credential not found</h1>
        <p className="mt-2 text-base text-ink-soft">
          We couldn&apos;t verify <span className="font-mono text-sm">{id}</span>. It may be mistyped, or the
          credential doesn&apos;t exist.
        </p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
          Explore ShieldSync Labs
        </Link>
      </div>
    );
  }

  const lab = getLab(credential.labSlug);
  const labTitle = lab?.title ?? credential.labSlug;

  return (
    <div className="mx-auto max-w-lg px-5 py-16">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="h-[3px] w-full bg-gradient-to-r from-brand to-cyan" aria-hidden />
        <div className="p-6 text-center sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl" aria-hidden>
            ✓
          </div>
          <p className="mt-3 text-sm font-bold uppercase tracking-wider text-emerald-700">Valid credential</p>
          <h1 className="mt-2 text-2xl font-extrabold text-ink">{credential.name}</h1>
          <p className="mt-2 text-base leading-6 text-ink-soft">
            completed the hands-on security lab
            <br />
            <span className="text-lg font-bold text-ink">{labTitle}</span>
          </p>
          <p className="mt-3 text-sm text-muted">on {fmtDate(credential.firstCompletedAt)}</p>

          <div className="mt-6 flex flex-col gap-2 rounded-xl border border-line bg-canvas p-4 text-left text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-semibold text-muted">Credential ID</span>
              <span className="font-mono text-ink">{credential.credentialId}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="font-semibold text-muted">Issued by</span>
              <span className="text-ink">ShieldSync Security Labs</span>
            </div>
          </div>

          {lab && (
            <Link
              href={`/labs/${lab.slug}`}
              className="mt-6 inline-block rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong"
            >
              View this lab →
            </Link>
          )}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted">
        This page confirms the credential was issued by ShieldSync Security Labs based on a live, auto-graded AWS
        lab — not a self-reported claim.
      </p>
    </div>
  );
}
