/**
 * Référence audio de STYLE par artiste (ACE-Step : text2music + `referenceAudioUrl`).
 *
 * Pourquoi pas le mode « cover » ? Tests Skarlvind (oct. 2026) :
 *  - cover (taskType cover + sourceAudioUrl) cale la DURÉE sur la source (30 s) et recopie
 *    l'harmonie et la mélodie du titre source, même à une force de 0.1 (copie chroma/mélodie mesurée) ;
 *  - référence seule = la durée demandée est respectée, et ACE reprend la production
 *    (batterie, sub, charleston, mix) sans recopier la piste.
 *
 * Stockage privé : le profil artiste (base Turso, privée) porte un identifiant, pas de fichier
 * dans le repo. Sources prises en charge :
 *  - { source: "deezer", deezerTrackId } : aperçu de 30 s rafraîchi à chaque génération via l'API
 *    publique Deezer (les URL signées expirent) ;
 *  - { source: "url", url }              : fichier hébergé en privé (URL https non listée) ;
 *  - { source: "env", env: "NOM_VAR" }   : URL privée lue dans une variable d'environnement serveur.
 */

const DEEZER_TRACK_API = "https://api.deezer.com/track/";

/** @returns {null | { source: string, deezerTrackId?: string, url?: string, env?: string, title: string, strength: number|null, mode: string }} */
export function readArtistStyleReference(artist) {
  const raw = artist?.styleReference || artist?.styleLock?.styleReference || null;
  if (!raw || typeof raw !== "object" || raw.enabled === false) return null;
  const source = String(raw.source || (raw.deezerTrackId ? "deezer" : raw.url ? "url" : raw.env ? "env" : "")).trim();
  if (!source) return null;
  const strengthNum = Number(raw.strength);
  return {
    source,
    deezerTrackId: raw.deezerTrackId != null ? String(raw.deezerTrackId).replace(/\D+/g, "") : undefined,
    url: raw.url ? String(raw.url).trim() : undefined,
    env: raw.env ? String(raw.env).trim() : undefined,
    title: String(raw.title || "style reference").slice(0, 120),
    strength: Number.isFinite(strengthNum) ? Math.min(1, Math.max(0.05, strengthNum)) : null,
    mode: raw.mode === "cover" ? "cover" : "reference",
  };
}

/**
 * Résout une URL https que Gradio peut télécharger.
 * @returns {Promise<null | { url: string, title: string, strength: number|null, mode: string }>}
 */
export async function resolveArtistStyleReference(artist, { fetchImpl = fetch, env = process.env } = {}) {
  const ref = readArtistStyleReference(artist);
  if (!ref) return null;
  let url = "";
  if (ref.source === "deezer" && ref.deezerTrackId) {
    try {
      const res = await fetchImpl(`${DEEZER_TRACK_API}${ref.deezerTrackId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const j = res.ok ? await res.json().catch(() => ({})) : {};
      url = String(j?.preview || "").trim();
    } catch (e) {
      console.warn("[style-ref] Deezer injoignable:", e?.message || e);
    }
  } else if (ref.source === "url") {
    url = ref.url || "";
  } else if (ref.source === "env" && ref.env) {
    url = String(env?.[ref.env] || "").trim();
  }
  if (!/^https:\/\//i.test(url)) return null;
  return { url, title: ref.title, strength: ref.strength, mode: ref.mode };
}

/** Hôtes dont l'URL directe est acceptée par Gradio (testé) quand l'upload Gradio est indisponible. */
export function isDirectStyleRefHostOk(url) {
  try {
    const h = new URL(String(url || "")).hostname;
    return /(^|\.)dzcdn\.net$/i.test(h) || /(^|\.)deezer\.com$/i.test(h);
  } catch {
    return false;
  }
}
