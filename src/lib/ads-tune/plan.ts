/** Pure planner: one finding in, one remedy out. No ad-platform calls. */
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { nzToday } from '@/lib/ads-strategy/promo-window'
import { factoryImagePath, type CopiedStory, type CreativeOrder, type CtaType } from '@/lib/ads-creative-card/order'
export const ADS_TUNE_SWITCH_KEY = 'ads_tune_cards'
export const ADS_TREND_JOB = 'ads-daily-trend-check'
export const TUNE_ACTION = 'ads.tune_proposal'
const ACCOUNT_RE = /^act_\d{6,20}$/
const ADSET_RE = /^\d{1,32}$/
const CREATIVE = new Set(['swap_creative', 'add_creative'])
export interface TuneImage { readonly path: string; readonly approved: boolean; readonly usedInAds: boolean }
export interface TuneLive {
  readonly accountId: string; readonly adSetId: string; readonly primaryText: string; readonly headline: string
  readonly ctaType: CtaType; readonly copy: CopiedStory; readonly imageUrl: string; readonly planId: string; readonly adSetActive: boolean
}
export interface TuneMarker {
  readonly kind: 'ads_tune'; readonly cardRunId: string | null; readonly subjectKey: string; readonly nzDay: string
  readonly subjectRef: string; readonly diagnosis: string; readonly remedy: 'creative' | 'ticket'; readonly label: string
}
export type TuneDecision =
  | { readonly kind: 'skip'; readonly reason: string; readonly subjectKey: string | null }
  | { readonly kind: 'ticket'; readonly subjectKey: string; readonly marker: TuneMarker }
  | { readonly kind: 'creative'; readonly subjectKey: string; readonly order: CreativeOrder; readonly copy: CopiedStory; readonly planId: string; readonly imageUrl: string; readonly marker: TuneMarker }
