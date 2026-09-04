/**
 * Timbre figé sur le profil artiste — source de vérité pour ACE / SongGen / duo.
 */

export function artistLockedTimbre(artist) {
  if (!artist || typeof artist !== "object") return "";
  const sample = artist.voiceSample || {};
  return String(
    sample.songGenTimbre ||
      sample.analyzedTimbre ||
      sample.timbreHint ||
      artist.styleLock?.timbre ||
      "",
  )
    .trim()
    .slice(0, 80);
}

export function artistHasLockedTimbre(artist) {
  return Boolean(artistLockedTimbre(artist));
}

/**
 * Invente un timbre stable depuis le profil IA (genre, voice, styleLock) —
 * sans extrait audio utilisateur. Sert de fingerprint pour tous les futurs titres.
 */
export function synthesizeArtistTimbreDna(artist) {
  if (!artist || typeof artist !== "object") return null;

  const gender = String(artist.gender || artist.visualIdentity?.gender || "")
    .toLowerCase()
    .trim();
  const registerFromGender =
    gender === "female"
      ? "mezzo"
      : gender === "male"
        ? "baritone"
        : gender === "nonbinary"
          ? "mixed"
          : "unknown";

  const lock = artist.styleLock || {};
  const existing =
    String(
      artist.voiceSample?.songGenTimbre ||
        artist.voiceSample?.analyzedTimbre ||
        lock.timbre ||
        "",
    ).trim();

  const voiceBlob = [
    artist.voice,
    lock.vocalStyle,
    lock.vocalRegister,
    lock.mood,
    artist.mood,
    Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords.slice(0, 4).join(" ") : "",
    artist.genre,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const qualities = [];
  if (/warm|chaleur|douce|soft|velours|velvet/i.test(voiceBlob)) qualities.push("warm");
  if (/bright|claire|aérien|airy|crystal|bright/i.test(voiceBlob)) qualities.push("bright");
  if (/raspy|rauque|gravel|gritty|rough/i.test(voiceBlob)) qualities.push("raspy");
  if (/breathy|souffl|whisper|intimate/i.test(voiceBlob)) qualities.push("breathy");
  if (/powerful|puissant|belt|belting|fierce/i.test(voiceBlob)) qualities.push("powerful");
  if (/dark|sombre|deep|grave/i.test(voiceBlob)) qualities.push("dark");
  if (/nasal|twang/i.test(voiceBlob)) qualities.push("nasal");
  if (/smooth|lisse|silky|soul/i.test(voiceBlob)) qualities.push("smooth");
  if (!qualities.length) {
    qualities.push(gender === "female" ? "bright" : gender === "male" ? "warm" : "clear");
  }

  let register = String(lock.vocalRegister || "").trim().toLowerCase() || registerFromGender;
  if (!/tenor|baritone|bass|alto|soprano|mezzo|spoken|mixed/i.test(register)) {
    if (/tenor|aigu male/i.test(voiceBlob)) register = "tenor";
    else if (/bass|basse/i.test(voiceBlob)) register = "bass";
    else if (/soprano/i.test(voiceBlob)) register = "soprano";
    else if (/alto/i.test(voiceBlob)) register = "alto";
    else if (/mezzo/i.test(voiceBlob)) register = "mezzo";
    else register = registerFromGender;
  }

  const delivery = [];
  if (/rap|spoken|parlé/i.test(voiceBlob)) delivery.push("spoken-sung");
  if (/melodic|mélod|singing|chant/i.test(voiceBlob)) delivery.push("melodic");
  if (/soul|r&b|rnb/i.test(voiceBlob)) delivery.push("soulful");
  if (/trap|auto-?tune|pitched/i.test(voiceBlob)) delivery.push("modern");

  // Si styleLock.timbre existe déjà en anglais court, on le normalise.
  let songGenTimbre = existing
    .replace(/[^a-zA-Z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  if (!songGenTimbre || songGenTimbre.split(/\s+/).length < 2) {
    songGenTimbre = [...qualities.slice(0, 2), register, ...delivery.slice(0, 1)]
      .filter(Boolean)
      .join(" ")
      .slice(0, 80);
  }

  const vocalStyle =
    String(lock.vocalStyle || artist.voice || "")
      .trim()
      .slice(0, 120) || `${qualities[0]} ${register} vocals`;

  return {
    timbre: songGenTimbre,
    songGenTimbre,
    vocalStyle,
    vocalRegister: register,
    genderFeel:
      gender === "female" || gender === "male" || gender === "ambiguous"
        ? gender
        : gender === "nonbinary"
          ? "ambiguous"
          : registerFromGender === "mezzo"
            ? "female"
            : registerFromGender === "baritone"
              ? "male"
              : "ambiguous",
  };
}

/** Fige un timbre synthétisé sur le profil (sans audio). */
export function lockSynthesizedTimbre(artist) {
  if (!artist || typeof artist !== "object") return artist;
  if (artistHasLockedTimbre(artist)) return artist;
  const dna = synthesizeArtistTimbreDna(artist);
  if (!dna) return artist;
  return applyTimbreDnaToArtist(artist, dna, { source: "profile-synth" });
}

/**
 * Applique le résultat Gemini sur voiceSample + styleLock.timbre + voice.
 */
export function applyTimbreDnaToArtist(artist, dna, { source = "analyze" } = {}) {
  if (!artist || typeof artist !== "object" || !dna) return artist;
  const songGenTimbre = String(dna.songGenTimbre || dna.timbre || "")
    .trim()
    .slice(0, 80);
  const analyzedTimbre = String(dna.timbre || songGenTimbre)
    .trim()
    .slice(0, 120);
  if (!songGenTimbre && !analyzedTimbre) return artist;

  const prevSample =
    artist.voiceSample && typeof artist.voiceSample === "object" ? { ...artist.voiceSample } : {};
  const voiceSample = {
    ...prevSample,
    guideMode: prevSample.guideMode === "reference" ? "reference" : "timbre",
    songGenTimbre: songGenTimbre || prevSample.songGenTimbre,
    analyzedTimbre: analyzedTimbre || prevSample.analyzedTimbre,
    vocalRegister: dna.vocalRegister || prevSample.vocalRegister,
    genderFeel: dna.genderFeel || prevSample.genderFeel,
    timbreSource: source,
    timbreAnalyzedAt: new Date().toISOString(),
  };

  const styleLock =
    artist.styleLock && typeof artist.styleLock === "object" ? { ...artist.styleLock } : {};
  if (!styleLock.timbre && (analyzedTimbre || songGenTimbre)) {
    styleLock.timbre = analyzedTimbre || songGenTimbre;
  }
  if (!styleLock.vocalStyle && dna.vocalStyle) {
    styleLock.vocalStyle = String(dna.vocalStyle).slice(0, 120);
  }
  if (!styleLock.vocalRegister && dna.vocalRegister) {
    styleLock.vocalRegister = String(dna.vocalRegister).slice(0, 40);
  }

  const voice =
    String(artist.voice || "").trim() ||
    String(dna.vocalStyle || analyzedTimbre || songGenTimbre).slice(0, 160) ||
    artist.voice;

  return {
    ...artist,
    voice,
    voiceSample,
    styleLock: Object.keys(styleLock).length ? styleLock : artist.styleLock,
  };
}
