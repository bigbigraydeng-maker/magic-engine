/**
 * 团目录页 —— 这家客户所有团的统一档案。
 *
 * 网站、广告、邮件以后都读这一份。这里不记订单、付款和剩余座位数。
 *
 * 服务端只做鉴权和外壳,取数和交互都在 TourCatalogClient 里(要 loading /
 * 出错重试 / 就地刷新这些状态)。
 */

import Link from 'next/link'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { TourCatalogClient } from './_components/TourCatalogClient'

export const dynamic = 'force-dynamic'

export default async function TourCatalogPage({ params }: { params: { id: string } }) {
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

  // 团目录会改到全站共用的数据,只让管理员碰。
  if (access.role !== 'admin') {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-black text-[#C2453A]">无权访问</p>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/70">这个页面只有管理员能用</p>
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
        <h1 className="mt-1 font-display text-2xl font-black text-me-charcoal">团目录</h1>
        <p className="mt-1 max-w-2xl text-sm font-semibold text-me-charcoal/55">
          这里是这家客户所有团的统一档案：团名、行程、展示价、出发班期。网站、广告、邮件以后都读这一份。这里不记订单、付款和剩余座位数。
        </p>
      </div>

      <TourCatalogClient clientId={params.id} />
    </div>
  )
}