interface Found { subjectRef: string; adSetId: string | null; label: string; diagnosis: string; creative: boolean }
export function tuneCardsEnabled(leadsConfig: unknown): boolean {
  return objectOf(leadsConfig)?.[ADS_TUNE_SWITCH_KEY] === true
}
export function withTuneSwitch(leadsConfig: unknown, enabled: boolean): Record<string, unknown> {
  return { ...objectOf(leadsConfig), [ADS_TUNE_SWITCH_KEY]: enabled }
}
export function tuneSubjectKey(subjectRef: string, day: string): string | null {
  const key = `tune:${canonicalHashOfInput({ ref: subjectRef }).slice(0, 12)}:${day}`
  return /^tune:[a-f0-9]{12}:\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
}
export function clipImage(path: unknown, mime: unknown, status: unknown, used: ReadonlySet<string>): TuneImage | null {
  if (status !== 'active' || typeof path !== 'string' || path.length === 0 || path.length > 240) return null
  const imageMime = typeof mime !== 'string' || mime.length === 0 || mime.startsWith('image/')
  if (!imageMime && !/\.(jpe?g|png|webp)$/i.test(path)) return null
  return { path, approved: true, usedInAds: used.has(path) }
}
export function pickUnusedImage(clientId: string, rows: readonly TuneImage[]): string | null {
  for (const row of rows) {
    if (!row.approved || row.usedInAds) continue
    const path = factoryImagePath(clientId, row.path)
    if (path) return path
  }
  return null
}
export function planTune(input: {
  clientId: string; now: Date; finding: unknown; images: readonly TuneImage[]
  live: TuneLive | null; already: boolean; enabled: boolean
}): TuneDecision {
  if (!input.enabled) return skip('这个客户没开调方确认卡。', null)
  const found = adaptFinding(input.finding)
  if (!found) return skip('这条约方认不出广告组，没有出卡。', null)
  const subjectKey = tuneSubjectKey(found.subjectRef, nzToday(input.now.getTime()))
  if (!subjectKey) return skip('认不出是哪一组，没有出卡。', null)
  if (input.already) return skip('这一组今天已经出过一张调方卡。', subjectKey)
  const marker = baseMarker(found, subjectKey, nzToday(input.now.getTime()))
  if (!found.creative) return skip('这条诊断没有可出的调方。', subjectKey)
  return creativeOrTicket(input, found, marker)
}
export function conditionStillHolds(marker: TuneMarker, fresh: readonly unknown[] | 'unread'): boolean | 'unread' {
  if (fresh === 'unread') return 'unread'
  return fresh.some((row) => sameAsk(marker, adaptFinding(row)))
}
export function findingsFromSummary(summary: unknown, clientId: string): unknown[] | 'unread' {
  const root = objectOf(summary)
  if (!root) return 'unread'
  const nested = findingsOf(objectOf(root.by_client)?.[clientId])
  if (nested) return nested
  if (root.client_id !== clientId && root.clientId !== clientId) return 'unread'
  return findingsOf(root.findings) ?? 'unread'
}
export function adaptFinding(raw: unknown): Found | null {
  const root = objectOf(raw)
  if (!root) return null
  const subject = objectOf(root.subject) ?? {}
  const subjectRef = shortText(subject.id ?? subject.ref ?? root.subject_id, 80)
  const diagnosis = shortText(root.diagnosis_code ?? root.diagnosis ?? root.code, 40)
  if (!subjectRef || !diagnosis) return null
  if (subject.level === 'campaign' || subject.level === 'ad') return null
  return {
    subjectRef,
    adSetId: adSetOf(root, subject),
    label: shortText(root.label_zh ?? root.label ?? subject.name, 40) ?? '这一组',
    diagnosis,
    creative: remedyList(root).some((item) => CREATIVE.has(item)),
  }
}
function creativeOrTicket(
  input: { clientId: string; images: readonly TuneImage[]; live: TuneLive | null },
  found: Found,
  marker: TuneMarker,
): TuneDecision {
  const image = pickUnusedImage(input.clientId, input.images)
  const live = input.live
  const usable = image && live && live.adSetActive && live.adSetId === found.adSetId
    && ACCOUNT_RE.test(live.accountId) && live.imageUrl.startsWith('https://')
  if (!usable || !image || !live) return { kind: 'ticket', subjectKey: marker.subjectKey, marker: { ...marker, remedy: 'ticket', label: found.label } }
  return {
    kind: 'creative',
    subjectKey: marker.subjectKey,
    copy: live.copy,
    planId: live.planId,
    imageUrl: live.imageUrl,
    marker: { ...marker, remedy: 'creative' },
    order: {
      adAccountId: live.accountId, adSetId: live.adSetId, imagePath: image, primaryText: live.primaryText,
      headline: live.headline, ctaType: live.ctaType, adName: live.headline.slice(0, 40), status: 'PAUSED',
    },
  }
}
function baseMarker(found: Found, subjectKey: string, day: string): TuneMarker {
  return {
    kind: 'ads_tune', cardRunId: null, subjectKey, nzDay: day, subjectRef: found.subjectRef,
    diagnosis: found.diagnosis, remedy: 'ticket', label: found.label,
  }
}
function sameAsk(marker: TuneMarker, fresh: Found | null): boolean {
  if (!fresh || fresh.subjectRef !== marker.subjectRef || fresh.diagnosis !== marker.diagnosis) return false
  return fresh.creative
}
function remedyList(root: Record<string, unknown>): string[] {
  const raw = root.suggested_tune ?? root.suggestedTune ?? root.remedies ?? root.tune
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}
function adSetOf(root: Record<string, unknown>, subject: Record<string, unknown>): string | null {
  for (const value of [subject.ad_set_id, subject.adSetId, root.ad_set_id, root.adSetId, subject.id]) {
    if (typeof value === 'string' && ADSET_RE.test(value)) return value
  }
  return null
}
function findingsOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}
function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= max && !/[{}[\]`]/.test(text) ? text : null
}
function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function skip(reason: string, subjectKey: string | null): TuneDecision {
  return { kind: 'skip', reason, subjectKey }
}
