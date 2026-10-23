import musicCatalogRaw from '../../../scripts/factory-worker/engines/remotion/catalog/music.json'
import musicVocalsRaw from '../../../scripts/factory-worker/engines/remotion/catalog/music-vocals.json'
import { beatGrid, excerptFor, parseMusicCatalog, stagedFileName, type MusicEntry } from '../../../scripts/factory-worker/engines/remotion/src/music'
import { FPS } from '../../../scripts/factory-worker/engines/remotion/src/timing'
import { loadTemplate, isTemplateId } from '../../../scripts/factory-worker/engines/remotion/src/templates'

interface VocalRecord {
  name?: string
  verdict?: string
  cleanUntilSec?: number
  signedBy?: string
}

export interface RemotionMusicChoice {
  id: string
  file: string
  mood: string
  style: string
  energy: string
  status: string
  clean_until_sec: number
  max_video_seconds: number
}

interface RemotionBrief {
  template?: unknown
  props?: unknown
  [key: string]: unknown
}

export interface RemotionMusicReplacement {
  remotion: RemotionBrief
  choice: RemotionMusicChoice
}

const musicCatalog = parseMusicCatalog(musicCatalogRaw)
const vocalRegistry = musicVocalsRaw as VocalRecord[]
const humanApproval = (signedBy?: string) =>
  typeof signedBy === 'string' && (signedBy.startsWith('human:') || signedBy.startsWith('PM审片@'))

function musicNameKey(name: string): string {
  return (name.split('/').pop() ?? name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]/g, '')
}

function vocalClearUntil(track: MusicEntry): number | null {
  const acceptedNames = new Set([stagedFileName(track), track.file].map(musicNameKey))
  const entries = vocalRegistry.filter((record) =>
    typeof record.name === 'string' &&
    acceptedNames.has(musicNameKey(record.name)) &&
    record.verdict === 'none' &&
    humanApproval(record.signedBy) &&
    typeof record.cleanUntilSec === 'number' &&
    Number.isFinite(record.cleanUntilSec),
  )
  // The worker validates the exact staged bytes by SHA-256. This name mapping
  // only decides what to offer; a stale or different file still fails closed.
  return entries.length > 0 ? Math.max(...entries.map((entry) => entry.cleanUntilSec!)) : null
}

function propsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function patchedPropsForMusic(template: string, props: Record<string, unknown>, track: MusicEntry): Record<string, unknown> {
  const stagedFile = stagedFileName(track)
  if (template === 'list') {
    const itemCount = Array.isArray(props.items) ? props.items.length : 0
    const excerpt = excerptFor(track, itemCount, 0)
    return { ...props, musicFile: stagedFile, musicStartSec: excerpt.musicStartSec, beats: excerpt.beats }
  }
  if (template === 'montage') {
    const totalBeats = typeof props.totalBeats === 'number' ? props.totalBeats : 0
    return { ...props, musicFile: stagedFile, beats: beatGrid(track, totalBeats + 1) }
  }
  return { ...props, musicFile: stagedFile, musicStartSec: 0 }
}

function eligibleTrackForBrief(brief: RemotionBrief, track: MusicEntry): RemotionMusicChoice | null {
  if (!isTemplateId(brief.template)) return null
  const props = propsRecord(brief.props)
  if (!props) return null

  let loaded
  let patchedProps: Record<string, unknown>
  try {
    loaded = loadTemplate(brief.template, props)
    // Beat-timed layouts require a ready BPM grid. The renderer will independently verify the exact staged bytes.
    if ((brief.template === 'list' || brief.template === 'montage') && track.status !== 'ready') return null
    patchedProps = patchedPropsForMusic(brief.template, loaded.props as Record<string, unknown>, track)
    loadTemplate(brief.template, patchedProps)
  } catch {
    return null
  }

  const cleanUntilSec = vocalClearUntil(track)
  const durationSeconds = loaded.totalFrames / FPS
  const startSec = typeof patchedProps.musicStartSec === 'number' ? patchedProps.musicStartSec : 0
  if (cleanUntilSec === null || cleanUntilSec < startSec + durationSeconds + 1) return null
  return {
    id: track.id,
    file: track.file,
    mood: track.mood,
    style: track.style,
    energy: track.energy,
    status: track.status,
    clean_until_sec: cleanUntilSec,
    max_video_seconds: Math.max(0, cleanUntilSec - startSec - 1),
  }
}


export function remotionMusicChoices(rawBriefRemotion: unknown): RemotionMusicChoice[] {
  const brief = propsRecord(rawBriefRemotion) as RemotionBrief | null
  if (!brief) return []
  const currentMusic = propsRecord(brief.props)?.musicFile
  const currentMusicKey = typeof currentMusic === 'string' ? musicNameKey(currentMusic) : null
  return musicCatalog.tracks
    .filter((track) => !currentMusicKey || musicNameKey(stagedFileName(track)) !== currentMusicKey)
    .map((track) => eligibleTrackForBrief(brief, track))
    .filter((choice): choice is RemotionMusicChoice => choice !== null)
}

export function replaceRemotionMusic(
  rawBriefRemotion: unknown,
  musicId: string,
): RemotionMusicReplacement | null {
  const brief = propsRecord(rawBriefRemotion) as RemotionBrief | null
  if (!brief || !isTemplateId(brief.template)) return null
  const choice = remotionMusicChoices(brief).find((option) => option.id === musicId)
  const track = musicCatalog.tracks.find((item) => item.id === musicId)
  const props = propsRecord(brief.props)
  if (!choice || !track || !props) return null

  try {
    const loaded = loadTemplate(brief.template, props)
    return {
      remotion: {
        ...brief,
        props: patchedPropsForMusic(brief.template, loaded.props as Record<string, unknown>, track),
      },
      choice,
    }
  } catch {
    return null
  }
}
