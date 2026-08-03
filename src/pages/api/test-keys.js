import { json, error, readBody } from "../../server/http.js";
import { geminiText } from "../../server/gemini.js";
import { fetchDeezerCharts } from "../../server/deezer.js";
import { getSpotifyAccess } from "../../server/spotify.js";
import { onceCredits, onceMe } from "../../server/once.js";
import { testDb } from "../../server/db.js";

export async function POST({ request }) {
  try {
    const { keys = {} } = await readBody(request);
    const results = {
      gemini: { ok: false, message: "Non testé" },
      deezer: { ok: false, message: "Non testé" },
      spotify: { ok: false, message: "Non testé" },
      once: { ok: false, message: "Non testé" },
      replicate: { ok: false, message: "Non testé" },
      turso: { ok: false, message: "Non testé" },
    };

    if (keys.geminiApiKey?.trim()) {
      try {
        const model = keys.geminiModel?.trim() || "gemini-2.5-flash-lite";
        const key = keys.geminiApiKey.trim();
        await geminiText(key, 'Réponds uniquement: "ok"', { model });

        const { geminiImage } = await import("../../server/gemini.js");
        const probe = await geminiImage(key, "simple red circle on black background", {
          kind: "image",
        });

        results.gemini = probe?.fallback
          ? {
              ok: true,
              message: `Texte OK (${model}) · Image NON dispo en free tier (billing requis)`,
            }
          : { ok: true, message: `Texte + Image OK (${model})` };
      } catch (e) {
        results.gemini = { ok: false, message: e.message };
      }
    } else {
      results.gemini = { ok: false, message: "Clé absente" };
    }

    try {
      const charts = await fetchDeezerCharts();
      results.deezer = { ok: true, message: `${charts.tracks.length} titres chart` };
    } catch (e) {
      results.deezer = { ok: false, message: e.message };
    }

    if (keys.spotifyClientId?.trim() && keys.spotifyClientSecret?.trim()) {
      try {
        const access = await getSpotifyAccess(keys);
        results.spotify = {
          ok: Boolean(access),
          message: access ? `Token ${access.mode}` : "Échec",
        };
      } catch (e) {
        results.spotify = { ok: false, message: e.message };
      }
    } else {
      results.spotify = { ok: false, message: "Credentials absents" };
    }

    if (keys.onceApiToken?.trim()) {
      try {
        const me = await onceMe(keys.onceApiToken.trim());
        const credits = await onceCredits(keys.onceApiToken.trim());
        const profile = me?.profile || me;
        const balance = credits?.balance ?? credits?.credits ?? credits?.available ?? "?";
        results.once = {
          ok: true,
          message: `Connecté (${profile?.email || profile?.first_name || "ok"}) · crédits ${balance}`,
        };
      } catch (e) {
        results.once = { ok: false, message: e.message };
      }
    } else {
      results.once = { ok: false, message: "Token ONCE absent" };
    }

    if (keys.replicateApiToken?.trim()) {
      try {
        const { testReplicateToken } = await import("../../server/replicate.js");
        const account = await testReplicateToken(keys.replicateApiToken.trim());
        results.replicate = {
          ok: true,
          message: `Compte OK (${account.username || account.name || "ok"})`,
        };
      } catch (e) {
        results.replicate = { ok: false, message: e.message };
      }
    } else {
      results.replicate = { ok: false, message: "Token absent (optionnel)" };
    }

    try {
      const db = await testDb();
      results.turso = { ok: true, message: `Connecté · ${db.projects} projet(s)` };
    } catch (e) {
      results.turso = { ok: false, message: e.message };
    }

    return json({ results });
  } catch (e) {
    return error(e.message || "Erreur test", 500);
  }
}

export const prerender = false;
