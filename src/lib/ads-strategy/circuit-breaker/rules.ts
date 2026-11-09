/**
 * Conservative anomaly rules. Pure. Never pauses and never calls Meta.
 * A missing cap or target is "cannot judge", not zero.
 */

import { DEFAULT_STALE_HOURS } from './settings'
import type { BreakerSettings } from './settings'

export const POLICY_ERROR_STATUSES = ['DISAPPROVED', 'WITH_ISSUES'] as const
const MIN_FORECAST_HOURS = 1

export interface SpendRow {
  readonly accountId: string
  readonly campaignId: string
  readonly campaignName: string
  readonly day: string
  readonly spendCents: number
  readonly leads: number | null
  readonly currency: string | null
  readonly campaignLive: boolean
}

export interface PolicyAd {
  readonly accountId: string
  readonly campaignId: string
  readonly campaignName: string
  readonly adsetId: string | null
  readonly configuredActive: boolean
  readonly effectiveStatus: string
  readonly campaignLive: boolean
}

export interface CaptureStamp {
  readonly accountId: string
  readonly capturedAt: string | null
  readonly complete: boolean
}

export interface InsightStamp {
  readonly accountId: string
  readonly updatedAt: string | null
}

export interface BreakerFacts {
  readonly now: Date
  readonly localDate: string | null
  readonly yesterday: string | null
  readonly hoursElapsed: number | null
  readonly capCents: number | null
  readonly capReadable: boolean
  readonly settings: BreakerSettings
  readonly spend: readonly SpendRow[]
  readonly spendReadable: boolean
  readonly policyAds: readonly PolicyAd[]
  readonly policyReadable: boolean
  readonly captures: readonly CaptureStamp[]
  readonly insights: readonly InsightStamp[]
  readonly accounts: readonly string[]
  readonly freshReadable: boolean
}

export type PauseRule = 'spend_over_cap' | 'cpl_zero_leads' | 'policy_error'

export interface PauseProposal {
  readonly kind: 'pause'
  readonly rules: readonly PauseRule[]
  readonly accountId: string
  readonly campaignId: string
  readonly campaignName: string
  readonly adsetId: string | null
  readonly summary: string
}

export type AlertCode =
  | 'spend_unreadable'
  | 'cap_unreadable'
  | 'mixed_currency'
  | 'no_live_campaign'
  | 'policy_unreadable'
  | 'fresh_unreadable'
  | 'stale'

export interface AlertFinding {
  readonly kind: 'alert'
  readonly code: AlertCode
  readonly accountId: string
  readonly summary: string
}

export interface BreakerJudgement {
  readonly pauses: readonly PauseProposal[]
  readonly alerts: readonly AlertFinding[]
}

export function hoursIntoLocalDay(timezone: string | null, now: Date): number | null {
  if (!timezone) return null
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return hour + minute / 60
  } catch {
    return null
  }
}

export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export function judgeBreaker(facts: BreakerFacts): BreakerJudgement {
  if (!facts.settings.enabled) return { pauses: [], alerts: [] }
  const spend = spendPause(facts)
  const pauses = mergePauses([...(spend ? [spend] : []), ...cplPauses(facts), ...policyPauses(facts)])
  const alerts = [spendAlert(facts), policyAlert(facts), freshAlert(facts)].flatMap((item) => item ?? [])
  return { pauses, alerts }
}

function spendPause(facts: BreakerFacts): PauseProposal | null {
  const today = dayRows(facts, facts.localDate)
  if (!facts.spendReadable || !facts.capReadable || facts.capCents === null || today === null) return null
  if (currenciesClash(today)) return null
  const total = sumSpend(today)
  if (!overCap(facts, total)) return null
  const live = [...today].filter((row) => row.campaignLive).sort((a, b) => b.spendCents - a.spendCents)[0]
  if (!live) return null
  const why = total > facts.capCents
    ? '今天的花费已经高于批准计划里的每天上限'
    : '照今天已经花的速度，全天会高于批准计划里的每天上限'
  return pauseOf('spend_over_cap', live, `${why}。系统没有暂停。请在确认卡上点确认，才会暂停「${live.campaignName}」。`)
}

function spendAlert(facts: BreakerFacts): AlertFinding | null {
  if (!facts.settings.enabled) return null
  if (!facts.spendReadable) return alert('spend_unreadable', '', '花费读不出来，没有出暂停卡。')
  if (!facts.capReadable) return alert('cap_unreadable', '', '批准计划里的每天上限读不出来，没有出暂停卡。')
  const today = dayRows(facts, facts.localDate)
  if (today && currenciesClash(today)) return alert('mixed_currency', '', '这几个账户的币种不一致，没有拿花费去比每天上限。')
  if (today && facts.capCents !== null && overCap(facts, sumSpend(today)) && !today.some((row) => row.campaignLive)) {
    return alert('no_live_campaign', '', '花费已经高于每天上限，但没有还在投的广告系列，所以没有出暂停卡。')
  }
  return null
}

function cplPauses(facts: BreakerFacts): PauseProposal[] {
  const target = facts.settings.targetCplCents
  const window = cplRows(facts)
  if (!facts.spendReadable || target === null || window === null || currenciesClash(window)) return []
  return groupCampaigns(window)
    .filter((row) => row.leads === 0 && row.spendCents > target * facts.settings.cplMultiple && row.campaignLive)
    .map((hit) => pauseOf('cpl_zero_leads', hit, '最近这一天有花费，但没有线索，花费已经高于约定的目标线索成本倍数。系统没有暂停。请在确认卡上点确认，才会暂停。'))
}

