/**
 * 测试用的假 Supabase —— **按表建模，不按调用次序建模**。
 *
 * 之前的假件是「第 N 次 from() 返回第 N 份数据」。那种写法有个致命性质：被测代码多查
 * 一张表、或者把两次查询换个顺序，假件照样返回一个「看起来对」的对象，于是真实
 * 环境里必炸的改动在测试里全绿。同一个毛病让一个静默失败活了两个月。
 *
 * 这里的规矩：
 *   · 没建模的表**直接抛** —— 查了不该查的表，测试当场红，不给半成品对象；
 *   · 过滤条件真的执行 —— 列名写错（`date` vs `insight_date`）会查出 0 条而不是全部；
 *   · 写操作原样记下来 —— 断言「有没有写」「写到哪一行」「写了什么值」。
 */

export interface FakeTable {
  rows: Array<Record<string, unknown>>
  /** 设了就让这张表的查询返回错误，用来验「查失败」跟「真没有」被分开处理。 */
  error?: string
}

export interface RecordedUpdate {
  table: string
  values: Record<string, unknown>
  filters: Array<[string, unknown]>
}

type Filter = (row: Record<string, unknown>) => boolean

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = []
  private eqPairs: Array<[string, unknown]> = []
  private updateValues: Record<string, unknown> | null = null

  constructor(
    private readonly table: string,
    private readonly data: FakeTable,
    private readonly updates: RecordedUpdate[],
  ) {}

  select(_cols?: string): this {
    return this
  }

  update(values: Record<string, unknown>): this {
    this.updateValues = values
    return this
  }

  eq(col: string, val: unknown): this {
    this.eqPairs.push([col, val])
    this.filters.push((r) => r[col] === val)
    return this
  }

  gte(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) >= val)
    return this
  }

  lte(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) <= val)
    return this
  }

  lt(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) < val)
    return this
  }

  is(col: string, val: null): this {
    this.filters.push((r) => (r[col] ?? null) === val)
    return this
  }

  not(col: string, op: 'is', val: null): this {
    if (op !== 'is') throw new Error(`未建模的 not 运算符: ${op}`)
    this.filters.push((r) => (r[col] ?? null) !== val)
    return this
  }

  private rows(): Array<Record<string, unknown>> {
    return this.data.rows.filter((r) => this.filters.every((f) => f(r)))
  }

  then<R1, R2 = never>(
    onfulfilled?:
      | ((v: { data: unknown; error: { message: string } | null }) => R1 | PromiseLike<R1>)
      | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const settle = () => {
      if (this.data.error) return { data: null, error: { message: this.data.error } }
      if (this.updateValues) {
        this.updates.push({
          table: this.table,
          values: this.updateValues,
          filters: this.eqPairs,
        })
        return { data: null, error: null }
      }
      return { data: this.rows(), error: null }
    }
    return Promise.resolve(settle()).then(onfulfilled, onrejected)
  }
}

export function makeFakeSupabase(tables: Record<string, FakeTable>) {
  const updates: RecordedUpdate[] = []
  const client = {
    from(table: string) {
      const modelled = tables[table]
      // 半成品对象是这类假件最大的谎言来源 —— 宁可当场炸。
      if (!modelled) throw new Error(`未建模的表: ${table}`)
      return new FakeQuery(table, modelled, updates)
    },
  }
  // 假件只需长得像被测代码用到的那部分；不用扛整个 SupabaseClient 类型。
  return { client: client as never, updates }
}
