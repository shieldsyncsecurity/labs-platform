"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Tiny shared state so the guide (left column) can react to the launch state that
// the panel (right column) owns. The panel keeps owning the session polling; it
// just broadcasts "is a lab live?" through this context. Used to progressively
// reveal the full walkthrough once the learner launches.
type LabWorkspace = { launched: boolean; setLaunched: (v: boolean) => void };

const Ctx = createContext<LabWorkspace>({ launched: false, setLaunched: () => {} });

export function LabWorkspaceProvider({ children }: { children: ReactNode }) {
  const [launched, setLaunched] = useState(false);
  return <Ctx.Provider value={{ launched, setLaunched }}>{children}</Ctx.Provider>;
}

export const useLabWorkspace = () => useContext(Ctx);
