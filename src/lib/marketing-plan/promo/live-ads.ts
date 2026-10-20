/**
 * 读「Meta 里现在有没有在跑的广告」（只读本库的快照表和日花费表，不调用 Meta）。
 * 只能在服务端用（引了 supabase）；页面组件要用的文案和类型在 live-ads-message.ts。
 */
import { supabaseAdmin } from '@/lib/supabase'
import { unusableAccountNote } from '@/lib/ads-strategy/war-map/pools'
import type { LiveAdsAccount, LiveAdsFact, LiveAdsState } from './live-ads-message'

export type { LiveAdsAccount, LiveAdsFact, LiveAdsState } from './live-ads-message'

export interface AccountInsightFact { last_day: string | null; spend_2d: number }
export interface AccountFact { currency: string | null; status_code: number | null }

export interface LiveAdsInput {
  /** 每个广告组最新一行快照（已按 entity 去重，新的在前） */
  adsets: { entity_id: string; ad_account_id?: string; effective_status: string | null; capture_reason: string | null; captured_at: string }[]
  /** 账户标签（来自绑定表）；没有就显示账户编号 */
  accountLabels?: Record<string, string | null>
  /** 每个账户的花费事实；缺这个账户 = 没法确认花费 */
  accountInsights?: Record<string, AccountInsightFact>
  /** 每个账户的状态码 / 币种（账户级快照） */
  accountFacts?: Record<string, AccountFact>
  today: string // YYYY-MM-DD（调用方给）
  snapshotAgeDays?: number | null
}

export function dayMinus(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10)
}

function stateOf(ins: AccountInsightFact | undefined, today: string, unusable: string | null): LiveAdsState {
  if (unusable !== null) return 'unusable'
  if (!ins || ins.last_day === null || ins.last_day < dayMinus(today, 1)) return 'no_spend_data'
  return ins.spend_2d > 0 ? 'spending' : 'idle'
}

function byAccount(input: LiveAdsInput): LiveAdsAccount[] {
  const map = new Map<string, LiveAdsAccount>()
  for (const a of input.adsets) {
    if (a.effective_status !== 'ACTIVE' || a.capture_reason === 'disappeared') continue
    const id = a.ad_account_id ?? '未知账户'
    const ins = input.accountInsights?.[id]
    const unusable = unusableAccountNote(input.accountFacts?.[id]?.status_code ?? null)
    const cur = map.get(id) ?? {
      ad_account_id: id, label: input.accountLabels?.[id] ?? null, live_adsets: 0, as_of: null,
      state: stateOf(ins, input.today, unusable), last_insight_day: ins?.last_day ?? null, spend_2d: ins?.spend_2d ?? 0,
      unusable_note: unusable,
    }
    cur.live_adsets += 1
    if (cur.as_of === null || a.captured_at > cur.as_of) cur.as_of = a.captured_at
    map.set(id, cur)
  }
  return Array.from(map.values())
}

export function summarizeLiveAds(input: LiveAdsInput): LiveAdsFact {
  const accounts = byAccount(input)
  let as_of: string | null = null
  for (const a of input.adsets) if (as_of === null || a.captured_at > as_of) as_of = a.captured_at
  const currency = Object.values(input.accountFacts ?? {}).map(f => f.currency).find((c): c is string => typeof c === 'string') ?? null
  return {
    ok: true,
    live_adsets: accounts.reduce((n, a) => n + a.live_adsets, 0),
    spending_adsets: accounts.filter(a => a.state === 'spending').reduce((n, a) => n + a.live_adsets, 0),
    by_account: accounts,
    currency,
    as_of,
    snapshot_age_days: input.snapshotAgeDays ?? null,
  }
}

// ── 读库 ─────────────────────────────────────────────────────────────────────
const FAIL: LiveAdsFact = { ok: false, reason: '读不到广告花费' }
const normalizeAccountId = (raw: string): string => `act_${raw.replace(/^act_/, '')}`
const toNumberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function loadAccountIds(clientId: string): Promise<{ ids: string[]; labels: Record<string, string | null> } | null> {
  const { data, error } = await supabaseAdmin.from('client_meta_ad_accounts').select('ad_account_id, label').eq('client_id', clientId)
  if (error) return null
  const labels: Record<string, string | null> = {}
  const ids: string[] = []
  for (const r of (data ?? []) as { ad_account_id: string | null; label: string | null }[]) {
    if (typeof r.ad_account_id !== 'string' || r.ad_account_id.length === 0) continue
    const id = normalizeAccountId(r.ad_account_id)
    ids.push(id)
    labels[id] = r.label
  }
  if (ids.length > 0) return { ids, labels }
  const fallback = await supabaseAdmin.from('clients').select('meta_ad_account_id').eq('id', clientId).maybeSingle()
  if (fallback.error) return null
  const single = (fallback.data as { meta_ad_account_id: string | null } | null)?.meta_ad_account_id
  return { ids: typeof single === 'string' && single.length > 0 ? [normalizeAccountId(single)] : [], labels: {} }
}

