import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { COMPANY } from "@/lib/company";
import { getQuestionnaire } from "@/lib/questionnaire";
import { QUESTIONNAIRE_LINK_HOURS, type Candidate } from "@/lib/candidate";

export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Issue a fresh questionnaire link for a candidate and email it to them.
// Re-sending mints a NEW token and invalidates the previous one (single active
// link per candidate), so a forwarded old link stops working.
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  // Link lifetime — see QUESTIONNAIRE_LINK_HOURS in lib/candidate.ts (shared
  // with the public /q/[token] page so the email and the on-page notice can
  // never drift out of sync again).
  const LINK_HOURS = QUESTIONNAIRE_LINK_HOURS;

  let body: { to?: string; send?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let candidate: Candidate;
  try {
    candidate = (await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${encodeURIComponent(seq)}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not load the candidate." }, { status: 502 });
  }
  if (candidate.submittedAt) {
    return NextResponse.json({ error: "This candidate has already submitted their questionnaire." }, { status: 409 });
  }

  const to = (body.to ?? candidate.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }
  // Mint the token (the engine stores only its hash and returns the raw value once).
  // The engine accepts validDays, not hours — convert (may be fractional; the engine rounds).
  let token: string;
  let expiresAt: string;
  try {
    const out = await hrFetch<{ token: string; expiresAt: string }>(`/hr/candidates/${encodeURIComponent(seq)}/token`, {
      method: "POST",
      body: { validDays: LINK_HOURS / 24, actor },
    });
    token = out.token;
    expiresAt = out.expiresAt;
  } catch {
    return NextResponse.json({ error: "Could not create the questionnaire link." }, { status: 502 });
  }

  const base = process.env.APP_URL || new URL(req.url).origin;
  const link = `${base}/q/${encodeURIComponent(token)}`;
  // If we tailored the questionnaire for this candidate, use its title/intro
  // — the invite email should match what she is about to see.
  const q = candidate.customQuestionnaire ?? getQuestionnaire(candidate.questionnaireRole);
  const role = candidate.roleAppliedFor || q.roleTitle;
  const firstName = candidate.name.split(" ")[0] || candidate.name;

  // Caller can ask for the link only (copy/paste via WhatsApp etc.).
  if (body.send === false) {
    return NextResponse.json({ ok: true, link, expiresAt, sent: false });
  }

  const subject = `${COMPANY.shortName} — a few questions after your interview — 15 minutes (${role})`;
  const text = `Hello ${firstName},

Thank you for taking the time to interview with us for the ${role} role.

To help us get to know you properly, please fill in this short questionnaire:
${link}

It takes about 15 minutes. Your answers are saved as you type, and once you submit you'll be able to see everything you sent.

This link is personal to you. Please fill it in within the next ${LINK_HOURS} hours — after that the link will stop working.

Warm regards,
HR Team
${COMPANY.legalName}
${COMPANY.hrEmail}`;

  // Table-based layout on purpose: plain <div>s with max-width/border-radius
  // render inconsistently across webmail (Outlook.com in particular ignored
  // the width constraint and shipped the navy header edge-to-edge — confirmed
  // from a real delivered email). This version fixes a second real bug found
  // the same way: the button's rounded corners were getting lost in Outlook's
  // renderer because bgcolor+border-radius on a bare <td> isn't reliable —
  // nesting an inner table INSIDE the button cell (the standard "bulletproof
  // button" pattern) is what actually survives Outlook.com's engine.
  const logoUrl = `${base}/brand/cipher-s-mark.png`;
  const html = `<div style="margin:0;padding:32px 16px;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:#ffffff;border:1px solid #e1e6ee;border-radius:14px;">
<tr>
<td bgcolor="#1f3a5f" style="background:#1f3a5f;padding:24px 28px;border-radius:14px 14px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:12px;"><img src="${esc(logoUrl)}" width="34" height="34" alt="" style="display:block;border-radius:8px;" /></td>
<td valign="middle">
<span style="color:#ffffff;font-weight:bold;font-size:16px;font-family:Arial,Helvetica,sans-serif;line-height:1.3;">${esc(COMPANY.legalName)}</span><br>
<span style="color:#a9bcd8;font-size:12px;font-family:Arial,Helvetica,sans-serif;">${esc(COMPANY.tagline)}</span>
</td>
</tr></table>
</td>
</tr>
<tr>
<td style="padding:32px 30px 8px;font-family:Arial,Helvetica,sans-serif;color:#1b2331;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Hello ${esc(firstName)},</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.7;">
Thank you for taking the time to interview with us for the <b>${esc(role)}</b> role. We enjoyed speaking with you.
</p>
<p style="margin:0 0 28px;font-size:14px;line-height:1.7;">
To help us get to know you properly &mdash; your experience, how you like to work, and a little about you outside work &mdash;
please fill in this short questionnaire. It takes about <b>15 minutes</b>.
</p>
</td>
</tr>
<tr>
<td align="center" style="padding:0 30px 28px;">
<!-- Bulletproof button: an inner table so the rounded, coloured pill survives Outlook.com's renderer -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="#1f3a5f" style="background:#1f3a5f;border-radius:999px;">
<a href="${esc(link)}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px;">Open my questionnaire</a>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding:0 30px 28px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0 0 14px;font-size:12.5px;line-height:1.6;color:#5b6676;">
Your answers are saved on your device as you type, and once you submit you'll be able to see everything you sent.
This link is personal to you. Please fill it in within the next <b>${LINK_HOURS} hours</b> &mdash; after that it will stop working.
</p>
<p style="margin:0;font-size:12px;line-height:1.6;color:#8a94a3;word-break:break-all;">
If the button doesn't work, paste this into your browser:<br>${esc(link)}
</p>
</td>
</tr>
<tr>
<td style="padding:22px 30px 28px;border-top:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#5b6676;">
Warm regards,<br><b>HR Team</b><br>${esc(COMPANY.legalName)}<br>
<a href="mailto:${esc(COMPANY.hrEmail)}" style="color:#2f4fb0;">${esc(COMPANY.hrEmail)}</a>
</td>
</tr>
</table>
</td></tr>
</table>
</div>`;

  let simulated = false;
  try {
    const out = await hrFetch<{ simulated?: boolean }>("/hr/notify", {
      method: "POST",
      body: { toEmail: to, subject, html, text, actor, action: "candidate.invite", target: candidate.candidateId },
      timeoutMs: 30000,
    });
    simulated = Boolean(out.simulated);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 503) {
      // Link is live and valid — email transport just isn't configured.
      return NextResponse.json({ ok: true, link, expiresAt, sent: false, warning: "Email isn't configured — copy the link below and send it yourself." });
    }
    return NextResponse.json({ ok: true, link, expiresAt, sent: false, warning: "The link was created but the email failed to send — copy it below and send it yourself." });
  }

  try {
    await hrFetch(`/hr/candidates/${encodeURIComponent(seq)}/sent`, { method: "POST", body: { to, actor } });
  } catch {
    /* best-effort bookkeeping */
  }

  return NextResponse.json({ ok: true, link, expiresAt, sent: true, simulated });
}
