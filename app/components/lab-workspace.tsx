"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Tiny shared state so the guide (left column) can react to the launch state that
// the panel (right column) owns. The panel keeps owning the session polling; it
// just broadcasts "is a lab live?" through this context. Used to progressively
// reveal the full walkthrough once the learner launches.
type LabWorkspace = { launched: boolean; setLaunched: (v: boolean) => void };

const Ctx = createContext<LabWorkspace>({ launched: false, setLaunched: () => {} });

export function LabWorkspaceProvider({ children }: { children: ReactNode }) {
  const [launched, setLaunched] = useState(false);
  // Dev-only preview hatch: ?ssdev forces the launched walkthrough so the guide can be
  // previewed without a live AWS session. `process.env.NODE_ENV` is inlined at build, so
  // this whole block is dead-code-eliminated from the production bundle.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    try {
      if (new URLSearchParams(window.location.search).has("ssdev")) setLaunched(true);
    } catch {}
  }, []);
  return <Ctx.Provider value={{ launched, setLaunched }}>{children}</Ctx.Provider>;
}

export const useLabWorkspace = () => useContext(Ctx);
