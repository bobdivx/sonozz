import { normalizeFeatArtist } from "./featArtist.js";

/**
 * Répartit des feats catalogue sur UNE PARTIE des pistes d’album (hors lead).
 * Jamais tout l’album : ~1/3 des titres hors lead, plafonné à 3.
 * Priorité ballad / banger / closer, rotation du pool d’artistes.
 */
export function assignAlbumAutoFeats(tracks = [], featPool = []) {
  const pool = (Array.isArray(featPool) ? featPool : [])
    .map((f) => normalizeFeatArtist(f))
    .filter(Boolean);
  if (!pool.length || !Array.isArray(tracks) || !tracks.length) return tracks;

  const members = tracks.filter((t) => t && t.role !== "lead");
  if (!members.length) return tracks;

  // Quelques morceaux seulement : ~1/3, min 1, max 3 (jamais la totalité).
  const targetCount = Math.max(
    1,
    Math.min(3, members.length - 1, Math.round(members.length / 3) || 1),
  );
  if (targetCount <= 0) return tracks;

  const preferredRoles = new Set(["ballad", "banger", "closer", "deep_cut"]);

  const scored = members
    .map((t, order) => ({
      id: t.id,
      order,
      score:
        (preferredRoles.has(String(t.trackRole || "").toLowerCase()) ? 10 : 0) +
        (order % 2 === 1 ? 3 : 0) +
        (order === members.length - 1 ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const chosen = new Set(scored.slice(0, targetCount).map((s) => s.id));
  let fi = 0;

  return tracks.map((t) => {
    if (!t || t.role === "lead" || !chosen.has(t.id)) {
      // Solo explicite : pas de feat hérité du projet lead.
      if (t && t.role !== "lead") {
        return { ...t, featArtist: undefined, featuring: undefined };
      }
      return t;
    }
    const feat = pool[fi % pool.length];
    fi += 1;
    return {
      ...t,
      featArtist: feat,
      featuring: feat.name,
    };
  });
}

/** Autres artistes du catalogue, hors lead courant. */
export function featPoolFromCatalog(catalog = [], leadSlug = "", leadName = "") {
  const lead = String(leadSlug || "").trim().toLowerCase();
  const leadN = String(leadName || "").trim().toLowerCase();
  return (Array.isArray(catalog) ? catalog : [])
    .map((a) => normalizeFeatArtist(a))
    .filter((f) => {
      if (!f?.name) return false;
      const slug = String(f.slug || "").trim().toLowerCase();
      if (lead && slug && slug === lead) return false;
      if (leadN && f.name.toLowerCase() === leadN) return false;
      return true;
    });
}
