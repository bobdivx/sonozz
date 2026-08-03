import { isUsableRasterImage } from "./imagePersist.js";
import { languageLabel } from "../lib/studio.js";

const DISTROKID_UPLOAD_URL = "https://distrokid.com/upload/";
const DISTROKID_DASHBOARD_URL = "https://distrokid.com/";

const GENRE_MAP = [
  { match: /metal|hard.?rock/i, genre: "Metal", subgenre: "Hard Rock" },
  { match: /punk|garage/i, genre: "Alternative", subgenre: "Punk" },
  { match: /jazz/i, genre: "Jazz", subgenre: "Contemporary Jazz" },
  { match: /blues/i, genre: "Blues", subgenre: "Contemporary Blues" },
  { match: /funk|disco/i, genre: "R&B/Soul", subgenre: "Funk" },
  { match: /gospel/i, genre: "Gospel", subgenre: "Contemporary Gospel" },
  { match: /k-?pop|j-?pop/i, genre: "Pop", subgenre: "K-Pop" },
  { match: /lo-?fi|chill|synthwave|retrowave/i, genre: "Electronic", subgenre: "Electronica" },
  { match: /house|techno|edm|festival/i, genre: "Electronic", subgenre: "Dance" },
  { match: /hyperpop|electro|electron/i, genre: "Electronic", subgenre: "Electronica" },
  { match: /trap|cloud.?rap|boom.?bap|hip.?hop|drill|rap/i, genre: "Hip Hop/Rap", subgenre: "Rap" },
  { match: /neo.?soul|quiet.?storm|r&b|rnb|soul/i, genre: "R&B/Soul", subgenre: "Contemporary R&B" },
  { match: /amapiano|afro.?house|afro/i, genre: "Worldwide", subgenre: "Afrobeats" },
  { match: /dancehall|reggae/i, genre: "Reggae/Dancehall", subgenre: "Dancehall" },
  { match: /latin|reggaeton/i, genre: "Latin", subgenre: "Reggaeton" },
  { match: /country|americana/i, genre: "Country", subgenre: "Contemporary Country" },
  { match: /folk|acoustique/i, genre: "Folk", subgenre: "Contemporary Folk" },
  { match: /world|fusion/i, genre: "Worldwide", subgenre: "Worldbeat" },
  { match: /indie|alternative/i, genre: "Alternative", subgenre: "Indie Pop" },
  { match: /rock/i, genre: "Rock", subgenre: "Indie Rock" },
  { match: /chanson|variété|pop/i, genre: "Pop", subgenre: "French Pop" },
];

function mapGenre(style = "") {
  for (const item of GENRE_MAP) {
    if (item.match.test(style)) return { genre: item.genre, subgenre: item.subgenre };
  }
  return { genre: "Pop", subgenre: "French Pop" };
}

function releaseDateISO(daysAhead = 14) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function detectExplicit(lyricsText = "") {
  const banned = /\b(fuck|shit|bitch|nigg|pute|encul|pd\b|salaud)/i;
  return banned.test(lyricsText);
}

/** Jaquette dédiée, sinon portrait artiste (raster uniquement). */
function resolveArtworkUrl(cover, artist) {
  for (const url of [cover?.imageUrl, artist?.imageUrl]) {
    if (isUsableRasterImage(url)) return url;
  }
  return null;
}

