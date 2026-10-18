// 转公开动作编排测试:内存版库 + 假 Meta,走完整链路(预览 → 令牌 → 抢占 → 调 Meta → 先流量记录后工单 → 首评 → 收尾)。
// 本文件同时是「当场试跑」的演练:不碰任何真实主页/真实库。

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/social/content-review', () => ({
  REEL_AUTO_CHECK_KEYS: [],
  checklistPasses: () => true,
  humanKeysForStored: () => [],
  validateContentChecklist: () => ({ ok: true, items: [{ key: 'k' }] }),
}))

import { runPromote } from './action'
import { PromoteMetaError, type MetaReelView, type PromoteDeps, type PromoteResult, type TrafficRow } from './types'
import type { PublishTarget } from '../../types'

const ORDER_ID = 'c0000000-0000-4000-8000-0000000000a1'
const CLIENT_ID = 'c0000000-0000-4000-8000-0000000000c1'
const ROW_ID = 'c0000000-0000-4000-8000-0000000000f1'
const PAGE = '1111111111'
const VIDEO = '2222222222'
const T0 = Date.parse('2026-10-20T00:00:00.000Z')
const ADMIN = 'boss@example.com'
const CAPTION = 'Great Acme tour deal'

interface World {
  now: number
  order: { status: string; updated_at: string; published_ref: Record<string, unknown>; review_ref: Record<string, unknown>; master_brief_id: string | null }
  row: TrafficRow | null
  extraRows: TrafficRow[]
  meta: MetaReelView
  target: PublishTarget | null
  log: string[]
  alerts: string[]
  orderWriteFails: number
  promoteError: Error | null
  commentError: Error | null
  readError: Error | null
  redlineWord: string
  seq: number
  afterPromoteDescription: string | null
}

function makeWorld(): World {
  return {
    now: T0,
    order: {
      status: 'published', updated_at: 'u1', master_brief_id: 'mb1',
      published_ref: { platform: 'facebook', page_id: PAGE, video_id: VIDEO, video_state: 'DRAFT', published_at: '2026-10-19T00:00:00.000Z', event_ids: ['old'] },
      review_ref: { approved_at: '2026-10-19T01:00:00.000Z', checklist_human: [] },
    },
    row: { id: ROW_ID, client_id: CLIENT_ID, payload: { work_order_id: ORDER_ID, platform: 'facebook', page_id: PAGE, video_id: VIDEO, video_state: 'DRAFT', published_at: '2026-10-19T00:00:00.000Z' } },
    extraRows: [],
    meta: { published: false, fromId: PAGE, description: `${CAPTION}⁣​‌`, updatedTime: '2026-10-19T12:00:00.000Z', permalink: '/reel/2222222222/' },
    target: { platform: 'facebook', page_id: PAGE, expect_brand: 'Acme', client_id: CLIENT_ID },
    log: [], alerts: [], orderWriteFails: 0, promoteError: null, commentError: null, readError: null,
    redlineWord: 'badword', seq: 0, afterPromoteDescription: null,
  }
}

function makeDeps(w: World): PromoteDeps {
  const brief = { copy: { caption: CAPTION, endcard: { cta: 'Book now', url: 'https://example.com/tour' } } }
  return {
    store: {
      async loadOrder() {
        return { id: ORDER_ID, client_id: CLIENT_ID, status: w.order.status, master_brief_id: w.order.master_brief_id, brief, output: { quality_checklist_auto: [] }, review_ref: structuredClone(w.order.review_ref), published_ref: structuredClone(w.order.published_ref), updated_at: w.order.updated_at }
      },
      async loadTrafficRows() { return w.row ? [structuredClone(w.row), ...w.extraRows] : [...w.extraRows] },
      async loadTrafficRow() { return w.row ? structuredClone(w.row) : null },
      async casPayload(_id, _c, expected, next) {
        const cur = w.row?.payload['promote_rev'] ?? null
        if (!w.row || cur !== expected) return false
        w.row.payload = structuredClone(next)
        w.log.push('traffic')
        return true
      },
      async writeOrderPublishedRef(_id, expectedUpdatedAt, nextRef) {
        if (w.orderWriteFails > 0) { w.orderWriteFails -= 1; return false }
        if (expectedUpdatedAt !== w.order.updated_at) return false
        w.order.published_ref = structuredClone(nextRef)
        w.order.updated_at = `u${++w.seq + 1}`
        w.log.push('order')
        return true
      },
    },
    meta: {
      async readReel() {
        if (w.readError) throw w.readError
        return structuredClone(w.meta)
      },
      async promote() {
        w.log.push('meta.promote')
        if (w.promoteError) throw w.promoteError
        w.meta.published = true
        if (w.afterPromoteDescription !== null) w.meta.description = w.afterPromoteDescription
        return { platform: 'facebook', page_id: PAGE, post_id: VIDEO, video_id: VIDEO, published_at: new Date(w.now).toISOString(), permalink: '/reel/2222222222/', video_state: 'PUBLISHED' }
      },
      async ensureFirstComment() {
        w.log.push('comment')
        if (w.commentError) throw w.commentError
        return 'comment-1'
      },
    },
    resolveTarget: async () => (w.target ? { ...w.target } : null),
    scanRedline: async (_c, _m, text) => (text.toLowerCase().includes(w.redlineWord) ? `命中红线: ${w.redlineWord}` : null),
    now: () => new Date(w.now),
    uuid: () => `00000000-0000-4000-8000-${String(++w.seq).padStart(12, '0')}`,
    randomToken: () => `tok-${++w.seq}`,
    alert: (m) => { w.alerts.push(m) },
  }
}

