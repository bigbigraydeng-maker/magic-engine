/**
 * 团目录页 —— 这家客户所有团的统一档案。这里不记订单、付款和剩余座位数。
 *
 * 服务端只做三件事:鉴权(名单内的客户员工或 Magic Engine 管理员)、行业闸、外壳。
 * 页头(品牌、Beta 说明)、取数和交互都在 TourCatalogClient 里。
 * 隐藏入口只是体验,真正的防护在每个接口自己的 requireCatalogAccess。
 */

import type { ReactNode } from 'react'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { clientHasIndustryFeature, INDUSTRY_FEATURE_NOTICE } from '@/lib/clients/industry-guard'
import { TourCatalogClient } from './_components/TourCatalogClient'
import {
  CatalogPageNotice,
  NO_ACCESS_TEXT,
  PAGE_UNAVAILABLE_TEXT,
} from './_components/page-notices'

export const dynamic = 'force-dynamic'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-[1680px] px-5 py-6 sm:px-8">{children}</div>
}

export default async function TourCatalogPage({ params }: { params: { id: string } }) {
  const access = await requireCatalogAccess(params.id, 'view')
  if (!access.ok) {
    // 未登录由 middleware 拦;到这里的 403 = 账号不在名单里。别的情况一律说「暂时打不开」。
    const text = access.response.status === 403 ? NO_ACCESS_TEXT : PAGE_UNAVAILABLE_TEXT
    return (
      <Shell>
        <CatalogPageNotice text={text} />
      </Shell>
    )
  }

  // 行业闸:入口卡片已经按行业藏了,这里挡直接敲网址的情况。
  if (!(await clientHasIndustryFeature(params.id, 'tour_catalog'))) {
    return (
      <Shell>
        <CatalogPageNotice text={INDUSTRY_FEATURE_NOTICE.tour_catalog.title} />
      </Shell>
    )
  }

  return (
    <Shell>
      <TourCatalogClient clientId={params.id} />
    </Shell>
  )
}
