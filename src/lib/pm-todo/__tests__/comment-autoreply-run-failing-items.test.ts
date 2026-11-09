import { describe, it, expect } from 'vitest'
import {
  buildCommentAutoreplyRunFailingTodos,
  CONSECUTIVE_FAILED_RUNS,
  type CommentRunLogRow,
} from '../comment-autoreply-run-failing-items'

const NOW = new Date('2026-10-10T04:00:00Z')
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const REDUCE = `fetchPagePosts 123: 500 {"error":{"code":1,"message":"Please reduce the amount of data you're asking for"}}`

const bad = (error = REDUCE): CommentRunLogRow => ({
  status: 'failed', finished_at: '2026-10-10T03:30:00Z', failed_count: 1, error_message: 'x',
  summary: { results: [{ client_id: CLIENT, ok: false, error }] },
})
// legacy rows: recorded "completed" but the result says ok:false
const badLegacy = (): CommentRunLogRow => ({ ...bad(), status: 'completed', failed_count: 0, error_message: null })
const good = (): CommentRunLogRow => ({
  status: 'completed', finished_at: '2026-10-10T03:30:00Z', failed_count: 0, error_message: null,
  summary: { results: [{ client_id: CLIENT, ok: true }] },
})

describe('buildCommentAutoreplyRunFailingTodos', () => {
  it('N consecutive failed runs → one to-do with what/how/href', () => {
    const t = buildCommentAutoreplyRunFailingTodos(Array.from({ length: CONSECUTIVE_FAILED_RUNS }, () => bad()), [CLIENT], NOW)
    expect(t).toHaveLength(1)
    expect(t[0].kind).toBe('comment_autoreply_run_failing')
    expect(t[0].what).toContain('数据太多')
    expect(t[0].how.length).toBeGreaterThan(20)
    expect(t[0].href).toContain(CLIENT)
  })

  it('also catches legacy rows recorded as "completed" with ok:false inside', () => {
    const t = buildCommentAutoreplyRunFailingTodos(Array.from({ length: CONSECUTIVE_FAILED_RUNS }, badLegacy), [CLIENT], NOW)
    expect(t).toHaveLength(1)
  })

  it('one good run among the latest N → no to-do', () => {
    const runs = [bad(), bad(), good(), bad(), bad(), bad()]
    expect(buildCommentAutoreplyRunFailingTodos(runs, [CLIENT], NOW)).toEqual([])
  })

  it('fewer than N runs, or stale latest run → no to-do', () => {
    expect(buildCommentAutoreplyRunFailingTodos([bad(), bad()], [CLIENT], NOW)).toEqual([])
    const stale = Array.from({ length: CONSECUTIVE_FAILED_RUNS }, () => ({ ...bad(), finished_at: '2026-10-01T00:00:00Z' }))
    expect(buildCommentAutoreplyRunFailingTodos(stale, [CLIENT], NOW)).toEqual([])
  })

  it('a client with no result in the recent runs (just enabled) is not flagged because another client keeps failing', () => {
    const other = (): CommentRunLogRow => ({
      ...bad(), summary: { results: [{ client_id: 'other', ok: false, error: REDUCE }] },
    })
    const runs = Array.from({ length: CONSECUTIVE_FAILED_RUNS }, other)
    expect(buildCommentAutoreplyRunFailingTodos(runs, [CLIENT], NOW)).toEqual([])
  })

  it('"could not resolve Page access token" is described as no-authorization, not a rejected token', () => {
    const runs = Array.from({ length: CONSECUTIVE_FAILED_RUNS }, () => bad('could not resolve Page access token'))
    expect(buildCommentAutoreplyRunFailingTodos(runs, [CLIENT], NOW)[0].what).toContain('拿不到这个主页的授权')
  })
})
