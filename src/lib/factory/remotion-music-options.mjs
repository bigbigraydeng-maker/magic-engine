import musicCatalogRaw from '../../../scripts/factory-worker/engines/remotion/catalog/music.json' with { type: 'json' }
import musicVocalsRaw from '../../../scripts/factory-worker/engines/remotion/catalog/music-vocals.json' with { type: 'json' }
import { beatGrid, excerptFor, parseMusicCatalog, stagedFileName } from '../../../scripts/factory-worker/engines/remotion/src/music.ts'
import { FPS } from '../../../scripts/factory-worker/engines/remotion/src/timing.ts'
import { loadTemplate, isTemplateId } from '../../../scripts/factory-worker/engines/remotion/src/templates.ts'

const musicCatalog = parseMusicCatalog(musicCatalogRaw)
const vocalRegistry = musicVocalsRaw
const humanApproval = (signedBy) =>
  typeof signedBy === 'string' && (signedBy.startsWith('human:') || signedBy.startsWith('PM审片@'))

function musicNameKey(name) {
  return (name.split('/').pop() ?? name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]/g, '')
}

function vocalClearUntil(track) {
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
  return entries.length > 0 ? Math.max(...entries.map((entry) => entry.cleanUntilSec)) : null
}

function propsRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
}

function patchedPropsForMusic(template, props, track) {
  const stagedFile = stagedFileName(track)
  if (template === 'list') {
    const itemCount = Array.isArray(props.items) ? props.items.length : 0
    const excerpt = excerptFor(track, itemCount, 0)
    return { ...props, musicFile: stagedFile, musicStartSec: excerpt.musicStartSec, beats: excerpt.beats }
  }
  if (template === 'montage' || template === 'impact') {
    const totalBeats = typeof props.totalBeats === 'number' ? props.totalBeats : 0
    return { ...props, musicFile: stagedFile, beats: beatGrid(track, totalBeats + 1) }
  }
  return { ...props, musicFile: stagedFile, musicStartSec: 0 }
}

function eligibleTrackForBrief(brief, track) {
  if (!isTemplateId(brief.template)) return null
  const props = propsRecord(brief.props)
  if (!props) return null

  let loaded
  let patchedProps
  try {
    loaded = loadTemplate(brief.template, props)
    // Beat-timed layouts require a ready BPM grid. The renderer will independently verify the exact staged bytes.
    if ((brief.template === 'list' || brief.template === 'montage' || brief.template === 'impact') && track.status !== 'ready') return null
    patchedProps = patchedPropsForMusic(brief.template, loaded.props, track)
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

export function remotionMusicChoices(rawBriefRemotion) {
  const brief = propsRecord(rawBriefRemotion)
  if (!brief) return []
  const currentMusic = propsRecord(brief.props)?.musicFile
  const currentMusicKey = typeof currentMusic === 'string' ? musicNameKey(currentMusic) : null
  return musicCatalog.tracks
    .filter((track) => !currentMusicKey || musicNameKey(stagedFileName(track)) !== currentMusicKey)
    .map((track) => eligibleTrackForBrief(brief, track))
    .filter((choice) => choice !== null)
}

export function replaceRemotionMusic(rawBriefRemotion, musicId) {
  const brief = propsRecord(rawBriefRemotion)
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
        props: patchedPropsForMusic(brief.template, loaded.props, track),
      },
      choice,
    }
  } catch {
    return null
  }
}
