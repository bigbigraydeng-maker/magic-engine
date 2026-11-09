/**
 * Rolling campaign CTR must match the account total: clicks ÷ impressions.
 * outbound_clicks_ctr is a different percent and used to make top campaigns
 * read 0.1% while the account, with the same clicks, read 2.8%.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdCampaignInsights } from '../client'
import { parseInsights } from '../account-insights'

afterEach(() => vi.unstubAllGlobals())

describe('campaign aggregate CTR', () => {
  it('uses clicks ÷ impressions even when Meta also sends outbound_clicks_ctr', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      data: [{
        campaign_id: 'c1',
        campaign_name: 'Lead form',
        spend: '2012',
        impressions: '67857',
        clicks: '1900',
        outbound_clicks_ctr: [{ action_type: 'outbound_click', value: '0.10' }],
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await getAdCampaignInsights('act_1', 'token', '2026-09-25', '2026-10-25')
    expect(rows).toHaveLength(1)
    expect(rows[0].ctr).toBeCloseTo(1900 / 67857, 8)
    expect(rows[0].clicks).toBe(1900)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).not.toContain('outbound_clicks_ctr')
  })

  it('account CTR is the same ratio, including a zero-click day', () => {
    expect(parseInsights({ spend: '10', impressions: '1000', clicks: '28' }).ctr).toBeCloseTo(0.028)
    expect(parseInsights({ spend: '10', impressions: '1000', clicks: '0' }).ctr).toBe(0)
    expect(parseInsights({ impressions: '0', clicks: '0' }).ctr).toBeNull()
  })
})
