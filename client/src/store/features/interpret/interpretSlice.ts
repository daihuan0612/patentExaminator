import { create } from "zustand";
import { saveInterpretSummary, deleteInterpretSummary } from "../../../lib/repositories/interpretRepo.js";

export interface InterpretSlice {
  interpretSummaries: Record<string, string>; // caseId → summary
  setInterpretSummary: (caseId: string, summary: string) => void;
  clearInterpretData: (caseId: string) => void;
  loadInterpretSummary: (caseId: string, summary: string) => void; // for loading from DB without re-saving
}

export const createInterpretSlice = (
  set: (fn: (prev: InterpretSlice) => Partial<InterpretSlice>) => void,
  _get: () => InterpretSlice
): InterpretSlice => ({
  interpretSummaries: {},

  setInterpretSummary: (caseId, summary) => {
    // Update Zustand store
    set((prev) => ({
      interpretSummaries: { ...prev.interpretSummaries, [caseId]: summary }
    }));
    // Persist to IndexedDB (async, fire-and-forget)
    saveInterpretSummary(caseId, summary).catch((err) => {
      console.error(`Failed to save interpret summary for case ${caseId}:`, err);
    });
  },

  loadInterpretSummary: (caseId, summary) =>
    set((prev) => ({
      interpretSummaries: { ...prev.interpretSummaries, [caseId]: summary }
    })),

  clearInterpretData: (caseId) => {
    set((prev) => {
      const next = { ...prev.interpretSummaries };
      delete next[caseId];
      return { interpretSummaries: next };
    });
    // Delete from IndexedDB (async, fire-and-forget)
    deleteInterpretSummary(caseId).catch((err) => {
      console.error(`Failed to delete interpret summary for case ${caseId}:`, err);
    });
  }
});

export const useInterpretStore = create<InterpretSlice>()((set, get) =>
  createInterpretSlice(set, get)
);
