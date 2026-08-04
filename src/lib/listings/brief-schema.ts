/**
 * 房子档案的**形状校验** —— AI 出的 draft 和人手改的 PATCH 都必须过这里。
 *
 * 为什么必须有这一层(而不是信 AI / 信前端):
 *
 * 1. **模型会编枚举**。提示词里写死了可选值,模型照样偶尔吐一个
 *    'renovation_potential' 这种看着挺合理的新词。放进去的后果不是报错,
 *    是**聚合悄悄失效** —— 20 套房里 3 套用了近义词,「投资客这条线贵不贵」
 *    的分母就错了,而且错得没有任何提示。所以非法枚举一律**拒绝整份 draft**,
 *    不静默丢弃(丢弃 = 人以为 AI 没想到,实际是被吃掉了)。
 *
 * 2. **数字必须有出处**。ME 因为编数字出过两次事故(CTS 编行程 / Oztop 编搜索量)。
 *    地产的中位价和租金回报是中介**会拿去跟卖家谈**的数,编一个比不填危险得多。
 *    所以 market_snapshot 里任何一个数,没有 source 就是非法 —— 查不到应该进
 *    gaps,不是估一个。这条在代码里是硬闸门,不是提示词里的一句请求。
 *
 * 3. **前端下拉只是方便**。真正的闸门在这:直接 curl 打 API、以后多一个调用方
 *    (批量导入 / agent 自动建档)绕过前端,绕不过这里。
 *
 * 纯函数、无 IO,所以能被单元测试直接打(变异测试的主要目标就是本文件的 guard)。
 */

import {
  isBuyerSegment,
  isListingAngle,
  isListingHesitation,
  isBriefSourceKind,
  isListingBriefVerdict,
  BUYER_SEGMENTS,
  LISTING_ANGLES,
  LISTING_HESITATIONS,
  BRIEF_SOURCE_KINDS,
  LISTING_BRIEF_VERDICTS,
  type BuyerSegment,
  type ListingAngle,
  type ListingHesitation,
  type BriefSourceKind,
  type ListingBriefVerdict,
} from './brief-constants'

// ── 类型 ──────────────────────────────────────────────────────────────────────

/** 一个带出处的数字。source 空 = 非法(见文件头第 2 条)。 */
export interface SourcedNumber {
  value: number
  source: string
}

export interface Comparable {
  address: string
  price: number | null
  sold_on: string | null
  source: string
}

export interface MarketSnapshot {
  median_price: SourcedNumber | null
  yoy_change_pct: SourcedNumber | null
  rental_yield: SourcedNumber | null
  area_avg_yield: SourcedNumber | null
  comparables: Comparable[]
}

export interface AngleRankingItem {
  angle: ListingAngle
  rank: number
  rationale: string | null
}

export interface UnitVariant {
  label: string
  size_sqm: number | null
  config: string | null
  target_segments: BuyerSegment[]
}

export interface BriefFacts {
  price_method: string | null
  completion_status: string | null
  school_zone: string | null
  nearby: string[]
  vendor_motivation: string | null
}

/** 逐条来源标记。field 是被标注的字段路径,如 'market_snapshot.median_price'。 */
export interface BriefSourceEntry {
  field: string
  kind: BriefSourceKind
  url: string | null
  note: string | null
}

export interface BriefOutcomes {
  actual_segments: BuyerSegment[]
  winning_angle: ListingAngle | null
  cost_per_qualified: number | null
  notes: string | null
}

/** 一份档案的全部内容字段(不含 id / version / status 这些外壳)。 */
export interface ListingBriefContent {
  buyer_segments: BuyerSegment[]
  angle_ranking: AngleRankingItem[]
  hesitations: ListingHesitation[]
  unit_variants: UnitVariant[]
  market_snapshot: MarketSnapshot
  facts: BriefFacts
  gaps: string[]
  sources: BriefSourceEntry[]
}

/** PATCH 能改的东西:内容字段的任意子集,外加回填两栏。 */
export interface ListingBriefPatch extends Partial<ListingBriefContent> {
  outcomes?: BriefOutcomes
  verdict?: ListingBriefVerdict
}

export type SchemaResult<T> = { ok: true; value: T } | { ok: false; error: string }

