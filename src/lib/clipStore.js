/**
 * Stockage local des clips vidéo (IndexedDB) —
 * évite d’envoyer des dizaines de Mo en base64 dans Turso.
 *
 * Clés : `projectId::clipId` (multi-clips) ou `projectId` (legacy mono-clip).
 */

import { clipBlobKey } from "./clipsModel.js";

const DB_NAME = "sonozz-clips";
const STORE = "clips";
const DB_VERSION = 1;
const TMP_KEY = "sonozz-clip-key";

/** Cache mémoire session (évite relecture IDB à chaque onglet). */
const memory = new Map();

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB impossible"));
  });
}

/** Clé stable avant le premier save Turso (legacy / projet sans id). */
export function ensureClipStorageKey(projectId, clipId) {
  if (projectId && clipId) return clipBlobKey(projectId, clipId);
  if (projectId) return String(projectId);
  try {
    let k = sessionStorage.getItem(TMP_KEY);
    if (!k) {
      k = `tmp-${crypto.randomUUID()}`;
      sessionStorage.setItem(TMP_KEY, k);
    }
    return clipId ? `${k}::${clipId}` : k;
  } catch {
    const k = `tmp-${Date.now()}`;
    return clipId ? `${k}::${clipId}` : k;
  }
}

export async function saveClipBlob(storageKey, blob, meta = {}) {
  if (!storageKey || !blob) return;
  const key = String(storageKey);
  memory.set(key, { blob, meta, at: Date.now() });
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ blob, meta, at: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Sauvegarde clip IndexedDB échouée"));
  });
}

export async function loadClipBlob(storageKey) {
  if (!storageKey) return null;
  const key = String(storageKey);
  if (memory.has(key)) return memory.get(key);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      const row = req.result || null;
      if (row?.blob) memory.set(key, row);
      resolve(row);
    };
    req.onerror = () => reject(req.error || new Error("Lecture clip IndexedDB échouée"));
  });
}

/** Migre un clip tmp-* / projectId vers l’id Turso après premier save. */
export async function migrateClipBlob(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const row = await loadClipBlob(fromKey);
  if (!row?.blob) return;
  await saveClipBlob(toKey, row.blob, row.meta || {});
  await deleteClipBlob(fromKey);
  try {
    const base = String(fromKey).split("::")[0];
    if (sessionStorage.getItem(TMP_KEY) === base || sessionStorage.getItem(TMP_KEY) === fromKey) {
      sessionStorage.removeItem(TMP_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** Migre tous les blobs d’un projet (préfixe `fromId` et `fromId::`). */
export async function migrateProjectClipBlobs(fromProjectId, toProjectId, clipIds = []) {
  if (!toProjectId || fromProjectId === toProjectId) return;
  const ids = clipIds.length ? clipIds : [null];
  if (fromProjectId) {
    for (const clipId of ids) {
      const from = clipId ? clipBlobKey(fromProjectId, clipId) : String(fromProjectId);
      const to = clipId ? clipBlobKey(toProjectId, clipId) : String(toProjectId);
      try {
        await migrateClipBlob(from, to);
      } catch {
        /* optionnel */
      }
    }
    // Legacy mono-clé → premier clipId si fourni
    if (clipIds[0]) {
      try {
        await migrateClipBlob(String(fromProjectId), clipBlobKey(toProjectId, clipIds[0]));
      } catch {
        /* ignore */
      }
    }
  }
  try {
    const tmp = sessionStorage.getItem(TMP_KEY);
    if (tmp) {
      for (const clipId of ids) {
        const from = clipId ? `${tmp}::${clipId}` : tmp;
        const to = clipId ? clipBlobKey(toProjectId, clipId) : String(toProjectId);
        await migrateClipBlob(from, to);
      }
    }
  } catch {
    /* ignore */
  }
}

export async function deleteClipBlob(storageKey) {
  if (!storageKey) return;
  const key = String(storageKey);
  memory.delete(key);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Suppression clip IndexedDB échouée"));
  });
}

/** Métadonnées clip sans payload data: (pour React state / Turso). */
export function clipMetaOnly(clip = {}, extra = {}) {
  if (!clip || typeof clip !== "object") return { storedLocally: true, ...extra };
  const { videoBase64, ...rest } = clip;
  const remote =
    typeof rest.videoUrl === "string" && /^https?:\/\//i.test(rest.videoUrl)
      ? rest.videoUrl
      : undefined;
  return {
    ...rest,
    ...extra,
    videoBase64: undefined,
    videoUrl: remote || extra.videoUrl || undefined,
    storedRemote: Boolean(remote || rest.s3Key || rest.storedRemote || extra.storedRemote),
    storedLocally: Boolean(
      extra.storedLocally ?? (rest.storedLocally && !remote && !rest.s3Key),
    ),
  };
}

export function dataUrlToBlob(dataUrl) {
  // fetch(data:) gère mieux les gros fichiers que atob()
  return fetch(dataUrl).then((r) => r.blob());
}

export async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture vidéo impossible"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Charge le blob clip : mémoire → IndexedDB (multi + legacy) → URL S3/http → data URL legacy.
 */
export async function resolveClipBlob(projectId, clip) {
  const clipId = clip?.id || null;
  const keys = [
    clipId && projectId ? clipBlobKey(projectId, clipId) : null,
    clipId ? ensureClipStorageKey(null, clipId) : null,
    projectId ? String(projectId) : null,
    ensureClipStorageKey(projectId),
  ].filter(Boolean);
  const uniq = [...new Set(keys.map(String))];
  for (const key of uniq) {
    try {
      const row = await loadClipBlob(key);
      if (row?.blob) return row.blob;
    } catch {
      /* try next */
    }
  }

  const remote = clip?.videoUrl;
  if (typeof remote === "string" && /^https?:\/\//i.test(remote)) {
    const res = await fetch(remote);
    if (!res.ok) throw new Error(`Clip distant HTTP ${res.status}`);
    const blob = await res.blob();
    const cacheKey =
      clipId && projectId ? clipBlobKey(projectId, clipId) : projectId || null;
    if (cacheKey) {
      try {
        await saveClipBlob(cacheKey, blob, clipMetaOnly(clip));
      } catch {
        /* ignore */
      }
    }
    return blob;
  }

  const src = clip?.videoBase64 || clip?.videoUrl;
  if (typeof src === "string" && src.startsWith("data:")) {
    return dataUrlToBlob(src);
  }
  return null;
}
