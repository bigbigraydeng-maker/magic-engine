"""Command-line music beat analyser: BPM, beat grid, downbeat and bars per file.
usage: python3 analyze-music.py <path> [<path> ...] [--out result.json]"""
import sys, os, json, subprocess
import numpy as np
from scipy.signal import stft, butter, lfilter

SR = 22050
HOP = 256
AUDIO_EXT = ('.mp3', '.wav', '.m4a')


def load(path):
    """Decode the whole file to mono float32 at SR via ffmpeg; return (samples, sr)."""
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-vn',
                          '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32), SR


def probe_duration(path):
    """Return the container duration in seconds via ffprobe, or None on failure."""
    out = subprocess.run(['ffprobe', '-nostdin', '-v', 'error', '-show_entries',
                          'format=duration', '-of', 'default=nw=1:nk=1', path],
                         capture_output=True).stdout.decode().strip()
    try:
        return float(out)
    except ValueError:
        return None


def grid_score(flux, fps, dur_s, bpm, step):
    """Mean spectral flux over a beat grid for bpm; return (score, best offset)."""
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


def normalise_bpm(bpm):
    """Halve tempos above 150 BPM; return (bpm, halved)."""
    if bpm > 150:
        return bpm / 2.0, True
    return bpm, False


def bar_starts(downbeat, bpm, duration):
    """Return bar start times every 4 beats from downbeat, fully inside duration."""
    bar = 4.0 * 60.0 / bpm
    out, k = [], 0
    while downbeat + k * bar + bar <= duration:
        out.append(round(downbeat + k * bar, 3))
        k += 1
    return out


def analyse(path):
    """Analyse one audio file; return the result dict or an error dict."""
    y, sr = load(path)
    if len(y) < sr:
        return {'error': 'empty or too short audio'}
    f, t, Z = stft(y, fs=sr, nperseg=1024, noverlap=1024 - HOP)
    flux = np.maximum(0, np.diff(np.abs(Z), axis=1)).sum(axis=0)
    flux = (flux - flux.mean()) / (flux.std() + 1e-9)
    fps = sr / HOP
    dur_s = len(flux) / fps
    cands = {b: grid_score(flux, fps, dur_s, b, 0.01)[0] for b in np.arange(80.0, 200.5, 1.0)}
    top = max(cands.values())
    good = [b for b, v in cands.items() if v >= 0.88 * top]
    bpm0 = max(good)
    fine = {b: grid_score(flux, fps, dur_s, b, 0.01) for b in np.arange(bpm0 - 1.5, bpm0 + 1.51, 0.1)}
    bpm1 = max(fine, key=lambda b: fine[b][0])
    fine2 = {b: grid_score(flux, fps, dur_s, b, 0.002) for b in np.arange(bpm1 - 0.15, bpm1 + 0.151, 0.01)}
    raw_bpm = max(fine2, key=lambda b: fine2[b][0])
    off = fine2[raw_bpm][1]
    bpm, halved = normalise_bpm(raw_bpm)
    period = 60.0 / bpm
    if halved:
        raw_period = 60.0 / raw_bpm
        cands_off = [off, off + raw_period]
        scores = []
        for o in cands_off:
            idx = np.round(np.arange(o, dur_s, period) * fps).astype(int) - 1  # diff() shifts flux by one frame
            idx = idx[(idx >= 0) & (idx < len(flux))]
            scores.append(flux[idx].mean() if len(idx) else -1e9)
        off = cands_off[int(np.argmax(scores))]
    first = off % period
    if first > 0.9 * period:
        first -= period
    times = np.arange(first, dur_s, period)
    b_, a_ = butter(2, [40 / (sr / 2), 150 / (sr / 2)], 'band')
    kick = np.abs(lfilter(b_, a_, y))
    ks = []
    for tt in times:
        i0 = int(max(0.0, tt - 0.02) * sr)
        i1 = min(len(kick), int(max(0.0, tt + 0.06) * sr))
        ks.append(float(kick[i0:i1].max()) if i1 > i0 else 0.0)
    phase = int(np.argmax([np.mean(ks[k::4]) for k in range(4)])) if len(ks) >= 8 else 0
    first_beat = float(times[0]) if times[0] >= 0 else float(times[0]) + period
    downbeat = float(times[0]) + phase * period
    while downbeat < 0:
        downbeat += 4 * period
    duration = probe_duration(path)
    if duration is None:
        duration = dur_s
    return {'durationSec': round(duration, 3), 'rawBpm': round(raw_bpm, 2),
            'bpm': round(bpm, 2), 'halved': halved, 'firstBeat': round(first_beat, 3),
            'downbeat': round(downbeat, 3), 'bars': bar_starts(downbeat, bpm, duration)}


def expand(paths):
    """Expand directories non-recursively to audio files, skipping scratch files named temp*."""
    out = []
    for p in paths:
        if os.path.isdir(p):
            for name in sorted(os.listdir(p)):
                if name.lower().endswith(AUDIO_EXT) and 'temp' not in name.lower():
                    out.append(os.path.join(p, name))
        else:
            out.append(p)
    return out


def main():
    """Parse arguments, analyse every file, print and optionally save the JSON."""
    args = sys.argv[1:]
    out_path = None
    if '--out' in args:
        i = args.index('--out')
        out_path = args[i + 1]
        args = args[:i] + args[i + 2:]
    tracks, ok = [], 0
    for path in expand(args):
        base = os.path.basename(path)
        entry = {'file': base, 'dir': os.path.basename(os.path.dirname(os.path.abspath(path)))}
        try:
            res = analyse(path)
            if 'error' in res:
                entry['error'] = res['error']
            else:
                entry.update(res)
                ok += 1
        except Exception:
            entry['error'] = 'could not analyse audio'
        tracks.append(entry)
    text = json.dumps({'tracks': tracks}, indent=2, ensure_ascii=False)
    print(text)
    if out_path:
        with open(out_path, 'w', encoding='utf-8') as fh:
            fh.write(text)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
