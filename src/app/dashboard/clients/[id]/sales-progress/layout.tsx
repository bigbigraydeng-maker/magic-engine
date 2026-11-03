import type { ReactNode } from 'react'
import { CrmWorkspaceShell } from '../crm/_components/CrmWorkspaceShell'

/**
 * 销售进度页虽然不在 crm/ 路径下，却是 CRM 顶部导航里的一项，从 CRM 点过来时
 * 应该还是同一个工作区（大菜单保持收起、顶部那条导航还在）。这一页只能从 CRM
 * 进入，所以套同一个外壳；页面内容一个字没动。
 * （「设置」页是各种设置共用的，不套这个外壳，见 PR 说明。）
 */
export default function SalesProgressLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { id: string }
}) {
  return <CrmWorkspaceShell clientId={params.id}>{children}</CrmWorkspaceShell>
}
