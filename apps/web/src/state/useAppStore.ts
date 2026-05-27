// App-level (cross-tool) state. The per-tool wizard state lives in its own
// store (useRunStore for cdna-display, useNanoporeStore for nanopore-ssm).
// This store only holds which tool is currently active, plus future global
// preferences if any.

import { create } from "zustand";

interface AppState {
  activeToolId: string;
  setActiveTool: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeToolId: "cdna-display",
  setActiveTool: (id) => set({ activeToolId: id }),
}));
