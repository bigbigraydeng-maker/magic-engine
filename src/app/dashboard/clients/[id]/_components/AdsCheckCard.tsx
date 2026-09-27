'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Tools Lab entry for self-serve customers. Eligibility (self-serve client with the ad check-up visible) is decided
 * on the server by the client layout; this only keeps the card to the workspace home page, not every sub-page.
 */
export default function AdsCheckCard({ clientId }: { clientId: string }) {
  const pathname = usePathname()
  if (pathname !== `/dashboard/clients/${clientId}`) return null
  return (
    <div className="mx-6 mt-4 rounded-xl border border-amber-300 bg-amber-50 p-5">
      <h2 className="text-lg font-semibold text-amber-950">免费 Facebook 广告体检</h2>
      <p className="mt-2 text-sm text-amber-900">连上广告账户，用中文告诉你哪条广告值得看一眼。只看不改，免费。</p>
      <Link
        href={`/meta-ads-ai/${clientId}`}
        className="mt-4 inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white no-underline"
      >
        去体检
      </Link>
    </div>
  )
}
