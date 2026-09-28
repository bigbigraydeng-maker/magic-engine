/**
 * 这个帖子是不是我们自己主页的。
 *
 * 广告账户里会混进别人主页的素材（老广告 / 合作方主页）。用本主页的 token 去读
 * 它们，Meta 一律回 #10 —— 那不是我们缺权限，把它算进「缺权限」会把 FDE 支去
 * Meta 后台白找一圈。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { belongsToPage, claimComment, finalise, MAX_ATTEMPTS, type CommentConfig, type FinaliseResult } from '../comment-autoreply-engine'
import type { PageComment } from '@/lib/meta/comments'
import type { CommentDecision } from '../comment-classifier'

const CTS_PAGE = '1616575215312482'

/**
 * `claimComment` 的两条真实 Supabase 调用路径（全新插入 / 重新认领 failed
 * 行重试）——假查询链只做到能验证这两条路径 + 捕获 `.update()` 收到的字段，
 * 不铺开完整的 engine 级测试基础设施（分类 / Meta API 调用等不在这个 finding
 * 的验证范围内）。
 */
let insertShouldSucceed = false
let existingRow: { id: string; reply_status: string; attempts: number } | null = null
let updateShouldSucceed = true
let capturedUpdatePayloads: Record<string, unknown>[] = []

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      insert: () => ({
        select: () => ({
          single: async () =>
            insertShouldSucceed
              ? { data: { id: 'new-row-id', attempts: 1 }, error: null }
              : { data: null, error: { message: 'duplicate key value violates unique constraint' } },
        }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: existingRow, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        capturedUpdatePayloads.push(payload)
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () =>
                  updateShouldSucceed
                    ? { data: { id: existingRow?.id ?? 'row' }, error: null }
                    : { data: null, error: null },
              }),
            }),
          }),
        }
      },
    }),
  },
}))

const COMMENT: PageComment = {
  commentId: 'c1',
  postId: 'p1',
  message: 'hi',
  fromId: 'u1',
  fromName: 'User',
  createdAt: '2026-09-28T00:00:00Z',
  isFromPage: false,
}

const CONFIG: CommentConfig = {
  client_id: 'cts',
  fb_page_id: CTS_PAGE,
  auto_reply_praise: true,
  auto_reply_question: true,
  auto_reply_complaint: true,
  auto_hide_spam: true,
  private_reply_enabled: true,
  lookback_days: 7,
  max_replies_per_run: 10,
}

describe('belongsToPage', () => {
  it('本主页的帖子（`<主页id>_<帖子id>`）算自己的', () => {
    expect(belongsToPage(`${CTS_PAGE}_1672828167982705`, CTS_PAGE)).toBe(true)
  })

  it('🔴 别人主页的素材不算 —— 它读不了不是权限问题', () => {
    expect(belongsToPage('999999999_1672828167982705', CTS_PAGE)).toBe(false)
  })

  it('Reels / 视频是裸 id，只可能来自本主页的接口，算自己的', () => {
    expect(belongsToPage('1234567890', CTS_PAGE)).toBe(true)
  })

  it('前缀只是「开头像」不算 —— 必须整段主页 ID 加下划线', () => {
    expect(belongsToPage(`${CTS_PAGE}00_123`, CTS_PAGE)).toBe(false)
  })
})

/**
 * Codex round 15 复审 P2：`needs_human=true` 但还没耗尽重试的 failed 行——
 * 一次公开回复尝试失败时 `status` 一律落 `'failed'`，不管 `decision.needsHuman`
 * 是不是 true（见 `processClaimedComment` 里 `status` 的推导），所以这个组合
 * 是真实可达的状态，不是纸面假设。FDE 在 CommentAuditList 看到 `needs_human`
 * 徽章点"标记已阅"会写 `reviewed_at`；`finalise()` 从不清空它。如果
 * `claimComment` 重新认领这行重试时不顺带清掉，等这行后面真耗尽重试变成
 * exhausted，检测通道 `.is('reviewed_at', null)` 会把它永久滤掉——即使自动化
 * 其实一直在正常重试，只是重试结果没人再看过。
 */
