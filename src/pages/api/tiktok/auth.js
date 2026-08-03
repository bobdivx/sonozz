import { json, error, readBody } from "../../../server/http.js";
import {
  buildAuthorizeUrl,
  createPkcePair,
  defaultRedirectUri,
  isDesktopRedirect,
  sanitizeClientKey,
  TIKTOK_SCOPES,
} from "../../../server/tiktok.js";

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const clientKey = sanitizeClientKey(
      body.keys?.tiktokClientKey || body.clientKey || "",
    );
    if (!clientKey) return error("TikTok Client Key manquant", 400);
    if (clientKey.length < 10) {
      return error(
        "Client Key trop courte — colle la Client Key (pas l’App ID ni le Secret) depuis TikTok Developers → Credentials.",
        400,
      );
    }

    const origin = new URL(request.url).origin;
    let redirectUri = body.redirectUri?.trim() || defaultRedirectUri(origin);
    // Correspondance exacte avec le portail : option trailing slash
    if (body.trailingSlash && !redirectUri.endsWith("/")) {
      redirectUri = `${redirectUri}/`;
    }

    const state = body.state || crypto.randomUUID();
    const desktop = isDesktopRedirect(redirectUri);
    const scopes = body.scopes?.trim() || TIKTOK_SCOPES;

    let codeVerifier = null;
    let codeChallenge = null;
    let codeChallengeMethod = null;

    if (desktop || body.forcePkce) {
      const pkce = createPkcePair();
      codeVerifier = pkce.codeVerifier;
      codeChallenge = pkce.codeChallenge;
      codeChallengeMethod = pkce.codeChallengeMethod;
    }

    const url = buildAuthorizeUrl({
      clientKey,
      redirectUri,
      state,
      scopes,
      codeChallenge,
      codeChallengeMethod,
    });

    return json({
      url,
      redirectUri,
      state,
      codeVerifier,
      clientKeyPreview: `${clientKey.slice(0, 4)}…${clientKey.slice(-4)}`,
      scopes,
      mode: desktop ? "desktop" : "web",
      hint: desktop
        ? "Mode Desktop : dans TikTok Developers → Login Kit → plateforme Desktop, ajoute EXACTEMENT cette Redirect URI (http localhost + port)."
        : "Mode Web : Redirect URI HTTPS dans Login Kit Web. Ne mélange pas Client Key Web avec un flux localhost Desktop.",
    });
  } catch (e) {
    return error(e.message || "Auth TikTok impossible", 500);
  }
}
