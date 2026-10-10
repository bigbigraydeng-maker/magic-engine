/**
 * Facebook 主页绑定的检查（AD-SEC-4 · 2026-09-17）。流程见 page-binding-service.ts。
 *
 * ── 为什么 ───────────────────────────────────────────────────────────────
 * clients.facebook_page_id 决定每小时私信同步 / 表单线索同步读哪个主页，也是
 * boost-post 等写路径归属校验的依据。令牌常常回落到能看到多家客户主页的共享令牌，
 * 所以「令牌读得到这个主页」≠「主页属于这个客户」。
 *
 * ── 各道闸分别防什么（同 ad-account-binding.ts，别高估 Graph 那道）────────
 * 1. 只有内部员工能写（路由里 requireGlobalAdmin）—— 防客户自己改。
 * 2. 主页已绑在别的客户名下 → 拒绝，**不允许覆盖**（findOtherClientsBoundToPage）——
 *    跨客户误绑的主防线。和广告账户不同：同一主页挂两个客户会让私信 webhook
 *    按主页找客户时两个都找不到，也让按主页取令牌、同步归属变得说不清，没有正当场景。
 * 3. Meta 核实（page-binding-service.ts 的 verifyPageReachable）—— 只防输错号 /
 *    ME 根本碰不到的主页。
 *
 * 本文件不在 import 时创建 Supabase 客户端（调用方传入）：同步闸和每日待办都要用。
 * 这里不写死任何客户或行业。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'

/**
 * Page IDs are long numeric strings ("1616575215312482"). We accept digits only:
 * people paste the vanity URL (facebook.com/CTSTOURS) by mistake, and saving that
 * would leave the sync silently pulling nothing until someone dug into the logs.
 *
 * Returns null on empty input (clear the binding); throws on anything malformed.
 */
export function normalisePageId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error('page_id 必须是字符串或 null')

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  if (!/^\d{8,}$/.test(trimmed)) {
    throw new Error(
      '主页 ID 只能是数字（至少 8 位），比如 1616575215312482。' +
        '主页网址里的名字（facebook.com/CTSTOURS）不是 ID，请在下面的列表里选，或到主页「关于」页面找「主页 ID」。',
    )
  }
  return trimmed
}

/**
 * 库里存的值可能是 SQL 手填的脏数据（全角数字、零宽字符、前后空格、前导零）。
 * 比对必须也认得出，否则重复检查就是 fail-open（同 registeredValueMatches 的教训）。
 */
export function pageIdMatches(stored: string, target: string): boolean {
  const canon = (v: string) =>
    v
      .normalize('NFKC')
      .replace(/[\s\p{Cf}]/gu, '')
      .split(/\D+/)
      .filter((run) => run.length > 0)
      .map((run) => run.replace(/^0+/, ''))
  const want = canon(target)
  if (want.length !== 1 || want[0] === '') return false
  return canon(stored).includes(want[0])
}

export interface OtherPageBinding {
  client_id: string
  client_name: string | null
}

/**
 * 这个主页是否已绑在**别的**客户名下。全量读出在内存里比对（脏数据等值查询会漏）。
 * 查询出错抛出 —— 调用方必须 fail closed（查不出来 ≠ 没有重复）。
 */
export async function findOtherClientsBoundToPage(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
): Promise<OtherPageBinding[]> {
  const rows = await fetchAll<{ id: string; name: string | null; facebook_page_id: string | null }>(
    (from, to) =>
      supabase
        .from('clients')
        .select('id, name, facebook_page_id')
        .not('facebook_page_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
  )
  return rows
    .filter((r) => r.id !== clientId && r.facebook_page_id && pageIdMatches(r.facebook_page_id, pageId))
    .map((r) => ({ client_id: r.id, client_name: r.name }))
}
