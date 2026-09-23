/**
 * 广告支柱 IMPACT 闭环 · 阶段 2 · 内核注册（P21.K）—— capability 装配。
 *
 * 🔴 本文件只做装配：把 `kernel/registry.ts` 里已经注册的四个广告动作的
 *    `version` / `steps` 接到骨架实现（`not-implemented.ts`）上，
 *    满足 `architecture.test.ts`「注册表的封闭性」要求的
 *    `createCapabilities()` 实现集合 === `ACTION_KEYS` 这道闸。
 *
 *    真实执行逻辑（K8-K12）由 PR-B/PR-C 替换掉这里的骨架，装配方式不变。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionKey, CapabilityImplementation } from '@/lib/kernel/types'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { createNotYetImplementedAdsCapability } from './not-implemented'

const ADS_ACTION_KEYS = [
  'ads.budget_move_plan',
  'ads.add_retargeting_adset',
  'ads.create_audience',
  'ads.pause',
] as const satisfies readonly ActionKey[]

/** 每个 capability 都需要一个注入进来的 supabase 客户端，跟其余 capability 装配方式一致。 */
export function createAdsCapabilities(
  _sb: SupabaseClient,
): Readonly<Record<string, CapabilityImplementation>> {
  const out: Record<string, CapabilityImplementation> = {}
  for (const key of ADS_ACTION_KEYS) {
    // 🔴 注册表已经保证这四个 key 一定存在（类型层封闭）；防御性判空只是
    //    避免注册表与装配之间将来漂移时静默丢一个动作。
    const definition = ACTION_REGISTRY.get(key)
    if (!definition) continue
    out[key] = createNotYetImplementedAdsCapability(key, definition.version, definition.steps)
  }
  return out
}
