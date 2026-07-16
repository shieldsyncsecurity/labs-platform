import type { MetadataRoute } from "next";

const APP_URL = "https://enterprise.shieldsyncsecurity.com";

// Crawl policy mirrors the sitemap: public marketing pages in, all gated
// surfaces out. Token-bearing routes (/a/, /r/, /sign/) are disallowed so
// leaked invite/report/e-sign URLs never end up crawled; the per-page noindex
// default in app/layout.tsx is the second line of defense.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/demo/report", "/demo/try", "/book-demo", "/privacy", "/terms"],
        disallow: ["/portal", "/admin", "/a/", "/r/", "/sign/", "/preview"],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
