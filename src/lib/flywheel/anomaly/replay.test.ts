/**
 * HISTORICAL REPLAY — the acceptance test for the standing watchers.
 *
 * Thresholds that pass synthetic tests but miss the incidents we actually had
 * are worthless. So these tests replay REAL rows pulled from production
 * (Supabase project glbdnayojixmexgofbsd, queried 2026-08-02) and assert the
 * watchers would have caught the three failures a human caught late.
 *
 * If someone tunes a threshold and one of these goes red, the tuning made the
 * detector blind to something that has genuinely happened. That is the point.
 *
 * Fixtures are verbatim query output — do not "tidy" the numbers.
 */

import { describe, it, expect } from 'vitest'
import { runWatchersOverSnapshot, type ClientSnapshot } from './WatcherJob'
import type { AdEntityHistory } from './watchers/types'
import type { RosterClient } from './roster'

// ── Fixture 1 · CTS "Lead Form — Reborn" ──────────────────────────────────────
// SELECT insight_date, spend, results, leads, impressions FROM ad_daily_insights
// WHERE level='campaign' AND entity_name='CTS — Lead Form — Reborn — 20260624'
//
// Note the shape of the failure: 07-20 spends and returns nothing, then rows
// STOP ENTIRELY until 07-28. A value-threshold rule has nothing to compare
// against for 07-21..07-27, which is exactly why it went unnoticed.
const CTS_REBORN: [string, number, number][] = [
  ['2026-06-24', 50.44, 18], ['2026-06-25', 61.27, 10], ['2026-06-26', 62.4, 7],
  ['2026-06-27', 73.17, 12], ['2026-06-28', 94.7, 36], ['2026-06-29', 88.67, 23],
  ['2026-06-30', 80.69, 16], ['2026-07-01', 85.29, 18], ['2026-07-02', 75.08, 16],
  ['2026-07-03', 76.92, 18], ['2026-07-04', 78.03, 10], ['2026-07-05', 87.51, 24],
  ['2026-07-06', 81.71, 14], ['2026-07-07', 74.87, 10], ['2026-07-08', 74.84, 22],
  ['2026-07-09', 83.64, 8],  ['2026-07-10', 81.71, 14], ['2026-07-11', 89.72, 6],
  ['2026-07-12', 87.26, 18], ['2026-07-13', 81.77, 16], ['2026-07-14', 80.13, 10],
  ['2026-07-15', 78.53, 18], ['2026-07-16', 79.39, 6],  ['2026-07-17', 82.38, 15],
  ['2026-07-18', 84.35, 15], ['2026-07-19', 89.7, 19],
  ['2026-07-20', 34.82, 0],
  // ── 2026-07-21 .. 2026-07-27: no rows at all ──
  ['2026-07-28', 35.72, 11], ['2026-07-29', 40.01, 7], ['2026-07-30', 36.66, 10],
  ['2026-07-31', 20.21, 2],
]

/** Build the campaign history as it stood on a given date. */
function ctsHistoryAsOf(date: string): AdEntityHistory {
  return {
    entityId: '120211000000000001',
    entityName: 'CTS — Lead Form — Reborn — 20260624',
    days: CTS_REBORN.filter(([d]) => d <= date).map(([insightDate, spend, results]) => ({
      insightDate,
      spend,
      results,
      leads: Math.floor(results / 2),
      impressions: 0,
    })),
  }
}

const CTS_CLIENT: RosterClient = {
  id: 'c0000000-0000-0000-0000-000000000000',
  name: 'CTS Tours NZ',
  createdAt: '2026-04-27T00:00:00Z',
  facebookPageId: '1616575215312482',
  metaAdAccountId: 'act_2775766642787274',
}

