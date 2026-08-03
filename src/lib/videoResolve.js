/**
 * Matérialise une URL vidéo distante en blob: local (contourne CORS Replicate).
 */

export async function resolveVideoBlobUrl(src) {
  if (!src) throw new Error("URL vidéo manquante");
  if (src.startsWith("blob:") || src.startsWith("data:")) {
    return { url: src, revoke: false, mimeType: "video/mp4" };
  }

  let res;
  if (/^https?:\/\//i.test(src)) {
    // Toujours via proxy serveur pour canvas (CORS + Range 416)
    res = await fetch(`/api/video/fetch?url=${encodeURIComponent(src)}`);
  } else {
    res = await fetch(src);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Vidéo inaccessible (HTTP ${res.status})`);
  }

  const blob = await res.blob();
  if (!blob.size || blob.size < 1000) throw new Error("Vidéo téléchargée vide");
  const mime = blob.type?.startsWith("video/") ? blob.type : "video/mp4";
  const fixed = blob.type?.startsWith("video/") ? blob : new Blob([blob], { type: mime });
  return {
    url: URL.createObjectURL(fixed),
    revoke: true,
    mimeType: mime,
    byteLength: fixed.size,
  };
}

/** Résout une liste d’URLs → blob: utilisables pour le montage canvas. */
export async function resolveVideoBlobUrls(sources = []) {
  const out = [];
  const revokable = [];
  for (const src of sources) {
    // blob: déjà locaux : ne pas re-fetcher ni révoquer ici (le caller gère)
    if (typeof src === "string" && src.startsWith("blob:")) {
      out.push(src);
      continue;
    }
    const resolved = await resolveVideoBlobUrl(src);
    out.push(resolved.url);
    if (resolved.revoke) revokable.push(resolved.url);
  }
  return {
    urls: out,
    revokeAll: () => revokable.forEach((u) => URL.revokeObjectURL(u)),
  };
}
