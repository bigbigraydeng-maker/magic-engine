// 特征化测试:把转公开动作「当前 Facebook 路径」的精确输出钉死,作为抽取平台端口时的零回归证据。
// 不判断对错,只记录现状:任何输出变化(错误文案、检查顺序、写入的字段、调用顺序、指纹值)都会让此处变红。
// 基线先在抽取之前的代码上写成并通过,抽取之后一字不改地再跑一遍。

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/social/content-review', () => ({
  REEL_AUTO_CHECK_KEYS: [],
  checklistPasses: () => true,
  humanKeysForStored: () => [],
  validateContentChecklist: () => ({ ok: true, items: [{ key: 'k' }] }),
}))

import { runPromote } from './action'
import { computeFingerprint } from './guards'
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
  seq: number
  commentError: Error | null
  readError: Error | null
  orderWriteFails: number
  items: string[]
  workLogs: string[]
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
    log: [], alerts: [], seq: 0, commentError: null, readError: null, orderWriteFails: 0, items: [], workLogs: [],
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
        w.log.push('store.traffic')
        return true
      },
      async writeOrderPublishedRef(_id, expectedUpdatedAt, nextRef) {
        if (w.orderWriteFails > 0) { w.orderWriteFails -= 1; w.log.push('store.order.conflict'); return false }
        if (expectedUpdatedAt !== w.order.updated_at) return false
        w.order.published_ref = structuredClone(nextRef)
        w.order.updated_at = `u${++w.seq + 1}`
        w.log.push('store.order')
        return true
      },
    },
    books: {
      async completeExecutionItem(a) { w.log.push('books.item'); w.items.push(a.title) },
      async writeWorkLog(a) { w.log.push('books.log'); w.workLogs.push(a.summary) },
    },
    meta: {
      async readReel() {
        w.log.push('meta.read')
        if (w.readError) throw w.readError
        return structuredClone(w.meta)
      },
      async promote() {
        w.log.push('meta.promote')
        w.meta.published = true
        return { platform: 'facebook', page_id: PAGE, post_id: VIDEO, video_id: VIDEO, published_at: new Date(w.now).toISOString(), permalink: '/reel/2222222222/', video_state: 'PUBLISHED' }
      },
      async ensureFirstComment() {
        w.log.push('meta.comment')
        if (w.commentError) throw w.commentError
        return 'comment-1'
      },
    },
    resolveTarget: async () => (w.target ? { ...w.target } : null),
    scanRedline: async (_c, _m, text) => { w.log.push('redline'); return text.toLowerCase().includes('badword') ? '命中红线: badword' : null },
    now: () => new Date(w.now),
    uuid: () => `00000000-0000-4000-8000-${String(++w.seq).padStart(12, '0')}`,
    randomToken: () => `tok-${++w.seq}`,
    alert: (m) => { w.alerts.push(m) },
  }
}

let w: World
let deps: PromoteDeps
const preview = () => runPromote(deps, { orderId: ORDER_ID, adminEmail: ADMIN, confirm: false })
const confirm = (token: string | undefined) => runPromote(deps, { orderId: ORDER_ID, adminEmail: ADMIN, confirm: true, previewToken: token })
const brief = (r: PromoteResult): { status: number; error: string } | 'ok' => (r.ok ? 'ok' : { status: r.status, error: r.error })
async function tokenOf(): Promise<string> {
  const r = await preview()
  if (!r.ok || r.kind !== 'preview') throw new Error(`preview failed: ${JSON.stringify(r)}`)
  return r.data.preview_token
}

beforeEach(() => { w = makeWorld(); deps = makeDeps(w) })

describe('特征化:指纹', () => {
  it('固定输入的指纹值不变(变了 = 已发出的预览令牌全部作废)', () => {
    expect(computeFingerprint({ videoId: VIDEO, description: CAPTION, firstComment: 'Book now: https://example.com/tour', approvedAt: '2026-10-19T01:00:00.000Z' }))
      .toMatchInlineSnapshot(`"041e248b9d82722eb8eb2176950ce3663fd85331916fbe9a0e1e7c62ebd3a891"`)
  })
})

