/**
 * 自动发信：看系统自动发给客人的信——内容、收件人、发送情况。只读，不发信。
 * 设计稿：Figma「自动发信 · 页面设计 v0.2」。
 *
 * 服务端页只做鉴权（跟「邮件模板」页一样：付费客户员工能进来看），其余都在自包含的客户端组件
 * AutoSendBoard 里（props 只收 clientId）。以后要放进别的页面的标签里，原样搬 <AutoSendBoard /> 就行。
 */

import type { ReactNode } from 'react'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { AutoSendBoard } from '../_components/auto-send/AutoSendBoard'

export const dynamic = 'force-dynamic'

const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
const UNAVAILABLE_TEXT = '这一页暂时打不开，请稍后再试；如果一直这样，请告诉 Magic Engine。'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">{children}</div>
}

export default async function AutoSendPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
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
  return <AutoSendBoard clientId={params.id} />
}
