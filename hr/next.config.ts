import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Security headers for the INTERNAL HR portal (employee.shieldsyncsecurity.com).
 *
 * This is a 2-person, allowlist-only admin tool holding employee PII, so the
 * policy is deliberately tight: same-origin everything, no framing, no camera/
 * mic/geo, and the whole app is noindex (see app/layout.tsx robots).
 *
 * Cognito sign-in works under `default-src 'self'` because the login route does
 * a SERVER-SIDE 302 to the Hosted UI (not a browser form-action or fetch), and
 * the token exchange happens server-side in the Worker — the browser never
 * calls Cognito directly.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Logo + company seal are served from /brand as same-origin static assets.
  "img-src 'self' data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "style-src-elem 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "script-src-elem 'self' 'unsafe-inline'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Internal tool: never index, even if the domain leaks.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pin Turbopack's workspace root to THIS app (the sibling package-lock.json at
  // labs-platform/ would otherwise be inferred as root and break dev resolution).
  // Production builds use `next build --webpack` (see package.json), so Turbopack
  // is never active in the CF deploy.
  turbopack: { root: process.cwd() },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
