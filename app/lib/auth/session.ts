// Server-side "who is this request" — verifies the session cookie.
// One source of truth for the user id used by entitlement + launch gating.

import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE, type SessionUser } from "./cognito";

export async function getServerUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSession(token);
}
