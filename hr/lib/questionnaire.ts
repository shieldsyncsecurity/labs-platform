// The candidate questionnaire — ONE data-driven definition that drives the
// public form, server-side validation, and the HR read-back view. Adding a
// question here makes it appear (and validate, and display) everywhere.
//
// LENGTH IS A FEATURE: capped at ~30 questions (owner's call). Before adding a
// question, CUT ONE — and check the stated time still matches: the written
// answers (`textarea`) drive it, roughly 60–75 seconds each, so 10 of them is
// ~15 minutes. Keep the intro and the invite email honest about that number.
//
// DELIBERATELY ABSENT: marital status, religion, caste, gender, age/DOB,
// health, pregnancy, and family details. They are not job-relevant for any
// role here, and collecting them creates discrimination exposure in hiring.

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "tel"
  | "number"
  | "select"
  | "multiselect"
  | "rating" // 1-5
  | "date"
  | "file"
  | "consent";

export type Field = {
  id: string;
  label: string;
  type: FieldType;
  /**
   * EVERY question is required by default — mark `optional: true` to relax it.
   * Doing it this way round means relaxing a question is a one-word change and
   * a new question can never accidentally ship as skippable.
   */
  optional?: boolean;
  hint?: string;
  options?: string[];
  placeholder?: string;
  rows?: number;
  allowOther?: boolean;
};

/** File uploads are never forced — a candidate may not have the document to hand. */
export function isRequired(f: Field): boolean {
  return !f.optional && f.type !== "file";
}

export type Section = {
  id: string;
  title: string;
  blurb?: string;
  fields: Field[];
};

export type Questionnaire = {
  roleKey: string;
  roleTitle: string;
  intro: string;
  /** Shown under the submit button — what happens next. */
  outro?: string;
  sections: Section[];
};

const RATING_HINT = "1 = beginner · 3 = comfortable · 5 = expert";

/**
 * Who this role supports, written as a ROLE and never as a person — the
 * owner's name must not appear anywhere a candidate can read. Referring to
 * "the founder" rather than "your manager" is what keeps the questions
 * personal and specific to this job.
 */
const SUPPORTS = "the founder";

/** Self-rating rows for the EA skill grid. */
function skill(id: string, label: string): Field {
  return { id, label, type: "rating" };
}

