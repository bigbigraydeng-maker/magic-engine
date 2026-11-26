/**
 * Exam (design §6). A PM correction becomes a fixed question: the audit must find what the PM saw.
 * Q1 · 2026-11-05 · CTS: "内容同质化太严重——视觉风格、剪辑风格、BGM" → templates, BGM, variants, forms, visuals all over the line.
 */
import { describe, expect, it } from 'vitest'
import { auditAccount, type MetricResult } from '../audit'
import { CTS_AS_OF, CTS_REELS_2026_11_05 } from './fixtures/cts-2026-11-05'

const byKey = (metrics: MetricResult[], key: string) => metrics.find((m) => m.key === key)

describe('exam Q1 · CTS reels on 2026-11-05', () => {
  const result = auditAccount(CTS_REELS_2026_11_05, CTS_AS_OF)

  it('reads all 41 reels', () => {
    expect(result.reelCount).toBe(41)
  })

  it('finds the sameness the PM saw: template, BGM, variants, form coverage, visuals', () => {
    for (const key of ['D1', 'D2', 'D3', 'D4', 'D6']) expect(byKey(result.metrics, key)?.status, key).toBe('over')
  })

  it('says what it cannot measure instead of passing it: content pillars', () => {
    expect(byKey(result.metrics, 'D5')?.status).toBe('not_measured')
    expect(result.findings.some((f) => f.key === 'D5' && f.tier === 'C')).toBe(true)
  })

  it('names the forms the account never shows and who has to act (factory cannot make them yet)', () => {
    const missing = result.findings.filter((f) => f.key === 'D4' && f.what.includes('缺'))
    expect(missing.map((f) => f.what).join('')).toContain('people')
    expect(missing.map((f) => f.what).join('')).toContain('explainer')
    expect(missing.every((f) => f.tier === 'C')).toBe(true)
  })

  it('puts the schedule-fixable findings in tier A', () => {
    const a = result.findings.filter((f) => f.tier === 'A').map((f) => f.key)
    expect(a).toEqual(expect.arrayContaining(['D1', 'D2', 'D3', 'D6']))
  })
})
