/**
 * Meta 的真实返回 → 回读闸门的入参。
 *
 * 为什么单独一个适配器：`launch-readback.ts` 是纯规则，不该知道 Meta 的字段长什么样；
 * 而 Meta 的形状有一堆**只有拿真数据才会发现的坑**（下面每一条都是 2026-08-04
 * 拉真实账号数据时撞到的，不是照文档猜的）：
 *
 *   1. `targeting_automation.advantage_audience` 是 **0 / 1 数字**，不是布尔。
 *      写 `if (t.advantage_audience)` 看起来对，但类型是 number —— 直接塞进
 *      boolean 字段会静默过 TS（any 边界）然后行为正确、类型说谎。
 *   2. 没有受众名单时，`custom_audiences` **整个字段不存在**，不是 `[]`。
 *      判「有没有挂名单」必须用「字段在不在 + 数组空不空」两层，只判长度会
 *      把「没配」和「配了空」混成一件事。
 *   3. `targeting_relaxation_types` 同样可能整个缺失 —— 缺失 ≠ 关闭。
 *      Meta 不返回它时到底是什么行为，官方没写死；**所以缺失一律按「不确定」
 *      处理，不当成安全**。
 *   4. `expanded_implicit_custom_audiences` 只在 Meta 真的补挂了相似人群时才出现，
 *      **创建接口的回显里永远没有它**。这正是必须回读的核心理由。
 *
 * 纯函数、不联网。取数在调用方。
 */

import type { AdSetReadback, CreativeReadback, LaunchReadbackInput } from './launch-readback'

/** Meta 回读到的原始 targeting（只声明我们要用的部分，其余忽略）。 */
export interface RawMetaTargeting {
  geo_locations?: {
    regions?: { name?: unknown }[]
    cities?: { name?: unknown }[]
    countries?: unknown[]
  }
  custom_audiences?: { id?: unknown; name?: unknown }[]
  expanded_implicit_custom_audiences?: { id?: unknown }[]
  targeting_relaxation_types?: { custom_audience?: unknown; lookalike?: unknown }
  targeting_automation?: { advantage_audience?: unknown }
}

export interface RawMetaAdSet {
  id: string
  name?: unknown
  optimization_goal?: unknown
  /** MESSENGER / WHATSAPP / WEBSITE / ON_VIDEO… 缺失就是没回读到，别当成不是私信。 */
  destination_type?: unknown
  targeting?: RawMetaTargeting
}

/** 一条广告的买家可见文案，由调用方从 creative 里摘出来。 */
export interface RawMetaAdCreative {
  adId: string
  adName?: unknown
  /** 正文 / 标题 / 描述 / 聊天模板问候语 / 建议回复按钮 —— 有几条给几条。 */
  texts: (string | null | undefined)[]
}

/** Meta 的 0/1 → 布尔。**缺失返回 undefined，不是 false** —— 见文件头第 3 条。 */
function flag(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true'
  return undefined
}

function strList(xs: unknown[] | undefined, pick: (x: unknown) => unknown): string[] {
  if (!Array.isArray(xs)) return []
  return xs
    .map(pick)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function geoNames(t: RawMetaTargeting | undefined): string[] {
  const g = t?.geo_locations
  if (!g) return []
  return [
    ...strList(g.regions, (r) => (r as { name?: unknown })?.name),
    ...strList(g.cities, (c) => (c as { name?: unknown })?.name),
    ...strList(g.countries, (c) => c),
  ]
}

/**
 * 名字里像不像在说「我是重定向」。
 *
 * **这是启发式，不是事实。** 跟 play-vocabulary 的名字解析同一条规矩：名字有多套
 * 规范、会被事后改写。它的唯一用途是**触发更严的检查**（宁可多问一句），
 * 而不是用来给广告组下定义。
 *
 * 反过来看它是安全的：猜错成「是重定向」→ 多几条提醒；猜错成「不是」→
 * 少查几项。所以宁可宽松命中。
 */
export function nameClaimsRetargeting(name: string | null | undefined): boolean {
  return /重定向|暖池|热池|retarget|remarket|warm.?pool|custom.?audience/i.test(String(name ?? ''))
}

export interface AdaptOptions {
  /** 房源/客户所在地区，用于对照投放地区。给不出就跳过那条检查。 */
  expectedGeo?: string | null
  /**
   * 显式声明这个广告组是不是重定向。给了就用，不给才退回名字启发式。
   * 建广告走 ME 入口时应该显式给 —— 那一刻是知道的。
   */
  isRetargeting?: boolean
}

/**
 * Meta 原始返回 → 闸门入参。
 *
 * 缺字段一律**如实反映为 undefined**，不填默认值。规则那边会把 undefined 当
 * 「不确定」处理，而不是当「安全」。
 */
export function adaptMetaAdSet(
  raw: RawMetaAdSet,
  creatives: readonly RawMetaAdCreative[],
  opts: AdaptOptions = {},
): LaunchReadbackInput {
  const t = raw.targeting

  const adSet: AdSetReadback = {
    adSetId: raw.id,
    adSetName: typeof raw.name === 'string' ? raw.name : raw.id,
    optimizationGoal: typeof raw.optimization_goal === 'string' ? raw.optimization_goal : '',
    // 空串也算没拿到 —— 传下去会被当成一个真实的「非私信落点」。
    destinationType:
      typeof raw.destination_type === 'string' && raw.destination_type.trim().length > 0
        ? raw.destination_type
        : undefined,
    targeting: {
      customAudienceRelaxed: flag(t?.targeting_relaxation_types?.custom_audience),
      advantageAudience:     flag(t?.targeting_automation?.advantage_audience),
      customAudienceIds:     strList(t?.custom_audiences, (a) => (a as { id?: unknown })?.id),
      implicitLookalikeIds:  strList(t?.expanded_implicit_custom_audiences, (a) => (a as { id?: unknown })?.id),
      geoNames:              geoNames(t),
    },
    creatives: creatives.map<CreativeReadback>((c) => ({
      adId: c.adId,
      adName: typeof c.adName === 'string' ? c.adName : c.adId,
      buyerFacingText: c.texts.filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0,
      ),
    })),
  }

  return {
    adSet,
    claimsRetargeting: opts.isRetargeting ?? nameClaimsRetargeting(adSet.adSetName),
    expectedGeo: opts.expectedGeo ?? null,
  }
}
