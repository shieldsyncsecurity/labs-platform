import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Baseline security headers for the labs platform.
 *
 * NOTE for M6/auth: when Cognito (Hosted UI / Amplify) is wired in, extend
 * `connect-src` with your Cognito domain + token endpoints, e.g.
 *   https://<your-domain>.auth.<region>.amazoncognito.com  https://cognito-idp.<region>.amazonaws.com
 * and `form-action` with the Hosted UI domain if you use the redirect flow.
 */
// Paytm Checkout needs to load its CheckoutJS script, render the payment iframe,
// and make its own XHR — without these the live checkout silently fails the moment
// PAYMENTS_LIVE is on. Harmless when payments are off (nothing loads from them).
const PAYTM = "https://securestage.paytmpayments.com https://secure.paytmpayments.com https://*.paytmpayments.com https://paytm.com https://*.paytm.com https://paytmcdn.co.in https://*.paytmcdn.co.in https://pguat.paytm.in https://*.paytm.in";
// Paytm's UPI-QR widget ("Scan with any UPI App") opens a WebSocket to stream the QR
// payload and await the scan: wss://secure.paytmpayments.com/websocket/?...&ID=<MID>_<orderId>.
// wss:// is a DISTINCT scheme in CSP — the https:// hosts above do NOT cover it (only
// http→https and ws→wss upgrades are implicit), so without this the QR spins forever
// while cards / UPI-collect (plain https) work. connect-src ONLY. (Root-caused 2026-07-14
// from a `Refused to connect ... wss://...` console violation; see PAYTM-UPI-QR-DEBUG.md.)
const PAYTM_WSS = "wss://secure.paytmpayments.com wss://securestage.paytmpayments.com wss://*.paytmpayments.com";
// Cognito (sign-in is server-side redirects, but allow its XHR/endpoints defensively).
const COGNITO = "https://cognito-idp.us-east-1.amazonaws.com https://*.auth.us-east-1.amazoncognito.com";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `style-src 'self' 'unsafe-inline' ${PAYTM}`,
  `style-src-elem 'self' 'unsafe-inline' ${PAYTM}`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${PAYTM}`,
  `script-src-elem 'self' 'unsafe-inline' ${PAYTM}`,
  `connect-src 'self' ${PAYTM} ${PAYTM_WSS} ${COGNITO}${isDev ? " ws:" : ""}`,
  `frame-src 'self' ${PAYTM}`,
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
