/**
 * Pure checks for turning one approved ad step into one paused-draft card.
 * No Meta calls, no database, no copy text invented here.
 */

import type { DraftExpansionSwitches, DraftKind } from './ad-draft'
import { MAX_DURATION_DAYS, MIN_DURATION_DAYS } from './ad-draft'
import type { CreativePoolEntry } from './config'
import { PROMOTION_SIGNAL_SOURCE, promotionDedupeKey } from '@/lib/factory/promotion-signal'
import { canonicalAccountDigits } from '@/lib/meta/ad-account-binding'
import type { AdPlay } from './plan-seed/ad-plays'
import type { PlayKey } from './play-vocabulary'
import { promoVerdict } from './promo-window'

export const EXPANSION_SOURCE = 'ad-agent:default-advantage-plus'

const KIND_FOR_PLAY: Partial<Record<PlayKey, DraftKind>> = {
  lead_form_harvest: 'lead_form',
  thruplay_pool_build: 'video_thruplay',
  messenger_direct: 'messenger_conversation',
}

const VIDEO_ID = /^\d{5,}$/
const PLACEHOLDER = /lorem ipsum|placeholder|your headline|your text|todo|xxx|测试文案|占位/i

export interface LeadFormRow {
  id: string
  name: string | null
  active: boolean
}

export interface CopyPair {
  primaryText: string
  headline: string
}

export type Ruled<T> = { ok: true } & T | { ok: false; reason: string }

export function kindForPlay(play: PlayKey): DraftKind | null {
  return KIND_FOR_PLAY[play] ?? null
}

export function playForStep(plays: readonly AdPlay[] | null, stepId: string): AdPlay | null {
  if (!plays) return null
  return plays.find((play) => play.step_key === stepId) ?? null
}

export function accountBlockReason(
  planAccount: string,
  clientAccount: string | null,
  spendAccount: string | null,
): string | null {
  const plan = digits(planAccount)
  const client = digits(clientAccount)
  if (!plan || !client) return '广告账户没有配全，没有出卡。'
  const spend = digits(spendAccount)
  const clientDiff = plan !== client
  const spendDiff = spend !== null && spend !== plan
  if (!clientDiff && !spendDiff) return null
  if (clientDiff && spendDiff) return '计划、客户设置和实际花费这三个广告账户不一致，没有猜用哪一个。'
  if (spendDiff) return '计划里的广告账户和实际花费账户不一致，没有猜用哪一个。'
  return '计划里的广告账户和客户设置的广告账户不一致，没有猜用哪一个。'
}

export function chooseLeadForm(args: {
  namedId?: string
  namedName?: string
  forms: readonly LeadFormRow[]
}): Ruled<{ id: string }> {
  const named = namedForm(args)
  if (named) return named
  const active = args.forms.filter((form) => form.active)
  if (active.length === 1 && active[0]) return { ok: true, id: active[0].id }
  if (active.length === 0) return { ok: false, reason: '这个主页没有在用的表单，需要选定一个已经存在的表单。' }
  return { ok: false, reason: '有多个在用的表单，需要选定一个已经存在的表单。' }
}

export function expansionForAudiences(hasAudiences: boolean): Ruled<{ expansion: DraftExpansionSwitches }> {
  if (hasAudiences) {
    return {
      ok: false,
      reason: '这一步挂了受众。优势受众默认要打开，但挂了受众就不能开扩量，需要人选定，所以没有出卡。',
    }
  }
  return {
    ok: true,
    expansion: {
      advantageAudience: true,
      customAudienceRelaxed: false,
      lookalikeRelaxed: false,
      source: EXPANSION_SOURCE,
    },
  }
}

export function flightDays(start: string, end: string): Ruled<{ days: number }> {
  const days = inclusiveDays(start, end)
  if (days === null) return { ok: false, reason: '这一步的投放日期读不懂，没有出卡。' }
  if (days < MIN_DURATION_DAYS) return { ok: false, reason: `投放至少要 ${MIN_DURATION_DAYS} 天，这一步不够，没有出卡。` }
  if (days > MAX_DURATION_DAYS) return { ok: false, reason: `一次最多投放 ${MAX_DURATION_DAYS} 天，这一步更长，没有出卡。` }
  return { ok: true, days }
}

export function videoIdFromPool(entry: CreativePoolEntry): Ruled<{ videoId: string }> {
  if (entry.kind === 'meta_video' && VIDEO_ID.test(entry.ref)) return { ok: true, videoId: entry.ref }
  const aliases = (entry.alias_refs ?? []).filter((id) => VIDEO_ID.test(id))
  if (aliases.length === 1 && aliases[0]) return { ok: true, videoId: aliases[0] }
  if (aliases.length === 0) return { ok: false, reason: '素材还没有可用的视频编号，素材还没准备好。' }
  return { ok: false, reason: '素材有多个视频编号，不能猜用哪一个，素材还没准备好。' }
}

export interface PromotionSignalLink {
  id: string
  clientId: string
  source: string
  dedupeKey: string
  workOrderId?: string | null
}

