/**
 * 跨客户经验的**取数**行为测试（loadGlobalLessons 分支，经 loadMemoryForClient 入口）。
 *
 * 背景：clients.industry 是 PM 在后台自由填写的文本。早期实现把它直接拼进
 * PostgREST 的 `.or()` 过滤串：
 *   `scope.eq.global,scope.eq.channel,and(scope.eq.industry,industry.eq.${industry})`
 *
 * 实测复现的两种静默故障（都不报错、不崩，只是悄悄做错事）：
 *   1. 值里含 `,`  → 破坏过滤串语法 → 整条查询失败 → 该客户读不到**任何**全局经验
 *                    （连恒命中的 global/channel 层也一起丢）
 *   2. 值里含 `)` + `,` → 能闭合 and(...) 分组并注入额外条件 → 读到**别行业**的经验，
 *                    击穿「地产的课只喂地产客户」这道隔离闸
 *
 * 因此核心不变量：**industry 的值永远不得出现在任何 .or() 参数里**。
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMemoryForClient } from '../service'

type Op = [method: string, args: unknown[]]

interface RecordedQuery {
  table: string
  ops: Op[]
}

const LESSON_BASE = {
  lesson: 'Meta 的 AI 文案改写会删掉合规限定词',
  rationale: null,
  scope: 'channel',
  industry: null,
  flywheel: 'ads',
  confidence: 0.95,
  confirmed_count: 1,
  contradicted_count: 0,
}

const LESSON_INDUSTRY = {
  lesson: '学区盘广告不要只投住在楼盘附近的人',
  rationale: '为学区搬家的买家现在不住在该学区里',
  scope: 'industry',
  industry: 'real_estate',
  flywheel: 'ads',
  confidence: 0.7,
  confirmed_count: 1,
  contradicted_count: 0,
}

/**
 * 最小 supabase mock：链式方法全部记录后返回自身，await 时按表返回预设行。
 * `global_learned_lessons` 按本次查询是否带 scope='industry' 分流，
 * 以便断言两条支线各自查了什么。
 */
function makeSupabase(industryValue: string | null, queries: RecordedQuery[]): SupabaseClient {
  const from = (table: string) => {
    const record: RecordedQuery = { table, ops: [] }
    queries.push(record)

    const rowsForThisQuery = (): unknown[] => {
      if (table !== 'global_learned_lessons') return []
      const isIndustryBranch = record.ops.some(
        ([m, args]) => m === 'eq' && args[0] === 'scope' && args[1] === 'industry',
      )
      return isIndustryBranch ? [LESSON_INDUSTRY] : [LESSON_BASE]
    }

    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'order', 'limit', 'in', 'or', 'not']) {
      builder[method] = (...args: unknown[]) => {
        record.ops.push([method, args])
        return builder
      }
    }
    builder.maybeSingle = () => {
      record.ops.push(['maybeSingle', []])
      return Promise.resolve({ data: { industry: industryValue }, error: null })
    }
    builder.then = (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: rowsForThisQuery(), error: null }).then(onFulfilled, onRejected)

    return builder
  }

  return { from } as unknown as SupabaseClient
}

/** 该次调用里所有 .or() 的参数拼起来，用于断言「行业值没被拼进过滤串」 */
function allOrArgs(queries: RecordedQuery[]): string {
  return queries
    .flatMap((q) => q.ops.filter(([m]) => m === 'or'))
    .flatMap(([, args]) => args.map((a) => String(a)))
    .join(' | ')
}

function lessonQueries(queries: RecordedQuery[]): RecordedQuery[] {
  return queries.filter((q) => q.table === 'global_learned_lessons')
}

describe('loadGlobalLessons — 行业值不得进过滤串（注入 / 语法破坏防线）', () => {
  it('🔴 含逗号的行业值不会被拼进 .or()（否则整条查询失败，客户读不到任何经验）', async () => {
    const queries: RecordedQuery[] = []
    const ctx = await loadMemoryForClient(makeSupabase('Retail, Wholesale', queries), 'c1')

    expect(allOrArgs(queries)).not.toContain('Retail, Wholesale')
    expect(allOrArgs(queries)).not.toContain('Retail')
    // 基础层照常命中 —— 行业写得再乱也不该牵连 global/channel
    expect(ctx.global_lessons?.some((l) => l.scope === 'channel')).toBe(true)
  })

  it('🔴 构造式注入值不会被拼进 .or()（否则能读到别行业的经验）', async () => {
    const evil = 'x),scope.eq.industry,and(scope.eq.industry'
    const queries: RecordedQuery[] = []
    await loadMemoryForClient(makeSupabase(evil, queries), 'c1')

    expect(allOrArgs(queries)).not.toContain('scope.eq.industry')
    expect(allOrArgs(queries)).not.toContain(evil)
  })

  it('行业值只经参数化 .in() 传入，且 scope 用固定字面量', async () => {
    const queries: RecordedQuery[] = []
    await loadMemoryForClient(makeSupabase('real_estate', queries), 'c1')

    const lq = lessonQueries(queries)
    expect(lq).toHaveLength(2) // 基础层 + 行业层，各自独立

    const scopeIn = lq.flatMap((q) =>
      q.ops.filter(([m, args]) => m === 'in' && args[0] === 'scope'),
    )
    expect(scopeIn[0]?.[1][1]).toEqual(['global', 'channel'])

    const industryIn = lq.flatMap((q) =>
      q.ops.filter(([m, args]) => m === 'in' && args[0] === 'industry'),
    )
    expect(industryIn[0]?.[1][1]).toEqual(['real_estate'])
  })
})

describe('loadGlobalLessons — 行业匹配的宽容度与边界', () => {
  it('后台填 "Real Estate" 也能命中 real_estate 的经验（大小写/空格归一）', async () => {
    const queries: RecordedQuery[] = []
    const ctx = await loadMemoryForClient(makeSupabase('Real Estate', queries), 'c1')

    const industryIn = lessonQueries(queries).flatMap((q) =>
      q.ops.filter(([m, args]) => m === 'in' && args[0] === 'industry'),
    )
    expect(industryIn[0]?.[1][1]).toEqual(['Real Estate', 'real_estate'])
    expect(ctx.global_lessons?.some((l) => l.scope === 'industry')).toBe(true)
  })

  it('行业为空 → 只查基础层，不发行业层查询（不炸，只是少读几条）', async () => {
    const queries: RecordedQuery[] = []
    const ctx = await loadMemoryForClient(makeSupabase(null, queries), 'c1')

    expect(lessonQueries(queries)).toHaveLength(1)
    expect(ctx.global_lessons?.every((l) => l.scope !== 'industry')).toBe(true)
    expect(ctx.global_lessons?.length).toBeGreaterThan(0)
  })

  it('行业只有空白字符 → 视同未填', async () => {
    const queries: RecordedQuery[] = []
    await loadMemoryForClient(makeSupabase('   ', queries), 'c1')

    expect(lessonQueries(queries)).toHaveLength(1)
  })

  it('两条支线合并后按 confidence 降序（高置信的经验先进 prompt）', async () => {
    const queries: RecordedQuery[] = []
    const ctx = await loadMemoryForClient(makeSupabase('real_estate', queries), 'c1')

    const confidences = (ctx.global_lessons ?? []).map((l) => l.confidence)
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a))
    expect(ctx.global_lessons).toHaveLength(2)
  })
})
