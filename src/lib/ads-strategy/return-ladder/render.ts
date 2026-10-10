/**
 * 一本账（return ladder）· 纯渲染模块（无 I/O、无 HTML）。
 *
 * 把 `ReturnLadder` 变成给非技术读者看的中文纯文本行。调用方自己转义。
 *
 * 规矩：
 *  - 平台通用：本文件不出现任何客户 / 行业 / 广告平台的名字。
 *  - 读不到的东西一律说「判不了 / 没有数」，不许用默认值糊过去。
 *  - 三个字母 ROI 只允许出现在第 6 级、且只在回报算得出来时；其余一律用「回报」。
 */

import { OUTCOME_STEP_LABEL } from '../portfolio/outcome-ladder'
import { formatMoney } from '@/lib/conversions/money'
import {
  LADDER_MIN_DEALS_FOR_VERDICT,
  type ReturnBlocker, type ReturnLadder, type LadderNote, type RevenueByCurrency, type SpendByCurrency,
} from './compute'

export interface LadderRenderOptions {
  /** 行业剧本里「结果」的叫法（来自 playbooks 的 resultNoun），如「咨询」「线索」 */
  resultNoun: string
}

export const RETURN_BLOCKER_TEXT: Readonly<Record<ReturnBlocker, string>> = {
  earlier_level_missing: '前面有一级还没有数',
  spend_incomplete: '花费数据没读全',
  currency_unknown: '有币种读不到或不认识',
  currency_mismatch: '花费和收入不是同一个币种，不相加也不相除',
  cycle_not_configured: '成交周期没配置，判不了（不用默认值）→ 该补：PM 和客户定一个成交周期',
  no_mature_month: '这几个月都还没走完成交周期：未成熟，不可判',
  no_spend_in_mature_months: '已走完成交周期的那几个月里没有广告花费，没法相除',
  too_few_deals: `已走完成交周期的月份里来源标记是投放渠道的成交不到 ${LADDER_MIN_DEALS_FOR_VERDICT} 单，太少不下结论（这个门槛是暂用值，待 PM 定）`,
  unknown_source_share_too_high: '来源不明的成交占比太高（这个门槛是暂用值，待 PM 定）',
}

export const LADDER_NOTE_TEXT: Readonly<Record<LadderNote, string>> = {
  config_unreadable: '广告配置这周没读出来，主结果是哪个判不了',
  timezone_unknown: '账户时区读不到，日期按 UTC 归，月初月末可能差一天',
  multiple_timezones: '名下账户不在同一个时区，统一按其中最早的那个日子归',
  spend_incomplete: '花费数据没读全，第 1、2 级的数只是已读到的部分',
  spend_stale: '花费数据已经很久没更新：可能是停投了，也可能是取数断了，两种情况从库里分不出来',
}

/** 一句话：算到第几级。 */
export function ladderHeadline(ladder: ReturnLadder): string {
  if (ladder.reachedLevel === 0) return '连第 1 级（花费）都没有数'
  return `算到第 ${ladder.reachedLevel} 级（一共 6 级，后面的还没有数）· 近三个自然月累计 ${ladder.window.from} ~ ${ladder.window.to}，不是本周`
}

// ---------------------------------------------------------------------------
// 金额
// ---------------------------------------------------------------------------

