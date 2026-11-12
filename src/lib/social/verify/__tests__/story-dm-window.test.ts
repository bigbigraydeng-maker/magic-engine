/**
 * T13 / T13b. Times are arguments. A failed read is not a zero.
 */
import { describe, expect, it } from 'vitest'
import {
  countNewThreads,
  formatStoryDmLabel,
  readStoryDmWindowConfig,
  rowsFromThreadQuery,
  storyDmInviteRole,
  storyDmReadAt,
  storyDmWindowEnd,
  type StoryDmThread,
} from '@/lib/social/verify/story-dm-window'

const SENT = '2026-11-02T07:00:00.000Z'
const END = '2026-11-02T19:00:00.000Z'
const SYNC_OK = '2026-11-02T19:00:00.000Z'
const SYNC_EARLY = '2026-11-02T18:59:59.000Z'

function thread(createdAt: string, entryReferral: unknown = null): StoryDmThread {
  return { createdAt, entryReferral }
}

describe('countNewThreads', () => {
  it('T13 a read error is not_readable, not zero, and an ad_id thread is left out', () => {
    const failed = countNewThreads(null, { sentAt: SENT, hours: 12, lastSuccessfulSyncStartedAt: SYNC_OK })
    expect(failed).toEqual({ verdict: 'not_readable', observedValue: null, reason: 'threads_unreadable' })
    expect(failed.verdict).not.toBe('counted')

    const rows = rowsFromThreadQuery({ message: 'db down' }, [thread(SENT)])
    expect(rows).toBeNull()
    const fromError = countNewThreads(rows, { sentAt: SENT, hours: 12, lastSuccessfulSyncStartedAt: SYNC_OK })
    expect(fromError.observedValue).toBeNull()

    const counted = countNewThreads(
      [
        thread('2026-11-02T08:00:00.000Z', { source: 'page' }),
        thread('2026-11-02T09:00:00.000Z', { ad_id: 'ad-1' }),
        thread('2026-11-02T10:00:00.000Z', { ad_id: null }),
        thread('2026-11-02T20:00:00.000Z'),
      ],
      { sentAt: SENT, hours: 12, lastSuccessfulSyncStartedAt: SYNC_OK },
    )
    expect(counted).toEqual({ verdict: 'counted', observedValue: 1, reason: null })
  })

  it('T13b no sync at or after the window end is sync_not_caught_up; an exact match counts', () => {
    const early = countNewThreads(
      [thread('2026-11-02T08:00:00.000Z')],
      { sentAt: SENT, hours: 12, lastSuccessfulSyncStartedAt: SYNC_EARLY },
    )
    expect(early).toEqual({ verdict: 'not_readable', observedValue: null, reason: 'sync_not_caught_up' })

    const missing = countNewThreads(
      [thread('2026-11-02T08:00:00.000Z')],
      { sentAt: SENT, hours: 12, lastSuccessfulSyncStartedAt: null },
    )
    expect(missing.reason).toBe('sync_not_caught_up')

    const exact = countNewThreads([], { sentAt: SENT, hours: 12, lastSuccessfulSyncStartedAt: END })
    expect(exact).toEqual({ verdict: 'counted', observedValue: 0, reason: null })
  })

  it('a thread with no time fails the whole count instead of dropping it', () => {
    const result = countNewThreads(
      [thread('not-a-time'), thread('2026-11-02T08:00:00.000Z')],
      { sentAt: SENT, hours: 12, lastSuccessfulSyncStartedAt: SYNC_OK },
    )
    expect(result).toEqual({ verdict: 'not_readable', observedValue: null, reason: 'thread_time_unreadable' })
  })
})

describe('story DM window config', () => {
  it('uses invite and 12 hours only when the client block is missing', () => {
    expect(readStoryDmWindowConfig(null)).toEqual({ ok: true, hours: 12, inviteRole: 'invite', fromDefault: true })
    expect(readStoryDmWindowConfig({})).toMatchObject({ fromDefault: true, hours: 12 })
    expect(storyDmWindowEnd(SENT, 12)).toBe(END)
    expect(storyDmReadAt(END)).toBe('2026-11-02T20:10:00.000Z')
  })

  it('keeps a client hour count and refuses an unusable block', () => {
    expect(readStoryDmWindowConfig({ story_dm_window: { hours: 6 } })).toEqual({
      ok: true, hours: 6, inviteRole: 'invite', fromDefault: false,
    })
    expect(readStoryDmWindowConfig({ story_dm_window: { hours: 0 } }).ok).toBe(false)
    expect(readStoryDmWindowConfig({ story_dm_window: { hours: 12.5 } }).ok).toBe(false)
    expect(readStoryDmWindowConfig({ story_dm_window: '12' }).ok).toBe(false)
    expect(storyDmInviteRole({ story_dm_window: { hours: 0, invite_role: 'fact' } })).toBe('fact')
  })
})

describe('formatStoryDmLabel', () => {
  it('shows a count or a plain reason, and does not echo an unknown reason', () => {
    expect(formatStoryDmLabel({
      verdict: 'counted', observedValue: 2, reason: null, windowHours: 12,
    })).toBe('发后 12 小时新开私信 2 条（已去掉带来广告编号的会话）')
    expect(formatStoryDmLabel({
      verdict: 'not_readable', observedValue: null, reason: 'sync_not_caught_up', windowHours: 12,
    })).toContain('没有记成 0')
    expect(formatStoryDmLabel({
      verdict: 'not_readable', observedValue: null, reason: 'secret-token', windowHours: 12,
    })).toBe('私信数读不到：没有读到，没有记成 0')
  })
})
