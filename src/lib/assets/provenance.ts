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
