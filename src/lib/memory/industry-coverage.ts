/**
 * 行业经验覆盖体检 —— 「哪些客户其实读不到同行的经验，为什么」。
 *
 * ── 2026-08-04 实查发现的洞 ─────────────────────────────────────────────────
 * `global_learned_lessons` 的行业层按 `clients.industry` 精确匹配取数
 * （见 lib/memory/service.ts > loadGlobalLessons）。受控词表
 * `lib/clients/industries.ts` 设计得很好，但**数据完全没跟上**：
 *
 *   · 26 个客户里 **15 个 industry 是空的** → 一条行业经验都读不到
 *   · 5 个是自由文本（`SPC/hybrid flooring wholesale (B2B trade)` /
 *     `Travel — Tour Operator` / `Healthcare — Physiotherapy` …）→ 永远匹配不上
 *   · Oztop 填的是 `flooring`，而词表里的规范值是 `building_supplies` → 也匹配不上
 *
 * 也就是说：**行业学习层对 26 个客户里的 20 个是静默失效的。**
 * 没有任何报错、没有任何日志 —— 它只是什么都不返回。
 *
 * ── 为什么这里只做「看见」，不做「自动归类」─────────────────────────────────
 * 把 `NZCPE 2026`（中新贸易展会主办方）归到哪个行业，是业务判断不是技术判断。
 * 猜错的代价是**把 A 行业的经验喂给 B 行业的客户** —— 正是狄仁杰查出来的那类
 * 跨客户泄露。所以这个模块只负责把缺口摆到台面上，归类留给人。
 *
 * 纯函数，不碰 DB。
 */

import { normaliseIndustry } from './service'

export type IndustryStatus =
  /** 词表内的规范值 —— 能正常读到同行经验。 */
  | 'canonical'
  /** 填了，但不在词表里 —— **永远匹配不上任何行业经验**。 */
  | 'free_text'
  /** 没填 —— 只能读到全局/渠道层。 */
  | 'missing'

export interface ClientIndustryRow {
  clientId: string
  clientName: string
  industry: string | null
}

export interface ClientCoverage {
  clientId: string
  clientName: string
  industry: string | null
  status: IndustryStatus
  /** 这个客户实际能读到几条行业经验。 */
  readableLessons: number
  /** 人话解释。 */
  note: string
}

export interface CoverageSummary {
  total: number
  canonical: number
  freeText: number
  missing: number
  /** 有行业经验、但一个客户都读不到的行业 —— 攒了没人用。 */
  orphanIndustries: string[]
  clients: ClientCoverage[]
}

/**
 * 归一化 —— **直接用取数侧那一个函数，不在这里另写一份**。
 *
 * 2026-08-05 魏征 B3：这里原来是 `trim().toLowerCase()`，取数侧
 * （`service.ts` 的 `buildIndustryMatchCandidates`）还多一步把空格/连字符转下划线。
 * 于是 `Real Estate` 在取数侧能命中 `real_estate` 的行业经验，在这份体检报告里
 * 却被判成「自由文本、读不到课」—— 体检结果跟真实行为**相反**，越认真看越被误导。
 *
 * 两份实现只要还分着写，就一定会再次漂移。所以只留一份。
 */
const norm = normaliseIndustry

/**
 * @param clients        全部客户及其 industry
 * @param knownValues    受控词表的规范值（INDUSTRY_OPTIONS.map(o => o.value)）
 * @param lessonCounts   每个行业当前有几条生效的行业层经验
 */
export function summariseIndustryCoverage(
  clients: readonly ClientIndustryRow[],
  knownValues: readonly string[],
  lessonCounts: Readonly<Record<string, number>>,
): CoverageSummary {
  const known = new Set(knownValues.map(norm))
  const counts = new Map(Object.entries(lessonCounts).map(([k, v]) => [norm(k), v]))
  const industriesInUse = new Set<string>()

  const rows: ClientCoverage[] = clients.map(c => {
    const raw = c.industry?.trim() ?? ''
    if (!raw) {
      return {
        clientId: c.clientId, clientName: c.clientName, industry: null,
        status: 'missing', readableLessons: 0,
        note: '行业没填 —— 只能读到全局/渠道层经验，读不到同行踩过的坑',
      }
    }
    const n = norm(raw)
    if (!known.has(n)) {
      return {
        clientId: c.clientId, clientName: c.clientName, industry: raw,
        status: 'free_text', readableLessons: 0,
        note: `「${raw}」不在受控词表里 —— 精确匹配永远命中不了，等于行业层对它失效`,
      }
    }
    industriesInUse.add(n)
    const readable = counts.get(n) ?? 0
    return {
      clientId: c.clientId, clientName: c.clientName, industry: raw,
      status: 'canonical', readableLessons: readable,
      note: readable > 0
        ? `能读到 ${readable} 条本行业经验`
        : '行业填对了，但这一行还没攒下任何经验',
    }
  })

  // 有经验、却没有任何客户挂在这个行业上 —— 攒了没人用。
  const orphanIndustries = Array.from(counts.entries())
    .filter(([ind, n]) => n > 0 && !industriesInUse.has(ind))
    .map(([ind]) => ind)
    .sort()

  return {
    total: rows.length,
    canonical: rows.filter(r => r.status === 'canonical').length,
    freeText: rows.filter(r => r.status === 'free_text').length,
    missing: rows.filter(r => r.status === 'missing').length,
    orphanIndustries,
    clients: rows.sort((a, b) => {
      // 问题最大的排最前：自由文本 > 没填 > 正常
      const rank = { free_text: 0, missing: 1, canonical: 2 } as const
      return rank[a.status] - rank[b.status] || a.clientName.localeCompare(b.clientName)
    }),
  }
}
