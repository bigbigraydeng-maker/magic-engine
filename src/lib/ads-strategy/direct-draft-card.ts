/**
 * The direct paused-ad route only asks for the existing paused-draft card.
 * It does not build. Several ad sets still have no card that can build them.
 */

import type { ConfirmationCardView } from '@/lib/confirmation-card'

export function draftHasSeveralAdSets(draft: { adSets?: unknown }): boolean {
  return Array.isArray(draft.adSets)
}

export async function askDirectPausedDraft(args: {
  draft: { adSets?: unknown }
  issue: () => Promise<ConfirmationCardView>
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (draftHasSeveralAdSets(args.draft)) {
    return {
      status: 409,
      body: {
        wroteMeta: false,
        error: '多个广告组还没有一张认多个组的确认卡，这一步没有去建。',
      },
    }
  }
  const card = await args.issue()
  return { status: 202, body: { wroteMeta: false, status: 'awaiting_confirmation', card } }
}
