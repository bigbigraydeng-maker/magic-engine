import type { SupabaseClient } from '@supabase/supabase-js'
import { loadClientCapFacts } from '@/lib/ads-strategy/circuit-cap-facts'
import { loadOutcomeConfig } from '@/lib/ads-strategy/portfolio/outcome-config'
import type { CostMetric } from '@/lib/ads-strategy/portfolio/goal-context'
import type { OutcomeStep } from '@/lib/ads-strategy/portfolio/outcome-ladder'
import { readClientPacing } from '@/lib/ads-strategy/intraday-spend/db'
import { shiftDay } from '@/lib/ads-strategy/intraday-spend/sample'
import type { IntradayAdsetSnap } from '@/lib/ads-strategy/intraday-spend/run'
import { evaluateDailySpendOverCapNotice } from '@/lib/ads-strategy/monitoring/spend-cap-notice'
import { APP_BASE } from '@/lib/pm-todo/binding-request-items'
import { evaluateEntityEarlyWarning, type EntityDayTotals } from './compare'
import {
  defaultEarlyWarningChannels,
  type EarlyWarningChannels,
  type EarlyWarningEmailFacts,
} from './notify-email'
import { deliverEarlyWarningToFde, listFdePortalRecipients } from './fde-outreach'
import {
  PATROL_KEY,
  RECEIPTS_KEY,
  TODO_KEY,
  parsePredictiveEarlyWarningConfig,
  patchLeadsConfigState,
  patrolLineForHeadline,
  predictiveEarlyWarningEnabled,
  readPatrolState,
  readReceipts,
  type ReceiptMap,
} from './switch'

export interface PredictiveEarlyWarningReceipt {
  clients: number
  alerts: number
  capEmails: number
  skippedNoFde: number
}

function count(metric: CostMetric, leads: number, messaging: number): number {
  return metric === 'leads' ? leads : metric === 'messaging' ? messaging : Math.max(leads, messaging)
}

function metricOf(leading: OutcomeStep | null, primary: OutcomeStep | null): CostMetric | null {
  const s = new Set([leading, primary])
  if (s.has('lead')) return 'leads'
  if (s.has('messaging_started')) return 'messaging'
  return null
}

async function baseline(
  sb: SupabaseClient,
  clientId: string,
  level: 'adset' | 'campaign',
  entityId: string,
  day: string,
  metric: CostMetric,
): Promise<EntityDayTotals[]> {
  const { data } = await sb
    .from('ad_daily_insights')
    .select('spend, leads, messaging_conversations')
    .eq('client_id', clientId)
    .eq('level', level)
    .eq('entity_id', entityId)
    .gte('insight_date', shiftDay(day, -7))
    .lte('insight_date', shiftDay(day, -1))
  return (data ?? []).map((r) => ({
    spendMajor: Number((r as { spend: number }).spend) || 0,
    resultCount: count(metric, (r as { leads: number | null }).leads ?? 0, (r as { messaging_conversations: number | null }).messaging_conversations ?? 0),
  }))
}

