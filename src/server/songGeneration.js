/**
 * Client SongGeneration Studio (Pinokio / Demeter).
 * API : POST /api/generate → poll /api/generation/:id → GET /api/audio/:id/0
 * @see https://github.com/BazedFrog/SongGeneration-Studio
 */

const DEFAULT_BASE = "http://127.0.0.1:7860";
const POLL_MS = 3000;
const MAX_POLLS = 200; // ~10 min

export function resolveSongGenBaseUrl(keys) {
  const raw = keys?.songGenBaseUrl?.trim() || DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

function errText(err) {
  return String(err?.message || err || "");
}

async function songGenFetch(baseUrl, path, { method = "GET", body } = {}) {
  const url = `${baseUrl}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `SongGeneration Studio injoignable (${baseUrl}). Lance l’app dans Pinokio (Start) et vérifie l’URL. ${errText(e).slice(0, 120)}`,
    );
  }
  const ct = res.headers.get("content-type") || "";
  const data = /json/i.test(ct) ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail.map((d) => d.msg || d).join("; ")
          : data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`SongGen ${path}: ${detail}`);
  }
  return data;
}

/** MiniMax-style [Verse] / [Chorus] → sections SongGeneration Studio. */
export function lyricsToSections(lyricsText = "") {
  const text = String(lyricsText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\[Couplet(?:\s*\d+)?\]/gi, "[Verse]")
    .replace(/\[Refrain\]/gi, "[Chorus]")
    .replace(/\[Pré[- ]?refrain\]/gi, "[prechorus]")
    .replace(/\[Pont\]/gi, "[Bridge]")
    .trim();

  if (!text) {
    return [
      { type: "intro", lyrics: null },
      { type: "verse", lyrics: "la la la" },
      { type: "chorus", lyrics: "oh oh oh" },
      { type: "outro", lyrics: null },
    ];
  }

  const tagRe = /\[([^\]]+)\]/g;
  const tags = [...text.matchAll(tagRe)];
  if (!tags.length) {
    return [
      { type: "intro", lyrics: null },
      { type: "verse", lyrics: text.slice(0, 800) },
      { type: "chorus", lyrics: text.slice(0, 400) },
      { type: "outro", lyrics: null },
    ];
  }

  const sections = [];
  for (let i = 0; i < tags.length; i++) {
    const rawType = String(tags[i][1] || "verse").trim().toLowerCase();
    const start = tags[i].index + tags[i][0].length;
    const end = i + 1 < tags.length ? tags[i + 1].index : text.length;
    const body = text.slice(start, end).trim();

    let type = "verse";
    if (/^intro/.test(rawType)) type = "intro";
    else if (/^outro/.test(rawType)) type = "outro";
    else if (/^chorus|refrain/.test(rawType)) type = "chorus";
    else if (/^bridge|pont/.test(rawType)) type = "bridge";
    else if (/^pre\s*chorus|prechorus/.test(rawType)) type = "prechorus";
    else if (/^instrumental|inst|solo/.test(rawType)) type = "instrumental";
    else if (/^verse|couplet/.test(rawType)) type = "verse";

    const vocal = ["verse", "chorus", "bridge", "prechorus"].includes(type);
    sections.push({
      type,
      lyrics: vocal && body ? body : null,
    });
  }

  return sections.length ? sections : [{ type: "verse", lyrics: text.slice(0, 800) }];
}

function mapGender(gender) {
  const g = String(gender || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/^(female|woman|femme|f)$/.test(g)) return "female";
  if (/^(nonbinary|non-binary|nonbinaire|nb|androgyne)$/.test(g)) return "female";
  return "male";
}

function mapGenre(genre = "") {
  const g = String(genre || "").toLowerCase();
  if (/hip[\s-]?hop|rap|trap/.test(g)) return "Hip-Hop";
  if (/r&?b|soul/.test(g)) return "R&B";
  if (/rock|indie rock/.test(g)) return "Rock";
  if (/metal/.test(g)) return "Metal";
  if (/jazz/.test(g)) return "Jazz";
  if (/folk|acoustic/.test(g)) return "Folk";
  if (/electro|edm|dance|house|techno/.test(g)) return "Electronic";
  if (/reggae/.test(g)) return "Reggae";
  if (/pop/.test(g)) return "Pop";
  return String(genre || "Pop").split(/[,/|]/)[0].trim().slice(0, 40) || "Pop";
}

export async function testSongGeneration(keys) {
  const base = resolveSongGenBaseUrl(keys);
  const health = await songGenFetch(base, "/api/health");
  let models;
  try {
    models = await songGenFetch(base, "/api/models");
  } catch {
    models = null;
  }
  const ready = Boolean(models?.has_ready_model);
  if (models && !ready) {
    throw new Error(
      `Studio OK (${base}) mais aucun modèle prêt — laisse Pinokio finir le download (~15 Go).`,
    );
  }
  return {
    base,
    health,
    defaultModel: models?.default || null,
    hasReadyModel: ready || models == null,
  };
}

/**
 * Lance une génération SongGen (réponse rapide — le client poll ensuite).
 * @returns {Promise<{ generationId: string, provider: string, base: string }>}
 */
export async function startSongGeneration(
  keys,
  { prompt, lyrics, title, gender, genre, mood, bpm } = {},
) {
  const base = resolveSongGenBaseUrl(keys);
  const sections = lyricsToSections(lyrics);
  const body = {
    title: String(title || "SONOZZ Track").slice(0, 120),
    sections,
    gender: mapGender(gender),
    timbre: "",
    genre: mapGenre(genre),
    emotion: String(mood || "").slice(0, 80),
    instruments: "",
    custom_style: String(prompt || "").slice(0, 500) || null,
    bpm: Math.min(200, Math.max(60, Number(bpm) || 110)),
    output_mode: "mixed",
    memory_mode: "auto",
  };

  console.info("[songgen] start…", base, body.title, sections.length, "sections");
  const created = await songGenFetch(base, "/api/generate", { method: "POST", body });
  const genId = created?.generation_id;
  if (!genId) throw new Error("SongGen n’a pas renvoyé de generation_id");
  return { generationId: genId, provider: "songgeneration-studio", base };
}

/**
 * Un tick de poll SongGen (requête courte — évite timeout proxy Cloudflare 524).
 * @returns {Promise<{ done: boolean, status: string, url?: string, durationLabel?: string, hasVocals?: boolean, generationId?: string, progress?: unknown, message?: string }>}
 */
export async function pollSongGeneration(keys, generationId) {
  const base = resolveSongGenBaseUrl(keys);
  const genId = String(generationId || "").trim();
  if (!genId) throw new Error("generationId SongGen manquant");

  const status = await songGenFetch(base, `/api/generation/${genId}`);
  const st = String(status?.status || "");
  if (st === "completed") {
    const url = `${base}/api/audio/${genId}/0`;
    const secs = Number(status?.duration);
    const durationLabel =
      Number.isFinite(secs) && secs > 0
        ? `~${Math.round(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`
        : "~2–4 min";
    console.info("[songgen] OK", genId, url);
    return {
      done: true,
      status: st,
      url,
      provider: "songgeneration-studio",
      durationLabel,
      hasVocals: true,
      generationId: genId,
    };
  }
  if (st === "failed" || st === "stopped") {
    throw new Error(status?.message || `Génération SongGen ${st}`);
  }
  return {
    done: false,
    status: st || "processing",
    progress: status?.progress,
    message: status?.message || "",
    generationId: genId,
  };
}

/**
 * Sync (pipeline A→Z) — préfère start+poll côté client pour /api/track.
 * @returns {Promise<{ url: string, provider: string, durationLabel: string, hasVocals: boolean, generationId: string }>}
 */
export async function generateMusicWithSongGeneration(
  keys,
  { prompt, lyrics, title, gender, genre, mood, bpm } = {},
) {
  const started = await startSongGeneration(keys, {
    prompt,
    lyrics,
    title,
    gender,
    genre,
    mood,
    bpm,
  });

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const tick = await pollSongGeneration(keys, started.generationId);
    if (tick.done) {
      return {
        url: tick.url,
        provider: tick.provider,
        durationLabel: tick.durationLabel || "~2–4 min",
        hasVocals: Boolean(tick.hasVocals),
        generationId: started.generationId,
      };
    }
    if (i % 10 === 0) {
      console.info(
        "[songgen] poll",
        started.generationId,
        tick.status,
        tick.progress ?? "?",
        tick.message || "",
      );
    }
  }

  throw new Error("Timeout SongGeneration Studio (~10 min) — vérifie GPU / Pinokio sur Demeter.");
}

export function isSongGenMusicProvider(keys) {
  return String(keys?.musicProvider || "").trim() === "songgen";
}
