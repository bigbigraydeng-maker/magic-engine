/** Metadata about a music catalogue entry, used to derive beat times. */
export interface MusicBeatInfo {
  bpm: number;
  durationSec: number;
  bars: readonly number[];
}

/** Maximum number of beats accepted by the props schema `beats` array. */
export const MAX_BEATS = 80;

/** Frame rate of the video; must equal FPS in timing.ts (checked by a test). */
export const MUSIC_FPS = 30;

/** Bar start (seconds) inside the music file, exactly as stored in the catalogue. */
function barStart(entry: MusicBeatInfo, startBar: number): number {
  if (!Number.isInteger(startBar) || startBar < 0 || startBar >= entry.bars.length) {
    throw new Error(
      `起始小节超出范围：${startBar}（可用范围 0..${entry.bars.length - 1}）`,
    );
  }
  return entry.bars[startBar];
}

/** Where the music excerpt starts: the frame boundary at or just before the bar start (Audio can only trim whole frames). */
export function musicStartFor(entry: MusicBeatInfo, startBar: number): number {
  const frames = Math.floor(barStart(entry, startBar) * MUSIC_FPS + 1e-6);
  return Math.round((frames / MUSIC_FPS) * 10000) / 10000;
}

/** Build `needBeats` beat times (seconds) relative to the excerpt start; the first is the bar start, under one frame in. */
export function beatsFor(
  entry: MusicBeatInfo,
  needBeats: number,
  startBar: number,
  stride = 1,
): number[] {
  if (!Number.isInteger(needBeats) || needBeats < 1 || needBeats > MAX_BEATS) {
    throw new Error(`节拍数量必须是 1 到 ${MAX_BEATS} 之间的整数，现在是 ${needBeats}`);
  }
  if (!Number.isInteger(stride) || stride < 1) {
    throw new Error(`步长必须是正整数，现在是 ${stride}`);
  }
  if (!Number.isFinite(entry.bpm) || entry.bpm < 30 || entry.bpm > 300) {
    throw new Error(`BPM 必须在 30 到 300 之间，现在是 ${entry.bpm}`);
  }
  const start = musicStartFor(entry, startBar);
  const lead = barStart(entry, startBar) - start;
  const step = stride * (60 / entry.bpm);
  if (Math.round(step * 1000) < 1) {
    throw new Error('节拍间隔太近');
  }
  const beats: number[] = [];
  for (let i = 0; i < needBeats; i++) {
    beats.push(Math.round((lead + i * step) * 1000) / 1000);
  }
  const last = beats[beats.length - 1];
  if (start + last > entry.durationSec) {
    throw new Error(
      `音乐不够长：需要 ${(start + last).toFixed(1)} 秒，可用 ${entry.durationSec.toFixed(1)} 秒`,
    );
  }
  return beats;
}
