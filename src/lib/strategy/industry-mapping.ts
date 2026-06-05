/**
 * A2.1-γ — Industry mapping helper
 *
 * Resolves clients.industry (free text) → industry_ai_visibility_questions.industry_code
 * (controlled enum, see src/lib/industry-ai-visibility/types.ts).
 *
 * Without this layer, fetchAiVisibilityScore would silently write 0 to
 * goals.current_value when industry didn't match — visually indistinguishable
 * from a real "score 0" result. (魏征 v1 P0-2 fix)
 *
 * matchAliases() supports Chinese / abbreviation / alternate spelling lookup
 * against client.name + client.brand_aliases for top3_brands containment.
 *
 * Spec ref: docs/superpowers/specs/2026-06-04-a21-stepc-design-v3.md (v3.1)
 */

import type { IndustryCode } from '@/lib/industry-ai-visibility/types'

const MAPPING: Record<string, IndustryCode> = {
  // Tourism
  //
  // AU/NZ travel agents serve two directions:
  //   - outbound_tour: AU/NZ residents going overseas (CTS Tours NZ → China,
  //                    most retail travel agents). This is the dominant case
  //                    for ME's AU/NZ market.
  //   - inbound_tour:  overseas visitors coming TO AU/NZ (DMCs, inbound
  //                    operators, Chinese-language inbound DMCs). Smaller
  //                    market but distinct AI-question set.
  //
  // Default the generic keywords ("travel", "tourism", "tour operator") to
  // OUTBOUND because that's what most AU/NZ retail clients are. Inbound
  // operators must use an explicit keyword ("inbound tour" / "入境旅游" /
  // "中文旅行社") that ALL include the disambiguating signal.
  //
  // Pre-2026-06-05 these generic keywords mapped to inbound_tour and
  // silently misclassified CTS Tours NZ (outbound NZ→China) → "no AI
  // visibility snapshots for industry inbound_tour" because the inbound_tour
  // snapshot didn't match CTS's outbound question set.
  'travel':             'outbound_tour',
  'tourism':            'outbound_tour',
  'tour operator':      'outbound_tour',
  '出境旅游':           'outbound_tour',
  // Inbound operators must opt in explicitly:
  'inbound tour':       'inbound_tour',
  'inbound tourism':    'inbound_tour',
  '入境旅游':           'inbound_tour',
  '中文旅行社':         'inbound_tour',

  // Real estate
  'real estate':        'real_estate',
  '房产':               'real_estate',

  // Restaurant
  'restaurant':         'restaurant',
  'food':               'restaurant',
  '餐饮':               'restaurant',
  '中餐':               'restaurant',

  // Migration / education
  'migration':          'migration',
  'immigration':        'migration',
  'education agent':    'migration',
  '移民':               'migration',
  '留学':               'migration',

  // Flooring / building materials (魏征 v3.1 P1-B includes "and" variant)
  'flooring':           'flooring',
  'tiles':              'flooring',
  'flooring & tiles':   'flooring',
  'flooring and tiles': 'flooring',
  'building':           'flooring',
  'building materials': 'flooring',
  '地板':               'flooring',
  '瓷砖':               'flooring',
  '建材':               'flooring',
}

/**
 * Normalise + lookup. Robust to whitespace + ampersand spacing variations
 * (魏征 v3 P1-B: "Flooring  &  Tiles" / "Flooring And Tiles" all resolve).
 *
 * Returns null when industry not in MAPPING — callers MUST handle null by
 * returning ok:false rather than writing a default score.
 */
export function resolveIndustryCode(industry: string | null | undefined): IndustryCode | null {
  if (!industry) return null
  const normalised = industry
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')         // collapse double-spaces
    .replace(/\s*&\s*/g, ' & ')   // standardise & spacing
  return MAPPING[normalised] ?? null
}

/**
 * Case-insensitive substring match across client.name + brand_aliases.
 * Used to detect whether a client's brand appears in top3_brands.
 */
export function matchAliases(
  text: string,
  name: string,
  aliases: string[] | null | undefined,
): boolean {
  if (!text || !name) return false
  const lower = text.toLowerCase()
  if (lower.includes(name.toLowerCase())) return true
  for (const alias of aliases ?? []) {
    if (alias && lower.includes(alias.toLowerCase())) return true
  }
  return false
}
