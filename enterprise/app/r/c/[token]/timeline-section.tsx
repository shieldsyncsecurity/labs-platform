"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * PROCESS EVIDENCE — the candidate's ordered control-plane actions, recorded by
 * AWS itself inside their isolated sandbox (CloudTrail), plus interviewer
 * debrief questions generated from what they actually did.
 *
 * This is the honest answer to "how do I know they did the work themselves?".
 * It is EVIDENCE, not a score: nothing here feeds the competency profile. The
 * hiring panel reads the trail and asks the questions; the candidate's answers
 * are what separate real work from a pasted one.
 *
 * CloudTrail needs ~5-15 min to make events queryable, so a report opened
 * immediately after submit may show an empty trail with a Refresh affordance
 * rather than a false "did nothing".
 */

type TLEvent = {
  at: string | null;
  name: string;
  service: string;
  resource: string | null;
  readOnly: boolean;
  error: string | null;
};
type TLStats = {
  total: number;
  writes: number;
  reads: number;
  errors: number;
  services: string[];
  firstAt: string | null;
  lastAt: string | null;
  destructive: string[];
};
type TLData = {
  available: boolean;
  reason?: string;
  events: TLEvent[];
  stats: TLStats | null;
  cached?: boolean;
};

type Criterion = { id?: string; description?: string; passed?: boolean; unknown?: boolean };

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** Interviewer questions derived from THIS candidate's actual actions + results.
 *  Every question cites something real, so it can't be pre-rehearsed. */
function buildDebrief(events: TLEvent[], stats: TLStats | null, criteria: Criterion[]): string[] {
  const qs: string[] = [];
  const failed = criteria.filter((c) => c && c.passed === false && !c.unknown);

  if (stats?.destructive?.length) {
    qs.push(
      `You ran ${stats.destructive[0]} during the session. Talk me through why you removed the resource instead of securing it in place — what would that have done to a real workload?`
    );
  }
  for (const f of failed.slice(0, 2)) {
    qs.push(`One check did not pass: "${f.description ?? f.id}". Walk me through what you'd do differently, and how you'd verify it.`);
  }
  const firstWrite = events.find((e) => !e.readOnly);
  if (firstWrite) {
    qs.push(
      `Your first change was ${firstWrite.name}${firstWrite.resource ? ` on ${firstWrite.resource}` : ""} at ${fmtTime(firstWrite.at)}. What had you seen up to that point that made that the right first move?`
    );
  }
  if (stats && stats.reads === 0 && stats.writes > 0) {
    qs.push(
      "You made changes without any read/inspect calls first. How did you determine what was misconfigured before changing it?"
    );
  }
  const errored = events.find((e) => e.error);
  if (errored) {
    qs.push(
      `You hit ${errored.error} on ${errored.name}. How did you diagnose that, and what did you change as a result?`
    );
  }
  if (stats && stats.writes > 0 && stats.writes <= 3) {
    qs.push(
      `You reached the end state in only ${stats.writes} change${stats.writes === 1 ? "" : "s"}. Walk me through your reasoning — what did you rule out?`
    );
  }
  if (stats?.services?.length) {
    qs.push(
      `You worked across ${stats.services.join(", ")}. Which of those changes would you roll out first in production, and why?`
    );
  }
  return qs.slice(0, 5);
}

