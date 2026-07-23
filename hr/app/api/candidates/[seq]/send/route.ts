import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { COMPANY } from "@/lib/company";
import { getQuestionnaire } from "@/lib/questionnaire";
import type { Candidate } from "@/lib/candidate";

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

  // Link lifetime is fixed at 36 hours (owner's decision, 2026-07-23) — the
  // candidate is expected to fill it while the interview is fresh, and a long
  // window mostly means the link sits forgotten in an inbox.
  const LINK_HOURS = 36;

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
  // The engine accepts validDays; 36 hours = 1.5 days keeps the wire contract unchanged.
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

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1b2331">
  <div style="background:#1f3a5f;padding:18px 20px;border-radius:10px 10px 0 0">
    <div style="color:#fff;font-weight:800;font-size:15px">${esc(COMPANY.legalName)}</div>
    <div style="color:#a9bcd8;font-size:11.5px;margin-top:2px">${esc(COMPANY.tagline)}</div>
  </div>
  <div style="border:1px solid #e2e8f2;border-top:none;border-radius:0 0 10px 10px;padding:24px 22px">
    <p style="font-size:15px;margin:0 0 12px">Hello ${esc(firstName)},</p>
    <p style="font-size:14px;line-height:1.65;margin:0 0 14px">
      Thank you for taking the time to interview with us for the <b>${esc(role)}</b> role. We enjoyed speaking with you.
    </p>
    <p style="font-size:14px;line-height:1.65;margin:0 0 18px">
      To help us get to know you properly &mdash; your experience, how you like to work, and a little about you outside work &mdash;
      please fill in this short questionnaire. It takes about <b>15 minutes</b>.
    </p>
    <p style="margin:0 0 18px">
      <a href="${esc(link)}" style="background:#1f3a5f;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 26px;border-radius:8px;display:inline-block">Open my questionnaire</a>
    </p>
    <p style="font-size:12.5px;color:#5b6676;line-height:1.6;margin:0 0 14px">
      Your answers are saved on your device as you type, and once you submit you'll be able to see everything you sent.
      This link is personal to you. Please fill it in within the next <b>${LINK_HOURS} hours</b> &mdash; after that it will stop working.
    </p>
    <p style="font-size:12px;color:#8a94a3;line-height:1.6;margin:0 0 16px;word-break:break-all">
      If the button doesn't work, paste this into your browser:<br>${esc(link)}
    </p>
    <div style="border-top:1px solid #eef2f7;padding-top:14px;font-size:12.5px;color:#5b6676;line-height:1.6">
      Warm regards,<br><b>HR Team</b><br>${esc(COMPANY.legalName)}<br>
      <a href="mailto:${esc(COMPANY.hrEmail)}" style="color:#2f4fb0">${esc(COMPANY.hrEmail)}</a>
    </div>
  </div>
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
