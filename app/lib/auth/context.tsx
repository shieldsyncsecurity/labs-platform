"use client";

// Local/offline auth identity (mock, persisted in localStorage) — swap
// MockAuthClient for CognitoAuthClient at M6 without touching useAuth.
//
// Entitlements are SERVER-AUTHORITATIVE: fetched from /api/entitlements and
// written only by the payment webhook. The client can't grant itself access.

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { AuthUser, Entitlement } from "./types";
import { getLab } from "@/lib/labs";
import { COGNITO_ENABLED, cognitoSignIn, cognitoSignOut, cognitoGetUser } from "./cognito-adapter";

// The mock/demo learner is a LOCAL-DEV fallback only. It must NEVER be reachable
// in production — real accounts (Cognito/Google) only. Gate it on a production
// build (NODE_ENV is inlined at build time) so even a misconfigured
// NEXT_PUBLIC_AUTH_MODE can't enable demo login in prod.
const ALLOW_MOCK = !COGNITO_ENABLED && process.env.NODE_ENV !== "production";

// Redirect-based flows (Cognito) navigate away; the returned promise never
// resolves so callers don't run post-await code before the browser leaves.
const NEVER = new Promise<void>(() => {});

const USER_KEY = "ss_labs_user";

function loadUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

const DEMO = {
  google: { name: "Demo Learner", email: "demo.learner@gmail.com" },
  linkedin: { name: "Demo Professional", email: "demo.pro@work.example" },
} as const;

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  entitlements: Entitlement[];
  signIn: (provider: "google" | "linkedin", returnTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasAccess: (slug: string) => boolean;
  refreshEntitlements: (u?: AuthUser | null) => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshEntitlements = useCallback(
    async (u?: AuthUser | null) => {
      const who = u ?? user;
      if (!who) {
        setEntitlements([]);
        return;
      }
      try {
        const r = await fetch(`/api/entitlements?userId=${encodeURIComponent(who.id)}`);
        const data = (await r.json()) as { entitlements?: Entitlement[] };
        setEntitlements(data.entitlements ?? []);
      } catch {
        /* offline / not ready — leave as-is */
      }
    },
    [user]
  );

  useEffect(() => {
    (async () => {
      const u = COGNITO_ENABLED ? await cognitoGetUser() : ALLOW_MOCK ? loadUser() : null;
      setUser(u);
      setLoading(false);
      if (u) void refreshEntitlements(u);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (provider: "google" | "linkedin", returnTo = "/dashboard") => {
      if (COGNITO_ENABLED) {
        cognitoSignIn(provider, returnTo); // full-page redirect to Cognito, then back to returnTo
        return NEVER;
      }
      // Production hardening: no Cognito + not a dev build = NO login at all.
      // The demo learner is dev-only; real accounts only in prod.
      if (!ALLOW_MOCK) {
        console.error("Auth not configured (no Cognito) — demo login is disabled in production.");
        return;
      }
      // Mock (offline dev only): mint a demo user.
      const d = DEMO[provider];
      const u: AuthUser = { id: `${provider}-demo`, email: d.email, name: d.name, provider };
      setUser(u);
      if (typeof window !== "undefined") window.localStorage.setItem(USER_KEY, JSON.stringify(u));
      await refreshEntitlements(u);
    },
    [refreshEntitlements]
  );

  const signOut = useCallback(async () => {
    // Best-effort: end any live lab in THIS browser first, so its account is
    // released immediately instead of waiting ≤3 min for the reaper. `keepalive`
    // lets the request survive the imminent logout navigation.
    if (typeof window !== "undefined") {
      try {
        const labKeys: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k && k.startsWith("lab:")) labKeys.push(k);
        }
        for (const k of labKeys) {
          const sid = window.sessionStorage.getItem(k);
          if (sid) {
            void fetch("/api/end-lab", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId: sid }),
              keepalive: true,
            });
          }
          window.sessionStorage.removeItem(k);
        }
      } catch {}
    }
    if (COGNITO_ENABLED) {
      cognitoSignOut(); // clears cookie + Cognito session, then redirects
      return NEVER;
    }
    setUser(null);
    setEntitlements([]);
    if (typeof window !== "undefined") window.localStorage.removeItem(USER_KEY);
  }, []);

  const hasAccess = useCallback(
    (slug: string) => {
      if (getLab(slug)?.free) return true;
      const now = Date.now();
      return entitlements.some((e) => {
        if (e.labSlug !== slug && e.labSlug !== "*") return false;
        if (e.accessUntil && new Date(e.accessUntil).getTime() < now) return false;
        return true;
      });
    },
    [entitlements]
  );

  return (
    <Ctx.Provider value={{ user, loading, entitlements, signIn, signOut, hasAccess, refreshEntitlements }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
