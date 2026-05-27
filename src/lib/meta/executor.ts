/**
 * Meta Graph API — Ads mutation executor
 *
 * P18.A.2: Pause campaigns/ad sets and adjust bids via Meta Graph API.
 * Pure helpers are exported for testability; HTTP functions use META_SYSTEM_USER_TOKEN.
 *
 * Safety constraints (per CLAUDE.md security boundary):
 *   - Bid adjustments capped at ±20% of current bid
 *   - Only pause/unpause and bid adjustments — no campaign creation or deletion
 */

const GRAPH_BASE = 'https://graph.facebook.com/v19.0'

// ── Types ──────────────────────────────────────────────────────────────────────

export type EntityType = 'campaign' | 'ad_set'
export type RoasGrade  = 'healthy' | 'warning' | 'critical'
export type RollbackAction = 'restore_active' | 'restore_bid' | 'none'

export interface EntityState {
  id: string
  name: string
  status: string
  effective_status: string
  /** Meta stores budgets in account currency cents (AUD cents for AU clients) */
  daily_budget_cents: number | null
  bid_amount_cents: number | null
}

export interface AuditPayload {
  entity_type: EntityType
  entity_id: string
  before: EntityState
  after: EntityState
  rollback_action: RollbackAction
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

export function parseCampaignState(raw: Record<string, unknown>): EntityState {
  return {
    id:                 String(raw.id ?? ''),
    name:               String(raw.name ?? ''),
    status:             String(raw.status ?? ''),
    effective_status:   String(raw.effective_status ?? ''),
    daily_budget_cents: raw.daily_budget != null ? Number(raw.daily_budget) : null,
    bid_amount_cents:   null,
  }
}

export function parseAdSetState(raw: Record<string, unknown>): EntityState {
  return {
    id:                 String(raw.id ?? ''),
    name:               String(raw.name ?? ''),
    status:             String(raw.status ?? ''),
    effective_status:   String(raw.effective_status ?? ''),
    daily_budget_cents: raw.daily_budget != null ? Number(raw.daily_budget) : null,
    bid_amount_cents:   raw.bid_amount  != null ? Number(raw.bid_amount)  : null,
  }
}

/**
 * Grade a campaign's health based on ROAS and spend.
 *
 * healthy  — ROAS ≥ 2, OR spend too low to judge (< $10)
 * warning  — ROAS 1–2 (break-even or marginal)
 * critical — ROAS < 1 with meaningful spend (≥ $10)
 */
export function gradeCampaignByRoas(roas: number | null, spend: number): RoasGrade {
  if (spend < 10) return 'healthy'
  if (roas === null) return 'healthy'
  if (roas >= 2)    return 'healthy'
  if (roas >= 1)    return 'warning'
  return 'critical'
}

export function buildAuditPayload(
  entityType: EntityType,
  entityId: string,
  before: EntityState,
  after: EntityState,
): AuditPayload {
  let rollback_action: RollbackAction = 'none'

  if (before.status === 'ACTIVE' && after.status === 'PAUSED') {
    rollback_action = 'restore_active'
  } else if (
    before.bid_amount_cents !== null &&
    after.bid_amount_cents !== null &&
    before.bid_amount_cents !== after.bid_amount_cents
  ) {
    rollback_action = 'restore_bid'
  }

  return { entity_type: entityType, entity_id: entityId, before, after, rollback_action }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function token(): string {
  return process.env.META_SYSTEM_USER_TOKEN ?? ''
}

/**
 * Fetch current state of a campaign (for before-snapshot).
 */
export async function fetchCampaignState(campaignId: string): Promise<EntityState | null> {
  const params = new URLSearchParams({
    fields: 'id,name,status,effective_status,daily_budget',
    access_token: token(),
  })
  try {
    const res = await fetch(`${GRAPH_BASE}/${campaignId}?${params}`)
    if (!res.ok) return null
    const data = await res.json() as Record<string, unknown>
    return parseCampaignState(data)
  } catch {
    return null
  }
}

/**
 * Fetch current state of an ad set (for before-snapshot).
 */
export async function fetchAdSetState(adSetId: string): Promise<EntityState | null> {
  const params = new URLSearchParams({
    fields: 'id,name,status,effective_status,daily_budget,bid_amount',
    access_token: token(),
  })
  try {
    const res = await fetch(`${GRAPH_BASE}/${adSetId}?${params}`)
    if (!res.ok) return null
    const data = await res.json() as Record<string, unknown>
    return parseAdSetState(data)
  } catch {
    return null
  }
}

/**
 * Pause a campaign or ad set.
 * Returns true on success, false if the API call fails.
 */
export async function pauseEntity(entityId: string): Promise<boolean> {
  const params = new URLSearchParams({
    status: 'PAUSED',
    access_token: token(),
  })
  try {
    const res = await fetch(`${GRAPH_BASE}/${entityId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/executor] pauseEntity ${entityId} failed ${res.status}:`, body.slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error('[meta/executor] pauseEntity fetch error:', err)
    return false
  }
}

/**
 * Restore a paused entity to ACTIVE.
 */
export async function restoreActive(entityId: string): Promise<boolean> {
  const params = new URLSearchParams({
    status: 'ACTIVE',
    access_token: token(),
  })
  try {
    const res = await fetch(`${GRAPH_BASE}/${entityId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Adjust the bid amount on an ad set.
 *
 * @param adSetId         Meta ad set ID
 * @param newBidCents     New bid in account currency cents (e.g. 160 = $1.60 AUD)
 * @param currentBidCents Current bid — used to enforce ±20% cap
 */
export async function adjustAdSetBid(
  adSetId: string,
  newBidCents: number,
  currentBidCents: number,
): Promise<{ success: boolean; capped: boolean; appliedBid: number }> {
  const maxDelta = currentBidCents * 0.20
  const minBid   = Math.round(currentBidCents - maxDelta)
  const maxBid   = Math.round(currentBidCents + maxDelta)

  const capped      = newBidCents < minBid || newBidCents > maxBid
  const appliedBid  = Math.min(maxBid, Math.max(minBid, newBidCents))

  const params = new URLSearchParams({
    bid_amount:   String(appliedBid),
    access_token: token(),
  })

  try {
    const res = await fetch(`${GRAPH_BASE}/${adSetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    return { success: res.ok, capped, appliedBid }
  } catch {
    return { success: false, capped, appliedBid }
  }
}
