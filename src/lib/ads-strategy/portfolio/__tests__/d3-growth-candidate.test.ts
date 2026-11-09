import { describe, it, expect } from 'vitest'
import { buildD3GrowthCandidate } from '../d3-growth-candidate'
import { validateGrowthActionCandidate } from '@/lib/growth'
import type { Diagnosis } from '../diagnostics/types'

const diagnosis: Diagnosis = {
  code: 'D3',
  status: 'hit',
  title: '花钱没结果：近 7 天花了 $140，留资 0 个',
  units: [{ level: 'adset', id: 'adset-1', name: 'Reels · 冷流量', adAccountId: '123456' }],
  evidence: { spend: 140, results: 0 },
  sample: [{ label: '留资', value: 0 }],
  reasons: ['花费 ≥ 2× 目标，且单次成本 ≥ 2× 目标'],
  clientVisible: true,
}

describe('buildD3GrowthCandidate', () => {
  it('产出的候选真的能过 validateGrowthActionCandidate（不是形似而已）', () => {
    const candidate = buildD3GrowthCandidate({
      clientId: 'client-1',
      insightDate: '2026-09-21',
      diagnosis,
      unit: diagnosis.units[0],
    })
    const result = validateGrowthActionCandidate(candidate)
    expect(result).toEqual({ ok: true })
  })

  it('input 携带 adset_id / ad_account_id / insight_date，供下游追溯', () => {
    const candidate = buildD3GrowthCandidate({
      clientId: 'client-1', insightDate: '2026-09-21', diagnosis, unit: diagnosis.units[0],
    })
    expect(candidate.input).toEqual({ ad_account_id: '123456', adset_id: 'adset-1', insight_date: '2026-09-21' })
  })
})
