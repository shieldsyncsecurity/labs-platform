import type { MetadataRoute } from "next";

const APP_URL = "https://enterprise.shieldsyncsecurity.com";

// Only the public marketing pages. Everything else (portal, admin,
// candidate /a/, reports /r/) is token/session-gated and stays out of the
// index (global noindex default in app/layout.tsx + robots.ts disallow).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${APP_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${APP_URL}/demo/report`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${APP_URL}/demo/try`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${APP_URL}/book-demo`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${APP_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${APP_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
