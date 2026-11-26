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
  // musicGain is calibrated for one specific track; a swapped-in track starts from the default gain (1).
  const { musicGain: _calibratedForOldTrack, ...baseProps } = props
  if (template === 'list') {
    const itemCount = Array.isArray(baseProps.items) ? baseProps.items.length : 0
    const excerpt = excerptFor(track, itemCount, 0)
    return { ...baseProps, musicFile: stagedFile, musicStartSec: excerpt.musicStartSec, beats: excerpt.beats }
  }
  if (template === 'montage') {
    const totalBeats = typeof baseProps.totalBeats === 'number' ? baseProps.totalBeats : 0
    return { ...baseProps, musicFile: stagedFile, beats: beatGrid(track, totalBeats + 1) }
  }
  return { ...baseProps, musicFile: stagedFile, musicStartSec: 0 }
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
    if ((brief.template === 'list' || brief.template === 'montage') && track.status !== 'ready') return null
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

function trackForMusicFile(musicFile) {
  const key = musicNameKey(musicFile)
  return musicCatalog.tracks.find((track) => {
    try {
      return musicNameKey(stagedFileName(track)) === key || musicNameKey(track.file) === key
    } catch {
      return musicNameKey(track.file) === key
    }
  }) ?? null
}

// Human-cleared windows for a track. A `none` entry without cleanUntilSec clears
// any length, matching the worker gate (music-vocal-gate.mjs).
function vocalClearWindow(track) {
  const acceptedNames = new Set([track.file, track.id].map(musicNameKey))
  try { acceptedNames.add(musicNameKey(stagedFileName(track))) } catch { /* file-only match */ }
  const entries = vocalRegistry.filter((record) =>
    typeof record.name === 'string' &&
    acceptedNames.has(musicNameKey(record.name)) &&
    record.verdict === 'none' &&
    humanApproval(record.signedBy),
  )
  if (entries.length === 0) return null
  if (entries.some((entry) => entry.cleanUntilSec === undefined)) return { unlimited: true, untilSec: null }
  const limits = entries.map((entry) => entry.cleanUntilSec).filter((value) => typeof value === 'number' && Number.isFinite(value))
  return limits.length > 0 ? { unlimited: false, untilSec: Math.max(...limits) } : null
}

const positiveNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
const nonNegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * Clearance for a finished video made outside the factory. The brief must name
 * the catalog track it used (`external_music.track_id`); the same human vocal
 * registry decides. A limited clean window is checked against the longer of the
 * declared length and the length measured at upload; with neither it is unreadable.
 * Trust boundary: the declared track id is not matched against the audio itself
 * (the factory worker matches staged bytes by SHA-256); a human still reviews the video.
 */
function externalMusicClearance(brief, unread, measuredSec) {
  const declared = propsRecord(brief.external_music)
  if (!declared || typeof declared.track_id !== 'string' || !declared.track_id.trim()) return unread
  const track = musicCatalog.tracks.find((item) => item.id === declared.track_id.trim()) ?? null
  if (!track) return { verdict: 'fail', reason: '配乐不在曲库', track_id: null, clean_until_sec: null }
  const window = vocalClearWindow(track)
  if (!window) return { verdict: 'fail', reason: '配乐没有人声核验', track_id: track.id, clean_until_sec: null }
  if (window.unlimited) return { verdict: 'pass', reason: '配乐已核无人声（全曲）', track_id: track.id, clean_until_sec: null }
  const startSec = declared.start_sec === undefined ? 0 : declared.start_sec
  // The length measured at upload wins over a smaller self-declared one.
  const lengths = [declared.duration_sec, measuredSec].filter(positiveNumber)
  if (!nonNegativeNumber(startSec) || lengths.length === 0) {
    return { verdict: 'unreadable', reason: '读不到片长或配乐起点', track_id: track.id, clean_until_sec: window.untilSec }
  }
  if (window.untilSec < startSec + Math.max(...lengths) + 1) {
    return { verdict: 'fail', reason: '配乐的无人声时长盖不住这条片子', track_id: track.id, clean_until_sec: window.untilSec }
  }
  return { verdict: 'pass', reason: '配乐已核无人声', track_id: track.id, clean_until_sec: window.untilSec }
}

/** Vocal clearance for the track already on this brief. Does not swap music. */
export function remotionMusicClearance(rawBriefRemotion, measuredSec) {
  const unread = { verdict: 'unreadable', reason: '读不到', track_id: null, clean_until_sec: null }
  const brief = propsRecord(rawBriefRemotion)
  if (!brief) return unread
  if (brief.template === undefined && brief.external_music !== undefined) return externalMusicClearance(brief, unread, measuredSec)
  if (!isTemplateId(brief.template)) return unread
  const props = propsRecord(brief.props)
  if (!props || typeof props.musicFile !== 'string' || !props.musicFile.trim()) return unread
  const track = trackForMusicFile(props.musicFile)
  if (!track) return { verdict: 'fail', reason: '配乐不在曲库', track_id: null, clean_until_sec: null }
  let loaded
  try {
    loaded = loadTemplate(brief.template, props)
  } catch {
    return unread
  }
  const cleanUntilSec = vocalClearUntil(track)
  if (cleanUntilSec === null) {
    return { verdict: 'fail', reason: '配乐没有人声核验', track_id: track.id, clean_until_sec: null }
  }
  const durationSeconds = loaded.totalFrames / FPS
  const startSec = typeof props.musicStartSec === 'number' && Number.isFinite(props.musicStartSec) ? props.musicStartSec : 0
  if (cleanUntilSec < startSec + durationSeconds + 1) {
    return { verdict: 'fail', reason: '配乐的无人声时长盖不住这条片子', track_id: track.id, clean_until_sec: cleanUntilSec }
  }
  return { verdict: 'pass', reason: '配乐已核无人声', track_id: track.id, clean_until_sec: cleanUntilSec }
}

/** Validate a remotion brief with the same template loader the worker runs, so bad props fail at order time, not render time. */
export function checkRemotionProps(rawBriefRemotion) {
  const brief = propsRecord(rawBriefRemotion)
  if (!brief || !isTemplateId(brief.template)) return { ok: false, error: '未知模板' }
  try {
    loadTemplate(brief.template, brief.props)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
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
