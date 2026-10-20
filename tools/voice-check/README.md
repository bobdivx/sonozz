# voice-check (Sonozz)

Petit worker HTTP qui mesure si la voix d'homme d'un duo est assez rauque (HNR Praat après
séparation demucs). Sonozz l'appelle après chaque génération ACE d'un **duo interne**
(ex. Skarlvind) : si `maleHnr > 12 dB` (échelle du worker ; ≈ 10 dB sur l’analyse complète de la piste, calibré sur 5 extraits ; surcharge `SONOZZ_VOICE_CHECK_HNR_MAX_DB`), il relance avec une nouvelle graine (max 2 relances),
puis garde la prise la plus rauque.

- Installer : `pip install demucs praat-parselmouth soundfile librosa`
- Lancer : `python server.py --port 8765` (idéalement sur la machine GPU d'ACE ; ~1 min par check sur CPU (mesuré sur la box, chargée), quelques secondes sur GPU)
- Brancher : variable d'env Sonozz `SONOZZ_VOICE_CHECK_URL=http://<hôte>:8765`
- Sans cette variable : aucune vérification (comportement inchangé).

Limite : « homme » = fenêtres de F0 médian entre 90 et 330 Hz (pas de classifieur de genre),
ce qui est fiable pour ACE (voix de femme ~400 Hz) mais pas universel.
