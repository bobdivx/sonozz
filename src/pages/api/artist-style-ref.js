import { json, error, readBody } from "../../server/http.js";
import { buildAceRecipe } from "../../server/styleReference/aceRecipe.js";
import { listAlbumTrackCandidates } from "../../server/styleReference/representativeTrack.js";

/**
 * Référence de style d'un artiste (formulaire artiste). NE MODIFIE PAS la base : renvoie un patch
 * styleLock que l'app enregistre via la sauvegarde normale du profil (action de l'utilisateur).
 *  - candidates : titres d'album du/des artiste(s) de référence (pour « Changer »)
 *  - auto       : re-choix automatique du titre + caption + profil qualité
 *  - set        : titre imposé (deezerTrackId) + caption + profil
 *  - refresh    : garde le titre actuel, recalcule caption + profil
 *  - disable / enable
 */
export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const action = String(body?.action || "").trim();
    const keys = body.keys || {};
    const lock = body.styleLock && typeof body.styleLock === "object" ? body.styleLock : null;
    if (!lock) return error("styleLock manquant", 400);
    const duo = Boolean(body.duo);
    const names = Array.isArray(body.names) ? body.names.map(String).slice(0, 8) : [];

    if (action === "candidates") {
      const name = lock.seedTrack?.artistName || lock.refs?.[0]?.matchedName || lock.matchedName || "";
      const deezerArtistId =
        lock.styleReference?.deezerArtistId ||
        (lock.source === "deezer" && /^\d+$/.test(String(lock.sourceId || "")) ? lock.sourceId : undefined);
      const data = await listAlbumTrackCandidates({ name, deezerArtistId, max: 12, perAlbum: 6 });
      return json({ ok: true, ...data });
    }
    if (action === "disable" || action === "enable") {
      if (!lock.styleReference) return error("Pas de référence à modifier", 400);
      return json({
        ok: true,
        patch: { styleReference: { ...lock.styleReference, enabled: action === "enable" } },
      });
    }
    if (!["auto", "set", "refresh"].includes(action)) return error("action inconnue", 400);
    const recipe = await buildAceRecipe({
      styleLock: lock,
      duo,
      leadGender: body.gender || null,
      names,
      keys,
      reference: action === "auto" ? "auto" : "keep",
      deezerTrack: action === "set" ? { deezerTrackId: body.deezerTrackId, title: body.title } : null,
    });
    return json({ ok: true, patch: recipe });
  } catch (e) {
    return error(e.message || "Référence de style impossible", 500);
  }
}

export const prerender = false;
