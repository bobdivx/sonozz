export const KEY_FIELDS = [
  {
    group: "IA",
    items: [
      {
        id: "geminiApiKey",
        label: "Gemini API Key",
        placeholder: "AIza...",
        help: "Obligatoire — tendances, artiste, paroles, jaquettes, shorts Veo 3 (billing vidéo)",
        required: true,
        url: "https://aistudio.google.com/apikey",
      },
      {
        id: "geminiModel",
        label: "Modèle Gemini",
        placeholder: "gemini-2.5-flash-lite",
        help: "Si 429 / quota 0 sur 2.0-flash, utilise 2.5-flash-lite (recommandé free tier)",
        required: false,
        inputType: "select",
        options: [
          { value: "gemini-2.5-flash-lite", label: "2.5 Flash Lite (free, recommandé)" },
          { value: "gemini-2.5-flash", label: "2.5 Flash (free)" },
          { value: "gemini-2.0-flash", label: "2.0 Flash (souvent quota 0)" },
          { value: "gemini-1.5-flash", label: "1.5 Flash (legacy)" },
        ],
      },
      {
        id: "replicateApiToken",
        label: "Replicate API Token",
        placeholder: "r8_...",
        help: "Audio MiniMax 2.6 (voix+paroles) + Flux images. Billing Replicate recommandé.",
        required: false,
        url: "https://replicate.com/account/api-tokens",
      },
    ],
  },
  {
    group: "Streaming",
    items: [
      {
        id: "spotifyClientId",
        label: "Spotify Client ID",
        placeholder: "abc123...",
        help: "App Spotify Developer",
        required: false,
        url: "https://developer.spotify.com/dashboard",
      },
      {
        id: "spotifyClientSecret",
        label: "Spotify Client Secret",
        placeholder: "secret...",
        help: "Pour token client + analyse catalogue",
        required: false,
      },
      {
        id: "spotifyRefreshToken",
        label: "Spotify Refresh Token",
        placeholder: "AQ...",
        help: "Optionnel — création playlist sur ton compte",
        required: false,
      },
      {
        id: "deezerAppId",
        label: "Deezer App ID",
        placeholder: "optionnel",
        help: "Charts Deezer publics sans clé ; ID pour usage avancé",
        required: false,
        url: "https://developers.deezer.com/",
      },
    ],
  },
  {
    group: "Distribution ONCE",
    items: [
      {
        id: "onceApiToken",
        label: "ONCE Personal Access Token",
        placeholder: "once_pat_...",
        help: "Obligatoire pour publier automatiquement → Spotify. Account → Developer → Create token",
        required: false,
        url: "https://once.app/",
      },
      {
        id: "distrokidArtistName",
        label: "Nom d'artiste (exact stores)",
        placeholder: "Identique à Spotify for Artists",
        help: "Doit matcher exactement l'artiste existant si déjà créé",
        required: false,
        inputType: "text",
      },
      {
        id: "distrokidLegalName",
        label: "Nom légal writer (prénom + nom)",
        placeholder: "Kaelen Moreau",
        help: "Obligatoire pour ONCE si l'artiste est un mononyme. Ex. « Kaelen Moreau ».",
        required: false,
        inputType: "text",
      },
      {
        id: "distrokidLabel",
        label: "Label / copyright",
        placeholder: "Par défaut = nom artiste",
        help: "Affiché comme record label sur les stores",
        required: false,
        inputType: "text",
      },
      {
        id: "distrokidReleaseDays",
        label: "Délai sortie (jours)",
        placeholder: "14",
        help: "Date de sortie = aujourd'hui + N jours (min. recommandé 7–14)",
        required: false,
        inputType: "number",
      },
    ],
  },
  {
    group: "Réseaux",
    items: [
      {
        id: "tiktokClientKey",
        label: "TikTok Client Key",
        placeholder: "aw…",
        help: "Fourni par TikTok Developers (souvent aw…). Pas le Client Secret. Login Kit doit être ajouté à l’app.",
        required: false,
        url: "https://developers.tiktok.com/",
        inputType: "text",
      },
      {
        id: "tiktokClientSecret",
        label: "TikTok Client Secret",
        placeholder: "…",
        help: "Secret de l’app. Enregistre, puis Connecter TikTok. Localhost = Login Kit Desktop ; prod = Login Kit Web (HTTPS).",
        required: false,
      },
      {
        id: "tiktokAccessToken",
        label: "TikTok Access Token",
        placeholder: "rempli automatiquement après OAuth",
        help: "Résultat de la connexion OAuth (scope video.upload). Ne colle pas le Client Key ici.",
        required: false,
      },
      {
        id: "tiktokRefreshToken",
        label: "TikTok Refresh Token",
        placeholder: "rempli automatiquement après OAuth",
        help: "Permet de renouveler l’access token (~24 h). Rempli par « Connecter TikTok ».",
        required: false,
      },
      {
        id: "socialWebhookUrl",
        label: "Webhook diffusion (Activepieces / Make)",
        placeholder: "https://cloud.activepieces.com/api/v1/webhooks/...",
        help: "POST auto du short + caption pour Instagram Reels / YouTube Shorts / multi-réseaux.",
        required: false,
        inputType: "url",
      },
    ],
  },
];

export const EMPTY_KEYS = () => {
  const base = Object.fromEntries(KEY_FIELDS.flatMap((g) => g.items.map((i) => [i.id, ""])));
  base.geminiModel = "gemini-2.5-flash-lite";
  return base;
};

/** URI à coller dans le portail TikTok (Login Kit / Redirect URI). */
export function tiktokRedirectUri() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/tiktok/callback`;
}

const STORAGE_KEY = "sonozz.keys.v1";

export function loadKeys() {
  if (typeof localStorage === "undefined") return EMPTY_KEYS();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_KEYS();
    return { ...EMPTY_KEYS(), ...JSON.parse(raw) };
  } catch {
    return EMPTY_KEYS();
  }
}

export function saveKeys(keys) {
  const next = { ...EMPTY_KEYS(), ...keys };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function keysReady(keys) {
  return Boolean(keys?.geminiApiKey?.trim());
}

export function maskSecret(value) {
  if (!value) return "";
  if (value.length < 8) return "••••••••";
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}
