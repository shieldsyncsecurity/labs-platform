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
  // Azure Portal added so the candidate readiness-check can ping it for
  // reachability (Azure-first assessments). Same-origin otherwise.
  `connect-src 'self' https://portal.azure.com${isDev ? " ws:" : ""}`,
  "frame-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera/microphone = (self): the candidate assessment records webcam
  // snapshots + mic audio, so our OWN origin must be allowed to request them
  // (this still blocks cross-origin/iframe camera+mic use — it is the correct
  // policy for a product that uses the camera, not a relaxation). A fully
  // empty allowlist `camera=()` blocks getUserMedia at the document level, so
  // no permission prompt ever appears — which is what broke camera/mic
  // detection. geolocation + browsing-topics stay fully off.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()" },
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
