/**
 * 「全部客人」抽屉的「上一位 / 下一位」——纯函数（`docs/specs/2026-09-27-crm-contact-drawer-v0.md` §3.1 / §3.3）。
 *
 * 只回答一件事：**给定「现在在哪」，下一步该做什么**——留在原地换个人、
 * 去问服务端要下一页、还是停下来告诉人「这一段/这一页看完了」。
 * **不发请求、不碰 DOM、不读 React state**——发请求和展开哪一段永远是调用方的事，
 * 这里只算。纯函数才测得动（spec 原话）。
 *
 * ## 两种模式，判据完全不同（spec §3.3）
 *
 * **分段模式**（跟进优先级那两张名单）：位置是全局的——「第 12 位 / 共 217 位」，
 * 跨页也算得出来，因为每段有权威 `total`。走到段尾**停住**，不自动跳下一段
 * （`open` 是完整声明，偷偷展开等于偷偷改用户的展开状态——见 segments 相关代码）。
 *
 * **平铺模式**（不分段的那张大表）：**只有本页序号**——「第 12 位 / 本页 100 位」，
 * 不出全局序号。原因是服务端按 `id`/`first_seen_at` 切页，前端又按「最近联系」
 * 把这一页的 100 行客户端重排了一遍（`page.tsx` 的 `sorted`）——两套顺序不一致，
 * 「第 12 / 共 1010」这种全局位置在平铺模式下**永远是假的**，所以干脆不给。
 * 走的必须是 `sorted` 那个顺序，不是接口返回顺序，否则「下一位」会跳到一个
 * 肉眼看不出为什么是下一个的人。
 */

import type { NextActionList } from './next-action'

/** 跟 list-sections.ts 同一份两张名单的 key；原四段合成 hot / cold。 */
export type SectionKey = NextActionList

export type NavDirection = 'prev' | 'next'

/**
 * 算完之后，调用方该做的唯一一件事。
 * 分成"能不能立刻做"和"要不要问人/问服务端"，调用方 switch 这个 kind 就够，
 * 不用再重新判一遍边界条件。
 */
export type NavStep =
  /** 留在当前已加载的这批 id 里，直接换到 `contactId`。 */
  | { kind: 'move'; contactId: string; positionLabel: string }
  /** 当前页/当前批走完了，但还有更多——调用方去拉那一页/那一段，拉完后打开 `openFirst ? 首个 : 末个`。 */
  | { kind: 'need_more'; reason: 'section_next_page' | 'flat_next_page' | 'flat_prev_page'; openFirst: boolean }
  /** 分段模式走到段尾——不自动跳下一段，只给一句话 + 下一段的名字（调用方自己去问「下一段是谁」）。 */
  | { kind: 'end_of_section'; message: string }
  /** 平铺模式：已经是全库最后/最前一页的最后/最前一个，没有更多了。 */
  | { kind: 'end_of_list'; message: string }
  /** `currentIndex` 传了 -1——多半是这个人被筛选/搜索掉出了当前列表（spec §3.8 那一行）。 */
  | { kind: 'not_in_list'; message: string }

interface SegmentNavInput {
  mode: 'segment'
  direction: NavDirection
  /** 当前这一段、当前这一页已加载的 id，按屏幕上看到的顺序。 */
  loadedIds: string[]
  /** `contactId` 在 `loadedIds` 里的下标；找不到传 -1（见 `not_in_list`）。 */
  currentIndex: number
  sectionKey: SectionKey
  /** 段名——「客人在等你」这种，拼进 positionLabel 和 end_of_section 的话术里。 */
  sectionTitle: string
  /** 段内当前页（1-based）。 */
  sectionPage: number
  /** 段内每页人数——跟服务端 `perPage` 必须一致，用来把页内下标换算成全局序号。 */
  perPage: number
  /** 这一段的总人数（服务端权威值，不是 `loadedIds.length`）。 */
  sectionTotal: number
  /** 下一段的信息——走到段尾时拼进提示。`null` = 已经是最后一段。 */
  nextSection: { key: SectionKey; title: string; total: number } | null
}

interface FlatNavInput {
  mode: 'flat'
  direction: NavDirection
  /** 当前页已加载、且已按「最近联系」客户端重排过的 id——即 `sorted`，不是接口原始顺序。 */
  loadedIds: string[]
  currentIndex: number
  /** 当前页（1-based）。 */
  page: number
  /** 总页数——服务端 `Math.ceil(total / perPage)`。 */
  totalPages: number
}

export type NavInput = SegmentNavInput | FlatNavInput

/** 段内页码 × 每页 + 页内序号，1-based。 */
function globalPosition(sectionPage: number, perPage: number, indexInPage: number): number {
  return (sectionPage - 1) * perPage + indexInPage + 1
}

