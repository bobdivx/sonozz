export const STEPS = [
  { id: 1, key: "stats", label: "Stats", short: "Analytics" },
  { id: 2, key: "lyrics", label: "Paroles", short: "Texte" },
  { id: 3, key: "tracks", label: "Morceaux", short: "Audio" },
  { id: 4, key: "covers", label: "Jaquettes", short: "Visuel" },
  { id: 5, key: "distrokid", label: "ONCE", short: "Release" },
  { id: 6, key: "clip", label: "Clips", short: "Vidéo" },
  { id: 7, key: "social", label: "Réseaux", short: "Pub" },
];

/** Ids d’étape Studio (sans création d’artiste). */
export const STUDIO_STEP = {
  stats: 1,
  lyrics: 2,
  tracks: 3,
  covers: 4,
  distrokid: 5,
  clip: 6,
  social: 7,
};

export function studioHref(projectId, stepKey = "tracks") {
  const step = STUDIO_STEP[stepKey] || STUDIO_STEP.tracks;
  const q = new URLSearchParams();
  if (projectId) q.set("project", String(projectId));
  q.set("step", String(step));
  return `/?${q.toString()}`;
}

export function artistHubHref(slug) {
  const s = String(slug || "").trim();
  return s ? `/artiste/${encodeURIComponent(s)}` : "/artistes";
}

export function artistEditHref(slug) {
  const s = String(slug || "").trim();
  return s ? `/artiste/${encodeURIComponent(s)}/editer` : "/artiste/nouveau";
}

/** Fiche artiste, onglet Album (création) ou album ouvert dans le catalogue. */
export function artistAlbumHref(slug, leadId = "") {
  const base = artistHubHref(slug);
  const id = String(leadId || "").trim();
  if (base === "/artistes") return base;
  return id ? `${base}#album-${id}` : `${base}#album`;
}
