/**
 * 「全部客人」横表的共享类型、标签表和小格式化函数。
 *
 * 从 page.tsx 搬出来（2026-09-26，WP3 R6 纯搬家）：那个文件 1034 行，超了本仓
 * 800 行上限，而 R7 还要往里加分段组件。这里只装**没有状态、没有 JSX** 的东西 ——
 * 表格主体、时间线条目、详情块都要读它们，放在一处才不会各写一份标签表。
 *
 * 搬家规则：一个字都没改，只在每条顶层声明前面加了 export。谁想改标签文案
 * 或加一个渠道，改这一处。
 */

import type { NextAction, IntentLevel } from '@/lib/crm/next-action'

export interface ContactRow {
  contactId: string
  name: string
  firstSeenAt: string
  lastTouchAt: string | null
  phone: string | null
  /** 号码在库里但打不通 —— 跟「今天该联系谁」那一页说同一件事。 */
  phoneUnusable?: boolean
  /** 被标成「别再联系」—— 展开里给一条取消的路（见 DncBanner）。 */
  doNotContact?: boolean
  email: string | null
  hasMessenger: boolean
  stage: string | null
  stageLabel: string | null
  /** 人工置顶时间（contacts.pinned_at）。非 null = 被钉在名单最前面。 */
  pinnedAt: string | null
  /** 「⭐置顶」附带的原因和到期日（contacts.important_note / important_due_at）。 */
  important: { note: string | null; dueAt: string | null }
  segment: string
  segmentLabel: string
  temperature: 'hot' | 'warm' | 'cold' | 'off'
  /** 他实际能被联系到的渠道 —— PersonDrawer 靠它决定给哪几个按钮（不要兜底成 'phone'）。 */
  suggestedChannel?: 'phone' | 'sms' | 'email' | 'messenger' | 'none'
  /** 为什么排到这一批 —— 抽屉顶部「上次说到这」那一档用。 */
  reason?: string
  /**
   * 「该做什么」—— 阶段 / 冷热 / 意向三套状态合成的那一个概念（PM 2026-10-10）。
   * 列表只画 `nextAction.line`；`stage` / `segment` 仍在，抽屉改阶段和筛选还要用。
   */
  nextAction: NextAction
  /** 最新一张 AI 摘要的意向；null = 没有摘要。 */
  intent: IntentLevel | null
  custom: Record<string, string | null>
  /** 他最早是从哪个渠道进来的（messenger / email / whatsapp / phone / fb_form / web_form），最多一项；列表在名字旁画小标签。 */
  sources?: string[]
  /**
   * 「回头客」：之前咨询过、我们联系过，今天又填了一张咨询表（强意向）。
   * 判据只有一份（`lib/crm/returning-lead`），列表排序、抽屉顶部的横幅都读它。null / 缺省 = 不是。
   */
  returning?: {
    firstEnquiryAt: string
    latestFormAt: string
    ourLastContactAt: string
    ourContacts: number
    earlierForms: number
  } | null
  /** 我们刚打通电话聊上了、还没记下一步（`segments.ts` 规则 6.5）。缺省 = 不是。 */
  afterCall?: boolean
  /**
   * 这条线索当前分给谁跟进（`client_portal_users.email`）。null = 未分配。
   * part 2 的 round-robin 自动写入；part 3 UI 让人手动改（issue #3158）。
   */
  assignedTo: string | null
}

export interface CustomColumnMeta {
  key: string
  label: string
}

export type TimelineEntry =
  | {
      kind: 'touch'
      at: string
      channel: string
      direction: 'inbound' | 'outbound'
      summary: string | null
      tour: string | null
      outcome: string | null
      travelWindow: string | null
      callbackAt: string | null
      competitor: string | null
    }
  | {
      kind: 'message'
      at: string
      direction: 'inbound' | 'outbound'
      senderName: string | null
      body: string
    }
  | {
      kind: 'stage'
      at: string
      fromStage: string | null
      toStage: string | null
      fromLabel: string | null
      toLabel: string | null
      changedBy: string | null
      note: string | null
    }

// 渠道 / 方向标签一律带 fallback：DB 先加第 7 个渠道、前端没跟上时显示原值，不炸。
export const CHANNEL_LABEL: Record<string, string> = {
  meta_lead_form: 'FB 表单',
  phone: '电话',
  email: '邮件',
  messenger: '私信',
  web_form: '官网表单',
  whatsapp: 'WhatsApp',
}
export const DIRECTION_LABEL: Record<string, string> = {
  inbound: '客户来找的',
  outbound: '我联系的',
}
export const OUTCOME_LABEL: Record<string, string> = {
  no_answer: '没接通',
  missed_inbound: '漏接来电',
  bad_number: '号码不通',
  do_not_contact: '别再联系',
  not_interested: '没兴趣',
  // 少了这一条，「暂时不考虑」这个结论在时间线上完全不显示 ——
  // 软硬拒绝分开这件事，在最主要的翻查视图里就等于没做。
  not_interested_now: '暂时不考虑',
  spoke: '聊上了',
  callback_set: '约了回电',
}

// 冷热上色：烫的标红、温的标赭、冷的中性、已结论的灰。
export const TEMP_CLS: Record<ContactRow['temperature'], string> = {
  hot: 'bg-[#C2453A]/12 text-[#C2453A]',
  warm: 'bg-me-ochre/12 text-me-ochre',
  cold: 'bg-me-ivory text-me-charcoal/55',
  off: 'bg-me-charcoal/5 text-me-charcoal/45',
}

/** 「该做什么」那一格的底色：hot 名单红、cold 名单灰。按 `nextAction.list` 取。 */
export const LIST_CLS: Record<NextAction['list'], string> = {
  hot: 'bg-[#C2453A]/12 text-[#C2453A]',
  cold: 'bg-me-charcoal/5 text-me-charcoal/55',
}

export function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
}

/**
 * 「今天 / 昨天 / 3天前 / 87天前」—— 最近联系一律用「几天前」。
 *
 * 原来满 30 天就换成「9/10」这种日期：PM 2026-10-10 看本地页，一列里「29天前」
 * 紧跟着「9/10」，同一列两种写法，眼睛要换算。一年以内都说「N天前」，超过一年才给日期。
 */
export function relTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  // 按日历日算，不按 24 小时算：昨晚 11 点在今天早上 6 点就该叫「昨天」，
  // 不能因为还没满 24 小时就掉回日期写法。
  const dayOf = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())
  const days = Math.round((dayOf(now) - dayOf(d)) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days >= 2 && days < 365) return `${days}天前`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
