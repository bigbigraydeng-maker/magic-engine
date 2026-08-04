/**
 * 「这个人最早是从哪来的」。
 *
 * ## 为什么要有（PM 2026-08-04）
 *
 * PM 问「CRM 里标不标 Facebook 来的还是邮件来的」。数据一直都记着（每条往来
 * 都带渠道），但**看板上看不见** —— 卡片只回答「现在该在哪回他」，不回答
 * 「他当初怎么找上来的」。
 *
 * 线上真实分布说明这两件事必须分开问：CTS 520 个人里**只有 156 个是单一渠道**，
 * 其余全是跨渠道的（189 个人四条线上都有往来）。所以「他是 Facebook 来的还是
 * 邮件来的」这个问法本身要拆成两个：
 *
 *   · 销售问的 → 「我现在该在哪回他」= `suggestedChannel`，早就有了
 *   · 老板问的 → 「哪条获客渠道带来的人值钱」= **首次来源**，就是这个文件
 *
 * ## 为什么现算，不存一列
 *
 * 首次来源 = 时间最早那条往来的渠道。触点是不可变的，所以这个值不会漂 ——
 * 存一列反而多一个会跟事实走散的地方。而且这一页本来就已经把每个人的触点
 * 全读进内存了，现算是免费的。
 *
 * 唯一会让它变的情况是**往回补了更早的历史**（比如以后把两年前的邮件导进来），
 * 那时候它跟着变正是对的 —— 我们确实是那时候才第一次接触到他。
 *
 * ## 只做提示，不参与任何判断
 *
 * PM 的原话是「只是做到一个提示作用」。它**绝不进分批、不进排序、不进优先级**
 * —— 一个人从哪来跟他今天该不该被联系没有关系，掺进去只会让判据变糊。
 */

/** 看板认识的渠道。跟 contact_touchpoints.channel 对齐。 */
export type FirstSource = 'messenger' | 'meta_lead_form' | 'email' | 'phone'

export interface TouchLike {
  channel: string
  occurredAt: string
}

/** 认得出的渠道才算数 —— 将来新增渠道时宁可显示不出来，也不要瞎标一个。 */
const KNOWN: ReadonlySet<string> = new Set<FirstSource>([
  'messenger',
  'meta_lead_form',
  'email',
  'phone',
])

function ts(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

/**
 * 最早那条往来是哪个渠道。
 *
 * **不依赖传进来的顺序**：调用方（today 路由）拿到的是按时间倒序的数组，
 * 但别的调用方未必。靠顺序的实现会在第二个调用方那里静默出错。
 *
 * 时间解析不出来的记录排到最后（`+Infinity`），不让一条脏数据冒充「最早」。
 */
export function firstSourceOf(touchpoints: readonly TouchLike[]): FirstSource | null {
  let best: TouchLike | null = null
  for (const t of touchpoints) {
    if (!KNOWN.has(t.channel)) continue
    if (!best || ts(t.occurredAt) < ts(best.occurredAt)) best = t
  }
  return best ? (best.channel as FirstSource) : null
}

/** 卡片上那个小标记。图标 + 一个词，不占地方。 */
export const FIRST_SOURCE_LABEL: Record<FirstSource, { icon: string; label: string }> = {
  meta_lead_form: { icon: '📋', label: '广告表单' },
  messenger: { icon: '💬', label: '私信' },
  email: { icon: '✉️', label: '邮件' },
  phone: { icon: '📞', label: '电话' },
}
