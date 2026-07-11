import type { MetadataRoute } from "next";

const APP_URL = "https://enterprise.shieldsyncsecurity.com";

// Crawl policy mirrors the sitemap: four public marketing pages in, all
// gated surfaces out. Token-bearing routes (/a/, /r/) are disallowed so
// leaked invite/report URLs never end up crawled; the per-page noindex
// default in app/layout.tsx is the second line of defense.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/demo/report", "/privacy", "/terms"],
        disallow: ["/portal", "/admin", "/a/", "/r/", "/preview"],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
