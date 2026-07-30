'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ZhugeWorkbenchFab } from '@/components/workbench/ZhugeWorkbenchFab'
import { ZhugeWorkbenchDrawer } from '@/components/workbench/ZhugeWorkbenchDrawer'

interface ClientMeta {
  name: string
  domain?: string | null
}

/**
 * Global 诸葛亮 FAB — mounted in clients/[id]/layout.tsx so it persists across
 * every sub-page (overview, execution, diagnostic, strategy, production, etc).
 *
 * Wraps ZhugeWorkbenchFab (info panel: current thread, pending summary,
 * next-step suggestions, recent threads, quick links) and ZhugeWorkbenchDrawer
 * (chat with 诸葛亮 about the current client).
 *
 * The fab auto-infers `currentAreaLabel` from pathname so each sub-page tells
 * 诸葛亮 where the user currently is.
 */
export function ZhugeGlobalFab({ clientId }: { clientId: string }) {
  const pathname = usePathname()
  const [chatOpen, setChatOpen] = useState(false)
  const [client, setClient] = useState<ClientMeta | null>(null)

  // Fetch client metadata once so the panel can show a real label
  useEffect(() => {
    if (!clientId) return
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { client?: ClientMeta }
        if (data.client) setClient(data.client)
      } catch {
        // non-fatal: panel will fall back to the id-slice label
      }
    })()
  }, [clientId])

  // Defensive: if a parent layout forgets to pass clientId (e.g. wrong layout
  // scope, undefined param), don't crash the entire tree — render nothing.
  // Hooks above always run; this gate only blocks rendering.
  if (!clientId) return null

  // Infer the current area from pathname so 诸葛亮 knows where the user is
  const currentAreaLabel = inferAreaLabel(pathname, clientId)

  // Standard quick links to other client sub-pages for fast navigation
  const quickLinks = [
    { label: '概览',         href: `/dashboard/clients/${clientId}` },
    { label: '执行看板',     href: `/dashboard/clients/${clientId}/execution` },
    { label: 'Launch Hub',   href: `/dashboard/content?client=${clientId}` },
    { label: '诊断',         href: `/dashboard/clients/${clientId}/diagnostic` },
    { label: '内容策略',     href: `/dashboard/clients/${clientId}/strategy` },
    { label: 'AI 可见度',    href: `/dashboard/ai-visibility/${clientId}` },
  ]

  const clientLabel = client?.name ?? clientId.slice(0, 8)

  return (
    <>
      <ZhugeWorkbenchFab
        clientId={clientId}
        currentHref={pathname}
        clientLabel={clientLabel}
        currentAreaLabel={currentAreaLabel}
        quickLinks={quickLinks}
        onOpenChat={() => setChatOpen(true)}
      />
      <ZhugeWorkbenchDrawer
        clientId={clientId}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </>
  )
}

function inferAreaLabel(pathname: string | null, clientId: string): string {
  if (!pathname) return '客户工作台'
  const base = `/dashboard/clients/${clientId}`
  if (pathname === base) return '客户概览'
  const tail = pathname.replace(base, '')
  if (tail.startsWith('/execution'))      return 'Execution 看板'
  if (tail.startsWith('/diagnostic'))     return '华佗诊断'
  if (tail.startsWith('/prescription'))   return '诸葛亮处方'
  if (tail.startsWith('/zhangqian'))      return '张骞发现'
  if (tail.startsWith('/strategy'))       return '内容策略'
  if (tail.startsWith('/marketing-plan')) return 'Marketing Plan'
  if (tail.startsWith('/blog'))           return '博客'
  if (tail.startsWith('/production'))     return '生产包'
  if (tail.startsWith('/seo-intelligence')) return 'SEO Intelligence'
  if (tail.startsWith('/seo-gap'))        return 'SEO Gap'
  if (tail.startsWith('/site-audit'))     return '站点审计'
  if (tail.startsWith('/connectors'))     return '广告连接器'
  if (tail.startsWith('/assets'))         return '素材库'
  if (tail.startsWith('/goal'))           return 'Goal 战略层'
  if (tail.startsWith('/goals'))          return 'Goal 战略层'
  if (tail.startsWith('/listings'))       return '房子'
  if (tail.startsWith('/memory'))         return '客户记忆库'
  if (tail.startsWith('/wallet'))         return '钱包'
  if (tail.startsWith('/settings'))       return '设置'
  // geo-composer is a sibling route outside clients/[id], matched by full path
  if (pathname?.includes('/geo-composer')) return 'GEO Composer'
  return '客户工作台'
}
