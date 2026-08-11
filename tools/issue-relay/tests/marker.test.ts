import { describe, expect, it } from 'vitest'
import { buildMarker, parseMarker } from '../src/marker'

describe('marker', () => {
  it('round-trips a numeric round', () => {
    const marker = { round: 3, sourceCommentId: 12345 }
    expect(parseMarker(buildMarker(marker))).toEqual(marker)
  })

  it('round-trips a halt marker', () => {
    const marker = { round: 'halt' as const, sourceCommentId: 999 }
    expect(parseMarker(buildMarker(marker))).toEqual(marker)
  })

  it('finds the marker embedded inside a larger comment body', () => {
    const body = `Some Codex reply text.\n\nMore text.\n\n${buildMarker({ round: 2, sourceCommentId: 42 })}`
    expect(parseMarker(body)).toEqual({ round: 2, sourceCommentId: 42 })
  })

  it('returns null for a comment with no marker', () => {
    expect(parseMarker('just a regular comment, no marker here')).toBeNull()
  })

  it('does not match a marker-shaped string typed by a human, only the exact format', () => {
    expect(parseMarker('<!-- me2-issue-relay:v1 round=banana source_comment_id=1 -->')).toBeNull()
  })
})
