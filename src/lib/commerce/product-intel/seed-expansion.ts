/**
 * 种子词扩展 —— 把「几个套利方向」自动长成一批可溯源的种子词。
 *
 * 🔴 **种子词不是拍脑袋编的。** 每个方向只给几个公开品类名当**入口锚点**
 *    （胎压泵、狗碗这种行业常识，不是客户业务数据），真正的种子词由 DataForSEO
 *    的 keyword_ideas 数据长出来，且**每个都带真实 NZ 搜索量**才留下 ——
 *    编错了锚点，长出来的词也会被搜索量过滤掉，不会污染选品。
 *
 * 🔴 这一层只负责「把方向变成一批词」，不做任何选品判断。判定仍在 score.ts，
 *    每个种子词照样要走完五道闸。扩词只是把漏斗的**入口**从 16 个撑到上百个。
 *
 * 分工同 local-price：纯逻辑（过滤/去重/溯源）在这里，调 API 的编排在
 * scripts/commerce-expand-seeds.ts。这里一行 fetch 都没有。
 */

import type { LabsKeyword } from '@/lib/dataforseo/labs'

/** 四个套利方向 —— PM 2026-08-16 拍板的铺词范围。 */
export type ArbitrageDirection =
  | 'auto_accessories'   // 汽配：轻小件、有本地零售价锚点
  | 'phone_tech'         // 3C 配件
  | 'pet'                // 宠物
  | 'home_gadgets'       // 家居小电

/** 一个入口锚点。`verified` 标记它是不是已经跑通过的赢家。 */
interface Anchor {
  readonly keyword: string
  /** 是不是 2026-08-16 已验证能打的品 —— 优先从赢家长词，最相关。 */
  readonly verified: boolean
}

/**
 * 方向 → 入口锚点。**这些是公开品类名，不是判据** ——
 * 只决定「往哪个方向问 DataForSEO」，最终种子词由数据 + 搜索量决定。
 * 已验证赢家（verified）打头，保证每个方向至少从一个真实信号出发。
 */
export const EXPANSION_ANCHORS: Record<ArbitrageDirection, readonly Anchor[]> = {
  auto_accessories: [
    { keyword: 'jump starter power bank', verified: true },  // 搭电宝一体机 ✓
    { keyword: 'tyre inflator portable', verified: true },   // 车载胎压泵 ✓
    { keyword: 'car vacuum cleaner cordless', verified: false },
    { keyword: 'dash cam', verified: false },
  ],
  phone_tech: [
    { keyword: 'portable blender', verified: false },
    { keyword: 'wireless charger', verified: false },
    { keyword: 'phone tripod', verified: false },
    { keyword: 'neck fan portable', verified: false },
  ],
  pet: [
    { keyword: 'slow feeder dog bowl', verified: false },
    { keyword: 'pet water fountain', verified: false },
    { keyword: 'dog nail grinder', verified: false },
    { keyword: 'cat litter mat', verified: false },
  ],
  home_gadgets: [
    { keyword: 'electric screwdriver precision', verified: true }, // 电动螺丝刀 ✓
    { keyword: 'handheld vacuum', verified: false },
    { keyword: 'mini humidifier', verified: false },
    { keyword: 'led strip lights', verified: false },
  ],
}

/**
 * 品牌 deny-list —— 选品要的是能自己做的**白牌品类词**，不是去卖别人的品牌。
 *
 * "Ninja portable blender" 这种词背后是别人的产品，我们进不去；
 * "portable blender" 才是能自己找货源做的。含品牌的词一律剔除。
 * 不全没关系 —— 漏网的品牌词后面在 TikTok / 供货端还会再暴露一次。
 */
const BRAND_DENYLIST: ReadonlySet<string> = new Set([
  'ninja', 'xiaomi', 'dyson', 'makita', 'dewalt', 'bosch', 'baseus',
  'anker', 'nutribullet', 'shark', 'philips', 'samsung', 'apple', 'iphone',
  'ryobi', 'milwaukee', 'karcher', 'breville', 'kmart', 'astroai',
  'fanttik', 'petkit', 'catit', 'lickimat', 'eufy',
  // 零售商名 —— keyword_ideas 会把它们当"相关词"混进来（实测 2026-08-16）。
  'pb', 'bulbs', 'wrights',
])

/**
 * 非套利词根 —— 耗材 / 配件 / 会被锚词带偏的大类泛化词。**不是耐用套利品。**
 *
 * 实测（2026-08-16）keyword_ideas 从锚词往外扩时，会顺着语义爬到耗材和大类：
 * "jump starter" → "aa battery" / "lithium battery"（电池是耗材）；
 * "led strip lights" → "light bulb" / "led lights"（灯泡红海）；
 * "pet water fountain" → "water garden"（园艺，跑偏）。这些一律剔除。
 */
const NON_ARBITRAGE_ROOTS: ReadonlySet<string> = new Set([
  'battery', 'batteries', 'cable', 'litter', 'bulb', 'bulbs',
  'light', 'lights', 'led', 'garden', 'camera', 'cameras',
  // 2026-08-17 50 词实测新增：整词错品类，比值校验抓不到（美国本地同为错品类），
  // 只能在种子词层面剔。bathroom/exhaust → 装修排气扇；trough → 牲畜水槽/集雨桶。
  'bathroom', 'exhaust', 'trough',
])

