import sharp from "sharp";

/** Limite alignée avec sanitize Turso (~2.5 Mo de data URL). */
export const MAX_PERSIST_DATA_URL = 2_500_000;

/** URL temporaires (Replicate, etc.) — elles expirent en ~1 h. */
export function isEphemeralImageUrl(url = "") {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return /replicate\.delivery|pb\.replicate\.com|fal\.media|oaidalleapiprodscus/i.test(url);
}

export function isDurableRasterImage(url = "") {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}

export function isUsableRasterImage(url) {
  if (!url || typeof url !== "string") return false;
  if (/^data:image\/svg\+xml/i.test(url)) return false;
  if (isDurableRasterImage(url)) return true;
  // HTTP encore "usable" tant qu’elle n’est pas expirée — mais pas durable
  return /^https?:\/\//i.test(url);
}

/**
 * Compresse un buffer image en JPEG data URL sous la limite Turso.
 */
async function toPersistableJpegDataUrl(buffer) {
  const sizes = [1536, 1280, 1024, 768, 640];
  const qualities = [82, 72, 62, 52, 42];

  for (const size of sizes) {
    for (const quality of qualities) {
      const out = await sharp(buffer)
        .rotate()
        .resize(size, size, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      const dataUrl = `data:image/jpeg;base64,${out.toString("base64")}`;
      if (dataUrl.length <= MAX_PERSIST_DATA_URL) return dataUrl;
    }
  }

  throw new Error("Image trop lourde même après compression JPEG");
}

function bufferFromDataUrl(imageUrl) {
  const match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/i);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}

/**
 * Transforme une URL HTTP (Replicate) ou data URL raster en data URL JPEG persistable.
 * Ne renvoie JAMAIS une URL HTTP éphémère — elles expirent.
 */
export async function materializeImageForStorage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;

  if (/^data:image\/svg\+xml/i.test(imageUrl)) return null;

  if (isDurableRasterImage(imageUrl)) {
    if (imageUrl.length <= MAX_PERSIST_DATA_URL) return imageUrl;
    const buf = bufferFromDataUrl(imageUrl);
    if (!buf) return null;
    return toPersistableJpegDataUrl(buf);
  }

  if (!/^https?:\/\//i.test(imageUrl)) return null;

  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(
      isEphemeralImageUrl(imageUrl)
        ? `URL Replicate expirée (HTTP ${res.status}) — régénère le portrait/jaquette.`
        : `Téléchargement image HTTP ${res.status}`,
    );
  }

  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0] || "image/jpeg";
  if (/svg/i.test(mime)) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  return toPersistableJpegDataUrl(buf);
}
