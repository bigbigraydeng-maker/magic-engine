/**
 * 巡检广告级结论 → 客户可读文案（Magic Bridge 报告第三部分，由程序拼接，不经 AI）。
 * 文案经板桥审（2026-09-26）。只有 Magic Engine 代管广告的客户才有巡检，
 * 所以建议一律用「我们的团队会处理」口吻，不叫客户自己去改账户。
 * 🔴 不许出现：巡检、规则、D2、D10、显著、p 值、手册、PM、FDE、模型或供应商名、
 * 英文缩写（CTR/CPL/CPM）。
 */

import { classifyFatigue, FATIGUE_FREQUENCY_HIGH, type FatigueKind } from './fatigue'
import type { RuleFinding } from './patrol-findings'

export interface ClientRuleFinding {
  kind: 'post_click_drop' | 'fatigue'
  adName: string
  headline: string
  detail: string
  action: string
  /** 近 3 天这条广告的花费（排序用），拿不到为 0 */
  spend: number
}

export interface ClientCopyOptions {
  currency: string | null
  /** 巡检数据截至哪天（YYYY-MM-DD，账户时区） */
  dataDate: string
  /** 所在广告系列近 7 天去重频次（Magic Bridge 现读），巡检频次缺失时补 */
  campaignFrequency: (campaignId: string | null) => number | null
}

export type RuleSectionInput =
  | { source: 'patrol'; dataDate: string; adsChecked: number; findings: ClientRuleFinding[] }
  | {
      source: 'none'
      reason:
        | 'not_connected'
        | 'stale'
        | 'partial'
        | 'shared_account'
        | 'client_page_unknown'
        | 'not_loaded'
        | 'no_delivering_ads'
    }

/** YYYY-MM-DD → 「9月24日」 */
export function formatDay(day: string): string {
  const [, month, date] = day.split('-')
  return `${Number(month)}月${Number(date)}日`
}

/** NZD → 'NZ$12.30'；AUD → 'A$'；USD → 'US$'；其它 → `${code} 12.30`；null currency → '12.30'。null amount → '—' */
export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || !Number.isFinite(amount)) return '—'
  const value = amount.toFixed(2)
  if (currency === null) return value
  if (currency === 'NZD') return `NZ$${value}`
  if (currency === 'AUD') return `A$${value}`
  if (currency === 'USD') return `US$${value}`
  return `${currency} ${value}`
}

