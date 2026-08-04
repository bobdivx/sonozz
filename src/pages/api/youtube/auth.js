import { json, error, readBody, publicOrigin } from "../../../server/http.js";
import {
  buildAuthorizeUrl,
  createPkcePair,
  defaultRedirectUri,
  sanitizeClientId,
  YOUTUBE_SCOPES,
} from "../../../server/youtube.js";

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const clientId = sanitizeClientId(
      body.keys?.youtubeClientId || body.clientId || "",
    );
    if (!clientId) return error("YouTube Client ID manquant", 400);
    if (clientId.length < 12) {
      return error(
        "Client ID trop court — colle l’ID OAuth depuis Google Cloud Console → Identifiants.",
        400,
      );
    }

    const origin = publicOrigin(request);
    let redirectUri = body.redirectUri?.trim() || defaultRedirectUri(origin);
    // Proxy http → forcer https hors localhost
    redirectUri = redirectUri.replace(/^http:\/\/(?!localhost|127\.0\.0\.1)/i, "https://");
    if (body.trailingSlash && !redirectUri.endsWith("/")) {
      redirectUri = `${redirectUri}/`;
    }

    const state = body.state || crypto.randomUUID();
    const scopes = body.scopes?.trim() || YOUTUBE_SCOPES;
    const pkce = createPkcePair();

    const url = buildAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      scopes,
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: pkce.codeChallengeMethod,
    });

    return json({
      url,
      redirectUri,
      state,
      codeVerifier: pkce.codeVerifier,
      clientIdPreview: `${clientId.slice(0, 8)}…${clientId.slice(-6)}`,
      scopes,
      hint:
        "Google Cloud → Identifiants → URI de redirection = EXACTEMENT " +
        redirectUri +
        " (https, sans slash final sauf si déclaré).",
    });
  } catch (e) {
    return error(e.message || "Auth YouTube impossible", 500);
  }
}
