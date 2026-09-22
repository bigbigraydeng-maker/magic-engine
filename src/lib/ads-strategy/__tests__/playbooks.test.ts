/**
 * Ads industry playbooks — G11 (ads IMPACT design §1.3 / §6⑥ / §7 L2).
 *
 * Shared ads code used to hardcode「询盘」「房源」, so a travel client's digest
 * said「每个询盘」and an ecommerce client's launch gate said「房源在」. Industry
 * words now live in playbook data, chosen by clients.industry only. These tests
 * lock (a) each playbook's words, (b) the neutral default, and (c) that every
 * shared function that used to hardcode a word now actually changes with industry.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveAdsPlaybook,
  DEFAULT_ADS_PLAYBOOK,
  INDUSTRY_ADS_PLAYBOOKS,
  type AdsPlaybook,
} from '../playbooks'
import { isKnownIndustry } from '@/lib/clients/industries'
import { judgeCampaign, type DailyPoint } from '../baseline'
import { prescribe, type PrescribeInput } from '../prescription'
import { buildBody } from '../digest'
import { checkLaunch, type LaunchReadbackInput } from '../launch-readback'

const WORD_FIELDS = ['resultNoun', 'costPerResultLabel', 'expectedGeoNoun'] as const
const wordsOf = (p: AdsPlaybook): string[] => WORD_FIELDS.map(f => p[f])

describe('resolveAdsPlaybook — picks words by industry', () => {
  it.each([
    ['logistics',   '真实询价', '每个询价', '服务地区'],
    ['travel',      '咨询',     '每个咨询', '客户服务市场'],
    ['real_estate', '线索',     '每个线索', '房源'],
    ['retail',      '订单',     '每个订单', '配送市场'],
  ])('%s', (industry, resultNoun, costPerResultLabel, expectedGeoNoun) => {
    const p = resolveAdsPlaybook(industry)
    expect(p.key).toBe(industry)
    expect(p).toEqual({ key: industry, resultNoun, costPerResultLabel, expectedGeoNoun })
  })

  it('real_estate words are industry-generic, not one client\'s play (valuation / listing mandate)', () => {
    for (const w of wordsOf(resolveAdsPlaybook('real_estate'))) {
      expect(w).not.toContain('估价')
      expect(w).not.toContain('委托')
    }
  })

  it('null / empty / unknown industry → default', () => {
    expect(resolveAdsPlaybook(null)).toBe(DEFAULT_ADS_PLAYBOOK)
    expect(resolveAdsPlaybook(undefined)).toBe(DEFAULT_ADS_PLAYBOOK)
    expect(resolveAdsPlaybook('')).toBe(DEFAULT_ADS_PLAYBOOK)
    expect(resolveAdsPlaybook('healthcare')).toBe(DEFAULT_ADS_PLAYBOOK)
    expect(resolveAdsPlaybook('other')).toBe(DEFAULT_ADS_PLAYBOOK)
    expect(resolveAdsPlaybook('SPC/hybrid flooring wholesale (B2B trade)')).toBe(DEFAULT_ADS_PLAYBOOK)
  })

  it('does not match on a client name or ID', () => {
    expect(resolveAdsPlaybook('CTS Tours NZ')).toBe(DEFAULT_ADS_PLAYBOOK)
    expect(resolveAdsPlaybook('c0000000-0000-0000-0000-000000000000')).toBe(DEFAULT_ADS_PLAYBOOK)
  })

  it('normalises legacy free-text case / spaces like the memory read side', () => {
    expect(resolveAdsPlaybook(' Real Estate ').key).toBe('real_estate')
    expect(resolveAdsPlaybook('TRAVEL').key).toBe('travel')
  })

  it('default words are neutral: no industry word of any playbook leaks into it', () => {
    const banned = [
      '询盘', '询价', '看房', '房源', '估价', '委托', '报团', '咨询', '订单', '成交', '线索', '物流', '配送',
      ...INDUSTRY_ADS_PLAYBOOKS.flatMap(wordsOf),
    ]
    for (const word of wordsOf(DEFAULT_ADS_PLAYBOOK)) {
      for (const b of banned) expect(word, `default「${word}」含行业词「${b}」`).not.toContain(b)
    }
  })

  it('industry keys (except logistics, not yet in the vocabulary) are INDUSTRY_OPTIONS values', () => {
    for (const p of INDUSTRY_ADS_PLAYBOOKS) {
      if (p.key === 'logistics') continue
      expect(isKnownIndustry(p.key), p.key).toBe(true)
    }
  })
})

// ── Every shared function that used to hardcode an industry word ────────────

function pt(date: string, cpr: number): DailyPoint {
  return { insight_date: date, ctr: 0.03, cost_per_result: cpr, results: 1, spend: 80, impressions: 5000 }
}
/** Cost per result climbs 10 → 16 (+60%) with flat CTR → cost_per_result alert. */
function costBlowup(): DailyPoint[] {
  const d = (i: number) => `2026-07-${String(i).padStart(2, '0')}`
  return [
    ...Array.from({ length: 14 }, (_, i) => pt(d(i + 1), 10)),
    ...Array.from({ length: 7 }, (_, i) => pt(d(i + 15), 16)),
  ]
}

