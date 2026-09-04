import { resolveAceStepBaseUrl } from "./models.js";
import {
  withAuth,
  resolveAceAudioUrl,
  errText,
  apiError,
  isLanOrLoopbackHost,
} from "./client.js";
import { looksLikeAudioBuffer } from "./errors.js";

/** Express Studio = :8001 (ou tunnel), Gradio Python = :7865 (souvent loopback Demeter). */
export function resolveAceStepGradioUrl(keys, studioBase) {
  const explicit = String(keys?.aceStepGradioUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (explicit) return explicit;
  const base = String(studioBase || resolveAceStepBaseUrl(keys)).replace(/\/+$/, "");
  try {
    const u = new URL(base);
    // Express Demeter (:8001) ou tunnel public : uploads via le même host (proxy Studio).
    if (u.port === "8001" || u.port === "7865" || !isLanOrLoopbackHost(u.hostname)) {
      return base;
    }
    // Ancien layout UI :3001 → Gradio LAN :7865
    u.port = "7865";
    return String(u).replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Tunnel / Express d’abord, puis Gradio dérivé (:7865 LAN). */
export function gradioUploadBases(keys, studioBase) {
  const studio = String(studioBase || resolveAceStepBaseUrl(keys)).replace(/\/+$/, "");
  const derived = resolveAceStepGradioUrl(keys, studio);
  return [...new Set([studio, derived].filter(Boolean))];
}

/**
 * Fichier hébergé par l’UI ACE (`/audio/…`).
 * Le Studio le recopie dans `app/temp/gradio/ref-*` → Gradio 5 refuse
 * (« was not uploaded by a user »).
 */
export function isAceHostedAudioUrl(studioBase, url) {
  const s = String(url || "").trim();
  if (!s) return false;
  if (s.startsWith("/audio/")) return true;
  try {
    const u = new URL(s);
    if (!u.pathname.startsWith("/audio/")) return false;
    if (!studioBase) return false;
    const base = new URL(studioBase);
    return u.hostname === base.hostname && (u.port || "") === (base.port || "");
  } catch {
    return false;
  }
}

export function gradioFileUrl(gradioBase, localPath) {
  const base = String(gradioBase || "").replace(/\/+$/, "");
  const p = String(localPath || "").trim().replace(/\\/g, "/");
  if (!base || !p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  return `${base}/gradio_api/file=${p}`;
}

export function extractGradioUploadUrl(gradioBase, data) {
  const pick = (item) => {
    if (!item) return "";
    if (typeof item === "string") {
      if (/^https?:\/\//i.test(item)) return item;
      return gradioFileUrl(gradioBase, item);
    }
    if (typeof item === "object") {
      if (/^https?:\/\//i.test(item.url || "")) return String(item.url);
      if (item.path) return gradioFileUrl(gradioBase, item.path);
    }
    return "";
  };
  if (Array.isArray(data)) return pick(data[0]);
  if (data && typeof data === "object" && data.files) {
    return pick(Array.isArray(data.files) ? data.files[0] : data.files);
  }
  return pick(data);
}

function extFromPreview(url, mimeType) {
  const path = String(url || "").split("?")[0].toLowerCase();
  if (/\.mp3$/i.test(path) || /mpeg|mp3/i.test(mimeType)) return "mp3";
  if (/\.m4a$/i.test(path) || /mp4|m4a|aac/i.test(mimeType)) return "m4a";
  if (/\.wav$/i.test(path) || /wav/i.test(mimeType)) return "wav";
  if (/\.ogg$/i.test(path) || /ogg/i.test(mimeType)) return "ogg";
  if (/\.flac$/i.test(path) || /flac/i.test(mimeType)) return "flac";
  return "mp3";
}

async function downloadPreviewBuffer(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SONOZZ/1.0; +https://sonozz.briseteia.me)",
      Accept: "audio/*,*/*",
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Preview HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Preview audio vide");
  const mimeType = res.headers.get("content-type") || "audio/mpeg";
  if (!looksLikeAudioBuffer(buffer, mimeType)) {
    throw new Error("Preview n’est pas un fichier audio (HTML / vide / silencieux)");
  }
  return { buffer, mimeType };
}

/**
 * Upload via l’API officielle Gradio (`/gradio_api/upload`).
 * Le path renvoyé est dans le vrai cache Gradio — contrairement à
 * ACE `app/temp/gradio/ref-*` qui déclenche InvalidPathError.
 */
export async function uploadReferenceToGradio(gradioBase, buffer, fileName = "style-ref.mp3", mimeType = "audio/mpeg") {
  const base = String(gradioBase || "").replace(/\/+$/, "");
  if (!base) return "";
  const safeName = String(fileName || "style-ref.mp3")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
  const endpoints = [`${base}/gradio_api/upload`, `${base}/upload`];
  for (const endpoint of endpoints) {
    const form = new FormData();
    form.append("files", blob, safeName);
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    const url = extractGradioUploadUrl(base, data);
    if (url) return url;
  }
  return "";
}

/**
 * @deprecated Ne plus utiliser pour une référence style : ACE recopie `/audio/`
 * dans `temp/gradio/ref-*` et Gradio 5 refuse le fichier.
 */
export async function uploadAceStepReference(keys, buffer, fileName = "style-ref.mp3", mimeType = "audio/mpeg") {
  const base = resolveAceStepBaseUrl(keys);
  const safeName = String(fileName || "style-ref.mp3")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const form = new FormData();
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const file =
    typeof File !== "undefined"
      ? new File([bytes], safeName, { type: mimeType || "audio/mpeg" })
      : new Blob([bytes], { type: mimeType || "audio/mpeg" });
  form.append("audio", file, safeName);

  return withAuth(base, async (token) => {
    let res;
    try {
      res = await fetch(`${base}/api/generate/upload-audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      throw new Error(`Upload réf. ACE-Step injoignable. ${errText(e).slice(0, 120)}`);
    }
    const ct = res.headers.get("content-type") || "";
    const data = /json/i.test(ct) ? await res.json().catch(() => ({})) : {};
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(apiError("/api/generate/upload-audio", data, res.status));
    }
    const url = String(data?.url || data?.publicUrl || "").trim();
    if (!url) throw new Error("ACE-Step n’a pas renvoyé d’URL de référence");
    return resolveAceAudioUrl(base, url);
  });
}

/**
 * Prépare une URL de référence que Gradio / ACE peuvent vraiment charger.
 * Uniquement l’upload officiel Gradio — S3 / iTunes en cover → Gradio dit
 * « invalid, unreadable, or silent » (HTML 403 ou fichier non décodable).
 */
export async function ensureAceStepStyleReference(keys, previewUrl) {
  const url = String(previewUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  const studioBase = resolveAceStepBaseUrl(keys);
  if (isAceHostedAudioUrl(studioBase, url)) return "";

  let buffer;
  let mimeType = "audio/mpeg";
  try {
    const downloaded = await downloadPreviewBuffer(url);
    buffer = downloaded.buffer;
    mimeType = downloaded.mimeType;
  } catch (e) {
    console.warn("[acestep] preview réf. ignoré:", e.message);
    return "";
  }
  const ext = extFromPreview(url, mimeType);

  for (const gradioBase of gradioUploadBases(keys, studioBase)) {
    try {
      const hosted = await uploadReferenceToGradio(gradioBase, buffer, `style-ref.${ext}`, mimeType);
      if (hosted && !isAceHostedAudioUrl(studioBase, hosted)) {
        console.info("[acestep] réf. via Gradio", gradioBase);
        return hosted;
      }
    } catch (e) {
      console.warn("[acestep] upload Gradio ignoré:", gradioBase, e.message);
    }
  }

  console.warn("[acestep] cover ignoré — pas d’upload Gradio (S3 rejeté comme silent/unreadable)");
  return "";
}
