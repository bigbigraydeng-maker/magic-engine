/**
 * Capability `ads.auto_pause_on_d3` —— pause / verify / rollback。
 *
 * 跟 page-apply-optimization 的 capability 测试同一套调用方式
 * （`cap.steps.<key>(step)`，`step.ctx` 走 `as unknown as AuthorizedExecutionContext`
 * 只填测试用得到的字段）——那边的用例已经把这套调用形状实测跑绿过。
 */
import { describe, it, expect, vi } from 'vitest'
import type { AuthorizedExecutionContext, CapabilityStepContext } from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import { createAdsAutoPauseCapability } from '..'
import type { AdsAutoPauseDeps } from '../deps'

function fakeCtx(clientId = 'client1'): AuthorizedExecutionContext {
  return {
    decisionId: 'dec1', runId: 'run1', clientId,
    actionKey: 'ads.auto_pause_on_d3',
    actionVersion: 1, policyVersion: 1, costCapUsd: null,
    idempotencyKey: 'idem1', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

const RUN_INPUT = { ad_account_id: '123456', adset_id: 'adset-1', diagnosis_code: 'D3', insight_date: '2026-09-21' }

function makeStep(overrides: Partial<CapabilityStepContext> = {}): CapabilityStepContext {
  return {
    ctx: fakeCtx(), stepKey: 'pause', attempt: 1, idempotencyKey: 'x', priorOutputs: {},
    runInput: RUN_INPUT,
    ...overrides,
  }
}

describe('pause step', () => {
  it('没有 Meta 令牌 → INVALID_INPUT，不重试', async () => {
    const cap = createAdsAutoPauseCapability({ resolveToken: async () => null })
    await expect(cap.steps.pause(makeStep())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('Meta 返回失败（setAdSetStatus=false）→ RetryableCapabilityError', async () => {
    const cap = createAdsAutoPauseCapability({
      resolveToken: async () => 'token1',
      setAdSetStatus: async () => false,
    })
    await expect(cap.steps.pause(makeStep())).rejects.toBeInstanceOf(RetryableCapabilityError)
  })

  it('setAdSetStatus 抛错 → 包成 RetryableCapabilityError（瞬时故障可重试）', async () => {
    const cap = createAdsAutoPauseCapability({
      resolveToken: async () => 'token1',
      setAdSetStatus: async () => { throw new Error('network blip') },
    })
    await expect(cap.steps.pause(makeStep())).rejects.toBeInstanceOf(RetryableCapabilityError)
  })

  it('happy path → 调了 setAdSetStatus(adset_id, token, PAUSED)，产物带 adset_id', async () => {
    const setAdSetStatus = vi.fn(async () => true)
    const cap = createAdsAutoPauseCapability({ resolveToken: async () => 'token1', setAdSetStatus })
    const result = await cap.steps.pause(makeStep())
    expect(setAdSetStatus).toHaveBeenCalledWith('adset-1', 'token1', 'PAUSED')
    expect(result.output).toMatchObject({ adset_id: 'adset-1', paused: true })
    expect(result.costActualUsd).toBe(0)
  })
})

describe('verify step', () => {
  it('回读状态 = PAUSED → verification.passed = true', async () => {
    const cap = createAdsAutoPauseCapability({
      resolveToken: async () => 'token1',
      getAdSetStatus: async () => ({ id: 'adset-1', name: 'x', status: 'PAUSED' }),
    })
    const result = await cap.steps.verify(makeStep({ stepKey: 'verify' }))
    expect(result.verification?.passed).toBe(true)
    expect(result.output).toMatchObject({ verified_status: 'PAUSED' })
  })

  it('回读状态 ≠ PAUSED（比如又被开回 ACTIVE）→ verification.passed = false，附失败原因', async () => {
    const cap = createAdsAutoPauseCapability({
      resolveToken: async () => 'token1',
      getAdSetStatus: async () => ({ id: 'adset-1', name: 'x', status: 'ACTIVE' }),
    })
    const result = await cap.steps.verify(makeStep({ stepKey: 'verify' }))
    expect(result.verification?.passed).toBe(false)
    expect(result.verification?.failure_reason).toContain('PAUSED')
  })

  it('回读失败（getAdSetStatus 抛错）→ verification.passed = false，不抛异常吞掉结果', async () => {
    const cap = createAdsAutoPauseCapability({
      resolveToken: async () => 'token1',
      getAdSetStatus: async () => { throw new Error('graph timeout') },
    })
    const result = await cap.steps.verify(makeStep({ stepKey: 'verify' }))
    expect(result.verification?.passed).toBe(false)
  })
})

describe('rollback（撤回 = 设回 ACTIVE）', () => {
  const priorOutputsPaused = { pause: { adset_id: 'adset-1', paused: true } }

  it('pause 从未成功过 → noop，不调用任何 Meta 写接口', async () => {
    const setAdSetStatus = vi.fn()
    const cap = createAdsAutoPauseCapability({ setAdSetStatus })
    const result = await cap.rollback!(makeStep(), {})
    expect(result).toMatchObject({ ok: true, rollbackKind: 'noop' })
    expect(setAdSetStatus).not.toHaveBeenCalled()
  })

  it('pause 成功过 → 重新设回 ACTIVE', async () => {
    const setAdSetStatus = vi.fn(async () => true)
    const cap = createAdsAutoPauseCapability({ resolveToken: async () => 'token1', setAdSetStatus })
    const result = await cap.rollback!(makeStep(), priorOutputsPaused)
    expect(setAdSetStatus).toHaveBeenCalledWith('adset-1', 'token1', 'ACTIVE')
    expect(result).toMatchObject({ ok: true, rollbackKind: 'provider_native' })
  })

  it('重新开启失败（Meta 不确认）→ ok:false，写清失败原因', async () => {
    const cap = createAdsAutoPauseCapability({ resolveToken: async () => 'token1', setAdSetStatus: async () => false })
    const result = await cap.rollback!(makeStep(), priorOutputsPaused)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toBeTruthy()
  })

  it('没有令牌 → ok:false，不假装撤回成功', async () => {
    const cap = createAdsAutoPauseCapability({ resolveToken: async () => null })
    const result = await cap.rollback!(makeStep(), priorOutputsPaused)
    expect(result.ok).toBe(false)
  })
})

describe('装配契约', () => {
  it('actionKey / version 跟注册表一致', () => {
    const cap = createAdsAutoPauseCapability()
    expect(cap.actionKey).toBe('ads.auto_pause_on_d3')
    expect(cap.version).toBe(1)
    expect(Object.keys(cap.steps).sort()).toEqual(['pause', 'verify'])
  })
})
