/**
 * 受治理的「候选身份 → ActionKey」配对表。
 *
 * 🔴 **当前是空的，而且这是刻意的。**
 *    没有真实调用方之前不预注册任何 GEO / Page / SEO 动作 ——
 *    预注册等于把「将来大概会用到」写成「现在已经批准了」。
 *    WP05 / WP07 带着真实调用方来的时候在这里加一行，
 *    且右边那个 ActionKey 必须**已经**在注册表里存在（类型层就挡住了编造）。
 *
 * 🔴 **逐项精确比对，不拼字符串。**
 *    早先设计用 `${domain}:${intent}` 当键，那样
 *    `{domain:'geo:x', intent:'y'}` 和 `{domain:'geo', intent:'x:y'}`
 *    会撞成同一个键 —— 一个分隔符就能让两个不同的候选映射到同一个动作。
 *    数组 + 两个字段各自 `===`：既没有分隔符碰撞，也没有对象键的原型链问题
 *    （`registry.ts` 用 `hasOwnProperty` 防的是同一类事）。
 */

import type { ActionKey } from '@/lib/kernel/types'

export interface CandidateMappingEntry {
  readonly domain: string
  readonly intent: string
  /** 🔴 只能是注册表里真实存在的 key —— 类型层封闭，编不出新的。 */
  readonly actionKey: ActionKey
}

export const MAPPING_TABLE: readonly CandidateMappingEntry[] = [
  // GEO Module (WP05) → Page Optimization Apply (v1).
  // spec: docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md §12
  {
    domain: 'geo',
    intent: 'optimize_page_answerability',
    actionKey: 'page.apply_optimization_request',
  },
  {
    domain: 'social',
    intent: 'publish_approved_post',
    actionKey: 'social.schedule_approved_post',
  },
]
