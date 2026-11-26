import { describe, expect, it } from 'vitest'
import { parseAdsAgentInvestigationEnabled } from '../config'

describe('parseAdsAgentInvestigationEnabled', () => {
  it('is false unless explicitly true', () => {
    expect(parseAdsAgentInvestigationEnabled(null)).toBe(false)
    expect(parseAdsAgentInvestigationEnabled({})).toBe(false)
    expect(parseAdsAgentInvestigationEnabled({ ads_agent_investigation_tools: false })).toBe(false)
    expect(parseAdsAgentInvestigationEnabled({ ads_agent_investigation_tools: true })).toBe(true)
  })
})
