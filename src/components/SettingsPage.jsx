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
  AudioLines,
  Radio,
  Share2,
  Shield,
  Users,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
import PocketIdAccount from "./PocketIdAccount.jsx";
import ChangePasswordForm from "./ChangePasswordForm.jsx";
import TeamPanel from "./TeamPanel.jsx";
import {
  KEY_FIELDS,
  loadKeys,
  saveKeys,
  saveKeysAsync,
  ensureKeysHydrated,
  keysReady,
  tiktokRedirectUri,
  youtubeRedirectUri,
  fieldVisible,
} from "../lib/keys.js";
import { formatQuotaReset, getTikTokQuota } from "../lib/tiktokQuota.js";
import { formatYouTubeQuotaReset, getYouTubeQuota } from "../lib/youtubeQuota.js";
import { api } from "../lib/apiClient.js";
import MusicStudiosPanel from "./MusicStudiosPanel.jsx";

const TIKTOK_STATE_KEY = "sonozz.tiktok.oauth.state";
const TIKTOK_VERIFIER_KEY = "sonozz.tiktok.oauth.verifier";
const YOUTUBE_STATE_KEY = "sonozz.youtube.oauth.state";
const YOUTUBE_VERIFIER_KEY = "sonozz.youtube.oauth.verifier";

const SECTION_META = {
  Compte: {
    id: "compte",
    icon: Shield,
    blurb: "Mot de passe et liaison Pocket ID pour ce compte.",
  },
  Équipe: {
    id: "equipe",
    icon: Users,
    blurb: "Inviter des membres au studio. Ils n’auront pas accès aux clés sensibles.",
  },
  IA: { id: "ia", icon: Sparkles, blurb: "Texte, images et clips : Gemini, Ollama, Veo / Wan2GP." },
  Morceaux: {
    id: "morceaux",
    icon: AudioLines,
    blurb: "Configure ACE-Step, SongGeneration et MiniMax, vois leur état, puis choisis le moteur actif.",
  },
  Streaming: { id: "streaming", icon: Music2, blurb: "Spotify et Deezer pour le contexte catalogue." },
  "Distribution ONCE": {
    id: "distribution",
    icon: Radio,
    blurb: "Publication auto vers les stores via ONCE.",
  },
  Réseaux: {
    id: "reseaux",
    icon: Share2,
    blurb: "TikTok, YouTube Shorts et webhook multi-réseaux.",
  },
};

function sectionFromQuery() {
  if (typeof window === "undefined") return "ia";
  const q = new URLSearchParams(window.location.search).get("section");
  const match = Object.values(SECTION_META).find((s) => s.id === q);
  return match?.id || "ia";
}

const SETTINGS_NAV = [
  { group: "Compte", items: [] },
  { group: "Équipe", items: [] },
  ...KEY_FIELDS,
];

