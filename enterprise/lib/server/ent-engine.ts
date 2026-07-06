// Server-only helper for talking to the enterprise engine (B2B sibling of the
// labs-platform/app engine client at lib/server/engine.ts).
//
// IMPORTANT: this module must NEVER be imported into client code — it would
// leak ENT_ENGINE_SECRET into the browser bundle. Always import from server
// components / Route Handlers only (this file has no "use client", and does
// not export anything that reads well from a client bundle).

const ENT_ENGINE_URL = process.env.ENT_ENGINE_URL ?? "http://localhost:4001";

export class EntEngineError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`Enterprise engine request failed (${status})`);
    this.name = "EntEngineError";
    this.status = status;
    this.body = body;
  }
}

type EntFetchOpts = {
  /** HTTP method — default GET. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body — sent for non-GET requests. */
  body?: unknown;
  /** Query-string params, appended to `path`. */
  query?: Record<string, string | number | boolean | undefined | null>;
};

function buildQuery(query?: EntFetchOpts["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Call the enterprise engine. This is the ONLY place ENT_ENGINE_SECRET is
 * read/attached — callers (Route Handlers) never see the secret itself, only
 * the parsed JSON result (or a thrown EntEngineError on non-2xx).
 */
export async function entFetch<T = unknown>(path: string, opts: EntFetchOpts = {}): Promise<T> {
  // Read at request time (Workers inject env per-request — mirrors labs' engine.ts).
  const secret = process.env.ENT_ENGINE_SECRET ?? "";

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-engine-token": secret,
  };

  const url = `${ENT_ENGINE_URL}${path}${buildQuery(opts.query)}`;

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    throw new EntEngineError(res.status, parsed);
  }

  return parsed as T;
}
