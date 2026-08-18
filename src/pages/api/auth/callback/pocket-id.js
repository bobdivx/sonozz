import { publicOrigin } from "../../../../server/http.js";
import {
  createSessionToken,
  getSessionFromCookies,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../../../../server/auth.js";
import { upsertUserFromOidc } from "../../../../server/users.js";
import {
  CALLBACK_PATH,
  OIDC_INTENT_COOKIE,
  OIDC_NEXT_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  SSO_HINT_COOKIE,
  claimsFromOidcTokens,
  exchangeOidcCode,
  fetchOidcDiscovery,
  fetchOidcUserinfo,
  getOidcConfig,
  isOidcConfigured,
  oidcCookieOptions,
} from "../../../../server/oidc.js";

export const prerender = false;

function safeNext(raw) {
  if (!raw || typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login") || raw.startsWith("/api/")) return "/";
  return raw;
}

function clearOidcCookies(cookies) {
  const gone = { ...oidcCookieOptions(0), maxAge: 0 };
  cookies.set(OIDC_STATE_COOKIE, "", gone);
  cookies.set(OIDC_VERIFIER_COOKIE, "", gone);
  cookies.set(OIDC_NEXT_COOKIE, "", gone);
  cookies.set(OIDC_INTENT_COOKIE, "", gone);
}

function loginError(cookies, code) {
  clearOidcCookies(cookies);
  return new Response(null, {
    status: 302,
    headers: { Location: `/login?error=${encodeURIComponent(code)}` },
  });
}

export async function GET({ request, cookies, url }) {
  if (!isOidcConfigured()) {
    return loginError(cookies, "sso_config");
  }

  const idpError = url.searchParams.get("error");
  if (idpError) {
    return loginError(cookies, "sso");
  }

  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const stored = cookies.get(OIDC_STATE_COOKIE)?.value || "";
  const [storedState] = stored.split(":");
  const verifier = cookies.get(OIDC_VERIFIER_COOKIE)?.value || "";
  const intent = cookies.get(OIDC_INTENT_COOKIE)?.value === "link" ? "link" : "login";
  const next = safeNext(cookies.get(OIDC_NEXT_COOKIE)?.value || "/");

  if (!code || !state || !storedState || state !== storedState || !verifier) {
    return loginError(cookies, "sso");
  }

  try {
    const cfg = getOidcConfig();
    const discovery = await fetchOidcDiscovery();
    const origin = publicOrigin(request);
    const redirectUri = `${origin}${CALLBACK_PATH}`;
    const tokens = await exchangeOidcCode({
      tokenEndpoint: discovery.token_endpoint,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code,
      redirectUri,
      codeVerifier: verifier,
    });
    const userinfo = await fetchOidcUserinfo(discovery.userinfo_endpoint, tokens.access_token);
    const claims = claimsFromOidcTokens(tokens, userinfo);
    if (!claims.email) {
      return loginError(cookies, "sso_email");
    }

    if (intent === "link") {
      const session = getSessionFromCookies(cookies);
      if (!session?.email) {
        return loginError(cookies, "sso");
      }
      if (session.email !== claims.email) {
        clearOidcCookies(cookies);
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/parametres?section=compte&error=${encodeURIComponent("sso_mismatch")}`,
          },
        });
      }
    }

    const user = await upsertUserFromOidc({ email: claims.email, sub: claims.sub });
    cookies.set(
      SESSION_COOKIE,
      createSessionToken(user.email),
      sessionCookieOptions(),
    );
    cookies.set(SSO_HINT_COOKIE, "1", {
      ...oidcCookieOptions(60 * 60 * 24 * 180),
      httpOnly: false,
    });
    clearOidcCookies(cookies);

    const dest =
      intent === "link"
        ? "/parametres?section=compte&pocket=linked"
        : next;
    return new Response(null, {
      status: 302,
      headers: { Location: dest },
    });
  } catch (e) {
    const msg = String(e?.message || "");
    if (/déjà lié/i.test(msg)) {
      return loginError(cookies, "sso_taken");
    }
    return loginError(cookies, "sso");
  }
}
