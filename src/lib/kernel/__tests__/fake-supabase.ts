/**
 * 内存版 supabase —— **按表建模，不按调用次序建模**。
 *
 * 🔴 这一点是踩出来的：早先的假件按「第 N 次调用返回第 N 份数据」写，
 *    于是被测代码多查一张表就静默拿到半成品对象、错误被 catch 吞掉、
 *    症状指向别处，而测试一直是绿的（同一个毛病让一个 bug 活了两个月）。
 *    所以这里：
 *      ① 数据以表为单位存，过滤是真过滤（eq / in / is / gte / order / limit 都真跑）；
 *      ② **没建模的表直接 throw**，不返回空数组 —— 「查了一张不存在的表」
 *         必须当场炸，不能长得像「这张表是空的」；
 *      ③ 唯一约束和 append-only 触发器都在这里复刻，
 *         因为幂等和审计不可改写恰恰靠它们，只测应用层等于没测。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
// 🔴 复刻 RPC 的可恢复白名单时**直接复用**唯一那份声明，不再手抄一遍。
//    手抄过一次的后果：SQL 与 runner.ts 有架构测试盯着，假件这第三份没人盯，
//    加第五个拒绝码时它当场就跟另外两处分家了（K-WP02 实测撞到）。
import { RECOVERABLE_DENY_CODES } from '../runner'

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

let seq = 0
export function fakeId(prefix = 'id'): string {
  seq += 1
  // 🔴 生成的必须是**合法 UUID** —— 真表里这些主键列就是 `uuid`。
  //    以前返回 `authorization_decisions-000001` 这种，看着好读，
  //    但它让测试绕过了一整类真实输入边界（真库对畸形 uuid 抛 22P02，
  //    假件只做字符串比较照收不误）。可读性靠把序号放在最后一段保留。
  void prefix
  return `feed0000-0000-4000-8000-${String(seq).padStart(12, '0')}`
}

/** 复刻生产库上的唯一约束。少了它，幂等测试测的就只是应用层的一个 if。 */
const UNIQUE_KEYS: Record<string, string[][]> = {
  action_runs: [['client_id', 'idempotency_key']],
  action_run_steps: [['run_id', 'step_key']],
  // 🔴 业务副作用的数据库级幂等兜底（对应迁移里的部分唯一索引
  //    `uq_production_packages_kernel_run`）：同一条 run 只可能落一个包。
  //    **部分**索引 —— 只约束带 `kernel_run_id` 的行（= 执行内核造的），
  //    人工 / 其它管道造的包不受影响，所以这里 null 值一律跳过（见 assertUnique）。
  production_packages: [['source_payload->>kernel_run_id']],
}

const DEFAULTS: Record<string, () => Row> = {
  action_runs: () => ({
    status: 'queued',
    goal_id: null,
    execution_item_id: null,
    triggered_by_ref: null,
    input: {},
    rationale: null,
    evidence: {},
    authorization_decision_id: null,
    correlation_id: fakeId('corr'),
    cost_cap_usd: null,
    cost_estimate_usd: null,
    needs_human: false,
    last_error: null,
    claimed_by: null,
    claimed_at: null,
    heartbeat_at: null,
    lease_expires_at: null,
    previous_claimed_by: null,
    reclaim_count: 0,
    last_reclaimed_at: null,
    claim_generation: 0,
    started_at: null,
    finished_at: null,
  }),
  action_run_steps: () => ({
    status: 'pending',
    claimed_by: null,
    claimed_at: null,
    heartbeat_at: null,
    attempt: 0,
    reclaim_count: 0,
    next_attempt_at: null,
    output: {},
    verification: null,
    cost_actual_usd: 0,
    last_error: null,
    claim_generation: 0,
    started_at: null,
    finished_at: null,
  }),
  authorization_decisions: () => ({
    deny_code: null,
    policy_snapshot: {},
    policy_id: null,
    policy_version: null,
    decided_by_user: null,
    cost_cap_usd: null,
    cost_estimate_usd: null,
    expires_at: null,
    consumed_at: null,
    consumed_by: null,
  }),
  production_packages: () => ({
    status: 'draft',
    brief: null,
    source_payload: {},
    generation_context_snapshot: {},
  }),
}

export interface FakeSupabaseOptions {
  /** 让某张表的某种操作报错 —— 用来验证「读炸了」和「读到空」不是同一条分支。 */
  failOn?: Array<{ table: string; op: 'select' | 'insert' | 'update' | 'delete'; message: string }>
  /** 每次操作都记一笔，测试可以断言「这张表被查了几次 / 用什么条件查的」。 */
  log?: Array<{ table: string; op: string; filters: Filter[] }>
  /**
   * 🔴 假件的时钟。真库的 RPC 用的是 `now()`，复刻时如果偷懒用真挂钟，
   *    而夹具又冻结在某个时刻 —— 授权有效期（900 秒）迟早会被**真实时间**跨过，
   *    测试就成了定时炸弹（实测：跑了几个小时后同一批测试突然全报「授权过期」）。
   *    时间必须整条链只有一个来源。
   */
  now?: () => Date
  /**
   * 每次调 RPC **之前**的钩子。
   *
   * 🔴 用来精确制造交错：有些分支只在「两句之间别人插了一脚」时才走得到
   *    （比如批准之后、领租约之前被别人抢先跑完）。没有这个缝，那条分支
   *    就只能靠「大概等价」的间接测试糊过去 —— 而那正是遮蔽闸的温床。
   */
  beforeRpc?: (name: string, args: Record<string, unknown>) => void
  /**
   * 每次表操作**之前**的钩子。跟 `beforeRpc` 同一个用途，但**可以返回 Promise** ——
   * 返回了就把这次操作挂住，直到它 resolve。
   *
   * 🔴 为什么需要「挂住」而不只是「插一脚」：有些闸只在
   *    「某一段耗时操作**进行当中**别人接管了」时才走得到。
   *    比如授权前置校验读政策的那一刻被接管 —— 这时 `authorizing` 那一次写
   *    **早就成功了**，所以前面那道围栏拦不住，只有落拒绝那道能拦。
   *    没有这个 barrier，那条分支就只能靠「大概等价」的构造去测，
   *    而那正是遮蔽闸的温床（这一条被遮蔽了两次才测出来）。
   */
  beforeOp?: (table: string, op: string, filters: Filter[]) => void | Promise<void>
}

export interface Filter {
  kind: 'eq' | 'in' | 'is' | 'gte' | 'lte' | 'not' | 'or'
  column: string
  value: unknown
}

/**
 * PostgREST 的 `.or('a.is.null,b.gt.X')` 语法的最小解析。
 * 🔴 只实现内核真用到的算子（is.null / gt / gte / lt / lte / eq）——
 *    认不出的算子直接 throw，不能静默当「匹配」（那会把过滤器变成漏勺）。
 */