function ctsSnapshotAsOf(date: string): ClientSnapshot {
  return {
    client: CTS_CLIENT,
    adHistories: [ctsHistoryAsOf(date)],
    observedThrough: CTS_REBORN.filter(([d]) => d <= date).slice(-1)[0][0],
    lastContentAt: '2026-08-01',
    contentExpected: true,
    recentDailyAdSpendAud: 80,
    firstAdSpendDate: '2026-06-24',
    pageAlreadyChecked: true,
  }
}

describe('replay · CTS "Lead Form — Reborn" stopped after 2026-07-20', () => {
  it('catches the wasted spend ON 07-20, the first day it was knowable', () => {
    const signals = runWatchersOverSnapshot(ctsSnapshotAsOf('2026-07-20'), '2026-07-20')
    const hit = signals.find(s => s.ruleId === 'ad-spend-no-result')

    expect(hit).toBeDefined()
    // 什么变了
    expect(hit!.whatChanged).toContain('0 results')
    // 影响多少钱 — the real recorded spend, not an estimate
    expect(hit!.moneyImpactAud).toBe(34.82)
    // 已经多久了
    expect(hit!.daysOngoing).toBe(1)
    // Restarting/pausing a campaign moves money and is customer-facing.
    expect(hit!.disposition).toBe('needs_approval')
  })

  it('catches the campaign going dark on 07-23, three days into the blackout', () => {
    // The row for 07-20 is the newest that exists; 07-21..07-23 are absent.
    const signals = runWatchersOverSnapshot(ctsSnapshotAsOf('2026-07-23'), '2026-07-23')
    const hit = signals.find(s => s.ruleId === 'ad-delivery-dark')

    expect(hit).toBeDefined()
    expect(hit!.daysOngoing).toBe(3)
    expect(hit!.whatChanged).toContain('spent nothing since 2026-07-20')
    expect(hit!.moneyImpactAud).toBeGreaterThan(0)
    expect(hit!.disposition).toBe('needs_approval')
  })

  it('escalates to high severity by 07-27, the day a human finally noticed', () => {
    const signals = runWatchersOverSnapshot(ctsSnapshotAsOf('2026-07-27'), '2026-07-27')
    const hit = signals.find(s => s.ruleId === 'ad-delivery-dark')

    expect(hit).toBeDefined()
    expect(hit!.severity).toBe('high')
    expect(hit!.daysOngoing).toBe(7)
    // ~$75.61/day average over its last 7 spending days x 7 dark days.
    expect(hit!.moneyImpactAud).toBeGreaterThan(400)
    expect(hit!.moneyBasis).toContain('forgone deployment')
  })

  it('does not double-report: the wasted-spend rule stays quiet during the blackout', () => {
    // 07-20 was already reported on its own day. Re-reporting it every day for
    // a week is how a watcher trains people to ignore it.
    const signals = runWatchersOverSnapshot(ctsSnapshotAsOf('2026-07-25'), '2026-07-25')

    expect(signals.filter(s => s.ruleId === 'ad-spend-no-result')).toHaveLength(0)
  })

  it('goes quiet once the campaign is back on 07-31', () => {
    const signals = runWatchersOverSnapshot(ctsSnapshotAsOf('2026-07-31'), '2026-07-31')

    expect(signals.filter(s => s.watcherId === 'ad-delivery')).toHaveLength(0)
  })

  it('stays silent through the healthy stretch before the incident', () => {
    // No false alarms across two weeks of normal delivery — a watcher that
    // cries wolf during good weeks is worse than none.
    for (const date of ['2026-07-05', '2026-07-10', '2026-07-15', '2026-07-19']) {
      const signals = runWatchersOverSnapshot(ctsSnapshotAsOf(date), date)
      expect(signals.filter(s => s.watcherId === 'ad-delivery')).toHaveLength(0)
    }
  })
})

// ── Fixture 2 · Oztop content drought ─────────────────────────────────────────
// Latest production across flywheel_actions / reels_drafts / content_posts for
// client d5c98811: 2026-07-14, then nothing until 2026-07-31.
const OZTOP_CLIENT: RosterClient = {
  id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84',
  name: 'oztop',
  createdAt: '2026-05-13T00:00:00Z',
  facebookPageId: null,
  metaAdAccountId: 'act_1735240120460765',
}

