import { useEffect, useState } from "preact/hooks";

const SSO_PASSWORD_BLOCKED = "Ce compte se connecte avec Pocket ID";

const ERROR_MESSAGES = {
  sso: "Connexion Pocket ID impossible. Réessaie.",
  sso_config: "SSO Pocket ID non configuré sur le serveur.",
  sso_email: "Pocket ID n’a pas renvoyé d’email.",
  sso_taken: "Ce compte Pocket ID est déjà lié à un autre utilisateur.",
  sso_mismatch: "L’email Pocket ID ne correspond pas à ce compte.",
  sso_invite: "Compte inconnu — demande une invitation au studio.",
};

function ssoStartHref(next, intent = "login") {
  const params = new URLSearchParams();
  if (next && next !== "/" && next !== "/studio") params.set("next", next);
  if (intent === "link") params.set("intent", "link");
  const q = params.toString();
  return `/api/auth/pocket-id${q ? `?${q}` : ""}`;
}

export default function LoginForm({
  next = "/studio",
  error = "",
  errorCode = "",
  initialEmail = "",
  oidcConfigured = false,
  passwordConfigured = true,
  preferSso = false,
}) {
  const [email, setEmail] = useState(String(initialEmail || ""));
  const [ssoLinked, setSsoLinked] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(!preferSso);

  const queryError = ERROR_MESSAGES[errorCode] || "";
  const alert = error || queryError;
  const ssoRequired =
    alert === SSO_PASSWORD_BLOCKED || errorCode === "sso_config";

  useEffect(() => {
    const value = email.trim().toLowerCase();
    if (!oidcConfigured || !value.includes("@")) {
      setSsoLinked(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/auth/sso-status?email=${encodeURIComponent(value)}`)
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) setSsoLinked(Boolean(d?.ssoLinked));
        })
        .catch(() => {
          if (!cancelled) setSsoLinked(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [email, oidcConfigured]);

  // Compte SSO connu (API ou erreur serveur) → masquer le mot de passe.
  const hidePassword = ssoLinked || ssoRequired;
  const ssoFirst = preferSso || hidePassword || ssoRequired;

  const ssoButton = oidcConfigured ? (
    <a
      href={ssoStartHref(next)}
      class={`btn w-full ${ssoFirst ? "btn-primary" : "btn-outline"}`}
    >
      Continuer avec Pocket ID
    </a>
  ) : null;

  const ssoMissingConfig = !oidcConfigured && hidePassword ? (
    <p class="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning" role="status">
      {SSO_PASSWORD_BLOCKED}. Le SSO n’est pas configuré sur ce serveur (variables{" "}
      <code class="text-xs">OIDC_ISSUER</code>, <code class="text-xs">OIDC_CLIENT_ID</code>,{" "}
      <code class="text-xs">OIDC_CLIENT_SECRET</code> manquantes). Utilise{" "}
      <a class="underline" href="https://sonozz.briseteia.me/login">
        sonozz.briseteia.me
      </a>{" "}
      ou ajoute-les au <code class="text-xs">.env</code> local.
    </p>
  ) : null;

  const passwordForm = passwordConfigured && !hidePassword ? (
    <form
      class="space-y-4"
      method="POST"
      action={`/login?next=${encodeURIComponent(next)}`}
      data-astro-reload
    >
      <p class="text-center text-sm text-base-content/55">Connexion réservée à l’équipe</p>
      <input type="hidden" name="next" value={next} />

      <label class="form-control w-full">
        <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
          Email
        </span>
        <input
          type="email"
          name="email"
          class="input input-bordered w-full bg-base-200/80"
          autocomplete="username"
          required
          value={email}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </label>

      <label class="form-control w-full">
        <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
          Mot de passe
        </span>
        <input
          type="password"
          name="password"
          class="input input-bordered w-full bg-base-200/80"
          autocomplete="current-password"
          required
        />
      </label>

      {alert && !ssoRequired && (
        <p class="rounded-md bg-error/15 px-3 py-2 text-sm text-error" role="alert">
          {alert}
        </p>
      )}

      <button type="submit" class="btn btn-ghost w-full border border-base-content/15">
        Se connecter au studio
      </button>
    </form>
  ) : null;

  const ssoOnlyBlock = hidePassword ? (
    <div class="space-y-4">
      <label class="form-control w-full">
        <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
          Email
        </span>
        <input
          type="email"
          class="input input-bordered w-full bg-base-200/80"
          autocomplete="username"
          value={email}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </label>
      {oidcConfigured ? (
        <p class="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning" role="status">
          {SSO_PASSWORD_BLOCKED} — utilise le bouton ci-dessus.
        </p>
      ) : (
        ssoMissingConfig
      )}
    </div>
  ) : null;

  const divider = oidcConfigured && passwordConfigured && !hidePassword ? (
    <div
      class="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-base-content/40"
      aria-hidden="true"
    >
      <span class="h-px flex-1 bg-base-content/15"></span>
      ou
      <span class="h-px flex-1 bg-base-content/15"></span>
    </div>
  ) : null;

  return (
    <div class="space-y-4">
      {ssoFirst && ssoButton}
      {ssoFirst && divider}
      {hidePassword ? ssoOnlyBlock : passwordOpen || !ssoFirst ? passwordForm : null}
      {!hidePassword && ssoFirst && passwordConfigured && !passwordOpen && (
        <button
          type="button"
          class="btn btn-ghost btn-sm w-full text-base-content/60"
          onClick={() => setPasswordOpen(true)}
        >
          Connexion email / mot de passe
        </button>
      )}
      {!ssoFirst && divider}
      {!ssoFirst && ssoButton}
      {!oidcConfigured && !hidePassword && passwordConfigured && (
        <p class="text-center text-xs text-base-content/40">
          Pocket ID non configuré en local (OIDC_* absentes).
        </p>
      )}
      {hidePassword && alert && alert !== SSO_PASSWORD_BLOCKED && (
        <p class="rounded-md bg-error/15 px-3 py-2 text-sm text-error" role="alert">
          {alert}
        </p>
      )}
    </div>
  );
}
