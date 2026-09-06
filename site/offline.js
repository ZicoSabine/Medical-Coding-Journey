const DB_NAME = "medical-coding-journey";
const STORE = "drafts";
let databasePromise;
function database() {
  if (!window.indexedDB) return Promise.resolve(null);
  databasePromise ??= new Promise((resolve) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null); });
  return databasePromise;
}
export async function saveDraft(caseId, draft) { const db = await database(); if (!db || !caseId) return; await new Promise((resolve) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(structuredClone(draft), caseId); tx.oncomplete = resolve; tx.onerror = resolve; }); }
export async function loadDraft(caseId) { const db = await database(); if (!db || !caseId) return null; return new Promise((resolve) => { const request = db.transaction(STORE).objectStore(STORE).get(caseId); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => resolve(null); }); }
export async function clearDraft(caseId) { const db = await database(); if (!db || !caseId) return; await new Promise((resolve) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(caseId); tx.oncomplete = resolve; tx.onerror = resolve; }); }
