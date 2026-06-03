import { ZhugeGlobalFab } from '../../clients/[id]/_components/ZhugeGlobalFab'

/**
 * GEO Composer client-scoped layout — injects the 诸葛亮 FAB on every page
 * under /dashboard/geo-composer/[clientId]/** so the FAB persists when
 * navigating between the composer and deploy pages.
 *
 * IMPORTANT: This layout MUST live inside the [clientId] segment, not at
 * the geo-composer root, because the root layout would also wrap the
 * client-list page (/dashboard/geo-composer) which has no clientId param —
 * passing undefined to ZhugeGlobalFab crashes the whole tree on
 * clientId.slice(0, 8).
 */
export default function GeoComposerClientLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { clientId: string }
}) {
  return (
    <>
      {children}
      <ZhugeGlobalFab clientId={params.clientId} />
    </>
  )
}
