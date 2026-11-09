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
}

export interface PausedDraftView {
  readonly status: string
  readonly kind: string | null
  readonly dailyBudget: number | null
  readonly durationDays: number | null
  readonly accountLabel: string | null
  readonly ids: GoLiveIds | null
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
  // 多个广告组的草稿：账本里只有 adSetIds（没有单个 adSetId），上线卡和「开」按钮都只会开一个组，
  // 开了一个就等于另外几组被静默落下 —— 一律当作「编号不全」，让上线卡走不通、交回人处理（失败关闭）。
  const multiSet = (Array.isArray(row.adSetIds) && row.adSetIds.length > 0) || (body !== null && Array.isArray(body.adSets))
  return {
    status,
    kind: body ? text(body.kind) : null,
    dailyBudget: body ? finite(body.dailyBudget) : null,
    durationDays: body ? finite(body.durationDays) : null,
    accountLabel: text(row.accountLabel),
    ids: !multiSet && campaignId && adSetId && adIds ? { campaignId, adSetId, adIds } : null,
  }
}
