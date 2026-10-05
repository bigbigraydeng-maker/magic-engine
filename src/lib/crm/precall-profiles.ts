/**
 * "Ask on the call" profiles for the pre-call brief card.
 *
 * The brief's `trip` block (`messenger/brief-schema.ts`) is the only place these
 * facts live, so a profile is just: which `trip` keys a salesperson still needs
 * to ask about when the key is empty, and how to say it in plain Chinese.
 *
 * This is an industry profile (travel), not a client setting. Another industry
 * passes its own list (or an empty one) to `buildPrecallBrief`; the shared
 * builder never names a tour, price, date or customer.
 */

import type { TripDetails } from '@/lib/messenger/brief-schema'

export interface PrecallAskItem {
  /** Key inside the brief's `trip` object. */
  key: keyof TripDetails
  /** Chinese label shown after "电话里要问：". */
  label: string
}

export const TOURISM_PRECALL_ASK_ITEMS: readonly PrecallAskItem[] = [
  { key: 'travel_window', label: '想什么时候出行' },
  { key: 'party_size', label: '几个人去' },
  { key: 'departure_city', label: '从哪个城市出发' },
  { key: 'first_time_to_china', label: '是不是第一次去' },
]
