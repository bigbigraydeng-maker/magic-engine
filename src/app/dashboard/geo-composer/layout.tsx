import { ZhugeGlobalFab } from '../clients/[id]/_components/ZhugeGlobalFab'

/**
 * GEO Composer layout — injects the 诸葛亮 FAB on every sub-page under
 * /dashboard/geo-composer/[clientId]/** so the FAB persists when navigating
 * between the composer and deploy pages.
 *
 * clientId is extracted from the URL segment; the FAB reads it to scope
 * API calls to the correct client.
 */
export default function GeoComposerLayout({
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
