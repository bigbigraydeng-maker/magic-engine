/**
 * Audience Ladder builder — Audience Asset Engine (P18.D).
 *
 * Turns the hand-built CTS intent ladder into a repeatable, per-client standard.
 * Rule shapes below are copied from the CTS production audiences that were read
 * back from Graph on 2026-07-29 (the ad set `Retargeting - VideoViewers +
 * FormOpeners`, which delivers leads at ~40% lower cost than the cold campaign).
 *
 * Spec: docs/superpowers/specs/2026-07-28-audience-asset-engine.md
 *
 * Design notes:
 *  - `planLadder()` is pure (no network) so the exact set of audiences can be
 *    reviewed — and unit tested — before anything is created.
 *  - `createLadder()` executes the plan, skipping audiences that already exist
 *    (matched by name) so re-runs are safe.
 *  - Clients without lead forms (e.g. Messenger-only) simply get fewer rungs;
 *    the gap is reported rather than silently ignored.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v19.0'

const DAY_SECONDS = 86_400

/** Rungs of the intent ladder, cold → converted. Order matters (index = depth). */
export type LadderStage =
  | 'page_engaged'    // L0 · touched the Page at all
  | 'page_messaged'   // L0 · opened a chat
  | 'page_video'      // L0 · watched any Page video
  | 'viewed'          // L1 · watched a specific video (15s / ThruPlay)
  | 'viewed_deep'     // L1 · watched a specific video to 50%
  | 'intent'          // L1 · opened a lead form, did not submit
  | 'converted'       // L1 · submitted — used as an EXCLUSION, never a target

/** Audiences that must never be targeted; they exist to be excluded. */
const EXCLUSION_STAGES: ReadonlySet<LadderStage> = new Set<LadderStage>(['converted'])

export interface LadderSpec {
  /** Short uppercase client code used in audience names, e.g. "ROMAN". */
  clientCode: string
  /** Ad account that will own the audiences, e.g. "act_1018365291238494". */
  adAccountId: string
  /** Page the engagement is sourced from. */
  pageId: string
  /** Specific video IDs to build per-content rungs from. Omit to skip them. */
  videoIds?: string[]
  /** Lead form IDs to build intent/converted rungs from. Omit to skip them. */
  leadFormIds?: string[]
  /** Retention for engagement rungs. Meta caps this at 365. */
  engagementRetentionDays?: number
  /** Retention for lead-form rungs. Meta caps this at 90. */
  leadFormRetentionDays?: number
}

export interface LadderPlanItem {
  stage: LadderStage
  /** Display name, per spec §6: `{AGENT} · {LAYER} · {SCOPE} · {WINDOW}`. */
  name: string
  layer: 'L0' | 'L1'
  retentionDays: number
  /** Meta `rule` payload, already JSON-stringified for the form body. */
  rule: string
  /** True when the audience exists purely to be excluded from targeting. */
  isExclusion: boolean
  /**
   * Whether this rule shape has been verified against the live API.
   * Page-source rules were created successfully on 2026-07-29; video-source
   * rules are copied from CTS production but not yet re-created by us.
   */
  verified: boolean
}

export interface LadderPlan {
  items: LadderPlanItem[]
  /** Rungs that could not be planned, with the reason (e.g. no lead forms). */
  gaps: Array<{ stage: LadderStage; reason: string }>
}

// ---------------------------------------------------------------------------
// Rule builders (pure)
// ---------------------------------------------------------------------------

/** Modern inclusions-form rule against a Page event source. */
function pageEventRule(pageId: string, event: string, retentionDays: number): string {
  return JSON.stringify({
    inclusions: {
      operator: 'or',
      rules: [
        {
          event_sources: [{ type: 'page', id: pageId }],
          retention_seconds: retentionDays * DAY_SECONDS,
          filter: { operator: 'and', filters: [{ field: 'event', operator: '=', value: event }] },
        },
      ],
    },
  })
}

/**
 * Per-video rule. Shape mirrors the CTS production audiences:
 * one entry per video, keyed by event name, scoped to the owning Page.
 */
function videoEventRule(videoIds: string[], pageId: string, event: string): string {
  return JSON.stringify(
    videoIds.map((videoId) => ({ event_name: event, object_id: videoId, context_id: pageId })),
  )
}

/** Lead-form rule covering both the Facebook and Instagram form surfaces. */
function leadFormRule(
  formIds: string[],
  pageId: string,
  event: string,
  retentionDays: number,
): string {
  const eventSources = formIds.flatMap((id) => [
    { type: 'lead', id, owner_id: pageId },
    { type: 'ig_lead_generation', id, owner_id: pageId },
  ])
  return JSON.stringify({
    inclusions: {
      operator: 'or',
      rules: [
        {
          event_sources: eventSources,
          retention_seconds: retentionDays * DAY_SECONDS,
          filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: event }] },
        },
      ],
    },
  })
}

