import type { Availability } from '@/lib/factory/template-library/types'

/** Plain status. Upcoming means the preview is here and the renderer does not accept it yet. */
export function AvailabilityMark({ availability }: { availability: Availability }) {
  const live = availability === 'live'
  return (
    <p className={live ? 'text-sm font-semibold text-status-track' : 'text-sm font-semibold text-me-ochre'}>
      {live ? '现在就能用' : '还在审核'}
    </p>
  )
}
