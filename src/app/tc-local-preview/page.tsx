// LOCAL TEST HARNESS ONLY - NOT COMMITTED
import { TourCatalogClient } from '@/app/dashboard/clients/[id]/tour-catalog/_components/TourCatalogClient'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1680px] px-5 py-6 sm:px-8">
      <p className="mb-2 text-[11px] font-semibold text-me-charcoal/55">本机试用（数据在本机临时库）</p>
      <TourCatalogClient clientId="00000000-0000-0000-0000-0000000000a1" />
    </div>
  )
}
