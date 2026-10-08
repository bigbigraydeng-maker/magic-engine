/**
 * Factory Reel → 自动起草一条「暂停的」Facebook 广告（Inngest 接线）。
 *
 * 消费 `me/factory.reel.published`，把事件交给 run.ts 的编排核心。
 * 真正的 I/O 全部在 real-deps.ts；本文件只负责声明函数、把依赖在
 * handler 内部构造好、并把未捕获的失败落成一张回执 + 一条待办。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { FACTORY_REEL_PUBLISHED_EVENT } from '@/lib/factory/publish/reel-published-event'
import { runFactoryReelAdDraft, type RunOutcome } from '@/lib/ads-strategy/factory-reel-draft/run'
import { buildRunDeps } from '@/lib/ads-strategy/factory-reel-draft/real-deps'
import { recordUnhandledFailure } from '@/lib/ads-strategy/factory-reel-draft/on-failure'

export const FACTORY_REEL_AD_DRAFT_FN_ID = `${CLOUD_FN_PREFIX}factory-reel-ad-draft`

export function createFactoryReelAdDraftFunction(deps: { getSupabase: () => SupabaseClient }) {
  return inngest.createFunction(
    {
      id: FACTORY_REEL_AD_DRAFT_FN_ID,
      name: 'Factory Reel: auto-draft a PAUSED ad',
      // 自动重试在这里没有意义：意图行才是幂等锚点，重试可能重复写 Meta；
      // 失败会落成一张回执 + 一条待办，由人来处理。
      retries: 0,
      concurrency: { limit: 1, key: 'event.data.client_id' },
      onFailure: async ({ event, error }) => {
        const nested = (event.data as { event?: { data?: unknown } } | undefined)?.event?.data
        try {
          const r = await recordUnhandledFailure(
            deps.getSupabase(),
            nested,
            error,
            new Date().toISOString(),
          )
          if (!r.ok) {
            console.error('[factory-reel-ad-draft] onFailure receipt not written', r.reason)
          }
        } catch (e) {
          console.error('[factory-reel-ad-draft] onFailure receipt write threw', e)
        }
      },
    },
    { event: FACTORY_REEL_PUBLISHED_EVENT },
    async ({ event, step }): Promise<RunOutcome> =>
      step.run('run-pipeline', () =>
        runFactoryReelAdDraft(buildRunDeps(deps.getSupabase()), event.data),
      ),
  )
}

export const factoryReelAdDraft = createFactoryReelAdDraftFunction({ getSupabase: () => supabaseAdmin })
