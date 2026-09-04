export function captionWithTags(social = {}) {
  const tags = (social.hashtags || [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .join(" ");
  return `${social.caption || ""}\n\n${tags}`.trim().slice(0, 2200);
}

export function mimeFromDataUrl(videoBase64 = "", fallback = "video/webm") {
  const m = String(videoBase64).match(/^data:([^;]+);base64,/i);
  if (m?.[1]) return m[1].split(";")[0].trim();
  return fallback;
}
