import { describe, it, expect } from 'vitest'
import { facebookCommentUrl, isStuck, mergeEngagements, shouldShowMarkReviewed, type Engagement } from '../CommentAuditList'
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
  post_id: 'page123_post456',
  comment_id: 'page123_post456_comment789',
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

/**
 * `mergeEngagements`（Codex round 7 复审 P1）：默认 `?limit=25` 只是一个按
 * `created_at` 倒序的近期窗口，卡死很久的行永远翻不到、按钮点不到；这里验证
 * 合并后卡死行一定在，且不会因为同一行同时出现在两边而重复。
 */
describe('mergeEngagements', () => {
  it('stuck 里独有的旧行会被并进来，不受 recent 窗口限制', () => {
    const recentRow = { ...base, id: 'r1', created_at: '2026-09-27T00:00:00Z' }
    const oldStuckRow = { ...base, id: 's1', created_at: '2026-08-01T00:00:00Z', reply_status: 'failed', attempts: MAX_ATTEMPTS }
    const merged = mergeEngagements([recentRow], [oldStuckRow])
    expect(merged.map((it) => it.id)).toEqual(['r1', 's1'])
  })

  it('同一行两边都有 → 按 id 去重，只保留一份', () => {
    const row = { ...base, id: 'x1', created_at: '2026-09-20T00:00:00Z' }
    const merged = mergeEngagements([row], [row])
    expect(merged).toHaveLength(1)
  })

  it('按 created_at 倒序排列', () => {
    const older = { ...base, id: 'a', created_at: '2026-09-01T00:00:00Z' }
    const newer = { ...base, id: 'b', created_at: '2026-09-20T00:00:00Z' }
    const merged = mergeEngagements([older], [newer])
    expect(merged.map((it) => it.id)).toEqual(['b', 'a'])
  })

  it('两边都空 → 空数组', () => {
    expect(mergeEngagements([], [])).toEqual([])
  })
})

/**
 * `shouldShowMarkReviewed`（Codex round 13 复审 P1）：`isStuck` 判不出第 4 类
 * （越过回看窗口、还没耗尽重试次数的 failed 行）——判这一类需要这个客户的
 * `lookback_days`，`Engagement` 上没有这个字段。这一类只能靠服务端
 * `?stuck=1` 的返回结果（`stuckIds`）来判定，不能靠本地重算。
 */
describe('shouldShowMarkReviewed', () => {
  it('needs_human → 显示，不管 isStuck/stuckIds', () => {
    expect(shouldShowMarkReviewed({ ...base, needs_human: true }, new Set(), NOW)).toBe(true)
  })

  it('isStuck 判定为卡死（比如 failed 耗尽重试）→ 显示', () => {
    const engagement = { ...base, reply_status: 'failed', attempts: MAX_ATTEMPTS }
    expect(shouldShowMarkReviewed(engagement, new Set(), NOW)).toBe(true)
  })

  it('第 4 类：failed 没耗尽重试，isStuck 判不出来，但在 stuckIds 里 → 显示', () => {
    const engagement = { ...base, id: 'orphaned-1', reply_status: 'failed', attempts: 1 }
    expect(isStuck(engagement, NOW)).toBe(false) // 确认 isStuck 单独判不出来
    expect(shouldShowMarkReviewed(engagement, new Set(['orphaned-1']), NOW)).toBe(true)
  })

  it('既不是 needs_human，也不卡死，也不在 stuckIds 里 → 不显示', () => {
    const engagement = { ...base, id: 'normal-1', reply_status: 'replied' }
    expect(shouldShowMarkReviewed(engagement, new Set(['other-id']), NOW)).toBe(false)
  })

  it('已经标记已阅（reviewed_at 有值）且不在 stuckIds 里 → 不显示', () => {
    const engagement = { ...base, reply_status: 'failed', attempts: MAX_ATTEMPTS, reviewed_at: '2026-09-27T00:00:00Z' }
    expect(shouldShowMarkReviewed(engagement, new Set(), NOW)).toBe(false)
  })
})

/**
 * `facebookCommentUrl`（Codex round 18 复审 P2）：post_id/comment_id 是
 * claimComment 插入时原样存的 Graph API 返回值，不需要再调一次 API 或多存
 * 一个字段——直接拼 Facebook 自己的评论深链格式。
 */
describe('facebookCommentUrl', () => {
  it('拼出 post 链接 + comment_id 查询参数', () => {
    expect(facebookCommentUrl('page123_post456', 'page123_post456_comment789'))
      .toBe('https://www.facebook.com/page123_post456?comment_id=page123_post456_comment789')
  })
})
