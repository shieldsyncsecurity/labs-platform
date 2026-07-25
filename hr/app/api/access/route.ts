import { NextResponse } from "next/server";
import { guardAdminApi, hrAdmins, isAdminEmail } from "@/lib/server/hr-access";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";
import { hrAllowlist } from "@/lib/server/hr-token";
import { normalizeAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Everyone who can sign in, with what they may currently do. Admin only —
 * the permission map is itself sensitive: it says exactly where the gaps are. */
export async function GET() {
  const denied = await guardAdminApi();
  if (denied) return denied;

  let grants: Record<string, unknown> = {};
  try {
    grants = (await hrFetch<{ grants?: Record<string, unknown> }>("/hr/access")).grants ?? {};
  } catch {
    return NextResponse.json({ error: "Could not read permissions." }, { status: 502 });
  }

  const admins = hrAdmins();
  const people = [...hrAllowlist()].map((email) => ({
    email,
    isAdmin: admins.has(email),
    access: admins.has(email) ? null : normalizeAccess(grants[email]),
    // Distinguishes "granted nothing" from "never set up", which the UI shows
    // differently — the second is a to-do, the first is a decision.
    configured: admins.has(email) ? true : Object.prototype.hasOwnProperty.call(grants, email),
  }));

  return NextResponse.json({ people });
}

/** Set one person's permissions. */
export async function PUT(req: Request) {
  const denied = await guardAdminApi();
  if (denied) return denied;

  let body: { email?: string; access?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Which person?" }, { status: 400 });

  // Only people who can actually sign in may hold permissions — otherwise the
  // matrix slowly fills with stale rows for people who left.
  if (!hrAllowlist().has(email)) {
    return NextResponse.json({ error: "That address is not on the sign-in allowlist." }, { status: 400 });
  }
  // Admin rights come from the environment. Storing a grant for an admin would
  // create a second, contradictory source of truth for the same question.
  if (isAdminEmail(email)) {
    return NextResponse.json(
      { error: "That address is an administrator and always has full access. Change HR_ADMIN_EMAILS to alter that." },
      { status: 400 },
    );
  }

  const access = normalizeAccess(body.access);
  try {
    const actor = await getHrActor();
    await hrFetch("/hr/access", { method: "PUT", body: { email, access, actor } });
  } catch {
    return NextResponse.json({ error: "Could not save permissions." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, email, access });
}
