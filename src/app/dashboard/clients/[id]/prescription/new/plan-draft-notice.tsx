'use client'

import { useEffect, useState } from 'react'
import type { PlanDraftCardView } from '@/lib/marketing-plan/promo/plan-draft-card'

const POLL_MS = 5000
const MAX_POLLS = 24

const TONE_CLASS: Record<PlanDraftCardView['tone'], string> = {
  waiting: 'border-black/10 bg-white text-me-charcoal/80',
  ok: 'border-status-track/30 bg-status-track/10 text-me-charcoal',
  warn: 'border-status-exec/30 bg-status-exec/10 text-me-charcoal',
  info: 'border-black/10 bg-white text-me-charcoal/80',
}

export function PlanDraftNoticeCard({ view }: { view: PlanDraftCardView | null }) {
  if (!view) return null
  return (
    <div role="status" className={`rounded-xl border p-4 text-sm ${TONE_CLASS[view.tone]}`}>
      <p className="font-medium">推广计划草稿</p>
      <p className="mt-1">{view.text}</p>
    </div>
  )
}

/**
 * Shows the plan-draft receipt next to the agree buttons. Drafting runs after the
 * prescription is saved, so re-read until the receipt settles (bounded, then stop).
 */
export function PlanDraftNotice({ clientId, prescriptionId, refineRound = 0 }: {
  clientId: string
  prescriptionId: string
  /** Bumped by the parent after each successful refine (same prescription id), so the old receipt is dropped and re-read. */
  refineRound?: number
}) {
  const [view, setView] = useState<PlanDraftCardView | null>(null)

  useEffect(() => {
    setView(null)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const read = async (polls: number): Promise<void> => {
      let settled = false
      try {
        const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json() as { plan_draft?: PlanDraftCardView }
          if (cancelled) return
          if (data.plan_draft) setView(data.plan_draft)
          settled = data.plan_draft?.settled === true
        }
      } catch (err) {
        console.warn('[plan-draft-notice] read failed', err)
      }
      if (cancelled || settled || polls + 1 >= MAX_POLLS) return
      timer = setTimeout(() => void read(polls + 1), POLL_MS)
    }
    void read(0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [clientId, prescriptionId, refineRound])

  return <PlanDraftNoticeCard view={view} />
}
