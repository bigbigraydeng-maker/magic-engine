/**
 * 经营测算页 —— 手填参数、立刻算出年度利润，可保存多个场景并对比。
 *
 * 服务端只做三件事:鉴权(公司内部账号)、行业闸、外壳。
 * 页头、取数和交互都在 BusinessCalculatorClient 里。
 */

import type { ReactNode } from 'react'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature, INDUSTRY_FEATURE_NOTICE } from '@/lib/clients/industry-guard'
import { BusinessCalculatorClient } from './_components/BusinessCalculatorClient'

export const dynamic = 'force-dynamic'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-[1680px] px-5 py-6 sm:px-8">{children}</div>
}

function Notice({ text }: { text: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 text-sm text-me-charcoal/70 shadow-sm">
      {text}
    </div>
  )
}

export default async function BusinessCalculatorPage({ params }: { params: { id: string } }) {
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) {
    const text =
      access.status === 403
        ? '经营测算只对公司内部账号开放。'
        : '页面暂时打不开，请稍后再试。'
    return (
      <Shell>
        <Notice text={text} />
      </Shell>
    )
  }

  // 行业闸:入口卡片已经按行业藏了,这里挡直接敲网址的情况。
  if (!(await clientHasIndustryFeature(params.id, 'business_calculator'))) {
    return (
      <Shell>
        <Notice text={INDUSTRY_FEATURE_NOTICE.business_calculator.title} />
      </Shell>
    )
  }

  return (
    <Shell>
      <BusinessCalculatorClient clientId={params.id} />
    </Shell>
  )
}
