import type { MusicTrack } from './types'

/** A detected tempo above this is treated as double-time and halved. */
export const FOLD_ABOVE_BPM = 150

/** Allowed music file extensions (mirrors the engine's MUSIC_EXTS). */
export const MUSIC_EXTS = ['.mp3', '.wav', '.m4a']

/** Minimum on-screen duration of the finished montage, in seconds. */
export const MIN_VIDEO_SEC = 14.5
/** Maximum on-screen duration of the finished montage, in seconds. */
export const MAX_VIDEO_SEC = 18
/** Minimum spacing between consecutive beats, in seconds. */
export const MIN_BEAT_GAP_SEC = 0.25

/** Round a number to 3 decimal places. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Compute `count` beat times (seconds from the start of the audio). */
export function beatGrid(entry: MusicTrack, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 80) {
    throw new Error('节拍数量必须是 1 到 80 的整数')
  }
  const basePeriod = 60 / entry.bpmDetected
  const step = entry.bpmDetected > FOLD_ABOVE_BPM ? 2 : 1
  const firstIndex = step === 1 ? entry.barPhase : entry.barPhase % 2
  const out: number[] = []
  for (let k = 0; k < count; k++) {
    out.push(round3(entry.offsetSec + (firstIndex + k * step) * basePeriod))
  }
  const last = out[out.length - 1]
  if (last > entry.durationSec - 1) {
    throw new Error('音乐太短：' + entry.id + ' 放不下 ' + count + ' 个节拍')
  }
  return out
}

/** Build the safe staged file name (id + lowercased extension) for a track. */
export function stagedFileName(entry: Pick<MusicTrack, 'id' | 'file'>): string {
  const dot = entry.file.lastIndexOf('.')
  if (dot < 0) {
    throw new Error('音乐文件扩展名不支持：' + entry.file)
  }
  const ext = entry.file.slice(dot).toLowerCase()
  if (!MUSIC_EXTS.includes(ext)) {
    throw new Error('音乐文件扩展名不支持：' + entry.file)
  }
  return `${entry.id}${ext}`
}

/** A chosen track plus the beat grid that fits the target video duration. */
export interface MusicPick {
  track: MusicTrack
  totalBeats: number
  beats: number[]
  durationSec: number
}

/** Energy ranking: high first, then mid, then low. */
const ENERGY_RANK: Record<MusicTrack['energy'], number> = {
  high: 0,
  mid: 1,
  low: 2,
}

/** True when the grid is strictly increasing with every gap >= MIN_BEAT_GAP_SEC. */
function gridIsUsable(beats: readonly number[]): boolean {
  for (let i = 1; i < beats.length; i++) {
    if (beats[i] - beats[i - 1] < MIN_BEAT_GAP_SEC) {
      return false
    }
  }
  return true
}

/**
 * Pick a deterministic track + totalBeats (a multiple of 4, >= minBeats, 16..64)
 * so beats[totalBeats] lands in [MIN_VIDEO_SEC, MAX_VIDEO_SEC].
 */
export function pickMusic(tracks: readonly MusicTrack[], minBeats: number): MusicPick | null {
  const sorted = [...tracks].sort((a, b) => {
    const rank = ENERGY_RANK[a.energy] - ENERGY_RANK[b.energy]
    if (rank !== 0) {
      return rank
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const start = Math.max(16, Math.ceil(minBeats / 4) * 4)
  for (const track of sorted) {
    for (let totalBeats = start; totalBeats <= 64; totalBeats += 4) {
      let beats: number[]
      try {
        beats = beatGrid(track, totalBeats + 1)
      } catch {
        continue
      }
      if (!gridIsUsable(beats)) {
        continue
      }
      const durationSec = beats[totalBeats]
      if (durationSec < MIN_VIDEO_SEC || durationSec > MAX_VIDEO_SEC) {
        continue
      }
      return { track, totalBeats, beats, durationSec }
    }
  }
  return null
}
