import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LABS, getLab } from "@/lib/labs";
import { labInstructions, labObjectives } from "@/lib/lab-content";
import { LabPanel } from "@/components/lab-panel";
import { LabGuide } from "@/components/lab-guide";
import { LabShell } from "@/components/lab-shell";
import { LabWorkspaceProvider } from "@/components/lab-workspace";
import { EntitlementStatus } from "@/components/entitlement-status";
import { getServerUser } from "@/lib/auth/session";
import { listEntitlements } from "@/lib/server/store";
import { priceFor } from "@/lib/payments/pricing";
import { rulesSummary } from "@/lib/access-rules";

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

const APP_URL = "https://labs.shieldsyncsecurity.com";
// The same lab also has a (faster, static, higher-authority) landing page on the
// marketing site. Canonicalise there so Google consolidates ranking signal on ONE
// page and indexes the fast Amplify version instead of this Cloudflare one — the
// app here stays the funnel target (search → marketing landing → sign in → app).
const MARKETING_URL = "https://shieldsyncsecurity.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lab = getLab(slug);
  if (!lab) return { title: "Lab" };
  const title = `${lab.title} — AWS Security Lab`;
  const description = `${lab.summary} A hands-on AWS security lab that runs in a real, isolated AWS account in your browser — ${lab.level.toLowerCase()} level, about ${lab.estimatedActiveMinutes} minutes.`;
  const url = `${APP_URL}/labs/${slug}`;
  return {
    title,
    description,
    keywords: ["AWS security lab", `${lab.title} AWS`, "hands-on AWS", "cloud security lab", ...lab.tags.map((t) => `AWS ${t}`)],
    alternates: { canonical: `${MARKETING_URL}/labs/${slug}` },
    openGraph: { title, description, url, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function LabPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lab = getLab(slug);
  if (!lab) notFound();

  // Fetch the signed-in user's entitlement for THIS lab (or the monthly all-access
  // "*" row) so we can render launch-cap / window state above the title. Best-effort:
  // any failure (no session, engine unreachable) returns null and the page renders
  // as it does for an anonymous visitor.
  const user = await getServerUser().catch(() => null);
  const entitlement = user
    ? (await listEntitlements(user.id).catch(() => []))
        .find((e) => e.labSlug === slug || e.labSlug === "*") ?? null
    : null;

  const full = lab.ready ? (labInstructions[slug] ?? null) : null;
  const [overview, walkthrough] = full ? splitSentinel(full) : [null, ""];
  const objectives: Objective[] = lab.ready ? (labObjectives[slug] ?? []) : [];

  // Paid labs: ship ONLY the overview to the client; gate the walkthrough behind the
  // entitlement-checked /api/lab-content route. Free labs ship the full guide as before.
  const gated = lab.ready && !lab.free;
  const instructions = full ? (gated ? overview : full) : null;
  const stepTitles = full ? extractStepTitles(walkthrough) : [];

  return (
    // Wide shell: a ~88rem container with an asymmetric guide / fixed-rail grid so a
    // wide screen has no dead side gutters — surplus width flows to the guide, not to
    // empty margins. pb-24 leaves room for the mobile sticky action bar.
    <div className="mx-auto max-w-[1536px] px-4 py-8 pb-24 sm:px-6 lg:px-10 lg:pb-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Course",
            "@id": `${APP_URL}/labs/${lab.slug}#course`,
            name: `${lab.title} — AWS Security Lab`,
            description: lab.summary,
            url: `${APP_URL}/labs/${lab.slug}`,
            provider: { "@type": "Organization", name: "ShieldSync Security", url: "https://shieldsyncsecurity.com" },
            educationalLevel: lab.level,
            inLanguage: "en",
            keywords: lab.tags.join(", "),
            hasCourseInstance: {
              "@type": "CourseInstance",
              courseMode: "online",
              courseWorkload: `PT${lab.estimatedActiveMinutes}M`,
            },
            offers: {
              "@type": "Offer",
              // Real per-level price from the single pricing source (was a stale
              // hardcoded "99" left over from the reverted launch promo).
              price: lab.free ? "0" : String(priceFor(lab.slug, "per-lab", "INR") / 100),
              priceCurrency: "INR",
              availability: "https://schema.org/InStock",
              category: lab.free ? "Free" : "Paid",
            },
          }),
        }}
      />
      {/* State-aware shell (design C + J): pre-launch = landing page with the full
          title/summary + natural scroll; launched = slim header + Mission HUD +
          the fixed-height split workspace. See components/lab-shell.tsx. */}
      <LabWorkspaceProvider>
        <LabShell
          title={lab.title}
          summary={lab.summary}
          level={lab.level}
          free={!!lab.free}
          minutes={lab.estimatedActiveMinutes}
          policy={lab.ready ? rulesSummary(lab.level, !!lab.free) : ""}
          objectives={objectives}
          statusSlot={<EntitlementStatus entitlement={entitlement} labSlug={lab.slug} />}
          guideSlot={
            lab.ready && instructions ? (
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
            )
          }
          panelSlot={
            <>
              <LabPanel slug={lab.slug} objectives={objectives} ready={lab.ready} />
              <div className="mt-3 flex flex-wrap gap-1.5">
                {lab.tags.map((t) => (
                  <span key={t} className="rounded-md border border-line px-2 py-0.5 font-mono text-xs text-muted">
                    {t}
                  </span>
                ))}
              </div>
            </>
          }
        />
      </LabWorkspaceProvider>
    </div>
  );
}
