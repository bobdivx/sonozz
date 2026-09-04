import { prepareSpotifyRelease } from "../spotify.js";
import { submitOnceRelease } from "../once.js";
import { llmJson, requireTextLlm } from "../llm.js";
import { promptJson } from "./util.js";

export async function runSpotify({ keys, artist, track, cover }) {
  return prepareSpotifyRelease(keys, { artist, track, cover });
}

export async function runDistroKid({
  keys,
  artist,
  track,
  cover,
  lyrics,
  submit = true,
  reuseRelease = false,
  releaseId = null,
}) {
  const onceToken = keys?.onceApiToken?.trim();
  if (!onceToken) {
    throw new Error("Token ONCE requis dans Paramètres pour publier vers Spotify.");
  }
  if (!submit) {
    throw new Error("Soumission ONCE désactivée.");
  }

  let spotifyAssist = null;
  try {
    if (keys?.spotifyClientId?.trim() && keys?.spotifyClientSecret?.trim()) {
      spotifyAssist = await prepareSpotifyRelease(keys, { artist, track, cover });
    }
  } catch {
    /* optional */
  }

  const once = await submitOnceRelease(onceToken, {
    artist,
    track,
    cover,
    lyrics,
    keys,
    reuseRelease: Boolean(reuseRelease),
    releaseId: releaseId || null,
  });
  return {
    provider: "once",
    ...once,
    uploadUrl: once.dashboardUrl,
    spotifyAssist,
  };
}

export async function runSocial({ keys, artist, track, lyrics, cover }) {
  requireTextLlm(keys);
  const data = await llmJson(
    keys,
    `Crée un pack de publication short vertical 9:16 pour CE MORCEAU (pas un clip générique).
Artiste: ${promptJson(artist)}
Morceau: ${promptJson({
      title: track?.title,
      style: track?.style,
      bpm: track?.bpm,
      key: track?.key,
      mood: track?.mood || artist?.mood,
    })}
Jaquette / univers: ${promptJson({ prompt: cover?.prompt, style: cover?.style })}
Paroles (source narrative du clip): ${(lyrics?.text || "").slice(0, 900)}

JSON strict:
{
  "format": "9:16",
  "duration": "8s",
  "platforms": ["TikTok","Instagram Reels","YouTube Shorts"],
  "caption": string,
  "scenes": [string, string, string],
  "hashtags": string[],
  "hook": string,
  "veoPromptHint": string,
  "status": "ready-for-veo"
}
Règles:
- scenes = 3 battements VISUELS en anglais qui illustrent les paroles / le thème du titre (métaphores → images), pas juste le look artiste. Préférer plans larges/moyens, silhouette, mains, décor — éviter gros plans bouche / lip-sync.
- veoPromptHint = 1–2 phrases EN ANGLAIS : direction cinéma du clip fidèle au morceau + portrait + jaquette (énergie BPM, émotion, lieux évoqués par les paroles), cadre 9:16 plein écran sans letterbox, sans lip-sync.
- caption/hook en français, accrocheurs, liés au titre.
- Aucun nom de célébrité réelle.`,
  );

  return {
    ...data,
    tiktokReady: Boolean(keys?.tiktokAccessToken?.trim()),
    webhookReady: Boolean(keys?.socialWebhookUrl?.trim()),
    publishNote: keys?.tiktokAccessToken?.trim() || keys?.socialWebhookUrl?.trim()
      ? "Prêt pour Clip Veo 3 puis diffusion (TikTok / webhook)."
      : "Génère le clip Veo 3, puis configure TikTok/webhook pour diffuser.",
  };
}
