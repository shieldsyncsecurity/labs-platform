// Per-lab settings overrides (prices / keywords / flags) — the data the
// /admin/labs panel edits. Bundled at build time from app/lab-settings.json;
// a panel save commits a new version to GitHub and CI rebuilds, so "edit in
// panel -> live in ~5-10 min". null / empty = no override.
import raw from "../lab-settings.json";

export type LabSetting = {
  priceINR: number | null; // rupees (major units)
  priceUSD: number | null; // dollars (major units)
  keywords: string[]; // non-empty replaces the lab's tags
  live: boolean | null; // overrides catalog `ready`
  free: boolean | null; // overrides catalog `free`
};

type SettingsFile = { _readme?: string; labs?: Record<string, Partial<LabSetting>> };

const FILE = raw as SettingsFile;

export const LAB_SETTINGS: Record<string, LabSetting> = Object.fromEntries(
  Object.entries(FILE.labs ?? {}).map(([slug, s]) => [
    slug,
    {
      priceINR: typeof s.priceINR === "number" ? s.priceINR : null,
      priceUSD: typeof s.priceUSD === "number" ? s.priceUSD : null,
      keywords: Array.isArray(s.keywords) ? s.keywords.filter((k) => typeof k === "string" && k.trim()) : [],
      live: typeof s.live === "boolean" ? s.live : null,
      free: typeof s.free === "boolean" ? s.free : null,
    },
  ]),
);

export function settingFor(slug: string): LabSetting | undefined {
  return LAB_SETTINGS[slug];
}

/** Per-lab price override in MINOR units (paise/cents), or null = use level pricing. */
export function priceOverrideMinor(slug: string | null, currency: "INR" | "USD"): number | null {
  if (!slug) return null;
  const s = LAB_SETTINGS[slug];
  if (!s) return null;
  const major = currency === "INR" ? s.priceINR : s.priceUSD;
  return typeof major === "number" ? Math.round(major * 100) : null;
}

/** Merge overrides onto a catalog lab (tags / ready / free). Pure — returns a copy. */
export function applyLabSettings<T extends { slug: string; tags: string[]; free: boolean; ready: boolean }>(lab: T): T {
  const s = LAB_SETTINGS[lab.slug];
  if (!s) return lab;
  return {
    ...lab,
    tags: s.keywords.length ? s.keywords : lab.tags,
    ready: s.live ?? lab.ready,
    free: s.free ?? lab.free,
  };
}
