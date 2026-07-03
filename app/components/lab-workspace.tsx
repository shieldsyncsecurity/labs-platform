"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Per-objective grade status, mirrored in from lab-panel's grade results. Opaque
// string ids — the mechanism has no idea what an objective "means" (product-line
// agnostic by design).
export type ObjectiveStatus = "pass" | "fail" | "unknown";

// Tiny shared state so the guide (left column) can react to state that the panel
// (right column) owns. The panel keeps owning the session polling AND the grading
// fetch/timing; it just broadcasts read-only snapshots through this context:
//   - launched: "is a lab live?" (progressive reveal of the full walkthrough)
//   - objectiveStatus / gradePassed / sessionStartedAt: mirrored grade results, so
//     the guide can render step-level verification + a completion moment without
//     owning any grading logic itself.
type LabWorkspace = {
  launched: boolean;
  setLaunched: (v: boolean) => void;
  objectiveStatus: Record<string, ObjectiveStatus>;
  setObjectiveStatus: (v: Record<string, ObjectiveStatus>) => void;
  gradePassed: boolean;
  setGradePassed: (v: boolean) => void;
  sessionStartedAt: string | null;
  setSessionStartedAt: (v: string | null) => void;
};

const Ctx = createContext<LabWorkspace>({
  launched: false,
  setLaunched: () => {},
  objectiveStatus: {},
  setObjectiveStatus: () => {},
  gradePassed: false,
  setGradePassed: () => {},
  sessionStartedAt: null,
  setSessionStartedAt: () => {},
});

export function LabWorkspaceProvider({ children }: { children: ReactNode }) {
  const [launched, setLaunched] = useState(false);
  const [objectiveStatus, setObjectiveStatus] = useState<Record<string, ObjectiveStatus>>({});
  const [gradePassed, setGradePassed] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);

  // Dev-only preview hatches — both are dead-code-eliminated from the production
  // bundle (`process.env.NODE_ENV` is inlined at build):
  //   ?ssdev                    forces the launched walkthrough so the guide can be
  //                              previewed without a live AWS session.
  //   ?ssgrade=id1,id2           seeds those objective ids as "pass" (comma-separated,
  //                              same ids used by the ss:obj content markers) so the
  //                              verified-step / completion-card states are visually
  //                              checkable without running a real grade. Only wired
  //                              up alongside ?ssdev.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has("ssdev")) setLaunched(true);
      const raw = params.get("ssgrade");
      if (raw) {
        const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length) {
          setObjectiveStatus(Object.fromEntries(ids.map((id) => [id, "pass" as const])));
          setSessionStartedAt(new Date().toISOString());
          // gradePassed is set by the caller once it knows the FULL objective set for
          // the lab (this hatch doesn't know the lab's total objective count) — see
          // lab-panel.tsx's dev-hatch wiring, which compares seeded ids against the
          // lab's own objectives and flips gradePassed when all are covered.
        }
      }
    } catch {}
  }, []);

  return (
    <Ctx.Provider
      value={{
        launched,
        setLaunched,
        objectiveStatus,
        setObjectiveStatus,
        gradePassed,
        setGradePassed,
        sessionStartedAt,
        setSessionStartedAt,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useLabWorkspace = () => useContext(Ctx);
