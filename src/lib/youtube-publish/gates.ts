/**
 * Server-side publish gates for YouTube. The client-side button state is never
 * trusted: any gate that is not an explicit `pass` blocks going Public.
 * Gate ids are platform-shared; per-client policy supplies the evidence.
 */

export const PUBLISH_GATE_IDS = [
  'thumbnail_9x16_verified',
  'title_matches_footage',
  'best_frame_in_first_second',
  'linked_long_video_saved',
  'bgm_not_repeated_in_7_days',
  'no_price_on_screen',
  'facts_have_website_evidence',
] as const

export type PublishGateId = (typeof PUBLISH_GATE_IDS)[number]
export type GateStatus = 'pass' | 'fail' | 'unknown'

export interface GateResult {
  id: PublishGateId
  /** Gate evidence belongs to one video; evidence for another video never counts. */
  videoId: string
  status: GateStatus
  /** Where the evidence lives (url / receipt id / doc path). Required for pass. */
  evidence?: string
}

export interface GateVerdict {
  canGoPublic: boolean
  blocking: Array<{ id: PublishGateId; reason: string }>
}

export function evaluatePublishGates(results: GateResult[], videoId: string): GateVerdict {
  const blocking: GateVerdict['blocking'] = []
  for (const id of PUBLISH_GATE_IDS) {
    const entries = results.filter((r) => r.id === id)
    const r = entries[0]
    if (!r) blocking.push({ id, reason: 'missing' })
    else if (entries.length > 1) blocking.push({ id, reason: 'duplicate entries' })
    else if (r.videoId !== videoId) blocking.push({ id, reason: 'evidence is for another video' })
    else if (r.status !== 'pass') blocking.push({ id, reason: r.status === 'fail' ? 'fail' : 'unknown' })
    else if (typeof r.evidence !== 'string' || !r.evidence.trim()) {
      blocking.push({ id, reason: 'pass without evidence' })
    }
  }
  return { canGoPublic: blocking.length === 0, blocking }
}
