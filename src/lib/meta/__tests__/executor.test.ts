/**
 * Tests for executor.ts pure helpers — P18.A.2
 */

import { describe, it, expect } from 'vitest'
import {
  parseCampaignState,
  parseAdSetState,
  gradeCampaignByRoas,
  buildAuditPayload,
} from '../executor'
import type { EntityState, AuditPayload } from '../executor'

// ── parseCampaignState ────────────────────────────────────────────────────────

describe('parseCampaignState', () => {
  it('parses active campaign', () => {
    const raw = { id: 'c1', name: 'Summer Sale', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '5000' }
    const state = parseCampaignState(raw)
    expect(state.id).toBe('c1')
    expect(state.name).toBe('Summer Sale')
    expect(state.status).toBe('ACTIVE')
    expect(state.daily_budget_cents).toBe(5000)
  })

  it('handles missing daily_budget', () => {
    const raw = { id: 'c2', name: 'No Budget', status: 'PAUSED', effective_status: 'PAUSED' }
    const state = parseCampaignState(raw)
    expect(state.daily_budget_cents).toBeNull()
  })

  it('parses string budget as number', () => {
    const raw = { id: 'c3', name: 'X', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '12345' }
    expect(parseCampaignState(raw).daily_budget_cents).toBe(12345)
  })
})

// ── parseAdSetState ───────────────────────────────────────────────────────────

describe('parseAdSetState', () => {
  it('parses ad set with bid amount', () => {
    const raw = { id: 'as1', name: 'Retargeting', status: 'ACTIVE', effective_status: 'ACTIVE', bid_amount: '200' }
    const state = parseAdSetState(raw)
    expect(state.id).toBe('as1')
    expect(state.bid_amount_cents).toBe(200)
  })

  it('handles missing bid_amount', () => {
    const raw = { id: 'as2', name: 'Auto Bid', status: 'ACTIVE', effective_status: 'ACTIVE' }
    expect(parseAdSetState(raw).bid_amount_cents).toBeNull()
  })
})

// ── gradeCampaignByRoas ───────────────────────────────────────────────────────

describe('gradeCampaignByRoas', () => {
  it('grades healthy when ROAS >= 2', () => {
    expect(gradeCampaignByRoas(2.5, 50)).toBe('healthy')
  })

  it('grades warning when ROAS 1-2', () => {
    expect(gradeCampaignByRoas(1.4, 50)).toBe('warning')
  })

  it('grades critical when ROAS < 1 and spend >= 10', () => {
    expect(gradeCampaignByRoas(0.5, 50)).toBe('critical')
  })

  it('grades healthy when spend < 10 regardless of ROAS', () => {
    expect(gradeCampaignByRoas(0.1, 5)).toBe('healthy')
  })

  it('grades warning when ROAS is exactly 1', () => {
    expect(gradeCampaignByRoas(1.0, 50)).toBe('warning')
  })

  it('grades healthy when roas is null (no conversions tracked)', () => {
    expect(gradeCampaignByRoas(null, 50)).toBe('healthy')
  })
})

// ── buildAuditPayload ─────────────────────────────────────────────────────────

describe('buildAuditPayload', () => {
  const before: EntityState = { id: 'c1', name: 'Campaign A', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget_cents: 5000, bid_amount_cents: null }
  const after: EntityState  = { id: 'c1', name: 'Campaign A', status: 'PAUSED', effective_status: 'PAUSED', daily_budget_cents: 5000, bid_amount_cents: null }

  it('includes before and after state', () => {
    const payload = buildAuditPayload('campaign', 'c1', before, after)
    expect(payload.before).toEqual(before)
    expect(payload.after).toEqual(after)
  })

  it('includes entity metadata', () => {
    const payload = buildAuditPayload('campaign', 'c1', before, after)
    expect(payload.entity_type).toBe('campaign')
    expect(payload.entity_id).toBe('c1')
  })

  it('sets rollback_action for paused entity', () => {
    const payload = buildAuditPayload('campaign', 'c1', before, after)
    expect(payload.rollback_action).toBe('restore_active')
  })

  it('sets rollback_action for bid adjust', () => {
    const beforeBid: EntityState = { ...before, bid_amount_cents: 200 }
    const afterBid: EntityState  = { ...before, bid_amount_cents: 160 }
    const payload = buildAuditPayload('ad_set', 'as1', beforeBid, afterBid)
    expect(payload.rollback_action).toBe('restore_bid')
  })
})