/** Audience display name, per spec §6. Clients never see this string directly. */
export function ladderAudienceName(
  clientCode: string,
  layer: 'L0' | 'L1',
  scope: string,
  retentionDays: number,
): string {
  return `${clientCode} · ${layer} · ${scope} · ${retentionDays}d`
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Build the full ladder plan without touching the network.
 *
 * Retention is clamped to Meta's ceilings (365d engagement, 90d lead form)
 * rather than silently sending a value the API would reject.
 */
export function planLadder(spec: LadderSpec): LadderPlan {
  const engagementDays = Math.min(spec.engagementRetentionDays ?? 365, 365)
  const leadDays = Math.min(spec.leadFormRetentionDays ?? 90, 90)
  const { clientCode, pageId } = spec

  const items: LadderPlanItem[] = []
  const gaps: LadderPlan['gaps'] = []

  const l0: Array<[LadderStage, string, string]> = [
    ['page_engaged', 'page-eng', 'page_engaged'],
    ['page_messaged', 'page-msg', 'page_messaged'],
    ['page_video', 'page-vid', 'page_video_view'],
  ]
  for (const [stage, scope, event] of l0) {
    items.push({
      stage,
      name: ladderAudienceName(clientCode, 'L0', scope, engagementDays),
      layer: 'L0',
      retentionDays: engagementDays,
      rule: pageEventRule(pageId, event, engagementDays),
      isExclusion: false,
      verified: true,
    })
  }

  const videoIds = spec.videoIds ?? []
  if (videoIds.length > 0) {
    const rungs: Array<[LadderStage, string, string]> = [
      ['viewed', 'video-15s', 'video_view_15s'],
      ['viewed_deep', 'video-50', 'video_view_50_percent'],
    ]
    for (const [stage, scope, event] of rungs) {
      items.push({
        stage,
        name: ladderAudienceName(clientCode, 'L1', scope, engagementDays),
        layer: 'L1',
        retentionDays: engagementDays,
        rule: videoEventRule(videoIds, pageId, event),
        isExclusion: false,
        verified: false,
      })
    }
  } else {
    gaps.push({
      stage: 'viewed',
      reason: 'No videoIds supplied — per-content rungs skipped. Content-as-segmentation needs them.',
    })
  }

  const formIds = spec.leadFormIds ?? []
  if (formIds.length > 0) {
    const rungs: Array<[LadderStage, string, string]> = [
      ['intent', 'form-dropoff', 'lead_generation_dropoff'],
      ['converted', 'form-submitted', 'lead_generation_submitted'],
    ]
    for (const [stage, scope, event] of rungs) {
      items.push({
        stage,
        name: ladderAudienceName(clientCode, 'L1', scope, leadDays),
        layer: 'L1',
        retentionDays: leadDays,
        rule: leadFormRule(formIds, pageId, event, leadDays),
        isExclusion: EXCLUSION_STAGES.has(stage),
        verified: true,
      })
    }
  } else {
    gaps.push({
      stage: 'intent',
      reason:
        'No leadFormIds supplied — the intent rung has no equivalent yet. ' +
        'Messenger-first clients need a separate definition of "opened but did not convert".',
    })
  }

  return { items, gaps }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

interface ExistingAudience {
  id: string
  name: string
}

/** List custom audiences on an ad account (names + ids only). */
export async function listCustomAudiences(
  adAccountId: string,
  accessToken: string,
): Promise<ExistingAudience[]> {
  const url = `${GRAPH_BASE}/${adAccountId}/customaudiences?fields=id,name&limit=200&access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url)
  const json = (await res.json()) as {
    data?: ExistingAudience[]
    error?: { message: string; error_user_msg?: string }
  }
  if (!res.ok || json.error) {
    const msg = json.error?.error_user_msg || json.error?.message || `${res.status}`
    throw new Error(`listCustomAudiences ${adAccountId}: ${msg}`)
  }
  return json.data ?? []
}

async function createOne(
  adAccountId: string,
  item: LadderPlanItem,
  accessToken: string,
): Promise<string> {
  const body = new URLSearchParams({
    name: item.name,
    subtype: 'ENGAGEMENT',
    rule: item.rule,
    access_token: accessToken,
  })
  const res = await fetch(`${GRAPH_BASE}/${adAccountId}/customaudiences`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json()) as {
    id?: string
    error?: { message: string; error_user_msg?: string }
  }
  if (!res.ok || json.error) {
    const msg = json.error?.error_user_msg || json.error?.message || `${res.status}`
    throw new Error(`createLadder "${item.name}": ${msg}`)
  }
  if (!json.id) throw new Error(`createLadder "${item.name}": no id returned`)
  return json.id
}

export interface LadderResultItem extends LadderPlanItem {
  audienceId: string | null
  outcome: 'created' | 'already_exists' | 'failed'
  error?: string
}

export interface LadderResult {
  items: LadderResultItem[]
  gaps: LadderPlan['gaps']
}

/**
 * Create every rung in the plan that does not already exist.
 *
 * Existing audiences are matched by exact name, so a re-run is a no-op rather
 * than a source of duplicates. One failing rung does not abort the rest — the
 * per-item outcome is reported so a partial ladder is visible, not hidden.
 */
export async function createLadder(
  spec: LadderSpec,
  accessToken: string,
): Promise<LadderResult> {
  const plan = planLadder(spec)
  const existing = await listCustomAudiences(spec.adAccountId, accessToken)
  const byName = new Map(existing.map((a) => [a.name, a.id]))

  const items: LadderResultItem[] = []
  for (const item of plan.items) {
    const found = byName.get(item.name)
    if (found) {
      items.push({ ...item, audienceId: found, outcome: 'already_exists' })
      continue
    }
    try {
      const audienceId = await createOne(spec.adAccountId, item, accessToken)
      items.push({ ...item, audienceId, outcome: 'created' })
    } catch (err) {
      items.push({
        ...item,
        audienceId: null,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { items, gaps: plan.gaps }
}