export function TimelineSection({ token, criteria }: { token: string; criteria: Criterion[] }) {
  const [data, setData] = useState<TLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/timeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateReportToken: token }),
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setData((await res.json()) as TLData);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const debrief = useMemo(
    () => (data?.available ? buildDebrief(data.events, data.stats, criteria) : []),
    [data, criteria]
  );

  // Nothing to say at all (older result, no session) — render nothing rather
  // than an empty shell.
  if (!loading && !failed && data && !data.available && data.reason === "no_session") return null;

  const spanMins =
    data?.stats?.firstAt && data?.stats?.lastAt
      ? Math.max(
          0,
          Math.round(
            (new Date(data.stats.lastAt).getTime() - new Date(data.stats.firstAt).getTime()) / 60000
          )
        )
      : null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Process evidence</h2>
        {data?.stats ? (
          <span className="font-mono text-xs text-muted">
            {data.stats.total} actions · {data.stats.writes} changes
          </span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="border-b border-line/70 bg-canvas/40 px-5 py-3 text-xs leading-relaxed text-ink-soft sm:px-6">
          Every control-plane action the candidate took inside their isolated cloud account, recorded
          by AWS itself. The candidate cannot edit, pause, or opt out of this trail. It is shown as
          <span className="font-medium text-ink"> evidence for your interview</span> — it is not
          scored and does not affect the competency profile.
        </div>

        {loading ? (
          <p className="px-5 py-6 text-sm text-muted sm:px-6">Loading the action trail…</p>
        ) : failed ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 text-sm text-ink-soft sm:px-6">
            <span>The action trail could not be loaded right now (a temporary issue).</span>
            <button type="button" onClick={() => void load()} className="rounded-md border border-line-strong px-3 py-1 text-xs font-semibold text-ink-soft hover:border-brand hover:text-brand-strong">Retry</button>
          </div>
        ) : !data?.available ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 text-sm text-ink-soft sm:px-6">
            <span>
              {data?.reason === "client_unavailable"
                ? "Action-trail lookup is not enabled on this deployment yet."
                : data?.reason === "sandbox_unreachable"
                  ? "This session's environment is no longer reachable, so the action trail can't be retrieved."
                  : "The action trail isn't available for this session."}
            </span>
            <button type="button" onClick={() => void load()} className="rounded-md border border-line-strong px-3 py-1 text-xs font-semibold text-ink-soft hover:border-brand hover:text-brand-strong">Retry</button>
          </div>
        ) : data.events.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 text-sm text-ink-soft sm:px-6">
            <span>
              No actions recorded yet. AWS can take up to ~15 minutes to publish a session&rsquo;s
              activity — if this session just finished, check back shortly.
            </span>
            <button type="button" onClick={() => void load()} className="rounded-md border border-line-strong px-3 py-1 text-xs font-semibold text-ink-soft hover:border-brand hover:text-brand-strong">Refresh</button>
          </div>
        ) : (
          <div className="flex flex-col gap-5 p-5 sm:p-6">
            {/* Objective facts derived from the trail */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-soft">
              <span><span className="font-semibold text-ink">{data.stats?.writes ?? 0}</span> changes made</span>
              <span><span className="font-semibold text-ink">{data.stats?.reads ?? 0}</span> inspect/read calls</span>
              {spanMins !== null ? <span>active across <span className="font-semibold text-ink">{spanMins} min</span></span> : null}
              {data.stats?.errors ? <span><span className="font-semibold text-amber-700">{data.stats.errors}</span> failed calls</span> : null}
              {data.stats?.services?.length ? <span>services: <span className="font-medium text-ink">{data.stats.services.join(", ")}</span></span> : null}
            </div>

            {data.stats?.destructive?.length ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                Destructive action recorded: {data.stats.destructive.join(", ")} — the candidate removed a
                resource rather than securing it. See Operational safety above.
              </p>
            ) : null}

            {/* The trail */}
            <div>
              <p className="mb-2 text-xs font-medium text-ink">Action trail</p>
              <ol className="max-h-80 overflow-y-auto rounded-lg border border-line/70">
                {data.events.map((e, i) => (
                  <li
                    key={`${e.at}-${e.name}-${i}`}
                    className="flex items-baseline gap-3 border-b border-line/50 px-3 py-1.5 text-xs last:border-b-0 odd:bg-canvas/40"
                  >
                    <span className="w-20 flex-none font-mono tabular-nums text-muted">{fmtTime(e.at)}</span>
                    <span className={`flex-none rounded px-1.5 py-0.5 text-[10px] font-semibold ${e.readOnly ? "bg-canvas text-muted ring-1 ring-inset ring-line-strong/60" : "bg-brand/10 text-brand-strong"}`}>
                      {e.readOnly ? "read" : "change"}
                    </span>
                    <span className="min-w-0 flex-1 text-ink-soft">
                      <span className="font-medium text-ink">{e.name}</span>
                      <span className="text-muted"> · {e.service}</span>
                      {e.resource ? <span className="text-muted"> · {e.resource}</span> : null}
                      {e.error ? <span className="font-medium text-amber-700"> · {e.error}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Interviewer debrief — the verification step */}
            {debrief.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-ink">Suggested debrief questions</p>
                <p className="mb-2 text-[11px] leading-relaxed text-muted">
                  Generated from this candidate&rsquo;s own actions, so they can&rsquo;t be rehearsed in
                  advance. Ten minutes on these in your interview is the strongest check that the work
                  was theirs.
                </p>
                <ul className="space-y-1.5">
                  {debrief.map((q, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-soft">
                      <span className="flex-none font-mono text-xs text-brand">{i + 1}.</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