describe('judgeCampaign reason text follows the playbook', () => {
  const reasonFor = (industry: string | null) =>
    judgeCampaign(costBlowup(), undefined, industry).metrics.find(m => m.metric === 'cost_per_result')!.reason

  it('travel → 咨询 · real_estate → 线索 · null → 结果', () => {
    expect(reasonFor('travel')).toContain('每个咨询成本')
    expect(reasonFor('real_estate')).toContain('每个线索成本')
    expect(reasonFor(null)).toContain('每个结果成本')
    expect(reasonFor(null)).not.toContain('询盘')
  })
})

describe('prescribe review_offer copy follows the playbook', () => {
  const input = (industry: string | null): PrescribeInput => ({
    verdict: 'alert',
    metrics: [
      { metric: 'ctr', verdict: 'healthy', baseline: 0.03, recent: 0.03, ratio: 1, reason: 'x' },
      { metric: 'cost_per_result', verdict: 'alert', baseline: 10, recent: 16, ratio: 1.6, reason: 'x' },
    ],
    frequency_7d: 1.2,
    industry,
  })

  it('travel → 咨询 · real_estate → 线索 · null → 结果', () => {
    expect(prescribe(input('travel'))?.why).toContain('每个咨询变贵了')
    expect(prescribe(input('real_estate'))?.why).toContain('每个线索变贵了')
    expect(prescribe(input(null))?.why).toContain('每个结果变贵了')
    expect(prescribe(input(null))?.why).not.toContain('询盘')
  })
})

describe('digest buildBody result words follow the playbook', () => {
  const payload = {
    overall_verdict: 'alert' as const,
    headline: 'x',
    evaluated: 1,
    generated_for: '2026-07-20',
    campaigns: [
      { campaign_name: 'A', verdict: 'alert' as const, headline: 'h', latest_spend_7d: 100, latest_results_7d: 8 },
    ],
  }

  it('travel → 咨询 · real_estate → 线索 · null → 结果', () => {
    const travel = buildBody(payload, 'alert', 'https://x', 'travel')
    expect(travel).toContain('咨询 8')
    expect(travel).toContain('每个咨询 $12.5')
    expect(buildBody(payload, 'alert', 'https://x', 'real_estate')).toContain('每个线索 $12.5')
    const neutral = buildBody(payload, 'alert', 'https://x', null)
    expect(neutral).toContain('结果 8')
    expect(neutral).toContain('每个结果 $12.5')
    expect(neutral).not.toContain('询盘')
  })
})

describe('checkLaunch geo_mismatch copy follows the playbook', () => {
  const input = (industry: string | null): LaunchReadbackInput => ({
    adSet: {
      adSetId: 'AS1',
      adSetName: 'x',
      optimizationGoal: 'LINK_CLICKS',
      targeting: { geoNames: ['New Zealand'] },
      creatives: [{ adId: 'A1', adName: 'a', buyerFacingText: ['hello'] }],
    },
    expectedGeo: 'Auckland',
    industry,
  })
  const geoMessage = (industry: string | null) =>
    checkLaunch(input(industry)).findings.find(f => f.code === 'geo_mismatch')!.message

  it('real_estate → 房源 · travel → 客户服务市场 · null → 客户业务', () => {
    expect(geoMessage('real_estate')).toContain('房源在「Auckland」')
    expect(geoMessage('travel')).toContain('客户服务市场在「Auckland」')
    expect(geoMessage(null)).toContain('客户业务在「Auckland」')
    expect(geoMessage(null)).not.toContain('房源')
  })

  it('industry only changes words, never the verdict', () => {
    expect(checkLaunch(input('travel')).safeToActivate).toBe(false)
    expect(checkLaunch(input(null)).safeToActivate).toBe(false)
  })
})
