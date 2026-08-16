import Link from "next/link";

export type WizardStep = {
  key: string;
  title: string;
  description: string;
  status: "done" | "current" | "locked";
  /** Shown when locked — why, and what unlocks it. */
  lockedHint?: string;
  /** A step is either a link to the existing generate/action page, or an
   * inline control (e.g. OffboardControl, SelfPinControl) rendered directly —
   * reusing the real controls rather than re-implementing them here keeps
   * this component pure UI, with zero duplicated business logic. */
  action?: { href: string; label: string };
  inline?: React.ReactNode;
  /** Shown next to the title once done, e.g. the issued ref or exit date. */
  doneNote?: string;
};

const card = (status: WizardStep["status"]): React.CSSProperties => ({
  border: `1px solid ${status === "current" ? "#2f4fb0" : "#e2e8f2"}`,
  borderRadius: 10,
  padding: "14px 16px",
  background: status === "locked" ? "#fafbfd" : "#fff",
  opacity: status === "locked" ? 0.7 : 1,
});

/**
 * A resumable step-flow shell for a multi-page process (onboarding a new
 * hire, offboarding an exiting one). "Resumable" is the key design choice:
 * there is no separate wizard-progress record to drift out of sync — the
 * caller derives each step's status from the employee's REAL data (issued
 * documents, status, hasSelfPin) every time this renders, so leaving and
 * coming back days later (the normal case for offboarding, which spans a
 * real notice period) always shows the true current state.
 */
export function LifecycleWizard({
  title,
  subtitle,
  backHref,
  backLabel,
  steps,
}: {
  title: string;
  subtitle: string;
  backHref: string;
  backLabel: string;
  steps: WizardStep[];
}) {
  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "36px 24px 48px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href={backHref} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {backLabel}</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 6, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: "#1f3a5f" }}>{title}</h1>
          <p style={{ fontSize: 12.5, color: "#5b6676", marginTop: 2 }}>{subtitle}</p>
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: doneCount === steps.length ? "#1a7a45" : "#8a94a3", background: doneCount === steps.length ? "#e7f6ee" : "#f3f5f9", borderRadius: 999, padding: "4px 11px", whiteSpace: "nowrap" }}>
          {doneCount === steps.length ? "✓ Complete" : `${doneCount} of ${steps.length} done`}
        </span>
      </div>

      <div style={{ marginTop: 10, height: 5, background: "#eef2f7", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(doneCount / steps.length) * 100}%`, background: doneCount === steps.length ? "#1a7a45" : "#2f4fb0", borderRadius: 99, transition: "width .3s" }} />
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        {steps.map((s, i) => (
          <div key={s.key} style={card(s.status)}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span
                style={{
                  width: 24, height: 24, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800,
                  background: s.status === "done" ? "#e7f6ee" : s.status === "current" ? "#2f4fb0" : "#eef2f7",
                  color: s.status === "done" ? "#1a7a45" : s.status === "current" ? "#fff" : "#a9b2c1",
                  border: s.status === "done" ? "1.5px solid #b7e2c9" : "none",
                }}
              >
                {s.status === "done" ? "✓" : i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: s.status === "locked" ? "#8a94a3" : "#1f3a5f" }}>{s.title}</span>
                  {s.doneNote ? <span style={{ fontSize: 11.5, color: "#8a94a3" }}>{s.doneNote}</span> : null}
                </div>
                <p style={{ fontSize: 12.5, color: "#5b6676", margin: "3px 0 0" }}>{s.description}</p>
                {s.status === "locked" && s.lockedHint ? (
                  <p style={{ fontSize: 11.5, color: "#a9772e", margin: "4px 0 0" }}>🔒 {s.lockedHint}</p>
                ) : null}
                {s.status !== "locked" && s.status !== "done" ? (
                  <div style={{ marginTop: 10 }}>
                    {s.inline ?? (s.action ? (
                      <Link
                        href={s.action.href}
                        style={{ background: "#1f3a5f", color: "#fff", textDecoration: "none", fontSize: 12.5, fontWeight: 700, borderRadius: 7, padding: "7px 13px", display: "inline-block" }}
                      >
                        {s.action.label}
                      </Link>
                    ) : null)}
                  </div>
                ) : null}
                {s.status === "done" && s.action ? (
                  <div style={{ marginTop: 8 }}>
                    <Link href={s.action.href} style={{ fontSize: 12, color: "#2f4fb0" }}>{s.action.label} again &rarr;</Link>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
