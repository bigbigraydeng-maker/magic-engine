import { describe, expect, it } from 'vitest'
import { buildBreakdownReport } from '@/lib/ads-strategy/breakdown-stats/report'
import { linkClickRate, overlayLinkCtrSeries } from '@/lib/ads-strategy/link-clicks'

describe('link clicks, not all clicks', () => {
  it('uses link_click from actions and stays unknown when actions are missing', () => {
    const actions = [
      { action_type: 'link_click', value: '4' },
      { action_type: 'post_engagement', value: '80' },
    ]
    expect(linkClickRate(actions, 1000)).toBe(0.004)
    expect(linkClickRate(null, 1000)).toBeNull()
    expect(linkClickRate(actions, 0)).toBeNull()
  })

  it('overlays the campaign series and does not keep the stored all-click rate', () => {
    const [campaign] = overlayLinkCtrSeries(
      [{ campaign_id: 'c1', ctr_series: [{ date: '2026-10-01', ctr: 0.08 }] }],
      [{ entity_id: 'c1', insight_date: '2026-10-01', impressions: 1000, actions: [{ action_type: 'link_click', value: 4 }] }],
    )
    expect(campaign.ctr_series).toEqual([{ date: '2026-10-01', ctr: 0.004 }])
  })

  it('breakdown rows keep all-click counts but rate off link clicks', () => {
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-10-01',
      days: 1,
      accounts: [],
      leads: [],
      objectives: new Map([['c1', 'OUTCOME_LEADS']]),
      stats: [{
        ad_account_id: 'act',
        campaign_id: 'c1',
        stat_date: '2026-10-01',
        breakdown_key: 'placement_device',
        breakdown_value: { publisher_platform: 'facebook', platform_position: 'feed', device_platform: 'mobile' },
        spend: 10,
        impressions: 1000,
        clicks: 80,
        link_clicks: 4,
        meta_leads: 1,
      }],
    })
    expect(report.placement[0]).toMatchObject({ clicks: 80, linkClicks: 4 })
    expect(report.totals.linkClicksLeadObjective).toBe(4)
  })
})
