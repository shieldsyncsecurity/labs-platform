"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { COGNITO_ENABLED } from "@/lib/auth/cognito-adapter";
import { labCatalog } from "@/lib/lab-catalog";

// Only honour a same-origin path as the post-sign-in destination — never an
// absolute/external or protocol-relative URL (open-redirect). Mirrors the
// server-side guard in /api/auth/login + /api/auth/callback.
function safeReturnTo(raw: string | null): string {
  return raw && /^\/[^/\\]/.test(raw) ? raw : "/dashboard";
}

type SignInContext = { heading: string; sub: string };

const DEFAULT_CONTEXT: SignInContext = {
  heading: "Sign in to ShieldSync Labs",
  sub: "One click — no signup form. Your first beginner lab is free.",
};

// Derive a tailored heading from where the user was headed. The lab page sends
// unauthenticated learners here with returnTo=/labs/<slug>, so we can name the
// lab they're one click away from instead of showing a generic prompt.
function contextFor(returnTo: string): SignInContext {
  const m = returnTo.match(/^\/labs\/([a-z0-9-]+)/);
  if (m) {
    const lab = labCatalog.find((l) => l.slug === m[1]);
    if (lab?.free) {
      return {
        heading: "Sign in to launch your free lab",
        sub: `${lab.title} — free, no card needed. One click and you're in.`,
      };
    }
    if (lab) {
      return {
        heading: "Sign in to continue",
        sub: `You'll go straight to ${lab.title} right after signing in.`,
      };
    }
    return {
      heading: "Sign in to launch your lab",
      sub: "One click and you'll pick up right where you left off.",
    };
  }
  return DEFAULT_CONTEXT;
}

export default function SignInPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<"google" | "linkedin" | null>(null);
  // Start from the default so the server render and first client render match
  // (no Suspense boundary needed); refine from the URL after mount.
  const [ctx, setCtx] = useState<SignInContext>(DEFAULT_CONTEXT);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCtx(contextFor(safeReturnTo(params.get("returnTo"))));
    setAuthError(params.has("error"));
  }, []);

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
    // Vertically centered instead of pinned to the top — the old layout left ~2/3
    // of the viewport as dead space below a small left-aligned card. 66px accounts
    // for the sticky header (matches the --ss-chrome-h convention used elsewhere).
    <div className="flex min-h-[calc(100dvh-66px)] items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <div className="h-[3px] w-full bg-gradient-to-r from-brand to-cyan" aria-hidden />
          <div className="p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-ink">{ctx.heading}</h1>
            <p className="mt-2 text-base text-ink-soft">{ctx.sub}</p>

            {authError && (
              <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                That sign-in didn&apos;t complete. Please try again.
              </p>
            )}

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
                Demo sign-in (offline). In production, sign-in happens securely through Google or
                LinkedIn — this demo skips that step.
              </p>
            )}
          </div>

          {/* Same trust strip used on the lab page's signed-out card (lab-panel.tsx)
              — reusing an established pattern instead of inventing new copy, and it
              fills what was empty space with something that actually earns trust. */}
          <div className="border-t border-line bg-canvas/60 px-6 py-4 sm:px-8">
            <ul className="grid gap-1.5">
              {[
                { i: "🔐", t: "Your own real, isolated AWS account" },
                { i: "✓", t: "Auto-graded against your live fixes" },
                { i: "🧹", t: "Auto-wiped when you're done" },
              ].map((c) => (
                <li key={c.t} className="flex items-start gap-2 text-sm text-ink-soft">
                  <span aria-hidden className="mt-0.5 flex-none">{c.i}</span>
                  {c.t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
