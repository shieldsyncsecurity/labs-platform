// Server-only client for the HR engine (the isolated Lambda/data-plane sibling
// of the enterprise engine). Mirrors labs-platform/enterprise/lib/server/
// ent-engine.ts: the ONLY place HR_ENGINE_SECRET is read/attached; callers
// (Route Handlers) get parsed JSON or a typed HrEngineError.
//
// NEVER import this into client code — it would leak the secret into the bundle.

const HR_ENGINE_URL = process.env.HR_ENGINE_URL ?? "http://localhost:4002";

export class HrEngineError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`HR engine request failed (${status})`);
    this.name = "HrEngineError";
    this.status = status;
    this.body = body;
  }
}

type FetchOpts = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Extra headers, e.g. x-hr-actor (identity must never ride in a URL). */
  headers?: Record<string, string>;
  timeoutMs?: number;
};

function buildQuery(query?: FetchOpts["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function hrFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const secret = process.env.HR_ENGINE_SECRET ?? "";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-engine-token": secret,
    ...(opts.headers ?? {}),
  };
  const url = `${HR_ENGINE_URL}${path}${buildQuery(opts.query)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
    });
  } catch (err) {
    throw new HrEngineError(504, {
      error: "ENGINE_UNAVAILABLE",
      cause: err instanceof Error ? err.name : "unknown",
    });
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) throw new HrEngineError(res.status, parsed);
  return parsed as T;
}
