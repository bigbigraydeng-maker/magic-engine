import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { computeReturnLadder, type LadderInput } from '@/lib/ads-strategy/return-ladder/compute'
import { renderLadderBlock, renderLadderUnavailable, renderOtherLadders } from '../return-ladder-section'
import { renderWeeklyReport, type ClientWeekly, type WeeklyClients } from '../build'
import type { ClientReturnLadder, ReturnLadderSection } from '../return-ladder-gather'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ladderInput(overrides: Partial<LadderInput> = {}): LadderInput {
  return {
    asOfDate: '2026-10-09',
    timezone: 'Pacific/Auckland',
    timezoneCount: 1,
    spendRows: [
      {
        adAccountId: 'acct_a',
        platform: 'p1',
        insightDate: '2026-10-05',
        spend: 100,
        leads: 3,
        messagingConversations: 4,
      },
    ],
    accounts: [{ adAccountId: 'acct_a', currency: 'NZD' }],
    outcomes: [],
    contacts: [],
    salesCycleDays: null,
    primaryResult: null,
    configSource: 'row',
    spendIncomplete: false,
    ...overrides,
  }
}

function row(client_id: string, name: string): ClientReturnLadder {
  return { client_id, name, resultNoun: '咨询', ladder: computeReturnLadder(ladderInput()) }
}

function weekly(client_id: string, name: string): ClientWeekly {
  return {
    client_id,
    name,
    seo: {
      page1_now: 0,
      page1_prior: 0,
      top3_now: 0,
      movers_up: [],
      movers_down: [],
      gsc_clicks_28d: null,
      gsc_impressions_28d: null,
      findings_week: 0,
      freshness: { latest: '2026-10-08', stale: false },
    },
    auto_changes: {
      titles_applied_week: 0,
      titles_with_rank_baseline_week: 0,
      freshness: { latest: '2026-10-08', stale: false },
      outcomes_checked_week: [],
      cards_new_week: 0,
    },
    blog: {
      generated_week: 0,
      published_week: 0,
      awaiting_review: 0,
    },
    social: {
      posts_7d: null,
      reactions_7d: null,
      days_since_last_post: null,
      reels_awaiting: 0,
      freshness: { latest: '2026-10-08', stale: false },
    },
    ads: {
      spend_7d: null,
      leads_7d: null,
      messages_7d: null,
      freshness: { latest: '2026-10-08', stale: false },
    },
  }
}

function clientsWith(section: ReturnLadderSection | undefined, ...list: ClientWeekly[]): WeeklyClients {
  const out: WeeklyClients = [...list]
  out.return_ladders = section
  return out
}

// ---------------------------------------------------------------------------
// renderLadderBlock
// ---------------------------------------------------------------------------

describe('renderLadderBlock', () => {
  it('renders the block title, the reached level, and the backfill link when below level 5', () => {
    const html = renderLadderBlock(row('client_a', '甲客户'))
    expect(html).toContain('广告一本账')
    expect(html).toContain('算到第 2 级')
    expect(html).toContain('去回填 / 审核成交')
  })
})

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

describe('escaping', () => {
  it('escapes client names coming from data', () => {
    const html = renderOtherLadders({ rows: [row('client_a', '<script>x</script>')], failed: [] }, [])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes error text and still says it could not be read', () => {
    const html = renderLadderUnavailable('<b>boom</b>')
    expect(html).not.toContain('<b>boom')
    expect(html).toContain('没读出来')
  })
})

// ---------------------------------------------------------------------------
// renderOtherLadders
// ---------------------------------------------------------------------------

describe('renderOtherLadders', () => {
  it('returns empty string when there is no section', () => {
    expect(renderOtherLadders(undefined, [])).toBe('')
  })

  it('returns empty string when every row is already shown', () => {
    const html = renderOtherLadders({ rows: [row('client_a', '甲客户')], failed: [] }, ['client_a'])
    expect(html).toBe('')
  })

  it('shows only clients not already shown', () => {
    const html = renderOtherLadders(
      { rows: [row('client_a', '甲客户'), row('client_b', '乙客户')], failed: [] },
      ['client_a'],
    )
    expect(html).toContain('乙客户')
    expect(html).not.toContain('甲客户')
  })

  it('reports a whole-section read failure', () => {
    const html = renderOtherLadders({ error: 'timeout' }, [])
    expect(html).toContain('其它有广告的客户')
    expect(html).toContain('没读出来')
  })

  it('lists per-client failures', () => {
    const html = renderOtherLadders(
      { rows: [], failed: [{ client_id: 'client_b', name: '乙客户', error: 'x' }] },
      [],
    )
    expect(html).toContain('乙客户')
    expect(html).toContain('没读出来')
  })
})

// ---------------------------------------------------------------------------
// Wiring in renderWeeklyReport
// ---------------------------------------------------------------------------

describe('renderWeeklyReport wiring', () => {
  it('places the focus client ladder block after the ads block', () => {
    const html = renderWeeklyReport(
      clientsWith({ rows: [row('client_a', '甲客户')], failed: [] }, weekly('client_a', '甲客户')),
      'label',
    ).html
    const ladderIndex = html.indexOf('广告一本账')
    const adsIndex = html.indexOf('社媒广告')
    expect(ladderIndex).toBeGreaterThan(-1)
    expect(adsIndex).toBeGreaterThan(-1)
    expect(ladderIndex).toBeGreaterThan(adsIndex)
    expect(html.split('广告一本账').length - 1).toBe(1)
  })

  it('renders the other-clients section for clients outside the focus list', () => {
    const html = renderWeeklyReport(
      clientsWith(
        { rows: [row('client_a', '甲客户'), row('client_b', '乙客户')], failed: [] },
        weekly('client_a', '甲客户'),
      ),
      'label',
    ).html
    expect(html).toContain('其它有广告的客户')
    expect(html).toContain('乙客户')
  })

  it('renders no ladder block when no section is attached', () => {
    const withUndefined = renderWeeklyReport(clientsWith(undefined, weekly('client_a', '甲客户')), 'label').html
    expect(withUndefined).not.toContain('广告一本账')

    const plain: ClientWeekly[] = [weekly('client_a', '甲客户')]
    const withPlainArray = renderWeeklyReport(plain, 'label').html
    expect(withPlainArray).not.toContain('广告一本账')
  })

  it('reports a section read failure in the report', () => {
    const html = renderWeeklyReport(clientsWith({ error: 'timeout' }, weekly('client_a', '甲客户')), 'label').html
    expect(html).toContain('广告一本账')
    expect(html).toContain('没读出来')
  })

  it('never claims ROI for these level-2 fixtures', () => {
    const html = renderWeeklyReport(
      clientsWith({ rows: [row('client_a', '甲客户')], failed: [] }, weekly('client_a', '甲客户')),
      'label',
    ).html
    expect(html).not.toContain('ROI')
  })
})

describe('renderLadderBlock · every data-derived line is escaped', () => {
  it('escapes the result noun coming from the playbook / data', () => {
    const html = renderLadderBlock({ ...row('client_a', '甲客户'), resultNoun: '<i>x</i>' })
    expect(html).not.toContain('<i>x</i>')
    expect(html).toContain('&lt;i&gt;x&lt;/i&gt;')
  })
})
