import { error, json, publicOrigin } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import { unlinkPocketId } from "../../../server/users.js";
import {
  CALLBACK_PATH,
  OIDC_INTENT_COOKIE,
  OIDC_NEXT_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  buildOidcAuthorizeUrl,
  createPkcePair,
  fetchOidcDiscovery,
  getOidcConfig,
  isOidcConfigured,
  oidcCookieOptions,
  randomOidcState,
} from "../../../server/oidc.js";

export const prerender = false;

function safeNext(raw) {
  if (!raw || typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login") || raw.startsWith("/api/")) return "/";
  return raw;
}

export async function GET({ request, cookies, url }) {
  if (!isOidcConfigured()) {
    return error("SSO Pocket ID non configuré", 503);
  }

  const intent = url.searchParams.get("intent") === "link" ? "link" : "login";
  if (intent === "link" && !getSessionFromCookies(cookies)) {
    return error("Connecte-toi avant de lier Pocket ID", 401);
  }

  const cfg = getOidcConfig();
  const discovery = await fetchOidcDiscovery();
  const origin = publicOrigin(request);
  const redirectUri = `${origin}${CALLBACK_PATH}`;
  const pkce = createPkcePair();
  const state = randomOidcState();
  const nonce = randomOidcState();
  const next = safeNext(url.searchParams.get("next") || "/");

  const cookieOpts = oidcCookieOptions(600);
  cookies.set(OIDC_STATE_COOKIE, `${state}:${nonce}`, cookieOpts);
  cookies.set(OIDC_VERIFIER_COOKIE, pkce.codeVerifier, cookieOpts);
  cookies.set(OIDC_NEXT_COOKIE, next, cookieOpts);
  cookies.set(OIDC_INTENT_COOKIE, intent, cookieOpts);

  const authorizeUrl = buildOidcAuthorizeUrl({
    authorizationEndpoint: discovery.authorization_endpoint,
    clientId: cfg.clientId,
    redirectUri,
    scopes: cfg.scopes,
    state,
    codeChallenge: pkce.codeChallenge,
    nonce,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl },
  });
}

export async function POST({ cookies }) {
  const session = getSessionFromCookies(cookies);
  if (!session?.email) return error("Non autorisé", 401);
  try {
    const user = await unlinkPocketId(session.email);
    if (!user) return error("Compte introuvable", 404);
    return json({
      ok: true,
      ssoLinked: false,
      email: user.email,
    });
  } catch (e) {
    return error(e.message || "Impossible de délier Pocket ID", 500);
  }
}
