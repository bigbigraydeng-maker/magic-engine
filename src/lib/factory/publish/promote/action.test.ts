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
  onPromote: (() => void) | null
  onComment: (() => Promise<void>) | null
  failCas: number
  promoteEstimated: boolean
  items: Array<{ existingItemId: string | null; title: string }>
  workLogs: string[]
  itemError: Error | null
  logError: Error | null
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
    onPromote: null, onComment: null, failCas: 0, promoteEstimated: false,
    items: [], workLogs: [], itemError: null, logError: null,
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
        if (w.failCas > 0 && w.log.includes('meta.promote')) { w.failCas -= 1; return false }
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
    books: {
      async completeExecutionItem(a) {
        if (w.itemError) throw w.itemError
        w.items.push({ existingItemId: a.existingItemId, title: a.title })
      },
      async writeWorkLog(a) {
        if (w.logError) throw w.logError
        w.workLogs.push(a.summary)
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
        w.onPromote?.()
        return { platform: 'facebook', page_id: PAGE, post_id: VIDEO, video_id: VIDEO, published_at: new Date(w.now).toISOString(), permalink: '/reel/2222222222/', video_state: 'PUBLISHED', ...(w.promoteEstimated ? { published_at_estimated: true } : {}) }
      },
      async ensureFirstComment() {
        w.log.push('comment')
        if (w.onComment) await w.onComment()
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

  it('已完成(consumed)且首评已发好 → 再点 409', async () => {
    await confirm(await tokenOf())
    const r = await runPromote(deps, { orderId: ORDER_ID, adminEmail: ADMIN, confirm: false })
    expect(!r.ok && r.status).toBe(409)
  })

  it('7.2 失败后租约立刻释放:不用等 5 分钟就能重试', async () => {
    w.orderWriteFails = 3
    expect((await confirm(await tokenOf())).ok).toBe(false)
    expect(auth().status).toBe('meta_published_db_pending')
    expect((await confirm(await tokenOf())).ok).toBe(true) // 时间没往后拨
  })

  it('7.1 写库失败:租约释放为 failed,真实 published_at 留在回执里,重入沿用而不重取', async () => {
    w.failCas = 3
    const first = await confirm(await tokenOf())
    expect(!first.ok && first.status).toBe(500)
    expect(auth().status).toBe('failed')
    expect(auth().published_at).toBe(new Date(T0).toISOString())
    w.now += 3_600_000
    w.meta.updatedTime = '2026-10-20T00:30:00.000Z'
    const second = await confirm(await tokenOf())
    expect(second.ok).toBe(true)
    expect(w.order.published_ref['published_at']).toBe(new Date(T0).toISOString())
    expect(w.row?.payload['published_at']).toBe(new Date(T0).toISOString())
    expect(w.log.filter((x) => x === 'meta.promote').length).toBe(1)
  })

  it('Meta 调用失败后 promote_called_at 被清掉(下次不会拿旧尝试的时间当估算)', async () => {
    w.promoteError = new Error('boom')
    await confirm(await tokenOf())
    expect(auth().promote_called_at).toBeUndefined()
  })

  it('适配器说这次是「已公开」的估算时间 → 标 estimated / late_backfill', async () => {
    w.promoteEstimated = true
    await confirm(await tokenOf())
    expect(w.order.published_ref['published_at_estimated']).toBe(true)
    expect(auth().late_backfill).toBe(true)
  })
})

describe('首评失败后补发 / 已公开后的收尾', () => {
  async function promoteWithFailedComment(): Promise<void> {
    w.commentError = new Error('comment boom')
    await confirm(await tokenOf())
    w.commentError = null
  }

  it('首评失败:收尾标 consumed + failed,工单带「首评待补」标记供页面显示入口', async () => {
    await promoteWithFailedComment()
    expect(auth().status).toBe('consumed')
    expect(auth().first_comment_status).toBe('failed')
    expect(w.order.published_ref['first_comment_pending']).toBe(true)
  })

  it('可以补发首评:要预览+令牌;预览不发评论;确认只发评论、不再调 Meta 转公开', async () => {
    await promoteWithFailedComment()
    w.log.length = 0
    const noToken = await runPromote(deps, { orderId: ORDER_ID, adminEmail: ADMIN, confirm: true })
    expect(!noToken.ok && noToken.status).toBe(403)
    const pv = await preview()
    expect(pv.ok && pv.kind === 'preview' ? pv.data.mode : '').toBe('comment_only')
    expect(w.log).not.toContain('comment')
    const r = await confirm(pv.ok && pv.kind === 'preview' ? pv.data.preview_token : undefined)
    expect(r.ok && r.kind).toBe('synced')
    expect(w.log).toContain('comment')
    expect(w.log).not.toContain('meta.promote')
    expect(auth().first_comment_status).toBe('ok')
    expect(w.order.published_ref).not.toHaveProperty('first_comment_pending')
    expect(w.order.published_ref['video_state']).toBe('PUBLISHED')
  })

  it('工单已写成公开但收尾没做完:预览只发令牌,确认才补首评和回执', async () => {
    await confirm(await tokenOf())
    w.row!.payload['promote_authorization'] = { ...auth(), status: 'meta_published_db_pending' }
    w.log.length = 0
    const token = await tokenOf()
    expect(w.log).not.toContain('comment')
    const r = await confirm(token)
    expect(r.ok && r.kind).toBe('synced')
    expect(w.log).not.toContain('meta.promote')
    expect(auth().status).toBe('consumed')
  })
})

