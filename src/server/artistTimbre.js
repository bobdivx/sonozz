import { listenVoiceTimbreFromBytes, listenTrackLeadVocalTimbreFromBytes, resolveTrackAudioBytes } from "./musicListen.js";
import { isS3Configured, downloadClipBuffer } from "./s3.js";
import { getArtistBySlug, upsertArtistFromProject, listArtists, getArtistHub } from "./artists.js";
import { getDb } from "./db.js";
import { normalizeFeatArtist } from "../lib/featArtist.js";

/**
 * Timbre figé sur le profil artiste — source de vérité pour ACE / SongGen / duo.
 */

export function artistLockedTimbre(artist) {
  if (!artist || typeof artist !== "object") return "";
  const sample = artist.voiceSample || {};
  return String(
    sample.songGenTimbre ||
      sample.analyzedTimbre ||
      sample.timbreHint ||
      artist.styleLock?.timbre ||
      "",
  )
    .trim()
    .slice(0, 80);
}

export function artistHasLockedTimbre(artist) {
  return Boolean(artistLockedTimbre(artist));
}

/**
 * Invente un timbre stable depuis le profil IA (genre, voice, styleLock) —
 * sans extrait audio utilisateur. Sert de fingerprint pour tous les futurs titres.
 */
export function synthesizeArtistTimbreDna(artist) {
  if (!artist || typeof artist !== "object") return null;

  const gender = String(artist.gender || artist.visualIdentity?.gender || "")
    .toLowerCase()
    .trim();
  const registerFromGender =
    gender === "female"
      ? "mezzo"
      : gender === "male"
        ? "baritone"
        : gender === "nonbinary"
          ? "mixed"
          : "unknown";

  const lock = artist.styleLock || {};
  const existing =
    String(
      artist.voiceSample?.songGenTimbre ||
        artist.voiceSample?.analyzedTimbre ||
        lock.timbre ||
        "",
    ).trim();

  const voiceBlob = [
    artist.voice,
    lock.vocalStyle,
    lock.vocalRegister,
    lock.mood,
    artist.mood,
    Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords.slice(0, 4).join(" ") : "",
    artist.genre,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const qualities = [];
  if (/warm|chaleur|douce|soft|velours|velvet/i.test(voiceBlob)) qualities.push("warm");
  if (/bright|claire|aérien|airy|crystal|bright/i.test(voiceBlob)) qualities.push("bright");
  if (/raspy|rauque|gravel|gritty|rough/i.test(voiceBlob)) qualities.push("raspy");
  if (/breathy|souffl|whisper|intimate/i.test(voiceBlob)) qualities.push("breathy");
  if (/powerful|puissant|belt|belting|fierce/i.test(voiceBlob)) qualities.push("powerful");
  if (/dark|sombre|deep|grave/i.test(voiceBlob)) qualities.push("dark");
  if (/nasal|twang/i.test(voiceBlob)) qualities.push("nasal");
  if (/smooth|lisse|silky|soul/i.test(voiceBlob)) qualities.push("smooth");
  if (!qualities.length) {
    qualities.push(gender === "female" ? "bright" : gender === "male" ? "warm" : "clear");
  }

  let register = String(lock.vocalRegister || "").trim().toLowerCase() || registerFromGender;
  if (!/tenor|baritone|bass|alto|soprano|mezzo|spoken|mixed/i.test(register)) {
    if (/tenor|aigu male/i.test(voiceBlob)) register = "tenor";
    else if (/bass|basse/i.test(voiceBlob)) register = "bass";
    else if (/soprano/i.test(voiceBlob)) register = "soprano";
    else if (/alto/i.test(voiceBlob)) register = "alto";
    else if (/mezzo/i.test(voiceBlob)) register = "mezzo";
    else register = registerFromGender;
  }

  const delivery = [];
  if (/rap|spoken|parlé/i.test(voiceBlob)) delivery.push("spoken-sung");
  if (/melodic|mélod|singing|chant/i.test(voiceBlob)) delivery.push("melodic");
  if (/soul|r&b|rnb/i.test(voiceBlob)) delivery.push("soulful");
  if (/trap|auto-?tune|pitched/i.test(voiceBlob)) delivery.push("modern");

  // Si styleLock.timbre existe déjà en anglais court, on le normalise.
  let songGenTimbre = existing
    .replace(/[^a-zA-Z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  if (!songGenTimbre || songGenTimbre.split(/\s+/).length < 2) {
    songGenTimbre = [...qualities.slice(0, 2), register, ...delivery.slice(0, 1)]
      .filter(Boolean)
      .join(" ")
      .slice(0, 80);
  }

  const vocalStyle =
    String(lock.vocalStyle || artist.voice || "")
      .trim()
      .slice(0, 120) || `${qualities[0]} ${register} vocals`;

  return {
    timbre: songGenTimbre,
    songGenTimbre,
    vocalStyle,
    vocalRegister: register,
    genderFeel:
      gender === "female" || gender === "male" || gender === "ambiguous"
        ? gender
        : gender === "nonbinary"
          ? "ambiguous"
          : registerFromGender === "mezzo"
            ? "female"
            : registerFromGender === "baritone"
              ? "male"
              : "ambiguous",
  };
}

/** Fige un timbre synthétisé sur le profil (sans audio). */
export function lockSynthesizedTimbre(artist) {
  if (!artist || typeof artist !== "object") return artist;
  if (artistHasLockedTimbre(artist)) return artist;
  const dna = synthesizeArtistTimbreDna(artist);
  if (!dna) return artist;
  return applyTimbreDnaToArtist(artist, dna, { source: "profile-synth" });
}

async function loadAudioBytesFromVoiceSample(voiceSample) {
  if (!voiceSample || typeof voiceSample !== "object") return null;
  if (voiceSample.s3Key && isS3Configured()) {
    try {
      const dl = await downloadClipBuffer(voiceSample.s3Key);
      return {
        buffer: dl.buffer,
        mimeType: dl.mimeType || voiceSample.mimeType || "audio/wav",
        source: "voice-sample-s3",
      };
    } catch (e) {
      console.warn("[timbre] S3 voice sample:", e.message);
    }
  }
  const url = String(voiceSample.url || "").trim();
  if (/^https?:\/\//i.test(url)) {
    const audio = await resolveTrackAudioBytes({
      audioUrl: url,
      mimeType: voiceSample.mimeType,
    });
    return {
      buffer: Buffer.from(audio.data, "base64"),
      mimeType: audio.mimeType,
      source: "voice-sample-url",
    };
  }
  if (typeof voiceSample.dataUrl === "string" && voiceSample.dataUrl.startsWith("data:")) {
    const raw = voiceSample.dataUrl.replace(/^data:[^;]+;base64,/, "");
    return {
      buffer: Buffer.from(raw, "base64"),
      mimeType: voiceSample.mimeType || "audio/wav",
      source: "voice-sample-data",
    };
  }
  return null;
}

/**
 * Applique le résultat Gemini sur voiceSample + styleLock.timbre + voice.
 */
export function applyTimbreDnaToArtist(artist, dna, { source = "analyze" } = {}) {
  if (!artist || typeof artist !== "object" || !dna) return artist;
  const songGenTimbre = String(dna.songGenTimbre || dna.timbre || "")
    .trim()
    .slice(0, 80);
  const analyzedTimbre = String(dna.timbre || songGenTimbre)
    .trim()
    .slice(0, 120);
  if (!songGenTimbre && !analyzedTimbre) return artist;

  const prevSample =
    artist.voiceSample && typeof artist.voiceSample === "object" ? { ...artist.voiceSample } : {};
  const voiceSample = {
    ...prevSample,
    guideMode: prevSample.guideMode === "reference" ? "reference" : "timbre",
    songGenTimbre: songGenTimbre || prevSample.songGenTimbre,
    analyzedTimbre: analyzedTimbre || prevSample.analyzedTimbre,
    vocalRegister: dna.vocalRegister || prevSample.vocalRegister,
    genderFeel: dna.genderFeel || prevSample.genderFeel,
    timbreSource: source,
    timbreAnalyzedAt: new Date().toISOString(),
  };

  const styleLock =
    artist.styleLock && typeof artist.styleLock === "object" ? { ...artist.styleLock } : {};
  if (!styleLock.timbre && (analyzedTimbre || songGenTimbre)) {
    styleLock.timbre = analyzedTimbre || songGenTimbre;
  }
  if (!styleLock.vocalStyle && dna.vocalStyle) {
    styleLock.vocalStyle = String(dna.vocalStyle).slice(0, 120);
  }
  if (!styleLock.vocalRegister && dna.vocalRegister) {
    styleLock.vocalRegister = String(dna.vocalRegister).slice(0, 40);
  }

  const voice =
    String(artist.voice || "").trim() ||
    String(dna.vocalStyle || analyzedTimbre || songGenTimbre).slice(0, 160) ||
    artist.voice;

  return {
    ...artist,
    voice,
    voiceSample,
    styleLock: Object.keys(styleLock).length ? styleLock : artist.styleLock,
  };
}

/**
 * Analyse / backfill le timbre d’un artiste.
 * Priorité : voiceSample audio → audioUrl fourni → premier morceau projet (si slug).
 */
export async function ensureArtistTimbre(keys, artist, opts = {}) {
  const force = Boolean(opts.force);
  if (!artist || typeof artist !== "object") {
    return { artist, ok: false, skipped: true, reason: "no-artist" };
  }
  if (!force && artistHasLockedTimbre(artist)) {
    return {
      artist,
      ok: true,
      skipped: true,
      reason: "already-locked",
      timbre: artistLockedTimbre(artist),
    };
  }

  // Sans forcer l’utilisateur à uploader sa voix : inventer un timbre depuis le profil IA.
  if (!force && !artist.voiceSample?.url && !artist.voiceSample?.s3Key && !opts.audioUrl) {
    const synth = lockSynthesizedTimbre(artist);
    if (artistHasLockedTimbre(synth)) {
      return {
        artist: synth,
        ok: true,
        skipped: false,
        reason: "profile-synth",
        timbre: artistLockedTimbre(synth),
      };
    }
  }

  const geminiKey = String(keys?.geminiApiKey || "").trim();
  // Pas de Gemini / pas d’audio → synthèse profil (toujours mieux que rien)
  if (!geminiKey && !opts.audioUrl && !(artist.voiceSample?.url || artist.voiceSample?.s3Key)) {
    const synth = lockSynthesizedTimbre(artist);
    return {
      artist: synth,
      ok: artistHasLockedTimbre(synth),
      skipped: false,
      reason: artistHasLockedTimbre(synth) ? "profile-synth" : "no-gemini",
      timbre: artistLockedTimbre(synth) || null,
    };
  }

  if (!geminiKey) {
    const synth = lockSynthesizedTimbre(artist);
    return {
      artist: synth,
      ok: artistHasLockedTimbre(synth),
      skipped: !artistHasLockedTimbre(synth),
      reason: artistHasLockedTimbre(synth) ? "profile-synth" : "no-gemini",
      timbre: artistLockedTimbre(synth) || null,
    };
  }

  let loaded = null;
  let source = "none";

  // 1) Extrait vocal perso (optionnel)
  try {
    loaded = await loadAudioBytesFromVoiceSample(artist.voiceSample);
    if (loaded) source = loaded.source || "voice-sample";
  } catch (e) {
    console.warn("[timbre] load voice sample:", e.message);
  }

  // 2) Audio explicite (dernier morceau)
  if (!loaded && opts.audioUrl) {
    try {
      const audio = await resolveTrackAudioBytes({
        audioUrl: opts.audioUrl,
        audioExcerptBase64: opts.audioExcerptBase64,
        mimeType: opts.mimeType,
      });
      loaded = {
        buffer: Buffer.from(audio.data, "base64"),
        mimeType: audio.mimeType,
      };
      source = "track-audio";
    } catch (e) {
      console.warn("[timbre] load track audio:", e.message);
    }
  }

  // 3) Cherche un audio dans le hub / projets si slug
  if (!loaded && (opts.slug || artist.slug)) {
    const slug = String(opts.slug || artist.slug || "").trim();
    try {
      const hubAudio = await findLatestArtistAudioUrl(slug);
      if (hubAudio) {
        const audio = await resolveTrackAudioBytes({ audioUrl: hubAudio });
        loaded = {
          buffer: Buffer.from(audio.data, "base64"),
          mimeType: audio.mimeType,
        };
        source = "hub-track";
      }
    } catch (e) {
      console.warn("[timbre] hub audio:", e.message);
    }
  }

  if (!loaded?.buffer?.length) {
    const synth = lockSynthesizedTimbre(artist);
    return {
      artist: synth,
      ok: artistHasLockedTimbre(synth),
      skipped: false,
      reason: artistHasLockedTimbre(synth) ? "profile-synth" : "no-audio",
      timbre: artistLockedTimbre(synth) || null,
    };
  }

  const name = artist.name || artist.aka || "?";
  let dna = null;
  try {
    if (source === "voice-sample" || source.startsWith("voice-sample")) {
      dna = await listenVoiceTimbreFromBytes(geminiKey, {
        buffer: loaded.buffer,
        mimeType: loaded.mimeType,
        artistName: name,
      });
    } else {
      dna = await listenTrackLeadVocalTimbreFromBytes(geminiKey, {
        buffer: loaded.buffer,
        mimeType: loaded.mimeType,
        artistName: name,
      });
    }
  } catch (e) {
    console.warn("[timbre] analyse:", e.message);
    return { artist, ok: false, skipped: false, reason: e.message };
  }

  if (!dna?.songGenTimbre && !dna?.timbre) {
    return { artist, ok: false, skipped: false, reason: "empty-dna" };
  }

  const next = applyTimbreDnaToArtist(artist, dna, { source });
  return {
    artist: next,
    ok: true,
    skipped: false,
    reason: source,
    timbre: artistLockedTimbre(next),
    dna,
  };
}

async function findLatestArtistAudioUrl(slug) {
  if (!slug) return null;
  try {
    const hub = await getArtistHub(slug);
    const releases = Array.isArray(hub?.releases) ? hub.releases : [];
    for (const r of releases) {
      const url = r?.audioUrl || r?.track?.audioUrl;
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  } catch {
    /* hub optional */
  }

  const db = getDb();
  const projects = await db.execute({
    sql: `
      SELECT project_json FROM projects
      WHERE artist_slug = ?
      ORDER BY updated_at DESC
      LIMIT 12
    `,
    args: [slug],
  });
  for (const row of projects.rows || []) {
    try {
      const project = JSON.parse(row.project_json);
      const track = project?.track;
      const url = track?.audioUrl;
      if (url && /^https?:\/\//i.test(url) && !track?.isPreview) return url;
      if (url && /^https?:\/\//i.test(url)) return url;
      const versions = project?.trackVersions || [];
      for (let i = versions.length - 1; i >= 0; i--) {
        const vUrl = versions[i]?.audioUrl;
        if (vUrl && /^https?:\/\//i.test(vUrl)) return vUrl;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Assure le timbre lead (+ feat) avant une génération.
 * Persiste sur le hub si slug connu.
 */
export async function ensureTrackArtistsTimbre(keys, artist, opts = {}) {
  let next = artist && typeof artist === "object" ? { ...artist } : artist;
  const report = { lead: null, feat: null };

  if (next) {
    const leadRes = await ensureArtistTimbre(keys, next, {
      audioUrl: opts.audioUrl,
      force: opts.force,
      slug: next.slug,
    });
    report.lead = {
      ok: leadRes.ok,
      skipped: leadRes.skipped,
      reason: leadRes.reason,
      timbre: leadRes.timbre || null,
    };
    if (leadRes.ok && leadRes.artist) {
      next = leadRes.artist;
      if (next.slug && !leadRes.skipped) {
        try {
          await upsertArtistFromProject(next, { preferredSlug: next.slug });
        } catch (e) {
          console.warn("[timbre] persist lead:", e.message);
        }
      }
    }
  }

  const feat = normalizeFeatArtist(next?.featArtist);
  if (feat?.name) {
    const featRes = await ensureArtistTimbre(keys, feat, {
      force: opts.force,
      slug: feat.slug,
    });
    report.feat = {
      ok: featRes.ok,
      skipped: featRes.skipped,
      reason: featRes.reason,
      timbre: featRes.timbre || null,
    };
    if (featRes.ok && featRes.artist) {
      next = { ...next, featArtist: featRes.artist };
      if (featRes.artist.slug && !featRes.skipped) {
        try {
          await upsertArtistFromProject(featRes.artist, {
            preferredSlug: featRes.artist.slug,
          });
        } catch (e) {
          console.warn("[timbre] persist feat:", e.message);
        }
      }
    }
  }

  return { artist: next, report };
}

/**
 * Après un morceau généré : fige le timbre si encore absent.
 */
export async function lockTimbreFromGeneratedTrack(keys, artist, audioUrl) {
  if (!artist || !audioUrl || artistHasLockedTimbre(artist)) {
    return { artist, ok: false, skipped: true };
  }
  const res = await ensureArtistTimbre(keys, artist, { audioUrl, force: false });
  if (res.ok && res.artist?.slug && !res.skipped) {
    try {
      await upsertArtistFromProject(res.artist, { preferredSlug: res.artist.slug });
    } catch (e) {
      console.warn("[timbre] persist after track:", e.message);
    }
  }
  return res;
}

/**
 * Backfill timbre pour tous les artistes du hub (voice sample ou dernier audio).
 */
export async function backfillAllArtistTimbres(keys, { limit = 80 } = {}) {
  const artists = await listArtists(Math.min(200, Math.max(1, Number(limit) || 80)));

  const report = {
    scanned: 0,
    locked: 0,
    analyzed: 0,
    failed: 0,
    skippedNoAudio: 0,
    skippedNoGemini: 0,
    details: [],
  };

  for (const row of artists || []) {
    report.scanned += 1;
    const slug = row.slug || row.profile?.slug;
    const stored = slug ? await getArtistBySlug(slug) : null;
    const profile = stored?.profile || row.profile || { name: row.name, slug };
    if (!slug) continue;
    if (artistHasLockedTimbre(profile)) {
      report.locked += 1;
      continue;
    }
    const res = await ensureArtistTimbre(keys, { ...profile, slug }, {
      slug,
      force: true,
    });
    if (res.reason === "no-gemini") {
      report.skippedNoGemini += 1;
      break;
    }
    if (res.reason === "no-audio") {
      report.skippedNoAudio += 1;
      report.details.push({ slug, status: "no-audio" });
      continue;
    }
    if (res.ok && res.artist) {
      await upsertArtistFromProject(
        { ...res.artist, slug, name: res.artist.name || row.name },
        { preferredSlug: slug },
      );
      report.analyzed += 1;
      report.details.push({ slug, status: "ok", timbre: res.timbre, via: res.reason });
    } else {
      report.failed += 1;
      report.details.push({ slug, status: "fail", reason: res.reason });
    }
  }

  return report;
}
