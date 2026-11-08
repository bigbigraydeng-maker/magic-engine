/**
 * IMPACT 批次 B · 只读取数（无写入）。复用既有 7 天花费、上限、诊断、漏斗基线逻辑。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { pickWinnerBaseline, type FunnelMetrics } from '@/lib/ads-strategy/entity-tree/funnel-baseline'
import type { DiagnosisRun } from '@/lib/ads-strategy/portfolio/diagnostics/types'
import { loadAdStrategyConfigWithSource } from '@/lib/ads-strategy/config'
import { ACCOUNT_WINNER_MIN_LEADS } from '@/lib/ads-strategy/entity-tree/funnel-baseline'
import type {
  CiFunnelCheckSlice,
  C3EvidenceLine,
  C3WeeklyCheckSlice,
  ClientImpactGapBundle,
  I1BusinessProfileSlice,
  M2SpendAccountSlice,
  M2SpendVsCapSlice,
} from './impact-gap-present'

const FUNNEL_SEGMENTS = [
  { key: 'hook', name: '钩子（3 秒播放率）' },
  { key: 'ctr', name: '点击率' },
  { key: 'completion', name: '点击→留资完成率' },
  { key: 'cpm', name: '千次展示成本' },
] as const

function isoDateDaysAgo(from: Date, days: number): string {
  const d = new Date(from.getTime() - days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function nonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0
}

async function loadRegisteredAccounts(
  sb: SupabaseClient,
  clientId: string,
): Promise<Array<{ ad_account_id: string; daily_budget_cap_cents: number | null }>> {
  const { data, error } = await sb
    .from('client_meta_ad_accounts')
    .select('ad_account_id, daily_budget_cap_cents')
    .eq('client_id', clientId)
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ ad_account_id: string; daily_budget_cap_cents: number | null }>
}

async function loadSpend7dByAccount(
  sb: SupabaseClient,
  clientId: string,
  since: string,
): Promise<Map<string, { spend: number; currency: string | null }>> {
  const { data, error } = await sb
    .from('ad_daily_insights')
    .select('ad_account_id, spend, currency')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .gte('insight_date', since)
  if (error) throw new Error(error.message)
  const map = new Map<string, { spend: number; currencies: Set<string> }>()
  for (const row of data ?? []) {
    const id = (row as { ad_account_id: string }).ad_account_id
    const cur = map.get(id) ?? { spend: 0, currencies: new Set<string>() }
    cur.spend += num((row as { spend: unknown }).spend)
    const c = (row as { currency?: string | null }).currency
    if (typeof c === 'string' && c.length > 0) cur.currencies.add(c)
    map.set(id, cur)
  }
  const out = new Map<string, { spend: number; currency: string | null }>()
  for (const [id, v] of map) {
    const currencies = [...v.currencies]
    out.set(id, {
      spend: Math.round(v.spend * 100) / 100,
      currency: currencies.length === 1 ? currencies[0] : currencies.length > 1 ? null : null,
    })
  }
  return out
}

export async function gatherM2Slice(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<M2SpendVsCapSlice> {
  const since = isoDateDaysAgo(now, 6)
  const windowLabel = `${since} ～ ${now.toISOString().slice(0, 10)}（日历 7 天，各账户本地时区未再切日）`
  const settingsHref = `/dashboard/clients/${clientId}/ads-health?tab=settings`
  const gaps: string[] = []
  try {
    const [accounts, spendMap, loaded] = await Promise.all([
      loadRegisteredAccounts(sb, clientId),
      loadSpend7dByAccount(sb, clientId, since),
      loadAdStrategyConfigWithSource(clientId),
    ])
    if (accounts.length === 0) gaps.push('未登记 Meta 广告账户')
    const slices: M2SpendAccountSlice[] = []
    const currencies = new Set<string>()
    for (const acc of accounts) {
      const spendRow = spendMap.get(acc.ad_account_id)
      if (spendRow?.currency) currencies.add(spendRow.currency)
      slices.push({
        adAccountId: acc.ad_account_id,
        spend7d: spendRow?.spend ?? (spendMap.size === 0 ? null : 0),
        currency: spendRow?.currency ?? null,
        timezone: null,
        accountDailyCapCents: acc.daily_budget_cap_cents,
      })
    }
    const mixedCurrency = currencies.size > 1
    let spend7dTotal: number | null = null
    if (!mixedCurrency && slices.length > 0) {
      spend7dTotal = Math.round(slices.reduce((s, a) => s + (a.spend7d ?? 0), 0) * 100) / 100
    } else if (mixedCurrency) {
      spend7dTotal = null
      gaps.push('多账户币种不一致')
    }
    const capCents = loaded.config.daily_budget_cap_cents
    const capSource: M2SpendVsCapSlice['capSource'] =
      loaded.source === 'fallback'
        ? 'unreadable'
        : capCents === null
          ? 'missing'
          : 'me_settings'
    if (capSource === 'missing') gaps.push('客户日总上限未配置')
    if (capSource === 'unreadable') gaps.push('客户广告设置读失败')
    const currency = mixedCurrency ? null : (currencies.values().next().value ?? null)
    return {
      status: gaps.length === 0 ? 'ok' : 'gap',
      windowLabel,
      accounts: slices,
      spend7dTotal,
      currency: typeof currency === 'string' ? currency : null,
      mixedCurrency,
      clientDailyCapCents: capCents,
      capSource,
      gaps,
      settingsHref,
    }
  } catch (e) {
    return {
      status: 'unknown',
      windowLabel,
      accounts: [],
      spend7dTotal: null,
      currency: null,
      mixedCurrency: false,
      clientDailyCapCents: null,
      capSource: 'unreadable',
      gaps: [e instanceof Error ? e.message : '读失败'],
      settingsHref,
    }
  }
}

export async function gatherI1Slice(sb: SupabaseClient, clientId: string): Promise<I1BusinessProfileSlice> {
  const settingsHref = `/dashboard/clients/${clientId}/settings`
  const gaps: string[] = []
  try {
    const { data, error } = await sb
      .from('master_briefs')
      .select('products, primary_audience, buying_trigger, website_urls')
      .eq('client_id', clientId)
      .or('status.eq.active,is_active.eq.true')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) {
      gaps.push('没有生效中的 Master Brief')
      return {
        status: 'gap',
        hasActiveBrief: false,
        missingFields: [
          { key: 'brief', label: 'Master Brief' },
        ],
        gaps,
        settingsHref,
      }
    }
    const row = data as Record<string, unknown>
    const missing: I1BusinessProfileSlice['missingFields'] = []
    if (!nonEmptyArray(row.products)) missing.push({ key: 'products', label: '卖什么（产品）' })
    if (!nonEmptyString(row.primary_audience)) missing.push({ key: 'primary_audience', label: '卖给谁' })
    if (!nonEmptyString(row.buying_trigger)) missing.push({ key: 'buying_trigger', label: '下单理由' })
    if (!nonEmptyArray(row.website_urls) && !nonEmptyString(row.website_urls)) {
      missing.push({ key: 'website_urls', label: '官网网址' })
    }
    return {
      status: missing.length === 0 ? 'ok' : 'gap',
      hasActiveBrief: true,
      missingFields: missing,
      gaps,
      settingsHref,
    }
  } catch (e) {
    return {
      status: 'unknown',
      hasActiveBrief: false,
      missingFields: [],
      gaps: [e instanceof Error ? e.message : '读失败'],
      settingsHref,
    }
  }
}

function diagnosisLines(run: DiagnosisRun | null | undefined): { lines: C3EvidenceLine[]; gaps: string[] } {
  const gaps: string[] = []
  if (!run?.diagnoses?.length) {
    gaps.push('最近体检没有 portfolio_diagnoses')
    return { lines: [], gaps }
  }
  const lines: C3EvidenceLine[] = []
  for (const d of run.diagnoses) {
    if (d.status !== 'hit') continue
    if (d.code === 'D2') {
      lines.push({ kind: 'fatigue', summary: d.title.slice(0, 120) })
    }
    if (d.code === 'D11') {
      lines.push({ kind: 'audience', summary: d.title.slice(0, 120) })
    }
  }
  if (lines.length === 0) gaps.push('最近体检里没有命中的疲劳(D2)或受众(D11)结论')
  return { lines: lines.slice(0, 5), gaps }
}

async function loadActionOutcomeLines(
  sb: SupabaseClient,
  clientId: string,
  sinceIso: string,
): Promise<C3EvidenceLine[]> {
  const { data, error } = await sb
    .from('flywheel_actions')
    .select('action_type')
    .eq('client_id', clientId)
    .not('executed_at', 'is', null)
    .gte('executed_at', sinceIso)
    .like('action_type', 'ads.%')
    .order('executed_at', { ascending: false })
    .limit(3)
  if (error || !data?.length) return []
  return (data as Array<{ action_type: string }>).map((row) => ({
    kind: 'action' as const,
    summary: `${row.action_type} · 到期结论见成绩单（本切片未拉 outcome 表）`,
  }))
}

export async function gatherC3Slice(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<C3WeeklyCheckSlice> {
  const adsHealthHref = `/dashboard/clients/${clientId}/ads-health`
  const gaps: string[] = []
  try {
    const { data, error } = await sb
      .from('ad_health_narratives')
      .select('payload, insight_date')
      .eq('client_id', clientId)
      .order('insight_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const payload = data?.payload as { portfolio_diagnoses?: DiagnosisRun } | null | undefined
    const diag = diagnosisLines(payload?.portfolio_diagnoses)
    gaps.push(...diag.gaps)
    const sinceIso = new Date(now.getTime() - 7 * 86_400_000).toISOString()
    const actionLines = await loadActionOutcomeLines(sb, clientId, sinceIso)
    const lines = [...diag.lines, ...actionLines]
    if (!data) gaps.push('没有广告体检记录')
    return {
      status: lines.length === 0 ? 'gap' : 'ok',
      lines,
      gaps,
      adsHealthHref,
    }
  } catch (e) {
    return {
      status: 'unknown',
      lines: [],
      gaps: [e instanceof Error ? e.message : '读失败'],
      adsHealthHref,
    }
  }
}

async function loadAdFunnelMetrics(
  sb: SupabaseClient,
  clientId: string,
  since: string,
): Promise<FunnelMetrics[]> {
  const { data, error } = await sb
    .from('ad_daily_insights')
    .select('entity_id, spend, impressions, leads, link_clicks, video_3s_views, messaging_conversations')
    .eq('client_id', clientId)
    .eq('level', 'ad')
    .gte('insight_date', since)
  if (error) throw new Error(error.message)
  const byAd = new Map<string, FunnelMetrics & { ctr?: number | null }>()
  for (const row of data ?? []) {
    const id = (row as { entity_id: string }).entity_id
    const cur = byAd.get(id) ?? {
      spend: 0,
      impressions: 0,
      linkClicks: 0,
      leads: 0,
      video3sViews: 0,
      costPerLead: null,
      ctr: null,
    }
    cur.spend += num((row as { spend: unknown }).spend)
    cur.impressions += num((row as { impressions: unknown }).impressions)
    cur.linkClicks += num((row as { link_clicks: unknown }).link_clicks)
    cur.leads += num((row as { leads: unknown }).leads)
    cur.video3sViews += num((row as { video_3s_views: unknown }).video_3s_views)
    byAd.set(id, cur)
  }
  const metrics: FunnelMetrics[] = []
  for (const m of byAd.values()) {
    const cpl = m.leads > 0 ? m.spend / m.leads : null
    metrics.push({
      spend: m.spend,
      impressions: m.impressions,
      linkClicks: m.linkClicks,
      leads: m.leads,
      video3sViews: m.video3sViews,
      costPerLead: cpl,
    })
  }
  return metrics
}

export async function gatherCiSlice(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<CiFunnelCheckSlice> {
  const entityTreeHref = `/dashboard/clients/${clientId}/ads-health?tab=entities`
  const gaps: string[] = []
  const since = isoDateDaysAgo(now, 6)
  try {
    const metrics = await loadAdFunnelMetrics(sb, clientId, since)
    const winner = pickWinnerBaseline(metrics)
    const winnerHold = winner !== null
    if (!winnerHold) gaps.push(`没有 ≥${ACCOUNT_WINNER_MIN_LEADS} 条留资的赢家广告`)
    const segments = FUNNEL_SEGMENTS.map((seg) => {
      if (!winnerHold || !winner) {
        return { name: seg.name, state: 'unknown' as const, note: '缺可比 winner' }
      }
      const val = winner[seg.key === 'hook' ? 'hook' : seg.key === 'ctr' ? 'linkCtr' : seg.key === 'completion' ? 'completion' : 'cpm']
      if (val === null) {
        return { name: seg.name, state: 'unknown' as const, note: '指标缺失' }
      }
      return { name: seg.name, state: 'comparable' as const, note: `爆款基线已建立` }
    })
    return {
      status: winnerHold ? 'ok' : 'unknown',
      winnerHold,
      minLeads: ACCOUNT_WINNER_MIN_LEADS,
      segments,
      gaps,
      entityTreeHref,
    }
  } catch (e) {
    return {
      status: 'unknown',
      winnerHold: false,
      minLeads: ACCOUNT_WINNER_MIN_LEADS,
      segments: FUNNEL_SEGMENTS.map(s => ({ name: s.name, state: 'unknown', note: '读失败' })),
      gaps: [e instanceof Error ? e.message : '读失败'],
      entityTreeHref,
    }
  }
}

export async function gatherClientImpactGapBundle(
  sb: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<ClientImpactGapBundle> {
  const [m2, i1, c3, ci] = await Promise.all([
    gatherM2Slice(sb, clientId, now),
    gatherI1Slice(sb, clientId),
    gatherC3Slice(sb, clientId, now),
    gatherCiSlice(sb, clientId, now),
  ])
  return { clientId, m2, i1, c3, ci }
}
