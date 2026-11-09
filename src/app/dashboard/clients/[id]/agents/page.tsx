/**
 * 同行渠道 · 旅行社客户 —— 服务端外壳。
 *
 * 服务端只做鉴权和行业闸，取数和交互都在 AgentsClient 里（仿 listings/page.tsx 的拆法）。
 *
 * 🔴 这一页原来整个是 'use client'，没有任何服务端检查——藏掉首页卡片不算修好，
 * 网址还能直接敲进去（2026-09-28 查证，见台账 client-custom-features-leak-to-other-clients）。
 */

import Link from 'next/link'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature, INDUSTRY_FEATURE_NOTICE } from '@/lib/clients/industry-guard'
import { AgentsClient } from './_components/AgentsClient'

export const dynamic = 'force-dynamic'

export default async function AgentsPage({ params }: { params: { id: string } }) {
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

  // 行业闸：导航已经藏了入口，这里挡直接敲网址的情况 —— 非旅游客户后台不该有同行渠道。
  if (!(await clientHasIndustryFeature(params.id, 'agents'))) {
    const notice = INDUSTRY_FEATURE_NOTICE.agents
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
        <div className="rounded-xl border border-me-charcoal/12 bg-me-charcoal/[0.03] p-4">
          <p className="text-sm font-black text-me-charcoal">{notice.title}</p>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{notice.body}</p>
          <Link
            href={`/dashboard/clients/${params.id}`}
            className="mt-3 inline-block text-xs font-bold text-me-ochre hover:underline"
          >
            ← 返回工作台
          </Link>
        </div>
      </div>
    )
  }

  return <AgentsClient />
}
