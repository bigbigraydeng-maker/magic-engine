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

/**
 * `runFactoryReelAdDraft` 从不抛错，所以「在建意图行之前就失败」的情况
 * （意图行都没能认领，或认领前发生意外错误）会让 Inngest 函数「成功」结束，
 * `onFailure` 永远不会跑，失败既没有回执也没有待办。
 *
 * 这个纯函数把这种「静默失败」转成真正的异常，让调用方在 step 之外抛出，
 * 从而触发 `onFailure`（retries 仍为 0）。
 */
export function throwIfSilentFailure(outcome: RunOutcome): void {
  if (outcome.recordError) {
    console.error('[factory-reel-ad-draft] 意图行收尾没写进去', outcome.recordError)
  }
  if (outcome.status === 'failed' && outcome.intentActionId === null) {
    const detail = [outcome.blockCode, outcome.message].filter(Boolean).join('：')
    throw new Error(`工厂 Reel 自动起草在建意图行之前就失败了：${detail}`)
  }
}

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
    async ({ event, step }): Promise<RunOutcome> => {
      const outcome = await step.run('run-pipeline', () =>
        runFactoryReelAdDraft(buildRunDeps(deps.getSupabase()), event.data),
      )
      // 在 step 之外抛出，onFailure 才会跑（retries 保持 0）。
      throwIfSilentFailure(outcome)
      return outcome
    },
  )
}

export const factoryReelAdDraft = createFactoryReelAdDraftFunction({ getSupabase: () => supabaseAdmin })