async function loadAdsets(clientId: string, accounts: string[], since: string): Promise<LiveAdsInput['adsets'] | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('entity_id, ad_account_id, effective_status, capture_reason, captured_at')
    .eq('client_id', clientId).eq('level', 'adset').in('ad_account_id', accounts).gte('captured_at', since)
    .order('captured_at', { ascending: false }).limit(2000)
  if (error) return null
  const seen = new Set<string>()
  const out: LiveAdsInput['adsets'] = []
  for (const r of (data ?? []) as LiveAdsInput['adsets']) {
    if (seen.has(r.entity_id)) continue
    seen.add(r.entity_id)
    out.push(r)
  }
  return out
}

async function loadAccountInsights(clientId: string, accounts: string[], today: string): Promise<Record<string, AccountInsightFact> | null> {
  const since = dayMinus(today, 1)
  const out: Record<string, AccountInsightFact> = {}
  for (const id of accounts) {
    const base = () => supabaseAdmin.from('ad_daily_insights').select('insight_date, spend')
      .eq('client_id', clientId).eq('ad_account_id', id).eq('level', 'campaign')
    const latest = await base().order('insight_date', { ascending: false }).limit(1)
    const recent = await base().gte('insight_date', since)
    if (latest.error || recent.error) return null
    const spend = ((recent.data ?? []) as { spend: unknown }[]).reduce((n, r) => n + (toNumberOrNull(r.spend) ?? 0), 0)
    out[id] = { last_day: (latest.data as { insight_date: string }[] | null)?.[0]?.insight_date ?? null, spend_2d: spend }
  }
  return out
}

/** 账户级快照：状态码（欠款/停用）和币种；读不到就当没有（不影响主流程）。 */
async function loadAccountFacts(clientId: string, accounts: string[]): Promise<Record<string, AccountFact>> {
  const out: Record<string, AccountFact> = {}
  for (const id of accounts) {
    const { data, error } = await supabaseAdmin.from('ad_entity_snapshots').select('currency, account_status')
      .eq('client_id', clientId).eq('ad_account_id', id).eq('level', 'account')
      .order('captured_at', { ascending: false }).limit(1)
    const row = (data as { currency: string | null; account_status: number | null }[] | null)?.[0]
    if (!error && row) out[id] = { currency: row.currency, status_code: row.account_status }
  }
  return out
}

/** 最近一次广告快照抓取距今天数；读不到 = null。快照表最近 2 天一行都没有时，靠它区分「真没有」和「抓取停摆」。 */
async function loadSnapshotAgeDays(clientId: string, accounts: string[], now: Date): Promise<number | null> {
  const { data, error } = await supabaseAdmin.from('ad_snapshot_captures').select('captured_at')
    .eq('client_id', clientId).in('ad_account_id', accounts).eq('level', 'adset')
    .order('captured_at', { ascending: false }).limit(1)
  const at = (data as { captured_at: string }[] | null)?.[0]?.captured_at
  if (error || !at) return null
  return Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000))
}

export async function loadLiveAds(clientId: string, now: Date = new Date()): Promise<LiveAdsFact> {
  try {
    const bound = await loadAccountIds(clientId)
    if (bound === null) return FAIL
    if (bound.ids.length === 0) return { ok: false, reason: '这个客户没有绑定广告账户' }
    const today = now.toISOString().slice(0, 10)
    const adsets = await loadAdsets(clientId, bound.ids, new Date(now.getTime() - 2 * 86_400_000).toISOString())
    const accountInsights = await loadAccountInsights(clientId, bound.ids, today)
    if (adsets === null || accountInsights === null) return FAIL
    const [accountFacts, snapshotAgeDays] = await Promise.all([
      loadAccountFacts(clientId, bound.ids), loadSnapshotAgeDays(clientId, bound.ids, now),
    ])
    return summarizeLiveAds({ adsets, accountLabels: bound.labels, accountInsights, accountFacts, today, snapshotAgeDays })
  } catch {
    return FAIL
  }
}
