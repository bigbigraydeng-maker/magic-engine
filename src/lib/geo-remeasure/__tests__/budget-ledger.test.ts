/**
 * #1347 · GEO 预算账本应用层判据：fail-closed + 不双花 + 幂等（三审必改）+ budgetUsd 唯一来源。
 * 🔴 SQL 层原子/并发行为另由 scripts/geo-budget-ledger-check.sh 在真 postgres 断言。
 */
import { describe, it, expect } from 'vitest'
import { resolveClientGeoBudget, geoBudgetPeriodKey } from '../budget-ledger'
import { FakeGeoBudgetStore } from './fake-budget-store'

const C = 'c0000000-0000-0000-0000-000000000000'
const P = '2026-09'
const rid = (s: string) => `batch-${s}`

describe('resolveClientGeoBudget — fail-closed', () => {
  it('没有预算行 → 不授权（no_budget_row）', async () => {
    const s = new FakeGeoBudgetStore()
    const r = await resolveClientGeoBudget(s, { reservationId: rid('1'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(false); if (!r.authorized) expect(r.reason).toBe('no_budget_row')
  })
  it('缺 reservationId → 不授权，不碰 store', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 100)
    const r = await resolveClientGeoBudget(s, { reservationId: '', clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(false); if (!r.authorized) expect(r.reason).toBe('invalid_reservation_id')
    expect(s.snapshot(C, P)).toEqual({ cap: 100, reserved: 0, spent: 0 })
  })
  it('worstCase 非正/NaN/Inf → 不授权', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 100)
    for (const bad of [0, -1, NaN, Infinity]) {
      const r = await resolveClientGeoBudget(s, { reservationId: rid(String(bad)), clientId: C, periodKey: P, worstCaseUsd: bad })
      expect(r.authorized).toBe(false)
    }
    expect(s.snapshot(C, P)!.reserved).toBe(0)
  })
})

describe('授权额度 = 预留额度', () => {
  it('额度足 → budgetUsd 恰等于 worstCase，reservationId 回传', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    const r = await resolveClientGeoBudget(s, { reservationId: rid('x'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(true)
    if (r.authorized) { expect(r.budgetUsd).toBe(1.8); expect(r.reservationId).toBe(rid('x')) }
    expect(s.snapshot(C, P)).toEqual({ cap: 5, reserved: 1.8, spent: 0 })
  })
})

describe('不双花（魏征 #1）', () => {
  it('额度只够一次时，两个不同批次只有一个成功', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 2)
    const a = await resolveClientGeoBudget(s, { reservationId: rid('a'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const b = await resolveClientGeoBudget(s, { reservationId: rid('b'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect([a, b].filter((x) => x.authorized).length).toBe(1)
    expect(s.snapshot(C, P)!.reserved).toBe(1.8)
  })
})

describe('幂等（三审必改：Inngest 会重试）', () => {
  it('同一 reservationId 重复 reserve → 只累加一次', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: rid('same'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const again = await resolveClientGeoBudget(s, { reservationId: rid('same'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(again.authorized).toBe(true)
    expect(s.snapshot(C, P)!.reserved).toBe(1.8) // 不是 3.6
  })
  it('重复 settle 同一批次 → 花费只记一次（魏征实测 0.63→1.26 的根治）', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: rid('s'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const first = await s.settle(rid('s'), 0.63)
    const second = await s.settle(rid('s'), 0.63)
    expect(first.chargedUsd).toBeCloseTo(0.63)
    expect(second.idempotent).toBe(true)
    expect(s.snapshot(C, P)!.spent).toBeCloseTo(0.63) // 不是 1.26
    expect(s.snapshot(C, P)!.reserved).toBe(0)
  })
})

describe('结算把预留挪成实际花费', () => {
  it('actual < worstCase → 只按 actual 扣，余额回补可再预留', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: rid('1'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    await s.settle(rid('1'), 0.63)
    expect(s.snapshot(C, P)!.spent).toBeCloseTo(0.63)
    const again = await resolveClientGeoBudget(s, { reservationId: rid('2'), clientId: C, periodKey: P, worstCaseUsd: 4 })
    expect(again.authorized).toBe(true)
  })
  it('actual 报得比预留高 → 最多按预留上界扣', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: rid('1'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const r = await s.settle(rid('1'), 999)
    expect(r.chargedUsd).toBe(1.8)
  })
  it('结算不存在的预留 → no_reservation（不凭空扣）', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    const r = await s.settle('ghost', 1)
    expect(r.settled).toBe(false); expect(r.reason).toBe('no_reservation')
  })
})

describe('reservation_id 身份核对（Codex P1：跨客户/窗口/金额复用必须 fail-closed）', () => {
  it('同一 reservationId 换客户 → 拒（不授权新客户一笔没预留的钱）', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap('a0000000-0000-0000-0000-000000000000', P, 1)
    await resolveClientGeoBudget(s, { reservationId: 'R', clientId: 'a0000000-0000-0000-0000-000000000000', periodKey: P, worstCaseUsd: 0.1 })
    const r = await resolveClientGeoBudget(s, { reservationId: 'R', clientId: 'b0000000-0000-0000-0000-000000000000', periodKey: '2026-10', worstCaseUsd: 100 })
    expect(r.authorized).toBe(false); if (!r.authorized) expect(r.reason).toBe('reservation_mismatch')
  })
  it('同一 reservationId 换金额 → 拒', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 100)
    await resolveClientGeoBudget(s, { reservationId: 'R2', clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const r = await resolveClientGeoBudget(s, { reservationId: 'R2', clientId: C, periodKey: P, worstCaseUsd: 50 })
    expect(r.authorized).toBe(false); if (!r.authorized) expect(r.reason).toBe('reservation_mismatch')
  })
  it('同一 reservationId 同一身份 → 仍幂等成功', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: 'R3', clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const r = await resolveClientGeoBudget(s, { reservationId: 'R3', clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(true)
    expect(s.snapshot(C, P)!.reserved).toBe(1.8)
  })
})

describe('已结算/已回收的预留不再是授权（Codex P2：防重放导致 provider 花两次）', () => {
  it('reserve → settle → 同身份 reserve 回放 → 拒（already_settled），不放行下游', async () => {
    const st = new FakeGeoBudgetStore(); st.setCap(C, P, 5)
    await resolveClientGeoBudget(st, { reservationId: 'RS', clientId: C, periodKey: P, worstCaseUsd: 0.5 })
    await st.settle('RS', 0.3)
    const replay = await resolveClientGeoBudget(st, { reservationId: 'RS', clientId: C, periodKey: P, worstCaseUsd: 0.5 })
    expect(replay.authorized).toBe(false)
    if (!replay.authorized) expect(replay.reason).toBe('already_settled')
  })
  it('预留被 expire 回收后同身份再 reserve → 拒（reservation_expired）', async () => {
    const st = new FakeGeoBudgetStore(); st.setCap(C, P, 5)
    await resolveClientGeoBudget(st, { reservationId: 'RE', clientId: C, periodKey: P, worstCaseUsd: 0.5 })
    // 手工把状态置为 expired 模拟 geo_expire_stale_reservations 已跑过
    ;(st as unknown as { reservations: Map<string, { status: string }> }).reservations.get('RE')!.status = 'expired'
    const replay = await resolveClientGeoBudget(st, { reservationId: 'RE', clientId: C, periodKey: P, worstCaseUsd: 0.5 })
    expect(replay.authorized).toBe(false)
    if (!replay.authorized) expect(replay.reason).toBe('reservation_expired')
  })
  it('未结算的同身份重复 reserve → 仍幂等成功（保证顺序重试正常）', async () => {
    const st = new FakeGeoBudgetStore(); st.setCap(C, P, 5)
    await resolveClientGeoBudget(st, { reservationId: 'RN', clientId: C, periodKey: P, worstCaseUsd: 0.5 })
    const again = await resolveClientGeoBudget(st, { reservationId: 'RN', clientId: C, periodKey: P, worstCaseUsd: 0.5 })
    expect(again.authorized).toBe(true)
    expect(st.snapshot(C, P)!.reserved).toBe(0.5)
  })
})

describe('geoBudgetPeriodKey', () => {
  it('给出 UTC 的 YYYY-MM', () => {
    expect(geoBudgetPeriodKey(new Date(Date.UTC(2026, 8, 4)))).toBe('2026-09')
    expect(geoBudgetPeriodKey(new Date(Date.UTC(2026, 0, 31)))).toBe('2026-01')
  })
})
