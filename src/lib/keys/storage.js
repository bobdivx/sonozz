import { EMPTY_KEYS, migrateKeys } from "./defaults.js";
import { isFlagOn } from "./studios.js";

const STORAGE_KEY = "sonozz.keys.v1";
const HYDRATED_FLAG = "sonozz.keys.turso.v1";

/** True si au moins une valeur non-défaut (secrets, tokens, URLs custom…). */
export function keysHaveUserData(keys) {
  const empty = EMPTY_KEYS();
  return Object.keys(empty).some((k) => {
    const v = String(keys?.[k] ?? "").trim();
    const d = String(empty[k] ?? "").trim();
    return Boolean(v) && v !== d;
  });
}

function writeLocalKeys(keys) {
  const next = migrateKeys({ ...EMPTY_KEYS(), ...keys });
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function loadKeys() {
  if (typeof localStorage === "undefined") return EMPTY_KEYS();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_KEYS();
    const migrated = migrateKeys({ ...EMPTY_KEYS(), ...JSON.parse(raw) });
    if (raw !== JSON.stringify(migrated)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return EMPTY_KEYS();
  }
}

async function pushKeysToTurso(keys) {
  // Ne jamais écraser Turso avec un blob local « vide » (ex. switch provider avant hydrate)
  let payload = keys;
  try {
    const res = await fetch("/api/keys");
    const data = await res.json().catch(() => ({}));
    const remote = data.keys && typeof data.keys === "object" ? data.keys : null;
    if (remote && keysHaveUserData(remote)) {
      const merged = { ...remote, ...keys };
      for (const k of Object.keys(remote)) {
        const localV = String(keys?.[k] ?? "").trim();
        const remoteV = String(remote[k] ?? "").trim();
        if (!localV && remoteV) merged[k] = remote[k];
      }
      payload = merged;
    }
  } catch {
    /* garde le payload local */
  }

  const res = await fetch("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Sauvegarde Turso HTTP ${res.status}`);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(HYDRATED_FLAG, "1");
    // Ré-écrire le merge pour que loadKeys() voie les secrets Turso
    writeLocalKeys(payload);
  }
  return data;
}

/**
 * Cache local + push Turso (fire-and-forget).
 * Préférer `saveKeysAsync` quand l’UI doit confirmer la persistance.
 */
export function saveKeys(keys) {
  const next = writeLocalKeys(keys);
  if (typeof window !== "undefined") {
    void pushKeysToTurso(next).catch((err) => {
      console.warn("[sonozz] sync clés → Turso échouée:", err?.message || err);
    });
  }
  return next;
}

/** Cache local + await Turso. Retourne { keys, labelSync? }. */
export async function saveKeysAsync(keys) {
  const data = await pushKeysToTurso(keys);
  const next = loadKeys();
  return { keys: next, labelSync: data?.labelSync || null };
}

let hydratePromise = null;

/**
 * Source de vérité = Turso.
 * Si Turso vide et localStorage a des clés → migration unique vers Turso.
 */
export async function hydrateKeysFromTurso() {
  if (typeof window === "undefined") return loadKeys();

  try {
    const res = await fetch("/api/keys");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Lecture Turso HTTP ${res.status}`);
    }

    const remote = data.keys && typeof data.keys === "object" ? data.keys : null;
    if (remote && keysHaveUserData(remote)) {
      const next = writeLocalKeys(remote);
      localStorage.setItem(HYDRATED_FLAG, "1");
      return next;
    }

    const local = loadKeys();
    if (keysHaveUserData(local)) {
      await pushKeysToTurso(local);
      return local;
    }

    localStorage.setItem(HYDRATED_FLAG, "1");
    return local;
  } catch (err) {
    console.warn("[sonozz] hydrate clés Turso échouée:", err?.message || err);
    return loadKeys();
  }
}

/** Une seule hydratation par chargement de page. */
export function ensureKeysHydrated() {
  if (typeof window === "undefined") {
    return Promise.resolve(EMPTY_KEYS());
  }
  if (!hydratePromise) {
    hydratePromise = hydrateKeysFromTurso();
  }
  return hydratePromise;
}

export function keysReady(keys) {
  if (String(keys?.llmProvider || "gemini").trim() === "ollama") {
    return Boolean(keys?.ollamaModel?.trim());
  }
  return Boolean(keys?.geminiApiKey?.trim());
}

/** Affiche un champ si `when` matche les clés actuelles. */
export function fieldVisible(field, keys) {
  if (!field?.when) return true;
  return Object.entries(field.when).every(([id, value]) => {
    const defaults = { llmProvider: "gemini", musicProvider: "replicate", videoProvider: "cloud" };
    const current = keys?.[id]?.trim() || defaults[id] || "";
    return current === value;
  });
}

export function maskSecret(value) {
  if (!value) return "";
  if (value.length < 8) return "••••••••";
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}
