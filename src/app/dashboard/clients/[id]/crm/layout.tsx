import type { ReactNode } from 'react'
import { CrmWorkspaceShell } from './_components/CrmWorkspaceShell'

/**
 * CRM 自己的工作区外壳：只套在 /dashboard/clients/[id]/crm/** 下面。
 * 左边大的 ME 侧栏默认收起（可展开），顶上多一条 CRM 专用的窄导航。
 * 其它 dashboard 页面不经过这里，所以看起来、用起来跟以前完全一样。
 */
export default function CrmLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { id: string }
}) {
  return <CrmWorkspaceShell clientId={params.id}>{children}</CrmWorkspaceShell>
}
