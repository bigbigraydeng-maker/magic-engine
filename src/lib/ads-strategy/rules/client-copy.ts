/**
 * 巡检广告级结论 → 客户可读文案（Magic Bridge 报告第三部分，由程序拼接，不经 AI）。
 * 文案经板桥审（2026-09-26）。只有 Magic Engine 代管广告的客户才有巡检，
 * 所以建议一律用「我们的团队会处理」口吻，不叫客户自己去改账户。
 * 🔴 不许出现：巡检、规则、D2、D10、显著、p 值、手册、PM、FDE、模型或供应商名、
 * 英文缩写（CTR/CPL/CPM）。
 */

import { classifyFatigue, type FatigueKind } from './fatigue'
import type { RuleFinding } from './patrol-findings'

export interface ClientRuleFinding {
  kind: 'post_click_drop' | 'fatigue'
  adName: string
  headline: string
  detail: string
  action: string
  /** 近 3 天这条广告的花费（排序用），拿不到为 0 */
  spend: number
  /** true = 这条结论解释了点击率（疲劳），报告里第一次出现时补一句点击率是什么 */
  explainsCtr: boolean
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
        | 'preparing'
        | 'stale'
        | 'partial'
        | 'shared_account'
        | 'client_page_unknown'
        | 'not_loaded'
        | 'no_delivering_ads'
        | 'incomplete_findings'
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

function askSentence(changed: string): string {
  return `如果你最近自己改过这条广告的${changed}，请告诉我们。`
}

function promiseSentence(dataDate: string): string {
  return `下面这几条我们的广告团队已经看到，会在${formatDay(shiftDay(dataDate, 7))}前后复查并处理，你不用动手。`
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
  if (f.code === 'D10') return d10Finding(opts, ev, adName, base, recent, spend, suffix)
  return d2Finding(opts, ev, adName, base, recent, spend, suffix)
}

function d10Finding(
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
  const who = metric === 'lead' ? '留下联系方式的人' : '发私信咨询的人'
  const money = (a: number | null) => formatMoney(a, opts.currency)
  const baseCpr = num(ev.base_cost_per_result)
  const recentCpr = num(ev.recent_cost_per_result)
  const peers = ev.baseline_source === 'same_adset_peers'
  const headline = peers
    ? recent === 0
      ? `「${adName}」最近 3 天点进来的人里，还没有人${noun}；同一组里其它广告，点进来的人里有 ${formatPct(base)} 会${noun}`
      : `「${adName}」最近 3 天，点进来的人里${noun}的比例只有 ${formatPct(recent)}，同一组里其它广告是 ${formatPct(base)}`
    : recent === 0
      ? `「${adName}」最近 3 天还没有人${noun}，之前两周点进来的人里有 ${formatPct(base)} 会${noun}`
      : `「${adName}」最近 3 天，点进来的人里${noun}的比例从之前两周的 ${formatPct(base)} 降到了 ${formatPct(recent)}`
  const costLine =
    recentCpr === null
      ? recent === 0
        ? `最近 3 天花了 ${money(spend)}，还没有带来${who}。`
        : ''
      : baseCpr === null
        ? `现在平均每带来一位${who}要花 ${money(recentCpr)}。`
        : `平均每带来一位${who}，花费从 ${money(baseCpr)} 涨到了 ${money(recentCpr)}。`
  const cause =
    metric === 'lead'
      ? '问题多半出在点进来之后，比如要填的表单太长、问题太多，而不是广告画面本身。'
      : '问题多半出在点进来之后，比如点进来的人看到的欢迎语或快捷问题不够吸引人，而不是广告画面本身。'
  const peerTail = baseCpr === null ? '。' : `，同一组里其它广告最近两周多平均每位只要 ${money(baseCpr)}。`
  const detail = peers
    ? recentCpr === null
      ? `它最近 3 天花了 ${money(spend)}，还没有带来${who}${peerTail}`
      : `它最近 3 天平均每带来一位${who}要花 ${money(recentCpr)}${peerTail}`
    : costLine + cause
  return {
    kind: 'post_click_drop',
    adName,
    headline: headline + suffix,
    detail,
    action: askSentence(metric === 'lead' ? '表单' : '欢迎语或快捷问题'),
    spend,
    explainsCtr: false,
  }
}

function d2Finding(
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
  const f7 = freq ?? 0
  const body =
    kind === 'creative'
      ? `和它一起投放的这批广告，每个人一周平均只看到约 ${f7.toFixed(1)} 次，还不算多，应该不是大家看腻了，更可能是这条广告的图片或视频不够吸引人了。`
      : kind === 'audience'
        ? `和它一起投放的这批广告，同一批人一周平均已经看到约 ${f7.toFixed(1)} 次，看多了就不太会再点了。`
        : '这次拿不到每个人看了几次，所以分不清是图片或视频不够吸引人，还是同一批人看腻了。'
  return {
    kind: 'fatigue',
    adName,
    headline: headline + suffix,
    detail: body,
    action: askSentence('图片或视频'),
    spend,
    explainsCtr: true,
  }
}

const NONE_REASON_TEXT: Record<
  Extract<RuleSectionInput, { source: 'none' }>['reason'],
  string
> = {
  not_connected: '它还没有接入每日检查',
  preparing: '单条广告检查还在准备中，准备好之后会自动出现在这里',
  stale: '最近几天的检查结果还没有更新，我们不想用旧数据下结论',
  partial: '最近一次检查时数据还没有到齐，我们不想用不完整的数据下结论',
  shared_account: '这个账户目前只看整体表现，暂时不逐条检查',
  client_page_unknown: '我们这边还没有登记好你的 Facebook 主页，登记好之后就会开始逐条检查',
  not_loaded: '这次没有拿到每条广告的数据，我们不想在数据不全时下结论',
  no_delivering_ads: '它现在没有正在投放的广告，没有需要检查的',
  incomplete_findings: '有几条广告这次的数据不完整，我们不想在数据不全时下结论',
}

const CTR_EXPLAINER = '点击率就是看到广告的人里点进来的比例。'

function findingBlock(x: ClientRuleFinding, explainCtr: boolean): string {
  const detail = explainCtr ? CTR_EXPLAINER + x.detail : x.detail
  return [x.headline, detail, x.action].filter((line) => line !== '').join('\n')
}

export function renderRuleSection(input: RuleSectionInput): string {
  const title = '三、需要留意的广告'
  if (input.source === 'none') {
    return `${title}\n这个广告账户这次没有做单条广告检查：${NONE_REASON_TEXT[input.reason]}。报告里其它部分的分析不受影响。`
  }
  if (input.findings.length === 0) {
    return `${title}\n这次没有发现连续两天以上明显变差的广告（检查了 ${input.adsChecked} 条正在投放的广告，数据截至 ${formatDay(input.dataDate)}）。`
  }
  const sorted = [...input.findings].sort((a, b) => b.spend - a.spend)
  let explained = false
  const blocks = sorted.map((x) => {
    const explainCtr = x.explainsCtr && !explained
    if (explainCtr) explained = true
    return findingBlock(x, explainCtr)
  })
  return `${title}\n${promiseSentence(input.dataDate)}\n\n${blocks.join('\n\n')}`
}
