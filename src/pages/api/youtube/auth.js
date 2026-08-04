import { json, error, readBody } from "../../../server/http.js";
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

    const origin = new URL(request.url).origin;
    let redirectUri = body.redirectUri?.trim() || defaultRedirectUri(origin);
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
        "Google Cloud → APIs → YouTube Data API v3 ON. OAuth consent (External + test users). " +
        "Identifiants → Application Web → Redirect URI exacte ci-dessous.",
    });
  } catch (e) {
    return error(e.message || "Auth YouTube impossible", 500);
  }
}
