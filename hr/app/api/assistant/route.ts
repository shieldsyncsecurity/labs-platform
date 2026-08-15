import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { guardApi } from "@/lib/server/hr-access";
import { hrFetch } from "@/lib/server/hr-engine";
import type { Candidate } from "@/lib/candidate";
import { DEFAULT_DURATION_MINUTES, formatIST, scheduleWarnings, todayIST } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

/**
 * The scheduling assistant.
 *
 * IT NEVER SENDS ANYTHING. The model's only job is to turn a sentence into a
 * *proposal*; the UI shows that proposal and the user confirms, at which point
 * the ordinary guarded endpoint does the work. That separation is the whole
 * safety design: an invite to a real candidate is unsendable, so no parse —
 * however confident — is allowed to trigger one on its own.
 *
 * When the request is ambiguous ("3pm" with no day, two candidates called A),
 * the model is instructed to ask rather than pick. A chatbot that guesses at an
 * irreversible action is worse than no chatbot.
 */

const MODEL = "claude-opus-5";

/** What the model is allowed to come back with. Anything not expressible here
 *  can't be proposed — the schema IS the permission boundary. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "What to say to the user. If asking a clarifying question, put it here.",
    },
    action: {
      type: "string",
      enum: ["schedule_interview", "clarify", "none"],
      description: "'clarify' when anything is ambiguous or missing. 'none' when the message isn't a scheduling request.",
    },
    candidateSeq: { type: ["integer", "null"], description: "seq of the matched candidate, null if unsure" },
    startsAt: { type: ["string", "null"], description: "ISO 8601 UTC instant for the interview start, null if unknown" },
    durationMinutes: { type: ["integer", "null"] },
    round: { type: ["string", "null"], description: "e.g. Screening, Technical, Final" },
    panel: { type: ["string", "null"] },
    sendInvite: { type: ["boolean", "null"], description: "false if the user asked for a hold / not to notify the candidate" },
  },
  required: ["reply", "action", "candidateSeq", "startsAt", "durationMinutes", "round", "panel", "sendInvite"],
  additionalProperties: false,
} as const;

function systemPrompt(candidates: Candidate[]): string {
  const roster = candidates.length
    ? candidates
        .map((c) => `- seq ${c.seq}: ${c.name} (${c.candidateId}), applying for ${c.roleAppliedFor}, outcome: ${c.outcome}`)
        .join("\n")
    : "(no candidates on file)";

  return `You help the founder of ShieldSync Security schedule candidate interviews.

Today's date is ${todayIST()} and the company works in IST (UTC+05:30). All times the user says are IST unless they state otherwise. Return startsAt as a UTC instant.

Candidates you may schedule with:
${roster}

Rules:
- You never send anything. You produce a proposal that the user confirms. Say what you are proposing, not what you have done.
- Ask rather than guess. If the day is missing ("3pm" with no date), if a name matches more than one candidate or none, or if the request is vague, set action to "clarify" and ask one specific question.
- A bare time with no day is ambiguous even if the time is still in the future today. Ask.
- Default duration is ${DEFAULT_DURATION_MINUTES} minutes when unstated. That is a safe default, not a guess worth asking about.
- If the user asks for a hold, a placeholder, or says not to tell the candidate yet, set sendInvite to false.
- If the message isn't about scheduling, set action to "none" and answer briefly and plainly.
- Keep replies to one or two sentences. The user is busy and the proposal card shows the details.`;
}

type Parsed = {
  reply: string;
  action: "schedule_interview" | "clarify" | "none";
  candidateSeq: number | null;
  startsAt: string | null;
  durationMinutes: number | null;
  round: string | null;
  panel: string | null;
  sendInvite: boolean | null;
};

export async function POST(req: Request) {
  // Scheduling an interview is a candidate write, so reaching the assistant at
  // all requires that permission — the model must never be a way around it.
  const denied = await guardApi("candidates", "write");
  if (denied) return denied;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The assistant isn't connected yet. Use the scheduling form below in the meantime." },
      { status: 503 },
    );
  }

  let body: { message?: string; history?: Array<{ role: "user" | "assistant"; content: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Say what you'd like to do." }, { status: 400 });
  if (message.length > 2000) return NextResponse.json({ error: "That message is too long." }, { status: 400 });

  let candidates: Candidate[] = [];
  try {
    candidates = (await hrFetch<{ candidates?: Candidate[] }>("/hr/candidates")).candidates ?? [];
  } catch {
    return NextResponse.json({ error: "Could not load your candidates just now." }, { status: 502 });
  }

  const client = new Anthropic();
  let parsed: Parsed;
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(candidates),
      // Prior turns give the model what "make it 4pm instead" refers to.
      messages: [
        ...(body.history ?? []).slice(-8).map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: message },
      ],
      output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    });
    const text = res.content.find((b) => b.type === "text");
    parsed = JSON.parse(text && "text" in text ? text.text : "{}") as Parsed;
  } catch {
    return NextResponse.json({ error: "The assistant couldn't respond. Use the form below instead." }, { status: 502 });
  }

  // Nothing to confirm — just talk back.
  if (parsed.action !== "schedule_interview") {
    return NextResponse.json({ reply: parsed.reply, proposal: null });
  }

  // Re-validate everything the model produced. It is an untrusted parser, not
  // an authority: a hallucinated seq or a malformed date must not become a
  // proposal the user can one-click approve.
  const candidate = candidates.find((c) => c.seq === parsed.candidateSeq);
  if (!candidate) {
    return NextResponse.json({
      reply: "I couldn't match that to a candidate on file. Who did you mean?",
      proposal: null,
    });
  }
  if (!parsed.startsAt || Number.isNaN(Date.parse(parsed.startsAt))) {
    return NextResponse.json({ reply: "What date and time should I use?", proposal: null });
  }

  const startsAt = new Date(parsed.startsAt).toISOString();
  const durationMinutes = parsed.durationMinutes && parsed.durationMinutes > 0 ? parsed.durationMinutes : DEFAULT_DURATION_MINUTES;

  return NextResponse.json({
    reply: parsed.reply,
    proposal: {
      candidateSeq: candidate.seq,
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      role: candidate.roleAppliedFor,
      startsAt,
      whenLabel: formatIST(startsAt),
      durationMinutes,
      round: parsed.round ?? undefined,
      panel: parsed.panel ?? undefined,
      sendInvite: parsed.sendInvite !== false,
      // Surfaced on the confirmation card so an odd slot is caught by a human
      // before the invite goes, not after.
      warnings: scheduleWarnings(startsAt),
    },
  });
}
