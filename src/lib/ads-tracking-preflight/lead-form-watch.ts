/**
 * 把表单留资系列的故障接到每小时盯盘上：读额外的数、判三种故障、命中才调只暂停入口。
 * 系列停了、还没读到、或定时未开始，不调入口。
 */

import { judgeLeadFormFaults, DEFAULT_CRM_LAG_HOURS, DEFAULT_SYNC_FAILURE_RUNS, type LeadFormJudgeInput } from './lead-form-faults'
import type { PauseRequestReceipt, ServicePauseCall } from './lead-form-types'
import { leadFormDetailHeadline } from './objective-watch-text'
import type { SeriesFacts, SeriesVerdict } from './objective-watch'
import type { ObjectiveWatchSeries, TrackingClientConfig } from './types'

/** 跟盯盘函数的 step.run 同形。不从那个文件引进来，免得两边互相引用。 */
export interface LeadFormStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

const SKIP_STATES: ReadonlySet<SeriesVerdict['state']> = new Set(['stopped', 'unread', 'scheduled'])

export interface LeadFormExtra {
  todaySpendCents: number | null
  accountCapCents: number | null
  accountCapKnown: boolean
  accountTodaySpendCents: number | null
  totalCapCents: number | null
  totalCapKnown: boolean
  clientTodaySpendCents: number | null
  metaLeadsToday: number | null
  crmRead: boolean
  crmLeadsToday: number | null
  syncRead: boolean
  syncStreak: number | null
}

export interface LeadFormWatchDeps {
  readLeadFormExtra: (clientId: string, cfg: TrackingClientConfig, series: ObjectiveWatchSeries, facts: SeriesFacts, now: Date) => Promise<LeadFormExtra>
  loadPreviousSurplus: (clientId: string, campaignId: string) => Promise<string | null>
  requestServicePause: (call: ServicePauseCall) => Promise<PauseRequestReceipt>
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function multipleOf(series: ObjectiveWatchSeries): number | null {
  const value = series.daily_spend_multiple
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function signalsOf(input: {
  facts: SeriesFacts
  extra: LeadFormExtra
  series: ObjectiveWatchSeries
  previous: string | null
  currency: string
}): LeadFormJudgeInput['money'] & { crm: LeadFormJudgeInput['crm']; sync: LeadFormJudgeInput['sync'] } {
  const budget = input.facts.campaign.daily_budget_cents
  return {
    todaySpendCents: input.extra.todaySpendCents,
    lifetimeSpendCents: input.facts.total?.spend_cents ?? null,
    dailyBudgetCents: typeof budget === 'number' ? budget : null,
    accountCapCents: input.extra.accountCapCents,
    accountCapKnown: input.extra.accountCapKnown,
    accountTodaySpendCents: input.extra.accountTodaySpendCents,
    totalCapCents: input.extra.totalCapCents,
    totalCapKnown: input.extra.totalCapKnown,
    clientTodaySpendCents: input.extra.clientTodaySpendCents,
    multiple: multipleOf(input.series),
    currency: input.currency,
    crm: {
      read: input.extra.crmRead,
      leadsToday: input.extra.crmLeadsToday,
      metaLeadsToday: input.extra.metaLeadsToday,
      lagHours: positive(input.series.crm_lag_hours, DEFAULT_CRM_LAG_HOURS),
      previousSurplusSince: input.previous,
    },
    sync: {
      read: input.extra.syncRead,
      streak: input.extra.syncStreak,
      failureRuns: DEFAULT_SYNC_FAILURE_RUNS,
    },
  }
}

export function pauseCallOf(input: {
  clientId: string
  cfg: TrackingClientConfig
  series: ObjectiveWatchSeries
  facts: SeriesFacts
  faults: SeriesVerdict['stop_faults']
}): ServicePauseCall {
  const faults = input.faults ?? []
  const account = input.series.ad_account_id ?? input.cfg.ad_account_id
  return {
    client_id: input.clientId,
    campaign_id: input.series.campaign_id,
    campaign_name: input.facts.campaign.name,
    ad_account_id: account,
    fault_code: faults.map(item => item.code).join('+'),
    fault_what: faults.map(item => item.what).join('。').slice(0, 800),
    spend_today_cents: null,
    spend_lifetime_cents: input.facts.total?.spend_cents ?? null,
    currency: input.cfg.currency,
    as_of: input.facts.as_of,
    triggered_by: 'ads-tracking-launch-watch',
    idempotency_key: `${input.clientId}:${input.series.campaign_id}:${faults.map(item => item.code).join('+')}:${input.facts.as_of}`,
  }
}

/** 不是表单留资、或这一小时不该动手，返回 null（调用方保持原结论）。 */
export async function reviewLeadFormSeries(args: {
  step: LeadFormStep
  deps: LeadFormWatchDeps
  clientId: string
  cfg: TrackingClientConfig
  series: ObjectiveWatchSeries
  facts: SeriesFacts | { read: false }
  verdict: SeriesVerdict
  now: Date
}): Promise<Partial<SeriesVerdict> | null> {
  if (args.series.kind !== 'lead_form' || !args.facts.read) return null
  if (SKIP_STATES.has(args.verdict.state)) return null
  const facts = args.facts
  const extra = await args.step.run(`lead-form:${args.clientId}:${args.series.campaign_id}`, () =>
    args.deps.readLeadFormExtra(args.clientId, args.cfg, args.series, facts, args.now))
  const previous = await args.step.run(`lead-form-prev:${args.clientId}:${args.series.campaign_id}`, () =>
    args.deps.loadPreviousSurplus(args.clientId, args.series.campaign_id))
  const packed = signalsOf({ facts, extra, series: args.series, previous, currency: args.cfg.currency })
  const review = judgeLeadFormFaults({
    now: args.now,
    money: packed,
    crm: packed.crm,
    sync: packed.sync,
    ads: facts.ads,
    adsets: facts.adsets,
    campaignEffectiveStatus: facts.campaign.effective_status,
  })
  const pause = review.faults.length === 0
    ? null
    : await args.step.run(`lead-form-pause:${args.clientId}:${args.series.campaign_id}`, () => {
      const call = pauseCallOf({ clientId: args.clientId, cfg: args.cfg, series: args.series, facts, faults: review.faults })
      call.spend_today_cents = extra.todaySpendCents
      return args.deps.requestServicePause(call)
    })
  return {
    stop_faults: review.faults,
    stop_notes: review.notes,
    crm_surplus_since: review.crmSurplusSince,
    pause_request: pause,
    headline: leadFormDetailHeadline({
      label: args.series.label,
      todaySpendCents: extra.todaySpendCents,
      todayLeads: extra.metaLeadsToday,
      currency: args.cfg.currency,
    }),
  }
}
