/**
 * 素材来源与归属 —— 两条正交属性的唯一定义处（2026-08-03）。
 *
 *   source    = 这东西哪来的 → 决定**能不能打真实价格**
 *   ownership = 谁能看见它   → 决定**能不能给同行共用**
 *
 * 混成一个字段会出现「AI 衍生物归了客户 → 被当成真料去打价格」这类误用，
 * 所以红线只认 `source`，永远不认 `ownership`。
 *
 * 对应数据库：`client_assets.source` / `.ownership` 上的 CHECK 约束。
 * 改这里的取值必须同时改约束，否则写入会被数据库拒绝。
 */

export const ASSET_SOURCES = [
  'client_verified',
  'client_provided',
  'fde_shot',
  'stock',
  'ai_generated',
  'unknown',
] as const
export type AssetSource = (typeof ASSET_SOURCES)[number]

export const ASSET_OWNERSHIPS = ['client_exclusive', 'industry_shared'] as const
export type AssetOwnership = (typeof ASSET_OWNERSHIPS)[number]

/**
 * 能给真实价格背书的来源 —— 只有这两个。
 *
 * `client_provided`（上传链接进来的）**不在此列**：链接不过期、可无限转发，
 * 客户完全可能传网图或 AI 图进来。要用它打真价，必须先由 FDE 逐张确认
 * 升成 `client_verified`，那一步带审计记录（谁、何时）。
 */
const REAL_PRICE_SOURCES: ReadonlySet<string> = new Set<AssetSource>(['client_verified', 'fde_shot'])

/** 这张素材能不能出现在标了真实价格的对外内容里。 */
export function canBackRealPrice(source: string | null | undefined): boolean {
  return source != null && REAL_PRICE_SOURCES.has(source)
}

export function isAssetSource(value: unknown): value is AssetSource {
  return typeof value === 'string' && (ASSET_SOURCES as readonly string[]).includes(value)
}

export function isAssetOwnership(value: unknown): value is AssetOwnership {
  return typeof value === 'string' && (ASSET_OWNERSHIPS as readonly string[]).includes(value)
}

/**
 * 把外部传入的来源收敛成合法值；认不出的一律降级 `unknown`。
 *
 * 降级而非报错的理由：认不出的值最坏后果是「这张料暂时打不了真价」，
 * 而报错会让整批上传失败。宁可保守，不可挡住 FDE 干活。
 */
export function normaliseSource(value: unknown): AssetSource {
  return isAssetSource(value) ? value : 'unknown'
}

/** FDE 上传时能选的来源 —— 不含 `client_verified`（那个只能通过确认通道升级）。 */
export const FDE_UPLOAD_SOURCES: readonly AssetSource[] = [
  'fde_shot',
  'client_provided',
  'stock',
  'unknown',
]

/**
 * `visual_assets.provider` → 来源。那张表是「贴文的配图槽」，自己没有来源列。
 *
 * 返回 `null` 表示**必须回查素材库**（`client_library` 的图来自 `client_assets`，
 * 真值只在那边）。机器生成的图不必回查：AI 出的图永远给不了真实价格背书。
 * 认不出的 provider（历史 `upload` 等）降级 `unknown` —— 保守方向，顶多多问一句。
 */
export function sourceForVisualProvider(provider: string | null | undefined): AssetSource | null {
  if (provider === 'client_library') return null
  if (provider === 'wavespeed' || provider === 'openai') return 'ai_generated'
  return 'unknown'
}

/** 给界面用的中文说明，避免每个页面各写一套。 */
export const SOURCE_LABELS: Record<AssetSource, string> = {
  client_verified: '客户实拍（已确认）',
  client_provided: '客户提供（未核实）',
  fde_shot: '我们拍的',
  stock: '图库 / 网上抓的',
  ai_generated: 'AI 生成或改写',
  unknown: '来源不明',
}

