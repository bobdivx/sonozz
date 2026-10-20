"""Sonozz voice-check worker — mesure la rugosité de la voix d'homme d'un duo.

POST /check {"audioUrl": "https://…mp3", "maxSeconds": 45}
 -> {"maleHnr": 8.4, "maleSeconds": 12.0, "femaleSeconds": 9.0, "windows": 26}

Méthode (validée sur ~120 extraits ACE vs Bob Dominator, cf. deep.py) :
 1. télécharge l'audio, garde les `maxSeconds` premières secondes ;
 2. sépare la voix (demucs htdemucs, --two-stems vocals ; GPU si dispo) ;
 3. fenêtres de 3 s (pas de 1.5 s) ; F0 médian Praat ; fenêtre « homme » si 90 < F0 < 330 Hz
    (les voix de femme ACE sont à ~400 Hz ; pas de classifieur de genre pour rester léger) ;
 4. HNR Praat (cross-correlation) médian sur les fenêtres homme voisées.
Seuil Sonozz : HNR > 10 dB = voix trop propre -> relance (max 2).

Lancer : pip install demucs praat-parselmouth soundfile librosa ; python server.py --port 8765
Puis côté Sonozz : SONOZZ_VOICE_CHECK_URL=http://<hôte>:8765
"""
import argparse, json, os, subprocess, sys, tempfile, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np

def measure(audio_url: str, max_seconds: float = 45.0) -> dict:
    import librosa, parselmouth, soundfile as sf
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "in.mp3")
        req = urllib.request.Request(audio_url, headers={"User-Agent": "sonozz-voice-check/1"})
        with urllib.request.urlopen(req, timeout=60) as r, open(src, "wb") as f:
            f.write(r.read())
        y, sr = librosa.load(src, sr=44100, mono=False, duration=max_seconds)
        clip = os.path.join(td, "clip.wav")
        sf.write(clip, (y.T if y.ndim > 1 else y), sr)
        subprocess.run([sys.executable, "-m", "demucs", "--two-stems", "vocals", "-n", "htdemucs", "-o", td, clip],
                       check=True, capture_output=True)
        v, vsr = librosa.load(os.path.join(td, "htdemucs", "clip", "vocals.wav"), sr=16000, mono=True)
    win, hop = 3 * 16000, int(1.5 * 16000)
    rms_all = np.sqrt(np.mean(v ** 2)) + 1e-9
    male, female, n = [], 0, 0
    for s in range(0, max(1, len(v) - win + 1), hop):
        seg = v[s:s + win]
        if np.sqrt(np.mean(seg ** 2)) < 0.25 * rms_all:
            continue
        snd = parselmouth.Sound(seg.astype(np.float64), sampling_frequency=16000)
        f0 = snd.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=700).selected_array["frequency"]
        voiced = f0[f0 > 0]
        if len(voiced) < 0.3 * len(f0):
            continue
        n += 1
        med = float(np.median(voiced))
        if 90 < med < 330:
            h = snd.to_harmonicity_cc(time_step=0.01, minimum_pitch=75).values
            h = h[h > -100]
            if len(h):
                male.append(float(np.median(h)))
        elif med >= 330:
            female += 1
    return {
        "maleHnr": round(float(np.median(male)), 2) if male else None,
        "maleSeconds": round(len(male) * 1.5, 1),
        "femaleSeconds": round(female * 1.5, 1),
        "windows": n,
    }

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path.rstrip("/") != "/check":
            self.send_response(404); self.end_headers(); return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            url = str(body.get("audioUrl") or "")
            if not url.startswith(("http://", "https://")):
                raise ValueError("audioUrl http(s) requis")
            out = measure(url, float(body.get("maxSeconds") or 45))
            code = 200
        except Exception as e:  # noqa: BLE001
            out, code = {"error": str(e)[:300]}, 500
        data = json.dumps(out).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        data = b'{"ok":true}'
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data)

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--once":
        print(json.dumps(measure(sys.argv[2]))); sys.exit(0)
    ap = argparse.ArgumentParser(); ap.add_argument("--port", type=int, default=8765); ap.add_argument("--host", default="0.0.0.0")
    a = ap.parse_args()
    ThreadingHTTPServer((a.host, a.port), H).serve_forever()
