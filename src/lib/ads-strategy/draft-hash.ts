import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'

export interface DraftHashCreative {
  name: string
  primaryText: string
  headline: string
  description?: string | null
  videoId?: string | null
  thumbnailImageHash?: string | null
  thumbnailUrl?: string | null
  language?: string | null
}

export interface DraftHashBuyerView {
  adName: string
  lines: readonly string[]
}

export interface DraftHashInput {
  kind: string
  creatives: readonly DraftHashCreative[]
  geoCountries: readonly string[]
  geoCityKeys?: readonly string[] | null
  ageMin?: number | null
  ageMax?: number | null
  dailyBudget: number
  durationDays: number
  pageId: string
  campaignId: string
  adSetId: string
  adIds: readonly string[]
  buyerWillSee: readonly DraftHashBuyerView[]
  capCentsSnapshot: number
  metaFingerprint: Readonly<Record<string, unknown>>
}

/** 可选字段统一归一：缺失 / undefined / null 都当 null；空串 '' 保留。 */
function normalizeOptional<T>(value: T | null | undefined): T | null {
  return value === undefined || value === null ? null : value
}

/** 集合语义：复制后排序，顺序不同但内容相同 → 摘要相同。 */
function normalizeSet(values: readonly string[] | null | undefined): string[] | null {
  if (values === undefined || values === null) return null
  return [...values].sort()
}

/** 逐字段挑出规范对象，多余属性一律忽略。 */
function toCanonical(input: DraftHashInput): Record<string, unknown> {
  return {
    kind: input.kind,
    creatives: input.creatives.map((creative) => ({
      name: creative.name,
      primaryText: creative.primaryText,
      headline: creative.headline,
      description: normalizeOptional(creative.description),
      videoId: normalizeOptional(creative.videoId),
      thumbnailImageHash: normalizeOptional(creative.thumbnailImageHash),
      thumbnailUrl: normalizeOptional(creative.thumbnailUrl),
      language: normalizeOptional(creative.language),
    })),
    geoCountries: normalizeSet(input.geoCountries),
    geoCityKeys: normalizeSet(input.geoCityKeys),
    ageMin: normalizeOptional(input.ageMin),
    ageMax: normalizeOptional(input.ageMax),
    dailyBudget: input.dailyBudget,
    durationDays: input.durationDays,
    pageId: input.pageId,
    campaignId: input.campaignId,
    adSetId: input.adSetId,
    adIds: normalizeSet(input.adIds),
    buyerWillSee: input.buyerWillSee.map((view) => ({
      adName: view.adName,
      lines: [...view.lines],
    })),
    capCentsSnapshot: input.capCentsSnapshot,
    metaFingerprint: input.metaFingerprint,
  }
}

/** 对"当时给授权人看的那版草案"算摘要；任何影响买家所见或花钱的字段变了，摘要就变。 */
export function computeDraftHash(input: DraftHashInput): string {
  return canonicalHashOfInput(toCanonical(input))
}
