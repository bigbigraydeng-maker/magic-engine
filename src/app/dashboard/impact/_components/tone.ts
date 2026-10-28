import type { ChainStepState } from '@/lib/prescription-chain/types'

/** Same colours as the nine dots on the prescription card. */
export const STAGE_TONE: Record<ChainStepState, string> = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  active: 'border-sky-200 bg-sky-50 text-sky-950',
  blocked: 'border-amber-300 bg-amber-50 text-amber-950',
  unread: 'border-gray-300 bg-gray-50 text-gray-700',
  waiting: 'border-gray-200 bg-white text-gray-500',
}