function segmentNav(input: SegmentNavInput): NavStep {
  const { direction, loadedIds, currentIndex, sectionTitle, sectionPage, perPage, sectionTotal, nextSection } = input

  if (currentIndex < 0) {
    return { kind: 'not_in_list', message: '他不在这份名单里了 —— 用上面的搜索框找找看' }
  }

  const nextIdx = direction === 'next' ? currentIndex + 1 : currentIndex - 1

  // 还在这一批已加载的 id 里 —— 直接换人，不用问服务端。
  if (nextIdx >= 0 && nextIdx < loadedIds.length) {
    const pos = globalPosition(sectionPage, perPage, nextIdx)
    return {
      kind: 'move',
      contactId: loadedIds[nextIdx],
      positionLabel: `${sectionTitle} · 第 ${pos} 位 / 共 ${sectionTotal} 位`,
    }
  }

  // 往前走到了这一页的头，但不是全段的头 —— 去问服务端要上一页。
  if (direction === 'prev' && sectionPage > 1) {
    return { kind: 'need_more', reason: 'section_next_page', openFirst: false }
  }
  // 往前走、已经是第 1 页第 1 位 —— 段头，没有"上一段"这个概念（spec 没定义），当成 not_in_list 同款静止处理更安全，
  // 但这不是"人不在名单里"，是"已经是第一位"——单独给一个更准确的提示。
  if (direction === 'prev') {
    return { kind: 'end_of_list', message: '已经是这一段第一位了' }
  }

  // 往后走：这一页走完了，全段还没完 —— 去问服务端要下一页。
  const totalPages = Math.max(1, Math.ceil(sectionTotal / perPage))
  if (sectionPage < totalPages) {
    return { kind: 'need_more', reason: 'section_next_page', openFirst: true }
  }

  // 段尾。🔴 绝不自动跳下一段——只给消息，调用方等用户点了才展开下一段。
  if (nextSection) {
    return {
      kind: 'end_of_section',
      message: `这一段的 ${sectionTotal} 位看完了 —— 看下一段：${nextSection.title}（${nextSection.total} 位）`,
    }
  }
  return { kind: 'end_of_section', message: `这一段的 ${sectionTotal} 位看完了 —— 已经是最后一段` }
}

function flatNav(input: FlatNavInput): NavStep {
  const { direction, loadedIds, currentIndex, page, totalPages } = input

  if (currentIndex < 0) {
    return { kind: 'not_in_list', message: '他不在这份名单里了 —— 用上面的搜索框找找看' }
  }

  const nextIdx = direction === 'next' ? currentIndex + 1 : currentIndex - 1

  if (nextIdx >= 0 && nextIdx < loadedIds.length) {
    return {
      kind: 'move',
      contactId: loadedIds[nextIdx],
      // 🔴 平铺模式不出全局序号——两套排序对不上会让这个数字说谎（见文件头注）。
      positionLabel: `第 ${nextIdx + 1} 位 / 本页 ${loadedIds.length} 位`,
    }
  }

  if (direction === 'next') {
    if (page < totalPages) return { kind: 'need_more', reason: 'flat_next_page', openFirst: true }
    return { kind: 'end_of_list', message: '已经是最后一位了' }
  }
  if (page > 1) return { kind: 'need_more', reason: 'flat_prev_page', openFirst: false }
  return { kind: 'end_of_list', message: '已经是第一位了' }
}

/** 唯一导出：算「下一步该做什么」，不做别的事。 */
export function nextNavStep(input: NavInput): NavStep {
  return input.mode === 'segment' ? segmentNav(input) : flatNav(input)
}

/**
 * 现在显示的位置文案——不是「下一步该显示什么」，是「我现在在哪」。
 *
 * 抽屉一打开就要看到这句话，不能等用户点了一次上一位/下一位才第一次算出来
 * （`nextNavStep` 只算移动之后的位置，没有算「原地不动」的这一档）。跟
 * `nextNavStep` 共用同一套判据：分段模式给全局序号，平铺模式只给本页序号
 * （文件头注解释过为什么）。
 *
 * `currentIndex < 0`（人不在已加载列表里）返回 null——调用方决定这时候怎么显示。
 */
export function currentPositionLabel(input: NavInput): string | null {
  if (input.currentIndex < 0) return null
  if (input.mode === 'segment') {
    const pos = globalPosition(input.sectionPage, input.perPage, input.currentIndex)
    return `${input.sectionTitle} · 第 ${pos} 位 / 共 ${input.sectionTotal} 位`
  }
  return `第 ${input.currentIndex + 1} 位 / 本页 ${input.loadedIds.length} 位`
}
