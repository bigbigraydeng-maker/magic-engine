/**
 * 共享的假 Supabase —— **按表建模，认不出的表直接抛，过滤条件可断言**。
 *
 * 🔴 为什么必须共享（2026-08-05 全仓实测）：
 *    131 个测试文件各造各的假 supabase，**只有 6 个会在查到没建模的表时报错**。
 *    剩下 125 个的默认行为是「返回 `{}` 或空数组」——
 *    于是代码去查一张**根本不存在的表**时，假件照样配合着返回空，测试全绿，
 *    而生产静默失效。这不是假设，是同一天里连续挖出来的：
 *
 *      · `runner.ts` 查 `keywords` 表 → 该表 5-30 就归档了 → SEO 整柱
 *        每天被判「跳过」，**两个月没人发现**。而它的测试假件**专门给这张
 *        不存在的表建了模型**，所以一直绿。
 *      · `billing-monitor.ts` 查一个不存在的列 `logged_at` → 每次必抛，
 *        而这块**一个测试都没有**。
 *      · `content_posts.source_keyword_id` 这列不存在 → route-a 的写入
 *        **从来没成功过**。
 *
 * 三条护栏，缺一条今天的 bug 就能重演：
 *
 *   1. **未建模的表直接 throw** —— 不许静默兜底。测试报出来的错会直接指向
 *      「你查了一张我没建模的表」，而不是三层之外一个莫名其妙的症状。
 *   2. **过滤条件被记下来，可以断言** —— 尤其 `client_id`。今天全仓查过
 *      跨客户串数据，靠的就是「这个查询到底有没有按客户过滤」。
 *   3. **错误和空数据分开表达** —— `rows: []` 是「真的没有」，
 *      `error: '...'` 是「查失败了」。只断言 `toEqual([])` 的测试
 *      两种都会过，那正是 bug 活下来的缝（全仓 271 处这样的断言）。
 *
 * 用法：
 * ```ts
 * const supabase = fakeSupabase({
 *   clients: { rows: [{ id: 'c1', domain: 'example.co.nz' }] },
 *   blog_posts: { rows: [] },              // 真的没有
 *   keyword_snapshots: { error: 'boom' },  // 查失败
 * })
 * // 代码若去查 keywords（不存在的表）→ 立刻 throw，指名道姓
 * expect(supabase.queries('clients')[0].filters).toContainEqual(['eq', 'id', 'c1'])
 * ```
 */

export type FakeFilter = [op: string, column: string, value: unknown]

export interface FakeQuery {
  table: string
  columns: string
  filters: FakeFilter[]
  /** `.order(col, {ascending})` 记下来 —— 排序方向写反是真出过事的 */
  order: Array<{ column: string; ascending: boolean }>
  limit: number | null
}

export interface FakeTable {
  /** 这张表里有什么。空数组 = 真的没有。 */
  rows?: Array<Record<string, unknown>>
  /** 查询失败。跟「没有数据」是两件事，不许混。 */
  error?: string
}

export interface FakeSupabase {
  from(table: string): unknown
  /** 某张表上实际发生过的查询 —— 用来断言过滤条件真的加了 */
  queries(table?: string): FakeQuery[]
}

/** PostgREST 的过滤语义，够用即可：eq / neq / gt / gte / lt / lte / in / is */
function rowMatches(row: Record<string, unknown>, filters: FakeFilter[]): boolean {
  return filters.every(([op, col, val]) => {
    const v = row[col]
    switch (op) {
      case 'eq':  return v === val
      case 'neq': return v !== val
      // SQL 语义：跟 NULL 比大小永远不成立
      case 'gt':  return typeof v === 'number' && typeof val === 'number' && v > val
      case 'gte': return typeof v === 'number' && typeof val === 'number' && v >= val
      case 'lt':  return typeof v === 'number' && typeof val === 'number' && v < val
      case 'lte': return typeof v === 'number' && typeof val === 'number' && v <= val
      case 'in':  return Array.isArray(val) && val.includes(v)
      case 'is':  return val === null ? v === null || v === undefined : v === val
      case 'not_is': return val === null ? v !== null && v !== undefined : v !== val
      default:    return true
    }
  })
}

/** `alias:source` 投影 —— 少写一个别名，取到的就是 undefined，跟生产一致。 */
function project(row: Record<string, unknown>, columns: string): Record<string, unknown> {
  const cols = columns.trim()
  if (!cols || cols === '*') return { ...row }
  const out: Record<string, unknown> = {}
  for (const part of cols.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [alias, source] = part.includes(':')
      ? (part.split(':').map((s) => s.trim()) as [string, string])
      : [part, part]
    out[alias] = row[source]
  }
  return out
}

export function fakeSupabase(tables: Record<string, FakeTable>): FakeSupabase {
  const log: FakeQuery[] = []

  function builder(table: string) {
    const spec = tables[table]
    const q: FakeQuery = { table, columns: '*', filters: [], order: [], limit: null }
    log.push(q)

    const settle = () => {
      if (spec.error) return { data: null, error: { message: spec.error } }
      let rows = (spec.rows ?? []).filter((r) => rowMatches(r, q.filters))
      for (const o of [...q.order].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = String(a[o.column] ?? '')
          const bv = String(b[o.column] ?? '')
          return o.ascending ? av.localeCompare(bv) : bv.localeCompare(av)
        })
      }
      if (q.limit !== null) rows = rows.slice(0, q.limit)
      return { data: rows.map((r) => project(r, q.columns)), error: null }
    }

    const chain: Record<string, unknown> = {}
    chain.select = (cols?: string) => { q.columns = cols ?? '*'; return chain }
    for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is'] as const) {
      chain[op] = (col: string, val: unknown) => { q.filters.push([op, col, val]); return chain }
    }
    chain.not = (col: string, op: string, val: unknown) => {
      q.filters.push([`not_${op}`, col, val]); return chain
    }
    chain.order = (col: string, opts?: { ascending?: boolean }) => {
      q.order.push({ column: col, ascending: opts?.ascending !== false }); return chain
    }
    chain.limit = (n: number) => { q.limit = n; return chain }
    chain.maybeSingle = () => {
      const r = settle()
      if (r.error) return Promise.resolve({ data: null, error: r.error })
      return Promise.resolve({ data: r.data?.[0] ?? null, error: null })
    }
    chain.single = chain.maybeSingle
    // 可 await：`const { data, error } = await supabase.from(...)...`
    chain.then = (resolve: (v: unknown) => void) => {
      const r = settle()
      resolve(r)
      return Promise.resolve(r)
    }
    // 写操作不返回假数据 —— 想断言写了什么，请断言 queries()
    for (const op of ['insert', 'update', 'upsert', 'delete'] as const) {
      chain[op] = () => chain
    }
    return chain
  }

  return {
    from(table: string) {
      if (!(table in tables)) {
        // 🔴 这一行就是这个文件存在的理由。
        throw new Error(
          `fake supabase: 表 '${table}' 没有建模。\n` +
            `如果被测代码真的该查这张表，请在 fakeSupabase({...}) 里加上它；\n` +
            `如果不该查 —— 恭喜，你刚抓到一个真 bug（本仓已有三次代码在查不存在的表，` +
            `而假件配合着返回空，测试全绿、生产静默失效）。\n` +
            `已建模的表：${Object.keys(tables).join(', ') || '（一张都没有）'}`,
        )
      }
      return builder(table)
    },
    queries(table?: string) {
      return table ? log.filter((q) => q.table === table) : log
    },
  }
}
