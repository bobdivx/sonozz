import { resolveAudioAsset } from "../audioResolve.js";

const W = 1080;
const H = 1920;
const FPS = 30;
export const PROMO_SHORT_SECONDS = 28;
const CTA_SECONDS = 3.5;

export function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    // blob:/data: = same-origin → pas de CORS. Remote + crossOrigin casse Replicate.
    if (/^https?:\/\//i.test(src)) {
      v.crossOrigin = "anonymous";
    }
    let settled = false;
    const fail = (why) => {
      if (settled) return;
      settled = true;
      reject(new Error(why || "Impossible de charger une piste vidéo"));
    };
    const ok = () => {
      if (settled) return;
      if (!v.videoWidth || !v.videoHeight) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => fail("Timeout chargement vidéo (métadonnées)"), 20000);
    const wrapOk = () => {
      clearTimeout(timer);
      ok();
    };
    v.onloadedmetadata = wrapOk;
    v.onloadeddata = wrapOk;
    v.oncanplay = wrapOk;
    v.onerror = () => {
      clearTimeout(timer);
      fail("Erreur décodage vidéo (CORS ou fichier invalide)");
    };
    v.src = src;
    v.load();
  });
}

/** Attend une frame décodée avant le premier drawImage (évite « Frame indisponible »). */
export async function waitForDecodableFrame(video, { timeoutMs = 12000 } = {}) {
  if (!video) throw new Error("Vidéo manquante");
  video.muted = true;
  video.playsInline = true;
  try {
    video.currentTime = 0;
  } catch {
    /* ignore */
  }
  await video.play().catch(() => {});

  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (video.videoWidth > 0 && video.readyState >= 2) {
      // petit seek pour forcer un decode
      try {
        if (video.currentTime < 0.05 && Number.isFinite(video.duration) && video.duration > 0.2) {
          await new Promise((resolve) => {
            const done = () => {
              video.removeEventListener("seeked", done);
              resolve();
            };
            video.addEventListener("seeked", done);
            try {
              video.currentTime = 0.08;
            } catch {
              resolve();
            }
            setTimeout(resolve, 400);
          });
        }
      } catch {
        /* ignore */
      }
      if (video.readyState >= 2) return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    "Frame vidéo indisponible — le plan n’a pas pu être décodé (souvent CORS Replicate). Réessaie.",
  );
}

export function loadAudio(src) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.preload = "auto";
    let settled = false;
    const ok = () => {
      if (settled) return;
      settled = true;
      resolve(a);
    };
    a.oncanplaythrough = ok;
    a.onloadeddata = () => setTimeout(ok, 300);
    a.onerror = () =>
      reject(
        new Error(
          "Impossible de charger l’audio du morceau — lien mort ? Régénère/réimporte à l’étape Morceaux.",
        ),
      );
    a.src = src;
  });
}
