import type { Metadata } from "next";
import CandidateFlow from "./candidate-flow";

// Hidden, non-production preview of the real candidate assessment front-end.
// Inherits the app-wide noindex default (app/layout.tsx) and is additionally
// disallowed in robots.ts; unlinked from any nav. For owner review only.
export const metadata: Metadata = {
  title: "Candidate flow — preview",
  robots: { index: false, follow: false },
};

export default function CandidatePreviewPage() {
  return <CandidateFlow />;
}
