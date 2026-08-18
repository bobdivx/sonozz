import { useEffect, useRef, useState } from "preact/hooks";
import {
  UserRound,
  MapPin,
  Mic2,
  Palette,
  Camera,
  Shirt,
  Music2,
  Languages,
  Sparkles,
  Heart,
} from "lucide-preact";
import {
  MUSIC_STYLES,
  formatGenres,
  languageLabel,
  languagesForProvider,
  songGenLanguageHint,
  languageEngineLabel,
  catalogGenresToStyleValues,
  styleGenreChips,
  inferLanguageFromStyleRef,
  parseGenres,
} from "../../lib/studio.js";
import { loadKeys } from "../../lib/keys.js";
import StyleArtistPicker from "../StyleArtistPicker.jsx";
import StyleTrackPicker from "../StyleTrackPicker.jsx";
import ArtistNameField, { isArtistNameBlocked } from "../ArtistNameField.jsx";
import PhotoUpload from "../PhotoUpload.jsx";
import VoiceSampleUpload from "../VoiceSampleUpload.jsx";
import { resolveArtistGender, inferGenderFromStyleRef, ARTIST_GENDER_OPTIONS, ARTIST_GENDER_LABELS } from "../../lib/artistGender.js";
import { artistPhotoSyncKey, normalizeArtistPhotos } from "../../lib/artistPhotos.js";
import { buildArtistDraftPatch, isUnchangedArtistDraft } from "../../lib/artistDraft.js";

