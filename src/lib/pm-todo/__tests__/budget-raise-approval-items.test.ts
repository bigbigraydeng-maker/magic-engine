import { describe, expect, it, vi } from 'vitest'
import { KERNEL_APPROVALS_PATH } from '@/lib/ads-budget-card/raise-approval-hints'
import { pushBudgetRaiseApprovalItems } from '../budget-raise-approval-items'
import type { ManualItem } from '../manual-item-types'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'

function holdPayload(over: Record<string, unknown> = {}) {
  return {
    kind: 'adset_daily_budget',
    status: 'awaiting',
    cardRunId: 'card-run',
    actionRunId: 'kernel-run',
    beforeCents: 100,
    afterCents: 120,
    order: { name: '春季组', newDailyBudgetCents: 120 },
    ...over,
  }
}

function fakeSupabase(
  flywheelRows: unknown[],
  runRows: unknown[],
  failFlywheel?: boolean,
): Parameters<typeof pushBudgetRaiseApprovalItems>[0] {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.in = vi.fn(() => chain)
    if (table === 'flywheel_actions') {
      chain.then = (resolve: (v: unknown) => void) => {
        resolve(failFlywheel
          ? { data: null, error: { message: 'boom' } }
          : { data: flywheelRows, error: null })
      }
    }
    if (table === 'action_runs') {
      chain.then = (resolve: (v: unknown) => void) => {
        resolve({ data: runRows, error: null })
      }
    }
    return chain
  })
  return { from } as unknown as Parameters<typeof pushBudgetRaiseApprovalItems>[0]
}

describe('pushBudgetRaiseApprovalItems', () => {
  it('emits a kernel-approvals todo while spend approval is pending', async () => {
    const items: ManualItem[] = []
    await pushBudgetRaiseApprovalItems(
      fakeSupabase(
        [{ client_id: CLIENT, payload: holdPayload() }],
        [{ id: 'kernel-run', status: 'pending_approval' }],
      ),
      items,
      [CLIENT],
      () => '演示客户',
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('budget_raise_awaiting_pm')
    expect(items[0].href).toContain(KERNEL_APPROVALS_PATH)
    expect(items[0].how).toContain(KERNEL_APPROVALS_PATH)
  })

  it('emits a confirmation-card todo after kernel authorized the raise', async () => {
    const items: ManualItem[] = []
    await pushBudgetRaiseApprovalItems(
      fakeSupabase(
        [{ client_id: CLIENT, payload: holdPayload() }],
        [{ id: 'kernel-run', status: 'authorized' }],
      ),
      items,
      [CLIENT],
      () => '演示客户',
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('budget_raise_awaiting_confirm')
    expect(items[0].href).toContain('/confirmation-cards')
  })

  it('surfaces a read failure instead of staying silent', async () => {
    const items: ManualItem[] = []
    await pushBudgetRaiseApprovalItems(fakeSupabase([], [], true), items, [CLIENT], () => '演示客户')
    expect(items[0].client_id).toBe('infra')
    expect(items[0].what).toMatch(/读不出来/)
  })
})