export const EA_SECRETARY_QUESTIONNAIRE: Questionnaire = {
  roleKey: "ea-secretary",
  roleTitle: "Executive Assistant",
  intro: `Thank you for taking the time to meet us — we genuinely enjoyed the conversation.

This form is how we get to know you properly before we take a decision: how you like to work, what you are good at, and what you enjoy outside work. We would far rather read something honest and in your own words than something polished.

A little about the role: you would work directly with ${SUPPORTS}, right at the centre of a small and growing cybersecurity company. It is real responsibility from day one, you will see how the whole business runs, and what you do will genuinely matter to us.

It takes about 15 minutes. Your answers save as you type, so you can pause and come back, and you can review everything at the end.`,
  outro: `Thank you — that is everything we need. We read every answer properly and will come back to you shortly. If anything needs correcting, just email us.`,
  sections: [
    {
      id: "about",
      title: "About you",
      fields: [{ id: "fullName", label: "Full name", type: "text" }],
    },
    {
      id: "experience",
      title: "Your experience & availability",
      blurb: "We care much more about what you have actually handled than about job titles.",
      fields: [
        {
          id: "totalExperience",
          label: "Total work experience",
          type: "select",
          options: [
            "Fresher (no formal experience)",
            "Internship experience only",
            "Less than 1 year",
            "1–2 years",
            "2–4 years",
            "4–7 years",
            "More than 7 years",
          ],
        },
        {
          id: "responsibilities",
          label: "What do (or did) you actually handle day to day?",
          type: "textarea",
          rows: 4,
          hint: "Be specific — the tasks you personally owned, not the team's.",
        },
        {
          id: "currentCtc",
          label: "Current / last monthly salary or stipend (₹)",
          type: "text",
          hint: "Write 'Not applicable' if this is your first role.",
        },
        {
          id: "lastRemunerationProof",
          label: "Upload proof of that amount — your last payslip, offer letter or internship letter",
          type: "file",
          // Not enforced server-side but the form never SAYS "optional" —
          // labelling it so invites skipping.
          optional: true,
          hint: "PDF, JPG or PNG, up to 4 MB. Stored encrypted and seen only by our HR team.",
        },
        {
          id: "expectedCtc",
          label: "What are you hoping to earn each month (₹)?",
          type: "text",
          hint: "Give us a real number rather than a safe one — we would rather have an honest starting point than negotiate in the dark.",
        },
        {
          id: "noticePeriod",
          label: "How soon can you join?",
          type: "select",
          options: ["Immediately", "Within 15 days", "Within 30 days", "Within 60 days", "Serving notice — I will confirm the date"],
        },
        {
          id: "urgentWillingness",
          label: "How willing are you to take on urgent work at short notice, including outside normal working hours?",
          type: "select",
          options: [
            "Very willing — anytime, including evenings and weekends",
            "Willing — happy to help in the evenings when something cannot wait",
            "Happy to help occasionally when it truly matters",
            "Happy to help within my working hours, and to plan around the occasional urgency",
          ],
          hint: "Please answer honestly — it helps us plan the role properly.",
        },
      ],
    },
    {
      id: "skills",
      title: "Executive assistant skills",
      blurb: `Please be honest rather than modest — nobody scores 5 on everything, and we are glad to train you on the rest. This tells us where you would want support, not whether you are good enough. ${RATING_HINT}.`,
      fields: [
        skill("skCalendar", "Calendar & diary management"),
        skill("skInbox", "Managing an inbox and drafting emails on someone else's behalf"),
        skill("skTravel", "Travel booking and itinerary planning"),
        skill("skPersonalSupport", "Handling personal appointments, errands and life admin on someone else's behalf"),
        skill("skExcel", "MS Excel / Google Sheets"),
        {
          id: "toolsDaily",
          label: "Which of these do you actually use regularly?",
          type: "multiselect",
          options: [
            "Google Workspace (Gmail, Calendar, Drive)",
            "Microsoft 365 (Outlook, Teams)",
            "Zoho (Mail, Docs, CRM)",
            "Zoom",
            "Asana",
            "Canva",
            "WhatsApp Business",
            "Tally / accounting software",
            "Calendly or similar scheduling tool",
            "Claude (Anthropic)",
            "Codex (OpenAI)",
            "Antigravity (Google)",
          ],
          allowOther: true,
        },
      ],
    },
    {
      id: "situational",
      title: "How you would handle real situations",
      blurb: "No model answers here — we just want to see how you think. A few sentences each is plenty.",
      fields: [
        {
          id: "sitConflict",
          label: `You find that ${SUPPORTS} has two important meetings booked at exactly the same time. Walk us through what you would do.`,
          type: "textarea",
          rows: 2,
        },
        {
          id: "sitConfidential",
          label:
            "We are a cybersecurity company, so you would handle confidential company and client information every day. How would you make sure it stays confidential?",
          type: "textarea",
          rows: 2,
        },
      ],
    },
    {
      id: "presentation",
      title: "Presentation & working style",
      blurb: "How the day-to-day would actually feel, and how you'd want to be part of it.",
      fields: [
        {
          id: "dressCode",
          label:
            "This role is client-facing and represents ShieldSync in meetings and at the office. Are you comfortable dressing formally or smart-professional as the day requires?",
          type: "select",
          options: [
            "Yes, absolutely — I already dress professionally",
            "Yes, and I enjoy dressing well — I see it as part of the job",
            "Yes, and I would love guidance on the dress code",
            "Yes, with some considerations we can discuss together",
          ],
        },
        {
          id: "peerPartnership",
          label:
            "We are a small team, and we will work side by side rather than boss-and-report. You would be expected to share your opinion, disagree when you disagree, and treat this as a partnership rather than a chain of command. How does that sit with you, and is it how you have worked before?",
          type: "textarea",
          rows: 4,
        },
        {
          id: "informalCulture",
          label:
            "The working style here is fairly informal — we talk directly, use first names, joke around, and there is no HR layer between the team. What kind of workplace culture do you feel most yourself in?",
          type: "textarea",
          rows: 3,
        },
        {
          id: "inTheRoom",
          label:
            "You would sometimes be part of conversations that go beyond diary and admin — things like how the business is going, ideas being tested, decisions being weighed up. How comfortable are you being in that kind of room, and would you want to contribute or prefer to stay out of it?",
          type: "textarea",
          rows: 3,
        },
      ],
    },
    {
      id: "personal",
      title: "Getting to know you",
      blurb: "The part a CV never captures. We read every one of these — it is how we get to know the person, not the CV.",
      fields: [
        {
          id: "freeTime",
          label: "How do you like to spend your time outside work?",
          type: "multiselect",
          options: [
            "Reading",
            "Cooking / baking",
            "Going out & partying",
            "Fashion & styling",
            "Shopping",
            "Meeting friends",
            "Gym / fitness",
            "Sports",
            "Dance",
            "Music",
            "Movies & series",
            "Gaming",
            "Travelling",
            "Photography",
            "Art & craft",
            "Volunteering",
            "Time with family",
            "Quiet time at home",
          ],
          allowOther: true,
          hint: "Pick as many as you like.",
        },
        {
          id: "personalDiscretion",
          label: `In this job you would see a lot of ${SUPPORTS}'s world — the diary, the travel, sometimes personal and family commitments, and conversations that are not for sharing. What does discretion mean to you personally?`,
          type: "textarea",
          rows: 4,
        },
        {
          id: "pushBack",
          label: `A good assistant also protects their boss from themselves — telling ${SUPPORTS} that a plan will not work, that the week is badly over-committed, or that something has been missed. How comfortable are you saying that to someone senior, and how would you say it?`,
          type: "textarea",
          rows: 4,
          hint: "We would much rather be told early than find out late.",
        },
        {
          id: "whatYouWant",
          label:
            "What would make you want to stay somewhere for years? And what would you want from the company in order to do your best work?",
          type: "textarea",
          rows: 4,
        },
        {
          id: "assistantMindset",
          label: `Much of this job is quiet, behind-the-scenes work — protecting ${SUPPORTS}'s time, remembering the things that slip through the cracks, chasing small details, and keeping the day running without being asked. How do you feel about that kind of work?`,
          type: "textarea",
          rows: 4,
        },
        {
          id: "pressureWithFounder",
          label: `Some days here are genuinely high-pressure. There will be moments when ${SUPPORTS} is in the middle of a crisis and comes across as urgent, blunt or frustrated. How do you keep yourself steady on a day like that?`,
          type: "textarea",
          rows: 4,
          hint: "We are asking openly because it is part of the job. Tell us what genuinely helps you.",
        },
        {
          id: "drainsAndEnergy",
          label: "What drains you at work, and what gives you energy back?",
          type: "textarea",
          rows: 3,
        },
        {
          id: "recognition",
          label: "How do you like to be recognised when you have done something well?",
          type: "textarea",
          rows: 3,
        },
      ],
    },
    {
      id: "interviewExperience",
      title: "Your impression of us",
      blurb: "This does not affect your application in any way — it only helps us do better.",
      fields: [
        { id: "expOverall", label: "Overall, how was your interview experience with us?", type: "rating" },
        {
          id: "expDescribe",
          label: "Which of these describe how the interview felt?",
          type: "multiselect",
          options: [
            "Welcoming",
            "Professional",
            "Thorough",
            "Friendly",
            "Clear about the role",
            "Honest",
            "Rushed",
            "Vague about the role",
            "Intimidating",
            "Disorganised",
          ],
          hint: "Tick anything that fits — the good and the not-so-good.",
        },
        {
          id: "expInterviewer",
          label: "What was your impression of the person who interviewed you — and is there anything they could have done differently?",
          type: "textarea",
          rows: 3,
        },
      ],
    },
    {
      id: "declaration",
      title: "Declaration",
      fields: [
        {
          id: "consent",
          label: "I confirm the information above is true and accurate.",
          type: "consent",
        },
      ],
    },
  ],
};

