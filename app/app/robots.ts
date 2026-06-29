import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/labs/"],
        disallow: ["/api/", "/dashboard", "/account", "/sign-in", "/admin"],
      },
    ],
    sitemap: "https://labs.shieldsyncsecurity.com/sitemap.xml",
    host: "https://labs.shieldsyncsecurity.com",
  };
}
