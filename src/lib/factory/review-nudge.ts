// Pending review older than 24 hours is nudged once in today's list.
// This does not approve the work order and does not send a message.

export const REVIEW_NUDGE_AFTER_MS = 24 * 60 * 60 * 1000

export type ReviewAge = 'wait' | 'nudge' | 'unreadable'

export function reviewAge(updatedAt: unknown, now: Date): ReviewAge {
  if (typeof updatedAt !== 'string' || !updatedAt.trim()) return 'unreadable'
  const parsed = Date.parse(updatedAt)
  if (!Number.isFinite(parsed)) return 'unreadable'
  return now.getTime() - parsed >= REVIEW_NUDGE_AFTER_MS ? 'nudge' : 'wait'
}
