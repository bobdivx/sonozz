/**
 * Export jaquette avec watermark Free (sharp).
 */
import sharp from "sharp";

/**
 * @param {Buffer} input
 * @param {{ label?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function watermarkCoverBuffer(input, { label = "SONOZZ · Free" } = {}) {
  const image = sharp(Buffer.isBuffer(input) ? input : Buffer.from(input));
  const meta = await image.metadata();
  const width = meta.width || 1000;
  const height = meta.height || 1000;
  const fontSize = Math.max(28, Math.round(Math.min(width, height) * 0.055));
  const pad = Math.round(fontSize * 0.55);
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#000" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.25"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${height - fontSize * 2.4}" width="${width}" height="${fontSize * 2.4}" fill="url(#g)"/>
      <text
        x="${pad}"
        y="${height - pad}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        fill="#f5e6a8"
        opacity="0.92"
      >${escapeXml(label)}</text>
    </svg>
  `;
  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
