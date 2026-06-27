import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LABS, getLab } from "@/lib/labs";
import { labInstructions, labObjectives } from "@/lib/lab-content";
import { LabPanel } from "@/components/lab-panel";
import { LabGuide } from "@/components/lab-guide";
import { LabIntro } from "@/components/lab-intro";
import { LabWorkspaceProvider } from "@/components/lab-workspace";

type Objective = { id: string; description: string };

// Split a lab's markdown at the "<!-- ss:walkthrough -->" sentinel (fallback: first
// "## Step"). For PAID labs we ship ONLY the overview into the public payload; the
// walkthrough (answers + capture flag) is fetched later from an entitlement-checked
// route. Step headings are NOT sensitive, so they're passed through for the launch-gate
// preview even when the body is gated.
function splitSentinel(md: string): [string, string] {
  const m = md.match(/<!--\s*ss:walkthrough\s*-->/);
  if (m && m.index != null) return [md.slice(0, m.index), md.slice(m.index + m[0].length)];
  const step = md.search(/^##\s+Step\b/m);
  return step >= 0 ? [md.slice(0, step), md.slice(step)] : [md, ""];
}
function extractStepTitles(walkthrough: string): string[] {
  const out: string[] = [];
  const re = /^##\s+Step\s+\d+\s*[—–-]\s*(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(walkthrough)) !== null) out.push(m[1].trim());
  return out;
}

export function generateStaticParams() {
  return LABS.map((l) => ({ slug: l.slug }));
}

// Revalidate the prerendered HTML every 5 min instead of Next's default 1-year
// static cache. The page body inlines hash-named JS/CSS chunk URLs, so a 1-year
// `s-maxage` meant a returning visitor kept loading STALE HTML pointing at OLD
// chunks — every deploy was invisible to warm clients until the cache expired.
// A short window makes new deploys reach users within minutes; the hashed assets
// themselves stay immutably cached.
export const revalidate = 300;

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

  const full = lab.ready ? (labInstructions[slug] ?? null) : null;
  const [overview, walkthrough] = full ? splitSentinel(full) : [null, ""];
  const objectives: Objective[] = lab.ready ? (labObjectives[slug] ?? []) : [];

  // Paid labs: ship ONLY the overview to the client; gate the walkthrough behind the
  // entitlement-checked /api/lab-content route. Free labs ship the full guide as before.
  const gated = lab.ready && !lab.free;
  const instructions = full ? (gated ? overview : full) : null;
  const stepTitles = full ? extractStepTitles(walkthrough) : [];

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

      {lab.ready && <LabIntro />}

      <LabWorkspaceProvider>
        <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* guide */}
          <div className="lg:col-span-2">
            {lab.ready && instructions ? (
              <LabGuide
                slug={lab.slug}
                instructions={instructions}
                gatedSlug={gated ? lab.slug : undefined}
                stepTitles={stepTitles}
              />
            ) : (
              <div className="rounded-2xl border border-line bg-canvas p-6 text-base text-ink-soft">
                {lab.ready ? "Guide not available yet." : "This lab is coming soon."}
              </div>
            )}
          </div>

          {/* sticky workspace panel — cap to viewport height + scroll internally so the
              bottom controls (End / Check my work) stay reachable on short windows */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
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
      </LabWorkspaceProvider>
    </div>
  );
}
