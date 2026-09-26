import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  loadDiagnosisInput: vi.fn(),
  runDiagnostics: vi.fn(),
  runOpportunities: vi.fn(),
  goal: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('../../portfolio/diagnostics/loader', () => ({ loadDiagnosisInput: mocks.loadDiagnosisInput }))
vi.mock('../../portfolio/diagnostics/run', () => ({ runDiagnostics: mocks.runDiagnostics }))
vi.mock('../../portfolio/opportunities/run', () => ({ runOpportunities: mocks.runOpportunities }))
vi.mock('../../portfolio/goal-context', () => ({ buildDigestGoalContext: mocks.goal }))

import { buildGrowthState } from '../patrol'

const COVERAGE = [{ adAccountId: 'act_1', ran: true, reason: 'ok', adsChecked: 4 }]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockReturnValue({ upsert: mocks.upsert })
  mocks.upsert.mockResolvedValue({ error: null })
  mocks.loadDiagnosisInput.mockResolvedValue({
    clientId: 'c',
    date: '2026-09-24',
    evaluatedAt: 'x',
    outcome: { leading: null, primary: null, targetCostPerPrimary: null, minPrimaryPerUnit: 5 },
    outcomeConfigured: false,
    messagingReferralAvailable: false,
    digestRecipients: [],
    accounts: [],
  })
  mocks.runDiagnostics.mockReturnValue({
    clientId: 'c',
    date: '2026-09-24',
    evaluatedAt: 'x',
    diagnoses: [],
    excluded: [],
    adLevelCoverage: COVERAGE,
  })
  mocks.runOpportunities.mockReturnValue({ opportunities: [], skippedReason: null })
  mocks.goal.mockResolvedValue(null)
})

const SYNC = [{ campaign: { success: true }, adset: { success: true }, ad: { success: true } }]

describe('buildGrowthState 落库 payload', () => {
  it('把 adLevelCoverage 写进 ads_growth_states 的 payload', async () => {
    const result = await buildGrowthState('c', '2026-09-24', SYNC)
    expect(result.success).toBe(true)
    expect(mocks.from).toHaveBeenCalledWith('ads_growth_states')
    const [row] = mocks.upsert.mock.calls[0] as [{ payload: { adLevelCoverage: unknown } }]
    expect(row.payload.adLevelCoverage).toEqual(COVERAGE)
  })

  it('runDiagnostics 没给 adLevelCoverage 时 payload 里是空数组', async () => {
    mocks.runDiagnostics.mockReturnValue({
      clientId: 'c',
      date: '2026-09-24',
      evaluatedAt: 'x',
      diagnoses: [],
      excluded: [],
    })
    const result = await buildGrowthState('c', '2026-09-24', SYNC)
    expect(result.success).toBe(true)
    const [row] = mocks.upsert.mock.calls[0] as [{ payload: { adLevelCoverage: unknown } }]
    expect(row.payload.adLevelCoverage).toEqual([])
  })
})
