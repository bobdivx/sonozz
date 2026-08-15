import { json, error, readBody } from "../../server/http.js";
import { geminiText, resolveGeminiTextModel } from "../../server/gemini.js";
import { isOllamaProvider } from "../../server/llm.js";
import { testOllama } from "../../server/ollama.js";
import { fetchDeezerCharts } from "../../server/deezer.js";
import { getSpotifyAccess } from "../../server/spotify.js";
import { onceCredits, onceMe } from "../../server/once.js";
import { testDb, getUserKeys } from "../../server/db.js";

export async function POST({ request }) {
  try {
    const { keys = {} } = await readBody(request);
    const results = {
      llm: { ok: false, message: "Non testé" },
      gemini: { ok: false, message: "Non testé" },
      veo: { ok: false, message: "Non testé" },
      deezer: { ok: false, message: "Non testé" },
      spotify: { ok: false, message: "Non testé" },
      once: { ok: false, message: "Non testé" },
      replicate: { ok: false, message: "Non testé" },
      songgen: { ok: false, message: "Non testé" },
      acestep: { ok: false, message: "Non testé" },
      wan2gp: { ok: false, message: "Non testé" },
      turso: { ok: false, message: "Non testé" },
    };

    if (isOllamaProvider(keys)) {
      try {
        const info = await testOllama(keys);
        results.llm = {
          ok: true,
          message: `Ollama OK · ${info.model} @ ${info.base} (${info.models.length} modèle(s))`,
        };
      } catch (e) {
        results.llm = { ok: false, message: e.message };
      }
    } else {
      results.llm = { ok: false, message: "Provider = Gemini (voir ligne gemini)" };
    }

    if (keys.geminiApiKey?.trim()) {
      try {
        const model = resolveGeminiTextModel(keys.geminiModel);
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

        if (!isOllamaProvider(keys)) {
          results.llm = { ok: true, message: `Gemini texte OK (${model})` };
        }
      } catch (e) {
        results.gemini = { ok: false, message: e.message };
        if (!isOllamaProvider(keys)) {
          results.llm = { ok: false, message: e.message };
        }
      }

      // Probe Veo : démarre une op courte (texte) pour vérifier l’accès paid preview
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: keys.geminiApiKey.trim() });
        const op = await ai.models.generateVideos({
          model: "veo-3.1-fast-generate-preview",
          prompt: "A single yellow leaf falling slowly, cinematic, 9:16",
          config: {
            aspectRatio: "9:16",
            durationSeconds: 4,
            numberOfVideos: 1,
            personGeneration: "allow_adult",
          },
        });
        results.veo = {
          ok: Boolean(op?.name),
          message: op?.name
            ? `Accès OK — Veo facturé à l’usage`
            : "Réponse Veo sans opération",
        };
      } catch (e) {
        const msg = String(e?.message || e);
        results.veo = {
          ok: false,
          message: /billing|paid|payment|PERMISSION|403|not.+enabled/i.test(msg)
            ? `Billing Veo requis (paid preview). ${msg.slice(0, 180)}`
            : msg.slice(0, 280),
        };
      }
    } else {
      results.gemini = {
        ok: false,
        message: isOllamaProvider(keys)
          ? "Clé absente (optionnel si Ollama — requis pour images Gemini / Veo)"
          : "Clé absente",
      };
      results.veo = { ok: false, message: "Clé Gemini absente" };
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
      results.replicate = {
        ok: false,
        message:
          ["songgen", "acestep"].includes(String(keys.musicProvider || "").trim())
            ? "Token absent (optionnel si provider local)"
            : "Token absent (optionnel)",
      };
    }

    try {
      const { testSongGeneration } = await import("../../server/songGeneration.js");
      const info = await testSongGeneration(keys);
      const modelBit = info.pickedModel || info.defaultModel || "";
      results.songgen = {
        ok: info.hasReadyModel !== false,
        message: info.hasReadyModel === false
          ? `Studio OK @ ${info.base} — aucun modèle prêt`
          : `Studio OK @ ${info.base}${modelBit ? ` · ${modelBit}` : ""}`,
      };
    } catch (e) {
      results.songgen = { ok: false, message: e.message };
    }

    try {
      const { testAceStep } = await import("../../server/aceStep.js");
      const info = await testAceStep(keys);
      const modelBit = info.pickedModel || info.activeModel || "";
      results.acestep = {
        ok: info.hasReadyModel !== false,
        message: info.hasReadyModel === false
          ? `Studio OK @ ${info.base} — aucun modèle chargé`
          : `Studio OK @ ${info.base}${modelBit ? ` · ${modelBit}` : ""}`,
      };
    } catch (e) {
      results.acestep = { ok: false, message: e.message };
    }

    if (String(keys.videoProvider || "").trim() === "wan2gp") {
      try {
        const { testWan2gp } = await import("../../server/wan2gp.js");
        const info = await testWan2gp(keys);
        results.wan2gp = {
          ok: true,
          message: info.queueOk
            ? `Wan2GP OK @ ${info.base} · queue Gradio`
            : `Wan2GP joignable @ ${info.base} mais queue /save_inputs absente`,
        };
      } catch (e) {
        results.wan2gp = { ok: false, message: e.message };
      }
    } else {
      results.wan2gp = { ok: false, message: "Provider vidéo = cloud (Veo/Seedance)" };
    }

    try {
      const db = await testDb();
      const stored = await getUserKeys();
      const fieldCount = stored && typeof stored === "object"
        ? Object.values(stored).filter((v) => String(v || "").trim()).length
        : 0;
      results.turso = {
        ok: true,
        message: `Connecté · ${db.projects} projet(s) · clés API : ${fieldCount ? `${fieldCount} champ(s)` : "aucune"}`,
      };
    } catch (e) {
      results.turso = { ok: false, message: e.message };
    }

    return json({ results });
  } catch (e) {
    return error(e.message || "Erreur test", 500);
  }
}

export const prerender = false;
