import { create } from "zustand";
import type { PatentCase, CaseWorkflowState } from "@shared/types/domain";
import { updateCase } from "../../../lib/repositories/caseRepo";
import { createLogger } from "../../../lib/logger";

const log = createLogger("CaseSlice");

export interface CaseSlice {
  currentCase: PatentCase | null;
  cases: PatentCase[];
  isLoading: boolean;

  setCurrentCase: (c: PatentCase | null) => void;
  setCases: (cases: PatentCase[]) => void;
  setLoading: (v: boolean) => void;
  updateWorkflowState: (state: CaseWorkflowState) => void;
}

export const createCaseSlice = (
  set: (fn: (prev: CaseSlice) => Partial<CaseSlice>) => void,
  _get: () => CaseSlice
): CaseSlice => ({
  currentCase: null,
  cases: [],
  isLoading: false,

  setCurrentCase: (c) => {
    set(() => ({ currentCase: c }));
    if (c) updateCase(c).catch((e) => log("IDB setCurrentCase error:", e));
  },
  setCases: (cases) => set(() => ({ cases })),
  setLoading: (v) => set(() => ({ isLoading: v })),
  updateWorkflowState: (state) =>
    set((prev) => {
      if (prev.currentCase) {
        const updated = { ...prev.currentCase, workflowState: state, updatedAt: new Date().toISOString() };
        updateCase(updated).catch((e) => log("updateCase error:", e));
        return { currentCase: updated };
      }
      return { currentCase: null };
    })
});

export const useCaseStore = create<CaseSlice>()((set, get) => createCaseSlice(set, get));
