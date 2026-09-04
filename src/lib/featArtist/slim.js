export function slimStyleLock(lock) {
  if (!lock || typeof lock !== "object") return null;
  return {
    matchedName: lock.matchedName || null,
    genreSummary: lock.genreSummary || null,
    genres: Array.isArray(lock.genres) ? lock.genres.slice(0, 6) : undefined,
    mood: lock.mood || null,
    energy: lock.energy || null,
    vocalStyle: lock.vocalStyle || null,
    timbre: lock.timbre || null,
    writingStyle: lock.writingStyle || null,
    rhythmFeel: lock.rhythmFeel || null,
    bpm: lock.bpm ?? null,
    instruments: Array.isArray(lock.instruments) ? lock.instruments.slice(0, 8) : undefined,
    sonicKeywords: Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords.slice(0, 8) : undefined,
    doNot: Array.isArray(lock.doNot) ? lock.doNot.slice(0, 4) : undefined,
    musicPrompt: lock.musicPrompt ? String(lock.musicPrompt).slice(0, 280) : null,
  };
}

export function slimVoiceSample(sample) {
  if (!sample || typeof sample !== "object") return null;
  const timbre =
    sample.songGenTimbre || sample.analyzedTimbre || sample.timbreHint || null;
  if (!timbre && !sample.guideMode) return null;
  return {
    guideMode: "timbre",
    songGenTimbre: timbre ? String(timbre).slice(0, 80) : undefined,
    analyzedTimbre: sample.analyzedTimbre
      ? String(sample.analyzedTimbre).slice(0, 80)
      : undefined,
  };
}
