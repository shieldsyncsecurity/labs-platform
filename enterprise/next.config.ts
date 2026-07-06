import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Baseline security headers for the enterprise platform.
 *
 * TODO(auth): once employer SSO / session auth is wired in, extend
 * connect-src / form-action with the relevant identity-provider domains
 * (mirrors labs-platform/app/next.config.ts's Cognito note).
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "style-src-elem 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "script-src-elem 'self' 'unsafe-inline'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pin Turbopack's workspace root to THIS app. Without this, the sibling
  // package-lock.json at labs-platform/ gets inferred as root and breaks
  // module/manifest resolution in dev.
  // NOTE: production builds use `next build --webpack` (see package.json)
  // so Turbopack is never active in the CF deploy — no ChunkLoadError.
  turbopack: { root: process.cwd() },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
