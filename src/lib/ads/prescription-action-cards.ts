/**
 * Turn prescriptions.content.action_list into one confirm-card request per action.
 * Callers pass the existing pause and budget issuers. This file does not execute.
 */

import { parseBudgetRequest } from '@/lib/ads-budget-card/request'
import type { BudgetIssueResult } from '@/lib/ads-budget-card/flow'
import type { BudgetOrder } from '@/lib/ads-budget-card/types'
import type { PauseIssueItem } from '@/lib/ads-pause-card/issue'
import type { PauseAdSetOrder } from '@/lib/ads-pause-card/order'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import {
  parsePrescriptionActionList,
  pauseCardOrderFromAction,
  type PrescriptionActionListItem,
  type PrescriptionBudgetAction,
  type PrescriptionPauseAction,
} from './prescription-action-list'

/** Auto cards from approval last until 23:59 NZ on the issue day. */
export const APPROVE_CARD_LIFETIME = 'nz_day' as const

export type ActionCardStatus = 'issued' | 'blocked' | 'off' | 'failed' | 'duplicate'

export interface ActionCardItem {
  readonly key: string
  readonly index: number
  readonly type: string
  readonly status: ActionCardStatus
  readonly reason: string | null
  readonly runId: string | null
  readonly wroteMeta: false
}

export interface ActionCardReport {
  readonly wroteMeta: false
  readonly lifetime: typeof APPROVE_CARD_LIFETIME
  readonly items: readonly ActionCardItem[]
}

export interface ActionCardPorts {
  issuePause: (order: PauseAdSetOrder) => Promise<PauseIssueItem>
  issueBudget: (order: BudgetOrder) => Promise<BudgetIssueResult>
}

type Work =
  | { kind: 'pause'; index: number; type: string; order: PauseAdSetOrder }
  | { kind: 'budget'; index: number; type: string; reason: string | null; order: BudgetOrder | null }
  | { kind: 'bad'; index: number; type: string; reason: string }

export function actionCardKey(prescriptionId: string, index: number, type: string): string {
  return `${prescriptionId}:${index}:${type}`
}

export function emptyActionCardReport(): ActionCardReport {
  return { wroteMeta: false, lifetime: APPROVE_CARD_LIFETIME, items: [] }
}

export function readStoredActionCards(generationMeta: unknown): ActionCardItem[] {
  const raw = objectOf(generationMeta)?.action_cards
  if (!Array.isArray(raw)) return []
  return raw.flatMap(storedItem)
}

export function withActionCards(meta: unknown, items: readonly ActionCardItem[]): Record<string, unknown> {
  const base = { ...(objectOf(meta) ?? {}) }
  const byKey = new Map(readStoredActionCards(base).map((item) => [item.key, item]))
  for (const item of items) {
    if (item.status === 'duplicate') continue
    byKey.set(item.key, item)
  }
  base.action_cards = [...byKey.values()].map(storedOf)
  return base
}

export function planActionCards(prescriptionId: string, version: number, content: unknown):
  | { ok: true; work: Work[] }
  | { ok: false; reason: string } {
  const raw = objectOf(content)?.action_list
  if (raw === undefined) return { ok: true, work: [] }
  const parsed = parsePrescriptionActionList(raw)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  return { ok: true, work: parsed.action_list.map((item, index) => workOf(prescriptionId, version, index, item)) }
}

export async function issuePlannedCards(args: {
  prescriptionId: string
  work: readonly Work[]
  prior: readonly ActionCardItem[]
  ports: ActionCardPorts
}): Promise<ActionCardReport> {
  const items: ActionCardItem[] = []
  for (const work of args.work) items.push(await oneCard(args, work))
  return { wroteMeta: false, lifetime: APPROVE_CARD_LIFETIME, items }
}