function oztopSnapshot(lastContentAt: string | null): ClientSnapshot {
  return {
    client: OZTOP_CLIENT,
    adHistories: [],
    observedThrough: null,
    lastContentAt,
    contentExpected: lastContentAt !== null,
    // Oztop's "Cold Broad" campaign was live throughout at roughly $65/day.
    recentDailyAdSpendAud: 65.78,
    firstAdSpendDate: '2026-06-21',
    pageAlreadyChecked: false,
  }
}

describe('replay · Oztop produced nothing 2026-07-14 → 2026-07-31', () => {
  it('catches the drought on 07-27, the day a human noticed it', () => {
    const signals = runWatchersOverSnapshot(oztopSnapshot('2026-07-14'), '2026-07-27')
    const hit = signals.find(s => s.ruleId === 'content-drought')

    expect(hit).toBeDefined()
    expect(hit!.daysOngoing).toBe(13)
    expect(hit!.whatChanged).toContain('2026-07-14')
    // Money line is real: ads kept running behind stale content.
    expect(hit!.moneyImpactAud).toBeCloseTo(65.78 * 13, 1)
    expect(hit!.moneyBasis).toContain('Ad spend still running behind stale content')
  })

  it('fires as early as 07-22, five days before the human caught it', () => {
    const signals = runWatchersOverSnapshot(oztopSnapshot('2026-07-14'), '2026-07-22')

    expect(signals.find(s => s.ruleId === 'content-drought')).toBeDefined()
  })

  it('escalates to high once the silence passes two weeks', () => {
    const signals = runWatchersOverSnapshot(oztopSnapshot('2026-07-14'), '2026-07-28')
    const hit = signals.find(s => s.ruleId === 'content-drought')

    expect(hit!.severity).toBe('high')
  })

  it('is a classify-only auto: drafting content spends nothing and stays internal', () => {
    const signals = runWatchersOverSnapshot(oztopSnapshot('2026-07-14'), '2026-07-27')
    const hit = signals.find(s => s.ruleId === 'content-drought')

    expect(hit!.disposition).toBe('auto')
    expect(hit!.remedy).toEqual({
      spendsMoney: false,
      customerFacing: false,
      hardToReverse: false,
    })
  })

  it('stays quiet during the earlier 8-day gap, which is under threshold', () => {
    // 2026-06-24 → 2026-07-02 was a real gap but a normal one. The threshold
    // has to tell "quiet week" apart from "abandoned".
    const signals = runWatchersOverSnapshot(oztopSnapshot('2026-06-24'), '2026-07-01')

    expect(signals.filter(s => s.ruleId === 'content-drought')).toHaveLength(0)
  })
})

// ── Fixture 3 · Roman HU page automation ──────────────────────────────────────
// Client created 2026-06-18. First ad spend 2026-07-27 — the 30 Kiteroa launch,
// 39 days later. Page 227633594573276 answered English buyers in Chinese.
const ROMAN_CLIENT: RosterClient = {
  id: 'e7465ac7-4f3d-4d6a-afbe-d036ab419708',
  name: 'Roman HU',
  createdAt: '2026-06-18T00:00:00Z',
  facebookPageId: '227633594573276',
  metaAdAccountId: 'act_1018365291238494',
}

function romanSnapshot(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    client: ROMAN_CLIENT,
    adHistories: [],
    observedThrough: '2026-07-27',
    lastContentAt: '2026-06-22',
    contentExpected: true,
    recentDailyAdSpendAud: 37.66,
    firstAdSpendDate: '2026-07-27',
    pageAlreadyChecked: false,
    ...overrides,
  }
}

