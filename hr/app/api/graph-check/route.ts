import { NextResponse } from "next/server";
import { guardAdminApi } from "@/lib/server/hr-access";
import { graphConfigured } from "@/lib/server/graph";

export const dynamic = "force-dynamic";

/**
 * "Is Teams actually wired up?" — a read-only pre-flight.
 *
 * Exists because every Graph misconfiguration fails the same way at the worst
 * moment: you click Send invite for a real candidate and get a 403. The three
 * things that break are all checkable without sending anything — the secret,
 * the admin consent, and whether the organiser mailbox exists — so check them
 * on demand instead of discovering them mid-hire.
 *
 * Creates nothing and emails nobody. Administrator-only: the response names the
 * tenant and the granted roles.
 */
export async function GET() {
  const denied = await guardAdminApi();
  if (denied) return denied;

  const tenant = process.env.MS_TENANT_ID ?? "";
  const clientId = process.env.MS_CLIENT_ID ?? "";
  const organiser = process.env.MS_ORGANISER_UPN ?? "";
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];

  if (!graphConfigured()) {
    return NextResponse.json({
      ok: false,
      steps: [
        {
          step: "Configuration",
          ok: false,
          detail: `Missing: ${[
            !tenant && "MS_TENANT_ID",
            !clientId && "MS_CLIENT_ID",
            !process.env.MS_CLIENT_SECRET && "MS_CLIENT_SECRET",
            !organiser && "MS_ORGANISER_UPN",
          ]
            .filter(Boolean)
            .join(", ")}`,
        },
      ],
    });
  }
  steps.push({ step: "Configuration", ok: true, detail: `tenant ${tenant.slice(0, 8)}…, organiser ${organiser}` });

  // 1. Can we mint a token? Proves the secret is right and not expired.
  let token = "";
  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: process.env.MS_CLIENT_SECRET ?? "",
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      steps.push({ step: "Client secret", ok: false, detail: (data.error_description ?? "Token request failed").split("\n")[0] });
      return NextResponse.json({ ok: false, steps });
    }
    token = data.access_token;
    steps.push({ step: "Client secret", ok: true, detail: "Token acquired" });
  } catch {
    steps.push({ step: "Client secret", ok: false, detail: "Couldn't reach login.microsoftonline.com" });
    return NextResponse.json({ ok: false, steps });
  }

  // 2. Did admin consent actually land? The roles are inside the token, so this
  //    catches "permission added but never consented" — which otherwise mints a
  //    perfectly valid token and then 403s on every call.
  try {
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { roles?: string[] };
    const roles = claims.roles ?? [];
    const hasCalendars = roles.some((r) => r === "Calendars.ReadWrite");
    steps.push({
      step: "Admin consent",
      ok: hasCalendars,
      detail: hasCalendars
        ? `Granted: ${roles.join(", ")}`
        : roles.length
          ? `Calendars.ReadWrite is missing. Granted: ${roles.join(", ")}`
          : "No application roles granted — click 'Grant admin consent' in Entra.",
    });
    if (!hasCalendars) return NextResponse.json({ ok: false, steps });
  } catch {
    steps.push({ step: "Admin consent", ok: false, detail: "Couldn't read the token's roles." });
  }

  // 3. Is the organiser a real, reachable mailbox? An alias or an unlicensed
  //    account passes every check above and still can't hold a meeting.
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiser)}?$select=displayName,mail,userPrincipalName`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
    );
    const data = (await res.json().catch(() => ({}))) as {
      displayName?: string;
      mail?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      steps.push({
        step: "Organiser mailbox",
        ok: false,
        detail:
          res.status === 404
            ? `${organiser} isn't a mailbox in this tenant (an alias won't work — meetings need a real calendar).`
            : (data.error?.message ?? `Graph returned ${res.status}`).slice(0, 200),
      });
      return NextResponse.json({ ok: false, steps });
    }
    steps.push({ step: "Organiser mailbox", ok: true, detail: `${data.displayName} <${data.mail ?? organiser}>` });
  } catch {
    steps.push({ step: "Organiser mailbox", ok: false, detail: "Couldn't reach Microsoft Graph." });
    return NextResponse.json({ ok: false, steps });
  }

  return NextResponse.json({
    ok: true,
    steps,
    note: "Teams meetings are ready. Nothing was created or sent by this check.",
  });
}
