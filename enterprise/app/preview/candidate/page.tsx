import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CandidateFlow from "./candidate-flow";

// Hidden, non-production preview of the real candidate assessment front-end. It
// renders FABRICATED data, so it must never be a second, live-looking path to the
// candidate flow in production - the one real entry point is /a/[token]. Inherits
// the app-wide noindex default (app/layout.tsx) and is disallowed in robots.ts,
// but robots only asks politely; the env gate below actually closes it. Reachable
// only when ALLOW_PREVIEW_MOCKS==="1" (absent in prod) - for local owner review.
export const metadata: Metadata = {
  title: "Candidate flow — preview",
  robots: { index: false, follow: false },
};

// Evaluate the gate per request rather than baking it in at build time.
export const dynamic = "force-dynamic";

export default function CandidatePreviewPage() {
  if (process.env.ALLOW_PREVIEW_MOCKS !== "1") notFound();
  return <CandidateFlow />;
}
