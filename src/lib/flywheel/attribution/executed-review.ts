/**
 * One review shape for a real budget-card or prescription pause-card execution.
 *
 * The cards already store a metric, a direction, and an observation window.
 * This module only reads that stored shape. It does not invent a window,
 * a direction, or an approval source, and it does not judge success.
 *
 * The attribution job compares this object's own daily numbers after the
 * window. Overlap stays inconclusive. A neutral metric, including spend,
 * is not a success by itself.
 */

import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'

export const BUDGET_CARD_ACTION = ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET
export const PAUSE_CARD_ACTION = ADS_ACTION_TYPE.PAUSE_AD_SET

const WINDOW_MIN = 1
const WINDOW_MAX = 28

export type ReviewDirection = 'up' | 'down' | 'pause'
export type PairMark = 'clear' | 'overlap'

/** The approval snapshot #3673 stores on the card. Every field must already be there. */
export interface ReviewSource {
  readonly prescriptionId: string
  readonly version: number
  readonly goalId: string
  readonly planId: string
  readonly planHash: string
  readonly approvedOn: string
}

/** The one shape both cards record once the write has really happened. */
export interface ReviewStamp {
  readonly metric: string
  readonly direction: ReviewDirection
  readonly observationWindowDays: number
  readonly objectId: string
  readonly source: ReviewSource
}

export interface ExecutedReview extends ReviewStamp {
  readonly actionId: string
  readonly clientId: string
  readonly actionType: string
  readonly executedAt: string
}

export interface WindowSpan {
  readonly actionId: string
  readonly clientId: string
  readonly objectId: string
  readonly executedAt: string
  readonly observationWindowDays: number
}

export interface ReviewAction {
  readonly id: string
  readonly client_id: string
  readonly action_type: string | null
  readonly payload: Record<string, unknown> | null
  readonly expected_metric: string | null
  readonly executed_at: string | null
}

export type ReviewRead =
  | { readonly kind: 'other' }
  | { readonly kind: 'not_executed' }
  | { readonly kind: 'incomplete'; readonly reason: string }
  | { readonly kind: 'ready'; readonly review: ExecutedReview }

const INCOMPLETE = 'executed card is missing its metric, direction, window, object, time, or approval source'

export function executedReviewStamp(input: {
  metric: unknown
  direction: unknown
  observationWindowDays: unknown
  objectId: unknown
  source: unknown
}): ReviewStamp | null {
  const metric = text(input.metric)
  const objectId = text(input.objectId)
  const direction = directionOf(input.direction)
  const observationWindowDays = windowOf(input.observationWindowDays)
  const source = sourceOf(input.source)
  if (!metric || !objectId || !direction || observationWindowDays === null || !source) return null
  return { metric, direction, observationWindowDays, objectId, source }
}

export function readExecutedReview(action: ReviewAction): ReviewRead {
  if (!isCard(action.action_type)) return { kind: 'other' }
  const payload = record(action.payload)
  if (!payload || payload.status !== 'executed') return { kind: 'not_executed' }
  const opened = openExecuted(action, payload)
  if (!opened) return { kind: 'incomplete', reason: INCOMPLETE }
  return { kind: 'ready', review: opened }
}

/** Timing of an executed card, even when the approval source is incomplete. */
export function windowSpanOf(action: ReviewAction): WindowSpan | null {
  if (!isCard(action.action_type)) return null
  const payload = record(action.payload)
  if (!payload || payload.status !== 'executed') return null
  const objectId = agree(objectFromStamp(payload), objectFromLegacy(payload))
  const observationWindowDays = agreeWindow(windowFromStamp(payload), windowFromLegacy(action.action_type, payload))
  const executedAt = text(action.executed_at)
  if (!objectId || observationWindowDays === null || !executedAt || Number.isNaN(Date.parse(executedAt))) return null
  return { actionId: action.id, clientId: action.client_id, objectId, executedAt, observationWindowDays }
}

export function observationDue(executedAt: string, windowDays: number, now: Date): boolean {
  const start = new Date(executedAt)
  if (Number.isNaN(start.getTime())) return false
  const end = new Date(start)
  end.setDate(end.getDate() + windowDays)
  return now.getTime() >= end.getTime()
}

export function pairSpans(spans: readonly WindowSpan[]): ReadonlyMap<string, PairMark> {
  const marks = new Map<string, PairMark>()
  for (const span of spans) marks.set(span.actionId, 'clear')
  for (let left = 0; left < spans.length; left += 1) {
    for (let right = left + 1; right < spans.length; right += 1) {
      const a = spans[left]
      const b = spans[right]
      if (!a || !b || a.actionId === b.actionId) continue
      if (a.clientId !== b.clientId || a.objectId !== b.objectId) continue
      if (!overlaps(a, b)) continue
      marks.set(a.actionId, 'overlap')
      marks.set(b.actionId, 'overlap')
    }
  }
  return marks
}

/**
 * Overlap stays inconclusive. Direction is an input, not a verdict.
 * The job scores a clear pair from the object's own window instead of calling this.
 */
