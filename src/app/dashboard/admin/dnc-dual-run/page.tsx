/**
 * 「切换前先看这批人」—— 拒联判据双跑对比的复核页。
 *
 * 事实优先重设计的第 0 步（方案
 * `docs/specs/2026-08-17-crm-facts-first-redesign-v1.md` §8 第 4 条）：
 * 把「能不能联系他」改成只从事实算之前，先把**会被放回名单的那批人**
 * 一个个看过。没有这份名单，切换那一刻就是在赌。
 *
 * 🔴 这一页只读。所有真正的改动都发生在「打开他的记录」之后的既有界面里 ——
 * 这里不新增任何写入路径，也不存任何新状态。
 *
 * 客户下拉是**选择器不是凭据**：列在这里只决定问哪个，能不能看由服务端
 * 每次重新校验（同 `/dashboard/kernel-approvals`）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { DualRunReview, type ClientOption } from './_components/DualRunReview'

export const dynamic = 'force-dynamic'

/**
 * 🔴 查客户失败 ≠ 没有客户。
 * `data ?? []` 会把网络抖动 / 权限问题一律变成空数组，页面于是宣称
 * 「还没有任何客户」—— 一句假话，而且看起来不像故障，没人会去查。
 */
type ClientLoad =
  | { readonly ok: true; readonly clients: ClientOption[] }
  | { readonly ok: false; readonly message: string }

async function loadClients(): Promise<ClientLoad> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .order('name', { ascending: true })
  if (error) return { ok: false, message: error.message }
  return { ok: true, clients: (data ?? []) as ClientOption[] }
}

export default async function DncDualRunPage() {
  const loaded = await loadClients()

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-black text-me-charcoal">切换前先看这批人</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-me-charcoal/65">
        我们准备把「这个人能不能联系」改成<b>只看往来记录算</b>，不再看档案上那个开关。
        改完之后，有一批人会<b>重新开始收到我们的消息</b> —— 他们的开关写着「已停」，
        但往来记录里一条证据都没有。
        <br />
        <b>这一页把那批人列出来，切换之前必须一个个看过。</b>
      </p>

      <div className="mt-6">
        {loaded.ok ? (
          loaded.clients.length === 0 ? (
            <p className="text-sm font-bold text-me-charcoal/55">还没有任何客户。</p>
          ) : (
            <DualRunReview clients={loaded.clients} />
          )
        ) : (
          <p className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/5 px-4 py-3 text-sm font-bold text-[#C2453A]">
            客户列表没读出来（{loaded.message}）—— 这不代表没有客户，先别当成空的看。
          </p>
        )}
      </div>
    </div>
  )
}
