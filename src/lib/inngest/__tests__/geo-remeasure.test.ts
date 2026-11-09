/**
 * #1347 · 切片 3a · Inngest 消费者契约与骨架行为。
 * 覆盖：payload fail-closed / 命名空间隔离 / stub 不花钱 / 依赖注入版走 runner 状态机。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  parseRemeasureDue,
  runBatchStub,
  createGeoRemeasureOneFunction,
  GEO_REMEASURE_DUE_EVENT,
} from '../functions/geo-remeasure'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import { FakeGeoBudgetStore } from '@/lib/geo-remeasure/__tests__/fake-budget-store'
import { authorizeMeasureSettle } from '@/lib/geo-remeasure/runner'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const P = '2026-09'

describe('parseRemeasureDue — payload fail-closed', () => {
  const good = {
    client_id: CTS, query_set_version: 'cts_geo_baseline_v1',
    reservation_id: 'r1', period_key: P, worst_case_usd: 1.8,
  }
  it('合法 payload → ok', () => {
    expect(parseRemeasureDue(good)).toEqual({ ok: true, value: good })
  })
  it.each([
    ['非对象', null, 'payload_not_object'],
    ['非对象-string', 'x', 'payload_not_object'],
    ['缺 client_id', { ...good, client_id: undefined }, 'invalid_client_id'],
    ['client_id 不是 uuid', { ...good, client_id: 'not-a-uuid' }, 'invalid_client_id'],
    ['空 query_set_version', { ...good, query_set_version: '' }, 'invalid_query_set_version'],
    ['空 reservation_id', { ...good, reservation_id: '' }, 'invalid_reservation_id'],
    ['period_key 格式错', { ...good, period_key: '2026/09' }, 'invalid_period_key'],
    ['period_key 空', { ...good, period_key: '' }, 'invalid_period_key'],
    ['period_key 月份 00', { ...good, period_key: '2026-00' }, 'invalid_period_key'],  // S1 魏征
    ['period_key 月份 13', { ...good, period_key: '2026-13' }, 'invalid_period_key'],  // S1 魏征
    ['period_key 月份 99', { ...good, period_key: '9999-99' }, 'invalid_period_key'],  // 狄仁杰 §A
    ['reservation_id 10MB 攻击', { ...good, reservation_id: 'x'.repeat(200000) }, 'invalid_reservation_id'],  // 狄仁杰 §A
    ['query_set_version 10MB 攻击', { ...good, query_set_version: 'y'.repeat(200000) }, 'invalid_query_set_version'],  // 狄仁杰 §A
    ['worst_case 是字符串', { ...good, worst_case_usd: '1.8' }, 'invalid_worst_case_usd'],
    ['worst_case NaN', { ...good, worst_case_usd: NaN }, 'invalid_worst_case_usd'],
    ['worst_case 0', { ...good, worst_case_usd: 0 }, 'invalid_worst_case_usd'],
    ['worst_case 负', { ...good, worst_case_usd: -1 }, 'invalid_worst_case_usd'],
    ['worst_case Infinity', { ...good, worst_case_usd: Infinity }, 'invalid_worst_case_usd'],
  ])('拒 %s', (_, bad, expectedReason) => {
    const r = parseRemeasureDue(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe(expectedReason)
  })
})

describe('云端函数登记（一事件一主 + cloud- 前缀）', () => {
  it('geoRemeasureOne 已登记到 cloudFunctions，id 以 cloud- 开头', () => {
    const ids = cloudFunctions.map((f) => f.id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}geo-remeasure-one`)
    for (const id of ids) expect(id.startsWith(CLOUD_FN_PREFIX)).toBe(true)
  })
  it('GEO_REMEASURE_DUE_EVENT 不与本机 worker 事件撞名（防云端 + 本机双消费）', () => {
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(GEO_REMEASURE_DUE_EVENT)
    expect(GEO_REMEASURE_DUE_EVENT).toBe('geo/remeasure.due')
  })
})

describe('runBatchStub — 3a 骨架：绝不花钱', () => {
  it('stub 一律抛 not_implemented，运行方永远走 batch_failed 分支', async () => {
    await expect(runBatchStub()).rejects.toThrow(/geo_remeasure_not_implemented/)
  })

  it('用 stub 装配的 runner 走完整流程：authorize → stub 抛 → batch_failed + 释放预留', async () => {
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, P, 5)
    const r = await authorizeMeasureSettle(
      { reservationId: 'stub-1', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 },
      budget,
      runBatchStub,
    )
    expect(r.kind).toBe('batch_failed')
    if (r.kind === 'batch_failed') expect(r.settleReleased).toBe(true)
    const snap = budget.snapshot(CTS, P)!
    expect(snap.reserved).toBe(0) // 预留完整释放
    expect(snap.spent).toBe(0)    // 一分钱没扣
  })
})

describe('createGeoRemeasureOneFunction — 依赖注入版契约', () => {
  it('注册出的函数 id 与生产实例一致（cloud-geo-remeasure-one）', () => {
    const fn = createGeoRemeasureOneFunction({
      budget: new FakeGeoBudgetStore(),
      runBatch: async () => ({ actualUsd: 0, batchId: null, status: 'noop' }),
    })
    expect(fn.id()).toBe(`${CLOUD_FN_PREFIX}geo-remeasure-one`)
  })
  it('注入的 runBatch 只在 authorize 成功后被调用（无预算 → 不调）', async () => {
    const budget = new FakeGeoBudgetStore() // 空账本
    const runBatch = vi.fn(async () => ({ actualUsd: 1, batchId: 'b', status: 'completed' }))
    const outcome = await authorizeMeasureSettle(
      { reservationId: 'inj-1', clientId: CTS, periodKey: P, worstCaseUsd: 1 },
      budget,
      runBatch,
    )
    expect(outcome.kind).toBe('blocked')
    expect(runBatch).not.toHaveBeenCalled()
  })
})