export function reviewVerdict(pair: PairMark): { verdict: 'inconclusive'; confidence: 0; pair: PairMark } {
  return { verdict: 'inconclusive', confidence: 0, pair }
}

function openExecuted(action: ReviewAction, payload: Record<string, unknown>): ExecutedReview | null {
  const span = windowSpanOf(action)
  const direction = agreeDirection(directionFromStamp(payload), directionFromLegacy(action.action_type, payload))
  const metric = agree(metricFromStamp(payload), metricFromLegacy(action.action_type, payload))
  const column = text(action.expected_metric)
  if (column && metric && column !== metric) return null
  const source = sourceFromLock(action.action_type, payload)
  const stampSource = sourceOf(record(payload.review)?.source)
  if (stampSource && source && !sameSource(stampSource, source)) return null
  if (!span || !direction || !metric || !source) return null
  if (action.action_type === PAUSE_CARD_ACTION && direction !== 'pause') return null
  if (action.action_type === BUDGET_CARD_ACTION && direction === 'pause') return null
  return {
    actionId: action.id,
    clientId: action.client_id,
    actionType: action.action_type ?? '',
    executedAt: span.executedAt,
    metric,
    direction,
    observationWindowDays: span.observationWindowDays,
    objectId: span.objectId,
    source,
  }
}

function isCard(actionType: string | null): boolean {
  return actionType === BUDGET_CARD_ACTION || actionType === PAUSE_CARD_ACTION
}

function sourceFromLock(actionType: string | null, payload: Record<string, unknown>): ReviewSource | null {
  return sourceOf(actionType === BUDGET_CARD_ACTION ? payload.lock : payload.source)
}

function metricFromLegacy(actionType: string | null, payload: Record<string, unknown>): string | null {
  const order = record(payload.order)
  if (!order) return null
  return text(actionType === BUDGET_CARD_ACTION ? order.expectedMetric : order.metric)
}

function directionFromLegacy(actionType: string | null, payload: Record<string, unknown>): ReviewDirection | null {
  const order = record(payload.order)
  const fromOrder = directionOf(order?.direction)
  const fromPayload = directionOf(payload.direction)
  if (actionType === PAUSE_CARD_ACTION) return fromOrder
  return agreeDirection(fromPayload, fromOrder)
}

function windowFromLegacy(actionType: string | null, payload: Record<string, unknown>): number | null {
  const order = record(payload.order)
  if (actionType === PAUSE_CARD_ACTION) return windowOf(order?.observationDays)
  return agreeWindow(windowOf(payload.observationWindowDays), windowOf(order?.observationWindowDays))
}

function objectFromLegacy(payload: Record<string, unknown>): string | null {
  return text(record(payload.order)?.adsetId)
}

function metricFromStamp(payload: Record<string, unknown>): string | null {
  return text(record(payload.review)?.metric)
}

function directionFromStamp(payload: Record<string, unknown>): ReviewDirection | null {
  return directionOf(record(payload.review)?.direction)
}

function windowFromStamp(payload: Record<string, unknown>): number | null {
  return windowOf(record(payload.review)?.observationWindowDays)
}

function objectFromStamp(payload: Record<string, unknown>): string | null {
  return text(record(payload.review)?.objectId)
}

function agree(left: string | null, right: string | null): string | null {
  if (left && right && left !== right) return null
  return left ?? right
}

function agreeDirection(left: ReviewDirection | null, right: ReviewDirection | null): ReviewDirection | null {
  if (left && right && left !== right) return null
  return left ?? right
}

function agreeWindow(left: number | null, right: number | null): number | null {
  if (left !== null && right !== null && left !== right) return null
  return left ?? right
}

function overlaps(left: WindowSpan, right: WindowSpan): boolean {
  const a0 = Date.parse(left.executedAt)
  const b0 = Date.parse(right.executedAt)
  const a1 = endMs(left)
  const b1 = endMs(right)
  if (a1 === null || b1 === null) return true
  return a0 < b1 && b0 < a1
}

function endMs(span: WindowSpan): number | null {
  const start = new Date(span.executedAt)
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start)
  end.setDate(end.getDate() + span.observationWindowDays)
  return end.getTime()
}

function sourceOf(value: unknown): ReviewSource | null {
  const row = record(value)
  if (!row) return null
  const prescriptionId = text(row.prescriptionId)
  const goalId = text(row.goalId)
  const planId = text(row.planId)
  const planHash = text(row.planHash)
  const approvedOn = text(row.approvedOn)
  const version = row.version
  if (!prescriptionId || !goalId || !planId || !planHash || !approvedOn) return null
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return null
  return { prescriptionId, version, goalId, planId, planHash, approvedOn }
}

function sameSource(left: ReviewSource, right: ReviewSource): boolean {
  return left.prescriptionId === right.prescriptionId
    && left.version === right.version
    && left.goalId === right.goalId
    && left.planId === right.planId
    && left.planHash === right.planHash
    && left.approvedOn === right.approvedOn
}

function directionOf(value: unknown): ReviewDirection | null {
  return value === 'up' || value === 'down' || value === 'pause' ? value : null
}

function windowOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < WINDOW_MIN || value > WINDOW_MAX) return null
  return value
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
