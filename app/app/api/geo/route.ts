import { NextResponse } from "next/server";

/* Country lookup for the marketing site's currency picker.
 *
 * The marketing site is a static export on AWS Amplify and can't read the
 * viewer's IP at render time. This tiny endpoint lives on the labs domain
 * (Cloudflare Workers), where every request carries the CF-injected
 * `cf-ipcountry` header — no third-party geolocation API needed.
 *
 * Behaviour:
 *  - Public, no auth, GET only.
 *  - No-store: this response is per-viewer, must never be shared/cached
 *    at any edge. The marketing site handles repeat-visit perf with its
 *    own localStorage cache.
 *  - CORS: explicit allow-origin for the marketing site (not wildcard).
 */

const ALLOWED_ORIGIN = "https://shieldsyncsecurity.com";

export async function GET(req: Request) {
  const country = (req.headers.get("cf-ipcountry") || "XX").toUpperCase();
  return new NextResponse(JSON.stringify({ country }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      Vary: "Origin",
    },
  });
}
