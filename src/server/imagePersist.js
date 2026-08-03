/** Limite alignée avec sanitize Turso (~2.5 Mo de data URL). */
export const MAX_PERSIST_DATA_URL = 2_500_000;

/**
 * Transforme une URL HTTP (Replicate) ou data URL raster en data URL persistable.
 * Les URL Replicate expirent — mieux vaut stocker le base64.
 */
export async function materializeImageForStorage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;

  if (/^data:image\/svg\+xml/i.test(imageUrl)) return null;

  if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageUrl)) {
    if (imageUrl.length <= MAX_PERSIST_DATA_URL) return imageUrl;
    return null; // trop lourd — le caller gardera l’URL HTTP si dispo
  }

  if (!/^https?:\/\//i.test(imageUrl)) return null;

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Téléchargement image HTTP ${res.status}`);

  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0] || "image/jpeg";
  if (/svg/i.test(mime)) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

  if (dataUrl.length <= MAX_PERSIST_DATA_URL) return dataUrl;

  // Trop gros : on renvoie l’URL HTTP (moins durable mais utilisable tout de suite)
  return imageUrl;
}

export function isUsableRasterImage(url) {
  if (!url || typeof url !== "string") return false;
  if (/^data:image\/svg\+xml/i.test(url)) return false;
  if (/^https?:\/\//i.test(url)) return true;
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}