/**
 * 按**顶层**逗号切开 —— 括号里的逗号不算分隔符。
 *
 * 🔴 PostgREST 的 `.or()` 允许嵌套：`or(a.gt.1,and(a.eq.1,b.gt.2))`。
 *    直接 `split(',')` 会把 `and(...)` 从中间劈开，切出两截语法垃圾，
 *    然后按「认不出的算子」抛错 —— 于是 keyset 分页那种写法在假件里根本跑不了，
 *    而它恰恰是唯一能在活跃队列上不跳条的分页方式。
 */
function splitTopLevel(expr: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(expr.slice(start, i))
      start = i + 1
    }
  }
  parts.push(expr.slice(start))
  return parts.filter((p) => p.length > 0)
}

function orMatches(row: Row, expr: string): boolean {
  return splitTopLevel(expr).some((cond) => {
    // 嵌套组：and(...) 全真才真；or(...) 递归
    if (cond.startsWith('and(') && cond.endsWith(')')) {
      const inner = cond.slice('and('.length, -1)
      return splitTopLevel(inner).every((c) => orMatches(row, c))
    }
    if (cond.startsWith('or(') && cond.endsWith(')')) {
      return orMatches(row, cond.slice('or('.length, -1))
    }
    const firstDot = cond.indexOf('.')
    const secondDot = cond.indexOf('.', firstDot + 1)
    const column = cond.slice(0, firstDot)
    const op = secondDot === -1 ? cond.slice(firstDot + 1) : cond.slice(firstDot + 1, secondDot)
    const value = secondDot === -1 ? '' : cond.slice(secondDot + 1)
    const v = readPath(row, column)
    switch (op) {
      case 'is':
        if (value !== 'null') throw new Error(`[fake-supabase] .or 只实现了 is.null：${cond}`)
        return v === null || v === undefined
      case 'gt':
        return v !== null && v !== undefined && String(v) > value
      case 'gte':
        return v !== null && v !== undefined && String(v) >= value
      case 'lt':
        return v !== null && v !== undefined && String(v) < value
      case 'lte':
        return v !== null && v !== undefined && String(v) <= value
      case 'eq':
        return String(v) === value
      default:
        throw new Error(`[fake-supabase] .or 没实现算子「${op}」：${cond}`)
    }
  })
}

function readPath(row: Row, column: string): unknown {
  // PostgREST 的 JSON 取值语法：source_payload->>kernel_run_id
  if (column.includes('->>')) {
    const [base, key] = column.split('->>')
    const obj = row[base]
    if (obj && typeof obj === 'object') return (obj as Row)[key]
    return undefined
  }
  return row[column]
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = readPath(row, f.column)
    switch (f.kind) {
      case 'eq':
        return v === f.value
      case 'in':
        return Array.isArray(f.value) && (f.value as unknown[]).includes(v)
      case 'is':
        return f.value === null ? v === null || v === undefined : v === f.value
      case 'gte':
        return String(v) >= String(f.value)
      case 'lte':
        return String(v) <= String(f.value)
      case 'not':
        return v !== f.value
      case 'or':
        return orMatches(row, String(f.value))
      default:
        return true
    }
  })
}

