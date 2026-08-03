import { useEffect, useMemo, useState } from "preact/hooks";
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  Save,
  PlugZap,
  Link2,
  Sparkles,
  Music2,
  Radio,
  Share2,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
import { KEY_FIELDS, loadKeys, saveKeys, keysReady, tiktokRedirectUri } from "../lib/keys.js";
import { formatQuotaReset, getTikTokQuota } from "../lib/tiktokQuota.js";
import { api } from "../lib/apiClient.js";

const TIKTOK_STATE_KEY = "sonozz.tiktok.oauth.state";
const TIKTOK_VERIFIER_KEY = "sonozz.tiktok.oauth.verifier";

const SECTION_META = {
  IA: { id: "ia", icon: Sparkles, blurb: "Gemini et génération audio / image." },
  Streaming: { id: "streaming", icon: Music2, blurb: "Spotify et Deezer pour le contexte catalogue." },
  "Distribution ONCE": {
    id: "distribution",
    icon: Radio,
    blurb: "Publication auto vers les stores via ONCE.",
  },
  Réseaux: {
    id: "reseaux",
    icon: Share2,
    blurb: "TikTok OAuth et webhook multi-réseaux.",
  },
};

function sectionFromQuery() {
  if (typeof window === "undefined") return "ia";
  const q = new URLSearchParams(window.location.search).get("section");
  const match = Object.values(SECTION_META).find((s) => s.id === q);
  return match?.id || "ia";
}

