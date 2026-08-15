/**
 * Restaure l’audio ORIGINAL d’une release ONCE → S3 + Turso.
 * Le PAT ONCE ne peut pas télécharger /api/files/* (401) :
 * fournir un fichier local téléchargé depuis l’UI ONCE, ou un buffer.
 */

import { isS3Configured, uploadClipBuffer } from "./s3.js";
import { extFromMime, sniffMime, mimeFromFileName } from "./audioPersist.js";

const ONCE_API = "https://once.app/v1";

export async function fetchOnceRelease(token, releaseId) {
  const res = await fetch(`${ONCE_API}/releases/${encodeURIComponent(releaseId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Once-Provenance": "SONOZZ",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `ONCE release HTTP ${res.status}`);
  }
  return data;
}

export function extractOnceAudioPath(release) {
  const tracks = release?.tracks || [];
  const t0 = tracks[0];
  return t0?.audio_file_url || t0?.original_audio_file_url || null;
}

/**
 * Tente un download authentifié (souvent 401 avec PAT — l’UI web utilise la session cookie).
 */
export async function tryDownloadOnceFile(token, filePath) {
  const path = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const urls = [`https://beta.once.app${path}`, `https://once.app${path}`];
  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "audio/*,application/octet-stream,*/*",
        "X-Once-Provenance": "SONOZZ",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const head = buf.subarray(0, 16).toString("utf8").toLowerCase();
    if (
      res.ok &&
      buf.length > 50_000 &&
      !ct.includes("html") &&
      !ct.includes("json") &&
      !head.includes("<!doctype") &&
      !head.includes("<html")
    ) {
      return {
        buffer: buf,
        mimeType: ct.startsWith("audio/") ? ct.split(";")[0] : "audio/wav",
        sourceUrl: url,
      };
    }
  }
  return null;
}

/**
 * @param {{ token: string, releaseId: string, projectId: string, audioBuffer?: Buffer, mimeType?: string }} opts
 */
export async function restoreAudioFromOnceRelease({
  token,
  releaseId,
  projectId,
  audioBuffer,
  mimeType = "audio/wav",
  fileName = "",
} = {}) {
  if (!token?.trim()) throw new Error("Token ONCE requis");
  if (!releaseId?.trim()) throw new Error("releaseId ONCE manquant");
  if (!isS3Configured()) throw new Error("S3 requis pour stocker l’audio ONCE");

  const release = await fetchOnceRelease(token.trim(), releaseId.trim());
  const title =
    release?.release?.title || release?.title || release?.tracks?.[0]?.title || "track";
  const audioPath = extractOnceAudioPath(release);

  let buffer = audioBuffer || null;
  let mime = mimeType;
  let via = "upload";

  if (!buffer) {
    if (!audioPath) throw new Error("Pas d’audio_file_url sur cette release ONCE");
    const dl = await tryDownloadOnceFile(token.trim(), audioPath);
    if (!dl) {
      const err = new Error(
        "ONCE refuse le téléchargement via API (401). Ouvre la release dans le navigateur, télécharge le WAV, puis réimporte-le dans SONOZZ.",
      );
      err.code = "ONCE_FILE_AUTH";
      err.releaseId = releaseId;
      err.audioPath = audioPath;
      err.dashboardUrl = `https://beta.once.app/releases/${releaseId}`;
      throw err;
    }
    buffer = dl.buffer;
    mime = dl.mimeType;
    via = "once-api";
  }

  if (!buffer?.length || buffer.length < 50_000) {
    throw new Error("Fichier audio trop petit / invalide");
  }
  const head = buffer.subarray(0, 20).toString("utf8").toLowerCase();
  if (head.includes("<html") || head.includes("<!doctype")) {
    throw new Error("Le fichier reçu est du HTML (login), pas de l’audio");
  }

  mime = sniffMime(buffer, mimeFromFileName(fileName, mime));
  const ext = extFromMime(mime);
  const key = `audio/${String(projectId || "anon").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60)}/once-${releaseId.slice(0, 8)}.${ext}`;
  const uploaded = await uploadClipBuffer(buffer, {
    projectId,
    mimeType: mime,
    key,
  });

  return {
    ok: true,
    title,
    releaseId,
    audioPath,
    audioUrl: uploaded.url,
    s3Key: uploaded.key,
    mimeType: uploaded.mimeType,
    byteLength: uploaded.byteLength,
    via,
    durationSec: release?.tracks?.[0]?.duration || null,
    dashboardUrl: `https://beta.once.app/releases/${releaseId}`,
    audioSha256: release?.tracks?.[0]?.audio_sha256 || null,
  };
}
