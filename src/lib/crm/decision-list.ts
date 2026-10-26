/**
 * 只读「今天需要关注谁」决策清单 —— CI-WP01（Issue #1009）。
 *
 * 不新增判据、不新增数据源：直接吃 `/api/clients/[id]/crm/today` 已经算好的桶
 * （lib/crm/segments + lib/crm/day-list + lib/crm/worklist-groups 那一整套冻结
 * 名单算法），把它拍平成一条按优先级排好的只读清单，每行只答三件事——
 * 这是谁 / 为什么现在处理 / 建议下一步。判据只有一份，这里不重新判断冷热。
 *
 * 四条防御性过滤（跟 today/route.ts 的判据是同一份事实，这里只是再挡一次，
 * 不代表这两处允许各写一套）：
 *   · 今天已经处理过的人不算「需要关注」——他不该出现在只读清单上
 *   · 被标「别再联系」的人绝不许出现，即使上游意外把他带了进来
 *   · `layer: 'queued'` 的人交给自动跟进了，不算「今天需要人工关注」——
 *     跟主看板一样折叠，不铺开成今日决策行（Codex 复审 2026-08-29）
 *   · 同行默认不进「今天该联系客人」——跟主看板默认视图（终端客户）保持一致，
 *     否则同行会无标记地混进客人清单和顶部人数（Codex 复审 2026-08-29）
 *   · 空清单必须说清是「都处理完了」还是「压根没有数据」，不能长得一样
 *   · 「今天已处理」的判断必须跟清单同一客群口径——如果桶里只有同行的
 *     `doneToday`，终端客户其实压根没被判断过，不能说「都处理完了」
 *     （Codex 复审 2026-08-29）
 */

import type { ContactKind } from './contact-kind'
import { LIST_META } from './next-action'

export type SuggestedChannel = 'phone' | 'sms' | 'email' | 'messenger' | 'none'

export interface DecisionSuggestedStage {
  toStage: string
  label: string
  why: string
  stillFollowed?: boolean
}

export interface DecisionSourceRow {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  reason: string
  suggestedChannel: SuggestedChannel
  phoneUnusable?: boolean
  doNotContact?: boolean
  doneToday?: boolean
  pinned?: boolean
  suggestedStage?: DecisionSuggestedStage | null
  /** 终端客户 / 同行 / 自己人 —— 没有就当终端客户（后端还没上线这个字段时不能整页空掉）。 */
  kind?: ContactKind
}

export interface DecisionBucketSource {
  layer: 'waiting' | 'acted' | 'queued'
  label: string
  people: DecisionSourceRow[]
  /** 这个桶命中的总人数（含被本页过滤掉的）—— `/crm/today` 每桶只回前 300 人。 */
  total?: number
  /** 这个桶命中的人比返回的 `people` 多 —— 清单没能显示全部，必须如实提示。 */
  truncated?: boolean
}

export interface DecisionRow {
  contactId: string
  name: string
  /** 纯文本联系方式，没有可点击的 tel:/mailto: —— 这份清单只读，不给动手的入口。 */
  contact: string
  why: string
  nextAction: string
  layerLabel: string
  pinned: boolean
}

const CHANNEL_ACTION_LABEL: Record<SuggestedChannel, string> = {
  phone: '建议致电',
  sms: '建议发短信',
  email: '建议发邮件',
  messenger: '建议在私信回复',
  none: '建议先核实联系方式',
}

function contactText(phone: string | null, email: string | null, phoneUnusable?: boolean): string {
  if (phone && !phoneUnusable) return phone
  if (phone && phoneUnusable) return email ? `${phone}（打不通）· ${email}` : `${phone}（打不通）`
  if (email) return email
  return '没留联系方式'
}

function nextActionText(row: DecisionSourceRow): string {
  const channel = CHANNEL_ACTION_LABEL[row.suggestedChannel]
  if (row.suggestedStage) {
    return `${channel} · 系统建议改状态为「${row.suggestedStage.label}」（${row.suggestedStage.why}）`
  }
  return channel
}

/**
 * 这一页只管「今天需要人工关注」——`queued` 是主看板本来就折叠、交给自动
 * 跟进的库存（人不用再一个个打了），不该在这份清单上重新铺开。
 */
function isManualLayer(bucket: DecisionBucketSource): boolean {
  return bucket.layer !== 'queued'
}

/**
 * 清单只展示终端客户、且已经排除 DNC —— 判断「今天是否已经处理过」时必须
 * 用同一个客群范围，否则同行的 `doneToday` 会被算成终端客户已处理
 * （Codex 复审 2026-08-29）。
 */
function isDisplayedAudience(p: DecisionSourceRow): boolean {
  if (p.doNotContact) return false
  if ((p.kind ?? 'retail') === 'trade') return false
  return true
}

/**
 * 空清单是「今天该处理的都处理了」还是「今天压根没有到期的跟进」——
 * 两句话意思完全不同，不能靠 `totalContacts > 0` 瞎猜（客户有 300 个联系人，
 * 但今天全部在推迟 / 未来培育 / 已终止阶段，跟「今天处理完了」是两回事）。
 * 判据：桶里（过滤前，但限定在清单展示的客群范围内）有没有出现过 `doneToday` 的人。
 */
export function hasHandledToday(buckets: DecisionBucketSource[]): boolean {
  return buckets
    .filter(isManualLayer)
    .some((b) => b.people.some((p) => isDisplayedAudience(p) && p.doneToday === true))
}

/** 是否有桶因为人数超过单桶上限而没能显示全部 —— 必须提示，不能悄悄截断。 */
export function hasTruncatedBucket(buckets: DecisionBucketSource[]): boolean {
  return buckets.filter(isManualLayer).some((b) => b.truncated === true)
}

/**
 * 把 `/crm/today` 的桶拍平成一条只读决策清单，按桶原有的优先级顺序。
 *
 * 只看终端客户，跟「今天要联系」主看板的默认视图一致 —— 那边同行默认也是
 * 筛掉的，只是多给了一个切换器。这一页没有切换器，沿用默认视图，不能把
 * 同行的类型丢掉、无标记地混进客人清单和顶部人数（Codex 复审 2026-08-29）。
 */
export function buildDecisionList(buckets: DecisionBucketSource[]): DecisionRow[] {
  const rows: DecisionRow[] = []
  for (const bucket of buckets) {
    if (!isManualLayer(bucket)) continue
    for (const p of bucket.people) {
      // 防御性过滤：不重判，只是不让这几类人以任何理由出现在只读清单上。
      if (!isDisplayedAudience(p)) continue
      if (p.doneToday) continue
      rows.push({
        contactId: p.contactId,
        name: p.name,
        contact: contactText(p.phone, p.email, p.phoneUnusable),
        why: p.reason,
        nextAction: nextActionText(p),
        // 这页只列要人动手的那一层，跟「全部客人」页同一个说法：今天要联系（PM 2026-10-10 一个概念）。
        layerLabel: LIST_META.hot.title,
        pinned: p.pinned === true,
      })
    }
  }
  return rows
}
