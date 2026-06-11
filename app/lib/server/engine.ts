// Server-only helper for talking to the labs engine (Lambda + API GW).
// Encapsulates:
//   - the URL (env)
//   - the shared-secret header (engine refuses requests without it in prod)
//   - the X-User-Id header (engine uses it for ownership checks on actions)
//
// IMPORTANT: this module must NEVER be imported into client code — it would
// leak ENGINE_SHARED_SECRET into the browser bundle. Always import from server
// components / API routes only (this file has no "use client").

import { getServerUser } from "@/lib/auth/session";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";
const ENGINE_SHARED_SECRET = process.env.ENGINE_SHARED_SECRET ?? "";

type Opts = {
  /** HTTP method — default POST. */
  method?: "GET" | "POST";
  /** JSON body for POSTs. */
  body?: unknown;
  /** When true, attach X-User-Id from the verified Cognito session. */
  withUser?: boolean;
  /** Override the user id (used by anonymous flows like local dev). */
  userId?: string | null;
  /** Pass through to fetch() — e.g. cache: "no-store" for polls. */
  cache?: RequestCache;
};

export async function engineFetch(path: string, opts: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ENGINE_SHARED_SECRET) headers["x-engine-token"] = ENGINE_SHARED_SECRET;
  if (opts.withUser) {
    const u = await getServerUser();
    const uid = opts.userId ?? u?.id ?? null;
    if (uid) headers["x-user-id"] = uid;
  } else if (opts.userId) {
    headers["x-user-id"] = opts.userId;
  }
  return fetch(`${ENGINE_URL}${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: opts.cache,
  });
}

/** Convenience for the most common "needs signed-in user" call. */
export function engineFetchAsUser(path: string, body?: unknown, init?: Omit<Opts, "withUser" | "body">) {
  return engineFetch(path, { ...init, withUser: true, body });
}
