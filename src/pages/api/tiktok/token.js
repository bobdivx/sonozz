import { json, error, readBody, publicOrigin } from "../../../server/http.js";
import {
  defaultRedirectUri,
  exchangeCodeForToken,
  refreshAccessToken,
} from "../../../server/tiktok.js";

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const keys = body.keys || {};
    const clientKey = keys.tiktokClientKey?.trim() || body.clientKey?.trim();
    const clientSecret = keys.tiktokClientSecret?.trim() || body.clientSecret?.trim();
    const origin = publicOrigin(request);
    let redirectUri = body.redirectUri?.trim() || defaultRedirectUri(origin);
    redirectUri = redirectUri.replace(/^http:\/\/(?!localhost|127\.0\.0\.1)/i, "https://");

    if (!clientKey || !clientSecret) {
      return error("Client Key et Client Secret TikTok requis", 400);
    }

    if (body.refreshToken || keys.tiktokRefreshToken) {
      const data = await refreshAccessToken({
        clientKey,
        clientSecret,
        refreshToken: (body.refreshToken || keys.tiktokRefreshToken).trim(),
      });
      return json({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || body.refreshToken || keys.tiktokRefreshToken,
        expiresIn: data.expires_in,
        openId: data.open_id,
        scope: data.scope,
      });
    }

    const code = body.code?.trim();
    if (!code) return error("Code OAuth manquant", 400);

    const codeVerifier = body.codeVerifier?.trim();
    // Desktop PKCE : verifier requis. Web : optionnel.
    const needsPkce = Boolean(codeVerifier) || /localhost|127\.0\.0\.1/i.test(redirectUri);
    if (needsPkce && !codeVerifier) {
      return error("code_verifier PKCE manquant — relance « Connecter TikTok »", 400);
    }

    const data = await exchangeCodeForToken({
      clientKey,
      clientSecret,
      code,
      redirectUri,
      codeVerifier: codeVerifier || undefined,
    });

    if (!data.access_token) {
      return error("TikTok n’a pas renvoyé d’access_token", 502);
    }

    return json({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || "",
      expiresIn: data.expires_in,
      openId: data.open_id,
      scope: data.scope,
    });
  } catch (e) {
    return error(e.message || "Échange token TikTok impossible", 500);
  }
}
