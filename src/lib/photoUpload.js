/**
 * Compresse une image fichier en data URL JPEG (côté navigateur).
 * Cible ~900px / qualité 0.78 pour rester sous la limite Turso.
 */
export function fileToJpegDataUrl(file, { maxSize = 900, quality = 0.78 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//i.test(file.type)) {
      reject(new Error("Fichier image requis (JPEG, PNG, WebP)"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture fichier impossible"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image invalide"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas indisponible"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          reject(e);
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function filesToJpegDataUrls(fileList, { max = 6 } = {}) {
  const files = Array.from(fileList || []).slice(0, max);
  const out = [];
  for (const file of files) {
    out.push(await fileToJpegDataUrl(file));
  }
  return out;
}
