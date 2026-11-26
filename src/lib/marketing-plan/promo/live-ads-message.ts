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
      /**
       * ok = 开投回执读全了；failed = 读不到或没读全，不能下「没有批准记录」的结论。
       * 缺这个字段 = 这次没有核对回执（旧调用），也不下那句结论。
       */
      receipt_read?: 'ok' | 'failed'
      /** 开着、但对不上「已执行并且读回」的开投回执的广告组数，按账户。 */
      unrecorded?: { ad_account_id: string; count: number }[]
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

function redSentence(fact: Extract<LiveAdsFact, { ok: true }>, rows: { ad_account_id: string; count: number }[]): string {
  const prefix = fact.currency ? (MONEY_PREFIX[fact.currency] ?? `${fact.currency} `) : ''
  const items = rows.map(row => {
    const account = fact.by_account.find(item => item.ad_account_id === row.ad_account_id)
    const name = account ? nameOf(account) : '已绑定的广告账户'
    const spend = account && row.count === account.live_adsets && account.state === 'spending'
      ? `，近 2 天已花 ${prefix}${account.spend_2d.toFixed(2)}`
      : ''
    return `${name} ${row.count} 个${spend}`
  })
  return `⚠️ 这些开着的广告组在 ME 里没有开投批准记录：${items.join('；')}。已经对上批准记录的不在这里。请补走批准流程，或者到 Meta 里暂停。${REFRESH_NOTE}`
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
 * 花费跟不跟得上。不在这里下「没有批准记录」的结论——那句只看开投回执，见 describeUnrecordedAdsets。
 * 状态开着但花费数据没跟上 → 黄字；欠款停摆 / 近 2 天没花费 → 灰字；
 * 快照太久没更新 → 灰字。读不到 / 确实没有 → null。
 */
export function describeLiveAds(fact: LiveAdsFact | null): LiveAdsMessage | null {
  if (!fact || !fact.ok) return null
  if (fact.live_adsets <= 0) {
    const age = fact.snapshot_age_hours
    return age !== null && age >= SNAPSHOT_STALE_HOURS
      ? { level: 'grey', text: `广告快照已 ${Math.floor(age / 24)} 天没更新，没法判断 Meta 里有没有在跑的广告，请到 Meta 核对。` }
      : null
  }
  const unknown = fact.by_account.filter(a => a.state === 'no_spend_data')
  const parts: string[] = []
  if (unknown.length > 0) parts.push(amberSentence(unknown))
  parts.push(...greySentences(fact))
  if (parts.length === 0) return null
  const level: LiveAdsLevel = unknown.length > 0 ? 'amber' : 'grey'
  return { level, text: parts.join(' ') }
}

/** 只点名没有「已执行并且读回」开投回执的广告组。回执没读全就不说「没有批准记录」。 */
export function describeUnrecordedAdsets(fact: LiveAdsFact | null): LiveAdsMessage | null {
  if (!fact || !fact.ok || fact.receipt_read === undefined) return null
  if (fact.receipt_read === 'failed') {
    return { level: 'grey', text: '读不到开投批准记录，没法判断哪些开着的广告组没有批准。' }
  }
  const rows = (fact.unrecorded ?? []).filter(row => row.count > 0)
  if (rows.length === 0) return null
  return { level: 'red', text: redSentence(fact, rows) }
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
