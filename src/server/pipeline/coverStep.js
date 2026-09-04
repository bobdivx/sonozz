import { generateVisual } from "../images.js";
import { isUsableRasterImage } from "../imagePersist.js";
import { getArtistBySlug } from "../artists.js";
import { normalizeArtistPhotos } from "../../lib/artistPhotos.js";
import {
  normalizeFeatArtist,
  duoCoverPromptBits,
  displayArtistCredit,
} from "../../lib/featArtist.js";
import { genderVisualLock } from "./util.js";

async function resolveFeatCoverPortrait(feat) {
  if (!feat) return null;
  if (isUsableRasterImage(feat.imageUrl)) return feat.imageUrl;
  const slug = String(feat.slug || "").trim();
  if (!slug) return null;
  try {
    const row = await getArtistBySlug(slug);
    const profile = row?.profile || {};
    const photos = normalizeArtistPhotos(profile.photos, profile.imageUrl);
    return photos.find((u) => isUsableRasterImage(u)) || null;
  } catch {
    return null;
  }
}

export async function runCover({ keys, prompt, artist, track, album }) {
  const portraitUrl = artist?.imageUrl;
  if (!isUsableRasterImage(portraitUrl)) {
    throw new Error(
      "Portrait artiste manquant ou SVG. Ouvre Modifier le profil (photo Gemini ou Replicate) avant la jaquette.",
    );
  }

  const feat = normalizeFeatArtist(artist?.featArtist);
  const featPortraitUrl = feat ? await resolveFeatCoverPortrait(feat) : null;
  const isDuo = Boolean(feat?.name);
  const credit = displayArtistCredit(artist, feat);

  const genderLock =
    artist?.visualIdentity?.genderLock || genderVisualLock(artist?.gender, artist?.age).en;
  const featGenderLock = feat
    ? feat.visualIdentity?.genderLock || genderVisualLock(feat.gender, feat.age).en
    : null;
  const releaseTitle = album?.title || track?.title || "Single";
  const duoBits = isDuo ? duoCoverPromptBits(artist, feat) : [];
  const styleHint = String(prompt || "").trim();

  const visual = [
    album?.title
      ? `Square LP album cover for "${album.title}" by ${credit}`
      : `Album cover for "${releaseTitle}" by ${credit}`,
    album?.concept ? `album concept: ${album.concept}` : "",
    styleHint,
    genderLock,
    featGenderLock && isDuo ? `featured artist look: ${featGenderLock}` : "",
    ...duoBits,
    `mood ${artist?.visualIdentity?.look || artist?.mood || "nocturne"}`,
    `wardrobe ${artist?.visualIdentity?.wardrobe || "contemporary"}`,
    `${artist?.genre || "pop"} aesthetic`,
    `palette ${artist?.palette?.join(", ") || "brass and moss"}`,
    isDuo
      ? featPortraitUrl
        ? "cinematic square composition, BOTH reference portraits must stay recognizable (face, age, hair, skin, gender) — image 1 = lead, image 2 = featured"
        : `cinematic square composition, lead matches reference portrait; featured ${feat.name} must appear as a second distinct person (${featGenderLock || "matching their gender"}), do not clone the lead`
      : "cinematic square composition, SAME PERSON and SAME GENDER as the reference portrait photo, do not change sex or age",
  ]
    .filter(Boolean)
    .join(", ");

  const referenceImageUrls = [portraitUrl, featPortraitUrl].filter((u) =>
    isUsableRasterImage(u),
  );

  const image = await generateVisual({
    keys,
    prompt: visual,
    kind: "cover",
    referenceImageUrl: portraitUrl,
    referenceImageUrls,
  });

  const warnings = [
    image.warning,
    isDuo && !featPortraitUrl
      ? `Feat ${feat.name} sans portrait catalogue — jaquette duo guidée surtout par le lead.`
      : null,
  ].filter(Boolean);

  return {
    prompt: visual,
    imageUrl: image.imageUrl,
    format: "3000×3000 (master)",
    style: isDuo
      ? `cinematic / duo ${credit}`
      : "cinematic / based on artist portrait",
    fallback: false,
    warning: warnings.length ? warnings.join(" ") : undefined,
    provider: image.provider,
    basedOnArtist: true,
    featuring: isDuo ? feat.name : undefined,
    localAsset: false,
    sourcePortrait: Boolean(portraitUrl),
    sourceFeatPortrait: Boolean(featPortraitUrl),
  };
}