export default function SettingsPage() {
  const [keys, setKeys] = useState(loadKeys);
  const [section, setSection] = useState(sectionFromQuery);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectingTikTok, setConnectingTikTok] = useState(false);
  const [tiktokPreview, setTiktokPreview] = useState(null);
  const [connectingYouTube, setConnectingYouTube] = useState(false);
  const [youtubePreview, setYoutubePreview] = useState(null);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookConfig, setWebhookConfig] = useState(null);
  const [webhookSecretDraft, setWebhookSecretDraft] = useState("");
  const [tests, setTests] = useState(null);
  const [message, setMessage] = useState("");
  const redirectUri = typeof window !== "undefined" ? tiktokRedirectUri() : "";
  const ytRedirectUri = typeof window !== "undefined" ? youtubeRedirectUri() : "";
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const activeGroup = useMemo(() => {
    if (section === "compte") return { group: "Compte", items: [] };
    if (section === "equipe") return { group: "Équipe", items: [] };
    return KEY_FIELDS.find((g) => SECTION_META[g.group]?.id === section) || KEY_FIELDS[0];
  }, [section]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hydrated = await ensureKeysHydrated();
      if (!cancelled) setKeys(hydrated);
    })();
    const params = new URLSearchParams(window.location.search);
    if (params.get("tiktok") === "connected") {
      setSection("reseaux");
      setMessage("TikTok connecté — access token enregistré sur Turso.");
      window.history.replaceState({}, "", "/parametres?section=reseaux");
    }
    if (params.get("youtube") === "connected") {
      setSection("reseaux");
      setMessage("YouTube connecté — access token enregistré sur Turso.");
      window.history.replaceState({}, "", "/parametres?section=reseaux");
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (section !== "distribution") return;
    fetch("/api/once/webhooks")
      .then((r) => r.json())
      .then((j) => setWebhookConfig(j.config || null))
      .catch(() => setWebhookConfig(null));
  }, [section]);

  async function registerOnceWebhook() {
    setWebhookBusy(true);
    setMessage("");
    try {
      await handleSave();
      const k = loadKeys();
      if (!k.onceApiToken?.trim()) {
        throw new Error("Enregistre d’abord le token ONCE.");
      }
      const base = window.location.origin;
      if (!/^https:\/\//i.test(base)) {
        throw new Error(
          "ONCE exige une URL HTTPS publique. Ouvre sonozz.briseteia.me (ou ton déploiement) pour enregistrer le webhook — pas localhost.",
        );
      }
      const res = await fetch("/api/once/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          keys: k,
          publicBaseUrl: base,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.config) setWebhookConfig(json.config);
      if (!res.ok) throw new Error(json.error || "Enregistrement webhook KO");
      setWebhookConfig(json.config || null);
      setMessage(`Webhook ONCE actif → ${json.url || json.config?.url}`);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setWebhookBusy(false);
    }
  }

  async function saveOnceWebhookSecret() {
    setWebhookBusy(true);
    setMessage("");
    try {
      const k = loadKeys();
      const res = await fetch("/api/once/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_secret",
          keys: k,
          secret: webhookSecretDraft,
          webhookUrl: `${window.location.origin}/api/once/webhook`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Secret non enregistré");
      setWebhookConfig(json.config || null);
      setWebhookSecretDraft("");
      setMessage("Secret webhook ONCE enregistré.");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setWebhookBusy(false);
    }
  }

  async function unregisterOnceWebhook() {
    setWebhookBusy(true);
    setMessage("");
    try {
      const k = loadKeys();
      const res = await fetch("/api/once/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unregister", keys: k }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Suppression KO");
      setWebhookConfig(json.config || null);
      setMessage("Webhook ONCE désenregistré.");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setWebhookBusy(false);
    }
  }

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

  async function handleSave() {
    setSaving(true);
    setMessage("");
    try {
      const { keys: next, labelSync } = await saveKeysAsync(keys);
      setKeys(next);
      let msg = keysReady(next)
        ? next.llmProvider === "ollama"
          ? "Clés enregistrées sur Turso — texte via Ollama."
          : "Clés enregistrées sur Turso."
        : next.llmProvider === "ollama"
          ? "Enregistré sur Turso — modèle Ollama encore requis."
          : "Enregistré sur Turso — Gemini est encore requis pour l’auto.";
      if (labelSync?.updated != null && next.distrokidLabel?.trim()) {
        msg += ` Label « ${labelSync.label} » forcé sur ${labelSync.updated}/${labelSync.total} artiste(s).`;
      } else if (labelSync?.error) {
        msg += ` Sync label artistes : ${labelSync.error}`;
      }
      setMessage(msg);
    } catch (e) {
      setMessage(e.message || "Échec sauvegarde Turso");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    try {
      await saveKeysAsync(keys);
    } catch {
      saveKeys(keys);
    }
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
    try {
      await saveKeysAsync(keys);
    } catch {
      saveKeys(keys);
    }
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
    try {
      await saveKeysAsync(cleared);
    } catch {
      saveKeys(cleared);
    }
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

  async function handlePrepareYouTube() {
    setMessage("");
    setYoutubePreview(null);
    const clientId = keys.youtubeClientId?.trim();
    const clientSecret = keys.youtubeClientSecret?.trim();
    if (!clientId || !clientSecret) {
      setMessage("Renseigne d’abord YouTube Client ID + Client Secret, puis Enregistrer.");
      selectSection("reseaux");
      return;
    }
    try {
      await saveKeysAsync(keys);
    } catch {
      saveKeys(keys);
    }
    setConnectingYouTube(true);
    try {
      const data = await api.youtubeAuthUrl();
      setYoutubePreview(data);
      setMessage(data.hint || "");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setConnectingYouTube(false);
    }
  }

  async function handleReconnectYouTube() {
    setMessage("");
    setYoutubePreview(null);
    const clientId = keys.youtubeClientId?.trim();
    const clientSecret = keys.youtubeClientSecret?.trim();
    if (!clientId || !clientSecret) {
      setMessage("Renseigne d’abord YouTube Client ID + Secret, puis Enregistrer.");
      selectSection("reseaux");
      return;
    }

    const cleared = {
      ...keys,
      youtubeAccessToken: "",
      youtubeRefreshToken: "",
      youtubeScope: "",
    };
    setKeys(cleared);
    try {
      await saveKeysAsync(cleared);
    } catch {
      saveKeys(cleared);
    }
    setConnectingYouTube(true);
    try {
      const data = await api.youtubeAuthUrl();
      if (!data?.url) throw new Error("URL OAuth YouTube manquante");
      sessionStorage.setItem(YOUTUBE_STATE_KEY, data.state);
      if (data.codeVerifier) {
        sessionStorage.setItem(YOUTUBE_VERIFIER_KEY, data.codeVerifier);
      } else {
        sessionStorage.removeItem(YOUTUBE_VERIFIER_KEY);
      }
      setMessage(`Redirection Google (scopes : ${data.scopes})…`);
      window.location.href = data.url;
    } catch (e) {
      setMessage(e.message);
      setConnectingYouTube(false);
    }
  }

  function handleConfirmYouTubeRedirect() {
    if (!youtubePreview?.url) return;
    sessionStorage.setItem(YOUTUBE_STATE_KEY, youtubePreview.state);
    if (youtubePreview.codeVerifier) {
      sessionStorage.setItem(YOUTUBE_VERIFIER_KEY, youtubePreview.codeVerifier);
    } else {
      sessionStorage.removeItem(YOUTUBE_VERIFIER_KEY);
    }
    window.location.href = youtubePreview.url;
  }

  const meta = SECTION_META[activeGroup.group];
  const SectionIcon = meta?.icon || Sparkles;

  return (
    <AppShell
      active="parametres"
      title="Paramètres"
      subtitle="Clés API stockées dans ton navigateur. Sépare IA, morceaux, streaming, distribution et réseaux."
    >
      <div class="flex flex-col gap-6 lg:flex-row lg:gap-8">
        {/* Section sidebar */}
        <nav
          class="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-visible"
          aria-label="Sections paramètres"
        >
          {SETTINGS_NAV.map((group) => {
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

          {section === "compte" ? (
            <div class="space-y-8">
              <ChangePasswordForm />
              <div>
                <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-base-content/50">
                  Pocket ID
                </h3>
                <PocketIdAccount />
              </div>
            </div>
          ) : section === "equipe" ? (
            <TeamPanel />
          ) : section === "morceaux" ? (
            <MusicStudiosPanel
              keys={keys}
              onChange={update}
              onKeysReplace={setKeys}
            />
          ) : (
          <form
            class="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            {activeGroup.items.filter((field) => fieldVisible(field, keys)).map((field) => (
              <label key={field.id} class="form-control block w-full max-w-xl">
                <span class="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span>
                    {field.label}
                    {field.required && <span class="text-primary"> *</span>}
                    {field.id === "geminiApiKey" && keys.llmProvider !== "ollama" && (
                      <span class="text-primary"> *</span>
                    )}
                    {field.id === "ollamaModel" && keys.llmProvider === "ollama" && (
                      <span class="text-primary"> *</span>
                    )}
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
          )}

          {section === "distribution" && (
            <div class="mt-8 max-w-xl space-y-3 border border-base-content/10 bg-base-200/40 p-4">
              <h3 class="font-display text-lg font-semibold">Webhook carrière ONCE</h3>
              <p class="text-xs text-base-content/60">
                ONCE pousse <code>release.status_changed</code> → SONOZZ met à jour le statut stores /
                ISRC et recalcule l’agent carrière (sans refresh manuel).
              </p>
              {webhookConfig?.registered ? (
                <div class="space-y-2 text-sm">
                  <p class="text-success">Actif{webhookConfig.hasSecret ? "" : " — secret manquant"}</p>
                  <p class="break-all font-mono text-xs text-base-content/55">{webhookConfig.url}</p>
                  {webhookConfig.lastEvent && (
                    <p class="text-xs text-base-content/50">
                      Dernier event : {webhookConfig.lastEvent.status || "—"}
                      {webhookConfig.lastEvent.careerVerdict
                        ? ` · verdict ${webhookConfig.lastEvent.careerVerdict}`
                        : ""}
                      {webhookConfig.lastEvent.at
                        ? ` · ${new Date(webhookConfig.lastEvent.at).toLocaleString("fr-FR")}`
                        : ""}
                    </p>
                  )}
                  <button
                    type="button"
                    class="btn btn-outline btn-sm"
                    disabled={webhookBusy}
                    onClick={unregisterOnceWebhook}
                  >
                    Désenregistrer
                  </button>
                </div>
              ) : (
                <div class="space-y-3">
                  <button
                    type="button"
                    class="btn btn-primary btn-sm gap-2"
                    disabled={webhookBusy}
                    onClick={registerOnceWebhook}
                  >
                    {webhookBusy ? (
                      <span class="loading loading-spinner loading-sm" />
                    ) : (
                      <PlugZap size={14} />
                    )}
                    Activer le webhook ONCE
                  </button>
                  <p class="text-xs text-base-content/50">
                    Sur once.app tu as déjà 2 endpoints (tunnel + prod) sans secret côté SONOZZ.
                    Supprime-les, puis réactive ici depuis <code>https://sonozz.briseteia.me</code>
                    pour n’en garder qu’un avec secret stocké.
                  </p>
                </div>
              )}
              {!webhookConfig?.hasSecret && (
                <label class="form-control w-full gap-1">
                  <span class="text-xs text-base-content/60">
                    Secret signing (copié une seule fois à la création)
                  </span>
                  <div class="flex flex-wrap gap-2">
                    <input
                      type="password"
                      class="input input-bordered input-sm min-w-0 flex-1 font-mono"
                      placeholder="whsec_…"
                      value={webhookSecretDraft}
                      onInput={(e) => setWebhookSecretDraft(e.currentTarget.value)}
                    />
                    <button
                      type="button"
                      class="btn btn-outline btn-sm"
                      disabled={webhookBusy || !webhookSecretDraft.trim()}
                      onClick={saveOnceWebhookSecret}
                    >
                      Enregistrer le secret
                    </button>
                  </div>
                </label>
              )}
              <p class="text-xs text-base-content/45">
                HTTPS obligatoire (prod). Localhost : utilise un tunnel ou enregistre depuis le domaine
                déployé. « last delivery never » = aucun changement de statut release depuis
                l’enregistrement (normal tant qu’aucune release ne bouge).
              </p>
            </div>
          )}

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

          {section === "reseaux" && ytRedirectUri && (
            <div class="mt-6 max-w-xl space-y-3 border border-secondary/30 bg-secondary/5 p-4 text-xs text-base-content/80">
              <p class="font-medium text-secondary">YouTube Shorts — checklist Google Cloud</p>
              <ol class="list-decimal space-y-1.5 pl-4">
                <li>
                  Ouvre{" "}
                  <a
                    class="link text-secondary"
                    href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    YouTube Data API v3
                  </a>{" "}
                  → Active l’API sur ton projet.
                </li>
                <li>
                  <a
                    class="link text-secondary"
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Identifiants
                  </a>{" "}
                  → Créer OAuth 2.0 → type <strong>Application Web</strong>. Colle Client ID + Secret
                  ci-dessus.
                </li>
                <li>
                  URI de redirection autorisée (<strong>https</strong>, exacte — pas http) :
                  <code class="mt-1 block break-all font-mono text-[11px] text-primary">{ytRedirectUri}</code>
                  Dans Google Cloud, ajoute exactement cette URI (sans slash final).
                </li>
                <li>
                  Écran de consentement OAuth → type <strong>External</strong> → ajoute ton compte Google
                  en <strong>utilisateur test</strong> (sinon « app non vérifiée » bloque).
                </li>
                <li>
                  Scope demandé : <code>youtube.upload</code>. Visibilité par défaut = Privé (test).
                  Quota free ≈ 6 Shorts / jour.
                </li>
              </ol>
            </div>
          )}

          {youtubePreview && section === "reseaux" && (
            <div class="mt-4 max-w-xl space-y-2 border border-base-content/15 bg-base-200/60 p-4 text-xs">
              <p class="font-medium text-base-content">Prévisualisation OAuth YouTube</p>
              <p>
                Key : <code>{youtubePreview.clientIdPreview}</code> · Scope :{" "}
                <code class="break-all">{youtubePreview.scopes}</code>
              </p>
              <p>
                Redirect : <code class="break-all text-primary">{youtubePreview.redirectUri}</code>
              </p>
              <p class="break-all text-base-content/50">{youtubePreview.url}</p>
              <button type="button" class="btn btn-secondary btn-sm gap-2" onClick={handleConfirmYouTubeRedirect}>
                <Link2 size={14} />
                Continuer vers Google
              </button>
            </div>
          )}

          {tiktokPreview && section === "reseaux" && (
            <div class="mt-4 max-w-xl space-y-2 border border-base-content/15 bg-base-200/60 p-4 text-xs">
              <p class="font-medium text-base-content">Prévisualisation OAuth TikTok</p>
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
            <div class="mt-4 max-w-xl border border-base-content/10 bg-base-200/40 p-3 text-xs space-y-2">
              <p>
                Scope TikTok :{" "}
                <code class={/video\.publish/i.test(keys.tiktokScope || "") ? "text-success" : "text-warning"}>
                  {keys.tiktokScope?.trim() || "(vide — reconnecte)"}
                </code>
              </p>
              {!/video\.publish/i.test(keys.tiktokScope || "") && (
                <p class="text-warning">
                  Il manque <code>video.publish</code>. Clique Reconnecter TikTok et accepte Direct Post.
                </p>
              )}
              {(() => {
                const q = getTikTokQuota();
                return (
                  <p class={q.blocked ? "text-error" : "text-base-content/70"}>
                    Compteur TikTok (24 h) : {q.used}/{q.limit}
                    {q.blocked ? ` — reset ${formatQuotaReset(q.resetsAt)}` : ` — ${q.remaining} restant(s)`}
                  </p>
                );
              })()}
              <p class="border-t border-base-content/10 pt-2">
                Scope YouTube :{" "}
                <code class={/youtube\.upload/i.test(keys.youtubeScope || "") ? "text-success" : "text-warning"}>
                  {keys.youtubeScope?.trim() || "(vide — connecte YouTube)"}
                </code>
              </p>
              {(() => {
                const q = getYouTubeQuota();
                return (
                  <p class={q.blocked ? "text-error" : "text-base-content/70"}>
                    Compteur YouTube (jour PT) : {q.used}/{q.limit}
                    {q.blocked
                      ? ` — reset ${formatYouTubeQuotaReset(q.resetsAt)}`
                      : ` — ${q.remaining} restant(s)`}
                  </p>
                );
              })()}
            </div>
          )}

          {section !== "compte" && (
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
                  disabled={connectingTikTok || connectingYouTube}
                >
                  {connectingTikTok ? (
                    <span class="loading loading-spinner loading-sm" />
                  ) : (
                    <Link2 size={16} />
                  )}
                  Reconnecter TikTok
                </button>
                <button
                  type="button"
                  class="btn btn-secondary gap-2"
                  onClick={handleReconnectYouTube}
                  disabled={connectingTikTok || connectingYouTube}
                >
                  {connectingYouTube ? (
                    <span class="loading loading-spinner loading-sm" />
                  ) : (
                    <Link2 size={16} />
                  )}
                  Connecter YouTube
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm gap-2"
                  onClick={handlePrepareTikTok}
                  disabled={connectingTikTok}
                >
                  Prévisualiser TikTok
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm gap-2"
                  onClick={handlePrepareYouTube}
                  disabled={connectingYouTube}
                >
                  Prévisualiser YouTube
                </button>
              </>
            )}
            <button type="button" class="btn btn-outline gap-2" onClick={handleTest} disabled={testing}>
              {testing ? <span class="loading loading-spinner loading-sm" /> : <PlugZap size={16} />}
              Tester les connexions
            </button>
          </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
