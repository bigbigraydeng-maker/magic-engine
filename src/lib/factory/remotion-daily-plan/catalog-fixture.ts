// Test support only: the real engine music catalog as typed tracks. Never imported by runtime code.
import catalog from '../../../../scripts/factory-worker/engines/remotion/catalog/music.json'
import type { MusicTrack } from './types'

function toTrack(value: unknown): MusicTrack {
  if (typeof value !== 'object' || value === null) throw new Error('catalog entry is not an object')
  const v = value as Record<string, unknown>
  const { folder, status, energy } = v
  if (folder !== 'Music' && folder !== '_shared/music') throw new Error('bad folder')
  if (status !== 'ready' && status !== 'beats_unverified') throw new Error('bad status')
  if (energy !== 'low' && energy !== 'mid' && energy !== 'high') throw new Error('bad energy')
  if (
    typeof v.id !== 'string' || typeof v.file !== 'string' || typeof v.durationSec !== 'number' ||
    typeof v.bpmDetected !== 'number' || typeof v.offsetSec !== 'number' || typeof v.barPhase !== 'number' ||
    typeof v.style !== 'string' || typeof v.mood !== 'string'
  ) throw new Error('bad field types')
  return {
    id: v.id, folder, file: v.file, durationSec: v.durationSec, bpmDetected: v.bpmDetected,
    offsetSec: v.offsetSec, barPhase: v.barPhase, status, energy, style: v.style, mood: v.mood,
  }
}

export function loadCatalogTracks(): MusicTrack[] {
  const raw: unknown[] = Array.isArray(catalog.tracks) ? catalog.tracks : []
  return raw.map(toTrack)
}
