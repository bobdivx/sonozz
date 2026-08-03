export const STEPS = [
  { id: 1, key: "trends", label: "Tendances", short: "Marché" },
  { id: 2, key: "artist", label: "Artiste", short: "Profil" },
  { id: 3, key: "lyrics", label: "Paroles", short: "Texte" },
  { id: 4, key: "tracks", label: "Morceaux", short: "Audio" },
  { id: 5, key: "covers", label: "Jaquettes", short: "Visuel" },
  { id: 6, key: "distrokid", label: "ONCE", short: "Release" },
  { id: 7, key: "clip", label: "Clip", short: "Veo" },
  { id: 8, key: "social", label: "Réseaux", short: "Pub" },
];

export const emptyProject = () => ({
  trends: null,
  artist: null,
  lyrics: null,
  track: null,
  cover: null,
  distrokid: null,
  social: null,
  clip: null,
});