describe('特征化:预览', () => {
  it('预览返回的字段与调用顺序', async () => {
    const r = await preview()
    expect(r).toMatchInlineSnapshot(`
      {
        "data": {
          "caption": "Great Acme tour deal⁣​‌",
          "checklist_passed_at": "2026-10-19T01:00:00.000Z",
          "expires_at": "2026-10-20T00:05:00.000Z",
          "first_comment": "Book now
      https://example.com/tour?utm_source=facebook&utm_medium=organic_social&utm_campaign=me_factory_reel&utm_content=c0000000-0000-4000-8000-0000000000a1",
          "mode": "promote",
          "page_id": "1111111111",
          "preview_token": "tok-1",
          "video_id": "2222222222",
        },
        "kind": "preview",
        "ok": true,
      }
    `)
    expect(w.log).toMatchInlineSnapshot(`
      [
        "meta.read",
        "redline",
        "store.traffic",
      ]
    `)
  })
})

describe('特征化:转公开主链路', () => {
  it('确认后:返回值、调用顺序、流量记录与工单的最终内容', async () => {
    const r = await confirm(await tokenOf())
    expect(r).toMatchInlineSnapshot(`
      {
        "data": {
          "first_comment_status": "ok",
          "permalink": "/reel/2222222222/",
          "published_at": "2026-10-20T00:00:00.000Z",
          "published_at_estimated": false,
          "request_id": "00000000-0000-4000-8000-000000000003",
          "video_id": "2222222222",
        },
        "kind": "promoted",
        "ok": true,
      }
    `)
    expect(w.log).toMatchInlineSnapshot(`
      [
        "meta.read",
        "redline",
        "store.traffic",
        "meta.read",
        "redline",
        "store.traffic",
        "store.traffic",
        "meta.promote",
        "store.traffic",
        "store.order",
        "store.traffic",
        "books.item",
        "books.log",
        "store.traffic",
        "redline",
        "meta.comment",
        "meta.read",
        "redline",
        "store.traffic",
      ]
    `)
    expect(w.order.published_ref).toMatchInlineSnapshot(`
      {
        "ig_crosspost_blocked": true,
        "page_id": "1111111111",
        "permalink": "/reel/2222222222/",
        "platform": "facebook",
        "promote_request_id": "00000000-0000-4000-8000-000000000003",
        "published_at": "2026-10-20T00:00:00.000Z",
        "video_id": "2222222222",
        "video_state": "PUBLISHED",
      }
    `)
    expect(w.row?.payload).toMatchInlineSnapshot(`
      {
        "first_comment_id": "comment-1",
        "page_id": "1111111111",
        "permalink": "/reel/2222222222/",
        "platform": "facebook",
        "promote_authorization": {
          "attempt_id": "00000000-0000-4000-8000-000000000003",
          "authorized_at": "2026-10-20T00:00:00.000Z",
          "authorized_by": "boss@example.com",
          "books_work_order_id": "c0000000-0000-4000-8000-0000000000a1",
          "books_written_at": "2026-10-20T00:00:00.000Z",
          "claimed_at": "2026-10-20T00:00:00.000Z",
          "fail_reason": undefined,
          "fingerprint": "220670c469715419890cf75bf7fd15a5ea7eac269dfa4b9a01ec27728d309977",
          "first_comment_status": "ok",
          "late_backfill": false,
          "needs_attention": false,
          "page_id": "1111111111",
          "post_publish_redline_hit": undefined,
          "promote_called_at": "2026-10-20T00:00:00.000Z",
          "published_at": "2026-10-20T00:00:00.000Z",
          "published_at_estimated": false,
          "request_id": "00000000-0000-4000-8000-000000000003",
          "status": "consumed",
          "video_id": "2222222222",
          "work_order_id": "c0000000-0000-4000-8000-0000000000a1",
        },
        "promote_preview": {
          "f632a98a3d7ca8bd": {
            "expires_at": "2026-10-20T00:05:00.000Z",
            "fingerprint": "220670c469715419890cf75bf7fd15a5ea7eac269dfa4b9a01ec27728d309977",
            "token_hash": "65dcf16ea3dfa49069628089eb4a75483070f5584b2a21ee64912b5f621f12da",
            "used": true,
            "work_order_id": "c0000000-0000-4000-8000-0000000000a1",
          },
        },
        "promote_rev": "00000000-0000-4000-8000-000000000010",
        "published_at": "2026-10-20T00:00:00.000Z",
        "published_at_estimated": false,
        "video_id": "2222222222",
        "video_state": "PUBLISHED",
        "work_order_id": "c0000000-0000-4000-8000-0000000000a1",
      }
    `)
    expect(w.alerts).toMatchInlineSnapshot(`[]`)
    expect(w.workLogs).toMatchInlineSnapshot(`
      [
        "【社媒｜工厂自动发布】Reel「Acme」已公开到 meta_graph。/reel/2222222222/",
      ]
    `)
    expect(w.items).toMatchInlineSnapshot(`
      [
        "【社媒 2026-10-20】工厂自动发布 Reel — Acme",
      ]
    `)
  })

  it('首评失败后补发:最终内容与调用顺序', async () => {
    w.commentError = new Error('boom')
    await confirm(await tokenOf())
    expect(w.order.published_ref['first_comment_pending']).toBe(true)
    w.commentError = null
    w.log.length = 0
    const t = await tokenOf()
    const r = await confirm(t)
    expect(r).toMatchInlineSnapshot(`
      {
        "data": {
          "first_comment_status": "ok",
          "permalink": "/reel/2222222222/",
          "published_at": "2026-10-20T00:00:00.000Z",
          "published_at_estimated": false,
          "request_id": "00000000-0000-4000-8000-000000000003",
          "video_id": "2222222222",
        },
        "kind": "synced",
        "ok": true,
      }
    `)
    expect(w.log).toMatchInlineSnapshot(`
      [
        "redline",
        "store.traffic",
        "redline",
        "store.traffic",
        "redline",
        "meta.comment",
        "meta.read",
        "redline",
        "store.traffic",
        "store.order",
      ]
    `)
    expect(w.order.published_ref).toMatchInlineSnapshot(`
      {
        "ig_crosspost_blocked": true,
        "page_id": "1111111111",
        "permalink": "/reel/2222222222/",
        "platform": "facebook",
        "promote_request_id": "00000000-0000-4000-8000-000000000003",
        "published_at": "2026-10-20T00:00:00.000Z",
        "video_id": "2222222222",
        "video_state": "PUBLISHED",
      }
    `)
    expect(w.row?.payload).toMatchInlineSnapshot(`
      {
        "first_comment_id": "comment-1",
        "page_id": "1111111111",
        "permalink": "/reel/2222222222/",
        "platform": "facebook",
        "promote_authorization": {
          "attempt_id": "00000000-0000-4000-8000-000000000014",
          "authorized_at": "2026-10-20T00:00:00.000Z",
          "authorized_by": "boss@example.com",
          "books_work_order_id": "c0000000-0000-4000-8000-0000000000a1",
          "books_written_at": "2026-10-20T00:00:00.000Z",
          "claimed_at": "2026-10-20T00:00:00.000Z",
          "fail_reason": undefined,
          "fingerprint": "6d85e2ad0181468e77f44fc0959b50479fa798c19930c9de67c54a6303697d53",
          "first_comment_status": "ok",
          "late_backfill": false,
          "needs_attention": false,
          "page_id": "1111111111",
          "post_publish_redline_hit": undefined,
          "promote_called_at": "2026-10-20T00:00:00.000Z",
          "published_at": "2026-10-20T00:00:00.000Z",
          "published_at_estimated": false,
          "request_id": "00000000-0000-4000-8000-000000000003",
          "status": "consumed",
          "video_id": "2222222222",
          "work_order_id": "c0000000-0000-4000-8000-0000000000a1",
        },
        "promote_preview": {
          "f632a98a3d7ca8bd": {
            "expires_at": "2026-10-20T00:05:00.000Z",
            "fingerprint": "6d85e2ad0181468e77f44fc0959b50479fa798c19930c9de67c54a6303697d53",
            "token_hash": "30abbce79cdd2c5e4e08f4f285e83be30aafe8c2289cc18d193258bc972f8a1d",
            "used": true,
            "work_order_id": "c0000000-0000-4000-8000-0000000000a1",
          },
        },
        "promote_rev": "00000000-0000-4000-8000-000000000016",
        "published_at": "2026-10-20T00:00:00.000Z",
        "published_at_estimated": false,
        "video_id": "2222222222",
        "video_state": "PUBLISHED",
        "work_order_id": "c0000000-0000-4000-8000-0000000000a1",
      }
    `)
  })
})