export async function runPredictiveEarlyWarning(
  sb: SupabaseClient,
  _now: Date,
  snaps: readonly IntradayAdsetSnap[],
  channels: EarlyWarningChannels = defaultEarlyWarningChannels(),
): Promise<PredictiveEarlyWarningReceipt> {
  const out: PredictiveEarlyWarningReceipt = { clients: 0, alerts: 0, capEmails: 0, skippedNoFde: 0 }
  const groups = new Map<string, IntradayAdsetSnap[]>()
  for (const s of snaps) {
    const g = groups.get(s.clientId)
    if (g) g.push(s)
    else groups.set(s.clientId, [s])
  }
  for (const [clientId, clientSnaps] of groups) {
    const { data } = await sb.from('clients').select('name, leads_config').eq('id', clientId).maybeSingle()
    const leadsConfig = (data as { leads_config?: unknown } | null)?.leads_config
    if (!predictiveEarlyWarningEnabled(leadsConfig)) continue
    out.clients += 1
    const name = (data as { name?: string | null } | null)?.name ?? clientId
    const accountDay = clientSnaps[0]?.accountDay
    if (!accountDay) continue
    const cfg = parsePredictiveEarlyWarningConfig(leadsConfig)
    const outcome = await loadOutcomeConfig(clientId)
    const metric = metricOf(outcome.config.leading, outcome.config.primary)
    const fdeRecipients = await listFdePortalRecipients(sb, clientId)
    const skipNote = fdeRecipients.length === 0 ? 'no FDE configured, push skipped' : null
    if (skipNote) out.skippedNoFde += 1
    const prior = readReceipts(leadsConfig)
    const next: ReceiptMap = { ...prior }
    const lines: string[] = []
    if (metric) {
      for (const snap of clientSnaps) {
        let level: 'adset' | 'campaign' = 'adset'
        let entityId = snap.adsetId
        let base = await baseline(sb, clientId, 'adset', snap.adsetId, accountDay, metric)
        if (base.filter((d) => d.spendMajor > 0 && d.resultCount > 0).length < 7 && snap.campaignId) {
          level = 'campaign'
          entityId = snap.campaignId
          base = await baseline(sb, clientId, 'campaign', snap.campaignId, accountDay, metric)
        }
        const key = `${level}:${entityId}`
        const verdict = evaluateEntityEarlyWarning({
          entityId,
          level,
          metric,
          today: { spendMajor: snap.spendMajor, resultCount: count(metric, snap.leads, snap.messaging) },
          baselineDays: base,
          minSpendMajor: cfg.minSpendMajor,
          accountDay,
          priorAlertCprMajor: prior[key]?.accountDay === accountDay ? prior[key].cprMajor : null,
        })
        if (!verdict.alert) continue
        const label = level === 'adset' ? '广告组' : '系列'
        lines.push(
          verdict.zeroResults
            ? `${label} ${entityId} 今日花费已超 ${cfg.minSpendMajor}，尚无成效`
            : `${label} ${entityId} 今日单次成本偏高`,
        )
        next[key] = { accountDay, cprMajor: verdict.todayCprMajor, zeroResults: verdict.zeroResults }
        if (fdeRecipients.length > 0) {
          const delivered = await deliverEarlyWarningToFde(
            sb,
            channels,
            clientId,
            fdeRecipients,
            fact(name, clientId, entityId, level, metric, accountDay, snap, verdict),
          )
          if (delivered.email === 'sent') out.alerts += 1
        }
      }
    }
    if (fdeRecipients.length > 0 && prior[`cap:${accountDay}`]?.accountDay !== accountDay) {
      out.capEmails += (await capMail(sb, clientId, name, accountDay, fdeRecipients, channels, next)) ? 1 : 0
    }
    await patchLeadsConfigState(sb, clientId, {
      [RECEIPTS_KEY]: next,
      [PATROL_KEY]: { accountDay, lines, skipNote },
      [TODO_KEY]: {
        accountDay,
        items: lines.map((what) => ({
          kind: 'ads_predictive_early_warning_alert',
          what: `「${name}」广告预警：${what}`,
          how: '打开广告健康页看花费与成效；系统不会自动改预算或暂停。',
          href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`,
        })),
      },
    })
  }
  return out
}

function fact(
  clientName: string,
  clientId: string,
  entityId: string,
  level: 'adset' | 'campaign',
  metric: CostMetric,
  accountDay: string,
  snap: IntradayAdsetSnap,
  verdict: Extract<ReturnType<typeof evaluateEntityEarlyWarning>, { alert: true }>,
): EarlyWarningEmailFacts {
  return {
    clientName,
    clientId,
    entityId,
    level,
    metric,
    accountDay,
    todayCprMajor: verdict.todayCprMajor,
    baselineCprMajor: verdict.baselineCprMajor,
    spendMajor: snap.spendMajor,
    currency: snap.currency ?? '—',
    zeroResults: verdict.zeroResults,
    kind: 'cpl_spike',
  }
}

async function capMail(
  sb: SupabaseClient,
  clientId: string,
  clientName: string,
  accountDay: string,
  fdeRecipients: Awaited<ReturnType<typeof listFdePortalRecipients>>,
  channels: EarlyWarningChannels,
  next: ReceiptMap,
): Promise<boolean> {
  const verdict = evaluateDailySpendOverCapNotice(await loadClientCapFacts(clientId))
  const pacing = await readClientPacing(sb, clientId, new Date()).catch(() => null)
  let facts: EarlyWarningEmailFacts | null = null
  if (verdict.alert) {
    facts = {
      clientName, clientId, entityId: 'account', level: 'campaign', metric: 'results', accountDay: verdict.referenceDate,
      todayCprMajor: null, baselineCprMajor: 0, spendMajor: verdict.spendMajor, currency: verdict.currency, zeroResults: false,
      kind: 'spend_over_cap_margin', capMajor: verdict.capMajor, forecastOrSpendMajor: verdict.spendMajor,
    }
  } else if (pacing?.clientOverCap && pacing.forecastMajor !== null && pacing.capMajor !== null && pacing.currency) {
    facts = {
      clientName, clientId, entityId: 'account', level: 'campaign', metric: 'results', accountDay,
      todayCprMajor: null, baselineCprMajor: 0, spendMajor: pacing.forecastMajor, currency: pacing.currency, zeroResults: false,
      kind: 'spend_over_cap_margin', capMajor: pacing.capMajor, forecastOrSpendMajor: pacing.forecastMajor,
    }
  }
  if (!facts) return false
  const delivered = await deliverEarlyWarningToFde(sb, channels, clientId, fdeRecipients, facts)
  if (delivered.email === 'sent') next[`cap:${accountDay}`] = { accountDay, cprMajor: null, zeroResults: false }
  return delivered.email === 'sent'
}

export async function loadPatrolEarlyWarningLine(sb: SupabaseClient, clientId: string, accountDay: string): Promise<string | null> {
  const { data } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  return patrolLineForHeadline(readPatrolState((data as { leads_config?: unknown } | null)?.leads_config, accountDay))
}