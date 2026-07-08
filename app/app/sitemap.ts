import type { MetadataRoute } from "next";
import { LABS } from "@/lib/labs";

const BASE = "https://labs.shieldsyncsecurity.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date("2026-06-30");
  return [
    {
      url: `${BASE}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    ...LABS.filter((l) => l.ready).map((l) => ({
      url: `${BASE}/labs/${l.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...["privacy", "terms"].map((slug) => ({
      url: `${BASE}/${slug}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
