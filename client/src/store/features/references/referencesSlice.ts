import { create } from "zustand";
import type { ReferenceDocument } from "@shared/types/domain";

// DEBUG: 调试 bug 18 - 删除对比文件后无法再加载再比较
const DEBUG_REFERENCES = true;

function debugRefLog(...args: unknown[]) {
  if (DEBUG_REFERENCES) {
    console.log("[ReferencesSlice]", ...args);
  }
}

export interface ProviderResult {
  providerId: string;
  providerName: string;
  resultCount: number;
  candidateCount: number;
}

export type SearchStep = "idle" | "extracting" | "editing" | "searching" | "done";

export interface ReferencesSlice {
  references: ReferenceDocument[];
  candidates: ReferenceDocument[];
  isLoading: boolean;
  isSearching: boolean;

  // nf-7: 检索会话状态
  searchTerms: string[];
  searchStep: SearchStep;
  searchSessionId: string | null;
  providerResults: ProviderResult[];

  setReferences: (refs: ReferenceDocument[]) => void;
  addReference: (ref: ReferenceDocument) => void;
  updateReference: (ref: ReferenceDocument) => void;
  removeReference: (id: string) => void;
  setLoading: (v: boolean) => void;

  setCandidates: (candidates: ReferenceDocument[]) => void;
  acceptCandidate: (candidateId: string) => void;
  rejectCandidate: (candidateId: string) => void;
  clearCandidates: () => void;
  setIsSearching: (v: boolean) => void;

  // nf-7 actions
  setSearchTerms: (terms: string[]) => void;
  setSearchStep: (step: SearchStep) => void;
  setSearchSessionId: (id: string | null) => void;
  setProviderResults: (results: ProviderResult[]) => void;
  addSearchTerm: (term: string) => void;
  updateSearchTerm: (index: number, term: string) => void;
  removeSearchTerm: (index: number) => void;
}

export const createReferencesSlice = (
  set: (fn: (prev: ReferencesSlice) => Partial<ReferencesSlice>) => void,
  _get: () => ReferencesSlice
): ReferencesSlice => ({
  references: [],
  candidates: [],
  isLoading: false,
  isSearching: false,

  // nf-7
  searchTerms: [],
  searchStep: "idle",
  searchSessionId: null,
  providerResults: [],

  setReferences: (references) => {
    debugRefLog("setReferences:", { count: references.length, ids: references.map(r => r.id) });
    return set(() => ({ references }));
  },
  addReference: (ref) => {
    debugRefLog("addReference:", { id: ref.id, title: ref.title ?? ref.fileName });
    return set((prev) => ({ references: [...prev.references, ref] }));
  },
  updateReference: (ref) => {
    debugRefLog("updateReference:", { id: ref.id, title: ref.title ?? ref.fileName });
    return set((prev) => ({
      references: prev.references.map((r) => (r.id === ref.id ? ref : r))
    }));
  },
  removeReference: (id) => {
    debugRefLog("removeReference 被调用:", { id });
    const before = _get().references.map(r => r.id);
    const result = set((prev) => {
      const after = prev.references.filter((r) => r.id !== id);
      debugRefLog("removeReference 执行:", { before, after: after.map(r => r.id), removed: id });
      return { references: after };
    });
    return result;
  },
  setLoading: (v) => set(() => ({ isLoading: v })),

  setCandidates: (candidates) => set(() => ({ candidates })),
  acceptCandidate: (candidateId) =>
    set((prev) => {
      const candidate = prev.candidates.find((c) => c.id === candidateId);
      if (!candidate) return prev;
      const accepted: ReferenceDocument = {
        ...candidate,
        source: "ai-search" as const,
        candidateStatus: "accepted" as const
      };
      return {
        references: [...prev.references, accepted],
        candidates: prev.candidates.filter((c) => c.id !== candidateId)
      };
    }),
  rejectCandidate: (candidateId) =>
    set((prev) => ({ candidates: prev.candidates.filter((c) => c.id !== candidateId) })),
  clearCandidates: () => set(() => ({ candidates: [] })),
  setIsSearching: (v) => set(() => ({ isSearching: v })),

  // nf-7 actions
  setSearchTerms: (terms) => set(() => ({ searchTerms: terms })),
  setSearchStep: (step) => set(() => ({ searchStep: step })),
  setSearchSessionId: (id) => set(() => ({ searchSessionId: id })),
  setProviderResults: (results) => set(() => ({ providerResults: results })),
  addSearchTerm: (term) => set((prev) => ({ searchTerms: [...prev.searchTerms, term] })),
  updateSearchTerm: (index, term) =>
    set((prev) => ({
      searchTerms: prev.searchTerms.map((t, i) => (i === index ? term : t))
    })),
  removeSearchTerm: (index) =>
    set((prev) => ({
      searchTerms: prev.searchTerms.filter((_, i) => i !== index)
    }))
});

export const useReferencesStore = create<ReferencesSlice>()((set, get) =>
  createReferencesSlice(set, get)
);
