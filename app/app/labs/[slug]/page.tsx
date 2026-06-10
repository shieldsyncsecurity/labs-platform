import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LABS, getLab } from "@/lib/labs";
import { labInstructions, labObjectives } from "@/lib/lab-content";
import { LabPanel } from "@/components/lab-panel";
import { LabGuide } from "@/components/lab-guide";

type Objective = { id: string; description: string };

export function generateStaticParams() {
  return LABS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lab = getLab(slug);
  return { title: lab ? lab.title : "Lab" };
}

export default async function LabPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lab = getLab(slug);
  if (!lab) notFound();

  const instructions = lab.ready ? (labInstructions[slug] ?? null) : null;
  const objectives: Objective[] = lab.ready ? (labObjectives[slug] ?? []) : [];

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <Link href="/" className="text-sm font-semibold text-muted hover:text-ink">
        ← All labs
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold badge-${lab.level.toLowerCase()}`}>{lab.level}</span>
        {lab.free && <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">FREE</span>}
        <span className="text-sm text-muted">~{lab.estimatedActiveMinutes} min</span>
      </div>
      <h1 className="mt-3 text-3xl font-extrabold text-ink">{lab.title}</h1>
      <p className="mt-2 max-w-3xl text-lg text-ink-soft">{lab.summary}</p>

      <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* guide */}
        <div className="lg:col-span-2">
          {lab.ready && instructions ? (
            <LabGuide slug={lab.slug} instructions={instructions} />
          ) : (
            <div className="rounded-2xl border border-line bg-canvas p-6 text-base text-ink-soft">
              {lab.ready ? "Guide not available yet." : "This lab is coming soon."}
            </div>
          )}
        </div>

        {/* sticky workspace panel */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-6">
            <LabPanel slug={lab.slug} objectives={objectives} ready={lab.ready} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {lab.tags.map((t) => (
                <span key={t} className="rounded-md border border-line px-2 py-0.5 font-mono text-xs text-muted">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
