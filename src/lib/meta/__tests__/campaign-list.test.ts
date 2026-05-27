/**
 * Tests for campaign-list.ts pure helpers — P18.A.1
 */

import { describe, it, expect } from 'vitest'
import {
  parseCampaignInsightsRow,
  sortCampaignsByRisk,
} from '../campaign-list'
import type { CampaignInsightsRow } from '../campaign-list'

// ── parseCampaignInsightsRow ───────────────────────────────────────────────────

describe('parseCampaignInsightsRow', () => {
  it('parses full row from Meta insights API', () => {
    const raw = {
      campaign_id:   'c1',
      campaign_name: 'Summer Sale',
      spend:         '120.50',
      impressions:   '5000',
      clicks:        '250',
      purchase_roas: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '3.2' }],
      actions:       [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '10' }],
    }
    const row = parseCampaignInsightsRow(raw)
    expect(row.campaign_id).toBe('c1')
    expect(row.campaign_name).toBe('Summer Sale')
    expect(row.spend).toBeCloseTo(120.5)
    expect(row.impressions).toBe(5000)
    expect(row.clicks).toBe(250)
    expect(row.roas).toBeCloseTo(3.2)
    expect(row.conversions).toBe(10)
  })

  it('returns null roas when purchase_roas is absent', () => {
    const raw = { campaign_id: 'c2', campaign_name: 'Brand', spend: '50', impressions: '1000', clicks: '30' }
    expect(parseCampaignInsightsRow(raw).roas).toBeNull()
  })

  it('returns null conversions when actions absent', () => {
    const raw = { campaign_id: 'c3', campaign_name: 'X', spend: '10', impressions: '200', clicks: '5' }
    expect(parseCampaignInsightsRow(raw).conversions).toBeNull()
  })

  it('computes ctr from clicks and impressions', () => {
    const raw = { campaign_id: 'c4', campaign_name: 'Y', spend: '20', impressions: '1000', clicks: '100' }
    expect(parseCampaignInsightsRow(raw).ctr).toBeCloseTo(0.1)
  })

  it('handles zero impressions without dividing', () => {
    const raw = { campaign_id: 'c5', campaign_name: 'Z', spend: '0', impressions: '0', clicks: '0' }
    expect(parseCampaignInsightsRow(raw).ctr).toBeNull()
  })
})

// ── sortCampaignsByRisk ────────────────────────────────────────────────────────

describe('sortCampaignsByRisk', () => {
  const critical: CampaignInsightsRow = { campaign_id: 'a', campaign_name: 'A', spend: 50, impressions: 1000, clicks: 20, roas: 0.5, conversions: 1, ctr: 0.02, grade: 'critical' }
  const warning:  CampaignInsightsRow = { campaign_id: 'b', campaign_name: 'B', spend: 50, impressions: 1000, clicks: 20, roas: 1.4, conversions: 5, ctr: 0.02, grade: 'warning' }
  const healthy:  CampaignInsightsRow = { campaign_id: 'c', campaign_name: 'C', spend: 50, impressions: 1000, clicks: 20, roas: 3.0, conversions: 15, ctr: 0.02, grade: 'healthy' }

  it('puts critical first', () => {
    const sorted = sortCampaignsByRisk([healthy, warning, critical])
    expect(sorted[0].campaign_id).toBe('a')
  })

  it('puts healthy last', () => {
    const sorted = sortCampaignsByRisk([critical, healthy, warning])
    expect(sorted[sorted.length - 1].campaign_id).toBe('c')
  })

  it('within same grade, sorts by spend descending', () => {
    const a: CampaignInsightsRow = { ...critical, campaign_id: 'x', spend: 200 }
    const b: CampaignInsightsRow = { ...critical, campaign_id: 'y', spend: 100 }
    const sorted = sortCampaignsByRisk([b, a])
    expect(sorted[0].campaign_id).toBe('x')
  })
})
