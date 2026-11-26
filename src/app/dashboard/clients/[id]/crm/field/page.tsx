/**
 * 手机外勤页（第 1 刀，只读）：员工在户外打开，只看「今天要联系谁」。
 * 服务端页只做鉴权，其余在客户端组件里。设计稿：docs/specs/2026-11-15-crm-mobile-field-view-design-v0.md
 */

import type { ReactNode } from 'react'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { FieldTodayList } from '../_components/field/FieldTodayList'

export const dynamic = 'force-dynamic'

const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
const UNAVAILABLE_TEXT = '这一页暂时打不开，请稍后再试；如果一直这样，请告诉 Magic Engine。'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-xl px-4 py-5">{children}</div>
}

export default async function FieldPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return (
      <Shell>
        <p className="rounded border border-me-charcoal/20 bg-me-ivory p-4 text-base text-me-charcoal">
          {access.status === 401 || access.status === 403 ? NO_ACCESS_TEXT : UNAVAILABLE_TEXT}
        </p>
      </Shell>
    )
  }
  return (
    <Shell>
      <h1 className="mb-3 text-xl font-bold text-me-charcoal">今天要联系</h1>
      <FieldTodayList clientId={params.id} />
    </Shell>
  )
}
