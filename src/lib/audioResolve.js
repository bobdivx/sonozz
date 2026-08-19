/**
 * Résout une URL audio en Blob / ObjectURL jouable & décodable.
 * Contourne CORS et liens Replicate morts via proxy serveur.
 */

function looksLikeAudio(buffer) {
  if (!buffer || buffer.byteLength < 100) return false;
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const head = String.fromCharCode(...u8.subarray(0, 16)).toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html")) return false;
  // MP3 / ID3 / WAV / Ogg / ftyp / fLaC
  if (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0) return true;
  if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return true;
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46) return true;
  if (u8[0] === 0x4f && u8[1] === 0x67 && u8[2] === 0x67) return true;
  if (u8[0] === 0x66 && u8[1] === 0x4c && u8[2] === 0x61 && u8[3] === 0x43) return true;
  if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79) return true;
  return u8.byteLength > 10_000; // gros binaire inconnu mais plausible
}

/**
 * URL jouable dans <audio> : proxy si cross-origin / LAN Pinokio / S3 privé.
 * Préfère `?key=` pour les objets sonozz (bucket privé Scaleway → 403 en URL publique).
 */
export function playableAudioSrc(audioUrl, s3Key) {
  const key =
    (typeof s3Key === "string" && /^(audio|clips)\//i.test(s3Key.trim()) && s3Key.trim()) ||
    null;
  if (key) {
    return `/api/audio/stream?key=${encodeURIComponent(key)}`;
  }
  if (!audioUrl) return "";
  if (audioUrl.startsWith("data:audio") || audioUrl.startsWith("blob:") || audioUrl.startsWith("/")) {
    return audioUrl;
  }
  try {
    if (typeof location !== "undefined") {
      const u = new URL(audioUrl, location.href);
      if (u.origin === location.origin) return audioUrl;
      // URL S3 sonozz non signée → stream via parsing côté serveur
      if (/s3\.|scw\.cloud|r2\.cloudflare|sonozz/i.test(u.hostname)) {
        return `/api/audio/stream?url=${encodeURIComponent(audioUrl)}`;
      }
    }
  } catch {
    /* fallthrough */
  }
  return `/api/audio/stream?url=${encodeURIComponent(audioUrl)}`;
}

function base64ToArrayBuffer(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Cross-origin (S3, Replicate…) → proxy pour éviter CORS / bruit console. */
function shouldProxyFirst(audioUrl) {
  try {
    if (typeof location === "undefined") return true;
    const u = new URL(audioUrl, location.href);
    if (u.origin === location.origin) return false;
    return true;
  } catch {
    return true;
  }
}

async function fetchDirect(audioUrl) {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (!looksLikeAudio(buf)) {
    throw new Error("Contenu non-audio (lien probablement expiré)");
  }
  const mime = (res.headers.get("content-type") || "audio/mpeg").split(";")[0];
  return { buffer: buf, mimeType: /audio\//i.test(mime) ? mime : "audio/mpeg" };
}

async function fetchViaStreamProxy(audioUrl) {
  const res = await fetch(`/api/audio/stream?url=${encodeURIComponent(audioUrl)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Proxy stream HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (!looksLikeAudio(buf)) throw new Error("Proxy: contenu non-audio");
  const mime = (res.headers.get("content-type") || "audio/mpeg").split(";")[0];
  return { buffer: buf, mimeType: /audio\//i.test(mime) ? mime : "audio/mpeg" };
}

async function fetchViaJsonProxy(audioUrl) {
  const res = await fetch("/api/audio/persist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "proxy", audioUrl }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error ||
        "Audio inaccessible — le lien Replicate a probablement expiré. Régénère ou réimporte le morceau.",
    );
  }
  return {
    buffer: base64ToArrayBuffer(data.base64),
    mimeType: data.mimeType || "audio/mpeg",
  };
}

async function fetchViaProxy(audioUrl) {
  try {
    return await fetchViaStreamProxy(audioUrl);
  } catch {
    return await fetchViaJsonProxy(audioUrl);
  }
}

function wrap(asset) {
  const blob = new Blob([asset.buffer], { type: asset.mimeType });
  return {
    ...asset,
    blob,
    objectUrl: URL.createObjectURL(blob),
  };
}

/**
 * @returns {Promise<{ buffer: ArrayBuffer, mimeType: string, blob: Blob, objectUrl: string }>}
 * Pense à revoke objectUrl après usage.
 */
export async function resolveAudioAsset(audioUrl) {
  if (!audioUrl) throw new Error("URL audio manquante");

  if (audioUrl.startsWith("data:audio")) {
    const res = await fetch(audioUrl);
    const buffer = await res.arrayBuffer();
    const mime = audioUrl.slice(5, audioUrl.indexOf(";")) || "audio/mpeg";
    const blob = new Blob([buffer], { type: mime });
    return { buffer, mimeType: mime, blob, objectUrl: URL.createObjectURL(blob) };
  }

  let lastErr;

  // S3 / CDN : proxy d’abord (évite rouge CORS dans la console)
  if (shouldProxyFirst(audioUrl)) {
    try {
      return wrap(await fetchViaProxy(audioUrl));
    } catch (e) {
      lastErr = e;
    }
    try {
      return wrap(await fetchDirect(audioUrl));
    } catch (e) {
      throw new Error(
        e.message ||
          lastErr?.message ||
          "Impossible de charger l’audio — régénère ou réimporte le morceau (étape Morceaux).",
      );
    }
  }

  try {
    return wrap(await fetchDirect(audioUrl));
  } catch (e) {
    lastErr = e;
  }

  try {
    return wrap(await fetchViaProxy(audioUrl));
  } catch (e) {
    throw new Error(
      e.message ||
        lastErr?.message ||
        "Impossible de charger l’audio — régénère ou réimporte le morceau (étape Morceaux).",
    );
  }
}

/** Persiste l’audio sur S3 (URL durable). `force` = re-upload même si déjà S3. */
export async function persistAudioRemote(audioUrl, projectId = "anon", { force = false } = {}) {
  const res = await fetch("/api/audio/persist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "persist", audioUrl, projectId, force }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Persistance audio impossible");
  return data;
}
