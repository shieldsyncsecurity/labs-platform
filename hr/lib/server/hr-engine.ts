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

/**
 * Reject any engine path that could re-target the request.
 *
 * WHY THIS IS A HARD GUARD AND NOT A LINT RULE: callers build paths by
 * interpolating route params — `/hr/employees/${seq}/generated/${genId}/accept`.
 * Next decodes those params, so a param of "%3F" becomes "?" and TRUNCATES the
 * path at the URL parser, while "%2F..%2F" re-roots it. Since this function is
 * the one place HR_ENGINE_SECRET is attached, a forged path arrives at the
 * engine fully authenticated: an anonymous request to the public /accept route
 * could be steered onto employee-create, /status, or /hr/access.
 *
 * Validating at every call site would mean never missing one, forever. This
 * validates once, at the only door the secret goes through.
 */
function assertSafeEnginePath(path: string): void {
  if (
    !path.startsWith("/hr/") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("..") ||
    path.includes("//") ||
    /[\s\\]/.test(path) ||
    // Control characters (incl. encoded newlines that survived a decode) have
    // no business in a path and can split a request at some proxies.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new HrEngineError(400, { error: "UNSAFE_ENGINE_PATH" });
  }
}

export async function hrFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  assertSafeEnginePath(path);
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
