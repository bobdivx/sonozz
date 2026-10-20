import { useState } from "preact/hooks";
import { api } from "../lib/apiClient.js";

/**
 * Titre de référence de style retenu (recette ACE auto) : afficher, changer, désactiver.
 * Les changements passent par onPatchArtist (sauvegarde du profil déclenchée par l'utilisateur).
 */
export default function StyleReferencePanel({ artist, onPatchArtist, disabled = false }) {
  const lock = artist?.styleLock;
  const ref = lock?.styleReference || null;
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [cands, setCands] = useState(null);
  if (!lock || (!ref && !lock.matchedName && !lock.seedTrack)) return null;

  const names = [artist?.name, artist?.aka, ...(artist?.vocalProfiles || []).map((v) => v?.name)].filter(Boolean);
  const base = { styleLock: lock, duo: Boolean(artist?.duo), gender: artist?.gender || null, names };

  async function run(action, extra = {}) {
    setErr("");
    setBusy(action);
    try {
      const res = await api.artistStyleRef({ ...base, action, ...extra });
      if (action === "candidates") {
        setCands(res?.candidates || []);
      } else if (res?.patch) {
        onPatchArtist?.({ styleLock: { ...lock, ...res.patch } });
        setCands(null);
      }
    } catch (e) {
      setErr(e?.message || "Action impossible");
    } finally {
      setBusy("");
    }
  }

  const off = ref && ref.enabled === false;
  const q = lock.qualityProfile;
  return (
    <div class="space-y-2 rounded-box border border-base-content/10 p-3 text-sm">
      <p class="text-xs uppercase tracking-wider text-primary">Titre de référence de style</p>
      {ref ? (
        <p class={off ? "text-base-content/40 line-through" : "text-base-content/80"}>
          {ref.title}
          {ref.album ? <span class="text-base-content/45"> · {ref.album}</span> : null}
          <span class="ml-2 text-xs text-base-content/45">
            {ref.auto ? "choisi automatiquement" : "choisi à la main"}
          </span>
        </p>
      ) : (
        <p class="text-base-content/55">Aucun titre de référence (le style suit la description texte).</p>
      )}
      {lock.aceCaption && !off && (
        <p class="text-xs text-base-content/45" title="Caption envoyée au modèle musical">
          Caption : {lock.aceCaption}
        </p>
      )}
      {q && !off && <p class="text-xs text-base-content/45">Profil qualité mesuré sur l'extrait — chaque prise est notée et relancée si elle s'en éloigne.</p>}
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-ghost btn-xs" disabled={disabled || !!busy} onClick={() => run("auto")}>
          {busy === "auto" ? "Analyse…" : ref ? "Re-choisir automatiquement" : "Choisir automatiquement"}
        </button>
        <button type="button" class="btn btn-ghost btn-xs" disabled={disabled || !!busy} onClick={() => run("candidates")}>
          {busy === "candidates" ? "…" : "Changer de titre"}
        </button>
        {ref && (
          <button type="button" class="btn btn-ghost btn-xs" disabled={disabled || !!busy} onClick={() => run(off ? "enable" : "disable")}>
            {off ? "Réactiver" : "Désactiver"}
          </button>
        )}
      </div>
      {Array.isArray(cands) && (
        <ul class="max-h-48 space-y-1 overflow-auto">
          {cands.length === 0 && <li class="text-base-content/50">Aucun titre d'album trouvé.</li>}
          {cands.map((c) => (
            <li key={c.deezerTrackId}>
              <button
                type="button"
                class="btn btn-ghost btn-xs justify-start text-left"
                disabled={disabled || !!busy}
                onClick={() => run("set", { deezerTrackId: c.deezerTrackId, title: c.title })}
              >
                {c.title} <span class="text-base-content/45">· {c.album}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p class="text-xs text-error">{err}</p>}
      <p class="text-xs text-base-content/40">
        Droits : l'extrait sert uniquement de guide de style (production, mix) pendant la génération ; il est lu
        depuis Deezer à chaque fois, rien n'est stocké ni copié (mélodie et paroles restent originales).
      </p>
    </div>
  );
}
