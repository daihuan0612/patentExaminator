import { create } from "zustand";
import type {
  ArgumentMapping,
  OfficeActionAnalysis,
  RejectionGround,
  RejectionCitedReference
} from "@shared/types/domain";
import {
  saveOpinionAnalysis,
  saveArgumentMappings,
  deleteArgumentMappings,
  clearOpinionData
} from "../../../lib/repositories/opinionRepo.js";

export interface OpinionSlice {
  officeActionAnalysis: OfficeActionAnalysis | null;
  argumentMappings: ArgumentMapping[];
  unmappedGrounds: string[];
  isLoading: boolean;

  setOfficeActionAnalysis: (analysis: OfficeActionAnalysis) => void;
  loadOfficeActionAnalysis: (analysis: OfficeActionAnalysis) => void; // Load from DB without re-saving
  setArgumentMappings: (mappings: ArgumentMapping[]) => void;
  loadArgumentMappings: (mappings: ArgumentMapping[]) => void; // Load from DB without re-saving
  setUnmappedGrounds: (codes: string[]) => void;
  addArgumentMapping: (mapping: ArgumentMapping) => void;
  updateArgumentMapping: (code: string, patch: Partial<ArgumentMapping>) => void;
  removeArgumentMapping: (code: string) => void;
  updateRejectionGround: (code: string, patch: Partial<RejectionGround>) => void;
  removeRejectionGround: (code: string) => void;
  addRejectionGround: (ground: RejectionGround) => void;
  addCitedRef: (ref: RejectionCitedReference) => void;
  removeCitedRef: (pubNumber: string) => void;
  clearReexamData: (caseId?: string) => void;
  setLoading: (v: boolean) => void;
}

export const createOpinionSlice = (
  set: (fn: (prev: OpinionSlice) => Partial<OpinionSlice>) => void,
  _get: () => OpinionSlice
): OpinionSlice => ({
  officeActionAnalysis: null,
  argumentMappings: [],
  unmappedGrounds: [],
  isLoading: false,

  setOfficeActionAnalysis: (analysis) => {
    saveOpinionAnalysis(analysis).catch((e) => console.error("[OpinionSlice] saveOpinionAnalysis error:", e));
    set(() => ({ officeActionAnalysis: analysis }));
  },
  loadOfficeActionAnalysis: (analysis) => {
    // Load from DB without re-saving to IndexedDB
    set(() => ({ officeActionAnalysis: analysis }));
  },
  setArgumentMappings: (mappings) => {
    if (mappings.length > 0 && mappings[0]!.caseId) {
      saveArgumentMappings(mappings).catch((e) => console.error("[OpinionSlice] saveArgumentMappings error:", e));
    }
    set(() => ({ argumentMappings: mappings }));
  },
  loadArgumentMappings: (mappings) => {
    // Load from DB without re-saving to IndexedDB
    set(() => ({ argumentMappings: mappings }));
  },
  setUnmappedGrounds: (codes) => set(() => ({ unmappedGrounds: codes })),

  addArgumentMapping: (mapping) => {
    set((prev) => {
      const newMappings = [...prev.argumentMappings, mapping];
      saveArgumentMappings(newMappings).catch((e) => console.error("[OpinionSlice] saveArgumentMappings error:", e));
      return { argumentMappings: newMappings };
    });
  },

  updateArgumentMapping: (code, patch) =>
    set((prev) => {
      const newMappings = prev.argumentMappings.map((m) =>
        m.rejectionGroundCode === code ? { ...m, ...patch } : m
      );
      if (newMappings.length > 0 && newMappings[0]!.caseId) {
        saveArgumentMappings(newMappings).catch((e) => console.error("[OpinionSlice] saveArgumentMappings error:", e));
      }
      return { argumentMappings: newMappings };
    }),

  removeArgumentMapping: (code) =>
    set((prev) => {
      const newMappings = prev.argumentMappings.filter((m) => m.rejectionGroundCode !== code);
      if (prev.argumentMappings.length > 0 && prev.argumentMappings[0]!.caseId) {
        deleteArgumentMappings(prev.argumentMappings[0]!.caseId).catch((e) => console.error("[OpinionSlice] deleteArgumentMappings error:", e));
        if (newMappings.length > 0) {
          saveArgumentMappings(newMappings).catch((e) => console.error("[OpinionSlice] saveArgumentMappings error:", e));
        }
      }
      return { argumentMappings: newMappings };
    }),

  updateRejectionGround: (code, patch) =>
    set((prev) => {
      if (!prev.officeActionAnalysis) return {};
      const newAnalysis = {
        ...prev.officeActionAnalysis,
        rejectionGrounds: prev.officeActionAnalysis.rejectionGrounds.map((g) =>
          g.code === code ? { ...g, ...patch } : g
        )
      };
      saveOpinionAnalysis(newAnalysis).catch((e) => console.error("[OpinionSlice] saveOpinionAnalysis error:", e));
      return { officeActionAnalysis: newAnalysis };
    }),

  removeRejectionGround: (code) =>
    set((prev) => {
      if (!prev.officeActionAnalysis) return {};
      const newAnalysis = {
        ...prev.officeActionAnalysis,
        rejectionGrounds: prev.officeActionAnalysis.rejectionGrounds.filter(
          (g) => g.code !== code
        )
      };
      saveOpinionAnalysis(newAnalysis).catch((e) => console.error("[OpinionSlice] saveOpinionAnalysis error:", e));
      return { officeActionAnalysis: newAnalysis };
    }),

  addRejectionGround: (ground) =>
    set((prev) => {
      if (!prev.officeActionAnalysis) return {};
      const newAnalysis = {
        ...prev.officeActionAnalysis,
        rejectionGrounds: [...prev.officeActionAnalysis.rejectionGrounds, ground]
      };
      saveOpinionAnalysis(newAnalysis).catch((e) => console.error("[OpinionSlice] saveOpinionAnalysis error:", e));
      return { officeActionAnalysis: newAnalysis };
    }),

  addCitedRef: (ref) =>
    set((prev) => {
      if (!prev.officeActionAnalysis) return {};
      const newAnalysis = {
        ...prev.officeActionAnalysis,
        citedReferences: [...prev.officeActionAnalysis.citedReferences, ref]
      };
      saveOpinionAnalysis(newAnalysis).catch((e) => console.error("[OpinionSlice] saveOpinionAnalysis error:", e));
      return { officeActionAnalysis: newAnalysis };
    }),

  removeCitedRef: (pubNumber) =>
    set((prev) => {
      if (!prev.officeActionAnalysis) return {};
      const newAnalysis = {
        ...prev.officeActionAnalysis,
        citedReferences: prev.officeActionAnalysis.citedReferences.filter(
          (r) => r.publicationNumber !== pubNumber
        )
      };
      saveOpinionAnalysis(newAnalysis).catch((e) => console.error("[OpinionSlice] saveOpinionAnalysis error:", e));
      return { officeActionAnalysis: newAnalysis };
    }),

  clearReexamData: (caseId) => {
    if (caseId) {
      clearOpinionData(caseId).catch((e) => console.error("[OpinionSlice] clearOpinionData error:", e));
    }
    set(() => ({ officeActionAnalysis: null, argumentMappings: [], unmappedGrounds: [] }));
  },
  setLoading: (v) => set(() => ({ isLoading: v }))
});

export const useOpinionStore = create<OpinionSlice>()((set, get) =>
  createOpinionSlice(set, get)
);