// ── 上限(防「粘贴整篇文档」)──────────────────────────────────────────────────

const MAX_TEXT = 600
const MAX_LONG_TEXT = 2000
const MAX_ARRAY = 30
const MAX_URL = 1000

function fail<T>(error: string): SchemaResult<T> {
  return { ok: false, error }
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

/** 文本:空串一律当 null(不存 ''),超长报错而不是截断(截断会悄悄改掉人写的东西)。 */
function text(v: unknown, field: string, max = MAX_TEXT): SchemaResult<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (typeof v !== 'string') return fail(`${field} 必须是文本`)
  const t = v.trim()
  if (t === '') return { ok: true, value: null }
  if (t.length > max) return fail(`${field} 太长(最多 ${max} 个字符)`)
  return { ok: true, value: t }
}

function requiredText(v: unknown, field: string, max = MAX_TEXT): SchemaResult<string> {
  const r = text(v, field, max)
  if (!r.ok) return r
  if (!r.value) return fail(`${field} 不能为空`)
  return { ok: true, value: r.value }
}

function finiteNumber(v: unknown, field: string): SchemaResult<number | null> {
  if (v === null || v === undefined || v === '') return { ok: true, value: null }
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fail(`${field} 必须是数字`)
  return { ok: true, value: n }
}

/**
 * 枚举数组的统一处理。
 *
 * 🔴 变异测试目标:把 guard 换成 () => true,`brief-schema.test.ts` 里
 * 「非法取值必须被拒绝」那一批用例必须全部变红。
 */
function enumArray<T extends string>(
  v: unknown,
  field: string,
  guard: (x: unknown) => x is T,
  allowed: readonly string[],
): SchemaResult<T[]> {
  if (v === null || v === undefined) return { ok: true, value: [] }
  if (!Array.isArray(v)) return fail(`${field} 必须是一个数组`)
  if (v.length > MAX_ARRAY) return fail(`${field} 最多 ${MAX_ARRAY} 项`)
  const out: T[] = []
  for (const item of v) {
    if (!guard(item)) {
      return fail(`${field} 里有不认识的取值「${String(item)}」(只能是:${allowed.join(' / ')})`)
    }
    if (!out.includes(item)) out.push(item)   // 去重:同一个值写两遍不该让聚合翻倍
  }
  return { ok: true, value: out }
}

// ── 市场快照(数字必须带出处)──────────────────────────────────────────────────

function sourcedNumber(v: unknown, field: string): SchemaResult<SourcedNumber | null> {
  if (v === null || v === undefined) return { ok: true, value: null }
  const obj = asObject(v)
  if (!obj) return fail(`${field} 必须是 { value, source } 的形状`)

  const n = finiteNumber(obj.value, `${field}.value`)
  if (!n.ok) return n
  if (n.value === null) return { ok: true, value: null }

  // 🔴 这一句就是「绝不编数字」的闸门。数字有值但没出处 → 整份拒绝,
  //    不允许「先存着回头补出处」——回头没人补,数字就变成了事实。
  const src = requiredText(obj.source, `${field}.source`, MAX_URL)
  if (!src.ok) {
    return fail(`${field} 有数字但没有出处 —— 查不到就写进 gaps,不要估一个数`)
  }
  return { ok: true, value: { value: n.value, source: src.value } }
}

function comparables(v: unknown): SchemaResult<Comparable[]> {
  if (v === null || v === undefined) return { ok: true, value: [] }
  if (!Array.isArray(v)) return fail('market_snapshot.comparables 必须是一个数组')
  if (v.length > MAX_ARRAY) return fail(`可比案例最多 ${MAX_ARRAY} 条`)

  const out: Comparable[] = []
  for (const raw of v) {
    const obj = asObject(raw)
    if (!obj) return fail('每条可比案例必须是一个对象')
    const address = requiredText(obj.address, '可比案例的地址')
    if (!address.ok) return address
    const source = requiredText(obj.source, `可比案例「${address.value}」的出处`, MAX_URL)
    if (!source.ok) {
      return fail(`可比案例「${address.value}」没有出处 —— 没出处的成交价不能进档案`)
    }
    const price = finiteNumber(obj.price, '可比案例的成交价')
    if (!price.ok) return price
    const soldOn = text(obj.sold_on, '可比案例的成交日期', 40)
    if (!soldOn.ok) return soldOn
    out.push({ address: address.value, price: price.value, sold_on: soldOn.value, source: source.value })
  }
  return { ok: true, value: out }
}