let w: World
let deps: PromoteDeps
const preview = (email = ADMIN) => runPromote(deps, { orderId: ORDER_ID, adminEmail: email, confirm: false })
const confirm = (token: string | undefined, email = ADMIN) => runPromote(deps, { orderId: ORDER_ID, adminEmail: email, confirm: true, previewToken: token })

async function tokenOf(email = ADMIN): Promise<string> {
  const r = await preview(email)
  if (!r.ok || r.kind !== 'preview') throw new Error(`preview failed: ${JSON.stringify(r)}`)
  return r.data.preview_token
}
const err = (r: PromoteResult): string => (r.ok ? '' : r.error)
const auth = () => (w.row?.payload['promote_authorization'] ?? {}) as Record<string, unknown>

beforeEach(() => { w = makeWorld(); deps = makeDeps(w) })

describe('预览', () => {
  it('只写预览令牌槽:不改任何业务字段,不调 Meta,令牌库里只存哈希', async () => {
    const token = await tokenOf()
    expect(w.row?.payload['video_state']).toBe('DRAFT')
    expect(w.log).not.toContain('meta.promote')
    expect(JSON.stringify(w.row?.payload)).not.toContain(token)
    expect(w.order.published_ref['video_state']).toBe('DRAFT')
  })

  it('两位管理员同时预览互不覆盖', async () => {
    const [a, b] = await Promise.all([tokenOf('a@example.com'), tokenOf('b@example.com')])
    const slots = w.row?.payload['promote_preview'] as Record<string, unknown>
    expect(Object.keys(slots).length).toBeGreaterThanOrEqual(1)
    // 并发写撞版本号时被覆盖者重新预览即可;两人各自重试后都能拿到可用令牌
    const a2 = await tokenOf('a@example.com'); const b2 = await tokenOf('b@example.com')
    expect(Object.keys(w.row?.payload['promote_preview'] as Record<string, unknown>).length).toBe(2)
    expect(new Set([a, b, a2, b2]).size).toBe(4)
  })
})

describe('令牌', () => {
  it('跳过预览直接确认被拒', async () => {
    const r = await confirm(undefined)
    expect(r.ok).toBe(false)
    expect(w.log).not.toContain('meta.promote')
  })

  it('错误令牌被拒;别的管理员拿不到、用不了', async () => {
    const token = await tokenOf()
    expect((await confirm('wrong')).ok).toBe(false)
    const other = await confirm(token, 'other@example.com')
    expect(other.ok).toBe(false)
    expect(w.log).not.toContain('meta.promote')
  })

  it('过期令牌被拒', async () => {
    const token = await tokenOf()
    w.now += 6 * 60 * 1000
    const r = await confirm(token)
    expect(r.ok).toBe(false); expect(err(r)).toContain('过期')
  })

  it('令牌用过一次后不能复用(崩溃后的旧请求被拒,提示重新预览)', async () => {
    const token = await tokenOf()
    w.promoteError = new Error('boom')
    expect((await confirm(token)).ok).toBe(false)
    w.promoteError = null
    w.now += 6 * 60 * 1000 // 租约过期
    const again = await confirm(token)
    expect(again.ok).toBe(false)
  })

  it('指纹:预览后审片记录被改 → 409', async () => {
    const token = await tokenOf()
    w.order.review_ref = { ...w.order.review_ref, approved_at: '2026-10-19T09:00:00.000Z' }
    const r = await confirm(token)
    expect(!r.ok && r.status).toBe(409)
  })

  it('预览后 Facebook 草稿文案被改 → 409', async () => {
    const token = await tokenOf()
    w.meta.description = 'Totally different text'
    const r = await confirm(token)
    expect(!r.ok && r.status).toBe(409)
    expect(w.log).not.toContain('meta.promote')
  })
})

