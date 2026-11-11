'use client'

/**
 * 「等你点头」标签的内嵌视图：与 `ad-health/auto-pause` 同 API，仅排版不同。
 *
 * 🔴 批准走 `POST .../ad-health/auto-pause/[runId]/decision` —— 网址、方法、请求体未改。
 */

import Link from 'next/link'
import { MeButton } from '@/components/ui/me-primitives'
import { AutoPausePageView } from '../ad-health/auto-pause/auto-pause-page-view'

export default function AutoPausePanel({
  clientId,
  onPendingAdsChanged,
}: {
  readonly clientId: string
  readonly onPendingAdsChanged?: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-me-stone bg-me-ivory px-4 py-3">
        <p className="text-sm text-me-charcoal/75">完整排版与统计在「自动暂停」专页；这里仍可直接出确认卡。</p>
        <MeButton variant="ghost" size="sm" href={`/dashboard/clients/${clientId}/ad-health/auto-pause`}>
          打开自动暂停页
        </MeButton>
      </div>
      <AutoPausePageView clientId={clientId} variant="embed" onPendingAdsChanged={onPendingAdsChanged} />
      <p className="text-center text-xs text-me-charcoal/45">
        通用审批页对这类动作只签字、不执行，
        <Link className="underline" href={`/dashboard/clients/${clientId}/ad-health/auto-pause`}>要批在这里</Link>
        。
      </p>
    </div>
  )
}
