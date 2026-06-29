import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { LABS } from "@/lib/labs";
import { LabCard } from "@/components/lab-card";
import { LabRequest } from "@/components/lab-request";
import { AutoCheckout } from "@/components/auto-checkout";

const FREE_SLUG = "s3-misconfiguration-audit";
const MARKETING_WIZARD = "https://shieldsyncsecurity.com/labs-wizard";
const APP_URL = "https://labs.shieldsyncsecurity.com";

export const metadata: Metadata = {
  title: "AWS Security Labs — Hands-on Cloud Security in Real AWS",
  description:
    "Browse hands-on AWS security labs that spin up real, isolated AWS accounts in your browser. Practice IAM, S3 misconfiguration, encryption, GuardDuty, VPC. First lab free.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "AWS Security Labs — Hands-on Cloud Security in Real AWS",
    description: "Real, isolated AWS accounts in your browser. First lab free.",
    url: APP_URL,
    type: "website",
  },
};

export default function CatalogPage() {
  const live = LABS.filter((l) => l.ready).length;
  const liveItems = LABS.filter((l) => l.ready);
  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${APP_URL}/#labs`,
    name: "AWS Security Labs catalog",
    numberOfItems: liveItems.length,
    itemListElement: liveItems.map((l, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${APP_URL}/labs/${l.slug}`,
      item: {
        "@type": "Course",
        name: `${l.title} — AWS Security Lab`,
        description: l.summary,
        url: `${APP_URL}/labs/${l.slug}`,
        provider: { "@type": "Organization", name: "ShieldSync Security", url: "https://shieldsyncsecurity.com" },
        educationalLevel: l.level,
        inLanguage: "en",
        offers: {
          "@type": "Offer",
          price: l.free ? "0" : "99",
          priceCurrency: "INR",
          availability: "https://schema.org/InStock",
        },
      },
    })),
  };

  return (
    <div className="mx-auto max-w-[1536px] px-4 py-10 sm:px-6 lg:px-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }} />
      <Suspense><AutoCheckout /></Suspense>

      {/* Hero — brief summary */}
      <section className="mb-8">
        <p className="text-sm font-bold uppercase tracking-widest text-brand">AWS Security Labs</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
          AWS Security Labs — practise cloud security in real, isolated AWS accounts.
        </h1>
        <p className="mt-3 max-w-2xl text-base text-ink-soft">
          Every lab spins up its own throwaway AWS account, hands you the real console, and wipes it
          when you&apos;re done. No setup, no bill, no risk to anything real.
        </p>
        <p className="mt-2 text-sm text-muted">
          {live} live · {LABS.length - live} more on the way
        </p>
      </section>

      {/* Plan picker — 3-up, mirrors the marketing wizard */}
      <section className="mb-10">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Pick how you want to learn</h2>
          <a href={MARKETING_WIZARD} className="text-sm font-semibold text-brand hover:underline">
            Open full wizard →
          </a>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link
            href={`/labs/${FREE_SLUG}?intent=launch`}
            className="flex flex-col rounded-2xl border border-line bg-canvas p-5 transition hover:border-brand"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-ink">Free lab</h3>
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">FREE</span>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
              <li>✓ Your first beginner lab</li>
              <li>✓ Real, isolated AWS account</li>
              <li>✓ No card needed</li>
            </ul>
            <span className="mt-auto pt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
              Launch now →
            </span>
          </Link>

          <a
            href={MARKETING_WIZARD}
            className="flex flex-col rounded-2xl border border-line bg-canvas p-5 transition hover:border-brand"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-ink">Pay per lab</h3>
              <span className="shrink-0 text-sm font-bold text-brand">From ₹99</span>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
              <li>✓ Buy only the labs you want</li>
              <li>✓ One-time payment</li>
              <li>✓ Great for targeted practice</li>
            </ul>
            <span className="mt-auto pt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
              Pick a lab →
            </span>
          </a>

          <a
            href={`${MARKETING_WIZARD}?plan=monthly`}
            className="relative flex flex-col rounded-2xl border-2 border-brand bg-canvas p-5 transition hover:brightness-105"
          >
            <span className="absolute -top-3 right-5 rounded-full bg-brand px-3 py-0.5 text-[11px] font-bold text-white shadow-sm">
              Best value
            </span>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-ink">Monthly — full access</h3>
              <span className="shrink-0 text-sm font-bold text-brand">₹2,000/mo</span>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
              <li>✓ Every AWS lab unlocked</li>
              <li>✓ New labs included</li>
              <li>✓ Cancel within 24h</li>
            </ul>
            <span className="mt-auto pt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
              Get started →
            </span>
          </a>
        </div>
      </section>

      {/* Catalog */}
      <section>
        <h2 className="mb-4 text-lg font-bold text-ink">All labs</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {LABS.map((lab) => (
            <LabCard key={lab.slug} lab={lab} />
          ))}
        </div>
      </section>

      <LabRequest />
    </div>
  );
}
