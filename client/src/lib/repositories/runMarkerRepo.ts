import { getDB } from "../indexedDb";

export async function saveRunMarker(caseId: string, module: string): Promise<void> {
  const db = await getDB();
  await db.put("runMarkers", {
    id: `${caseId}::${module}`,
    caseId,
    module,
    timestamp: new Date().toISOString()
  });
}

export async function getRunMarkersByCaseId(caseId: string): Promise<string[]> {
  const db = await getDB();
  const markers = await db.getAllFromIndex("runMarkers", "by-caseId", caseId);
  return markers.map((m) => m.module);
}

export async function deleteRunMarker(caseId: string, module: string): Promise<void> {
  const db = await getDB();
  await db.delete("runMarkers", `${caseId}::${module}`);
}