// ShieldSync Enterprise — WORK TIMELINE ("process evidence").
//
// WHY THIS EXISTS: the hardest B2B objection to a remote assessment is "how do I
// know they did it themselves?" — a second laptop or an AI tool defeats any
// webcam. The strongest honest answer is not more surveillance, it is the
// SERVER-SIDE action trail: every control-plane call the candidate made inside
// their isolated sandbox, in order, recorded by AWS itself. A candidate cannot
// edit it, pause it, or point a camera away from it. The employer's interviewer
// uses it to ask "walk me through why you did X before Y" — which is what
// actually separates someone who did the work from someone who pasted an answer.
//
// SOURCE: CloudTrail LookupEvents (management events, ~90-day event history,
// on by default in every account) executed INSIDE the sandbox account via the
// ShieldSyncLabExec role. Note the account itself is recycled, not closed, and
// ShieldSyncLabExec is nuke-protected — so this still works AFTER teardown.
//
// LAG: CloudTrail can take ~5-15 minutes to make an event queryable. We therefore
// fetch LAZILY on first report view (an employer opens a report minutes-to-hours
// later, well past the lag) and cache the result onto the stored result row —
// rather than blocking submit/teardown on a 15-minute wait.
//
// TIME-WINDOWED: events are bounded to [startedAt, submittedAt], so a later
// candidate leasing the same recycled account can never bleed into this trail.
//
// @aws-sdk/client-cloudtrail may not be present in the Lambda runtime (same
// situation as @aws-sdk/client-bedrock), so it is imported LAZILY and the whole
// feature degrades to `available:false` rather than 500-ing the report.
import { assumeInSandbox } from "./labinfra.mjs";

const MAX_PAGES = 4;
const PER_PAGE = 50; // -> up to 200 events, plenty for a 60-min session

// Our own platform machinery, not the candidate's work — never show it as their action.
const NOISE_EVENTS = new Set([
  "AssumeRole",
  "GetCallerIdentity",
  "ConsoleLogin",
  "GetSessionToken",
  "GetFederationToken",
]);
const NOISE_PRINCIPAL = /ShieldSyncEnterpriseEngine|ShieldSyncEngineRole|ShieldSyncLabExec|OrganizationAccountAccessRole/i;

const shortSource = (src) => String(src || "").replace(/\.amazonaws\.com$/, "");

/**
 * fetchWorkTimeline(): the candidate's ordered control-plane actions.
 * Returns { available, reason?, events, stats }.
 *  events: [{ at, name, service, resource, readOnly, error }]
 *  stats:  { total, writes, reads, errors, services, firstAt, lastAt, destructive }
 */
export async function fetchWorkTimeline({ execRoleArn, startedAt, submittedAt }) {
  if (!execRoleArn || !startedAt) {
    return { available: false, reason: "no_session", events: [], stats: null };
  }

  let CloudTrailClient, LookupEventsCommand;
  try {
    ({ CloudTrailClient, LookupEventsCommand } = await import("@aws-sdk/client-cloudtrail"));
  } catch {
    // Client not in the runtime bundle — degrade honestly instead of erroring.
    return { available: false, reason: "client_unavailable", events: [], stats: null };
  }

  const start = new Date(startedAt);
  // Pad the end slightly: the candidate's last action can land moments before
  // the submit request is recorded. Fall back to "now" if never submitted.
  const end = new Date((submittedAt ? new Date(submittedAt).getTime() : Date.now()) + 60_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { available: false, reason: "bad_window", events: [], stats: null };
  }

  let creds;
  try {
    creds = await assumeInSandbox(execRoleArn, "ent-timeline", 900);
  } catch {
    // The account may have been released/recycled beyond our reach.
    return { available: false, reason: "sandbox_unreachable", events: [], stats: null };
  }

  const ct = new CloudTrailClient({ region: "us-east-1", credentials: creds });
  const raw = [];
  let nextToken;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await ct.send(
        new LookupEventsCommand({
          StartTime: start,
          EndTime: end,
          MaxResults: PER_PAGE,
          ...(nextToken ? { NextToken: nextToken } : {}),
        })
      );
      for (const e of res.Events ?? []) raw.push(e);
      nextToken = res.NextToken;
      if (!nextToken) break;
    }
  } catch {
    return { available: false, reason: "lookup_failed", events: [], stats: null };
  }

  const events = [];
  for (const e of raw) {
    const name = e.EventName || "";
    if (NOISE_EVENTS.has(name)) continue;
    let detail = {};
    try { detail = JSON.parse(e.CloudTrailEvent || "{}"); } catch { /* keep going */ }
    const principal =
      detail?.userIdentity?.arn || detail?.userIdentity?.sessionContext?.sessionIssuer?.arn || e.Username || "";
    if (NOISE_PRINCIPAL.test(principal) && !detail?.userIdentity?.sessionContext?.attributes) continue;
    const readOnly = detail?.readOnly === true || e.ReadOnly === "true";
    const resource =
      (e.Resources ?? []).map((r) => r.ResourceName).filter(Boolean)[0] ||
      detail?.requestParameters?.bucketName ||
      detail?.requestParameters?.userName ||
      null;
    events.push({
      at: e.EventTime ? new Date(e.EventTime).toISOString() : null,
      name,
      service: shortSource(e.EventSource),
      resource: resource ? String(resource).slice(0, 120) : null,
      readOnly,
      error: detail?.errorCode ? String(detail.errorCode).slice(0, 60) : null,
    });
  }
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const writes = events.filter((x) => !x.readOnly).length;
  const stats = {
    total: events.length,
    writes,
    reads: events.length - writes,
    errors: events.filter((x) => x.error).length,
    services: [...new Set(events.map((x) => x.service))].sort(),
    firstAt: events[0]?.at ?? null,
    lastAt: events[events.length - 1]?.at ?? null,
    // A destructive action is a strong operational-safety signal (deleting the
    // resource instead of securing it) — surfaced, never silently scored.
    destructive: events.filter((x) => /^Delete/.test(x.name) && !x.readOnly).map((x) => x.name),
  };

  return { available: true, events, stats };
}