async function oneCard(args: {
  prescriptionId: string
  prior: readonly ActionCardItem[]
  ports: ActionCardPorts
}, work: Work): Promise<ActionCardItem> {
  const key = actionCardKey(args.prescriptionId, work.index, work.type)
  const prior = args.prior.find((item) => item.key === key && item.runId)
  if (prior) return { ...prior, status: 'duplicate', wroteMeta: false }
  if (work.kind === 'bad') return failed(key, work.index, work.type, work.reason)
  try {
    if (work.kind === 'pause') return fromPause(key, work.index, work.type, await args.ports.issuePause(work.order))
    if (!work.order) return failed(key, work.index, work.type, work.reason ?? '预算动作读不懂，没有出卡。')
    return fromBudget(key, work.index, work.type, await args.ports.issueBudget(work.order))
  } catch (error) {
    return failed(key, work.index, work.type, messageOf(error))
  }
}

function workOf(prescriptionId: string, version: number, index: number, item: PrescriptionActionListItem): Work {
  if (item.type === ADS_ACTION_TYPE.PAUSE_AD_SET) return pauseWork(prescriptionId, version, index, item)
  return budgetWork(prescriptionId, index, item)
}

function pauseWork(prescriptionId: string, version: number, index: number, item: PrescriptionPauseAction): Work {
  const parsed = pauseCardOrderFromAction(prescriptionId, version, item)
  if (!parsed.ok) return { kind: 'bad', index, type: item.type, reason: parsed.reason ?? '这份暂停动作没有出卡。' }
  return { kind: 'pause', index, type: item.type, order: parsed.order }
}

function budgetWork(prescriptionId: string, index: number, item: PrescriptionBudgetAction): Work {
  try {
    return { kind: 'budget', index, type: item.type, reason: null, order: parseBudgetRequest(budgetBody(prescriptionId, item)) }
  } catch (error) {
    return { kind: 'budget', index, type: item.type, reason: messageOf(error), order: null }
  }
}

function budgetBody(prescriptionId: string, item: PrescriptionBudgetAction): Record<string, unknown> {
  return {
    prescriptionId,
    adsetId: item.target.adset_id,
    adAccountId: item.target.ad_account_id,
    newDailyBudgetCents: item.proposed_daily_budget_cents,
    name: null,
    expectedMetric: item.expected_metric,
    direction: item.direction,
    observationWindowDays: item.observation_days,
  }
}

function fromPause(key: string, index: number, type: string, item: PauseIssueItem): ActionCardItem {
  return { key, index, type, status: item.status, reason: item.reason ?? null, runId: item.runId ?? null, wroteMeta: false }
}

function fromBudget(key: string, index: number, type: string, item: BudgetIssueResult): ActionCardItem {
  const status = item.card ? item.status : 'blocked'
  return { key, index, type, status, reason: item.reason, runId: item.card?.runId ?? null, wroteMeta: false }
}

function failed(key: string, index: number, type: string, reason: string): ActionCardItem {
  return { key, index, type, status: 'failed', reason, runId: null, wroteMeta: false }
}

function storedOf(item: ActionCardItem): Record<string, unknown> {
  return { key: item.key, index: item.index, type: item.type, status: item.status, reason: item.reason, runId: item.runId }
}

function storedItem(value: unknown): ActionCardItem[] {
  const row = objectOf(value)
  if (!row || typeof row.key !== 'string' || typeof row.index !== 'number' || typeof row.type !== 'string') return []
  if (!isStatus(row.status)) return []
  return [{
    key: row.key,
    index: row.index,
    type: row.type,
    status: row.status,
    reason: typeof row.reason === 'string' ? row.reason : null,
    runId: typeof row.runId === 'string' ? row.runId : null,
    wroteMeta: false,
  }]
}

function isStatus(value: unknown): value is ActionCardStatus {
  return value === 'issued' || value === 'blocked' || value === 'off' || value === 'failed' || value === 'duplicate'
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 300)
  return '出确认卡失败，没有改广告。'
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
