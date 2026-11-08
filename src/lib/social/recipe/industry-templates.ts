export type IndustryTemplateKey = 'travel' | 'logistics'

export interface SuggestedNumber {
  value: number
  suggested: true
}

export interface SuggestedRange {
  min: number
  max: number
  suggested: true
}

export interface IndustryTemplate {
  key: IndustryTemplateKey
  quotas: {
    reelPerWeek: SuggestedRange
    postPerWeek: SuggestedRange
    storyPerDay: SuggestedRange
  }
  /** Percentages; the values sum to 100. */
  mix: Readonly<Record<string, SuggestedNumber>>
  /** The "explain what it is" pillar, emphasised in the starting stage. */
  explainPillarKey: string
  formatRoles: { reel: string; post: string; story: string }
  humanReplyTopics: readonly string[]
  bannedClaims: readonly string[]
  peakSeasons: {
    description: string
    leadTimeWeeks: SuggestedRange | null
  }
}

function num(value: number): SuggestedNumber {
  return { value, suggested: true }
}

function range(min: number, max: number): SuggestedRange {
  return { min, max, suggested: true }
}

const TRAVEL_TEMPLATE: IndustryTemplate = {
  key: 'travel',
  quotas: {
    reelPerWeek: range(1, 2),
    postPerWeek: range(3, 3),
    storyPerDay: range(1, 1),
  },
  mix: {
    travel_mood: num(35),
    practical_info: num(25),
    guest_stories: num(20),
    tour_intro: num(15),
    expertise_history: num(5),
  },
  explainPillarKey: 'tour_intro',
  formatRoles: {
    reel: 'acquire: text hook on the first frame, never an empty scenery shot',
    post: 'explain one thing: what is included, what the price covers, why choose it',
    story:
      'reminder and companionship, never selling: morning inspiration, noon fact, evening invite to private message',
  },
  humanReplyTopics: [
    'pricing_quote',
    'reschedule',
    'visa_individual_case',
    'cancellation',
  ],
  bannedClaims: [
    'price_not_on_client_website_today',
    'invented_departure_dates',
    'guaranteed_outcome',
  ],
  peakSeasons: {
    description:
      'seasonal travel calendar peaks; start promoting ahead of the season',
    leadTimeWeeks: range(8, 10),
  },
}

const LOGISTICS_TEMPLATE: IndustryTemplate = {
  key: 'logistics',
  quotas: {
    reelPerWeek: range(1, 2),
    postPerWeek: range(3, 3),
    storyPerDay: range(1, 1),
  },
  mix: {
    how_to_ship: num(30),
    packaging_prohibited_damage: num(25),
    warehouse_loading_arrival: num(25),
    route_service_scenes: num(15),
    other: num(5),
  },
  explainPillarKey: 'how_to_ship',
  formatRoles: {
    reel:
      'acquire: real loading or arrival footage, text hook on the first frame, never an empty scenery shot',
    post: 'explain one thing: what to ship, roughly how long, what cannot be shipped',
    story:
      'reminder and companionship, never selling: morning in-transit picture, noon one rule, evening invite to private message for a quote or tracking number',
  },
  humanReplyTopics: [
    'quote',
    'change_address',
    'lost_or_damaged_parcel',
    'customs_individual_case',
  ],
  bannedClaims: [
    'price_not_on_client_website_today',
    'invented_transit_days',
    'guaranteed_delivery_time',
  ],
  peakSeasons: {
    description: 'shopping seasons and pre-holiday shipping rush',
    leadTimeWeeks: null,
  },
}

export const INDUSTRY_TEMPLATES: Record<IndustryTemplateKey, IndustryTemplate> = {
  travel: TRAVEL_TEMPLATE,
  logistics: LOGISTICS_TEMPLATE,
}

/**
 * Small lookup from clients.industry style values to a template key.
 * The three vocabularies are NOT merged here; this is only a lookup.
 */
const INDUSTRY_ALIASES: Readonly<Record<string, IndustryTemplateKey>> = {
  travel: 'travel',
  tourism_operator: 'travel',
  tourism_travel: 'travel',
  logistics: 'logistics',
  logistics_3pl: 'logistics',
  logistics_3pl_nz: 'logistics',
  freight: 'logistics',
  '3pl': 'logistics',
}

function normaliseIndustryKey(industryKey: string): string {
  return industryKey.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * Resolve an industry key to a template.
 * Unknown industries return null; there is never a fallback to a default.
 */
export function industryTemplateFor(
  industryKey: string | null | undefined,
): IndustryTemplate | null {
  if (industryKey === null || industryKey === undefined) {
    return null
  }
  const normalised = normaliseIndustryKey(industryKey)
  if (normalised.length === 0) {
    return null
  }
  if (!Object.prototype.hasOwnProperty.call(INDUSTRY_ALIASES, normalised)) {
    return null
  }
  const templateKey = INDUSTRY_ALIASES[normalised]
  return INDUSTRY_TEMPLATES[templateKey]
}
