import { describe, expect, it } from 'vitest'
import {
  GATE_IMPACT,
  TRACKING_PREFLIGHT_JOB,
  TRACKING_RECEIPT_STALE_HOURS,
  buildClientReceipt,
  buildReceiptItems,
  buildRunReceipt,
  isTrackingRunReceiptLike,
  pickLatestClientReceipt,
  receiptAgeHours,
} from '../receipt'
import { GATE_LABELS } from '../judge'
import {
  HARD_GATE,
  POST_GATE_KEYS,
  PREFLIGHT_GATE_KEYS,
  type TrackingClientReceipt,
  type TrackingGateKey,
  type TrackingGateReceipt,
  type TrackingRunReceipt,
} from '../types'

const NOW = new Date('2026-10-19T10:30:00.000Z')
const LINKS = { fallback: 'https://app.example.test/plan', byGate: { 'tracking.pixel_alive': 'https://events.example.test/ds' } as const }

function gate(key: TrackingGateKey, status: TrackingGateReceipt['status'], over: Partial<TrackingGateReceipt> = {}): TrackingGateReceipt {
  return { key, status, reason: `原因-${key}`, how: `怎么办-${key}`, evidence: {}, as_of: NOW.toISOString(), hard: HARD_GATE[key], ...over }
}

function clientReceipt(clientId: string, over: Partial<TrackingClientReceipt> = {}): TrackingClientReceipt {
  const built = buildClientReceipt({
    requestId: `req-${clientId}`, clientId, checkedAt: NOW.toISOString(), trigger: 'cron', phase: 'preflight',
    gates: [gate('tracking.pixel_alive', 'green')], readErrors: [], links: LINKS,
  })
  return { ...built, ...over }
}

describe('常量', () => {
  it('回执任务名和过期时限', () => {
    expect(TRACKING_PREFLIGHT_JOB).toBe('ads-tracking-preflight')
    expect(TRACKING_RECEIPT_STALE_HOURS).toBe(36)
  })

  it('每道门都有一句「不处理会怎样」', () => {
    for (const key of [...PREFLIGHT_GATE_KEYS, ...POST_GATE_KEYS]) {
      expect(GATE_IMPACT[key].length).toBeGreaterThan(0)
    }
  })
})

describe('buildReceiptItems · 红灯变待办三件套（问题和影响 / 怎么做 / 直达链接）', () => {
  it('绿灯、黄灯不出待办', () => {
    const items = buildReceiptItems('c1', [gate('tracking.pixel_alive', 'green'), gate('tracking.landing_ok', 'yellow')], LINKS)
    expect(items).toEqual([])
  })

  it('硬门红灯 → 一条待办：说清问题和影响、怎么做、直达链接', () => {
    const [item] = buildReceiptItems('c1', [gate('tracking.pixel_alive', 'red')], LINKS)
    expect(item).toMatchObject({
      client_id: 'c1', gate_key: 'tracking.pixel_alive', hard: true,
      how: '怎么办-tracking.pixel_alive', href: 'https://events.example.test/ds',
    })
    expect(item.what).toContain(GATE_LABELS['tracking.pixel_alive'])
    expect(item.what).toContain('原因-tracking.pixel_alive')
    expect(item.what).toContain(GATE_IMPACT['tracking.pixel_alive'])
  })

  it('没有专属链接的门用兜底链接', () => {
    const [item] = buildReceiptItems('c1', [gate('tracking.landing_ok', 'red')], LINKS)
    expect(item.href).toBe('https://app.example.test/plan')
  })

  it('硬门灰灯也出待办（没证据不等于没事）；软门灰灯不出；软门红灯出', () => {
    const items = buildReceiptItems('c1', [
      gate('tracking.pixel_alive', 'gray'),
      gate('tracking.ga4_events', 'gray'),
      gate('tracking.capi_ready', 'red'),
    ], LINKS)
    expect(items.map(i => i.gate_key)).toEqual(['tracking.pixel_alive', 'tracking.capi_ready'])
    expect(items.map(i => i.hard)).toEqual([true, false])
  })

  it('不适用的门不出待办', () => {
    const items = buildReceiptItems('c1', [gate('tracking.lead_reaches_crm', 'gray', { na: true, hard: false })], LINKS)
    expect(items).toEqual([])
  })

  it('「不适用」的门不管灯是什么都不出待办（防御：哪怕有人把它标成红）', () => {
    const items = buildReceiptItems('c1', [gate('tracking.lead_reaches_crm', 'red', { na: true, hard: false })], LINKS)
    expect(items).toEqual([])
  })

  it('门自己没给「怎么办」时用兜底说法，三件套不缺项', () => {
    const [item] = buildReceiptItems('c1', [gate('tracking.pixel_alive', 'red', { how: '' })], LINKS)
    expect(item.how.length).toBeGreaterThan(0)
  })

  it('开投后读回的红灯也出待办；过长的说明截断', () => {
    const [item] = buildReceiptItems('c1', [gate('post.t24h', 'red', { reason: '很长'.repeat(300) })], LINKS)
    expect(item.gate_key).toBe('post.t24h')
    expect(item.what.length).toBeLessThanOrEqual(300)
  })
})