export default function SettingsPage() {
  const [keys, setKeys] = useState(loadKeys);
  const [section, setSection] = useState(sectionFromQuery);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectingTikTok, setConnectingTikTok] = useState(false);
  const [tiktokPreview, setTiktokPreview] = useState(null);
  const [tests, setTests] = useState(null);
  const [message, setMessage] = useState("");
  const redirectUri = typeof window !== "undefined" ? tiktokRedirectUri() : "";
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const activeGroup = useMemo(
    () => KEY_FIELDS.find((g) => SECTION_META[g.group]?.id === section) || KEY_FIELDS[0],
    [section],
  );

  useEffect(() => {
    setKeys(loadKeys());
    const params = new URLSearchParams(window.location.search);
    if (params.get("tiktok") === "connected") {
      setSection("reseaux");
      setMessage("TikTok connecté — access token enregistré.");
      window.history.replaceState({}, "", "/parametres?section=reseaux");
    }
  }, []);

  function selectSection(id) {
    setSection(id);
    setMessage("");
    const url = new URL(window.location.href);
    url.searchParams.set("section", id);
    window.history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString());
  }

  function update(id, value) {
    setKeys((prev) => ({ ...prev, [id]: value }));
  }

  function handleSave() {
    setSaving(true);
    const next = saveKeys(keys);
    setKeys(next);
    setMessage(
      keysReady(next)
        ? "Clés enregistrées localement."
        : "Enregistré — Gemini est encore requis pour l’auto.",
    );
    setSaving(false);
  }

  async function handleTest() {
    saveKeys(keys);
    setTesting(true);
    setMessage("");
    try {
      const { results } = await api.testKeys();
      setTests(results);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setTesting(false);
    }
  }

  async function handlePrepareTikTok() {
    setMessage("");
    setTiktokPreview(null);
    const clientKey = keys.tiktokClientKey?.trim();
    const clientSecret = keys.tiktokClientSecret?.trim();
    if (!clientKey || !clientSecret) {
      setMessage("Renseigne d’abord TikTok Client Key + Client Secret, puis Enregistrer.");
      selectSection("reseaux");
      return;
    }
    if (clientKey.length < 10 || clientSecret.length < 8) {
      setMessage("Client Key / Secret invalides — vérifie que tu n’as pas inversé les champs ni collé l’App ID.");
      return;
    }
    saveKeys(keys);
    setConnectingTikTok(true);
    try {
      const data = await api.tiktokAuthUrl();
      setTiktokPreview(data);
      setMessage(data.hint || "");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setConnectingTikTok(false);
    }
  }

  /** Un clic : invalide l’ancien token et ouvre TikTok avec video.upload. */
  async function handleReconnectTikTok() {
    setMessage("");
    setTiktokPreview(null);
    const clientKey = keys.tiktokClientKey?.trim();
    const clientSecret = keys.tiktokClientSecret?.trim();
    if (!clientKey || !clientSecret) {
      setMessage("Renseigne d’abord Client Key + Secret, puis Enregistrer.");
      selectSection("reseaux");
      return;
    }

    const cleared = {
      ...keys,
      tiktokAccessToken: "",
      tiktokRefreshToken: "",
      tiktokScope: "",
    };
    setKeys(cleared);
    saveKeys(cleared);
    setConnectingTikTok(true);
    try {
      const data = await api.tiktokAuthUrl();
      if (!data?.url) throw new Error("URL OAuth TikTok manquante");
      sessionStorage.setItem(TIKTOK_STATE_KEY, data.state);
      if (data.codeVerifier) {
        sessionStorage.setItem(TIKTOK_VERIFIER_KEY, data.codeVerifier);
      } else {
        sessionStorage.removeItem(TIKTOK_VERIFIER_KEY);
      }
      setMessage(`Redirection TikTok (scopes : ${data.scopes})…`);
      window.location.href = data.url;
    } catch (e) {
      setMessage(e.message);
      setConnectingTikTok(false);
    }
  }

  function handleConfirmTikTokRedirect() {
    if (!tiktokPreview?.url) return;
    sessionStorage.setItem(TIKTOK_STATE_KEY, tiktokPreview.state);
    if (tiktokPreview.codeVerifier) {
      sessionStorage.setItem(TIKTOK_VERIFIER_KEY, tiktokPreview.codeVerifier);
    } else {
      sessionStorage.removeItem(TIKTOK_VERIFIER_KEY);
    }
    window.location.href = tiktokPreview.url;
  }

  const meta = SECTION_META[activeGroup.group];
  const SectionIcon = meta?.icon || Sparkles;

  return (
    <AppShell
      active="parametres"
      title="Paramètres"
      subtitle="Clés API stockées dans ton navigateur. Sépare IA, streaming, distribution et réseaux."
    >
      <div class="flex flex-col gap-6 lg:flex-row lg:gap-8">
        {/* Section sidebar */}
        <nav
          class="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-visible"
          aria-label="Sections paramètres"
        >
          {KEY_FIELDS.map((group) => {
            const info = SECTION_META[group.group];
            const Icon = info?.icon || Sparkles;
            const id = info?.id || group.group;
            const isActive = section === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectSection(id)}
                class={`flex min-w-[9rem] items-center gap-2 border px-3 py-2.5 text-left text-sm transition lg:w-full ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-base-content/10 bg-base-200/40 text-base-content/70 hover:border-base-content/25"
                }`}
              >
                <Icon size={16} />
                <span class="font-medium">{group.group}</span>
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <section class="min-w-0 flex-1 animate-rise">
          <div class="mb-6 flex items-start gap-3">
            <div class="mt-0.5 text-primary">
              <SectionIcon size={22} />
            </div>
            <div>
              <h2 class="font-display text-xl font-bold md:text-2xl">{activeGroup.group}</h2>
              <p class="mt-1 text-sm text-base-content/55">{meta?.blurb}</p>
            </div>
          </div>

          <form
            class="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            {activeGroup.items.map((field) => (
              <label key={field.id} class="form-control block w-full max-w-xl">
                <span class="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span>
                    {field.label}
                    {field.required && <span class="text-primary"> *</span>}
                  </span>
                  {field.url && (
                    <a
                      href={field.url}
                      target="_blank"
                      rel="noreferrer"
                      class="inline-flex items-center gap-1 text-xs text-secondary hover:underline"
                    >
                      Obtenir <ExternalLink size={12} />
                    </a>
                  )}
                </span>
                {field.inputType === "select" ? (
                  <select
                    class="select select-bordered w-full bg-base-200"
                    value={keys[field.id] || field.options?.[0]?.value || ""}
                    onChange={(e) => update(field.id, e.currentTarget.value)}
                  >
                    {(field.options || []).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.inputType || "password"}
                    autocomplete="off"
                    name={field.id}
                    class="input input-bordered w-full bg-base-200 font-mono text-sm"
                    placeholder={field.placeholder}
                    value={keys[field.id] || ""}
                    onInput={(e) => update(field.id, e.currentTarget.value)}
                  />
                )}
                <span class="mt-1 text-xs text-base-content/45">{field.help}</span>
              </label>
            ))}
          </form>

          {section === "reseaux" && redirectUri && (
            <div class="mt-6 max-w-xl space-y-3 border border-warning/30 bg-warning/5 p-4 text-xs text-base-content/80">
              <p class="font-medium text-warning">Erreur TikTok « client_key » — checklist portail</p>
              <ol class="list-decimal space-y-1.5 pl-4">
                <li>
                  Ouvre{" "}
                  <a
                    class="link text-secondary"
                    href="https://developers.tiktok.com/apps"
                    target="_blank"
                    rel="noreferrer"
                  >
                    developers.tiktok.com/apps
                  </a>{" "}
                  → ton app → <strong>Credentials</strong> : copie la <strong>Client Key</strong> (pas App ID, pas
                  Secret).
                </li>
                <li>
                  Produits → <strong>Login Kit</strong> + <strong>Content Posting API</strong> avec
                  <strong> Direct Post</strong> ON. Scope <code>video.publish</code> obligatoire.
                </li>
                <li>
                  {isLocalhost ? (
                    <>
                      En local, Login Kit plateforme <strong>Desktop</strong> avec cette URI{" "}
                      <em>exactement</em> :
                    </>
                  ) : (
                    <>
                      En prod, Login Kit plateforme <strong>Web</strong> avec cette URI{" "}
                      <em>exactement</em> :
                    </>
                  )}
                  <code class="mt-1 block break-all font-mono text-[11px] text-primary">{redirectUri}</code>
                </li>
                <li>
                  Si Login Kit n’a que <strong>Web</strong> (HTTPS), le flux <code>localhost</code> échoue.
                  Connecte-toi alors sur{" "}
                  <a class="link text-secondary" href="https://sonozz.briseteia.me/parametres?section=reseaux">
                    sonozz.briseteia.me
                  </a>{" "}
                  (<code class="text-primary">https://sonozz.briseteia.me/tiktok/callback</code>).
                </li>
                <li>
                  Content Posting activé ≠ token à jour. Clique <strong>Reconnecter</strong> et accepte
                  <code>video.publish</code> (Direct Post). Sans ça, rien ne part sur le profil.
                </li>
              </ol>
            </div>
          )}

          {tiktokPreview && section === "reseaux" && (
            <div class="mt-4 max-w-xl space-y-2 border border-base-content/15 bg-base-200/60 p-4 text-xs">
              <p class="font-medium text-base-content">Prévisualisation OAuth</p>
              <p>
                Mode : <strong>{tiktokPreview.mode}</strong> · Key :{" "}
                <code>{tiktokPreview.clientKeyPreview}</code> · Scope :{" "}
                <code>{tiktokPreview.scopes}</code>
              </p>
              <p>
                Redirect : <code class="break-all text-primary">{tiktokPreview.redirectUri}</code>
              </p>
              <p class="break-all text-base-content/50">{tiktokPreview.url}</p>
              <button type="button" class="btn btn-secondary btn-sm gap-2" onClick={handleConfirmTikTokRedirect}>
                <Link2 size={14} />
                Continuer vers TikTok
              </button>
            </div>
          )}

          {tests && (
            <ul class="mt-6 max-w-xl space-y-2 border-t border-base-content/10 pt-4">
              {Object.entries(tests).map(([name, result]) => (
                <li key={name} class="flex items-start gap-2 text-sm">
                  {result.ok ? (
                    <CheckCircle2 size={16} class="mt-0.5 text-success" />
                  ) : (
                    <XCircle size={16} class="mt-0.5 text-base-content/35" />
                  )}
                  <span>
                    <span class="font-medium capitalize">{name}</span> — {result.message}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {message && <p class="mt-4 text-sm text-primary">{message}</p>}

          {section === "reseaux" && (
            <div class="mt-4 max-w-xl border border-base-content/10 bg-base-200/40 p-3 text-xs space-y-1">
              <p>
                Scope token actuel :{" "}
                <code class={/video\.publish/i.test(keys.tiktokScope || "") ? "text-success" : "text-warning"}>
                  {keys.tiktokScope?.trim() || "(vide — reconnecte)"}
                </code>
              </p>
              {!/video\.publish/i.test(keys.tiktokScope || "") && (
                <p class="text-warning">
                  Il manque <code>video.publish</code>. Clique Reconnecter et accepte Direct Post.
                  Sur developers.tiktok.com → ton app → <strong>Scopes</strong> : coche video.publish.
                </p>
              )}
              {(() => {
                const q = getTikTokQuota();
                return (
                  <p class={q.blocked ? "text-error" : "text-base-content/70"}>
                    Compteur envois TikTok (24 h) : {q.used}/{q.limit}
                    {q.blocked ? ` — reset ${formatQuotaReset(q.resetsAt)}` : ` — ${q.remaining} restant(s)`}
                  </p>
                );
              })()}
            </div>
          )}

          <div class="mt-8 flex flex-wrap gap-3">
            <button type="button" class="btn btn-primary gap-2" onClick={handleSave} disabled={saving}>
              <Save size={16} />
              Enregistrer
            </button>
            {section === "reseaux" && (
              <>
                <button
                  type="button"
                  class="btn btn-secondary gap-2"
                  onClick={handleReconnectTikTok}
                  disabled={connectingTikTok}
                >
                  {connectingTikTok ? (
                    <span class="loading loading-spinner loading-sm" />
                  ) : (
                    <Link2 size={16} />
                  )}
                  Reconnecter
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm gap-2"
                  onClick={handlePrepareTikTok}
                  disabled={connectingTikTok}
                >
                  Prévisualiser OAuth
                </button>
              </>
            )}
            <button type="button" class="btn btn-outline gap-2" onClick={handleTest} disabled={testing}>
              {testing ? <span class="loading loading-spinner loading-sm" /> : <PlugZap size={16} />}
              Tester les connexions
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