export default function ArtistStep({ artist, trends, loading, onGenerate, onPatchArtist, initialMode }) {
  const [mode, setMode] = useState(() =>
    initialMode === "self" || artist?.mode === "self" ? "self" : "fiction",
  );
  const [name, setName] = useState(artist?.name || "");
  const [allowTakenName, setAllowTakenName] = useState(false);
  const [nameStatus, setNameStatus] = useState(null);
  const [genres, setGenres] = useState(() => parseGenres(artist?.genres || artist?.genre));
  const [customGenre, setCustomGenre] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [language, setLanguage] = useState(artist?.language || "fr");
  const [bioHint, setBioHint] = useState(artist?.bioHint || "");
  const [styleArtist, setStyleArtist] = useState(artist?.styleArtist || "");
  const [styleArtistPick, setStyleArtistPick] = useState(() =>
    artist?.styleLock?.sourceId && artist?.styleLock?.source !== "multi"
      ? {
          source: artist.styleLock.source,
          id: artist.styleLock.sourceId,
          name: artist.styleArtist || artist.styleLock.matchedName,
          image: artist.styleLock.image || null,
        }
      : null,
  );
  const [styleArtistPicks, setStyleArtistPicks] = useState(() => {
    if (Array.isArray(artist?.styleLock?.refs) && artist.styleLock.refs.length) {
      return artist.styleLock.refs
        .filter((r) => r.source && r.sourceId)
        .map((r) => ({
          source: r.source,
          id: String(r.sourceId),
          name: r.matchedName,
          image: r.image || null,
          genres: r.genres || [],
        }));
    }
    return [];
  });
  const [styleTrackPick, setStyleTrackPick] = useState(() => {
    const st = artist?.styleLock?.seedTrack;
    if (st?.source && st?.sourceId) {
      return {
        source: st.source,
        id: String(st.sourceId),
        name: st.title,
        artistName: st.artistName || "",
        album: st.album || "",
        image: st.image || null,
        url: st.url || null,
        previewUrl: st.previewUrl || null,
      };
    }
    return null;
  });
  const [age, setAge] = useState(artist?.age != null ? String(artist.age) : "");
  const [gender, setGender] = useState(() => resolveArtistGender(artist)?.code || "");
  const [city, setCity] = useState(artist?.city || "");
  const [photos, setPhotos] = useState(() => normalizeArtistPhotos(artist?.photos, artist?.imageUrl));
  const [voiceSample, setVoiceSample] = useState(() => artist?.voiceSample || null);
  const [pickError, setPickError] = useState("");
  const languageManualRef = useRef(false);
  const genderManualRef = useRef(Boolean(resolveArtistGender(artist)?.code));
  const skipHydrateRef = useRef(false);
  const persistTimerRef = useRef(null);
  const draftReadyRef = useRef(false);
  const loadingRef = useRef(Boolean(loading));
  const artistRef = useRef(artist);
  const onPatchRef = useRef(onPatchArtist);
  const draftRef = useRef({});
  loadingRef.current = Boolean(loading);
  artistRef.current = artist;
  onPatchRef.current = onPatchArtist;
  const keysSnap = loadKeys();
  const langOptions = languagesForProvider(
    keysSnap.musicProvider,
    keysSnap.songGenPreferredModel,
  );
  const songGenLangs = String(keysSnap.musicProvider || "") === "songgen";

  useEffect(() => {
    if (initialMode !== "self" && initialMode !== "fiction") return;
    if (initialMode === mode) return;
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!langOptions.some((l) => l.code === language) && langOptions[0]) {
      setLanguage(langOptions[0].code);
    }
  }, [language, langOptions]);

  useEffect(() => {
    if (!artist) return;
    if (skipHydrateRef.current) {
      skipHydrateRef.current = false;
      return;
    }
    setName(artist.name || "");
    setAllowTakenName(false);
    setNameStatus(null);
    if (artist.mode === "self" || artist.mode === "fiction") setMode(artist.mode);
    const parsed = parseGenres(artist.genres || artist.genre);
    const presetValues = new Set(MUSIC_STYLES.map((s) => s.value).filter(Boolean));
    const known = parsed.filter((g) => presetValues.has(g));
    const unknown = parsed.filter((g) => !presetValues.has(g));
    setGenres(known);
    if (unknown.length) {
      setShowCustom(true);
      setCustomGenre(unknown.join(" × "));
    } else {
      setShowCustom(false);
      setCustomGenre("");
    }
    if (artist.language) setLanguage(artist.language);
    setStyleArtist(artist.styleArtist || "");
    setAge(artist.age != null ? String(artist.age) : "");
    const savedGender = resolveArtistGender(artist)?.code;
    if (savedGender) {
      setGender(savedGender);
      genderManualRef.current = true;
    }
    setCity(artist.city || "");
    setBioHint(artist.bioHint || "");
    setVoiceSample(artist.voiceSample || null);
    if (Array.isArray(artist.styleLock?.refs) && artist.styleLock.refs.length) {
      setStyleArtistPicks(
        artist.styleLock.refs
          .filter((r) => r.source && r.sourceId)
          .map((r) => ({
            source: r.source,
            id: String(r.sourceId),
            name: r.matchedName,
            image: r.image || null,
            genres: r.genres || [],
          })),
      );
    } else if (artist.styleLock?.sourceId && artist.styleLock?.source !== "multi") {
      setStyleArtistPick({
        source: artist.styleLock.source,
        id: artist.styleLock.sourceId,
        name: artist.styleArtist || artist.styleLock.matchedName,
        image: artist.styleLock.image || null,
      });
    }
  }, [artist?.name, artist?.genre, artist?.genres, artist?.language, artist?.styleArtist, artist?.mode, artist?.age, artist?.city, artist?.bioHint]);

  const photoSyncKey = artistPhotoSyncKey(artist);
  useEffect(() => {
    if (!artist) return;
    const incoming = normalizeArtistPhotos(artist.photos, artist.imageUrl);
    setPhotos((prev) => {
      if (prev.length === incoming.length && prev.every((p, i) => p === incoming[i])) return prev;
      return incoming;
    });
  }, [photoSyncKey]);

  function applyPhotos(next) {
    const list = normalizeArtistPhotos(next);
    setPhotos(list);
    setPickError("");
    skipHydrateRef.current = true;
    onPatchArtist?.({
      photos: list,
      imageUrl: list[0] || null,
      imageProvider: list[0] ? "user-upload" : null,
      imageFallback: false,
      imageWarning: null,
    });
  }

  function toggleStyle(value) {
    if (!value) {
      setGenres([]);
      setShowCustom(false);
      setCustomGenre("");
      return;
    }
    setGenres((prev) =>
      prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value],
    );
  }

  const resolvedGenres = [
    ...genres,
    ...(showCustom && customGenre.trim() ? [customGenre.trim()] : []),
  ];
  const resolvedGenre = formatGenres(resolvedGenres);
  const isSelf = mode === "self";
  draftRef.current = {
    mode,
    name,
    age,
    gender,
    city,
    language,
    resolvedGenres,
    bioHint,
    styleArtist,
    styleArtistPick,
    styleArtistPicks,
    styleTrackPick,
  };

  function flushDraft(overrides = {}) {
    if (loadingRef.current) return;
    const prev = artistRef.current || {};
    const patch = buildArtistDraftPatch(
      { ...draftRef.current, ...overrides },
      prev,
    );
    if (isUnchangedArtistDraft(patch, prev)) return;
    skipHydrateRef.current = true;
    onPatchRef.current?.(patch);
  }

  function queueDraft(overrides = {}, immediate = false) {
    if (overrides && Object.keys(overrides).length) {
      draftRef.current = { ...draftRef.current, ...overrides };
    }
    if (loadingRef.current) return;
    if (immediate) {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      flushDraft(overrides);
      return;
    }
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      flushDraft();
    }, 500);
  }

  function applyMode(nextMode) {
    setPickError("");
    const nextPicks =
      nextMode === "self" && !styleArtistPicks.length && styleArtistPick?.id
        ? [styleArtistPick]
        : styleArtistPicks;
    if (nextMode === "self" && nextPicks.length && !styleArtistPicks.length) {
      setStyleArtistPicks(nextPicks);
    }
    if (nextMode === "fiction" && !styleArtistPick?.id && styleArtistPicks[0]?.id) {
      setStyleArtistPick(styleArtistPicks[0]);
      if (styleArtistPicks[0].name) setStyleArtist(styleArtistPicks[0].name);
    }
    setMode(nextMode);
    queueDraft(
      {
        mode: nextMode,
        styleArtistPicks: nextMode === "self" ? nextPicks : styleArtistPicks,
        styleArtistPick:
          nextMode === "fiction" && !styleArtistPick?.id && styleArtistPicks[0]
            ? styleArtistPicks[0]
            : styleArtistPick,
      },
      true,
    );
  }
  const hasStyleRef = Boolean(
    styleTrackPick?.id ||
      styleArtistPick?.id ||
      (Array.isArray(styleArtistPicks) && styleArtistPicks.length > 0),
  );

  /** Genres catalogue issus des artistes sélectionnés. */
  const artistRefGenres = (() => {
    const raw = [];
    if (isSelf) {
      for (const p of styleArtistPicks || []) {
        if (Array.isArray(p.genres)) raw.push(...p.genres);
      }
    } else if (Array.isArray(styleArtistPick?.genres)) {
      raw.push(...styleArtistPick.genres);
    }
    return [...new Set(raw.map((g) => String(g || "").trim()).filter(Boolean))];
  })();

  /** Genres issus du titre (ou fallback artiste si le titre n’en a pas). */
  const trackRefGenres = (() => {
    if (!styleTrackPick?.id) return [];
    const fromTrack = Array.isArray(styleTrackPick.genres)
      ? styleTrackPick.genres.map((g) => String(g || "").trim()).filter(Boolean)
      : [];
    if (fromTrack.length) return [...new Set(fromTrack)];
    // Deezer sans genre → reprendre ceux de l’artiste ref
    if (artistRefGenres.length) return artistRefGenres;
    return [];
  })();

  const trackStyleValues = new Set(catalogGenresToStyleValues(trackRefGenres));
  const artistOnlyStyleValues = new Set(
    catalogGenresToStyleValues(artistRefGenres).filter((v) => !trackStyleValues.has(v)),
  );
  const trackGenreChips = styleGenreChips(trackRefGenres);
  const artistGenreChips = styleGenreChips(artistRefGenres).filter(
    (chip) => !trackGenreChips.some((t) => t.label === chip.label),
  );
  const nameBlocked = isArtistNameBlocked(name, nameStatus, allowTakenName);

  useEffect(() => {
    if (languageManualRef.current) return;
    const pick = isSelf ? styleArtistPicks[0] : styleArtistPick;
    const inferred = inferLanguageFromStyleRef({
      country: pick?.country,
      language: pick?.language,
      genres: [
        ...(Array.isArray(pick?.genres) ? pick.genres : []),
        ...(Array.isArray(styleTrackPick?.genres) ? styleTrackPick.genres : []),
      ],
      titles: [styleTrackPick?.name, styleTrackPick?.album].filter(Boolean),
    });
    if (inferred && inferred !== language) setLanguage(inferred);
  }, [
    isSelf,
    styleArtistPick?.id,
    styleArtistPick?.country,
    styleArtistPick?.language,
    styleArtistPicks,
    styleTrackPick?.id,
    styleTrackPick?.genres,
    styleTrackPick?.name,
    language,
  ]);

  useEffect(() => {
    if (genderManualRef.current) return;
    const pick = isSelf ? styleArtistPicks[0] : styleArtistPick;
    const inferred = inferGenderFromStyleRef(pick);
    if (inferred && inferred !== gender) setGender(inferred);
  }, [isSelf, styleArtistPick?.id, styleArtistPick?.gender, styleArtistPicks, gender]);

  useEffect(() => {
    if (!draftReadyRef.current) {
      draftReadyRef.current = true;
      return;
    }
    queueDraft();
  }, [
    name,
    age,
    gender,
    city,
    language,
    resolvedGenre,
    bioHint,
    styleArtist,
    styleArtistPick,
    styleArtistPicks,
    styleTrackPick,
  ]);

  useEffect(() => {
    if (initialMode !== "self" && initialMode !== "fiction") return;
    if (artistRef.current?.mode === initialMode) return;
    queueDraft({ mode: initialMode }, true);
  }, [initialMode]);

  useEffect(() => {
    if (!loading) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, [loading]);

  useEffect(() => {
    return () => {
      if (!persistTimerRef.current) return;
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
      if (!loadingRef.current) flushDraft();
    };
  }, []);

  function handleGenerate() {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (isSelf) {
      if (!name.trim()) {
        setPickError("Indique ton nom de scène.");
        return;
      }
      if (!gender) {
        setPickError("Choisis ton sexe / présentation.");
        return;
      }
      const ageNum = Number(age);
      if (!Number.isFinite(ageNum) || ageNum < 13 || ageNum > 99) {
        setPickError("Indique un âge entre 13 et 99.");
        return;
      }
      if (!photos.length) {
        setPickError("Ajoute au moins une photo de toi.");
        return;
      }
      if (!styleArtistPicks.length) {
        setPickError("Ajoute et valide au moins un artiste que tu aimes.");
        return;
      }
      if (nameBlocked) {
        setPickError("Ce nom de scène est déjà pris — choisis-en un autre ou force quand même.");
        return;
      }
      setPickError("");
      onGenerate({
        mode: "self",
        name: name.trim(),
        age: Math.round(ageNum),
        gender,
        city: city.trim() || undefined,
        photos,
        voiceSample:
          voiceSample?.url || voiceSample?.s3Key
            ? {
                ...voiceSample,
                guideMode: voiceSample.guideMode === "reference" ? "reference" : "timbre",
              }
            : undefined,
        genre: resolvedGenre || undefined,
        genres: resolvedGenres.length ? resolvedGenres : undefined,
        language,
        bioHint: bioHint.trim(),
        styleArtistPicks,
        styleTrackPick: styleTrackPick || undefined,
        styleArtist: styleArtistPicks.map((p) => p.name).join(" × "),
        allowTakenName: allowTakenName || undefined,
        trends,
      });
      return;
    }

    if (styleArtist.trim() && !styleArtistPick?.id && !styleTrackPick?.id) {
      setPickError("Choisis et valide un artiste (ou un titre) dans la liste avant de générer.");
      return;
    }
    if (nameBlocked) {
      setPickError("Ce nom de scène est déjà pris — choisis-en un autre ou force quand même.");
      return;
    }
    setPickError("");
    onGenerate({
      mode: "fiction",
      name: name.trim(),
      genre: resolvedGenre || undefined,
      genres: resolvedGenres.length ? resolvedGenres : undefined,
      language,
      bioHint: bioHint.trim(),
      styleArtist: styleArtistPick?.name || styleArtist.trim() || undefined,
      styleArtistPick: styleArtistPick || undefined,
      styleTrackPick: styleTrackPick || undefined,
      allowTakenName: allowTakenName || undefined,
      trends,
    });
  }

  const vi = artist?.visualIdentity;
  const displayGenres = parseGenres(artist?.genres || artist?.genre);
  const savedGenderLabel = resolveArtistGender(artist)?.label;
  const favoriteNames =
    artist?.styleArtists ||
    (Array.isArray(artist?.styleLock?.refs)
      ? artist.styleLock.refs.map((r) => r.matchedName).filter(Boolean)
      : null);

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">
          {isSelf ? "Créer mon profil artiste" : "Créer un artiste complet"}
        </h2>
        <p class="max-w-xl text-base-content/70">
          {isSelf
            ? "Tes photos, ton identité, ta voix si tu veux, et les artistes que tu aimes — les morceaux colleront à ce son."
            : "Choisis un ou plusieurs styles musicaux et la langue — puis génère profil + portrait."}
        </p>
      </header>

      <div class="flex flex-wrap gap-2" role="tablist" aria-label="Type de profil">
        <button
          type="button"
          role="tab"
          aria-selected={!isSelf}
          class={`btn btn-sm gap-2 ${!isSelf ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
          disabled={loading}
          onClick={() => applyMode("fiction")}
        >
          <Sparkles size={14} />
          Artiste fictionnel
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isSelf}
          class={`btn btn-sm gap-2 ${isSelf ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
          disabled={loading}
          onClick={() => applyMode("self")}
        >
          <Heart size={14} />
          C’est moi
        </button>
      </div>

      <div class="flex flex-col gap-5">
        <ArtistNameField
          value={name}
          disabled={loading}
          allowTakenName={allowTakenName}
          onChange={setName}
          onAllowTakenNameChange={setAllowTakenName}
          onAvailabilityChange={setNameStatus}
        />

        {isSelf && (
          <>
            <PhotoUpload photos={photos} disabled={loading} onPhotosChange={applyPhotos} max={4} />

            <VoiceSampleUpload
              value={voiceSample}
              disabled={loading}
              projectId={name.trim() || artist?.slug || "voice"}
              onChange={(sample) => {
                setVoiceSample(sample);
                skipHydrateRef.current = true;
                if (sample?.url || sample?.s3Key) {
                  onPatchArtist?.({ voiceSample: sample });
                } else {
                  onPatchArtist?.({ voiceSample: null });
                }
              }}
            />

            <div class="grid gap-4 sm:grid-cols-2">
              <label class="form-control w-full">
                <span class="label-text mb-1 text-sm text-base-content/60">Âge</span>
                <input
                  class="input input-bordered w-full bg-base-200"
                  type="number"
                  min={13}
                  max={99}
                  placeholder="Ex. 24"
                  value={age}
                  disabled={loading}
                  onInput={(e) => setAge(e.currentTarget.value)}
                />
              </label>
              <label class="form-control w-full">
                <span class="label-text mb-1 text-sm text-base-content/60">Ville (optionnel)</span>
                <input
                  class="input input-bordered w-full bg-base-200"
                  type="text"
                  placeholder="Ex. Lyon"
                  value={city}
                  disabled={loading}
                  onInput={(e) => setCity(e.currentTarget.value)}
                />
              </label>
            </div>
          </>
        )}

        <fieldset class="space-y-3">
          <legend class="mb-1 flex items-center gap-2 text-sm text-base-content/60">
            <Music2 size={14} class="text-primary" />
            Références sonores
          </legend>
          <p class="text-xs text-base-content/45">
            {isSelf
              ? "Choisis les artistes (et éventuellement un titre précis) — c’est la source principale du style."
              : "Artiste et/ou titre de référence : le genre, le BPM et la prod viennent d’ici. Pas besoin de cocher un style à la main."}
          </p>
          <div class="space-y-3">
            {isSelf ? (
              <StyleArtistPicker
                multiple
                maxPicks={5}
                picks={styleArtistPicks}
                disabled={loading}
                label="Artistes que tu aimes"
                hint="Ajoute 1 à 5 artistes — les paroles et le son seront calés dessus."
                onQueryChange={() => setPickError("")}
                onPicksChange={(next) => {
                  setStyleArtistPicks(next);
                  setPickError("");
                }}
              />
            ) : (
              <StyleArtistPicker
                value={styleArtist}
                pick={styleArtistPick}
                disabled={loading}
                onQueryChange={(q) => {
                  setStyleArtist(q);
                  setStyleArtistPick(null);
                  setPickError("");
                }}
                onPickChange={(pick) => {
                  setStyleArtistPick(pick);
                  if (pick?.name) setStyleArtist(pick.name);
                  setPickError("");
                }}
              />
            )}
            <StyleTrackPicker
              pick={styleTrackPick}
              artistPick={mode === "self" ? styleArtistPicks[0] || null : styleArtistPick}
              disabled={loading}
              onPickChange={(p) => {
                if (!p) {
                  setStyleTrackPick(null);
                  setPickError("");
                  return;
                }
                const artistGenres = (() => {
                  const raw = [];
                  if (mode === "self") {
                    for (const a of styleArtistPicks || []) {
                      if (Array.isArray(a.genres)) raw.push(...a.genres);
                    }
                  } else if (Array.isArray(styleArtistPick?.genres)) {
                    raw.push(...styleArtistPick.genres);
                  }
                  return [...new Set(raw.map((g) => String(g || "").trim()).filter(Boolean))];
                })();
                const genres =
                  Array.isArray(p.genres) && p.genres.length ? p.genres : artistGenres;
                setStyleTrackPick({ ...p, genres });
                setPickError("");
              }}
            />
            {pickError && <p class="text-xs text-warning">{pickError}</p>}
          </div>
        </fieldset>

        <fieldset class="space-y-2">
          <legend class="mb-1 flex items-center gap-2 text-sm text-base-content/60">
            <Palette size={14} class="text-primary" />
            Styles musicaux (optionnel)
          </legend>

          {hasStyleRef && (trackGenreChips.length > 0 || artistGenreChips.length > 0) && (
            <div class="space-y-2 rounded-lg border border-base-content/10 bg-base-200/40 p-3">
              <p class="text-xs text-base-content/55">Déduit de ta référence — pas besoin de recocher :</p>
              <div class="flex flex-wrap gap-2">
                {trackGenreChips.map((chip) => (
                    <span
                      key={`track-${chip.label}`}
                      class="badge badge-lg gap-1 border-0 bg-info/25 font-medium text-info"
                      title="Depuis le titre de référence"
                    >
                      {chip.label}
                      <span class="opacity-70">· titre</span>
                    </span>
                ))}
                {artistGenreChips.map((chip) => (
                    <span
                      key={`artist-${chip.label}`}
                      class="badge badge-lg gap-1 border-0 bg-secondary/25 font-medium text-secondary"
                      title="Depuis l’artiste de référence"
                    >
                      {chip.label}
                      <span class="opacity-70">· artiste</span>
                    </span>
                ))}
              </div>
              <p class="text-[11px] text-base-content/45">
                <span class="text-info">Bleu = titre</span>
                {" · "}
                <span class="text-secondary">Violet = artiste</span>
                {" · "}
                <span class="text-primary">Jaune = forçage manuel</span>
              </p>
            </div>
          )}

          {hasStyleRef ? (
            <p class="text-xs text-base-content/45">
              Ne coche un style jaune que si tu veux <strong>forcer</strong> un genre différent de la
              référence.
            </p>
          ) : (
            <p class="text-xs text-base-content/45">
              Utile si tu n’as pas encore choisi d’artiste / titre — sinon laisse vide et utilise les
              références ci-dessus.
            </p>
          )}
          <div class="flex flex-wrap gap-2">
            {MUSIC_STYLES.map((s) => {
              const manual = s.value
                ? genres.includes(s.value)
                : genres.length === 0 && !showCustom && !hasStyleRef;
              const fromTrack = s.value && trackStyleValues.has(s.value);
              const fromArtist = s.value && artistOnlyStyleValues.has(s.value);
              let cls = "btn btn-sm btn-ghost border border-base-content/15";
              if (manual) cls = "btn btn-sm btn-primary";
              else if (fromTrack) cls = "btn btn-sm border-0 bg-info/25 text-info hover:bg-info/35";
              else if (fromArtist)
                cls = "btn btn-sm border-0 bg-secondary/25 text-secondary hover:bg-secondary/35";
              return (
                <button
                  key={s.label}
                  type="button"
                  class={cls}
                  title={
                    fromTrack
                      ? "Déjà couvert par le titre de référence"
                      : fromArtist
                        ? "Déjà couvert par l’artiste de référence"
                        : undefined
                  }
                  onClick={() => toggleStyle(s.value)}
                >
                  {s.label}
                  {fromTrack && !manual ? " · titre" : ""}
                  {fromArtist && !manual && !fromTrack ? " · artiste" : ""}
                </button>
              );
            })}
            <button
              type="button"
              class={`btn btn-sm ${showCustom ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
              onClick={() => {
                setShowCustom((v) => !v);
                if (showCustom) setCustomGenre("");
              }}
            >
              Personnalisé
            </button>
          </div>
          {resolvedGenres.length > 0 && (
            <p class="text-xs text-primary">Forçage manuel : {formatGenres(resolvedGenres)}</p>
          )}
          {showCustom && (
            <input
              class="input input-bordered mt-2 w-full bg-base-200"
              type="text"
              placeholder="Ex. duo électro-rap aux influences orientales"
              value={customGenre}
              onInput={(e) => setCustomGenre(e.currentTarget.value)}
            />
          )}
        </fieldset>

        <fieldset class="space-y-2">
          <legend class="mb-1 flex items-center gap-2 text-sm text-base-content/60">
            <Languages size={14} class="text-primary" />
            Langue des chansons
          </legend>
          <p class="text-xs text-base-content/45">
            Langue des paroles, du chant et des métadonnées de release.
          </p>
          {songGenLangs && (
            <p class="text-xs text-warning">
              {songGenLanguageHint(keysSnap.songGenPreferredModel || "songgeneration_large")}
            </p>
          )}
          <div class="flex flex-wrap gap-2">
            {langOptions.map((l) => {
              const active = language === l.code;
              const engine = languageEngineLabel(
                l.code,
                keysSnap.musicProvider,
                keysSnap.songGenPreferredModel,
              );
              return (
                <button
                  key={l.code}
                  type="button"
                  class={`btn btn-sm ${active ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
                  onClick={() => {
                    languageManualRef.current = true;
                    setLanguage(l.code);
                  }}
                >
                  {l.label}
                  {engine === "MiniMax" ? (
                    <span class="ml-1 text-[10px] opacity-70">MiniMax</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {(() => {
            const pick = isSelf ? styleArtistPicks[0] : styleArtistPick;
            const inferred = inferLanguageFromStyleRef({
              country: pick?.country,
              language: pick?.language,
              genres: [
                ...(Array.isArray(pick?.genres) ? pick.genres : []),
                ...(Array.isArray(styleTrackPick?.genres) ? styleTrackPick.genres : []),
              ],
              titles: [styleTrackPick?.name, styleTrackPick?.album].filter(Boolean),
            });
            if (!inferred || inferred !== language || languageManualRef.current || !pick?.name) {
              return null;
            }
            return (
              <p class="text-xs text-base-content/45">
                {languageLabel(inferred)} proposé d’après {pick.name} — tu peux changer.
              </p>
            );
          })()}
        </fieldset>

        <fieldset class="space-y-2">
          <legend class="mb-1 text-sm text-base-content/60">Sexe / présentation</legend>
          <p class="text-xs text-base-content/45">
            Voix, portrait et bio collent à ce choix — ce n’est pas le style musical.
          </p>
          <div class="flex flex-wrap gap-2">
            {ARTIST_GENDER_OPTIONS.map((g) => (
              <button
                key={g.value}
                type="button"
                class={`btn btn-sm ${gender === g.value ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
                disabled={loading}
                onClick={() => {
                  genderManualRef.current = true;
                  setGender(g.value);
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
          {(() => {
            const pick = isSelf ? styleArtistPicks[0] : styleArtistPick;
            const inferred = inferGenderFromStyleRef(pick);
            if (!inferred || inferred !== gender || genderManualRef.current || !pick?.name) {
              return null;
            }
            return (
              <p class="text-xs text-base-content/45">
                {ARTIST_GENDER_LABELS[inferred]} proposé d’après {pick.name} — tu peux changer.
              </p>
            );
          })()}
        </fieldset>

        <label class="form-control w-full">
          <span class="label-text mb-1 text-sm text-base-content/60">
            {isSelf ? "Univers / personnalité (optionnel)" : "Personnalité / univers (optionnel)"}
          </span>
          <textarea
            class="textarea textarea-bordered w-full bg-base-200"
            rows={3}
            placeholder={
              isSelf
                ? "Histoire, vibe, thèmes que tu veux chanter…"
                : "Origines, look, histoire… (pas le style musical — déjà choisi au-dessus)"
            }
            value={bioHint}
            onInput={(e) => setBioHint(e.currentTarget.value)}
          />
        </label>

        <button
          class="btn btn-primary gap-2 self-start"
          disabled={
            loading ||
            nameBlocked ||
            (showCustom &&
              !customGenre.trim() &&
              genres.length === 0 &&
              !isSelf &&
              !hasStyleRef) ||
            (isSelf &&
              (!name.trim() ||
                !gender ||
                !age ||
                !photos.length ||
                !styleArtistPicks.length))
          }
          onClick={handleGenerate}
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <UserRound size={18} />}
          {loading
            ? isSelf
              ? "Création de ton profil…"
              : "Profil + portrait…"
            : isSelf
              ? "Créer mon profil artiste"
              : "Générer le profil & le visuel"}
        </button>
      </div>

      {artist && (
        <article class="animate-rise space-y-5 border-t border-base-content/10 pt-5">
          <div class="grid gap-6 md:grid-cols-[240px_1fr] md:items-start">
            <figure class="space-y-2">
              {(() => {
                const portraitSrc =
                  photos[0] ||
                  (artist.imageUrl && !/^data:image\/svg/i.test(artist.imageUrl)
                    ? artist.imageUrl
                    : "");
                return portraitSrc ? (
                <img
                  src={portraitSrc}
                  alt={`Portrait de ${artist.name}`}
                  class="aspect-square w-full object-cover shadow-2xl shadow-black/40"
                />
                ) : (
                <div class="flex aspect-square w-full items-center justify-center border border-warning/30 bg-warning/10 p-3 text-center text-sm text-warning">
                  Portrait photo manquant. Clique « Générer le profil » (Gemini Image ou Replicate).
                </div>
                );
              })()}
              <figcaption class="text-xs text-base-content/45">
                {artist.mode === "self"
                  ? "Identité visuelle · ta photo"
                  : "Identité visuelle · portrait artiste (photo, pas SVG)"}
              </figcaption>
              {artist.imageProvider && (
                <p class="text-xs text-base-content/45">Source : {artist.imageProvider}</p>
              )}
              {artist.imageWarning && (
                <p class="text-xs text-warning">{artist.imageWarning}</p>
              )}
              {photos.length > 1 && (
                <div class="flex flex-wrap gap-1.5 pt-1">
                  {photos.slice(0, 4).map((src, i) => (
                    <img
                      key={`thumb-${i}-${src.length}`}
                      src={src}
                      alt=""
                      class="h-12 w-12 object-cover border border-base-content/10"
                    />
                  ))}
                </div>
              )}
              {(!photos[0] &&
                (!artist.imageUrl || /^data:image\/svg/i.test(artist.imageUrl))) && (
                <p class="text-xs text-warning">
                  Sans photo réelle, la jaquette et ONCE resteront bloqués. Billing Replicate :{" "}
                  <a
                    class="link"
                    href="https://replicate.com/account/billing#billing"
                    target="_blank"
                    rel="noreferrer"
                  >
                    replicate.com/billing
                  </a>
                </p>
              )}
            </figure>

            <div class="space-y-4">
              <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.2em] text-primary">
                    {artist.mode === "self" ? "Profil réel" : artist.aka}
                  </p>
                  <h3 class="font-display text-3xl font-bold">{artist.name}</h3>
                  {artist.slug && (
                    <a class="link link-primary text-sm" href={`/artiste/${artist.slug}`}>
                      Page artiste /{artist.slug}
                    </a>
                  )}
                </div>
                <div class="flex gap-2">
                  {(artist.palette || []).map((c) => (
                    <span
                      key={c}
                      class="h-6 w-6 rounded-full border border-base-content/20"
                      style={{ background: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                {displayGenres.length ? (
                  displayGenres.map((g) => (
                    <span
                      key={g}
                      class="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary"
                    >
                      <Music2 size={12} />
                      {g}
                    </span>
                  ))
                ) : (
                  <span class="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                    <Music2 size={12} />
                    Style non défini
                  </span>
                )}
                {savedGenderLabel && (
                  <span class="inline-flex items-center border border-base-content/15 px-2.5 py-1 text-xs text-base-content/70">
                    {savedGenderLabel}
                  </span>
                )}
                {artist.age != null && (
                  <span class="inline-flex items-center border border-base-content/15 px-2.5 py-1 text-xs text-base-content/70">
                    {artist.age} ans
                  </span>
                )}
                <span class="inline-flex items-center gap-1.5 border border-secondary/30 bg-secondary/10 px-2.5 py-1 text-xs text-secondary">
                  <Languages size={12} />
                  {languageLabel(artist.language)}
                </span>
                {artist.mood && (
                  <span class="inline-flex items-center border border-base-content/15 px-2.5 py-1 text-xs text-base-content/70">
                    {artist.mood}
                  </span>
                )}
              </div>

              <p class="leading-relaxed text-base-content/80">{artist.bio}</p>

              <div class="flex flex-wrap gap-4 text-sm text-base-content/70">
                <span class="inline-flex items-center gap-2">
                  <MapPin size={16} class="text-secondary" /> {artist.city}
                </span>
                <span class="inline-flex items-center gap-2">
                  <Mic2 size={16} class="text-accent" /> {artist.voice}
                  {artist.voiceSample?.url || artist.voiceSample?.s3Key ? (
                    <span class="text-xs text-success">· extrait vocal</span>
                  ) : null}
                </span>
              </div>

              <p class="text-sm text-base-content/55">
                Influences : {(artist.influences || []).join(" · ")}
              </p>
              {(favoriteNames?.length || artist.styleArtist) && (
                <p class="text-sm text-base-content/55">
                  {artist.mode === "self" ? "Artistes aimés" : "Référence style"} :{" "}
                  <span class="text-primary">
                    {(favoriteNames || [artist.styleArtist]).filter(Boolean).join(" · ")}
                  </span>
                  {artist.styleLock?.source ? (
                    <span class="text-base-content/40">
                      {" "}
                      · {artist.styleLock.source}
                      {artist.styleLock.confidence ? ` · ${artist.styleLock.confidence}` : ""}
                    </span>
                  ) : null}
                </p>
              )}
              {artist.styleLock?.genreSummary && (
                <p class="text-sm text-base-content/55">
                  Style verrouillé :{" "}
                  <span class="text-secondary">{artist.styleLock.genreSummary}</span>
                  {artist.styleLock.audioListened ? (
                    <span class="ml-2 text-xs text-success">· preview écouté</span>
                  ) : null}
                </p>
              )}
              {(artist.styleLock?.timbre ||
                artist.styleLock?.rhythmFeel ||
                artist.styleLock?.bpm ||
                (artist.styleLock?.instruments || []).length > 0) && (
                <div class="space-y-1 rounded-lg border border-base-content/10 bg-base-200/40 px-3 py-2 text-xs text-base-content/65">
                  <p class="font-medium uppercase tracking-wider text-base-content/45">
                    DNA sonore
                  </p>
                  {artist.styleLock.timbre && (
                    <p>
                      Timbre — <span class="text-base-content/80">{artist.styleLock.timbre}</span>
                    </p>
                  )}
                  {(artist.styleLock.rhythmFeel || artist.styleLock.tempoFeel) && (
                    <p>
                      Groove —{" "}
                      <span class="text-base-content/80">
                        {artist.styleLock.rhythmFeel || artist.styleLock.tempoFeel}
                      </span>
                    </p>
                  )}
                  {artist.styleLock.bpm ? (
                    <p>
                      Tempo — <span class="text-base-content/80">~{artist.styleLock.bpm} BPM</span>
                      {artist.styleLock.energy
                        ? ` · énergie ${artist.styleLock.energy}`
                        : ""}
                    </p>
                  ) : null}
                  {(artist.styleLock.instruments || []).length > 0 && (
                    <p>
                      Instruments —{" "}
                      <span class="text-base-content/80">
                        {artist.styleLock.instruments.slice(0, 6).join(" · ")}
                      </span>
                    </p>
                  )}
                  {artist.styleLock.vocalStyle && (
                    <p>
                      Voix —{" "}
                      <span class="text-base-content/80">
                        {[artist.styleLock.vocalStyle, artist.styleLock.vocalRegister]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </p>
                  )}
                </div>
              )}
              {artist.styleLock?.production && (
                <p class="text-xs text-base-content/45">{artist.styleLock.production}</p>
              )}

              {vi && (
                <div class="space-y-3 border-t border-base-content/10 pt-4">
                  <p class="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
                    <Palette size={14} /> Identité visuelle
                  </p>
                  <ul class="space-y-2 text-sm text-base-content/75">
                    {vi.look && (
                      <li class="flex gap-2">
                        <Camera size={16} class="mt-0.5 shrink-0 text-secondary" />
                        <span>
                          <span class="text-base-content/45">Look — </span>
                          {vi.look}
                        </span>
                      </li>
                    )}
                    {vi.wardrobe && (
                      <li class="flex gap-2">
                        <Shirt size={16} class="mt-0.5 shrink-0 text-accent" />
                        <span>
                          <span class="text-base-content/45">Wardrobe — </span>
                          {vi.wardrobe}
                        </span>
                      </li>
                    )}
                    {vi.photographyStyle && (
                      <li>
                        <span class="text-base-content/45">Photo — </span>
                        {vi.photographyStyle}
                      </li>
                    )}
                    {vi.logoConcept && (
                      <li>
                        <span class="text-base-content/45">Logo — </span>
                        {vi.logoConcept}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </article>
      )}
    </section>
  );
}
