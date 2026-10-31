/**
 * Ask for one paused-draft confirmation card. Does not write Meta.
 * A person confirms on the existing card. That path creates paused ads only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdDraft, AdDraftCreative } from '@/lib/ads-strategy/ad-draft'
import { loadPausedDraftContext } from '@/lib/ads-strategy/paused-draft-context'
import { issuePausedDraftCard } from '@/lib/ads-strategy/paused-draft-submit'
import { createKernel } from '@/lib/kernel'

const POST_ID = /^\d+$/

export interface WinnerPost {
  postId: string
  message: string
  score: number
}

export function majorBudget(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const minor = Number(raw)
  if (!Number.isFinite(minor) || minor <= 0) return null
  return minor / 100
}

function headlineFrom(message: string): string {
  const line = message.split('\n').map((part) => part.trim()).find(Boolean) ?? ''
  return line.slice(0, 40)
}

export function buildWinnerPausedDraft(args: {
  clientId: string
  pageId: string
  adSetId: string
  adSetName: string
  dailyBudgetMajor: number | null
  winners: readonly WinnerPost[]
}): { draft: AdDraft | null; skipped: number; blocked: string | null } {
  if (!/^\d{5,}$/.test(args.adSetId) || !POST_ID.test(args.pageId)) {
    return { draft: null, skipped: args.winners.length, blocked: 'target_not_promotable' }
  }
  const creatives: AdDraftCreative[] = []
  let skipped = 0
  for (const winner of args.winners) {
    const text = winner.message.trim()
    const headline = headlineFrom(text)
    const postOk = POST_ID.test(winner.postId) && POST_ID.test(args.pageId)
    if (!text || !headline || !postOk) {
      skipped += 1
      continue
    }
    const preview = text.slice(0, 30).replace(/\s+/g, ' ')
    creatives.push({
      name: `Reel: ${preview} [${winner.postId.slice(-6)}]`.slice(0, 90),
      primaryText: text.slice(0, 500),
      headline,
      promotedPostId: `${args.pageId}_${winner.postId}`,
    })
  }
  if (creatives.length === 0) return { draft: null, skipped, blocked: 'winner_skipped_no_caption' }
  const adSetName = args.adSetName.trim().slice(0, 80) || '已有广告组'
  return {
    blocked: null,
    skipped,
    draft: {
      kind: 'video_thruplay',
      clientId: args.clientId,
      campaignName: '赢家素材暂停草稿',
      adSetName,
      dailyBudget: args.dailyBudgetMajor ?? 0,
      durationDays: 0,
      geoCountries: [],
      pageId: args.pageId,
      existingAdSetId: args.adSetId,
      creatives,
    },
  }
}

export async function requestWinnerPausedCard(args: {
  supabase: SupabaseClient
  clientId: string
  adAccountId: string
  draft: AdDraft
}): Promise<{ runId: string }> {
  const context = await loadPausedDraftContext(args.supabase, args.clientId, args.adAccountId)
  const card = await issuePausedDraftCard({
    kernel: createKernel(args.supabase),
    clientId: args.clientId,
    clicker: { kind: 'agent', email: null },
    draft: args.draft,
    accountLabel: context.accountLabel,
    review: context.review,
  })
  return { runId: card.runId }
}
