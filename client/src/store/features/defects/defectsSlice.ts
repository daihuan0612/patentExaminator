import { create } from "zustand";
import type { FormalDefect } from "@shared/types/domain";
import {
  createDefect,
  updateDefect,
  deleteDefect,
  deleteDefectsByCaseId
} from "../../../lib/repositories/defectRepo.js";

export interface DefectsSlice {
  defects: FormalDefect[];
  isLoading: boolean;

  setDefects: (defects: FormalDefect[]) => void;
  loadDefects: (defects: FormalDefect[]) => void; // Load from DB without re-saving
  addDefect: (defect: FormalDefect) => void;
  updateDefect: (defect: FormalDefect) => void;
  removeDefect: (id: string) => void;
  clearDefectsByCase: (caseId: string) => void;
  setLoading: (v: boolean) => void;
}

export const createDefectsSlice = (
  set: (fn: (prev: DefectsSlice) => Partial<DefectsSlice>) => void,
  _get: () => DefectsSlice
): DefectsSlice => ({
  defects: [],
  isLoading: false,

  setDefects: (defects) => {
    // Persist each defect to IndexedDB
    for (const defect of defects) {
      createDefect(defect).catch((e) => console.error("[DefectsSlice] createDefect error:", e));
    }
    set(() => ({ defects }));
  },
  loadDefects: (defects) => {
    // Load from DB without re-saving to IndexedDB
    set(() => ({ defects }));
  },
  addDefect: (defect) => {
    createDefect(defect).catch((e) => console.error("[DefectsSlice] createDefect error:", e));
    set((prev) => ({ defects: [...prev.defects, defect] }));
  },
  updateDefect: (defect) => {
    updateDefect(defect).catch((e) => console.error("[DefectsSlice] updateDefect error:", e));
    set((prev) => ({
      defects: prev.defects.map((d) => (d.id === defect.id ? defect : d))
    }));
  },
  removeDefect: (id) => {
    deleteDefect(id).catch((e) => console.error("[DefectsSlice] deleteDefect error:", e));
    set((prev) => ({ defects: prev.defects.filter((d) => d.id !== id) }));
  },
  clearDefectsByCase: (caseId) => {
    deleteDefectsByCaseId(caseId).catch((e) => console.error("[DefectsSlice] deleteDefectsByCaseId error:", e));
    set((prev) => ({ defects: prev.defects.filter((d) => d.caseId !== caseId) }));
  },
  setLoading: (v) => set(() => ({ isLoading: v }))
});

export const useDefectsStore = create<DefectsSlice>()((set, get) =>
  createDefectsSlice(set, get)
);