describe('特征化:前置检查的错误文案与顺序', () => {
  const cases: Array<[string, (x: World) => void]> = [
    ['找不到目标', (x) => { x.target = null }],
    ['非 facebook 目标', (x) => { x.target = { platform: 'instagram' as unknown as 'facebook', page_id: PAGE, expect_brand: 'Acme' } }],
    ['目标缺 page_id', (x) => { x.target = { platform: 'facebook', expect_brand: 'Acme' } }],
    ['目标缺品牌', (x) => { x.target = { platform: 'facebook', page_id: PAGE } }],
    ['工单不是 published', (x) => { x.order.status = 'approved' }],
    ['不是 DRAFT', (x) => { x.order.published_ref['video_state'] = 'SOMETHING' }],
    ['缺 master_brief_id', (x) => { x.order.master_brief_id = null }],
    ['0 条流量记录', (x) => { x.row = null }],
    ['2 条流量记录', (x) => { x.extraRows = [{ id: 'r2', client_id: CLIENT_ID, payload: {} }] }],
    ['工单与记录视频 id 不一致', (x) => { if (x.row) x.row.payload['video_id'] = '9' }],
    ['工单主页 id 与目标不一致', (x) => { x.order.published_ref['page_id'] = '9' }],
    ['记录主页 id 与目标不一致', (x) => { if (x.row) x.row.payload['page_id'] = '9' }],
    ['缺审片通过时间', (x) => { x.order.review_ref['approved_at'] = '' }],
    ['Meta 不返回 from', (x) => { x.meta.fromId = null }],
    ['视频不属本页', (x) => { x.meta.fromId = '9' }],
    ['视频已被删', (x) => { x.readError = new PromoteMetaError('video_missing', 'gone') }],
    ['读 Meta 失败', (x) => { x.readError = new Error('token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH') }],
    ['草稿文案被改', (x) => { x.meta.description = 'changed' }],
    ['草稿含红线词', (x) => { x.meta.description = `${CAPTION} badword` }],
  ]

  it('每种拒绝的状态码与文案(预览阶段)', async () => {
    const out: Record<string, unknown> = {}
    for (const [name, mutate] of cases) {
      w = makeWorld(); mutate(w); deps = makeDeps(w)
      out[name] = brief(await preview())
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "0 条流量记录": {
          "error": "找不到该工单的发布流量记录,不能转公开",
          "status": 409,
        },
        "2 条流量记录": {
          "error": "该工单有多条发布流量记录,无法确定转哪一条,不能转公开",
          "status": 409,
        },
        "Meta 不返回 from": {
          "error": "Meta 没有返回视频所属主页,保守拒绝",
          "status": 422,
        },
        "不是 DRAFT": {
          "error": "只有草稿(DRAFT)状态的 Reel 才能转公开",
          "status": 409,
        },
        "工单不是 published": {
          "error": "工单状态不是已发布,不能转公开",
          "status": 409,
        },
        "工单与记录视频 id 不一致": {
          "error": "工单与流量记录的视频 id 不一致,不能转公开",
          "status": 409,
        },
        "工单主页 id 与目标不一致": {
          "error": "工单、流量记录与发布目标的主页 id 不一致,不能转公开",
          "status": 409,
        },
        "找不到目标": {
          "error": "发布目标未配置或不是 Facebook 主页,不能转公开",
          "status": 422,
        },
        "目标缺 page_id": {
          "error": "发布目标未配置或不是 Facebook 主页,不能转公开",
          "status": 422,
        },
        "目标缺品牌": {
          "error": "防误发品牌名缺失,不能转公开",
          "status": 422,
        },
        "缺 master_brief_id": {
          "error": "工单缺少 master_brief_id,不能转公开",
          "status": 422,
        },
        "缺审片通过时间": {
          "error": "工单缺少审片通过时间,不能转公开",
          "status": 409,
        },
        "草稿含红线词": {
          "error": "草稿文案与库里的不一致,请先核对 Facebook 上的草稿",
          "status": 409,
        },
        "草稿文案被改": {
          "error": "草稿文案与库里的不一致,请先核对 Facebook 上的草稿",
          "status": 409,
        },
        "视频不属本页": {
          "error": "这条视频不属于本客户的主页,已拦截",
          "status": 409,
        },
        "视频已被删": {
          "error": "这条视频在 Facebook 上已经不存在(可能被删了)",
          "status": 404,
        },
        "记录主页 id 与目标不一致": {
          "error": "工单、流量记录与发布目标的主页 id 不一致,不能转公开",
          "status": 409,
        },
        "读 Meta 失败": {
          "error": "读取 Facebook 视频失败: token=[已隐藏]",
          "status": 502,
        },
        "非 facebook 目标": {
          "error": "发布目标未配置或不是 Facebook 主页,不能转公开",
          "status": 422,
        },
      }
    `)
  })
})

describe('特征化:补收尾分支的目标校验', () => {
  const targets: Array<[string, PublishTarget | null]> = [
    ['找不到目标', null],
    ['非 facebook', { platform: 'instagram' as unknown as 'facebook', page_id: PAGE, expect_brand: 'Acme' }],
    ['主页 id 变了', { platform: 'facebook', page_id: '9', expect_brand: 'Acme' }],
    ['缺品牌', { platform: 'facebook', page_id: PAGE }],
  ]

  it('已公开但首评失败的工单,目标不合格时的拒绝文案', async () => {
    w.commentError = new Error('boom')
    await confirm(await tokenOf())
    const out: Record<string, unknown> = {}
    for (const [name, target] of targets) {
      w.target = target
      out[name] = brief(await preview())
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "主页 id 变了": {
          "error": "发布目标缺失或与工单主页不一致,不能补做收尾",
          "status": 422,
        },
        "找不到目标": {
          "error": "发布目标缺失或与工单主页不一致,不能补做收尾",
          "status": 422,
        },
        "缺品牌": {
          "error": "发布目标缺失或与工单主页不一致,不能补做收尾",
          "status": 422,
        },
        "非 facebook": {
          "error": "发布目标缺失或与工单主页不一致,不能补做收尾",
          "status": 422,
        },
      }
    `)
  })
})