export function normalizeMarketSnapshot(v: unknown): SchemaResult<MarketSnapshot> {
  const empty: MarketSnapshot = {
    median_price: null, yoy_change_pct: null, rental_yield: null,
    area_avg_yield: null, comparables: [],
  }
  if (v === null || v === undefined) return { ok: true, value: empty }
  const obj = asObject(v)
  if (!obj) return fail('market_snapshot 必须是一个对象')

  const keys = ['median_price', 'yoy_change_pct', 'rental_yield', 'area_avg_yield'] as const
  const out = { ...empty }
  for (const k of keys) {
    const r = sourcedNumber(obj[k], `market_snapshot.${k}`)
    if (!r.ok) return r
    out[k] = r.value
  }
  const comps = comparables(obj.comparables)
  if (!comps.ok) return comps
  out.comparables = comps.value
  return { ok: true, value: out }
}

// ── 卖点排序 / 户型 / 事实 / 来源 ─────────────────────────────────────────────

export function normalizeAngleRanking(v: unknown): SchemaResult<AngleRankingItem[]> {
  if (v === null || v === undefined) return { ok: true, value: [] }
  if (!Array.isArray(v)) return fail('angle_ranking 必须是一个数组')
  if (v.length > MAX_ARRAY) return fail(`卖点最多 ${MAX_ARRAY} 条`)

  const out: AngleRankingItem[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    const obj = asObject(raw)
    if (!obj) return fail('每条卖点必须是一个对象')
    if (!isListingAngle(obj.angle)) {
      return fail(`卖点里有不认识的取值「${String(obj.angle)}」(只能是:${LISTING_ANGLES.join(' / ')})`)
    }
    // 同一个卖点排两次,「第一该打的是哪条」就没有答案了。
    if (seen.has(obj.angle)) return fail(`卖点「${obj.angle}」重复了`)
    seen.add(obj.angle)

    const rank = finiteNumber(obj.rank, '卖点的排序')
    if (!rank.ok) return rank
    if (rank.value === null || !Number.isInteger(rank.value) || rank.value < 1) {
      return fail('卖点的排序必须是 1 起的整数')
    }
    const rationale = text(obj.rationale, '卖点的理由', MAX_LONG_TEXT)
    if (!rationale.ok) return rationale
    out.push({ angle: obj.angle, rank: rank.value, rationale: rationale.value })
  }
  return { ok: true, value: out.sort((a, b) => a.rank - b.rank) }
}

export function normalizeUnitVariants(v: unknown): SchemaResult<UnitVariant[]> {
  if (v === null || v === undefined) return { ok: true, value: [] }
  if (!Array.isArray(v)) return fail('unit_variants 必须是一个数组')
  if (v.length > MAX_ARRAY) return fail(`户型最多 ${MAX_ARRAY} 个`)

  const out: UnitVariant[] = []
  for (const raw of v) {
    const obj = asObject(raw)
    if (!obj) return fail('每个户型必须是一个对象')
    const label = requiredText(obj.label, '户型的名称')
    if (!label.ok) return label
    const size = finiteNumber(obj.size_sqm, `户型「${label.value}」的面积`)
    if (!size.ok) return size
    if (size.value !== null && size.value <= 0) {
      return fail(`户型「${label.value}」的面积必须大于 0`)
    }
    const config = text(obj.config, `户型「${label.value}」的配置`)
    if (!config.ok) return config
    const segs = enumArray(obj.target_segments, `户型「${label.value}」的买家类型`, isBuyerSegment, BUYER_SEGMENTS)
    if (!segs.ok) return segs
    out.push({ label: label.value, size_sqm: size.value, config: config.value, target_segments: segs.value })
  }
  return { ok: true, value: out }
}

function textArray(v: unknown, field: string, max = MAX_TEXT): SchemaResult<string[]> {
  if (v === null || v === undefined) return { ok: true, value: [] }
  if (!Array.isArray(v)) return fail(`${field} 必须是一个数组`)
  if (v.length > MAX_ARRAY) return fail(`${field} 最多 ${MAX_ARRAY} 项`)
  const out: string[] = []
  for (const item of v) {
    const r = text(item, field, max)
    if (!r.ok) return r
    if (r.value) out.push(r.value)
  }
  return { ok: true, value: out }
}

