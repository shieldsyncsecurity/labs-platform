// Cookie-bound self-serve session helpers (server components + Route
// Handlers). Mirrors hr-session.ts exactly, but for the SELF_COOKIE boundary —
// getSelfSession() is the single place /my/* code asks "which ex-employee, if
// any, is this?" and must fail closed (null) on anything but a valid token.

import { cookies } from "next/headers";
import { SELF_COOKIE, SELF_COOKIE_MAX_AGE, signSelfSession, verifySelfSession, type SelfSession } from "./self-token";

/** The signed-in self-serve identity, or null. Server-only. */
export async function getSelfSession(): Promise<SelfSession | null> {
  const store = await cookies();
  const value = store.get(SELF_COOKIE)?.value;
  if (!value) return null;
  return verifySelfSession(value);
}

/** Stamp a signed self-serve session cookie after PIN verification. */
export async function setSelfCookie(seq: number): Promise<void> {
  const token = await signSelfSession({ seq });
  const store = await cookies();
  store.set(SELF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SELF_COOKIE_MAX_AGE,
  });
}

export async function clearSelfSession(): Promise<void> {
  const store = await cookies();
  store.delete(SELF_COOKIE);
}
