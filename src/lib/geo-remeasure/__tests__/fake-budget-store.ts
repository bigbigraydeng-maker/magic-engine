/**
 * 假 GeoBudgetStore：内存建模 geo_client_budgets + geo_budget_reservations 两表 + 同一套判据。
 * 🔴 这是**应用层判据**的镜像（幂等、fail-closed 分支）。SQL 层的真实并发/原子行为由
 *    scripts/geo-budget-ledger-check.sh 在真 postgres 上单独断言（魏征 #3：假件的 JS 单线程
 *    模拟不了 postgres 行锁并发，不能替代 SQL 测试）。两处判据必须手动保持一致。
 */
import type { GeoBudgetStore, GeoBudgetReserveResult, GeoBudgetSettleResult } from '../budget-ledger'

interface BudgetRow { cap: number; reserved: number; spent: number }
interface ResRow { clientId: string; periodKey: string; worstCase: number; status: 'reserved' | 'settled' | 'expired'; charged?: number }

export class FakeGeoBudgetStore implements GeoBudgetStore {
  private budgets = new Map<string, BudgetRow>()
  private reservations = new Map<string, ResRow>()

  setCap(clientId: string, periodKey: string, capUsd: number): void {
    this.budgets.set(`${clientId}::${periodKey}`, { cap: capUsd, reserved: 0, spent: 0 })
  }
  snapshot(clientId: string, periodKey: string): BudgetRow | undefined {
    const r = this.budgets.get(`${clientId}::${periodKey}`)
    return r ? { ...r } : undefined
  }

  async reserve(reservationId: string, clientId: string, periodKey: string, worstCaseUsd: number): Promise<GeoBudgetReserveResult> {
    if (!reservationId) return { reserved: false, reason: 'invalid_reservation_id' }
    if (!Number.isFinite(worstCaseUsd) || !(worstCaseUsd > 0)) return { reserved: false, reason: 'invalid_worst_case' }
    const existing = this.reservations.get(reservationId)
    if (existing) {
      // 🔴 幂等只对同一身份成立；换客户/窗口/金额 = 冲突，fail-closed（Codex P1）。
      if (existing.clientId !== clientId || existing.periodKey !== periodKey || existing.worstCase !== worstCaseUsd) {
        return { reserved: false, reason: 'reservation_mismatch' }
      }
      // 🔴 已结算/已回收 → 不再是执行授权（Codex P2：重放会导致 provider 真花两次而账本记一次）。
      if (existing.status === 'settled') return { reserved: false, reason: 'already_settled' }
      if (existing.status === 'expired') return { reserved: false, reason: 'reservation_expired' }
      return { reserved: true, idempotent: true }
    }
    const b = this.budgets.get(`${clientId}::${periodKey}`)
    if (!b) return { reserved: false, reason: 'no_budget_row' } // fail-closed
    const remaining = b.cap - b.reserved - b.spent
    if (remaining < worstCaseUsd) return { reserved: false, reason: 'insufficient', remainingUsd: remaining }
    b.reserved += worstCaseUsd
    this.reservations.set(reservationId, { clientId, periodKey, worstCase: worstCaseUsd, status: 'reserved' })
    return { reserved: true, remainingUsd: remaining - worstCaseUsd }
  }

  async settle(reservationId: string, actualUsd: number): Promise<GeoBudgetSettleResult> {
    if (!Number.isFinite(actualUsd) || actualUsd < 0) return { settled: false, reason: 'invalid_actual' }
    const r = this.reservations.get(reservationId)
    if (!r) return { settled: false, reason: 'no_reservation' }
    if (r.status === 'settled') return { settled: true, idempotent: true, chargedUsd: r.charged } // 幂等：不重复扣
    if (r.status === 'expired') return { settled: false, reason: 'expired' }
    const charge = Math.min(actualUsd, r.worstCase)
    const b = this.budgets.get(`${r.clientId}::${r.periodKey}`)!
    b.reserved -= r.worstCase
    b.spent += charge
    r.status = 'settled'; r.charged = charge
    return { settled: true, chargedUsd: charge }
  }
}
