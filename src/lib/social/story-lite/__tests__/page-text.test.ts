import { describe, expect, it } from 'vitest'

import {
  describeActionError,
  describeItemStatus,
  describeMode,
  describePackState,
  describeProblem,
  describeRange,
  describeStopResult,
  thumbnailUrl,
  describeNzDay,
  formatClock,
  nzDateKey,
  formatSlot,
} from '../page-text'
import type { LiteItemStatus } from '../types'

const BANNED = /信封|素材池|指纹|哈希|hash|fingerprint|claim|UNKNOWN|PENDING/i
const PROBLEMS = [
  'NOT_PENDING',
  'CHANNEL_NOT_SUPPORTED',
  'SLOT_IN_PAST',
  'SLOT_AFTER_EXPIRY',
  'ACCOUNT_MISMATCH',
  'PRICE_IN_TEXT',
  'FILE_CHANGED',
  'FILE_UNREACHABLE',
  'VIDEO_NOT_ACCEPTABLE',
  'CLIENT_NOT_ACTIVE',
  'PACK_NOT_DRAFT',
]
const STATUSES: LiteItemStatus[] = ['PENDING', 'CLAIMED', 'SENT', 'UNKNOWN_OUTCOME', 'FAILED', 'BLOCKED', 'MISSED']

describe('story page wording', () => {
  it('every known problem code has its own plain sentence, and no code leaks', () => {
    const seen = new Set<string>()
    for (const code of PROBLEMS) {
      const text = describeProblem(code)
      expect(text).not.toBe(describeProblem('SOMETHING_NEW'))
      expect(text).not.toMatch(BANNED)
      expect(text).not.toContain(code)
      seen.add(text)
    }
    expect(seen.size).toBe(PROBLEMS.length)
  })

  it('an unknown problem code never shows the code itself', () => {
    expect(describeProblem('WEIRD_CODE_X')).not.toContain('WEIRD')
  })

  it('every status and pack state reads as plain Chinese without banned words', () => {
    for (const status of STATUSES) expect(describeItemStatus(status)).not.toMatch(BANNED)
    for (const state of ['DRAFT', 'AUTHORIZED', 'REVOKED', 'EXPIRED'] as const) {
      expect(describePackState(state)).not.toMatch(BANNED)
    }
  })

  it('the banner tells rehearsal from live in words, not colour only', () => {
    expect(describeMode(false).headline).toContain('演练模式')
    expect(describeMode(false).headline).toContain('不会真发')
    expect(describeMode(false).tone).toBe('rehearsal')
    expect(describeMode(true).headline).toContain('真发已开')
    expect(describeMode(true).tone).toBe('live')
  })

  it('formats slots in New Zealand time and never invents a time for garbage', () => {
    // 2026-10-13T20:00:00Z = Wed 14 Oct 09:00 NZDT
    const text = formatSlot('2026-10-13T20:00:00Z')
    expect(text).toContain('10月14日')
    expect(text).toContain('09:00')
    expect(formatSlot('not a time')).toBe('not a time')
  })

  it('describes the range with count, first and last slot', () => {
    const text = describeRange(['2026-10-13T20:00:00Z', '2026-10-15T05:30:00Z', '2026-10-14T01:00:00Z'])
    expect(text).toContain('共 3 条')
    expect(text).toContain('10月14日')
    expect(text).toContain('10月15日')
    expect(describeRange([])).toContain('还没有')
  })

  it('action errors are plain, and an unknown one is generic', () => {
    expect(describeActionError('PACK_CHANGED_SINCE_PREVIEW')).toContain('改过')
    expect(describeActionError('???')).toContain('没成功')
    expect(describeActionError('PACK_CHANGED_SINCE_PREVIEW')).not.toMatch(BANNED)
  })

  it('after 「停」 it never says all is stopped while something is sent or unsettled', () => {
    const clean = describeStopResult('第3周', 0, 0)
    expect(clean).toContain('不会再发')
    expect(clean).toContain('第3周')
    expect(clean).not.toContain('核对')
    const sent = describeStopResult('第3周', 2, 0)
    expect(sent).toContain('2 条')
    expect(sent).toContain('手动删除')
    const unsure = describeStopResult('第3周', 0, 1)
    expect(unsure).toContain('1 条')
    expect(unsure).toContain('核对')
    expect(describeStopResult('第3周', 1, 1)).toMatch(/1 条不会撤回.*1 条正在发/)
  })

  it('rehearsal wording says an authorisation stays valid after live is switched on', () => {
    expect(describeMode(false).detail).toContain('一旦开启真发')
    expect(describeItemStatus('UNKNOWN_OUTCOME')).toContain('核对')
  })

  it('thumbnails use the small-picture address for storage files, and leave other addresses alone', () => {
    expect(thumbnailUrl('https://x.supabase.co/storage/v1/object/public/visual-assets/a/b.png')).toBe(
      'https://x.supabase.co/storage/v1/render/image/public/visual-assets/a/b.png?width=180&height=320&resize=cover&quality=60',
    )
    expect(thumbnailUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg')
    expect(thumbnailUrl('https://x.supabase.co/storage/v1/object/public/b/a.png?v=2')).toBe('https://x.supabase.co/storage/v1/object/public/b/a.png?v=2')
  })

  it('New Zealand day and clock: a late-evening UTC time lands on the next NZ day', () => {
    expect(nzDateKey('2026-10-13T19:30:00Z')).toBe('2026-10-14')
    expect(nzDateKey('garbage')).toBe('')
    expect(describeNzDay('2026-10-14')).toBe('10月14日 周三')
    expect(describeNzDay('oops')).toBe('oops')
    expect(formatClock('2026-10-13T19:30:00Z')).toBe('08:30')
    expect(formatClock('2026-10-14T00:00:00Z')).toBe('13:00')
  })
})
