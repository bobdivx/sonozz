import { getArtistBySlug, upsertArtistFromProject, listArtists } from "../artists.js";
import { normalizeFeatArtist } from "../../lib/featArtist.js";
import {
  artistHasLockedTimbre,
  artistLockedTimbre,
  lockSynthesizedTimbre,
  applyTimbreDnaToArtist,
} from "./core.js";
import {
  loadAudioBytesFromVoiceSample,
  findLatestArtistAudioUrl,
  listenVoiceTimbreFromBytes,
  listenTrackLeadVocalTimbreFromBytes,
  resolveTrackAudioBytes,
} from "./audio.js";

/**
 * Analyse / backfill le timbre d'un artiste.
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

  // Sans forcer l'utilisateur à uploader sa voix : inventer un timbre depuis le profil IA.
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
  // Pas de Gemini / pas d'audio → synthèse profil (toujours mieux que rien)
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
