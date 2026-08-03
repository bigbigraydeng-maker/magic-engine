import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDerive = vi.fn()
const mockGenerate = vi.fn()

vi.mock('./initiative-derive', () => ({
  deriveInitiativesFromPrescription: (...a: unknown[]) => mockDerive(...a),
}))
vi.mock('./execution-generator', () => ({
  generateExecutionItems: (...a: unknown[]) => mockGenerate(...a),
}))

import { landPrescription, type LandablePrescription } from './prescription-landing'

/**
 * 记录每一次 update 调用，用来断言「到底往表里写了什么」。
 *
 * `matched` 控制每次 update 命中几行 —— 默认 1。设成 0 用来复现
 * 「PostgREST 匹配 0 行也返回 error:null」那种静默失败。
 */
function fakeSupabase(
  opts: {
    updateError?: Record<string, string>
    /** 按 `表名:status` 指定命中行数，如 `{'prescriptions:approved': 0}` */
    matched?: Record<string, number>
    /** 上一版名下 pending 的旧动作条数（默认全部干净、可作废） */
    supersededItems?: number
    /** 直接给定上一版的旧动作，用来构造"有人动过"的情况 */
    priorItems?: Array<{
      id: string
      generation_error: string | null
      steps_json?: Record<string, unknown>
    }>
    /** 这些动作留过操作日志 —— 有人在上面写过东西 */
    itemsWithLogs?: string[]
    /** 查操作日志这一步失败 —— 保护性查询挂了，必须整轮不删 */
    logsQueryFails?: boolean
  } = {},
) {
  const updates: Array<{
    table: string
    patch: Record<string, unknown>
    /** 记 `[方法名, 字段, 值]` 三元组 —— 只记字段名的话，`.in('status', [...])` 里
     *  那个数组会被丢掉，于是"只作废 pending"这条断言其实什么都没锁住。 */
    calls: Array<[string, unknown, unknown]>
  }> = []
  /** 读操作上带的过滤条件，`[表名, 字段, 值]` */
  const readCalls: Array<[string, unknown, unknown]> = []
  /** 上一版名下的旧动作，供 select 用 */
  const priorItems =
    opts.priorItems ??
    Array.from({ length: opts.supersededItems ?? 2 }, (_, i) => ({
      id: `old${i}`,
      generation_error: null as string | null,
    }))
  const from = (table: string) => ({
    // 读旧动作 / 读操作日志
    select: (...selArgs: unknown[]) => {
      const chain: Record<string, unknown> = {}
      const self = (...args: unknown[]) => {
        readCalls.push([table, args[0], args[1]])
        return chain
      }
      for (const m of ['eq', 'in', 'order', 'limit']) chain[m] = self
      chain.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
        if (table === 'execution_logs' && opts.logsQueryFails) {
          return res({ data: null, error: { message: '查询超时' } })
        }
        return res({
          data:
            table === 'execution_logs'
              ? (opts.itemsWithLogs ?? []).map((id) => ({ execution_item_id: id }))
              : priorItems,
          error: null,
        })
      }
      void selArgs
      return chain
    },
    update: (patch: Record<string, unknown>) => {
      const rec = { table, patch, calls: [] as Array<[string, unknown, unknown]> }
      updates.push(rec)
      const key = `${table}:${String(patch.status)}`
      const err = opts.updateError?.[String(patch.status)]
      const chain: Record<string, unknown> = {}
      const method = (name: string) => (...args: unknown[]) => {
        rec.calls.push([name, args[0], args[1]])
        return chain
      }
      chain.eq = method('eq')
      chain.in = method('in')
      chain.select = () => {
        // execution_items 的作废是按 id 列表打的，命中数就是列表长度
        const inIds = rec.calls.find((c) => c[0] === 'in' && c[1] === 'id')?.[2] as string[] | undefined
        const rowCount =
          table === 'execution_items' ? (inIds?.length ?? 0) : (opts.matched?.[key] ?? 1)
        return Promise.resolve({
          data: err ? null : Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}` })),
          error: err ? { message: err } : null,
        })
      }
      return chain
    },
  })
  return { supabase: { from } as never, updates, readCalls }
}

const PRES: LandablePrescription = {
  id: 'p1',
  client_id: 'c1',
  goal_id: 'g1',
  version: 2,
  content: { summary: 's', phases: [], kpi_targets: [], budget_allocation: [] },
  supersedes_id: null,
}

beforeEach(() => {
  mockDerive.mockReset()
  mockGenerate.mockReset()
  mockDerive.mockResolvedValue({ inserted: 2, skipped: 0, notes: [], initiativeIdsByPhase: { 1: 'i1' } })
  mockGenerate.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }])
})

describe('landPrescription —— 方案变成看板上的活儿', () => {
  it('正常路径：派生 Initiative → 生成执行项 → 标记已批准', async () => {
    const { supabase, updates } = fakeSupabase()
    const r = await landPrescription(supabase, PRES)

    expect(r.initiativesInserted).toBe(2)
    expect(r.executionItems).toBe(3)
    const approved = updates.find((u) => u.patch.status === 'approved')
    expect(approved).toBeTruthy()
    expect(approved!.patch.approved_at).toBeTruthy()
  })

  it('🔴 派生 Initiative 失败**不**阻塞落地 —— 挂不上目标不代表动作做不了', async () => {
    mockDerive.mockRejectedValue(new Error('goal 没了'))
    const { supabase, updates } = fakeSupabase()
    const r = await landPrescription(supabase, PRES)

    expect(r.executionItems).toBe(3)
    expect(r.notes.join()).toContain('Initiative 派生失败')
    expect(updates.some((u) => u.patch.status === 'approved')).toBe(true)
  })

  it('🔴 执行项生成失败**必须**阻塞 —— 绝不能留下「已批准但看板上没动作」的幽灵', async () => {
    mockGenerate.mockRejectedValue(new Error('AI 挂了'))
    const { supabase, updates } = fakeSupabase()

    await expect(landPrescription(supabase, PRES)).rejects.toThrow('AI 挂了')
    // 关键：一次 approved 都不许写出去，处方要留在 draft
    expect(updates.some((u) => u.patch.status === 'approved')).toBe(false)
  })

  it('修订版落地 → 把被它替代的上一版归档，否则看板上同时挂着两版方案', async () => {
    const { supabase, updates } = fakeSupabase()
    await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(updates.some((u) => u.table === 'prescriptions' && u.patch.status === 'superseded')).toBe(true)
  })

  it('🔴 归档上一版时，它名下**没人动过**的旧动作也要一起作废 —— 否则堆的是动作不是处方', async () => {
    const { supabase, updates } = fakeSupabase({ supersededItems: 47 })
    const r = await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })

    const itemUpdate = updates.find((u) => u.table === 'execution_items')
    expect(itemUpdate).toBeTruthy()
    expect(itemUpdate!.patch.status).toBe('superseded')
    expect(r.supersededItems).toBe(47)
  })

  it('🔴 候选**只能**是 pending —— 把进行中/已完成也拉进来等于抹掉别人的工作记录', async () => {
    // 这是整个改动里唯一会破坏已有成果的一条，必须精确锁住取哪些状态。
    // 上一版这条断言只查了「filters 里出现过 status」，把 ['pending'] 改成
    // ['pending','in_progress','completed'] 照样全绿 —— 等于没锁。
    const { supabase, readCalls } = fakeSupabase({ supersededItems: 3 })
    await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    const statusIn = readCalls.find((c) => c[0] === 'execution_items' && c[1] === 'status')
    expect(statusIn?.[2]).toEqual(['pending'])
  })

  it('🔴 生成失败退回 pending 的不许动 —— 那是 FDE 等着重试的活，不是没人要的活', async () => {
    const { supabase } = fakeSupabase({
      priorItems: [
        { id: 'clean1', generation_error: null },
        { id: 'failed1', generation_error: '生成超时' },
        { id: 'clean2', generation_error: null },
      ],
    })
    const r = await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(r.supersededItems).toBe(2)
    expect(r.notes.join()).toContain('1 条有人动过')
  })

  it('🔴 留过操作日志的不许动 —— 有人在上面写过东西', async () => {
    const { supabase } = fakeSupabase({
      priorItems: [
        { id: 'clean1', generation_error: null },
        { id: 'logged1', generation_error: null },
      ],
      itemsWithLogs: ['logged1'],
    })
    const r = await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(r.supersededItems).toBe(1)
    expect(r.notes.join()).toContain('1 条有人动过')
  })

  it('🔴 只碰这份方案自己生成的动作 —— 诸葛亮的看板推荐卡也挂同一个方案号，但那是归属标记', async () => {
    // 库里实测：CTS 挂在当前方案下的 9 条待办**全是**诸葛亮昨天生成的建议。
    // 不加来源过滤的话，每周会把它当天刚算出来、让 FDE 今天去做的事一起抹掉。
    const { supabase, readCalls } = fakeSupabase({ supersededItems: 3 })
    await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    const sourceFilter = readCalls.find((c) => c[0] === 'execution_items' && c[1] === 'source')
    expect(sourceFilter?.[2]).toBe('diagnostic')
  })

  it('🔴 最终写回时状态条件要再查一遍 —— 中间隔了两个来回，FDE 可能刚把某条开工了', async () => {
    const { supabase, updates } = fakeSupabase({ supersededItems: 2 })
    await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    const itemUpdate = updates.find((u) => u.table === 'execution_items')!
    const statusGuard = itemUpdate.calls.find((c) => c[0] === 'in' && c[1] === 'status')
    expect(statusGuard?.[2]).toEqual(['pending'])
  })

  it('🔴 查操作记录失败 → 整轮一条都不动，不能偏向"删"', async () => {
    const { supabase, updates } = fakeSupabase({ logsQueryFails: true })
    const r = await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(r.supersededItems).toBe(0)
    expect(updates.some((u) => u.table === 'execution_items')).toBe(false)
    expect(r.notes.join()).toContain('这轮不动任何旧动作')
  })

  it('🔴 FDE 在看板上手工加的活不许收 —— 它也落成同一个来源，三道保护一道都不占', async () => {
    const { supabase } = fakeSupabase({
      priorItems: [
        { id: 'auto1', generation_error: null },
        { id: 'byhand', generation_error: null, steps_json: { source: 'fde_manual_add' } },
      ],
    })
    const r = await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(r.supersededItems).toBe(1)
    expect(r.notes.join()).toContain('1 条有人动过')
  })

  it('上一版的动作全都有人动过 → 一条都不作废', async () => {
    const { supabase } = fakeSupabase({
      priorItems: [{ id: 'a', generation_error: '失败了' }],
    })
    const r = await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(r.supersededItems).toBe(0)
  })

  it('没有上一版时，一条旧动作都不许碰', async () => {
    const { supabase, updates } = fakeSupabase()
    await landPrescription(supabase, PRES)
    expect(updates.some((u) => u.table === 'execution_items')).toBe(false)
  })

  it('旧版归档失败不致命 —— 新方案已经落地了，只是界面上多一份', async () => {
    const { supabase } = fakeSupabase({ updateError: { superseded: '写不进去' } })
    const r = await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(r.executionItems).toBe(3)
    expect(r.notes.join()).toContain('归档失败')
  })

  it('🔴 标记已批准失败要 throw —— 落地了却没记上，下周会重复开一份一样的方案', async () => {
    const { supabase } = fakeSupabase({ updateError: { approved: '列不存在' } })
    await expect(landPrescription(supabase, PRES)).rejects.toThrow('标记处方已批准失败')
  })

  it('🔴 UPDATE 一行都没命中也要 throw —— PostgREST 这时不报错，不自己查就当成功了', async () => {
    const { supabase } = fakeSupabase({ matched: { 'prescriptions:approved': 0 } })
    await expect(landPrescription(supabase, PRES)).rejects.toThrow('没有匹配到这条处方')
  })

  it('🔴 只写表里真有的列 —— approved_by 不是表字段，写进去整条 UPDATE 会失败', async () => {
    const { supabase, updates } = fakeSupabase()
    await landPrescription(supabase, PRES, '张三')
    const approved = updates.find((u) => u.patch.status === 'approved')!
    expect(Object.keys(approved.patch).sort()).toEqual(['approved_at', 'status'])
  })
})