export function buildDistroKidPackage({ keys, artist, track, cover, lyrics }) {
  const artistName = (keys?.distrokidArtistName?.trim() || artist?.name || "Unknown Artist").trim();
  const title = (track?.title || lyrics?.title || "Untitled").trim();
  const { genre, subgenre } = mapGenre(artist?.genre || track?.style || "");
  const explicit = detectExplicit(lyrics?.text || "");
  const year = new Date().getFullYear();
  const releaseDate = releaseDateISO(Number(keys?.distrokidReleaseDays) || 14);
  const artworkUrl = resolveArtworkUrl(cover, artist);
  const artworkFromPortrait = Boolean(artworkUrl && artworkUrl === artist?.imageUrl && artworkUrl !== cover?.imageUrl);

  const form = {
    releaseType: "Single",
    artistName,
    releaseTitle: title,
    trackTitle: title,
    featuring: "",
    genre,
    subgenre,
    lyricsLanguage: languageLabel(lyrics?.language || artist?.language || "fr"),
    explicitLyrics: explicit ? "Yes" : "No",
    instrumental: "No",
    primaryGenre: genre,
    recordLabel: keys?.distrokidLabel?.trim() || artistName,
    copyrightYear: String(year),
    copyrightOwner: `© ${year} ${artistName}`,
    phonogramYear: String(year),
    phonogramOwner: `℗ ${year} ${artistName}`,
    releaseDate,
    previouslyReleased: "No",
    stores: ["Spotify", "Apple Music", "Amazon", "Deezer", "YouTube Music", "TikTok/CapCut"],
    price: "Mid",
    territory: "Worldwide",
    isrc: "Auto (DistroKid)",
    upc: "Auto (DistroKid)",
  };

  const checklist = [
    {
      label: "Nom d'artiste exact (Spotify for Artists)",
      ok: Boolean(artistName),
      tip: "Doit correspondre à l'artiste Spotify existant si déjà créé",
    },
    {
      label: "Titre single / track",
      ok: Boolean(title),
    },
    {
      label: "Artwork carré (JPG/PNG)",
      ok: Boolean(artworkUrl),
      tip: artworkUrl
        ? artworkFromPortrait
          ? "Portrait artiste utilisé en secours — idéalement régénère une vraie jaquette (étape 5)"
          : "Idéal 3000×3000, sans URL / @reseaux / logos stores"
        : "Manquant — génère la jaquette (étape 5) à partir du portrait artiste",
    },
    {
      label: "Fichier audio master",
      ok: Boolean(track?.audioUrl) || Boolean(track?.sunoPrompt),
      tip: track?.audioUrl
        ? "Audio généré prêt — exporte en WAV/FLAC si possible"
        : "Génère l'audio (Replicate) ou finalise via Suno puis exporte WAV",
    },
    {
      label: "Paroles / langue renseignées",
      ok: Boolean(lyrics?.text),
    },
    {
      label: "Date de sortie (≥ quelques jours)",
      ok: Boolean(releaseDate),
      tip: `Prévue le ${releaseDate}`,
    },
  ];

  const ready = checklist.every((c) => c.ok);

  const uploadSteps = [
    "Ouvre DistroKid → Upload / New release",
    `Artist name : ${form.artistName}`,
    `Release title / Track title : ${form.trackTitle}`,
    `Genre : ${form.genre} / ${form.subgenre}`,
    `Explicit : ${form.explicitLyrics} · Langue : ${form.lyricsLanguage}`,
    `Release date : ${form.releaseDate}`,
    "Upload l'artwork (carré) puis le fichier audio WAV/FLAC/MP3",
    "Coche Spotify (+ autres stores) → confirme la release",
  ];

  const packageId = `dk_${Date.now().toString(36)}`;

  return {
    packageId,
    status: ready ? "ready-to-upload" : "needs-assets",
    distributor: "DistroKid",
    destination: "Spotify (+ stores DistroKid)",
    uploadUrl: DISTROKID_UPLOAD_URL,
    dashboardUrl: DISTROKID_DASHBOARD_URL,
    accountEmail: keys?.distrokidEmail?.trim() || null,
    form,
    checklist,
    uploadSteps,
    assets: {
      coverUrl: artworkUrl,
      audioUrl: track?.audioUrl || null,
      sunoPrompt: track?.sunoPrompt || null,
      lyrics: lyrics?.text || null,
      artworkFromPortrait,
    },
    metadataDownload: {
      packageId,
      artist: artistName,
      title,
      genre,
      subgenre,
      releaseDate,
      explicit,
      label: form.recordLabel,
      copyright: form.copyrightOwner,
      phonogram: form.phonogramOwner,
      stores: form.stores,
      bpm: track?.bpm,
      key: track?.key,
      mood: artist?.mood,
      bio: artist?.bio,
    },
    eta: "Spotify : souvent 2–7 jours après validation DistroKid",
    note:
      "DistroKid n’offre pas d’API publique d’upload. SONOZZ prépare le package complet ; tu colles les champs et uploades en 2 minutes.",
  };
}
