import { listPausedAds } from '@/lib/ads-activate-card/paused'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { AdsExecutionReviewPanel } from '../_components/AdsExecutionReviewPanel'
import { ActivateAdEntry } from './activate-ad-entry'
import { AddCreativeEntry } from './add-creative-entry'

export const dynamic = 'force-dynamic'

export default async function ConfirmationCardsPage({
  params,
}: {
  params: { id: string }
}) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    const line = access.status === 401 ? '请先登录。' : '你不能看这位客户的确认卡。'
    return (
      <div className="px-6 py-10 md:px-10">
        <h1 className="font-display text-2xl font-bold text-me-charcoal">确认卡</h1>
        <p className="mt-3 text-base text-me-charcoal/80">{line}</p>
      </div>
    )
  }

  const pausedAds = await listPausedAds(supabaseAdmin, params.id)

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <header className="max-w-3xl">
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal md:text-3xl">确认卡</h1>
        <p className="mt-2 text-base leading-relaxed text-me-charcoal/70">
          会改广告、预算或 Meta 的事，都在这里点头。你不点，什么都不会改。
        </p>
      </header>
      <div className="max-w-3xl space-y-8">
        <ActivateAdEntry clientId={params.id} choices={pausedAds} />
        <AddCreativeEntry clientId={params.id} />
        <AdsExecutionReviewPanel clientId={params.id} />
      </div>
    </div>
  )
}
