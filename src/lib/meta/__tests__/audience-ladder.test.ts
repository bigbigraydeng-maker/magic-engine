/**
 * Tests for meta/audience-ladder.ts — P18.D
 *
 * planLadder() is pure, so the exact audience set + rule shapes are verified
 * here without a Meta token. Rule shapes are checked against the CTS production
 * audiences read back from Graph on 2026-07-29.
 */

import { describe, it, expect } from 'vitest'
import { planLadder, ladderAudienceName, type LadderSpec } from '../audience-ladder'

const BASE: LadderSpec = {
  clientCode: 'ROMAN',
  adAccountId: 'act_1018365291238494',
  pageId: '227633594573276',
}

const FULL: LadderSpec = {
  ...BASE,
  videoIds: ['1054695836889645', '962958206315529'],
  leadFormIds: ['1328741742716400'],
}

describe('ladderAudienceName', () => {
  it('follows the {AGENT} · {LAYER} · {SCOPE} · {WINDOW} convention', () => {
    expect(ladderAudienceName('ROMAN', 'L1', 'video-50', 365)).toBe('ROMAN · L1 · video-50 · 365d')
  })
})

describe('planLadder — L0 rungs', () => {
  it('always plans the three Page-sourced rungs, even with no videos or forms', () => {
    const stages = planLadder(BASE).items.map((i) => i.stage)
    expect(stages).toEqual(['page_engaged', 'page_messaged', 'page_video'])
  })

  it('marks Page-sourced rules as verified (created successfully on 2026-07-29)', () => {
    expect(planLadder(BASE).items.every((i) => i.verified)).toBe(true)
  })

  it('scopes the Page rule to the supplied page and converts retention to seconds', () => {
    const item = planLadder(BASE).items.find((i) => i.stage === 'page_messaged')!
    const rule = JSON.parse(item.rule)
    const inner = rule.inclusions.rules[0]
    expect(inner.event_sources).toEqual([{ type: 'page', id: '227633594573276' }])
    expect(inner.retention_seconds).toBe(365 * 86_400)
    expect(inner.filter.filters[0].value).toBe('page_messaged')
  })
})

describe('planLadder — video rungs', () => {
  it('plans both video rungs when videoIds are supplied', () => {
    const stages = planLadder(FULL).items.map((i) => i.stage)
    expect(stages).toContain('viewed')
    expect(stages).toContain('viewed_deep')
  })

  it('emits one rule entry per video, scoped to the Page (CTS production shape)', () => {
    const item = planLadder(FULL).items.find((i) => i.stage === 'viewed_deep')!
    expect(JSON.parse(item.rule)).toEqual([
      { event_name: 'video_view_50_percent', object_id: '1054695836889645', context_id: '227633594573276' },
      { event_name: 'video_view_50_percent', object_id: '962958206315529', context_id: '227633594573276' },
    ])
  })

  it('flags video rules as unverified — the shape is copied, not yet re-created', () => {
    const item = planLadder(FULL).items.find((i) => i.stage === 'viewed')!
    expect(item.verified).toBe(false)
  })

  it('reports a gap instead of silently skipping when no videos are supplied', () => {
    const { gaps } = planLadder(BASE)
    expect(gaps.some((g) => g.stage === 'viewed')).toBe(true)
  })
})

describe('planLadder — lead form rungs', () => {
  it('covers both the Facebook and Instagram form surfaces', () => {
    const item = planLadder(FULL).items.find((i) => i.stage === 'intent')!
    const sources = JSON.parse(item.rule).inclusions.rules[0].event_sources
    expect(sources).toEqual([
      { type: 'lead', id: '1328741742716400', owner_id: '227633594573276' },
      { type: 'ig_lead_generation', id: '1328741742716400', owner_id: '227633594573276' },
    ])
  })

  it('marks the converted rung as an exclusion so it is never targeted', () => {
    const items = planLadder(FULL).items
    expect(items.find((i) => i.stage === 'converted')!.isExclusion).toBe(true)
    expect(items.find((i) => i.stage === 'intent')!.isExclusion).toBe(false)
  })

  it('reports the Messenger-first gap rather than pretending the rung exists', () => {
    // Roman runs Messenger, not lead forms — the intent rung has no equivalent yet.
    const { gaps } = planLadder({ ...BASE, videoIds: ['123'] })
    const gap = gaps.find((g) => g.stage === 'intent')
    expect(gap?.reason).toContain('Messenger')
  })
})

describe('planLadder — retention ceilings', () => {
  it('clamps engagement retention to Meta\'s 365-day ceiling', () => {
    const item = planLadder({ ...BASE, engagementRetentionDays: 999 }).items[0]
    expect(item.retentionDays).toBe(365)
  })

  it('clamps lead form retention to Meta\'s 90-day ceiling', () => {
    const spec = { ...FULL, leadFormRetentionDays: 400 }
    const item = planLadder(spec).items.find((i) => i.stage === 'intent')!
    expect(item.retentionDays).toBe(90)
    expect(JSON.parse(item.rule).inclusions.rules[0].retention_seconds).toBe(90 * 86_400)
  })

  it('honours a shorter retention when explicitly requested', () => {
    const item = planLadder({ ...BASE, engagementRetentionDays: 30 }).items[0]
    expect(item.retentionDays).toBe(30)
    expect(item.name).toContain('30d')
  })
})

describe('planLadder — full ladder', () => {
  it('plans all seven rungs with no gaps when videos and forms are supplied', () => {
    const { items, gaps } = planLadder(FULL)
    expect(items).toHaveLength(7)
    expect(gaps).toHaveLength(0)
  })

  it('produces unique names so re-runs can match existing audiences safely', () => {
    const names = planLadder(FULL).items.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
