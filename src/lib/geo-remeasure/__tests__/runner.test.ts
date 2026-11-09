/**
 * #1347 · 切片 3a · runner 状态机 + fail-closed 边界。
 * 用假 GeoBudgetStore（内存两表 + 幂等） + 手写 runBatch 覆盖所有分支。
 */
import { describe, it, expect, vi } from 'vitest'
import { authorizeMeasureSettle, sanitizeErrorMessage, type RemeasureBatchResult } from '../runner'
import { FakeGeoBudgetStore } from './fake-budget-store'
import type { GeoBudgetStore, GeoBudgetReserveResult, GeoBudgetSettleResult } from '../budget-ledger'

/** 假 store：reserve 通过、settle 强制返回 {settled:false, reason} —— 用于锁 settle_failed 分支（魏征 S2）。 */
class SettleFailingStore implements GeoBudgetStore {
  async reserve(): Promise<GeoBudgetReserveResult> { return { reserved: true, remainingUsd: 1 } }
  async settle(): Promise<GeoBudgetSettleResult> { return { settled: false, reason: 'no_reservation' } }
}

const CTS = 'c0000000-0000-0000-0000-000000000000'
const P = '2026-09'

function ok(actualUsd: number, batchId = 'batch-1', status = 'completed'): RemeasureBatchResult {
  return { actualUsd, batchId, status }
}

describe('authorizeMeasureSettle — 状态机', () => {
  it('账本无预算行 → blocked，绝不调 runBatch', async () => {
    const budget = new FakeGeoBudgetStore()
    const runBatch = vi.fn(async () => ok(0.5))
    const r = await authorizeMeasureSettle(
      { reservationId: 'r1', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 },
      budget,
      runBatch,
    )
    expect(r.kind).toBe('blocked')
    if (r.kind === 'blocked') expect(r.reason).toBe('no_budget_row')
    expect(runBatch).not.toHaveBeenCalled()
  })

  it('账本额度不足 → blocked，绝不调 runBatch', async () => {
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, P, 0.5)
    const runBatch = vi.fn(async () => ok(0.1))
    const r = await authorizeMeasureSettle(
      { reservationId: 'r2', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 },
      budget,
      runBatch,
    )
    expect(r.kind).toBe('blocked')
    if (r.kind === 'blocked') expect(r.reason).toBe('insufficient')
    expect(runBatch).not.toHaveBeenCalled()
  })

  it('已结算的预留身份 → blocked（Codex P2）：不放行下游、不重跑', async () => {
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, P, 5)
    // 提前建一笔已结算的预留
    await budget.reserve('r3', CTS, P, 1.8)
    await budget.settle('r3', 0.6)
    const runBatch = vi.fn(async () => ok(0.5))
    const r = await authorizeMeasureSettle(
      { reservationId: 'r3', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 },
      budget,
      runBatch,
    )
    expect(r.kind).toBe('blocked')
    if (r.kind === 'blocked') expect(r.reason).toBe('already_settled')
    expect(runBatch).not.toHaveBeenCalled()
  })

  it('正常路径：授权 → runBatch → settle 实付 → completed（额度按实付扣）', async () => {
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, P, 5)
    const r = await authorizeMeasureSettle(
      { reservationId: 'r4', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 },
      budget,
      async () => ok(0.63, 'batch-77124a10', 'completed'),
    )
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') {
      expect(r.batchId).toBe('batch-77124a10')
      expect(r.status).toBe('completed')
      expect(r.chargedUsd).toBeCloseTo(0.63)
      expect(r.reservationId).toBe('r4')
    }
    const snap = budget.snapshot(CTS, P)!
    expect(snap.reserved).toBe(0) // 预留已挪走
    expect(snap.spent).toBeCloseTo(0.63)
  })

  it('runBatch 抛异常 → batch_failed，尝试 settle 0 释放预留，且如实报告释放结果', async () => {
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, P, 5)
    const r = await authorizeMeasureSettle(
      { reservationId: 'r5', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 },
      budget,
      async () => { throw new Error('provider timeout') },
    )
    expect(r.kind).toBe('batch_failed')
    if (r.kind === 'batch_failed') {
      expect(r.reason).toContain('provider timeout')
      expect(r.settleReleased).toBe(true)
    }
    const snap = budget.snapshot(CTS, P)!
    expect(snap.reserved).toBe(0) // 预留已释放
    expect(snap.spent).toBe(0)    // 没扣钱
  })

  it('runBatch 返回 NaN / 负数 actualUsd → 用 worstCase 保守扣（宁多不少）', async () => {
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, P, 5)
    const r = await authorizeMeasureSettle(
      { reservationId: 'r6', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 },
      budget,
      async () => ok(NaN, 'batch-x', 'partial'),
    )
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') expect(r.chargedUsd).toBeCloseTo(1.8)
    expect(budget.snapshot(CTS, P)!.spent).toBeCloseTo(1.8)
  })

  it('runBatch 返回超过预留上界 → 扣款封顶在 worstCaseUsd（账本侧的最终防线）', async () => {
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, P, 5)
    const r = await authorizeMeasureSettle(
      { reservationId: 'r7', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 },
      budget,
      async () => ok(999, 'batch-x', 'completed'),
    )
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') expect(r.chargedUsd).toBe(1.8)
  })
})

