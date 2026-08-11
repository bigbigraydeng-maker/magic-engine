/**
 * GEO Measurement Runtime —— fake provider（Issue #874 / WP04）
 */

import { describe, it, expect } from 'vitest'
import { createAlwaysSucceedsFakeProvider, createFakeGeoProvider } from '../fake-provider'

describe('fake provider', () => {
  it('拒绝非法的 costCeilingUsdPerCall', () => {
    expect(() => createFakeGeoProvider({ costCeilingUsdPerCall: -1, script: [() => ({ kind: 'timeout', costUsd: 0 })] })).toThrow()
    expect(() => createFakeGeoProvider({ costCeilingUsdPerCall: NaN, script: [() => ({ kind: 'timeout', costUsd: 0 })] })).toThrow()
  })

  it('拒绝空脚本', () => {
    expect(() => createFakeGeoProvider({ costCeilingUsdPerCall: 0.01, script: [] })).toThrow()
  })

  it('按调用顺序回放脚本，并记录调用日志', async () => {
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [
        () => ({ kind: 'success', rawResponse: 'r1', citations: [], confidence: 0.9, costUsd: 0.01 }),
        () => ({ kind: 'timeout', costUsd: 0 }),
      ],
    })
    const out1 = await provider.call({ cohort: { engineFamily: 'openai', modelVersion: 'm', locale: 'en-NZ', market: 'NZ' }, query: { queryKey: 'q1', questionText: 'x' }, sampleIndex: 0 })
    const out2 = await provider.call({ cohort: { engineFamily: 'openai', modelVersion: 'm', locale: 'en-NZ', market: 'NZ' }, query: { queryKey: 'q1', questionText: 'x' }, sampleIndex: 1 })
    expect(out1.kind).toBe('success')
    expect(out2.kind).toBe('timeout')
    expect(provider.callLog).toHaveLength(2)
  })

  it('always-succeeds provider 默认声明不支持幂等（保守假设）', () => {
    const provider = createAlwaysSucceedsFakeProvider(0.01)
    expect(provider.idempotency.supported).toBe(false)
  })
})
