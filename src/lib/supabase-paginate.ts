/**
 * 把一张表真正读全。
 *
 * ⚠️ 为什么必须有这个：Supabase(PostgREST) 单次查询**硬顶 1000 行**，
 * `.limit(20000)` 不会突破它，也**不会报任何错** —— 你以为拿到了两万条，
 * 实际只有一千条，剩下的静默消失。
 *
 * 这不是理论问题。2026-07-29 实测 CTS：
 *   库里 1271 条触点 · `.limit(20000)` 拿到 1000 条 · 静默丢 271 条
 *
 * 后果是「今天该联系谁」算错人：配合 `order('occurred_at', desc)`，被丢掉的
 * 恰恰是**最老的记录**。一位客户六月说过「下个月左右走」，那条记录排在
 * 1000 名开外，于是系统完全看不见他说过要走 —— 他被永远压在培育里。
 *
 * 用法（`range` 必须配 `order`，否则分页之间顺序不稳、会重复或漏行）：
 *
 *   const rows = await fetchAll((from, to) =>
 *     supabaseAdmin.from('contact_touchpoints')
 *       .select('contact_id, occurred_at')
 *       .eq('client_id', clientId)
 *       .order('occurred_at', { ascending: false })
 *       .range(from, to),
 *   )
 */

const PAGE_SIZE = 1000

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * 分页拉完所有行。
 *
 * @param page    给定 [from, to] 返回一页（务必带 .range(from, to) 和稳定排序）
 * @param hardCap 安全阀。到顶就停下并抛错 —— 宁可报错，也不要悄悄给出半份数据，
 *                那正是这个函数要解决的病。
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  hardCap = 100_000,
): Promise<T[]> {
  const out: T[] = []

  for (let from = 0; from < hardCap; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    // 不满一页 = 已经到底
    if (data.length < PAGE_SIZE) return out
  }

  if (out.length >= hardCap) {
    throw new Error(
      `fetchAll 触到 ${hardCap} 行上限，数据可能不完整 —— 这里需要改成流式或收窄查询条件`,
    )
  }
  return out
}

/** Read later pages in bounded batches, preserving order and the same fail-closed cap. */
export async function fetchAllBatched<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  hardCap = 100_000,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  let batchSize = 1
  while (from < hardCap) {
    const starts = Array.from({ length: batchSize }, (_, i) => from + i * PAGE_SIZE)
      .filter((start) => start < hardCap)
    const pages = await Promise.all(starts.map((start) => page(start, start + PAGE_SIZE - 1)))
    for (const result of pages) {
      if (result.error) throw new Error(result.error.message)
      if (!result.data || result.data.length === 0) return out
      out.push(...result.data)
      if (out.length >= hardCap) throw new Error(`fetchAll 触到 ${hardCap} 行上限，数据可能不完整 —— 这里需要改成流式或收窄查询条件`)
      if (result.data.length < PAGE_SIZE) return out
    }
    from += starts.length * PAGE_SIZE
    batchSize = 3
  }
  return out
}

export interface CountedPageResult<T> extends PageResult<T> {
  count?: number | null
}

/**
 * Read the first page together with the exact row count, then every remaining page at once.
 *
 * Sequential paging costs one round trip per 1000 rows; on a ten-page table that was
 * the largest single delay in the CRM list. Completeness is still proven, not assumed:
 * the merged result must contain exactly `count` distinct rows. Any mismatch (rows
 * inserted or deleted between the two waves, a missing count) falls back to the
 * sequential `fetchAll`, so the caller never receives a silently partial table.
 *
 * @param page  returns one page; request the exact count only when `withCount` is true
 * @param keyOf stable unique key of a row, used to detect rows that shifted between pages
 */
export async function fetchAllParallel<T>(
  page: (from: number, to: number, withCount: boolean) => PromiseLike<CountedPageResult<T>>,
  keyOf: (row: T) => string,
  hardCap = 100_000,
): Promise<T[]> {
  const sequential = () => fetchAll<T>((from, to) => page(from, to, false), hardCap)
  const first = await page(0, PAGE_SIZE - 1, true)
  if (first.error) throw new Error(first.error.message)
  const head = first.data ?? []
  const total = first.count
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return sequential()
  if (total >= hardCap) {
    throw new Error(`fetchAll 触到 ${hardCap} 行上限，数据可能不完整 —— 这里需要改成流式或收窄查询条件`)
  }
  const starts: number[] = []
  for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) starts.push(from)
  const rest = await Promise.all(starts.map((from) => page(from, from + PAGE_SIZE - 1, false)))
  const seen = new Set<string>()
  const out: T[] = []
  for (const result of [first, ...rest]) {
    if (result.error) throw new Error(result.error.message)
    for (const row of result.data ?? []) {
      const key = keyOf(row)
      // A repeated row means the table moved between the two waves.
      if (seen.has(key)) return sequential()
      seen.add(key)
      out.push(row)
    }
  }
  if (out.length !== total || head.length !== Math.min(total, PAGE_SIZE)) return sequential()
  return out
}
