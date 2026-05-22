import { create } from "zustand";
import type { InventiveStepAnalysis } from "@shared/types/domain";
import {
  createInventive,
  updateInventive,
  deleteInventive,
  deleteInventiveByCaseId
} from "../../../lib/repositories/inventiveRepo.js";

export interface InventiveSlice {
  analyses: InventiveStepAnalysis[];
  isLoading: boolean;

  setAnalyses: (analyses: InventiveStepAnalysis[]) => void;
  loadAnalyses: (analyses: InventiveStepAnalysis[]) => void; // Load from DB without re-saving
  addAnalysis: (analysis: InventiveStepAnalysis) => void;
  updateAnalysis: (analysis: InventiveStepAnalysis) => void;
  removeAnalysis: (id: string) => void;
  clearAnalysesByCase: (caseId: string) => void;
  setLoading: (v: boolean) => void;
}

export const createInventiveSlice = (
  set: (fn: (prev: InventiveSlice) => Partial<InventiveSlice>) => void,
  _get: () => InventiveSlice
): InventiveSlice => ({
  analyses: [],
  isLoading: false,

  setAnalyses: (analyses) => {
    console.log("[InventiveSlice] setAnalyses:", analyses.map(a => ({ id: a.id, closestPriorArtId: a.closestPriorArtId })));
    // Persist each analysis to IndexedDB
    for (const analysis of analyses) {
      createInventive(analysis).catch((e) => console.error("[InventiveSlice] createInventive error:", e));
    }
    set(() => ({ analyses }));
  },
  loadAnalyses: (analyses) => {
    // Load from DB without re-saving to IndexedDB
    console.log("[InventiveSlice] loadAnalyses:", analyses.map(a => ({ id: a.id, closestPriorArtId: a.closestPriorArtId })));
    set(() => ({ analyses }));
  },
  addAnalysis: (analysis) => {
    console.log("[InventiveSlice] addAnalysis:", { id: analysis.id, closestPriorArtId: analysis.closestPriorArtId });
    createInventive(analysis).catch((e) => console.error("[InventiveSlice] createInventive error:", e));
    set((prev) => ({ analyses: [...prev.analyses, analysis] }));
  },
  updateAnalysis: (analysis) => {
    console.log("[InventiveSlice] updateAnalysis called:", { 
      id: analysis.id, 
      closestPriorArtId: analysis.closestPriorArtId,
      fullAnalysis: analysis
    });
    updateInventive(analysis).catch((e) => console.error("[InventiveSlice] updateInventive error:", e));
    set((prev) => {
      const newAnalyses = prev.analyses.map((a) => (a.id === analysis.id ? analysis : a));
      console.log("[InventiveSlice] updateAnalysis result:", newAnalyses.map(a => ({ id: a.id, closestPriorArtId: a.closestPriorArtId })));
      return { analyses: newAnalyses };
    });
  },
  removeAnalysis: (id) => {
    console.log("[InventiveSlice] removeAnalysis:", { id });
    deleteInventive(id).catch((e) => console.error("[InventiveSlice] deleteInventive error:", e));
    set((prev) => ({ analyses: prev.analyses.filter((a) => a.id !== id) }));
  },
  clearAnalysesByCase: (caseId) => {
    console.log("[InventiveSlice] clearAnalysesByCase:", { caseId });
    deleteInventiveByCaseId(caseId).catch((e) => console.error("[InventiveSlice] deleteInventiveByCaseId error:", e));
    set((prev) => ({ analyses: prev.analyses.filter((a) => a.caseId !== caseId) }));
  },
  setLoading: (v) => set(() => ({ isLoading: v }))
});

export const useInventiveStore = create<InventiveSlice>()((set, get) =>
  createInventiveSlice(set, get)
);