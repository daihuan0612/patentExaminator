import { create } from "zustand";
import type { ReexamDraftResponse, SummaryResponse } from "../../../agent/contracts";

export interface DraftSlice {
  reexamDrafts: Record<string, ReexamDraftResponse>; // caseId → draft
  summaries: Record<string, SummaryResponse>; // caseId → summary
  setReexamDraft: (caseId: string, draft: ReexamDraftResponse) => void;
  setSummary: (caseId: string, summary: SummaryResponse) => void;
  clearDraftData: (caseId: string) => void;
}

export const createDraftSlice = (
  set: (fn: (prev: DraftSlice) => Partial<DraftSlice>) => void,
  _get: () => DraftSlice
): DraftSlice => ({
  reexamDrafts: {},
  summaries: {},

  setReexamDraft: (caseId, draft) =>
    set((prev) => ({
      reexamDrafts: { ...prev.reexamDrafts, [caseId]: draft }
    })),

  setSummary: (caseId, summary) =>
    set((prev) => ({
      summaries: { ...prev.summaries, [caseId]: summary }
    })),

  clearDraftData: (caseId) =>
    set((prev) => {
      const nextDrafts = { ...prev.reexamDrafts };
      delete nextDrafts[caseId];
      const nextSummaries = { ...prev.summaries };
      delete nextSummaries[caseId];
      return { reexamDrafts: nextDrafts, summaries: nextSummaries };
    })
});

export const useDraftStore = create<DraftSlice>()((set, get) =>
  createDraftSlice(set, get)
);
