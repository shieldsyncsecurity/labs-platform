"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth/context";

export default function SignInPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<"google" | "linkedin" | null>(null);

  async function go(provider: "google" | "linkedin") {
    setBusy(provider);
    await signIn(provider);
    router.push("/dashboard");
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

      <p className="mt-6 text-sm text-muted">
        Demo sign-in (offline). In production these route through Amazon Cognito — Google as a
        built-in social provider, LinkedIn via OpenID Connect.
      </p>
    </div>
  );
}