/** 0.0391 → '3.9%' */
export function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/** 在 YYYY-MM-DD 上加 n 天（UTC）。 */
function shiftDay(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** evidence 里的值：有限数字才返回，否则 null。 */
function num(v: string | number | boolean | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function actionSentence(dataDate: string, changed: string): string {
  return `我们的广告团队已经看到这个情况，会在 ${formatDay(shiftDay(dataDate, 7))} 前后复查并处理，你不用动手。如果你最近自己改过这条广告的${changed}，请告诉我们。`
}

function adNameOf(f: RuleFinding): string | null {
  const ad = f.units?.find((u) => u.level === 'ad')
  return ad ? (ad.name ?? ad.id) : null
}

export function toClientFinding(f: RuleFinding, opts: ClientCopyOptions): ClientRuleFinding | null {
  if (f.status !== 'hit') return null
  if (f.code !== 'D2' && f.code !== 'D10') return null
  const adName = adNameOf(f)
  if (adName === null) return null
  const ev = f.evidence ?? {}
  const base = num(ev.base_rate)
  const recent = num(ev.recent_rate)
  if (base === null || recent === null) return null
  const spend = num(ev.recent_spend) ?? 0
  const suffix = `（数据截至 ${formatDay(opts.dataDate)}）`
  if (f.code === 'D10') return d10Finding(f, opts, ev, adName, base, recent, spend, suffix)
  return d2Finding(f, opts, ev, adName, base, recent, spend, suffix)
}

function d10Finding(
  f: RuleFinding,
  opts: ClientCopyOptions,
  ev: Record<string, string | number | boolean | null>,
  adName: string,
  base: number,
  recent: number,
  spend: number,
  suffix: string,
): ClientRuleFinding | null {
  const metric = ev.core_metric
  const noun = metric === 'lead' ? '留下联系方式' : metric === 'messaging_started' ? '发私信咨询' : null
  if (noun === null) return null
  const who = metric === 'lead' ? '留下联系方式的客户' : '发私信咨询的客户'
  const money = (a: number | null) => formatMoney(a, opts.currency)
  const baseCpr = num(ev.base_cost_per_result)
  const recentCpr = num(ev.recent_cost_per_result)
  const peers = ev.baseline_source === 'same_adset_peers'
  const headline = peers
    ? `「${adName}」最近 3 天，点进来的人里${noun}的比例只有 ${formatPct(recent)}，同一组里其它广告是 ${formatPct(base)}`
    : recent === 0
      ? `「${adName}」最近 3 天还没有人${noun}（之前两周点进来的人里有 ${formatPct(base)} 会${noun}）`
      : `「${adName}」最近 3 天，点进来的人里${noun}的比例从之前两周的 ${formatPct(base)} 降到了 ${formatPct(recent)}`
  const costLine =
    recentCpr === null
      ? `最近 3 天花了 ${money(spend)} 还没有带来${who}。`
      : `每位${who}的成本从 ${money(baseCpr)} 涨到了 ${money(recentCpr)}。`
  const cause =
    metric === 'lead'
      ? '问题多半出在点进去之后，比如表单问题太多太长，而不是广告图片本身。'
      : '问题多半出在点进去之后，比如客户看到的欢迎语或快捷问题不够吸引人，而不是广告图片本身。'
  const detail = peers
    ? recentCpr === null
      ? `它最近 3 天花了 ${money(spend)} 还没有带来${who}，同一组里其它广告每位只要 ${money(baseCpr)}。`
      : `它每带来一位${who}要花 ${money(recentCpr)}，同一组里其它广告只要 ${money(baseCpr)}。`
    : costLine + cause
  const changed = metric === 'lead' ? '表单' : '欢迎语或快捷问题'
  return {
    kind: 'post_click_drop',
    adName,
    headline: headline + suffix,
    detail,
    action: actionSentence(opts.dataDate, changed),
    spend,
  }
}

function d2Finding(
  f: RuleFinding,
  opts: ClientCopyOptions,
  ev: Record<string, string | number | boolean | null>,
  adName: string,
  base: number,
  recent: number,
  spend: number,
  suffix: string,
): ClientRuleFinding {
  const evFreq = num(ev.frequency_7d)
  const campaignId = typeof ev.campaign_id === 'string' ? ev.campaign_id : null
  const freq = evFreq ?? opts.campaignFrequency(campaignId)
  const rawKind = ev.fatigue_kind
  const kind: FatigueKind =
    evFreq !== null && (rawKind === 'audience' || rawKind === 'creative')
      ? rawKind
      : classifyFatigue(freq)
  const headline = `「${adName}」最近 3 天，看到广告后点进来的人变少了：点击率从之前两周的 ${formatPct(base)} 降到了 ${formatPct(recent)}`
  const prefix = '点击率就是看到广告的人里点进来的比例。'
  const f7 = freq ?? 0
  const body =
    kind === 'creative'
      ? `每个人一周平均只看到约 ${f7.toFixed(1)} 次，还不算多，所以不是大家看腻了，更可能是这条广告的图片或视频不够吸引人了。`
      : kind === 'audience'
        ? `同一批人一周平均已经看到这条广告约 ${f7.toFixed(1)} 次，看多了就不太会再点了。`
        : '这次拿不到每个人看了几次，所以分不清是图片或视频不够吸引人，还是同一批人看腻了。'
  return {
    kind: 'fatigue',
    adName,
    headline: headline + suffix,
    detail: prefix + body,
    action: actionSentence(opts.dataDate, '图片或视频'),
    spend,
  }
}

const NONE_REASON_TEXT: Record<
  Extract<RuleSectionInput, { source: 'none' }>['reason'],
  string
> = {
  not_connected: '还没有接入每日检查',
  stale: '每日检查最近几天没有更新',
  partial: '最近一次检查的数据没有拉全',
  shared_account: '这个账户暂时只做整体检查',
  client_page_unknown: '还没有登记这个客户的 Facebook 主页',
  not_loaded: '还没有拿到单条广告的数据',
  no_delivering_ads: '这个账户现在没有正在投放的广告',
}

export function renderRuleSection(input: RuleSectionInput): string {
  const title = '三、需要留意的广告'
  if (input.source === 'none') {
    return `${title}\n这个广告账户这次没有做单条广告检查：${NONE_REASON_TEXT[input.reason]}。`
  }
  if (input.findings.length === 0) {
    return `${title}\n这次没有发现哪条广告明显变差（看了 ${input.adsChecked} 条正在投放的广告，数据截至 ${formatDay(input.dataDate)}）。`
  }
  const sorted = [...input.findings].sort((a, b) => b.spend - a.spend)
  const blocks = sorted.map((x) => `${x.headline}\n${x.detail}\n${x.action}`)
  return `${title}\n${blocks.join('\n\n')}`
}