/** Every questionnaire the portal can send. Keyed by roleKey. */
export const QUESTIONNAIRES: Record<string, Questionnaire> = {
  [EA_SECRETARY_QUESTIONNAIRE.roleKey]: EA_SECRETARY_QUESTIONNAIRE,
};

export const DEFAULT_ROLE_KEY = EA_SECRETARY_QUESTIONNAIRE.roleKey;

export function getQuestionnaire(roleKey?: string): Questionnaire {
  return QUESTIONNAIRES[roleKey ?? ""] ?? EA_SECRETARY_QUESTIONNAIRE;
}

export function allFields(q: Questionnaire): Field[] {
  return q.sections.flatMap((s) => s.fields);
}

export type Answers = Record<string, string | string[]>;

/** Server-side validation — the browser's `required` is a convenience, not a gate. */
export function validateAnswers(q: Questionnaire, answers: Answers): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const f of allFields(q)) {
    if (!isRequired(f)) continue;
    const v = answers[f.id];
    const empty = v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");
    if (empty) missing.push(f.label);
  }
  return { ok: missing.length === 0, missing };
}

/** Human-readable answer for the HR view / print. */
export function displayAnswer(f: Field, v: string | string[] | undefined): string {
  if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || String(v).trim() === "")
    return f.type === "file" ? "Not uploaded" : "—";
  if (f.type === "consent") return String(v) === "yes" ? "Agreed" : "Not agreed";
  if (f.type === "rating") return `${v} / 5`;
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
