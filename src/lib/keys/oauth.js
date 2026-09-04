/** URI à coller dans le portail TikTok (Login Kit / Redirect URI). */
export function tiktokRedirectUri() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/tiktok/callback`.replace(
    /^http:\/\/(?!localhost|127\.0\.0\.1)/i,
    "https://",
  );
}

/** URI à coller dans Google Cloud Console (OAuth → URI de redirection). */
export function youtubeRedirectUri() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/youtube/callback`.replace(
    /^http:\/\/(?!localhost|127\.0\.0\.1)/i,
    "https://",
  );
}
