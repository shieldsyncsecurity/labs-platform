// Microsoft Graph — creates the real Teams meeting on the founder's calendar
// and sends the candidate a proper Outlook invite they can accept.
//
// WHY A CALENDAR EVENT AND NOT /onlineMeetings: creating an *event* with
// isOnlineMeeting=true does three jobs in one call — generates the Teams join
// link, puts it on the organiser's calendar, and emails every attendee a real
// invite. The /onlineMeetings endpoint only mints a link: it appears on nobody's
// calendar and invites nobody, so we'd have to send the email ourselves and the
// meeting would be missing from Outlook. It also needs application-access
// policies configured through PowerShell, which Calendars.ReadWrite does not.
//
// AUTH: client-credentials (app-only). No user sign-in, no refresh tokens to
// store or expire at 2am — the portal holds a client secret and mints its own
// short-lived token. NEVER import this into client code.

const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com";

export class GraphError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(`Microsoft Graph request failed (${status})`);
    this.name = "GraphError";
    this.status = status;
    this.detail = detail;
  }
}

/** Configured only when all four are present — the UI degrades to "paste a
 *  link yourself" rather than showing a button that can only fail. */
export function graphConfigured(): boolean {
  return Boolean(
    process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_ORGANISER_UPN,
  );
}

// App-only tokens last ~1 hour. Cached in the isolate with a safety margin so
// a burst of scheduling doesn't mint a token per request.
let tokenCache: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAt) return tokenCache.token;

  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID ?? "",
    client_secret: process.env.MS_CLIENT_SECRET ?? "",
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(`${LOGIN}/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new GraphError(res.status, data.error_description ?? data);

  // Refresh 5 minutes early — a token that expires mid-flight fails the send,
  // and the candidate is the one who notices.
  tokenCache = { token: data.access_token, expiresAt: now + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000 };
  return data.access_token;
}

export type MeetingRequest = {
  subject: string;
  /** ISO instant. */
  startsAt: string;
  durationMinutes: number;
  /** Candidate's email. Omit to create a private hold with no invite sent. */
  attendeeEmail?: string;
  attendeeName?: string;
  body?: string;
};

export type MeetingResult = {
  eventId: string;
  joinUrl?: string;
  webLink?: string;
};

/** Create the calendar event + Teams meeting, inviting the attendee. */
export async function createTeamsMeeting(req: MeetingRequest): Promise<MeetingResult> {
  const token = await accessToken();
  const organiser = process.env.MS_ORGANISER_UPN ?? "";
  const start = new Date(req.startsAt);
  const end = new Date(start.getTime() + req.durationMinutes * 60_000);

  const payload = {
    subject: req.subject,
    // Times are sent as UTC with an explicit timeZone so Outlook renders them
    // in each recipient's own zone — the candidate may not be in IST.
    start: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: end.toISOString().replace("Z", ""), timeZone: "UTC" },
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    body: req.body ? { contentType: "HTML", content: req.body } : undefined,
    attendees: req.attendeeEmail
      ? [{ emailAddress: { address: req.attendeeEmail, name: req.attendeeName ?? req.attendeeEmail }, type: "required" }]
      : [],
  };

  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(organiser)}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    onlineMeeting?: { joinUrl?: string };
    webLink?: string;
    error?: unknown;
  };
  if (!res.ok || !data.id) throw new GraphError(res.status, data.error ?? data);

  return { eventId: data.id, joinUrl: data.onlineMeeting?.joinUrl, webLink: data.webLink };
}

/** Cancel a scheduled meeting — Graph notifies the attendee automatically. */
export async function cancelMeeting(eventId: string, comment?: string): Promise<void> {
  const token = await accessToken();
  const organiser = process.env.MS_ORGANISER_UPN ?? "";
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(organiser)}/events/${encodeURIComponent(eventId)}/cancel`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ comment: comment ?? "This interview has been cancelled." }),
    signal: AbortSignal.timeout(20000),
  });
  // 404 means it's already gone from the calendar — the desired end state, so
  // don't fail the caller and leave our record stuck marked as scheduled.
  if (!res.ok && res.status !== 404) {
    throw new GraphError(res.status, await res.json().catch(() => ({})));
  }
}
