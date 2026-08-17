import sharp from "sharp";
import { error } from "../../../../server/http.js";
import { getArtistBySlug } from "../../../../server/artists.js";

export const prerender = false;

function firstPhoto(profile = {}) {
  const candidates = [
    profile.imageUrl,
    ...(Array.isArray(profile.photos) ? profile.photos : []),
  ];
  for (const url of candidates) {
    if (typeof url !== "string" || !url) continue;
    if (/^data:image\/svg/i.test(url)) continue;
    if (url.startsWith("data:image/") || /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

function bufferFromDataUrl(url) {
  const match = String(url).match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function GET({ params }) {
  try {
    const artist = await getArtistBySlug(params.slug);
    if (!artist) return error("Artiste introuvable", 404);
    const src = firstPhoto(artist.profile);
    if (!src) return error("Pas de photo", 404);

    if (/^https?:\/\//i.test(src)) {
      return Response.redirect(src, 302);
    }

    const parsed = bufferFromDataUrl(src);
    if (!parsed?.buffer?.length) return error("Photo illisible", 404);

    const thumb = await sharp(parsed.buffer)
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();

    return new Response(thumb, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
        ETag: `"${params.slug}-${parsed.buffer.length}"`,
      },
    });
  } catch (e) {
    return error(e.message || "Photo indisponible", 500);
  }
}