export interface PromotionOrderLink {
  id: string
  clientId: string
  signalId: string | null
}

/** Work orders opened by this plan's promotion signal. No window is invented. */
export function promotionWorkOrderIds(input: {
  clientId: string
  prescriptionId: string
  signals: readonly PromotionSignalLink[]
  orders: readonly PromotionOrderLink[]
}): string[] {
  const key = promotionDedupeKey(input.prescriptionId)
  const signals = input.signals.filter((row) => (
    row.clientId === input.clientId
    && row.source === PROMOTION_SIGNAL_SOURCE
    && row.dedupeKey === key
  ))
  const signalIds = new Set(signals.map((row) => row.id))
  const ids = new Set<string>()
  for (const signal of signals) {
    if (signal.workOrderId) ids.add(signal.workOrderId)
  }
  for (const order of input.orders) {
    if (order.clientId !== input.clientId || !order.signalId) continue
    if (signalIds.has(order.signalId)) ids.add(order.id)
  }
  return [...ids].sort()
}

export function creativeWindowReason(
  entry: CreativePoolEntry,
  today: string,
  use: { start: string; end: string },
): string | null {
  const verdict = promoVerdict(entry.promo_window, today, use)
  if (verdict === 'ok') return null
  if (verdict === 'undeclared') return '素材没有声明推广期，素材还没准备好。'
  if (verdict === 'expired') return '素材的推广期已经过了，素材还没准备好。'
  if (verdict === 'not_started') return '素材的推广期还没开始，素材还没准备好。'
  return '素材的推广期盖不住这次投放，素材还没准备好。'
}

/**
 * A missing window is not a placeholder. It is acceptable only when this pool
 * row is the work order opened by the plan's own promotion signal.
 * A window that is present and does not cover the flight still blocks.
 */
export function creativeReadyReason(
  entry: CreativePoolEntry,
  today: string,
  use: { start: string; end: string },
  linkedToPlan: boolean,
): string | null {
  const reason = creativeWindowReason(entry, today, use)
  if (!reason) return null
  if (linkedToPlan && entry.promo_window === undefined) return null
  return reason
}

export function acceptDraftCopy(raw: unknown, brandText: string): Ruled<CopyPair> {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '广告文案没有写出来。' }
  const row = raw as { primaryText?: unknown; headline?: unknown }
  if (typeof row.primaryText !== 'string' || typeof row.headline !== 'string') {
    return { ok: false, reason: '广告文案没有写出来。' }
  }
  const primaryText = row.primaryText.trim()
  const headline = row.headline.trim()
  if (!primaryText || !headline) return { ok: false, reason: '广告文案没有写出来。' }
  if (primaryText.length > 300 || headline.length > 40) {
    return { ok: false, reason: '广告文案超过能放下的长度，没有出卡。' }
  }
  if (PLACEHOLDER.test(primaryText) || PLACEHOLDER.test(headline)) {
    return { ok: false, reason: '广告文案没有写出来。' }
  }
  if (inventedNumber(`${primaryText} ${headline}`, brandText)) {
    return { ok: false, reason: '广告文案里有品牌资料没有的数字，没有出卡。' }
  }
  return { ok: true, primaryText, headline }
}

function namedForm(args: {
  namedId?: string
  namedName?: string
  forms: readonly LeadFormRow[]
}): Ruled<{ id: string }> | null {
  const id = args.namedId?.trim() ?? ''
  const name = args.namedName?.trim() ?? ''
  if (!id && !name) return null
  if (id) return formById(args.forms, id, name)
  return formByName(args.forms, name)
}

function formById(forms: readonly LeadFormRow[], id: string, name: string): Ruled<{ id: string }> {
  const hit = forms.find((form) => form.id === id)
  if (!hit) return { ok: false, reason: '计划点名的表单不在这个主页上，需要选定一个已经存在的表单。' }
  if (name && (hit.name ?? '').trim() !== name) {
    return { ok: false, reason: '计划里的表单编号和名字对不上，需要选定一个已经存在的表单。' }
  }
  return { ok: true, id: hit.id }
}

function formByName(forms: readonly LeadFormRow[], name: string): Ruled<{ id: string }> {
  const hits = forms.filter((form) => (form.name ?? '').trim() === name)
  if (hits.length === 1 && hits[0]) return { ok: true, id: hits[0].id }
  if (hits.length === 0) return { ok: false, reason: '计划点名的表单不在这个主页上，需要选定一个已经存在的表单。' }
  return { ok: false, reason: '有多个同名表单，需要选定一个已经存在的表单。' }
}

function digits(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const out = canonicalAccountDigits(trimmed)
  return out === '' ? null : out
}

function inclusiveDays(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null
  const from = Date.parse(`${start}T00:00:00Z`)
  const to = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  return Math.round((to - from) / 86_400_000) + 1
}

function inventedNumber(text: string, brand: string): boolean {
  const nums = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []
  const hay = brand.replace(/,/g, '')
  return nums.some((n) => !hay.includes(n.replace(/,/g, '')))
}
