/**
 * 等你点头的动作（内核审批）—— K-WP01 · Issue #881。
 *
 * 这一页是 ME「查看 + 授权」产品形态在**内核动作**上的落地，跟 `/dashboard/ad-approval`
 * 是同一套规矩的两条线：ME 把活干到只剩点头，那一下必须是人点的。
 *
 * 🔴 这一页只**签授权**，不**执行**。
 *    点「同意」之后，这条动作停在 `authorized` —— 没有任何能力被调用、没有任何步骤
 *    开始、没有任何对外写入。真正把它跑掉是 WP07 的事，不在本页范围内。
 *    页面上必须把这句话说给人听，否则审批人会以为自己点的是「现在就去做」。
 *
 * 🔴 本页一律走 `/api/kernel/approvals` 三个接口，**不直接查库**。
 *    那三个路由里冻结了鉴权顺序（先鉴权后查、runId 反查 client_id 再鉴权），
 *    页面自己查库 = 把那套顺序重新实现一遍，早晚跟服务端跑偏。
 *
 * 客户下拉是**选择器**不是**凭据**：这里列出来的客户只决定「问哪个」，
 * 能不能看由服务端每次重新校验。
 */

import { supabaseAdmin } from '@/lib/supabase'
import ApprovalQueue from './_components/ApprovalQueue'

export const dynamic = 'force-dynamic'

interface ClientOption {
  readonly id: string
  readonly name: string
}

/**
 * 🔴 查客户失败 ≠ 没有客户。
 *    `data ?? []` 会把网络抖动 / 权限问题 / 库故障一律变成空数组，页面于是宣称
 *    「还没有任何客户」—— 一句假话，而且看起来不像故障，没人会去查。
 *    这跟列表侧那三种空状态是同一条规矩，页面这一层也不能例外。
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

  return {
    ok: true,
    clients: ((data ?? []) as ClientOption[]).map((c) => ({ id: c.id, name: c.name })),
  }
}

export default async function KernelApprovalsPage() {
  const loaded = await loadClients()

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">等你点头的动作</h1>
        <p className="mt-2 text-sm text-slate-600">
          系统已经把活准备到只差一个决定。你点「同意」= 这条动作被<strong>签上授权</strong>，
          它会停在那里等着被执行；<strong>点同意不会让它立刻发生</strong>。
          你点「先不做」= 它被否决，不会再被捡起来。
        </p>
      </header>

      {!loaded.ok ? (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
          <p className="font-medium">客户名单读不出来</p>
          <p className="mt-1">
            这不是「没有客户」——是这次查询失败了，所以下面什么都不能显示。
          </p>
          <p className="mt-1 text-xs text-red-700">原话：{loaded.message}</p>
        </div>
      ) : loaded.clients.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 ring-1 ring-slate-200">
          还没有任何客户，先去客户管理里建一个。
        </p>
      ) : (
        <ApprovalQueue clients={loaded.clients} />
      )}
    </div>
  )
}
