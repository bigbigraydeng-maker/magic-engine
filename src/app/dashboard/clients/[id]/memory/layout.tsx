/**
 * 客户记忆库的服务端门。页面本身是客户端组件，文案挡不住直接打开网址。
 * 客户角色（access_type both/dashboard 且不是内部名单）不渲染编辑、删除、提取、导出。
 */

import type { ReactNode } from 'react'
import { requireOperatorAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

export default async function ClientMemoryLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { id: string }
}) {
  const access = await requireOperatorAccess(params.id)
  if (!access.ok) {
    const text =
      access.status === 403
        ? '客户记忆库只对内部账号开放。'
        : '页面暂时打不开，请稍后再试。'
    return (
      <div className="p-6">
        <p className="text-sm font-medium text-[#B03A2E]">{text}</p>
      </div>
    )
  }
  return children
}
