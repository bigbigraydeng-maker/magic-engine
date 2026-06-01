const HARD_BLOCKED_PATTERNS = [
  /\bbunnings\b/i,
  /\bofficeworks\b/i,
  /\bcoles\b/i,
  /\bspotlights?\b/i,
  /\btoilets?\s+near\s+me\b/i,
  /\bbathrooms?\s+public\b/i,
  /\bcoles\s+supermarket\b/i,
  /^canvas$/i,
  /^marketplace$/i,
]

const COMMON_TERMS = new Set([
  'and', 'are', 'australia', 'australian', 'best', 'buy', 'for', 'from',
  'guide', 'how', 'in', 'near', 'new', 'of', 'online', 'the', 'to', 'with',
])

const BUILDING_SUPPLIES_TERMS = [
  'floor', 'flooring', 'timber', 'hardwood', 'hybrid', 'laminate', 'vinyl',
  'spc', 'decking', 'tile', 'tiles', 'cladding', 'panel', 'panels', 'supplier',
  'supplies', 'building', 'renovation',
]

interface BusinessContext {
  domain?: string | null
  industry?: string | null
  seedTerms?: string[]
}

export function buildBusinessKeywordTerms(context: BusinessContext): string[] {
  const terms = new Set<string>()
  addTerms(terms, context.domain)
  addTerms(terms, context.industry)
  for (const seed of context.seedTerms ?? []) addTerms(terms, seed)

  const hint = [context.domain, context.industry, ...(context.seedTerms ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (/(floor|flooring|timber|building|suppl|renovat|oztop)/i.test(hint)) {
    for (const term of BUILDING_SUPPLIES_TERMS) terms.add(term)
  }

  return Array.from(terms)
}

export function extractBriefSeedTerms(brief: Record<string, unknown> | null | undefined): string[] {
  if (!brief) return []
  const fields = [
    'keyword_seeds',
    'seed_keywords',
    'services',
    'products',
    'primary_services',
    'target_keywords',
    'topics',
  ]

  const values: string[] = []
  for (const field of fields) {
    collectStrings(brief[field], values)
  }
  return values
}

export function isBusinessRelevantKeyword(keyword: string, businessTerms: string[]): boolean {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return false
  if (HARD_BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized))) return false

  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  const meaningfulWords = words.filter((word) => !COMMON_TERMS.has(word))
  if (meaningfulWords.length === 0) return false

  if (businessTerms.length === 0) return true
  return businessTerms.some((term) => normalized.includes(term))
}

function addTerms(terms: Set<string>, value: string | null | undefined): void {
  if (!value) return
  for (const word of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 3 && !COMMON_TERMS.has(word)) terms.add(word)
  }
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, output)
    }
  }
}
