import React from 'react'
import Link from 'next/link'
import { enabled } from '@/lib/meta/ai/contract'
import { ZhugeGlobalFab } from './_components/ZhugeGlobalFab'
import { readUserTier } from '@/components/auth/ServerFeatureLock'

export default function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  // 板桥 2026-08-11 PR6 复审：诸葛亮 FAB 是给内部员工（FDE/admin）用的中文
  // 工作台入口，之前无条件挂在这个 layout 上，对自助注册客户也全程可见——
  // 一个刚验证完邮箱的新西兰老板会在纯英文向导页角落看到一个飘着的中文
  // 悬浮球，容易怀疑自己上错网站。self_serve 访客不该看到它。
  const tier = readUserTier()
  const showFab = tier !== 'self_serve'

  return (
    <>
      {enabled() && <div className="border-b px-6 py-2 text-sm"><Link href={`/meta-ads-ai/${params.id}`} className="underline">Connect Meta Ads to your AI · Read-only pilot</Link></div>}
      {children}
      {showFab && <ZhugeGlobalFab clientId={params.id} />}
    </>
  )
}
