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
        help: "1.5 / 2.0 sont retirés par Google — 2.5-flash-lite recommandé (free tier)",
        required: false,
        inputType: "select",
        options: [
          { value: "gemini-2.5-flash-lite", label: "2.5 Flash Lite (free, recommandé)" },
          { value: "gemini-2.5-flash", label: "2.5 Flash (free)" },
          { value: "gemini-flash-lite-latest", label: "Flash Lite (alias latest)" },
          { value: "gemini-flash-latest", label: "Flash (alias latest)" },
        ],
      },
      {
        id: "replicateApiToken",
        label: "Replicate API Token",
        placeholder: "r8_...",
        help: "Audio MiniMax 2.6 + images Flux + Seedance 2.0 (shorts sync audio). Billing Replicate recommandé.",
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
        help: "Résultat de « Reconnecter ». Doit inclure video.publish (Direct Post).",
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
        id: "tiktokPrivacyLevel",
        label: "Visibilité TikTok (Direct Post)",
        help: "App non auditée : « Uniquement moi ». Public = audit app requis. Compte TikTok privé parfois obligatoire pour Direct Post.",
        required: false,
        inputType: "select",
        options: [
          { value: "SELF_ONLY", label: "Uniquement moi (recommandé sans audit)" },
          { value: "MUTUAL_FOLLOW_FRIENDS", label: "Amis (follow mutuel)" },
          { value: "FOLLOWER_OF_CREATOR", label: "Abonnés" },
          { value: "PUBLIC_TO_EVERYONE", label: "Public (nécessite audit app)" },
        ],
      },
      {
        id: "tiktokPostMode",
        label: "Mode publication TikTok",
        help: "Direct = profil tout de suite. Inbox = brouillon à valider dans l’app. Auto = Direct, puis Inbox si TikTok bloque (app non auditée).",
        required: false,
        inputType: "select",
        options: [
          { value: "direct", label: "Direct Post (profil) — recommandé" },
          { value: "auto", label: "Auto (Direct seulement ; pas d’Inbox auto)" },
          { value: "inbox", label: "Inbox (brouillon — max ~5 / 24 h)" },
        ],
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

const RETIRED_GEMINI_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
]);

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

export const EMPTY_KEYS = () => {
  const base = Object.fromEntries(KEY_FIELDS.flatMap((g) => g.items.map((i) => [i.id, ""])));
  base.geminiModel = DEFAULT_GEMINI_MODEL;
  base.tiktokPrivacyLevel = "SELF_ONLY";
  base.tiktokPostMode = "direct";
  return base;
};

function migrateKeys(keys) {
  const next = { ...keys };
  if (!next.geminiModel?.trim() || RETIRED_GEMINI_MODELS.has(next.geminiModel.trim())) {
    next.geminiModel = DEFAULT_GEMINI_MODEL;
  }
  if (!next.tiktokPrivacyLevel?.trim()) {
    next.tiktokPrivacyLevel = "SELF_ONLY";
  }
  if (!next.tiktokPostMode?.trim() || next.tiktokPostMode === "auto") {
    // Auto brûlait le quota Inbox ; Direct = chemin principal
    next.tiktokPostMode = "direct";
  }
  return next;
}

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
    const migrated = migrateKeys({ ...EMPTY_KEYS(), ...JSON.parse(raw) });
    if (raw !== JSON.stringify(migrated)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return EMPTY_KEYS();
  }
}

export function saveKeys(keys) {
  const next = migrateKeys({ ...EMPTY_KEYS(), ...keys });
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
