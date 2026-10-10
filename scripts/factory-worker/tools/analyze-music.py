"""Beat grid for one audio file: BPM, first-beat offset, bar downbeat position, duration.
Adapted from the beat detector already proven on the CTS Remotion reels (numpy/scipy + ffmpeg, no librosa).
usage: python3 analyze-music.py <audio>   -> prints one JSON line
{durationSec, bpmDetected, offsetSec, barPhase, strength}

Known weakness (measured 2026-10-06): the detector prefers the faster pulse, so the same song can come back
at 2x (199 vs 100). It reports the raw value on purpose; src/music.ts folds > 150 BPM down and the
first render of every track must be checked with a lag measurement before the track is marked ready.

The whole file is analysed (not just the first minute) and spectral-flux index i is the frame i+1, so beat times are not one
frame early (both fixed 2026-10-06 after a synthetic click-track check)."""
import sys, json, subprocess
import numpy as np
from scipy.signal import stft, butter, lfilter

SR = 22050
HOP = 512


def duration_of(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout.strip()
    return round(float(out), 1)


def load(path):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-vn', '-ac', '1',
                          '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def analyse(path):
    y = load(path)
    _, _, Z = stft(y, fs=SR, nperseg=1024, noverlap=1024 - HOP)
    flux = np.maximum(0, np.diff(np.abs(Z), axis=1)).sum(axis=0)  # spectral flux
    flux = (flux - flux.mean()) / (flux.std() + 1e-9)
    fps = SR / HOP
    dur_s = len(flux) / fps

    def grid_score(bpm, step=0.01):
        period = 60.0 / bpm
        best, off = -1e9, 0.0
        for o in np.arange(0, period, step):
            idx = np.round(np.arange(o, dur_s, period) * fps).astype(int) - 1  # diff() shifts flux by one frame
            idx = idx[(idx >= 0) & (idx < len(flux))]
            if len(idx) == 0:
                continue
            sc = flux[idx].mean()
            if sc > best:
                best, off = sc, o
        return best, off

    cands = {b: grid_score(b) for b in np.arange(80.0, 200.5, 1.0)}
    top = max(v[0] for v in cands.values())
    bpm0 = max(b for b, v in cands.items() if v[0] >= 0.88 * top)  # fastest pulse nearly as well supported
    fine = {b: grid_score(b) for b in np.arange(bpm0 - 1.5, bpm0 + 1.51, 0.1)}
    bpm1 = max(fine, key=lambda b: fine[b][0])
    fine2 = {b: grid_score(b, 0.002) for b in np.arange(bpm1 - 0.15, bpm1 + 0.151, 0.01)}  # whole-file grids drift if BPM is coarse
    bpm = max(fine2, key=lambda b: fine2[b][0])
    period = 60.0 / bpm
    off = fine2[bpm][1] % period  # first beat, always in [0, period)
    times = np.arange(off, dur_s, period)
    b_, a_ = butter(2, [40 / (SR / 2), 150 / (SR / 2)], 'band')  # kick band decides which beat opens a bar
    kick = np.abs(lfilter(b_, a_, y))
    ks = []
    for t in times:
        i0, i1 = int(max(0.0, t - 0.02) * SR), min(len(kick), int((t + 0.06) * SR))
        ks.append(float(kick[i0:i1].max()) if i1 > i0 else 0.0)
    phase = int(np.argmax([np.mean(ks[k::4]) for k in range(4)])) if len(ks) >= 8 else 0
    return {'durationSec': duration_of(path), 'bpmDetected': round(float(bpm), 2), 'offsetSec': round(float(off), 3),
            'barPhase': phase, 'strength': round(float(np.clip(flux, 0, None).mean()), 3)}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: python3 analyze-music.py <audio>')
    print(json.dumps(analyse(sys.argv[1])))