describe('buildClientReceipt', () => {
  it('总灯取最差、前置条件看硬门、带上待办和读取错误，no_publish 恒为 true', () => {
    const receipt = buildClientReceipt({
      requestId: 'r1', clientId: 'c1', checkedAt: NOW.toISOString(), trigger: 'requested', phase: 'preflight',
      gates: [gate('tracking.pixel_alive', 'red'), gate('tracking.ga4_events', 'yellow')],
      readErrors: [{ source: 'ga4', error: '没读到' }], links: LINKS,
    })
    expect(receipt).toMatchObject({
      request_id: 'r1', client_id: 'c1', checked_at: NOW.toISOString(), trigger: 'requested', phase: 'preflight',
      overall: 'red', preconditions_met: false, no_publish: true,
      read_errors: [{ source: 'ga4', error: '没读到' }],
    })
    expect(receipt.gates).toHaveLength(2)
    expect(receipt.items.map(i => i.gate_key)).toEqual(['tracking.pixel_alive'])
  })

  it('开投后读回的回执带开投时刻（launched_at），开投前的回执这一项是 null', () => {
    const base = {
      requestId: 'r1', clientId: 'c1', checkedAt: NOW.toISOString(), trigger: 'postlaunch' as const, phase: 'post_t1h' as const,
      gates: [gate('post.t1h', 'green')], readErrors: [], links: LINKS,
    }
    expect(buildClientReceipt({ ...base, launchedAt: '2026-10-19T09:00:00.000Z' }).launched_at).toBe('2026-10-19T09:00:00.000Z')
    expect(buildClientReceipt(base).launched_at).toBeNull()
    expect(clientReceipt('c1').launched_at).toBeNull()
  })

  it('全绿 → overall green、前置条件满足、没有待办', () => {
    const receipt = clientReceipt('c1')
    expect(receipt.overall).toBe('green')
    expect(receipt.preconditions_met).toBe(true)
    expect(receipt.items).toEqual([])
  })
})

describe('buildRunReceipt', () => {
  it('所有客户都读完 → ok，error 为空', () => {
    const run = buildRunReceipt({ requestId: 'run1', checkedAt: NOW.toISOString(), trigger: 'cron', clients: [clientReceipt('c1')] })
    expect(run).toMatchObject({ request_id: 'run1', status: 'ok', error: null, no_publish: true, trigger: 'cron' })
    expect(run.clients).toHaveLength(1)
  })

  it('有客户读取出过错 → partial，并写明几个', () => {
    const withError = clientReceipt('c2', { read_errors: [{ source: 'meta', error: 'x' }] })
    const run = buildRunReceipt({ requestId: 'run1', checkedAt: NOW.toISOString(), trigger: 'cron', clients: [clientReceipt('c1'), withError] })
    expect(run.status).toBe('partial')
    expect(run.error).toContain('1')
  })

  it('一个配置了追踪检查的客户都没有 → not_configured，写明原因', () => {
    const run = buildRunReceipt({ requestId: 'run1', checkedAt: NOW.toISOString(), trigger: 'cron', clients: [] })
    expect(run.status).toBe('not_configured')
    expect(run.error).toContain('配置')
  })
})