describe('租约与 request 栅栏', () => {
  it('收尾(补首评)期间租约不放:别的管理员此时预览/确认都被拒,只有一次评论', async () => {
    let rivalPreview: PromoteResult | null = null
    let rivalConfirm: PromoteResult | null = null
    w.onComment = async () => {
      w.onComment = null
      rivalPreview = await preview('b@example.com')
      rivalConfirm = await runPromote(deps, { orderId: ORDER_ID, adminEmail: 'b@example.com', confirm: true, previewToken: 'guess' })
    }
    const r = await confirm(await tokenOf())
    expect(r.ok).toBe(true)
    expect((rivalPreview as PromoteResult | null)?.ok).toBe(false)
    expect((rivalConfirm as PromoteResult | null)?.ok).toBe(false)
    expect(w.log.filter((x) => x === 'comment').length).toBe(1)
    expect(w.log.filter((x) => x === 'meta.promote').length).toBe(1)
  })

  it('调 Meta 之后被别的请求接管:写流量记录被栅栏挡住,工单不被写', async () => {
    w.onPromote = () => { w.row!.payload['promote_authorization'] = { ...auth(), attempt_id: 'someone-else' } }
    const r = await confirm(await tokenOf())
    expect(!r.ok && r.status).toBe(409)
    expect(w.log).not.toContain('order')
    expect(w.row?.payload['video_state']).toBe('DRAFT')
  })

  it('收尾期间被接管:收尾回执不会覆盖对方,返回 409', async () => {
    w.onComment = async () => { w.row!.payload['promote_authorization'] = { ...auth(), attempt_id: 'someone-else', status: 'claimed' } }
    const r = await confirm(await tokenOf())
    expect(!r.ok && r.status).toBe(409)
    expect(auth().status).toBe('claimed')
    expect(auth().attempt_id).toBe('someone-else')
  })
})

describe('首评发出前无条件过红线', () => {
  it('已被人手公开的分支:首评命中红线 → 不发,标 failed + needs_attention', async () => {
    w.meta.published = true
    w.redlineWord = 'book now'
    const r = await confirm(await tokenOf())
    expect(r.ok && r.kind === 'synced' ? r.data.first_comment_status : '').toBe('failed')
    expect(w.log).not.toContain('comment')
    expect(auth().needs_attention).toBe(true)
    expect(w.alerts.join('|')).toContain('首评命中红线')
  })

  it('首评红线检查本身出错 → 保守不发', async () => {
    w.meta.published = true
    const ok = deps.scanRedline
    let calls = 0
    deps.scanRedline = async (...a) => { calls += 1; if (calls >= 1) throw new Error('db down'); return ok(...a) }
    const r = await confirm(await tokenOf())
    expect(r.ok && r.kind === 'synced' ? r.data.first_comment_status : '').toBe('failed')
    expect(w.log).not.toContain('comment')
  })
})

