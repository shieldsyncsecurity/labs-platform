"use client";

// Client-side seam for the real Cognito flow. The heavy lifting (token exchange,
// JWT verification, cookies) is server-side in the /api/auth/* routes + cognito.ts;
// these are just the browser entry points the AuthProvider calls.
//
// Enabled when NEXT_PUBLIC_AUTH_MODE === "cognito". Otherwise the app uses the
// local mock in context.tsx, so offline dev is untouched.

import type { AuthUser } from "./types";

export const COGNITO_ENABLED = process.env.NEXT_PUBLIC_AUTH_MODE === "cognito";

export function cognitoSignIn(provider: "google" | "linkedin", returnTo = "/dashboard"): void {
  window.location.href = `/api/auth/login?provider=${provider}&returnTo=${encodeURIComponent(returnTo)}`;
}

export function cognitoSignOut(): void {
  window.location.href = "/api/auth/logout";
}

export async function cognitoGetUser(): Promise<AuthUser | null> {
  try {
    const r = await fetch("/api/auth/me", { cache: "no-store" });
    const d = (await r.json()) as { user?: AuthUser | null };
    return d.user ?? null;
  } catch {
    return null;
  }
}
