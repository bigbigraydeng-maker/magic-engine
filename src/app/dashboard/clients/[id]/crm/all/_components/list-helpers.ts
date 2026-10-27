import { type SectionKey } from '@/lib/crm/drawer-nav'
import { type Segment } from '@/lib/crm/segments'
import { type DrawerRow } from '../../_components/PersonDrawer'
import { type ContactRow } from './contact-table-types'

// SectionKey 从 drawer-nav.ts 引，不在本文件另声明一份同样的字面量联合类型——
// 只有一处定义，谁改了 lib/crm/list-sections.ts 的四段名字，这里跟着变，不用记得改两处。
export interface PrioritySectionData {
  key: SectionKey
  title: string
  hint: string
  total: number
  open: boolean
  page: number
  items: ContactRow[] | null
}

/**
 * 今天有没有碰过这个人——"全部客人"的 ContactRow 没有「今天要联系」那页专属的
 * `doneToday` 标记（那边是按日重置的行动队列，这页不是），用「最近联系是不是今天」
 * 当替代信号，跟 contact-table-types.ts 的 `relTime()`「今天/昨天」判断同一个口径
 * （2026-09-28 WP-B5）。
 */
export function isToday(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
}

export function toDrawerRow(r: ContactRow): DrawerRow {
  return {
    contactId: r.contactId,
    name: r.name,
    phone: r.phone,
    email: r.email,
    stage: r.stage,
    stageLabel: r.stageLabel,
    reason: r.reason,
    // 后端 segmentContact() 的枚举值原样传下来，这里的 ContactRow.segment 类型是
    // string（跨接口共用的宽类型），值域跟 Segment 一致，不重新校验。
    segment: r.segment as Segment,
    important: r.important,
    suggestedChannel: r.suggestedChannel,
    phoneUnusable: r.phoneUnusable,
    doNotContact: r.doNotContact,
    // 「该做什么」三行卡的内容 —— 跟列表那一格同一个对象，两处不会说两套话。
    nextAction: r.nextAction,
    // 只给抽屉显示一行「AI 初判（未校准）」小字，不参与任何判断。
    intent: r.intent,
    // 跟进人（part 3）：抽屉里给下拉改；列表接口已经把这个值透出来。
    assignedTo: r.assignedTo ?? null,
    // 回头客：同一份判据，抽屉顶部的横幅靠它立刻画出来。
    returning: r.returning ?? null,
  }
}

/**
 * 这一段现在显示的是第几个到第几个。
 *
 * ⚠️ 服务端是**翻页不是累加**：`list-sections.ts` 用 `bucket.slice(start, start + perPage)`，
 * 所以 `p_<段>=2` 拿到的是第 101–200 个、**第 1–100 个会消失**。
 * 第一版我按「累加」写，按钮叫「再看 100 个」——那会让前 100 个人凭空不见，
 * 正是这一轮要修的那个毛病换个方向再犯一次。查了 slice 才改成老实的翻页。
 */
export function sectionRange(
  s: PrioritySectionData,
  sectionPages: Partial<Record<SectionKey, number>>,
  perPage: number,
): { from: number; to: number; pages: number } {
  const page = sectionPages[s.key] ?? 1
  const from = s.total === 0 ? 0 : (page - 1) * perPage + 1
  return { from, to: (page - 1) * perPage + (s.items?.length ?? 0), pages: Math.max(1, Math.ceil(s.total / perPage)) }
}
