/**
 * 房子列表页 —— 一个中介 / 开发商手上的房子在这里建档和维护。
 *
 * 在这之前「一套房」只能靠人直接改数据库,运营碰不到(CLAUDE.md:FDE/PM 配置类
 * 数据必须有 UI)。这一页就是那条写入路径。
 *
 * 服务端只做鉴权和外壳,取数和交互都在 ListingsClient 里(要 loading / 出错重试 /
 * 就地保存这些状态)。
 */

import Link from 'next/link'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { ListingsClient } from './_components/ListingsClient'

export const dynamic = 'force-dynamic'

export default async function ListingsPage({ params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-black text-[#C2453A]">无权访问</p>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{access.error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
      <div className="mb-6">
        <Link
          href={`/dashboard/clients/${params.id}`}
          className="text-xs font-bold text-me-charcoal/45 hover:text-me-ochre"
        >
          ← 返回工作台
        </Link>
        <h1 className="mt-1 font-display text-2xl font-black text-me-charcoal">房子</h1>
        <p className="mt-1 max-w-2xl text-sm font-semibold text-me-charcoal/55">
          这个中介手上的每一套房。建了档之后，进来的客人和投出去的广告才能挂到具体哪套房上，
          「哪个郊区好卖」「这个价位该投多少」才算得出来。
        </p>
      </div>

      <ListingsClient clientId={params.id} />
    </div>
  )
}
