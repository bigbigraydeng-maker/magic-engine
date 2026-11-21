/** Real Graph and database wiring for `daily-plan-promote.ts`. Reads only. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getStoredPageToken } from '@/lib/meta/token-manager'
import { readPageStoryId } from '@/lib/meta/page-posts'
import { loadPromotionTarget } from '@/lib/winner-reel-sync/engine'
import {
  checkDailyPlanPromotion,
  supabasePromoteDeps,
  type PromoteCheck,
} from './daily-plan-promote'

async function readStoryId(clientId: string, pageId: string, photoId: string): Promise<string | null> {
  const token = await getStoredPageToken(clientId, pageId)
  if (!token) return null
  const read = await readPageStoryId({ photoId, pageId, pageAccessToken: token })
  return read.ok ? read.postId : null
}

export function checkDailyPlanPromotionLive(
  sb: SupabaseClient,
  input: { clientId: string; planId: string; date: string },
): Promise<PromoteCheck> {
  return checkDailyPlanPromotion(supabasePromoteDeps(sb, { readStoryId, target: loadPromotionTarget }), input)
    .catch((error: unknown) => ({ ok: false as const, reason: `核对帖子出错：${error instanceof Error ? error.message : String(error)}` }))
}
