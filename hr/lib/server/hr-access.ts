// Server-side permission resolution and the guards every protected surface uses.
//
// Permissions are read FRESH from the data plane on each request (memoised for
// the duration of that request by React `cache`), deliberately NOT baked into
// the session cookie. Cookie-embedded permissions would mean a revocation only
// took effect at the target's next sign-in — up to 12 hours later. When the
// owner takes banking away from someone, it has to be gone now.
//
// NEVER import this from client code: it reads the engine secret via hrFetch.

import { cache } from "react";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getHrActor } from "./hr-session";
import { hrFetch } from "./hr-engine";
import { hrAdmins, isAdminEmail } from "./hr-token";
import { type Access, type Area, can, fullAccess, noAccess, normalizeAccess } from "@/lib/access";

// Admin identity is environment configuration, defined once in hr-token.ts so
// the edge middleware and these guards can never disagree about who the owner is.
export { hrAdmins, isAdminEmail };

export type Viewer = {
  actor: string | null;
  isAdmin: boolean;
  access: Access;
};

/** The signed-in user and what they may do. Memoised per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const actor = await getHrActor();
  if (!actor) return { actor: null, isAdmin: false, access: noAccess() };
  if (isAdminEmail(actor)) return { actor, isAdmin: true, access: fullAccess() };

  try {
    const { grants } = await hrFetch<{ grants?: Record<string, unknown> }>("/hr/access");
    const mine = grants?.[actor.trim().toLowerCase()];
    // No grant on file means nothing has been given yet — not "everything".
    return { actor, isAdmin: false, access: mine ? normalizeAccess(mine) : noAccess() };
  } catch {
    // The store being unreachable must not silently widen access.
    return { actor, isAdmin: false, access: noAccess() };
  }
});

/**
 * Guard for Route Handlers. Returns a response to send back when the caller is
 * not allowed, or null to proceed:
 *
 *   const denied = await guardApi("banking", "write");
 *   if (denied) return denied;
 */
export async function guardApi(area: Area, need: "read" | "write"): Promise<NextResponse | null> {
  const { actor, isAdmin, access } = await getViewer();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (isAdmin || can(access, area, need)) return null;
  return NextResponse.json(
    { error: "You do not have access to this. Ask the administrator if you need it." },
    { status: 403 },
  );
}

/** Guard for admin-only Route Handlers (the access editor itself). */
export async function guardAdminApi(): Promise<NextResponse | null> {
  const { actor, isAdmin } = await getViewer();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (isAdmin) return null;
  return NextResponse.json({ error: "Administrator only." }, { status: 403 });
}

/**
 * Guard for pages (server components). Redirects rather than rendering, so a
 * forbidden page never half-renders sensitive data before the check lands.
 */
export async function requirePage(area: Area, need: "read" | "write" = "read"): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.actor) redirect("/login");
  if (viewer.isAdmin || can(viewer.access, area, need)) return viewer;
  redirect(`/no-access?area=${encodeURIComponent(area)}`);
}

/** Admin-only pages. */
export async function requireAdminPage(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.actor) redirect("/login");
  if (!viewer.isAdmin) redirect("/no-access?area=admin");
  return viewer;
}
