import { describe, it, expect, beforeAll } from 'vitest'
import { beatGrid, stagedFileName, pickMusic, MIN_VIDEO_SEC, MAX_VIDEO_SEC } from './music'
import type { MusicTrack } from './types'
import { loadCatalogTracks } from './catalog-fixture'
import { loadRealEngine, type RealEngine } from './engine-loader'

/** Build a MusicTrack with sensible defaults, overriding only what a test cares about. */
function track(overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id: 'track-a',
    folder: 'Music',
    file: 'track-a.m4a',
    durationSec: 60,
    bpmDetected: 120,
    offsetSec: 0,
    barPhase: 0,
    status: 'ready',
    energy: 'mid',
    style: 'pop',
    mood: 'happy',
    ...overrides,
  }
}

describe('beatGrid', () => {
  it('computes evenly spaced beats from offset and barPhase', () => {
    const t = track({ bpmDetected: 120, offsetSec: 0.2, barPhase: 0, durationSec: 60 })
    expect(beatGrid(t, 4)).toEqual([0.2, 0.7, 1.2, 1.7])
  })

  it('folds double-time tempos above 150 bpm', () => {
    const t = track({ bpmDetected: 180, offsetSec: 0, barPhase: 0, durationSec: 60 })
    const beats = beatGrid(t, 3)
    const spacing = 2 * (60 / 180)
    expect(beats[0]).toBeCloseTo(0, 2)
    expect(beats[1]).toBeCloseTo(spacing, 2)
    expect(beats[2]).toBeCloseTo(2 * spacing, 2)
  })
})

describe('stagedFileName', () => {
  it('returns id plus lowercased extension', () => {
    expect(stagedFileName({ id: 'sunrise', file: 'Sunrise.M4A' })).toBe('sunrise.m4a')
  })

  it('throws on unsupported extensions', () => {
    expect(() => stagedFileName({ id: 'x', file: 'x.flac' })).toThrow()
  })
})

describe('pickMusic', () => {
  it('returns null for an empty list', () => {
    expect(pickMusic([], 16)).toBeNull()
  })

  it('returns null when the track is too short', () => {
    const t = track({ durationSec: 10 })
    expect(pickMusic([t], 16)).toBeNull()
  })

  it('is deterministic and prefers high energy over mid', () => {
    const mid = track({ id: 'aaa', energy: 'mid' })
    const high = track({ id: 'zzz', energy: 'high' })
    const first = pickMusic([mid, high], 16)
    const second = pickMusic([mid, high], 16)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.track.id).toBe('zzz')
    expect(second?.track.id).toBe('zzz')
  })

  it('produces a grid of totalBeats + 1 with a duration in range', () => {
    const t = track({ bpmDetected: 120, durationSec: 60 })
    const pick = pickMusic([t], 16)
    expect(pick).not.toBeNull()
    if (pick === null) {
      return
    }
    expect(pick.beats.length).toBe(pick.totalBeats + 1)
    expect(pick.totalBeats % 4).toBe(0)
    expect(pick.durationSec).toBeGreaterThanOrEqual(MIN_VIDEO_SEC)
    expect(pick.durationSec).toBeLessThanOrEqual(MAX_VIDEO_SEC)
  })
})

describe('agreement with the engine', () => {
  const tracks = loadCatalogTracks()
  let engine: RealEngine
  beforeAll(async () => {
    engine = await loadRealEngine()
  })

  it('has at least one catalog track', () => {
    expect(tracks.length).toBeGreaterThan(0)
  })

  it('matches beatGrid and stagedFileName for every catalog track', () => {
    for (const t of tracks) {
      let engineBeats: number[] | null = null
      try {
        engineBeats = engine.beatGrid(t, 33)
      } catch {
        engineBeats = null
      }
      if (engineBeats === null) {
        expect(() => beatGrid(t, 33)).toThrow()
      } else {
        expect(beatGrid(t, 33)).toEqual(engineBeats)
      }

      let engineName: string | null = null
      try {
        engineName = engine.stagedFileName(t)
      } catch {
        engineName = null
      }
      if (engineName === null) {
        expect(() => stagedFileName(t)).toThrow()
      } else {
        expect(stagedFileName(t)).toBe(engineName)
      }
    }
  })
})
