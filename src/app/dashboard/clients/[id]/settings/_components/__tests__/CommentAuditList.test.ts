import { describe, it, expect } from 'vitest'
import { isStuck, type Engagement } from '../CommentAuditList'

/**
 * `isStuck` decides whether "标记已阅" shows for a row that isn't `needs_human`.
 * Must mirror what `comment-autoreply-stuck-items.ts` treats as permanently
 * stuck (Codex round 3 复审 P1: the button used to only show for
 * `needs_human` rows, so a stuck praise comment — needs_human=false — had no
 * way to ever clear the daily todo).
 */
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
  needs_human: false,
  guardrail_flags: null,
  reply_source: null,
  created_at: '2026-09-01T00:00:00Z',
}

describe('isStuck', () => {
  it('failed → stuck', () => {
    expect(isStuck({ ...base, reply_status: 'failed' })).toBe(true)
  })

  it('processing → stuck', () => {
    expect(isStuck({ ...base, reply_status: 'processing' })).toBe(true)
  })

  it('dm_sent 且没有公开回复 id → stuck（私信发了，公开回复没发）', () => {
    expect(isStuck({ ...base, reply_status: 'dm_sent', public_reply_id: null })).toBe(true)
  })

  it('dm_sent 但公开回复也发了 → 不算 stuck', () => {
    expect(isStuck({ ...base, reply_status: 'dm_sent', public_reply_id: 'fb_123' })).toBe(false)
  })

  it('replied → 不算 stuck', () => {
    expect(isStuck({ ...base, reply_status: 'replied', public_reply_id: 'fb_123' })).toBe(false)
  })

  it('pending / skipped / hidden / reverted → 不算 stuck', () => {
    for (const status of ['pending', 'skipped', 'hidden', 'reverted']) {
      expect(isStuck({ ...base, reply_status: status })).toBe(false)
    }
  })
})