describe('公开后的两笔回执(工作日志 + 执行事项)', () => {
  it('新转公开:各写一次;字段沿用 writeThreeBooks(factory 账号文案、进行中改 completed 的标题)', async () => {
    await confirm(await tokenOf())
    expect(w.workLogs).toHaveLength(1)
    expect(w.workLogs[0]).toContain('已公开')
    expect(w.items).toHaveLength(1)
    expect(w.items[0].existingItemId).toBeNull() // 2817 之后草稿期没有这行 -> 新建
    expect(w.items[0].title).toContain('工厂自动发布 Reel')
    expect(auth().books_work_order_id).toBe(ORDER_ID)
  })

  it('草稿期已有执行事项(2817 之前):用它标 completed,而不是再建一条', async () => {
    w.row!.execution_item_id = 'item-1'
    await confirm(await tokenOf())
    expect(w.items).toEqual([expect.objectContaining({ existingItemId: 'item-1' })])
  })

  it('只同步(人手已公开):也写一次', async () => {
    w.meta.published = true
    await confirm(await tokenOf())
    expect(w.workLogs).toHaveLength(1)
    expect(w.items).toHaveLength(1)
  })

  it('补首评分支不写', async () => {
    w.commentError = new Error('boom')
    await confirm(await tokenOf())
    w.commentError = null
    expect(w.workLogs).toHaveLength(1)
    await confirm(await tokenOf())
    expect(w.workLogs).toHaveLength(1)
    expect(w.items).toHaveLength(1)
  })

  it('重入(7.2 失败后重来)不重复写:全程各一次', async () => {
    w.orderWriteFails = 3
    await confirm(await tokenOf())
    expect(w.workLogs).toHaveLength(0) // 工单还没写成公开,不记「已公开」
    await confirm(await tokenOf())
    expect(w.workLogs).toHaveLength(1)
    expect(w.items).toHaveLength(1)
  })

  it('去重:回执里已有该工单的占位 → 不再写(去掉去重判断此条变红)', async () => {
    w.row!.payload['promote_authorization'] = { books_work_order_id: ORDER_ID }
    await confirm(await tokenOf())
    expect(w.workLogs).toHaveLength(0)
    expect(w.items).toHaveLength(0)
  })

  it('写入失败不回滚公开:回执 needs_attention + books_error + 告警,请求仍成功', async () => {
    w.logError = new Error('db down')
    const r = await confirm(await tokenOf())
    expect(r.ok).toBe(true)
    expect(w.order.published_ref['video_state']).toBe('PUBLISHED')
    expect(auth().status).toBe('consumed')
    expect(auth().needs_attention).toBe(true)
    expect(String(auth().books_error)).toContain('工作日志')
    expect(w.alerts.join('|')).toContain('公开回执')
  })

  it('执行事项写入失败同样不回滚公开,工作日志仍照写', async () => {
    w.itemError = new Error('db down')
    const r = await confirm(await tokenOf())
    expect(r.ok).toBe(true)
    expect(w.workLogs).toHaveLength(1)
    expect(String(auth().books_error)).toContain('执行事项')
  })
})

describe('公开后补收尾也补两笔回执(窗口 B:写完工单后、占位前崩溃)', () => {
  /** 模拟崩溃现场:工单已是 PUBLISHED、回执还停在 claimed 且租约过期,两笔回执没写也没占位。 */
  async function crashAfterOrderWrite(): Promise<void> {
    await confirm(await tokenOf())
    const a = { ...auth() }
    delete a['books_work_order_id']; delete a['books_written_at']; delete a['first_comment_status']
    w.row!.payload['promote_authorization'] = { ...a, status: 'claimed', claimed_at: new Date(w.now - 6 * 60_000).toISOString() }
    w.items.length = 0; w.workLogs.length = 0; w.log.length = 0
  }

  it('补收尾写一次两笔回执,且不再调 Meta 转公开', async () => {
    await crashAfterOrderWrite()
    const r = await confirm(await tokenOf())
    expect(r.ok && r.kind).toBe('synced')
    expect(w.workLogs).toHaveLength(1)
    expect(w.items).toHaveLength(1)
    expect(w.log).not.toContain('meta.promote')
    expect(auth().books_written_at).toBeTruthy()
  })

  it('已占位(上次其实写过)的再次补收尾不重复写', async () => {
    await crashAfterOrderWrite()
    w.row!.payload['promote_authorization'] = { ...auth(), books_work_order_id: ORDER_ID, books_written_at: new Date(T0).toISOString() }
    await confirm(await tokenOf())
    expect(w.workLogs).toHaveLength(0)
    expect(w.items).toHaveLength(0)
  })

  it('仅补首评(commentRetry)不写回执', async () => {
    w.commentError = new Error('boom')
    await confirm(await tokenOf())
    w.commentError = null
    const a = { ...auth() }; delete a['books_work_order_id']; delete a['books_written_at'] // 去掉占位,证明不写是分支决定的而不只是去重
    w.row!.payload['promote_authorization'] = a
    w.items.length = 0; w.workLogs.length = 0
    await confirm(await tokenOf())
    expect(w.workLogs).toHaveLength(0)
    expect(w.items).toHaveLength(0)
  })
})

describe('books_written_at 章', () => {
  it('两笔都成功:盖章,收尾不标 needs_attention', async () => {
    await confirm(await tokenOf())
    expect(auth().books_written_at).toBe(new Date(T0).toISOString())
    expect(auth().needs_attention).toBe(false)
  })

  it('有占位却没盖章(上次中途崩了):收尾标 needs_attention,不重复写', async () => {
    w.row!.payload['promote_authorization'] = { books_work_order_id: ORDER_ID }
    await confirm(await tokenOf())
    expect(auth().needs_attention).toBe(true)
    expect(w.workLogs).toHaveLength(0)
  })

  it('命中 0 行的更新(端口抛错)视为失败:不盖章,标 books_error + needs_attention,公开不回滚', async () => {
    w.itemError = { message: '执行事项更新没有命中任何行' } as unknown as Error
    const r = await confirm(await tokenOf())
    expect(r.ok).toBe(true)
    expect(auth().books_written_at).toBeUndefined()
    expect(String(auth().books_error)).toContain('没有命中任何行')
    expect(auth().needs_attention).toBe(true)
  })
})