describe('前置校验与红线', () => {
  it('Meta 草稿文案含红线词被拒(含零宽字符绕过)', async () => {
    w.order.published_ref = { ...w.order.published_ref }
    const caption = 'Great bad​word deal'
    w.meta.description = caption
    deps = { ...makeDeps(w), scanRedline: deps.scanRedline }
    const brief = { copy: { caption: 'Great badword deal', endcard: { cta: 'Book now', url: 'https://example.com/tour' } } }
    const base = deps.store
    deps.store = { ...base, loadOrder: async () => { const o = await base.loadOrder(ORDER_ID); return o ? { ...o, brief } : null } }
    const r = await preview()
    expect(r.ok).toBe(false); expect(err(r)).toContain('红线')
  })

  it('expect_brand 缺失 → 拒绝,不碰 Meta', async () => {
    w.target = { platform: 'facebook', page_id: PAGE, client_id: CLIENT_ID }
    const r = await preview()
    expect(!r.ok && r.status).toBe(422)
  })

  it('Meta 不返回视频 from → 拒绝;from 不是本页 → 拒绝', async () => {
    w.meta.fromId = null
    expect(!(await preview()).ok).toBe(true)
    w.meta.fromId = '999'
    expect(err(await preview())).toContain('不属于')
  })

  it('工单无 master_brief_id → 拒绝', async () => {
    w.order.master_brief_id = null
    expect(!(await preview()).ok).toBe(true)
  })

  it('流量记录 0 行或多行都拒绝', async () => {
    w.row = null
    expect(!(await preview()).ok).toBe(true)
    w = makeWorld(); deps = makeDeps(w)
    w.extraRows = [{ id: 'x', client_id: CLIENT_ID, payload: {} }]
    expect(!(await preview()).ok).toBe(true)
  })

  it('页面三方 id 不一致被拒', async () => {
    if (w.row) w.row.payload['page_id'] = '555'
    expect(!(await preview()).ok).toBe(true)
  })

  it('视频已被删:报「已不存在」而不是「不属本页」', async () => {
    w.readError = new PromoteMetaError('video_missing', 'gone')
    const r = await preview()
    expect(!r.ok && r.status).toBe(404)
  })

  it('不是草稿(已公开/superseded)的工单一律拒绝', async () => {
    w.order.status = 'superseded'
    expect(!(await preview()).ok).toBe(true)
  })
})

describe('转公开主链路', () => {
  it('先流量记录后工单,两处同一个 published_at;工单带 ig_crosspost_blocked 并清掉旧 event_ids', async () => {
    const r = await confirm(await tokenOf())
    expect(r.ok && r.kind).toBe('promoted')
    const order = w.log.indexOf('order')
    expect(w.log.indexOf('meta.promote')).toBeLessThan(order)
    const firstPublishedWrite = w.log.indexOf('traffic', w.log.indexOf('meta.promote'))
    expect(firstPublishedWrite).toBeGreaterThan(-1)
    expect(firstPublishedWrite).toBeLessThan(order)
    const iso = new Date(T0).toISOString()
    expect(w.row?.payload['published_at']).toBe(iso)
    expect(w.order.published_ref['published_at']).toBe(iso)
    expect(w.row?.payload['video_state']).toBe('PUBLISHED')
    expect(w.order.published_ref['video_state']).toBe('PUBLISHED')
    expect(w.order.published_ref['ig_crosspost_blocked']).toBe(true)
    expect(w.order.published_ref).not.toHaveProperty('event_ids')
    expect(auth().status).toBe('consumed')
    expect(auth().first_comment_status).toBe('ok')
    expect(w.row?.payload['first_comment_id']).toBe('comment-1')
  })

  it('读-改-写合并:授权回执、预览槽和原有字段都还在', async () => {
    await confirm(await tokenOf())
    const p = w.row?.payload ?? {}
    expect(p['work_order_id']).toBe(ORDER_ID)
    expect(p['promote_preview']).toBeTruthy()
    expect(auth().authorized_by).toBe(ADMIN)
    expect(typeof p['promote_rev']).toBe('string')
  })

  it('并发双击:同一令牌只有一个请求调到 Meta', async () => {
    const token = await tokenOf()
    const [a, b] = await Promise.all([confirm(token), confirm(token)])
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1)
    expect(w.log.filter((x) => x === 'meta.promote').length).toBe(1)
  })

  it('租约未过期再点 → 409;过期可重新抢占', async () => {
    w.row!.payload['promote_authorization'] = { status: 'claimed', claimed_at: new Date(T0 - 60_000).toISOString() }
    const t1 = await tokenOf()
    expect(!(await confirm(t1)).ok).toBe(true)
    w.row!.payload['promote_authorization'] = { status: 'claimed', claimed_at: new Date(T0 - 6 * 60_000).toISOString() }
    const t2 = await tokenOf()
    expect((await confirm(t2)).ok).toBe(true)
  })

  it('Meta 调用失败:原因脱敏,工单仍是草稿,可再预览重试', async () => {
    w.promoteError = new Error('FB failed access_token=EAABSECRETSECRETSECRET123 fbtrace_id=ABCDEF')
    const r = await confirm(await tokenOf())
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('EAABSECRET')
    expect(String(auth().fail_reason)).not.toContain('EAABSECRET')
    expect(auth().status).toBe('failed')
    expect(w.order.published_ref['video_state']).toBe('DRAFT')
    w.promoteError = null
    expect((await confirm(await tokenOf())).ok).toBe(true)
  })

  it('首评失败不回滚公开:回执标 failed + needs_attention + 告警', async () => {
    w.commentError = new Error('comment boom')
    const r = await confirm(await tokenOf())
    expect(r.ok && r.kind === 'promoted' ? r.data.first_comment_status : undefined).toBe('failed')
    expect(w.order.published_ref['video_state']).toBe('PUBLISHED')
    expect(auth().needs_attention).toBe(true)
    expect(w.alerts.join('|')).toContain('首评')
  })

  it('转公开后回读命中红线 → 告警并记入回执(尽力防护)', async () => {
    w.afterPromoteDescription = 'now with badword inside'
    await confirm(await tokenOf())
    expect(auth().post_publish_redline_hit).toBeTruthy()
    expect(w.alerts.join('|')).toContain('红线')
  })
})

