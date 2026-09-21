import { getDb, saveProject } from "../db.js";
import { resolveArtistGender, withResolvedArtistGender } from "../../lib/artistGender.js";
import { artistPhotoPath } from "../../lib/artistPhotos.js";
import { ensureArtistSchema, lightAssetUrl } from "./schema.js";
import { getArtistBySlug, upsertArtistFromProject } from "./crud.js";
import {
  resolveArtistProfileForRelease,
  recoverArtistGenderFromProjects,
} from "./profile.js";
import { tryParseS3ObjectKey } from "../s3.js";

export async function listArtistReleases(slug, limit = 40, opts = {}) {
  await ensureArtistSchema();
  const db = getDb();

  const name =
    opts.artistName ||
    (await getArtistBySlug(slug))?.name ||
    slug;

  // Ne jamais SELECT project_json entier (peut peser des dizaines de Mo : clip base64).
  // Colonnes dénormalisées pour audio/cover ; json_extract seulement pour le reste.
  const res = await db.execute({
    sql: `
      SELECT
        id,
        title,
        artist_name,
        track_title,
        status,
        artist_slug,
        created_at,
        updated_at,
        audio_url,
        track_status,
        cover_url,
        json_extract(project_json, '$.track.title') AS track_title_json,
        json_extract(project_json, '$.lyrics.title') AS lyrics_title,
        json_extract(project_json, '$.lyrics.theme') AS lyrics_theme,
        json_extract(project_json, '$.album.cover.imageUrl') AS album_cover_url,
        json_extract(project_json, '$.artist.imageUrl') AS artist_image,
        json_extract(project_json, '$.distrokid.status') AS once_status,
        json_extract(project_json, '$.distrokid.provider') AS once_provider,
        json_extract(project_json, '$.distrokid.releaseId') AS release_id,
        json_extract(project_json, '$.album.status') AS album_status,
        json_extract(project_json, '$.album.title') AS album_title,
        json_extract(project_json, '$.album.id') AS album_id,
        json_extract(project_json, '$.album.targetCount') AS album_target,
        json_extract(project_json, '$.albumMeta.leadProjectId') AS album_lead_id,
        json_extract(project_json, '$.albumMeta.albumTitle') AS album_meta_title,
        json_extract(project_json, '$.albumMeta.index') AS album_index
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [slug, name, limit],
  });

  return res.rows.map((row) => {
    const pendingReview =
      String(row.track_status || "") === "pending-review" ||
      String(row.track_status || "") === "preview-ready";
    const audioUrl = pendingReview ? null : lightAssetUrl(row.audio_url);
    const photo = artistPhotoPath(row.artist_slug || slug);
    const artistImage = lightAssetUrl(row.artist_image) || photo;
    const coverUrl =
      lightAssetUrl(row.cover_url) || lightAssetUrl(row.album_cover_url) || artistImage;
    const onceStatus = row.once_status || null;
    const hasLyrics = Boolean(row.lyrics_title || row.lyrics_theme);
    return {
      id: row.id,
      title: row.title,
      artistName: row.artist_name,
      trackTitle:
        row.track_title || row.track_title_json || row.lyrics_title || null,
      status: row.status,
      slug: row.artist_slug || slug,
      hasAudio: Boolean(audioUrl),
      hasLyrics,
      hasCover: Boolean(row.cover_url || row.album_cover_url),
      albumStatus: row.album_status || null,
      albumTitle: row.album_title || row.album_meta_title || null,
      albumTargetCount: row.album_target ? Number(row.album_target) : null,
      albumId: row.album_id || null,
      albumLeadId: row.album_lead_id || (row.album_status ? row.id : null),
      albumIndex: row.album_index != null ? Number(row.album_index) : row.album_status ? 1 : null,
      distributed: Boolean(
        onceStatus === "submitted" ||
          onceStatus === "live" ||
          row.once_provider === "once",
      ),
      onceStatus,
      releaseId: row.release_id || null,
      coverUrl,
      audioUrl,
      audioS3Key: audioUrl ? tryParseS3ObjectKey(row.audio_url || audioUrl) || undefined : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * Catalogue jouable via colonnes dénormalisées (index has_audio) — pas de scan json_extract.
 * @param {number} limit
 * @param {{ artistSlug?: string }} [opts]
 */
export async function listLibraryTracks(limit = 200, opts = {}) {
  await ensureArtistSchema();
  const db = getDb();
  const artistSlug = String(opts.artistSlug || "").trim();
  const res = await db.execute({
    sql: `
      SELECT
        id,
        title,
        artist_name,
        track_title,
        status,
        artist_slug,
        created_at,
        updated_at,
        audio_url,
        track_status,
        cover_url,
        track_duration
      FROM projects
      WHERE has_audio = 1
        ${artistSlug ? "AND artist_slug = ?" : ""}
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: artistSlug ? [artistSlug, limit] : [limit],
  });

  return res.rows
    .map((row) => {
      if (
        String(row.track_status || "") === "pending-review" ||
        String(row.track_status || "") === "preview-ready"
      )
        return null;
      const audioUrl = lightAssetUrl(row.audio_url);
      if (!audioUrl) return null;
      const photo = artistPhotoPath(row.artist_slug);
      const coverUrl = lightAssetUrl(row.cover_url) || photo;
      const audioS3Key = tryParseS3ObjectKey(row.audio_url || audioUrl);
      return {
        id: row.id,
        title: row.title,
        artistName: row.artist_name || "Artiste inconnu",
        trackTitle: row.track_title || row.title || "Sans titre",
        slug: row.artist_slug || null,
        status: row.status,
        coverUrl,
        artistImage: photo,
        audioUrl,
        audioS3Key: audioS3Key || undefined,
        duration: row.track_duration || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })
    .filter(Boolean);
}

/**
 * Nouveau projet / morceau pour un artiste existant (garde le profil).
 * Réutilise gender, timbre (voice / voiceSample), styleLock, genres du hub + meilleurs projets.
 */
export async function createArtistRelease(slug, { theme = "", variantOf = null, genreOverride = null, referencesOverride = null, referenceTrackOverride = null, featArtist = null } = {}) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");

  const themeHint =
    theme?.trim() ||
    (variantOf ? `Suite / variante de « ${variantOf} »` : "");

  let profile = await resolveArtistProfileForRelease(artist.slug, artist.name);
  if (!profile) throw new Error("Profil artiste introuvable");

  // Appliquer les overrides si fournis
  if (genreOverride) {
    profile = { ...profile, genre: genreOverride };
  }
  if (Array.isArray(referencesOverride) && referencesOverride.length > 0) {
    profile = { ...profile, styleArtists: referencesOverride };
  }
  if (referenceTrackOverride) {
    profile = {
      ...profile,
      styleLock: {
        ...(profile.styleLock || {}),
        topTracks: [referenceTrackOverride, ...(profile.styleLock?.topTracks || []).slice(0, 4)],
      },
    };
  }

  if (!resolveArtistGender(profile)) {
    const recovered = await recoverArtistGenderFromProjects(artist.slug, artist.name);
    if (recovered) {
      profile = withResolvedArtistGender({
        ...profile,
        ...recovered,
        gender: recovered.gender || profile.gender,
        voice: recovered.voice || profile.voice,
        visualIdentity: {
          ...(profile.visualIdentity || {}),
          ...(recovered.visualIdentity || {}),
        },
      });
    }
  }

  // Persiste le profil enrichi sur le hub pour les prochains singles
  await upsertArtistFromProject(profile, { preferredSlug: artist.slug });

  const language = profile.language || artist.profile?.language || "fr";

  const { normalizeFeatArtist } = await import("../../lib/featArtist.js");
  const feat = normalizeFeatArtist(featArtist);

  const project = {
    trends: null,
    artist: profile,
    featArtist: feat,
    // Préremplit l’étape paroles quand un thème vient de l’agent carrière
    lyrics: themeHint
      ? { theme: themeHint, language }
      : null,
    track: null,
    cover: null,
    distrokid: null,
    social: null,
    clip: null,
    clips: [],
    activeClipId: null,
  };

  const seed = {
    name: artist.name,
    bioHint: profile.bio || artist.profile?.bio || "",
    theme: themeHint || "Nouveau single",
    market: "FR",
    genre: profile.genre || "",
    genres: Array.isArray(profile.genres) ? profile.genres : [],
    language,
    styleArtist: profile.styleArtist || "",
    artistSlug: artist.slug,
  };

  const saved = await saveProject({
    project,
    seed,
    event: {
      stepKey: "artist",
      eventType: "new-release",
      message: `Nouveau morceau pour ${artist.name}`,
      payload: { slug: artist.slug, theme: themeHint, variantOf },
    },
  });

  // Lier le slug
  const db = getDb();
  await db.execute({
    sql: `UPDATE projects SET artist_slug = ? WHERE id = ?`,
    args: [artist.slug, saved.id],
  });

  return {
    projectId: saved.id,
    slug: artist.slug,
    theme: themeHint || "Nouveau single",
    studioUrl: `/studio?project=${saved.id}&step=2`,
  };
}

/**
 * Page d’édition du profil (hors Studio).
 */
export async function openArtistStyleEditor(slug) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");
  return {
    slug,
    editorUrl: `/artiste/${encodeURIComponent(slug)}/editer`,
  };
}