export function normalizeFacts(v: unknown): SchemaResult<BriefFacts> {
  const empty: BriefFacts = {
    price_method: null, completion_status: null, school_zone: null,
    nearby: [], vendor_motivation: null,
  }
  if (v === null || v === undefined) return { ok: true, value: empty }
  const obj = asObject(v)
  if (!obj) return fail('facts 必须是一个对象')

  const out = { ...empty }
  const singles = ['price_method', 'completion_status', 'school_zone', 'vendor_motivation'] as const
  for (const k of singles) {
    const r = text(obj[k], `facts.${k}`, MAX_LONG_TEXT)
    if (!r.ok) return r
    out[k] = r.value
  }
  const nearby = textArray(obj.nearby, 'facts.nearby')
  if (!nearby.ok) return nearby
  out.nearby = nearby.value
  return { ok: true, value: out }
}

export function normalizeSources(v: unknown): SchemaResult<BriefSourceEntry[]> {
  if (v === null || v === undefined) return { ok: true, value: [] }
  if (!Array.isArray(v)) return fail('sources 必须是一个数组')
  if (v.length > 200) return fail('来源标记最多 200 条')

  const out: BriefSourceEntry[] = []
  for (const raw of v) {
    const obj = asObject(raw)
    if (!obj) return fail('每条来源标记必须是一个对象')
    const field = requiredText(obj.field, '来源标记的字段名')
    if (!field.ok) return field
    if (!isBriefSourceKind(obj.kind)) {
      return fail(`来源标记「${field.value}」的类型不认识(只能是:${BRIEF_SOURCE_KINDS.join(' / ')})`)
    }
    const url = text(obj.url, '来源标记的网址', MAX_URL)
    if (!url.ok) return url
    // 「有出处」却给不出网址,那它就不是有出处 —— 这一档不能靠嘴说。
    if (obj.kind === 'cited' && !url.value) {
      return fail(`来源标记「${field.value}」标成了「有出处」却没给网址`)
    }
    const note = text(obj.note, '来源标记的说明', MAX_LONG_TEXT)
    if (!note.ok) return note
    out.push({ field: field.value, kind: obj.kind, url: url.value, note: note.value })
  }
  return { ok: true, value: out }
}

// ── AI draft 的整体校验 ───────────────────────────────────────────────────────

/**
 * 校验模型吐回来的一整份 draft。
 *
 * 任何一处不合法 → **整份拒绝**,调用方负责记日志 + 告诉人「AI 这次没出对」。
 * 不做部分接受:部分接受会让人对着一份缺了几栏的档案,却以为 AI 就想到这么多。
 */
export function normalizeAiDraft(raw: unknown): SchemaResult<ListingBriefContent> {
  const obj = asObject(raw)
  if (!obj) return fail('AI 返回的内容不是一个对象')

  const segments = enumArray(obj.buyer_segments, 'buyer_segments', isBuyerSegment, BUYER_SEGMENTS)
  if (!segments.ok) return segments
  const angles = normalizeAngleRanking(obj.angle_ranking)
  if (!angles.ok) return angles
  const hesitations = enumArray(obj.hesitations, 'hesitations', isListingHesitation, LISTING_HESITATIONS)
  if (!hesitations.ok) return hesitations
  const variants = normalizeUnitVariants(obj.unit_variants)
  if (!variants.ok) return variants
  const market = normalizeMarketSnapshot(obj.market_snapshot)
  if (!market.ok) return market
  const facts = normalizeFacts(obj.facts)
  if (!facts.ok) return facts
  const gaps = textArray(obj.gaps, 'gaps', MAX_LONG_TEXT)
  if (!gaps.ok) return gaps
  const sources = normalizeSources(obj.sources)
  if (!sources.ok) return sources

  return {
    ok: true,
    value: {
      buyer_segments:  segments.value,
      angle_ranking:   angles.value,
      hesitations:     hesitations.value,
      unit_variants:   variants.value,
      market_snapshot: market.value,
      facts:           facts.value,
      gaps:            gaps.value,
      sources:         sources.value,
    },
  }
}