describe('replay · Roman HU Page 227633594573276 answered English buyers in Chinese', () => {
  it('raises the check on 07-27, the day paid traffic first hit the Page', () => {
    const signals = runWatchersOverSnapshot(romanSnapshot(), '2026-07-27')
    const hit = signals.find(s => s.ruleId === 'page-automation-unverified')

    expect(hit).toBeDefined()
    expect(hit!.entityId).toBe('227633594573276')
    expect(hit!.severity).toBe('high')
  })

  it('REGRESSION: the old client-age trigger would have missed this entirely', () => {
    // Roman HU was 39 days old when traffic started — outside any 30-day
    // "newly adopted client" window. Anchoring on first spend is what makes the
    // rule fire at all. If someone reverts to client age, this goes red.
    const client = romanSnapshot().client
    const ageAtLaunch =
      (Date.parse('2026-07-27') - Date.parse(client.createdAt)) / 86_400_000

    expect(ageAtLaunch).toBeGreaterThan(30)

    const signals = runWatchersOverSnapshot(romanSnapshot(), '2026-07-27')
    expect(signals.find(s => s.ruleId === 'page-automation-unverified')).toBeDefined()
  })

  it('is explicitly honest that ME never actually read the Page settings', () => {
    const hit = runWatchersOverSnapshot(romanSnapshot(), '2026-07-27').find(
      s => s.ruleId === 'page-automation-unverified'
    )

    // The whole value of this hand is that it does not pretend to have checked.
    expect(hit!.requiresManualVerification).toBe(true)
    expect(hit!.whatChanged).toContain('CANNOT READ')
    expect(hit!.disposition).toBe('needs_approval')
  })

  it('asks once, not every day — it goes quiet after it has been raised', () => {
    const signals = runWatchersOverSnapshot(
      romanSnapshot({ pageAlreadyChecked: true }),
      '2026-07-28'
    )

    expect(signals.filter(s => s.ruleId === 'page-automation-unverified')).toHaveLength(0)
  })

  it('does not nag about a Page whose traffic started months ago', () => {
    const signals = runWatchersOverSnapshot(
      romanSnapshot({ firstAdSpendDate: '2026-04-01' }),
      '2026-07-27'
    )

    expect(signals.filter(s => s.ruleId === 'page-automation-unverified')).toHaveLength(0)
  })
})

// ── Fixture 4 · Type B must not be nagged about content ───────────────────────
// 30 Kiteroa Rothesay Bay buys leads, not content: no flywheel_actions, no
// reels_drafts, no content_posts, ever.
describe('replay · Type B client 30 Kiteroa is never flagged for content', () => {
  const KITEROA: RosterClient = {
    id: '5a3fb2b7-72c3-471e-a5e7-1a528c0f776c',
    name: '30 Kiteroa Rothesay Bay',
    createdAt: '2026-07-27T00:00:00Z',
    facebookPageId: null,
    metaAdAccountId: null,
  }

  const snapshot: ClientSnapshot = {
    client: KITEROA,
    adHistories: [],
    observedThrough: null,
    lastContentAt: null,
    contentExpected: false,
    recentDailyAdSpendAud: 0,
    firstAdSpendDate: null,
    pageAlreadyChecked: false,
  }

  it('stays silent even 100 days in', () => {
    const signals = runWatchersOverSnapshot(snapshot, '2026-11-04')

    expect(signals.filter(s => s.ruleId === 'content-drought')).toHaveLength(0)
  })

  it('would fire for the same silence if the client WERE on a content line', () => {
    // Proves the silence is long enough to trip the rule, and that
    // contentExpected is the only thing holding it back — not an accident of
    // the fixture.
    const asTypeA = { ...snapshot, contentExpected: true, lastContentAt: '2026-07-27' }
    const signals = runWatchersOverSnapshot(asTypeA, '2026-11-04')

    expect(signals.find(s => s.ruleId === 'content-drought')).toBeDefined()
  })
})