describe('claimComment', () => {
  beforeEach(() => {
    insertShouldSucceed = false
    existingRow = null
    updateShouldSucceed = true
    capturedUpdatePayloads = []
  })

  it('重新认领一行还没耗尽重试的 failed 行 → 连带清空 reviewed_at / reviewed_by', async () => {
    existingRow = { id: 'row-1', reply_status: 'failed', attempts: 1 }
    const claim = await claimComment(COMMENT, CONFIG)
    expect(claim).toEqual({ rowId: 'row-1', attempts: 2 })
    expect(capturedUpdatePayloads).toHaveLength(1)
    expect(capturedUpdatePayloads[0]).toMatchObject({
      reply_status: 'processing',
      attempts: 2,
      reviewed_at: null,
      reviewed_by: null,
    })
  })

  it('全新评论（插入成功）→ 不碰 reviewed_at（这行从来没被审核过，列默认值就是 null）', async () => {
    insertShouldSucceed = true
    const claim = await claimComment(COMMENT, CONFIG)
    expect(claim).toEqual({ rowId: 'new-row-id', attempts: 1 })
    expect(capturedUpdatePayloads).toHaveLength(0)
  })

  it('已经耗尽重试的 failed 行不会被重新认领（attempts >= MAX_ATTEMPTS）', async () => {
    existingRow = { id: 'row-1', reply_status: 'failed', attempts: MAX_ATTEMPTS }
    const claim = await claimComment(COMMENT, CONFIG)
    expect(claim).toBeNull()
    expect(capturedUpdatePayloads).toHaveLength(0)
  })
})

const DECISION: CommentDecision = {
  category: 'complaint',
  confidence: 0.9,
  publicReply: null,
  publicReplyAfterDm: null,
  privateReply: null,
  shouldHide: false,
  needsHuman: true,
  guardrailFlags: [],
  replySource: 'llm',
}

const FINALISE_RESULT: FinaliseResult = {
  status: 'failed',
  hidden: false,
  dmSent: false,
  publicReplyId: null,
  publicText: null,
  error: 'boom',
}

/**
 * Codex round 16 复审 P2：`claimComment` 在认领瞬间清空 `reviewed_at` 只堵住了
 * "这次重试开始前就已经被标记已阅"这一半——`classifyComment` /
 * `replyToComment` / `sendPrivateReply`（`processClaimedComment` 内，
 * `claimComment` 和 `finalise` 之间）都是真实的网络调用，这段时间行一直停在
 * `processing`、`needs_human` 还是上一轮的旧值，FDE 这时候点"标记已阅"会
 * 重新写一次 `reviewed_at`——`claimComment` 的清空已经跑过了，拦不住这次。
 * `finalise` 作为这次尝试的最后一次写入，无条件把 `reviewed_at`/`reviewed_by`
 * 也清一遍，才能真正堵死这条竞态：不管这次结果是什么，这次尝试的结果都还
 * 没有人看过，旧的审核标记不该继续算数。
 */
describe('finalise', () => {
  beforeEach(() => {
    capturedUpdatePayloads = []
  })

  it('无论这次结果是什么，都顺带清空 reviewed_at / reviewed_by', async () => {
    await finalise('row-1', DECISION, FINALISE_RESULT)
    expect(capturedUpdatePayloads).toHaveLength(1)
    expect(capturedUpdatePayloads[0]).toMatchObject({ reviewed_at: null, reviewed_by: null })
  })

  it('回复成功的结果同样清空——不是只有失败结果才清', async () => {
    await finalise('row-1', { ...DECISION, needsHuman: false }, {
      status: 'replied', hidden: false, dmSent: false, publicReplyId: 'fb_1', publicText: 'thanks!',
    })
    expect(capturedUpdatePayloads).toHaveLength(1)
    expect(capturedUpdatePayloads[0]).toMatchObject({ reviewed_at: null, reviewed_by: null })
  })
})
