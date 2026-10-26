/**
 * 诸葛亮产 action.type 的封闭词汇表 —— 不认识的 action 不进 execution_items。
 *
 * 为什么要这个：
 *   执行看板上 2026-08-05 积压 281 条、最后一次「完成」停在 15 天前。调查显示
 *   LLM 临场编了没有执行器的 slug（例如 `launch_google_search_ads_3pl`、
 *   `configure_target_keywords`），写进 execution_items 后永远卡在 pending ——
 *   auto-run 看它不在白名单直接跳过，没人收口、也没人删，看板从此只增不减。
 *   这就是「自动执行空转」的根因之一（Grok Bot #3075 对本窗口 10-26 重做）。
 *
 * 判定来源 —— 两个权威源的并集，任一收录即算 known：
 *   1. `@/lib/flywheel/vocabulary` 的 GEO/SEO/ADS/SOCIAL 四个 flywheel action key
 *   2. `@/lib/kernel/registry` 的 Kernel 已注册 action
 *
 * 不维护硬编码白名单：所有可执行能力都已在上述两处登记，词汇表自动跟系统能力
 * 同步，新增能力无需来这里改一行。
 *
 * 作用面只在 `writeExecutionItems`（诸葛亮直产 top_actions 入看板的通道）。
 * SEO weekly list / patrol / FDE / Luban 各有自己的入口，不走这里，所以本
 * 词汇表的拒绝不会误伤那些工作流。
 */

import {
  ADS_ACTION_TYPE,
  GEO_ACTION_TYPE,
  SEO_ACTION_TYPE,
  SOCIAL_ACTION_TYPE,
} from '@/lib/flywheel/vocabulary'
import { ACTION_KEYS, ACTION_REGISTRY } from '@/lib/kernel/registry'

const FLYWHEEL_ACTION_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.values(GEO_ACTION_TYPE),
  ...Object.values(SEO_ACTION_TYPE),
  ...Object.values(ADS_ACTION_TYPE),
  ...Object.values(SOCIAL_ACTION_TYPE),
])

/** `true` 表示系统里有执行器（或指标采集器）接得住这个 action.type。
 *
 * 严格字面匹配——不 trim、不 case-fold。原因：下游 execution_items 以原样
 * 字串做 dedup key，一旦这里"宽容"接收 '  seo.publish_blog  '，看板里就会
 * 出现带空格的 action_type 行，无法跟干净版本去重。
 */
export function isKnownActionType(actionType: unknown): boolean {
  if (typeof actionType !== 'string') return false
  if (actionType.length === 0) return false
  if (FLYWHEEL_ACTION_TYPES.has(actionType)) return true
  return ACTION_REGISTRY.has(actionType)
}

/** 已登记的 action.type 全集，排序后返回 —— 用于诊断日志、prompt 注入。 */
export function knownActionTypes(): readonly string[] {
  const union = new Set<string>(FLYWHEEL_ACTION_TYPES)
  for (const key of ACTION_KEYS) union.add(key)
  return Array.from(union).sort()
}
