import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import type { CapabilityImplementation } from '@/lib/kernel/types'
import type { KernelDeps } from '@/lib/kernel/deps'
import { neverResume, withoutResume } from '../kernel'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, user: { email: 'Ray@Example.com' } })),
}))

vi.mock('@/lib/kernel/runner', () => ({
  runAction: vi.fn(),
  approveAndRun: vi.fn(),
}))

import { executeConfirmedPause, pauseUnitInput, triggerFromSessionUser } from '@/lib/action-submission/pause-ad-set'
import { approveAndRun, runAction } from '@/lib/kernel/runner'

const pause = {
  actionKey: 'ads.pause_unit',
  version: 1,
  steps: { apply: vi.fn() },
  rollback: vi.fn(async () => ({ ok: true, rollbackKind: 'provider_native', detail: {} })),
} as unknown as CapabilityImplementation

describe('pause card cannot resume', () => {
  it('keeps the pause steps and never calls the original rollback', async () => {
    const wrapped = withoutResume(pause)
    expect(wrapped.steps).toBe(pause.steps)
    await wrapped.rollback?.({} as never, {})
    expect(pause.rollback).not.toHaveBeenCalled()
    expect(await neverResume()).toMatchObject({ rollbackKind: 'noop' })
    const source = readFileSync(join(process.cwd(), 'src/lib/ads-pause-card/kernel.ts'), 'utf8')
    expect(source).not.toContain('setAdSetStatus')
    expect(source).not.toContain('ACTIVE')
  })
})

describe('confirming session', () => {
  it('uses the session email and only the pause input', () => {
    expect(triggerFromSessionUser({ email: '  Ray@Example.com ' })?.triggeredByRef).toBe('ray@example.com')
    expect(triggerFromSessionUser({ email: '' })).toBeNull()
    expect(Object.keys(pauseUnitInput({ cycleDate: '2026-11-08', adAccountId: 'acct-a', adsetId: 'set-a' })).sort()).toEqual([
      'ad_account_id', 'adset_id', 'cycle_date',
    ])
    const source = readFileSync(join(process.cwd(), 'src/lib/action-submission/pause-ad-set.ts'), 'utf8')
    expect(source).toContain('requirePaidClientAccess(')
    expect(source).not.toContain('setAdSetStatus')
    expect(source).not.toContain("triggeredBy: 'human'")
  })

  it('does not approve again when readback already failed', async () => {
    vi.mocked(runAction).mockResolvedValue({
      kind: 'dead_letter',
      run: { id: 'run-1' },
      decision: null,
      execution: { steps: [{ step_key: 'readback', output: { status_now: 'ACTIVE' } }] },
      humanReason: '没验过',
    } as never)
    const result = await executeConfirmedPause({} as KernelDeps, {
      clientId: 'client-1',
      goalId: 'goal-1',
      adAccountId: 'acct-a',
      adsetId: 'set-a',
      cycleDate: '2026-11-08',
      nonce: 'hold-1',
      basis: '这一组花钱但没有结果',
    })
    expect(result.kind).toBe('mismatch')
    expect(result.after).toBe('ACTIVE')
    expect(approveAndRun).not.toHaveBeenCalled()
    expect(runAction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runAction).mock.calls[0]?.[1]).toMatchObject({
      triggeredByRef: 'ray@example.com',
      actionKey: 'ads.pause_unit',
    })
  })
})
