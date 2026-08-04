import { json, error, readBody, publicOrigin } from "../../../server/http.js";
import {
  defaultRedirectUri,
  exchangeCodeForToken,
  refreshAccessToken,
} from "../../../server/youtube.js";

export const prerender = false;

function normalizeRedirectUri(uri) {
  return String(uri || "")
    .trim()
    .replace(/^http:\/\/(?!localhost|127\.0\.0\.1)/i, "https://");
}

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const keys = body.keys || {};
    const clientId = keys.youtubeClientId?.trim() || body.clientId?.trim();
    const clientSecret = keys.youtubeClientSecret?.trim() || body.clientSecret?.trim();
    const origin = publicOrigin(request);
    const redirectUri = normalizeRedirectUri(
      body.redirectUri?.trim() || defaultRedirectUri(origin),
    );

    if (!clientId || !clientSecret) {
      return error("Client ID et Client Secret YouTube requis", 400);
    }

    if (body.refreshToken || keys.youtubeRefreshToken) {
      const data = await refreshAccessToken({
        clientId,
        clientSecret,
        refreshToken: (body.refreshToken || keys.youtubeRefreshToken).trim(),
      });
      return json({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || body.refreshToken || keys.youtubeRefreshToken,
        expiresIn: data.expires_in,
        scope: data.scope,
        tokenType: data.token_type,
      });
    }

    const code = body.code?.trim();
    if (!code) return error("Code OAuth manquant", 400);

    const codeVerifier = body.codeVerifier?.trim();
    if (!codeVerifier) {
      return error("code_verifier PKCE manquant — relance « Connecter YouTube »", 400);
    }

    const data = await exchangeCodeForToken({
      clientId,
      clientSecret,
      code,
      redirectUri,
      codeVerifier,
    });

    if (!data.access_token) {
      return error("Google n’a pas renvoyé d’access_token", 502);
    }

    return json({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || "",
      expiresIn: data.expires_in,
      scope: data.scope,
      tokenType: data.token_type,
    });
  } catch (e) {
    return error(e.message || "Échange token YouTube impossible", 500);
  }
}
