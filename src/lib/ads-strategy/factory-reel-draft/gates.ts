import {
  validateContentChecklist,
  checklistPasses,
  REEL_HUMAN_CHECK_KEYS,
  REEL_AUTO_CHECK_KEYS,
} from '@/lib/social/content-review'
import { buildReelPostCaption } from '@/lib/social/reel-publishing'
import { findRedlineHits } from '@/lib/ads-strategy/draft-redlines'

export type ReelDraftBlockCode =
  | 'client_mismatch'
  | 'page_mismatch'
  | 'video_mismatch'
  | 'not_published'
  | 'published_at_mismatch'
  | 'approval_missing'
  | 'checklist_not_passed'
  | 'redline_scan_missing'
  | 'redline_hits_present'
  | 'bad_published_at'
  | 'stale'
  | 'copy_unreadable'
  | 'redlines_unreadable'
  | 'copy_redline_hit'

export interface ReelDraftEventClaim {
  clientId: string
  workOrderId: string
  pageId: string
  videoId: string
  publishedAt: string
}

export interface ReelWorkOrderRow {
  id: string
  client_id: string
  status: string
  brief: Record<string, unknown> | null
  output: Record<string, unknown> | null
  review_ref: Record<string, unknown> | null
  published_ref: Record<string, unknown> | null
}

export type GateResult = { ok: true } | { ok: false; code: ReelDraftBlockCode; message: string }
export type TextsResult = { ok: true; texts: string[] } | { ok: false; code: ReelDraftBlockCode; message: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function block(
  code: ReelDraftBlockCode,
  message: string,
): { ok: false; code: ReelDraftBlockCode; message: string } {
  return { ok: false, code, message }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

// 审批人必须是可识别的邮箱；'unknown' 是评审流程在拿不到邮箱时写入的占位符，不算有效审批人。
const APPROVER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readApproverEmail(value: unknown): string | null {
  const approver = readNonEmptyString(value)
  if (!approver) return null
  if (approver.toLowerCase() === 'unknown') return null
  if (!APPROVER_EMAIL_RE.test(approver)) return null
  return approver
}

export function checkIdentity(claim: ReelDraftEventClaim, row: ReelWorkOrderRow): GateResult {
  if (row.id !== claim.workOrderId || row.client_id !== claim.clientId) {
    return block('client_mismatch', '这条工单和事件对不上（客户或工单号不一致），不能自动建广告。')
  }
  const published = row.published_ref
  if (!isPlainObject(published) || published.page_id !== claim.pageId) {
    return block('page_mismatch', '发布记录里的主页和事件对不上，不能自动建广告。')
  }
  const videoId = published.video_id ?? published.post_id
  if (videoId !== claim.videoId) {
    return block('video_mismatch', '发布记录里的视频和事件对不上，不能自动建广告。')
  }
  if (
    row.status !== 'published' ||
    published.platform !== 'facebook' ||
    published.video_state !== 'PUBLISHED'
  ) {
    return block('not_published', '这条 Reel 还没确认发布成功，不能自动建广告。')
  }
  const publishedAt = published.published_at
  if (
    typeof publishedAt !== 'string' ||
    Date.parse(publishedAt) !== Date.parse(claim.publishedAt)
  ) {
    return block('published_at_mismatch', '发布记录的时间和事件对不上，不能自动建广告。')
  }
  return { ok: true }
}

export function checkApprovalEvidence(row: ReelWorkOrderRow): GateResult {
  const review = row.review_ref
  const approvedBy = isPlainObject(review) ? readApproverEmail(review.approved_by) : null
  if (!approvedBy) {
    return block('approval_missing', '这条 Reel 的审批人不明确或缺失，不能自动建广告。')
  }
  const output = row.output
  const human = validateContentChecklist(
    isPlainObject(review) ? review.checklist_human : undefined,
    REEL_HUMAN_CHECK_KEYS,
    'HUMAN',
  )
  const auto = validateContentChecklist(
    isPlainObject(output) ? output.quality_checklist_auto : undefined,
    REEL_AUTO_CHECK_KEYS,
    'AUTO',
  )
  if (!human.ok || !auto.ok || !checklistPasses(human.items) || !checklistPasses(auto.items)) {
    return block('checklist_not_passed', '这条 Reel 的检查清单没有全部通过，不能自动建广告。')
  }
  const redlineHits = isPlainObject(output) ? output.redline_hits : undefined
  if (!Array.isArray(redlineHits)) {
    return block('redline_scan_missing', '这条 Reel 没有记录禁用词扫描结果，不能自动建广告。')
  }
  if (redlineHits.length > 0) {
    return block('redline_hits_present', '这条 Reel 的文案命中了客户的禁用词，不能自动建广告。')
  }
  return { ok: true }
}

export function checkFreshness(
  publishedAtIso: string,
  nowMs: number,
  maxAgeHours: number,
): GateResult {
  const publishedMs = Date.parse(publishedAtIso)
  if (Number.isNaN(publishedMs) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    return block('bad_published_at', '发布时间或有效期不合法，不能自动建广告。')
  }
  if (publishedMs - nowMs > 5 * 60 * 1000) {
    return block('bad_published_at', '发布时间比现在还晚，不能自动建广告。')
  }
  if (nowMs - publishedMs > maxAgeHours * 3_600_000) {
    return block('stale', '这条 Reel 发布太久了，不能自动建广告。')
  }
  return { ok: true }
}

export function collectReelTexts(brief: Record<string, unknown> | null): TextsResult {
  const copy = isPlainObject(brief) ? brief.copy : undefined
  if (!isPlainObject(copy)) {
    return block('copy_unreadable', '读不到这条 Reel 的文案，不能自动建广告。')
  }
  const endcard = isPlainObject(copy.endcard) ? copy.endcard : {}
  const offer = Array.isArray(endcard.offer)
    ? endcard.offer.filter((v): v is string => typeof v === 'string')
    : []
  const raw: unknown[] = [buildReelPostCaption(copy), endcard.cta, endcard.vo, ...offer]
  const texts = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  if (texts.length === 0) {
    return block('copy_unreadable', '这条 Reel 没有可扫描的文案，不能自动建广告。')
  }
  return { ok: true, texts }
}

export function checkCopyRedlines(
  texts: readonly string[],
  redlines: readonly string[] | null,
): GateResult {
  if (redlines === null) {
    return block('redlines_unreadable', '读不到这个客户的禁用词，不能自动建广告。')
  }
  const hits = findRedlineHits(texts, redlines)
  if (hits.length > 0) {
    return block('copy_redline_hit', `文案命中了客户的禁用词：${hits.join('、')}`)
  }
  return { ok: true }
}

export function evaluateReelDraftGates(input: {
  claim: ReelDraftEventClaim
  row: ReelWorkOrderRow
  redlines: readonly string[] | null
  nowMs: number
  maxAgeHours: number
}): TextsResult {
  const identity = checkIdentity(input.claim, input.row)
  if (!identity.ok) return identity
  const approval = checkApprovalEvidence(input.row)
  if (!approval.ok) return approval
  const freshness = checkFreshness(input.claim.publishedAt, input.nowMs, input.maxAgeHours)
  if (!freshness.ok) return freshness
  const texts = collectReelTexts(input.row.brief)
  if (!texts.ok) return texts
  const redlines = checkCopyRedlines(texts.texts, input.redlines)
  if (!redlines.ok) return redlines
  return { ok: true, texts: texts.texts }
}
