import { handle_file } from "@gradio/client";
import { isS3Configured, uploadClipBuffer } from "../s3.js";

/** Null sûr pour champs média Gradio requis (vidéo / image / filepath). */
export function emptyMediaValue(typeStr = "") {
  const t = String(typeStr);
  if (/dict\(video:/i.test(t)) return null;
  if (/filepath/i.test(t) && !/dict\(/i.test(t)) return null;
  if (/dict\(background:/i.test(t)) return null; // image_mask_guide
  if (/dict\(path:/i.test(t)) return null; // FileData image
  if (/Literal\[\]/.test(t)) return null;
  if (/^list\[/i.test(t)) return [];
  return null;
}

/** Télécharge le portrait côté sonozz puis le pousse à Gradio (Demeter ne voit pas localhost). */
export async function uploadImageForGradio(imageUrl) {
  if (!imageUrl) return null;
  try {
    const res = await fetch(imageUrl, {
      headers: { Accept: "image/*,*/*" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error("image trop petite");
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    let ext = "jpg";
    let mime = "image/jpeg";
    if (/png/.test(ct) || /\.png(\?|$)/i.test(imageUrl)) {
      ext = "png";
      mime = "image/png";
    } else if (/webp/.test(ct) || /\.webp(\?|$)/i.test(imageUrl)) {
      ext = "webp";
      mime = "image/webp";
    } else if (/gif/.test(ct)) {
      ext = "gif";
      mime = "image/gif";
    }
    // Gradio exige une extension reconnue dans le nom de fichier
    const file = new File([buf], `portrait.${ext}`, { type: mime });
    return handle_file(file);
  } catch (e) {
    console.warn("[wan2gp] download portrait failed:", e.message);
    return null;
  }
}

export function absolutizeMediaUrl(raw, baseUrl) {
  const s = String(raw || "").trim();
  if (!s || /\s/.test(s) || /<[^>]+>/.test(s) || s.length > 800) return null;
  if (/\.(svg|png|jpe?g|gif|webp|ico)(\?|$)/i.test(s)) return null;
  if (/\/icons\//i.test(s)) return null;
  if (!/\.(mp4|webm|mov)(\?|$)/i.test(s) && !/\/file[=/][^\s"'<>]+\.(mp4|webm|mov)/i.test(s)) {
    return null;
  }
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${baseUrl}${s}`;
  return `${baseUrl}/${s.replace(/^\.\//, "")}`;
}

export function collectVideoUrls(data, baseUrl) {
  const found = [];
  const stack = [data];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null || seen.has(cur)) continue;
    if (typeof cur === "object") seen.add(cur);

    if (typeof cur === "string") {
      // Extraire les URLs vidéo d’un blob (évite de prendre tout le HTML queue pour une URL)
      const re =
        /(?:https?:\/\/[^\s"'<>]+|(?:\/gradio_api)?\/file(?:=|\/)[^\s"'<>]+|\.?\/?[^\s"'<>]+)\.(?:mp4|webm|mov)(?:\?[^\s"'<>]*)?/gi;
      const hits = cur.match(re) || [];
      if (hits.length) {
        for (const h of hits) {
          const url = absolutizeMediaUrl(h, baseUrl);
          if (url && !found.includes(url)) found.push(url);
        }
      } else {
        const url = absolutizeMediaUrl(cur, baseUrl);
        if (url && !found.includes(url)) found.push(url);
      }
      continue;
    }
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
      continue;
    }
    if (typeof cur === "object") {
      if (typeof cur.url === "string") stack.push(cur.url);
      if (typeof cur.path === "string") stack.push(cur.path);
      if (typeof cur.video === "object") stack.push(cur.video);
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return found;
}

export function extractVideoUrl(data, baseUrl) {
  const urls = collectVideoUrls(data, baseUrl);
  return urls[0] || null;
}

export async function persistVideoIfPossible(videoUrl, projectId) {
  if (!isS3Configured()) return { url: videoUrl };
  try {
    const res = await fetch(videoUrl, {
      headers: { Accept: "video/*,application/octet-stream,*/*" },
    });
    if (!res.ok) return { url: videoUrl };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) return { url: videoUrl };
    const uploaded = await uploadClipBuffer(buffer, {
      projectId: projectId || "wan2gp",
      mimeType: "video/mp4",
      key: `tmp/wan2gp/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
    });
    return { url: uploaded.url, s3Key: uploaded.key };
  } catch {
    return { url: videoUrl };
  }
}
