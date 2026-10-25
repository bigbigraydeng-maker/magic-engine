/**
 * 「计划没批准，Meta 里却可能已有广告在跑」的提示文案（纯函数，不引任何服务端模块：
 * 页面组件会直接 import 它，一旦这里 import 了 supabase，浏览器一加载就会因缺服务端密钥整页白屏）。
 */
import { publicAdAccountName } from '@/lib/ads/spend-figures'

/**
 * spending = 近 2 天确认有花费；no_spend_data = 状态开着但花费数据缺失/没跟上，没法确认；
 * idle = 花费数据是新的且近 2 天为 0；unusable = 账户欠款/停用，不会出广告。
 */
export type LiveAdsState = 'spending' | 'no_spend_data' | 'idle' | 'unusable'

export interface LiveAdsAccount {
  ad_account_id: string
  label: string | null
  live_adsets: number
  as_of: string | null
  state: LiveAdsState
  /** 该账户花费数据最新一天；一条都没有 = null */
  last_insight_day: string | null
  spend_2d: number
  /** 账户不可用的原因（欠款/停用）；可用 = null */
  unusable_note: string | null
}

export type LiveAdsFact =
  | {
      ok: true
      live_adsets: number
      spending_adsets: number
      by_account: LiveAdsAccount[]
      currency: string | null
      as_of: string | null
      /** 最近一次「完整」广告快照抓取距今小时数；读不到 = null */
      snapshot_age_hours: number | null
    }
  | { ok: false; reason: string }

export type LiveAdsLevel = 'red' | 'amber' | 'grey'
export interface LiveAdsMessage { level: LiveAdsLevel; text: string }

const MONEY_PREFIX: Record<string, string> = { NZD: 'NZ$', AUD: 'A$', USD: 'US$' }
const nameOf = (a: LiveAdsAccount): string => publicAdAccountName(a.label, a.ad_account_id)
const REFRESH_NOTE = '（页面数据每 6 小时更新一次，以 Meta 为准）'
/** 快照抓取停摆多久算「没更新」：每 6 小时抓一次，超过 2 天一定是出问题了 */
export const SNAPSHOT_STALE_HOURS = 48
/** 「确认没有在跑的广告」要求快照新到什么程度：抓取每 6 小时一次，留 2 小时余量 */
export const SNAPSHOT_FRESH_HOURS = 8

function redSentence(spending: LiveAdsAccount[], currency: string | null): string {
  const prefix = currency ? (MONEY_PREFIX[currency] ?? `${currency} `) : ''
  const items = spending.map(a => `${nameOf(a)} 近 2 天已花 ${prefix}${a.spend_2d.toFixed(2)}（${a.live_adsets} 个广告组开着）`)
  return `⚠️ ME 里没有这些广告的批准记录，但 Meta 里它们在花钱：${items.join('；')}。要么补走批准流程，要么到 Meta 暂停。${REFRESH_NOTE}`
}

function amberSentence(unknown: LiveAdsAccount[]): string {
  const items = unknown.map(a => `${nameOf(a)} 有 ${a.live_adsets} 个广告组是「开着」的，${a.last_insight_day ? `但这个账户从 ${a.last_insight_day} 起没有花费记录` : '但还没有任何花费记录'}`)
  return `ℹ️ ${items.join('；')}。新开投的广告，花费数据明天才会到，所以它们可能已经在花钱——请到 Meta 核对，别当成没事。`
}

function greySentences(fact: Extract<LiveAdsFact, { ok: true }>): string[] {
  const out: string[] = []
  for (const a of fact.by_account.filter(x => x.state === 'unusable')) out.push(`${nameOf(a)}：${a.unusable_note ?? '账户不可用'}，不会出广告。`)
  const idle = fact.by_account.filter(x => x.state === 'idle')
  if (idle.length > 0) out.push(`${idle.map(a => `${nameOf(a)} ${a.live_adsets} 个`).join('、')}广告组状态是「开着」，但近 2 天没有花费。`)
  return out
}

/**
 * 把读取结果翻成给 PM 的话。红字只给「近 2 天确认有花费」的账户；
 * 状态开着但花费数据没跟上 → 黄字（明说可能已经在花钱，别当成没事）；欠款停摆/近 2 天没花费 → 灰字；
 * 快照太久没更新 → 灰字（不能让「0 个」读成没事）。读不到 / 确实没有 → null。
 */
export function describeLiveAds(fact: LiveAdsFact | null): LiveAdsMessage | null {
  if (!fact || !fact.ok) return null
  if (fact.live_adsets <= 0) {
    const age = fact.snapshot_age_hours
    return age !== null && age >= SNAPSHOT_STALE_HOURS
      ? { level: 'grey', text: `广告快照已 ${Math.floor(age / 24)} 天没更新，没法判断 Meta 里有没有在跑的广告，请到 Meta 核对。` }
      : null
  }
  const spending = fact.by_account.filter(a => a.state === 'spending')
  const unknown = fact.by_account.filter(a => a.state === 'no_spend_data')
  const parts: string[] = []
  if (spending.length > 0) parts.push(redSentence(spending, fact.currency))
  if (unknown.length > 0) parts.push(amberSentence(unknown))
  parts.push(...greySentences(fact))
  if (parts.length === 0) return null
  const level: LiveAdsLevel = spending.length > 0 ? 'red' : unknown.length > 0 ? 'amber' : 'grey'
  return { level, text: parts.join(' ') }
}

/**
 * 排期表头那句「目前广告没有投」只在确认没有在跑的广告时才写：
 * 读不到 / 非内部账号（传 null）/ 快照不够新 → unknown（不写）。快照每 6 小时抓一次，所以新鲜度只给 8 小时。
 */
export function adsRunningFrom(fact: LiveAdsFact | null): 'none' | 'running' | 'unknown' {
  if (!fact || !fact.ok) return 'unknown'
  if (fact.live_adsets > 0) return 'running'
  return fact.snapshot_age_hours !== null && fact.snapshot_age_hours < SNAPSHOT_FRESH_HOURS ? 'none' : 'unknown'
}
