/** Seven platform stage categories. Each client maps its own stage keys onto these (client config, never in shared code). */
export const STAGE_CATEGORIES = ['untouched', 'engaged', 'deep', 'won', 'no_reply', 'declined', 'not_lead'] as const
export type StageCategory = (typeof STAGE_CATEGORIES)[number]

/** Only the first four categories have an order. */
export const ORDERED_LEVEL: Readonly<Partial<Record<StageCategory, number>>> = {
  untouched: 0,
  engaged: 1,
  deep: 2,
  won: 3,
}

export function levelOf(c: StageCategory): number | null {
  return ORDERED_LEVEL[c] ?? null
}

export interface BaozhengClientConfig {
  enabled: boolean
  /** client stage_key -> category */
  stageCategories: Readonly<Record<string, StageCategory>>
  /** writer strings starting with one of these (case-insensitive) count as human, e.g. "PM-" */
  humanWriterPrefixes: readonly string[]
}

export const DISABLED_CONFIG: BaozhengClientConfig = {
  enabled: false,
  stageCategories: {},
  humanWriterPrefixes: [],
}

const STAGE_CATEGORY_SET: ReadonlySet<string> = new Set(STAGE_CATEGORIES)

function isStageCategory(v: unknown): v is StageCategory {
  return typeof v === 'string' && STAGE_CATEGORY_SET.has(v)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Parse clients.leads_config.baozheng. Shape:
 *   { enabled: boolean, stage_categories: { [stageKey: string]: StageCategory }, human_writer_prefixes: string[] }
 * Rules: input not an object, or no `baozheng` object -> DISABLED_CONFIG.
 * enabled is true ONLY when `baozheng.enabled === true`.
 * stage_categories: keep only entries whose key is a non-empty string and value is one of STAGE_CATEGORIES; drop the rest.
 * human_writer_prefixes: keep only non-empty trimmed strings; drop the rest.
 * Never throws.
 */
export function parseBaozhengConfig(leadsConfig: unknown): BaozhengClientConfig {
  if (!isPlainObject(leadsConfig)) return DISABLED_CONFIG
  const raw = leadsConfig['baozheng']
  if (!isPlainObject(raw)) return DISABLED_CONFIG

  const enabled = raw['enabled'] === true

  const stageCategories: Record<string, StageCategory> = {}
  const rawStages = raw['stage_categories']
  if (isPlainObject(rawStages)) {
    for (const [key, value] of Object.entries(rawStages)) {
      if (key.length === 0) continue
      if (!isStageCategory(value)) continue
      stageCategories[key] = value
    }
  }

  const humanWriterPrefixes: string[] = []
  const rawPrefixes = raw['human_writer_prefixes']
  if (Array.isArray(rawPrefixes)) {
    for (const item of rawPrefixes) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (trimmed.length === 0) continue
      humanWriterPrefixes.push(trimmed)
    }
  }

  return { enabled, stageCategories, humanWriterPrefixes }
}
