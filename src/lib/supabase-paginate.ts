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