describe('authorizeMeasureSettle — settle_failed 分支（魏征 S2）', () => {
  it('settle 返回 {settled:false} → kind=settle_failed，透传 reason，不当作 completed', async () => {
    const CTS = 'c0000000-0000-0000-0000-000000000000'
    const P = '2026-09'
    const r = await authorizeMeasureSettle(
      { reservationId: 'sf-1', clientId: CTS, periodKey: P, worstCaseUsd: 1.0 },
      new SettleFailingStore(),
      async () => ({ actualUsd: 0.5, batchId: 'batch-sf', status: 'completed' }),
    )
    expect(r.kind).toBe('settle_failed')
    if (r.kind === 'settle_failed') {
      expect(r.reason).toBe('no_reservation')
      expect(r.batchId).toBe('batch-sf')
      expect(r.status).toBe('completed')
    }
  })
})

describe('sanitizeErrorMessage — 3b provider secret 脱敏（狄仁杰 §C）', () => {
  it('剔除 sk- 开头的 API key', () => {
    expect(sanitizeErrorMessage(new Error('OpenAI failed with sk-proj-abcdef123456'))).toContain('sk-***')
    expect(sanitizeErrorMessage(new Error('sk-proj-abcdef123456'))).not.toContain('proj-abcdef')
  })
  it('剔除 Bearer token', () => {
    const out = sanitizeErrorMessage(new Error('Auth failed: Bearer eyJraWQiOiIxMjMifQ.foo.bar'))
    expect(out).toContain('Bearer ***')
    expect(out).not.toContain('kIiOiIx')
  })
  it('剔除 JWT-like (eyJ...)', () => {
    const out = sanitizeErrorMessage(new Error('bad token eyJhbGciOiJIUzI1NiJ9.abc.def'))
    expect(out).toContain('eyJ***')
  })
  it('剔除长 hex 串（可能是 hash / private key 片段）', () => {
    const hex = 'a'.repeat(40)
    expect(sanitizeErrorMessage(new Error('key: ' + hex))).toContain('***hex***')
  })
  it('截断到 200 字符', () => {
    const long = 'x'.repeat(500)
    const out = sanitizeErrorMessage(new Error(long))
    expect(out.length).toBeLessThanOrEqual(201)
  })
  it('空字符串 → unknown_error', () => {
    expect(sanitizeErrorMessage('')).toBe('unknown_error')
  })
  it('非 Error → 强制转字符串', () => {
    expect(sanitizeErrorMessage({ foo: 'bar' })).toBe('[object Object]')
  })
  it('batch_failed 用脱敏：runner 抛"sk-XXX"错误后 reason 不含原 key', async () => {
    const CTS = 'c0000000-0000-0000-0000-000000000000'
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, '2026-09', 5)
    const r = await authorizeMeasureSettle(
      { reservationId: 'san-1', clientId: CTS, periodKey: '2026-09', worstCaseUsd: 1 },
      budget,
      async () => { throw new Error('provider hit: sk-liveXXXXXXX12345 rejected') },
    )
    expect(r.kind).toBe('batch_failed')
    if (r.kind === 'batch_failed') {
      expect(r.reason).not.toContain('sk-liveXXXXXXX12345')
      expect(r.reason).toContain('sk-***')
    }
  })
})

describe('authorizeMeasureSettle — 幂等（Inngest 会重试）', () => {
  it('同一 reservationId 在结算完成后再走一次 → blocked already_settled，不重跑', async () => {
    const budget = new FakeGeoBudgetStore(); budget.setCap(CTS, P, 5)
    const req = { reservationId: 'r8', clientId: CTS, periodKey: P, worstCaseUsd: 1.8 }
    const first = await authorizeMeasureSettle(req, budget, async () => ok(0.6))
    expect(first.kind).toBe('completed')

    const runBatch = vi.fn(async () => ok(0.6))
    const replay = await authorizeMeasureSettle(req, budget, runBatch)
    expect(replay.kind).toBe('blocked')
    if (replay.kind === 'blocked') expect(replay.reason).toBe('already_settled')
    expect(runBatch).not.toHaveBeenCalled() // 关键：不重跑，不重复花钱
    expect(budget.snapshot(CTS, P)!.spent).toBeCloseTo(0.6) // 账本只记一次
  })
})
