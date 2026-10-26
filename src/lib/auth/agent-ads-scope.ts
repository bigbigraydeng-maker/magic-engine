/**
 * Ads-agent identity policy.
 *
 * A client API key whose scopes are exactly `ads:plan-draft` may only read a
 * plan seed or save an unapproved draft. Every other action is denied.
 * Issuing the key, the two allowed routes, and rate limits are later cuts.
 */

export const AGENT_ADS_SCOPE = 'ads:plan-draft'

/** mcp_access_log.tool value for a denied ads-agent call. */
export const AGENT_ADS_DENY_TOOL = 'ads_agent_deny'

export const AGENT_ADS_ALLOWED_ACTIONS = ['plan_seed_read', 'plan_draft_save'] as const

export const AGENT_ADS_PRIVILEGED_ACTIONS = [
  'approve',
  'launch',
  'change_budget',
  'change_cap',
  'upload_audience',
  'write_meta',
] as const

export type AgentAdsAllowedAction = (typeof AGENT_ADS_ALLOWED_ACTIONS)[number]
export type AgentAdsPrivilegedAction = (typeof AGENT_ADS_PRIVILEGED_ACTIONS)[number]

const ALLOWED = new Set<string>(AGENT_ADS_ALLOWED_ACTIONS)
const PRIVILEGED = new Set<string>(AGENT_ADS_PRIVILEGED_ACTIONS)

export function isExactAgentAdsScope(scopes: readonly string[]): boolean {
  const unique = new Set(scopes)
  return unique.size === 1 && unique.has(AGENT_ADS_SCOPE)
}

export function scopeIncludesAgentAds(scopes: readonly string[]): boolean {
  return scopes.includes(AGENT_ADS_SCOPE)
}

/** Meta execute carries launch, budget edits, and other writes on one route. */
export function metaExecuteDenialAction(actionType: string): 'launch' | 'change_budget' | 'write_meta' {
  if (actionType === 'ads.reactivate_campaign') return 'launch'
  if (actionType === 'ads.adjust_bid') return 'change_budget'
  return 'write_meta'
}

export interface AgentAdsIdentity {
  keyId: string
  clientId: string
  scopes: readonly string[]
  expiresAt: string | null
}

export interface AgentAdsAllow {
  ok: true
  status: 200
  code: 'allowed'
  log: false
}

export interface AgentAdsDeny {
  ok: false
  status: 403
  code: string
  log: true
  keyId: string
  clientId: string
}

export function decideAgentAdsAccess(input: {
  identity: AgentAdsIdentity
  requestedClientId: string
  action: string
  nowMs: number
}): AgentAdsAllow | AgentAdsDeny {
  const { identity, requestedClientId, action, nowMs } = input
  if (!isExactAgentAdsScope(identity.scopes)) return deny(identity, 'wrong_scope')
  if (identity.clientId !== requestedClientId) return deny(identity, 'client_mismatch')
  if (!expiryStillValid(identity.expiresAt, nowMs)) {
    return deny(identity, identity.expiresAt ? 'expired' : 'missing_expiry')
  }
  if (ALLOWED.has(action)) return { ok: true, status: 200, code: 'allowed', log: false }
  const code = PRIVILEGED.has(action) ? action : 'outside_allowlist'
  return deny(identity, code)
}

function deny(identity: AgentAdsIdentity, code: string): AgentAdsDeny {
  return {
    ok: false,
    status: 403,
    code,
    log: true,
    keyId: identity.keyId,
    clientId: identity.clientId,
  }
}

function expiryStillValid(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false
  const parsed = Date.parse(expiresAt)
  return Number.isFinite(parsed) && parsed > nowMs
}
