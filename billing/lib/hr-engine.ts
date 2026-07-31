// Read-only client for the HR engine — billing only ever GETs invoices.
// Never import into client components.

const HR_ENGINE_URL = process.env.HR_ENGINE_URL ?? "http://localhost:4002";

export class EngineError extends Error {
  status: number;
  constructor(status: number) {
    super(`Engine request failed (${status})`);
    this.status = status;
  }
}

export async function engineGet<T = unknown>(path: string): Promise<T> {
  if (!path.startsWith("/hr/") || path.includes("?") || path.includes("..")) {
    throw new EngineError(400);
  }
  const secret = process.env.HR_ENGINE_SECRET ?? "";
  const res = await fetch(`${HR_ENGINE_URL}${path}`, {
    headers: { "content-type": "application/json", "x-engine-token": secret },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new EngineError(res.status);
  return res.json() as Promise<T>;
}
