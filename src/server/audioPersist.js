/**
 * Persistance audio durable (S3) — les URL replicate.delivery expirent ~1 h,
 * et les data: sont trop lourds pour Turso.
 */

import { isS3Configured, uploadClipBuffer } from "./s3.js";

export function isEphemeralAudioUrl(url = "") {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/replicate\.delivery|pb\.replicate\.com|fal\.media|cdn\.replicate/i.test(url)) return true;
  // SongGeneration Studio local (Pinokio) — fichiers volatils tant que non persistés S3
  try {
    const u = new URL(url);
    if (/\/api\/audio\//i.test(u.pathname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function isAudioDataUrl(url = "") {
  return typeof url === "string" && /^data:audio\//i.test(url);
}

function extFromMime(mime = "") {
  if (/mpeg|mp3/i.test(mime)) return "mp3";
  if (/wav/i.test(mime)) return "wav";
  if (/ogg/i.test(mime)) return "ogg";
  if (/mp4|m4a|aac/i.test(mime)) return "m4a";
  if (/webm/i.test(mime)) return "webm";
  return "mp3";
}

function sniffMime(buffer, fallback = "audio/mpeg") {
  if (!buffer?.length) return fallback;
  // ID3 / MP3
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return "audio/mpeg";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  // RIFF WAVE
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    return "audio/wav";
  }
  // Ogg
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67) return "audio/ogg";
  // ftyp (m4a)
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return "audio/mp4";
  }
  return fallback;
}

function bufferFromDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mimeType: match[1] || "audio/mpeg",
    buffer: Buffer.from(match[2], "base64"),
  };
}

/**
 * Télécharge / décode une source audio → buffer + mime.
 */
export async function loadAudioBuffer(source) {
  if (!source || typeof source !== "string") {
    throw new Error("Source audio manquante");
  }

  if (isAudioDataUrl(source)) {
    const parsed = bufferFromDataUrl(source);
    if (!parsed?.buffer?.length) throw new Error("Data URL audio invalide");
    return {
      buffer: parsed.buffer,
      mimeType: sniffMime(parsed.buffer, parsed.mimeType),
    };
  }

  if (!/^https?:\/\//i.test(source)) {
    throw new Error("URL audio non supportée (http(s) ou data:audio requis)");
  }

  const res = await fetch(source);
  if (!res.ok) {
    throw new Error(
      isEphemeralAudioUrl(source)
        ? `Audio Replicate expiré (HTTP ${res.status}) — régénère ou réimporte le morceau.`
        : `Téléchargement audio HTTP ${res.status}`,
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1000) {
    throw new Error("Fichier audio trop petit / invalide (lien probablement mort)");
  }

  // Souvent une page HTML d’erreur
  const head = buffer.subarray(0, 64).toString("utf8").toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html")) {
    throw new Error(
      "L’URL audio renvoie une page HTML (lien mort). Régénère ou réimporte le morceau.",
    );
  }

  const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
  const mimeType = sniffMime(
    buffer,
    /audio\//i.test(ct) ? ct : isEphemeralAudioUrl(source) ? "audio/mpeg" : "audio/mpeg",
  );

  return { buffer, mimeType };
}

/**
 * Matérialise l’audio sur S3. Renvoie null si S3 absent ou source déjà durable non-éphémère.
 */
export async function materializeAudioForStorage(audioUrl, { projectId = "anon" } = {}) {
  if (!audioUrl || typeof audioUrl !== "string") return null;
  if (!isS3Configured()) {
    if (isEphemeralAudioUrl(audioUrl) || isAudioDataUrl(audioUrl)) {
      throw new Error(
        "S3 requis pour garder le morceau (les liens Replicate expirent ~1 h). Configure S3 dans .env.",
      );
    }
    return null;
  }

  // Déjà sur notre bucket → garder
  if (/^https?:\/\//i.test(audioUrl) && !isEphemeralAudioUrl(audioUrl) && !isAudioDataUrl(audioUrl)) {
    // Si c’est déjà une URL S3 sonozz / publique, ne pas re-upload
    if (/s3\.|scw\.cloud|r2\.cloudflare|digitaloceanspaces|sonozz/i.test(audioUrl)) {
      return { url: audioUrl, reused: true };
    }
  }

  const { buffer, mimeType } = await loadAudioBuffer(audioUrl);
  const ext = extFromMime(mimeType);
  const key = `audio/${String(projectId).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60)}/${Date.now()}.${ext}`;
  const uploaded = await uploadClipBuffer(buffer, {
    projectId,
    mimeType,
    key,
  });

  return {
    url: uploaded.url,
    s3Key: uploaded.key,
    mimeType: uploaded.mimeType,
    byteLength: uploaded.byteLength,
    reused: false,
  };
}

/** Test rapide : l’URL répond-elle encore avec de l’audio ? */
export async function probeAudioUrl(audioUrl) {
  if (!audioUrl || typeof audioUrl !== "string") {
    return { ok: false, reason: "missing" };
  }
  if (isAudioDataUrl(audioUrl)) {
    return { ok: true, durable: false, kind: "data" };
  }
  if (!/^https?:\/\//i.test(audioUrl)) {
    return { ok: false, reason: "unsupported" };
  }
  try {
    const res = await fetch(audioUrl, { method: "HEAD" });
    if (!res.ok) {
      // Certains CDN refusent HEAD
      const get = await fetch(audioUrl, {
        headers: { Range: "bytes=0-1023" },
      });
      if (!get.ok) {
        return {
          ok: false,
          reason: "http",
          status: get.status,
          ephemeral: isEphemeralAudioUrl(audioUrl),
        };
      }
      const ct = get.headers.get("content-type") || "";
      const buf = Buffer.from(await get.arrayBuffer());
      if (buf.subarray(0, 20).toString("utf8").toLowerCase().includes("<html")) {
        return { ok: false, reason: "html", ephemeral: isEphemeralAudioUrl(audioUrl) };
      }
      return {
        ok: true,
        durable: !isEphemeralAudioUrl(audioUrl),
        mimeType: ct,
        ephemeral: isEphemeralAudioUrl(audioUrl),
      };
    }
    const ct = res.headers.get("content-type") || "";
    return {
      ok: /audio|octet-stream|mpeg|mp4|wav/i.test(ct) || res.ok,
      durable: !isEphemeralAudioUrl(audioUrl),
      mimeType: ct,
      ephemeral: isEphemeralAudioUrl(audioUrl),
    };
  } catch (e) {
    return { ok: false, reason: e.message, ephemeral: isEphemeralAudioUrl(audioUrl) };
  }
}