function spendEntry(s: SpendByCurrency): string {
  const amount = s.amount.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${s.currency ?? '币种未知'} ${amount}`
}

function revenueEntry(r: RevenueByCurrency): string {
  const formatted = formatMoney(r.amountMinor, r.currency)
  if (formatted === null) return `${r.currency ?? '币种未知'}（金额换算不了）`
  return formatted
}

function joinMoney(entries: readonly string[]): string {
  if (entries.length === 0) return '无'
  if (entries.length === 1) return entries[0] ?? '无'
  return `${entries.join('；')}（币种不同，不相加）`
}

function spendMoney(byCurrency: readonly SpendByCurrency[]): string {
  return joinMoney(byCurrency.map(spendEntry))
}

function revenueMoney(byCurrency: readonly RevenueByCurrency[]): string {
  return joinMoney(byCurrency.map(revenueEntry))
}

function stamp(latestDate: string | null): string {
  return latestDate === null ? '' : ` · 数据截至 ${latestDate}`
}

// ---------------------------------------------------------------------------
// 逐级
// ---------------------------------------------------------------------------

function spendLine(ladder: ReturnLadder): string {
  const s = ladder.spend
  if (s.status === 'has') {
    const stale = ladder.notes.includes('spend_stale') && s.daysSinceLatest !== null ? `（⚠️ 近 ${s.daysSinceLatest} 天没有新花费数据）` : ''
    return `① 花费：${spendMoney(s.byCurrency)}（${s.daysWithData} 天有花费，${s.accountCount} 个账户；只含已接入的投放渠道，含不含税没有区分）${stamp(s.latestDate)}${stale}`
  }
  if (s.status === 'cannot_judge') {
    return `① 花费：没读全，判不了。已读到的部分：${spendMoney(s.byCurrency)}。该补：负责同事查取数`
  }
  return '① 花费：没有数。缺：这段时间的广告花费 → 该补：负责同事查取数'
}

function resultsLine(ladder: ReturnLadder): string {
  const r = ladder.results
  const leadLabel = OUTCOME_STEP_LABEL.lead
  const chatLabel = OUTCOME_STEP_LABEL.messaging_started
  const leadPart = r.primary === 'lead' ? `${leadLabel}【主结果】` : leadLabel
  const chatPart = r.primary === 'messaging_started' ? `${chatLabel}【主结果】` : chatLabel
  if (r.status === 'has') {
    const n = (v: number | null) => (v === null ? '读不到' : `${v} 个`)
    return `② ${leadPart} ${n(r.leads)} · ${chatPart} ${n(r.conversations)}（投放渠道自己报的数；两个数多半是同一批人的两个阶段，不相加）${stamp(r.latestDate)}`
  }
  if (r.status === 'cannot_judge') {
    return `② ${leadLabel} / ${chatLabel}：花费数据没读全，判不了`
  }
  return `② ${leadLabel} / ${chatLabel}：没有数`
}

function qualifiedLine(ladder: ReturnLadder, resultNoun: string): string {
  const q = ladder.qualified
  const pending = q.pendingReview > 0 ? `；另有 ${q.pendingReview} 条待审没算` : ''
  if (q.status === 'has') {
    return `③ 合格${resultNoun}：已有证据确认的 ${q.count} 个（${sourceText(q, '个')}）。没进表的不等于不合格，所以这不是合格率，不能拿它除第 2 级，也不能直接除花费${pending}${stamp(q.latestDate)}`
  }
  return `③ 合格${resultNoun}：没有数（不等于 0 个）${pending}。缺：哪些${resultNoun}是合格的 → 该补：客户销售回填，负责同事接通回填通道`
}

/** 来源三分：投放渠道 / 其它来源 / 来源不明。 */
function sourceText(x: { fromPaid: number; otherSource: number; unknownSource: number }, unit: string): string {
  return `来源标记是投放渠道 ${x.fromPaid} ${unit}、其它来源 ${x.otherSource} ${unit}、来源不明 ${x.unknownSource} ${unit}`
}

function dealsExtra(d: ReturnLadder['deals'], includeUnplaced: boolean): string {
  let extra = ''
  if (includeUnplaced && d.unplacedMonth > 0) extra += `；其中 ${d.unplacedMonth} 单连不上是哪个月进来的线索`
  if (d.leadInBeforeWindow > 0) extra += `；另有 ${d.leadInBeforeWindow} 单是更早进来的线索成交的，没算在内`
  if (d.pendingReview > 0) extra += `；另有 ${d.pendingReview} 单待审没算`
  return extra
}

function dealsLine(ladder: ReturnLadder): string {
  const d = ladder.deals
  if (d.status === 'has') {
    return `④ 成交：${d.count} 单，是这个客户全部已确认的成交，不都是广告带来的（${sourceText(d, '单')}）${dealsExtra(d, true)}${stamp(d.latestDate)}`
  }
  return `④ 成交单数：没有数${dealsExtra(d, false)}。缺：成交记录 → 该补：客户回填成交，负责同事跟`
}

function revenueLine(ladder: ReturnLadder): string {
  const r = ladder.revenue
  if (r.status === 'has') {
    return `⑤ 成交金额：定金口径（只算首笔收款）${revenueMoney(r.firstPayment)}；全款口径（首笔＋已到账尾款）${revenueMoney(r.withBalance)}。退款没有记录，实际可能更低${stamp(r.latestDate)}`
  }
  return '⑤ 成交金额：没有数。缺：每单的金额和币种 → 该补：客户回填成交时一起填'
}

function ratioText(v: number | null): string {
  return v === null ? '算不出' : `${v}`
}

function returnLine(ladder: ReturnLadder): string {
  const r = ladder.returnOnSpend
  if (r.status === 'has') {
    const immature = r.immatureMonths.length > 0 ? `。${r.immatureMonths.join('、')} 未成熟，不可判` : ''
    const unknown = r.unknownSourceDeals > 0 ? `；另有 ${r.unknownSourceDeals} 单来源不明没算进去` : ''
    return `⑥ ROI（成交收入 ÷ 广告费；范围比第 5 级窄：只算已走完成交周期的 ${r.matureMonths.join('、')}、来源标记是投放渠道的 ${r.dealCount} 单${unknown}）：定金口径 ${ratioText(r.firstPaymentBasis)} 倍；全款口径 ${ratioText(r.withBalanceBasis)} 倍；剔掉最大一单后 ${ratioText(r.withBalanceBasisWithoutLargest)} 倍。退款没有记录，实际可能更低${immature}`
  }
  if (r.blockers.includes('earlier_level_missing')) {
    return '⑥ 回报（成交收入 ÷ 广告费）：还算不到，先要补齐前面缺的那一级'
  }
  const reasons = r.blockers.map(b => RETURN_BLOCKER_TEXT[b]).join('；')
  return `⑥ 回报（成交收入 ÷ 广告费）：判不了。原因：${reasons}`
}

function reachedNote(ladder: ReturnLadder): string[] {
  const n = ladder.reachedLevel
  if (n === 1 || n === 2) return [`只到第 ${n} 级：现在只能说每个结果花了多少钱，不能说赚没赚。`]
  if (n === 3 || n === 4 || n === 5) return [`只到第 ${n} 级：后面的级没有数，不估、不拿别的数顶替。`]
  return []
}

/** 六级逐行 + 提醒行。纯文本，调用方自己转义。 */
export function ladderLines(ladder: ReturnLadder, opts: LadderRenderOptions): string[] {
  const lines = [
    spendLine(ladder),
    resultsLine(ladder),
    qualifiedLine(ladder, opts.resultNoun),
    dealsLine(ladder),
    revenueLine(ladder),
    returnLine(ladder),
    ...reachedNote(ladder),
  ]
  for (const note of ladder.notes) lines.push(`提醒：${LADDER_NOTE_TEXT[note]}`)
  return lines
}
