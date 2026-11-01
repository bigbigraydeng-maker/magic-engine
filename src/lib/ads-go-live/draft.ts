/**
 * Read a paused draft that is already waiting for approval.
 * This card does not create the draft. Blade 11 owns that entry.
 * Optional `accountLabel` on the payload is the seam for that draft's account name.
 */

const DRAFT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,64}$/

export interface GoLiveIds {
  readonly campaignId: string
  readonly adSetId: string
  readonly adIds: readonly string[]
  /**
   * This campaign already existed. Go-live may switch the new ad set and ads,
   * and must not turn the campaign on or off.
   */
  readonly reusedCampaign?: boolean
  /** This ad set already existed. Go-live may switch only the new ads. */
  readonly reusedAdSet?: boolean
}

export interface PausedDraftView {
  readonly status: string
  readonly kind: string | null
  readonly dailyBudget: number | null
  readonly durationDays: number | null
  readonly accountLabel: string | null
  readonly ids: GoLiveIds | null
  /** The daily amount and span were read from an existing ad set, not the draft request. */
  readonly inheritedSchedule?: boolean
  /** Absolute end time copied from the ad set. Null means that ad set has no end. */
  readonly endTime?: string | null
}

export function goLiveSubjectKey(draftId: string): string | null {
  const id = draftId.trim().toLowerCase()
  if (!DRAFT_ID_RE.test(id)) return null
  return `go-live:${id}`
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const ids = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return ids.length === value.length ? ids : null
}

export function parsePausedDraft(payload: unknown): PausedDraftView | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const row = payload as Record<string, unknown>
  const status = text(row.status)
  if (!status) return null
  const draft = row.draft
  const body = draft && typeof draft === 'object' && !Array.isArray(draft)
    ? draft as Record<string, unknown>
    : null
  const campaignId = text(row.campaignId)
  const adSetId = text(row.adSetId)
  const adIds = idList(row.adIds)
  const reusedAdSet = Boolean(body && text(body.existingAdSetId))
  const reusedCampaign = Boolean(body && text(body.existingCampaignId)) || reusedAdSet
  const spend = reusedAdSet ? storedSpend(body) : null
  return {
    status,
    kind: body ? text(body.kind) : null,
    dailyBudget: reusedAdSet ? (spend?.daily ?? null) : (body ? finite(body.dailyBudget) : null),
    durationDays: reusedAdSet ? (spend ? spend.days : null) : (body ? finite(body.durationDays) : null),
    accountLabel: text(row.accountLabel),
    inheritedSchedule: Boolean(spend),
    ...(spend && spend.endTime !== undefined ? { endTime: spend.endTime } : {}),
    ids: campaignId && adSetId && adIds
      ? {
          campaignId,
          adSetId,
          adIds,
          ...(reusedCampaign ? { reusedCampaign: true } : {}),
          ...(reusedAdSet ? { reusedAdSet: true } : {}),
        }
      : null,
  }
}

function storedSpend(
  body: Record<string, unknown> | null,
): { daily: number; days: number | null; endTime?: string | null } | null {
  if (!body) return null
  const raw = body.inheritedSpend
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const daily = finite(row.dailyBudget)
  if (daily === null || daily <= 0) return null
  const endTime = storedEnd(row)
  if (endTime === 'bad') return null
  const end = endTime === undefined ? {} : { endTime }
  if (row.durationDays === null) return { daily, days: null, ...end }
  const days = finite(row.durationDays)
  if ((days === null || !Number.isInteger(days) || days < 1) && endTime === undefined) return null
  const kept = days !== null && Number.isInteger(days) && days >= 1 ? days : null
  return { daily, days: kept, ...end }
}

function storedEnd(row: Record<string, unknown>): string | null | undefined | 'bad' {
  if (!Object.prototype.hasOwnProperty.call(row, 'endTime')) return undefined
  if (row.endTime === null) return null
  if (typeof row.endTime !== 'string' || !Number.isFinite(Date.parse(row.endTime))) return 'bad'
  return row.endTime
}
