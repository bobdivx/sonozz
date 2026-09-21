import { useState } from "preact/hooks";
import { Pressable } from "./ui/Motion.jsx";

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
  // Toujours afficher email/mot de passe (comptes DB) — SSO en complément, pas à la place.
  const [passwordOpen, setPasswordOpen] = useState(true);

  const queryError = ERROR_MESSAGES[errorCode] || "";
  const alert = error || queryError;
  const ssoFirst = preferSso && oidcConfigured;
  // Formulaire mdp toujours dispo si auth env OU comptes utilisateurs (studio).
  const showPassword = passwordConfigured !== false;

  const ssoButton = oidcConfigured ? (
    <Pressable
      as="a"
      href={ssoStartHref(next)}
      class={`btn w-full cursor-pointer ${ssoFirst ? "btn-primary" : "btn-outline"}`}
      scale={0.97}
    >
      Continuer avec Pocket ID
    </Pressable>
  ) : null;

  const passwordForm = showPassword ? (
    <form
      class="space-y-4"
      method="POST"
      action={`/login?next=${encodeURIComponent(next)}`}
      data-astro-reload
    >
      <p class="text-center text-sm text-base-content/55">Connexion au studio</p>
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

      {alert && (
        <p class="rounded-md bg-error/15 px-3 py-2 text-sm text-error" role="alert">
          {alert}
        </p>
      )}

      <button type="submit" class="btn btn-ghost w-full cursor-pointer border border-base-content/15">
        Se connecter au studio
      </button>
      <p class="text-center text-sm text-base-content/55">
        Nouveau ?{" "}
        <a class="link link-primary" href={`/signup?next=${encodeURIComponent(next)}`}>
          Créer un compte
        </a>
      </p>
    </form>
  ) : null;

  const divider = oidcConfigured && showPassword ? (
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
      {(passwordOpen || !ssoFirst) && passwordForm}
      {ssoFirst && showPassword && !passwordOpen && (
        <button
          type="button"
          class="btn btn-ghost btn-sm w-full cursor-pointer text-base-content/60"
          onClick={() => setPasswordOpen(true)}
        >
          Connexion email / mot de passe
        </button>
      )}
      {!ssoFirst && divider}
      {!ssoFirst && ssoButton}
      {!oidcConfigured && showPassword && (
        <p class="text-center text-xs text-base-content/40">
          Pocket ID non configuré en local (OIDC_* absentes).
        </p>
      )}
      {!showPassword && alert && (
        <p class="rounded-md bg-error/15 px-3 py-2 text-sm text-error" role="alert">
          {alert}
        </p>
      )}
    </div>
  );
}
