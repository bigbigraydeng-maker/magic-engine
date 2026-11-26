/**
 * 发信统计：每封信发给了谁，客人有没有反应（点了链接 / 发信后联系了我们）。只读。
 * 服务端页只做鉴权（付费客户员工能进来看），其余在客户端组件里。
 */

import Link from 'next/link'
import type { ReactNode } from 'react'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { SendStatsView } from '../_components/send-stats/SendStatsView'

export const dynamic = 'force-dynamic'

const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
const UNAVAILABLE_TEXT = '这一页暂时打不开，请稍后再试；如果一直这样，请告诉 Magic Engine。'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">{children}</div>
}

export default async function SendStatsPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return (
      <Shell>
        <p className="rounded border border-me-charcoal/20 bg-me-ivory p-4 text-sm text-me-charcoal">
          {access.status === 401 || access.status === 403 ? NO_ACCESS_TEXT : UNAVAILABLE_TEXT}
        </p>
      </Shell>
    )
  }
  return (
    <Shell>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-me-charcoal">发信统计</h1>
        <Link href={`/dashboard/clients/${params.id}/crm/all`} className="text-sm underline">
          回到全部客人
        </Link>
      </div>
      <p className="mb-4 text-sm text-me-charcoal/70">每封信发给了谁，客人有没有反应。只统计从 CRM 里点「发送」发出的信。</p>
      <SendStatsView clientId={params.id} />
    </Shell>
  )
}
