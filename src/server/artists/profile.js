import { getDb, saveProject } from "../db.js";
import { resolveArtistGender, withResolvedArtistGender } from "../../lib/artistGender.js";
import { mergeArtistProfile, omitUndefined, profileRichness } from "./schema.js";
import { getArtistBySlug, upsertArtistFromProject } from "./crud.js";

/**
 * Charge le profil artiste le plus riche : hub + meilleurs projets studio.
 * Garantit gender / styleLock / voice / voiceSample réutilisables pour un nouveau morceau.
 */
export async function resolveArtistProfileForRelease(slug, nameHint = "") {
  const artist = await getArtistBySlug(slug);
  if (!artist && !nameHint) return null;

  const name = nameHint || artist?.name || slug;
  let profile = withResolvedArtistGender({
    ...(artist?.profile || {}),
    slug: artist?.slug || slug,
    name,
  });

  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT
        json_extract(project_json, '$.artist') AS artist_json,
        updated_at
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
      ORDER BY updated_at DESC
      LIMIT 20
    `,
    args: [artist?.slug || slug, name],
  });

  let bestFromProjects = null;
  let bestScore = -1;
  for (const row of res.rows) {
    if (!row.artist_json) continue;
    let a;
    try {
      a = typeof row.artist_json === "string" ? JSON.parse(row.artist_json) : row.artist_json;
    } catch {
      continue;
    }
    if (!a || typeof a !== "object") continue;
    const score = profileRichness(a);
    if (score > bestScore) {
      bestScore = score;
      bestFromProjects = a;
    }
  }

  if (bestFromProjects) {
    // Hub = base, projet riche = prioritaire sur style / voix / genres (merge préserve les trous)
    profile = mergeArtistProfile(profile, bestFromProjects);
  }

  profile = withResolvedArtistGender({
    ...profile,
    slug: artist?.slug || slug,
    name,
  });

  return profile;
}

/**
 * Récupère sexe / voix depuis un projet studio déjà généré (hub parfois incomplet).
 */
export async function recoverArtistGenderFromProjects(slug, name) {
  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT
        json_extract(project_json, '$.artist.gender') AS gender,
        json_extract(project_json, '$.artist.voice') AS voice,
        json_extract(project_json, '$.artist.visualIdentity.gender') AS vi_gender,
        json_extract(project_json, '$.artist.visualIdentity.genderLock') AS gender_lock,
        json_extract(project_json, '$.artist.portraitPrompt') AS portrait_prompt,
        json_extract(project_json, '$.artist.visualIdentity.portraitPrompt') AS vi_portrait
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
      ORDER BY updated_at DESC
      LIMIT 12
    `,
    args: [slug, name],
  });

  for (const row of res.rows) {
    const recovered = {
      gender: row.gender || undefined,
      voice: row.voice || undefined,
      portraitPrompt: row.portrait_prompt || undefined,
      visualIdentity: {
        ...(row.vi_gender ? { gender: row.vi_gender } : {}),
        ...(row.gender_lock ? { genderLock: row.gender_lock } : {}),
        ...(row.vi_portrait ? { portraitPrompt: row.vi_portrait } : {}),
      },
    };
    if (!Object.keys(recovered.visualIdentity).length) delete recovered.visualIdentity;
    if (resolveArtistGender(recovered)) return omitUndefined(recovered);
  }
  return null;
}

/**
 * Rétablit `artist.gender` sur un projet déjà sauvé (hub / snapshot incomplet).
 */
export async function hydrateProjectArtistGender(saved) {
  const project = saved?.project;
  const original = project?.artist;
  if (!original) return saved;

  let artist = withResolvedArtistGender({ ...original });
  const slug = artist.slug || saved.seed?.artistSlug || "";
  const name = artist.name || saved.artistName || "";

  if (!resolveArtistGender(artist) && slug) {
    try {
      const hub = await getArtistBySlug(slug);
      if (hub?.profile) {
        artist = withResolvedArtistGender({
          ...hub.profile,
          ...artist,
          slug: slug || artist.slug,
          name: name || artist.name,
          gender: artist.gender || hub.profile.gender,
          voice: artist.voice || hub.profile.voice,
          visualIdentity: {
            ...(hub.profile.visualIdentity || {}),
            ...(artist.visualIdentity || {}),
          },
          portraitPrompt:
            artist.portraitPrompt ||
            artist.visualIdentity?.portraitPrompt ||
            hub.profile.portraitPrompt ||
            hub.profile.visualIdentity?.portraitPrompt,
        });
      }
    } catch {
      /* hub optionnel */
    }
  }

  if (!resolveArtistGender(artist) && (slug || name)) {
    const recovered = await recoverArtistGenderFromProjects(slug, name);
    if (recovered) {
      artist = withResolvedArtistGender({
        ...artist,
        ...recovered,
        gender: recovered.gender || artist.gender,
        voice: recovered.voice || artist.voice,
        visualIdentity: {
          ...(artist.visualIdentity || {}),
          ...(recovered.visualIdentity || {}),
        },
      });
    }
  }

  artist = withResolvedArtistGender(artist);
  const resolved = resolveArtistGender(artist);
  if (!resolved) return saved;
  if (original.gender === resolved.code && artist.gender === original.gender) {
    return saved;
  }

  artist = { ...artist, gender: resolved.code };
  const nextProject = { ...project, artist };
  try {
    await saveProject({
      id: saved.id,
      project: nextProject,
      seed: saved.seed,
      event: {
        stepKey: "artist",
        eventType: "backfill",
        message: "Voix artiste rétablie depuis le profil",
      },
    });
  } catch {
    /* lecture toujours possible même si la persistance échoue */
  }

  if (slug) {
    try {
      await upsertArtistFromProject(artist, { preferredSlug: slug });
    } catch {
      /* hub optionnel */
    }
  }

  return { ...saved, project: nextProject };
}
