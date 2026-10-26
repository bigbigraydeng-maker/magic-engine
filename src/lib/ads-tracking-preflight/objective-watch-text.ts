/**
 * 按目标盯盘 · 给人看的文字（提醒的「什么 / 怎么办」和回执里的一句话摘要）。
 *
 * 纯文字拼装：不读网络、不读库、不读时钟。全部大白话，不出现黑话；
 * 提醒一律说明「这只是提醒，没有动你的广告」——盯盘从不改广告。
 * 🔴 平台通用：不点名任何客户，系列名从配置的 label 来。
 */

import type { MetricsRow } from './objective-watch'

const CURRENCY_PREFIX: Readonly<Record<string, string>> = { NZD: 'NZ$', AUD: 'A$', USD: 'US$' }

/** 币种单位的钱（例如 3.2 元）→ 「NZ$3.20」；币种不认识就用币种代码当前缀。 */
export function formatMoney(units: number, currency: string): string {
  return `${CURRENCY_PREFIX[currency] ?? `${currency} `}${units.toFixed(2)}`
}

export function formatCents(cents: number, currency: string): string {
  return formatMoney(cents / 100, currency)
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/** 频次最多留两位小数，去掉多余的 0（4.30 → 4.3）。 */
export function formatFrequency(f: number): string {
  return String(Number(f.toFixed(2)))
}

/** 小时最多留一位小数（7.0 → 7，7.46 → 7.5）。 */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 10) / 10)
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  ACTIVE: '投放中',
  PENDING_REVIEW: '审核中',
  IN_PROCESS: '处理中',
  PREAPPROVED: '预审通过',
  DISAPPROVED: '被拒登',
  WITH_ISSUES: '有问题',
  PENDING_BILLING_INFO: '缺付款信息',
  PAUSED: '已暂停',
  ADSET_PAUSED: '广告组已暂停',
  CAMPAIGN_PAUSED: '系列已暂停',
  ARCHIVED: '已归档',
  DELETED: '已删除',
}

export function statusLabel(status: string | null): string {
  if (status === null) return '状态未知'
  return STATUS_LABEL[status] ?? status
}

const REVIEWING = new Set(['PENDING_REVIEW', 'IN_PROCESS', 'PREAPPROVED'])
const REJECTED = new Set(['DISAPPROVED', 'WITH_ISSUES'])
const MAX_NAMES = 3

interface AdStatus {
  name: string
  effective_status: string | null
}

const quoted = (names: readonly string[]): string => names.slice(0, MAX_NAMES).map(n => `「${n}」`).join('、')

/** 一句话说清在投的广告现在各是什么状态（没花钱的原因多半写在这里）。 */
function adStatusSentence(ads: readonly AdStatus[]): string {
  const rejected = ads.filter(a => a.effective_status !== null && REJECTED.has(a.effective_status))
  const reviewing = ads.filter(a => a.effective_status !== null && REVIEWING.has(a.effective_status))
  const billing = ads.filter(a => a.effective_status === 'PENDING_BILLING_INFO')
  const active = ads.filter(a => a.effective_status === 'ACTIVE')
  const parts: string[] = []
  if (rejected.length > 0) parts.push(`其中 ${rejected.length} 个广告被 Meta 拒登或有问题（${quoted(rejected.map(a => a.name))}）。`)
  if (reviewing.length > 0) parts.push(`${reviewing.length} 个广告还在 Meta 审核中。`)
  if (billing.length > 0) parts.push(`${billing.length} 个广告缺付款信息。`)
  if (active.length > 0) parts.push(`${active.length} 个广告状态是投放中但没有花费，多半是受众太窄或出价太低。`)
  return parts.join('')
}

export interface AlertText {
  what: string
  how: string
}

export function zeroSpendText(input: { label: string; hours: number; ads: readonly AdStatus[] }): AlertText {
  const status = adStatusSentence(input.ads)
  return {
    what: `「${input.label}」最近一次改动后已过 ${formatHours(input.hours)} 小时，一分钱都没花——广告还没开始给人看。${status}`,
    how: '到广告管理工具打开这个系列，看里面广告的状态：卡在审核超过 24 小时就点进去看原因或申诉；被拒登就换素材重新提交；状态是投放中却不花钱，就查广告组的预算、受众大小和出价。这条只是提醒，没有动你的广告。',
  }
}

export function frequencyText(input: {
  label: string
  offenders: readonly { display: string; frequency: number }[]
  yellow: number
  red: number
}): AlertText {
  const list = input.offenders.map(o => `${o.display} ${formatFrequency(o.frequency)} 次`).join('、')
  return {
    what: `「${input.label}」里同一个人平均看到广告的次数偏高：${list}（超过 ${input.yellow} 次算黄灯，超过 ${input.red} 次算红灯）——同一批人被反复刷到，再投下去多半是浪费预算。`,
    how: '让广告负责人决定：换一支新视频、把受众放大，或先暂停频次最高的那个广告。这条只是提醒，没有动你的广告。',
  }
}