/** 一个带来源的种子词 —— 能追到「哪个方向、从哪个锚点长的、搜索量多少」。 */
export interface SeedKeyword {
  readonly keyword: string
  readonly direction: ArbitrageDirection
  /** 从哪个锚点扩出来的。 */
  readonly anchor: string
  /** NZ 月搜索量（DataForSEO keyword_ideas 返回值）。 */
  readonly searchVolumeNz: number | null
  readonly cpcUsd: number | null
}

export interface FilterOptions {
  /** 搜索量下限。低于此的扩展词不进种子池（呼应判定的 100 合计下限）。 */
  readonly minSearchVolume: number
  /**
   * 搜索量上限 —— **粗筛砍红海用**。
   *
   * 🔴 反直觉但关键：本地搜索量越高，越可能是成熟红海（vacuum cleaner 月搜 12100、
   *    led lights 5400），轮不到我们。套利机会在**中等搜索量的外溢需求**：
   *    已验证赢家搭电宝 NZ 才 2400、胎压泵 590。所以高于上限的一律先剔。
   *    这是粗筛不是判据 —— 砍明显红海即可，漏网的大件后面 TikTok 关还会再筛
   *    （大件在 TikTok US 卖不动、运费也不成立）。
   */
  readonly maxSearchVolume: number
  /** 词数上限 —— 超过就是长尾问句/超细规格，不是品类词。 */
  readonly maxWords: number
}

export const DEFAULT_FILTER: FilterOptions = {
  minSearchVolume: 50,
  maxSearchVolume: 3000,
  maxWords: 5,
}

const QUESTION_STARTER =
  /^(who|what|where|when|why|how|can|is|are|does|do|will|should|which)\b/i

function containsBrand(keyword: string): boolean {
  const words = keyword.toLowerCase().split(/\s+/)
  return words.some((w) => BRAND_DENYLIST.has(w))
}

function hasNonArbitrageRoot(keyword: string): boolean {
  const words = keyword.toLowerCase().split(/\s+/)
  return words.some((w) => NON_ARBITRAGE_ROOTS.has(w))
}

/**
 * 一个锚点扩出来的 ideas → 该方向的种子词。
 *
 * 过滤顺序（都会剔除，不是打分）：
 *   1. 空词 / 问句（不是品类词）
 *   2. 含品牌 / 零售商名（进不去）
 *   3. 耗材 / 大类泛化词根（不是耐用套利品）
 *   4. 词数超上限（长尾规格）
 *   5. 搜索量取不到、低于下限、或高于上限（红海）
 */
export function ideasToSeeds(
  direction: ArbitrageDirection,
  anchor: string,
  ideas: readonly LabsKeyword[],
  opts: FilterOptions = DEFAULT_FILTER,
): SeedKeyword[] {
  const out: SeedKeyword[] = []
  for (const idea of ideas) {
    const keyword = idea.keyword?.trim()
    if (!keyword || QUESTION_STARTER.test(keyword)) continue
    if (containsBrand(keyword) || hasNonArbitrageRoot(keyword)) continue
    if (keyword.split(/\s+/).length > opts.maxWords) continue
    const vol = idea.search_volume
    if (vol === null || vol === undefined) continue
    if (vol < opts.minSearchVolume || vol > opts.maxSearchVolume) continue
    out.push({
      keyword,
      direction,
      anchor,
      searchVolumeNz: vol,
      cpcUsd: idea.cpc ?? null,
    })
  }
  return out
}

/**
 * 合并所有方向的种子词：**跨方向去重** + 每方向按搜索量取 top N。
 *
 * 去重规则：同一个词可能从多个锚点长出来（"car air compressor" 既在
 * "tyre inflator" 也在 "jump starter" 的 ideas 里）—— 只留搜索量最高的那条，
 * 保住它第一次出现的方向归属，避免同一个词被扫两遍白花钱。
 */
export function consolidateSeeds(
  seeds: readonly SeedKeyword[],
  perDirectionCap: number,
): SeedKeyword[] {
  // 先按词去重，留搜索量最高的一条。
  const bestByKeyword = new Map<string, SeedKeyword>()
  for (const seed of seeds) {
    const key = seed.keyword.toLowerCase()
    const existing = bestByKeyword.get(key)
    if (!existing || (seed.searchVolumeNz ?? 0) > (existing.searchVolumeNz ?? 0)) {
      bestByKeyword.set(key, seed)
    }
  }

  // 按方向分组，每组按搜索量降序取 top N。
  const byDirection = new Map<ArbitrageDirection, SeedKeyword[]>()
  for (const seed of Array.from(bestByKeyword.values())) {
    const list = byDirection.get(seed.direction) ?? []
    list.push(seed)
    byDirection.set(seed.direction, list)
  }

  const result: SeedKeyword[] = []
  for (const list of Array.from(byDirection.values())) {
    list.sort((a: SeedKeyword, b: SeedKeyword) =>
      (b.searchVolumeNz ?? 0) - (a.searchVolumeNz ?? 0))
    result.push(...list.slice(0, perDirectionCap))
  }
  return result
}
