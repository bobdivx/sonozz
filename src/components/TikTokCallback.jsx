import { useEffect, useState } from "preact/hooks";
import { loadKeys, saveKeys } from "../lib/keys.js";

const STATE_KEY = "sonozz.tiktok.oauth.state";
const VERIFIER_KEY = "sonozz.tiktok.oauth.verifier";

export default function TikTokCallback() {
  const [status, setStatus] = useState("Connexion TikTok…");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const err = params.get("error");
    const errDesc = params.get("error_description");

    if (err) {
      setError(errDesc || err);
      setStatus("Échec");
      return;
    }

    if (!code) {
      setError("Aucun code OAuth reçu. Vérifie la Redirect URI dans TikTok Developers.");
      setStatus("Échec");
      return;
    }

    const expected = sessionStorage.getItem(STATE_KEY);
    if (expected && state && expected !== state) {
      setError("State OAuth invalide (CSRF). Relance « Connecter TikTok ».");
      setStatus("Échec");
      return;
    }

    const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
    const isLocal =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocal && !codeVerifier) {
      setError("code_verifier PKCE manquant. Relance « Connecter TikTok » depuis Paramètres.");
      setStatus("Échec");
      return;
    }

    (async () => {
      try {
        const keys = loadKeys();
        if (!keys.tiktokClientKey?.trim() || !keys.tiktokClientSecret?.trim()) {
          throw new Error(
            "Client Key / Secret absents du navigateur. Enregistre-les dans Paramètres avant de connecter.",
          );
        }

        const redirectUri = `${window.location.origin}/tiktok/callback`;
        const res = await fetch("/api/tiktok/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys, code, redirectUri, codeVerifier }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        saveKeys({
          ...keys,
          tiktokAccessToken: data.accessToken || "",
          tiktokRefreshToken: data.refreshToken || keys.tiktokRefreshToken || "",
        });
        sessionStorage.removeItem(STATE_KEY);
        sessionStorage.removeItem(VERIFIER_KEY);
        setStatus("TikTok connecté. Tu peux fermer cet onglet.");
        setTimeout(() => {
          window.location.href = "/parametres?tiktok=connected&section=reseaux";
        }, 1200);
      } catch (e) {
        setError(e.message || "Échange impossible");
        setStatus("Échec");
      }
    })();
  }, []);

  return (
    <div class="mx-auto max-w-lg px-4 py-16 text-center">
      <p class="text-xs uppercase tracking-[0.22em] text-primary">SONOZZ × TikTok</p>
      <h1 class="font-display mt-2 text-3xl font-bold">{status}</h1>
      {error ? (
        <p class="mt-4 text-sm text-error">{error}</p>
      ) : (
        <p class="mt-4 text-sm text-base-content/60">Échange du code contre un access token…</p>
      )}
      <p class="mt-8">
        <a href="/parametres?section=reseaux" class="link">
          ← Retour aux paramètres
        </a>
      </p>
    </div>
  );
}
