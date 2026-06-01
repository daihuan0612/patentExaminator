import { create, query, remove } from "../dataClient";

interface RunMarker {
  id: string;
  caseId: string;
  module: string;
  timestamp: string;
}

export async function saveRunMarker(caseId: string, module: string): Promise<void> {
  await create("runMarkers", {
    id: `${caseId}::${module}`,
    caseId,
    module,
    timestamp: new Date().toISOString()
  });
}

export async function getRunMarkersByCaseId(caseId: string): Promise<string[]> {
  const markers = await query<RunMarker>("runMarkers", "caseId", caseId);
  return markers.map((m) => m.module);
}

export async function deleteRunMarker(caseId: string, module: string): Promise<void> {
  await remove("runMarkers", `${caseId}::${module}`);
}