export function meNotReceivingText(input: { label: string; meta: number; me: number; level: 'yellow' | 'red' }): AlertText {
  const how = '先打开 CRM 看最近有没有新的 WhatsApp 会话：确实没有或明显偏少，就是 ME 收 WhatsApp 的通道出了问题，需要开发去查 WhatsApp 收信（回调）有没有断。'
  if (input.level === 'red') {
    return {
      what: `Meta 说「${input.label}」已经有 ${input.meta} 个人点广告开始了 WhatsApp 聊天，但 ME 里自这个系列创建以来一条 WhatsApp 新消息都没收到——客人的消息可能没进 CRM，会漏回。`,
      how,
    }
  }
  return {
    what: `Meta 说「${input.label}」有 ${input.meta} 个人点广告开始了 WhatsApp 聊天，ME 里只收到 ${input.me} 个会话——差了一半以上，可能有客人的消息没进 CRM。`,
    how,
  }
}

export function readFailedText(input: { label: string; error: string }): AlertText {
  return {
    what: `盯盘读不到「${input.label}」的数据（${input.error}）——这个系列现在没人在盯。`,
    how: '这是我们这边的欠账，不用你动手；如果这个系列其实已经删掉了，把它从盯盘配置里去掉就好。',
  }
}

// ─── 回执里的一句话摘要 ─────────────────────────────────────────────────────

export function stoppedHeadline(label: string): string {
  return `「${label}」已暂停，或里面没有在投的广告，不盯`
}

export function unreadHeadline(label: string, error: string): string {
  return `「${label}」没读到：${error}`
}

export function waitingHeadline(input: {
  label: string
  hours: number
  statusCounts: Readonly<Record<string, number>>
  /** 系列累计已经花过的钱（旧版本花的）；没有 = null */
  earlierSpendCents?: number | null
  currency?: string
}): string {
  const counts = Object.entries(input.statusCounts).map(([s, n]) => `${statusLabel(s)} ${n}`).join('、')
  const earlier = input.earlierSpendCents != null && input.earlierSpendCents > 0 && input.currency
    ? `；旧版本花过 ${formatCents(input.earlierSpendCents, input.currency)}，现在在投的广告还没花过钱`
    : ''
  return `「${input.label}」还没花钱（最近一次改动在 ${formatHours(input.hours)} 小时前${counts ? `；广告：${counts}` : ''}${earlier}）`
}

export function scheduledHeadline(input: { label: string; hoursToStart: number | null }): string {
  const when = input.hoursToStart === null ? '' : `（约 ${formatHours(Math.max(0, input.hoursToStart))} 小时后开始）`
  return `「${input.label}」已排好定时开投${when}，还没到点，不盯`
}

export function awarenessHeadline(input: { label: string; total: MetricsRow; currency: string }): string {
  const { total, currency } = input
  const cost = total.cost_per_thruplay === null ? '' : `（每次 ${formatMoney(total.cost_per_thruplay, currency)}）`
  const reach = total.reach === null ? '' : ` · 触达 ${formatCount(total.reach)} 人`
  const freq = total.frequency === null ? '' : ` · 平均看到 ${formatFrequency(total.frequency)} 次`
  return `「${input.label}」完整播放 ${formatCount(total.thruplays)} 次${cost}${reach}${freq} · 花费 ${formatCents(total.spend_cents, currency)}`
}

export function whatsappHeadline(input: {
  label: string
  total: MetricsRow
  me: { read: boolean; count: number | null } | null
  currency: string
}): string {
  const { total, currency } = input
  const cost = total.cost_per_conversation === null ? '' : `（每个 ${formatMoney(total.cost_per_conversation, currency)}）`
  const me = input.me === null ? '' : input.me.read && input.me.count !== null ? ` · ME 收到 ${input.me.count} 个` : ' · ME 收到几个没读到'
  return `「${input.label}」开始聊天 ${total.conversations} 个${cost} · 花费 ${formatCents(total.spend_cents, currency)}${me}`
}

/** 表单留资系列在判定出当天数字之前的一句；有当天数字时由盯盘改写成带花费和线索的那句。 */
export function leadFormWatchHeadline(label: string): string {
  return `「${label}」是表单留资系列，这一小时看花费、线索和审核状态`
}

/** 表单留资这一小时的摘要。没读到的数写成「没读到」，不当成 0。 */
export function leadFormDetailHeadline(input: {
  label: string
  todaySpendCents: number | null
  todayLeads: number | null
  currency: string
}): string {
  const spend = input.todaySpendCents === null
    ? '当天花费没读到'
    : `当天花费 ${formatCents(input.todaySpendCents, input.currency)}`
  const leads = input.todayLeads === null ? '当天线索没读到' : `当天线索 ${input.todayLeads} 条`
  return `「${input.label}」${spend}，${leads}`
}
