import { describe, it, expect } from 'vitest'
import { isStuck, type Engagement } from '../CommentAuditList'
import { MAX_ATTEMPTS, STALE_PROCESSING_MS } from '@/lib/social/comment-autoreply-constants'

/**
 * `isStuck` decides whether "标记已阅" shows for a row that isn't `needs_human`.
 * Must mirror what `comment-autoreply-stuck-items.ts` treats as permanently
 * stuck — not just loosely by `reply_status` (Codex round 3 复审 P1 + round 5
 * 复审 P2): a `failed` row still mid-retry, or a `processing` row still well
 * within a normal run, is not actually stuck yet. Showing the button early
 * invites a premature click that permanently hides the row from the detector
 * once it later does become genuinely stuck (finalise() never clears
 * reviewed_at).
 */
const NOW = Date.parse('2026-09-28T00:00:00Z')

const base: Engagement = {
  id: 'e1',
  category: 'praise',
  comment_text: 'nice',
  author_name: 'Jane',
  public_reply_text: null,
  public_reply_id: null,
  private_reply_sent: false,
  hidden: false,
  reply_status: 'replied',
  attempts: 1,
  needs_human: false,
  reviewed_at: null,
  guardrail_flags: null,
  reply_source: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
}

describe('isStuck', () => {
  it('failed 且重试耗尽 → stuck', () => {
    expect(isStuck({ ...base, reply_status: 'failed', attempts: MAX_ATTEMPTS }, NOW)).toBe(true)
  })

  it('failed 但还没耗尽重试 → 不算 stuck（Codex round 5 P2：太早显示按钮会抢在真正卡死前写死 reviewed_at）', () => {
    expect(isStuck({ ...base, reply_status: 'failed', attempts: MAX_ATTEMPTS - 1 }, NOW)).toBe(false)
  })

  it('processing 且超过宽限期 → stuck', () => {
    const staleUpdatedAt = new Date(NOW - STALE_PROCESSING_MS - 1000).toISOString()
    expect(isStuck({ ...base, reply_status: 'processing', updated_at: staleUpdatedAt }, NOW)).toBe(true)
  })

  it('processing 但还在宽限期内 → 不算 stuck（可能就是这一轮正常在跑）', () => {
    const freshUpdatedAt = new Date(NOW - 60_000).toISOString()
    expect(isStuck({ ...base, reply_status: 'processing', updated_at: freshUpdatedAt }, NOW)).toBe(false)
  })

  it('dm_sent 且没有公开回复 id → stuck（私信发了，公开回复没发）', () => {
    expect(isStuck({ ...base, reply_status: 'dm_sent', public_reply_id: null }, NOW)).toBe(true)
  })

  it('dm_sent 但公开回复也发了 → 不算 stuck', () => {
    expect(isStuck({ ...base, reply_status: 'dm_sent', public_reply_id: 'fb_123' }, NOW)).toBe(false)
  })

  it('已经点过已阅（reviewed_at 有值）→ 不再显示，不管 reply_status 是什么（Codex round 5 P2）', () => {
    expect(
      isStuck({ ...base, reply_status: 'failed', attempts: MAX_ATTEMPTS, reviewed_at: '2026-09-27T00:00:00Z' }, NOW),
    ).toBe(false)
  })

  it('replied → 不算 stuck', () => {
    expect(isStuck({ ...base, reply_status: 'replied', public_reply_id: 'fb_123' }, NOW)).toBe(false)
  })

  it('pending / skipped / hidden / reverted → 不算 stuck', () => {
    for (const status of ['pending', 'skipped', 'hidden', 'reverted']) {
      expect(isStuck({ ...base, reply_status: status }, NOW)).toBe(false)
    }
  })
})