describe('特征化:多个问题同时出现时先报哪一个', () => {
  const cases: Array<[string, (x: World) => void]> = [
    ['目标缺 page_id 且缺品牌', (x) => { x.target = { platform: 'facebook' } }],
    ['目标 page_id 纯空格', (x) => { x.target = { platform: 'facebook', page_id: '   ', expect_brand: 'Acme' } }],
    ['目标不合格且工单也不是 published', (x) => { x.order.status = 'approved'; x.target = { platform: 'facebook', page_id: PAGE } }],
    ['不是 DRAFT 且缺 master_brief_id', (x) => { x.order.published_ref['video_state'] = 'X'; x.order.master_brief_id = null }],
    ['缺 master_brief_id 且 0 条流量记录', (x) => { x.order.master_brief_id = null; x.row = null }],
    ['2 条流量记录且视频 id 不一致', (x) => { x.extraRows = [{ id: 'r2', client_id: CLIENT_ID, payload: {} }]; if (x.row) x.row.payload['video_id'] = '9' }],
    ['视频 id 与主页 id 都不一致', (x) => { if (x.row) { x.row.payload['video_id'] = '9'; x.row.payload['page_id'] = '9' } }],
    ['视频 id 不一致且缺审片通过时间', (x) => { if (x.row) x.row.payload['video_id'] = '9'; x.order.review_ref['approved_at'] = '' }],
    ['主页 id 不一致且缺审片通过时间', (x) => { x.order.published_ref['page_id'] = '9'; x.order.review_ref['approved_at'] = '' }],
    ['工单与记录视频 id 都是纯空格', (x) => { x.order.published_ref['video_id'] = '  '; if (x.row) x.row.payload['video_id'] = '  ' }],
    ['工单主页 id 纯空格', (x) => { x.order.published_ref['page_id'] = '  ' }],
    ['缺审片时间且 Meta 不返回 from', (x) => { x.order.review_ref['approved_at'] = ''; x.meta.fromId = null }],
    ['Meta 不返回 from 且文案被改', (x) => { x.meta.fromId = null; x.meta.description = 'changed' }],
  ]

  it('每种组合的状态码与文案(预览阶段)', async () => {
    const out: Record<string, unknown> = {}
    for (const [name, mutate] of cases) {
      w = makeWorld(); mutate(w); deps = makeDeps(w)
      out[name] = brief(await preview())
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "2 条流量记录且视频 id 不一致": {
          "error": "该工单有多条发布流量记录,无法确定转哪一条,不能转公开",
          "status": 409,
        },
        "Meta 不返回 from 且文案被改": {
          "error": "Meta 没有返回视频所属主页,保守拒绝",
          "status": 422,
        },
        "不是 DRAFT 且缺 master_brief_id": {
          "error": "只有草稿(DRAFT)状态的 Reel 才能转公开",
          "status": 409,
        },
        "主页 id 不一致且缺审片通过时间": {
          "error": "工单、流量记录与发布目标的主页 id 不一致,不能转公开",
          "status": 409,
        },
        "工单与记录视频 id 都是纯空格": {
          "error": "工单与流量记录的视频 id 不一致,不能转公开",
          "status": 409,
        },
        "工单主页 id 纯空格": {
          "error": "工单、流量记录与发布目标的主页 id 不一致,不能转公开",
          "status": 409,
        },
        "目标 page_id 纯空格": {
          "error": "发布目标未配置或不是 Facebook 主页,不能转公开",
          "status": 422,
        },
        "目标不合格且工单也不是 published": {
          "error": "防误发品牌名缺失,不能转公开",
          "status": 422,
        },
        "目标缺 page_id 且缺品牌": {
          "error": "发布目标未配置或不是 Facebook 主页,不能转公开",
          "status": 422,
        },
        "缺 master_brief_id 且 0 条流量记录": {
          "error": "工单缺少 master_brief_id,不能转公开",
          "status": 422,
        },
        "缺审片时间且 Meta 不返回 from": {
          "error": "工单缺少审片通过时间,不能转公开",
          "status": 409,
        },
        "视频 id 不一致且缺审片通过时间": {
          "error": "工单与流量记录的视频 id 不一致,不能转公开",
          "status": 409,
        },
        "视频 id 与主页 id 都不一致": {
          "error": "工单与流量记录的视频 id 不一致,不能转公开",
          "status": 409,
        },
      }
    `)
  })
})

describe('特征化:视频已被人手公开(sync_only)', () => {
  it('预览与确认后的最终内容、调用顺序', async () => {
    w.meta.published = true
    const p = await preview()
    expect(p).toMatchInlineSnapshot(`
      {
        "data": {
          "caption": "Great Acme tour deal⁣​‌",
          "checklist_passed_at": "2026-10-19T01:00:00.000Z",
          "expires_at": "2026-10-20T00:05:00.000Z",
          "first_comment": "Book now
      https://example.com/tour?utm_source=facebook&utm_medium=organic_social&utm_campaign=me_factory_reel&utm_content=c0000000-0000-4000-8000-0000000000a1",
          "mode": "sync_only",
          "page_id": "1111111111",
          "preview_token": "tok-1",
          "video_id": "2222222222",
        },
        "kind": "preview",
        "ok": true,
      }
    `)
    w.log.length = 0
    const r = await confirm(p.ok && p.kind === 'preview' ? p.data.preview_token : undefined)
    expect(r).toMatchInlineSnapshot(`
      {
        "data": {
          "first_comment_status": "ok",
          "permalink": "/reel/2222222222/",
          "published_at": "2026-10-19T12:00:00.000Z",
          "published_at_estimated": true,
          "request_id": "00000000-0000-4000-8000-000000000003",
          "video_id": "2222222222",
        },
        "kind": "synced",
        "ok": true,
      }
    `)
    expect(w.log).toMatchInlineSnapshot(`
      [
        "meta.read",
        "store.traffic",
        "store.traffic",
        "store.order",
        "store.traffic",
        "books.item",
        "books.log",
        "store.traffic",
        "redline",
        "meta.comment",
        "meta.read",
        "redline",
        "store.traffic",
      ]
    `)
    expect(w.order.published_ref).toMatchInlineSnapshot(`
      {
        "ig_crosspost_blocked": true,
        "page_id": "1111111111",
        "permalink": "/reel/2222222222/",
        "platform": "facebook",
        "promote_request_id": "00000000-0000-4000-8000-000000000003",
        "published_at": "2026-10-19T12:00:00.000Z",
        "published_at_estimated": true,
        "video_id": "2222222222",
        "video_state": "PUBLISHED",
      }
    `)
    expect(w.row?.payload['promote_authorization']).toMatchInlineSnapshot(`
      {
        "attempt_id": "00000000-0000-4000-8000-000000000003",
        "authorized_at": "2026-10-20T00:00:00.000Z",
        "authorized_by": "boss@example.com",
        "books_work_order_id": "c0000000-0000-4000-8000-0000000000a1",
        "books_written_at": "2026-10-20T00:00:00.000Z",
        "claimed_at": "2026-10-20T00:00:00.000Z",
        "fail_reason": undefined,
        "fingerprint": "220670c469715419890cf75bf7fd15a5ea7eac269dfa4b9a01ec27728d309977",
        "first_comment_status": "ok",
        "late_backfill": true,
        "needs_attention": false,
        "page_id": "1111111111",
        "post_publish_redline_hit": undefined,
        "promote_called_at": undefined,
        "published_at": "2026-10-19T12:00:00.000Z",
        "published_at_estimated": true,
        "request_id": "00000000-0000-4000-8000-000000000003",
        "status": "consumed",
        "video_id": "2222222222",
        "work_order_id": "c0000000-0000-4000-8000-0000000000a1",
      }
    `)
  })
})

describe('特征化:写工单时发生冲突后的重试', () => {
  it('第一次写工单被抢先改了:重试后平台标记仍在,最终内容不变', async () => {
    w.orderWriteFails = 1
    const r = await confirm(await tokenOf())
    expect(r).toMatchInlineSnapshot(`
      {
        "data": {
          "first_comment_status": "ok",
          "permalink": "/reel/2222222222/",
          "published_at": "2026-10-20T00:00:00.000Z",
          "published_at_estimated": false,
          "request_id": "00000000-0000-4000-8000-000000000003",
          "video_id": "2222222222",
        },
        "kind": "promoted",
        "ok": true,
      }
    `)
    expect(w.log).toMatchInlineSnapshot(`
      [
        "meta.read",
        "redline",
        "store.traffic",
        "meta.read",
        "redline",
        "store.traffic",
        "store.traffic",
        "meta.promote",
        "store.traffic",
        "store.order.conflict",
        "store.order",
        "store.traffic",
        "books.item",
        "books.log",
        "store.traffic",
        "redline",
        "meta.comment",
        "meta.read",
        "redline",
        "store.traffic",
      ]
    `)
    expect(w.order.published_ref).toMatchInlineSnapshot(`
      {
        "ig_crosspost_blocked": true,
        "page_id": "1111111111",
        "permalink": "/reel/2222222222/",
        "platform": "facebook",
        "promote_request_id": "00000000-0000-4000-8000-000000000003",
        "published_at": "2026-10-20T00:00:00.000Z",
        "video_id": "2222222222",
        "video_state": "PUBLISHED",
      }
    `)
  })
})

describe('特征化:补首评分支不改工单上的平台标记', () => {
  it('补首评前后 published_ref 除「首评待补」外一致', async () => {
    w.commentError = new Error('boom')
    await confirm(await tokenOf())
    const before = structuredClone(w.order.published_ref)
    w.commentError = null
    await confirm(await tokenOf())
    const after = structuredClone(w.order.published_ref)
    const { first_comment_pending: pendingBefore, ...beforeRest } = before
    expect(pendingBefore).toBe(true)
    expect(after).not.toHaveProperty('first_comment_pending')
    expect(after).toEqual(beforeRest)
    expect(after['ig_crosspost_blocked']).toBe(true)
  })
})
