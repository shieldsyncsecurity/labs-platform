"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* /demo/try — the interactive "feel the assessment" preview.
 *
 * All scenario state lives in this component (it's a per-visitor simulation);
 * grading happens server-side in /api/demo-lab/grade using the same
 * policy-document-analysis style as the real engine. Copy never mentions
 * internals; the SIMULATED framing is explicit and repeated. */

const DATA_BUCKET = "sslab-data-demo";
const ASSETS_BUCKET = "sslab-assets-demo";

type Stmt = {
  Sid?: string;
  Effect?: string;
  Principal?: unknown;
  Action?: string | string[];
  Resource?: string | string[];
  Condition?: Record<string, unknown>;
};

const INITIAL_DATA_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PublicRead",
      Effect: "Allow",
      Principal: "*",
      Action: "s3:GetObject",
      Resource: `arn:aws:s3:::${DATA_BUCKET}/*`,
    },
    {
      Sid: "EnforceTLS",
      Effect: "Deny",
      Principal: "*",
      Action: "s3:*",
      Resource: [`arn:aws:s3:::${DATA_BUCKET}`, `arn:aws:s3:::${DATA_BUCKET}/*`],
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    },
  ] as Stmt[],
};

const INITIAL_USER_POLICY = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [{ Sid: "PipelineAccess", Effect: "Allow", Action: "s3:*", Resource: "*" }],
  },
  null,
  2,
);

const SCOPED_TEMPLATE = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PipelineData",
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
        Resource: [`arn:aws:s3:::${DATA_BUCKET}`, `arn:aws:s3:::${DATA_BUCKET}/*`],
      },
    ],
  },
  null,
  2,
);

type SubCheck = { id: string; label: string; passed: boolean };
type Objective = { id: string; title: string; subChecks: SubCheck[]; earned: number; max: number; passed: boolean };
type GradeResult = { objectives: Objective[]; score: number; max: number; canary: { ok: boolean; reason: string } };

function isPublicStmt(s: Stmt): boolean {
  const p = s.Principal as { AWS?: unknown } | string | undefined;
  const pub = p === "*" || (typeof p === "object" && p !== null && [(p as { AWS?: unknown }).AWS].flat().includes("*"));
  return s.Effect === "Allow" && pub;
}

function summarize(s: Stmt): string {
  const acts = [s.Action].flat().filter(Boolean).join(", ");
  const res = [s.Resource].flat().filter(Boolean).length;
  return `${s.Effect} ${acts} on ${res} resource${res === 1 ? "" : "s"}${s.Condition ? " (with condition)" : ""}`;
}