describe('isTrackingRunReceiptLike · 运行时校验（读回执的人不信数据库里的 JSON）', () => {
  const good = (): TrackingRunReceipt => buildRunReceipt({
    requestId: 'run1', checkedAt: NOW.toISOString(), trigger: 'cron',
    clients: [buildClientReceipt({
      requestId: 'r1', clientId: 'c1', checkedAt: NOW.toISOString(), trigger: 'cron', phase: 'preflight',
      gates: [gate('tracking.pixel_alive', 'red')], readErrors: [], links: LINKS,
    })],
  })

  it('合格的回执通过', () => {
    expect(isTrackingRunReceiptLike(good())).toBe(true)
    expect(isTrackingRunReceiptLike(JSON.parse(JSON.stringify(good())))).toBe(true)
  })

  it('不是对象 / 缺字段 / 类型不对都不通过', () => {
    for (const bad of [null, 'x', 42, [], {}, { ...good(), request_id: 1 }, { ...good(), clients: 'no' }, { ...good(), status: 'weird' }]) {
      expect(isTrackingRunReceiptLike(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('某个客户的门或待办长得不对 → 不通过', () => {
    const a = good()
    const brokenGate = { ...a, clients: [{ ...a.clients[0], gates: [{ key: 'tracking.pixel_alive', status: 'purple', hard: true }] }] }
    expect(isTrackingRunReceiptLike(brokenGate)).toBe(false)
    const brokenItem = { ...a, clients: [{ ...a.clients[0], items: [{ gate_key: 'tracking.pixel_alive', what: 1 }] }] }
    expect(isTrackingRunReceiptLike(brokenItem)).toBe(false)
  })
})

describe('pickLatestClientReceipt', () => {
  const run = (clients: TrackingClientReceipt[], startedAt: string, status: string | null = 'completed') => ({
    status, started_at: startedAt,
    summary: buildRunReceipt({ requestId: `run-${startedAt}`, checkedAt: startedAt, trigger: 'cron', clients }),
  })

  it('取最新一份含该客户的回执，并带上那一轮的开始时间', () => {
    const rows = [
      run([clientReceipt('c1', { request_id: 'new' })], '2026-10-19T07:00:00Z'),
      run([clientReceipt('c1', { request_id: 'old' })], '2026-10-18T07:00:00Z'),
    ]
    const picked = pickLatestClientReceipt(rows, 'c1')
    expect(picked?.receipt.request_id).toBe('new')
    expect(picked?.started_at).toBe('2026-10-19T07:00:00Z')
  })

  it('更新的一轮只查了别的客户，不能盖住这个客户更早的回执', () => {
    const rows = [
      run([clientReceipt('c2')], '2026-10-19T07:00:00Z'),
      run([clientReceipt('c1', { request_id: 'mine' })], '2026-10-18T07:00:00Z'),
    ]
    expect(pickLatestClientReceipt(rows, 'c1')?.receipt.request_id).toBe('mine')
  })

  it('跳过还在跑的、读不懂的；全都没有 → null', () => {
    const rows = [
      run([clientReceipt('c1', { request_id: 'running-one' })], '2026-10-19T07:00:00Z', 'running'),
      { status: 'completed', started_at: '2026-10-18T07:00:00Z', summary: { nonsense: true } },
      { status: 'completed', started_at: '2026-10-17T07:00:00Z', summary: null },
    ]
    expect(pickLatestClientReceipt(rows, 'c1')).toBeNull()
    expect(pickLatestClientReceipt([], 'c1')).toBeNull()
  })

  // 🔴 审查整改（子牙 + 魏征都抓到）：开投后读回的回执和开投前体检写在同一个任务名下。
  //    不挑阶段的话，开投后读回会把早上的红灯待办顶掉、看板十道门全灰、36 小时判据被读回刷新。
  it('开投后读回的回执不算「开投前回执」：混在最新位置时，仍取更早的那份开投前回执', () => {
    const rows = [
      run([clientReceipt('c1', { request_id: 'post', phase: 'post_t1h', trigger: 'postlaunch' })], '2026-10-19T09:30:00Z'),
      run([clientReceipt('c1', { request_id: 'pre' })], '2026-10-19T07:00:00Z'),
    ]
    const picked = pickLatestClientReceipt(rows, 'c1')
    expect(picked?.receipt.request_id).toBe('pre')
    expect(picked?.started_at).toBe('2026-10-19T07:00:00Z')
  })

  it('只有开投后读回的回执（t1h / t24h）→ null，它不是开投前的体检，不能拿来代替', () => {
    const rows = [
      run([clientReceipt('c1', { phase: 'post_t24h', trigger: 'postlaunch' })], '2026-10-20T09:30:00Z'),
      run([clientReceipt('c1', { phase: 'post_t1h', trigger: 'postlaunch' })], '2026-10-19T09:30:00Z'),
    ]
    expect(pickLatestClientReceipt(rows, 'c1')).toBeNull()
  })
})

describe('receiptAgeHours', () => {
  it('算出回执已经多少小时；时间读不懂 → null', () => {
    expect(receiptAgeHours('2026-10-18T22:30:00.000Z', NOW)).toBe(12)
    expect(receiptAgeHours('garbage', NOW)).toBeNull()
  })
})