function policyPauses(facts: BreakerFacts): PauseProposal[] {
  if (!facts.policyReadable) return []
  const bad = facts.policyAds.filter((ad) => ad.configuredActive && ad.campaignLive && isPolicyError(ad.effectiveStatus) && ad.campaignId)
  const campaigns = [...new Set(bad.map((ad) => ad.campaignId))]
  return campaigns.map((campaignId) => policyOf(bad.filter((ad) => ad.campaignId === campaignId)))
}

function policyOf(ads: readonly PolicyAd[]): PauseProposal {
  const first = ads[0]
  const adsetIds = new Set(ads.map((ad) => ad.adsetId))
  return {
    kind: 'pause',
    rules: ['policy_error'],
    accountId: first.accountId,
    campaignId: first.campaignId,
    campaignName: nameOf(first.campaignName),
    adsetId: adsetIds.size === 1 ? [...adsetIds][0] : null,
    summary: '有一条还在投的广告被平台判了投放或政策问题。系统没有暂停。请在确认卡上点确认，才会暂停这个广告系列。',
  }
}

function policyAlert(facts: BreakerFacts): AlertFinding | null {
  if (facts.policyReadable) return null
  return alert('policy_unreadable', '', '广告设置读不全，没有拿政策问题去出暂停卡。')
}

function freshAlert(facts: BreakerFacts): AlertFinding | null {
  if (!facts.freshReadable) return alert('fresh_unreadable', '', '广告快照或花费的更新时间读不出来。这条只是提醒，不会出暂停卡。')
  const limit = facts.settings.staleHours || DEFAULT_STALE_HOURS
  const stale = facts.accounts.filter((accountId) => accountIsStale(facts, accountId, limit))
  if (stale.length === 0) return null
  return alert('stale', stale[0] ?? '', '广告设置快照或花费数据已经超过约定时间没更新。这条只是提醒，不会出暂停卡。')
}

function accountIsStale(facts: BreakerFacts, accountId: string, limit: number): boolean {
  const capture = facts.captures.find((row) => row.accountId === accountId)
  const insight = facts.insights.find((row) => row.accountId === accountId)
  const snapAge = capture?.complete ? ageHours(capture.capturedAt, facts.now) : null
  const insightAge = ageHours(insight?.updatedAt ?? null, facts.now)
  return snapAge === null || snapAge > limit || insightAge === null || insightAge > limit
}

function cplRows(facts: BreakerFacts): readonly SpendRow[] | null {
  const today = dayRows(facts, facts.localDate)
  if (today === null) return null
  if (today.some((row) => row.spendCents > 0)) return today
  if (facts.hoursElapsed !== null && facts.hoursElapsed < 12) return dayRows(facts, facts.yesterday)
  return null
}

function dayRows(facts: BreakerFacts, day: string | null): readonly SpendRow[] | null {
  if (!day) return null
  return facts.spend.filter((row) => row.day === day)
}

function overCap(facts: BreakerFacts, total: number): boolean {
  if (facts.capCents === null || total <= facts.capCents) {
    return Boolean(facts.settings.forecastEnabled && forecastOver(facts, total))
  }
  return true
}

function forecastOver(facts: BreakerFacts, total: number): boolean {
  const hours = facts.hoursElapsed
  if (facts.capCents === null || hours === null || hours < MIN_FORECAST_HOURS || hours >= 24) return false
  return Math.round(total * 24 / hours) > facts.capCents
}

function groupCampaigns(rows: readonly SpendRow[]): SpendRow[] {
  const map = new Map<string, SpendRow>()
  for (const row of rows) {
    const prior = map.get(row.campaignId)
    if (!prior) {
      map.set(row.campaignId, row)
      continue
    }
    const leads = prior.leads === null || row.leads === null ? null : prior.leads + row.leads
    map.set(row.campaignId, { ...prior, spendCents: prior.spendCents + row.spendCents, leads, campaignLive: prior.campaignLive || row.campaignLive })
  }
  return [...map.values()]
}

function mergePauses(items: readonly PauseProposal[]): PauseProposal[] {
  const map = new Map<string, PauseProposal>()
  for (const item of items) {
    const prior = map.get(item.campaignId)
    if (!prior) {
      map.set(item.campaignId, item)
      continue
    }
    map.set(item.campaignId, {
      ...prior,
      rules: [...prior.rules, ...item.rules],
      adsetId: prior.adsetId ?? item.adsetId,
      summary: `${prior.summary} ${item.summary}`,
    })
  }
  return [...map.values()]
}

function pauseOf(rule: PauseRule, row: SpendRow, summary: string): PauseProposal {
  return {
    kind: 'pause',
    rules: [rule],
    accountId: row.accountId,
    campaignId: row.campaignId,
    campaignName: nameOf(row.campaignName),
    adsetId: null,
    summary,
  }
}

function alert(code: AlertFinding['code'], accountId: string, summary: string): AlertFinding {
  return { kind: 'alert', code, accountId, summary }
}

function sumSpend(rows: readonly SpendRow[]): number {
  return rows.reduce((sum, row) => sum + (row.spendCents > 0 ? row.spendCents : 0), 0)
}

function currenciesClash(rows: readonly SpendRow[]): boolean {
  const names = new Set(rows.filter((row) => row.spendCents > 0).map((row) => row.currency))
  return names.size > 1 || names.has(null)
}

function isPolicyError(status: string): boolean {
  return (POLICY_ERROR_STATUSES as readonly string[]).includes(status)
}

function ageHours(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return (now.getTime() - time) / 3_600_000
}

function nameOf(name: string): string {
  const cleaned = name.replace(/[{}[\]`]/g, '').trim()
  return cleaned.slice(0, 80) || '在投的广告系列'
}
