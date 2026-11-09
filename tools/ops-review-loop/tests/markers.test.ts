import { describe, expect, it } from 'vitest'
import { buildMarker, parseMarkers } from '../src/markers.mjs'

describe('markers', () => {
  it('round-trips a marker without a round', () => {
    const marker = buildMarker({ stage: 'review-requested', pr: 42, sha: 'abc1234' , round: undefined })
    expect(parseMarkers([marker])).toEqual([{ stage: 'review-requested', pr: 42, sha: 'abc1234', round: undefined }])
  })

  it('round-trips a marker with a round', () => {
    const marker = buildMarker({ stage: 'fix-dispatched', pr: 42, sha: 'abc1234', round: 2 })
    expect(parseMarkers([marker])).toEqual([{ stage: 'fix-dispatched', pr: 42, sha: 'abc1234', round: 2 }])
  })

  it('finds a marker embedded in a longer comment body', () => {
    const marker = buildMarker({ stage: 'ready', pr: 7, sha: 'deadbee' , round: undefined })
    const body = `**READY FOR PRODUCT OWNER**\n\nSome prose.\n\n${marker}`
    expect(parseMarkers([body])).toEqual([{ stage: 'ready', pr: 7, sha: 'deadbee', round: undefined }])
  })

  it('extracts multiple markers across separate comments and ignores non-marker comments', () => {
    const a = buildMarker({ stage: 'review-requested', pr: 1, sha: 'aaa1111' , round: undefined })
    const b = buildMarker({ stage: 'fix-dispatched', pr: 1, sha: 'aaa1111', round: 1 })
    const bodies = [a, 'just a human comment, no marker here', b, null, undefined]
    expect(parseMarkers(bodies)).toEqual([
      { stage: 'review-requested', pr: 1, sha: 'aaa1111', round: undefined },
      { stage: 'fix-dispatched', pr: 1, sha: 'aaa1111', round: 1 },
    ])
  })

  it('ignores text that merely mentions ops-codex-loop without the marker shape', () => {
    expect(parseMarkers(['this PR is about ops-codex-loop but has no marker'])).toEqual([])
  })
})
