import {
  replicateJson,
  errorText,
  isThrottle,
  billingHint,
  extractOutputUrl,
  waitPrediction,
} from "./client.js";

/** MiniMax attend des tags EN : [Verse], [Chorus], [Bridge]… */
function normalizeLyrics(lyricsText = "") {
  return String(lyricsText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\[Couplet(?:\s*\d+)?\]/gi, "[Verse]")
    .replace(/\[Refrain\]/gi, "[Chorus]")
    .replace(/\[Pré[- ]?refrain\]/gi, "[Pre Chorus]")
    .replace(/\[Pont\]/gi, "[Bridge]")
    .replace(/\[Outro\]/gi, "[Outro]")
    .replace(/\[Intro\]/gi, "[Intro]")
    .trim()
    .slice(0, 3500);
}

/**
 * Paroles courtes pour un brouillon MiniMax (1er Verse + 1er Chorus).
 * Pas de durée API — gain partiel vs paroles complètes.
 */
export function truncateLyricsForPreview(lyricsText = "") {
  const text = normalizeLyrics(lyricsText);
  if (!text) return "";

  const tagRe = /\[([^\]]+)\]/g;
  const tags = [...text.matchAll(tagRe)];
  if (!tags.length) {
    return text.slice(0, 500);
  }

  let verse = "";
  let chorus = "";
  for (let i = 0; i < tags.length; i++) {
    const raw = String(tags[i][1] || "").trim().toLowerCase();
    const start = tags[i].index + tags[i][0].length;
    const end = i + 1 < tags.length ? tags[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    if (/^verse|couplet/.test(raw) && !verse) {
      verse = `[Verse]\n${body.slice(0, 400)}`;
    } else if (/^chorus|refrain/.test(raw) && !chorus) {
      chorus = `[Chorus]\n${body.slice(0, 280)}`;
    }
    if (verse && chorus) break;
  }

  const out = [verse, chorus].filter(Boolean).join("\n\n").trim();
  return out || text.slice(0, 500);
}

function minimaxMusicInput({ prompt, lyrics, preview = false }) {
  const lyricsText = preview
    ? truncateLyricsForPreview(lyrics)
    : normalizeLyrics(lyrics);
  const stylePrompt = String(prompt || "modern french pop, emotional vocals").slice(0, 2000);
  return lyricsText
    ? {
        prompt: stylePrompt,
        lyrics: lyricsText,
        is_instrumental: false,
        lyrics_optimizer: false,
      }
    : {
        prompt: stylePrompt,
        is_instrumental: false,
        lyrics_optimizer: true,
      };
}

/** Crée la prediction MiniMax sans attendre (évite timeout proxy). */
export async function startMinimaxMusic(token, { prompt, lyrics, preview = false } = {}) {
  const input = minimaxMusicInput({ prompt, lyrics, preview });

  let { res, data } = await replicateJson(token, "/models/minimax/music-2.6/predictions", {
    method: "POST",
    wait: false,
    body: JSON.stringify({ input }),
  });

  if (isThrottle(res, data)) {
    const waitSec = parseRetrySeconds(errorText(data, res.status));
    await new Promise((r) => setTimeout(r, waitSec * 1000));
    ({ res, data } = await replicateJson(token, "/models/minimax/music-2.6/predictions", {
      method: "POST",
      wait: false,
      body: JSON.stringify({ input }),
    }));
  }

  if (isThrottle(res, data)) {
    throw new Error(billingHint(errorText(data, res.status)));
  }
  if (!res.ok && !data?.id) {
    console.error("[replicate] MiniMax create failed", res.status, data);
    throw new Error(billingHint(errorText(data, res.status)));
  }

  console.info("[replicate] MiniMax start", data.id, data.status);
  return {
    generationId: data.id,
    provider: "minimax-music-2.6",
    status: data.status || "starting",
  };
}

function parseRetrySeconds(message) {
  const m = String(message).match(/resets? in ~?(\d+)\s*s/i);
  return m ? Number(m[1]) + 1 : 12;
}

/** Un tick de poll prediction MiniMax. */
export async function pollMinimaxMusic(token, generationId) {
  const id = String(generationId || "").trim();
  if (!id) throw new Error("predictionId MiniMax manquant");

  const { res, data } = await replicateJson(token, `/predictions/${id}`);
  if (!res.ok) throw new Error(billingHint(errorText(data, res.status)));

  if (data.status === "succeeded") {
    const url = extractOutputUrl(data.output);
    if (!url) throw new Error("Replicate a réussi mais sans URL de fichier");
    return {
      done: true,
      status: "succeeded",
      url: String(url),
      provider: "minimax-music-2.6",
      durationLabel: "~2–4 min",
      hasVocals: true,
      generationId: id,
    };
  }
  if (data.status === "failed" || data.status === "canceled") {
    throw new Error(data.error || "Génération audio échouée");
  }
  return { done: false, status: data.status || "processing", generationId: id };
}

/** Annule une prediction Replicate en cours (best-effort). */
export async function cancelMinimaxMusic(token, generationId) {
  const id = String(generationId || "").trim();
  if (!id) return { ok: false, skipped: true };
  const { res, data } = await replicateJson(token, `/predictions/${id}/cancel`, {
    method: "POST",
  });
  return { ok: res.ok || res.status === 404, status: data?.status || null };
}

/**
 * MiniMax Music 2.6 — chanson complète avec voix + paroles (2–4 min typique).
 */
async function generateWithMinimax(token, { prompt, lyrics }) {
  const started = await startMinimaxMusic(token, { prompt, lyrics });
  const url = await waitPrediction(token, { id: started.generationId, status: started.status }, {
    maxPolls: 180,
  });
  return { url, provider: "minimax-music-2.6", durationLabel: "~2–4 min", hasVocals: true };
}

/**
 * MiniMax Music 2.6 uniquement (voix + paroles).
 * Pas de fallback MusicGen silencieux — sinon on retombe sur de l'instrumental 20–30s.
 */
export async function generateMusicWithReplicate(token, { prompt, lyrics } = {}) {
  console.info("[replicate] MiniMax music-2.6…");
  try {
    const result = await generateWithMinimax(token, { prompt, lyrics });
    console.info("[replicate] MiniMax OK", result.provider);
    return result;
  } catch (miniErr) {
    console.error("[replicate] MiniMax échec:", miniErr.message);
    throw new Error(
      `MiniMax Music 2.6: ${miniErr.message} (pas de fallback MusicGen — ce modèle est instrumental court).`,
    );
  }
}