// ─── AI 排版海报 —— 唯一能打真价的 AI 图（PM 2026-11-15「改规矩允许写」）──────────
//
// 一张 AI 排版海报（`vision_metadata.poster` 带血统）可以配真实价格，必须同时满足：
//   1. 原图**当前**的来源能打真价（client_verified / fde_shot）—— 原图被降级，海报跟着失效；
//   2. Magic Engine 团队成员看过海报、对过原图，签了字（verified_by + verified_at）；
//   3. 海报带价格时，即使文案没写价格，也按「这条帖子报了价」处理 —— 见 `posterHasPrice`。
// 理由：改图模型会重画照片里的东西，所以必须有人拿原图对过。
// 其余 AI 图规则不变：没有海报血统的 ai_generated 照旧打不了真价。

/** `client_assets.vision_metadata.poster` —— 海报的血统记录。 */
export interface PosterLineage {
  recipe_id: string
  recipe_version: number
  source_asset_id: string
  has_price: boolean
  text_lines: string[]
  cost_usd: number | null
  provider_request_id: string | null
  created_at: string
  /** YYYY-MM-DD of the departure printed on the poster; null when none is printed. */
  next_depart_on: string | null
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

function isNullableCost(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)
}

/**
 * 严格读海报血统：任何一个字段不合格就当它**不是**海报（返回 null）。
 * 不是海报 = 走普通 AI 图规则 = 打不了真价，所以读坏了只会更保守。
 */
export function readPosterLineage(visionMetadata: unknown): PosterLineage | null {
  if (!isPlainRecord(visionMetadata)) return null
  const p = visionMetadata.poster
  if (!isPlainRecord(p)) return null
  const ok =
    typeof p.recipe_id === 'string' && p.recipe_id.length > 0 &&
    typeof p.recipe_version === 'number' && Number.isInteger(p.recipe_version) && p.recipe_version > 0 &&
    typeof p.source_asset_id === 'string' && UUID_LIKE.test(p.source_asset_id) &&
    typeof p.has_price === 'boolean' &&
    Array.isArray(p.text_lines) && p.text_lines.every((l) => typeof l === 'string') &&
    isNullableCost(p.cost_usd) &&
    isNullableString(p.provider_request_id) &&
    typeof p.created_at === 'string' && !Number.isNaN(Date.parse(p.created_at)) &&
    (p.next_depart_on === undefined || p.next_depart_on === null ||
      (typeof p.next_depart_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.next_depart_on)))
  if (!ok) return null
  return {
    recipe_id: p.recipe_id as string,
    recipe_version: p.recipe_version as number,
    source_asset_id: p.source_asset_id as string,
    has_price: p.has_price as boolean,
    text_lines: [...(p.text_lines as string[])],
    cost_usd: p.cost_usd as number | null,
    provider_request_id: p.provider_request_id as string | null,
    created_at: p.created_at as string,
    next_depart_on: typeof p.next_depart_on === 'string' ? p.next_depart_on : null,
  }
}

/** 海报图里写了价格 —— 发布闸要把它当成「这条帖子报了价」。非海报一律 false。 */
export function posterHasPrice(visionMetadata: unknown): boolean {
  return readPosterLineage(visionMetadata)?.has_price === true
}

export interface AssetBackingInput {
  source: string | null | undefined
  verified_by: string | null | undefined
  verified_at: string | null | undefined
  vision_metadata: unknown
}

/** 团队签过字：verified_by 非空且 verified_at 是合法时间。 */
export function isPosterSigned(asset: Pick<AssetBackingInput, 'verified_by' | 'verified_at'>): boolean {
  return (
    typeof asset.verified_by === 'string' && asset.verified_by.trim().length > 0 &&
    typeof asset.verified_at === 'string' && !Number.isNaN(Date.parse(asset.verified_at))
  )
}

/**
 * 一整行素材能不能给真实价格背书。
 *
 * - 不是海报：跟 `canBackRealPrice(source)` 完全一样。
 * - 是海报：不看它自己的 source（就算被误标成「已确认」也不认），只认
 *   「原图当前来源能打真价」**且**「团队签过字」。`parentSource` 由调用方按原图
 *   **当前**那一行传进来；查不到原图就传 null —— 背不了。
 */
export function canAssetBackRealPrice(
  asset: AssetBackingInput,
  parentSource: string | null | undefined,
): boolean {
  if (readPosterLineage(asset.vision_metadata) === null) return canBackRealPrice(asset.source)
  return canBackRealPrice(parentSource) && isPosterSigned(asset)
}