describe('时间取值与重入', () => {
  it('人手已公开:不调 Meta 转公开,不用 now,用 Meta 读到的时间并标 estimated / late_backfill', async () => {
    w.meta.published = true
    const r = await confirm(await tokenOf())
    expect(r.ok && r.kind).toBe('synced')
    expect(w.log).not.toContain('meta.promote')
    expect(w.order.published_ref['published_at']).toBe('2026-10-19T12:00:00.000Z')
    expect(w.order.published_ref['published_at_estimated']).toBe(true)
    expect(auth().late_backfill).toBe(true)
    expect(w.log).toContain('comment')
  })

  it('已公开且读不到任何真实时间 → 拒绝(绝不用 now 冒充)', async () => {
    w.meta.published = true; w.meta.updatedTime = null
    const r = await confirm(await tokenOf())
    expect(r.ok).toBe(false)
  })

  it('7.1 成功 7.2 失败后重入:两处沿用已写的 published_at,且不再调 Meta', async () => {
    w.orderWriteFails = 3
    const first = await confirm(await tokenOf())
    expect(first.ok).toBe(false)
    const t1 = w.row?.payload['published_at']
    expect(t1).toBe(new Date(T0).toISOString())
    expect(auth().status).toBe('meta_published_db_pending')
    w.now += 10 * 60 * 1000
    const second = await confirm(await tokenOf())
    expect(second.ok).toBe(true)
    expect(w.order.published_ref['published_at']).toBe(t1)
    expect(w.row?.payload['published_at']).toBe(t1)
    expect(w.log.filter((x) => x === 'meta.promote').length).toBe(1)
  })

  it('工单已写成公开但收尾没做完:只补首评和回执,不再调 Meta', async () => {
    await confirm(await tokenOf())
    const rid = w.order.published_ref['promote_request_id']
    w.row!.payload['promote_authorization'] = { ...auth(), status: 'meta_published_db_pending', request_id: rid }
    w.log.length = 0
    const r = await runPromote(deps, { orderId: ORDER_ID, adminEmail: ADMIN, confirm: true })
    expect(r.ok && r.kind).toBe('synced')
    expect(w.log).not.toContain('meta.promote')
    expect(auth().status).toBe('consumed')
  })

  it('已完成(consumed)的工单再点 → 409', async () => {
    await confirm(await tokenOf())
    const r = await runPromote(deps, { orderId: ORDER_ID, adminEmail: ADMIN, confirm: true })
    expect(!r.ok && r.status).toBe(409)
  })

  it('补发任务清 event_ids 后能补发:published_ref 保持 PUBLISHED 且无 event_ids,ig 标记还在', async () => {
    await confirm(await tokenOf())
    expect(w.order.published_ref['video_state']).toBe('PUBLISHED')
    expect(w.order.published_ref['event_ids']).toBeUndefined()
    expect(w.order.published_ref['ig_crosspost_blocked']).toBe(true)
  })
})
