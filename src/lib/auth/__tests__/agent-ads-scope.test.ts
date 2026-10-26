import { describe, expect, it } from 'vitest'
import {
  AGENT_ADS_ALLOWED_ACTIONS,
  AGENT_ADS_PRIVILEGED_ACTIONS,
  AGENT_ADS_SCOPE,
  decideAgentAdsAccess,
  isExactAgentAdsScope,
  metaExecuteDenialAction,
  type AgentAdsIdentity,
} from '../agent-ads-scope'

const KEY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = Date.parse('2026-10-27T00:00:00.000Z')

function identity(overrides: Partial<AgentAdsIdentity> = {}): AgentAdsIdentity {
  return {
    keyId: KEY_ID,
    clientId: CLIENT_ID,
    scopes: [AGENT_ADS_SCOPE],
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function decide(action: string, overrides: Partial<AgentAdsIdentity> = {}, clientId = CLIENT_ID) {
  return decideAgentAdsAccess({
    identity: identity(overrides),
    requestedClientId: clientId,
    action,
    nowMs: NOW,
  })
}

describe('ads agent scope policy', () => {
  it('allows only the two named read and draft actions', () => {
    for (const action of AGENT_ADS_ALLOWED_ACTIONS) {
      expect(decide(action)).toEqual({ ok: true, status: 200, code: 'allowed', log: false })
    }
  })

  it('denies approve, launch, budget, cap, audience upload, and Meta writes', () => {
    for (const action of AGENT_ADS_PRIVILEGED_ACTIONS) {
      expect(decide(action)).toMatchObject({ ok: false, status: 403, code: action, log: true })
    }
  })

  it('denies an action that is not on the allowlist', () => {
    expect(decide('read_settings')).toMatchObject({ ok: false, status: 403, code: 'outside_allowlist' })
  })

  it('rejects a normal read-all key and a key that mixes in the agent scope', () => {
    expect(isExactAgentAdsScope(['read:all'])).toBe(false)
    expect(decide('plan_seed_read', { scopes: ['read:all'] }).code).toBe('wrong_scope')
    expect(decide('plan_seed_read', { scopes: [AGENT_ADS_SCOPE, 'read:all'] }).code).toBe('wrong_scope')
  })

  it('rejects a key locked to another client', () => {
    const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    expect(decide('plan_seed_read', {}, other)).toMatchObject({ code: 'client_mismatch', log: true })
  })

  it('rejects a key with no expiry and a key that has already expired', () => {
    expect(decide('plan_draft_save', { expiresAt: null }).code).toBe('missing_expiry')
    expect(decide('plan_draft_save', { expiresAt: '2000-01-01T00:00:00.000Z' }).code).toBe('expired')
  })

  it('maps Meta execute types onto launch, budget, or a Meta write', () => {
    expect(metaExecuteDenialAction('ads.reactivate_campaign')).toBe('launch')
    expect(metaExecuteDenialAction('ads.adjust_bid')).toBe('change_budget')
    expect(metaExecuteDenialAction('ads.pause_campaign')).toBe('write_meta')
    expect(metaExecuteDenialAction('something_else')).toBe('write_meta')
  })
})
