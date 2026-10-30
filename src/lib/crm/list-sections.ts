/**
 * WP3 R4 — 「全部客人」页的分段视图（2 张名单 + 段内排序 + 段内分页 + focus 定位）。
 *
 * 两张名单：hot（今天要联系）/ cold（先放着）。hot = 原 waiting + acted 两层；
 * cold = 原 queued + off_list 两层。意向只能往上抬：只有「聊过一轮就断了」
 * （stale_conversation）+ 高意向会从 cold 抬进 hot，medium / low / unknown /
 * 没有 brief 一律不动（见 next-action.ts 头注）。
 *
 * 这是纯函数：输入已排好序列出来的每个客人（`segmentContact` 结果 + pinnedAt + contactId + intent），
 * 输出 2 张名单（每张 total + 是否展开 + 展开时的这一页 items + focus 命中位置）。
 *
 * 排序（同 today 路由 `route.ts:713-726`）：
 *   1. 置顶（`pinnedAt` 有值）在前，按 pinnedAt 越晚越前；
 *   2. 其余按 `compareNextAction` —— 先按分段，同段高意向排前。
 *
 * 分页：每张名单独立翻页，size 由调用方给（默认 100，跟老列表一致）。名单收起来时不算 items，
 * 只回 total —— 避免每次请求都装两张名单各 100 行的 items。
 *
 * focus：给 contactId → 找到它落在哪张名单第几页；page 自动跳到那一页，section 展开。
 *
 * 2026-08-02 事故（`worklist-groups.ts` 头注）教训在这里同样成立：每一个
 * Segment × 意向（含 null）都必须落进恰好一张名单 —— 漏掉一个组合，人就凭空消失。
 * 测试用 `Segment` 的 keyof × `INTENT_LEVELS` 做穷举断言。
 */

import type { SegmentResult } from './segments'
import {
  LIST_META,
  listOf,
  compareNextAction,
  type IntentLevel,
  type NextActionList,
} from './next-action'

/** 两张名单之一。原四段（waiting/acted/queued/off_list）合成 hot / cold，见 next-action.ts 头注。 */
export type SectionKey = NextActionList

export const SECTION_KEYS: readonly SectionKey[] = ['hot', 'cold']

/** 每张名单的显示元数据（title / hint 只用 LIST_META 一份）。 */
export function sectionMeta(key: SectionKey): { title: string; hint: string } {
  return { ...LIST_META[key] }
}

/**
 * 装配好的一行——上游从 SQL + segmentContact 拼出来后喂进本函数。
 * 只列本函数用到的字段；其他返回给页面的字段（name / stage 等）由调用方在同一份 rows 上叠加。
 */
export interface RankedContact {
  contactId: string
  seg: SegmentResult
  /** `contacts.pinned_at` —— 置顶按时间倒序，NULL 排后面。 */
  pinnedAt: string | null
  /** conversation_briefs.intent_level（最新一张）；null = 没有 AI 摘要。只能把人往上抬，见 next-action.ts。 */
  intent: IntentLevel | null
  /** 今天我们已经动过他了 —— 卡片就地变灰打勾，位置不动（day-list 的承诺）。不传 = 没做当天冻结。 */
  handled?: boolean
  /** 已处理的话，一句人话说明做了什么。 */
  handledWhy?: string | null
}

export interface SectionResult<T> {
  key: SectionKey
  title: string
  hint: string
  /** 段内总人数（不受本次翻页 / 展开影响）。 */
  total: number
  /** 展开状态。false = items 为 null，只暴露 total。 */
  open: boolean
  /** 段内当前页 (1-based)。段展开时才有意义。 */
  page: number
  /** 段展开时的这一页；未展开返回 null。 */
  items: T[] | null
}

export interface BuildOptions<T> {
  /** 4 段各自要不要展开；默认前两段展开、后两段收起（跟 crm/page.tsx:167 一致）。 */
  open?: Partial<Record<SectionKey, boolean>>
  /** 段内每页人数，默认 100。 */
  perPage?: number
  /** 段内翻页：以段 key → 页码 (1-based) 的 map 传入；缺省算第 1 页。 */
  page?: Partial<Record<SectionKey, number>>
  /**
   * 只有想让某位客人自动展开、跳到他所在页时才传。
   * `getRow(RankedContact)` 用来把 ranked 输入还原成响应行（例如附上 name / stage）；
   * 想同时展开该段的调用方需自己在 `open` 里把该段设 true（本函数不做副作用）。
   */
  focusContactId?: string
  getRow: (r: RankedContact) => T
}

export interface FocusResult {
  found: boolean
  section?: SectionKey
  page?: number
}

/** 排序：置顶在前，同置顶按 pinnedAt 倒序；其余按 compareNextAction。 */
export function compareRanked(a: RankedContact, b: RankedContact): number {
  const ap = a.pinnedAt ? Date.parse(a.pinnedAt) : 0
  const bp = b.pinnedAt ? Date.parse(b.pinnedAt) : 0
  if (ap !== bp) return bp - ap // 有 pinnedAt 的排前面；两个都有的越新越前
  return compareNextAction(a, b)
}

/**
 * 主入口：给排好的 4 段，附上 total / open / 当前页的 items / focus 命中信息。
 *
 * 输入 `contacts` **不要求预排序** —— 本函数按 SECTION_OF_SEGMENT 拆桶，
 * 每桶内部自行 `compareRanked`。
 */
export function buildSections<T>(
  contacts: RankedContact[],
  opts: BuildOptions<T>,
): { sections: SectionResult<T>[]; focus: FocusResult } {
  const perPage = Math.max(1, opts.perPage ?? 100)
  const defaults: Record<SectionKey, boolean> = {
    hot: true,
    cold: false,
  }
  const openOf = (k: SectionKey): boolean => opts.open?.[k] ?? defaults[k]
  const pageOf = (k: SectionKey): number => Math.max(1, opts.page?.[k] ?? 1)

  const buckets: Record<SectionKey, RankedContact[]> = {
    hot: [],
    cold: [],
  }
  for (const c of contacts) {
    const key = listOf(c.seg.segment, c.intent)
    buckets[key].push(c)
  }
  for (const key of Object.keys(buckets) as SectionKey[]) buckets[key].sort(compareRanked)

  let focus: FocusResult = { found: false }
  if (opts.focusContactId) {
    for (const key of Object.keys(buckets) as SectionKey[]) {
      const idx = buckets[key].findIndex((r) => r.contactId === opts.focusContactId)
      if (idx >= 0) {
        focus = { found: true, section: key, page: Math.floor(idx / perPage) + 1 }
        break
      }
    }
  }

  const sections: SectionResult<T>[] = SECTION_KEYS.map((key) => {
    const bucket = buckets[key]
    const total = bucket.length
    const open = openOf(key)
    const page = pageOf(key)
    if (!open) {
      const meta = sectionMeta(key)
      return { key, title: meta.title, hint: meta.hint, total, open, page, items: null }
    }
    const start = (page - 1) * perPage
    const items = bucket.slice(start, start + perPage).map(opts.getRow)
    const meta = sectionMeta(key)
    return { key, title: meta.title, hint: meta.hint, total, open, page, items }
  })

  return { sections, focus }
}
