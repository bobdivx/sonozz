import { getDb, getUserKeys } from "../db.js";
import { normalizeArtistPhotos } from "../../lib/artistPhotos.js";
import { generateVisual } from "../images.js";
import { ensureArtistSchema, stripHeavyProfile } from "./schema.js";
import { getArtistBySlug } from "./crud.js";

/**
 * Recadre les photos d’un artiste « c’est moi » sur son identity visuelle actuelle
 * (garde le visage, change garde-robe / lumière / décor).
 */
export async function restyleArtistPortraits(slug, { keys, prompt } = {}) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");
  const storedKeys = keys && typeof keys === "object" ? keys : (await getUserKeys()) || {};
  const photos = normalizeArtistPhotos(artist.profile?.photos, artist.profile?.imageUrl);
  if (!photos.length) {
    throw new Error("Aucune photo à restyler — ajoute un portrait d’abord.");
  }

  const vi = artist.profile?.visualIdentity || {};
  const restylePrompt =
    String(prompt || "").trim() ||
    [
      `39-year-old adult man, clearly masculine face, same person as the reference photo`,
      `hardcore hip hop artist portrait`,
      vi.wardrobe || "dark hoodie, baggy streetwear, utilitarian jacket",
      vi.photographyStyle || "gritty urban high-contrast industrial photography",
      `${artist.profile?.mood || "tense, determined"} mood`,
      "photorealistic, square, no text",
    ].join(", ");

  const restyled = [];
  let provider = null;
  for (let i = 0; i < photos.length; i += 1) {
    const visual = await generateVisual({
      keys: storedKeys,
      prompt: restylePrompt,
      kind: "portrait",
      referenceImageUrl: photos[i],
    });
    restyled.push(visual.imageUrl);
    provider = visual.provider || provider;
  }

  const now = new Date().toISOString();
  const profile = stripHeavyProfile({
    ...artist.profile,
    imageUrl: restyled[0],
    photos: restyled,
    imageProvider: provider || "restyle",
    imageFallback: false,
    imageWarning: undefined,
    portraitPrompt: restylePrompt,
    visualIdentity: {
      ...vi,
      portraitPrompt: restylePrompt,
    },
    slug: artist.slug,
    name: artist.name,
  });

  const db = getDb();
  await db.execute({
    sql: `UPDATE artists SET profile_json = ?, updated_at = ? WHERE slug = ?`,
    args: [JSON.stringify(profile), now, slug],
  });

  return {
    slug,
    count: restyled.length,
    provider,
    profile,
  };
}

/**
 * Force le label / copyright global sur tous les profils artistes existants.
 * Utilisé quand Paramètres → Label / copyright est enregistré.
 */
export async function applyRecordLabelToAllArtists(label) {
  const value = String(label || "").trim().slice(0, 120);
  if (!value) {
    return { updated: 0, label: null };
  }

  await ensureArtistSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT id, slug, name, profile_json FROM artists`,
  });
  const now = new Date().toISOString();
  let updated = 0;

  for (const row of res.rows) {
    let profile = {};
    try {
      profile = row.profile_json ? JSON.parse(row.profile_json) : {};
    } catch {
      profile = {};
    }
    if (profile.recordLabel === value) continue;
    const merged = { ...profile, recordLabel: value, slug: row.slug };
    await db.execute({
      sql: `UPDATE artists SET profile_json = ?, updated_at = ? WHERE id = ?`,
      args: [JSON.stringify(stripHeavyProfile(merged)), now, row.id],
    });
    updated += 1;
  }

  return { updated, label: value, total: res.rows.length };
}
