"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { COGNITO_ENABLED } from "@/lib/auth/cognito-adapter";

// Only honour a same-origin path as the post-sign-in destination — never an
// absolute/external or protocol-relative URL (open-redirect). Mirrors the
// server-side guard in /api/auth/login + /api/auth/callback.
function safeReturnTo(raw: string | null): string {
  return raw && /^\/[^/\\]/.test(raw) ? raw : "/dashboard";
}

export default function SignInPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<"google" | "linkedin" | null>(null);

  async function go(provider: "google" | "linkedin") {
    setBusy(provider);
    // Read at click time (client-only) so we don't need a Suspense boundary for
    // useSearchParams. Cognito does a full-page redirect and returns to this path
    // via the server; the mock resolves and we push to it below.
    const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
    await signIn(provider, returnTo);
    router.push(returnTo);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-16">
      <h1 className="text-2xl font-extrabold text-ink">Sign in to ShieldSync Labs</h1>
      <p className="mt-2 text-base text-ink-soft">
        One click — no signup form. Your first beginner lab is free.
      </p>

      <div className="mt-7 flex flex-col gap-3">
        <button
          onClick={() => go("google")}
          disabled={busy !== null}
          className="flex items-center justify-center gap-3 rounded-xl border border-line bg-surface px-5 py-3.5 text-base font-semibold text-ink hover:bg-canvas disabled:opacity-60"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#ea4335] text-xs font-bold text-white">G</span>
          {busy === "google" ? "Signing in…" : "Continue with Google"}
        </button>
        <button
          onClick={() => go("linkedin")}
          disabled={busy !== null}
          className="flex items-center justify-center gap-3 rounded-xl border border-line bg-surface px-5 py-3.5 text-base font-semibold text-ink hover:bg-canvas disabled:opacity-60"
        >
          <span className="grid h-5 w-5 place-items-center rounded bg-[#0a66c2] text-xs font-bold text-white">in</span>
          {busy === "linkedin" ? "Signing in…" : "Continue with LinkedIn"}
        </button>
      </div>

      {!COGNITO_ENABLED && (
        <p className="mt-6 text-sm text-muted">
          Demo sign-in (offline). In production these route through Amazon Cognito — Google as a
          built-in social provider, LinkedIn via OpenID Connect.
        </p>
      )}
    </div>
  );
}