// ── 人手校正(PATCH)的校验 ──────────────────────────────────────────────────

function normalizeOutcomes(v: unknown): SchemaResult<BriefOutcomes> {
  const obj = asObject(v)
  if (!obj) return fail('outcomes 必须是一个对象')

  const segs = enumArray(obj.actual_segments, 'outcomes.actual_segments', isBuyerSegment, BUYER_SEGMENTS)
  if (!segs.ok) return segs

  let winning: ListingAngle | null = null
  if (obj.winning_angle !== null && obj.winning_angle !== undefined && obj.winning_angle !== '') {
    if (!isListingAngle(obj.winning_angle)) {
      return fail(`outcomes.winning_angle 不认识(只能是:${LISTING_ANGLES.join(' / ')})`)
    }
    winning = obj.winning_angle
  }

  const cost = finiteNumber(obj.cost_per_qualified, 'outcomes.cost_per_qualified')
  if (!cost.ok) return cost
  if (cost.value !== null && cost.value < 0) return fail('每个够格 lead 的成本不能是负数')

  const notes = text(obj.notes, 'outcomes.notes', MAX_LONG_TEXT)
  if (!notes.ok) return notes

  return {
    ok: true,
    value: {
      actual_segments: segs.value,
      winning_angle: winning,
      cost_per_qualified: cost.value,
      notes: notes.value,
    },
  }
}

/** 内容字段逐个处理。只看请求里真正出现的 key —— 没出现 = 不动。 */
// eslint-disable-next-line complexity
function collectContentPatch(obj: Record<string, unknown>, out: ListingBriefPatch): string | null {
  if ('buyer_segments' in obj) {
    const r = enumArray(obj.buyer_segments, 'buyer_segments', isBuyerSegment, BUYER_SEGMENTS)
    if (!r.ok) return r.error
    out.buyer_segments = r.value
  }
  if ('hesitations' in obj) {
    const r = enumArray(obj.hesitations, 'hesitations', isListingHesitation, LISTING_HESITATIONS)
    if (!r.ok) return r.error
    out.hesitations = r.value
  }
  if ('angle_ranking' in obj) {
    const r = normalizeAngleRanking(obj.angle_ranking)
    if (!r.ok) return r.error
    out.angle_ranking = r.value
  }
  if ('unit_variants' in obj) {
    const r = normalizeUnitVariants(obj.unit_variants)
    if (!r.ok) return r.error
    out.unit_variants = r.value
  }
  if ('market_snapshot' in obj) {
    const r = normalizeMarketSnapshot(obj.market_snapshot)
    if (!r.ok) return r.error
    out.market_snapshot = r.value
  }
  if ('facts' in obj) {
    const r = normalizeFacts(obj.facts)
    if (!r.ok) return r.error
    out.facts = r.value
  }
  if ('gaps' in obj) {
    const r = textArray(obj.gaps, 'gaps', MAX_LONG_TEXT)
    if (!r.ok) return r.error
    out.gaps = r.value
  }
  if ('sources' in obj) {
    const r = normalizeSources(obj.sources)
    if (!r.ok) return r.error
    out.sources = r.value
  }
  return null
}

/**
 * 人手改档案。
 *
 * 跟 AI draft 走**同一批 guard** —— 人手改也不能塞非法枚举,否则「后端严、前端松」
 * 的差别就成了下一个 bug 的藏身处。
 */
export function validateBriefPatch(body: unknown): SchemaResult<ListingBriefPatch> {
  const obj = asObject(body)
  if (!obj) return fail('请求内容必须是一个对象')

  const out: ListingBriefPatch = {}
  const err = collectContentPatch(obj, out)
  if (err) return fail(err)

  if ('outcomes' in obj) {
    const r = normalizeOutcomes(obj.outcomes)
    if (!r.ok) return r
    out.outcomes = r.value
  }
  if ('verdict' in obj) {
    if (!isListingBriefVerdict(obj.verdict)) {
      return fail(`verdict 不认识(只能是:${LISTING_BRIEF_VERDICTS.join(' / ')})`)
    }
    out.verdict = obj.verdict
  }

  if (Object.keys(out).length === 0) return fail('没有要修改的字段')
  return { ok: true, value: out }
}