export function createFakeSupabase(
  tables: Tables,
  options: FakeSupabaseOptions = {},
): SupabaseClient {
  const known = new Set(Object.keys(tables))

  function tableOf(name: string): Row[] {
    if (!known.has(name)) {
      // 🔴 不返回 []。查一张没建模的表必须炸 —— 否则「查错了表名」
      //    在测试里长得跟「这张表是空的」一模一样，正是生产上那个 bug 的形状。
      throw new Error(
        `[fake-supabase] 测试没有为表「${name}」建模。要么它不该被查，要么这个测试少准备了数据。`,
      )
    }
    return tables[name]
  }

  function failureFor(table: string, op: string): string | null {
    const hit = (options.failOn ?? []).find((f) => f.table === table && f.op === op)
    return hit ? hit.message : null
  }

  /**
   * 复刻 `action_run_steps.cost_actual_usd_is_a_real_amount`（T3）。
   *
   * 🔴 只建模应用层的守卫等于没建模这一层 —— 「绕开应用直接写库」的那条路
   *    必须在假件里也走不通，否则 SQL 和复刻在这一路上分家的那天不会有测试变红。
   *    判据跟 SQL 逐条对应（numeric 语义已在生产 PG 17.6 实测）：
   *      >= 0 拦住负数和 -Infinity；<> NaN 拦住 NaN（`NaN >= 0` 在 numeric 里是 true！）；
   *      < Infinity 拦住 +Infinity。
   */
  function assertRealCost(table: string, value: unknown): void {
    if (table !== 'action_run_steps') return
    if (value === null || value === undefined) return
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) return
    throw new Error(
      `new row for relation "action_run_steps" violates check constraint "cost_actual_usd_is_a_real_amount"`,
    )
  }

  /** 复刻 `client_automation_policies.spend_caps_are_real_amounts`（T2c）。 */
  function assertRealCaps(table: string, row: Row): void {
    if (table !== 'client_automation_policies') return
    for (const col of ['spend_cap_per_run_usd', 'spend_cap_per_period_usd']) {
      const v = row[col]
      if (v === null || v === undefined) continue
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) continue
      throw new Error(
        `new row for relation "client_automation_policies" violates check constraint "spend_caps_are_real_amounts"`,
      )
    }
  }

  function assertUnique(table: string, row: Row, ignore?: Row): void {
    for (const keys of UNIQUE_KEYS[table] ?? []) {
      // 🔴 部分唯一索引：任何一列取不到值就整条跳过。
      //    Postgres 的 `WHERE ... IS NOT NULL` 就是这个语义 ——
      //    不跳过的话，一堆「两边都是 null」的历史行会被误判成互相冲突。
      const values = keys.map((k) => readPath(row, k))
      if (values.some((v) => v === null || v === undefined)) continue

      const dup = tableOf(table).find(
        (r) => r !== ignore && keys.every((k, i) => readPath(r, k) === values[i]),
      )
      if (dup) {
        const e = new Error(
          `duplicate key value violates unique constraint "${table}_${keys.join('_')}_key"`,
        ) as Error & { code?: string }
        // Postgres 的唯一约束冲突码。应用层靠它把「正常竞争」跟「真故障」分开。
        e.code = '23505'
        throw e
      }
    }
  }

  function from(table: string) {
    const filters: Filter[] = []
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row[] = []
    let patch: Row = {}
    /**
     * 排序键，**按调用顺序**（跟 PostgREST 一致：先按第一个排，平手再按第二个）。
     *
     * 🔴 早先这里是单个 `orderBy`，后一次 `.order()` 把前一次**覆盖**掉。
     *    于是「先按时间、平手再按 id」这种写法在假件里悄悄退化成「只按 id」——
     *    被测代码的主排序键根本没生效，而测试照样绿。
     *    实测：一条专门验「等得最久的排最前」的变异探针因此完全抓不住。
     */
    const orderKeys: Array<{ column: string; ascending: boolean }> = []
    let limitN: number | null = null
    /** `.range(from, to)` 的起点。0 = 没翻页。 */
    let rangeFrom = 0
    let wantsReturn = false
    let singleMode: 'single' | 'maybeSingle' | null = null

    const builder: Record<string, unknown> = {}

    const chain = () => builder

    builder.select = (_cols?: string) => {
      if (op === 'select') wantsReturn = true
      else wantsReturn = true
      return chain()
    }
    builder.insert = (rows: Row | Row[]) => {
      op = 'insert'
      payload = Array.isArray(rows) ? rows : [rows]
      return chain()
    }
    builder.update = (p: Row) => {
      op = 'update'
      patch = p
      return chain()
    }
    builder.delete = () => {
      op = 'delete'
      return chain()
    }
    builder.eq = (column: string, value: unknown) => {
      filters.push({ kind: 'eq', column, value })
      return chain()
    }
    builder.in = (column: string, value: unknown[]) => {
      filters.push({ kind: 'in', column, value })
      return chain()
    }
    builder.is = (column: string, value: unknown) => {
      filters.push({ kind: 'is', column, value })
      return chain()
    }
    builder.gte = (column: string, value: unknown) => {
      filters.push({ kind: 'gte', column, value })
      return chain()
    }
    builder.lte = (column: string, value: unknown) => {
      filters.push({ kind: 'lte', column, value })
      return chain()
    }
    builder.or = (expr: string) => {
      filters.push({ kind: 'or', column: '', value: expr })
      return chain()
    }
    builder.not = (column: string, _op: string, value: unknown) => {
      filters.push({ kind: 'not', column, value })
      return chain()
    }
    builder.order = (column: string, opts?: { ascending?: boolean }) => {
      orderKeys.push({ column, ascending: opts?.ascending !== false })
      return chain()
    }
    builder.limit = (n: number) => {
      limitN = n
      return chain()
    }
    /**
     * PostgREST 的 `.range(from, to)` —— **两端都含**（`Range: 0-9` 是 10 行）。
     *
     * 🔴 复刻它是因为「翻页」这件事必须能被测：只建模 `.limit()` 的话，
     *    分页逻辑在假件里永远只看得到第一页，而「第二页拿到的是不是接着的」
     *    这个问题在测试里根本问不出来。
     */
    builder.range = (from: number, to: number) => {
      rangeFrom = from
      limitN = to - from + 1
      return chain()
    }
    builder.single = () => {
      singleMode = 'single'
      return chain()
    }
    builder.maybeSingle = () => {
      singleMode = 'maybeSingle'
      return chain()
    }

    function run(): { data: unknown; error: { message: string; code?: string } | null } {
      options.log?.push({ table, op, filters: [...filters] })

      const failure = failureFor(table, op)
      if (failure) return { data: null, error: { message: failure } }

      const nowIso = new Date().toISOString()
      let rows: Row[]

      if (op === 'insert') {
        const created: Row[] = []
        for (const raw of payload) {
          const row: Row = {
            id: fakeId(table),
            created_at: nowIso,
            updated_at: nowIso,
            ...(DEFAULTS[table]?.() ?? {}),
            ...raw,
          }
          try {
            assertRealCost(table, row.cost_actual_usd)
            assertRealCaps(table, row)
            assertUnique(table, row)
          } catch (e) {
            const err = e as Error & { code?: string }
            return { data: null, error: { message: err.message, code: err.code } }
          }
          // 复刻 fk_action_runs_goal_same_client（C4）：goal 必须属于同一客户。
          // MATCH SIMPLE 语义 —— goal_id 为 NULL 时不检查。
          if (table === 'action_runs' && row.goal_id) {
            const goal = tableOf('goals').find(
              (g) => g.id === row.goal_id && g.client_id === row.client_id,
            )
            if (!goal) {
              return {
                data: null,
                error: {
                  message:
                    'insert or update on table "action_runs" violates foreign key constraint "fk_action_runs_goal_same_client"',
                },
              }
            }
          }
          // 复刻 fk_action_runs_execution_item_same_client（S2）：同一个洞的第二处。
          if (table === 'action_runs' && row.execution_item_id) {
            const item = tableOf('execution_items').find(
              (e) => e.id === row.execution_item_id && e.client_id === row.client_id,
            )
            if (!item) {
              return {
                data: null,
                error: {
                  message:
                    'insert or update on table "action_runs" violates foreign key constraint "fk_action_runs_execution_item_same_client"',
                },
              }
            }
          }
          tableOf(table).push(row)
          created.push(row)
        }
        rows = created
      } else if (op === 'update') {
        const target = tableOf(table).filter((r) => matches(r, filters))

        // 复刻 `client_automation_policies_version_guard` 触发器。
        // 🔴 不复刻的话，「政策改了但没人 bump 版本」这条 P1 的测试
        //    测的就只是应用层碰巧写对了，而不是数据库真的强制了。
        if (table === 'client_automation_policies') {
          for (const r of target) {
            if (
              ('client_id' in patch && patch.client_id !== r.client_id) ||
              ('action_key' in patch && patch.action_key !== r.action_key)
            ) {
              return {
                data: null,
                error: {
                  message:
                    'client_automation_policies: client_id / action_key are immutable (insert a new policy row instead)',
                },
              }
            }
          }
        }
        // append-only 触发器的复刻：授权决策只允许把 consumed_at 从空写成一次值
        if (table === 'authorization_decisions') {
          const illegal = Object.keys(patch).filter(
            (k) => k !== 'consumed_at' && k !== 'consumed_by' && k !== 'updated_at',
          )
          if (illegal.length > 0) {
            return {
              data: null,
              error: {
                message: `authorization_decisions is append-only: only consumed_at/consumed_by may be set (tried: ${illegal.join(',')})`,
              },
            }
          }
          const already = target.find((r) => r.consumed_at !== null && r.consumed_at !== undefined)
          if (already) {
            return {
              data: null,
              error: { message: `authorization decision ${already.id} already consumed` },
            }
          }
        }
        // CHECK 约束在**写之前**判 —— 写完再回滚不是数据库的语义
        if ('cost_actual_usd' in patch) {
          try {
            assertRealCost(table, patch.cost_actual_usd)
          } catch (e) {
            return { data: null, error: { message: (e as Error).message } }
          }
        }
        for (const r of target) {
          const before = { ...r }
          Object.assign(r, patch)
          if (table === 'client_automation_policies') {
            const authFields = [
              'mode',
              'spend_cap_per_run_usd',
              'spend_cap_per_period_usd',
              'spend_cap_period',
              'decision_ttl_seconds',
              'effective_from',
              'effective_to',
            ]
            const changed = authFields.some((f) => before[f] !== r[f])
            // 调用方传什么 policy_version 都不算数：变了就 +1，没变就保持原值
            r.policy_version = Number(before.policy_version ?? 1) + (changed ? 1 : 0)
            r.updated_at = new Date().toISOString()
          }
        }
        rows = target
      } else if (op === 'delete') {
        const keep: Row[] = []
        const removed: Row[] = []
        for (const r of tableOf(table)) (matches(r, filters) ? removed : keep).push(r)

        // 🔴 删除侧的引用动作也要复刻，不能只建模插入侧。
        //    两条复合外键的删除语义**是不一样的**，而且这个差别是有意的：
        //      · goals   → NO ACTION：已经有执行台账的目标删不掉（要删先归档记录）
        //      · execution_items → ON DELETE SET NULL (execution_item_id)：
        //        看板卡片是会被例行删掉的，但执行台账要留下，只把指针置空
        //    只建模插入侧的话，SQL 和这份复刻在删除这一路上就分家了 ——
        //    而分家的那天没有任何测试会红。
        if (table === 'goals' && removed.length > 0) {
          const ids = new Set(removed.map((r) => r.id))
          const blocking = tableOf('action_runs').find((r) => r.goal_id && ids.has(r.goal_id))
          if (blocking) {
            return {
              data: null,
              error: {
                message:
                  'update or delete on table "goals" violates foreign key constraint "fk_action_runs_goal_same_client" on table "action_runs"',
              },
            }
          }
        }
        if (table === 'execution_items' && removed.length > 0) {
          const ids = new Set(removed.map((r) => r.id))
          for (const r of tableOf('action_runs')) {
            if (r.execution_item_id && ids.has(r.execution_item_id)) r.execution_item_id = null
          }
        }

        tables[table] = keep
        rows = removed
      } else {
        rows = tableOf(table).filter((r) => matches(r, filters))
        if (orderKeys.length > 0) {
          rows = [...rows].sort((a, b) => {
            for (const { column, ascending } of orderKeys) {
              const av = readPath(a, column)
              const bv = readPath(b, column)
              if (av === bv) continue // 这一键平手 → 交给下一键
              const cmp = (av as never) < (bv as never) ? -1 : 1
              return ascending ? cmp : -cmp
            }
            return 0
          })
        }
        // 🔴 先跳过 offset 再截断 —— 顺序反了的话第二页拿到的还是第一页那几条
        if (rangeFrom > 0) rows = rows.slice(rangeFrom)
        if (limitN !== null) rows = rows.slice(0, limitN)
      }

      // 返回深拷贝：让被测代码拿到的行改不动内存里的表，
      // 免得「忘了写库」的 bug 因为对象是同一个引用而看起来像成功了。
      const out = rows.map((r) => JSON.parse(JSON.stringify(r)) as Row)

      if (singleMode) {
        if (out.length === 1) return { data: out[0], error: null }
        if (singleMode === 'maybeSingle' && out.length === 0) return { data: null, error: null }
        return { data: null, error: { message: `expected single row, got ${out.length}` } }
      }
      if (op !== 'select' && !wantsReturn) return { data: null, error: null }
      return { data: out, error: null }
    }

    builder.then = (
      onFulfilled: (v: { data: unknown; error: { message: string; code?: string } | null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      // 钩子可以返回 Promise —— 返回了就把这次操作挂住（见 FakeSupabaseOptions.beforeOp）
      const hook = options.beforeOp?.(table, op, filters)
      if (hook && typeof (hook as Promise<void>).then === 'function') {
        return (hook as Promise<void>).then(() => settle(onFulfilled, onRejected), onRejected)
      }
      return settle(onFulfilled, onRejected)
    }

    function settle(
      onFulfilled: (v: { data: unknown; error: { message: string; code?: string } | null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) {
      let result: { data: unknown; error: { message: string; code?: string } | null }
      try {
        result = run()
      } catch (e) {
        // 🔴 必须**调用** onRejected，不能只 return 一个 rejected promise。
        //    `await thenable` 走的是 `then(resolve, reject)`，它的返回值被丢弃 ——
        //    返回一个没人接的 rejected promise，await 会永远不落地，
        //    错误变成一条 unhandled rejection。（这条是被 store.test.ts 揪出来的。）
        return onRejected ? Promise.resolve(onRejected(e)) : Promise.reject(e)
      }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    }

    return builder
  }

  /**
   * `kernel_begin_authorized_run` 的内存复刻。
   *
   * 🔴 **整个函数体是同步的**，这一点是故意的：Postgres 那边靠
   *    `FOR UPDATE` 锁 run 来保证「从 authorized 进 running 只发生一次」，
   *    JS 单线程里同步执行给出的是同一个语义 —— 中间不会被另一个
   *    并发调用切进来。只要这里出现一个 `await`，这个复刻就不再等价，
   *    并发测试也就测不到真东西了。
   */
  function beginAuthorizedRun(args: Record<string, unknown>): { ok: boolean; reason: string } {
    const runId = String(args.p_run_id)
    const decisionId = String(args.p_decision_id)
    const workerId = String(args.p_worker_id)
    const expectedGeneration =
      args.p_expected_generation === null || args.p_expected_generation === undefined
        ? null
        : Number(args.p_expected_generation)
    const no = (reason: string) => ({ ok: false, reason })

    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return no('run_not_found')
    const decision = tableOf('authorization_decisions').find((d) => d.id === decisionId)
    if (!decision) return no('decision_not_found')

    if (run.status !== 'authorized') return no(`run_not_authorized:${String(run.status)}`)
    // 🔴 F1 代际闸：状态闸和指针闸都对得上时，只有它能分开「当前这一代」和「上一代」
    if (expectedGeneration !== null && Number(run.claim_generation ?? 0) !== expectedGeneration) {
      return no(`stale_generation:${String(run.claim_generation ?? 0)}`)
    }
    if (run.authorization_decision_id !== decisionId) return no('decision_not_current')
    if (decision.action_run_id !== run.id) return no('decision_run_mismatch')

    if (decision.client_id !== run.client_id) return no('cross_client')
    if (decision.action_key !== run.action_key) return no('action_key_mismatch')
    if (decision.action_version !== run.action_version) return no('action_version_mismatch')
    if (decision.idempotency_key !== run.idempotency_key) return no('idempotency_mismatch')

    if (decision.verdict !== 'allow') return no(`not_allow:${String(decision.verdict)}`)
    if (decision.consumed_at) return no('already_consumed')
    if (decision.expires_at && String(decision.expires_at) <= (options.now?.() ?? new Date()).toISOString()) {
      return no('expired')
    }

    // 时间窗（C5）：带结束时间但还没到期的政策一样是生效的 —— 跟真 SQL 逐字一致
    const nowStr = (options.now?.() ?? new Date()).toISOString()
    const policy = tableOf('client_automation_policies')
      .filter(
        (p) =>
          p.client_id === run.client_id &&
          p.action_key === run.action_key &&
          String(p.effective_from) <= nowStr &&
          (p.effective_to === null || p.effective_to === undefined || String(p.effective_to) > nowStr),
      )
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0]
    // 🔴 政策被删掉 ≠ 「没有版本号所以随便过」。这正是 P1-1 里最阴的那条路。
    if (!policy) return no('no_active_policy')
    // 身份（C2）：版本号只在同一行政策内有意义
    if (policy.id !== decision.policy_id) return no('policy_identity_changed')
    if (policy.policy_version !== decision.policy_version) return no('stale_policy_version')
    // 模式复核（C2）
    if (decision.decided_by === 'policy' && policy.mode !== 'auto_approve') return no('policy_mode_changed')
    if (decision.decided_by === 'human' && policy.mode !== 'require_approval') return no('policy_mode_changed')

    const nowIso = (options.now?.() ?? new Date()).toISOString()
    decision.consumed_at = nowIso
    decision.consumed_by = workerId
    run.status = 'running'
    run.started_at = run.started_at ?? nowIso
    run.last_error = null
    run.updated_at = nowIso
    return { ok: true, reason: 'ok' }
  }

  /**
   * `kernel_resolve_pending_approval` 的内存复刻。
   * 🔴 跟 beginAuthorizedRun 同一原则：**整个函数体同步**，等价于行锁 ——
   *    一个 await 都不能有，否则并发测试测不到真东西。
   */
  function resolvePendingApproval(args: Record<string, unknown>): {
    ok: boolean
    reason: string
    decision_id: string | null
  } {
    const runId = String(args.p_run_id)
    const pendingId = String(args.p_pending_decision_id)
    const resolution = String(args.p_resolution)
    const resolvedBy = String(args.p_resolved_by)
    const reason = String(args.p_reason)
    const snapshot = (args.p_policy_snapshot ?? {}) as Row
    const costEstimate = (args.p_cost_estimate_usd ?? null) as number | null
    const no = (r: string) => ({ ok: false, reason: r, decision_id: null })

    if (resolution !== 'approve' && resolution !== 'reject') return no('bad_resolution')

    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return no('run_not_found')
    if (run.status !== 'pending_approval') return no(`not_pending:${String(run.status)}`)
    if (run.authorization_decision_id !== pendingId) return no('decision_not_current')

    const pending = tableOf('authorization_decisions').find((d) => d.id === pendingId)
    if (!pending) return no('pending_not_found')
    if (pending.action_run_id !== run.id) return no('pending_run_mismatch')
    if (pending.verdict !== 'require_approval') return no('not_require_approval')
    // 🔴 身份核对 —— 跟 SQL 一样放在 approve / reject 的**公共**分支。
    //    只在 approve 里判的话，一条 client_id 属于别人的错挂决策可以被
    //    当前客户拒掉，而新签的 deny 会把对方的 policy_id / 版本抄过来。
    if (
      pending.client_id !== run.client_id ||
      pending.action_key !== run.action_key ||
      pending.action_version !== run.action_version ||
      pending.idempotency_key !== run.idempotency_key
    ) {
      return no('pending_identity_mismatch')
    }

    const nowIso = (options.now?.() ?? new Date()).toISOString()

    if (resolution === 'reject') {
      const decision: Row = {
        id: fakeId('authorization_decisions'),
        created_at: nowIso,
        ...(DEFAULTS.authorization_decisions?.() ?? {}),
        action_run_id: run.id,
        client_id: run.client_id,
        action_key: run.action_key,
        action_version: run.action_version,
        verdict: 'deny',
        deny_code: 'policy_deny',
        reason,
        policy_snapshot: snapshot,
        policy_id: pending.policy_id ?? null,
        policy_version: pending.policy_version ?? null,
        decided_by: 'human',
        decided_by_user: resolvedBy,
        cost_cap_usd: run.cost_cap_usd ?? null,
        cost_estimate_usd: run.cost_estimate_usd ?? null,
        idempotency_key: run.idempotency_key,
        expires_at: null,
      }
      tableOf('authorization_decisions').push(decision)
      run.status = 'denied'
      run.authorization_decision_id = decision.id
      run.needs_human = false
      run.last_error = reason
      run.finished_at = nowIso
      // 🔴 跟 SQL 一致：批准 / 拒绝都是**交接**，把挂起期间那份僵尸租约清干净
      run.claimed_by = null
      run.claimed_at = null
      run.heartbeat_at = null
      run.lease_expires_at = null
      run.updated_at = nowIso
      return { ok: true, reason: 'rejected', decision_id: String(decision.id) }
    }

    // approve：政策三连，时间窗口径与 beginAuthorizedRun 一致
    const policy = tableOf('client_automation_policies')
      .filter(
        (p) =>
          p.client_id === run.client_id &&
          p.action_key === run.action_key &&
          String(p.effective_from) <= nowIso &&
          (p.effective_to === null || p.effective_to === undefined || String(p.effective_to) > nowIso),
      )
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0]
    if (!policy) return no('no_active_policy')
    if (policy.id !== pending.policy_id) return no('policy_identity_changed')
    if (policy.policy_version !== pending.policy_version) return no('stale_policy_version')
    if (policy.mode !== 'require_approval') return no('policy_mode_changed')


    const costCap = Number(policy.spend_cap_per_run_usd ?? 0)
    const ttl = Number(policy.decision_ttl_seconds ?? 900)
    const expiresAt = new Date(
      Date.parse(nowIso) + ttl * 1000,
    ).toISOString()

    const decision: Row = {
      id: fakeId('authorization_decisions'),
      created_at: nowIso,
      ...(DEFAULTS.authorization_decisions?.() ?? {}),
      action_run_id: run.id,
      client_id: run.client_id,
      action_key: run.action_key,
      action_version: run.action_version,
      verdict: 'allow',
      deny_code: null,
      reason,
      policy_snapshot: snapshot,
      policy_id: policy.id,
      policy_version: policy.policy_version,
      decided_by: 'human',
      decided_by_user: resolvedBy,
      cost_cap_usd: costCap,
      cost_estimate_usd: costEstimate,
      idempotency_key: run.idempotency_key,
      expires_at: expiresAt,
    }
    tableOf('authorization_decisions').push(decision)
    run.status = 'authorized'
    run.authorization_decision_id = decision.id
    run.cost_cap_usd = costCap
    run.cost_estimate_usd = costEstimate
    run.needs_human = false
    // 🔴 跟 SQL 一致：批准是交接 —— 挂起期间那份租约的 owner 早就走了，
    //    不清掉会把真正要来推进的人挡成「已经有人在做了」。
    run.claimed_by = null
    run.claimed_at = null
    run.heartbeat_at = null
    run.lease_expires_at = null
    run.updated_at = nowIso
    return { ok: true, reason: 'approved', decision_id: String(decision.id) }
  }

  /**
   * `kernel_claim_run_recovery` 的内存复刻。
   * 🔴 同样**整个函数体同步** —— 一个 await 都不能有，否则并发恢复测试测不到真东西。
   *    步骤重置和状态转换必须在这一个函数里一起完成（真库里是同一个事务）。
   */
  function claimRunRecovery(args: Record<string, unknown>): { ok: boolean; reason: string } {
    const runId = String(args.p_run_id)
    const expected = (args.p_expected_decision_id ?? null) as string | null
    const kind = String(args.p_recovery_kind)
    const actor = String(args.p_actor)
    const reason = String(args.p_reason)
    const no = (r: string) => ({ ok: false, reason: r })

    if (kind !== 'denied' && kind !== 'dead_letter') return no('bad_recovery_kind')

    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return no('run_not_found')

    // 状态 CAS
    if (run.status !== kind) return no(`not_recoverable:${String(run.status)}`)
    // 指针 CAS
    if ((run.authorization_decision_id ?? null) !== expected) return no('decision_not_current')

    let decision: Row | undefined
    if (expected !== null) {
      decision = tableOf('authorization_decisions').find((d) => d.id === expected)
      if (!decision) return no('decision_not_found')
      if (decision.action_run_id !== run.id) return no('decision_run_mismatch')
    }

    if (kind === 'denied') {
      if (expected === null) return no('deny_decision_missing')
      if (decision!.verdict !== 'deny') return no('not_a_deny')
      if (decision!.decided_by === 'human') return no('human_reject_not_recoverable')
      const code = decision!.deny_code as string | null
      if (!code || !RECOVERABLE_DENY_CODES.has(code)) {
        return no(`deny_code_not_recoverable:${code ?? 'null'}`)
      }
    }

    const nowIso = (options.now?.() ?? new Date()).toISOString()

    // 🔴 F1：恢复也是换人 —— 代际 +1 并推到**所有**步骤（含已成功的），
    //    否则恢复之前那个执行者醒过来还能拿着旧 step_id 写进来。
    const nextGen = Number(run.claim_generation ?? 0) + 1
    // 步骤重置 —— 只碰没跑成的；cost_actual_usd / output / verification 一概不动
    for (const st of tableOf('action_run_steps')) {
      if (st.run_id !== run.id) continue
      st.claim_generation = nextGen
      st.updated_at = nowIso
      if (st.status === 'succeeded') continue
      st.status = 'pending'
      st.last_error = null
      st.next_attempt_at = null
      st.finished_at = null
    }

    run.status = 'queued'
    run.authorization_decision_id = null
    run.needs_human = false
    run.last_error = null
    run.finished_at = null
    // 🔴 跟 SQL 一致：放回 queued 的同时把租约清干净，否则恢复之后崩掉
    //    这条 run 会留着一个死 owner，再也没人接得走。
    run.claimed_by = null
    run.claimed_at = null
    run.heartbeat_at = null
    run.lease_expires_at = null
    // 🔴 F1：恢复是换人 —— 代际 +1（上面已经推到所有步骤上了）
    run.claim_generation = nextGen
    run.evidence = {
      ...((run.evidence ?? {}) as Row),
      last_recovered_by: actor,
      last_recovered_at: nowIso,
      recovery_reason: reason,
      recovery_kind: kind,
      recovered_from_deny_code: (decision?.deny_code ?? null) as string | null,
    }
    run.updated_at = nowIso
    return { ok: true, reason: 'claimed' }
  }

  /**
   * `kernel_claim_or_takeover_run` 的内存复刻。
   * 🔴 同样**整个函数体同步**：真库靠 `FOR UPDATE` 锁 run 保证
   *    「同一时刻只有一个人能把 owner 换成自己」，JS 单线程里同步执行给的是同一个语义。
   */
  function claimOrTakeoverRun(args: Record<string, unknown>): {
    ok: boolean
    reason: string
    run_status: string | null
    decision_id: string | null
    reclaimed: boolean
    reclaim_count: number
    claim_generation: number | null
    reset_steps: boolean
  } {
    const runId = String(args.p_run_id)
    const ownerId = (args.p_owner_id ?? null) as string | null
    const leaseSeconds = Number(args.p_lease_seconds ?? 0)
    const expectedGeneration =
      args.p_expected_generation === null || args.p_expected_generation === undefined
        ? null
        : Number(args.p_expected_generation)
    const no = (r: string, run?: Row) => ({
      ok: false,
      reason: r,
      run_status: run ? String(run.status) : null,
      decision_id: run ? ((run.authorization_decision_id ?? null) as string | null) : null,
      reclaimed: false,
      reclaim_count: run ? Number(run.reclaim_count ?? 0) : 0,
      claim_generation: run ? Number(run.claim_generation ?? 0) : null,
      reset_steps: false,
    })

    if (!ownerId || ownerId.trim().length === 0) return no('owner_required')
    if (!Number.isFinite(leaseSeconds) || leaseSeconds <= 0) return no('lease_seconds_required')

    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return no('run_not_found')

    // 状态白名单。🔴 running 也在里面，但只有租约过期才轮得到（见下）——
    // 一律排除 running 会让「崩在执行中」的 run 永远没人能接手。
    if (!['queued', 'authorizing', 'authorized', 'running'].includes(String(run.status))) {
      return no(`not_claimable:${String(run.status)}`, run)
    }

    // 代际 CAS：带了 expected 就必须还是那一代（防旧调用复活之后来续租）
    if (expectedGeneration !== null && Number(run.claim_generation ?? 0) !== expectedGeneration) {
      return no(`stale_generation:${String(run.claim_generation ?? 0)}`, run)
    }

    const now = options.now?.() ?? new Date()
    const nowIso = now.toISOString()

    // 租约还活着、而且不是自己的 → 抢不走（这才配叫 in_progress）
    const leaseAlive =
      run.claimed_by != null &&
      run.lease_expires_at != null &&
      String(run.lease_expires_at) > nowIso
    if (leaseAlive && run.claimed_by !== ownerId) {
      return no(`already_owned:${String(run.claimed_by)}`, run)
    }

    const prevOwner = (run.claimed_by ?? null) as string | null
    const reclaimed = prevOwner !== null && prevOwner !== ownerId
    const changedHands = prevOwner !== ownerId
    const wasRunning = String(run.status) === 'running' && changedHands
    const nextGen = Number(run.claim_generation ?? 0) + (changedHands ? 1 : 0)

    // 接管一个 running 的 run = 放回可重新授权的状态（授权已被上一代兑换掉）
    if (wasRunning) {
      for (const st of tableOf('action_run_steps')) {
        if (st.run_id !== run.id) continue
        if (st.status === 'succeeded') continue
        st.status = 'pending'
        st.last_error = null
        st.next_attempt_at = null
        st.finished_at = null
        st.updated_at = nowIso
      }
    }
    // 🔴 换人就把**所有**步骤的代际推上去（含已成功的）——
    //    上一代握着的 step_id 从这一刻起写不进任何一行。
    if (changedHands) {
      for (const st of tableOf('action_run_steps')) {
        if (st.run_id !== run.id) continue
        st.claim_generation = nextGen
        st.updated_at = nowIso
      }
    }

    const statusOut = wasRunning ? 'queued' : String(run.status)
    const decisionOut = wasRunning ? null : ((run.authorization_decision_id ?? null) as string | null)

    run.status = statusOut
    run.authorization_decision_id = decisionOut
    run.claimed_by = ownerId
    run.claimed_at = nowIso
    run.heartbeat_at = nowIso
    run.lease_expires_at = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
    run.claim_generation = nextGen
    if (reclaimed) {
      run.previous_claimed_by = prevOwner
      run.reclaim_count = Number(run.reclaim_count ?? 0) + 1
      run.last_reclaimed_at = nowIso
    }
    run.evidence = {
      ...((run.evidence ?? {}) as Row),
      last_claimed_by: ownerId,
      last_claimed_at: nowIso,
      last_claim_generation: nextGen,
      last_takeover_from: reclaimed ? prevOwner : null,
      took_over_running: wasRunning,
    }
    run.updated_at = nowIso

    return {
      ok: true,
      reason: reclaimed ? 'taken_over' : 'claimed',
      run_status: statusOut,
      decision_id: decisionOut,
      reclaimed,
      reclaim_count: Number(run.reclaim_count ?? 0),
      claim_generation: nextGen,
      reset_steps: wasRunning,
    }
  }

  /** `kernel_record_fenced_deny` 的内存复刻。插入之前就在「锁」里验代际。 */
  function recordFencedDeny(args: Record<string, unknown>): {
    ok: boolean
    reason: string
    decision_id: string | null
  } {
    const runId = String(args.p_run_id)
    const expectedGen =
      args.p_expected_generation === null || args.p_expected_generation === undefined
        ? null
        : Number(args.p_expected_generation)
    const expectedStatus = (args.p_expected_status ?? null) as string | null
    const expectedDecisionId = (args.p_expected_decision_id ?? null) as string | null
    const d = (args.p_decision ?? {}) as Row
    const reason = String(args.p_reason)
    const no = (r: string) => ({ ok: false, reason: r, decision_id: null })

    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return no('run_not_found')
    if (expectedGen !== null && Number(run.claim_generation ?? 0) !== expectedGen) {
      return no(`stale_generation:${String(run.claim_generation ?? 0)}`)
    }
    // 跨客户：决策必须属于这条 run 的客户（跟 SQL 同一道闸）
    if (d.client_id !== run.client_id) return no('cross_client')
    // 复刻 deny_code_matches_verdict：deny 必须带机器可读的码
    if (!d.deny_code) {
      throw new Error(
        'new row for relation "authorization_decisions" violates check constraint "deny_code_matches_verdict"',
      )
    }
    if (expectedStatus !== null && run.status !== expectedStatus) {
      return no(`not_${expectedStatus}:${String(run.status)}`)
    }
    // 🔴 指针闸 —— 跟 SQL 第 ④ 步同一道：run 当前指着的必须还是调用方看到的那份。
    //    只建模状态闸的话，「期间被重新排成另一份待审批请求」那条路在假件里走不到。
    if (expectedDecisionId !== null) {
      if (run.authorization_decision_id !== expectedDecisionId) return no('decision_not_current')

      // 🔴 **锚的完整身份 —— 跟 SQL 逐条对齐。**（Codex P2）
      //    只比指针不够：外键只保证那条决策**存在**，不保证它属于这条 run、
      //    这个客户。错挂之后失败落地会把别人那份决策的 policy_id / 版本
      //    抄进这个客户的审计记录。假件少一条，那条路在测试里就走不到。
      const pending = tableOf('authorization_decisions').find((x) => x.id === expectedDecisionId)
      if (!pending) return no('pending_not_found')
      if (pending.action_run_id !== run.id) return no('pending_run_mismatch')
      if (pending.verdict !== 'require_approval') return no('not_require_approval')
      if (
        pending.client_id !== run.client_id ||
        pending.action_key !== run.action_key ||
        pending.action_version !== run.action_version ||
        pending.idempotency_key !== run.idempotency_key
      ) {
        return no('pending_identity_mismatch')
      }
    }

    const nowIso = (options.now?.() ?? new Date()).toISOString()
    const decision: Row = {
      id: fakeId('authorization_decisions'),
      created_at: nowIso,
      ...(DEFAULTS.authorization_decisions?.() ?? {}),
      action_run_id: run.id,
      client_id: d.client_id,
      action_key: d.action_key,
      action_version: d.action_version,
      verdict: 'deny',
      deny_code: d.deny_code ?? null,
      reason,
      policy_snapshot: d.policy_snapshot ?? {},
      policy_id: d.policy_id ?? null,
      policy_version: d.policy_version ?? null,
      decided_by: d.decided_by ?? 'policy',
      decided_by_user: d.decided_by_user ?? null,
      cost_cap_usd: d.cost_cap_usd ?? null,
      cost_estimate_usd: d.cost_estimate_usd ?? null,
      idempotency_key: d.idempotency_key,
      expires_at: null,
    }
    tableOf('authorization_decisions').push(decision)

    run.status = 'denied'
    run.authorization_decision_id = decision.id
    run.needs_human = true
    run.last_error = reason
    run.finished_at = nowIso
    run.updated_at = nowIso
    return { ok: true, reason: 'denied', decision_id: String(decision.id) }
  }

  /** `kernel_ensure_run_steps` 的内存复刻。建步骤也要过代际闸。 */
  function ensureRunSteps(args: Record<string, unknown>): {
    ok: boolean
    reason: string
    created: number
  } {
    const runId = String(args.p_run_id)
    const clientId = String(args.p_client_id)
    const keys = (args.p_step_keys ?? []) as string[]
    const expectedGen =
      args.p_expected_generation === null || args.p_expected_generation === undefined
        ? null
        : Number(args.p_expected_generation)
    const no = (r: string) => ({ ok: false, reason: r, created: 0 })

    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return no('run_not_found')
    if (run.client_id !== clientId) return no('cross_client')
    if (expectedGen !== null && Number(run.claim_generation ?? 0) !== expectedGen) {
      return no(`stale_generation:${String(run.claim_generation ?? 0)}`)
    }

    const nowIso = (options.now?.() ?? new Date()).toISOString()
    const gen = Number(run.claim_generation ?? 0)
    let created = 0
    keys.forEach((key, idx) => {
      const dup = tableOf('action_run_steps').find(
        (st) => st.run_id === run.id && st.step_key === key,
      )
      if (dup) return
      tableOf('action_run_steps').push({
        id: fakeId('action_run_steps'),
        created_at: nowIso,
        updated_at: nowIso,
        ...(DEFAULTS.action_run_steps?.() ?? {}),
        run_id: run.id,
        client_id: run.client_id,
        step_key: key,
        step_index: idx,
        status: 'pending',
        claim_generation: gen,
      })
      created += 1
    })
    // 已存在的步骤拉齐到当前代际（第二道保险）
    for (const st of tableOf('action_run_steps')) {
      if (st.run_id !== run.id) continue
      if (Number(st.claim_generation ?? 0) === gen) continue
      st.claim_generation = gen
      st.updated_at = nowIso
    }
    return { ok: true, reason: 'ok', created }
  }

  /** `kernel_renew_lease` 的内存复刻（四项 CAS 一个都不能少）。 */
  function renewLease(args: Record<string, unknown>): { ok: boolean; reason: string } {
    const runId = String(args.p_run_id)
    const ownerId = String(args.p_owner_id)
    const expectedGen = Number(args.p_expected_generation)
    const leaseSeconds = Number(args.p_lease_seconds ?? 0)
    if (!Number.isFinite(leaseSeconds) || leaseSeconds <= 0) {
      return { ok: false, reason: 'lease_seconds_required' }
    }
    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return { ok: false, reason: 'run_not_found' }
    if (run.claimed_by !== ownerId) {
      return { ok: false, reason: `not_owner:${String(run.claimed_by ?? '<none>')}` }
    }
    if (Number(run.claim_generation ?? 0) !== expectedGen) {
      return { ok: false, reason: `stale_generation:${String(run.claim_generation ?? 0)}` }
    }
    if (run.status !== 'running') return { ok: false, reason: `not_running:${String(run.status)}` }

    const now = options.now?.() ?? new Date()
    run.lease_expires_at = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
    run.heartbeat_at = now.toISOString()
    run.updated_at = now.toISOString()
    return { ok: true, reason: 'renewed' }
  }

  /** `kernel_park_for_human` 的内存复刻。 */
  function parkForHuman(args: Record<string, unknown>): { ok: boolean; reason: string } {
    const runId = String(args.p_run_id)
    const expectedGen =
      args.p_expected_generation === null || args.p_expected_generation === undefined
        ? null
        : Number(args.p_expected_generation)
    const reason = String(args.p_reason ?? '')
    const key = String(args.p_evidence_key ?? 'parked_for_human')

    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return { ok: false, reason: 'run_not_found' }
    if (expectedGen !== null && Number(run.claim_generation ?? 0) !== expectedGen) {
      return { ok: false, reason: `stale_generation:${String(run.claim_generation ?? 0)}` }
    }

    const nowIso = (options.now?.() ?? new Date()).toISOString()
    const previousStatus = String(run.status)
    run.status = 'dead_letter'
    run.needs_human = true
    run.last_error = reason
    run.finished_at = nowIso
    run.claimed_by = null
    run.claimed_at = null
    run.heartbeat_at = null
    run.lease_expires_at = null
    run.evidence = {
      ...((run.evidence ?? {}) as Row),
      [key]: {
        reason,
        at: nowIso,
        generation: run.claim_generation ?? 0,
        previous_status: previousStatus,
      },
    }
    run.updated_at = nowIso
    return { ok: true, reason: 'parked' }
  }

  const client = {
    from,
    /** 只实现 Kernel 真正会调的那几个 RPC。别的名字直接炸。 */
    async rpc(name: string, args: Record<string, unknown>) {
      options.beforeRpc?.(name, args)
      if (name === 'kernel_begin_authorized_run') {
        return { data: [beginAuthorizedRun(args)], error: null }
      }
      // 🔴 历史原名今天**仍然存在**（前向迁移把它换成了转发到 v2 的兼容壳），
      //    所以假件也必须让它可调用并给出同样的结果 —— 建模成「不存在」会把
      //    「代码打了历史原名」这种真实回归伪装成一次干脆的失败，
      //    而生产上它是**静默成功**打在旧实现上的，那才是要防的形状。
      if (name === 'kernel_resolve_pending_approval' || name === 'kernel_resolve_pending_approval_v2') {
        return { data: [resolvePendingApproval(args)], error: null }
      }
      if (name === 'kernel_claim_run_recovery') {
        return { data: [claimRunRecovery(args)], error: null }
      }
      if (name === 'kernel_renew_lease') {
        return { data: [renewLease(args)], error: null }
      }
      if (name === 'kernel_park_for_human') {
        return { data: [parkForHuman(args)], error: null }
      }
      if (name === 'kernel_claim_or_takeover_run') {
        return { data: [claimOrTakeoverRun(args)], error: null }
      }
      // 🔴 两个**名字不同**的入口，按真库的形状分开建模。
      //    历史五参入口在真库里**没有** p_expected_decision_id 这个参数 ——
      //    PostgREST 按参数名找函数，多带一个它就找不到、回 PGRST202。
      //    假件必须照着炸：不然「不小心把指针传给了旧入口」这种回归
      //    会在测试里静静地生效，而生产上那道闸根本没跑。
      if (name === 'kernel_record_fenced_deny') {
        if ('p_expected_decision_id' in args) {
          return {
            data: null,
            error: {
              code: 'PGRST202',
              message:
                'Could not find the function public.kernel_record_fenced_deny(' +
                'p_decision, p_expected_decision_id, p_expected_generation, p_expected_status, ' +
                'p_reason, p_run_id) in the schema cache',
            },
          }
        }
        return { data: [recordFencedDeny({ ...args, p_expected_decision_id: null })], error: null }
      }
      if (name === 'kernel_record_fenced_deny_v2') {
        return { data: [recordFencedDeny(args)], error: null }
      }
      if (name === 'kernel_ensure_run_steps') {
        return { data: [ensureRunSteps(args)], error: null }
      }
      if (name !== 'kernel_claim_run_step') {
        throw new Error(`[fake-supabase] 没有建模的 RPC：${name}`)
      }
      const workerId = String(args.p_worker_id)
      const clientIds = (args.p_client_ids as string[] | null) ?? null
      const runs = tableOf('action_runs')
      const steps = tableOf('action_run_steps')

      const eligible = steps
        .filter((s) => s.status === 'pending')
        .filter((s) => !s.next_attempt_at || String(s.next_attempt_at) <= (options.now?.() ?? new Date()).toISOString())
        .filter((s) => !clientIds || clientIds.includes(String(s.client_id)))
        .filter((s) => {
          const run = runs.find((r) => r.id === s.run_id)
          return (
            !!run &&
            (run.status === 'authorized' || run.status === 'running') &&
            run.authorization_decision_id !== null &&
            run.authorization_decision_id !== undefined
          )
        })
        .sort((a, b) => Number(a.step_index) - Number(b.step_index))

      const step = eligible[0]
      if (!step) {
        return { data: [{ ok: false, step_id: null, run_id: null, client_id: null, step_key: null, attempt: null }], error: null }
      }
      step.status = 'claimed'
      step.claimed_by = workerId
      step.claimed_at = new Date().toISOString()
      step.heartbeat_at = step.claimed_at
      step.attempt = Number(step.attempt) + 1
      return {
        data: [
          {
            ok: true,
            step_id: step.id,
            run_id: step.run_id,
            client_id: step.client_id,
            step_key: step.step_key,
            attempt: step.attempt,
          },
        ],
        error: null,
      }
    },
  }

  return client as unknown as SupabaseClient
}