const FIELD =
  "w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export default function TryDemo() {
  const [phase, setPhase] = useState<"intro" | "working" | "graded">("intro");
  const [tab, setTab] = useState<"storage" | "iam">("storage");
  const [dataStmts, setDataStmts] = useState<Stmt[] | null>(INITIAL_DATA_POLICY.Statement);
  const [accountBpa, setAccountBpa] = useState(false);
  const [bucketBpa, setBucketBpa] = useState(false);
  const [userPolicy, setUserPolicy] = useState(INITIAL_USER_POLICY);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [canaryMsg, setCanaryMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(5 * 60);
  const topRef = useRef<HTMLDivElement>(null);

  // Cosmetic 5-minute countdown — no enforcement, this is a preview.
  useEffect(() => {
    if (phase !== "working") return;
    const id = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const mm = String(Math.floor(secondsLeft / 60));
  const ss = String(secondsLeft % 60).padStart(2, "0");

  const dataPolicyJson =
    dataStmts === null ? null : JSON.stringify({ Version: "2012-10-17", Statement: dataStmts }, null, 2);
  const stillPublic = (dataStmts ?? []).some(isPublicStmt);
  const masked = stillPublic && (accountBpa || bucketBpa);

  function currentState() {
    return { accountBpa, bucketBpa, dataPolicy: dataPolicyJson, userPolicy };
  }

  function validPolicyOrError(): boolean {
    try {
      JSON.parse(userPolicy);
      setPolicyError(null);
      return true;
    } catch {
      setPolicyError("That policy isn't valid JSON — fix it (or insert the template) and try again.");
      setTab("iam");
      return false;
    }
  }

  async function testPipeline() {
    if (!validPolicyOrError()) return;
    setBusy(true);
    setCanaryMsg(null);
    try {
      const res = await fetch("/api/demo-lab/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(currentState()),
      });
      const data = (await res.json()) as GradeResult;
      setCanaryMsg({ ok: data.canary.ok, text: data.canary.reason });
    } catch {
      setCanaryMsg({ ok: false, text: "Could not reach the grader — try again." });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!validPolicyOrError()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/demo-lab/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(currentState()),
      });
      const data = (await res.json()) as GradeResult;
      setResult(data);
      setPhase("graded");
      topRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch {
      setCanaryMsg({ ok: false, text: "Could not submit — try again." });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhase("working");
    setDataStmts(INITIAL_DATA_POLICY.Statement);
    setAccountBpa(false);
    setBucketBpa(false);
    setUserPolicy(INITIAL_USER_POLICY);
    setPolicyError(null);
    setCanaryMsg(null);
    setResult(null);
    setSecondsLeft(5 * 60);
  }

  /* ------------------------------------------------------------- intro */
  if (phase === "intro") {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
          Simulated preview · 5 minutes
        </p>
        <h2 className="mt-3 text-xl font-bold text-ink">
          You've just joined the security team. This account is not okay.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          A small data pipeline runs here: two storage buckets, a processor, and a pipeline
          service user. A review flagged it. Your job — fix what's wrong{" "}
          <b>without breaking the pipeline</b>, then submit and see exactly the kind of report a
          hiring team receives.
        </p>
        <ul className="mt-5 space-y-2 text-sm text-ink-soft">
          <li>· One bucket is readable by anyone on the internet — fix it at the root.</li>
          <li>· The pipeline user can do anything to any bucket — right-size it.</li>
          <li>· Test the pipeline anytime. It must still work when you submit.</li>
        </ul>
        <button
          type="button"
          onClick={() => setPhase("working")}
          className="mt-7 inline-flex items-center justify-center rounded-full bg-brand px-7 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Start the preview
        </button>
        <p className="mt-4 text-xs text-muted">
          This preview is simulated and graded on its final state, server-side. Real assessments
          run in a live, isolated AWS account with the real console — and are graded the same
          way: on what you actually did.
        </p>
      </div>
    );
  }

  /* ------------------------------------------------------------ report */
  if (phase === "graded" && result) {
    const pct = Math.round((result.score / result.max) * 100);
    return (
      <div ref={topRef}>
        <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">
                Your result — as the hiring team would see it
              </p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">
                {result.score} <span className="text-base font-semibold text-muted">/ {result.max} points</span>
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                pct >= 75 ? "bg-emerald-100 text-emerald-800" : pct >= 40 ? "bg-amber-100 text-amber-800" : "bg-line text-ink-soft"
              }`}
            >
              {pct >= 75 ? "Strong showing" : pct >= 40 ? "Partial credit earned" : "Room to grow"}
            </span>
          </div>

          <div className="mt-6 space-y-3">
            {result.objectives.map((o) => (
              <div key={o.id} className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-center justify-between gap-3 bg-surface px-4 py-2.5">
                  <span className="text-sm font-semibold text-ink">{o.title}</span>
                  <span className="font-mono text-xs font-bold text-ink-soft">
                    {o.earned}/{o.max}
                  </span>
                </div>
                <div className="border-t border-line bg-canvas px-4 py-2">
                  {o.subChecks.map((c) => (
                    <div key={c.id} className="flex items-baseline gap-2 py-1 text-[13px] text-ink-soft">
                      <span className={`w-4 flex-none text-center font-extrabold ${c.passed ? "text-emerald-600" : "text-red-600"}`}>
                        {c.passed ? "✓" : "✗"}
                      </span>
                      {c.label}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-5 text-sm leading-relaxed text-ink-soft">
            Every line above was verified against the final state you left behind — root cause vs
            cover-up, precision vs collateral damage, and whether the business kept running. Real
            assessments grade a live AWS account the same way, across five job levels.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/book-demo"
              className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong"
            >
              Book a walkthrough
            </Link>
            <Link
              href="/demo/report"
              className="inline-flex items-center justify-center rounded-full border border-line-strong bg-surface px-6 py-3 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong"
            >
              See the full hiring report
            </Link>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-muted transition-colors hover:text-ink-soft"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- room */
  return (
    <div ref={topRef}>
      {/* status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-3">
        <p className="text-sm font-semibold text-ink">
          Harden the pipeline <span className="font-normal text-muted">· simulated preview</span>
        </p>
        <div className="flex items-center gap-4">
          <span className="rounded-lg border border-line bg-canvas px-3 py-1 font-mono text-sm font-bold text-ink">
            {mm}:{ss}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {busy ? "Grading…" : "Submit & see my report"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* environment panel */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab("storage")}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold ${tab === "storage" ? "bg-brand/10 text-brand-strong" : "text-muted hover:text-ink-soft"}`}
            >
              Storage buckets
            </button>
            <button
              type="button"
              onClick={() => setTab("iam")}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold ${tab === "iam" ? "bg-brand/10 text-brand-strong" : "text-muted hover:text-ink-soft"}`}
            >
              Pipeline user (IAM)
            </button>
          </div>

          {tab === "storage" && (
            <div className="mt-4 space-y-4">
              {/* data bucket */}
              <div className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[13px] font-semibold text-ink">{DATA_BUCKET}</span>
                  {dataStmts === null || !stillPublic ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-emerald-800">Private</span>
                  ) : masked ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-800" title="Blocked by BPA, but the public grant still exists underneath">
                      Masked — grant still present
                    </span>
                  ) : (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-red-700">Public</span>
                  )}
                </div>

                <p className="mt-2 text-xs text-muted">Bucket policy statements:</p>
                {dataStmts === null ? (
                  <p className="mt-2 rounded-lg border border-dashed border-line-strong bg-canvas px-3 py-3 text-sm text-muted">
                    No bucket policy. (You deleted it — including whatever protections it carried.)
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {dataStmts.map((s) => (
                      <div
                        key={s.Sid}
                        className={`rounded-lg border px-3 py-2.5 ${isPublicStmt(s) ? "border-red-300 bg-red-50" : "border-line bg-canvas"}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-[12px] font-semibold text-ink">{s.Sid}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const next = (dataStmts ?? []).filter((x) => x.Sid !== s.Sid);
                              setDataStmts(next);
                            }}
                            className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand-strong"
                          >
                            Remove statement
                          </button>
                        </div>
                        <p className="mt-1 font-mono text-[11.5px] text-ink-soft">{summarize(s)}</p>
                        {isPublicStmt(s) && (
                          <p className="mt-1 text-[11.5px] font-medium text-red-700">
                            Grants read access to anyone on the internet.
                          </p>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDataStmts(null)}
                      className="text-[11.5px] font-medium text-muted underline-offset-2 hover:text-red-700 hover:underline"
                    >
                      Delete the entire bucket policy
                    </button>
                  </div>
                )}

                <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-soft">
                  <input type="checkbox" checked={bucketBpa} onChange={(e) => setBucketBpa(e.target.checked)} className="h-4 w-4 accent-[#d97706]" />
                  Block Public Access — this bucket
                </label>
              </div>

              {/* assets bucket (decoy) */}
              <div className="rounded-xl border border-line p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[13px] font-semibold text-ink">{ASSETS_BUCKET}</span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-emerald-800">Private</span>
                </div>
                <p className="mt-2 text-xs text-muted">No policy attached. Nothing suspicious here — not every resource needs fixing.</p>
              </div>

              {/* account BPA */}
              <label className="flex items-center gap-2 rounded-xl border border-line bg-canvas px-4 py-3 text-[13px] font-medium text-ink-soft">
                <input type="checkbox" checked={accountBpa} onChange={(e) => setAccountBpa(e.target.checked)} className="h-4 w-4 accent-[#d97706]" />
                Block Public Access — entire account
              </label>
            </div>
          )}

          {tab === "iam" && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[13px] font-semibold text-ink">user/ pipeline-svc</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setUserPolicy(SCOPED_TEMPLATE); setPolicyError(null); }}
                    className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand-strong"
                  >
                    Insert least-privilege template
                  </button>
                  <button
                    type="button"
                    onClick={() => { setUserPolicy(INITIAL_USER_POLICY); setPolicyError(null); }}
                    className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-ink-soft"
                  >
                    Restore original
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">
                Attached policy (editable — this is what the pipeline runs with):
              </p>
              <textarea
                value={userPolicy}
                onChange={(e) => setUserPolicy(e.target.value)}
                rows={13}
                spellCheck={false}
                className={`${FIELD} mt-2`}
              />
              {policyError && (
                <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {policyError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* right rail */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h3 className="text-sm font-bold text-ink">Objectives</h3>
            <ul className="mt-3 space-y-2.5 text-[13px] leading-snug text-ink-soft">
              <li>1 · Remove the public exposure — at the root, keeping legitimate protections.</li>
              <li>2 · Right-size <span className="font-mono text-[12px]">pipeline-svc</span> to least privilege.</li>
              <li>3 · The pipeline must still work when you submit.</li>
            </ul>
            <p className="mt-3 text-[11.5px] text-muted">Graded at submit, on final state — partial credit is real.</p>
          </div>

          <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5">
            <h3 className="text-sm font-bold text-ink">🧪 Test the pipeline</h3>
            <p className="mt-1.5 text-[12.5px] text-ink-soft">Run it as often as you like — it must work at submit.</p>
            <button
              type="button"
              onClick={testPipeline}
              disabled={busy}
              className="mt-3 w-full rounded-full border border-brand/40 bg-surface px-4 py-2 text-sm font-semibold text-brand-strong transition-colors hover:bg-brand hover:text-white disabled:opacity-60"
            >
              {busy ? "Running…" : "Run the pipeline"}
            </button>
            {canaryMsg && (
              <p className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] leading-snug ${canaryMsg.ok ? "border border-emerald-200 bg-emerald-50 text-emerald-800" : "border border-red-200 bg-red-50 text-red-700"}`}>
                {canaryMsg.ok ? "✓ " : "✗ "}
                {canaryMsg.text}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h3 className="text-sm font-bold text-ink">How the real thing differs</h3>
            <ul className="mt-2.5 space-y-2 text-[12.5px] leading-snug text-ink-soft">
              <li>· A live, isolated AWS account — the real console, not panels like these.</li>
              <li>· 60 minutes, five objectives, per-level scenarios (Analyst → Security Lead).</li>
              <li>· Docs &amp; AI assistants allowed, just like the job.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
