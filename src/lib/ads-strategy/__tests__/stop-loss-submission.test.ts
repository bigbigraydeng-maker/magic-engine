import { describe, it, expect, vi } from 'vitest'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { SubmitActionInput } from '@/lib/kernel/runner'
import {
  submitStopLossThroughKernel,
  type StopLossSubmissionInput,
  type StopLossUnit,
} from '../stop-loss-submission'

const runActionMock = vi.fn()
vi.mock('@/lib/kernel/runner', () => ({
  runAction: (...args: unknown[]) => runActionMock(...args),
}))

function outcome(kind: string, runId: string) {
  return { kind, run: { id: runId }, decision: null, execution: null, humanReason: null }
}

const deps = {} as unknown as KernelDeps

function unit(over: Partial<StopLossUnit> = {}): StopLossUnit {
  return { adsetId: 'as-1', name: '冷启广泛 AU', currentCents: 5_000, afterCents: 4_000, ...over }
}

function input(over: Partial<StopLossSubmissionInput> = {}): StopLossSubmissionInput {
  return {
    clientId: 'c-1',
    adAccountId: 'act_123',
    cycleDate: '2026-09-27',
    goalId: 'g-1',
    action: 'cut',
    units: [unit()],
    pressedBy: 'someone@example.com',
    campaignId: 'cmp-1',
    ...over,
  }
}

function firstSubmitInput(): SubmitActionInput {
  return runActionMock.mock.calls[0][1] as SubmitActionInput
}

describe('submitStopLossThroughKernel', () => {
  it('cut 动作提交 ads.cut_unit_budget', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('succeeded', 'run-1'))

    await submitStopLossThroughKernel(deps, input({ action: 'cut' }))

    expect(runActionMock).toHaveBeenCalledTimes(1)
    expect(firstSubmitInput().actionKey).toBe('ads.cut_unit_budget')
  })

  it('pause 动作提交 ads.pause_unit', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('succeeded', 'run-1'))

    await submitStopLossThroughKernel(
      deps,
      input({ action: 'pause', units: [unit({ afterCents: null })] }),
    )

    expect(runActionMock).toHaveBeenCalledTimes(1)
    expect(firstSubmitInput().actionKey).toBe('ads.pause_unit')
  })

  it('提交的 purpose 是 growth 且 goalId 是 g-1', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('succeeded', 'run-1'))

    await submitStopLossThroughKernel(deps, input({ action: 'cut' }))

    const submitted = firstSubmitInput()
    expect(submitted.purpose).toBe('growth')
    expect(submitted.goalId).toBe('g-1')
  })

  it('cut 时 input 的键集合严格等于 cycle_date/ad_account_id/adset_id/after_cents', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('succeeded', 'run-1'))

    await submitStopLossThroughKernel(deps, input({ action: 'cut' }))

    expect(Object.keys(firstSubmitInput().input).sort()).toEqual(
      ['ad_account_id', 'adset_id', 'after_cents', 'cycle_date'].sort(),
    )
  })

  it('pause 时 input 的键集合严格等于 cycle_date/ad_account_id/adset_id（不含 after_cents）', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('succeeded', 'run-1'))

    await submitStopLossThroughKernel(
      deps,
      input({ action: 'pause', units: [unit({ afterCents: null })] }),
    )

    expect(Object.keys(firstSubmitInput().input).sort()).toEqual(
      ['ad_account_id', 'adset_id', 'cycle_date'].sort(),
    )
  })

  it('input 里带上 cycle_date、ad_account_id、adset_id', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('succeeded', 'run-1'))

    await submitStopLossThroughKernel(deps, input({ action: 'cut' }))

    const submitted = firstSubmitInput()
    expect(submitted.input.cycle_date).toBe('2026-09-27')
    expect(submitted.input.ad_account_id).toBe('act_123')
    expect(submitted.input.adset_id).toBe('as-1')
  })

  it('triggeredBy 是 human、triggeredByRef 是按下的人', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('succeeded', 'run-1'))

    await submitStopLossThroughKernel(deps, input({ action: 'cut' }))

    const submitted = firstSubmitInput()
    expect(submitted.triggeredBy).toBe('human')
    expect(submitted.triggeredByRef).toBe('someone@example.com')
  })

  it('cut 但没算出 afterCents 时不提交，记成 invalid_unit', async () => {
    runActionMock.mockReset()

    const result = await submitStopLossThroughKernel(
      deps,
      input({ action: 'cut', units: [unit({ afterCents: null })] }),
    )

    expect(runActionMock).not.toHaveBeenCalled()
    expect(result.units).toHaveLength(1)
    expect(result.units[0].kind).toBe('invalid_unit')
    expect(result.units[0].runId).toBeNull()
  })

  it('三个单位串行提交，顺序与传入一致', async () => {
    runActionMock.mockReset()
    runActionMock
      .mockResolvedValueOnce(outcome('succeeded', 'run-1'))
      .mockResolvedValueOnce(outcome('succeeded', 'run-2'))
      .mockResolvedValueOnce(outcome('succeeded', 'run-3'))

    const result = await submitStopLossThroughKernel(
      deps,
      input({
        action: 'cut',
        units: [
          unit({ adsetId: 'as-1' }),
          unit({ adsetId: 'as-2' }),
          unit({ adsetId: 'as-3' }),
        ],
      }),
    )

    expect(runActionMock).toHaveBeenCalledTimes(3)
    expect(result.units).toHaveLength(3)
    expect(result.units.map((u) => u.adsetId)).toEqual(['as-1', 'as-2', 'as-3'])
  })

  it('第一个单位抛错不打断后面的单位', async () => {
    runActionMock.mockReset()
    runActionMock
      .mockRejectedValueOnce(new Error('kernel exploded'))
      .mockResolvedValueOnce(outcome('succeeded', 'run-2'))

    const result = await submitStopLossThroughKernel(
      deps,
      input({
        action: 'cut',
        units: [unit({ adsetId: 'as-1' }), unit({ adsetId: 'as-2' })],
      }),
    )

    expect(result.units).toHaveLength(2)
    expect(result.units[0].kind).toBe('kernel_error')
    expect(result.units[0].humanReason).toContain('kernel exploded')
    expect(result.units[1].kind).toBe('succeeded')
  })

  it('Kernel 给回 pending_approval 时如实记录，不粉饰成 succeeded', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('pending_approval', 'run-9'))

    const result = await submitStopLossThroughKernel(deps, input({ action: 'cut' }))

    expect(result.units[0].kind).toBe('pending_approval')
    expect(result.units[0].runId).toBe('run-9')
  })

  it('Kernel 给回 denied 时如实记录', async () => {
    runActionMock.mockReset()
    runActionMock.mockResolvedValueOnce(outcome('denied', 'run-10'))

    const result = await submitStopLossThroughKernel(deps, input({ action: 'cut' }))

    expect(result.units[0].kind).toBe('denied')
    expect(result.units[0].runId).toBe('run-10')
  })
})
