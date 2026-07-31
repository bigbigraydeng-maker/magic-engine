import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getItinerary } from '@/lib/tailor-made/store'
import TailorMadeEditor from '../_components/TailorMadeEditor'

export const dynamic = 'force-dynamic'

export default async function TailorMadeEditorPage({
  params,
}: {
  params: { id: string; quoteId: string }
}) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-black text-[#C2453A]">无权访问</p>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{access.error}</p>
        </div>
      </div>
    )
  }

  const record = await getItinerary(params.id, params.quoteId)
  if (!record) notFound()

  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 py-6 sm:px-8">
      <Link
        href={`/dashboard/clients/${params.id}/tailor-made`}
        className="text-xs font-bold text-me-charcoal/45 hover:text-me-ochre"
      >
        ← 返回行程单列表
      </Link>
      <div className="mt-3">
        <TailorMadeEditor record={record} clientId={params.id} />
      </div>
    </div>
  )
}
