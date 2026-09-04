import { parseLlmJson } from "../parseLlmJson.js";

export const MAX_AUDIO_BYTES = 12_000_000;

/**
 * Télécharge le morceau (ou utilise un extrait client) pour analyse Gemini.
 * Veo n’accepte PAS d’audio en entrée — on écoute via Gemini, puis on pilote le prompt Veo.
 */
export async function resolveTrackAudioBytes({ audioUrl, audioExcerptBase64, mimeType } = {}) {
  if (audioExcerptBase64) {
    const raw = String(audioExcerptBase64).replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(raw, "base64");
    if (!buf.length) throw new Error("Extrait audio vide");
    if (buf.length > MAX_AUDIO_BYTES) throw new Error("Extrait audio trop lourd");
    return {
      mimeType: mimeType || "audio/wav",
      data: buf.toString("base64"),
      bytes: buf.length,
      source: "excerpt",
    };
  }

  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    throw new Error("URL audio du morceau manquante");
  }

  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Téléchargement audio HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("Fichier audio vide");
  if (buf.length > MAX_AUDIO_BYTES) {
    throw new Error("Fichier audio trop lourd pour analyse (max ~12 Mo) — importe un extrait plus court.");
  }
  const ct = (res.headers.get("content-type") || "audio/mpeg").split(";")[0].trim();
  return {
    mimeType: /audio\//i.test(ct) ? ct : mimeType || "audio/mpeg",
    data: buf.toString("base64"),
    bytes: buf.length,
    source: "url",
  };
}

export function parseJsonLoose(text) {
  return parseLlmJson(text);
}
