import { useEffect, useState } from "preact/hooks";

const LOADERS = {
  stats: () => import("./StatsStep.jsx"),
  lyrics: () => import("./LyricsStep.jsx"),
  tracks: () => import("./TracksStep.jsx"),
  covers: () => import("./CoverStep.jsx"),
  distrokid: () => import("./DistroKidStep.jsx"),
  clip: () => import("./ClipStep.jsx"),
  social: () => import("./SocialStep.jsx"),
};

const pending = new Map();
const resolved = new Map();

export function peekStep(key) {
  return resolved.get(key) || null;
}

export function loadStep(key) {
  if (!LOADERS[key]) return Promise.resolve(null);
  if (resolved.has(key)) return Promise.resolve(resolved.get(key));
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const job = LOADERS[key]()
    .then((mod) => {
      const Comp = mod.default;
      resolved.set(key, Comp);
      pending.delete(key);
      return Comp;
    })
    .catch((err) => {
      pending.delete(key);
      throw err;
    });
  pending.set(key, job);
  return job;
}

export function prefetchStep(key) {
  if (!key || !LOADERS[key]) return;
  void loadStep(key).catch(() => {});
}

/** Composant de l’étape visible. Les autres chunks restent hors du premier chargement. */
export function useStudioStep(stepKey) {
  const [rev, setRev] = useState(0);
  const [failedKey, setFailedKey] = useState(null);

  useEffect(() => {
    if (!stepKey || peekStep(stepKey)) return;
    let alive = true;
    loadStep(stepKey)
      .then(() => {
        if (alive) setRev((n) => n + 1);
      })
      .catch(() => {
        if (alive) setFailedKey(stepKey);
      });
    return () => {
      alive = false;
    };
  }, [stepKey]);

  void rev;
  return {
    Comp: stepKey ? peekStep(stepKey) : null,
    failed: failedKey === stepKey && !peekStep(stepKey),
  };
}
